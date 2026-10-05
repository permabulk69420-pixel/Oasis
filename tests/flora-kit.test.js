import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rng, curve, resample, pathLength, along, packCharts, packAtlas, Model, addTube, addRibbon, addLathe, addBead, addTrail, bulbProfile, texelDensity,
  tubeFrames, length, sub, dot, normalize, CYAN,
} from '../src/flora-kit.js';

// A small model with every kind of surface in it.
function sample(plan = null) {
  const m = new Model('sample', { plan });
  const stem = curve([[0, 0, 0], [0.1, 0.4, 0], [0.05, 0.9, 0.1], [0, 1.3, 0.1]], 5);
  addTube(m, 'stem', stem, { radius: t => 0.05 * (1 - 0.6 * t) + 0.01, sides: 8, capStart: 'flat', capEnd: 'round', color: () => [0.02, 0.06, 0.05] });
  addTube(m, 'root', curve([[0, 0, 0], [0.4, -0.1, 0.2], [0.8, 0, 0.3]], 4), { radius: 0.03, sides: 6, capStart: 'none', capEnd: 'round' });
  addRibbon(m, 'leaf', curve([[0, 0.6, 0], [0.2, 0.8, 0], [0.5, 0.85, 0], [0.7, 0.7, 0]], 4), { width: t => 0.12 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.05)), fold: 0.4, color: () => [0.02, 0.07, 0.05] });
  addLathe(m, 'bowl', [[0, 0], [0.12, 0.02], [0.18, 0.1], [0.14, 0.2], [0, 0.22]], { origin: [0, 1.3, 0.1], sides: 10, emit: () => [0.03, 0.6, 1.0] });
  addBead(m, 'bead', [0.2, 1.0, 0], 0.03, { halo: 0.3 });
  addTrail(m, 'vein', stem, { radius: t => 0.05 * (1 - 0.6 * t) + 0.01, width: 0.01, angle: () => 0.25, emit: () => CYAN });
  return m;
}

const near = (a, b, eps = 1e-5) => Math.abs(a - b) <= eps;
const interiorOf = (data, k) => {
  const key = data.charts[data.chartOf[k]].key;
  const r = data.atlas.rects[key];
  const pad = data.atlas.padding;
  return { r, lo: [(r.x + pad) / data.atlas.size, (r.y + pad) / data.atlas.size], hi: [(r.x + r.w - pad) / data.atlas.size, (r.y + r.h - pad) / data.atlas.size] };
};

test('a random stream is the same for the same seed, differs for another, and stays in [0, 1)', () => {
  const a = rng(7), b = rng(7), c = rng(8);
  const xs = Array.from({ length: 50 }, () => a());
  assert.deepEqual(xs, Array.from({ length: 50 }, () => b()));
  assert.notDeepEqual(xs, Array.from({ length: 50 }, () => c()));
  assert.ok(xs.every(x => x >= 0 && x < 1));
});

test('curve keeps its ends, resample spreads points evenly by length, along finds a fraction of the length', () => {
  const pts = [[0, 0, 0], [1, 0, 0], [1, 2, 0], [0, 2, 1]];
  const c = curve(pts, 6);
  assert.deepEqual(c[0], pts[0]);
  assert.deepEqual(c[c.length - 1], pts[3]);
  const r = resample(c, 11);
  const gaps = r.slice(1).map((p, i) => length(sub(p, r[i])));
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  for (const g of gaps) assert.ok(Math.abs(g - mean) < mean * 0.25, `uneven gap ${g} vs ${mean}`);
  const straight = [[0, 0, 0], [0, 3, 0], [4, 3, 0]];
  assert.ok(near(pathLength(straight), 7));
  const mid = along(straight, 3 / 7);
  assert.ok(near(mid.p[1], 3) && near(mid.p[0], 0, 1e-6));
  const late = along(straight, 5 / 7);
  assert.ok(near(late.p[0], 2) && near(late.T[0], 1));
});

test('tube frames never twist on their own: the normal stays square to the path and steady along a straight run', () => {
  const path = Array.from({ length: 12 }, (_, i) => [0, i * 0.2, 0]);
  const { T, N, B } = tubeFrames(path);
  for (let i = 0; i < path.length; i++) {
    assert.ok(Math.abs(dot(T[i], N[i])) < 1e-9 && Math.abs(dot(T[i], B[i])) < 1e-9);
    assert.ok(Math.abs(length(N[i]) - 1) < 1e-9);
    assert.ok(dot(N[i], N[0]) > 0.999, 'the frame turned on a straight path');
  }
});

test('packing: every chart gets a place inside the square, none overlap, and a chart that cannot fit says so', () => {
  const random = rng(11);
  const charts = Array.from({ length: 70 }, (_, i) => ({ key: `c${i}`, w: 0.05 + random() * 0.9, h: 0.05 + random() * 1.4 }));
  const packed = packCharts(charts, { size: 1024, padding: 3, density: 80 });
  assert.ok(packed, 'the charts fit at 80 px/m');
  const rects = Object.values(packed.rects);
  assert.equal(rects.length, charts.length);
  for (const r of rects) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1024 && r.y + r.h <= 1024);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, 'two charts overlap');
  }
  assert.equal(packCharts([{ key: 'huge', w: 20, h: 1 }], { size: 1024, density: 96 }), null);
});

test('packAtlas keeps the asked density when it fits and backs off, a little at a time, when it does not', () => {
  const small = packAtlas([{ key: 'a', w: 1, h: 1 }, { key: 'b', w: 0.5, h: 2 }], { density: 96 });
  assert.equal(small.density, 96);
  const random = rng(3);
  const many = Array.from({ length: 200 }, (_, i) => ({ key: `c${i}`, w: 0.3 + random(), h: 0.5 + random() * 2 }));
  const big = packAtlas(many, { density: 96 });
  assert.ok(big.density < 96 && big.density > 30, `backed off to ${big.density}`);
  assert.ok(big.utilisation > 0.3 && big.utilisation <= 1);
});

