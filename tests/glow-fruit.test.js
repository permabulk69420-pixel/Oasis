import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HERO_TREE, isInPond } from '../src/world.js';
import {
  FRUIT, MOUTH_RADIUS, fruitLayout, mouthPosition, createGroundFruit, createHeldFruit, fruitGripSurface,
} from '../src/glow-fruit.js';

test('fruit layout is deterministic, around the tree, outside the roots and out of the pond', () => {
  const a = fruitLayout();
  const b = fruitLayout();
  assert.deepEqual(a, b);
  assert.equal(a.length, FRUIT.count);
  for (const item of a) {
    const r = Math.hypot(item.x - HERO_TREE.x, item.z - HERO_TREE.z);
    assert.ok(r >= 13 && r <= 36, `radius ${r}`);
    assert.equal(isInPond(item.x, item.z), false);
  }
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      assert.ok(Math.hypot(a[i].x - a[j].x, a[i].z - a[j].z) >= 3, 'fruit are spaced out');
    }
  }
});

test('a different seed gives a different scatter; a blocked area is never used', () => {
  const a = fruitLayout({ seed: 1 });
  const b = fruitLayout({ seed: 2 });
  assert.notDeepEqual(a, b);
  const blockedEast = fruitLayout({ blocked: x => x > HERO_TREE.x });
  assert.ok(blockedEast.length > 0);
  assert.ok(blockedEast.every(item => item.x <= HERO_TREE.x));
});

test('mouth sits a little below and in front of the eyes, and turns with the head', () => {
  const head = new THREE.Object3D();
  head.position.set(10, 5, 20);
  head.updateMatrixWorld(true);
  const m = mouthPosition(head.matrixWorld);
  assert.ok(m.y < 5 && m.y > 4.8);
  assert.ok(m.z < 20, 'forward is -z');
  head.rotation.y = Math.PI / 2; // now facing -x
  head.updateMatrixWorld(true);
  const turned = mouthPosition(head.matrixWorld);
  assert.ok(turned.x < 10 && Math.abs(turned.z - 20) < 1e-6);
});

// update() clamps each step to 1 s (like a long frame), so advance in whole seconds.
function advance(system, seconds) {
  for (let t = 0; t < seconds; t += 1) system.update(Math.min(1, seconds - t));
}

function ground(layout) {
  const sun = new THREE.Vector3(0, 1, 0);
  const made = createGroundFruit({ field: { sample: () => 20 }, sunDirection: sun, layout });
  return { ...made, sun };
}

test('ground fruit spawns one per slot, glows brighter and shows halos only at night', () => {
  const layout = [{ x: 0, z: 0, yaw: 0, tilt: 0 }, { x: 5, z: 5, yaw: 1, tilt: 0.1 }];
  const f = ground(layout);
  const fruit = f.group.children.filter(c => c.userData.looseFruit);
  assert.equal(fruit.length, 2);
  f.sun.set(0, 1, 0);
  f.update(0.016);
  const dayGlow = f.material.emissiveIntensity;
  assert.equal(f.halos.mesh.visible, false);
  f.sun.set(0, -0.5, 0);
  f.update(0.016);
  assert.ok(f.material.emissiveIntensity > dayGlow * 4);
  assert.equal(f.halos.mesh.visible, true);
});

test('eaten fruit regrows in its own spot after the respawn delay, growing in', () => {
  const f = ground([{ x: 3, z: 4, yaw: 0, tilt: 0 }]);
  const first = f.slots[0].fruit;
  assert.ok(f.consume(first));
  assert.equal(first.parent, null);
  assert.equal(f.slots[0].fruit, null);
  advance(f, FRUIT.respawnSeconds - 5);
  assert.equal(f.slots[0].fruit, null, 'not back yet');
  advance(f, 6);
  const second = f.slots[0].fruit;
  assert.ok(second && second !== first);
  assert.ok(second.scale.x < 1, 'still growing in');
  advance(f, 3);
  assert.equal(second.scale.x, 1);
  assert.equal(second.position.x, 3);
  assert.equal(second.position.z, 4);
});

