import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeightField } from '../src/world.js';
import { layoutFinds } from '../src/desert-finds.js';
import {
  MINING, createNodeState, applyBlow, stepNode, lodFor, insideNode, pushOutOfRocks, maxHealthOf,
} from '../src/mining.js';

const field = createHeightField();
const { nodes: layout } = layoutFinds({ heightAt: field.sample });
const make = (kind, variant) => createNodeState({ ...layout.find(n => n.kind === kind && n.variant === variant), x: 100, z: 100, y: 5, yaw: 0, scale: 1 });

test('every node in the layout starts standing, full of health, ready to be hit', () => {
  for (const entry of layout) {
    const node = createNodeState(entry);
    assert.equal(node.state, 'idle');
    assert.equal(node.health, maxHealthOf(node));
    assert.ok(node.health > 30);
    assert.ok(MINING.kinds[node.kind], `${node.kind} has numbers`);
    assert.ok(MINING.accepts[node.kind], `${node.kind} has tools that work on it`);
  }
});

test('a pickaxe breaks rock and crystal, an axe cuts spires; the wrong tool just rings off', () => {
  const rock = make('rock', 'boulder'), crystal = make('crystal', 'cluster'), spire = make('spire', 'tall');
  for (const [node, wrong] of [[rock, 'axe'], [crystal, 'spear'], [spire, 'torch']]) {
    const before = node.health;
    const result = applyBlow(node, 28, wrong);
    assert.equal(result.accepted, false);
    assert.equal(result.dealt, 0);
    assert.equal(node.health, before, `${node.kind} untouched by a ${wrong}`);
    assert.equal(node.shake, 1, 'but it still rings');
  }
  assert.equal(applyBlow(rock, 26, 'pickaxe').accepted, true);
  assert.equal(applyBlow(crystal, 26, 'pickaxe').accepted, true);
  assert.equal(applyBlow(spire, 28, 'axe').accepted, true);
  assert.ok(spire.health < maxHealthOf(spire));
  const spearBlow = make('spire', 'tall');
  assert.ok(applyBlow(spearBlow, 34, 'spear').dealt < 34 * 0.6, 'a spear only pokes a spire');
});

test('items pop out for every share of the damage, and the last blow drops a bonus', () => {
  const node = make('rock', 'boulder');
  const kind = MINING.kinds.rock;
  let drops = 0, blows = 0;
  while (node.state === 'idle') {
    const result = applyBlow(node, 26, 'pickaxe');
    drops += result.drops; blows += 1;
    assert.ok(blows < 40, 'it must break eventually');
  }
  assert.equal(node.state, 'breaking');
  assert.equal(node.health, 0);
  const expected = Math.floor((maxHealthOf(node) - 1e-9) / kind.perDrop);
  assert.ok(drops >= kind.bonus + expected - 1 && drops <= kind.bonus + expected + 1, `drops ${drops}, expected about ${kind.bonus + expected}`);
  assert.ok(blows >= 3 && blows <= 8, `a rock takes ${blows} full blows`);
  // a node coming down cannot be hit again
  assert.deepEqual(applyBlow(node, 26, 'pickaxe'), { accepted: false, dealt: 0, drops: 0, broke: false });
});

test('a weak swing takes longer than a hard one, and nothing is lost to rounding', () => {
  const soft = make('crystal', 'cluster'), hard = make('crystal', 'cluster');
  let softBlows = 0, hardBlows = 0, softDrops = 0, hardDrops = 0;
  while (soft.state === 'idle') { softDrops += applyBlow(soft, 9, 'pickaxe').drops; softBlows += 1; }
  while (hard.state === 'idle') { hardDrops += applyBlow(hard, 26, 'pickaxe').drops; hardBlows += 1; }
  assert.ok(softBlows > hardBlows * 2, `${softBlows} soft vs ${hardBlows} hard`);
  assert.ok(Math.abs(softDrops - hardDrops) <= 1, 'same material either way');
});

test('a broken node comes down, waits, grows back and is whole again', () => {
  const node = make('spire', 'tall');
  while (node.state === 'idle') applyBlow(node, 28, 'axe');
  const kind = MINING.kinds.spire;
  let t = 0;
  while (node.state === 'breaking' && t < 10) { stepNode(node, 0.1); t += 0.1; }
  assert.equal(node.state, 'gone');
  assert.ok(Math.abs(t - kind.breakTime) < 0.2, `broke in ${t}s`);
  assert.equal(applyBlow(node, 28, 'axe').accepted, false, 'cannot hit a node that is not there');
  t = 0;
  while (node.state === 'gone' && t < kind.respawn + 5) { stepNode(node, 1); t += 1; }
  assert.equal(node.state, 'growing');
  assert.ok(Math.abs(t - kind.respawn) <= 2, `back after ${t}s`);
  assert.equal(applyBlow(node, 28, 'axe').accepted, false, 'cannot hit it while it grows');
  let previous = -1;
  for (t = 0; node.state === 'growing' && t < kind.regrow + 5; t += 1) { stepNode(node, 1); assert.ok(node.grow >= previous); previous = node.grow; }
  assert.equal(node.state, 'idle');
  assert.equal(node.health, node.maxHealth);
  assert.equal(node.grow, 1);
});

