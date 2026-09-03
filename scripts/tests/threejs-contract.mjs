import assert from 'node:assert/strict';
import { findDisallowedRemoteUrls, locallyMappedThreePath } from '../lib/threejs.mjs';
import { compareWorkspaceSnapshot } from '../lib/utils.mjs';

const method = {
  allowedModifiedFiles: ['index.html', 'src/main.js', 'src/style.css'],
  requiredModifiedFiles: [],
  requiredAnyModifiedFiles: ['index.html', 'src/main.js'],
};
const before = {
  'index.html': 'index-before',
  'src/main.js': 'main-before',
  'src/style.css': 'style-before',
};

assert.equal(compareWorkspaceSnapshot(before, before, method).ok, false);
assert.equal(compareWorkspaceSnapshot(before, { ...before, 'index.html': 'index-after' }, method).ok, true);
assert.equal(compareWorkspaceSnapshot(before, { ...before, 'src/main.js': 'main-after' }, method).ok, true);
assert.equal(compareWorkspaceSnapshot(before, { ...before, 'package.json': 'changed' }, method).ok, false);

const jsdelivr = 'https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js';
const unpkgAddon = 'https://unpkg.com/three@0.185.1/examples/jsm/postprocessing/EffectComposer.js';
assert.equal(locallyMappedThreePath(jsdelivr), 'build/three.module.js');
assert.equal(locallyMappedThreePath(unpkgAddon), 'examples/jsm/postprocessing/EffectComposer.js');
assert.deepEqual(findDisallowedRemoteUrls(`import * as THREE from '${jsdelivr}';`, { allowThreeCdnMapping: true }), []);
assert.deepEqual(findDisallowedRemoteUrls(`const texture = 'https://example.com/a.png';`, { allowThreeCdnMapping: true }), ['https://example.com/a.png']);
assert.deepEqual(findDisallowedRemoteUrls(`import * as THREE from '${jsdelivr}';`), [jsdelivr]);

console.log(JSON.stringify({ ok: true, test: 'threejs-contract' }));
