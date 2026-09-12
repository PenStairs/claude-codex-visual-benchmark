#!/usr/bin/env node

import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

const normalize = (value) => value.replace(/\r\n/g, '\n');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const escapeCell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
const repoPath = (path) => relative(ROOT, path).replace(/\\/g, '/');

async function writeGenerated(path, content) {
  const normalized = normalize(content).replace(/\s+$/, '') + '\n';
  if (CHECK) {
    let existing = null;
    try { existing = normalize(await readFile(path, 'utf8')); } catch {}
    if (existing !== normalized) throw new Error(`Generated documentation is stale: ${repoPath(path)}`);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, normalized, 'utf8');
}

function sourceIdentity(source = {}) {
  const first = source.urls?.[0] ?? '';
  const match = first.match(/^https:\/\/x\.com\/([^/]+)\/status\/(\d+)/i);
  return {
    handle: match?.[1] ?? 'unavailable',
    postId: match?.[2] ?? 'unavailable',
  };
}

function evidenceLabel(source = {}) {
  if (source.promptFidelity === 'verbatim') return 'Manifest marks prompt as verbatim';
  if (source.promptFidelity === 'fairness-adapted') return 'Fairness-adapted; original preserved';
  return 'Source linked; prompt evidence not independently re-verified';
}

function runnerLabel(id) {
  return id === 'claude' ? 'Claude Code' : 'Codex CLI';
}

function providerLabel(provider = {}) {
  if (provider.name) return provider.name;
  return ({ openai: 'OpenAI', anthropic: 'Anthropic', deepseek: 'DeepSeek', skillflow_glm: 'Z.AI Coding Plan' })[provider.id] ?? provider.id ?? 'unavailable';
}

async function loadModels() {
  const dir = join(ROOT, 'config', 'models');
  const files = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  return Promise.all(files.map((file) => readJson(join(dir, file))));
}

async function loadPrompts() {
  const result = [];
  for (const method of ['threejs', 'twigl']) {
    const root = join(ROOT, 'config', 'prompts', method);
    const dirs = (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of dirs) {
      const dir = join(root, entry.name);
      const manifest = await readJson(join(dir, 'manifest.json'));
      const definitions = manifest.promptFile
        ? [{ id: 'initial', promptFile: manifest.promptFile }]
        : manifest.rounds;
      const rounds = [];
      for (const [index, round] of definitions.entries()) {
        rounds.push({
          index: index + 1,
          id: round.id,
          file: round.promptFile,
          sourceUrl: round.sourceUrl ?? null,
          text: normalize(await readFile(join(dir, round.promptFile), 'utf8')).trimEnd(),
        });
      }
      result.push({ ...manifest, rounds, identity: sourceIdentity(manifest.source), directory: dir });
    }
  }
  return result;
}

function modelGallery(models) {
  const rows = models.map((model) => `| ${escapeCell(model.displayName)} | \`${model.id}\` | ${runnerLabel(model.runner ?? 'codex')} | ${escapeCell(providerLabel(model.provider))} | **${model.reasoning?.default ?? 'unavailable'}** | ${model.authentication?.type === 'environment' ? `\`${model.authentication.environmentVariable}\`` : model.authentication?.type} | ${model.supportedMethods?.join(', ')} |`).join('\n');
  return `<!-- GENERATED FILE. Run npm run generate:docs. -->
# Model gallery

The repository currently ships **${models.length} runnable profiles**. A profile is a model + runner + endpoint + authentication + reasoning policy, so the same model may intentionally appear once per runner.

| Model profile | Profile ID | Runner | Provider | Default reasoning | Authentication | Methods |
|---|---|---|---|---|---|---|
${rows}

## Bring your own model

DeepSeek routing note (2026-09-12): the V4.1 Flash profiles replace the old V4 Flash entries and call the official \`deepseek-flash\` alias. DeepSeek also routes the legacy API name to V4.1 Flash; it no longer selects a separate old model. Historical run reports remain unchanged. See [configuration and official sources](../references/configuration.md#deepseek-v41-flash-verified-2026-09-12).

Copy the closest example from [\`examples/custom-models\`](../examples/custom-models/) into \`config/models/\`, give it a unique profile ID, and keep credentials in environment variables. See [Add your model](add-your-model.md).

> Model and product names are descriptive compatibility labels. This independent project is not affiliated with or endorsed by Anthropic, OpenAI, DeepSeek, or Zhipu AI.
`;
}

function promptGallery(prompts) {
  const groups = ['threejs', 'twigl'].map((method) => {
    const items = prompts.filter((prompt) => prompt.method === method);
    const rows = items.map((prompt) => {
      const likes = prompt.source?.engagementSnapshot?.likes;
      const source = prompt.source?.urls?.[0] ? `[X post](${prompt.source.urls[0]})` : 'unavailable';
      return `| [${escapeCell(prompt.title)}](prompts/${prompt.id}.md) | ${prompt.rounds.length} | [@${prompt.identity.handle}](https://x.com/${prompt.identity.handle}) | ${source} | ${likes === undefined ? 'unavailable' : `${likes} (${prompt.source.engagementSnapshot.capturedAt})`} | ${escapeCell(evidenceLabel(prompt.source))} |`;
    }).join('\n');
    return `## ${method === 'threejs' ? 'Three.js' : 'Twigl'} (${items.length})

| Prompt | Rounds | Linked account | Original post | Likes snapshot | Evidence status |
|---|---:|---|---|---:|---|
${rows}`;
  }).join('\n\n');
  return `<!-- GENERATED FILE. Run npm run generate:docs. -->
# Prompt gallery

This gallery contains **${prompts.length} active prompts**: **${prompts.filter((item) => item.method === 'threejs').length} Three.js** and **${prompts.filter((item) => item.method === 'twigl').length} Twigl**. Prompt bytes live in the linked detail pages. Engagement values are dated snapshots, never live claims.

Evidence labels are intentionally conservative: an X link proves where a source is associated, while only explicit manifest evidence supports a stronger prompt-fidelity claim. See [Prompt provenance](prompt-provenance.md).

${groups}
`;
}

