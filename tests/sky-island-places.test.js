import test from 'node:test';
import assert from 'node:assert/strict';
import { SKY_ISLAND, buildIsland, topGround, topOffset, outlineRadius, makeMeshGround } from '../src/sky-island-shape.js';
import { createSkyIslandGround, ISLAND_START } from '../src/sky-island-ground.js';
import { createIslandFeatures, ISLAND_PLACES, ISLAND_LAKE } from '../src/sky-island-places.js';

const ground = createSkyIslandGround(SKY_ISLAND);
const features = ground.features;
const { lake } = features;
const heightAt = (x, z) => topGround(x, z, SKY_ISLAND, features);

function polygonArea(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) { const p = points[i], q = points[(i + 1) % points.length]; a += p.x * q.z - q.x * p.z; }
  return Math.abs(a / 2);
}
function topArea() {
  let n = 0;
  for (let x = SKY_ISLAND.x - 330; x <= SKY_ISLAND.x + 330; x += 4) for (let z = SKY_ISLAND.z - 330; z <= SKY_ISLAND.z + 330; z += 4) if (topGround(x, z, SKY_ISLAND) !== null) n++;
  return n * 16;
}

test('the lake is about 100 m by 50 m and about two percent of the top (Kane, 5 Oct)', () => {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of lake.outline) { const { u, v } = lake.toLocal(p.x, p.z); u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const length = u1 - u0, width = v1 - v0;
  assert.ok(length > 90 && length < 125, `length ${length.toFixed(0)} m`);
  assert.ok(width > 42 && width < 66, `width ${width.toFixed(0)} m`);
  const share = polygonArea(lake.outline) / topArea();
  assert.ok(share > 0.015 && share < 0.026, `${(share * 100).toFixed(2)}% of the top`);
});

test('the lake is irregular: a bay on one shore and a headland on the other, not an oval', () => {
  // an oval of the same area would have a convex outline; this one must fold in somewhere on each side
  let reflex = 0;
  const o = lake.outline;
  for (let i = 0; i < o.length; i++) {
    const a = o[(i + o.length - 1) % o.length], b = o[i], c = o[(i + 1) % o.length];
    const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
    if (cross < 0) reflex++;
  }
  const convex = Math.min(reflex, o.length - reflex);
  assert.ok(convex > o.length * 0.08, `only ${convex} of ${o.length} corners turn the other way`);
  const radiusSpread = (() => {
    const c = lake.toWorld(0, 0);
    const radii = o.map(p => Math.hypot(p.x - c.x, p.z - c.z));
    return Math.max(...radii) / Math.min(...radii);
  })();
  assert.ok(radiusSpread > 2, `${radiusSpread.toFixed(2)}`);
});

test('the lake sits off the middle, well clear of the meadow, wholly on the top, with its far tip by the rim', () => {
  const start = ISLAND_START;
  let nearest = Infinity;
  for (const p of lake.outline) {
    nearest = Math.min(nearest, Math.hypot(p.x - start.x, p.z - start.z));
    const edge = outlineRadius(Math.atan2(p.z - SKY_ISLAND.z, p.x - SKY_ISLAND.x), SKY_ISLAND);
    const rho = Math.hypot(p.x - SKY_ISLAND.x, p.z - SKY_ISLAND.z) / edge;
    assert.ok(topGround(p.x, p.z, SKY_ISLAND) !== null && rho < 0.97, `shore point at rho ${rho.toFixed(3)}`);
  }
  assert.ok(nearest > ISLAND_PLACES.meadow.radius + 40, `the shore comes within ${nearest.toFixed(0)} m of the start`);
  const centre = lake.toWorld(0, 0);
  const fromMiddle = Math.hypot(centre.x - SKY_ISLAND.x, centre.z - SKY_ISLAND.z);
  assert.ok(fromMiddle > 120 && fromMiddle < 230, `${fromMiddle.toFixed(0)} m from the island's middle`);
  // the tip is a short walk from the crest, and the crest is the last of the top before the rounded lip
  assert.ok(Math.hypot(lake.tip.x - lake.crest.x, lake.tip.z - lake.crest.z) < ISLAND_LAKE.tipGap + 1);
  assert.ok(topGround(lake.crest.x, lake.crest.z, SKY_ISLAND, features) !== null);
});

