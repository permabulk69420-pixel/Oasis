import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeightField } from '../src/world.js';
import { layoutFinds, footprintOf, heightOf } from '../src/desert-finds.js';
import { MOTES, layoutMotes, lifeOf } from '../src/crystal-motes.js';

const field = createHeightField();
const { nodes } = layoutFinds({ heightAt: field.sample });
const crystals = nodes.filter(node => node.kind === 'crystal');
const layout = layoutMotes(nodes);

test('only crystals get motes, a fixed number for each variant', () => {
  const expected = crystals.reduce((sum, node) => sum + MOTES.perNode[node.variant], 0);
  assert.equal(layout.count, expected);
  assert.equal(layout.ranges.length, crystals.length);
  assert.ok(layout.count > 300 && layout.count < 1200, `${layout.count} motes in all: one cheap draw, but not a flood`);
  let next = 0;
  for (const range of layout.ranges) {
    assert.equal(range.node.kind, 'crystal');
    assert.equal(range.start, next, 'ranges follow one another with no gap');
    assert.equal(range.count, MOTES.perNode[range.node.variant]);
    next += range.count;
  }
  assert.equal(next, layout.count);
});

test('the layout is the same every time, and a different seed moves them', () => {
  const again = layoutMotes(nodes);
  assert.deepEqual(Array.from(again.positions), Array.from(layout.positions));
  const other = layoutMotes(nodes, { seed: MOTES.seed + 1 });
  assert.notDeepEqual(Array.from(other.positions), Array.from(layout.positions));
});

test('every mote starts on its own crystal: inside the footprint and between the foot and the tip', () => {
  for (const { node, start, count } of layout.ranges) {
    const reach = footprintOf('crystal', node.variant) * node.scale * MOTES.spreadShare;
    const top = heightOf('crystal', node.variant) * node.scale;
    for (let i = start; i < start + count; i++) {
      const dx = layout.positions[i * 3] - node.x, dz = layout.positions[i * 3 + 2] - node.z;
      const up = layout.positions[i * 3 + 1] - node.y;
      assert.ok(Math.hypot(dx, dz) <= reach + 1e-3, `${node.id} mote ${i - start} is ${Math.hypot(dx, dz).toFixed(2)} m out (reach ${reach.toFixed(2)})`);
      assert.ok(up >= top * MOTES.startHeight[0] - 1e-3 && up <= top * MOTES.startHeight[1] + 1e-3, `${node.id} mote ${i - start} starts ${up.toFixed(2)} m up`);
    }
  }
});

test('rise, size and seed stay inside the table, and about one mote in five is cyan', () => {
  const sqrtScaleOf = new Float32Array(layout.count);
  for (const { node, start, count } of layout.ranges) sqrtScaleOf.fill(Math.sqrt(node.scale), start, start + count);
  for (let i = 0; i < layout.count; i++) {
    assert.ok(layout.seeds[i] >= 0 && layout.seeds[i] < 1);
    assert.ok(layout.rises[i] >= MOTES.rise[0] * sqrtScaleOf[i] - 1e-4 && layout.rises[i] <= MOTES.rise[1] * sqrtScaleOf[i] + 1e-4, `rise ${layout.rises[i]}`);
    assert.ok(layout.sizes[i] >= MOTES.size[0] - 1e-6 && layout.sizes[i] <= MOTES.size[1] + 1e-6);
    assert.ok(layout.cools[i] === 0 || layout.cools[i] === 1);
  }
  const share = layout.cools.reduce((sum, v) => sum + v, 0) / layout.count;
  assert.ok(Math.abs(share - MOTES.cyanShare) < 0.06, `cyan share ${share.toFixed(3)}`);
});

test('a broken crystal takes its motes with it and they come back as it grows', () => {
  assert.equal(lifeOf({ state: 'idle' }), 1);
  assert.equal(lifeOf({ state: 'breaking', grow: 1 }), 0);
  assert.equal(lifeOf({ state: 'gone', grow: 0 }), 0);
  assert.equal(lifeOf({ state: 'growing', grow: 0 }), 0);
  assert.equal(lifeOf({ state: 'growing', grow: 1 }), 1);
  const half = lifeOf({ state: 'growing', grow: 0.5 });
  assert.ok(half > 0.5 && half < 1, 'eases out: more than half there at half grown');
  assert.equal(lifeOf({ state: 'growing' }), 0, 'a missing grow counts as not grown');
});

test('a world with no crystals is fine', () => {
  const none = layoutMotes(nodes.filter(node => node.kind !== 'crystal'));
  assert.equal(none.count, 0);
  assert.equal(none.positions.length, 0);
});
