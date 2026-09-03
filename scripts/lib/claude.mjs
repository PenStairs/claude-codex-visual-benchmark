import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { appendFile, readFile } from 'node:fs/promises';
import { runProcess } from './process.mjs';
import { BenchmarkError, pathExists, writeJson, writeUtf8 } from './utils.mjs';

// Runner: Anthropic Claude Code CLI (`claude -p`).
// Covers native Claude login (Claude Pro/Max subscription), an Anthropic API
// key, and every provider that exposes an Anthropic-compatible Messages
// endpoint (DeepSeek, GLM, Kimi, MiniMax, Qwen, local gateways, ...).

export const id = 'claude';
export const displayName = 'Claude Code CLI';
export const commandName = 'claude';
export const usageSource = 'claude-code-stream-json-result.modelUsage';
export const executionDefinition = 'Local wall-clock time from Claude Code process start through model inference, tool calls, file edits, and process exit. Validation, recording, composition, and publishing are excluded.';
export const supportedAuthenticationTypes = ['claude-login', 'environment'];

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Environment variables that could silently redirect a Claude Code run to a
// different provider, model, or credential than the profile declares.
const STRIPPED_ENVIRONMENT = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_EFFORT_LEVEL',
  'MAX_THINKING_TOKENS',
  'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
  'CLAUDE_CONFIG_DIR',
  // Nested-launch markers set by a parent Claude Code session (desktop app or CLI).
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
];

function isAnthropicFirstParty(model) {
  return (model.provider?.id ?? 'anthropic') === 'anthropic' && !model.provider?.baseUrl;
}

export function reasoningControl(model) {
  const requested = model.reasoning?.control;
  if (requested) {
    if (!['effort-flag', 'none'].includes(requested)) {
      throw new BenchmarkError(`Unsupported reasoning control for ${model.id}: ${requested} (use effort-flag or none)`, { kind: 'configuration' });
    }
    return requested;
  }
  return isAnthropicFirstParty(model) ? 'effort-flag' : 'none';
}

function validateProfile(model) {
  if (!supportedAuthenticationTypes.includes(model.authentication?.type)) {
    throw new BenchmarkError(`Claude runner profile ${model.id} needs authentication.type claude-login or environment.`, { kind: 'configuration' });
  }
  if (model.authentication.type === 'claude-login' && !isAnthropicFirstParty(model)) {
    throw new BenchmarkError(`Claude runner profile ${model.id} uses claude-login but declares a third-party baseUrl; subscription login only works against Anthropic.`, { kind: 'configuration' });
  }
  if (model.provider?.baseUrl && model.provider.wireApi && model.provider.wireApi !== 'anthropic') {
    throw new BenchmarkError(`Claude runner profile ${model.id} must declare provider.wireApi "anthropic" (Claude Code only speaks the Anthropic Messages protocol).`, { kind: 'configuration' });
  }
  if (model.provider?.baseUrl && !/^https:\/\//i.test(model.provider.baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(model.provider.baseUrl)) {
    throw new BenchmarkError(`Claude runner profile ${model.id} baseUrl must use https (or a localhost http gateway).`, { kind: 'configuration' });
  }
  if (reasoningControl(model) === 'effort-flag') {
    for (const level of model.reasoning.allowed) {
      if (!EFFORT_LEVELS.includes(level)) {
        throw new BenchmarkError(`Claude runner profile ${model.id} allows reasoning preset ${level}, but --effort accepts only ${EFFORT_LEVELS.join(', ')}. Set reasoning.control to "none" or use those presets.`, { kind: 'configuration' });
      }
    }
  }
}

function baseArguments(model, reasoning) {
  validateProfile(model);
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', model.model,
    '--permission-mode', 'bypassPermissions',
    '--permission-prompts', 'none',
    // Benchmark isolation: no user-level settings, hooks, MCP servers, skills,
    // or Chrome bridge. The workspace CLAUDE.md is still discovered natively.
    '--setting-sources', 'project',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-chrome',
    '--disallowedTools', 'WebFetch,WebSearch',
  ];
  if (reasoningControl(model) === 'effort-flag') args.push('--effort', reasoning);
  return args;
}

