import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createTools, holsterQuaternion } from '../src/tools.js';
import { createAxeKind, TREE_DROPS, TREE_HITS_TO_FELL } from '../src/axe.js';
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
    scene, states: [state], renderer, onError: () => {},
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
  assert.equal(tools.belt.left.children.length, 1, 'the axe is physically on the left hip');

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
  const holster = { outward: 0.2, pitch: 0.3, flip: true };
  const down = new THREE.Vector3(0, 1, 0);
  const left = down.clone().applyQuaternion(holsterQuaternion(holster, 'left'));
  const right = down.clone().applyQuaternion(holsterQuaternion(holster, 'right'));
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