function promptDetail(prompt) {
  const sourceLinks = (prompt.source?.urls ?? []).map((url, index) => `- Source ${index + 1}: ${url}`).join('\n') || '- unavailable';
  const rounds = prompt.rounds.map((round) => `## Round ${round.index}: ${round.id}

Source file: [\`${round.file}\`](../../${repoPath(join(prompt.directory, round.file))})

\`\`\`text
${round.text}
\`\`\``).join('\n\n');
  const engagement = prompt.source?.engagementSnapshot
    ? `${prompt.source.engagementSnapshot.likes} likes captured ${prompt.source.engagementSnapshot.capturedAt} (${prompt.source.engagementSnapshot.scope})`
    : 'unavailable';
  const roundSourceMapping = prompt.rounds.every((round) => round.sourceUrl)
    ? prompt.rounds.map((round) => `- Round ${round.index} (${round.id}): ${round.sourceUrl}`).join('\n')
    : '- Round-level source mapping: unavailable in the current manifest; URL order is not treated as proof.';
  const adaptation = prompt.source?.promptFidelity === 'fairness-adapted'
    ? `\n## Adaptation disclosure\n\n- Source fidelity: fairness-adapted\n- Original prompt: \`${prompt.source.originalPrompt}\`\n- Removed text: \`${prompt.source.adaptation?.removedText}\`\n- Reason: ${prompt.source.adaptation?.reason}\n`
    : '';
  const issueLines = (prompt.source?.sourceIssues ?? []).map((issue) => `- ${issue.type}: kept \`${issue.verbatim}\`; likely intended \`${issue.likelyIntended}\` (${issue.handling})`).join('\n');
  const issues = issueLines ? `\n## Source issues\n\n${issueLines}\n` : '';
  return `<!-- GENERATED FILE. Run npm run generate:docs. -->
# ${prompt.title}

| Field | Value |
|---|---|
| Prompt ID | \`${prompt.id}\` |
| Version | ${prompt.version} |
| Method | ${prompt.method === 'threejs' ? 'Three.js' : 'Twigl'} |
| Rounds | ${prompt.rounds.length} |
| Linked X account | [@${prompt.identity.handle}](https://x.com/${prompt.identity.handle}) |
| Linked post ID | \`${prompt.identity.postId}\` |
| Method origin | \`${prompt.source?.methodOrigin ?? 'unavailable'}\` |
| Evidence status | ${evidenceLabel(prompt.source)} |
| Engagement | ${engagement} |
| Effect preview | Open the linked X post; third-party source media is not mirrored into this repository. |

## Original source links

${sourceLinks}

${prompt.source?.provenanceNote ? `Provenance note: ${prompt.source.provenanceNote}\n` : ''}

### Round-to-source mapping

${roundSourceMapping}

${rounds}
${adaptation}${issues}
## Run this prompt

\`\`\`bash
npm run benchmark -- describe --model-a <profile-a> --model-b <profile-b> --method ${prompt.method} --prompt ${prompt.id}
\`\`\`

Review the plan hash, then run with the exact confirmed hash as documented in [Quick start](../quick-start.md).
`;
}

function catalog(models, prompts) {
  return JSON.stringify({
    schemaVersion: 1,
    generatedFrom: ['config/models', 'config/prompts'],
    counts: {
      modelProfiles: models.length,
      modelIdentities: new Set(models.map((item) => item.model)).size,
      runners: new Set(models.map((item) => item.runner ?? 'codex')).size,
      prompts: prompts.length,
      threejsPrompts: prompts.filter((item) => item.method === 'threejs').length,
      twiglPrompts: prompts.filter((item) => item.method === 'twigl').length,
    },
    models: models.map((item) => ({ id: item.id, displayName: item.displayName, runner: item.runner ?? 'codex', provider: item.provider?.id, reasoning: item.reasoning?.default, methods: item.supportedMethods })),
    prompts: prompts.map((item) => ({ id: item.id, title: item.title, method: item.method, rounds: item.rounds.length, sourceUrls: item.source?.urls ?? [], evidence: evidenceLabel(item.source) })),
  }, null, 2);
}

const models = await loadModels();
const prompts = await loadPrompts();

await writeGenerated(join(ROOT, 'docs', 'model-gallery.md'), modelGallery(models));
await writeGenerated(join(ROOT, 'docs', 'prompt-gallery.md'), promptGallery(prompts));
for (const prompt of prompts) await writeGenerated(join(ROOT, 'docs', 'prompts', `${prompt.id}.md`), promptDetail(prompt));
await writeGenerated(join(ROOT, 'docs', 'data', 'catalog.json'), catalog(models, prompts));

console.log(JSON.stringify({ ok: true, check: CHECK, modelProfiles: models.length, prompts: prompts.length, generatedPromptPages: prompts.length }, null, 2));
