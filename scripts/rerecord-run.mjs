#!/usr/bin/env node

import { join, resolve } from 'node:path';
import { getMethod, loadPolicy } from './lib/config.mjs';
import { installThreeDependencies, recordThree, recordThreeDeterministic, verifyThree } from './lib/threejs.mjs';
import { recordTwigl, verifyTwigl } from './lib/twigl.mjs';
import { composeComparison } from './lib/video.mjs';
import { captureRecordingPair } from './lib/recording.mjs';
import {
  BenchmarkError,
  compactError,
  pathExists,
  readJson,
  safeSegment,
  writeJson,
} from './lib/utils.mjs';

function usage() {
  return 'Usage: node scripts/rerecord-run.mjs <absolute-run-directory> [output-name.mp4]';
}

async function main() {
  const runArgument = process.argv[2];
  if (!runArgument) throw new BenchmarkError(usage(), { kind: 'configuration' });
  const runDirectory = resolve(runArgument);
  const outputName = safeSegment(process.argv[3] ?? 'comparison-x.mp4', 'output name');
  if (!outputName.toLowerCase().endsWith('.mp4')) {
    throw new BenchmarkError('Rerecord output name must end in .mp4.', { kind: 'configuration' });
  }

  const runSpecPath = join(runDirectory, 'run-spec.json');
  if (!(await pathExists(runSpecPath))) {
    throw new BenchmarkError(`Existing run-spec.json was not found: ${runDirectory}`, { kind: 'configuration' });
  }
  const runSpec = await readJson(runSpecPath);
  const participants = Array.isArray(runSpec.participants) ? runSpec.participants : [];
  if (participants.length !== 2 || participants[0].side !== 'a' || participants[1].side !== 'b') {
    throw new BenchmarkError('Existing run must contain participant A followed by participant B.', { kind: 'configuration' });
  }

  const method = await getMethod(runSpec.method?.id);
  const policy = await loadPolicy();
  const rerecordDirectory = join(runDirectory, 'x-rerecord');
  const recordings = [];
  const recordingMetadata = [];
  const verifications = [];
  const prepared = [];

  for (const participant of participants) {
    const participantRoot = join(runDirectory, `model-${participant.side}`);
    const workspace = join(participantRoot, 'workspace');
    const logDirectory = join(participantRoot, 'logs', 'x-rerecord');
    if (!(await pathExists(workspace))) {
      throw new BenchmarkError(`Participant workspace is missing: model-${participant.side}`, { kind: 'configuration' });
    }

    if (method.id === 'threejs' && !(await pathExists(join(workspace, 'node_modules')))) {
      await installThreeDependencies(workspace, logDirectory);
    }
    const verification = method.id === 'threejs'
      ? await verifyThree({ workspace, logDirectory, videoPolicy: policy.video, startupTimeoutSeconds: policy.threejsStartupTimeoutSeconds, requirements: runSpec.prompt?.requirements })
      : await verifyTwigl({ workspace, method, videoPolicy: policy.video });
    verifications.push({ side: participant.side, verification });
    if (!verification.ok) {
      throw new BenchmarkError(`Existing model-${participant.side} workspace no longer passes verification.`, {
        kind: 'infrastructure',
        details: verification.failures,
      });
    }

    prepared.push({ ...participant, root: participantRoot, workspace, logDirectory, verification });
  }

  const captureParticipant = async (participant, captureMode) => {
    const outputPath = join(participant.root, captureMode === 'deterministic-frame'
      ? 'recording-x-deterministic.mkv'
      : 'recording-x.mkv');
    const common = {
      workspace: participant.workspace,
      outputPath,
      modelLabel: participant.displayName,
      promptTitle: runSpec.prompt?.title ?? runSpec.prompt?.id ?? 'Visual benchmark',
      videoPolicy: policy.video,
      startupTimeoutSeconds: policy.threejsStartupTimeoutSeconds,
      interaction: method.recording.interaction,
      requirements: runSpec.prompt?.requirements,
    };
    if (method.id === 'threejs' && captureMode === 'deterministic-frame') await recordThreeDeterministic(common);
    else if (method.id === 'threejs') await recordThree(common);
    else await recordTwigl({ ...common, method });
    return { recording: outputPath, recordingMetadata: await readJson(`${outputPath}.json`) };
  };

  let capture;
  if (method.id === 'threejs') {
    capture = await captureRecordingPair({
      participants: prepared,
      allowDeterministicFallback: policy.video.deterministicFallback.enabled
        && policy.video.deterministicFallback.applyToBothParticipants,
      recordRealtime: async (participant) => await captureParticipant(participant, 'realtime'),
      recordDeterministic: async (participant, provenance) => {
        const captured = await captureParticipant(participant, 'deterministic-frame');
        captured.recordingMetadata.fallback = {
          triggeredBySides: provenance.triggerSides,
          realtimeEvidence: provenance.realtime,
        };
        await writeJson(`${captured.recording}.json`, captured.recordingMetadata);
        return captured;
      },
    });
  } else {
    const entries = [];
    for (const participant of prepared) {
      const selected = { ok: true, ...await captureParticipant(participant, 'realtime') };
      entries.push({ participant, side: participant.side, realtime: selected, selected });
    }
    capture = { captureMode: 'realtime', fallbackTriggered: false, triggerSides: [], entries };
  }

  for (const entry of capture.entries) {
    recordings.push(entry.selected.recording);
    recordingMetadata.push(entry.selected.recordingMetadata);
  }

  const outputPath = join(runDirectory, outputName);
  const videoProbe = await composeComparison({
    topPath: recordings[0],
    bottomPath: recordings[1],
    outputPath,
    videoPolicy: policy.video,
    logDirectory: rerecordDirectory,
  });
  const report = {
    ok: true,
    sourceRunId: runSpec.runId,
    method: method.id,
    outputPath,
    policyVersion: policy.schemaVersion,
    videoPolicy: policy.video,
    capture: {
      captureMode: capture.captureMode,
      fallbackTriggered: capture.fallbackTriggered,
      triggerSides: capture.triggerSides,
    },
    participants: participants.map((participant, index) => ({
      side: participant.side,
      modelProfile: participant.modelProfile,
      displayName: participant.displayName,
      recording: recordings[index],
      recordingMetadata: recordingMetadata[index],
      realtimeRecording: capture.entries[index].realtime,
      verification: verifications[index].verification,
    })),
    videoProbe,
  };
  await writeJson(join(rerecordDirectory, 'report.json'), report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: compactError(error) }, null, 2));
  process.exitCode = 1;
});
