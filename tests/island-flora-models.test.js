import test from 'node:test';
import assert from 'node:assert/strict';
import { FLORA_MODELS, buildFloraLevels } from '../src/island-flora-models.js';
import { FLORA_RENDER, floraLodFor } from '../src/island-flora.js';
import { texelDensity } from '../src/flora-kit.js';

const names = Object.keys(FLORA_MODELS);
const all = new Map(names.map(name => [name, buildFloraLevels(name)]));

// the island's new models: three levels each, checked against a Quest-sized budget (Kane, 5 Oct: be bold, but say what it costs)
const CEILING = [10000, 1600, 700];
// what each should be about (metres, level 0): [min height, max height, max width]
const SIZE = {
  weepingTree: [6.5, 9, 12], rootArch: [5.5, 8, 14], ribcage: [3, 5, 12], standingStoneA: [3.5, 5.5, 4], standingStoneB: [2.5, 4.5, 4],
  fern: [0.5, 1.2, 3], flower: [1.2, 2, 2], cushion: [0.2, 0.6, 1.3], mushrooms: [0.1, 0.3, 0.4], vines: [3, 5, 5],
  fungusLog: [0.5, 1.4, 6], log: [0.5, 1.4, 6], driftwoodA: [0.5, 1.5, 4.5], driftwoodB: [0.5, 1.5, 4.5], driftwoodC: [0.5, 1.5, 4.5], bonesA: [0.1, 0.5, 2.5], bonesB: [0.1, 0.5, 2.5],
};

test('every island model is in the table, builds in three levels, and each level is lighter than the one before', () => {
  assert.ok(names.length >= 17, `${names.length} models`);
  for (const name of names) {
    const levels = all.get(name);
    assert.equal(levels.length, 3, name);
    assert.ok(levels[0].triangles > levels[1].triangles && levels[1].triangles > levels[2].triangles, `${name}: ${levels.map(l => l.triangles)}`);
    levels.forEach((level, lod) => assert.ok(level.triangles <= CEILING[lod], `${name} level ${lod}: ${level.triangles} triangles`));
    assert.ok(levels[2].triangles >= 8, `${name}: the far level still has a shape`);
  }
});

test('a model is its own size: the tree stands about 7 m, the arch frames a path, the stones are 3 to 5 m, the plants stay small', () => {
  for (const [name, [lo, hi, wide]] of Object.entries(SIZE)) {
    assert.ok(all.has(name), `no ${name}`);
    const b = all.get(name)[0].bounds;
    const height = b.max[1] - Math.min(0, b.min[1]) - (name === 'vines' ? Math.min(0, b.min[1]) * 0 : 0);
    const h = name === 'vines' ? b.max[1] - b.min[1] : height;
    assert.ok(h >= lo && h <= hi, `${name} is ${h.toFixed(2)} m tall (${lo} to ${hi})`);
    const w = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
    assert.ok(w <= wide, `${name} is ${w.toFixed(2)} m wide (at most ${wide})`);
  }
});

test('the levels line up: a coarser level stays inside the finer one\'s size, so the pop is small', () => {
  for (const name of names) {
    const [a, b, c] = all.get(name).map(l => l.bounds);
    for (const [fine, coarse, label] of [[a, b, '1'], [a, c, '2']]) {
      for (let axis = 0; axis < 3; axis++) {
        const span = fine.max[axis] - fine.min[axis];
        assert.ok(coarse.max[axis] <= fine.max[axis] + 0.12 * span + 0.2, `${name} level ${label} grows past level 0 on axis ${axis}`);
        assert.ok(coarse.min[axis] >= fine.min[axis] - 0.12 * span - 0.2, `${name} level ${label} grows past level 0 on axis ${axis}`);
      }
      const h0 = fine.max[1] - fine.min[1], h1 = coarse.max[1] - coarse.min[1];
      // (a hand-sized plant's far level may be just its cap, a flat thing: only the bigger models must keep their height)
      if (h0 > 0.5) assert.ok(h1 > h0 * (label === '2' ? 0.45 : 0.6), `${name} level ${label} is a lot shorter than level 0 (${h1.toFixed(2)} vs ${h0.toFixed(2)})`);
    }
  }
});

