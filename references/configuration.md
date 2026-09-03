# Configuration

## Models

Each file under `config/models/` is one selectable model. Add a new model by copying a profile and changing its stable `id`, user-facing `displayName`, `runner` (`codex` or `claude`; see [runners.md](runners.md)), the runner-facing `model` id, provider, authentication mode, supported reasoning levels, and supported methods. Profiles without a `runner` field default to `codex`.

Naming convention: a profile that runs under Claude Code carries the `-claude` suffix (`deepseek-v4-pro-claude`), so the same provider model can exist once per runner and the user can choose a same-harness pairing.

Never put a key value in JSON. For an API or subscription key, use:

```json
"authentication": {
  "type": "environment",
  "environmentVariable": "PROVIDER_KEY"
}
```

Set it only in the launching shell or operating-system credential layer. Example:

```powershell
$env:GLM_CODING_PLAN_KEY = "paste-key-in-this-shell-only"
node scripts/benchmark.mjs doctor --models glm-5.3-coding-plan,gpt-5.6-sol
```

```bash
export GLM_CODING_PLAN_KEY='paste-key-in-this-shell-only'
node scripts/benchmark.mjs doctor --models glm-5.3-coding-plan,gpt-5.6-sol
```

`codex-login` means the profile uses the existing native Codex authentication; `claude-login` means it uses the existing native Claude Code login (`claude auth status` must report `loggedIn: true`). Each native login works only with its own runner. The bundled GLM profile intentionally calls the official Responses endpoint directly and does not use CC Switch.

### Claude runner profiles

First-party Anthropic models use aliases so they never go stale:

```json
{
  "id": "claude-opus",
  "displayName": "Claude Opus",
  "runner": "claude",
  "model": "opus",
  "provider": { "id": "anthropic", "name": "Anthropic" },
  "authentication": { "type": "claude-login" },
  "reasoning": { "default": "high", "allowed": ["low", "medium", "high", "xhigh", "max"], "control": "effort-flag" },
  "supportedMethods": ["threejs", "twigl"]
}
```

Third-party models reachable through an Anthropic-compatible endpoint declare `provider.baseUrl` with `wireApi: "anthropic"` and read a key from the environment (sent as a bearer token by default; set `"authentication": { ..., "header": "x-api-key" }` when the provider expects that header instead):

```json
{
  "id": "deepseek-v4-pro-claude",
  "displayName": "DeepSeek V4 Pro (Claude Code)",
  "runner": "claude",
  "model": "deepseek-v4-pro",
  "provider": { "id": "deepseek", "name": "DeepSeek", "baseUrl": "https://api.deepseek.com/anthropic", "wireApi": "anthropic" },
  "authentication": { "type": "environment", "environmentVariable": "DEEPSEEK_API_KEY", "header": "bearer" },
  "reasoning": { "default": "high", "allowed": ["low", "high", "max"], "control": "effort-flag" },
  "supportedMethods": ["threejs", "twigl"]
}
```

The bundled `deepseek-v4-pro-claude` and `glm-5.3-coding-plan-claude` profiles reuse `DEEPSEEK_API_KEY` and `GLM_CODING_PLAN_KEY`, so no new secrets are needed to run those models under Claude Code. To add another provider, copy one of those two profiles and change the model id, `baseUrl`, and environment variable name; confirm both with the provider's Claude Code integration guide first. Most Chinese open-model providers (DeepSeek, Zhipu/Z.AI, Moonshot, MiniMax, Alibaba Qwen) document such an endpoint because it is what their own Claude Code integrations use.

The bundled DeepSeek V4 Flash and Pro profiles call the provider's official endpoint directly and both read only `DEEPSEEK_API_KEY`. Flash uses model ID `deepseek-v4-flash`, the native Codex Responses path, a 1M context catalog, and the provider-supported `low`, `high`, and `max` reasoning presets with `max` as the benchmark default. Pro uses model ID `deepseek-v4-pro`, the same exposed presets, and `high` as the benchmark default. Their Claude-runner counterparts pass the same fixed presets through Claude Code's `--effort` flag. Do not put the key in either model JSON or route these profiles through CC Switch.

```powershell
$env:DEEPSEEK_API_KEY = "paste-key-in-this-shell-only"
node scripts/benchmark.mjs doctor --models deepseek-v4-pro
```

```bash
export DEEPSEEK_API_KEY='paste-key-in-this-shell-only'
node scripts/benchmark.mjs doctor --models deepseek-v4-pro
```

The bundled GLM-5.3 and GLM-5.3-Flash profiles use the China-region GLM Coding Plan Responses endpoint `https://open.bigmodel.cn/api/v1` and read only `GLM_CODING_PLAN_KEY`. Flash uses model ID `glm-5.3-flash`, a 1M context catalog, and `low`, `high`, and `max` reasoning presets with `max` as this benchmark's quality-mode default. GLM-5.3 uses `high`. Their Claude-runner counterparts pass the same fixed presets through Claude Code's `--effort` flag. The key is a Coding Plan credential and is not interchangeable with a normal Open Platform key. Do not route either profile through CC Switch.

