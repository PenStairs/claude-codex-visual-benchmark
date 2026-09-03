#!/usr/bin/env node

import { access, readFile, readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'README.md', 'README.en.md', 'LICENSE', 'CONTRIBUTING.md', 'SECURITY.md', 'CODE_OF_CONDUCT.md',
  '.github/workflows/ci.yml', 'docs/quick-start.md', 'docs/model-gallery.md', 'docs/prompt-gallery.md',
  'schemas/model-profile.schema.json', 'schemas/prompt-manifest.schema.json',
  'assets/readme/hero.jpg', 'assets/readme/social-preview.jpg', 'assets/readme/sample-military-armory.png',
];
const forbiddenPublic = ['runs', 'node_modules', '_to_delete', 'backup-before-0.6.0', 'assets/audio/brainiac-mixkit.mp3'];
const forbiddenAlways = ['_to_delete', 'backup-before-0.6.0'];
const failures = [];

for (const rel of required) {
  try { await access(join(ROOT, rel)); } catch { failures.push(`missing required file: ${rel}`); }
}
for (const rel of forbiddenAlways) {
  try { await access(join(ROOT, rel)); failures.push(`forbidden public artifact exists: ${rel}`); } catch {}
}

try {
  await access(join(ROOT, '.git'));
  for (const rel of forbiddenPublic) {
    const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', rel], { cwd: ROOT, stdio: 'ignore' });
    if (tracked.status === 0) failures.push(`forbidden public artifact is tracked: ${rel}`);
  }
} catch {
  const gitignore = await readFile(join(ROOT, '.gitignore'), 'utf8');
  for (const expected of ['node_modules/', 'runs/', 'assets/audio/*.mp3']) {
    if (!gitignore.includes(expected)) failures.push(`.gitignore is missing publication guard: ${expected}`);
  }
}

async function walk(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await walk(full));
    else result.push(full);
  }
  return result;
}

for (const file of await walk(ROOT)) {
  const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
  const info = await stat(file);
  if (info.size > 25 * 1024 * 1024) failures.push(`file exceeds 25 MiB publication guard: ${rel}`);
  if (/\.(json|md|mjs|js|yaml|yml|txt|example|gitignore)$/i.test(file)) {
    const text = await readFile(file, 'utf8');
    if (/\b(?:sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})\b/.test(text)) failures.push(`possible credential in ${rel}`);
    if (/C:\\Users\\yi|D:\\PenroseBrain/i.test(text)) failures.push(`machine-specific path in ${rel}`);
  }
}

for (const file of (await walk(ROOT)).filter((entry) => entry.toLowerCase().endsWith('.md'))) {
  const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
  const markdown = await readFile(file, 'utf8');
  const withoutFences = markdown.replace(/```[\s\S]*?```/g, '');
  const links = [
    ...[...withoutFences.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1]),
    ...[...withoutFences.matchAll(/<(?:img|a)\b[^>]*(?:src|href)="([^"]+)"[^>]*>/gi)].map((match) => match[1]),
  ];
  for (const raw of links) {
    const target = raw.replace(/^<|>$/g, '').split('#')[0].split('?')[0];
    if (!target || /^(?:https?:|mailto:|data:|#)/i.test(raw)) continue;
    let decoded;
    try { decoded = decodeURIComponent(target); } catch { decoded = target; }
    try { await access(resolve(dirname(file), decoded)); }
    catch { failures.push(`broken local link in ${rel}: ${raw}`); }
  }
}

const social = await stat(join(ROOT, 'assets', 'readme', 'social-preview.jpg')).catch(() => null);
if (social && social.size >= 1024 * 1024) failures.push('social-preview.jpg must stay below 1 MiB for GitHub upload');

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, requiredFiles: required.length, publicationGuards: true }, null, 2));
}