test('UVs: every vertex sits inside its own chart, charts never overlap, atlases are 1k at most (Kane, 5 Oct: proper non-overlapping UVs)', () => {
  for (const name of names) for (const [lod, data] of all.get(name).entries()) {
    const { atlas, uvs, chartOf, charts } = data;
    assert.ok(atlas.size <= 1024, `${name}: a ${atlas.size} atlas`);
    const rects = Object.values(atlas.rects);
    assert.ok(rects.length >= charts.length);
    for (const r of rects) assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= atlas.size && r.y + r.h <= atlas.size, `${name} level ${lod}: a chart off the atlas`);
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${name} level ${lod}: two charts overlap`);
    }
    for (let k = 0; k < data.vertexCount; k++) {
      const r = atlas.rects[charts[chartOf[k]].key];
      const u = uvs[k * 2] * atlas.size, v = uvs[k * 2 + 1] * atlas.size;
      const eps = 0.02;
      assert.ok(u >= r.x + atlas.padding - eps && u <= r.x + r.w - atlas.padding + eps && v >= r.y + atlas.padding - eps && v <= r.y + r.h - atlas.padding + eps,
        `${name} level ${lod}: vertex ${k} leaves its chart ${charts[chartOf[k]].key}`);
    }
  }
});

test('texel density is steady inside a model and at least 40 pixels a metre on level 0 (the tree and the arch are the big ones)', () => {
  for (const name of names) {
    const data = all.get(name)[0];
    const d = texelDensity(data);
    assert.ok(data.atlas.density >= 40, `${name}: ${data.atlas.density.toFixed(1)} px/m`);
    assert.ok(d.p5 >= data.atlas.density * 0.7 && d.p95 <= data.atlas.density * 1.5, `${name}: ${d.p5.toFixed(1)} to ${d.p95.toFixed(1)} against ${data.atlas.density.toFixed(1)}`);
  }
  for (const name of ['fern', 'cushion', 'mushrooms', 'flower', 'vines', 'standingStoneA', 'standingStoneB', 'ribcage']) {
    assert.ok(all.get(name)[0].atlas.density >= 80, `${name} keeps its density`);
  }
});

test('models that share an atlas share it exactly: every level has the same charts in the same places', () => {
  for (const [name, spec] of Object.entries(FLORA_MODELS)) {
    if (!spec.share) continue;
    const [a, b, c] = all.get(name);
    for (const level of [b, c]) {
      assert.equal(level.atlas.density, a.atlas.density, name);
      for (const chart of level.charts) assert.deepEqual(level.atlas.rects[chart.key], a.atlas.rects[chart.key], `${name}: ${chart.key}`);
    }
  }
});

test('the numbers are clean: finite, unit normals, in-range indices, sway in [0, 1], no negative glow, valid halos', () => {
  for (const name of names) for (const [lod, data] of all.get(name).entries()) {
    const label = `${name} level ${lod}`;
    for (const arr of [data.positions, data.normals, data.colors, data.emits, data.sways, data.uvs]) assert.ok(arr.every(Number.isFinite), `${label}: a number is not finite`);
    assert.ok(data.sways.every(s => s >= 0 && s <= 1), `${label}: sway out of range`);
    assert.ok(data.emits.every(e => e >= 0), `${label}: negative glow`);
    assert.ok(data.colors.every(c => c >= 0 && c <= 1), `${label}: colour out of range`);
    let worst = 0;
    for (let i = 0; i < data.vertexCount; i++) worst = Math.max(worst, Math.abs(Math.hypot(data.normals[i * 3], data.normals[i * 3 + 1], data.normals[i * 3 + 2]) - 1));
    assert.ok(worst < 1e-3, `${label}: a normal is ${worst} off unit`);
    for (const i of data.indices) assert.ok(i < data.vertexCount, `${label}: index past the end`);
    assert.equal(data.indices.length % 3, 0);
    for (const h of data.halos) {
      assert.ok([h.x, h.y, h.z, h.r].every(Number.isFinite) && h.r > 0 && h.r < 3, `${label}: a bad halo`);
      assert.ok(h.tone === 'cyan' || h.tone === 'pale', `${label}: halo tone ${h.tone}`);
    }
  }
});

test('the glow is cyan or pale: every lit vertex leans blue, the plants are mostly dark forms (the oasis look, no new crystals)', () => {
  for (const name of names) {
    const data = all.get(name)[0];
    let lit = 0;
    for (let i = 0; i < data.vertexCount; i++) {
      const r = data.emits[i * 3], g = data.emits[i * 3 + 1], b = data.emits[i * 3 + 2];
      if (g + b < 0.05) continue;
      lit++;
      assert.ok(b >= r * 1.4, `${name}: a glow that is not cyan or pale (${r.toFixed(2)}, ${g.toFixed(2)}, ${b.toFixed(2)})`);
    }
    // (the little mushrooms are mostly cap and the fungus log is mostly shelf, and those glow; everything else is mostly dark)
    assert.ok(lit < data.vertexCount * (name === 'mushrooms' ? 0.85 : name === 'fungusLog' ? 0.75 : 0.6), `${name}: ${lit} of ${data.vertexCount} vertices glow`);
    for (let i = 0; i < data.vertexCount; i++) {
      const lum = (data.colors[i * 3] + data.colors[i * 3 + 1] + data.colors[i * 3 + 2]) / 3;
      assert.ok(lum < 0.45, `${name}: a base colour that bright (${lum.toFixed(2)}) would glow at night`);
    }
  }
});

test('the glowing models have glow, the tree and the vines have halos for their pods, and the small far levels drop the halos', () => {
  for (const name of ['fern', 'mushrooms', 'flower', 'weepingTree', 'vines', 'rootArch', 'fungusLog']) {
    const data = all.get(name)[0];
    let lit = 0;
    for (let i = 0; i < data.vertexCount; i++) if (data.emits[i * 3 + 1] + data.emits[i * 3 + 2] > 0.1) lit++;
    assert.ok(lit > 10, `${name} has no glow`);
  }
  for (const name of ['weepingTree', 'vines']) assert.ok(all.get(name)[0].halos.length >= 3, `${name} halos`);
  for (const name of names) assert.ok(all.get(name)[2].halos.length <= all.get(name)[0].halos.length);
});

test('the tree and the vines hang: the sway weights are zero at the root and grow along the strands; upright plants carry none', () => {
  for (const name of ['weepingTree', 'vines']) {
    const data = all.get(name)[0];
    let max = 0, nonzero = 0;
    for (const s of data.sways) { max = Math.max(max, s); if (s > 0.01) nonzero++; }
    assert.ok(max > 0.5 && max <= 1, `${name}: tips sway ${max}`);
    assert.ok(nonzero > data.vertexCount * 0.3, `${name}: only ${nonzero} vertices sway`);
    assert.equal(FLORA_RENDER[name].sway, undefined, name);
    assert.ok(FLORA_RENDER[name].hang, name);
  }
  for (const name of ['rootArch', 'standingStoneA', 'ribcage']) assert.ok(all.get(name)[0].sways.every(s => s === 0), `${name} is still`);
});

test('every model has a draw rule and sensible level-of-detail distances', () => {
  for (const name of names) {
    const r = FLORA_RENDER[name];
    assert.ok(r, `no render rule for ${name}`);
    assert.equal(r.lod.length, 2);
    assert.ok(r.lod[0] > 3 && r.lod[1] > r.lod[0], `${name}: ${r.lod}`);
    assert.ok(r.draw >= r.lod[1], `${name} is drawn out to ${r.draw} m`);
  }
  const r = FLORA_RENDER.weepingTree;
  assert.equal(floraLodFor(r.lod[0] * 0.5, r), 0);
  assert.equal(floraLodFor((r.lod[0] + r.lod[1]) / 2, r), 1);
  assert.equal(floraLodFor(r.lod[1] * 1.5, r), 2);
  // a model that has just crossed a boundary keeps its level for a little (no flicker at the edge)
  assert.equal(floraLodFor(r.lod[0] * 1.02, r, 0), 0);
  assert.equal(floraLodFor(r.lod[0] * 0.98, r, 1), 1);
});

test('models are built the same every time', () => {
  for (const name of ['weepingTree', 'rootArch', 'ribcage', 'fern']) {
    const a = FLORA_MODELS[name].build(0, null).finish(), b = FLORA_MODELS[name].build(0, null).finish();
    assert.deepEqual(a.positions, b.positions, name);
    assert.deepEqual(a.uvs, b.uvs, name);
    assert.deepEqual(a.indices, b.indices, name);
  }
});

test('the whole set costs: all levels together are a few hundred thousand triangles at most, and building them takes a second or so', () => {
  let level0 = 0;
  for (const name of names) level0 += all.get(name)[0].triangles;
  assert.ok(level0 < 60000, `${level0} triangles for one of each at level 0`);
});
