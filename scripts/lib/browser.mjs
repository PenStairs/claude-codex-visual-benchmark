import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PNG } from 'pngjs';
import { chromium } from 'playwright';
import { runProcess } from './process.mjs';
import { BenchmarkError, ensureDirectory, sha256, writeJson } from './utils.mjs';

const BROWSER_PROFILES = [
  {
    id: 'hardware-webgl',
    args: ['--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu'],
  },
  {
    id: 'swiftshader-fallback',
    args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader'],
  },
];

let selectedBrowserProfilePromise;

async function closeWithin(browser, timeoutMs = 5000) {
  if (!browser) return { ok: true, timedOut: false };
  let timer;
  const close = browser.close().then(
    () => ({ ok: true, timedOut: false }),
    (error) => ({ ok: false, timedOut: false, error: error.message }),
  );
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, timedOut: true }), timeoutMs);
    timer.unref();
  });
  const result = await Promise.race([close, timeout]);
  clearTimeout(timer);
  return result;
}

async function probeWebgl(browser) {
  const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
  try {
    await page.setContent('<canvas id="probe" width="8" height="8"></canvas>');
    return await page.evaluate(() => {
      const canvas = document.querySelector('#probe');
      const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (!gl) return { ok: false, renderer: null };
      const extension = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = extension
        ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER);
      return { ok: true, renderer };
    });
  } finally {
    await page.close().catch(() => {});
  }
}

async function selectBrowserProfile() {
  const failures = [];
  for (const candidate of BROWSER_PROFILES) {
    let browser;
    try {
      browser = await chromium.launch({ headless: true, args: candidate.args });
      const probe = await probeWebgl(browser);
      if (probe.ok) return { ...candidate, renderer: probe.renderer };
      failures.push(`${candidate.id}: WebGL context unavailable`);
    } catch (error) {
      failures.push(`${candidate.id}: ${error.message}`);
    } finally {
      await closeWithin(browser);
    }
  }
  throw new BenchmarkError('Chromium could not provide a WebGL recording context.', {
    kind: 'infrastructure',
    details: failures,
  });
}

export async function getBrowserRenderingProfile() {
  selectedBrowserProfilePromise ??= selectBrowserProfile();
  return await selectedBrowserProfilePromise;
}

export async function launchBenchmarkBrowser() {
  const profile = await getBrowserRenderingProfile();
  try {
    return await chromium.launch({ headless: true, args: profile.args });
  } catch (error) {
    throw new BenchmarkError('Chromium could not be launched. Run: npx playwright install chromium', {
      kind: 'infrastructure',
      details: { profile: profile.id, error: error.message },
    });
  }
}

export function attachDiagnostics(page) {
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const badResponses = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.method()} ${request.url()} :: ${request.failure()?.errorText ?? 'failed'}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
  });

  return { consoleErrors, pageErrors, failedRequests, badResponses };
}

async function largestCanvas(page) {
  const index = await page.locator('canvas').evaluateAll((canvases) => {
    let best = -1;
    let bestArea = 0;
    canvases.forEach((canvas, candidate) => {
      const rect = canvas.getBoundingClientRect();
      const area = Math.max(0, rect.width) * Math.max(0, rect.height);
      if (area > bestArea) {
        bestArea = area;
        best = candidate;
      }
    });
    return best;
  });
  if (index < 0) return null;
  return page.locator('canvas').nth(index);
}

function analyzePng(buffer) {
  const png = PNG.sync.read(buffer);
  let nonBlack = 0;
  let opaque = 0;
  let sum = 0;
  let sumSquares = 0;
  const colors = new Set();
  const stride = Math.max(1, Math.floor((png.width * png.height) / 50000));
  let samples = 0;

  for (let pixel = 0; pixel < png.width * png.height; pixel += stride) {
    const offset = pixel * 4;
    const r = png.data[offset];
    const g = png.data[offset + 1];
    const b = png.data[offset + 2];
    const a = png.data[offset + 3];
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (a > 8) opaque += 1;
    if (luma > 6 && a > 8) nonBlack += 1;
    sum += luma;
    sumSquares += luma * luma;
    colors.add(`${r >> 4}:${g >> 4}:${b >> 4}:${a >> 6}`);
    samples += 1;
  }

  const mean = samples ? sum / samples : 0;
  const variance = samples ? Math.max(0, sumSquares / samples - mean * mean) : 0;
  return {
    width: png.width,
    height: png.height,
    samples,
    opaqueRatio: samples ? opaque / samples : 0,
    nonBlackRatio: samples ? nonBlack / samples : 0,
    lumaMean: mean,
    lumaStdDev: Math.sqrt(variance),
    quantizedColorCount: colors.size,
    screenshotSha256: sha256(buffer),
  };
}