export function buildArguments(model, reasoning, workspace, sessionId = randomUUID()) {
  if (!UUID_PATTERN.test(sessionId)) {
    throw new BenchmarkError('Claude session id must be a UUID.', { kind: 'configuration' });
  }
  // `workspace` is the process cwd (Claude Code scopes the session to it).
  void workspace;
  return [...baseArguments(model, reasoning), '--session-id', sessionId];
}

export function buildResumeArguments(model, reasoning, workspace, sessionId) {
  if (!UUID_PATTERN.test(String(sessionId))) {
    throw new BenchmarkError('Claude resume requires the UUID session id from round 1.', { kind: 'configuration' });
  }
  void workspace;
  return [...baseArguments(model, reasoning), '--resume', sessionId];
}

export function buildEnvironment(model, { apiTimeoutMs = 600000 } = {}) {
  const env = { ...process.env };
  for (const name of STRIPPED_ENVIRONMENT) delete env[name];

  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  env.DISABLE_AUTOUPDATER = '1';
  env.DISABLE_TELEMETRY = '1';
  env.DISABLE_ERROR_REPORTING = '1';
  env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE = '1';
  env.API_TIMEOUT_MS = String(model.runnerOptions?.apiTimeoutMs ?? apiTimeoutMs);

  if (model.authentication.type === 'environment') {
    const secret = process.env[model.authentication.environmentVariable];
    if (!secret) {
      throw new BenchmarkError(`Environment variable ${model.authentication.environmentVariable} is not set for ${model.id}.`, { kind: 'infrastructure' });
    }
    const header = model.authentication.header ?? (isAnthropicFirstParty(model) ? 'x-api-key' : 'bearer');
    if (header === 'x-api-key') env.ANTHROPIC_API_KEY = secret;
    else env.ANTHROPIC_AUTH_TOKEN = secret;
  }

  if (model.provider?.baseUrl) {
    env.ANTHROPIC_BASE_URL = model.provider.baseUrl;
    // Third-party endpoints usually serve one model. Route every Claude Code
    // internal model role to the benchmark model so no hidden Anthropic call
    // (or an unknown model id) reaches the provider.
    env.ANTHROPIC_MODEL = model.model;
    env.ANTHROPIC_SMALL_FAST_MODEL = model.model;
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = model.model;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = model.model;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = model.model;
  }
  return env;
}

function parseEvents(stdout) {
  const events = [];
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // Non-JSON output is retained in the log and ignored for parsing.
    }
  }
  return events;
}

export function parseSessionId(stdout) {
  let sessionId = null;
  for (const event of parseEvents(stdout)) {
    if (event.type === 'system' && event.subtype === 'init' && typeof event.session_id === 'string') {
      sessionId = event.session_id;
    } else if (!sessionId && typeof event.session_id === 'string' && event.session_id) {
      sessionId = event.session_id;
    }
  }
  return sessionId;
}

function safeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function parseResult(stdout) {
  const results = parseEvents(stdout).filter((event) => event.type === 'result');
  return results.length ? results[results.length - 1] : null;
}

