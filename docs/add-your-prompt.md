# Add your prompt

Prompts live in `config/prompts/<method>/<prompt-id>/`. Copy the example directory, then edit its manifest and prompt file.

```bash
cp -R examples/custom-prompts/threejs-example-v1 config/prompts/threejs/my-prompt-v1
```

Requirements:

- Preserve public prompt wording exactly and keep provenance outside the prompt file.
- Use `prompt-native` when the text names Three.js/Twigl; use `source-environment` only when the source visibly ran that exact prompt in the method.
- Use `platform: "user-provided"` and a plain provenance note when there is no public source. Never invent a URL.
- Increment `version` when prompt bytes or round order change.
- Multi-round entries use ordered `rounds`; never combine `promptFile` and `rounds`.
- Do not include model-specific advice, hidden assets, credentials, private project state, or another required Skill.

After editing:

```bash
npm run generate:docs
npm run benchmark -- list-prompts --method threejs
npm run check:public
npm run check
```

Read [Prompt provenance](prompt-provenance.md) and [CONTRIBUTING_PROMPTS.md](../CONTRIBUTING_PROMPTS.md) before submitting a public prompt.
