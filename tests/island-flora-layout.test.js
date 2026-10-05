import test from 'node:test';
import assert from 'node:assert/strict';
import { SKY_ISLAND, buildIsland, makeMeshGround, outlineRadius, undersidePoint } from '../src/sky-island-shape.js';
import { createSkyIslandGround, ISLAND_START } from '../src/sky-island-ground.js';
import { createPathIndex } from '../src/sky-island-paths.js';
import { layoutSkyTrees, SKY_TREES } from '../src/sky-island-layout.js';
import { layoutRocks } from '../src/sky-island-rocks.js';
import { layoutIslandGlow } from '../src/sky-island-glow.js';
import { layoutIslandFlora, ISLAND_FLORA, boulderTop } from '../src/island-flora-layout.js';
import { FLORA_MODELS } from '../src/island-flora-models.js';
import { FLORA_RENDER } from '../src/island-flora.js';

const ground = createSkyIslandGround(SKY_ISLAND);
const { features } = ground;
const drawn = makeMeshGround(buildIsland(ground.baseY, SKY_ISLAND, features), SKY_ISLAND);
const paths = [];   // the island has no paths (Kane, 6 Oct); ISLAND_SCENERY.paths in src/sky-island-scenery.js
const pathIndex = createPathIndex(paths);
const palms = layoutSkyTrees(SKY_ISLAND, SKY_TREES, { features, pathIndex });
const waterY = ground.baseY + features.lakeSpec.level; // the lake's surface in world metres
const rocks = layoutRocks({ ground: drawn, features, pathIndex, config: SKY_ISLAND, avoid: palms, waterY });
const glow = layoutIslandGlow({ ground: drawn, features, pathIndex, paths, config: SKY_ISLAND, obstacles: [...rocks.filter(r => r.r >= 0.3), ...palms.map(p => ({ x: p.x, z: p.z, r: 0.7 * p.scale }))] });
const obstacles = [...palms.map(p => ({ x: p.x, z: p.z, r: 0.7 * p.scale })), ...glow.map(g => ({ x: g.x, z: g.z, r: 0.5 * g.scale, soft: true }))];
const ctx = { ground: drawn, features, pathIndex, paths, config: SKY_ISLAND, obstacles, rocks, waterY };
const items = layoutIslandFlora(ctx);
const { lake, places, channel } = features;
const of = type => items.filter(i => i.type === type);
const where = (type, place) => items.filter(i => i.type === type && i.place === place);
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

test('the plants grow the same every time, and every one is a model the renderer can draw', () => {
  assert.deepEqual(layoutIslandFlora(ctx), items);
  assert.ok(items.length > 140 && items.length < 340, `${items.length} items`);
  for (const item of items) {
    assert.ok(FLORA_MODELS[item.type], `no model called ${item.type}`);
    assert.ok(FLORA_RENDER[item.type], `no render rule for ${item.type}`);
    assert.ok([item.x, item.y, item.z, item.yaw, item.scale, item.tiltX, item.tiltZ].every(Number.isFinite), `a bad number in ${item.type}`);
    assert.ok(item.scale > 0.5 && item.scale < 3.2);
    assert.ok(['meadow', 'grove', 'lake', 'rise', 'rim', 'hollow', 'path'].includes(item.place), `${item.type} has place ${item.place}`);
  }
});

test('how many of each: a few big landmarks, a drift of small plants, and every model used', () => {
  const n = type => of(type).length;
  assert.equal(n('rootArch'), 1);
  assert.ok(n('weepingTree') >= 4 && n('weepingTree') <= 6, `${n('weepingTree')} trees`);
  assert.ok(n('fern') >= 55 && n('fern') <= 70, `${n('fern')} ferns`);
  assert.ok(n('flower') >= 40 && n('flower') <= 56, `${n('flower')} flowers`);
  assert.ok(n('mushrooms') >= 40 && n('mushrooms') <= 50, `${n('mushrooms')} mushrooms`);
  assert.ok(n('vines') >= 10 && n('vines') <= 14, `${n('vines')} vine curtains`);
  // the weak models are retired (Kane, 6 Oct): none of them is placed, every other model is used
  for (const type of ISLAND_FLORA.retired) assert.equal(n(type), 0, `${type} is retired but placed`);
  for (const type of Object.keys(FLORA_MODELS)) if (!ISLAND_FLORA.retired.includes(type)) assert.ok(n(type) >= 1, `${type} is never used`);
});

