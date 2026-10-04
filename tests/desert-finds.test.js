import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeightField, SPAWN, WATER, HERO_TREE } from '../src/world.js';
import { layoutFinds, footprintOf, heightOf, groundUnder, FINDS, FINDS_VERSION, NODE_KINDS } from '../src/desert-finds.js';

const field = createHeightField();
const layout = layoutFinds({ heightAt: field.sample });
const { nodes, sites } = layout;
const away = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

test('the layout is the same every time', () => {
  const again = layoutFinds({ heightAt: field.sample });
  assert.deepEqual(again.nodes, nodes);
  assert.equal(typeof FINDS_VERSION, 'number');
});

test('there is plenty out there, of every kind, with unique ids', () => {
  assert.ok(nodes.length >= 80 && nodes.length <= 200, `${nodes.length} nodes`);
  assert.equal(new Set(nodes.map(n => n.id)).size, nodes.length, 'ids are unique');
  for (const kind of NODE_KINDS) assert.ok(nodes.filter(n => n.kind === kind).length >= 15, `${kind} count`);
  for (const node of nodes) {
    assert.match(node.id, /^[rcs]\d{2,}$/);
    assert.ok(node.scale > 0.7 && node.scale < 1.8, `${node.id} scale ${node.scale}`);
    assert.ok(Number.isFinite(node.y) && Number.isFinite(node.yaw));
  }
});

test('there is something to find close to the start: stone, fibre and (guarded) crystal', () => {
  const within = (kind, metres) => nodes.filter(n => n.kind === kind && away(n, SPAWN) <= metres);
  assert.ok(within('rock', 60).length >= 2, 'two outcrops within 60 m');
  assert.ok(within('spire', 75).length >= 2, 'two spire plants within 75 m');
  const stinger = nodes.filter(n => n.kind === 'crystal' && away(n, FINDS.stingerHome) < 45);
  assert.ok(stinger.length >= 3, `crystals on the stinger's ground: ${stinger.length}`);
});

test('the far sites are far, apart from each other, and the richer ones further out', () => {
  const far = sites.filter(s => !s.near);
  assert.ok(far.length >= 18, `${far.length} far sites`);
  for (const site of far) assert.ok(away(site, SPAWN) >= FINDS.farMin - 1 && away(site, SPAWN) <= FINDS.farMax + 1, `${site.name} at ${away(site, SPAWN)}`);
  for (let i = 0; i < far.length; i++) for (let j = i + 1; j < far.length; j++) assert.ok(away(far[i], far[j]) >= FINDS.siteSpacing - 1, `${far[i].name} and ${far[j].name}`);
  // the biggest crystals are kept for a walk
  const spikes = nodes.filter(n => n.variant === 'spike' && n.site !== 'stinger crystals');
  assert.ok(spikes.length > 0 && spikes.every(n => away(n, SPAWN) > 90), 'big crystals are out in the dunes');
});

test('nothing in the pond, the hero tree\'s clearing, the start, or the edge of the world', () => {
  for (const node of nodes) {
    assert.ok(Math.abs(node.x) <= FINDS.worldLimit + 1 && Math.abs(node.z) <= FINDS.worldLimit + 1, `${node.id} inside the world`);
    assert.ok(away(node, HERO_TREE) >= FINDS.heroClear - 1, `${node.id} clear of the hero tree`);
    assert.ok(away(node, SPAWN) >= FINDS.spawnClear - 1, `${node.id} clear of the start`);
    assert.ok(away(node, WATER) >= FINDS.pondClear * 0.6 - 1, `${node.id} clear of the pond`);
    assert.ok(field.sample(node.x, node.z) > WATER.y + 0.4, `${node.id} above the water line`);
  }
  for (const node of nodes.filter(n => n.kind === 'rock')) assert.ok(away(node, FINDS.stingerHome) >= 13, `${node.id} keeps off the stinger's home`);
});

test('nodes stand on gentle ground and never overlap', () => {
  for (const node of nodes) {
    const r = footprintOf(node.kind, node.variant) * node.scale;
    const ground = groundUnder(field.sample, node.x, node.z, r);
    assert.ok(ground.max - ground.min <= FINDS.maxSlope[node.kind] * r + 1e-6, `${node.id} on ground that drops ${(ground.max - ground.min).toFixed(2)} m`);
    assert.ok(node.y >= ground.min - 0.01 && node.y <= ground.max + 0.01 + (node.kind === 'rock' ? 0.04 * heightOf('rock', node.variant) * node.scale : 0), `${node.id} stands on the ground`);
  }
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      assert.ok(away(a, b) >= a.radius + b.radius + 0.4, `${a.id} and ${b.id} overlap`);
    }
  }
});

test('footprint and height helpers know every variant', () => {
  for (const node of nodes) {
    assert.ok(footprintOf(node.kind, node.variant) > 0.3);
    assert.ok(heightOf(node.kind, node.variant) > 0.8);
  }
  assert.throws(() => footprintOf('rock', 'nonsense'));
  assert.throws(() => layoutFinds({}));
});
