# Official vs community benchmarks

Custom models are a core feature, so the project uses two result lanes.

## Official benchmark

An official result must use an unchanged released model profile, prompt version, method scaffold, reasoning policy, and recording policy. It must include a complete `run-spec.json` and `run-report.json` locally, disclose cross-runner status, and pass the release's validation rules.

Official does not mean provider-endorsed. It means “produced under this repository's published contract.”

## Community benchmark

A result is community-scoped when it uses any custom model, endpoint, runner modification, prompt, scaffold, policy, hardware capture override, or manual repair. Community results are encouraged because they expand coverage, but their configuration must travel with the claim.

## No universal mixed leaderboard

The project does not merge official and community scores into one universal ranking. Visual outputs are first-class evidence, and different prompts test different capabilities. Galleries should allow filtering by prompt, model profile, runner, method, date, and result lane.

Templates for future published records live in `benchmarks/official/` and `benchmarks/community/`.
