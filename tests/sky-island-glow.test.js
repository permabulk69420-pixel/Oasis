import test from 'node:test';
import assert from 'node:assert/strict';
import { SKY_ISLAND, buildIsland, makeMeshGround, outlineRadius } from '../src/sky-island-shape.js';
import { createSkyIslandGround, ISLAND_START } from '../src/sky-island-ground.js';
import { layoutPaths, createPathIndex } from '../src/sky-island-paths.js';
import { layoutSkyTrees, SKY_TREES } from '../src/sky-island-layout.js';
import { layoutRocks } from '../src/sky-island-rocks.js';
import { layoutIslandGlow, ISLAND_GLOW } from '../src/sky-island-glow.js';

const ground = createSkyIslandGround(SKY_ISLAND);
const { features } = ground;
const drawn = makeMeshGround(buildIsland(ground.baseY, SKY_ISLAND, features), SKY_ISLAND);
const paths = layoutPaths(features, SKY_ISLAND);
const pathIndex = createPathIndex(paths);
const palms = layoutSkyTrees(SKY_ISLAND, SKY_TREES, { features, pathIndex });
const rocks = layoutRocks({ ground: drawn, features, pathIndex, config: SKY_ISLAND, avoid: palms });
const obstacles = [...rocks.filter(r => r.r >= 0.3), ...palms.map(p => ({ x: p.x, z: p.z, r: 0.7 * p.scale }))];
const make = () => layoutIslandGlow({ ground: drawn, features, pathIndex, paths, obstacles, config: SKY_ISLAND });
const items = make();

test('the glow is laid out the same every time, with reeds at the water and blooms at every place', () => {
  assert.deepEqual(make(), items);
  const by = {};
  for (const item of items) by[`${item.kind}:${item.place}`] = (by[`${item.kind}:${item.place}`] || 0) + 1;
  assert.ok(by['reed:lake'] >= 30, JSON.stringify(by));
  for (const place of ['lake', 'grove', 'meadow', 'rise', 'rim', 'hollow', 'path']) assert.ok(by[`lantern:${place}`] >= 4, `${place}: ${by[`lantern:${place}`]}`);
  assert.ok(items.length > 90 && items.length < 200, `${items.length} plants`);
});

test('reeds stand in the shallows and on the shore; blooms on dry ground; none on the meadow, a path, a stone, a palm, the channel or the rim', () => {
  const { lake, places, channel } = features;
  for (const item of items) {
    const s = lake.signed(item.x, item.z);
    if (item.kind === 'reed') assert.ok(s > -2.7 && s < 1.7, `a reed ${s.toFixed(1)} m in`);
    else assert.ok(s <= -1 + 1e-6, 'a bloom in the water');
    if (item.place !== 'meadow') assert.ok(Math.hypot(item.x - places.meadow.x, item.z - places.meadow.z) >= places.meadow.radius, 'on the meadow');
    assert.ok(pathIndex.clearance(item.x, item.z) >= ISLAND_GLOW.pathClear - 1e-6, 'on a path');
    for (const o of obstacles) assert.ok(Math.hypot(o.x - item.x, o.z - item.z) >= o.r + 0.7 - 1e-6, 'in a stone or a palm');
    const dx = channel.bx - channel.ax, dz = channel.bz - channel.az;
    const t = Math.max(0, Math.min(1, ((item.x - channel.ax) * dx + (item.z - channel.az) * dz) / (dx * dx + dz * dz)));
    assert.ok(Math.hypot(item.x - (channel.ax + dx * t), item.z - (channel.az + dz * t)) >= 3.2 - 1e-6, 'in the channel');
    const edge = outlineRadius(Math.atan2(item.z - SKY_ISLAND.z, item.x - SKY_ISLAND.x), SKY_ISLAND) - SKY_ISLAND.lip;
    assert.ok(edge - Math.hypot(item.x - SKY_ISLAND.x, item.z - SKY_ISLAND.z) >= 5 - 1e-6, 'on the rim');
  }
  const ring = items.filter(i => i.place === 'meadow');
  for (const item of ring) {
    const d = Math.hypot(item.x - ISLAND_START.x, item.z - ISLAND_START.z);
    assert.ok(d >= places.meadow.radius && d < 70, `a ring bloom ${d.toFixed(0)} m from the start`);
  }
});

test('the plants keep their distance from each other and stand on gentle ground', () => {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      assert.ok(Math.hypot(items[i].x - items[j].x, items[i].z - items[j].z) >= Math.min(ISLAND_GLOW.reed.spacing, ISLAND_GLOW.lantern.spacing) - 1e-6);
    }
    const s = (drawn(items[i].x + 1, items[i].z) - drawn(items[i].x - 1, items[i].z)) / 2;
    assert.ok(Math.abs(s) < 1.2, `slope ${s.toFixed(2)}`);
  }
});