test('the meadow is untouched by the places: the ground there is the plain shape, to the last millimetre', () => {
  const m = ISLAND_PLACES.meadow;
  for (let a = 0; a < 360; a += 15) for (const r of [0, 12, 24, 36]) {
    const x = m.x + Math.cos(a * Math.PI / 180) * r, z = m.z + Math.sin(a * Math.PI / 180) * r;
    const plain = topGround(x, z, SKY_ISLAND);
    assert.ok(Math.abs(heightAt(x, z) - plain) < 1e-6, `(${x.toFixed(0)}, ${z.toFixed(0)})`);
  }
  assert.ok(Math.abs(heightAt(ISLAND_START.x, ISLAND_START.z) - topGround(ISLAND_START.x, ISLAND_START.z, SKY_ISLAND)) < 1e-9);
});

test('the lake holds water: below the surface inside, above it all round, and no deeper than a wader\'s lake', () => {
  const level = ISLAND_LAKE.level;
  let deepest = 0, lowest = Infinity;
  for (let x = lake.bounds.minX; x <= lake.bounds.maxX; x += 1.5) for (let z = lake.bounds.minZ; z <= lake.bounds.maxZ; z += 1.5) {
    const s = lake.signed(x, z);
    const h = heightAt(x, z);
    if (h === null) continue;
    if (s > 0.8) { assert.ok(h <= level + 1e-6, `bed above the water at (${x.toFixed(0)}, ${z.toFixed(0)}): ${h.toFixed(2)}`); deepest = Math.max(deepest, level - h); lowest = Math.min(lowest, h); }
  }
  assert.ok(deepest > 0.9 && deepest <= ISLAND_LAKE.depth + 1e-6, `deepest ${deepest.toFixed(2)} m`);
  // the bank: just beyond the shoreline all round the ground is above the water, except where the spill channel leaves
  const channel = features.channel;
  for (const p of lake.outline) {
    const c = lake.toWorld(0, 0);
    const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz);
    const hit = (() => {
      // push out along the line from the shore point away from the lake: find the nearest point with signed distance -2.5
      for (let t = 0.5; t < 20; t += 0.5) {
        const x = p.x + (dx / d) * t, z = p.z + (dz / d) * t;
        if (lake.signed(x, z) < -2.5) return { x, z };
      }
      return null;
    })();
    if (!hit) continue;
    const toChannel = Math.hypot(hit.x - channel.ax, hit.z - channel.az);
    if (toChannel < 9) continue;
    assert.ok(heightAt(hit.x, hit.z) >= level + 0.02, `the bank at (${hit.x.toFixed(0)}, ${hit.z.toFixed(0)}) is only ${heightAt(hit.x, hit.z).toFixed(2)} (the water is at ${level})`);
  }
});

test('the spill channel carries the water downhill from the lake to the rim and stops at the crest', () => {
  const { channel } = features;
  const n = 12;
  let last = Infinity;
  for (let i = 0; i <= n; i++) {
    const x = channel.ax + (channel.bx - channel.ax) * (i / n), z = channel.az + (channel.bz - channel.az) * (i / n);
    const h = heightAt(x, z);
    assert.ok(h <= last + 1e-6, `the channel rises at step ${i}`);
    last = h;
    if (i === 0) assert.ok(h < ISLAND_LAKE.level && h > ISLAND_LAKE.level - 0.3, `the channel's head is ${h.toFixed(2)}`);
  }
  assert.ok(last < 1.2, `the channel ends at ${last.toFixed(2)}`);
  // the crest is where the top ends: a metre further out is the rounded lip (no top)
  const out = { x: channel.bx + lake.ux * 3, z: channel.bz + lake.uz * 3 };
  assert.equal(heightAt(out.x, out.z), null);
});

test('every place is on the top, they are a good walk apart but all within a few minutes of the start', () => {
  const names = Object.keys(ISLAND_PLACES);
  for (const name of names) assert.ok(heightAt(ISLAND_PLACES[name].x, ISLAND_PLACES[name].z) !== null, name);
  const lakeMiddle = lake.toWorld(0, 0);
  const points = { ...ISLAND_PLACES, lake: lakeMiddle };
  const keys = Object.keys(points);
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = points[keys[i]], b = points[keys[j]];
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    assert.ok(d > 45, `${keys[i]} and ${keys[j]} are only ${d.toFixed(0)} m apart`);
  }
  for (const key of keys) {
    const d = Math.hypot(points[key].x - ISLAND_START.x, points[key].z - ISLAND_START.z);
    assert.ok(d < 215, `${key} is ${d.toFixed(0)} m from the start`);
  }
});

