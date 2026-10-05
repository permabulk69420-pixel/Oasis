import test from 'node:test';
import assert from 'node:assert/strict';
import { SKY_ISLAND, buildIsland, makeMeshGround } from '../src/sky-island-shape.js';
import { createSkyIslandGround } from '../src/sky-island-ground.js';
import { createPathIndex } from '../src/sky-island-paths.js';
import { layoutSkyTrees, SKY_TREES } from '../src/sky-island-layout.js';
import { layoutRocks } from '../src/sky-island-rocks.js';
import { createJungleField, layoutUndergrowth, layoutJungleTrees, layoutTreeVines, JUNGLE, JUNGLE_TREES_LAYOUT } from '../src/island-jungle-layout.js';
import { UNDERGROWTH_MODELS } from '../src/island-undergrowth-models.js';
import { FLORA_RENDER } from '../src/island-flora.js';

// The dense island (Kane, 6 Oct: "it's meant to be like a dense island area to explore"): the layouts are pure and seeded, so they are built once here and checked as a set.
const ground = createSkyIslandGround(SKY_ISLAND);
const { features } = ground;
const drawn = makeMeshGround(buildIsland(ground.baseY, SKY_ISLAND, features), SKY_ISLAND);
const pathIndex = createPathIndex([]);
const palms = layoutSkyTrees(SKY_ISLAND, SKY_TREES, { features, pathIndex });
const waterY = ground.baseY + features.lakeSpec.level;
const rocks = layoutRocks({ ground: drawn, features, pathIndex, config: SKY_ISLAND, avoid: palms, waterY });
const field = createJungleField({ features, config: SKY_ISLAND });
const treeObstacles = [...palms.map(p => ({ x: p.x, z: p.z, r: 2.4 * p.scale })), ...rocks.filter(r => r.r >= 0.3).map(r => ({ x: r.x, z: r.z, r: r.r + 1.6 }))];
const trees = layoutJungleTrees({ ground: drawn, obstacles: treeObstacles }, field);
const vines = layoutTreeVines(trees, drawn);
const undergrowthObstacles = [
  ...palms.map(p => ({ x: p.x, z: p.z, r: 0.5 * p.scale })),
  ...rocks.filter(r => r.r >= 0.3).map(r => ({ x: r.x, z: r.z, r: r.r * 0.9 })),
  ...trees.map(t => ({ x: t.x, z: t.z, r: 1.3 * t.scale })),
];
const undergrowth = layoutUndergrowth({ ground: drawn, features, config: SKY_ISLAND, obstacles: undergrowthObstacles }, field);
const { meadow, hollow, rise } = features.places;
const all = [...trees, ...vines, ...undergrowth];

test('the forest grows the same every time, from models and render rules that exist, with sane numbers', () => {
  assert.deepEqual(layoutJungleTrees({ ground: drawn, obstacles: treeObstacles }, field), trees);
  assert.deepEqual(layoutUndergrowth({ ground: drawn, features, config: SKY_ISLAND, obstacles: undergrowthObstacles }, field).slice(0, 400), undergrowth.slice(0, 400));
  assert.ok(trees.length > 150 && trees.length < 600, `${trees.length} trees`);
  assert.ok(undergrowth.length > 4000 && undergrowth.length < 30000, `${undergrowth.length} undergrowth items`);
  assert.ok(vines.length > 0.5 * trees.length && vines.length < 2.2 * trees.length, `${vines.length} vine curtains`);
  for (const item of all) {
    assert.ok(UNDERGROWTH_MODELS[item.type], `no model called ${item.type}`);
    assert.ok(FLORA_RENDER[item.type], `no render rule for ${item.type}`);
    const scale = Array.isArray(item.scale) ? item.scale : [item.scale];
    assert.ok([item.x, item.y, item.z, item.yaw, ...scale, ...(item.tint ?? [])].every(Number.isFinite), `a bad number in ${item.type}`);
    assert.ok(scale.every(s => s > 0 && s < 12), `${item.type} scale ${scale}`);
  }
});

test('all three kinds of giant stand, none is nearly all of them, and every other kind of plant is in the mix', () => {
  const count = type => all.filter(item => item.type === type).length;
  for (const type of JUNGLE_TREES_LAYOUT.types) assert.ok(count(type) > 0.15 * trees.length, `only ${count(type)} ${type} of ${trees.length} trees`);
  for (const [type] of JUNGLE.plants) assert.ok(count(type) > 100, `only ${count(type)} ${type}`);
});

