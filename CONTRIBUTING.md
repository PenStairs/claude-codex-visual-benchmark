# Contributing

Thanks for helping make visual model comparison broader, clearer, and more reproducible.

## Good contributions

- Add a runnable model profile without embedding credentials.
- Add a source-grounded Three.js or Twigl prompt whose exact wording can be reviewed.
- Improve isolation, verification, recording quality, failure classification, or cross-platform behavior.
- Submit a community result with enough configuration to understand what was compared.
- Fix documentation without changing benchmark semantics accidentally.

## Before opening a pull request

1. Fork the repository and create a focused branch.
2. Install dependencies with `npm install` and Chromium with `npx playwright install chromium`.
3. Make the smallest coherent change.
4. Run `npm run generate:docs` after changing models or prompts.
5. Run `npm run check:public`, `npm run check:docs`, and `npm run check`. Local `npm run check` expects at least one runner CLI; CI explicitly skips only that installed-command prerequisite while still testing both adapters.
6. Explain whether your change affects fairness, prompt bytes, model cost, external network access, or recording output.

Do not commit `runs/`, API keys, login tokens, raw model logs, downloaded soundtrack files, generated workspaces, or third-party assets without a clear redistribution license.

Model contributions must follow [CONTRIBUTING_MODELS.md](CONTRIBUTING_MODELS.md). Prompt contributions must follow [CONTRIBUTING_PROMPTS.md](CONTRIBUTING_PROMPTS.md). All participation follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Benchmark compatibility

A change that alters prompt bytes, round order, scaffold rules, required reasoning, validation, capture dimensions, frame rate, or encoding policy can invalidate comparisons. Call this out explicitly and update versions where required. Historical run artifacts are immutable.

## Pull request review

Maintainers review correctness, provenance, fairness, security, cross-platform usability, and whether public claims match evidence. Passing CI is required but is not proof that a model endpoint or X source is currently available.
