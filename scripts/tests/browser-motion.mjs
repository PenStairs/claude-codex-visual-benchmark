#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  assessRecordingCadence,
  buildPointerTimeline,
  launchBenchmarkBrowser,
  performPointerInteraction,
} from '../lib/browser.mjs';
import { loadPolicy } from '../lib/config.mjs';

const policy = await loadPolicy();
const durationMs = policy.video.durationSeconds * 1000;
const samplesPerSecond = policy.video.cadence.pointerSamplesPerSecond;
const width = policy.video.participantWidth;
const height = policy.video.participantHeight;
const timeline = buildPointerTimeline({ width, height, durationMs, samplesPerSecond });

assert.equal(policy.video.target, 'x');
assert.equal(policy.video.layout, 'vertical-stack');
assert.equal(policy.video.outputWidth, width);
assert.equal(policy.video.outputHeight, height * 2);

assert.equal(timeline.length, durationMs / 1000 * samplesPerSecond + 1);
assert.equal(timeline[0].atMs, 0);
assert.equal(timeline.at(-1).atMs, durationMs);
assert.ok(Math.abs(timeline[0].x - width / 2) < 0.001);
assert.ok(Math.abs(timeline[0].y - height / 2) < 0.001);
assert.ok(Math.abs(timeline.at(-1).x - width / 2) < 0.001);
assert.ok(Math.abs(timeline.at(-1).y - height / 2) < 0.001);

const timingGaps = timeline.slice(1).map((point, index) => point.atMs - timeline[index].atMs);
assert.ok(Math.max(...timingGaps) <= 1000 / samplesPerSecond + 0.001);
assert.ok(Math.min(...timingGaps) >= 1000 / samplesPerSecond - 0.001);

const distances = timeline.slice(1).map((point, index) => {
  const previous = timeline[index];
  return Math.hypot(point.x - previous.x, point.y - previous.y);
});
assert.ok(Math.min(...distances) > 0.5);
assert.ok(timeline.every((point) => point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height));

const overloadDurationMs = 300;
const browser = await launchBenchmarkBrowser();
let interaction;
let observed;
let interactionElapsedMs;
try {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent('<canvas id="target" width="1200" height="676"></canvas>');
  await page.evaluate(() => {
    window.__motionEvents = [];
    document.addEventListener('pointermove', (event) => {
      window.__motionEvents.push({ type: event.type, x: event.clientX, y: event.clientY });
    });
  });
  const interactionStartedAt = performance.now();
  interaction = await performPointerInteraction(page, overloadDurationMs, 'orbit', { samplesPerSecond });
  interactionElapsedMs = performance.now() - interactionStartedAt;
  observed = await page.evaluate(() => window.__motionEvents);
} finally {
  await browser.close();
}
assert.equal(interaction.strategy, 'in-page-raf-wall-clock');
assert.ok(interaction.dispatchedSamples >= Math.floor(interaction.scheduledSamples * 0.8));
assert.ok(observed.length >= interaction.dispatchedSamples);
assert.ok(Math.max(...observed.map((event) => event.x)) - Math.min(...observed.map((event) => event.x)) > 20);
assert.ok(interactionElapsedMs < overloadDurationMs + policy.video.cadence.maximumInteractionOverrunMs);

const borderline = assessRecordingCadence({
  interactionElapsedMs: durationMs + 100,
  durationMs,
  frameTelemetry: { averageFps: 25, p95FrameMs: 50.1, maxFrameMs: 100 },
  cadencePolicy: policy.video.cadence,
});
assert.deepEqual(borderline.cadenceWarnings, ['p95FrameMs=50.1']);
assert.deepEqual(borderline.severeCadenceFailures, []);

const severe = assessRecordingCadence({
  interactionElapsedMs: durationMs + 2000,
  durationMs,
  frameTelemetry: { averageFps: 12, p95FrameMs: 150, maxFrameMs: 800 },
  cadencePolicy: policy.video.cadence,
});
assert.ok(severe.cadenceWarnings.length >= 4);
assert.ok(severe.severeCadenceFailures.length >= 4);

console.log(JSON.stringify({
  ok: true,
  samples: timeline.length,
  intervalMs: timingGaps[0],
  minimumMovementPixels: Math.min(...distances),
  maximumMovementPixels: Math.max(...distances),
  interaction: { ...interaction, observedEvents: observed.length, elapsedMs: Number(interactionElapsedMs.toFixed(2)) },
  cadenceClassification: { borderline, severe },
}, null, 2));