export async function measureRenderedCanvas(page) {
  const canvas = await largestCanvas(page);
  if (!canvas) return { ok: false, reason: 'No canvas element was found.' };
  const box = await canvas.boundingBox();
  if (!box || box.width < 64 || box.height < 64) {
    return { ok: false, reason: 'The largest canvas is missing or too small.', box };
  }
  const screenshot = await canvas.screenshot({ type: 'png' });
  const metrics = analyzePng(screenshot);
  const ok = metrics.opaqueRatio > 0.95
    && metrics.nonBlackRatio > 0.015
    && metrics.quantizedColorCount >= 6
    && metrics.lumaStdDev >= 1.5;
  return {
    ok,
    reason: ok ? null : 'Canvas pixels are blank or lack enough rendered variation.',
    box,
    metrics,
  };
}

export async function addBenchmarkOverlay(page, { modelLabel, promptTitle }) {
  await page.evaluate(({ modelLabel: label, promptTitle: title }) => {
    document.querySelector('#skillflow-benchmark-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'skillflow-benchmark-overlay';
    overlay.style.cssText = [
      'position:fixed',
      'left:24px',
      'top:20px',
      'z-index:2147483647',
      'pointer-events:none',
      'color:white',
      'background:rgba(4,7,12,.76)',
      'border:1px solid rgba(255,255,255,.24)',
      'border-radius:10px',
      'padding:11px 16px',
      'font:600 19px/1.25 Arial, sans-serif',
      'letter-spacing:.01em',
      'box-shadow:0 4px 24px rgba(0,0,0,.35)',
      'max-width:70vw',
    ].join(';');
    const model = document.createElement('div');
    model.textContent = label;
    const prompt = document.createElement('div');
    prompt.textContent = title;
    prompt.style.cssText = 'font-size:12px;font-weight:400;opacity:.76;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    overlay.append(model, prompt);
    document.body.appendChild(overlay);
  }, { modelLabel, promptTitle });
}

export function buildPointerTimeline({ width, height, durationMs, samplesPerSecond = 15 }) {
  const sampleCount = Math.max(2, Math.round((durationMs / 1000) * samplesPerSecond));
  const center = { x: width / 2, y: height / 2 };
  const radiusX = Math.min(90, width * 0.12);
  const radiusY = Math.min(35, height * 0.08);
  return Array.from({ length: sampleCount + 1 }, (_, index) => {
    const progress = index / sampleCount;
    const phase = progress * Math.PI * 2;
    return {
      atMs: progress * durationMs,
      x: center.x + radiusX * Math.sin(phase),
      y: center.y + radiusY * Math.sin(phase * 2),
    };
  });
}

export async function performPointerInteraction(page, durationMs, mode, { samplesPerSecond = 30 } = {}) {
  const viewport = page.viewportSize() ?? { width: 1200, height: 675 };
  const center = { x: viewport.width / 2, y: viewport.height / 2 };
  await page.mouse.move(center.x, center.y);
  if (mode === 'orbit') await page.mouse.down({ button: 'left' });
  let interaction;
  try {
    interaction = await page.evaluate(({ width, height, duration, rate, interactionMode }) => (
      new Promise((resolve) => {
        const canvases = [...document.querySelectorAll('canvas')];
        const target = canvases.sort((left, right) => {
          const a = left.getBoundingClientRect();
          const b = right.getBoundingClientRect();
          return b.width * b.height - a.width * a.height;
        })[0] ?? document.body;
        const sampleCount = Math.max(2, Math.round((duration / 1000) * rate));
        const radiusX = Math.min(90, width * 0.12);
        const radiusY = Math.min(35, height * 0.08);
        const startedAt = performance.now();
        let lastTickAt = startedAt;
        let lastIndex = -1;
        let dispatchedSamples = 0;
        let skippedSamples = 0;
        let maximumFrameGapMs = 0;

        const dispatchMove = (index) => {
          const progress = index / sampleCount;
          const phase = progress * Math.PI * 2;
          const x = width / 2 + radiusX * Math.sin(phase);
          const y = height / 2 + radiusY * Math.sin(phase * 2);
          const common = {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: x,
            clientY: y,
            screenX: x,
            screenY: y,
            button: -1,
            buttons: interactionMode === 'orbit' ? 1 : 0,
          };
          target.dispatchEvent(new PointerEvent('pointermove', {
            ...common,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
            pressure: interactionMode === 'orbit' ? 0.5 : 0,
          }));
          dispatchedSamples += 1;
        };

        const tick = (now) => {
          maximumFrameGapMs = Math.max(maximumFrameGapMs, now - lastTickAt);
          lastTickAt = now;
          const elapsed = Math.min(duration, now - startedAt);
          const index = Math.min(sampleCount, Math.floor((elapsed / duration) * sampleCount));
          if (index > lastIndex) {
            if (lastIndex >= 0 && index > lastIndex + 1) skippedSamples += index - lastIndex - 1;
            dispatchMove(index);
            lastIndex = index;
          }
          if (elapsed >= duration) {
            if (lastIndex < sampleCount) {
              skippedSamples += Math.max(0, sampleCount - lastIndex - 1);
              dispatchMove(sampleCount);
            }
            resolve({
              strategy: 'in-page-raf-wall-clock',
              scheduledSamples: sampleCount + 1,
              dispatchedSamples,
              skippedSamples,
              maximumFrameGapMs: Number(maximumFrameGapMs.toFixed(2)),
            });
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      })
    ), {
      width: viewport.width,
      height: viewport.height,
      duration: durationMs,
      rate: samplesPerSecond,
      interactionMode: mode,
    });
  } finally {
    if (mode === 'orbit') await page.mouse.up({ button: 'left' });
  }
  return interaction;
}

async function settleWithin(promise, timeoutMs) {
  let timer;
  const settled = promise.then(
    (value) => ({ ok: true, timedOut: false, value }),
    (error) => ({ ok: false, timedOut: false, error: error.message }),
  );
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, timedOut: true }), timeoutMs);
    timer.unref();
  });
  const result = await Promise.race([settled, timeout]);
  clearTimeout(timer);
  return result;
}

