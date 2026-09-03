# Contributing a model profile

A profile represents the complete execution path: model ID, runner, provider endpoint, authentication mode, reasoning policy, supported methods, and optional pricing catalog. The same model may have one profile per runner.

## Requirements

- Start from an example in `examples/custom-models/` or the closest built-in profile.
- Use a stable lowercase kebab-case `id`.
- Set `runner` to `codex` or `claude`.
- Use only a provider-documented Responses-compatible or Anthropic-compatible endpoint.
- Store only an environment-variable name, never a key value.
- Declare the real runner-facing model ID and supported reasoning presets.
- Do not claim an effort level is supported until a real preflight has shown the provider accepts and executes it.
- Add current official pricing only when an authoritative public price exists; otherwise leave cost unavailable.

## Validation

```bash
npm run generate:docs
npm run check:public
npm run benchmark -- doctor --models <profile-id> --probe-models
npm run check
```

The live model probe can consume quota. State that clearly in your pull request and never run it in shared CI with contributor secrets.

## Subscription plans

Provider subscriptions and coding plans may restrict which clients or uses are permitted. Technical compatibility does not grant permission to power a public SaaS. Contributors are responsible for citing the provider's current integration documentation and terms when adding a subscription-backed profile.
