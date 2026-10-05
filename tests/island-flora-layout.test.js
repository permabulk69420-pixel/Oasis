import test from 'node:test';
import assert from 'node:assert/strict';
import { SKY_ISLAND, buildIsland, makeMeshGround, outlineRadius, undersidePoint } from '../src/sky-island-shape.js';
import { createSkyIslandGround, ISLAND_START } from '../src/sky-island-ground.js';
import { layoutPaths, createPathIndex } from '../src/sky-island-paths.js';
import { layoutSkyTrees, SKY_TREES } from '../src/sky-island-layout.js';
import { layoutRocks } from '../src/sky-island-rocks.js';
import { layoutIslandGlow } from '../src/sky-island-glow.js';
import { layoutIslandFlora, ISLAND_FLORA, boulderTop } from '../src/island-flora-layout.js';
import { FLORA_MODELS } from '../src/island-flora-models.js';
import { FLORA_RENDER } from '../src/island-flora.js';

const ground = createSkyIslandGround(SKY_ISLAND);
const { features } = ground;
const drawn = makeMeshGround(buildIsland(ground.baseY, SKY_ISLAND, features), SKY_ISLAND);
const paths = layoutPaths(features, SKY_ISLAND);
const pathIndex = createPathIndex(paths);
const palms = layoutSkyTrees(SKY_ISLAND, SKY_TREES, { features, pathIndex });
const rocks = layoutRocks({ ground: drawn, features, pathIndex, config: SKY_ISLAND, avoid: palms });
const glow = layoutIslandGlow({ ground: drawn, features, pathIndex, paths, config: SKY_ISLAND, obstacles: [...rocks.filter(r => r.r >= 0.3), ...palms.map(p => ({ x: p.x, z: p.z, r: 0.7 * p.scale }))] });
const obstacles = [...palms.map(p => ({ x: p.x, z: p.z, r: 0.7 * p.scale })), ...glow.map(g => ({ x: g.x, z: g.z, r: 0.5 * g.scale, soft: true }))];
const ctx = { ground: drawn, features, pathIndex, paths, config: SKY_ISLAND, obstacles, rocks };
const items = layoutIslandFlora(ctx);
const { lake, places, channel } = features;
const of = type => items.filter(i => i.type === type);
const where = (type, place) => items.filter(i => i.type === type && i.place === place);
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

test('the plants grow the same every time, and every one is a model the renderer can draw', () => {
  assert.deepEqual(layoutIslandFlora(ctx), items);
  assert.ok(items.length > 200 && items.length < 340, `${items.length} items`);
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
  assert.equal(n('ribcage'), 1);
  assert.equal(n('standingStoneA'), 1);
  assert.equal(n('standingStoneB'), 1);
  assert.ok(n('weepingTree') >= 4 && n('weepingTree') <= 6, `${n('weepingTree')} trees`);
  assert.ok(n('fern') >= 55 && n('fern') <= 70, `${n('fern')} ferns`);
  assert.ok(n('flower') >= 40 && n('flower') <= 56, `${n('flower')} flowers`);
  assert.ok(n('cushion') >= 35 && n('cushion') <= 58, `${n('cushion')} cushions`);
  assert.ok(n('mushrooms') >= 40 && n('mushrooms') <= 50, `${n('mushrooms')} mushrooms`);
  assert.ok(n('fungusLog') >= 3 && n('log') >= 3, 'logs');
  assert.ok(n('driftwoodA') + n('driftwoodB') + n('driftwoodC') >= 5, 'driftwood');
  assert.ok(n('bonesA') + n('bonesB') >= 5, 'bones');
  assert.ok(n('vines') >= 10 && n('vines') <= 14, `${n('vines')} vine curtains`);
  for (const type of Object.keys(FLORA_MODELS)) assert.ok(n(type) >= 1, `${type} is never used`);
});

