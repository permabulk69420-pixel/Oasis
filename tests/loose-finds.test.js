import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { registerLooseFindDrops, createCrystalPickup, createFibrePickup, LOOSE_FINDS } from '../src/loose-finds.js';
import { spawnDrop, hasDropSpawner } from '../src/resource-drops.js';
import { buildLooseCrystal, buildFibreBundle } from '../src/find-shapes.js';
import { ITEMS } from '../src/crafting.js';
import { getInventoryItemWeight } from '../src/inventory.js';

const materials = { crystal: new THREE.MeshStandardMaterial(), fibre: new THREE.MeshStandardMaterial() };

test('crystal and fibre drops appear on the ground, in the groups the hands already search', () => {
  const stonesGroup = new THREE.Group(), sticksGroup = new THREE.Group();
  registerLooseFindDrops({ stonesGroup, sticksGroup, materials, heightAt: (x, z) => 3 + x * 0.1 });
  assert.ok(hasDropSpawner('crystal') && hasDropSpawner('fibre'));
  const crystal = spawnDrop('crystal', 10, 4, 1.2);
  assert.equal(crystal.parent, stonesGroup);
  assert.equal(crystal.userData.looseStone, true, 'the stone hands pick it up');
  assert.equal(crystal.userData.collectibleResource, 'crystal', 'and the chest stores it as a crystal');
  assert.equal(crystal.getObjectByName('Crystal').isMesh, true, 'the grip mesh is called Crystal');
  const bottom = crystal.position.y + LOOSE_FINDS.crystalBottom * crystal.scale.y;
  assert.ok(Math.abs(bottom - (3 + 10 * 0.1)) < 0.02, `the shard stands on the sand (${bottom})`);
  const fibre = spawnDrop('fibre', -5, 2, 0.4);
  assert.equal(fibre.parent, sticksGroup);
  assert.equal(fibre.userData.looseStick, true);
  assert.equal(fibre.userData.collectibleResource, 'fibre');
  assert.equal(fibre.getObjectByName('Fibre').isMesh, true);
  assert.ok(Math.abs(fibre.position.y + LOOSE_FINDS.fibreBottom - (3 - 0.5)) < 0.02, 'the bundle lies on the sand');
  assert.equal(fibre.userData.gripSurface.axis[0], 1, 'gripped along its length like a stick');
});

test('each drop is its own object, with some variety', () => {
  const stonesGroup = new THREE.Group(), sticksGroup = new THREE.Group();
  registerLooseFindDrops({ stonesGroup, sticksGroup, materials, heightAt: () => 0 });
  const a = spawnDrop('crystal', 0, 0, 0), b = spawnDrop('crystal', 1, 1, 0), c = spawnDrop('crystal', 2, 2, 0);
  assert.notEqual(a, b);
  assert.equal(new Set([a.getObjectByName('Crystal').geometry, b.getObjectByName('Crystal').geometry, c.getObjectByName('Crystal').geometry]).size, 3);
  assert.equal(stonesGroup.children.length, 3);
});

test('crystal and fibre are things the game knows about: named, weighed, and listed in the menu', () => {
  for (const id of ['crystal', 'fibre', 'pickaxe']) {
    assert.ok(ITEMS[id], `${id} is an item`);
    assert.ok(getInventoryItemWeight(id) > 0, `${id} has a weight`);
    if (id !== 'fibre') assert.ok(getInventoryItemWeight(id) > 1, `${id} is not just the default weight`);
  }
  assert.ok(createCrystalPickup(buildLooseCrystal(1), materials.crystal).userData.gripSurface.meshes.includes('Crystal'));
  assert.ok(createFibrePickup(buildFibreBundle(1), materials.fibre).userData.gripSurface.meshes.includes('Fibre'));
});
