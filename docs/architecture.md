# Architecture

```text
conversation / CLI
        |
        v
model profiles + method + prompt manifest
        |
        v
describe -> immutable confirmation hash
        |
        v
two clean workspaces, two private runner sessions
        |
        +--> Codex CLI adapter ------+
        |                            |
        +--> Claude Code adapter ----+--> verify --> matched recording --> compose MP4
                                             |
                                             +--> run report + evidence
```

The orchestrator is runner-neutral. Adapters translate one benchmark contract into native CLI arguments, authentication, session continuation, usage parsing, and provider endpoints. Prompt text remains runner-independent.

The project is local-first: only the runner's provider request and explicitly configured publishing endpoint leave the machine. The benchmark blocks model workspace network access and retains generated evidence locally.

Configuration is versioned separately from results. Every run resolves model, method, prompt, reasoning, policy, and publishing options into `run-spec.json`; a confirmation hash prevents an old approval from authorizing a changed plan.
