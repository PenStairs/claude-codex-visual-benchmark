# Benchmark participant rules

Write one self-contained Twigl Classic fragment shader for the requested visual.

- Edit only `shader.frag`. Do not edit `AGENTS.md` or `CLAUDE.md` (identical copies of these rules).
- Use GLSL ES 1.00 / WebGL 1 syntax compatible with Twigl Classic.
- Available uniforms are `vec2 resolution`, `vec2 mouse`, and `float time`.
- Do not use textures, external files, network calls, includes, or additional packages.
- Keep loops statically bounded and avoid unsupported WebGL 2 syntax.
- The shader must compile as the complete contents of the Twigl editor.
