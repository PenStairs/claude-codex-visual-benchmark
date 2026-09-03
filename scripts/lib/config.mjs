import { join, resolve } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import process from 'node:process';
import {
  BenchmarkError,
  SKILL_ROOT,
  normalizeText,
  pathExists,
  readJson,
  resolveInside,
  safeSegment,
  sha256,
} from './utils.mjs';

const CONFIG_ROOT = join(SKILL_ROOT, 'config');

function requireFields(value, fields, label) {
  for (const field of fields) {
    if (value[field] === undefined || value[field] === null || value[field] === '') {
      throw new BenchmarkError(`${label} is missing required field: ${field}`, { kind: 'configuration' });
    }
  }
}

function validateRates(rates, label) {
  requireFields(rates, ['input', 'cachedInput', 'cacheWriteInput', 'output'], label);
  for (const [field, value] of Object.entries(rates)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new BenchmarkError(`${label} ${field} must be a non-negative number.`, { kind: 'configuration' });
    }
  }
}

export async function loadPricingCatalog() {
  const catalog = await readJson(join(CONFIG_ROOT, 'pricing.json'));
  requireFields(catalog, ['schemaVersion', 'checkedAt', 'currency', 'unitTokens', 'models'], 'pricing catalog');
  if (catalog.schemaVersion !== 1 || !Number.isInteger(catalog.unitTokens) || catalog.unitTokens <= 0
    || typeof catalog.models !== 'object' || Array.isArray(catalog.models)) {
    throw new BenchmarkError('Pricing catalog schema is invalid.', { kind: 'configuration' });
  }
  for (const [modelId, pricing] of Object.entries(catalog.models)) {
    requireFields(pricing, ['displayName', 'sourceUrl', 'sourceLabel', 'schedule'], `pricing ${modelId}`);
    const schedule = pricing.schedule;
    requireFields(schedule, ['type'], `pricing ${modelId} schedule`);
    if (schedule.type === 'fixed') {
      requireFields(schedule, ['planId', 'rates'], `pricing ${modelId} schedule`);
      validateRates(schedule.rates, `pricing ${modelId} rates`);
    } else if (schedule.type === 'weekly-utc') {
      requireFields(schedule, ['peakPlanId', 'offPeakPlanId', 'peakWeekdays', 'peakWindows', 'peakRates', 'offPeakRates'], `pricing ${modelId} schedule`);
      if (!Array.isArray(schedule.peakWeekdays) || !Array.isArray(schedule.peakWindows)) {
        throw new BenchmarkError(`pricing ${modelId} weekly schedule arrays are invalid.`, { kind: 'configuration' });
      }
      validateRates(schedule.peakRates, `pricing ${modelId} peak rates`);
      validateRates(schedule.offPeakRates, `pricing ${modelId} off-peak rates`);
      if (schedule.selection !== undefined && schedule.selection !== 'lowest') {
        throw new BenchmarkError(`pricing ${modelId} has unsupported selection: ${schedule.selection}`, { kind: 'configuration' });
      }
    } else if (schedule.type === 'periods') {
      if (!Array.isArray(schedule.periods) || !schedule.periods.length) {
        throw new BenchmarkError(`pricing ${modelId} must define at least one rate period.`, { kind: 'configuration' });
      }
      for (const period of schedule.periods) {
        requireFields(period, ['planId', 'rates'], `pricing ${modelId} period`);
        validateRates(period.rates, `pricing ${modelId} period rates`);
      }
      if (schedule.selection !== undefined && schedule.selection !== 'lowest') {
        throw new BenchmarkError(`pricing ${modelId} has unsupported selection: ${schedule.selection}`, { kind: 'configuration' });
      }
    } else {
      throw new BenchmarkError(`Unsupported pricing schedule for ${modelId}: ${schedule.type}`, { kind: 'configuration' });
    }
  }
  return catalog;
}

