# Benchmark methods

## Three.js

Each participant receives a clean local Vite + Three.js scaffold and equivalent `AGENTS.md` / `CLAUDE.md` rules. The model may edit only the files declared in `config/methods/threejs.json`. Dependencies are pinned and installed by the harness; models cannot add packages, fetch remote assets, or inspect parent directories.

Verification checks the file contract, dependency boundary, blocked remote URLs, server startup, WebGL canvas, and visible motion. Recognized Three.js CDN imports may be mapped to the pinned local dependency only when the source prompt explicitly requires that behavior.

## Twigl

Each participant writes a complete Twigl Classic fragment shader in `shader.frag`. The harness loads it in the configured editor/runtime, verifies compilation and visual output, and records the same interaction window for both sides.

Twigl supports ordered multi-round prompts. Later rounds resume the same private runner session and workspace; the follow-up text is sent exactly as stored, without a benchmark wrapper.

## Shared boundary

The method is selected before the prompt. Both participants always receive the same method, prompt bytes, round order, verification contract, and recording policy. Models may differ in runner only when the plan explicitly marks the comparison as cross-runner.