function heldFixture({ onEat } = {}) {
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
  const state = { handedness: 'right', grip, objectGrip, inputSource };
  const localHead = new THREE.Vector3(0.12, 1.68, -0.08);
  rig.updateMatrixWorld(true);
  const xrCamera = new THREE.PerspectiveCamera();
  xrCamera.position.copy(localHead);
  xrCamera.updateMatrixWorld(true);
  xrCamera.matrixWorld.setPosition(rig.localToWorld(localHead.clone()));
  const renderer = { xr: { isPresenting: true, getCamera: () => xrCamera } };

  const made = createGroundFruit({
    field: { sample: () => 20 },
    sunDirection: new THREE.Vector3(0, 1, 0),
    layout: [{ x: 0, z: 0, yaw: 0, tilt: 0 }, { x: 40, z: 40, yaw: 0, tilt: 0 }],
  });
  scene.add(made.group);
  const held = createHeldFruit({ scene, states: [state], renderer, onEat });
  const fruit = made.slots[0].fruit;
  grip.position.set(0.2, 0.1, -0.5);
  rig.updateMatrixWorld(true);
  grip.getWorldPosition(fruit.position);
  const press = pressed => { inputSource.gamepad.buttons[1].pressed = pressed; held.update(); };
  const mouthWorld = () => mouthPosition(xrCamera.matrixWorld);
  const moveHandTo = world => { grip.position.copy(rig.worldToLocal(world.clone())); rig.updateMatrixWorld(true); };
  return { scene, rig, grip, objectGrip, state, held, made, fruit, press, mouthWorld, moveHandTo, xrCamera };
}

test('grip near a fruit picks up that exact fruit; letting go drops it on the ground', () => {
  const f = heldFixture();
  f.press(true);
  assert.equal(f.objectGrip.children[0], f.fruit);
  assert.ok(f.held.isHolding('right'));
  assert.equal(f.fruit.userData.held, true);

  f.press(false);
  assert.equal(f.objectGrip.children.length, 0);
  assert.equal(f.held.isHolding('right'), false);
  assert.equal(f.fruit.parent, f.made.group, 'dropped fruit returns to the fruit group');
  assert.equal(f.made.slots[0].fruit, f.fruit, 'still counts as that slot\'s fruit (no duplicates)');
});

test('bringing a held fruit to the mouth eats it once, feeds onEat and starts the respawn', () => {
  const eaten = [];
  const f = heldFixture({ onEat: info => eaten.push(info) });
  f.press(true);
  assert.equal(eaten.length, 0);
  // far from the mouth: nothing happens
  f.moveHandTo(f.mouthWorld().add(new THREE.Vector3(0, -0.6, 0)));
  f.held.update();
  assert.equal(eaten.length, 0);
  assert.equal(f.objectGrip.children.length, 1);
  // at the mouth: eaten
  f.moveHandTo(f.mouthWorld().add(new THREE.Vector3(MOUTH_RADIUS * 0.4, 0, 0)));
  f.held.update();
  assert.equal(eaten.length, 1);
  assert.equal(eaten[0].food, FRUIT.food);
  assert.equal(eaten[0].water, FRUIT.water);
  assert.equal(f.objectGrip.children.length, 0);
  assert.equal(f.made.slots[0].fruit, null);
  f.held.update();
  assert.equal(eaten.length, 1, 'only once');
  advance(f.made, FRUIT.respawnSeconds + 1);
  assert.ok(f.made.slots[0].fruit, 'a new fruit grows back');
});

test('an empty hand far from any fruit grabs nothing', () => {
  const f = heldFixture();
  f.grip.position.set(3, 0.1, -0.5);
  f.rig.updateMatrixWorld(true);
  f.press(true);
  assert.equal(f.objectGrip.children.length, 0);
  assert.equal(f.held.isHolding('right'), false);
});

test('the fruit is held off the palm, mirrored for each hand, with one stable surface per hand', () => {
  const right = fruitGripSurface('right');
  const left = fruitGripSurface('left');
  // The fruit is 5 cm in radius, more than the grip solver's palm shift can clear from a centred grip point.
  assert.ok(FRUIT.gripOffset > 0 && FRUIT.gripOffset < 0.06);
  assert.deepEqual(right.point, [-FRUIT.gripOffset, 0, 0]);
  assert.deepEqual(left.point, [FRUIT.gripOffset, 0, 0]);
  assert.deepEqual(right.meshes, ['Fruit']);
  // The solver caches a solved grip against the surface object, so it has to be the same one each time.
  assert.equal(fruitGripSurface('right'), right);
  assert.equal(fruitGripSurface('left'), left);
  assert.equal(fruitGripSurface(undefined), right);
});