async function beginFrameTelemetry(page) {
  await page.evaluate(() => {
    const state = { active: true, previous: null, intervals: [] };
    window.__skillflowBenchmarkFrameTelemetry = state;
    const tick = (time) => {
      if (!state.active) return;
      if (state.previous !== null) state.intervals.push(time - state.previous);
      state.previous = time;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function endFrameTelemetry(page) {
  return await page.evaluate(() => {
    const state = window.__skillflowBenchmarkFrameTelemetry;
    if (!state) return null;
    state.active = false;
    const intervals = state.intervals.filter((value) => Number.isFinite(value) && value > 0);
    if (!intervals.length) return { frames: 0, averageFps: 0, p95FrameMs: null, maxFrameMs: null };
    const sorted = [...intervals].sort((a, b) => a - b);
    const elapsed = intervals.reduce((sum, value) => sum + value, 0);
    return {
      frames: intervals.length,
      averageFps: Number((intervals.length / (elapsed / 1000)).toFixed(2)),
      p95FrameMs: Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))].toFixed(2)),
      maxFrameMs: Number(Math.max(...intervals).toFixed(2)),
    };
  });
}

async function largestRecordedVideo(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.webm')) continue;
    const path = join(directory, entry.name);
    candidates.push({ path, size: (await stat(path)).size });
  }
  candidates.sort((a, b) => b.size - a.size);
  if (!candidates.length) {
    throw new BenchmarkError('Playwright did not produce a recording file.', { kind: 'infrastructure' });
  }
  return candidates[0].path;
}