test('the rocky rise stands clear of the meadow and the hollow is a bowl open to it', () => {
  const rise = ISLAND_PLACES.rise;
  const base = (x, z) => topOffset(x, z, Math.hypot(x - SKY_ISLAND.x, z - SKY_ISLAND.z) / outlineRadius(Math.atan2(z - SKY_ISLAND.z, x - SKY_ISLAND.x), SKY_ISLAND), SKY_ISLAND);
  const gain = heightAt(rise.summit.x, rise.summit.z) - base(rise.summit.x, rise.summit.z);
  assert.ok(gain > 2.5, `the rise adds ${gain.toFixed(1)} m at the summit`);
  assert.ok(heightAt(rise.ledge.x, rise.ledge.z) < heightAt(rise.summit.x, rise.summit.z) - 2, 'the ledge is below the summit');
  const hollow = ISLAND_PLACES.hollow;
  const floor = heightAt(hollow.x, hollow.z);
  const back = heightAt(hollow.x, hollow.z + hollow.radius * 1.2);
  assert.ok(floor < base(hollow.x, hollow.z) - 0.8, 'the hollow is dug in');
  assert.ok(back > floor + 1.2, 'with higher ground behind it');
});

test('the drawn ground (the mesh) is what is walked on: a sampler agrees with every vertex and stays within a quarter of a metre of the smooth function', () => {
  const data = buildIsland(ground.baseY, SKY_ISLAND, features);
  const mesh = makeMeshGround(data, SKY_ISLAND);
  const A = SKY_ISLAND.around;
  for (let ring = 2; ring <= SKY_ISLAND.topRings; ring += 11) for (let j = 0; j < A; j += 17) {
    const v = 1 + (ring - 1) * A + j;
    assert.ok(Math.abs(mesh(data.positions[v * 3], data.positions[v * 3 + 2]) - data.positions[v * 3 + 1]) < 1e-3, `ring ${ring} step ${j}`);
  }
  let worst = 0;
  for (let k = 0; k < 4000; k++) {
    const angle = (k * 2.399963) % (Math.PI * 2), r = Math.sqrt((k + 0.5) / 4000) * SKY_ISLAND.radius * 1.1;
    const x = SKY_ISLAND.x + Math.cos(angle) * r, z = SKY_ISLAND.z + Math.sin(angle) * r;
    const smooth = heightAt(x, z), drawn = mesh(x, z);
    assert.equal(smooth === null, drawn === null, `the two disagree about whether (${x.toFixed(0)}, ${z.toFixed(0)}) is on the top`);
    if (smooth !== null) worst = Math.max(worst, Math.abs(ground.baseY + smooth - drawn));
  }
  assert.ok(worst < 0.45, `worst gap ${worst.toFixed(3)} m`);
});

test('the places add stone to the ground and take the turf off the shore, the bed and the hill', () => {
  const out = { grass: 1, stone: 0, gravel: 0 };
  const paint = (x, z, grass = 1, stone = 0) => { out.grass = grass; out.stone = stone; out.gravel = 0; features.paint(x, z, out); return { ...out }; };
  const middle = lake.toWorld(0, 0);
  const inWater = paint(middle.x, middle.z);
  assert.ok(inWater.grass < 0.05 && inWater.stone > 0.5, 'the lake bed has no turf');
  const rise = ISLAND_PLACES.rise.summit;
  const hill = paint(rise.x, rise.z);
  assert.ok(hill.stone > 0.3 && hill.grass < 0.7, 'the rise is rocky');
  const meadow = paint(ISLAND_START.x, ISLAND_START.z);
  assert.ok(meadow.grass === 1 && meadow.stone === 0 && meadow.gravel === 0, 'the meadow keeps its turf');
});

test('features are optional: the same island without them is exactly the old one', () => {
  const plain = buildIsland(270);
  const same = buildIsland(270, SKY_ISLAND, null);
  assert.equal(plain.positions.length, same.positions.length);
  for (let i = 0; i < plain.positions.length; i += 997) assert.equal(plain.positions[i], same.positions[i]);
  // the shape's own rock patches are stone now (zone.y below zero); the underside keeps its warm strata (zone.x)
  let stone = 0, strata = 0;
  for (let v = 0; v < plain.vertexCount; v++) { if (plain.zones[v * 3 + 1] < -0.5) stone++; if (plain.zones[v * 3] > 0.5) strata++; }
  assert.ok(stone > 100 && strata > 10000, `${stone} stone vertices and ${strata} strata vertices`);
});
