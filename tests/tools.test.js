import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createTools, holsterPose, inHolsterZone, HOLSTER_RADIUS, HOLSTER_HALF_HEIGHT } from '../src/tools.js';
import { createAxeKind, TREE_DROPS, TREE_HITS_TO_FELL, TREE_TRUNK_RADIUS, TREE_CHOP_REACH, TREE_CHOP_TOP } from '../src/axe.js';
import { createTorchKind } from '../src/torch.js';
import { registerDropSpawner } from '../src/resource-drops.js';
import { addInventoryItem, getInventoryCount, removeInventoryItem } from '../src/inventory.js';

function toolModel(meshName) {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.6, 0.04));
  mesh.name = meshName;
  mesh.position.y = 0.25;
  scene.add(mesh);
  return scene;
}

function fixture(t) {
  t.mock.method(GLTFLoader.prototype, 'load', (url, onLoad) => {
    onLoad({ scene: toolModel(url.includes('/axe/') ? 'WoodenHandle' : 'WoodenShaft'), animations: [] });
  });
  const scene = new THREE.Scene();
  const rig = new THREE.Group();
  rig.position.set(300, 20, -300);
  scene.add(rig);
  const head = new THREE.Vector3(0, 1.7, 0);
  const xrCamera = new THREE.PerspectiveCamera();
  xrCamera.position.copy(rig.position).add(head);
  xrCamera.updateMatrixWorld(true);
  const renderer = { xr: { isPresenting: true, getCamera: () => xrCamera } };
  const grip = new THREE.Group();
  const objectGrip = new THREE.Group();
  grip.add(objectGrip);
  rig.add(grip);
  const buttons = Array.from({ length: 6 }, () => ({ pressed: false, value: 0 }));
  const state = { handedness: 'right', grip, objectGrip, inputSource: { gamepad: { buttons } } };
  const tools = createTools({
    scene, rig, states: [state], renderer, onError: () => {},
    kinds: [createTorchKind({ scene, onError: () => {} }), createAxeKind({ scene, onError: () => {} })],
  });
  const handTo = world => { rig.updateMatrixWorld(true); grip.position.copy(rig.worldToLocal(world.clone())); grip.updateMatrixWorld(true); };
  const squeeze = value => { buttons[1].pressed = value; tools.update(0.016); };
  tools.update(0.016); // place the belt
  return { scene, rig, tools, state, handTo, squeeze, xrCamera };
}

function clearInventory(type) {
  removeInventoryItem(type, getInventoryCount(type));
}

test('tools move between backpack and hips from the menu, all or nothing', t => {
  const { tools } = fixture(t);
  clearInventory('axe');
  assert.equal(tools.equip('axe', 'left'), false, 'nothing to equip yet');
  addInventoryItem('axe', 2);
  assert.equal(tools.equip('axe', 'left'), true);
  assert.equal(getInventoryCount('axe'), 1);
  assert.deepEqual(tools.getHipSlots(), { left: 'axe', right: null });
  assert.equal(tools.belt.left.children.filter(child => child.userData.toolKind).length, 1, 'the axe is physically on the left hip');

  addInventoryItem('torch', 1);
  assert.equal(tools.equip('torch', 'left'), true, 'equipping an occupied hip swaps');
  assert.deepEqual(tools.getHipSlots(), { left: 'torch', right: null });
  assert.equal(getInventoryCount('axe'), 2, 'the swapped-out axe went back to the backpack');

  assert.equal(tools.unequip('left'), true);
  assert.equal(getInventoryCount('torch'), 1);
  assert.deepEqual(tools.getHipSlots(), { left: null, right: null });
  assert.equal(tools.unequip('left'), false);
  clearInventory('axe'); clearInventory('torch');
});

test('a tool drawn from one hip can be put on the other, dropped, or packed at the chest', t => {
  const { tools, state, handTo, squeeze, xrCamera } = fixture(t);
  addInventoryItem('axe', 1);
  tools.equip('axe', 'right');
  const axe = tools.getInstances('axe').find(instance => instance.slot === 'right');

  handTo(tools.belt.right.getWorldPosition(new THREE.Vector3()));
  squeeze(true);
  assert.equal(axe.heldBy, state, 'grabbed off the hip');
  assert.equal(tools.getHipSlots().right, null, 'the hip is free while it is in hand');

  handTo(tools.belt.left.getWorldPosition(new THREE.Vector3()));
  squeeze(false);
  assert.equal(axe.slot, 'left', 'released at the other hip, it holsters there');

  squeeze(true);
  const away = tools.belt.left.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0.9, 0.3, -0.6));
  handTo(away);
  squeeze(false);
  assert.equal(axe.slot, null);
  assert.equal(axe.root.parent?.isScene, true, 'released away from the body, it lands on the ground');

  handTo(axe.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.14, 0)));
  squeeze(true);
  assert.equal(axe.heldBy, state);
  const before = getInventoryCount('axe');
  handTo(xrCamera.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.38, -0.12)));
  squeeze(false);
  assert.equal(getInventoryCount('axe'), before + 1, 'released at the chest, it goes in the backpack');
  assert.ok(!tools.getInstances('axe').includes(axe));
  clearInventory('axe');
});

