import test from 'node:test';
import assert from 'node:assert/strict';
import { ISLAND_GRASS, makeGrassChunk, grassKeep, createIslandGrass } from '../src/island-grass.js';

// A flat island 100 m across, grass everywhere inside it.
const ground = (x, z) => (Math.hypot(x, z) < 50 ? 10 + 0.01 * x : null);
const cover = (x, z) => (Math.hypot(x, z) < 50 ? 1 : 0);
const field = { ground, cover, thick: () => 0.5 };

test('a chunk of grass is made once from a seed: the same patches every time, on the ground, inside the chunk', () => {
  const a = makeGrassChunk(0, 0, field), b = makeGrassChunk(0, 0, field);
  assert.deepEqual(a, b);
  assert.ok(a.count > 20 && a.count <= Math.pow(Math.round(ISLAND_GRASS.chunk / ISLAND_GRASS.cell), 2), `${a.count} patches`);
  assert.equal(a.matrices.length, a.count * 16);
  assert.equal(a.colours.length, a.count * 3);
  assert.equal(a.hash.length, a.count);
  for (let k = 0; k < a.count; k++) {
    const x = a.matrices[k * 16 + 12], y = a.matrices[k * 16 + 13], z = a.matrices[k * 16 + 14];
    assert.ok(x >= 0 && x <= ISLAND_GRASS.chunk && z >= 0 && z <= ISLAND_GRASS.chunk, 'inside its chunk');
    assert.ok(Math.abs(y - (ground(x, z) + 0.01)) < 1e-3, 'on the ground');
    assert.ok(a.hash[k] >= 0 && a.hash[k] <= 1);
    assert.ok([...a.colours.subarray(k * 3, k * 3 + 3)].every(c => c > 0 && c < 1), 'a colour');
  }
  assert.notDeepEqual(makeGrassChunk(1, 0, field).matrices.slice(0, 16), a.matrices.slice(0, 16), 'another chunk is another set of patches');
});

test('no grass where none grows, or off the ground', () => {
  assert.equal(makeGrassChunk(20, 20, field).count, 0, 'far off the island');
  assert.equal(makeGrassChunk(0, 0, { ground, cover: () => 0, thick: () => 0.5 }).count, 0, 'cover zero');
});

test('thicker growth is taller and darker', () => {
  const thin = makeGrassChunk(0, 0, { ground, cover, thick: () => 0 }), thick = makeGrassChunk(0, 0, { ground, cover, thick: () => 1 });
  const mean = (c, offset) => { let s = 0; for (let k = 0; k < c.count; k++) s += c.matrices[k * 16 + offset]; return s / c.count; };
  assert.ok(mean(thick, 5) > mean(thin, 5) * 1.2, 'taller (the y scale is the matrix element 5)');
  const green = c => { let s = 0; for (let k = 0; k < c.count; k++) s += c.colours[k * 3 + 1]; return s / c.count; };
  assert.ok(green(thick) < green(thin), 'darker');
});

test('the share of patches kept falls from one at the near edge to nothing at the far edge, smoothly', () => {
  assert.equal(grassKeep(0), 1);
  assert.equal(grassKeep(ISLAND_GRASS.fullTo), 1);
  assert.equal(grassKeep(ISLAND_GRASS.thinTo), 0);
  assert.equal(grassKeep(ISLAND_GRASS.thinTo + 50), 0);
  let last = 1;
  for (let d = ISLAND_GRASS.fullTo; d <= ISLAND_GRASS.thinTo; d += 1) { const k = grassKeep(d); assert.ok(k <= last + 1e-9, 'never rises'); last = k; }
  assert.ok(ISLAND_GRASS.rich <= ISLAND_GRASS.thinTo, 'the rich blades are the near ones');
});

test('the grass fills the two instanced meshes round you, rich near and lite further out, and stays inside their capacity', () => {
  const grass = createIslandGrass({ ground, cover, thick: () => 0.5 });
  assert.equal(grass.group.children.length, 2);
  assert.equal(grass.update(0, 0, true), true);
  const [rich, lite] = grass.group.children;
  assert.ok(rich.count > 200 && rich.count <= ISLAND_GRASS.maxRich, `${rich.count} rich patches`);
  assert.ok(lite.count > 100 && lite.count <= ISLAND_GRASS.maxLite, `${lite.count} lite patches`);
  // every rich patch is within the rich radius of where we stand, every lite one beyond it
  for (let k = 0; k < rich.count; k++) assert.ok(Math.hypot(rich.instanceMatrix.array[k * 16 + 12], rich.instanceMatrix.array[k * 16 + 14]) < ISLAND_GRASS.rich + 1e-3);
  for (let k = 0; k < lite.count; k++) assert.ok(Math.hypot(lite.instanceMatrix.array[k * 16 + 12], lite.instanceMatrix.array[k * 16 + 14]) >= ISLAND_GRASS.rich - 1e-3);
  assert.equal(grass.update(0.5, 0), false, 'a step of half a metre does not rebuild');
  assert.equal(grass.update(30, 0), true, 'a few metres does');
  grass.dispose?.();
});
