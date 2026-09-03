#!/usr/bin/env node

import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordBrowserPage } from '../lib/browser.mjs';
import { loadPolicy } from '../lib/config.mjs';

const policy = await loadPolicy();
const root = await mkdtemp(join(tmpdir(), 'visual-benchmark-recording-retry-'));
const outputPath = join(root, 'retry-test.mkv');
const cadencePolicy = {
  ...policy.video.cadence,
  captureTailMs: 100,
  maximumFrameGapMs: 50,
  severeFrameRetry: {
    ...policy.video.cadence.severeFrameRetry,
    maximumRetries: 1,
    delayMs: 0,
    maximumInteractionOverrunMs: 1000,
    minimumAverageFps: 1,
    maximumP95FrameMs: 1000,
    maximumFrameGapMs: 100,
  },
};

let captured;
try {
  await recordBrowserPage({
    outputPath,
    width: 320,
    height: 180,
    durationMs: 1000,
    framesPerSecond: 30,
    captureFramesPerSecond: 30,
    captureBitrateBitsPerSecond: 1_000_000,
    cadencePolicy,
    load: async (page) => {
      await page.setContent('<canvas width="320" height="180"></canvas>');
    },
    interact: async (page, durationMs) => {
      await page.waitForTimeout(100);
      await page.evaluate(() => {
        const startedAt = performance.now();
        while (performance.now() - startedAt < 350) {
          // Deliberately block rendering to exercise the severe-frame retry path.
        }
      });
      await page.waitForTimeout(durationMs - 450);
    },
  });
  assert.fail('The deliberately blocked page should exhaust its recording retries.');
} catch (error) {
  captured = error;
}

try {
  if (captured?.details?.retryExhausted !== true) {
    console.error(JSON.stringify({ unexpectedError: { name: captured?.name, message: captured?.message, kind: captured?.kind, details: captured?.details } }, null, 2));
  }
  assert.equal(captured?.details?.retryExhausted, true);
  assert.equal(captured.details.maximumAttempts, 2);
  assert.equal(captured.details.attempts.length, 2);
  assert.ok(captured.details.attempts.every((attempt) => attempt.severeCadenceFailures.some((failure) => failure.startsWith('maxFrameMs='))));
  await access(`${outputPath}.attempt-1.json`);
  await access(`${outputPath}.attempt-2.json`);
  console.log(JSON.stringify({
    ok: true,
    maximumAttempts: captured.details.maximumAttempts,
    attempts: captured.details.attempts,
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
