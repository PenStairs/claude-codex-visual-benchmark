#!/usr/bin/env node

import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { copyFile, readFile } from 'node:fs/promises';
import {
  credentialStatus,
  getMethod,
  getModel,
  getPrompt,
  listModels,
  listPrompts,
  loadPolicy,
  selectReasoning,
  validateModelMethod,
} from './lib/config.mjs';
import { buildFollowupPrompt, buildGenerationPrompt, buildRepairPrompt } from './lib/prompts.mjs';
import { RUNNERS, describeHarness, getRunner, runnerCommandNames, runnerId } from './lib/runners.mjs';
import { launchBenchmarkBrowser } from './lib/browser.mjs';
import { findDisallowedRemoteUrls, installThreeDependencies, recordThree, recordThreeDeterministic, validateSingleHtmlContract, verifyThree } from './lib/threejs.mjs';
import { recordTwigl, verifyTwigl } from './lib/twigl.mjs';
import { composeComparison, createFailureRecording } from './lib/video.mjs';
import { captureRecordingPair } from './lib/recording.mjs';
import { publishComparison } from './lib/publish.mjs';
import { resolveCommand, runProcess } from './lib/process.mjs';
import { estimateListPrice, selfTestPricing } from './lib/pricing.mjs';
import {
  BenchmarkError,
  SKILL_ROOT,
  compactError,
  compareWorkspaceSnapshot,
  copyDirectory,
  createRunId,
  ensureDirectory,
  pathExists,
  readJson,
  safeSegment,
  sha256,
  snapshotFiles,
  writeJson,
  writeUtf8,
} from './lib/utils.mjs';

function parseArguments(argv) {
  const [command = 'help', ...rest] = argv;
  const options = {};
  const positionals = [];
  const booleans = new Set(['publish', 'dry-run', 'json', 'include-disabled', 'probe-models']);

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const equals = token.indexOf('=');
    if (equals > 2) {
      options[token.slice(2, equals)] = token.slice(equals + 1);
      continue;
    }
    const key = token.slice(2);
    if (booleans.has(key)) {
      options[key] = true;
      continue;
    }
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) {
      throw new BenchmarkError(`Option --${key} requires a value.`, { kind: 'configuration' });
    }
    options[key] = value;
    index += 1;
  }
  return { command, options, positionals };
}

function emit(value, asJson = false) {
  if (asJson || typeof value !== 'string') console.log(JSON.stringify(value, null, 2));
  else console.log(value);
}

function requireOption(options, key) {
  if (!options[key]) throw new BenchmarkError(`Missing required option: --${key}`, { kind: 'configuration' });
  return options[key];
}

function parseModelIds(options, allModels) {
  if (!options.models) return allModels.map((model) => model.id);
  return [...new Set(options.models.split(',').map((value) => value.trim()).filter(Boolean))];
}

const TOKEN_USAGE_FIELDS = [
  'input_tokens',
  'cached_input_tokens',
  'cache_write_input_tokens',
  'output_tokens',
  'reasoning_output_tokens',
  'uncached_input_tokens',
  'total_tokens',
];

function recordAgentExecution(participant, phase, category, execution) {
  participant.agentExecutions.push({
    phase,
    category,
    startedAt: execution.startedAt,
    finishedAt: execution.finishedAt,
    durationMs: execution.durationMs,
    usage: execution.usage,
  });
}

function participantMetrics(participant) {
  const executions = participant.agentExecutions ?? [];
  const usageTotals = Object.fromEntries(TOKEN_USAGE_FIELDS.map((field) => [field, 0]));
  const missingUsagePhases = [];
  let usageEventCount = 0;
  let usageComplete = true;

  for (const execution of executions) {
    if (!execution.usage) {
      missingUsagePhases.push(execution.phase);
      usageComplete = false;
      continue;
    }
    usageEventCount += execution.usage.event_count;
    usageComplete = usageComplete && execution.usage.complete;
    for (const field of TOKEN_USAGE_FIELDS) usageTotals[field] += execution.usage[field] ?? 0;
  }

  const creativeDurationMs = executions
    .filter((execution) => execution.category === 'creative')
    .reduce((sum, execution) => sum + execution.durationMs, 0);
  const repairDurationMs = executions
    .filter((execution) => execution.category === 'repair')
    .reduce((sum, execution) => sum + execution.durationMs, 0);
  const completeTaskDurationMs = creativeDurationMs + repairDurationMs;

  const runner = getRunner(participant.model);
  const usageSources = [...new Set(executions.map((execution) => execution.usage?.source).filter(Boolean))];
  const reasoningReported = executions.every((execution) => execution.usage?.reasoning_tokens_reported !== false);

  const completeTaskTime = {
    definition: 'creativeRoundsDurationMs + repairRoundsDurationMs',
    durationMs: completeTaskDurationMs,
    durationSeconds: Number((completeTaskDurationMs / 1000).toFixed(3)),
    creativeRoundsDurationMs: creativeDurationMs,
    repairRoundsDurationMs: repairDurationMs,
  };
  const providerName = participant.model.provider.name ?? participant.model.provider.id;
  const subscriptionBacked = runner.isSubscriptionBacked(participant.model) || /coding plan/i.test(providerName);
  const listPriceEstimatedCost = {
    ...estimateListPrice(participant.model, executions),
    billingMode: subscriptionBacked ? 'subscription' : 'metered-api',
  };

  return {
    runner: runner.id,
    completeTaskTime,
    listPriceEstimatedCost,
    modelExecution: {
      definition: runner.executionDefinition,
      totalDurationMs: completeTaskDurationMs,
      totalDurationSeconds: Number((completeTaskDurationMs / 1000).toFixed(3)),
      creativeDurationMs,
      repairDurationMs,
      phases: executions,
    },
    tokenUsage: executions.length === 0 ? null : {
      source: usageSources.length === 1 ? usageSources[0] : (usageSources.length ? usageSources : runner.usageSource),
      complete: usageComplete && missingUsagePhases.length === 0,
      reasoning_tokens_reported: reasoningReported,
      event_count: usageEventCount,
      missing_phases: missingUsagePhases,
      ...usageTotals,
    },
    cost: listPriceEstimatedCost,
  };
}

function runTiming(startedAtMs) {
  const finishedAtMs = Date.now();
  return {
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    elapsedMs: finishedAtMs - startedAtMs,
    elapsedSeconds: Number(((finishedAtMs - startedAtMs) / 1000).toFixed(3)),
  };
}

function classifyTermination(error) {
  const details = error?.details ?? {};
  const text = `${error?.message ?? ''}\n${JSON.stringify(details)}`.toLowerCase();
  const status = details.apiErrorStatus
    ?? details.preflight?.find?.((entry) => entry.apiErrorStatus)?.apiErrorStatus
    ?? null;
  if (details.timeoutReason === 'idle-timeout' || details.terminationReason === 'idle-timeout') return { category: 'idle-timeout', retryable: true };
  if (details.timeoutReason === 'hard-timeout' || details.hardTimedOut) return { category: 'generation-timeout', retryable: true };
  if (details.aborted || details.terminationReason === 'peer-aborted') return { category: 'peer-aborted', retryable: true };
  const numericStatus = Number(status);
  if (numericStatus === 401 || /oauth access token has expired|unauthorized|authentication/.test(text)) return { category: 'authentication', retryable: true };
  if (numericStatus === 429 || /session limit|rate limit|quota|too many requests/.test(text)) return { category: 'quota-exhausted', retryable: true };
  if ([403, 404].includes(numericStatus) || /model.+not found|no access to.+model|permission denied.+model/.test(text)) return { category: 'model-access', retryable: false };
  if (numericStatus === 400 && /does not support this model|upgrade|version/.test(text)) return { category: 'unsupported-client-version', retryable: false };
  if (error?.kind === 'publishing') return { category: 'publishing', retryable: true };
  if (/verification|recording|ffmpeg|playwright|browser/.test(text)) return { category: 'verification-or-recording', retryable: true };
  if (/network|socket|econn|timeout|temporar/.test(text)) return { category: 'transient-network', retryable: true };
  return { category: 'unknown-infrastructure', retryable: false };
}

