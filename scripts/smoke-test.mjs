#!/usr/bin/env node

import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getMethod, loadPolicy } from './lib/config.mjs';
import { installThreeDependencies, recordThree, verifyThree } from './lib/threejs.mjs';
import { recordTwigl, verifyTwigl } from './lib/twigl.mjs';
import { composeComparison } from './lib/video.mjs';
import { compactError, copyDirectory, ensureDirectory, writeJson } from './lib/utils.mjs';

const methodId = process.argv.includes('--method')
  ? process.argv[process.argv.indexOf('--method') + 1]
  : 'threejs';

async function main() {
  if (!['threejs', 'twigl'].includes(methodId)) throw new Error('Smoke-test method must be threejs or twigl.');
  const root = await mkdtemp(join(tmpdir(), `visual-code-model-benchmark-${methodId}-`));
  const method = await getMethod(methodId);
  const policy = await loadPolicy();
  policy.video.durationSeconds = 2;
  policy.video.framesPerSecond = 15;
  const sides = ['a', 'b'].map((side) => ({
    side,
    workspace: join(root, side, 'workspace'),
    logs: join(root, side, 'logs'),
    recording: join(root, side, 'recording.mkv'),
  }));

  await Promise.all(sides.map(async (side) => {
    await ensureDirectory(side.logs);
    await copyDirectory(method.templatePath, side.workspace);
    if (methodId === 'threejs') await installThreeDependencies(side.workspace, side.logs);
  }));

  const verifications = await Promise.all(sides.map((side) => (
    methodId === 'threejs'
      ? verifyThree({ workspace: side.workspace, logDirectory: side.logs, videoPolicy: policy.video, startupTimeoutSeconds: policy.threejsStartupTimeoutSeconds })
      : verifyTwigl({ workspace: side.workspace, method, videoPolicy: policy.video })
  )));
  if (verifications.some((verification) => !verification.ok)) {
    throw new Error(`Template verification failed: ${JSON.stringify(verifications)}`);
  }

  for (const side of sides) {
    const common = {
      workspace: side.workspace,
      outputPath: side.recording,
      modelLabel: `Smoke ${side.side.toUpperCase()}`,
      promptTitle: `${method.displayName} infrastructure test`,
      videoPolicy: policy.video,
      startupTimeoutSeconds: policy.threejsStartupTimeoutSeconds,
      interaction: method.recording.interaction,
    };
    if (methodId === 'threejs') await recordThree(common);
    else await recordTwigl({ ...common, method });
  }

  const recordingMetadata = await Promise.all(sides.map(async (side) => (
    JSON.parse(await readFile(`${side.recording}.json`, 'utf8'))
  )));
  const renderingProfiles = new Set(recordingMetadata.map((metadata) => metadata.renderingProfile.id));
  if (renderingProfiles.size !== 1) throw new Error('Participants used different browser rendering profiles.');
  if (recordingMetadata.some((metadata) => !metadata.contextClose.ok || metadata.contextClose.timedOut
    || !metadata.browserClose.ok || metadata.browserClose.timedOut)) {
    throw new Error(`Browser recording did not close cleanly: ${JSON.stringify(recordingMetadata)}`);
  }
  const expectedFrames = policy.video.durationSeconds * policy.video.framesPerSecond;
  if (recordingMetadata.some((metadata) => metadata.probe.frames < expectedFrames - 2)) {
    throw new Error(`Browser recording is missing frames: ${JSON.stringify(recordingMetadata)}`);
  }
  if (recordingMetadata.some((metadata) => metadata.recordingFailures.length > 0
    || metadata.interactionOverrunMs > policy.video.cadence.maximumInteractionOverrunMs
    || metadata.frameTelemetry.averageFps < policy.video.cadence.minimumAverageFps)) {
    throw new Error(`Browser recording cadence failed: ${JSON.stringify(recordingMetadata)}`);
  }

  const outputPath = join(root, 'comparison.mp4');
  const videoProbe = await composeComparison({
    topPath: sides[0].recording,
    bottomPath: sides[1].recording,
    outputPath,
    videoPolicy: policy.video,
    logDirectory: root,
  });
  const audioStream = videoProbe.streams?.find((stream) => stream.codec_type === 'audio');
  if (audioStream?.codec_name !== policy.video.audio.codec
    || Number(audioStream.sample_rate) !== policy.video.audio.sampleRate
    || audioStream.channels !== policy.video.audio.channels) {
    throw new Error(`Composed soundtrack is missing or invalid: ${JSON.stringify(videoProbe)}`);
  }
  const report = { ok: true, method: methodId, root, outputPath, verifications, recordingMetadata, videoProbe };
  await writeJson(join(root, 'smoke-report.json'), report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, method: methodId, error: compactError(error) }, null, 2));
  process.exitCode = 1;
});
