import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { BenchmarkError } from './utils.mjs';

export async function publishComparison({ outputPath, runId, metadata }) {
  const template = process.env.SKILLFLOW_BENCHMARK_UPLOAD_URL;
  if (!template) {
    throw new BenchmarkError('Publishing was requested but SKILLFLOW_BENCHMARK_UPLOAD_URL is not configured.', {
      kind: 'publishing',
    });
  }
  const url = new URL(template.replaceAll('{runId}', encodeURIComponent(runId)));
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new BenchmarkError('Publishing requires HTTPS except for localhost development.', { kind: 'publishing' });
  }

  const headers = {
    'Content-Type': 'video/mp4',
    'X-Skillflow-Benchmark': Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64'),
  };
  if (process.env.SKILLFLOW_PUBLISH_TOKEN) {
    headers.Authorization = `Bearer ${process.env.SKILLFLOW_PUBLISH_TOKEN}`;
  }

  const response = await fetch(url, {
    method: process.env.SKILLFLOW_BENCHMARK_UPLOAD_METHOD ?? 'PUT',
    headers,
    body: await readFile(outputPath),
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new BenchmarkError(`Publishing failed with HTTP ${response.status}.`, {
      kind: 'publishing',
      details: responseText.slice(0, 1000),
    });
  }

  let payload = {};
  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = { response: responseText.slice(0, 1000) };
    }
  }
  return {
    ok: true,
    pageUrl: payload.pageUrl ?? payload.url ?? null,
    status: response.status,
  };
}