function participantSummary(participant) {
  return {
    side: participant.side,
    runner: runnerId(participant.model),
    modelProfile: participant.model.id,
    model: participant.model.model,
    displayName: participant.model.displayName,
    reasoning: participant.reasoning,
    workspace: participant.workspace,
    status: participant.status,
    creativeRoundsCompleted: participant.creativeRoundsCompleted,
    repairRoundsUsed: participant.repairRoundsUsed,
    verification: participant.verification,
    recording: participant.recording,
    recordingMetadata: participant.recordingMetadata,
    captureMode: participant.captureMode ?? participant.recordingMetadata?.captureMode ?? null,
    realtimeRecording: participant.realtimeRecording ?? null,
    captureFallback: participant.captureFallback ?? null,
    reusedFromRun: participant.reusedFromRun ?? null,
    metrics: participantMetrics(participant),
  };
}

async function commandVersion(command, args = ['--version']) {
  const result = await runProcess({ command, args, timeoutMs: 15000 });
  return {
    ok: result.exitCode === 0,
    command: result.command,
    version: (result.stdout || result.stderr).trim().split(/\r?\n/)[0],
  };
}

async function listModelsCommand(options) {
  const models = await listModels({ includeDisabled: options['include-disabled'] });
  emit(models.map((model) => ({
    id: model.id,
    name: model.displayName,
    runner: runnerId(model),
    runnerModel: model.model,
    provider: model.provider.name ?? model.provider.id,
    authentication: model.authentication.type === 'environment'
      ? `env:${model.authentication.environmentVariable}`
      : model.authentication.type,
    defaultReasoning: model.reasoning.default,
    supportedMethods: model.supportedMethods,
    listPrice: model.pricing ? {
      currency: model.pricing.currency,
      unitTokens: model.pricing.unitTokens,
      checkedAt: model.pricing.checkedAt,
      sourceUrl: model.pricing.sourceUrl,
      schedule: model.pricing.schedule,
    } : null,
    enabled: model.enabled !== false,
  })), options.json);
}

async function listPromptsCommand(options) {
  const method = requireOption(options, 'method');
  const prompts = await listPrompts(method);
  emit(prompts.map((prompt) => ({
    id: prompt.id,
    title: prompt.title,
    version: prompt.version,
    language: prompt.language,
    roundCount: prompt.roundCount,
  })), options.json);
}

function buildResolvedPlan({ modelA, modelB, reasoningA, reasoningB, method, prompt, policy, publishRequested }) {
  return {
    paidCallsOnRun: true,
    publishRequested,
    harness: describeHarness([modelA, modelB]),
    participants: [
      {
        side: 'a',
        displayName: modelA.displayName,
        profileId: modelA.id,
        runner: runnerId(modelA),
        runnerModel: modelA.model,
        reasoning: reasoningA,
        provider: modelA.provider.name ?? modelA.provider.id,
      },
      {
        side: 'b',
        displayName: modelB.displayName,
        profileId: modelB.id,
        runner: runnerId(modelB),
        runnerModel: modelB.model,
        reasoning: reasoningB,
        provider: modelB.provider.name ?? modelB.provider.id,
      },
    ],
    method: { id: method.id, displayName: method.displayName },
    prompt: {
      id: prompt.id,
      title: prompt.title,
      version: prompt.version,
      requirements: prompt.requirements ?? {},
      roundCount: prompt.roundCount,
      sha256: prompt.sha256,
      rounds: prompt.rounds.map((round) => ({
        index: round.index,
        id: round.id,
        sha256: round.sha256,
        byteLength: round.byteLength,
        text: round.text,
      })),
    },
    limits: {
      reasoningPolicy: policy.reasoningPolicy,
      generation: policy.generation,
      repair: policy.repair,
      preflight: policy.preflight,
      recovery: policy.recovery,
      threejsStartupTimeoutSeconds: policy.threejsStartupTimeoutSeconds,
    },
    recording: policy.video,
    output: {
      uploadOnlyFinalMp4: policy.uploadOnlyFinalMp4,
      localFileName: 'comparison.mp4',
    },
  };
}

function resolvedPlanHash(plan) {
  return sha256(Buffer.from(JSON.stringify(plan), 'utf8'));
}

function buildCreativeRoundPrompts(method, prompt) {
  return prompt.rounds.map((round, index) => {
    const agentPrompt = index === 0
      ? buildGenerationPrompt(method, prompt, round)
      : buildFollowupPrompt(round);
    return {
      index: round.index,
      id: round.id,
      sourceSha256: round.sha256,
      agentPrompt,
      sha256: sha256(Buffer.from(agentPrompt, 'utf8')),
      byteLength: Buffer.byteLength(agentPrompt, 'utf8'),
    };
  });
}

async function describeCommand(options) {
  const modelA = await getModel(requireOption(options, 'model-a'));
  const modelB = await getModel(requireOption(options, 'model-b'));
  if (modelA.id === modelB.id) throw new BenchmarkError('Choose two different model profiles.', { kind: 'configuration' });
  const method = await getMethod(requireOption(options, 'method'));
  const prompt = await getPrompt(method.id, requireOption(options, 'prompt'));
  validateModelMethod(modelA, method.id);
  validateModelMethod(modelB, method.id);
  getRunner(modelA);
  getRunner(modelB);
  const policy = await loadPolicy();
  const plan = buildResolvedPlan({
    modelA,
    modelB,
    reasoningA: selectReasoning(modelA, options['reasoning-a'], policy),
    reasoningB: selectReasoning(modelB, options['reasoning-b'], policy),
    method,
    prompt,
    policy,
    publishRequested: Boolean(options.publish),
  });
  emit({ ...plan, confirmationToken: resolvedPlanHash(plan) }, options.json);
}