test('each plant has its own places: the drifts, the trees and the landmarks are not scattered everywhere', () => {
  const allowed = {
    weepingTree: ['meadow', 'lake'], fern: ['grove', 'hollow'], flower: ['meadow', 'lake', 'rim', 'grove'], rootArch: ['grove'],
    vines: ['rim', 'hollow'], mushrooms: ['rim', 'hollow', 'grove', 'lake', 'rise'],
  };
  for (const item of items) assert.ok(allowed[item.type].includes(item.place), `${item.type} in the ${item.place}`);
  // and most places have a few kinds of their own (the rise has only its mushrooms: its boulders are the rock layout's)
  for (const place of ['meadow', 'grove', 'lake', 'rim', 'hollow']) {
    const kinds = new Set(items.filter(i => i.place === place).map(i => i.type));
    assert.ok(kinds.size >= 2, `${place} has only ${[...kinds]}`);
  }
});

test('everything stands on the drawn ground (or on the stone it was put on, or hangs from the rim)', () => {
  const rockOf = item => rocks.find(r => r.type === 'boulder' && boulderTop(r, item.x, item.z) !== null && Math.abs(boulderTop(r, item.x, item.z) - item.y) < 0.4);
  for (const item of items) {
    const g = drawn(item.x, item.z);
    if (item.type === 'vines') continue;
    assert.ok(g !== null, `${item.type} off the island`);
    if (item.type === 'cushion' && Math.abs(item.y - g) > 0.5) { assert.ok(rockOf(item), 'a cushion in mid-air'); continue; }
    assert.ok(Math.abs(item.y - g) < 0.7, `${item.type} is ${(item.y - g).toFixed(2)} m off the ground`);
  }
});

