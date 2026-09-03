import { join } from 'node:path';
import process from 'node:process';
import { appendFile } from 'node:fs/promises';
import { modelCatalogPath } from './config.mjs';
import { runProcess } from './process.mjs';
import { BenchmarkError, safeSegment, writeJson, writeUtf8 } from './utils.mjs';

// Runner: OpenAI Codex CLI (`codex exec`).
// Covers native Codex login (ChatGPT subscription) and every provider that
// exposes an OpenAI-compatible Responses or Chat Completions endpoint.

export const id = 'codex';
export const displayName = 'Codex CLI';
export const commandName = 'codex';
export const usageSource = 'codex-jsonl-turn.completed';
export const executionDefinition = 'Local wall-clock time from Codex process start through model inference, tool calls, file edits, and process exit. Validation, recording, composition, and publishing are excluded.';
export const supportedAuthenticationTypes = ['codex-login', 'environment'];

// Prompt builders stay importable from here for backwards compatibility.
export { buildFollowupPrompt, buildGenerationPrompt, buildRepairPrompt } from './prompts.mjs';

function tomlString(value) {
  return JSON.stringify(String(value));
}

function appendModelConfiguration(args, model, reasoning) {
  args.push('-m', model.model);
  args.push('-c', `model_reasoning_effort=${tomlString(reasoning)}`);

  if (model.provider.id !== 'openai') {
    const providerKey = model.provider.id;
    args.push('-c', `model_provider=${tomlString(providerKey)}`);
    args.push('-c', `model_providers.${providerKey}.name=${tomlString(model.provider.name)}`);
    args.push('-c', `model_providers.${providerKey}.base_url=${tomlString(model.provider.baseUrl)}`);
    args.push('-c', `model_providers.${providerKey}.wire_api=${tomlString(model.provider.wireApi)}`);
    args.push('-c', `model_providers.${providerKey}.requires_openai_auth=${Boolean(model.provider.requiresOpenAIAuth)}`);
    if (model.authentication.type === 'environment') {
      args.push('-c', `model_providers.${providerKey}.env_key=${tomlString(model.authentication.environmentVariable)}`);
    }
  }

  const catalog = modelCatalogPath(model);
  if (catalog) args.push('-c', `model_catalog_json=${tomlString(catalog)}`);
  return args;
}

function buildBaseArguments(model, reasoning, workspace) {
  const args = [
    'exec',
    '--ignore-user-config',
    '--ignore-rules',
    '--strict-config',
    '--skip-git-repo-check',
    '--json',
    '--approve-for-me',
    '-C', workspace,
  ];
  return appendModelConfiguration(args, model, reasoning);
}

export function buildArguments(model, reasoning, workspace) {
  return [...buildBaseArguments(model, reasoning, workspace), '-'];
}

export function buildResumeArguments(model, reasoning, workspace, sessionId) {
  return [
    ...buildBaseArguments(model, reasoning, workspace),
    'resume',
    safeSegment(sessionId, 'Codex session id'),
    '-',
  ];
}

// Legacy names kept for any external caller.
export const buildCodexArguments = buildArguments;
export const buildCodexResumeArguments = buildResumeArguments;

export function parseSessionId(stdout) {
  let sessionId = null;
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type !== 'thread.started') continue;
      const candidate = event.thread_id ?? event.threadId ?? event.thread?.id;
      if (typeof candidate === 'string' && candidate.length > 0) sessionId = candidate;
    } catch {
      // Non-JSON output is retained in the log and ignored for session discovery.
    }
  }
  return sessionId;
}
export const parseCodexSessionId = parseSessionId;

const USAGE_FIELDS = [
  'input_tokens',
  'cached_input_tokens',
  'cache_write_input_tokens',
  'output_tokens',
  'reasoning_output_tokens',
];