export function validateVideoPolicy(video) {
  requireFields(video, [
    'target',
    'layout',
    'participantWidth',
    'participantHeight',
    'outputWidth',
    'outputHeight',
    'framesPerSecond',
    'durationSeconds',
    'captureFramesPerSecond',
    'captureBitrateBitsPerSecond',
    'codec',
    'profile',
    'level',
    'pixelFormat',
    'preset',
    'crf',
    'maximumBitrateBitsPerSecond',
    'maximumFileSizeBytes',
  ], 'policy video');

  const positiveIntegers = [
    'participantWidth',
    'participantHeight',
    'outputWidth',
    'outputHeight',
    'framesPerSecond',
    'durationSeconds',
    'captureFramesPerSecond',
    'captureBitrateBitsPerSecond',
    'maximumBitrateBitsPerSecond',
    'maximumFileSizeBytes',
  ];
  for (const field of positiveIntegers) {
    if (!Number.isInteger(video[field]) || video[field] <= 0) {
      throw new BenchmarkError(`policy video ${field} must be a positive integer.`, { kind: 'configuration' });
    }
  }

  if (video.target !== 'x' || video.layout !== 'vertical-stack') {
    throw new BenchmarkError('The benchmark output policy must target X with a vertical-stack layout.', { kind: 'configuration' });
  }
  if (video.outputWidth !== video.participantWidth || video.outputHeight !== video.participantHeight * 2) {
    throw new BenchmarkError('X output dimensions must stack two participant recordings without scaling or padding.', { kind: 'configuration' });
  }
  if ([video.participantWidth, video.participantHeight, video.outputWidth, video.outputHeight].some((value) => value % 2 !== 0)) {
    throw new BenchmarkError('Video dimensions must be even for yuv420p encoding.', { kind: 'configuration' });
  }

  const aspectRatio = video.outputWidth / video.outputHeight;
  if (aspectRatio < 1 / 2.39 || aspectRatio > 2.39) {
    throw new BenchmarkError(`X output aspect ratio is outside the supported range: ${aspectRatio.toFixed(3)}`, { kind: 'configuration' });
  }
  const portrait = video.outputHeight >= video.outputWidth;
  const resolutionOk = portrait
    ? video.outputWidth <= 1200 && video.outputHeight <= 1900
    : video.outputWidth <= 1920 && video.outputHeight <= 1200;
  if (!resolutionOk) {
    throw new BenchmarkError(`X output resolution is too large: ${video.outputWidth}x${video.outputHeight}`, { kind: 'configuration' });
  }
  if (video.framesPerSecond > 40) {
    throw new BenchmarkError('X output frame rate must not exceed 40 fps.', { kind: 'configuration' });
  }
  if (video.durationSeconds > 140) {
    throw new BenchmarkError('X output duration must fit the non-Premium 140-second limit.', { kind: 'configuration' });
  }
  if (video.captureFramesPerSecond < video.framesPerSecond || video.captureFramesPerSecond > 40) {
    throw new BenchmarkError('Browser capture frame rate must cover the output rate and not exceed 40 fps.', { kind: 'configuration' });
  }
  if (video.captureBitrateBitsPerSecond > 25_000_000) {
    throw new BenchmarkError('Browser capture bitrate must not exceed 25 Mbps.', { kind: 'configuration' });
  }
  if (video.maximumBitrateBitsPerSecond > 25_000_000) {
    throw new BenchmarkError('X output bitrate cap must not exceed 25 Mbps.', { kind: 'configuration' });
  }
  if (video.maximumFileSizeBytes > 512 * 1024 * 1024) {
    throw new BenchmarkError('X output file-size cap must not exceed 512 MiB.', { kind: 'configuration' });
  }
  if (video.codec !== 'libx264' || video.profile !== 'high' || video.pixelFormat !== 'yuv420p') {
    throw new BenchmarkError('X output must use H.264 High with yuv420p pixel format.', { kind: 'configuration' });
  }
  if (!Number.isInteger(video.crf) || video.crf < 0 || video.crf > 51) {
    throw new BenchmarkError('policy video crf must be an integer from 0 to 51.', { kind: 'configuration' });
  }

  requireFields(video.cadence, [
    'pointerSamplesPerSecond',
    'captureTailMs',
    'maximumInteractionOverrunMs',
    'minimumAverageFps',
    'maximumP95FrameMs',
    'maximumFrameGapMs',
  ], 'policy video cadence');
  for (const field of ['pointerSamplesPerSecond', 'captureTailMs', 'maximumInteractionOverrunMs']) {
    if (!Number.isInteger(video.cadence[field]) || video.cadence[field] <= 0) {
      throw new BenchmarkError(`policy video cadence ${field} must be a positive integer.`, { kind: 'configuration' });
    }
  }
  for (const field of ['minimumAverageFps', 'maximumP95FrameMs', 'maximumFrameGapMs']) {
    if (!Number.isFinite(video.cadence[field]) || video.cadence[field] <= 0) {
      throw new BenchmarkError(`policy video cadence ${field} must be a positive number.`, { kind: 'configuration' });
    }
  }
  if (video.cadence.pointerSamplesPerSecond > video.captureFramesPerSecond) {
    throw new BenchmarkError('Pointer sampling must not exceed the browser capture frame rate.', { kind: 'configuration' });
  }
  if (video.cadence.minimumAverageFps > video.framesPerSecond) {
    throw new BenchmarkError('Minimum average page FPS must not exceed the output frame rate.', { kind: 'configuration' });
  }
  requireFields(video.cadence.severeFrameRetry, [
    'enabled',
    'maximumRetries',
    'delayMs',
    'maximumInteractionOverrunMs',
    'minimumAverageFps',
    'maximumP95FrameMs',
    'maximumFrameGapMs',
  ], 'policy video cadence severeFrameRetry');
  const severeRetry = video.cadence.severeFrameRetry;
  if (severeRetry.enabled !== true
    || !Number.isInteger(severeRetry.maximumRetries) || severeRetry.maximumRetries < 0 || severeRetry.maximumRetries > 5
    || !Number.isInteger(severeRetry.delayMs) || severeRetry.delayMs < 0 || severeRetry.delayMs > 30000
    || !Number.isInteger(severeRetry.maximumInteractionOverrunMs) || severeRetry.maximumInteractionOverrunMs <= 0
    || !Number.isFinite(severeRetry.minimumAverageFps) || severeRetry.minimumAverageFps <= 0
    || !Number.isFinite(severeRetry.maximumP95FrameMs) || severeRetry.maximumP95FrameMs <= 0
    || !Number.isFinite(severeRetry.maximumFrameGapMs) || severeRetry.maximumFrameGapMs <= 0) {
    throw new BenchmarkError('Severe-frame retry settings are invalid.', { kind: 'configuration' });
  }
  if (severeRetry.minimumAverageFps > video.cadence.minimumAverageFps
    || severeRetry.maximumInteractionOverrunMs < video.cadence.maximumInteractionOverrunMs
    || severeRetry.maximumP95FrameMs < video.cadence.maximumP95FrameMs
    || severeRetry.maximumFrameGapMs < video.cadence.maximumFrameGapMs) {
    throw new BenchmarkError('Severe-frame retry boundaries must be stricter in severity than cadence warning boundaries.', { kind: 'configuration' });
  }

  requireFields(video.deterministicFallback, [
    'enabled',
    'applyToBothParticipants',
    'warmupFrames',
    'frameTimeoutSeconds',
    'captureTimeoutSeconds',
    'imageFormat',
  ], 'policy video deterministicFallback');
  const deterministicFallback = video.deterministicFallback;
  if (deterministicFallback.enabled !== true
    || deterministicFallback.applyToBothParticipants !== true
    || !Number.isInteger(deterministicFallback.warmupFrames) || deterministicFallback.warmupFrames < 0 || deterministicFallback.warmupFrames > 300
    || !Number.isInteger(deterministicFallback.frameTimeoutSeconds) || deterministicFallback.frameTimeoutSeconds <= 0 || deterministicFallback.frameTimeoutSeconds > 120
    || !Number.isInteger(deterministicFallback.captureTimeoutSeconds) || deterministicFallback.captureTimeoutSeconds <= 0 || deterministicFallback.captureTimeoutSeconds > 7200
    || deterministicFallback.imageFormat !== 'png') {
    throw new BenchmarkError('Deterministic-frame fallback settings are invalid.', { kind: 'configuration' });
  }
  const minimumCaptureSeconds = video.durationSeconds * video.framesPerSecond * deterministicFallback.frameTimeoutSeconds;
  if (deterministicFallback.captureTimeoutSeconds > minimumCaptureSeconds) {
    throw new BenchmarkError('Deterministic capture timeout cannot exceed the sum of all per-frame timeouts.', { kind: 'configuration' });
  }

  requireFields(video.audio, [
    'enabled',
    'asset',
    'title',
    'artist',
    'sourcePage',
    'sourceUrl',
    'license',
    'licenseUrl',
    'sha256',
    'startSeconds',
    'volume',
    'fadeInSeconds',
    'fadeOutSeconds',
    'codec',
    'bitrateBitsPerSecond',
    'sampleRate',
    'channels',
  ], 'policy video audio');
  if (video.audio.enabled !== true) {
    throw new BenchmarkError('The X benchmark soundtrack must remain enabled.', { kind: 'configuration' });
  }
  if (!Number.isFinite(video.audio.startSeconds) || video.audio.startSeconds < 0
    || !Number.isFinite(video.audio.volume) || video.audio.volume <= 0 || video.audio.volume > 1
    || !Number.isFinite(video.audio.fadeInSeconds) || video.audio.fadeInSeconds < 0
    || !Number.isFinite(video.audio.fadeOutSeconds) || video.audio.fadeOutSeconds < 0) {
    throw new BenchmarkError('The soundtrack timing and volume settings are invalid.', { kind: 'configuration' });
  }
  if (video.audio.fadeInSeconds > video.durationSeconds || video.audio.fadeOutSeconds > video.durationSeconds) {
    throw new BenchmarkError('The soundtrack fades must fit within the video duration.', { kind: 'configuration' });
  }
  if (video.audio.codec !== 'aac'
    || !Number.isInteger(video.audio.bitrateBitsPerSecond) || video.audio.bitrateBitsPerSecond <= 0
    || !Number.isInteger(video.audio.sampleRate) || video.audio.sampleRate <= 0
    || video.audio.channels !== 2
    || !/^[a-f0-9]{64}$/i.test(video.audio.sha256)) {
    throw new BenchmarkError('The soundtrack must use a pinned stereo AAC output and a SHA-256 source hash.', { kind: 'configuration' });
  }
}

