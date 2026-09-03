import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { recordBrowserPageDeterministic } from '../lib/browser.mjs';

const directory = await mkdtemp(join(tmpdir(), 'visual-benchmark-deterministic-'));
const outputPath = join(directory, 'capture.mkv');
try {
  await recordBrowserPageDeterministic({
    outputPath,
    width: 320,
    height: 180,
    durationMs: 1000,
    framesPerSecond: 30,
    deterministicPolicy: {
      enabled: true,
      warmupFrames: 2,
      frameTimeoutSeconds: 10,
      captureTimeoutSeconds: 60,
      imageFormat: 'png',
    },
    interaction: 'hover',
    load: async (page) => {
      await page.setContent(`<!doctype html><canvas width="320" height="180"></canvas><script>
        const canvas = document.querySelector('canvas');
        const context = canvas.getContext('2d');
        function draw(now) {
          context.fillStyle = 'rgb(' + (Math.floor(now / 10) % 255) + ',40,90)';
          context.fillRect(0, 0, 320, 180);
          requestAnimationFrame(draw);
        }
        requestAnimationFrame(draw);
      </script>`);
    },
  });
  const metadata = JSON.parse(await readFile(`${outputPath}.json`, 'utf8'));
  assert.equal(metadata.captureMode, 'deterministic-frame');
  assert.equal(metadata.virtualTimeline.frameCount, 30);
  assert.equal(metadata.probe.frames, 30);
  assert.equal(metadata.probe.streams[0].width, 320);
  assert.equal(metadata.probe.streams[0].height, 180);
  assert.equal(metadata.interaction.skippedSamples, 0);
  assert.equal(metadata.recordingFailures.length, 0);
  console.log('deterministic capture test passed');
} finally {
  await rm(directory, { recursive: true, force: true });
}
