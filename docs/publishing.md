# Publishing

Publishing is opt-in. Without `--publish`, every artifact remains under the local run directory.

Configure a direct HTTPS upload endpoint:

```bash
export SKILLFLOW_BENCHMARK_UPLOAD_URL='https://your-domain.example/api/benchmark-results/{runId}/video'
export SKILLFLOW_PUBLISH_TOKEN='short-lived-token'
```

PowerShell:

```powershell
$env:SKILLFLOW_BENCHMARK_UPLOAD_URL = "https://your-domain.example/api/benchmark-results/{runId}/video"
$env:SKILLFLOW_PUBLISH_TOKEN = "short-lived-token"
```

The runner replaces `{runId}` and sends one `PUT` request with `Content-Type: video/mp4`. The body contains only final MP4 bytes. A compact metadata object is base64-encoded in the `X-Skillflow-Benchmark` header. The endpoint should return JSON with `pageUrl` or `url`.

Source code, prompts, logs, reports, keys, and individual recordings are never uploaded by this flow. A failed upload does not delete the local video.
