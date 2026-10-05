import test from 'node:test';
import assert from 'node:assert/strict';
import { SKY_ISLAND, buildIsland, makeMeshGround, outlineRadius } from '../src/sky-island-shape.js';
import { createSkyIslandGround } from '../src/sky-island-ground.js';
import { layoutPaths, createPathIndex } from '../src/sky-island-paths.js';
import { layoutSkyTrees, SKY_TREES } from '../src/sky-island-layout.js';
import { layoutRocks, buildRocks, ROCKS } from '../src/sky-island-rocks.js';

const ground = createSkyIslandGround(SKY_ISLAND);
const { features } = ground;
const { lake, places } = features;
const drawn = makeMeshGround(buildIsland(ground.baseY, SKY_ISLAND, features), SKY_ISLAND);
const pathIndex = createPathIndex(layoutPaths(features, SKY_ISLAND));
const palms = layoutSkyTrees(SKY_ISLAND, SKY_TREES, { features, pathIndex });
const level = ground.baseY + features.lakeSpec.level; // the lake's surface in world metres
const ctx = { ground: drawn, features, pathIndex, config: SKY_ISLAND, avoid: palms, waterY: level };
const items = layoutRocks(ctx);
const rimGap = (x, z) => outlineRadius(Math.atan2(z - SKY_ISLAND.z, x - SKY_ISLAND.x), SKY_ISLAND) - SKY_ISLAND.lip - Math.hypot(x - SKY_ISLAND.x, z - SKY_ISLAND.z);

test('the stone is laid out the same every time, a few hundred pieces in every place', () => {
  assert.deepEqual(layoutRocks(ctx), items);
  assert.ok(items.length > 280 && items.length < 520, `${items.length} stones`);
  const places6 = new Set(items.map(item => item.place));
  for (const name of ['meadow', 'lake', 'grove', 'rise', 'rim', 'hollow']) assert.ok(places6.has(name), `no stone at the ${name}`);
  for (const item of items) for (const key of ['x', 'y', 'z', 'r']) assert.ok(Number.isFinite(item[key]), `${key} of a stone is ${item[key]}`);
});

test('every stone stands on the top, back from the rim, and none sits on the meadow, a path or a palm', () => {
  for (const item of items) {
    assert.ok(drawn(item.x, item.z) !== null, `a stone is off the top at (${item.x.toFixed(0)}, ${item.z.toFixed(0)})`);
    if (item.type === 'column') continue;
    assert.ok(rimGap(item.x, item.z) >= item.r + 3, `a stone is ${rimGap(item.x, item.z).toFixed(1)} m from the rim (r ${item.r.toFixed(1)})`);
    assert.ok(Math.hypot(item.x - places.meadow.x, item.z - places.meadow.z) >= places.meadow.radius, `a stone is on the meadow at (${item.x.toFixed(0)}, ${item.z.toFixed(0)})`);
    if (!item.stepping && item.place !== 'hollow') {
      assert.ok(pathIndex.clearance(item.x, item.z) >= Math.min(item.r * 0.8 + 0.4, 1.2) - 0.35, `a stone is on a path at (${item.x.toFixed(0)}, ${item.z.toFixed(0)}), r ${item.r.toFixed(1)}`);
    }
    for (const p of palms) assert.ok(Math.hypot(p.x - item.x, p.z - item.z) > 0.8 || item.r < 0.2, 'a stone is inside a palm trunk');
  }
});

