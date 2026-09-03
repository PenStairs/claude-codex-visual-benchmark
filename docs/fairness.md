# Fairness policy

Fair does not mean pretending every model and runner is identical. It means controlling what can be controlled and disclosing what cannot.

## Controlled in every official run

- Same normalized UTF-8 prompt bytes and round order.
- Clean copies of the same method scaffold.
- Byte-identical workspace rules exposed under each CLI's native filename.
- Same allowed and required files.
- Same blocked network and dependency policy.
- Explicit, policy-required reasoning profile with no automatic downgrade.
- Parallel generation and matched verification/recording policy.
- Immutable plan hash reviewed before paid execution.

## Disclosed, not erased

- Runner (`codex` or `claude`) and whether the pair is cross-runner.
- Provider endpoint and subscription/API authentication class.
- Model-specific meaning of `high` or `max`.
- Local hardware and recording fallback.
- Repairs, infrastructure failures, retries, and reused participants.
- Missing or incomplete token/cost evidence.

## What a result may claim

A result supports: “Under this prompt version, profile versions, runner paths, reasoning settings, policy, and hardware, these were the produced visual outputs.”

It does not support: “Model A is universally better than Model B.” One prompt is a case, not a global ranking.

## Failure handling

Infrastructure errors remain visible and are not silently converted into model failures. A successful side may be reused for a confirmed single-side recovery only when its prompt hashes and creative rounds match. Historical reports are immutable.
