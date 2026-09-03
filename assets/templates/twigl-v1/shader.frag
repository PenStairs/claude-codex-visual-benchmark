precision highp float;
uniform vec2 resolution;
uniform vec2 mouse;
uniform float time;

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - resolution.xy) / min(resolution.x, resolution.y);
  uv.x += 0.035 * sin(time * 1.2);
  float glow = 0.05 / max(abs(length(uv) - 0.55), 0.002);
  vec3 color = vec3(0.02, 0.08, 0.14) + glow * vec3(0.08, 0.35, 0.65 + 0.08 * sin(time));
  gl_FragColor = vec4(color, 1.0);
}
