import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  launchBenchmarkBrowser,
  attachDiagnostics,
  measureRenderedCanvas,
  addBenchmarkOverlay,
  performPointerInteraction,
  recordBrowserPage,
  recordBrowserPageDeterministic,
} from './browser.mjs';
import { runProcess, startManagedProcess } from './process.mjs';
import { BenchmarkError, pathExists, resolveInside, writeUtf8 } from './utils.mjs';

const REMOTE_URL_PATTERN = /https?:\/\/[^\s"'`<>]+/gi;

export function locallyMappedThreePath(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  let relativePath = null;
  if (host === 'cdn.jsdelivr.net') {
    relativePath = url.pathname.match(/^\/npm\/three(?:@[^/]+)?\/(.+)$/i)?.[1] ?? null;
  } else if (host === 'unpkg.com') {
    relativePath = url.pathname.match(/^\/three(?:@[^/]+)?\/(.+)$/i)?.[1] ?? null;
  } else if (host === 'esm.sh') {
    relativePath = url.pathname.match(/^\/three(?:@[^/]+)?\/(.+)$/i)?.[1] ?? null;
    if (!relativePath && /^\/three(?:@[^/]+)?\/?$/i.test(url.pathname)) relativePath = 'build/three.module.js';
    if (!relativePath && /^\/three\.core(?:\.min)?\.js$/i.test(url.pathname)) {
      relativePath = `build/${url.pathname.slice(1)}`;
    }
  }

  if (!relativePath) return null;
  try {
    relativePath = decodeURIComponent(relativePath).replace(/\\/g, '/');
  } catch {
    return null;
  }
  if (!/^(?:build|examples\/jsm)\/[A-Za-z0-9_./-]+\.m?js$/i.test(relativePath)
    || relativePath.split('/').includes('..')) {
    return null;
  }
  return relativePath;
}

export function findDisallowedRemoteUrls(source, { allowThreeCdnMapping = false } = {}) {
  const urls = String(source ?? '').match(REMOTE_URL_PATTERN) ?? [];
  return [...new Set(urls.filter((url) => !allowThreeCdnMapping || !locallyMappedThreePath(url)))];
}

export async function validateSingleHtmlContract(workspace, integrity) {
  const failures = [];
  const changedAppFiles = integrity.changed.filter((rel) => ['src/main.js', 'src/style.css'].includes(rel));
  if (!integrity.changed.includes('index.html')) {
    failures.push({ stage: 'single-html', message: 'The prompt requires a single HTML implementation, but index.html was not changed.' });
  }
  if (changedAppFiles.length) {
    failures.push({ stage: 'single-html', message: 'The prompt requires app HTML, CSS, and JavaScript to remain in index.html.', files: changedAppFiles });
  }
  const indexPath = join(workspace, 'index.html');
  if (await pathExists(indexPath)) {
    const html = await readFile(indexPath, 'utf8');
    const localAppReferences = [
      ...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi),
      ...html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi),
    ].map((match) => match[1]).filter((value) => (
      !/^(?:https?:|data:|blob:|#)/i.test(value)
      && /\.(?:m?js|css)(?:[?#].*)?$/i.test(value)
    ));
    if (localAppReferences.length) {
      failures.push({ stage: 'single-html', message: 'The single HTML entry still references separate local JavaScript or CSS files.', references: localAppReferences });
    }
  }
  return failures;
}

async function installNetworkPolicy(page, workspace, { allowThreeCdnMapping = false } = {}) {
  const evidence = { enabledThreeCdnMapping: allowThreeCdnMapping, mappedRequests: [], blockedRequests: [] };
  await page.route('**/*', async (route) => {
    const requestUrl = route.request().url();
    let url;
    try {
      url = new URL(requestUrl);
    } catch {
      await route.abort('blockedbyclient');
      return;
    }
    if (!['http:', 'https:'].includes(url.protocol)
      || ['127.0.0.1', 'localhost'].includes(url.hostname.toLowerCase())) {
      await route.continue();
      return;
    }

    const relativePath = allowThreeCdnMapping ? locallyMappedThreePath(requestUrl) : null;
    if (relativePath) {
      const target = resolveInside(workspace, join(workspace, 'node_modules', 'three', ...relativePath.split('/')), 'mapped Three.js CDN dependency');
      if (await pathExists(target)) {
        evidence.mappedRequests.push({ url: requestUrl, localPackagePath: `three/${relativePath}` });
        await route.fulfill({ path: target, contentType: 'text/javascript; charset=utf-8' });
        return;
      }
    }

    evidence.blockedRequests.push(requestUrl);
    await route.abort('blockedbyclient');
  });
  return evidence;
}

async function getFreePort() {
  const { createServer } = await import('node:net');
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHttp(url, server, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      const output = server.output();
      throw new BenchmarkError('The local Three.js server exited before becoming ready.', {
        kind: 'infrastructure',
        details: output,
      });
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new BenchmarkError(`Timed out waiting for local Three.js server: ${url}`, { kind: 'infrastructure' });
}

async function startVite(workspace) {
  const viteEntry = join(workspace, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!(await pathExists(viteEntry))) {
    throw new BenchmarkError('Pinned Vite dependency is missing from the participant workspace.', { kind: 'infrastructure' });
  }
  const port = await getFreePort();
  const server = startManagedProcess({
    command: process.execPath,
    args: [viteEntry, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    cwd: workspace,
  });
  const url = `http://127.0.0.1:${port}/`;
  await waitForHttp(url, server);
  return { server, url };
}

export async function installThreeDependencies(workspace, logDirectory) {
  const result = await runProcess({
    command: 'npm',
    args: ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
    cwd: workspace,
    timeoutMs: 300000,
  });
  await writeUtf8(join(logDirectory, 'npm-ci.log'), `${result.stdout}\n${result.stderr}`);
  if (result.exitCode !== 0 || result.timedOut) {
    throw new BenchmarkError('Pinned Three.js dependencies could not be installed.', {
      kind: 'infrastructure',
      details: result.stderr.slice(-3000),
    });
  }
}

export async function verifyThree({ workspace, logDirectory, videoPolicy, startupTimeoutSeconds, requirements = {} }) {
  const failures = [];
  const build = await runProcess({
    command: 'npm',
    args: ['run', 'build'],
    cwd: workspace,
    timeoutMs: 180000,
  });
  await writeUtf8(join(logDirectory, 'build.log'), `${build.stdout}\n${build.stderr}`);
  if (build.exitCode !== 0 || build.timedOut) {
    failures.push({ stage: 'build', message: 'npm run build failed', output: `${build.stdout}\n${build.stderr}`.slice(-5000) });
    return { ok: false, failures, metrics: null };
  }

  const { server, url } = await startVite(workspace);
  const browser = await launchBenchmarkBrowser();
  let diagnostics;
  let canvas;
  let webgl;
  let networkPolicy;
  try {
    const page = await browser.newPage({ viewport: { width: videoPolicy.participantWidth, height: videoPolicy.participantHeight } });
    networkPolicy = await installNetworkPolicy(page, workspace, {
      allowThreeCdnMapping: requirements.localThreeCdnMapping === true,
    });
    diagnostics = attachDiagnostics(page);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('canvas', { state: 'visible', timeout: startupTimeoutSeconds * 1000 });
    await page.waitForTimeout(1200);
    canvas = await measureRenderedCanvas(page);
    webgl = await page.locator('canvas').evaluateAll((canvases) => ({
      canvasCount: canvases.length,
      webgl2CanvasCount: canvases.filter((candidate) => candidate.getContext('webgl2') !== null).length,
    }));
  } catch (error) {
    failures.push({ stage: 'browser', message: error.message });
  } finally {
    await browser.close();
    await server.stop();
  }

  if (diagnostics) {
    if (diagnostics.consoleErrors.length) failures.push({ stage: 'console', errors: diagnostics.consoleErrors.slice(0, 20) });
    if (diagnostics.pageErrors.length) failures.push({ stage: 'page', errors: diagnostics.pageErrors.slice(0, 20) });
    if (diagnostics.failedRequests.length) failures.push({ stage: 'network', errors: diagnostics.failedRequests.slice(0, 20) });
    if (diagnostics.badResponses.length) failures.push({ stage: 'network', errors: diagnostics.badResponses.slice(0, 20) });
  }
  if (canvas && !canvas.ok) failures.push({ stage: 'pixels', message: canvas.reason, metrics: canvas.metrics });
  if (requirements.webgl2Required === true && (!webgl || webgl.webgl2CanvasCount === 0)) {
    failures.push({ stage: 'webgl2', message: 'The prompt requires WebGL2, but no rendered canvas exposed a WebGL2 context.', metrics: webgl });
  }

  return { ok: failures.length === 0, failures, metrics: { canvas, diagnostics, webgl, networkPolicy } };
}

export async function recordThree({ workspace, outputPath, modelLabel, promptTitle, videoPolicy, interaction, startupTimeoutSeconds, requirements = {} }) {
  const { server, url } = await startVite(workspace);
  try {
    return await recordBrowserPage({
      outputPath,
      width: videoPolicy.participantWidth,
      height: videoPolicy.participantHeight,
      durationMs: videoPolicy.durationSeconds * 1000,
      framesPerSecond: videoPolicy.framesPerSecond,
      captureFramesPerSecond: videoPolicy.captureFramesPerSecond,
      captureBitrateBitsPerSecond: videoPolicy.captureBitrateBitsPerSecond,
      cadencePolicy: videoPolicy.cadence,
      load: async (page) => {
        await installNetworkPolicy(page, workspace, {
          allowThreeCdnMapping: requirements.localThreeCdnMapping === true,
        });
        const diagnostics = attachDiagnostics(page);
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForSelector('canvas', { state: 'visible', timeout: startupTimeoutSeconds * 1000 });
        await page.waitForTimeout(800);
        if (diagnostics.consoleErrors.length || diagnostics.pageErrors.length
          || diagnostics.failedRequests.length || diagnostics.badResponses.length) {
          throw new BenchmarkError('Three.js entry failed while preparing its recording.', {
            kind: 'infrastructure',
            details: diagnostics,
          });
        }
        await addBenchmarkOverlay(page, { modelLabel, promptTitle });
      },
      interact: async (page, durationMs) => performPointerInteraction(page, durationMs, interaction, {
        samplesPerSecond: videoPolicy.cadence.pointerSamplesPerSecond,
      }),
    });
  } finally {
    await server.stop();
  }
}

export async function recordThreeDeterministic({ workspace, outputPath, modelLabel, promptTitle, videoPolicy, interaction, startupTimeoutSeconds, requirements = {} }) {
  const { server, url } = await startVite(workspace);
  try {
    return await recordBrowserPageDeterministic({
      outputPath,
      width: videoPolicy.participantWidth,
      height: videoPolicy.participantHeight,
      durationMs: videoPolicy.durationSeconds * 1000,
      framesPerSecond: videoPolicy.framesPerSecond,
      deterministicPolicy: videoPolicy.deterministicFallback,
      interaction,
      load: async (page) => {
        await installNetworkPolicy(page, workspace, {
          allowThreeCdnMapping: requirements.localThreeCdnMapping === true,
        });
        const diagnostics = attachDiagnostics(page);
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForSelector('canvas', { state: 'visible', timeout: startupTimeoutSeconds * 1000 });
        await page.waitForTimeout(100);
        if (diagnostics.consoleErrors.length || diagnostics.pageErrors.length
          || diagnostics.failedRequests.length || diagnostics.badResponses.length) {
          throw new BenchmarkError('Three.js entry failed while preparing deterministic recording.', {
            kind: 'infrastructure',
            details: diagnostics,
          });
        }
        await addBenchmarkOverlay(page, { modelLabel, promptTitle });
      },
    });
  } finally {
    await server.stop();
  }
}