test('each plant has its own places: the drifts, the trees and the landmarks are not scattered everywhere', () => {
  const allowed = {
    weepingTree: ['meadow', 'lake'], fern: ['grove', 'hollow'], flower: ['meadow', 'lake', 'rim', 'grove'], fungusLog: ['grove'], log: ['meadow', 'rise'],
    driftwoodA: ['lake'], driftwoodB: ['lake'], driftwoodC: ['lake'], rootArch: ['grove'], ribcage: ['hollow'], standingStoneA: ['rim'], standingStoneB: ['rim'],
    vines: ['rim', 'hollow'], bonesA: ['hollow', 'rise', 'grove', 'lake'], bonesB: ['hollow', 'rise', 'grove', 'lake'],
    mushrooms: ['path', 'rim', 'hollow', 'grove'], cushion: ['rise', 'rim', 'lake', 'hollow', 'meadow', 'grove'],
  };
  for (const item of items) assert.ok(allowed[item.type].includes(item.place), `${item.type} in the ${item.place}`);
  // and every place has several kinds of its own
  for (const place of ['meadow', 'grove', 'lake', 'rise', 'rim', 'hollow']) {
    const kinds = new Set(items.filter(i => i.place === place).map(i => i.type));
    assert.ok(kinds.size >= 3, `${place} has only ${[...kinds]}`);
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

test('the root arch stands over the path into the grove, with its opening along the way', () => {
  const [arch] = of('rootArch');
  const route = paths.find(p => p.name === 'meadow to grove');
  const near = route.samples.reduce((best, s) => (Math.hypot(s.x - arch.x, s.z - arch.z) < Math.hypot(best.x - arch.x, best.z - arch.z) ? s : best));
  assert.ok(Math.hypot(near.x - arch.x, near.z - arch.z) < 1.0, 'the arch is not over the path');
  // its local z is the way through: yaw turns local +z to (sin yaw, cos yaw), which should run along the path
  const along = Math.abs(Math.sin(arch.yaw) * near.tx + Math.cos(arch.yaw) * near.tz);
  assert.ok(along > 0.9, `the opening faces ${along.toFixed(2)} along the path`);
  const g = places.grove;
  const dg = Math.hypot(arch.x - g.x, arch.z - g.z);
  assert.ok(dg > 14 && dg < 34, `${dg.toFixed(1)} m from the grove's heart`);
  // and the legs stand on level ground either side
  for (const side of [-1, 1]) {
    const fx = arch.x + Math.cos(arch.yaw) * side * 2.75, fz = arch.z - Math.sin(arch.yaw) * side * 2.75;
    assert.ok(Math.abs(drawn(fx, fz) - arch.y) < 1.4, 'a leg in the air or buried');
  }
});

test('the standing stones frame the lookout: one of each shape, one either side of the view, back from the rim', () => {
  const [a] = of('standingStoneA'), [b] = of('standingStoneB');
  const rimA = Math.atan2(places.rim.z - SKY_ISLAND.z, places.rim.x - SKY_ISLAND.x);
  const angle = s => Math.atan2(s.z - SKY_ISLAND.z, s.x - SKY_ISLAND.x);
  assert.ok(wrap(angle(a) - rimA) * wrap(angle(b) - rimA) < 0, 'both on the same side');
  for (const s of [a, b]) {
    const edge = outlineRadius(angle(s), SKY_ISLAND) - SKY_ISLAND.lip;
    const gap = edge - Math.hypot(s.x - SKY_ISLAND.x, s.z - SKY_ISLAND.z);
    assert.ok(gap > 8 && gap < 32, `${gap.toFixed(1)} m from the edge`);
    assert.ok(Math.hypot(s.x - places.rim.x, s.z - places.rim.z) < 40, 'far from the lookout');
  }
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 9 && Math.hypot(a.x - b.x, a.z - b.z) < 40, 'the pair is too tight or too far apart');
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

test('the ribcage lies in the hollow\'s mouth, with bones about it, and nothing blocks it', () => {
  const [cage] = of('ribcage');
  const h = places.hollow;
  assert.ok(Math.hypot(cage.x - h.x, cage.z - h.z) <= h.radius * 1.4 + 1e-6, 'the ribcage is outside the hollow');
  assert.ok(cage.z < h.z, 'the ribcage is behind the hollow, not in its mouth (the hollow opens north)');
  assert.ok(where('bonesA', 'hollow').length + where('bonesB', 'hollow').length >= 2, 'bones in the hollow');
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

test('little mushrooms follow the paths a step off their edge, and cluster at the landmarks', () => {
  const onPath = where('mushrooms', 'path');
  assert.ok(onPath.length >= 25, `${onPath.length} along the paths`);
  for (const m of onPath) {
    const c = pathIndex.clearance(m.x, m.z);
    assert.ok(c > 0.3 && c < 3.4, `${c.toFixed(2)} m from a path`);
  }
  const names = new Set(onPath.map(m => paths.reduce((best, p) => p.samples.reduce((b, s) => Math.min(b, Math.hypot(s.x - m.x, s.z - m.z)), Infinity) < best.d ? { d: p.samples.reduce((b, s) => Math.min(b, Math.hypot(s.x - m.x, s.z - m.z)), Infinity), name: p.name } : best, { d: Infinity, name: '' }).name));
  assert.ok(names.size >= 5, `mushrooms along ${names.size} paths`);
});

test('cushions sit on the stones that are flat enough, whole foot on the rock, and not under water', () => {
  const onRocks = of('cushion').filter(c => Math.abs(c.y - drawn(c.x, c.z)) > 0.3);
  assert.ok(onRocks.length >= 25, `${onRocks.length} cushions on rocks`);
  for (const c of onRocks) {
    const rock = rocks.find(r => r.type === 'boulder' && boulderTop(r, c.x, c.z) !== null && Math.abs(boulderTop(r, c.x, c.z) - c.y) < 0.4);
    assert.ok(rock, 'a cushion with no stone under it');
    for (const [dx, dz] of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) assert.ok(boulderTop(rock, c.x + dx * c.scale, c.z + dz * c.scale) !== null, 'the cushion hangs over the stone\'s edge');
    assert.ok(c.y > features.lakeSpec.level - 0.1 || lake.signed(c.x, c.z) < -0.5, 'a cushion under water');
  }
});

test('logs and driftwood lie along the ground, tilted to meet it at both ends, not too steep', () => {
  for (const item of items.filter(i => /^(log|fungusLog|driftwood)/.test(i.type))) {
    assert.ok(Math.abs(item.tiltZ) <= 0.42 + 1e-6, `${item.type} tilted ${item.tiltZ.toFixed(2)}`);
    const half = (item.type.startsWith('driftwood') ? 3.4 : 4.5) * item.scale / 2;
    const dx = Math.cos(item.yaw) * half, dz = -Math.sin(item.yaw) * half;
    const a = drawn(item.x - dx, item.z - dz), b = drawn(item.x + dx, item.z + dz);
    assert.ok(a !== null && b !== null, `${item.type} hangs off the island`);
    assert.ok(Math.abs((a + b) / 2 - item.y) < 0.2, 'a log in the air');
  }
});

test('the whole layout takes well under a second', () => {
  const t = Date.now();
  layoutIslandFlora(ctx);
  assert.ok(Date.now() - t < 1500, `${Date.now() - t} ms`);
});