## Timing, usage, and cost

Every runner generation and repair process records ISO start/end timestamps and elapsed milliseconds. The final report exposes `metrics.completeTaskTime` as a first-class output for every participant:

```text
completeTaskTime.durationMs
  = completeTaskTime.creativeRoundsDurationMs
  + completeTaskTime.repairRoundsDurationMs
```

This is the complete task-completion time defined for the benchmark. It includes CLI startup, model inference, tool calls, and file edits within creative and repair rounds. It excludes preflight, dependency installation, validation, recording, video composition, and publishing. `metrics.modelExecution` remains as the detailed/backward-compatible phase view, while the report's top-level `timing` remains the end-to-end benchmark elapsed time.

Token counts are parsed from Codex JSONL `turn.completed.usage` events or from the Claude Code `result` event's `modelUsage`, then normalized to one schema (see [runners.md](runners.md)). The report marks usage incomplete if any successful phase lacks a valid usage event, and records `reasoning_tokens_reported` per participant.

The second first-class output is `metrics.listPriceEstimatedCost`. It covers the same creative and repair rounds and is calculated from actual runner-reported token counts and the checked public API rates in `config/pricing.json`. Its fixed policy is `pricingStrategy: "lowest-published-rate"`: when the same token category has multiple listed tariffs, the lower tariff is used. DeepSeek therefore uses off-peak rates even when the run happened during peak hours; GLM-5.3-Flash uses its lower promotional rate while the catalog is still inside its review window; GPT uses standard rather than Fast pricing and omits the higher long-context surcharge; Claude cache writes use the lower 5-minute tariff rather than the 1-hour tariff. Claude Code's own estimate is retained under `runnerReportedEstimate` for reference but is not used to replace the benchmark's lower-price result.

"Lower price" applies only among tariffs for the same token category. It does not turn ordinary input into cached input: regular input, cached input, cache-write input, and output are still multiplied by their own actual token counts.

The estimate counts regular input, cached input, cache-write input, and output tokens. Reasoning tokens are already included in output tokens and are never charged a second time. Preflight is excluded. A missing/incomplete usage event, inconsistent token totals, expired lower price requiring review, or uncovered price configuration produces `status: "unavailable"` rather than a guessed amount.

`listPriceEstimatedCost` is not the user's real bill. Native Codex login, native Claude login, and GLM Coding Plan are subscription-backed; account discounts, subscription allocation, credits, taxes, billing adjustments, and unreported paid tool calls are outside the estimate. `metrics.cost` remains an alias of the same object for backward compatibility, and `actualCharge` is always `false`.

When adding or renaming a model, also add its exact runner-facing model ID to `config/pricing.json`. Use only a current official price page. If no official public list price exists, leave the model usable but expect `listPriceEstimatedCost.status: "unavailable"`.

The resolved plan, `run-spec.json`, and the final report all carry `harness.crossRunner`. When it is `true`, the participants ran in different CLIs and the comparison is "model + harness"; disclose that in the video caption.

## Prompts

Each prompt is a directory containing `manifest.json` and one or more Markdown prompt files:

```text
config/prompts/<method>/<prompt-id>/manifest.json
config/prompts/<method>/<prompt-id>/prompt.md
```

A single-round manifest uses the legacy-compatible `promptFile` field:

```json
{
  "id": "example-v1",
  "version": 1,
  "method": "threejs",
  "title": "Example",
  "promptFile": "prompt.md"
}
```

For prompts collected from public posts, keep provenance in the manifest without changing the prompt text:

```json
"source": {
  "platform": "x",
  "urls": ["https://x.com/example/status/123"],
  "methodOrigin": "prompt-native"
}
```

Use `prompt-native` when the original prompt explicitly names Three.js or Twigl. Use `source-environment` when the original prompt does not name the method but the source ran it in that environment. This metadata is informational and is never sent to either model.

Every active prompt must have a source. When the user supplied a prompt directly and no public URL exists, do not invent one; record it as:

```json
"source": {
  "platform": "user-provided",
  "methodOrigin": "prompt-native",
  "provenanceNote": "Provided directly by the user; no public source URL was supplied."
}
```

If the user explicitly requests a fairness adaptation to public source text, increment the prompt version, keep the original wording in `source.originalPrompt`, set `source.promptFidelity` to `fairness-adapted`, and record the exact transformation and reason under `source.adaptation`. Never present the adapted prompt as a verbatim source quote.

Three.js prompts may declare executable output requirements:

```json
"requirements": {
  "singleHtml": true,
  "webgl2Required": true,
  "localThreeCdnMapping": true
}
```

Use only the flags explicitly required by the source prompt. `singleHtml` verifies that application HTML, CSS, and JavaScript stay in `index.html`; `webgl2Required` checks the rendered canvas context; `localThreeCdnMapping` allows recognized Three.js module CDN URLs to resolve to the pinned local package while all other external requests remain blocked. The mapping normalizes dependency delivery and does not score CDN behavior.

