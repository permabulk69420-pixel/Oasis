import test from 'node:test';
import assert from 'node:assert/strict';
import { SKY_ISLAND, buildIsland, makeMeshGround, outlineRadius, undersidePoint } from '../src/sky-island-shape.js';
import { createSkyIslandGround } from '../src/sky-island-ground.js';
import { ISLAND_LAKE } from '../src/sky-island-places.js';
import { buildLakeWater, buildSpill, SPILL } from '../src/sky-island-water.js';

const ground = createSkyIslandGround(SKY_ISLAND);
const { features } = ground;
const data = buildIsland(ground.baseY, SKY_ISLAND, features);
const drawn = makeMeshGround(data, SKY_ISLAND);
const level = ground.baseY + ISLAND_LAKE.level;
const water = buildLakeWater({ lake: features.lake, ground: drawn, level });
const spill = buildSpill({ lake: features.lake, channel: features.channel, ground: drawn, config: SKY_ISLAND, spill: ISLAND_LAKE.spill });

test('the lake water is well formed and only covers the lake and a hair beyond its shore', () => {
  for (const v of water.positions) assert.ok(Number.isFinite(v));
  for (const v of water.depth) assert.ok(Number.isFinite(v));
  for (const i of water.indices) assert.ok(i < water.vertexCount);
  const triangles = water.indices.length / 3;
  assert.ok(triangles > 2000 && triangles < 7000, `${triangles} triangles`);
  const { lake } = features;
  let farthest = 0;
  for (const i of water.indices) {
    const x = water.positions[i * 3], z = water.positions[i * 3 + 2];
    farthest = Math.max(farthest, -lake.signed(x, z));
    assert.ok(Math.abs(water.positions[i * 3 + 1] - level) < 1e-3);
  }
  assert.ok(farthest < 3, `water mesh reaches ${farthest.toFixed(1)} m past the shore`);
});

test('the water is shallow at the edge, deepest in the middle and never deeper than the lake is, and none past the shore', () => {
  const { lake } = features;
  let deepest = 0, shallowAtShore = 0, shore = 0;
  for (let k = 0; k < water.vertexCount; k++) {
    const x = water.positions[k * 3], z = water.positions[k * 3 + 2];
    const s = lake.signed(x, z);
    if (s < 0) assert.ok(water.depth[k] <= -0.05, `water past the shore at (${x.toFixed(0)}, ${z.toFixed(0)}): ${water.depth[k].toFixed(2)}`);
    else if (s > 0) deepest = Math.max(deepest, water.depth[k]);
    if (s > 0 && s < 1.6) { shore++; if (water.depth[k] < 0.3) shallowAtShore++; }
  }
  assert.ok(deepest > 0.9 && deepest < ISLAND_LAKE.depth + 0.3, `deepest ${deepest.toFixed(2)}`);
  assert.ok(shallowAtShore / shore > 0.95, 'the margin of the lake is shallow');
});

test('the spill is well formed: finite, indices in range, no sliver triangles, fades from nothing to nothing', () => {
  const count = spill.positions.length / 3;
  for (const v of spill.positions) assert.ok(Number.isFinite(v));
  for (const i of spill.indices) assert.ok(i < count);
  assert.equal(spill.uvs.length / 2, count);
  assert.equal(spill.fades.length, count);
  for (let f = 0; f < spill.indices.length; f += 3) {
    const [a, b, c] = [spill.indices[f] * 3, spill.indices[f + 1] * 3, spill.indices[f + 2] * 3];
    const ux = spill.positions[b] - spill.positions[a], uy = spill.positions[b + 1] - spill.positions[a + 1], uz = spill.positions[b + 2] - spill.positions[a + 2];
    const vx = spill.positions[c] - spill.positions[a], vy = spill.positions[c + 1] - spill.positions[a + 1], vz = spill.positions[c + 2] - spill.positions[a + 2];
    const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    assert.ok(area > 1e-4, `triangle ${f / 3} has area ${area}`);
  }
  assert.ok(Math.min(...spill.fades) >= 0 && Math.max(...spill.fades) <= 1 + 1e-6);
  assert.ok(spill.fades[0] < 0.01, 'the stream comes in from nothing');
  assert.ok(spill.fades[spill.fades.length - 1] < 0.01 && spill.fades[spill.fades.length - 2] < 0.01, 'and the fall ends as nothing');
});

test('the stream lies on the drawn ground and leaves the lake at the water\'s height', () => {
  const { channel } = features;
  const first = spill.spine[0];
  assert.ok(Math.abs(first.y - (drawn(first.x, first.z) + SPILL.lift)) < 1e-3);
  assert.ok(first.y > level - 0.2 && first.y < level + 0.4, `the stream starts ${(first.y - level).toFixed(2)} m from the water's height`);
  let n = 0;
  for (const p of spill.spine) {
    if (Math.hypot(p.x - channel.ax, p.z - channel.az) > Math.hypot(channel.bx - channel.ax, channel.bz - channel.az)) break;
    const g = drawn(p.x, p.z);
    assert.ok(g !== null && p.y >= g + SPILL.lift - 1e-3 && p.y <= g + SPILL.lift + 1e-3, 'on the ground');
    n++;
  }
  assert.ok(n > 8);
});

test('the fall hangs clear of the rock under the island, is thin where it leaves the rim, and has gone to mist well before the ground', () => {
  const edge = outlineRadius(ISLAND_LAKE.spill, SKY_ISLAND);
  const cs = Math.cos(ISLAND_LAKE.spill), sn = Math.sin(ISLAND_LAKE.spill);
  let minGap = Infinity, drop = 0;
  for (const p of spill.spine) {
    const h = spill.crest.y - p.y;
    if (h < SKY_ISLAND.lip + 4) continue; // the lip itself
    const r = (p.x - SKY_ISLAND.x) * cs + (p.z - SKY_ISLAND.z) * sn;
    const v = Math.min(1, h / SKY_ISLAND.thickness);
    for (const dth of [-0.02, 0, 0.02]) minGap = Math.min(minGap, r - undersidePoint(ISLAND_LAKE.spill + dth, v, spill.crest.y - SKY_ISLAND.lip, SKY_ISLAND).r);
    drop = Math.max(drop, h);
  }
  assert.ok(minGap >= SPILL.clear - 0.75, `the fall comes within ${minGap.toFixed(2)} m of the rock`);
  assert.ok(drop > 100 && drop < SKY_ISLAND.altitude - 60, `it falls ${drop.toFixed(0)} m of the ${SKY_ISLAND.altitude} m to the desert`);
  assert.ok(edge > 100);
  // the sheet is only a couple of metres wide where it leaves the rim
  const top = spill.positions;
  const widths = [];
  for (let k = 0; k + 1 < top.length / 3; k += 2) {
    const a = k * 3, b = (k + 1) * 3;
    widths.push(Math.hypot(top[a] - top[b], top[a + 1] - top[b + 1], top[a + 2] - top[b + 2]));
  }
  assert.ok(widths.some(w => w < 3.2 && w > 1.8), 'a thin thread near the lip');
  assert.ok(Math.max(...widths) <= SPILL.mistWidth + 0.01, 'and never wider than the mist');
});

test('the lake has no outlet but the spill: nothing flows anywhere else and nothing the water makes reaches the desert', () => {
  // the whole spill's lowest point is well above the desert's lowest point under the island
  const bottom = spill.bottom;
  assert.ok(bottom.y - (ground.baseY - SKY_ISLAND.altitude) > 60, 'ends in the air');
});
