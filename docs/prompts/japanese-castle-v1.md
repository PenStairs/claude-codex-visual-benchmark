<!-- GENERATED FILE. Run npm run generate:docs. -->
# Procedural Japanese Castle

| Field | Value |
|---|---|
| Prompt ID | `japanese-castle-v1` |
| Version | 2 |
| Method | Three.js |
| Rounds | 1 |
| Linked X account | [@karankendre](https://x.com/karankendre) |
| Linked post ID | `2025624483000963350` |
| Method origin | `prompt-native` |
| Evidence status | Source linked; prompt evidence not independently re-verified |
| Engagement | unavailable |
| Effect preview | Open the linked X post; third-party source media is not mirrored into this repository. |

## Original source links

- Source 1: https://x.com/karankendre/status/2025624483000963350



### Round-to-source mapping

- Round-level source mapping: unavailable in the current manifest; URL order is not treated as proof.

## Round 1: initial

Source file: [`prompt.md`](../../config/prompts/threejs/japanese-castle-v1/prompt.md)

```text
Create a single-file Three.js Japanese castle (天守閣 Tenshu-kaku) scene with a 5-tier procedurally generated castle on a tapered ishigaki stone base with corner turrets, curved irimoya roofs with gold eave trim and chidori-hafu gables, golden shachihoko finials, and a castle gate (Ōtemon). Surround it with a square moat featuring animated koi fish, lily pads, a wooden bridge, and a red torii gate; ring the grounds with procedural cherry blossom trees with curved branches and foliage clusters. Add 4 seasonal modes (Spring/Summer/Autumn/Winter) that smoothly interpolate sky shader, fog, ground, water, foliage, and particle colors, with season-specific particle behavior cherry petals flutter in spring, leaves drift in autumn, slow snowflakes fall in winter, fireflies glow in summer. Include a cinematic camera mode with 6 named shots (ishigaki, keep, shachihoko, blossoms, moat, wide), letterbox bars, fading captions, and a gold progress bar. Post-process with UnrealBloom and FXAA; usefferGeometryUtils.mergeGeometries to batch all castle geometry by material into single draw calls for performance; cap pixel ratio at 1.5, shadow map at 2048, and throttle lantern flicker and firefly updates to alternate frames
```

## Source issues

- suspected-typo: kept `usefferGeometryUtils.mergeGeometries`; likely intended `use BufferGeometryUtils.mergeGeometries` (preserve-source-text)

## Run this prompt

```bash
npm run benchmark -- describe --model-a <profile-a> --model-b <profile-b> --method threejs --prompt japanese-castle-v1
```

Review the plan hash, then run with the exact confirmed hash as documented in [Quick start](../quick-start.md).