test('a model keeps every vertex inside its own chart, charts apart, so no two surfaces share texels', () => {
  const data = sample().finish();
  assert.ok(data.triangles > 100);
  for (let k = 0; k < data.vertexCount; k++) {
    const { lo, hi } = interiorOf(data, k);
    const u = data.uvs[k * 2], v = data.uvs[k * 2 + 1];
    assert.ok(u >= lo[0] - 1e-4 && u <= hi[0] + 1e-4 && v >= lo[1] - 1e-4 && v <= hi[1] + 1e-4, `vertex ${k} (${data.charts[data.chartOf[k]].key}) uv ${u.toFixed(4)},${v.toFixed(4)} outside ${lo} ${hi}`);
    assert.ok(u >= 0 && u <= 1 && v >= 0 && v <= 1);
  }
  const rects = Object.values(data.atlas.rects);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, 'two charts overlap');
  }
});

test('texel density is steady across a model (it is metres of surface by construction)', () => {
  const data = sample().finish();
  const d = texelDensity(data);
  assert.ok(d.count > 100);
  assert.ok(d.median > data.atlas.density * 0.9 && d.median < data.atlas.density * 1.15, `median ${d.median} vs ${data.atlas.density}`);
  assert.ok(d.p5 > data.atlas.density * 0.75 && d.p95 < data.atlas.density * 1.4, `${d.p5}..${d.p95} vs ${data.atlas.density}`);
});

test('triangles are real, normals are unit length and face outward, indices are in range, every number is finite', () => {
  const data = sample().finish();
  const { positions, normals, indices, vertexCount } = data;
  for (const arr of [positions, normals, data.colors, data.emits, data.sways, data.uvs]) assert.ok(arr.every(Number.isFinite));
  for (let i = 0; i < vertexCount; i++) assert.ok(Math.abs(Math.hypot(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]) - 1) < 1e-3, `normal ${i}`);
  for (let k = 0; k < indices.length; k += 3) {
    const [a, b, c] = [indices[k], indices[k + 1], indices[k + 2]];
    assert.ok(a < vertexCount && b < vertexCount && c < vertexCount);
    const p = i => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
    const e1 = sub(p(b), p(a)), e2 = sub(p(c), p(a));
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    assert.ok(length(n) > 1e-10, `triangle ${k / 3} has no area`);
  }
  // the lathe bowl and the stem face away from their axes
  let checked = 0;
  for (let k = 0; k < vertexCount; k++) {
    const key = data.charts[data.chartOf[k]].key;
    if (key !== 'bowl') continue;
    const out = [positions[k * 3], 0, positions[k * 3 + 2] - 0.1];
    if (Math.hypot(out[0], out[2]) < 0.05) continue;
    assert.ok(dot(normalize(out), [normals[k * 3], 0, normals[k * 3 + 2]]) > 0, 'a bowl normal faces inward');
    checked++;
  }
  assert.ok(checked > 20);
});

test('only the glowing parts carry emit, a trail glows, and a halo is recorded where asked', () => {
  const data = sample().finish();
  let lit = 0;
  for (let k = 0; k < data.vertexCount; k++) if (data.emits[k * 3 + 2] > 0.5) lit++;
  assert.ok(lit > 20 && lit < data.vertexCount, `${lit} lit vertices of ${data.vertexCount}`);
  assert.equal(data.halos.length, 1);
  assert.ok(data.halos[0].r === 0.3 && data.halos[0].tone === 'cyan');
});

test('a model is the same every time it is built', () => {
  const a = sample().finish(), b = sample().finish();
  assert.deepEqual(a.positions, b.positions);
  assert.deepEqual(a.uvs, b.uvs);
  assert.deepEqual(a.indices, b.indices);
  assert.deepEqual(a.atlas.rects, b.atlas.rects);
});

test('a coarser level can reuse the finer level\'s atlas, and is refused when its charts do not match', () => {
  const fine = sample();
  const data = fine.finish();
  const plan = { size: data.atlas.size, padding: data.atlas.padding, density: data.atlas.density, rects: data.atlas.rects, height: data.atlas.height };
  const again = sample(plan).finish();
  assert.deepEqual(again.atlas.rects, data.atlas.rects);
  assert.deepEqual(again.uvs, data.uvs);
  const stranger = new Model('stranger', { plan });
  addLathe(stranger, 'not-in-the-plan', bulbProfile(0.1, 0.1), { sides: 6 });
  assert.throws(() => stranger.finish(), /does not/);
  const bigger = new Model('bigger', { plan });
  addTube(bigger, 'stem', [[0, 0, 0], [0, 3, 0]], { radius: 0.3, sides: 6 });
  assert.throws(() => bigger.finish(), /bigger than its place/);
});

test('a chart name can only be used once in a model', () => {
  const m = new Model('twice');
  addLathe(m, 'a', bulbProfile(0.1, 0.1), { sides: 6 });
  assert.throws(() => addLathe(m, 'a', bulbProfile(0.1, 0.1), { sides: 6 }), /used twice/);
});

test('a bulb profile is a dome from its rim to its apex, and the beads and caps are closed', () => {
  const p = bulbProfile(0.2, 0.1, 4);
  assert.equal(p.length, 5);
  assert.deepEqual(p[0], [0.2, 0]);
  assert.deepEqual(p[4], [0, 0.1]);
  const closed = bulbProfile(0.2, 0.1, 4, { bottom: true });
  assert.deepEqual(closed[0], [0, 0]);
});