test('shaking dies away', () => {
  const node = make('rock', 'mesa');
  applyBlow(node, 26, 'pickaxe');
  assert.equal(node.shake, 1);
  for (let i = 0; i < 10; i++) stepNode(node, 0.1);
  assert.equal(node.shake, 0);
});

test('levels of detail: near, middle, far, and a node on a boundary does not flicker', () => {
  const [near, far] = MINING.lodDistance;
  assert.equal(lodFor(10), 0);
  assert.equal(lodFor(near + 20), 1);
  assert.equal(lodFor(far + 20), 2);
  assert.equal(lodFor(near + 2, 0), 0, 'keeps the close level just past the boundary');
  assert.equal(lodFor(near + 2, 1), 1, 'and the middle one if it was there');
  assert.equal(lodFor(near - 2, 1), 1);
  assert.equal(lodFor(near + 20, 0), 1, 'but gives it up once clear of the band');
  assert.equal(lodFor(far - 2, 2), 2);
  assert.equal(lodFor(far + 2, 1), 1);
});

test('a tool tip is inside a rock only where the rock is, and inside a crystal near it', () => {
  const rock = make('rock', 'boulder');
  assert.equal(insideNode(rock, 100, 5.5, 100), true, 'the middle');
  assert.equal(insideNode(rock, 100, 5.5, 110), false, 'ten metres away');
  assert.equal(insideNode(rock, 100, 20, 100), false, 'far above');
  assert.equal(insideNode(rock, 100, 5.5, 101.4, 0.05) || insideNode(rock, 101.4, 5.5, 100, 0.05), true, 'near the side');
  const crystal = make('crystal', 'cluster');
  assert.equal(insideNode(crystal, 100.2, 5.4, 100), true);
  assert.equal(insideNode(crystal, 104, 5.4, 100), false);
});

test('rocks are solid: you are walked out of one, but not out of crystals, spires or a rock that is gone', () => {
  const rock = make('rock', 'mesa');
  const nodes = [rock];
  assert.equal(pushOutOfRocks(nodes, 100 + 5, 100), null, 'clear of it');
  const pushed = pushOutOfRocks(nodes, 100.3, 100.2);
  assert.ok(pushed, 'inside the rock');
  const dist = Math.hypot(pushed[0] - 100, pushed[1] - 100);
  assert.ok(dist > 1.2 && dist < 3.4, `ends up ${dist} m from the middle, outside the stone`);
  assert.equal(pushOutOfRocks(nodes, pushed[0], pushed[1]), null, 'and stays put once outside');
  // pushing a point along a line out of the rock moves it away and never into the middle
  for (let angle = 0; angle < Math.PI * 2; angle += 0.3) {
    const out = pushOutOfRocks(nodes, 100 + Math.cos(angle) * 0.9, 100 + Math.sin(angle) * 0.9);
    assert.ok(out && Math.hypot(out[0] - 100, out[1] - 100) >= 1.0, `direction ${angle.toFixed(1)}`);
  }
  rock.state = 'breaking';
  assert.equal(pushOutOfRocks(nodes, 100.3, 100.2), null, 'a rock that is coming down lets you through');
  rock.state = 'growing'; rock.grow = 0.2;
  assert.equal(pushOutOfRocks(nodes, 100.3, 100.2), null, 'and so does one that has barely started to rise');
  rock.grow = 0.8;
  assert.ok(pushOutOfRocks(nodes, 100.3, 100.2), 'but not one that is nearly back');
  assert.equal(pushOutOfRocks([make('crystal', 'cluster'), make('spire', 'tall')], 100.1, 100.1), null);
});

test('layout rocks leave a way round them: no two rocks wall in the start', () => {
  // from the start, walk outwards in every direction and check we are never inside a rock on the way
  const nodes = layout.map(createNodeState);
  const start = [319, -292];
  assert.equal(pushOutOfRocks(nodes, start[0], start[1]), null, 'the start is clear of rocks');
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 12) {
    let blocked = 0;
    for (let d = 2; d < 80; d += 2) if (pushOutOfRocks(nodes, start[0] + Math.cos(angle) * d, start[1] + Math.sin(angle) * d)) blocked += 1;
    assert.ok(blocked <= 3, `direction ${angle.toFixed(2)} meets a rock ${blocked} times`);
  }
});
