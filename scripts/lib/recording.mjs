import { compactError } from './utils.mjs';

export function isSevereCadenceRetryExhaustion(error) {
  return error?.kind === 'infrastructure' && error?.details?.retryExhausted === true;
}

/**
 * Try real-time capture for both sides first. When either Three.js capture
 * exhausts the severe-cadence retries, preserve that evidence and recapture
 * both sides with the same deterministic frame pipeline.
 */
export async function captureRecordingPair({
  participants,
  allowDeterministicFallback,
  recordRealtime,
  recordDeterministic,
}) {
  const entries = participants.map((participant) => ({
    participant,
    side: participant.side,
    realtime: null,
    selected: null,
  }));
  const triggerSides = [];

  for (const entry of entries) {
    try {
      entry.realtime = { ok: true, ...await recordRealtime(entry.participant) };
      entry.selected = entry.realtime;
    } catch (error) {
      if (!isSevereCadenceRetryExhaustion(error) || !allowDeterministicFallback) throw error;
      triggerSides.push(entry.side);
      entry.realtime = { ok: false, error: compactError(error), evidence: error.details };
    }
  }

  if (!triggerSides.length) {
    return {
      captureMode: 'realtime',
      fallbackTriggered: false,
      triggerSides,
      entries,
    };
  }

  for (const entry of entries) {
    entry.selected = { ok: true, ...await recordDeterministic(entry.participant, {
      triggerSides,
      realtime: entry.realtime,
    }) };
  }
  return {
    captureMode: 'deterministic-frame',
    fallbackTriggered: true,
    triggerSides,
    entries,
  };
}