export function parseUsage(stdout) {
  const result = parseResult(stdout);
  if (!result) return null;

  let complete = result.subtype === 'success' && !result.is_error;
  let reasoningReported = false;
  const totals = {
    api_input_tokens: 0,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
  };
  let estimatedCostUsd = null;
  let costBasis = null;

  const modelUsage = result.modelUsage && typeof result.modelUsage === 'object' ? Object.values(result.modelUsage) : [];
  if (modelUsage.length) {
    for (const entry of modelUsage) {
      const fields = [
        ['api_input_tokens', entry.inputTokens],
        ['cached_input_tokens', entry.cacheReadInputTokens],
        ['cache_write_input_tokens', entry.cacheCreationInputTokens],
        ['output_tokens', entry.outputTokens],
      ];
      for (const [field, value] of fields) {
        const parsed = safeInteger(value);
        if (parsed === null) complete = false;
        else totals[field] += parsed;
      }
      if (entry.thinkingTokens !== undefined) {
        reasoningReported = true;
        const parsed = safeInteger(entry.thinkingTokens);
        if (parsed === null) complete = false;
        else totals.reasoning_output_tokens += parsed;
      }
      if (typeof entry.costUSD === 'number') {
        estimatedCostUsd = (estimatedCostUsd ?? 0) + entry.costUSD;
        costBasis = entry.costBasis ?? costBasis;
      }
    }
  } else if (result.usage && typeof result.usage === 'object') {
    const usage = result.usage;
    const fields = [
      ['api_input_tokens', usage.input_tokens],
      ['cached_input_tokens', usage.cache_read_input_tokens ?? 0],
      ['cache_write_input_tokens', usage.cache_creation_input_tokens ?? 0],
      ['output_tokens', usage.output_tokens],
    ];
    for (const [field, value] of fields) {
      const parsed = safeInteger(value);
      if (parsed === null) complete = false;
      else totals[field] += parsed;
    }
    const thinking = usage.output_tokens_details?.thinking_tokens;
    if (thinking !== undefined) {
      reasoningReported = true;
      totals.reasoning_output_tokens += safeInteger(thinking) ?? 0;
    }
  } else {
    return null;
  }

  if (typeof result.total_cost_usd === 'number' && estimatedCostUsd === null) estimatedCostUsd = result.total_cost_usd;

  // Shared schema: input_tokens counts every prompt token (cached or not) so
  // that uncached_input_tokens = input_tokens - cached_input_tokens matches the
  // Codex runner's accounting.
  const inputTokens = totals.api_input_tokens + totals.cached_input_tokens + totals.cache_write_input_tokens;
  return {
    source: modelUsage.length ? usageSource : 'claude-code-stream-json-result.usage',
    runner: id,
    event_count: 1,
    complete,
    reasoning_tokens_reported: reasoningReported,
    input_tokens: inputTokens,
    cached_input_tokens: totals.cached_input_tokens,
    cache_write_input_tokens: totals.cache_write_input_tokens,
    output_tokens: totals.output_tokens,
    reasoning_output_tokens: totals.reasoning_output_tokens,
    uncached_input_tokens: inputTokens - totals.cached_input_tokens,
    total_tokens: inputTokens + totals.output_tokens,
    estimated_cost_usd: estimatedCostUsd === null ? null : Number(estimatedCostUsd.toFixed(6)),
    estimated_cost_basis: costBasis ? `claude-code-${costBasis}-price` : null,
    num_turns: safeInteger(result.num_turns),
    api_duration_ms: safeInteger(result.duration_api_ms),
  };
}

export function credentialStatus(model) {
  if (model.authentication.type === 'claude-login') {
    return { ok: true, type: 'claude-login', detail: 'native Claude Code authentication' };
  }
  return null;
}

export function isSubscriptionBacked(model) {
  return model.authentication.type === 'claude-login';
}

async function loginCheck() {
  try {
    const result = await runProcess({ command: 'claude', args: ['auth', 'status'], timeoutMs: 30000 });
    const status = JSON.parse(result.stdout);
    return status.loggedIn
      ? { ok: true, detail: `${status.authMethod ?? 'unknown method'} / ${status.apiProvider ?? 'unknown provider'}` }
      : { ok: false, error: 'Claude Code is not logged in. Run `claude auth login` (or `claude` once) with the subscription account.' };
  } catch (error) {
    return { ok: false, error: `Could not read Claude Code auth status: ${error.message}` };
  }
}

async function helpSupports(flag) {
  const result = await runProcess({ command: 'claude', args: ['--help'], timeoutMs: 30000 });
  return { ok: result.exitCode === 0 && result.stdout.includes(flag), version: null };
}

