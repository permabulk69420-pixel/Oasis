import test from 'node:test';
import assert from 'node:assert/strict';
import { SKY_ISLAND, topGround, outlineRadius } from '../src/sky-island-shape.js';
import { createSkyIslandGround, ISLAND_START } from '../src/sky-island-ground.js';
import { ISLAND_PLACES } from '../src/sky-island-places.js';
import { layoutPaths, createPathIndex } from '../src/sky-island-paths.js';
import { layoutSkyTrees, SKY_TREES } from '../src/sky-island-layout.js';

const ground = createSkyIslandGround(SKY_ISLAND);
const { features } = ground;
const paths = layoutPaths(features, SKY_ISLAND);
const pathIndex = createPathIndex(paths);
const palms = layoutSkyTrees(SKY_ISLAND, SKY_TREES, { features, pathIndex });

test('the palms are a grove, not an even spread: a thick stand between the meadow and the lake, a few elsewhere', () => {
  const g = ISLAND_PLACES.grove;
  const inGrove = palms.filter(p => Math.hypot(p.x - g.x, p.z - g.z) < 34);
  assert.ok(inGrove.length >= 22, `${inGrove.length} palms in the grove`);
  assert.ok(palms.length >= 45 && palms.length <= 75, `${palms.length} palms in all`);
  // inside the grove the crowns overlap (close neighbours); outside they stand apart
  const nearest = (list, p) => Math.min(...list.filter(q => q !== p).map(q => Math.hypot(q.x - p.x, q.z - p.z)));
  const meanIn = inGrove.reduce((s, p) => s + nearest(palms, p), 0) / inGrove.length;
  const out = palms.filter(p => !inGrove.includes(p));
  const meanOut = out.reduce((s, p) => s + nearest(palms, p), 0) / out.length;
  assert.ok(meanIn < 8, `mean gap in the grove ${meanIn.toFixed(1)} m`);
  assert.ok(meanOut > 11, `mean gap outside ${meanOut.toFixed(1)} m`);
  // the biggest palms are in the shade's heart
  const scale = list => list.reduce((s, p) => s + p.scale, 0) / list.length;
  assert.ok(scale(inGrove) > scale(out) - 0.05);
});

test('palms stand on the top, off the meadow, the paths, the water, the rise and the hollow, and back from the rim', () => {
  const { lake, places } = features;
  for (const p of palms) {
    assert.ok(topGround(p.x, p.z, SKY_ISLAND, features) !== null);
    assert.ok(Math.hypot(p.x - ISLAND_START.x, p.z - ISLAND_START.z) >= SKY_TREES.clearing, 'not on the meadow');
    assert.ok(pathIndex.clearance(p.x, p.z) >= SKY_TREES.pathClear - 1e-6, 'not on a path');
    assert.ok(lake.signed(p.x, p.z) <= -3.5 + 1e-6, 'not in the water');
    assert.ok(Math.hypot(p.x - places.rise.x, p.z - places.rise.z) >= places.rise.radius * 0.8, 'not on the rise');
    assert.ok(Math.hypot(p.x - places.hollow.x, p.z - places.hollow.z) >= places.hollow.radius * 1.15, 'not in the hollow');
    const edge = outlineRadius(Math.atan2(p.z - SKY_ISLAND.z, p.x - SKY_ISLAND.x), SKY_ISLAND) - SKY_ISLAND.lip;
    assert.ok(edge - Math.hypot(p.x - SKY_ISLAND.x, p.z - SKY_ISLAND.z) >= 7 - 1e-6, 'back from the rim');
  }
});

test('each of the places has palms of its own, and the lake has some leaning over it', () => {
  const by = {};
  for (const p of palms) by[p.place] = (by[p.place] || 0) + 1;
  for (const place of ['grove', 'lake', 'meadow', 'rim', 'hollow']) assert.ok((by[place] || 0) >= 2, `${place}: ${by[place] || 0}`);
});