function promptRoundDefinitions(manifest, label) {
  const hasPromptFile = typeof manifest.promptFile === 'string' && manifest.promptFile.length > 0;
  const hasRounds = Object.prototype.hasOwnProperty.call(manifest, 'rounds');
  if (hasPromptFile && hasRounds) {
    throw new BenchmarkError(`${label} must define either promptFile or rounds, not both.`, { kind: 'configuration' });
  }
  if (hasPromptFile) return [{ id: 'initial', promptFile: manifest.promptFile }];
  if (!Array.isArray(manifest.rounds) || manifest.rounds.length === 0) {
    throw new BenchmarkError(`${label} must define promptFile or at least one prompt round.`, { kind: 'configuration' });
  }

  const ids = new Set();
  return manifest.rounds.map((round, index) => {
    const roundLabel = `${label} round ${index + 1}`;
    requireFields(round, ['id', 'promptFile'], roundLabel);
    safeSegment(round.id, `${roundLabel} id`);
    if (ids.has(round.id)) {
      throw new BenchmarkError(`${label} has duplicate round id: ${round.id}`, { kind: 'configuration' });
    }
    ids.add(round.id);
    return { id: round.id, promptFile: round.promptFile };
  });
}

function validatePromptSource(manifest, label) {
  requireFields(manifest, ['source'], label);
  requireFields(manifest.source, ['platform', 'methodOrigin'], `${label} source`);
  if (!['prompt-native', 'source-environment'].includes(manifest.source.methodOrigin)) {
    throw new BenchmarkError(`${label} source has unsupported methodOrigin: ${manifest.source.methodOrigin}`, { kind: 'configuration' });
  }
  if (manifest.source.platform === 'x') {
    if (!Array.isArray(manifest.source.urls) || manifest.source.urls.length === 0
      || manifest.source.urls.some((url) => typeof url !== 'string' || !/^https:\/\/x\.com\//i.test(url))) {
      throw new BenchmarkError(`${label} X source must contain at least one x.com URL.`, { kind: 'configuration' });
    }
  } else if (manifest.source.platform === 'user-provided') {
    requireFields(manifest.source, ['provenanceNote'], `${label} user-provided source`);
  } else {
    throw new BenchmarkError(`${label} source has unsupported platform: ${manifest.source.platform}`, { kind: 'configuration' });
  }
}

function validatePromptRequirements(manifest, label) {
  if (manifest.requirements === undefined) return;
  if (!manifest.requirements || typeof manifest.requirements !== 'object' || Array.isArray(manifest.requirements)) {
    throw new BenchmarkError(`${label} requirements must be an object.`, { kind: 'configuration' });
  }
  const supported = new Set(['singleHtml', 'webgl2Required', 'localThreeCdnMapping']);
  for (const [field, value] of Object.entries(manifest.requirements)) {
    if (!supported.has(field)) {
      throw new BenchmarkError(`${label} has unsupported requirement: ${field}`, { kind: 'configuration' });
    }
    if (typeof value !== 'boolean') {
      throw new BenchmarkError(`${label} requirement ${field} must be boolean.`, { kind: 'configuration' });
    }
  }
  if (manifest.method !== 'threejs' && Object.keys(manifest.requirements).length > 0) {
    throw new BenchmarkError(`${label} declares Three.js-only requirements for method ${manifest.method}.`, { kind: 'configuration' });
  }
}

export async function loadPolicy() {
  const policy = await readJson(join(CONFIG_ROOT, 'policy.json'));
  requireFields(policy, ['reasoningPolicy', 'generation', 'repair', 'preflight', 'recovery', 'threejsStartupTimeoutSeconds', 'video'], 'policy');
  requireFields(policy.reasoningPolicy, ['defaultRequired', 'requiredByProfile', 'allowAutomaticFallback'], 'policy reasoningPolicy');
  if (policy.reasoningPolicy.defaultRequired !== 'high'
    || typeof policy.reasoningPolicy.requiredByProfile !== 'object'
    || Array.isArray(policy.reasoningPolicy.requiredByProfile)
    || policy.reasoningPolicy.allowAutomaticFallback !== false) {
    throw new BenchmarkError('Quality mode requires default High reasoning, a per-profile override map, and automatic fallback disabled.', { kind: 'configuration' });
  }
  for (const [profileId, preset] of Object.entries(policy.reasoningPolicy.requiredByProfile)) {
    safeSegment(profileId, 'reasoning policy profile id');
    if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(preset)) {
      throw new BenchmarkError(`Unsupported required reasoning preset for ${profileId}: ${preset}`, { kind: 'configuration' });
    }
  }
  requireFields(policy.generation, ['softTimeoutSeconds', 'hardTimeoutSeconds', 'idleTimeoutSeconds', 'progressIntervalSeconds'], 'policy generation');
  for (const field of ['softTimeoutSeconds', 'hardTimeoutSeconds', 'idleTimeoutSeconds', 'progressIntervalSeconds']) {
    if (!Number.isInteger(policy.generation[field]) || policy.generation[field] <= 0) {
      throw new BenchmarkError(`policy generation ${field} must be a positive integer.`, { kind: 'configuration' });
    }
  }
  if (policy.generation.softTimeoutSeconds >= policy.generation.hardTimeoutSeconds) {
    throw new BenchmarkError('policy generation softTimeoutSeconds must be lower than hardTimeoutSeconds.', { kind: 'configuration' });
  }
  if (policy.generation.idleTimeoutSeconds >= policy.generation.hardTimeoutSeconds) {
    throw new BenchmarkError('policy generation idleTimeoutSeconds must be lower than hardTimeoutSeconds.', { kind: 'configuration' });
  }
  requireFields(policy.repair, ['timeoutSeconds', 'maximumRounds', 'reasoning'], 'policy repair');
  if (!Number.isInteger(policy.repair.timeoutSeconds) || policy.repair.timeoutSeconds <= 0
    || !Number.isInteger(policy.repair.maximumRounds) || policy.repair.maximumRounds < 0
    || policy.repair.reasoning !== 'same-as-generation') {
    throw new BenchmarkError('policy repair must reuse each participant generation reasoning with a positive timeout and a non-negative integer maximumRounds.', { kind: 'configuration' });
  }
  requireFields(policy.preflight, ['timeoutSeconds', 'effort'], 'policy preflight');
  if (!Number.isInteger(policy.preflight.timeoutSeconds) || policy.preflight.timeoutSeconds <= 0 || policy.preflight.effort !== 'low') {
    throw new BenchmarkError('policy preflight must use low effort with a positive timeout.', { kind: 'configuration' });
  }
  requireFields(policy.recovery, ['allowSingleParticipantRetry', 'reuseSuccessfulParticipant', 'restartFailedParticipantFromCleanWorkspace', 'requireNewConfirmation', 'automaticPaidRetry'], 'policy recovery');
  if (!policy.recovery.allowSingleParticipantRetry || !policy.recovery.reuseSuccessfulParticipant
    || !policy.recovery.restartFailedParticipantFromCleanWorkspace || !policy.recovery.requireNewConfirmation
    || policy.recovery.automaticPaidRetry !== false) {
    throw new BenchmarkError('policy recovery must use confirmed, clean, non-automatic single-participant retries.', { kind: 'configuration' });
  }
  if (!Number.isInteger(policy.threejsStartupTimeoutSeconds) || policy.threejsStartupTimeoutSeconds <= 0 || policy.threejsStartupTimeoutSeconds > 300) {
    throw new BenchmarkError('policy threejsStartupTimeoutSeconds must be an integer from 1 to 300.', { kind: 'configuration' });
  }
  validateVideoPolicy(policy.video);
  if (policy.video.audio.enabled) {
    const soundtrackPath = resolveInside(SKILL_ROOT, join(SKILL_ROOT, policy.video.audio.asset), 'soundtrack asset');
    if (!(await pathExists(soundtrackPath))) {
      throw new BenchmarkError('The local soundtrack asset is missing. Run: npm run fetch:bgm', { kind: 'configuration' });
    }
    const soundtrackHash = sha256(await readFile(soundtrackPath));
    if (soundtrackHash !== policy.video.audio.sha256.toLowerCase()) {
      throw new BenchmarkError('The local soundtrack asset does not match its pinned SHA-256. Run: npm run fetch:bgm', { kind: 'configuration' });
    }
  }
  return policy;
}

