import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getMethod, loadPolicy } from '../lib/config.mjs';
import { installThreeDependencies, validateSingleHtmlContract, verifyThree } from '../lib/threejs.mjs';
import { copyDirectory, ensureDirectory } from '../lib/utils.mjs';

const root = await mkdtemp(join(tmpdir(), 'visual-code-threejs-runtime-'));
try {
  const method = await getMethod('threejs');
  const policy = await loadPolicy();
  const workspace = join(root, 'workspace');
  const logs = join(root, 'logs');
  await ensureDirectory(logs);
  await copyDirectory(method.templatePath, workspace);
  await writeFile(join(workspace, 'index.html'), `<!doctype html>
<html><head><meta charset="UTF-8"><style>html,body{margin:0;overflow:hidden}</style></head>
<body><script type="module">
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js';
const scene = new THREE.Scene();
const camera = new THREE.Camera();
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), new THREE.ShaderMaterial({
  vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position,1.0);}',
  fragmentShader: 'varying vec2 vUv; void main(){gl_FragColor=vec4(vUv,0.35+0.65*sin(vUv.x*18.0)*sin(vUv.y*14.0),1.0);}'
})));
renderer.setAnimationLoop(() => renderer.render(scene, camera));
</script></body></html>
`, 'utf8');
  assert.deepEqual(await validateSingleHtmlContract(workspace, { changed: ['index.html'] }), []);
  assert.equal((await validateSingleHtmlContract(workspace, { changed: ['index.html', 'src/main.js'] })).length, 1);
  await installThreeDependencies(workspace, logs);
  const verification = await verifyThree({
    workspace,
    logDirectory: logs,
    videoPolicy: policy.video,
    startupTimeoutSeconds: policy.threejsStartupTimeoutSeconds,
    requirements: { singleHtml: true, localThreeCdnMapping: true, webgl2Required: true },
  });
  assert.equal(verification.ok, true, JSON.stringify(verification.failures));
  assert.ok(verification.metrics.networkPolicy.mappedRequests.length >= 1);
  assert.ok(verification.metrics.webgl.webgl2CanvasCount >= 1);
  console.log(JSON.stringify({
    ok: true,
    mappedRequests: verification.metrics.networkPolicy.mappedRequests,
    webgl: verification.metrics.webgl,
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
