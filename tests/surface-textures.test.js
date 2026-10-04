import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BARK, BARK_PHOTO, LEAF, SURFACE_BY_MATERIAL, barkPixels, leafPixels, barkGrey, surfaceTexture, applySurfaceTextures,
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

test('the photo bark replaces the drawn bark on every bark material, including ones added later', async () => {
  const fresh = await import('../src/surface-textures.js?photo-ok');
  const loaded = [];
  const loader = { loadAsync: async url => { loaded.push(url); return new THREE.DataTexture(new Uint8Array(4), 1, 1); } };
  const make = () => new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ name: 'Banded teal bark' }));
  const early = make();
  fresh.applySurfaceTextures(early, { photo: false });
  assert.equal(early.material.normalMap, null, 'drawn bark has no normal map');
  const photo = await fresh.loadBarkPhoto(loader, '/oasis/');
  assert.deepEqual(loaded.sort(), [`/oasis/${fresh.BARK_PHOTO.detail}`, `/oasis/${fresh.BARK_PHOTO.normal}`].sort());
  assert.equal(early.material.map, photo.detail);
  assert.equal(early.material.emissiveMap, photo.detail);
  assert.equal(early.material.normalMap, photo.normal);
  assert.equal(photo.normal.colorSpace, THREE.NoColorSpace);
  assert.equal(photo.normal.flipY, false);
  const late = make();
  fresh.applySurfaceTextures(late, { photo: false });
  assert.equal(late.material.normalMap, photo.normal, 'a model loaded after the photo gets it straight away');
  assert.equal(await fresh.loadBarkPhoto(loader), photo, 'loaded once');
});

test('if the photo bark cannot be loaded the drawn bark stays and nothing throws', async () => {
  const fresh = await import('../src/surface-textures.js?photo-fail');
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ name: 'Banded teal bark' }));
  fresh.applySurfaceTextures(mesh, { photo: false });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const result = await fresh.loadBarkPhoto({ loadAsync: async () => { throw new Error('404'); } });
    assert.equal(result, null);
  } finally {
    console.warn = warn;
  }
  assert.equal(mesh.material.map, fresh.surfaceTexture('bark'));
  assert.equal(mesh.material.normalMap, null);
});

test('the palm builder bakes bark UVs at the same tiles per metre as the texture module', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../tools/alien-tree/build_alien_tree.py', import.meta.url), 'utf8');
  const match = source.match(/^BARK_TILES_PER_METRE = ([0-9.]+)/m);
  assert.ok(match, 'constant found');
  assert.equal(Number(match[1]), BARK.tilesPerMetre);
});

test('the photo bark files exist and are small', async () => {
  const { statSync } = await import('node:fs');
  for (const file of [BARK_PHOTO.detail, BARK_PHOTO.normal]) {
    const { size } = statSync(new URL(`../public/${file}`, import.meta.url));
    assert.ok(size > 50_000 && size < 700_000, `${file} is ${size} bytes`);
  }
});

test('the leaf look comes from the address, and falls back to the default', async () => {
  const m = await import('../src/surface-textures.js?looks');
  assert.equal(m.pickLeafLook(''), m.DEFAULT_LEAF_LOOK);
  assert.equal(m.pickLeafLook('?leaf=plain'), 'plain');
  assert.equal(m.pickLeafLook('?leaf=dark'), 'dark');
  assert.equal(m.pickLeafLook('?leaf=nonsense'), m.DEFAULT_LEAF_LOOK);
  assert.ok(Object.hasOwn(m.LEAF_LOOKS, m.DEFAULT_LEAF_LOOK));
  assert.equal(m.LEAF_LOOKS.plain, null);
});

test('the desert plant leaf texture goes on every palm leaf material and takes the pattern colours, not the model blue', async () => {
  const m = await import('../src/surface-textures.js?leaf-ok');
  const asked = [];
  const loader = { loadAsync: async url => { asked.push(url); return new THREE.DataTexture(new Uint8Array(4), 1, 1); } };
  const make = name => new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ name, vertexColors: true }));
  const early = make('Waxy blue leaf tissue'), bark = make('Banded teal bark');
  m.applySurfaceTextures(Object.assign(new THREE.Group(), {}).add(early, bark), { photo: false });
  const texture = await m.loadLeafPhoto(loader, '/oasis/');
  assert.deepEqual(asked, ['/oasis/textures/alien_desert_plant/alien_desert_plant_leaf_albedo.png']);
  const look = m.LEAF_LOOKS[m.DEFAULT_LEAF_LOOK];
  assert.equal(early.material.map, texture);
  assert.equal(early.material.emissiveMap, texture);
  assert.equal(early.material.vertexColors, look.vertexColors);
  assert.equal(early.material.emissive.r, look.glow);
  assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
  assert.equal(texture.wrapS, THREE.MirroredRepeatWrapping);
  assert.notEqual(bark.material.map, texture, 'the trunk is left alone');
  const late = make('Waxy blue leaf tissue');
  m.applySurfaceTextures(late, { photo: false });
  assert.equal(late.material.map, texture, 'a palm loaded after the photo gets it straight away');
});

test('if the leaf texture cannot be loaded the drawn leaf stays', async () => {
  const m = await import('../src/surface-textures.js?leaf-fail');
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ name: 'Waxy blue leaf tissue' }));
  m.applySurfaceTextures(mesh, { photo: false });
  const warn = console.warn;
  console.warn = () => {};
  try { assert.equal(await m.loadLeafPhoto({ loadAsync: async () => { throw new Error('404'); } }), null); } finally { console.warn = warn; }
  assert.equal(mesh.material.map, m.surfaceTexture('leaf'));
});

test('the leaf texture file the palms borrow exists', async () => {
  const { statSync } = await import('node:fs');
  assert.ok(statSync(new URL('../public/textures/alien_desert_plant/alien_desert_plant_leaf_albedo.png', import.meta.url)).size > 100_000);
});
