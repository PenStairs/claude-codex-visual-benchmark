# Twigl path

Each model writes only `shader.frag` in a private workspace. The required target is Twigl Classic: GLSL ES 1.00 / WebGL 1 with `resolution`, `mouse`, and `time` uniforms.

The active drowned-city prompt is a two-round creative test. Round 1 asks for the infinite neo-gothic city in a stormy ocean. Round 2 sends the exact follow-up `Make it better` by resuming each model's own runner session (Codex or Claude Code) in the same private workspace. Both models finish round 2 before shader verification or recording begins.

The verifier opens the real `https://twigl.app/` editor at the same native 1200×676 viewport used for recording, switches to Classic mode, inserts the shader through Twigl's Ace editor, triggers rendering, checks browser errors and rendered pixel diversity, then records both entries at 30 fps with the same duration and pointer path. The final X MP4 stacks model A above model B without empty bands. If Twigl is unavailable or its editor contract has changed, the run is classified as an infrastructure failure rather than a model failure.

Shader compilation or a blank shader is eligible for the same repair budget as a Three.js build error. The model never receives a screenshot-based aesthetic repair prompt.
