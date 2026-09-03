<div align="center">
  <img src="assets/readme/hero.jpg" alt="Claude, Codex and any model visual benchmark" width="100%" />
</div>

<div align="center">

[![Version](https://img.shields.io/badge/version-0.8.0-7c6cff?style=flat-square)](CHANGELOG.md)
[![Model profiles](https://img.shields.io/badge/model_profiles-11-38bdf8?style=flat-square)](docs/model-gallery.md)
[![Prompt library](https://img.shields.io/badge/source_linked_prompts-20-f59e0b?style=flat-square)](docs/prompt-gallery.md)
[![Methods](https://img.shields.io/badge/methods-Three.js_%2B_Twigl-34d399?style=flat-square)](docs/benchmark-methods.md)
[![CI](https://img.shields.io/github/actions/workflow/status/PenStairs/claude-codex-visual-benchmark/ci.yml?branch=main&style=flat-square&label=checks)](https://github.com/PenStairs/claude-codex-visual-benchmark/actions)
[![License](https://img.shields.io/badge/license-MIT-e5e7eb?style=flat-square)](LICENSE)

**The most complete, beautiful, and reproducible visual comparison kit for Claude, Codex, and models you bring yourself.**

Give two coding agents the same real prompt. Let each build in an isolated workspace. Verify both results, record them at matched settings, and export one side-by-side video you can judge with your own eyes.

[简体中文](README.zh-CN.md) · [Quick start](docs/quick-start.md) · [Model gallery](docs/model-gallery.md) · [Prompt gallery](docs/prompt-gallery.md) · [Add your model](docs/add-your-model.md)

</div>

## See the difference, not just a score

Traditional leaderboards compress a model into one number. Visual coding tasks expose composition, interaction, motion, polish, and runtime quality directly. This project turns those differences into replayable evidence.

<img src="assets/readme/sample-military-armory.png" alt="Real GPT-5.6 Sol and Claude Fable 5.1 Three.js military armory comparison frames" width="100%" />

<p align="center"><sub>Real benchmark output: GPT-5.6 Sol (top) vs Claude Fable 5.1 (bottom), same Three.js prompt and matched capture policy. This is a result sample, not a claim that either model wins universally.</sub></p>

## What makes this benchmark different

| | Capability | What you get |
|---|---|---|
| 🧩 | **Bring any two models** | Use the 11 built-in profiles or add your own Codex CLI / Claude Code compatible profile. |
| 🎨 | **Visual-first evaluation** | Run rich Three.js worlds or compact Twigl shaders instead of judging code in a vacuum. |
| 🔗 | **Source-linked prompts** | Every built-in prompt keeps its original X link, exact prompt files, method origin, and dated engagement snapshot when available. |
| ⚖️ | **Controlled comparison** | Same prompt bytes, equivalent workspace rules, clean isolated scaffolds, explicit reasoning profiles, and matched recording settings. |
| 🎬 | **X-ready proof** | Produces a high-quality H.264 vertical comparison video with both outputs stacked at native capture size. |
| 🧾 | **Auditable runs** | The confirmed plan hash, timings, token usage, verification status, capture metadata, and failures remain in the local run report. |

## One prompt. Two isolated agents. One visual proof.

<img src="assets/readme/workflow.svg" alt="Choose two models, one prompt, isolate, verify, and record" width="100%" />

The benchmark is deliberately local-first. Models run through their configured agent runners on your machine; generated source code, logs, reports, and recordings stay under `runs/` unless you explicitly publish the final comparison video. Credentials stay in native CLI login stores or environment variables and are never written into a model profile.

## Start in five minutes

Prerequisites: Node.js 20.19+, FFmpeg, Chromium for Playwright, and at least one authenticated runner (`codex` or `claude`).

```bash
git clone https://github.com/PenStairs/claude-codex-visual-benchmark.git
cd claude-codex-visual-benchmark
npm install
npx playwright install chromium
npm run fetch:bgm
npm run benchmark -- doctor
```

Explore the current library:

```bash
npm run benchmark -- list-models
npm run benchmark -- list-prompts --method threejs
npm run benchmark -- list-prompts --method twigl
```

Build a reviewable plan before spending model quota:

```bash
npm run benchmark -- describe \
  --model-a gpt-5.6-sol \
  --model-b claude-fable-5-1 \
  --method threejs \
  --prompt military-armory-v1
```

After checking the exact prompt, profiles, reasoning levels, and estimated workflow, run again with the returned plan hash:

```bash
npm run benchmark -- run \
  --model-a gpt-5.6-sol \
  --model-b claude-fable-5-1 \
  --method threejs \
  --prompt military-armory-v1 \
  --confirmed-plan <sha256>
```

Windows PowerShell uses the same commands; either put the command on one line or replace `\` with PowerShell's backtick. Read the full [Quick start](docs/quick-start.md) before your first paid run.

### Install as a Codex Skill

The repository root is a complete Skill. With the open-source Skills CLI:

```bash
npx skills add PenStairs/claude-codex-visual-benchmark --global --all --copy
```

Or copy the repository into your agent's Skills directory. Then ask the agent to use `$visual-code-model-benchmark` and guide you through model, method, prompt, plan review, and confirmation.

## Built for Claude, Codex, and your own models

The same underlying model can have multiple profiles because a profile describes the whole execution path—not only a model name.

| Runner | Built-in profiles | Best fit |
|---|---:|---|
| Codex CLI | 6 | OpenAI login and Responses-compatible endpoints |
| Claude Code | 5 | Anthropic login and Anthropic-compatible endpoints |

Flash profiles default to their highest configured reasoning preset; all other profiles default to `high`. Automatic reasoning fallback is disabled so a quality run cannot silently downgrade itself.

See the live, generated [Model gallery](docs/model-gallery.md), or start from these templates:

- [OpenAI Responses-compatible custom model](examples/custom-models/openai-responses-compatible.json)
- [Anthropic-compatible custom model](examples/custom-models/anthropic-compatible.json)

## Prompt gallery with provenance

The built-in library currently contains:

- **18 Three.js prompts** covering games, simulations, architecture, vehicles, procedural worlds, and interaction.
- **2 Twigl prompts** for compact real-time shader evaluation, including a genuine two-round `Make it better` continuation.
- **20 source-linked prompts**, with direct X post URLs and dated engagement snapshots where the local manifest has captured them.

[Browse every prompt →](docs/prompt-gallery.md)

Each generated detail page shows the unmodified prompt text used by the runner, all source URLs, the linked account and post ID, the method origin, multi-round order, engagement capture date, and any adaptation or source issue disclosure.

<img src="assets/readme/provenance.svg" alt="Prompt source to final video provenance chain" width="100%" />

Important: **source-linked is not the same as independently re-verified**. The gallery labels this conservatively. Engagement counts are historical snapshots, not live popularity claims. See [Prompt provenance](docs/prompt-provenance.md).

## Official vs community benchmarks

To keep comparisons meaningful, this project does not mix every custom setup into one universal leaderboard.

- **Official benchmark**: unchanged released profile and prompt versions, declared runner, required reasoning policy, clean workspace, and complete local evidence.
- **Community benchmark**: custom model, endpoint, prompt, runner patch, policy, or hardware. Valuable and welcome, but reported with its own configuration.

Both belong in the project; they answer different questions. Read [Official vs community](docs/official-vs-community.md) and [Fairness policy](docs/fairness.md).

## Repository map

```text
config/models/          Runnable model profiles
config/prompts/         Source-linked Three.js and Twigl prompts
config/methods/         Benchmark scaffolds and file contracts
assets/templates/       Isolated workspaces given to each model
scripts/                Orchestration, verification, recording, and tests
schemas/                Public JSON Schemas for extensions
examples/               Copyable custom model and prompt examples
docs/                   Guides and generated galleries
benchmarks/             Publication contracts for official/community results
runs/                   Local outputs — always gitignored
```

## Contribute

You can contribute a model profile, a source-grounded prompt, a runner improvement, a reproducible bug report, or a community result.

Please read [CONTRIBUTING.md](CONTRIBUTING.md), then use the focused guide for [models](CONTRIBUTING_MODELS.md) or [prompts](CONTRIBUTING_PROMPTS.md). Pull requests run configuration, contract, timeout, browser-motion, recording, generated-doc, and publication-safety checks.

## Security, privacy, and affiliation

- Keep API keys in environment variables; never commit them.
- Generated workspaces and evidence remain local under `runs/`.
- Model outputs are untrusted code and are run inside the benchmark's constrained local scaffold—not a security sandbox for hostile code.
- Review provider terms before using subscription-backed plans or third-party gateways.

See [SECURITY.md](SECURITY.md). This is an independent community project by [PenStairs](https://github.com/PenStairs). It is not affiliated with, sponsored by, or endorsed by Anthropic, OpenAI, DeepSeek, Zhipu AI, Three.js, Twigl, or X.

## License

Code and original project documentation are released under the [MIT License](LICENSE). Prompt text and linked posts may retain rights held by their original authors; source attribution does not relicense third-party content. The optional soundtrack is downloaded separately under its own [license notice](assets/audio/brainiac-mixkit-license.txt).
