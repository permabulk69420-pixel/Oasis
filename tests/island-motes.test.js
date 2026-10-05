import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SKY_ISLAND, buildIsland, makeMeshGround } from '../src/sky-island-shape.js';
import { createSkyIslandGround } from '../src/sky-island-ground.js';
import { layoutPaths, createPathIndex } from '../src/sky-island-paths.js';
import { layoutSkyTrees, SKY_TREES } from '../src/sky-island-layout.js';
import { layoutRocks } from '../src/sky-island-rocks.js';
import { layoutIslandGlow } from '../src/sky-island-glow.js';
import { layoutIslandFlora } from '../src/island-flora-layout.js';
import { ISLAND_MOTES, layoutSeedPuffs, layoutGlowFlies, nightAmount, createIslandMotes } from '../src/island-motes.js';

const ground = createSkyIslandGround(SKY_ISLAND);
const { features } = ground;
const drawn = makeMeshGround(buildIsland(ground.baseY, SKY_ISLAND, features), SKY_ISLAND);
const paths = layoutPaths(features, SKY_ISLAND);
const pathIndex = createPathIndex(paths);
const palms = layoutSkyTrees(SKY_ISLAND, SKY_TREES, { features, pathIndex });
const rocks = layoutRocks({ ground: drawn, features, pathIndex, config: SKY_ISLAND, avoid: palms });
const glow = layoutIslandGlow({ ground: drawn, features, pathIndex, paths, config: SKY_ISLAND, obstacles: [...rocks.filter(r => r.r >= 0.3), ...palms.map(p => ({ x: p.x, z: p.z, r: 0.7 * p.scale }))] });
const items = layoutIslandFlora({
  ground: drawn, features, pathIndex, paths, config: SKY_ISLAND, rocks, waterY: ground.baseY + features.lakeSpec.level,
  obstacles: [...palms.map(p => ({ x: p.x, z: p.z, r: 0.7 * p.scale })), ...glow.map(g => ({ x: g.x, z: g.z, r: 0.5 * g.scale, soft: true }))],
});
const flowers = items.filter(i => i.type === 'flower');
const level = ground.baseY + features.lakeSpec.level;
const { lake } = features;
const P = ISLAND_MOTES.puffs, F = ISLAND_MOTES.flies;

test('every flower lets go of a few puffs, from its own head, and nothing else does', () => {
  const puffs = layoutSeedPuffs(flowers);
  assert.equal(puffs.count, flowers.length * P.perFlower);
  assert.ok(puffs.count >= 120 && puffs.count <= 320, `${puffs.count} puffs: a drift, not a blizzard`);
  flowers.forEach((flower, f) => {
    for (let k = 0; k < P.perFlower; k++) {
      const i = f * P.perFlower + k;
      const x = puffs.positions[i * 3], y = puffs.positions[i * 3 + 1], z = puffs.positions[i * 3 + 2];
      assert.ok(Math.hypot(x - flower.x, z - flower.z) <= 0.35 * flower.scale + 1e-4, 'a puff off its flower');
      assert.ok(y >= flower.y + P.leave[0] * flower.scale - 1e-4 && y <= flower.y + P.leave[1] * flower.scale + 1e-4, `starts ${(y - flower.y).toFixed(2)} m up`);
    }
  });
});

test('puffs are the same every time, a different seed moves them, and every number stays in its table', () => {
  const a = layoutSeedPuffs(flowers), b = layoutSeedPuffs(flowers);
  assert.deepEqual(Array.from(a.positions), Array.from(b.positions));
  assert.notDeepEqual(Array.from(layoutSeedPuffs(flowers, { seed: ISLAND_MOTES.seed + 5 }).positions), Array.from(a.positions));
  for (let i = 0; i < a.count; i++) {
    assert.ok(a.seeds[i] >= 0 && a.seeds[i] < 1);
    assert.ok(a.drifts[i] >= P.drift[0] - 1e-4 && a.drifts[i] <= P.drift[1] + 1e-4);
    assert.ok(a.rises[i] >= P.rise[0] - 1e-4 && a.rises[i] <= P.rise[1] + 1e-4);
    assert.ok(a.sizes[i] >= P.size[0] - 1e-6 && a.sizes[i] <= P.size[1] + 1e-6);
  }
  assert.equal(layoutSeedPuffs([]).count, 0);
});

test('puffs come from every part of the island that has flowers, so some always drift over the meadow', () => {
  const meadow = items.filter(i => i.type === 'flower' && i.place === 'meadow').length;
  assert.ok(meadow >= 12, `${meadow} flowers round the meadow`);
  const places = new Set(flowers.map(flower => flower.place));
  assert.ok(places.size >= 3);
});

