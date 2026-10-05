import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CardModel, arch, SPRITES, ATLAS_SIZE, LEAF_ATTACH } from '../src/foliage-cards.js';

const painted = JSON.parse(readFileSync(new URL('../public/textures/island-leaves/sprites.json', import.meta.url), 'utf8'));
const len = v => Math.hypot(...v);

test('the sprite table says where the painter put every leaf (the painter writes sprites.json, this keeps the two in step)', () => {
  for (const atlas of Object.keys(SPRITES)) {
    assert.ok(painted[atlas], `the painter has no atlas ${atlas}`);
    for (const [name, rect] of Object.entries(SPRITES[atlas])) {
      assert.deepEqual(painted[atlas][name], rect, `${atlas}/${name}`);
      const [x, y, w, h] = rect;
      assert.ok(x >= 0 && y >= 0 && x + w <= ATLAS_SIZE && y + h <= ATLAS_SIZE, `${atlas}/${name} is inside the atlas`);
    }
  }
  for (const atlas of Object.keys(painted)) if (atlas !== 'size') assert.ok(SPRITES[atlas], `the painter made ${atlas}, which the table does not know`);
});

test('a leaf card is a strip along its path: one row of quads a segment, uvs inside its sprite, normals of length one', () => {
  const m = new CardModel('test', 'fern');
  const path = arch([0, 0, 0], [1, 0, 0], 1.2, 0.8, 1.5, 6);
  m.card('sword', path, { width: 0.6, across: [0, 0, 1], cols: 3 });
  const f = m.finish();
  assert.equal(f.vertexCount, 6 * 3);
  assert.equal(f.triangles, 5 * 2 * 2);
  assert.equal(f.groups, null, 'no bark: one material');
  const [rx, ry, rw, rh] = SPRITES.fern.sword;
  for (let i = 0; i < f.vertexCount; i++) {
    const u = f.uvs[i * 2] * ATLAS_SIZE, v = (1 - f.uvs[i * 2 + 1]) * ATLAS_SIZE;
    assert.ok(u >= rx && u <= rx + rw && v >= ry && v <= ry + rh, 'inside the sprite');
    assert.ok(Math.abs(len([f.normals[i * 3], f.normals[i * 3 + 1], f.normals[i * 3 + 2]]) - 1) < 1e-4);
  }
  for (const k of f.indices) assert.ok(k < f.vertexCount);
  // the strip is as wide as asked and as long as its path
  const a = [f.positions[0], f.positions[1], f.positions[2]], b = [f.positions[6], f.positions[7], f.positions[8]];
  assert.ok(Math.abs(len([a[0] - b[0], a[1] - b[1], a[2] - b[2]]) - 0.6) < 1e-4);
});

test('base to tip runs up the sprite: the first row is its bottom edge, the last row its top edge', () => {
  const m = new CardModel('test', 'broadleaf');
  m.card('heart', [[0, 0, 0], [0, 0.5, 0.2], [0, 0.9, 0.5]], { width: 0.5, across: [1, 0, 0], cols: 2 });
  const f = m.finish();
  const [, ry, , rh] = SPRITES.broadleaf.heart;
  const vAt = i => (1 - f.uvs[i * 2 + 1]) * ATLAS_SIZE;
  assert.ok(Math.abs(vAt(0) - (ry + rh)) < 1.0, 'the base is the sprite bottom');
  assert.ok(Math.abs(vAt(f.vertexCount - 1) - ry) < 1.0, 'the tip is the sprite top');
});

test('an unknown atlas or sprite is an error, not a silent blank', () => {
  assert.throws(() => new CardModel('x', 'nothing'));
  const m = new CardModel('x', 'fern');
  assert.throws(() => m.card('missing', [[0, 0, 0], [0, 1, 0]], { width: 1 }));
  assert.throws(() => m.stem([[0, 0, 0], [0, 1, 0]], 0.02), /swatch/);
});

test('a stalk takes its colour from the atlas swatch', () => {
  const m = new CardModel('x', 'broadleaf');
  m.stem([[0, 0, 0], [0.05, 0.4, 0], [0.2, 0.8, 0]], 0.02, { sides: 4 });
  const f = m.finish();
  const [rx, ry, rw, rh] = SPRITES.broadleaf.stem;
  for (let i = 0; i < f.vertexCount; i++) {
    const u = f.uvs[i * 2] * ATLAS_SIZE, v = (1 - f.uvs[i * 2 + 1]) * ATLAS_SIZE;
    assert.ok(u >= rx && u <= rx + rw && v >= ry && v <= ry + rh);
  }
  assert.ok(LEAF_ATTACH.heart > 0, 'a heart is attached above its bottom edge (its lobes)');
});

