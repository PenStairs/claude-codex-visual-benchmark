# Contributing a prompt

The prompt library is evidence-first. A beautiful post is only a lead; a benchmark entry needs reviewable prompt text and provenance.

## Inclusion gates

- A direct stable `x.com/<author>/status/<id>` URL or an explicitly marked user-provided source.
- The complete prompt preserved exactly; do not fix grammar, capitalization, spelling, punctuation, or framework names.
- Clear Three.js or Twigl method evidence. SVG-only, Blender, image-generation, and unrelated shader prompts are out of scope.
- A runnable task that does not depend on an undisclosed Skill, private project, proprietary asset pack, or hidden context.
- No exact or semantic duplicate that adds no new evaluation dimension.
- Dated engagement values when supplied; never present a remembered number as current.

Copy `examples/custom-prompts/threejs-example-v1/`, choose a stable versioned ID, and keep source metadata outside prompt files so models receive only the benchmark text.

Multi-round prompts are allowed only when the source supplies every round in order. Preserve vague follow-ups such as `Make it better` exactly. Record source support for each round when known; otherwise disclose that round-level attribution is unverified.

If a fairness adaptation is necessary, request maintainer approval, preserve `source.originalPrompt`, record the exact transformation and reason, and never label the active text as verbatim.

After editing:

```bash
npm run generate:docs
npm run benchmark -- list-prompts --method threejs
npm run benchmark -- list-prompts --method twigl
npm run check:public
npm run check
```
