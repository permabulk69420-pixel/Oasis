import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BARK, LEAF, SURFACE_BY_MATERIAL, barkPixels, leafPixels, barkGrey, surfaceTexture, applySurfaceTextures,
} from '../src/surface-textures.js';

function mean(data) {
  let s = 0;
  for (let i = 0; i < data.length; i += 4) s += data[i];
  return s / (data.length / 4) / 255;
}

test('bark detail has the average grey the materials are brightened by', () => {
  const m = mean(barkPixels());
  assert.ok(Math.abs(m - BARK.mean) < 0.05, `bark mean ${m}`);
});

test('leaf detail has the average grey the materials are brightened by', () => {
  const m = mean(leafPixels());
  assert.ok(Math.abs(m - LEAF.mean) < 0.05, `leaf mean ${m}`);
});

test('bark tiles seamlessly both ways', () => {
  for (let t = 0; t < 1; t += 0.05) {
    assert.ok(Math.abs(barkGrey(0.0001, t) - barkGrey(0.9999, t)) < 0.03, `u seam at v=${t}`);
    assert.ok(Math.abs(barkGrey(t, 0.0001) - barkGrey(t, 0.9999)) < 0.03, `v seam at u=${t}`);
  }
});

test('bark has real contrast but never goes black or white', () => {
  const d = barkPixels();
  let lo = 255, hi = 0;
  for (let i = 0; i < d.length; i += 4) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); }
  assert.ok(hi - lo > 60, `contrast ${hi - lo}`);
  assert.ok(lo > 40 && hi < 255);
});

test('textures are built once and shared', () => {
  assert.equal(surfaceTexture('bark'), surfaceTexture('bark'));
  assert.notEqual(surfaceTexture('bark'), surfaceTexture('leaf'));
  assert.throws(() => surfaceTexture('stone'));
});

test('applySurfaceTextures textures known materials only, with the same texture on every copy', () => {
  const make = name => new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ name }));
  const root = new THREE.Group();
  const a = make('Banded teal bark'), b = make('Banded teal bark'), c = make('Waxy blue leaf tissue'), d = make('Glow');
  root.add(a, b, c, d);
  applySurfaceTextures(root);
  assert.equal(a.material.map, surfaceTexture('bark'));
  assert.equal(b.material.map, a.material.map);
  assert.equal(a.material.emissiveMap, a.material.map);
  assert.equal(c.material.map, surfaceTexture('leaf'));
  assert.equal(d.material.map, null);
  assert.ok(a.material.color.r > 1, 'brightened to make up for the detail grey');
  assert.deepEqual(Object.keys(SURFACE_BY_MATERIAL).sort(), ['Banded teal bark', 'Waxy blue leaf tissue']);
});