test('a trunk is a tube wearing the bark photo: outward normals, tiling uvs, and the bark is the second material group', () => {
  const m = new CardModel('x', 'canopy');
  const path = [[0, -0.4, 0], [0, 1, 0], [0.1, 4, 0], [0.3, 9, 0.1]];
  m.trunk(path, { radius: t => 1 - 0.5 * t, sides: 9, repeats: 3 });
  m.card('broad', [[0, 10, 0], [0, 10.5, 1]], { width: 2, cols: 2 });
  const f = m.finish();
  assert.equal(f.vertexCount, 4 * 10 + 2 * 2, 'a ring of sides + 1 (the seam repeats) a station, then the card');
  assert.deepEqual(f.groups.map(g => g.material), [0, 1]);
  assert.equal(f.groups[0].start, 0);
  assert.equal(f.groups[1].start, f.groups[0].count, 'the bark follows the cards');
  assert.equal(f.groups[0].count + f.groups[1].count, f.indices.length);
  assert.equal(f.triangles, f.indices.length / 3);
  const cardVerts = 4;
  for (let i = cardVerts; i < f.vertexCount; i++) {
    const p = [f.positions[i * 3], f.positions[i * 3 + 1], f.positions[i * 3 + 2]], n = [f.normals[i * 3], f.normals[i * 3 + 1], f.normals[i * 3 + 2]];
    assert.ok(Math.abs(len(n) - 1) < 1e-4);
    // outward: away from the trunk's own axis (it leans, so compare with the nearest station)
    const centre = path.reduce((best, c) => (Math.abs(c[1] - p[1]) < Math.abs(best[1] - p[1]) ? c : best));
    assert.ok((p[0] - centre[0]) * n[0] + (p[2] - centre[2]) * n[2] > 0, 'outward');
    const u = f.uvs[i * 2];
    assert.ok(u >= 0 && u <= 3 + 1e-6, 'u runs 0 to the repeat count round the tube');
  }
  // the seam: first and last vertex of a ring sit in the same place and are a whole repeat apart
  const a = cardVerts, b = cardVerts + 9;
  assert.ok(Math.hypot(f.positions[a * 3] - f.positions[b * 3], f.positions[a * 3 + 1] - f.positions[b * 3 + 1], f.positions[a * 3 + 2] - f.positions[b * 3 + 2]) < 1e-9);
  assert.equal(f.uvs[b * 2] - f.uvs[a * 2], 3);
  // v grows up the trunk
  assert.ok(f.uvs[(cardVerts + 3 * 10) * 2 + 1] > f.uvs[(cardVerts + 10) * 2 + 1]);
});

test('buttress ridges push the foot out where a lobe is and not high up', () => {
  const plain = new CardModel('p', 'canopy'), flared = new CardModel('f', 'canopy');
  const path = [[0, -0.3, 0], [0, 1, 0], [0, 3, 0], [0, 8, 0]];
  const opts = { radius: 1, sides: 24 };
  plain.trunk(path, opts);
  flared.trunk(path, { ...opts, buttress: { count: 4, reach: 2, height: 5, power: 2, phase: 0, sharp: 3 } });
  const reach = f => { let m = [0, 0, 0, 0]; for (let i = 0; i < f.vertexCount; i++) { const y = f.positions[i * 3 + 1], k = y < 0 ? 0 : y < 2 ? 1 : y < 4 ? 2 : 3; m[k] = Math.max(m[k], Math.hypot(f.positions[i * 3], f.positions[i * 3 + 2])); } return m; };
  const a = reach(plain.finish()), b = reach(flared.finish());
  assert.ok(b[1] > a[1] * 1.8, `foot reaches ${b[1].toFixed(2)} m against ${a[1].toFixed(2)}`);
  assert.ok(b[3] < a[3] * 1.01, 'the top of the trunk is unchanged');
});

test('an oval section stands on its edge when told which way is up (a root fin)', () => {
  const m = new CardModel('x', 'canopy');
  m.trunk([[0.5, 1.5, 0], [1.5, 1.5, 0], [2.5, 1.5, 0]], { radius: () => [0.2, 1.4], frameUp: [0, 1, 0], sides: 8 });
  const f = m.finish();
  let width = 0, height = 0;
  for (let i = 0; i < 9; i++) { width = Math.max(width, Math.abs(f.positions[i * 3 + 2])); height = Math.max(height, Math.abs(f.positions[i * 3 + 1] - 1.5)); }
  assert.ok(Math.abs(width - 0.2) < 1e-6 && Math.abs(height - 1.4) < 0.05, `${width} wide, ${height} high`);
});

test('an arch leaves its base along the direction, rises, and bends down by the droop', () => {
  const p = arch([0, 1, 0], [1, 0, 0], 0.6, 1.2, 2, 9);
  assert.equal(p.length, 9);
  assert.deepEqual(p[0], [0, 1, 0]);
  assert.ok(p[1][0] > 0 && p[1][1] > 1, 'it starts out and up');
  assert.ok(p[8][1] < Math.max(...p.map(q => q[1])), 'then comes down at the tip');
  assert.ok(Math.abs(p.reduce((s, q, i) => (i ? s + len([q[0] - p[i - 1][0], q[1] - p[i - 1][1], q[2] - p[i - 1][2]]) : 0), 0) - 2) < 1e-6, 'two metres long');
});