export async function doctorChecks(model, { skillRoot, probeModel = false, preflightPolicy = {} }) {
  void skillRoot;
  const checks = [];
  try {
    buildArguments(model, model.reasoning.default, skillRoot);
    buildEnvironment(model);
    checks.push({ name: `claude-config:${model.id}`, ok: true, reasoningControl: reasoningControl(model) });
  } catch (error) {
    checks.push({ name: `claude-config:${model.id}`, ok: false, error: error.message });
  }

  for (const flag of ['--session-id', '--setting-sources', '--strict-mcp-config', '--permission-prompts']) {
    const support = await helpSupports(flag);
    if (!support.ok) checks.push({ name: `claude-flag:${flag}`, ok: false, error: `Installed Claude Code does not support ${flag}; upgrade Claude Code.` });
  }
  if (reasoningControl(model) === 'effort-flag') {
    const support = await helpSupports('--effort');
    checks.push({ name: `claude-effort-flag:${model.id}`, ok: support.ok, error: support.ok ? undefined : 'Installed Claude Code has no --effort flag; upgrade or set reasoning.control to "none".' });
  }

  if (model.authentication.type === 'claude-login') {
    checks.push({ name: `claude-login:${model.id}`, ...(await loginCheck()) });
  }
  if (probeModel) {
    try {
      const probe = await preflight(model, {
        timeoutMs: (preflightPolicy.timeoutSeconds ?? 120) * 1000,
        effort: preflightPolicy.effort ?? 'low',
      });
      checks.push({ name: `claude-model-probe:${model.id}`, ...probe });
    } catch (error) {
      checks.push({ name: `claude-model-probe:${model.id}`, ok: false, error: error.message });
    }
  }

  // User-level memory is outside --setting-sources and would leak private
  // instructions into one participant only. Surface it as a warning.
  const userMemory = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'CLAUDE.md');
  if (await pathExists(userMemory)) {
    const text = (await readFile(userMemory, 'utf8')).trim();
    if (text.length) {
      checks.push({
        name: `claude-user-memory:${model.id}`,
        ok: true,
        warning: `${userMemory} is not empty; its contents are added to this participant's context. Keep it empty or benchmark-neutral during runs.`,
      });
    }
  }
  return checks;
}

export function selfTest(model, { skillRoot, sessionProbe }) {
  const args = buildArguments(model, model.reasoning.default, skillRoot, sessionProbe);
  const resumeArgs = buildResumeArguments(model, model.reasoning.default, skillRoot, sessionProbe);
  return {
    argsValid: args.includes('--session-id') && args.includes(sessionProbe) && args.includes('stream-json'),
    resumeArgsValid: resumeArgs.includes('--resume') && resumeArgs.includes(sessionProbe),
  };
}

export function selfTestParsers() {
  const sessionProbe = '00000000-0000-4000-8000-000000000000';
  const stdout = [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: sessionProbe, model: 'probe' }),
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      num_turns: 3,
      duration_api_ms: 1000,
      session_id: sessionProbe,
      total_cost_usd: 0.01,
      usage: { input_tokens: 5, cache_creation_input_tokens: 10, cache_read_input_tokens: 20, output_tokens: 30 },
      modelUsage: {
        probe: { inputTokens: 40, outputTokens: 30, cacheReadInputTokens: 80, cacheCreationInputTokens: 0, thinkingTokens: 10, costUSD: 0.01, costBasis: 'list' },
      },
    }),
  ].join('\n');
  if (parseSessionId(stdout) !== sessionProbe) {
    throw new BenchmarkError('Claude session id parser self-test failed.', { kind: 'configuration' });
  }
  const usage = parseUsage(stdout);
  if (!usage?.complete
    || usage.input_tokens !== 120
    || usage.cached_input_tokens !== 80
    || usage.uncached_input_tokens !== 40
    || usage.reasoning_output_tokens !== 10
    || usage.total_tokens !== 150) {
    throw new BenchmarkError('Claude token usage parser self-test failed.', { kind: 'configuration' });
  }
  return usage;
}