test('holsters mirror left and right', () => {
  const holster = { dir: [0.3, 1, 0.2], along: 0.2 };
  const up = new THREE.Vector3(0, 1, 0);
  const left = up.clone().applyQuaternion(holsterPose(holster, 'left').quaternion);
  const right = up.clone().applyQuaternion(holsterPose(holster, 'right').quaternion);
  assert.ok(Math.abs(left.x + right.x) < 1e-6 && Math.abs(left.y - right.y) < 1e-6);
});

test('six real swings fell a tree, which drops logs and sticks along where it fell', t => {
  const scene = new THREE.Scene();
  const trees = new THREE.Group();
  trees.name = 'Alien desert trees';
  scene.add(trees);
  const tree = new THREE.Group();
  tree.position.set(0, 0, -2);
  tree.userData.oasisTree = true;
  tree.userData.layoutItem = {};
  trees.add(tree);
  const drops = [];
  for (const type of ['wood', 'stick']) registerDropSpawner(type, (x, z) => drops.push({ type, x, z }));

  const kind = createAxeKind({ scene, onError: () => {} });
  kind.prepareTemplate(toolModel('WoodenHandle'));
  const root = toolModel('WoodenHandle');
  scene.add(root);
  const grip = new THREE.Group();
  const heldBy = { grip, inputSource: { gamepad: {} } };
  const instance = { root, heldBy, state: kind.createState() };
  const frame = inTrunk => {
    // Head of the axe inside / outside the trunk, controller moving fast either way.
    root.position.set(0, 0.4, inTrunk ? -1.6 : -0.5); // near side of the trunk
    grip.position.x = grip.position.x > 0 ? -0.05 : 0.05;
    kind.update(instance, 0.016);
    kind.updateShared(0.016);
  };
  frame(false);
  for (let i = 0; i < TREE_HITS_TO_FELL; i++) { frame(true); for (let j = 0; j < 12; j++) frame(false); }
  assert.equal(tree.userData.chopState.phase, 'falling');
  assert.equal(tree.userData.layoutItem.felled, true, 'its shadow is removed');
  for (let i = 0; i < 120; i++) kind.updateShared(0.016);
  assert.equal(drops.length, TREE_DROPS.length);
  assert.deepEqual(drops.map(drop => drop.type).sort(), TREE_DROPS.map(drop => drop.type).sort());
  assert.ok(drops.every(drop => drop.z < -2), 'drops land on the far side, away from the swing');
  for (let i = 0; i < 400; i++) kind.updateShared(0.016);
  assert.equal(tree.visible, false, 'the felled trunk sinks away');
});

test('the chop zone follows the real trunk: a 2x tree is not choppable through thin air', () => {
  const kind = createAxeKind({ scene: new THREE.Scene(), onError: () => {} });
  kind.prepareTemplate(toolModel('WoodenHandle'));
  const HEAD_Y = 0.49; // where prepareTemplate puts the head of the test axe, above its origin

  // Does one fast swing with the axe head at (distance from trunk, height) land a hit?
  function hits(scale, distance, height) {
    const scene = new THREE.Scene();
    const trees = new THREE.Group(); trees.name = 'Alien desert trees'; scene.add(trees);
    const tree = new THREE.Group();
    tree.position.set(0, 3, 0); tree.scale.setScalar(scale); tree.userData.oasisTree = true;
    trees.add(tree);
    const axe = createAxeKind({ scene, onError: () => {} });
    axe.prepareTemplate(toolModel('WoodenHandle'));
    const root = toolModel('WoodenHandle'); scene.add(root);
    const grip = new THREE.Group();
    const instance = { root, heldBy: { grip, inputSource: { gamepad: {} } }, state: axe.createState() };
    root.position.set(distance, 3 + height - HEAD_Y, 0);
    for (let i = 0; i < 4; i++) { grip.position.x = i % 2 ? -0.05 : 0.05; axe.update(instance, 0.016); }
    return (tree.userData.chopState?.hits || 0) > 0;
  }

  const reach = scale => TREE_TRUNK_RADIUS * scale + TREE_CHOP_REACH;
  for (const scale of [1, 1.3, 2]) {
    assert.equal(hits(scale, 0.1, 0.8 * scale), true, `scale ${scale}: on the trunk`);
    assert.equal(hits(scale, reach(scale) - 0.05, 0.8 * scale), true, `scale ${scale}: just inside reach`);
    assert.equal(hits(scale, reach(scale) + 0.05, 0.8 * scale), false, `scale ${scale}: just outside reach`);
    assert.equal(hits(scale, 0.1, (TREE_CHOP_TOP + 0.3) * scale), false, `scale ${scale}: up in the canopy`);
    assert.equal(hits(scale, 0.1, 0.0), false, `scale ${scale}: below the ground`);
  }
  assert.ok(reach(2) < 0.75, 'a 2x tree can be chopped from under 75 cm away (it used to be 1.44 m)');
});

