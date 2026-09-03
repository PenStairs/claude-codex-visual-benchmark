#!/usr/bin/env node

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { SKILL_ROOT, readJson, resolveInside } from './lib/utils.mjs';

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function main() {
  const policy = await readJson(join(SKILL_ROOT, 'config', 'policy.json'));
  const audio = policy.video?.audio;
  if (!audio?.enabled || !audio.asset || !audio.sourceUrl || !audio.sha256) {
    throw new Error('The soundtrack download configuration is incomplete.');
  }

  const target = resolveInside(SKILL_ROOT, join(SKILL_ROOT, audio.asset), 'soundtrack asset');
  try {
    const existing = await readFile(target);
    if (digest(existing) === audio.sha256.toLowerCase()) {
      console.log(JSON.stringify({ ok: true, changed: false, target, sha256: audio.sha256 }, null, 2));
      return;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const response = await fetch(audio.sourceUrl, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Soundtrack download failed: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const actualHash = digest(buffer);
  if (actualHash !== audio.sha256.toLowerCase()) {
    throw new Error(`Soundtrack SHA-256 mismatch: expected ${audio.sha256}, received ${actualHash}`);
  }

  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.download`;
  try {
    await writeFile(temporary, buffer);
    await rm(target, { force: true });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
  console.log(JSON.stringify({ ok: true, changed: true, target, bytes: buffer.length, sha256: actualHash }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