export function parseUsage(stdout) {
  const totals = Object.fromEntries(USAGE_FIELDS.map((field) => [field, 0]));
  let eventCount = 0;
  let complete = true;

  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type !== 'turn.completed' || !event.usage || typeof event.usage !== 'object') continue;
      eventCount += 1;
      for (const field of USAGE_FIELDS) {
        const value = event.usage[field];
        if (value === undefined && !['input_tokens', 'output_tokens'].includes(field)) continue;
        if (!Number.isSafeInteger(value) || value < 0) {
          complete = false;
          continue;
        }
        totals[field] += value;
      }
    } catch {
      // Non-JSON output is retained in the log and ignored for usage accounting.
    }
  }

  if (eventCount === 0) return null;
  return {
    source: usageSource,
    runner: id,
    event_count: eventCount,
    complete,
    reasoning_tokens_reported: true,
    ...totals,
    uncached_input_tokens: Math.max(0, totals.input_tokens - totals.cached_input_tokens),
    total_tokens: totals.input_tokens + totals.output_tokens,
    estimated_cost_usd: null,
  };
}
export const parseCodexUsage = parseUsage;

export function credentialStatus(model) {
  if (model.authentication.type === 'codex-login') {
    return { ok: true, type: 'codex-login', detail: 'native Codex authentication' };
  }
  return null;
}

export function isSubscriptionBacked(model) {
  return model.authentication.type === 'codex-login';
}

async function catalogCheck(model, skillRoot) {
  const execArgs = buildArguments(model, model.reasoning.default, skillRoot);
  const configArgs = [];
  for (let index = 0; index < execArgs.length; index += 1) {
    if (execArgs[index] === '-c') {
      configArgs.push('-c', execArgs[index + 1]);
      index += 1;
    }
  }
  configArgs.push('-c', `model=${JSON.stringify(model.model)}`);
  const result = await runProcess({ command: 'codex', args: ['debug', ...configArgs, 'models'], timeoutMs: 30000 });
  if (result.exitCode !== 0) return { ok: false, error: result.stderr.slice(-2000) };
  try {
    const catalog = JSON.parse(result.stdout);
    const found = catalog.models?.some((candidate) => candidate.slug === model.model);
    return found ? { ok: true } : { ok: false, error: `Model slug ${model.model} was not found in the resolved Codex catalog.` };
  } catch (error) {
    return { ok: false, error: `Codex returned invalid model catalog JSON: ${error.message}` };
  }
}

export async function doctorChecks(model, { skillRoot, probeModel = false }) {
  void probeModel;
  const checks = [];
  try {
    buildArguments(model, model.reasoning.default, skillRoot);
    checks.push({ name: `codex-config:${model.id}`, ok: true });
  } catch (error) {
    checks.push({ name: `codex-config:${model.id}`, ok: false, error: error.message });
  }
  checks.push({ name: `codex-model-catalog:${model.id}`, ...(await catalogCheck(model, skillRoot)) });
  return checks;
}

// Codex has no cheap real-call probe; the catalog check in doctorChecks covers
// model availability and configuration.
export async function preflight() {
  return null;
}

export function selfTest(model, { skillRoot, sessionProbe }) {
  const args = buildArguments(model, model.reasoning.default, skillRoot);
  const resumeArgs = buildResumeArguments(model, model.reasoning.default, skillRoot, sessionProbe);
  return {
    argsValid: args.length > 8,
    resumeArgsValid: resumeArgs.includes('resume') && resumeArgs.includes(sessionProbe),
  };
}