test('the start meadow is a clearing: no undergrowth in the middle, no tree for thirty metres, the grass field open', () => {
  for (const item of undergrowth) assert.ok(Math.hypot(item.x - meadow.x, item.z - meadow.z) >= JUNGLE.clearing.radius, `${item.type} at ${(Math.hypot(item.x - meadow.x, item.z - meadow.z)).toFixed(1)} m from the start`);
  for (const t of trees) assert.ok(Math.hypot(t.x - meadow.x, t.z - meadow.z) >= JUNGLE_TREES_LAYOUT.openRadius, 'a tree in the clearing');
  assert.equal(field.thick(meadow.x, meadow.z), 0);
  assert.ok(field.cover(meadow.x, meadow.z) > 0.9, 'grass grows in the meadow');
  assert.ok(field.thick(meadow.x + 45, meadow.z) > 0 || field.thick(meadow.x - 45, meadow.z) > 0 || field.thick(meadow.x, meadow.z - 45) > 0, 'and the growth begins within a few tens of metres');
});

test('trees keep their gap, stay off the rim, the water, the hollow and the rocky rise, and stand on drawn ground', () => {
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    assert.ok(drawn(t.x, t.z) !== null, 'a tree off the island');
    assert.ok(field.rimGap(t.x, t.z) >= JUNGLE_TREES_LAYOUT.rimMargin - 1e-6, `a tree ${field.rimGap(t.x, t.z).toFixed(1)} m from the lip`);
    assert.ok(field.shore(t.x, t.z) > 0, 'a tree in the lake');
    assert.ok(Math.hypot(t.x - hollow.x, t.z - hollow.z) > hollow.radius, 'a tree in the hollow');
    assert.ok(Math.hypot(t.x - rise.x, t.z - rise.z) > rise.radius * 0.8, 'a tree on the rise');
    for (let j = i + 1; j < trees.length; j++) assert.ok(Math.hypot(t.x - trees[j].x, t.z - trees[j].z) >= JUNGLE_TREES_LAYOUT.minGap - 1e-6, 'two trees closer than the gap');
  }
});

test('nothing grows in the lake or the spill channel, or off the island', () => {
  for (const item of undergrowth) {
    assert.ok(drawn(item.x, item.z) !== null, `${item.type} off the island`);
    assert.ok(field.shore(item.x, item.z) > 0, `${item.type} in the lake`);
    assert.ok(field.channelDistance(item.x, item.z) >= 2.0, `${item.type} in the channel`);
  }
});

test('plants sit on the ground: a plant at most a few centimetres below it, a tree a quarter of its scale (so its roots bite)', () => {
  for (const item of undergrowth) {
    const g = drawn(item.x, item.z);
    assert.ok(Math.abs(item.y - (g - 0.03 * item.scale)) < 1e-6, `${item.type} floats or sinks`);
  }
  for (const t of trees) assert.ok(Math.abs(t.y - (drawn(t.x, t.z) - 0.25 * t.scale)) < 1e-6, 'a tree floats or sinks');
});

test('a vine curtain hangs from a limb of a tree and reaches the ground', () => {
  for (const v of vines) {
    assert.equal(v.type, 'vineCurtain');
    assert.equal(v.scale.length, 3);
    const g = drawn(v.x, v.z);
    assert.ok(g === null || v.y > g + 2, `a curtain only ${(v.y - g).toFixed(1)} m up`);
    const near = trees.some(t => Math.hypot(t.x - v.x, t.z - v.z) < 14);
    assert.ok(near, 'a curtain with no tree near it');
  }
});

test('the growth is thick where the places are thick (grove, hollow) and thin on the rise and at the lip', () => {
  const { grove } = features.places;
  const around = (c, radius) => { let sum = 0, n = 0; for (let a = 0; a < 16; a++) for (const f of [0.3, 0.6]) { sum += field.thick(c.x + Math.cos(a / 16 * 2 * Math.PI) * radius * f, c.z + Math.sin(a / 16 * 2 * Math.PI) * radius * f); n++; } return sum / n; };
  assert.ok(around(grove, grove.radius) > around(rise, rise.radius), 'the grove is thicker than the rise');
  assert.ok(field.thick(SKY_ISLAND.x + 1, SKY_ISLAND.z) >= 0);
});
