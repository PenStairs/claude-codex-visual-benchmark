# Security policy

## Supported version

Security fixes target the latest release on `main`.

## Report a vulnerability

Please use GitHub's **Security → Report a vulnerability** private reporting flow. Do not open a public issue containing a credential, exploit, private endpoint, or sensitive model output. If private reporting is unavailable, open a public issue that contains no sensitive detail and ask a maintainer to establish a private channel.

## Threat boundary

This project reduces accidental cross-run contamination and blocks ordinary network access in benchmark workspaces, but it is not a hardened sandbox for hostile code. Models generate executable JavaScript and shaders. Run the benchmark on a machine and account whose data exposure you can tolerate, keep unrelated secrets out of the environment, and inspect custom scaffolds before use.

Credentials must live in native Codex/Claude login stores or named environment variables. Profiles, prompts, reports, screenshots, videos, issues, and pull requests must never contain credential values.

Publishing sends only the final MP4 to the configured HTTPS endpoint. Source code, prompts, logs, reports, credentials, and individual recordings remain local. Review [docs/publishing.md](docs/publishing.md) before enabling it.
