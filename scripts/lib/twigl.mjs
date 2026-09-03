import { readFile } from 'node:fs/promises';
import { attachDiagnostics, launchBenchmarkBrowser, measureRenderedCanvas, addBenchmarkOverlay, performPointerInteraction, recordBrowserPage } from './browser.mjs';
import { BenchmarkError } from './utils.mjs';

async function loadShaderInTwigl(page, twiglUrl, shader) {
  await page.goto(twiglUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => typeof window.ace !== 'undefined', null, { timeout: 30000 });

  const editorResult = await page.evaluate((source) => {
    const mode = document.querySelector('#modeselect');
    if (mode) {
      mode.value = '0';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const editorElement = document.querySelector('#editor');
    if (!editorElement || !window.ace) return { ok: false, reason: 'Twigl Ace editor was not found.' };
    const editor = window.ace.edit('editor');
    editor.setValue(source, -1);
    editor.clearSelection();
    editor.focus();
    return { ok: true, length: editor.getValue().length };
  }, shader);

  if (!editorResult.ok || editorResult.length !== shader.length) {
    throw new BenchmarkError('Twigl editor did not accept the complete shader.', {
      kind: 'infrastructure',
      details: editorResult,
    });
  }

  await page.keyboard.press('Alt+Enter');
  await page.waitForTimeout(3500);
}

async function collectEditorAnnotations(page) {
  return await page.evaluate(() => {
    try {
      return window.ace.edit('editor').getSession().getAnnotations().map((annotation) => ({
        row: annotation.row,
        column: annotation.column,
        type: annotation.type,
        text: annotation.text,
      }));
    } catch {
      return [];
    }
  });
}

async function hideTwiglUi(page) {
  const hide = page.locator('#hidemenuicon');
  if (await hide.count()) {
    try {
      await hide.click({ timeout: 3000 });
      await page.waitForTimeout(400);
    } catch {
      // Recording can continue even if this cosmetic control changes.
    }
  }
}

export async function verifyTwigl({ workspace, method, videoPolicy }) {
  const shader = await readFile(`${workspace}/shader.frag`, 'utf8');
  const failures = [];
  const browser = await launchBenchmarkBrowser();
  let diagnostics;
  let canvas;
  let annotations = [];

  try {
    const page = await browser.newPage({
      viewport: { width: videoPolicy.participantWidth, height: videoPolicy.participantHeight },
    });
    diagnostics = attachDiagnostics(page);
    await loadShaderInTwigl(page, method.twiglUrl, shader);
    annotations = await collectEditorAnnotations(page);
    await hideTwiglUi(page);
    canvas = await measureRenderedCanvas(page);
  } catch (error) {
    if (error instanceof BenchmarkError && error.kind === 'infrastructure') throw error;
    throw new BenchmarkError('The real Twigl editor could not be loaded or controlled.', {
      kind: 'infrastructure',
      details: error.message,
    });
  } finally {
    await browser.close();
  }

  const shaderAnnotations = annotations.filter((annotation) => annotation.type === 'error');
  if (shaderAnnotations.length) failures.push({ stage: 'shader', errors: shaderAnnotations.slice(0, 20) });
  if (diagnostics.pageErrors.length) failures.push({ stage: 'page', errors: diagnostics.pageErrors.slice(0, 20) });
  if (diagnostics.consoleErrors.length) failures.push({ stage: 'console', errors: diagnostics.consoleErrors.slice(0, 20) });
  if (canvas && !canvas.ok) failures.push({ stage: 'pixels', message: canvas.reason, metrics: canvas.metrics });

  return { ok: failures.length === 0, failures, metrics: { canvas, annotations, diagnostics } };
}

export async function recordTwigl({ workspace, method, outputPath, modelLabel, promptTitle, videoPolicy, interaction }) {
  const shader = await readFile(`${workspace}/shader.frag`, 'utf8');
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
      await loadShaderInTwigl(page, method.twiglUrl, shader);
      await hideTwiglUi(page);
      await addBenchmarkOverlay(page, { modelLabel, promptTitle });
    },
    interact: async (page, durationMs) => performPointerInteraction(page, durationMs, interaction, {
      samplesPerSecond: videoPolicy.cadence.pointerSamplesPerSecond,
    }),
  });
}
