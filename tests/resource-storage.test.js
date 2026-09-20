import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createGroundStones, createHeldStones } from '../src/stones.js';
import { createHeldSticks } from '../src/sticks.js';
import { getInventoryCount } from '../src/inventory.js';
import { isHandAtChest } from '../src/chest-storage.js';
import { readFileSync } from 'node:fs';

function fixture(type, factory, { seated = false } = {}) {
  const scene = new THREE.Scene();
  const rig = new THREE.Group();
  rig.position.set(280, 23, -370);
  rig.rotation.y = 0.8;
  scene.add(rig);
  const grip = new THREE.Group();
  const objectGrip = new THREE.Group();
  grip.add(objectGrip);
  rig.add(grip);
  const inputSource = { gamepad: { buttons: [{ pressed: false }, { pressed: false }] } };
  const state = { handedness: 'left', grip, objectGrip, inputSource };
  const headHeight = seated ? 1.05 : 1.68;
  const localHead = new THREE.Vector3(0.12, headHeight, -0.08);
  rig.updateMatrixWorld(true);
  const headWorld = rig.localToWorld(localHead.clone());
  // Reproduce WebXR: an unparented camera with a reference-space pose and
  // a separately computed world matrix that includes the rig translation.
  const xrCamera = new THREE.PerspectiveCamera();
  xrCamera.position.copy(localHead);
  xrCamera.updateMatrixWorld(true);
  xrCamera.matrixWorld.setPosition(headWorld);
  const renderer = { xr: { isPresenting: true, getCamera: () => xrCamera } };
  const system = factory({ scene, states: [state], renderer });
  const group = new THREE.Group();
  group.name = type === 'stone' ? 'Loose oasis stones' : 'Loose oasis sticks';
  scene.add(group);
  const item = new THREE.Group();
  item.userData[type === 'stone' ? 'looseStone' : 'looseStick'] = true;
  item.userData.sourceBottom = -0.05;
  item.userData.gripPoint = [0.3, 0, 0];
  group.add(item);
  grip.position.set(0.2, 0.1, -0.5);
  rig.updateMatrixWorld(true);
  grip.getWorldPosition(item.position);
  const update = pressed => { inputSource.gamepad.buttons[1].pressed = pressed; system.update(); };
  const toChest = () => grip.position.copy(localHead).add(new THREE.Vector3(0, -0.38, 0));
  return { scene, rig, grip, objectGrip, state, renderer, xrCamera, system, group, item, update, toChest };
}

test('creating stone hands before the world does not spawn duplicate stones', t => {
  let loads = 0;
  t.mock.method(GLTFLoader.prototype, 'load', () => { loads++; });
  const scene = new THREE.Scene();
  createHeldStones({ scene, states: [] });
  assert.equal(loads, 0, 'hand setup must not load or spawn ground stones');
  scene.add(createGroundStones({ field: { sample: () => 0 } }));
  assert.equal(loads, 1, 'the world spawns exactly one stone set');
  assert.equal(scene.children.filter(item => item.name === 'Loose oasis stones').length, 1);
});

for (const [type, factory] of [['stick', createHeldSticks], ['stone', createHeldStones]]) {
  for (const seated of [false, true]) {
    test(`${type}: pickup moves the original; chest release stores once (${seated ? 'seated' : 'standing'})`, () => {
      const f = fixture(type, factory, { seated });
      const before = getInventoryCount(type);
      f.update(true);
      assert.equal(f.group.children.length, 0, 'no copy remains on the ground');
      assert.equal(f.objectGrip.children[0], f.item, 'hold the original object');
      assert.ok(f.system.isHolding('left'));
      f.toChest();
      // Opening the hand may move its animated socket. The controller is the
      // stable storage target, including after walking/turning far from origin.
      f.objectGrip.position.set(0.5, 0.5, 0.5);
      const worldBefore = f.xrCamera.matrixWorld.clone();
      f.update(false);
      assert.equal(f.item.parent, null, 'stored object disappears from the scene');
      assert.equal(f.objectGrip.children.length, 0);
      assert.equal(f.item.userData.collected, true);
      assert.equal(f.system.isHolding('left'), false);
      assert.equal(getInventoryCount(type), before + 1);
      assert.deepEqual(f.xrCamera.matrixWorld.elements, worldBefore.elements, 'do not overwrite XR world pose');
      f.update(false); f.update(true); f.update(false);
      assert.equal(getInventoryCount(type), before + 1, 'a stored object cannot be collected twice');
    });
  }

  test(`${type}: release away from chest drops the original and allows pickup again`, () => {
    const f = fixture(type, factory);
    const before = getInventoryCount(type);
    f.update(true);
    f.update(false);
    assert.equal(f.item.parent, f.group);
    assert.equal(f.group.children.length, 1);
    assert.equal(getInventoryCount(type), before);
    const world = f.item.getWorldPosition(new THREE.Vector3());
    f.grip.position.copy(f.rig.worldToLocal(world));
    f.update(true);
    assert.equal(f.item.parent, f.objectGrip);
    assert.equal(f.group.children.length, 0);
  });

  test(`${type}: a controller disconnect at the chest drops without granting inventory`, () => {
    const f = fixture(type, factory);
    const before = getInventoryCount(type);
    f.update(true); f.toChest(); f.state.inputSource = null; f.system.update();
    assert.equal(f.item.parent, f.group);
    assert.equal(getInventoryCount(type), before);
  });
}

test('chest storage is disabled outside immersive VR', () => {
  const f = fixture('stone', createHeldStones);
  f.toChest();
  f.renderer.xr.isPresenting = false;
  assert.equal(isHandAtChest(f.renderer, f.state), false);
});

test('frame prepares the XR world pose before testing hand interactions', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const frame = main.slice(main.indexOf('function frame(time)'));
  assert.ok(frame.indexOf('renderer.xr.updateCamera(camera)') < frame.indexOf('hands.update(dt)'));
});