async function doctorCommand(options) {
  const policy = await loadPolicy();
  const allModels = await listModels();
  const modelIds = parseModelIds(options, allModels);
  const selectedModels = await Promise.all(modelIds.map((id) => getModel(id)));
  const checks = [];

  const runnerCommands = selectedModels.length
    ? runnerCommandNames(selectedModels)
    : Object.values(RUNNERS).map((runner) => runner.commandName);
  const commands = [
    ['node', ['--version']],
    ['npm', ['--version']],
    ...runnerCommands.map((command) => [command, ['--version']]),
    ['ffmpeg', ['-version']],
    ['ffprobe', ['-version']],
  ];
  for (const [command, args] of commands) {
    try {
      checks.push({ name: command, ...(await commandVersion(command, args)) });
    } catch (error) {
      checks.push({ name: command, ok: false, error: error.message });
    }
  }

  const playwrightInstalled = await pathExists(join(SKILL_ROOT, 'node_modules', 'playwright'));
  if (!playwrightInstalled) {
    checks.push({ name: 'playwright-package', ok: false, error: 'Run npm install in the skill folder.' });
  } else {
    try {
      const browser = await launchBenchmarkBrowser();
      await browser.close();
      checks.push({ name: 'playwright-chromium', ok: true });
    } catch (error) {
      checks.push({ name: 'playwright-chromium', ok: false, error: error.message });
    }
  }

  for (const model of selectedModels) {
    const status = credentialStatus(model);
    checks.push({
      name: `credential:${model.id}`,
      ok: status.ok,
      runner: runnerId(model),
      authentication: status.type,
      detail: status.detail,
    });
    try {
      const runner = getRunner(model);
      checks.push(...(await runner.doctorChecks(model, {
        skillRoot: SKILL_ROOT,
        probeModel: Boolean(options['probe-models']),
        preflightPolicy: policy.preflight,
      })));
    } catch (error) {
      checks.push({ name: `runner:${model.id}`, ok: false, error: error.message });
    }
  }

  const report = {
    ok: checks.every((check) => check.ok),
    mode: options['probe-models'] ? 'static-and-paid-model-probe' : 'static-only',
    paidModelProbeRequested: Boolean(options['probe-models']),
    harness: selectedModels.length === 2 ? describeHarness(selectedModels) : undefined,
    warnings: checks.filter((check) => check.warning).map((check) => `${check.name}: ${check.warning}`),
    checks,
  };
  emit(report, options.json);
  if (!report.ok) process.exitCode = 2;
}

async function selfTestCommand(options) {
  const models = await listModels({ includeDisabled: true });
  const policy = await loadPolicy();
  const results = [];
  const modelsWithoutPricing = models.filter((model) => !model.pricing).map((model) => model.id);
  if (modelsWithoutPricing.length) {
    throw new BenchmarkError(`Enabled model profiles are missing public list-price configuration: ${modelsWithoutPricing.join(', ')}`, { kind: 'configuration' });
  }
  const expectedMaxProfiles = [
    'deepseek-v4.1-flash',
    'deepseek-v4.1-flash-claude',
    'glm-5.3-flash',
    'glm-5.3-flash-claude',
  ];
  if (policy.schemaVersion !== 8
    || policy.reasoningPolicy.defaultRequired !== 'high'
    || expectedMaxProfiles.some((id) => policy.reasoningPolicy.requiredByProfile[id] !== 'max')
    || policy.reasoningPolicy.allowAutomaticFallback !== false
    || policy.generation.softTimeoutSeconds !== 3600
    || policy.generation.hardTimeoutSeconds !== 10800
    || policy.generation.idleTimeoutSeconds !== 900
    || policy.repair.reasoning !== 'same-as-generation'
    || policy.repair.maximumRounds !== 2
    || policy.recovery.automaticPaidRetry !== false
    || policy.video.audio.enabled !== true
    || policy.video.audio.codec !== 'aac'
    || policy.video.cadence.pointerSamplesPerSecond !== policy.video.framesPerSecond
    || policy.video.cadence.maximumInteractionOverrunMs > 500
    || policy.video.cadence.severeFrameRetry.enabled !== true
    || policy.video.cadence.severeFrameRetry.maximumRetries !== 2
    || policy.video.deterministicFallback.enabled !== true
    || policy.video.deterministicFallback.applyToBothParticipants !== true
    || policy.video.deterministicFallback.imageFormat !== 'png') {
    throw new BenchmarkError('Quality-first policy self-test failed.', { kind: 'configuration' });
  }
  for (const methodId of ['threejs', 'twigl']) {
    const method = await getMethod(methodId);
    const prompts = await listPrompts(methodId);
    if (!prompts.length) throw new BenchmarkError(`No prompts configured for ${methodId}.`, { kind: 'configuration' });
    const prompt = await getPrompt(methodId, prompts[0].id);
    const creativeRounds = buildCreativeRoundPrompts(method, prompt);
    const templateFiles = await snapshotFiles(method.templatePath, { ignoreTopLevel: method.ignoredGeneratedPaths });
    results.push({
      method: methodId,
      prompt: prompt.id,
      promptSha256: prompt.sha256,
      promptRoundCount: prompt.roundCount,
      creativePromptBytes: creativeRounds.map((round) => round.byteLength),
      templateFileCount: Object.keys(templateFiles).length,
    });
  }
  const sessionProbe = '00000000-0000-4000-8000-000000000000';
  const parserProbes = {};
  for (const runner of Object.values(RUNNERS)) parserProbes[runner.id] = runner.selfTestParsers();
  const parsedUsage = parserProbes.codex;
  const claudeUsage = parserProbes.claude;
  if (parsedUsage.input_tokens !== claudeUsage.input_tokens
    || parsedUsage.uncached_input_tokens !== claudeUsage.uncached_input_tokens
    || parsedUsage.total_tokens !== claudeUsage.total_tokens) {
    throw new BenchmarkError('Runner usage schemas disagree on equivalent probes.', { kind: 'configuration' });
  }
  const metricsProbe = participantMetrics({
    model: models[0],
    agentExecutions: [
      {
        phase: 'prompt-round-1',
        category: 'creative',
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: '2026-01-01T00:00:01.200Z',
        durationMs: 1200,
        usage: parsedUsage,
      },
      {
        phase: 'repair-1',
        category: 'repair',
        startedAt: '2026-01-01T00:00:02.000Z',
        finishedAt: '2026-01-01T00:00:02.300Z',
        durationMs: 300,
        usage: parsedUsage,
      },
    ],
  });
  const pricingProbe = selfTestPricing();
  if (metricsProbe.completeTaskTime.durationMs !== 1500
    || metricsProbe.completeTaskTime.durationSeconds !== 1.5
    || metricsProbe.completeTaskTime.creativeRoundsDurationMs !== 1200
    || metricsProbe.completeTaskTime.repairRoundsDurationMs !== 300
    || metricsProbe.modelExecution.totalDurationMs !== 1500
    || metricsProbe.modelExecution.creativeDurationMs !== 1200
    || metricsProbe.modelExecution.repairDurationMs !== 300
    || metricsProbe.tokenUsage.input_tokens !== 240
    || metricsProbe.listPriceEstimatedCost.status !== 'estimated'
    || metricsProbe.listPriceEstimatedCost.amount !== metricsProbe.cost.amount
    || pricingProbe.fixed.amount !== 5.38
    || pricingProbe.weekly.amount !== 2
    || pricingProbe.periods.amount !== 2) {
    throw new BenchmarkError('Participant metrics aggregation self-test failed.', { kind: 'configuration' });
  }
  results.push({
    metricsAccountingValid: true,
    exactTiming: true,
    exactTokenUsage: true,
    listPriceEstimatedCost: true,
    exactSettledMonetaryCost: false,
    runners: Object.keys(RUNNERS),
  });
  for (const model of models) {
    const expectedReasoning = expectedMaxProfiles.includes(model.id) ? 'max' : 'high';
    const resolvedReasoning = selectReasoning(model, undefined, policy);
    if (model.reasoning.default !== expectedReasoning || resolvedReasoning !== expectedReasoning) {
      throw new BenchmarkError(`Reasoning policy self-test failed for ${model.id}: expected ${expectedReasoning}, got ${resolvedReasoning}.`, { kind: 'configuration' });
    }
    const runner = getRunner(model);
    const probe = runner.selfTest(model, { skillRoot: SKILL_ROOT, sessionProbe });
    if (!probe.argsValid || !probe.resumeArgsValid) {
      throw new BenchmarkError(`Runner argument self-test failed for ${model.id} (${runner.id}).`, { kind: 'configuration' });
    }
    results.push({
      model: model.id,
      runner: runner.id,
      reasoning: resolvedReasoning,
      argsValid: probe.argsValid,
      resumeArgsValid: probe.resumeArgsValid,
      containsCredentialValue: false,
    });
  }
  const requiredCommands = ['node', 'npm', 'ffmpeg', 'ffprobe'];
  const missingOptional = [];
  for (const command of requiredCommands) resolveCommand(command);
  for (const runner of Object.values(RUNNERS)) {
    try {
      resolveCommand(runner.commandName);
    } catch (error) {
      missingOptional.push({ runner: runner.id, command: runner.commandName, error: error.message });
    }
  }
  const allowMissingRunnerCli = process.env.BENCHMARK_SELF_TEST_ALLOW_MISSING_RUNNER_CLI === '1';
  if (missingOptional.length === Object.keys(RUNNERS).length && !allowMissingRunnerCli) {
    throw new BenchmarkError('No runner CLI is installed. Install Codex CLI and/or Claude Code.', { kind: 'infrastructure' });
  }
  if (missingOptional.length) results.push({
    runnerCommandsMissing: missingOptional,
    allowedBySelfTestEnvironment: allowMissingRunnerCli,
  });
  emit({ ok: true, policyVersion: policy.schemaVersion, results }, options.json);
}

