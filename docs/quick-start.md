# Quick start

## 1. Install prerequisites

- Node.js 20.19 or newer
- FFmpeg and FFprobe on `PATH`
- Codex CLI, Claude Code CLI, or both
- Chromium installed through Playwright

```bash
npm install
npx playwright install chromium
npm run fetch:bgm
```

The soundtrack is downloaded separately because its license is not the repository's MIT license. The checksum is pinned in `config/policy.json`.

## 2. Authenticate runners

Use each CLI's native login for first-party profiles. For third-party profiles, copy `.env.example` and set environment variables only in the launching shell or your operating-system credential manager. The benchmark does not automatically load `.env` files.

PowerShell:

```powershell
$env:DEEPSEEK_API_KEY = "your-key-for-this-shell"
$env:GLM_CODING_PLAN_KEY = "your-key-for-this-shell"
```

macOS, Linux, or Git Bash:

```bash
export DEEPSEEK_API_KEY='your-key-for-this-shell'
export GLM_CODING_PLAN_KEY='your-key-for-this-shell'
```

Only define credentials for profiles you plan to use.

## 3. Inspect before spending quota

```bash
npm run benchmark -- list-models
npm run benchmark -- list-prompts --method threejs
npm run benchmark -- doctor --models gpt-5.6-sol,claude-fable-5-1
```

Add `--probe-models` only when you want a real minimal provider request. A live probe may consume quota.

## 4. Describe and confirm

```bash
npm run benchmark -- describe --model-a gpt-5.6-sol --model-b claude-fable-5-1 --method threejs --prompt military-armory-v1
```

Read the complete returned plan, including exact prompt rounds, model profiles, runner boundary, reasoning, publishing state, and warning text. The command returns a `confirmationToken` derived from the resolved plan. Any changed option or prompt byte changes that token.

## 5. Run

```bash
npm run benchmark -- run --model-a gpt-5.6-sol --model-b claude-fable-5-1 --method threejs --prompt military-armory-v1 --confirmed-plan <sha256>
```

The two generations run in parallel. Verification and recording follow only after both creative sessions finish. A failed infrastructure side can be retried later without paying to rerun the successful side, but only after a new retry plan and confirmation.

## 6. Find the result

The run directory contains:

- `comparison-x.mp4` or `comparison.mp4` — final X-ready result
- `run-spec.json` — immutable resolved plan
- `run-report.json` — status, timing, tokens, cost estimate, validation, and recording evidence
- `model-a/` and `model-b/` — local workspaces, logs, and intermediates

`runs/` is gitignored. Do not publish raw workspaces or logs without inspecting them.

## Multi-round Twigl example

```bash
npm run benchmark -- describe --model-a gpt-5.6-sol --model-b claude-fable-5-1 --method twigl --prompt drowned-city-v1
```

Round 1 asks for the drowned neo-gothic city; round 2 sends the exact follow-up `Make it better` to the same private model session and workspace.
