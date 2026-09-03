import { createHash, randomBytes } from 'node:crypto';
import { constants as fsConstants, existsSync } from 'node:fs';
import { access, cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

export const SKILL_ROOT = resolve(moduleDirectory, '..', '..');

export class BenchmarkError extends Error {
  constructor(message, { kind = 'benchmark', details = null } = {}) {
    super(message);
    this.name = 'BenchmarkError';
    this.kind = kind;
    this.details = details;
  }
}

export function normalizeText(value) {
  return String(value).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trimEnd() + '\n';
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function safeSegment(value, label = 'value') {
  const text = String(value ?? '');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(text)) {
    throw new BenchmarkError(`${label} contains unsupported characters: ${text}`, { kind: 'configuration' });
  }
  return text;
}

export function createRunId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `${stamp}-${randomBytes(3).toString('hex')}`;
}

export async function pathExists(target) {
  try {
    await access(target, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDirectory(target) {
  await mkdir(target, { recursive: true });
  return target;
}

export async function readJson(target) {
  let text;
  try {
    text = await readFile(target, 'utf8');
  } catch (error) {
    throw new BenchmarkError(`Cannot read JSON file: ${target}`, {
      kind: 'configuration',
      details: error.message,
    });
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new BenchmarkError(`Invalid JSON file: ${target}`, {
      kind: 'configuration',
      details: error.message,
    });
  }
}

export async function writeJson(target, value) {
  await ensureDirectory(dirname(target));
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function writeUtf8(target, value) {
  await ensureDirectory(dirname(target));
  await writeFile(target, value, 'utf8');
}

export async function copyDirectory(source, destination) {
  await ensureDirectory(dirname(destination));
  await cp(source, destination, { recursive: true, force: false, errorOnExist: true });
}

export function toPosixPath(value) {
  return value.split(sep).join('/');
}

export async function walkFiles(root, { ignoreTopLevel = [] } = {}) {
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const rel = toPosixPath(relative(root, absolute));
      const top = rel.split('/')[0];
      if (ignoreTopLevel.includes(top)) continue;
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  }

  if (existsSync(root)) await visit(root);
  return files.sort();
}

export async function snapshotFiles(root, options = {}) {
  const result = {};
  for (const rel of await walkFiles(root, options)) {
    result[rel] = sha256(await readFile(join(root, ...rel.split('/'))));
  }
  return result;
}

export function compareWorkspaceSnapshot(before, after, method) {
  const allowed = new Set(method.allowedModifiedFiles);
  const required = new Set(method.requiredModifiedFiles);
  const requiredAny = new Set(method.requiredAnyModifiedFiles ?? []);
  const changed = [];
  const forbidden = [];
  const allPaths = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const rel of [...allPaths].sort()) {
    if (before[rel] === after[rel]) continue;
    changed.push(rel);
    if (!allowed.has(rel)) forbidden.push(rel);
  }

  const missingRequiredChanges = [...required].filter((rel) => before[rel] === after[rel]);
  const missingRequiredAnyChanges = requiredAny.size > 0
    && ![...requiredAny].some((rel) => before[rel] !== after[rel])
    ? [...requiredAny]
    : [];
  return {
    ok: forbidden.length === 0
      && missingRequiredChanges.length === 0
      && missingRequiredAnyChanges.length === 0,
    changed,
    forbidden,
    missingRequiredChanges,
    missingRequiredAnyChanges,
  };
}

export function redactText(value, secrets = []) {
  let text = String(value ?? '');
  const candidates = [...new Set(secrets.filter((secret) => typeof secret === 'string' && secret.length >= 8))];
  for (const secret of candidates) text = text.split(secret).join('[REDACTED]');
  return text;
}

export function compactError(error) {
  if (error instanceof BenchmarkError) {
    return { name: error.name, message: error.message, kind: error.kind, details: error.details };
  }
  return { name: error?.name ?? 'Error', message: error?.message ?? String(error) };
}

export async function fileSize(target) {
  return (await stat(target)).size;
}

export function resolveInside(root, candidate, label = 'path') {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`;
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(prefix)) {
    throw new BenchmarkError(`${label} escapes its allowed root`, { kind: 'configuration' });
  }
  return resolvedCandidate;
}