async function waitForRecordedVideoReady(directory, minimumDurationSeconds, framesPerSecond, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastPath = null;
  let lastSize = -1;
  let stableSamples = 0;
  let lastProbeError = '';

  while (Date.now() < deadline) {
    try {
      const path = await largestRecordedVideo(directory);
      const size = (await stat(path)).size;
      if (path === lastPath && size === lastSize && size > 0) stableSamples += 1;
      else stableSamples = 0;
      lastPath = path;
      lastSize = size;

      if (stableSamples >= 8) {
        const probe = await runProcess({
          command: 'ffprobe',
          args: ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,nb_read_frames:format=duration', '-of', 'json', path],
          timeoutMs: 5000,
        });
        if (probe.exitCode === 0 && !probe.timedOut) {
          const parsed = JSON.parse(probe.stdout);
          const duration = Number(parsed.format?.duration);
          const frames = Number(parsed.streams?.[0]?.nb_read_frames);
          const minimumFrames = Math.floor(minimumDurationSeconds * framesPerSecond) - 2;
          if ((Number.isFinite(duration) && duration >= minimumDurationSeconds - 0.15)
            || (Number.isFinite(frames) && frames >= minimumFrames)) return path;
          lastProbeError = `duration=${duration}, frames=${frames}; expected at least ${minimumDurationSeconds.toFixed(3)}s or ${minimumFrames} frames`;
        } else lastProbeError = probe.stderr.slice(-1000);
      }
    } catch (error) {
      lastProbeError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new BenchmarkError('Playwright recording did not finish writing a readable WebM file.', {
    kind: 'infrastructure',
    details: { path: lastPath, size: lastSize, probeError: lastProbeError },
  });
}

async function finalizeRecordedVideo({
  sourcePath,
  outputPath,
  startSeconds,
  durationSeconds,
  width,
  height,
  framesPerSecond,
}) {
  const expectedFrames = Math.round(durationSeconds * framesPerSecond);
  const encode = await runProcess({
    command: 'ffmpeg',
    args: [
      '-hide_banner', '-y',
      '-fflags', '+genpts',
      '-ss', startSeconds.toFixed(3),
      '-i', sourcePath,
      '-t', String(durationSeconds),
      '-an',
      '-vf', `fps=${framesPerSecond},setpts=PTS-STARTPTS,scale=${width}:${height}:flags=lanczos,format=yuv420p,setsar=1`,
      '-c:v', 'libx264',
      '-profile:v', 'high',
      '-level:v', '4.1',
      '-crf', '8',
      '-preset', 'medium',
      '-pix_fmt', 'yuv420p',
      '-color_range', 'tv',
      '-colorspace', 'bt709',
      '-color_primaries', 'bt709',
      '-color_trc', 'bt709',
      outputPath,
    ],
    timeoutMs: 300000,
  });
  if (encode.exitCode !== 0 || encode.timedOut) {
    throw new BenchmarkError('FFmpeg could not finalize the browser recording.', {
      kind: 'infrastructure',
      details: encode.stderr.slice(-5000),
    });
  }

  const inspect = await runProcess({
    command: 'ffprobe',
    args: [
      '-v', 'error',
      '-count_frames',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,pix_fmt,avg_frame_rate,nb_read_frames:format=duration',
      '-of', 'json',
      outputPath,
    ],
    timeoutMs: 120000,
  });
  if (inspect.exitCode !== 0) {
    throw new BenchmarkError('FFprobe could not inspect the browser recording.', {
      kind: 'infrastructure',
      details: inspect.stderr,
    });
  }
  const probe = JSON.parse(inspect.stdout);
  const stream = probe.streams?.[0];
  const duration = Number(probe.format?.duration);
  const frames = Number(stream?.nb_read_frames);
  const failures = [];
  if (stream?.width !== width || stream?.height !== height) failures.push(`dimensions=${stream?.width}x${stream?.height}`);
  if (!Number.isFinite(duration) || duration < durationSeconds - 0.15) failures.push(`duration=${duration}`);
  if (!Number.isFinite(frames) || frames < expectedFrames - 2) failures.push(`frames=${frames}`);
  if (failures.length) {
    throw new BenchmarkError(`Browser recording failed validation: ${failures.join(', ')}`, { kind: 'infrastructure' });
  }
  return { ...probe, frames };
}

export function assessRecordingCadence({ interactionElapsedMs, durationMs, frameTelemetry, cadencePolicy }) {
  const interactionOverrunMs = Math.max(0, interactionElapsedMs - durationMs);
  const cadenceWarnings = [];
  const severeCadenceFailures = [];
  if (!cadencePolicy) return { interactionOverrunMs, cadenceWarnings, severeCadenceFailures };

  if (interactionOverrunMs > cadencePolicy.maximumInteractionOverrunMs) {
    cadenceWarnings.push(`interactionElapsedMs=${interactionElapsedMs.toFixed(1)}`);
  }
  if (frameTelemetry) {
    if (frameTelemetry.averageFps < cadencePolicy.minimumAverageFps) {
      cadenceWarnings.push(`averageFps=${frameTelemetry.averageFps}`);
    }
    if (frameTelemetry.p95FrameMs > cadencePolicy.maximumP95FrameMs) {
      cadenceWarnings.push(`p95FrameMs=${frameTelemetry.p95FrameMs}`);
    }
    if (frameTelemetry.maxFrameMs > cadencePolicy.maximumFrameGapMs) {
      cadenceWarnings.push(`maxFrameMs=${frameTelemetry.maxFrameMs}`);
    }
  }

  const severe = cadencePolicy.severeFrameRetry;
  if (!severe?.enabled) return { interactionOverrunMs, cadenceWarnings, severeCadenceFailures };
  if (interactionOverrunMs > severe.maximumInteractionOverrunMs) {
    severeCadenceFailures.push(`interactionElapsedMs=${interactionElapsedMs.toFixed(1)}`);
  }
  if (frameTelemetry) {
    if (frameTelemetry.averageFps < severe.minimumAverageFps) {
      severeCadenceFailures.push(`averageFps=${frameTelemetry.averageFps}`);
    }
    if (frameTelemetry.p95FrameMs > severe.maximumP95FrameMs) {
      severeCadenceFailures.push(`p95FrameMs=${frameTelemetry.p95FrameMs}`);
    }
    if (frameTelemetry.maxFrameMs > severe.maximumFrameGapMs) {
      severeCadenceFailures.push(`maxFrameMs=${frameTelemetry.maxFrameMs}`);
    }
  }
  return { interactionOverrunMs, cadenceWarnings, severeCadenceFailures };
}

async function recordBrowserPageAttempt({
  outputPath,
  width,
  height,
  durationMs,
  framesPerSecond = 30,
  captureFramesPerSecond = 30,
  captureBitrateBitsPerSecond = 8_000_000,
  cadencePolicy = null,
  recordingAttempt,
  load,
  interact,
}) {
  await ensureDirectory(dirname(outputPath));
  const renderingProfile = await getBrowserRenderingProfile();
  const browser = await launchBenchmarkBrowser();
  const temporaryVideoDirectory = `${dirname(outputPath)}/.playwright-video-${Date.now()}`;
  await ensureDirectory(temporaryVideoDirectory);
  let context;
  let cleanupTemporaryVideo = false;

  try {
    context = await browser.newContext({
      viewport: { width, height },
      recordVideo: { dir: temporaryVideoDirectory, size: { width, height } },
      ignoreHTTPSErrors: false,
    });
    const page = await context.newPage();
    const videoStartedAt = Date.now();
    await load(page);
    await beginFrameTelemetry(page);
    const interactionStartedAt = Date.now();
    const interaction = interact
      ? await interact(page, durationMs)
      : await page.waitForTimeout(durationMs);
    const interactionElapsedMs = Date.now() - interactionStartedAt;
    const frameTelemetry = await endFrameTelemetry(page);
    if (cadencePolicy?.captureTailMs) await page.waitForTimeout(cadencePolicy.captureTailMs);
    const contextClose = await settleWithin(context.close(), 60000);
    const browserClose = await closeWithin(browser, 60000);
    const startSeconds = Math.max(0, (interactionStartedAt - videoStartedAt) / 1000);
    const durationSeconds = durationMs / 1000;
    const sourcePath = await waitForRecordedVideoReady(temporaryVideoDirectory, startSeconds + durationSeconds, captureFramesPerSecond);
    const probe = await finalizeRecordedVideo({
      sourcePath,
      outputPath,
      startSeconds,
      durationSeconds,
      width,
      height,
      framesPerSecond,
    });
    const { interactionOverrunMs, cadenceWarnings, severeCadenceFailures } = assessRecordingCadence({
      interactionElapsedMs,
      durationMs,
      frameTelemetry,
      cadencePolicy,
    });
    const recordingFailures = [...severeCadenceFailures];
    if (!contextClose.ok || contextClose.timedOut) recordingFailures.push('browser context did not close cleanly');
    if (!browserClose.ok || browserClose.timedOut) recordingFailures.push('browser did not close cleanly');
    const retryableCadence = severeCadenceFailures.length > 0
      && contextClose.ok && !contextClose.timedOut
      && browserClose.ok && !browserClose.timedOut;

    const metadata = {
      captureMode: 'realtime',
      renderingProfile: { id: renderingProfile.id, renderer: renderingProfile.renderer },
      frameTelemetry,
      browserRecorder: {
        codec: 'vp8',
        framesPerSecond: captureFramesPerSecond,
        bitrateBitsPerSecond: captureBitrateBitsPerSecond,
      },
      contextClose,
      browserClose,
      interaction,
      startSeconds: Math.max(0, (interactionStartedAt - videoStartedAt) / 1000),
      durationSeconds: durationMs / 1000,
      interactionElapsedMs,
      interactionOverrunMs,
      cadencePolicy,
      cadenceWarnings,
      severeCadenceFailures,
      recordingAttempt,
      recordingStatus: cadenceWarnings.length ? 'passed-with-cadence-warning' : 'passed',
      probe,
      recordingFailures,
      retryableCadence,
    };
    await writeJson(`${outputPath}.json`, metadata);
    if (recordingFailures.length) {
      cleanupTemporaryVideo = true;
      throw new BenchmarkError(`Browser recording failed severe cadence validation: ${recordingFailures.join(', ')}`, {
        kind: 'infrastructure',
        details: metadata,
      });
    }
    cleanupTemporaryVideo = true;
  } finally {
    if (context) await settleWithin(context.close(), 2000);
    await closeWithin(browser, 5000);
    if (cleanupTemporaryVideo) await rm(temporaryVideoDirectory, { recursive: true, force: true });
  }
  return outputPath;
}

export async function recordBrowserPage(options) {
  const retryPolicy = options.cadencePolicy?.severeFrameRetry;
  const maximumRetries = retryPolicy?.enabled ? retryPolicy.maximumRetries : 0;
  const maximumAttempts = maximumRetries + 1;
  const priorSevereAttempts = [];

  for (let attemptNumber = 1; attemptNumber <= maximumAttempts; attemptNumber += 1) {
    try {
      return await recordBrowserPageAttempt({
        ...options,
        recordingAttempt: {
          attemptNumber,
          maximumAttempts,
          priorSevereAttempts,
        },
      });
    } catch (error) {
      if (!error?.details?.retryableCadence) throw error;
      const attemptEvidence = {
        attemptNumber,
        cadenceWarnings: error.details.cadenceWarnings,
        severeCadenceFailures: error.details.severeCadenceFailures,
        frameTelemetry: error.details.frameTelemetry,
        interactionElapsedMs: error.details.interactionElapsedMs,
        interactionOverrunMs: error.details.interactionOverrunMs,
      };
      priorSevereAttempts.push(attemptEvidence);
      await writeJson(`${options.outputPath}.attempt-${attemptNumber}.json`, error.details);
      if (attemptNumber >= maximumAttempts) {
        throw new BenchmarkError(`Browser recording remained severely choppy after ${maximumAttempts} attempts.`, {
          kind: 'infrastructure',
          details: {
            retryExhausted: true,
            maximumAttempts,
            attempts: priorSevereAttempts,
          },
        });
      }
      await rm(options.outputPath, { force: true });
      await rm(`${options.outputPath}.json`, { force: true });
      if (retryPolicy.delayMs > 0) await delay(retryPolicy.delayMs);
    }
  }
  throw new BenchmarkError('Browser recording retry loop ended unexpectedly.', { kind: 'infrastructure' });
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

async function finalizeDeterministicFrames({
  frameDirectory,
  outputPath,
  frameCount,
  durationSeconds,
  width,
  height,
  framesPerSecond,
}) {
  const inputPattern = join(frameDirectory, 'frame-%06d.png');
  const encode = await runProcess({
    command: 'ffmpeg',
    args: [
      '-hide_banner', '-y',
      '-framerate', String(framesPerSecond),
      '-start_number', '0',
      '-i', inputPattern,
      '-frames:v', String(frameCount),
      '-an',
      '-vf', `scale=${width}:${height}:flags=lanczos,format=yuv420p,setsar=1`,
      '-c:v', 'libx264',
      '-profile:v', 'high',
      '-level:v', '4.1',
      '-crf', '8',
      '-preset', 'medium',
      '-pix_fmt', 'yuv420p',
      '-color_range', 'tv',
      '-colorspace', 'bt709',
      '-color_primaries', 'bt709',
      '-color_trc', 'bt709',
      outputPath,
    ],
    timeoutMs: 300000,
  });
  if (encode.exitCode !== 0 || encode.timedOut) {
    throw new BenchmarkError('FFmpeg could not encode the deterministic frame sequence.', {
      kind: 'infrastructure',
      details: encode.stderr.slice(-5000),
    });
  }

  const inspect = await runProcess({
    command: 'ffprobe',
    args: [
      '-v', 'error',
      '-count_frames',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,pix_fmt,avg_frame_rate,nb_read_frames:format=duration',
      '-of', 'json',
      outputPath,
    ],
    timeoutMs: 120000,
  });
  if (inspect.exitCode !== 0) {
    throw new BenchmarkError('FFprobe could not inspect the deterministic recording.', {
      kind: 'infrastructure',
      details: inspect.stderr,
    });
  }
  const probe = JSON.parse(inspect.stdout);
  const stream = probe.streams?.[0];
  const duration = Number(probe.format?.duration);
  const frames = Number(stream?.nb_read_frames);
  const failures = [];
  if (stream?.width !== width || stream?.height !== height) failures.push(`dimensions=${stream?.width}x${stream?.height}`);
  if (!Number.isFinite(duration) || Math.abs(duration - durationSeconds) > 0.05) failures.push(`duration=${duration}`);
  if (!Number.isFinite(frames) || frames !== frameCount) failures.push(`frames=${frames}`);
  if (failures.length) {
    throw new BenchmarkError(`Deterministic recording failed validation: ${failures.join(', ')}`, { kind: 'infrastructure' });
  }
  return { ...probe, frames };
}

async function installDeterministicAnimationClock(page) {
  const bootstrap = () => {
    if (window.__skillflowDeterministicStep) return;
    let virtualNow = 0;
    let nextId = 1;
    let queue = new Map();
    const cancelled = new Set();
    const realDateNow = Date.now();
    const performanceNow = () => virtualNow;

    Object.defineProperty(window.performance, 'now', { configurable: true, value: performanceNow });
    Date.now = () => realDateNow + virtualNow;
    window.requestAnimationFrame = (callback) => {
      const id = nextId;
      nextId += 1;
      queue.set(id, callback);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      cancelled.add(id);
      queue.delete(id);
    };
    window.__skillflowDeterministicStep = (timeMs) => {
      virtualNow = timeMs;
      const current = queue;
      queue = new Map();
      let callbacks = 0;
      for (const [id, callback] of current) {
        if (cancelled.delete(id)) continue;
        callback(virtualNow);
        callbacks += 1;
      }
      return { callbacks, queuedForNextFrame: queue.size, virtualNow };
    };
    window.__skillflowDeterministicState = () => ({ virtualNow, queuedCallbacks: queue.size });
  };
  await page.addInitScript(bootstrap);
  await page.evaluate(bootstrap);
}

async function runFrameOperation(operation, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new BenchmarkError(`${label} exceeded ${timeoutMs} ms.`, {
      kind: 'infrastructure',
      details: { timeoutMs, label },
    })), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Captures exactly one PNG for every output frame after advancing a virtual
 * requestAnimationFrame clock. The page can take as long as it needs to render
 * each frame; render cost is measured but cannot cause dropped output frames.
 */
export async function recordBrowserPageDeterministic({
  outputPath,
  width,
  height,
  durationMs,
  framesPerSecond = 30,
  deterministicPolicy,
  interaction = 'hover',
  load,
}) {
  if (!deterministicPolicy?.enabled) {
    throw new BenchmarkError('Deterministic frame capture is disabled by policy.', { kind: 'configuration' });
  }
  await ensureDirectory(dirname(outputPath));
  const renderingProfile = await getBrowserRenderingProfile();
  const browser = await launchBenchmarkBrowser();
  const frameDirectory = join(dirname(outputPath), `.deterministic-frames-${Date.now()}`);
  await ensureDirectory(frameDirectory);
  const frameCount = Math.round((durationMs / 1000) * framesPerSecond);
  const frameDurationMs = 1000 / framesPerSecond;
  const warmupFrames = deterministicPolicy.warmupFrames;
  const frameTimeoutMs = deterministicPolicy.frameTimeoutSeconds * 1000;
  const captureTimeoutMs = deterministicPolicy.captureTimeoutSeconds * 1000;
  const captureStartedAt = Date.now();
  const renderWallTimes = [];
  const stepEvidence = [];
  let context;
  let contextClose = null;
  let browserClose = null;

  try {
    context = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: false });
    const page = await context.newPage();
    await installDeterministicAnimationClock(page);
    await load(page);

    for (let index = 0; index < warmupFrames; index += 1) {
      const virtualTimeMs = index * frameDurationMs;
      await runFrameOperation(
        page.evaluate((timeMs) => window.__skillflowDeterministicStep(timeMs), virtualTimeMs),
        frameTimeoutMs,
        `Deterministic warmup frame ${index + 1}`,
      );
    }

    const timeline = buildPointerTimeline({ width, height, durationMs, samplesPerSecond: framesPerSecond });
    if (interaction === 'orbit') {
      await page.mouse.move(timeline[0].x, timeline[0].y);
      await page.mouse.down({ button: 'left' });
    }
    try {
      for (let index = 0; index < frameCount; index += 1) {
        if (Date.now() - captureStartedAt > captureTimeoutMs) {
          throw new BenchmarkError(`Deterministic frame capture exceeded ${deterministicPolicy.captureTimeoutSeconds} seconds.`, {
            kind: 'infrastructure',
            details: { completedFrames: index, frameCount },
          });
        }
        const progressIndex = frameCount <= 1
          ? 0
          : Math.round((index / (frameCount - 1)) * (timeline.length - 1));
        const pointer = timeline[progressIndex];
        if (interaction === 'orbit' || interaction === 'hover') {
          await page.mouse.move(pointer.x, pointer.y);
        }
        const virtualTimeMs = (warmupFrames + index) * frameDurationMs;
        const startedAt = performance.now();
        const step = await runFrameOperation(
          page.evaluate((timeMs) => window.__skillflowDeterministicStep(timeMs), virtualTimeMs),
          frameTimeoutMs,
          `Deterministic render frame ${index + 1}`,
        );
        await runFrameOperation(
          page.screenshot({
            path: join(frameDirectory, `frame-${String(index).padStart(6, '0')}.png`),
            type: 'png',
            animations: 'disabled',
            timeout: frameTimeoutMs,
          }),
          frameTimeoutMs,
          `Deterministic screenshot frame ${index + 1}`,
        );
        const elapsedMs = performance.now() - startedAt;
        renderWallTimes.push(elapsedMs);
        if (index < 5 || index === frameCount - 1) stepEvidence.push({ frame: index, ...step });
      }
    } finally {
      if (interaction === 'orbit') await page.mouse.up({ button: 'left' }).catch(() => {});
    }

    contextClose = await settleWithin(context.close(), 60000);
    browserClose = await closeWithin(browser, 60000);
    const probe = await finalizeDeterministicFrames({
      frameDirectory,
      outputPath,
      frameCount,
      durationSeconds: durationMs / 1000,
      width,
      height,
      framesPerSecond,
    });
    const totalWallMs = renderWallTimes.reduce((sum, value) => sum + value, 0);
    const metadata = {
      captureMode: 'deterministic-frame',
      renderingProfile: { id: renderingProfile.id, renderer: renderingProfile.renderer },
      virtualTimeline: {
        framesPerSecond,
        frameDurationMs,
        frameCount,
        warmupFrames,
        durationSeconds: durationMs / 1000,
      },
      frameRenderWallTelemetry: {
        totalMs: Number(totalWallMs.toFixed(2)),
        averageMs: Number((totalWallMs / Math.max(1, renderWallTimes.length)).toFixed(2)),
        p95Ms: Number((percentile(renderWallTimes, 0.95) ?? 0).toFixed(2)),
        maxMs: Number((Math.max(...renderWallTimes, 0)).toFixed(2)),
      },
      interaction: {
        strategy: 'deterministic-frame-step',
        mode: interaction,
        scheduledSamples: frameCount,
        dispatchedSamples: frameCount,
        skippedSamples: 0,
      },
      clockScope: 'requestAnimationFrame+performance.now+Date.now',
      stepEvidence,
      browserRecorder: { codec: 'png-sequence', framesPerSecond },
      contextClose,
      browserClose,
      recordingStatus: 'passed',
      probe,
      recordingFailures: [],
    };
    await writeJson(`${outputPath}.json`, metadata);
    return outputPath;
  } finally {
    if (context) await settleWithin(context.close(), 2000);
    browserClose ??= await closeWithin(browser, 5000);
    await rm(frameDirectory, { recursive: true, force: true });
  }
}

export async function readUtf8(target) {
  return await readFile(target, 'utf8');
}
