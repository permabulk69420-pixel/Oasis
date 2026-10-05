import test from 'node:test';
import assert from 'node:assert/strict';
import { SKY_ISLAND, buildIsland, topGround, outlineRadius } from '../src/sky-island-shape.js';
import { ISLAND_START, createSkyIslandGround } from '../src/sky-island-ground.js';
import { terrainHeight, SPAWN, noise, smooth } from '../src/world.js';
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

test('the island ground reads the same numbers as the mesh', () => {
  const ground = createSkyIslandGround();
  assert.equal(ground.baseY, terrainHeight(SKY_ISLAND.x, SKY_ISLAND.z) + SKY_ISLAND.altitude);
  assert.equal(ground.groundHeight(SKY_ISLAND.x, SKY_ISLAND.z), ground.baseY + topGround(SKY_ISLAND.x, SKY_ISLAND.z));
  assert.equal(ground.groundHeight(SKY_ISLAND.x + 5000, SKY_ISLAND.z), null);
});

test('the island start is open, level, high and well away from the edge, every palm and the oasis start', () => {
  const { x, z } = ISLAND_START;
  assert.ok(topGround(x, z) !== null);
  let slope = 0;
  for (let a = 0; a < Math.PI * 2; a += 0.4) for (const r of [1, 2, 4]) {
    const h = topGround(x + Math.cos(a) * r, z + Math.sin(a) * r);
    assert.ok(h !== null);
    slope = Math.max(slope, Math.abs(h - topGround(x, z)) / r);
  }
  assert.ok(slope < 0.04, `the start's ground is level enough for the tools to stand on (${slope.toFixed(3)})`);
  const edge = outlineRadius(Math.atan2(z - SKY_ISLAND.z, x - SKY_ISLAND.x));
  assert.ok(edge - Math.hypot(x - SKY_ISLAND.x, z - SKY_ISLAND.z) > 60, 'a good walk from the edge');
  for (const tree of layoutSkyTrees()) assert.ok(Math.hypot(tree.x - x, tree.z - z) > 30, 'no palm on top of the tools');
  // the starting tools sit within a few metres of the start and must be on the top, too
  for (const [dx, dz] of [[-0.85, -1.05], [0.75, -1.05], [-2.0, -1.25], [-3.1, -1.0], [2.0, -1.35]]) {
    assert.ok(topGround(x + dx - 0, z + dz) !== null);
  }
  assert.ok(Math.hypot(x - SPAWN.x, z - SPAWN.z) > 500, 'far from the oasis start');
  assert.equal(ISLAND_START.yaw, 0, 'faces -z like the oasis start, so the sky sits where it always has');
});

test('the island start is on grass, not on a rock patch', () => {
  const { x, z } = ISLAND_START;
  for (let a = 0; a < Math.PI * 2; a += 0.5) for (const r of [0, 10, 20]) {
    const v = smooth(0.70, 0.82, noise((x + Math.cos(a) * r) / 42 + 7, (z + Math.sin(a) * r) / 42 - 5));
    assert.ok(v < 0.05, 'grass all round the tools');
  }
});
