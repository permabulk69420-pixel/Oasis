import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { versionedUrl, installAssetVersioning, BUILD_ID } from '../src/asset-version.js';

test('our model, texture and audio files get the build id', () => {
  assert.equal(versionedUrl('./models/vegetation/alien-tree/alien_tree_lod0.glb', 'abc123'), './models/vegetation/alien-tree/alien_tree_lod0.glb?v=abc123');
  assert.equal(versionedUrl('/Oasis/textures/bark/palm_bark_normal.jpg', 'abc123'), '/Oasis/textures/bark/palm_bark_normal.jpg?v=abc123');
  assert.equal(versionedUrl('./audio/ambient/loop.mp3', 'abc123'), './audio/ambient/loop.mp3?v=abc123');
});

test('anything else is left alone', () => {
  assert.equal(versionedUrl('blob:https://x/1234', 'abc'), 'blob:https://x/1234');
  assert.equal(versionedUrl('data:image/png;base64,AAAA', 'abc'), 'data:image/png;base64,AAAA');
  assert.equal(versionedUrl('https://example.com/models/a.glb', 'abc'), 'https://example.com/models/a.glb');
  assert.equal(versionedUrl('./models/a.glb?x=1', 'abc'), './models/a.glb?x=1');
  assert.equal(versionedUrl('./index.html', 'abc'), './index.html');
});

test('no build id (the dev server, tests) means no change', () => {
  assert.equal(BUILD_ID, '');
  assert.equal(versionedUrl('./models/a.glb'), './models/a.glb');
  const manager = new THREE.LoadingManager();
  assert.equal(installAssetVersioning(manager, ''), false);
  assert.equal(manager.resolveURL('./models/a.glb'), './models/a.glb');
});

test('installing it makes the loaders ask for the versioned URL', () => {
  const manager = new THREE.LoadingManager();
  assert.equal(installAssetVersioning(manager, 'b00b5'), true);
  assert.equal(manager.resolveURL('./models/a.glb'), './models/a.glb?v=b00b5');
});