test('the glow-flies hover over the lake and its banks, apart from each other, at a height you can see them', () => {
  const flies = layoutGlowFlies(lake, level, { ground: drawn });
  assert.equal(flies.count, F.count);
  for (let i = 0; i < flies.count; i++) {
    const x = flies.positions[i * 3], y = flies.positions[i * 3 + 1], z = flies.positions[i * 3 + 2];
    assert.ok(lake.signed(x, z) >= F.inland - 1e-6, `a fly ${lake.signed(x, z).toFixed(1)} m out`);
    assert.ok(y - level >= F.height[0] - 1e-4 && y - level <= F.height[1] + 1.5, `a fly ${(y - level).toFixed(2)} m above the water`);
    const under = drawn(x, z);
    assert.ok(under === null || y - under >= F.clearance + 0.22 * flies.reaches[i] - 1e-4, `a fly ${(y - under).toFixed(2)} m above the ground, in the bank when its loop dips`);
    assert.ok(flies.reaches[i] >= F.reach[0] - 1e-6 && flies.reaches[i] <= F.reach[1] + 1e-6);
    assert.ok(flies.rates[i] >= F.rate[0] - 1e-6 && flies.rates[i] <= F.rate[1] + 1e-6);
    assert.ok(flies.pulses[i] >= F.pulse[0] - 1e-6 && flies.pulses[i] <= F.pulse[1] + 1e-6);
    for (let j = 0; j < i; j++) assert.ok(Math.hypot(x - flies.positions[j * 3], z - flies.positions[j * 3 + 2]) >= 1.5 - 1e-6, 'two flies on top of each other');
  }
  const cells = new Set();
  for (let i = 0; i < flies.count; i++) cells.add(`${Math.floor(flies.positions[i * 3] / 20)},${Math.floor(flies.positions[i * 3 + 2] / 20)}`);
  assert.ok(cells.size >= 5, `flies over only ${cells.size} patches of the lake`);
  assert.deepEqual(Array.from(layoutGlowFlies(lake, level, { ground: drawn }).positions), Array.from(flies.positions), 'the same every time');
});

test('night comes in as the exposure falls, the same measure the halos and crystal motes use', () => {
  assert.equal(nightAmount(0.62), 0);
  assert.equal(nightAmount(0.035), 1);
  assert.ok(nightAmount(0.2) > 0 && nightAmount(0.2) < 1);
  assert.ok(nightAmount(0.1) > nightAmount(0.3));
});

test('two Points draws with every attribute the shaders read, shaders that interpolated cleanly, and a clock that advances', () => {
  const motes = createIslandMotes({ flowers, lake, level, getExposure: () => 0.035, anchor: { x: SKY_ISLAND.x, z: SKY_ISLAND.z, distance: 700 } });
  assert.ok(motes.puffs.isPoints && motes.flies.isPoints);
  assert.equal(motes.group.children.length, 2);
  for (const points of [motes.puffs, motes.flies]) {
    const { vertexShader, fragmentShader } = points.material;
    assert.ok(!/undefined|NaN|\[object/.test(vertexShader + fragmentShader), `${points.name}: a bad interpolation in the shader`);
    for (const [, name] of vertexShader.matchAll(/attribute\s+\w+\s+(\w+)\s*;/g)) assert.ok(points.geometry.getAttribute(name), `${points.name} has no ${name}`);
    assert.equal(points.frustumCulled, false);
    assert.equal(points.material.depthWrite, false);
    assert.equal(points.material.blending, THREE.AdditiveBlending);
  }
  assert.equal(motes.puffs.geometry.getAttribute('position').count, flowers.length * P.perFlower);
  assert.equal(motes.flies.geometry.getAttribute('position').count, F.count);
  const head = { x: SKY_ISLAND.x, z: SKY_ISLAND.z };
  motes.update(head, 0.5, 900);
  const { uniforms } = motes.puffs.material;
  assert.equal(uniforms.uTime.value, 0.5);
  assert.equal(uniforms.uViewHeight.value, 900);
  assert.equal(uniforms.uNight.value, 1);
  motes.update(head, 0.25, 900);
  assert.equal(uniforms.uTime.value, 0.75);
  assert.equal(motes.flies.visible, true);
  motes.dispose();
});

test('by day the flies are put away and the puffs stay; far from the island nothing is drawn', () => {
  let exposure = 0.62;
  const motes = createIslandMotes({ flowers, lake, level, getExposure: () => exposure, anchor: { x: SKY_ISLAND.x, z: SKY_ISLAND.z, distance: 700 } });
  const head = { x: SKY_ISLAND.x, z: SKY_ISLAND.z };
  motes.update(head, 0.1);
  assert.equal(motes.puffs.visible, true);
  assert.equal(motes.flies.visible, false);
  assert.equal(motes.puffs.material.uniforms.uNight.value, 0);
  exposure = 0.035;
  motes.update(head, 0.1);
  assert.equal(motes.flies.visible, true);
  motes.update({ x: 5000, z: 0 }, 0.1);
  assert.equal(motes.group.visible, false);
  motes.update(head, 0.1);
  assert.equal(motes.group.visible, true);
});

test('no flowers and no lake is fine', () => {
  const motes = createIslandMotes({});
  assert.equal(motes.group.children.length, 0);
  motes.update({ x: 0, z: 0 }, 0.1);
  motes.dispose();
});