function lastThinkingEstimate(stdout) {
  let estimate = null;
  for (const event of parseEvents(stdout)) {
    if (event.type === 'system' && event.subtype === 'thinking_tokens' && Number.isFinite(event.estimated_tokens)) {
      estimate = event.estimated_tokens;
    }
  }
  return estimate;
}

function countToolCalls(stdout) {
  let count = 0;
  for (const event of parseEvents(stdout)) {
    if (event.type !== 'assistant') continue;
    for (const block of event.message?.content ?? []) if (block.type === 'tool_use') count += 1;
  }
  return count;
}

function countFileWrites(stdout) {
  let count = 0;
  const writeTools = new Set(['Write', 'Edit', 'NotebookEdit']);
  for (const event of parseEvents(stdout)) {
    if (event.type !== 'assistant') continue;
    for (const block of event.message?.content ?? []) {
      if (block.type === 'tool_use' && writeTools.has(block.name)) count += 1;
    }
  }
  return count;
}

function progressRecord({ participant, model, phase, snapshot }) {
  return {
    type: 'benchmark-progress',
    timestamp: new Date().toISOString(),
    participant,
    runner: id,
    modelProfile: model.id,
    phase,
    reason: snapshot.reason,
    elapsedSeconds: Number((snapshot.elapsedMs / 1000).toFixed(1)),
    idleSeconds: Number((snapshot.idleMs / 1000).toFixed(1)),
    softLimitReached: snapshot.softTimeoutReached,
    estimatedThinkingTokens: lastThinkingEstimate(snapshot.stdout),
    toolCalls: countToolCalls(snapshot.stdout),
    fileWrites: countFileWrites(snapshot.stdout),
  };
}

// A few-token real call that surfaces the failures which otherwise only show
// up after the other participant has already burned its budget: expired
// OAuth token, Claude Code too old for the model, no access to the model,
// unreachable third-party endpoint.
export async function preflight(model, { timeoutMs = 120000, effort = 'low' } = {}) {
  validateProfile(model);
  const args = [
    '-p',
    '--output-format', 'json',
    '--model', model.model,
    '--tools', '',
    '--no-session-persistence',
    '--setting-sources', 'project',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-chrome',
    '--permission-prompts', 'none',
  ];
  if (reasoningControl(model) === 'effort-flag') args.push('--effort', effort);
  const startedAt = Date.now();
  const result = await runProcess({
    command: 'claude',
    args,
    env: buildEnvironment(model),
    stdin: 'Reply with exactly the word OK and nothing else.',
    timeoutMs,
  });
  let payload = null;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    // Non-JSON output is reported below.
  }
  const ok = result.exitCode === 0 && payload && !payload.is_error;
  return {
    ok,
    runner: id,
    model: model.model,
    durationMs: Date.now() - startedAt,
    servedModel: payload?.modelUsage ? Object.keys(payload.modelUsage)[0] ?? null : null,
    effort: reasoningControl(model) === 'effort-flag' ? effort : 'provider-default',
    usage: parseUsage(result.stdout),
    error: ok ? undefined : (payload?.result ?? result.stderr.slice(-500) ?? 'Claude Code preflight failed'),
    apiErrorStatus: payload?.api_error_status ?? undefined,
  };
}

