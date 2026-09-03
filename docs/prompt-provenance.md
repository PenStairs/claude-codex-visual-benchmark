# Prompt provenance

The public gallery separates evidence levels instead of turning incomplete metadata into a stronger claim.

## Evidence vocabulary

- **Source linked**: the manifest contains a direct X status URL associated with the entry.
- **Manifest marks prompt as verbatim**: the manifest explicitly records `promptFidelity: "verbatim"` and preserves the active prompt bytes.
- **Fairness-adapted**: the active benchmark prompt differs from the source; the original prompt, exact removed text, and reason remain in metadata.
- **Independently re-verified**: reserved for a fresh source audit that confirms the complete prompt location, author, method, and engagement at a stated date. The generated gallery does not infer this from a URL alone.

## Engagement snapshots

Likes and other metrics are time-sensitive. The gallery shows a number only with the capture date stored in the manifest. Missing data is `unavailable`; it is never estimated from memory, search rank, views, or a different post.

## Multi-link and multi-round entries

All source links remain visible. A provenance note may explain that one URL contains the prompt and another contains the result. Round-level source claims require explicit metadata; URL order alone is not enough to infer which post proves which round.

## Rights

Attribution preserves traceability; it does not relicense third-party prompt text or media. Contributors should quote only the prompt necessary for the runnable benchmark and link to the original post.
