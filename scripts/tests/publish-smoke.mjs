#!/usr/bin/env node

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { publishComparison } from '../lib/publish.mjs';
import { sha256 } from '../lib/utils.mjs';

const fileArgument = process.argv[2];
if (!fileArgument) {
  console.error('Usage: node scripts/tests/publish-smoke.mjs <comparison.mp4>');
  process.exit(2);
}

const file = resolve(fileArgument);
const expected = await readFile(file);
let received = Buffer.alloc(0);
let receivedHeaders;
let receivedUrl;

const server = createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    received = Buffer.concat(chunks);
    receivedHeaders = request.headers;
    receivedUrl = request.url;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ pageUrl: 'https://skillflow.net/benchmarks/publish-smoke' }));
  });
});

await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
const address = server.address();
process.env.SKILLFLOW_BENCHMARK_UPLOAD_URL = `http://127.0.0.1:${address.port}/upload/{runId}`;
process.env.SKILLFLOW_PUBLISH_TOKEN = 'publish-smoke-token';

try {
  const result = await publishComparison({
    outputPath: file,
    runId: 'publish-smoke',
    metadata: { runId: 'publish-smoke', uploadOnlyFinalMp4: true },
  });
  const assertions = {
    bodyMatchesMp4: sha256(received) === sha256(expected),
    bodyLength: received.length,
    expectedLength: expected.length,
    contentType: receivedHeaders?.['content-type'],
    bearerTokenPresent: receivedHeaders?.authorization === 'Bearer publish-smoke-token',
    metadataHeaderPresent: Boolean(receivedHeaders?.['x-skillflow-benchmark']),
    requestUrl: receivedUrl,
  };
  const ok = assertions.bodyMatchesMp4
    && assertions.bodyLength === assertions.expectedLength
    && assertions.contentType === 'video/mp4'
    && assertions.bearerTokenPresent
    && assertions.metadataHeaderPresent
    && assertions.requestUrl === '/upload/publish-smoke';
  console.log(JSON.stringify({ ok, result, assertions }, null, 2));
  if (!ok) process.exitCode = 1;
} finally {
  await new Promise((resolveClosed) => server.close(resolveClosed));
  delete process.env.SKILLFLOW_BENCHMARK_UPLOAD_URL;
  delete process.env.SKILLFLOW_PUBLISH_TOKEN;
}
