import test from 'node:test';
import assert from 'node:assert/strict';
import { SKY_ISLAND, buildIsland, topGround, outlineRadius } from '../src/sky-island-shape.js';
import { layoutSkyTrees, SKY_TREES } from '../src/sky-island-layout.js';

const BASE = 270;
const mesh = buildIsland(BASE);

test('the island mesh is well formed: finite numbers, indices in range, unit normals', () => {
  for (const value of mesh.positions) assert.ok(Number.isFinite(value));
  for (const index of mesh.indices) assert.ok(index < mesh.vertexCount);
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const length = Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]);
    assert.ok(Math.abs(length - 1) < 1e-3);
  }
  assert.equal(mesh.vertexCount * 3, mesh.positions.length);
});

test('the island is a closed solid whose faces point out', () => {
  const edges = new Map();
  const add = (a, b) => { const key = a < b ? `${a}_${b}` : `${b}_${a}`; const e = edges.get(key) || { forward: 0, back: 0 }; if (a < b) e.forward++; else e.back++; edges.set(key, e); };
  const idx = mesh.indices;
  for (let f = 0; f < idx.length; f += 3) { add(idx[f], idx[f + 1]); add(idx[f + 1], idx[f + 2]); add(idx[f + 2], idx[f]); }
  for (const [key, e] of edges) assert.ok(e.forward === 1 && e.back === 1, `edge ${key} is not shared by exactly two faces going opposite ways`);
  // signed volume is positive when the faces point outward
  const p = mesh.positions;
  let volume = 0;
  for (let f = 0; f < idx.length; f += 3) {
    const a = idx[f] * 3, b = idx[f + 1] * 3, c = idx[f + 2] * 3;
    volume += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  assert.ok(volume > 0, 'faces point inwards');
});

test('the island is about the size the notes say, and hangs as an upside-down mountain', () => {
  const p = mesh.positions;
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < p.length; i += 3) { minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]); minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1]); }
  assert.ok(maxX - minX > 380 && maxX - minX < 620, `width ${maxX - minX}`);
  assert.ok(maxY < BASE + SKY_ISLAND.relief + SKY_ISLAND.dome + 1);
  assert.ok(BASE - minY > SKY_ISLAND.thickness * 0.8 && BASE - minY < SKY_ISLAND.thickness * 1.3, `depth ${BASE - minY}`);
});

test('the top is ground you can stand on, and the mesh agrees with the function', () => {
  assert.ok(topGround(SKY_ISLAND.x, SKY_ISLAND.z) !== null);
  assert.equal(topGround(SKY_ISLAND.x + 900, SKY_ISLAND.z), null);
  for (let a = 0; a < 360; a += 30) {
    const theta = a * Math.PI / 180;
    const r = outlineRadius(theta);
    assert.ok(r > SKY_ISLAND.radius * 0.7 && r < SKY_ISLAND.radius * 1.3);
    assert.equal(topGround(SKY_ISLAND.x + Math.cos(theta) * (r + 2), SKY_ISLAND.z + Math.sin(theta) * (r + 2)), null);
  }
  // vertices on the top rings sit exactly on the function
  const ring = 40, around = SKY_ISLAND.around;
  for (let j = 0; j < around; j += 37) {
    const v = 1 + (ring - 1) * around + j;
    const x = mesh.positions[v * 3], y = mesh.positions[v * 3 + 1], z = mesh.positions[v * 3 + 2];
    assert.ok(Math.abs(y - (BASE + topGround(x, z))) < 1e-3);
  }
});

test('the palms are laid out the same every time, on the top, apart from each other and clear of the middle', () => {
  const a = layoutSkyTrees(), b = layoutSkyTrees();
  assert.deepEqual(a, b);
  assert.ok(a.length > 40);
  for (const [i, tree] of a.entries()) {
    assert.ok(topGround(tree.x, tree.z) !== null);
    assert.ok(Math.hypot(tree.x - SKY_ISLAND.x, tree.z - SKY_ISLAND.z) >= SKY_TREES.clearing);
    for (let k = i + 1; k < a.length; k++) assert.ok(Math.hypot(tree.x - a[k].x, tree.z - a[k].z) >= SKY_TREES.spacing - 1e-6);
  }
});
