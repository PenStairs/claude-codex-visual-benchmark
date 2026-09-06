<!-- GENERATED FILE. Run npm run generate:docs. -->
# Model gallery

The repository currently ships **12 runnable profiles**. A profile is a model + runner + endpoint + authentication + reasoning policy, so the same model may intentionally appear once per runner.

| Model profile | Profile ID | Runner | Provider | Default reasoning | Authentication | Methods |
|---|---|---|---|---|---|---|
| Claude Fable 5.1 | `claude-fable-5-1` | Claude Code | Anthropic | **high** | claude-login | threejs, twigl |
| Claude Opus 5 | `claude-opus-5` | Claude Code | Anthropic | **high** | claude-login | threejs, twigl |
| DeepSeek V4 Flash (Claude Code) | `deepseek-v4-flash-claude` | Claude Code | DeepSeek | **max** | `DEEPSEEK_API_KEY` | threejs, twigl |
| DeepSeek V4 Flash | `deepseek-v4-flash` | Codex CLI | DeepSeek | **max** | `DEEPSEEK_API_KEY` | threejs, twigl |
| DeepSeek V4 Pro (Claude Code) | `deepseek-v4-pro-claude` | Claude Code | DeepSeek | **high** | `DEEPSEEK_API_KEY` | threejs, twigl |
| DeepSeek V4 Pro | `deepseek-v4-pro` | Codex CLI | DeepSeek | **high** | `DEEPSEEK_API_KEY` | threejs, twigl |
| GLM-5.3 Coding Plan (Claude Code) | `glm-5.3-coding-plan-claude` | Claude Code | Z.AI Coding Plan | **high** | `GLM_CODING_PLAN_KEY` | threejs, twigl |
| GLM-5.3 Coding Plan | `glm-5.3-coding-plan` | Codex CLI | Z.AI Coding Plan | **high** | `GLM_CODING_PLAN_KEY` | threejs, twigl |
| GLM-5.3-Flash (Claude Code) | `glm-5.3-flash-claude` | Claude Code | Z.AI Coding Plan | **max** | `GLM_CODING_PLAN_KEY` | threejs, twigl |
| GLM-5.3-Flash | `glm-5.3-flash` | Codex CLI | Z.AI Coding Plan | **max** | `GLM_CODING_PLAN_KEY` | threejs, twigl |
| GPT-5.6 Sol | `gpt-5.6-sol` | Codex CLI | OpenAI | **high** | codex-login | threejs, twigl |
| GPT-6 Astra | `gpt-6-astra` | Codex CLI | OpenAI | **high** | codex-login | threejs, twigl |

## Bring your own model

Copy the closest example from [`examples/custom-models`](../examples/custom-models/) into `config/models/`, give it a unique profile ID, and keep credentials in environment variables. See [Add your model](add-your-model.md).

> Model and product names are descriptive compatibility labels. This independent project is not affiliated with or endorsed by Anthropic, OpenAI, DeepSeek, or Zhipu AI.
