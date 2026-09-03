# Add your model

You can compare any model that a supported runner can execute. A model profile is a local JSON file under `config/models/`; it never contains the key itself.

## Choose the runner

- Use `runner: "codex"` for native Codex authentication or a provider-documented OpenAI Responses-compatible endpoint.
- Use `runner: "claude"` for native Claude Code authentication or a provider-documented Anthropic-compatible endpoint.

If one provider supports both surfaces, create two profile IDs and suffix the Claude Code profile with `-claude`. The resulting comparison is allowed, but a cross-runner result measures model + harness and must be disclosed.

## Copy an example

```bash
cp examples/custom-models/openai-responses-compatible.json config/models/my-model.json
```

PowerShell:

```powershell
Copy-Item "examples/custom-models/openai-responses-compatible.json" "config/models/my-model.json"
```

Edit the stable ID, display name, runner-facing model ID, documented endpoint, environment variable name, supported methods, and reasoning presets. Do not copy an example's placeholder endpoint into a real run.

## Verify

```bash
npm run generate:docs
npm run benchmark -- list-models
npm run benchmark -- doctor --models my-model
```

When ready to spend a minimal request, add `--probe-models`. Confirm that the provider truly accepts and executes the selected reasoning setting; a UI label alone is not evidence.

## Share a profile

Open a pull request only when the endpoint and model ID are public and reproducible. Cite official provider documentation in the pull request. Private gateways and personal proxies should remain local community profiles.
