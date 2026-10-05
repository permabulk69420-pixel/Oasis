import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FAR_PICKUPS, isPickup, createFarPickups } from '../src/far-pickups.js';

function pickup(flag, x, z) {
  const object = new THREE.Group();
  object.position.set(x, 0, z);
  object.userData[flag] = true;
  return object;
}

test('only pickups are touched: things in the same group that are not (the fruit\'s halos) stay as they are', () => {
  const halos = new THREE.Group();
  const stone = pickup('looseStone', 10, 10);
  assert.ok(isPickup(stone) && isPickup(pickup('looseStick', 0, 0)) && isPickup(pickup('looseFruit', 0, 0)));
  assert.ok(!isPickup(halos));
  assert.ok(!isPickup(new THREE.Group()));
  const group = new THREE.Group();
  group.add(halos, stone);
  const far = createFarPickups({ groups: [group] });
  far.update(5000, 5000);
  assert.equal(halos.visible, true);
  assert.equal(stone.visible, false);
});

test('past the range a pickup is not drawn, inside it it is, and it comes back when you do', () => {
  const near = pickup('looseStone', 100, 0), edge = pickup('looseStick', 249, 0), farOne = pickup('looseFruit', 300, 0), veryFar = pickup('looseStone', -600, 40);
  const group = new THREE.Group();
  group.add(near, edge, farOne, veryFar);
  const far = createFarPickups({ groups: [group] });
  far.update(0, 0);
  assert.deepEqual([near, edge, farOne, veryFar].map(o => o.visible), [true, true, false, false]);
  assert.equal(far.hiddenCount(), 2);
  far.update(-550, 0); // walk over to the far ones
  assert.deepEqual([near, edge, farOne, veryFar].map(o => o.visible), [false, false, false, true]);
  far.update(150, 0);
  assert.deepEqual([near, edge, farOne, veryFar].map(o => o.visible), [true, true, true, false]);
});

test('every pickup in every group counts, and the start of the real world is all hidden from the island and all shown at the oasis', () => {
  const stones = new THREE.Group(), sticks = new THREE.Group(), fruit = new THREE.Group();
  for (let i = 0; i < 12; i++) stones.add(pickup('looseStone', Math.cos(i) * 40, Math.sin(i) * 25));
  for (let i = 0; i < 6; i++) sticks.add(pickup('looseStick', Math.cos(i * 2) * 30, Math.sin(i * 2) * 20));
  for (let i = 0; i < 14; i++) fruit.add(pickup('looseFruit', Math.cos(i * 0.7) * 20, Math.sin(i * 0.7) * 15));
  const all = [...stones.children, ...sticks.children, ...fruit.children];
  const far = createFarPickups({ groups: [stones, sticks, fruit] });
  far.update(-105, 635); // the island's start meadow
  assert.equal(all.filter(o => !o.visible).length, 32);
  far.update(0, 0); // the pond
  assert.equal(all.filter(o => !o.visible).length, 0);
  assert.equal(far.hiddenCount(), 0);
});

test('a pickup dropped near you on the island is drawn (the rule is by where each one is, not by group)', () => {
  const group = new THREE.Group();
  const oasisStone = pickup('looseStone', 0, 0);
  const dropped = pickup('looseStone', -100, 630);
  group.add(oasisStone, dropped);
  createFarPickups({ groups: [group] }).update(-105, 635);
  assert.equal(oasisStone.visible, false);
  assert.equal(dropped.visible, true);
});

test('picking one up while it is hidden leaves nothing behind, and a pickup that is already hidden by someone else is not shown', () => {
  const group = new THREE.Group();
  const gone = pickup('looseStone', 900, 0), kept = pickup('looseStick', 900, 10), already = pickup('looseStick', 5, 0);
  already.visible = false;
  group.add(gone, kept, already);
  const far = createFarPickups({ groups: [group] });
  far.update(0, 0);
  assert.equal(far.hiddenCount(), 2);
  group.remove(gone);
  far.update(0, 0);
  assert.equal(far.hiddenCount(), 1);
  far.update(900, 0);
  assert.equal(kept.visible, true);
  assert.equal(already.visible, false, 'not ours to switch on');
});

test('the range is a few hundred metres: well past anything on the oasis, well inside what the island sees', () => {
  assert.ok(FAR_PICKUPS.range >= 150 && FAR_PICKUPS.range <= 400);
});