export function selfTestParsers() {
  const sessionProbe = '00000000-0000-0000-0000-000000000000';
  const parsedSession = parseSessionId(`${JSON.stringify({ type: 'thread.started', thread_id: sessionProbe })}\n`);
  if (parsedSession !== sessionProbe) {
    throw new BenchmarkError('Codex session id parser self-test failed.', { kind: 'configuration' });
  }
  const parsedUsage = parseUsage(`${JSON.stringify({
    type: 'turn.completed',
    usage: {
      input_tokens: 120,
      cached_input_tokens: 80,
      cache_write_input_tokens: 0,
      output_tokens: 30,
      reasoning_output_tokens: 10,
    },
  })}\n`);
  if (!parsedUsage?.complete
    || parsedUsage.input_tokens !== 120
    || parsedUsage.uncached_input_tokens !== 40
    || parsedUsage.total_tokens !== 150) {
    throw new BenchmarkError('Codex token usage parser self-test failed.', { kind: 'configuration' });
  }
  return parsedUsage;
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
  const args = sessionId
    ? buildResumeArguments(model, reasoning, workspace, sessionId)
    : buildArguments(model, reasoning, workspace);
  const progressWrites = [];
  const progressPath = join(logDirectory, 'progress.jsonl');
  const result = await runProcess({
    command: 'codex',
    args,
    cwd: workspace,
    env: { ...process.env },
    stdin: prompt,
    timeoutMs,
    softTimeoutMs,
    idleTimeoutMs,
    progressIntervalMs,
    secrets: secretValues,
    signal,
    onProgress: (snapshot) => {
      const events = String(snapshot.stdout ?? '').split(/\r?\n/).map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
      const completedItems = events.filter((event) => event.type === 'item.completed').map((event) => event.item ?? {});
      const usageSnapshot = parseUsage(snapshot.stdout);
      const record = {
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
        estimatedThinkingTokens: usageSnapshot?.reasoning_output_tokens ?? null,
        toolCalls: completedItems.filter((item) => ['command_execution', 'mcp_tool_call', 'file_change'].includes(item.type)).length,
        fileWrites: completedItems.filter((item) => item.type === 'file_change').length,
      };
      console.error(JSON.stringify(record));
      progressWrites.push(appendFile(progressPath, `${JSON.stringify(record)}\n`, 'utf8').catch(() => {}));
    },
  });
  await Promise.all(progressWrites);
  const discoveredSessionId = parseSessionId(result.stdout);
  const resolvedSessionId = discoveredSessionId ?? sessionId;
  const usage = parseUsage(result.stdout);

  await writeUtf8(join(logDirectory, `${phase}.jsonl`), result.stdout);
  await writeUtf8(join(logDirectory, `${phase}.stderr.log`), result.stderr);
  await writeJson(join(logDirectory, `${phase}.process.json`), {
    participant,
    runner: id,
    modelProfile: model.id,
    model: model.model,
    reasoning,
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
    captureTruncated: result.captureTruncated,
    resumed: Boolean(sessionId),
    sessionId: resolvedSessionId,
  });

  if (result.aborted) {
    throw new BenchmarkError(`Codex execution for participant ${participant} was stopped during ${phase} because the other participant failed`, {
      kind: 'infrastructure',
      details: { participant, phase, aborted: true, terminationReason: result.terminationReason },
    });
  }
  if (result.exitCode !== 0 || result.timedOut) {
    throw new BenchmarkError(`Codex execution failed for participant ${participant} during ${phase}${result.timedOut ? ' (generation timeout reached)' : ''}`, {
      kind: 'infrastructure',
      details: {
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        hardTimedOut: result.hardTimedOut,
        idleTimedOut: result.idleTimedOut,
        timeoutReason: result.terminationReason,
        participant,
        phase,
        stderrTail: result.stderr.slice(-2000),
      },
    });
  }

  if (sessionId && discoveredSessionId && discoveredSessionId !== sessionId) {
    throw new BenchmarkError(`Codex resumed an unexpected session for participant ${participant} during ${phase}`, {
      kind: 'infrastructure',
      details: { expectedSessionId: sessionId, discoveredSessionId },
    });
  }
  if (!resolvedSessionId) {
    throw new BenchmarkError(`Codex did not report a session id for participant ${participant} during ${phase}`, {
      kind: 'infrastructure',
    });
  }

  return { ...result, sessionId: resolvedSessionId, usage };
}
export const runCodexAgent = runAgent;
