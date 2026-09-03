# Troubleshooting

## `401` or expired OAuth token

Reauthenticate the native runner, then run `doctor` again. The preflight exists to catch this before a long peer run consumes quota.

## Model requires a newer CLI

Upgrade Codex CLI or Claude Code using its official installation method. Re-run `doctor --probe-models` only after the local version check passes.

## One model thinks for a long time without writing

High-effort models can spend tens of thousands of tokens planning an open-ended visual task before their first file edit. The current policy warns after one hour, stops after three hours, and stops after 15 minutes without any output. Progress output every 60 seconds distinguishes a slow active request from a dead process.

## Three.js starts slowly

The shared startup limit is 60 seconds. It applies equally to both sides. If a scene still hangs, inspect the Vite output and browser console in the run evidence; do not relabel a failed historical run by editing its report.

## Choppy recording

Close GPU-heavy apps, connect power, update the browser/graphics driver, and rerun the recording stage. The harness retries severe real-time captures and can switch both Three.js sides to deterministic frame capture without rerunning models.

## Missing music asset

Run `npm run fetch:bgm`. The downloader verifies the pinned SHA-256 and refuses a changed file.

## A custom endpoint works in one runner but not the other

Responses-compatible and Anthropic-compatible endpoints are different integration surfaces. Create one explicit profile per supported runner. Do not merely change the display name or assume an `effort` flag has the same semantics across providers.

## A paid run failed on one side

Use `describe-retry --run <run> --side <a|b>`, review the recovery plan, then use `retry-participant` with its new confirmation hash. The successful side is reused only after hashes and completion state are checked.
