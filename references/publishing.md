# Publishing

Publishing is opt-in with `--publish`. Without that flag, all artifacts stay local under the selected run directory.

Configure a direct upload endpoint:

```powershell
$env:SKILLFLOW_BENCHMARK_UPLOAD_URL = "https://example.invalid/api/benchmark-results/{runId}/video"
$env:SKILLFLOW_PUBLISH_TOKEN = "short-lived-token"
```

```bash
export SKILLFLOW_BENCHMARK_UPLOAD_URL='https://example.invalid/api/benchmark-results/{runId}/video'
export SKILLFLOW_PUBLISH_TOKEN='short-lived-token'
```

The runner replaces `{runId}`, sends one `PUT` request with `Content-Type: video/mp4`, and places only the bytes of `comparison.mp4` in the request body. Metadata is sent in `X-Skillflow-Benchmark` as base64-encoded JSON. A token, when present, is sent as a Bearer token. The endpoint should return JSON with `pageUrl` or `url`.

Use HTTPS outside localhost. A failed upload never deletes the local MP4. Logs, source code, individual recordings, prompts, keys, and reports are never uploaded by this Skill.