export async function listModels({ includeDisabled = false } = {}) {
  const root = join(CONFIG_ROOT, 'models');
  const pricingCatalog = await loadPricingCatalog();
  const files = (await readdir(root)).filter((name) => name.endsWith('.json')).sort();
  const models = [];
  for (const file of files) {
    const model = await readJson(join(root, file));
    requireFields(model, ['id', 'displayName', 'model', 'provider', 'authentication', 'reasoning', 'supportedMethods'], `model ${file}`);
    safeSegment(model.id, 'model id');
    if (model.runner !== undefined) safeSegment(model.runner, `model ${file} runner`);
    model.pricing = pricingCatalog.models[model.model]
      ? {
        ...pricingCatalog.models[model.model],
        checkedAt: pricingCatalog.checkedAt,
        currency: pricingCatalog.currency,
        unitTokens: pricingCatalog.unitTokens,
      }
      : null;
    if (includeDisabled || model.enabled !== false) models.push(model);
  }
  return models;
}

export async function getModel(id) {
  const model = (await listModels({ includeDisabled: true })).find((candidate) => candidate.id === id);
  if (!model) throw new BenchmarkError(`Unknown model profile: ${id}`, { kind: 'configuration' });
  if (model.enabled === false) throw new BenchmarkError(`Model profile is disabled: ${id}`, { kind: 'configuration' });
  return model;
}