test('stones in the lake are outcrops that stand clear of the water, and the stepping stones cross the outflow', () => {
  const inWater = items.filter(item => item.type === 'boulder' && lake.signed(item.x, item.z) > item.r);
  const clear = inWater.filter(item => item.y + item.half[1] * 0.95 >= level + 0.45);
  assert.ok(clear.length >= 3, `${clear.length} outcrops stand clear of the water`);
  // the three big outcrops are asked to stand at least 0.9 m clear (the lake's height has to be in world metres for that to mean anything)
  const big = inWater.filter(item => item.r >= 1.5);
  assert.ok(big.length >= 3, `${big.length} big outcrops`);
  for (const item of big) assert.ok(item.y + item.half[1] * 0.95 >= level + 0.9 - 1e-6, `an outcrop stands ${(item.y + item.half[1] * 0.95 - level).toFixed(2)} m clear`);
  for (const item of clear) assert.ok(item.y + item.half[1] * 0.95 < level + 4, 'an outcrop is a boulder, not a tower');
  const steps = items.filter(item => item.stepping);
  assert.ok(steps.length >= 5, `${steps.length} stepping stones`);
  for (let i = 1; i < steps.length; i++) assert.ok(Math.hypot(steps[i].x - steps[i - 1].x, steps[i].z - steps[i - 1].z) < 2.0, 'the stepping stones are within a stride');
  for (const step of steps) assert.ok(step.y + step.half[1] > ground.baseY + features.lakeSpec.level - 1.5, 'a stepping stone is under the stream');
});

test('the spire on the rise is the tall landmark, with a lookout ledge and a roof over the hollow', () => {
  const columns = items.filter(item => item.type === 'column');
  assert.ok(columns.length >= 4 && columns.length <= 7);
  const tallest = Math.max(...columns.map(column => column.height));
  assert.equal(tallest, ROCKS.spire.height);
  const spire = columns.find(column => column.height === tallest);
  assert.ok(Math.hypot(spire.x - places.rise.summit.x, spire.z - places.rise.summit.z) < 1, 'the spire stands on the summit');
  const ledge = items.find(item => item.type === 'boulder' && item.half[0] > 4.5 && item.place === 'rise');
  assert.ok(ledge && Math.hypot(ledge.x - places.rise.ledge.x, ledge.z - places.rise.ledge.z) < 1, 'the ledge is where the rise says');
  const roof = items.find(item => item.place === 'hollow' && item.half[0] > 4.5);
  assert.ok(roof && roof.y - drawn(places.hollow.x, places.hollow.z) > 2.5, 'the hollow has a roof overhead');
});

test('the stone builds to a few meshes within its triangle budget, with sound normals', () => {
  const data = buildRocks(items);
  assert.ok(data.triangles <= ROCKS.maxTriangles, `${data.triangles} triangles`);
  assert.ok(data.triangles > 20000, `${data.triangles} triangles is too little stone to look like a place`);
  assert.ok(data.chunks.length >= 4 && data.chunks.length <= 14, `${data.chunks.length} chunks`);
  let total = 0;
  for (const chunk of data.chunks) {
    total += chunk.triangles;
    assert.ok(chunk.triangles < 30000, `chunk ${chunk.name} has ${chunk.triangles} triangles`);
    assert.equal(chunk.positions.length, chunk.triangles * 9);
    assert.equal(chunk.normals.length, chunk.positions.length);
    assert.equal(chunk.colors.length, chunk.positions.length);
    assert.equal(chunk.zones.length, chunk.positions.length);
    for (let i = 0; i < chunk.positions.length; i++) assert.ok(Number.isFinite(chunk.positions[i]));
    for (let i = 0; i < chunk.normals.length; i += 3) {
      const length = Math.hypot(chunk.normals[i], chunk.normals[i + 1], chunk.normals[i + 2]);
      assert.ok(Math.abs(length - 1) < 1e-3, `normal ${i / 3} has length ${length}`);
    }
    // the island-stone marker the terrain shader reads: a negative salt channel
    for (let i = 1; i < chunk.zones.length; i += 3) assert.ok(chunk.zones[i] <= 0 && chunk.zones[i] >= -1.0001);
    assert.ok(chunk.bounds.maxX - chunk.bounds.minX < ROCKS.cell + 60, 'a chunk spans a place, not the island');
  }
  assert.equal(total, data.triangles);
});