A multi-round manifest uses an ordered `rounds` array:

```json
{
  "id": "example-v1",
  "version": 2,
  "method": "twigl",
  "title": "Example",
  "rounds": [
    { "id": "initial", "promptFile": "prompt.md" },
    { "id": "improve", "promptFile": "round-2.md" }
  ]
}
```

Do not define `promptFile` and `rounds` together. The runner normalizes each file's line endings once, hashes the resulting UTF-8 bytes, and sends every round to both models in the same order. Round 1 starts a private CLI session for each model (`codex exec` or `claude -p --session-id`); later rounds resume that same model's session and workspace and are sent as the exact normalized file content, without an explanatory wrapper. Verification begins only after all creative rounds finish. Changing any round file or its order requires incrementing `version` in the manifest. Do not put model-specific advice in a benchmark prompt.

## Methods and policy

`config/methods/*.json` pins the scaffold, editable files, runtime, and prompt root. `config/policy.json` pins quality mode and lifecycle limits: explicit `max` for every bundled Flash profile and explicit `high` for all other bundled profiles, with no automatic downgrade; generation soft warning at 3600 seconds, hard stop at 10800 seconds, output-idle stop at 900 seconds, and progress every 60 seconds; two repair rounds that reuse each participant's generation reasoning, with a 3600-second limit each; and a 120-second low-effort preflight. The policy also forbids automatic paid retries; single-side recovery requires a new confirmation token. The shared Three.js startup timeout applies equally to verification and recording for both participants; startup latency is not the visual benchmark's primary score, but the timeout remains bounded so a hung entry cannot block a run indefinitely. The only output target is X: each participant is recorded natively at 1200×676 using Playwright's low-overhead recorder patched to 30 fps and 8 Mbps, then A and B are stacked vertically into one 1200×1352 H.264 High/yuv420p MP4. `scripts/patch-playwright-recorder.mjs` applies this narrow patch only to pinned Playwright Core 1.62.1 and fails closed if the recorder source shape changes; `npm install` and every supported benchmark command apply it before use. The two-pixel adjustment from exact 16:9 keeps every yuv420p dimension even. The final encoder uses CRF 17 with the slow preset and the validator enforces the configured X bitrate, duration, frame-rate, aspect-ratio, resolution, and file-size ceilings. Do not restore the former side-by-side web layout or upscale a 960×540 recording and call it a clarity improvement.

The `video.cadence` policy drives pointer movement at the capture frame rate against wall-clock progress and drops stale samples instead of replaying a delayed input backlog. Its ordinary boundaries produce `cadenceWarnings`; they do not trigger retries. The nested `severeFrameRetry` boundaries identify materially choppy local recordings. A severe attempt is discarded and retried after the configured delay, up to `maximumRetries`; these local recording retries never rerun a paid model phase. Every failed attempt is preserved as a JSON evidence file. For Three.js, `video.deterministicFallback` requires both participants to switch together after either side exhausts those retries. It pins PNG frame capture, warmup frame count, per-frame timeout, and total wall-clock timeout while retaining 1200×676, 30 fps, and the configured 12-second duration. The final report retains the real-time evidence and marks the selected final intermediates with `captureMode: deterministic-frame`. Twigl continues to abort on exhausted severe cadence because its remote editor cannot be placed under this local virtual animation clock. Keep severe minimum-FPS lower than the warning minimum and severe maximum-duration boundaries higher than warning maximums. The final composition uses `video.audio`: the checksum-pinned local `Brainiac` MP3 is trimmed from its configured offset, mixed at low volume with fades, encoded as stereo AAC, and validated with the video. Run `npm run fetch:bgm` to acquire the local asset. Do not put the raw Mixkit MP3 into a redistributed Skill archive; each recipient downloads a local copy under the then-current Mixkit terms.

One run resolves these files into `run-spec.json`; do not edit policy midway through a run.

Quality mode accepts only the preset required by each profile: `max` for bundled Flash profiles and `high` for all other bundled profiles. A conflicting `--reasoning-a` or `--reasoning-b` value is rejected instead of silently changing quality. The selected presets are recorded in the run report.

Before a paid run, call `describe` with the exact model, reasoning, method, prompt, and publish options. It returns every normalized prompt round plus a `confirmationToken` derived from the complete resolved plan. Pass that value to `run --confirmed-plan <token>`. Any changed option, prompt round, round order, or config invalidates the token and requires a new description and confirmation. `--dry-run` deliberately does not require a token because it never calls a model or publishes.

For a single-side infrastructure retry, call `describe-retry --run <source-run-id-or-path> --side <a|b>` and then `retry-participant` with the returned token. The retry command verifies the source prompt hashes, rebuilds the failed side from the clean current template, copies only the successful side's allowed generated files, and marks the new run `recovered-single-participant`. It refuses to reuse a side that did not finish every creative round.
