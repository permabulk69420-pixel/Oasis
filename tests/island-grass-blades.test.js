import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createIslandPatchGeometry, ISLAND_RICH_BLADES, ISLAND_LITE_BLADES, ISLAND_RICH_TRIANGLES, ISLAND_LITE_TRIANGLES, BLADE_ROOT, BLADE_TIP,
} from '../src/island-grass-blades.js';
import { makeGrassChunk } from '../src/island-grass.js';

const lum = (c, k) => 0.3 * c[k * 3] + 0.59 * c[k * 3 + 1] + 0.11 * c[k * 3 + 2];

test('the island blade patch has the triangle counts its stats assume, and is the same every time', () => {
  for (const [blades, segments, rich, tris] of [[ISLAND_RICH_BLADES, 2, true, ISLAND_RICH_TRIANGLES], [ISLAND_LITE_BLADES, 1, false, ISLAND_LITE_TRIANGLES]]) {
    const a = createIslandPatchGeometry(blades, segments, rich), b = createIslandPatchGeometry(blades, segments, rich);
    assert.equal(a.index.count / 3, tris);
    assert.equal(a.attributes.position.count, blades * (segments + 1) * 2);
    assert.deepEqual(a.attributes.position.array, b.attributes.position.array, 'no randomness between builds');
    assert.equal(a.attributes.color.count, a.attributes.position.count, 'a colour for every vertex');
  }
});

test('every blade rises from the ground to a point no higher than 0.6 m and is darker at the root than at the tip', () => {
  for (const [blades, segments, rich] of [[ISLAND_RICH_BLADES, 2, true], [ISLAND_LITE_BLADES, 1, false]]) {
    const g = createIslandPatchGeometry(blades, segments, rich), pos = g.attributes.position.array, col = g.attributes.color.array, per = (segments + 1) * 2;
    const heights = [];
    for (let blade = 0; blade < blades; blade++) {
      let last = -1;
      for (let row = 0; row <= segments; row++) {
        const v = blade * per + row * 2;
        assert.ok(pos[v * 3 + 1] > last - 1e-9, 'a blade only rises along its length (the arch never folds back)');
        last = pos[v * 3 + 1];
        assert.ok(pos[v * 3 + 1] >= 0);
      }
      assert.equal(pos[blade * per * 3 + 1], 0, 'the root is on the ground');
      assert.ok(last > 0.1 && last <= 0.6, `blade ${blade} is ${last.toFixed(2)} m`);
      heights.push(last);
      const tipV = blade * per + segments * 2;
      assert.ok(lum(col, tipV) > lum(col, blade * per) * 1.5, 'lighter at the tip');
      // it tapers to a point: the tip is much narrower than the root
      const width = v => Math.hypot(pos[v * 3] - pos[(v + 1) * 3], pos[v * 3 + 2] - pos[(v + 1) * 3 + 2]);
      assert.ok(width(tipV) < width(blade * per) * 0.2, 'a point');
    }
    assert.ok(Math.max(...heights) > Math.min(...heights) * 1.4, 'short, ordinary and tall blades in one patch');
  }
  assert.ok(BLADE_ROOT.every((c, k) => c < BLADE_TIP[k]), 'the gradient runs dark to light');
});

test('the grass is clumped: thick stands and thin places, never an even carpet, and never bare', () => {
  const ground = () => 10, cover = () => 1;
  const counts = [];
  for (let cx = -6; cx < 6; cx++) for (let cz = -6; cz < 6; cz++) counts.push(makeGrassChunk(cx, cz, { ground, cover, thick: () => 0.3 }).count);
  const mean = counts.reduce((s, n) => s + n, 0) / counts.length;
  const sd = Math.sqrt(counts.reduce((s, n) => s + (n - mean) ** 2, 0) / counts.length);
  assert.ok(sd > mean * 0.08, `chunk counts vary (mean ${mean.toFixed(1)}, sd ${sd.toFixed(1)})`);
  assert.ok(Math.max(...counts) > Math.min(...counts) * 1.3, 'thick stands and thin places');
  assert.ok(Math.min(...counts) > 20, 'no chunk of the open meadow is bare');
});