export async function getMethod(id) {
  safeSegment(id, 'method id');
  const target = join(CONFIG_ROOT, 'methods', `${id}.json`);
  if (!(await pathExists(target))) throw new BenchmarkError(`Unknown benchmark method: ${id}`, { kind: 'configuration' });
  const method = await readJson(target);
  requireFields(method, ['id', 'displayName', 'template', 'promptRoot', 'allowedModifiedFiles', 'requiredModifiedFiles'], `method ${id}`);
  for (const field of ['allowedModifiedFiles', 'requiredModifiedFiles', 'requiredAnyModifiedFiles']) {
    if (method[field] !== undefined && (!Array.isArray(method[field]) || method[field].some((value) => typeof value !== 'string' || !value))) {
      throw new BenchmarkError(`method ${id} ${field} must be an array of file paths.`, { kind: 'configuration' });
    }
  }
  const allowed = new Set(method.allowedModifiedFiles);
  for (const field of ['requiredModifiedFiles', 'requiredAnyModifiedFiles']) {
    for (const rel of method[field] ?? []) {
      if (!allowed.has(rel)) {
        throw new BenchmarkError(`method ${id} ${field} contains a file that is not editable: ${rel}`, { kind: 'configuration' });
      }
    }
  }
  method.templatePath = resolveInside(SKILL_ROOT, join(SKILL_ROOT, method.template), 'method template');
  method.promptRootPath = resolveInside(SKILL_ROOT, join(SKILL_ROOT, method.promptRoot), 'prompt root');
  return method;
}