test('the holster zone is tall and forgiving, and a glow marks empty hips while you hold a tool', t => {
  const anchor = new THREE.Vector3(1, 1, 1);
  const at = (dx, dy, dz) => new THREE.Vector3(1 + dx, 1 + dy, 1 + dz);
  assert.equal(inHolsterZone(at(0, 0, 0), anchor), true);
  assert.equal(inHolsterZone(at(0, -(HOLSTER_HALF_HEIGHT - 0.02), 0), anchor), true, 'a hand hanging low at your side counts');
  assert.equal(inHolsterZone(at(0, HOLSTER_HALF_HEIGHT - 0.02, 0), anchor), true, 'so does one lifted to your waist');
  assert.equal(inHolsterZone(at(0, HOLSTER_HALF_HEIGHT + 0.05, 0), anchor), false);
  assert.equal(inHolsterZone(at(HOLSTER_RADIUS - 0.02, 0, 0), anchor), true);
  assert.equal(inHolsterZone(at(HOLSTER_RADIUS * 0.8, 0, HOLSTER_RADIUS * 0.8), anchor), false, 'horizontal distance is a circle, not a square');

  const { tools, state, handTo, squeeze } = fixture(t);
  addInventoryItem('axe', 1);
  tools.equip('axe', 'left');
  const axe = tools.getInstances('axe').find(instance => instance.slot === 'left');
  assert.ok(Object.values(tools.markers).every(marker => !marker.visible), 'no glow when nothing is held');

  handTo(tools.belt.left.getWorldPosition(new THREE.Vector3()));
  squeeze(true);
  assert.equal(axe.heldBy, state);
  assert.equal(tools.markers.left.visible, true, 'the hip you drew from is empty again, so it glows');
  assert.equal(tools.markers.right.visible, true, 'the other empty hip glows too');
  assert.ok(tools.markers.left.material.opacity > 0.5, 'bright where your hand is');
  assert.ok(tools.markers.right.material.opacity < 0.5, 'dim where it is not');

  const right = tools.belt.right.getWorldPosition(new THREE.Vector3());
  handTo(right.clone().add(new THREE.Vector3(0.05, -0.35, 0)));
  tools.update(0.016);
  assert.ok(tools.markers.right.material.opacity > 0.5, 'brighter when your hand is in the zone');
  assert.ok(tools.markers.left.material.opacity < 0.5, 'and the one you left dims again');
  squeeze(false);
  assert.equal(axe.slot, 'right', 'letting go with a hand hanging low by your side holsters it');
  assert.ok(Object.values(tools.markers).every(marker => !marker.visible), 'glow gone once nothing is held');
  clearInventory('axe');
});

test('hips stay put while you look around, and face where you look once you start walking', t => {
  const { tools, state, xrCamera } = fixture(t);
  state.handedness = 'left';
  const stick = state.inputSource.gamepad.axes = [0, 0, 0, 0];
  const hip = () => tools.belt.right.getWorldPosition(new THREE.Vector3());
  const settle = () => { for (let i = 0; i < 150; i++) tools.update(0.016); };
  const start = hip();
  xrCamera.rotation.y = Math.PI / 2; // turn the head to the left
  xrCamera.updateMatrixWorld(true);
  settle();
  assert.ok(hip().distanceTo(start) < 0.01, 'turning your head on the spot does not move the hips');
  stick[3] = -1; // push forward
  settle();
  const after = hip();
  assert.ok(after.distanceTo(start) > 0.3, 'the body turns to face the head when you start walking');
  xrCamera.rotation.y = 0;
  xrCamera.updateMatrixWorld(true);
  settle();
  assert.ok(hip().distanceTo(after) < 0.01, 'and then stays put while you keep walking and glance around');
});
