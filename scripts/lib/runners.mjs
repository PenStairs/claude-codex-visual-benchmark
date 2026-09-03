import * as claude from './claude.mjs';
import * as codex from './codex.mjs';
import { BenchmarkError } from './utils.mjs';

// Runner registry. A "runner" is the agent harness that turns a model into a
// coding agent inside the participant workspace. Each runner module exports
// the same surface:
//   id, displayName, commandName, usageSource, executionDefinition,
//   supportedAuthenticationTypes, buildArguments, buildResumeArguments,
//   parseSessionId, parseUsage, credentialStatus, isSubscriptionBacked,
//   doctorChecks, selfTest, selfTestParsers, runAgent.
export const RUNNERS = Object.freeze({
  [codex.id]: codex,
  [claude.id]: claude,
});

export const DEFAULT_RUNNER = codex.id;

export function runnerId(model) {
  return model.runner ?? DEFAULT_RUNNER;
}

export function getRunner(model) {
  const key = runnerId(model);
  const runner = RUNNERS[key];
  if (!runner) {
    throw new BenchmarkError(`Model profile ${model.id} declares unknown runner: ${key}. Known runners: ${Object.keys(RUNNERS).join(', ')}`, { kind: 'configuration' });
  }
  if (!runner.supportedAuthenticationTypes.includes(model.authentication?.type)) {
    throw new BenchmarkError(`Model profile ${model.id} uses authentication.type ${model.authentication?.type}, which runner ${key} does not support (${runner.supportedAuthenticationTypes.join(', ')}).`, { kind: 'configuration' });
  }
  return runner;
}

export function describeHarness(models) {
  const runners = [...new Set(models.map((model) => runnerId(model)))];
  const crossRunner = runners.length > 1;
  return {
    runners: runners.map((key) => ({ id: key, displayName: RUNNERS[key]?.displayName ?? key })),
    crossRunner,
    comparability: crossRunner ? 'model-plus-harness' : 'model-within-shared-harness',
    note: crossRunner
      ? 'Participants run in different agent harnesses (system prompts, tools, and editing strategies differ). The result compares each model inside its own CLI, not the models alone.'
      : 'Both participants run in the same agent harness; differences are attributable to the models (and their providers).',
  };
}

export function runnerCommandNames(models) {
  return [...new Set(models.map((model) => getRunner(model).commandName))];
}