export async function listPrompts(methodId) {
  const method = await getMethod(methodId);
  const entries = await readdir(method.promptRootPath, { withFileTypes: true });
  const prompts = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const manifestPath = join(method.promptRootPath, entry.name, 'manifest.json');
    if (!(await pathExists(manifestPath))) continue;
    const manifest = await readJson(manifestPath);
    requireFields(manifest, ['id', 'version', 'method', 'title'], `prompt ${entry.name}`);
    safeSegment(manifest.id, `prompt ${entry.name} id`);
    if (manifest.id !== entry.name) {
      throw new BenchmarkError(`Prompt directory ${entry.name} does not match manifest id ${manifest.id}`, { kind: 'configuration' });
    }
    if (manifest.method !== method.id) {
      throw new BenchmarkError(`Prompt ${manifest.id} declares method ${manifest.method}, expected ${method.id}`, { kind: 'configuration' });
    }
    validatePromptSource(manifest, `prompt ${entry.name}`);
    validatePromptRequirements(manifest, `prompt ${entry.name}`);
    const roundCount = promptRoundDefinitions(manifest, `prompt ${entry.name}`).length;
    if (manifest.status !== 'disabled') prompts.push({ ...manifest, roundCount });
  }
  return prompts;
}

export async function getPrompt(methodId, promptId) {
  safeSegment(promptId, 'prompt id');
  const method = await getMethod(methodId);
  const directory = resolveInside(method.promptRootPath, join(method.promptRootPath, promptId), 'prompt path');
  const manifest = await readJson(join(directory, 'manifest.json'));
  requireFields(manifest, ['id', 'version', 'method', 'title'], `prompt ${promptId}`);
  if (manifest.id !== promptId || manifest.method !== methodId) {
    throw new BenchmarkError(`Prompt manifest does not match requested method/id: ${methodId}/${promptId}`, { kind: 'configuration' });
  }
  validatePromptSource(manifest, `prompt ${promptId}`);
  validatePromptRequirements(manifest, `prompt ${promptId}`);
  const definitions = promptRoundDefinitions(manifest, `prompt ${promptId}`);
  const rounds = [];
  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    const promptPath = resolveInside(directory, join(directory, definition.promptFile), `prompt round ${index + 1} file`);
    const text = normalizeText(await readFile(promptPath, 'utf8'));
    if (!text.trim()) {
      throw new BenchmarkError(`Prompt ${promptId} round ${definition.id} is empty.`, { kind: 'configuration' });
    }
    rounds.push({
      index: index + 1,
      id: definition.id,
      promptFile: definition.promptFile,
      promptPath,
      text,
      sha256: sha256(Buffer.from(text, 'utf8')),
      byteLength: Buffer.byteLength(text, 'utf8'),
    });
  }

  const setHash = rounds.length === 1
    ? rounds[0].sha256
    : sha256(Buffer.from(JSON.stringify(rounds.map(({ id, text }) => ({ id, text }))), 'utf8'));
  return {
    ...manifest,
    directory,
    promptPath: rounds[0].promptPath,
    text: rounds[0].text,
    rounds,
    roundCount: rounds.length,
    sha256: setHash,
  };
}