test('nothing grows on the meadow, in the water, in the spill channel, on a path (but the arch, which stands over one), or in a palm or a stone', () => {
  const dx = channel.bx - channel.ax, dz = channel.bz - channel.az;
  const channelDistance = (x, z) => {
    const t = Math.max(0, Math.min(1, ((x - channel.ax) * dx + (z - channel.az) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(x - (channel.ax + dx * t), z - (channel.az + dz * t));
  };
  for (const item of items) {
    if (item.type === 'vines') continue;
    assert.ok(Math.hypot(item.x - places.meadow.x, item.z - places.meadow.z) >= places.meadow.radius + 0.5, `${item.type} on the meadow`);
    assert.ok(lake.signed(item.x, item.z) <= -0.5 + 1e-6 || item.type === 'cushion', `${item.type} in the water (${lake.signed(item.x, item.z).toFixed(1)})`);
    if (item.type !== 'cushion') assert.ok(channelDistance(item.x, item.z) >= 3, `${item.type} in the channel`);
    if (item.type !== 'rootArch') assert.ok(pathIndex.clearance(item.x, item.z) >= 0.25, `${item.type} on a path (${pathIndex.clearance(item.x, item.z).toFixed(2)})`);
    if (item.type === 'cushion') continue;
    for (const p of palms) assert.ok(Math.hypot(p.x - item.x, p.z - item.z) >= 0.5 * p.scale + 0.2, `${item.type} inside a palm`);
    for (const r of rocks) {
      if (r.r < 0.9 || r.stepping) continue;
      assert.ok(Math.hypot(r.x - item.x, r.z - item.z) >= (r.type === 'column' ? r.baseR : r.r) * 0.6, `${item.type} inside a ${r.type}`);
    }
  }
});

test('the start stays open: the whole meadow around where you spawn is empty', () => {
  for (const item of items) {
    if (item.type === 'vines') continue;
    assert.ok(Math.hypot(item.x - ISLAND_START.x, item.z - ISLAND_START.z) > 38, `${item.type} at ${Math.hypot(item.x - ISLAND_START.x, item.z - ISLAND_START.z).toFixed(1)} m from the start`);
  }
});

test('the root arch is the grove\'s gateway: at its edge on the line to the meadow, with its opening along that line, on level ground', () => {
  const [arch] = of('rootArch');
  const g = places.grove, m = places.meadow;
  const dg = Math.hypot(arch.x - g.x, arch.z - g.z);
  assert.ok(dg > 20 && dg < 36, `${dg.toFixed(1)} m from the grove's heart`);
  // its local z is the way through: yaw turns local +z to (sin yaw, cos yaw), which should run along the line from the grove to the meadow
  const toMeadow = [m.x - g.x, m.z - g.z], len = Math.hypot(...toMeadow);
  const along = Math.abs(Math.sin(arch.yaw) * toMeadow[0] / len + Math.cos(arch.yaw) * toMeadow[1] / len);
  assert.ok(along > 0.8, `the opening faces ${along.toFixed(2)} along the line to the meadow`);
  // and the legs stand on level ground either side
  for (const side of [-1, 1]) {
    const fx = arch.x + Math.cos(arch.yaw) * side * 2.75, fz = arch.z - Math.sin(arch.yaw) * side * 2.75;
    assert.ok(Math.abs(drawn(fx, fz) - arch.y) < 1.4, 'a leg in the air or buried');
  }
});

test('the weeping trees: one standing sentinel off the meadow, the rest on the lake shore, none within 9 m of each other, none on a slope', () => {
  const trees = of('weepingTree');
  assert.ok(where('weepingTree', 'meadow').length === 1);
  assert.ok(where('weepingTree', 'lake').length >= 3);
  for (const t of trees) {
    for (const u of trees) if (t !== u) assert.ok(Math.hypot(t.x - u.x, t.z - u.z) >= 9, 'two trees on top of each other');
    assert.ok(t.scale >= 0.9 && t.scale <= 1.12);
    const slope = Math.max(Math.abs(drawn(t.x + 1, t.z) - drawn(t.x - 1, t.z)), Math.abs(drawn(t.x, t.z + 1) - drawn(t.x, t.z - 1))) / 2;
    assert.ok(slope < 0.6, `slope ${slope.toFixed(2)}`);
  }
  // the sentinel is the one you see first: within sight of the start, on the way to the lake
  const [sentinel] = where('weepingTree', 'meadow');
  const dStart = Math.hypot(sentinel.x - ISLAND_START.x, sentinel.z - ISLAND_START.z);
  assert.ok(dStart > 40 && dStart < 110, `${dStart.toFixed(0)} m from the start`);
});

test('the hollow has three vine curtains under its overhang', () => {
  const h = places.hollow;
  for (const v of where('vines', 'hollow')) assert.ok(Math.hypot(v.x - h.x, v.z - h.z) < h.radius * 1.5, 'vines far from the overhang');
  assert.equal(where('vines', 'hollow').length, 3);
});

test('rim vines hang off the lip into clear air, never into the cliff, and not over the waterfall', () => {
  const rim = where('vines', 'rim');
  assert.ok(rim.length >= 8, `${rim.length} curtains on the rim`);
  const spill = features.lakeSpec.spill;
  for (const v of rim) {
    const th = Math.atan2(v.z - SKY_ISLAND.z, v.x - SKY_ISLAND.x);
    const edge = outlineRadius(th, SKY_ISLAND);
    const r = Math.hypot(v.x - SKY_ISLAND.x, v.z - SKY_ISLAND.z);
    assert.ok(r >= edge + 0.3 - 1e-6 && r <= edge + 0.3 + ISLAND_FLORA.vineBulge + 0.1, `the anchor is ${(r - edge).toFixed(2)} m past the lip`);
    assert.ok(Math.abs(wrap(th - spill)) >= 0.075 - 1e-6, 'over the waterfall');
    assert.ok(v.scale >= 2 && v.scale <= 2.6);
    // the cliff under the curtain does not poke out past it
    const hang = 4.2 * v.scale;
    let worst = -Infinity;
    for (const dth of [-1.5 / r * v.scale, 0, 1.5 / r * v.scale]) for (let s = 1; s <= 24; s++) {
      const u = undersidePoint(th + dth, (hang * s / 24) / SKY_ISLAND.thickness, v.y + 0.35, SKY_ISLAND);
      worst = Math.max(worst, u.r - (r - 0.1));
    }
    assert.ok(worst <= 0.1, `the cliff pokes ${worst.toFixed(2)} m past a curtain`);
  }
  // spaced along the rim, not piled up
  for (const v of rim) for (const w of rim) {
    if (v === w) continue;
    const gap = Math.abs(wrap(Math.atan2(v.z - SKY_ISLAND.z, v.x - SKY_ISLAND.x) - Math.atan2(w.z - SKY_ISLAND.z, w.x - SKY_ISLAND.x))) * 250;
    assert.ok(gap > ISLAND_FLORA.vineSpacing * 0.9, `two curtains ${gap.toFixed(1)} m apart`);
  }
});

test('little mushrooms grow in small groups: round the arch, under the palms, at the hollow, along the lake and at the foot of the rise', () => {
  const m = of('mushrooms');
  assert.ok(m.length >= 40);
  for (const place of ['grove', 'hollow', 'lake']) assert.ok(where('mushrooms', place).length >= 3, `mushrooms in the ${place}`);
  // groups, not an even sprinkle: most have another within 3 m
  const paired = m.filter(a => m.some(b => b !== a && Math.hypot(a.x - b.x, a.z - b.z) < 3)).length;
  assert.ok(paired >= m.length * 0.7, `${paired} of ${m.length} have a neighbour`);
});

test('the whole layout takes well under a second', () => {
  const t = Date.now();
  layoutIslandFlora(ctx);
  assert.ok(Date.now() - t < 1500, `${Date.now() - t} ms`);
});
