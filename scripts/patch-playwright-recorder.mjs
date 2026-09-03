#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BenchmarkError, SKILL_ROOT, readJson } from './lib/utils.mjs';

async function main() {
  const policy = await readJson(join(SKILL_ROOT, 'config', 'policy.json'));
  const desiredFps = policy.video?.captureFramesPerSecond;
  const desiredBitrate = policy.video?.captureBitrateBitsPerSecond;
  if (!Number.isInteger(desiredFps) || desiredFps <= 0) {
    throw new BenchmarkError('Recorder patch requires a positive captureFramesPerSecond.', { kind: 'configuration' });
  }
  if (!Number.isInteger(desiredBitrate) || desiredBitrate <= 0 || desiredBitrate % 1_000_000 !== 0) {
    throw new BenchmarkError('Recorder patch bitrate must be a positive whole number of Mbps.', { kind: 'configuration' });
  }

  const packagePath = join(SKILL_ROOT, 'node_modules', 'playwright-core', 'package.json');
  const bundlePath = join(SKILL_ROOT, 'node_modules', 'playwright-core', 'lib', 'coreBundle.js');
  const packageJson = await readJson(packagePath);
  if (packageJson.version !== '1.62.1') {
    throw new BenchmarkError(`Unsupported Playwright Core version for recorder patch: ${packageJson.version}`, {
      kind: 'configuration',
    });
  }

  const source = await readFile(bundlePath, 'utf8');
  const startMarker = '// packages/playwright-core/src/server/videoRecorder.ts';
  const endMarker = '// packages/playwright-core/src/server/chromium/crPage.ts';
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new BenchmarkError('Pinned Playwright recorder source markers were not found.', { kind: 'configuration' });
  }

  const recorderSource = source.slice(start, end);
  const fpsMatches = recorderSource.match(/\bfps = \d+;/g) ?? [];
  const bitrateMatches = recorderSource.match(/-b:v [^ ]+ -threads \d+/g) ?? [];
  if (fpsMatches.length !== 1 || bitrateMatches.length !== 1) {
    throw new BenchmarkError('Pinned Playwright recorder arguments changed; refusing an ambiguous patch.', {
      kind: 'configuration',
      details: { fpsMatches, bitrateMatches },
    });
  }

  const desiredBitrateLabel = `${desiredBitrate / 1_000_000}M`;
  const patchedRecorder = recorderSource
    .replace(fpsMatches[0], `fps = ${desiredFps};`)
    .replace(bitrateMatches[0], `-b:v ${desiredBitrateLabel} -threads 2`);
  const patched = `${source.slice(0, start)}${patchedRecorder}${source.slice(end)}`;
  const changed = patched !== source;
  if (changed) await writeFile(bundlePath, patched, 'utf8');

  console.log(JSON.stringify({
    ok: true,
    changed,
    playwrightCoreVersion: packageJson.version,
    captureFramesPerSecond: desiredFps,
    captureBitrateBitsPerSecond: desiredBitrate,
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: {
      name: error.name,
      message: error.message,
      kind: error.kind,
      details: error.details,
    },
  }, null, 2));
  process.exitCode = 1;
});
