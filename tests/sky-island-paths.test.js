import test from 'node:test';
import assert from 'node:assert/strict';
import { SKY_ISLAND, buildIsland, makeMeshGround, outlineRadius } from '../src/sky-island-shape.js';
import { createSkyIslandGround, ISLAND_START } from '../src/sky-island-ground.js';
import { ISLAND_PLACES } from '../src/sky-island-places.js';
import { layoutPaths, createPathIndex, buildPathStrips, ISLAND_PATHS, PATH_SPEC } from '../src/sky-island-paths.js';

const ground = createSkyIslandGround(SKY_ISLAND);
const { features } = ground;
const drawn = makeMeshGround(buildIsland(ground.baseY, SKY_ISLAND, features), SKY_ISLAND);
const paths = layoutPaths(features, SKY_ISLAND);
const index = createPathIndex(paths);
const rimGap = (x, z) => outlineRadius(Math.atan2(z - SKY_ISLAND.z, x - SKY_ISLAND.x), SKY_ISLAND) - SKY_ISLAND.lip - Math.hypot(x - SKY_ISLAND.x, z - SKY_ISLAND.z);

test('the paths are laid out the same every time and are a few hundred metres of winding trail', () => {
  assert.deepEqual(layoutPaths(features, SKY_ISLAND), paths);
  assert.equal(paths.length, ISLAND_PATHS.length);
  const total = paths.reduce((s, p) => s + p.samples[p.samples.length - 1].along, 0);
  assert.ok(total > 700 && total < 1100, `${total.toFixed(0)} m of path`);
  for (const path of paths) {
    const { samples } = path;
    for (let i = 1; i < samples.length; i++) {
      const gap = Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z);
      assert.ok(gap > 0.3 && gap < PATH_SPEC.step * 1.6, `${path.name}: gap ${gap.toFixed(2)} at ${i}`);
    }
    // winding: longer than the straight line between its ends
    const a = samples[0], b = samples[samples.length - 1];
    const straight = Math.hypot(b.x - a.x, b.z - a.z);
    if (straight > 20) assert.ok(b.along > straight * 1.02, `${path.name} is a straight line`);
  }
});

test('every path stays on the top, back from the rim, out of the water, and never takes a steep line', () => {
  for (const path of paths) {
    for (let i = 0; i < path.samples.length; i++) {
      const s = path.samples[i];
      const g = drawn(s.x, s.z);
      assert.ok(g !== null, `${path.name} leaves the top at ${i}`);
      assert.ok(rimGap(s.x, s.z) >= PATH_SPEC.rimMargin - 0.8, `${path.name} is ${rimGap(s.x, s.z).toFixed(1)} m from the rim at ${i}`);
      assert.ok(features.lake.signed(s.x, s.z) <= -(PATH_SPEC.lakeMargin - 0.5), `${path.name} is in the lake at ${i}`);
      if (i > 0) {
        const p = path.samples[i - 1];
        const slope = Math.abs(g - drawn(p.x, p.z)) / Math.hypot(s.x - p.x, s.z - p.z);
        assert.ok(slope < 0.5, `${path.name} climbs ${slope.toFixed(2)} at ${i}`);
      }
    }
  }
});

test('the paths are one network: every trail meets another, and every place is on one', () => {
  const ends = [];
  paths.forEach((p, i) => { ends.push({ i, x: p.samples[0].x, z: p.samples[0].z }, { i, x: p.samples[p.samples.length - 1].x, z: p.samples[p.samples.length - 1].z }); });
  const parent = paths.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const a of ends) for (const b of ends) if (a.i !== b.i && Math.hypot(a.x - b.x, a.z - b.z) < 2.5) parent[find(a.i)] = find(b.i);
  // the meadow is open ground and the trails that leave it all start on it: the meadow joins them
  const meadow = ISLAND_PLACES.meadow;
  const onMeadow = ends.filter(e => Math.hypot(e.x - meadow.x, e.z - meadow.z) < meadow.radius);
  assert.ok(onMeadow.length >= 3, 'at least three trails leave the meadow');
  for (const a of onMeadow) parent[find(a.i)] = find(onMeadow[0].i);
  // trails may also meet in the middle of another (a junction): join by nearest sample
  for (const p of paths) for (const end of [p.samples[0], p.samples[p.samples.length - 1]]) {
    paths.forEach((q, j) => { if (q !== p && q.samples.some(s => Math.hypot(s.x - end.x, s.z - end.z) < 2.5)) parent[find(paths.indexOf(p))] = find(j); });
  }
  assert.equal(new Set(paths.map((_, i) => find(i))).size, 1, 'the trails are not all joined up');
  const near = { ...ISLAND_PLACES, lake: features.lake.toWorld(0, -28), start: ISLAND_START };
  for (const [name, p] of Object.entries(near)) {
    if (name === 'meadow') continue; // the meadow is the open start: the trails meet at its edge
    const x = p.summit?.x ?? p.x, z = p.summit?.z ?? p.z;
    assert.ok(index.nearest(x, z).distance < 30, `${name} is ${index.nearest(x, z).distance.toFixed(0)} m from any path`);
  }
  assert.ok(index.nearest(ISLAND_START.x, ISLAND_START.z).distance > 9.5, 'the start itself is not on a path');
});