export function selectReasoning(model, requested, policy = null) {
  const value = requested ?? model.reasoning.default;
  if (!model.reasoning.allowed.includes(value)) {
    throw new BenchmarkError(`Reasoning preset ${value} is not allowed for ${model.id}. Allowed: ${model.reasoning.allowed.join(', ')}`, {
      kind: 'configuration',
    });
  }
  if (policy?.reasoningPolicy) {
    const required = policy.reasoningPolicy.requiredByProfile?.[model.id]
      ?? policy.reasoningPolicy.defaultRequired;
    if (required && value !== required) {
      throw new BenchmarkError(`Quality mode requires reasoning preset ${required} for ${model.id}; automatic fallback is disabled.`, { kind: 'configuration' });
    }
  }
  return value;
}

export function validateModelMethod(model, methodId) {
  if (!model.supportedMethods.includes(methodId)) {
    throw new BenchmarkError(`${model.id} does not support method ${methodId}`, { kind: 'configuration' });
  }
}

const NATIVE_LOGIN_TYPES = {
  'codex-login': { runner: 'codex', detail: 'native Codex authentication' },
  'claude-login': { runner: 'claude', detail: 'native Claude Code authentication' },
};

export function credentialStatus(model) {
  const nativeLogin = NATIVE_LOGIN_TYPES[model.authentication.type];
  if (nativeLogin) {
    const runner = model.runner ?? 'codex';
    if (runner !== nativeLogin.runner) {
      return { ok: false, type: model.authentication.type, detail: `${model.authentication.type} only works with runner ${nativeLogin.runner} (profile uses ${runner})` };
    }
    return { ok: true, type: model.authentication.type, detail: nativeLogin.detail };
  }
  if (model.authentication.type === 'environment') {
    const name = model.authentication.environmentVariable;
    return {
      ok: Boolean(process.env[name]),
      type: 'environment',
      detail: name,
      secret: process.env[name] ?? null,
    };
  }
  return { ok: false, type: model.authentication.type, detail: 'unsupported authentication type' };
}

export function modelCatalogPath(model) {
  if (!model.modelCatalog) return null;
  return resolveInside(SKILL_ROOT, resolve(SKILL_ROOT, model.modelCatalog), 'model catalog');
}