export async function runAgent({
  participant,
  model,
  reasoning,
  workspace,
  prompt,
  timeoutMs,
  softTimeoutMs = 0,
  idleTimeoutMs = 0,
  progressIntervalMs = 0,
  logDirectory,
  secretValues = [],
  phase,
  sessionId = null,
  signal = null,
}) {
  const requestedSessionId = sessionId ?? randomUUID();
  const args = sessionId
    ? buildResumeArguments(model, reasoning, workspace, sessionId)
    : buildArguments(model, reasoning, workspace, requestedSessionId);
  const progressWrites = [];
  const progressPath = join(logDirectory, 'progress.jsonl');
  const result = await runProcess({
    command: 'claude',
    args,
    cwd: workspace,
    env: buildEnvironment(model),
    stdin: prompt,
    timeoutMs,
    softTimeoutMs,
    idleTimeoutMs,
    progressIntervalMs,
    secrets: secretValues,
    signal,
    onProgress: (snapshot) => {
      const record = progressRecord({ participant, model, phase, snapshot });
      console.error(JSON.stringify(record));
      progressWrites.push(appendFile(progressPath, `${JSON.stringify(record)}\n`, 'utf8').catch(() => {}));
    },
  });
  await Promise.all(progressWrites);
  const discoveredSessionId = parseSessionId(result.stdout);
  const resolvedSessionId = discoveredSessionId ?? requestedSessionId;
  const usage = parseUsage(result.stdout);
  const finalResult = parseResult(result.stdout);

  await writeUtf8(join(logDirectory, `${phase}.jsonl`), result.stdout);
  await writeUtf8(join(logDirectory, `${phase}.stderr.log`), result.stderr);
  await writeJson(join(logDirectory, `${phase}.process.json`), {
    participant,
    runner: id,
    modelProfile: model.id,
    model: model.model,
    reasoning,
    reasoningControl: reasoningControl(model),
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    hardTimedOut: result.hardTimedOut,
    idleTimedOut: result.idleTimedOut,
    softTimeoutReached: result.softTimeoutReached,
    terminationReason: result.terminationReason,
    lastActivityAt: result.lastActivityAt,
    aborted: result.aborted,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
    usage,
    resultSubtype: finalResult?.subtype ?? null,
    resultIsError: finalResult?.is_error ?? null,
    captureTruncated: result.captureTruncated,
    resumed: Boolean(sessionId),
    sessionId: resolvedSessionId,
  });

  if (result.aborted) {
    throw new BenchmarkError(`Claude Code execution for participant ${participant} was stopped during ${phase} because the other participant failed`, {
      kind: 'infrastructure',
      details: { participant, phase, aborted: true, terminationReason: result.terminationReason },
    });
  }
  if (finalResult?.is_error) {
    throw new BenchmarkError(`Claude Code reported an API/execution error for participant ${participant} during ${phase}: ${String(finalResult.result ?? '').slice(0, 300)}`, {
      kind: 'infrastructure',
      details: {
        resultSubtype: finalResult.subtype ?? null,
        apiErrorStatus: finalResult.api_error_status ?? null,
        participant,
        phase,
        resultTail: String(finalResult.result ?? '').slice(-2000),
      },
    });
  }
  if (result.exitCode !== 0 || result.timedOut) {
    const thinking = lastThinkingEstimate(result.stdout);
    throw new BenchmarkError(`Claude Code execution failed for participant ${participant} during ${phase}${result.timedOut ? ' (generation timeout reached)' : ''}`, {
      kind: 'infrastructure',
      details: {
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        hardTimedOut: result.hardTimedOut,
        idleTimedOut: result.idleTimedOut,
        timeoutReason: result.terminationReason,
        participant,
        phase,
        resultSubtype: finalResult?.subtype ?? null,
        toolCallsBeforeExit: countToolCalls(result.stdout),
        fileWritesBeforeExit: countFileWrites(result.stdout),
        estimatedThinkingTokensBeforeExit: thinking,
        stderrTail: result.stderr.slice(-2000),
      },
    });
  }
  if (discoveredSessionId && discoveredSessionId !== requestedSessionId) {
    throw new BenchmarkError(`Claude Code used an unexpected session for participant ${participant} during ${phase}`, {
      kind: 'infrastructure',
      details: { expectedSessionId: requestedSessionId, discoveredSessionId },
    });
  }
  if (!discoveredSessionId) {
    throw new BenchmarkError(`Claude Code did not report a session id for participant ${participant} during ${phase}`, {
      kind: 'infrastructure',
    });
  }

  return { ...result, sessionId: resolvedSessionId, usage };
}