test('the strips are well formed, lie on the ground, and look like turf at their edges and worn earth in the middle', () => {
  const strips = buildPathStrips(paths, { ground: drawn, features, config: SKY_ISLAND });
  assert.equal(strips.positions.length, strips.vertexCount * 3);
  for (const a of [strips.positions, strips.normals, strips.colors, strips.zones]) for (const v of a) assert.ok(Number.isFinite(v));
  for (const i of strips.indices) assert.ok(i < strips.vertexCount);
  const triangles = strips.indices.length / 3;
  assert.ok(triangles > 5000 && triangles < 14000, `${triangles} triangles`);
  for (let v = 0; v < strips.vertexCount; v++) {
    const x = strips.positions[v * 3], y = strips.positions[v * 3 + 1], z = strips.positions[v * 3 + 2];
    assert.ok(Math.abs(y - (drawn(x, z) + PATH_SPEC.lift)) < 1e-3, 'on the ground');
    assert.ok(features.lake.signed(x, z) < 0.5, 'not in the water');
    assert.ok(strips.normals[v * 3 + 1] > 0.6, 'faces up');
  }
  // up faces: every triangle's normal has y > 0
  for (let f = 0; f < strips.indices.length; f += 3) {
    const [a, b, c] = [strips.indices[f] * 3, strips.indices[f + 1] * 3, strips.indices[f + 2] * 3];
    const ux = strips.positions[b] - strips.positions[a], uz = strips.positions[b + 2] - strips.positions[a + 2];
    const vx = strips.positions[c] - strips.positions[a], vz = strips.positions[c + 2] - strips.positions[a + 2];
    assert.ok(uz * vx - ux * vz > 0, `triangle ${f / 3} faces down`);
  }
  // the middle vertices have lost most of the turf and gained stone and pebbles; the outer ones keep the ground's own look
  const across = PATH_SPEC.across.length;
  let middle = 0, edge = 0, middleGrass = 0, edgeGrass = 0;
  for (let v = 0; v < strips.vertexCount; v++) {
    const k = v % across; // rows are complete, so a vertex's place in its row is its index modulo the row
    if (k === Math.floor(across / 2)) { middle++; middleGrass += strips.colors[v * 3 + 2]; }
    if (k === 0 || k === across - 1) { edge++; edgeGrass += strips.colors[v * 3 + 2]; }
  }
  assert.ok(middleGrass / middle < 0.2, `the middle keeps ${(middleGrass / middle).toFixed(2)} of its turf`);
  assert.ok(edgeGrass / edge > 0.55, `the edges keep ${(edgeGrass / edge).toFixed(2)} of theirs`);
});

test('the strips stop at the outflow, where the path is stepping stones, and nowhere does one lie over the water', () => {
  const strips = buildPathStrips(paths, { ground: drawn, features, config: SKY_ISLAND });
  const { channel } = features;
  for (let v = 0; v < strips.vertexCount; v++) {
    const x = strips.positions[v * 3], z = strips.positions[v * 3 + 2];
    const dx = channel.bx - channel.ax, dz = channel.bz - channel.az;
    const t = Math.max(0, Math.min(1, ((x - channel.ax) * dx + (z - channel.az) * dz) / (dx * dx + dz * dz)));
    assert.ok(Math.hypot(x - (channel.ax + dx * t), z - (channel.az + dz * t)) > 1.8, 'a strip over the channel');
  }
});