async function prepareParticipant({ side, model, reasoning, runDirectory, method }) {
  const root = join(runDirectory, `model-${side}`);
  const workspace = join(root, 'workspace');
  const logDirectory = join(root, 'logs');
  await ensureDirectory(logDirectory);
  await copyDirectory(method.templatePath, workspace);
  const baseline = await snapshotFiles(workspace, { ignoreTopLevel: method.ignoredGeneratedPaths });
  return {
    side,
    model,
    reasoning,
    root,
    workspace,
    logDirectory,
    baseline,
    status: 'prepared',
    sessionId: null,
    creativeRoundsCompleted: 0,
    repairRoundsUsed: 0,
    verification: null,
    recording: null,
    agentExecutions: [],
  };
}

async function verifyParticipant(participant, method, prompt, policy, phase) {
  const current = await snapshotFiles(participant.workspace, { ignoreTopLevel: method.ignoredGeneratedPaths });
  const integrity = compareWorkspaceSnapshot(participant.baseline, current, method);
  let runtime = null;
  const failures = [];
  let repairable = true;

  if (!integrity.ok) {
    if (integrity.forbidden.length) {
      failures.push({ stage: 'integrity', message: 'Protected or additional files were changed.', files: integrity.forbidden });
      repairable = false;
    }
    if (integrity.missingRequiredChanges.length || integrity.missingRequiredAnyChanges.length) {
      failures.push({
        stage: 'implementation',
        message: 'Required implementation files were not changed.',
        files: [...integrity.missingRequiredChanges, ...integrity.missingRequiredAnyChanges],
      });
    }
  }

  if (method.id === 'threejs' && prompt.requirements?.singleHtml === true && integrity.forbidden.length === 0) {
    failures.push(...await validateSingleHtmlContract(participant.workspace, integrity));
  }

  if (integrity.forbidden.length === 0) {
    const policyViolations = [];
    for (const rel of method.allowedModifiedFiles) {
      const target = join(participant.workspace, ...rel.split('/'));
      if (!(await pathExists(target))) continue;
      const source = await readFile(target, 'utf8');
      const forbiddenPatterns = [
        { label: 'fetch call', pattern: /\bfetch\s*\(/ },
        { label: 'XMLHttpRequest', pattern: /\bXMLHttpRequest\b/ },
        { label: 'WebSocket', pattern: /\bWebSocket\s*\(/ },
      ];
      for (const url of findDisallowedRemoteUrls(source, {
        allowThreeCdnMapping: method.id === 'threejs' && prompt.requirements?.localThreeCdnMapping === true,
      })) {
        policyViolations.push(`${rel}: remote URL (${url})`);
      }
      for (const candidate of forbiddenPatterns) {
        if (candidate.pattern.test(source)) policyViolations.push(`${rel}: ${candidate.label}`);
      }
    }
    if (policyViolations.length) {
      failures.push({ stage: 'policy', message: 'Remote services or assets are not allowed.', violations: policyViolations });
      repairable = false;
    }
  }

  if (repairable && integrity.forbidden.length === 0) {
    const verificationLogDirectory = join(participant.logDirectory, phase);
    await ensureDirectory(verificationLogDirectory);
    if (method.id === 'threejs') {
      await installThreeDependencies(participant.workspace, verificationLogDirectory);
    }
    runtime = method.id === 'threejs'
      ? await verifyThree({ workspace: participant.workspace, logDirectory: verificationLogDirectory, videoPolicy: policy.video, startupTimeoutSeconds: policy.threejsStartupTimeoutSeconds, requirements: prompt.requirements })
      : await verifyTwigl({ workspace: participant.workspace, method, videoPolicy: policy.video });
    failures.push(...runtime.failures);
  }

  const verification = {
    ok: failures.length === 0,
    repairable,
    phase,
    integrity,
    runtime,
    failures,
  };
  participant.verification = verification;
  await writeJson(join(participant.logDirectory, `${phase}.verification.json`), verification);
  return verification;
}

async function settleAll(promises) {
  const results = await Promise.allSettled(promises);
  const rejected = results.find((result) => result.status === 'rejected');
  if (rejected) throw rejected.reason;
  return results.map((result) => result.value);
}

// Runs participant tasks in parallel but stops the others as soon as one
// fails, so a fast failure on one side (expired login, unsupported model,
// timeout) does not let the other side keep spending its budget.
async function settleAllFailFast(taskFactories) {
  const controller = new AbortController();
  let firstError = null;
  const results = await Promise.allSettled(taskFactories.map((factory) => (
    factory(controller.signal).catch((error) => {
      if (!firstError) {
        firstError = error;
        controller.abort();
      }
      throw error;
    })
  )));
  if (firstError) throw firstError;
  return results.map((result) => result.value);
}

async function preflightParticipants(participants, policy) {
  const outcomes = [];
  for (const participant of participants) {
    const runner = getRunner(participant.model);
    const probe = await runner.preflight(participant.model, {
      timeoutMs: policy.preflight.timeoutSeconds * 1000,
      effort: policy.preflight.effort,
    });
    if (probe) outcomes.push({ side: participant.side, modelProfile: participant.model.id, ...probe });
  }
  const failed = outcomes.filter((outcome) => !outcome.ok);
  if (failed.length) {
    throw new BenchmarkError(`Preflight failed before any paid generation started: ${failed.map((outcome) => `${outcome.modelProfile} (${String(outcome.error).slice(0, 200)})`).join('; ')}`, {
      kind: 'infrastructure',
      details: { preflight: outcomes },
    });
  }
  return outcomes;
}

async function runCreativeRounds(participants, creativeRounds, policy, secretValues) {
  for (const round of creativeRounds) {
    await settleAllFailFast(participants.map((participant) => async (signal) => {
      participant.status = `prompt-round-${round.index}`;
      const execution = await getRunner(participant.model).runAgent({
        participant: participant.side,
        model: participant.model,
        reasoning: participant.reasoning,
        workspace: participant.workspace,
        prompt: round.agentPrompt,
        timeoutMs: policy.generation.hardTimeoutSeconds * 1000,
        softTimeoutMs: policy.generation.softTimeoutSeconds * 1000,
        idleTimeoutMs: policy.generation.idleTimeoutSeconds * 1000,
        progressIntervalMs: policy.generation.progressIntervalSeconds * 1000,
        logDirectory: participant.logDirectory,
        secretValues,
        phase: `prompt-round-${round.index}`,
        sessionId: round.index === 1 ? null : participant.sessionId,
        signal,
      });
      recordAgentExecution(participant, `prompt-round-${round.index}`, 'creative', execution);
      participant.sessionId = execution.sessionId;
      participant.creativeRoundsCompleted = round.index;
    }));
  }
  for (const participant of participants) participant.status = 'generated';
}

async function repairParticipants(participants, method, prompt, policy, secretValues) {
  for (let round = 1; round <= policy.repair.maximumRounds; round += 1) {
    const candidates = participants.filter((participant) => !participant.verification.ok && participant.verification.repairable);
    if (!candidates.length) break;
    await settleAllFailFast(candidates.map((participant) => async (signal) => {
      const repairPrompt = buildRepairPrompt(method, participant.verification, round, policy.repair.maximumRounds);
      const execution = await getRunner(participant.model).runAgent({
        participant: participant.side,
        model: participant.model,
        reasoning: participant.reasoning,
        workspace: participant.workspace,
        prompt: repairPrompt,
        timeoutMs: policy.repair.timeoutSeconds * 1000,
        idleTimeoutMs: Math.min(policy.generation.idleTimeoutSeconds, policy.repair.timeoutSeconds) * 1000,
        progressIntervalMs: policy.generation.progressIntervalSeconds * 1000,
        logDirectory: participant.logDirectory,
        secretValues,
        phase: `repair-${round}`,
        sessionId: participant.sessionId,
        signal,
      });
      recordAgentExecution(participant, `repair-${round}`, 'repair', execution);
      participant.sessionId = execution.sessionId;
      participant.repairRoundsUsed = round;
    }));
    await settleAll(candidates.map((participant) => verifyParticipant(participant, method, prompt, policy, `repair-${round}`)));
  }
}

async function captureParticipant(participant, method, prompt, policy, captureMode = 'realtime') {
  const outputPath = join(participant.root, captureMode === 'deterministic-frame'
    ? 'recording-deterministic.mkv'
    : 'recording.mkv');
  const common = {
    workspace: participant.workspace,
    outputPath,
    modelLabel: participant.model.displayName,
    promptTitle: prompt.title,
    videoPolicy: policy.video,
    startupTimeoutSeconds: policy.threejsStartupTimeoutSeconds,
    interaction: method.recording.interaction,
    requirements: prompt.requirements,
  };

  if (participant.verification.ok) {
    if (method.id === 'threejs' && captureMode === 'deterministic-frame') await recordThreeDeterministic(common);
    else if (method.id === 'threejs') await recordThree(common);
    else await recordTwigl({ ...common, method });
  } else {
    const reason = participant.verification.failures
      .map((failure) => failure.message ?? failure.stage)
      .join(' · ');
    await createFailureRecording({
      outputPath,
      modelLabel: participant.model.displayName,
      promptTitle: prompt.title,
      reason,
      videoPolicy: policy.video,
      captureMode,
    });
  }
  return {
    recording: outputPath,
    recordingMetadata: await readJson(`${outputPath}.json`),
  };
}

async function recordParticipants(participants, method, prompt, policy) {
  for (const participant of participants) participant.status = 'recording';

  if (method.id !== 'threejs') {
    for (const participant of participants) {
      const captured = await captureParticipant(participant, method, prompt, policy, 'realtime');
      participant.recording = captured.recording;
      participant.recordingMetadata = captured.recordingMetadata;
      participant.captureMode = 'realtime';
      participant.realtimeRecording = { ok: true, ...captured };
      participant.captureFallback = { fallbackTriggered: false, triggerSides: [] };
      participant.status = participant.verification.ok ? 'passed' : 'model-failed';
    }
    return { captureMode: 'realtime', fallbackTriggered: false, triggerSides: [] };
  }

  const result = await captureRecordingPair({
    participants,
    allowDeterministicFallback: policy.video.deterministicFallback.enabled
      && policy.video.deterministicFallback.applyToBothParticipants,
    recordRealtime: async (participant) => await captureParticipant(participant, method, prompt, policy, 'realtime'),
    recordDeterministic: async (participant, provenance) => {
      const captured = await captureParticipant(participant, method, prompt, policy, 'deterministic-frame');
      captured.recordingMetadata.fallback = {
        triggeredBySides: provenance.triggerSides,
        realtimeEvidence: provenance.realtime,
      };
      await writeJson(`${captured.recording}.json`, captured.recordingMetadata);
      return captured;
    },
  });

  for (const entry of result.entries) {
    const participant = entry.participant;
    participant.recording = entry.selected.recording;
    participant.recordingMetadata = entry.selected.recordingMetadata;
    participant.captureMode = result.captureMode;
    participant.realtimeRecording = entry.realtime;
    participant.captureFallback = {
      fallbackTriggered: result.fallbackTriggered,
      triggerSides: result.triggerSides,
    };
    participant.status = participant.verification.ok ? 'passed' : 'model-failed';
  }
  return {
    captureMode: result.captureMode,
    fallbackTriggered: result.fallbackTriggered,
    triggerSides: result.triggerSides,
  };
}

async function resolveSourceRun(runValue, policy) {
  const raw = requireOption({ run: runValue }, 'run');
  const sourceRunDirectory = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(raw)
    ? join(SKILL_ROOT, policy.runRoot, raw)
    : resolve(raw);
  if (!(await pathExists(sourceRunDirectory))) {
    throw new BenchmarkError(`Source run does not exist: ${sourceRunDirectory}`, { kind: 'configuration' });
  }
  const runSpec = await readJson(join(sourceRunDirectory, 'run-spec.json'));
  const runReport = await readJson(join(sourceRunDirectory, 'run-report.json'));
  return { sourceRunDirectory, runSpec, runReport };
}

async function loadRecoveryContext(options) {
  const retrySide = safeSegment(requireOption(options, 'side'), 'retry side').toLowerCase();
  if (!['a', 'b'].includes(retrySide)) {
    throw new BenchmarkError('Retry side must be a or b.', { kind: 'configuration' });
  }
  const reusedSide = retrySide === 'a' ? 'b' : 'a';
  const policy = await loadPolicy();
  if (!policy.recovery.allowSingleParticipantRetry) {
    throw new BenchmarkError('Single-participant recovery is disabled by policy.', { kind: 'configuration' });
  }
  const source = await resolveSourceRun(options.run, policy);
  const sourceParticipants = source.runSpec.participants ?? [];
  const sourceRetry = sourceParticipants.find((entry) => entry.side === retrySide);
  const sourceReused = sourceParticipants.find((entry) => entry.side === reusedSide);
  if (!sourceRetry || !sourceReused) {
    throw new BenchmarkError('Source run does not contain both participants.', { kind: 'configuration' });
  }

  const method = await getMethod(source.runSpec.method?.id);
  const prompt = await getPrompt(method.id, source.runSpec.prompt?.id);
  if (prompt.version !== source.runSpec.prompt?.version || prompt.sha256 !== source.runSpec.prompt?.sha256) {
    throw new BenchmarkError('The configured prompt changed after the source run. Restore the exact prompt version before retrying one participant.', { kind: 'configuration' });
  }
  const modelA = await getModel(sourceParticipants.find((entry) => entry.side === 'a').modelProfile);
  const modelB = await getModel(sourceParticipants.find((entry) => entry.side === 'b').modelProfile);
  validateModelMethod(modelA, method.id);
  validateModelMethod(modelB, method.id);
  const reasoningA = selectReasoning(modelA, sourceParticipants.find((entry) => entry.side === 'a').reasoning, policy);
  const reasoningB = selectReasoning(modelB, sourceParticipants.find((entry) => entry.side === 'b').reasoning, policy);

  const sourceReusedSummary = source.runReport.participants?.find((entry) => entry.side === reusedSide);
  const sourceRetrySummary = source.runReport.participants?.find((entry) => entry.side === retrySide);
  if (!sourceReusedSummary
    || !Number.isInteger(sourceReusedSummary.creativeRoundsCompleted)
    || sourceReusedSummary.creativeRoundsCompleted < prompt.roundCount) {
    throw new BenchmarkError(`Participant ${reusedSide} did not complete every creative round in the source run and cannot be reused.`, { kind: 'configuration' });
  }
  if (sourceRetrySummary?.status === 'passed') {
    throw new BenchmarkError(`Participant ${retrySide} already passed in the source run. Use rerecord for recording infrastructure failures instead of spending another model run.`, { kind: 'configuration' });
  }
  const sourceReusedWorkspace = join(source.sourceRunDirectory, `model-${reusedSide}`, 'workspace');
  if (!(await pathExists(sourceReusedWorkspace))) {
    throw new BenchmarkError(`Reusable participant workspace is missing: ${sourceReusedWorkspace}`, { kind: 'configuration' });
  }

  const creativeRounds = [];
  for (const metadata of source.runSpec.creativeRounds ?? []) {
    const agentPrompt = await readFile(join(source.sourceRunDirectory, `prompt-round-${metadata.index}.txt`), 'utf8');
    if (sha256(Buffer.from(agentPrompt, 'utf8')) !== metadata.sha256) {
      throw new BenchmarkError(`Source prompt round ${metadata.index} no longer matches its recorded hash.`, { kind: 'configuration' });
    }
    creativeRounds.push({ ...metadata, agentPrompt });
  }
  if (creativeRounds.length !== prompt.roundCount) {
    throw new BenchmarkError('Source run is missing one or more exact agent prompt files.', { kind: 'configuration' });
  }

  const basePlan = buildResolvedPlan({
    modelA,
    modelB,
    reasoningA,
    reasoningB,
    method,
    prompt,
    policy,
    publishRequested: Boolean(options.publish),
  });
  const recoveryPlan = {
    ...basePlan,
    executionMode: 'recovered-single-participant',
    recovery: {
      sourceRunId: source.runSpec.runId ?? source.runReport.runId,
      retrySide,
      reusedSide,
      exactSourcePromptHashes: creativeRounds.map((round) => round.sha256),
      automaticPaidRetry: false,
    },
  };
  return {
    ...source,
    sourceRetry,
    sourceReused,
    sourceReusedSummary,
    sourceRetrySummary,
    sourceReusedWorkspace,
    retrySide,
    reusedSide,
    policy,
    method,
    prompt,
    modelA,
    modelB,
    reasoningA,
    reasoningB,
    creativeRounds,
    recoveryPlan,
    confirmationToken: resolvedPlanHash(recoveryPlan),
  };
}

async function describeRetryCommand(options) {
  const context = await loadRecoveryContext(options);
  emit({ ...context.recoveryPlan, confirmationToken: context.confirmationToken }, options.json);
}

async function prepareReusedParticipant({ context, runDirectory }) {
  const model = context.reusedSide === 'a' ? context.modelA : context.modelB;
  const reasoning = context.reusedSide === 'a' ? context.reasoningA : context.reasoningB;
  const participant = await prepareParticipant({
    side: context.reusedSide,
    model,
    reasoning,
    runDirectory,
    method: context.method,
  });
  for (const relativePath of context.method.allowedModifiedFiles) {
    const sourcePath = join(context.sourceReusedWorkspace, ...relativePath.split('/'));
    if (!(await pathExists(sourcePath))) continue;
    const destinationPath = join(participant.workspace, ...relativePath.split('/'));
    await ensureDirectory(dirname(destinationPath));
    await copyFile(sourcePath, destinationPath);
  }
  participant.status = 'generated-reused';
  participant.creativeRoundsCompleted = context.sourceReusedSummary.creativeRoundsCompleted;
  participant.repairRoundsUsed = context.sourceReusedSummary.repairRoundsUsed ?? 0;
  participant.agentExecutions = context.sourceReusedSummary.metrics?.modelExecution?.phases ?? [];
  participant.reusedFromRun = context.runSpec.runId ?? context.runReport.runId;
  await writeJson(join(participant.logDirectory, 'reuse-evidence.json'), {
    sourceRunId: participant.reusedFromRun,
    sourceSide: context.reusedSide,
    sourceWorkspace: context.sourceReusedWorkspace,
    copiedAllowedFiles: context.method.allowedModifiedFiles,
  });
  return participant;
}

async function retryParticipantCommand(options) {
  const runStartedAtMs = Date.now();
  const context = await loadRecoveryContext(options);
  if (!options['dry-run'] && options['confirmed-plan'] !== context.confirmationToken) {
    throw new BenchmarkError('The confirmed recovery plan is missing or stale. Run describe-retry with the exact same options, show it to the user, then pass its confirmationToken as --confirmed-plan.', {
      kind: 'configuration',
      details: { expectedConfirmationToken: context.confirmationToken },
    });
  }
  const runId = options['run-id'] ? safeSegment(options['run-id'], 'run id') : createRunId();
  const runRoot = options['output-dir'] ? resolve(options['output-dir']) : join(SKILL_ROOT, context.policy.runRoot);
  const runDirectory = join(runRoot, runId);
  if (await pathExists(runDirectory)) throw new BenchmarkError(`Run directory already exists: ${runDirectory}`, { kind: 'configuration' });
  await ensureDirectory(runDirectory);

  const runSpec = {
    schemaVersion: 3,
    runId,
    createdAt: new Date(runStartedAtMs).toISOString(),
    status: options['dry-run'] ? 'dry-run' : 'running',
    executionMode: 'recovered-single-participant',
    recovery: context.recoveryPlan.recovery,
    method: context.runSpec.method,
    prompt: context.runSpec.prompt,
    creativeRounds: context.creativeRounds.map(({ agentPrompt, ...metadata }) => metadata),
    policy: context.policy,
    harness: describeHarness([context.modelA, context.modelB]),
    participants: context.recoveryPlan.participants.map((entry) => ({
      side: entry.side,
      runner: entry.runner,
      modelProfile: entry.profileId,
      model: entry.runnerModel,
      displayName: entry.displayName,
      reasoning: entry.reasoning,
    })),
    publishRequested: Boolean(options.publish),
    confirmedPlanSha256: options['dry-run'] ? null : context.confirmationToken,
  };
  await writeJson(join(runDirectory, 'run-spec.json'), runSpec);
  await settleAll(context.creativeRounds.map((round) => writeUtf8(join(runDirectory, `prompt-round-${round.index}.txt`), round.agentPrompt)));
  await writeUtf8(join(runDirectory, 'generation-prompt.txt'), context.creativeRounds[0].agentPrompt);

  const retryModel = context.retrySide === 'a' ? context.modelA : context.modelB;
  const retryReasoning = context.retrySide === 'a' ? context.reasoningA : context.reasoningB;
  const prepared = await settleAll([
    prepareParticipant({ side: context.retrySide, model: retryModel, reasoning: retryReasoning, runDirectory, method: context.method }),
    prepareReusedParticipant({ context, runDirectory }),
  ]);
  const participants = ['a', 'b'].map((side) => prepared.find((participant) => participant.side === side));
  const retryParticipant = participants.find((participant) => participant.side === context.retrySide);
  const reusedParticipant = participants.find((participant) => participant.side === context.reusedSide);

  if (options['dry-run']) {
    const report = { ok: true, dryRun: true, executionMode: 'recovered-single-participant', runId, runDirectory, timing: runTiming(runStartedAtMs), runSpec };
    await writeJson(join(runDirectory, 'run-report.json'), report);
    return report;
  }

  let preflight = [];
  try {
    const status = credentialStatus(retryParticipant.model);
    if (!status.ok) throw new BenchmarkError(`Missing credential configuration: ${retryParticipant.model.id} (${status.detail})`, { kind: 'infrastructure' });
    const secretValues = [status.secret].filter(Boolean);
    preflight = await preflightParticipants([retryParticipant], context.policy);
    await writeJson(join(runDirectory, 'preflight.json'), preflight);
    if (context.method.id === 'threejs') await installThreeDependencies(retryParticipant.workspace, retryParticipant.logDirectory);
    await runCreativeRounds([retryParticipant], context.creativeRounds, context.policy, secretValues);
    await settleAll(participants.map((participant) => verifyParticipant(participant, context.method, context.prompt, context.policy, 'creative-rounds')));
    if (!reusedParticipant.verification.ok) {
      throw new BenchmarkError('The reused participant no longer verifies against the current harness; recovery was stopped before any repair changed it.', {
        kind: 'infrastructure',
        details: { participant: reusedParticipant.side, verification: reusedParticipant.verification },
      });
    }
    await repairParticipants([retryParticipant], context.method, context.prompt, context.policy, secretValues);
    const capture = await recordParticipants(participants, context.method, context.prompt, context.policy);

    const outputPath = join(runDirectory, 'comparison.mp4');
    const videoProbe = await composeComparison({
      topPath: participants[0].recording,
      bottomPath: participants[1].recording,
      outputPath,
      videoPolicy: context.policy.video,
      logDirectory: runDirectory,
    });
    const metadata = {
      schemaVersion: 3,
      runId,
      method: context.method.id,
      prompt: { id: context.prompt.id, version: context.prompt.version, roundCount: context.prompt.roundCount, sha256: context.prompt.sha256 },
      executionMode: 'recovered-single-participant',
      recovery: context.recoveryPlan.recovery,
      capture,
      harness: describeHarness(participants.map((participant) => participant.model)),
      participants: participants.map((participant) => ({
        side: participant.side,
        runner: runnerId(participant.model),
        modelProfile: participant.model.id,
        model: participant.model.model,
        reasoning: participant.reasoning,
        status: participant.status,
        creativeRoundsCompleted: participant.creativeRoundsCompleted,
        repairRoundsUsed: participant.repairRoundsUsed,
      })),
    };
    const publication = options.publish ? await publishComparison({ outputPath, runId, metadata }) : null;
    const report = {
      ok: true,
      status: 'completed',
      completion: 'conclusive',
      executionMode: 'recovered-single-participant',
      recovery: context.recoveryPlan.recovery,
      runId,
      runDirectory,
      outputPath,
      videoProbe,
      capture,
      timing: runTiming(runStartedAtMs),
      harness: describeHarness(participants.map((participant) => participant.model)),
      participants: participants.map(participantSummary),
      preflight,
      publication,
    };
    await writeJson(join(runDirectory, 'run-report.json'), report);
    return report;
  } catch (error) {
    const report = {
      ok: false,
      status: error?.kind === 'publishing' ? 'publishing-failed' : 'infrastructure-failed',
      completion: 'inconclusive',
      executionMode: 'recovered-single-participant',
      recovery: context.recoveryPlan.recovery,
      runId,
      runDirectory,
      error: compactError(error),
      termination: classifyTermination(error),
      timing: runTiming(runStartedAtMs),
      participants: participants.map(participantSummary),
      preflight,
    };
    await writeJson(join(runDirectory, 'run-report.json'), report);
    throw error;
  }
}

async function runBenchmark(options) {
  const runStartedAtMs = Date.now();
  const modelA = await getModel(requireOption(options, 'model-a'));
  const modelB = await getModel(requireOption(options, 'model-b'));
  if (modelA.id === modelB.id) throw new BenchmarkError('Choose two different model profiles.', { kind: 'configuration' });
  const method = await getMethod(requireOption(options, 'method'));
  const prompt = await getPrompt(method.id, requireOption(options, 'prompt'));
  validateModelMethod(modelA, method.id);
  validateModelMethod(modelB, method.id);
  getRunner(modelA);
  getRunner(modelB);
  const policy = await loadPolicy();
  const reasoningA = selectReasoning(modelA, options['reasoning-a'], policy);
  const reasoningB = selectReasoning(modelB, options['reasoning-b'], policy);
  const resolvedPlan = buildResolvedPlan({
    modelA,
    modelB,
    reasoningA,
    reasoningB,
    method,
    prompt,
    policy,
    publishRequested: Boolean(options.publish),
  });
  const expectedConfirmationToken = resolvedPlanHash(resolvedPlan);
  if (!options['dry-run'] && options['confirmed-plan'] !== expectedConfirmationToken) {
    throw new BenchmarkError('The confirmed benchmark plan is missing or stale. Run describe with the exact same options, show it to the user, then pass its confirmationToken as --confirmed-plan.', {
      kind: 'configuration',
      details: { expectedConfirmationToken },
    });
  }
  const runId = options['run-id'] ? safeSegment(options['run-id'], 'run id') : createRunId();
  const runRoot = options['output-dir'] ? resolve(options['output-dir']) : join(SKILL_ROOT, policy.runRoot);
  const runDirectory = join(runRoot, runId);
  if (await pathExists(runDirectory)) throw new BenchmarkError(`Run directory already exists: ${runDirectory}`, { kind: 'configuration' });
  await ensureDirectory(runDirectory);

  const creativeRounds = buildCreativeRoundPrompts(method, prompt);
  const runSpec = {
    schemaVersion: 3,
    runId,
    createdAt: new Date(runStartedAtMs).toISOString(),
    status: options['dry-run'] ? 'dry-run' : 'running',
    method: { id: method.id, displayName: method.displayName },
    prompt: {
      id: prompt.id,
      version: prompt.version,
      title: prompt.title,
      roundCount: prompt.roundCount,
      sha256: prompt.sha256,
      rounds: prompt.rounds.map((round) => ({
        index: round.index,
        id: round.id,
        promptFile: round.promptFile,
        sha256: round.sha256,
        byteLength: round.byteLength,
      })),
    },
    creativeRounds: creativeRounds.map(({ agentPrompt, ...metadata }) => metadata),
    policy,
    harness: describeHarness([modelA, modelB]),
    participants: [
      { side: 'a', runner: runnerId(modelA), modelProfile: modelA.id, model: modelA.model, displayName: modelA.displayName, reasoning: reasoningA },
      { side: 'b', runner: runnerId(modelB), modelProfile: modelB.id, model: modelB.model, displayName: modelB.displayName, reasoning: reasoningB },
    ],
    executionMode: 'parallel',
    publishRequested: Boolean(options.publish),
    confirmedPlanSha256: options['dry-run'] ? null : expectedConfirmationToken,
  };
  await writeJson(join(runDirectory, 'run-spec.json'), runSpec);
  await settleAll(creativeRounds.map((round) => (
    writeUtf8(join(runDirectory, `prompt-round-${round.index}.txt`), round.agentPrompt)
  )));
  await writeUtf8(join(runDirectory, 'generation-prompt.txt'), creativeRounds[0].agentPrompt);

  const participants = await settleAll([
    prepareParticipant({ side: 'a', model: modelA, reasoning: reasoningA, runDirectory, method }),
    prepareParticipant({ side: 'b', model: modelB, reasoning: reasoningB, runDirectory, method }),
  ]);

  if (options['dry-run']) {
    const report = { ok: true, dryRun: true, runId, runDirectory, timing: runTiming(runStartedAtMs), runSpec };
    await writeJson(join(runDirectory, 'run-report.json'), report);
    return report;
  }

  let preflight = [];
  try {
    const credentials = participants.map((participant) => ({ participant, status: credentialStatus(participant.model) }));
    const missing = credentials.filter(({ status }) => !status.ok);
    if (missing.length) {
      throw new BenchmarkError(`Missing credential configuration: ${missing.map(({ participant, status }) => `${participant.model.id} (${status.detail})`).join(', ')}`, {
        kind: 'infrastructure',
      });
    }
    const secretValues = credentials.map(({ status }) => status.secret).filter(Boolean);

    preflight = await preflightParticipants(participants, policy);
    await writeJson(join(runDirectory, 'preflight.json'), preflight);

    if (method.id === 'threejs') {
      await settleAll(participants.map((participant) => installThreeDependencies(participant.workspace, participant.logDirectory)));
    }
    await runCreativeRounds(participants, creativeRounds, policy, secretValues);
    await settleAll(participants.map((participant) => verifyParticipant(participant, method, prompt, policy, 'creative-rounds')));
    await repairParticipants(participants, method, prompt, policy, secretValues);
    const capture = await recordParticipants(participants, method, prompt, policy);

    const outputPath = join(runDirectory, 'comparison.mp4');
    const videoProbe = await composeComparison({
      topPath: participants[0].recording,
      bottomPath: participants[1].recording,
      outputPath,
      videoPolicy: policy.video,
      logDirectory: runDirectory,
    });
    const metadata = {
      schemaVersion: 3,
      runId,
      method: method.id,
      prompt: { id: prompt.id, version: prompt.version, roundCount: prompt.roundCount, sha256: prompt.sha256 },
      capture,
      harness: describeHarness(participants.map((participant) => participant.model)),
      participants: participants.map((participant) => ({
        side: participant.side,
        runner: runnerId(participant.model),
        modelProfile: participant.model.id,
        model: participant.model.model,
        reasoning: participant.reasoning,
        status: participant.status,
        creativeRoundsCompleted: participant.creativeRoundsCompleted,
        repairRoundsUsed: participant.repairRoundsUsed,
      })),
    };
    const publication = options.publish
      ? await publishComparison({ outputPath, runId, metadata })
      : null;
    const report = {
      ok: true,
      status: 'completed',
      completion: 'conclusive',
      executionMode: 'parallel',
      runId,
      runDirectory,
      outputPath,
      videoProbe,
      capture,
      timing: runTiming(runStartedAtMs),
      harness: describeHarness(participants.map((participant) => participant.model)),
      participants: participants.map(participantSummary),
      preflight,
      publication,
    };
    await writeJson(join(runDirectory, 'run-report.json'), report);
    return report;
  } catch (error) {
    const report = {
      ok: false,
      status: error?.kind === 'publishing' ? 'publishing-failed' : 'infrastructure-failed',
      completion: 'inconclusive',
      executionMode: 'parallel',
      runId,
      runDirectory,
      error: compactError(error),
      termination: classifyTermination(error),
      timing: runTiming(runStartedAtMs),
      participants: participants.map(participantSummary),
      preflight,
    };
    await writeJson(join(runDirectory, 'run-report.json'), report);
    throw error;
  }
}

function helpText() {
  return `Visual Code Model Benchmark

Commands:
  list-models [--json]
  list-prompts --method <threejs|twigl> [--json]
  describe --model-a <id> --model-b <id> --method <id> --prompt <id>
      [--reasoning-a <level>] [--reasoning-b <level>] [--publish] [--json]
  describe-retry --run <run-id|path> --side <a|b> [--publish] [--json]
  doctor [--models <id,id>] [--probe-models] [--json]
  self-test [--json]
  run --model-a <id> --model-b <id> --method <id> --prompt <id>
      [--reasoning-a <level>] [--reasoning-b <level>]
      [--confirmed-plan <sha256>] [--output-dir <path>] [--run-id <id>]
      [--dry-run] [--publish] [--json]
  retry-participant --run <run-id|path> --side <a|b>
      [--confirmed-plan <sha256>] [--output-dir <path>] [--run-id <id>]
      [--dry-run] [--publish] [--json]

Runners: each model profile declares "runner": "codex" (Codex CLI) or "claude" (Claude Code CLI).
Pairing two profiles with different runners is allowed; describe/run then report harness.crossRunner = true.

Publishing is opt-in. A normal run keeps all source and evidence local and creates comparison.mp4.`;
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  switch (command) {
    case 'list-models':
      await listModelsCommand(options);
      break;
    case 'list-prompts':
      await listPromptsCommand(options);
      break;
    case 'describe':
      await describeCommand(options);
      break;
    case 'describe-retry':
      await describeRetryCommand(options);
      break;
    case 'doctor':
      await doctorCommand(options);
      break;
    case 'self-test':
      await selfTestCommand(options);
      break;
    case 'run':
      emit(await runBenchmark(options), options.json);
      break;
    case 'retry-participant':
      emit(await retryParticipantCommand(options), options.json);
      break;
    case 'help':
    case '--help':
    case '-h':
      emit(helpText());
      break;
    default:
      throw new BenchmarkError(`Unknown command: ${command}\n\n${helpText()}`, { kind: 'configuration' });
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: compactError(error) }, null, 2));
  process.exitCode = 1;
});
