# Recording and X output

The current policy records each participant at 1200×676, 30 fps, and 8 Mbps, then stacks A above B into a 1200×1352 MP4. The two-pixel height adjustment keeps H.264 `yuv420p` dimensions valid. Final encoding uses H.264 High, CRF 17, the slow preset, AAC stereo audio, and X-compatible bitrate, duration, resolution, aspect-ratio, and file-size guards.

The recorder measures page-frame cadence and pointer timing. Ordinary slow frames become warnings. Severe real-time capture failures are retried locally without rerunning a paid model. If a Three.js side still cannot meet severe cadence limits, both sides switch to deterministic frame capture so the comparison remains synchronized and fair. Twigl cannot use the local virtual clock and therefore aborts after exhausted severe retries.

Recording quality depends on GPU, browser, drivers, thermal limits, and other workloads. Close heavy applications and connect laptop power before recording. Intel Iris Xe and other integrated GPUs can run the workflow, but deterministic fallback may be needed for complex scenes.

The optional soundtrack is downloaded with `npm run fetch:bgm`; the raw MP3 is intentionally excluded from Git and redistribution archives.
