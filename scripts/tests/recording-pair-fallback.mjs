import assert from 'node:assert/strict';
import { BenchmarkError } from '../lib/utils.mjs';
import { captureRecordingPair } from '../lib/recording.mjs';

const participants = [{ side: 'a' }, { side: 'b' }];
const deterministicCalls = [];
const result = await captureRecordingPair({
  participants,
  allowDeterministicFallback: true,
  recordRealtime: async (participant) => {
    if (participant.side === 'b') {
      throw new BenchmarkError('severely choppy', {
        kind: 'infrastructure',
        details: { retryExhausted: true, attempts: [{ averageFps: 12 }] },
      });
    }
    return { recording: 'a-realtime.mkv', recordingMetadata: { captureMode: 'realtime' } };
  },
  recordDeterministic: async (participant, provenance) => {
    deterministicCalls.push(participant.side);
    assert.deepEqual(provenance.triggerSides, ['b']);
    return {
      recording: `${participant.side}-deterministic.mkv`,
      recordingMetadata: { captureMode: 'deterministic-frame' },
    };
  },
});

assert.equal(result.captureMode, 'deterministic-frame');
assert.equal(result.fallbackTriggered, true);
assert.deepEqual(result.triggerSides, ['b']);
assert.deepEqual(deterministicCalls, ['a', 'b']);
assert.equal(result.entries[0].realtime.ok, true);
assert.equal(result.entries[1].realtime.ok, false);
assert.equal(result.entries[0].selected.recording, 'a-deterministic.mkv');
assert.equal(result.entries[1].selected.recording, 'b-deterministic.mkv');

await assert.rejects(
  captureRecordingPair({
    participants,
    allowDeterministicFallback: true,
    recordRealtime: async () => {
      throw new BenchmarkError('not cadence', { kind: 'infrastructure' });
    },
    recordDeterministic: async () => ({}),
  }),
  /not cadence/,
);

console.log('recording pair fallback tests passed');
