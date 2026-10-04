import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { createAdaptiveGrip } from '../src/adaptive-grip.js';
import { attachHeldObject, createGripContact, setGripSurface } from '../src/grip-contact.js';
import {
  PACK, PACK_GRIP, PACK_HELD_ROTATION, backZoneCentre, createBackpack, glowIntensity, inBackZone, packGroundHeight,
} from '../src/backpack.js';
import { createTools } from '../src/tools.js';
import { createAxeKind } from '../src/axe.js';
import { createTorchKind } from '../src/torch.js';
import { createSurvivorMenu, MENU_SIZE } from '../src/survivor-menu.js';
import {
  ENCUMBERED_FACTOR, PACK_CARRY_BONUS, POCKET_CARRY_WEIGHT, addInventoryItem, canTakeOffPack, getCarryCapacity,
  getCarrySpeedMultiplier, getInventoryCount, getInventoryItems, getInventoryWeight, getMaxCarryWeight, isPackWorn,
  removeInventoryItem, setPackWorn,
} from '../src/inventory.js';

async function loadAsset(path) {
  const bytes = await readFile(new URL(`../public/models/${path}`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'ContactTestTextures', loadTexture: async () => new THREE.Texture() }));
  return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}
const [leftHand, rightHand, packAsset] = await Promise.all([
  loadAsset('hands/LeftHand.glb'), loadAsset('hands/RightHand.glb'), loadAsset('backpack/backpack.glb'),
]);

function reset() {
  setPackWorn(false);
  for (const { type, count } of getInventoryItems()) removeInventoryItem(type, count);
}

// ---------------------------------------------------------------------------------------------- what you can carry

test('pockets carry 40, a worn pack adds 60 (the old flat 100), and the slowdown scales with the limit', () => {
  reset();
  assert.equal(POCKET_CARRY_WEIGHT, 40);
  assert.equal(PACK_CARRY_BONUS, 60);
  assert.equal(getCarryCapacity(), 40);
  assert.equal(getMaxCarryWeight(), 40 * ENCUMBERED_FACTOR);
  assert.equal(getCarrySpeedMultiplier(40), 1, 'no slowdown up to the limit');
  assert.ok(Math.abs(getCarrySpeedMultiplier(40.001) - 0.5) < 0.001, 'one over halves your speed');
  assert.ok(Math.abs(getCarrySpeedMultiplier(60) - 0.25) < 1e-9);
  assert.equal(getCarrySpeedMultiplier(80), 0, 'a standstill at twice the limit');
  assert.equal(getCarrySpeedMultiplier(500), 0);

  setPackWorn(true);
  assert.equal(getCarryCapacity(), 100);
  assert.equal(getMaxCarryWeight(), 200);
  assert.equal(getCarrySpeedMultiplier(100), 1);
  assert.ok(Math.abs(getCarrySpeedMultiplier(150) - 0.25) < 1e-9, 'the same curve the game had before there was a pack');
  assert.equal(getCarrySpeedMultiplier(200), 0);
  reset();
});

test('your speed follows the live weight and whether the pack is on', () => {
  reset();
  addInventoryItem('stone', 7); // 56
  assert.ok(getCarrySpeedMultiplier() < 0.5, 'too heavy for pockets');
  setPackWorn(true);
  assert.equal(getCarrySpeedMultiplier(), 1, 'the pack takes the load');
  setPackWorn(false);
  assert.ok(getCarrySpeedMultiplier() < 0.5);
  reset();
});

test('the pack can only come off when everything fits in your pockets', () => {
  reset();
  setPackWorn(true);
  addInventoryItem('stone', 5); // 40
  assert.equal(getInventoryWeight(), 40);
  assert.equal(canTakeOffPack(), true, 'exactly what the pockets hold');
  addInventoryItem('stick', 1);
  assert.equal(canTakeOffPack(), false);
  removeInventoryItem('stick', 1);
  assert.equal(canTakeOffPack(), true);
  reset();
});

// ---------------------------------------------------------------------------------------------- the back zone

test('the back zone sits behind the shoulders and turns with the body', () => {
  const front = backZoneCentre({ center: new THREE.Vector3(10, 1.7, 5), yaw: 0 });
  assert.ok(Math.abs(front.x - 10) < 1e-9 && Math.abs(front.z - (5 + PACK.back.behind)) < 1e-9, 'facing -Z, behind is +Z');
  assert.ok(Math.abs(front.y - (1.7 - PACK.back.below)) < 1e-9);
  const left = backZoneCentre({ center: new THREE.Vector3(0, 1.7, 0), yaw: Math.PI / 2 });
  assert.ok(Math.abs(left.x - PACK.back.behind) < 1e-9 && Math.abs(left.z) < 1e-9, 'turned left, behind is +X');
  const turned = backZoneCentre({ center: new THREE.Vector3(0, 1.7, 0), yaw: Math.PI });
  assert.ok(Math.abs(turned.z + PACK.back.behind) < 1e-9, 'facing +Z, behind is -Z');
});

test('a hand over the shoulder or at the small of the back is in the zone; chest, hips, head and sides are not', () => {
  const body = { center: new THREE.Vector3(0, 1.7, 0), yaw: 0 };
  const centre = backZoneCentre(body);
  const at = (x, y, z) => inBackZone({ x, y, z }, centre);
  assert.equal(at(0, 1.6, 0.20), true, 'over the shoulder');
  assert.equal(at(0.10, 1.35, 0.30), true, 'between the shoulder blades');
  assert.equal(at(0.05, 1.02, 0.28), true, 'the small of the back');
  assert.equal(at(0, 1.32, -0.15), false, 'the chest, where things are packed away');
  assert.equal(at(0.30, 1.4, 0.0), false, 'out at your side');
  assert.equal(at(0.26, 0.90, 0.10), false, 'a hip holster');
  assert.equal(at(0, 1.78, 0.2), false, 'above the shoulders');
  assert.equal(at(0, 1.35, 0.60), false, 'too far behind');
});

test('the back zone never reaches the chest, so packing things at your chest cannot put the pack on', () => {
  const centre = backZoneCentre({ center: new THREE.Vector3(0, 1.7, 0), yaw: 0 });
  // The chest storage zone is centred 0.38 below the head and within 0.34 of it; the back zone must keep clear of the
  // front half of that, measured in the direction the body faces.
  assert.ok(PACK.back.behind - PACK.back.radius >= -0.07, 'the front edge of the zone is at most a few centimetres past the head');
  assert.equal(inBackZone({ x: 0, y: 1.32, z: -0.10 }, centre), false);
  assert.equal(inBackZone({ x: 0.1, y: 1.30, z: -0.25 }, centre), false);
});

// ---------------------------------------------------------------------------------------------- placing it on the sand

test('the pack stands on the highest ground under its base, sunk a little', () => {
  const slope = (x) => 0.5 * x; // rises along +x
  const level = packGroundHeight(() => 3, 10, 10, 0.4);
  assert.ok(Math.abs(level - (3 - PACK.settle)) < 1e-9);
  const onSlope = packGroundHeight((x) => slope(x), 0, 0, 0);
  assert.ok(Math.abs(onSlope - (0.5 * PACK.footprint.halfWidth - PACK.settle)) < 1e-9, 'the uphill edge sets the height');
  const turned = packGroundHeight((x) => slope(x), 0, 0, Math.PI / 2);
  assert.ok(Math.abs(turned - (0.5 * PACK.footprint.halfDepth - PACK.settle)) < 1e-9, 'and it follows the way the pack faces');
});

test('the glowing trim looks the same whatever the exposure: soft at night, clearer by day', () => {
  const night = glowIntensity(0.035) * 0.035;
  const day = glowIntensity(0.82) * 0.82;
  assert.ok(Math.abs(night - PACK.glow.night) < 1e-6, `displayed brightness at night ${night}`);
  assert.ok(Math.abs(day - PACK.glow.day) < 1e-6, `displayed brightness by day ${day}`);
  assert.ok(glowIntensity(0.035) > 10 * glowIntensity(0.82), 'the night exposure is undone, so the intensity is many times higher');
  let last = night;
  for (const exposure of [0.05, 0.1, 0.2, 0.3, 0.5]) {
    const displayed = glowIntensity(exposure) * exposure;
    assert.ok(displayed >= last - 1e-9, 'brightness eases up with the light');
    last = displayed;
  }
});

// ---------------------------------------------------------------------------------------------- the real hand, the real pack

function handFixture(handedness) {
  const asset = handedness === 'left' ? leftHand : rightHand;
  const root = clone(asset.scene);
  const scene = new THREE.Scene();
  const grip = new THREE.Group();
  scene.add(grip);
  const anchor = new THREE.Group();
  anchor.rotation.z = handedness === 'left' ? Math.PI / 2 : -Math.PI / 2;
  grip.add(anchor);
  anchor.add(root);
  const objectGrip = new THREE.Group();
  grip.add(objectGrip);
  const socket = root.getObjectByName(`b_${handedness === 'left' ? 'l' : 'r'}_grip`);
  scene.updateMatrixWorld(true);
  new THREE.Matrix4().copy(grip.matrixWorld).invert().multiply(socket.matrixWorld)
    .decompose(objectGrip.position, objectGrip.quaternion, objectGrip.scale);
  const solver = createAdaptiveGrip({ root, clips: asset.animations, objectGrip, handedness });
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(asset.animations.find(clip => clip.name === 'Grip'));
  action.play(); action.paused = true; action.time = 0.72; mixer.update(0);
  return { root, scene, grip, objectGrip, solver, mixer };
}

function penetrations(root, objectGrip, contact) {
  root.updateWorldMatrix(true, false);
  root.updateMatrixWorld(true);
  const inverse = objectGrip.matrixWorld.clone().invert();
  let count = 0;
  root.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const transform = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
    const points = [];
    for (let i = 0; i < mesh.geometry.getAttribute('position').count; i++) {
      const point = mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(transform);
      points.push(point);
      if (contact.contains(point)) count++;
    }
    const index = mesh.geometry.index;
    for (let i = 0; i < index.count; i += 3) {
      if (contact.intersectsTriangle(points[index.getX(i)], points[index.getX(i + 1)], points[index.getX(i + 2)])) count++;
    }
  });
  return count;
}

for (const side of ['left', 'right']) {
  test(`the ${side} hand closes round the carry handle without going through it, and the pack hangs from it`, () => {
    const f = handFixture(side);
    const pack = packAsset.scene.clone(true);
    setGripSurface(pack, PACK_GRIP);
    assert.ok(attachHeldObject(f, pack, PACK_HELD_ROTATION[side]));
    const unfitted = createGripContact(pack);
    assert.ok(unfitted, 'the handle gives the fingers a surface to close on');
    assert.ok(f.solver.update(pack, 0.12), 'the grip solves');
    const solved = f.solver.getState();
    for (let frame = 0; frame < 20; frame++) {
      f.mixer.update(1 / 200);
      f.solver.update(pack, 1 / 200);
      assert.equal(penetrations(f.root, f.objectGrip, solved.contact), 0, `closing frame ${frame}`);
    }
    assert.ok(solved.fingers.filter(finger => finger.amounts.some(amount => amount > 0.1 && amount < 0.95)).length >= 4,
      'the fingers stop on the strap rather than closing into a fist');

    // An arm that hangs at the side, wrist relaxed (the hand pointing down and a little forward): the pack hangs.
    f.grip.quaternion.setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(-65), 0, 0));
    f.scene.updateMatrixWorld(true);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(pack.matrixWorld);
    const front = new THREE.Vector3(0, 0, 1).transformDirection(pack.matrixWorld);
    const bar = new THREE.Vector3(1, 0, 0).transformDirection(pack.matrixWorld);
    assert.ok(up.y > 0.93, `the pack hangs upright from a relaxed hand (up.y ${up.y.toFixed(2)})`);
    assert.ok(front.x * (side === 'right' ? 1 : -1) > 0.9, `its front faces out, away from your leg (front.x ${front.x.toFixed(2)})`);
    assert.ok(Math.abs(bar.z) > 0.95, 'the handle runs front to back, the way a hand carries a bag');
    const bounds = new THREE.Box3().setFromObject(pack);
    assert.ok(bounds.max.y < f.grip.position.y + 0.1, 'the top of the pack is at the hand, not above it');
    assert.ok(bounds.max.y - bounds.min.y > 0.5 && bounds.max.y - bounds.min.y < 0.75);
  });
}

test('the two hands hold it as mirror images', () => {
  const right = PACK_HELD_ROTATION.right;
  const left = PACK_HELD_ROTATION.left;
  for (const axis of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
    const a = new THREE.Vector3(...axis).applyQuaternion(right);
    const b = new THREE.Vector3(...axis).applyQuaternion(left);
    assert.ok(Math.abs(a.y + b.y) < 1e-9 || Math.abs(a.y - b.y) < 1e-9);
    assert.ok(Math.abs(a.z - b.z) < 1e-9 && Math.abs(a.x + b.x) < 1e-9, 'the pack goes the same way up the forearm, mirrored in x');
  }
});

// ---------------------------------------------------------------------------------------------- picking it up, wearing it

function toolModel(meshName) {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.6, 0.04));
  mesh.name = meshName;
  mesh.position.y = 0.25;
  scene.add(mesh);
  return scene;
}

function world(t, { heightAt = () => 20 } = {}) {
  t.mock.method(GLTFLoader.prototype, 'load', (url, onLoad) => {
    if (url.includes('/backpack/')) onLoad({ scene: packAsset.scene.clone(true), animations: [] });
    else onLoad({ scene: toolModel(url.includes('/axe/') ? 'WoodenHandle' : 'WoodenShaft'), animations: [] });
  });
  const scene = new THREE.Scene();
  const rig = new THREE.Group();
  rig.position.set(300, 20, -300);
  scene.add(rig);
  const xrCamera = new THREE.PerspectiveCamera();
  xrCamera.position.copy(rig.position).add(new THREE.Vector3(0, 1.7, 0));
  xrCamera.updateMatrixWorld(true);
  const renderer = { xr: { isPresenting: true, getCamera: () => xrCamera } };
  const pulses = [];
  const hand = handedness => {
    const grip = new THREE.Group();
    const objectGrip = new THREE.Group();
    grip.add(objectGrip);
    rig.add(grip);
    const buttons = Array.from({ length: 6 }, () => ({ pressed: false, value: 0 }));
    const actuator = { pulse: (strength, ms) => { pulses.push({ handedness, strength, ms }); return Promise.resolve(); } };
    return { handedness, grip, objectGrip, buttons, inputSource: { gamepad: { buttons, hapticActuators: [actuator] } } };
  };
  const right = hand('right');
  const left = hand('left');
  const states = [left, right];
  const tools = createTools({
    scene, rig, states, renderer, onError: () => {},
    kinds: [createTorchKind({ scene, onError: () => {} }), createAxeKind({ scene, onError: () => {} })],
  });
  tools.update(0.016); // places the belt and the body
  const exposure = { value: 1 };
  const backpack = createBackpack({
    scene, states, renderer, camera: xrCamera, rig, tools, heightAt, getExposure: () => exposure.value, onError: () => {},
  });
  backpack.update(0.016); // finds the body, so the back zone exists from the start
  const handTo = (state, point) => {
    rig.updateMatrixWorld(true);
    state.grip.position.copy(rig.worldToLocal(point.clone()));
    state.grip.updateMatrixWorld(true);
  };
  const squeeze = (state, value) => {
    state.buttons[1].pressed = value;
    tools.update(0.016);
    backpack.update(0.016);
  };
  const handle = () => backpack.debug.getObject().localToWorld(new THREE.Vector3(0, PACK_GRIP.point[1], 0));
  const backZone = () => backpack.debug.getZoneCentre(new THREE.Vector3());
  return { scene, rig, xrCamera, tools, backpack, states, left, right, pulses, exposure, handTo, squeeze, handle, backZone };
}

test('the pack lies upright on the sand by the starting tools, facing the way you set off', t => {
  reset();
  const { backpack, scene } = world(t, { heightAt: () => 21 });
  assert.equal(backpack.ready, true);
  const pack = backpack.debug.getObject();
  assert.equal(pack.parent, scene);
  assert.ok(Math.abs(pack.position.x - PACK.spawn.x) < 1e-9 && Math.abs(pack.position.z - PACK.spawn.z) < 1e-9);
  assert.ok(Math.abs(pack.position.y - (21 - PACK.settle)) < 1e-9, 'on the ground, sunk a little');
  const up = new THREE.Vector3(0, 1, 0).transformDirection(pack.matrixWorld);
  assert.ok(up.y > 0.999, 'upright');
  assert.deepEqual(backpack.getStatus(), 'ground');
  assert.equal(backpack.isWorn(), false);
  assert.equal(isPackWorn(), false);
  assert.ok(Math.hypot(PACK.spawn.x - 319, PACK.spawn.z + 292) < 3, 'a couple of metres from where you start');
});

test('grip near the handle picks it up; from further away, or with a full hand, it does nothing', t => {
  reset();
  const { backpack, right, left, handTo, squeeze, handle, pulses, tools } = world(t);
  const pack = backpack.debug.getObject();

  handTo(right, handle().add(new THREE.Vector3(PACK.grabRadius + 0.2, 0, 0)));
  squeeze(right, true);
  assert.equal(backpack.getStatus(), 'ground', 'out of reach');
  squeeze(right, false);

  // a hand full of something else cannot take it
  right.objectGrip.add(new THREE.Group());
  handTo(right, handle());
  squeeze(right, true);
  assert.equal(backpack.getStatus(), 'ground', 'the hand is busy');
  squeeze(right, false);
  right.objectGrip.clear();

  // holding grip while moving in does not count: a grab is a fresh press
  right.buttons[1].pressed = true;
  handTo(right, handle().add(new THREE.Vector3(1.5, 0, 0)));
  tools.update(0.016); backpack.update(0.016);
  handTo(right, handle());
  tools.update(0.016); backpack.update(0.016);
  assert.equal(backpack.getStatus(), 'ground', 'sliding into reach with grip held is not a grab');
  squeeze(right, false);

  handTo(right, handle().add(new THREE.Vector3(0.1, -0.1, 0)));
  squeeze(right, true);
  assert.equal(backpack.getStatus(), 'held');
  assert.equal(right.objectGrip.children[0], pack, 'in the right hand');
  assert.ok(pulses.some(p => p.handedness === 'right'), 'a pulse in that hand');
  const grabs = pulses.length;

  // the other hand cannot take it off you
  handTo(left, handle());
  squeeze(left, true);
  assert.equal(right.objectGrip.children[0], pack);
  assert.equal(pulses.length, grabs, 'and gets no pulse');
});

test('let go away from your back and it drops upright on the ground, facing you', t => {
  reset();
  const { backpack, right, handTo, squeeze, handle, xrCamera, scene } = world(t, { heightAt: (x, z) => 20 + 0.01 * x });
  const pack = backpack.debug.getObject();
  handTo(right, handle());
  squeeze(right, true);
  assert.equal(backpack.getStatus(), 'held');

  const spot = new THREE.Vector3(303.5, 21.0, -301.2); // out in front and to the side
  handTo(right, spot);
  squeeze(right, true);
  assert.equal(backpack.getStatus(), 'held', 'still held while grip is down');
  squeeze(right, false);
  assert.equal(backpack.getStatus(), 'ground');
  assert.equal(pack.parent, scene);
  assert.equal(isPackWorn(), false, 'nothing was put on');
  assert.ok(Math.abs(pack.position.x - (spot.x)) < 0.8 && Math.abs(pack.position.z - spot.z) < 0.8, 'it lands under the hand');
  const up = new THREE.Vector3(0, 1, 0).transformDirection(pack.matrixWorld);
  assert.ok(up.y > 0.999, 'upright, whatever way it was held');
  const front = new THREE.Vector3(0, 0, 1).transformDirection(pack.matrixWorld);
  const toHead = new THREE.Vector3().subVectors(xrCamera.position, pack.position).setY(0).normalize();
  assert.ok(front.dot(toHead) > 0.99, 'its front faces you');
  assert.ok(Math.abs(pack.position.y - (20 + 0.01 * pack.position.x + 0.01 * PACK.footprint.halfWidth - PACK.settle)) < 0.02, 'on the sand');
});

test('let go behind your shoulder and you are wearing it: it vanishes from the scene and you can carry more', t => {
  reset();
  const { backpack, right, handTo, squeeze, handle, backZone, pulses, scene } = world(t);
  const pack = backpack.debug.getObject();
  assert.equal(getCarryCapacity(), 40);
  handTo(right, handle());
  squeeze(right, true);
  const before = pulses.length;

  handTo(right, backZone());
  squeeze(right, true); // still gripping: only a tick as it reaches the zone
  assert.equal(backpack.getStatus(), 'held');
  assert.ok(pulses.length > before, 'a small tick as the hand reaches the back zone');
  const ticks = pulses.length;
  squeeze(right, true);
  assert.equal(pulses.length, ticks, 'one tick, not a buzz');

  squeeze(right, false);
  assert.equal(backpack.getStatus(), 'worn');
  assert.equal(backpack.isWorn(), true);
  assert.equal(isPackWorn(), true);
  assert.equal(getCarryCapacity(), 100);
  assert.equal(pack.parent, null, 'no longer in the world or in your hand');
  assert.equal(right.objectGrip.children.length, 0, 'the hand is free');
  assert.ok(!scene.getObjectById(pack.id));
  assert.ok(pulses.length > ticks, 'a firm pulse as it goes on');
  assert.deepEqual(backpack.list(), { status: 'worn', worn: true });
  reset();
});

test('the tick at the back zone is strong enough to feel, and the "it is on" pulse is firmer than the tick', t => {
  reset();
  const { right, handTo, squeeze, handle, backZone, pulses } = world(t);
  handTo(right, handle());
  squeeze(right, true);
  pulses.length = 0;
  handTo(right, backZone());
  squeeze(right, true);
  assert.equal(pulses.length, 1, 'one tick on reaching the zone');
  const [tick] = pulses;
  assert.ok(tick.strength >= 0.3 && tick.ms >= 30, `a tick you can feel on a Quest, not ${tick.strength} for ${tick.ms} ms`);
  squeeze(right, false);
  const wear = pulses[pulses.length - 1];
  assert.ok(wear.strength > tick.strength && wear.ms > tick.ms, 'wearing it is firmer than the tick');
  reset();
});

test('the pack is not put on with a hand that is not behind you, nor by a controller that went away', t => {
  reset();
  const { backpack, right, handTo, squeeze, handle, backZone, xrCamera } = world(t);
  handTo(right, handle());
  squeeze(right, true);
  // at the chest
  handTo(right, xrCamera.position.clone().add(new THREE.Vector3(0, -0.38, -0.12)));
  squeeze(right, false);
  assert.equal(backpack.getStatus(), 'ground', 'let go at the chest, it just falls');
  assert.equal(isPackWorn(), false);

  handTo(right, backpack.debug.getObject().localToWorld(new THREE.Vector3(0, PACK_GRIP.point[1], 0)));
  squeeze(right, true);
  assert.equal(backpack.getStatus(), 'held');
  handTo(right, backZone());
  right.inputSource = null; // the controller disconnects behind your back
  backpack.update(0.016);
  assert.equal(backpack.getStatus(), 'ground', 'a disconnected controller drops it');
  assert.equal(isPackWorn(), false);
});

test('reach back with an empty hand and grip to take it off, unless your pockets cannot hold what you carry', t => {
  reset();
  const { backpack, right, left, handTo, squeeze, backZone, pulses } = world(t);
  backpack.debug.wear();
  assert.equal(backpack.getStatus(), 'worn');
  addInventoryItem('stone', 6); // 48: more than the pockets hold

  handTo(right, backZone());
  const before = pulses.length;
  squeeze(right, true);
  assert.equal(backpack.getStatus(), 'worn', 'too heavy for pockets: it has to stay on');
  assert.equal(isPackWorn(), true);
  assert.ok(pulses.length > before, 'a buzz says no');
  squeeze(right, false);

  removeInventoryItem('stone', 2); // 32
  handTo(left, new THREE.Vector3(0, 0, 0).copy(backZone()).add(new THREE.Vector3(-0.05, 0, 0)));
  squeeze(left, true);
  assert.equal(backpack.getStatus(), 'held');
  assert.equal(isPackWorn(), false);
  assert.equal(getCarryCapacity(), 40);
  assert.equal(left.objectGrip.children[0], backpack.debug.getObject(), 'in the hand that reached for it');
  reset();
});

test('a hand reaching back for its tools is not taking the pack off, and a full hand cannot', t => {
  reset();
  const { backpack, right, handTo, squeeze, backZone } = world(t);
  backpack.debug.wear();
  right.objectGrip.add(new THREE.Group());
  handTo(right, backZone());
  squeeze(right, true);
  assert.equal(backpack.getStatus(), 'worn', 'the hand already holds something');
  reset();
});

test('Take off in the menu sets it down in front of you, facing you, and refuses when it is too heavy', t => {
  reset();
  const { backpack, xrCamera, scene } = world(t);
  assert.equal(backpack.takeOff().ok, false, 'not wearing one');
  backpack.debug.wear();
  addInventoryItem('stone', 6);
  const refused = backpack.takeOff();
  assert.equal(refused.ok, false);
  assert.match(refused.message, /pockets/);
  assert.equal(isPackWorn(), true);
  assert.equal(backpack.canTakeOff(), false);

  removeInventoryItem('stone', 6);
  assert.equal(backpack.canTakeOff(), true);
  const result = backpack.takeOff();
  assert.equal(result.ok, true);
  assert.equal(isPackWorn(), false);
  assert.equal(backpack.getStatus(), 'ground');
  const pack = backpack.debug.getObject();
  assert.equal(pack.parent, scene);
  const ahead = new THREE.Vector3().subVectors(pack.position, xrCamera.position).setY(0);
  assert.ok(Math.abs(ahead.length() - PACK.dropAhead) < 0.02, 'about three quarters of a metre away');
  assert.ok(ahead.z < -0.7, 'in front, the way the headset faces (-Z)');
  assert.equal(backpack.takeOff().ok, false, 'and now it is not on you any more');
  reset();
});

test('the glowing trim is driven by the exposure, so it shows at night', t => {
  reset();
  const { backpack, right, handTo, squeeze, exposure } = world(t);
  const glow = [];
  backpack.debug.getObject().traverse(object => { if (object.material?.name === 'Glow') glow.push(object.material); });
  assert.equal(glow.length, 1, 'one glow material');
  exposure.value = 0.82;
  squeeze(right, false);
  const day = glow[0].emissiveIntensity;
  exposure.value = 0.035;
  squeeze(right, false);
  const night = glow[0].emissiveIntensity;
  assert.ok(Math.abs(day * 0.82 - PACK.glow.day) < 0.02);
  assert.ok(Math.abs(night * 0.035 - PACK.glow.night) < 0.02);
  assert.ok(night > 10 * day);
  handTo(right, new THREE.Vector3());
  reset();
});

// ---------------------------------------------------------------------------------------------- the menu

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.listeners = {}; this.attributes = {}; }
  append(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); } }
  setAttribute(k, v) { this.attributes[k] = v; }
  addEventListener(k, v) { this.listeners[k] = v; }
  remove() { this.parent.children = this.parent.children.filter(x => x !== this); }
  focus() { document.activeElement = this; }
  querySelector(s) { return this.querySelectorAll(s)[0]; }
  querySelectorAll(s) {
    return this.children.flatMap(n => [n, ...(n.querySelectorAll?.('*') || [])])
      .filter(n => s === '*' || n.dataset?.action === s.match(/data-action="([^"]+)"/)?.[1]);
  }
}

test('the menu shows the Back slot, the bigger limit when it is worn, and Take off', () => {
  reset();
  const originalDocument = globalThis.document;
  const drawn = [];
  const body = new Element('body');
  const context = new Proxy({ measureText: text => ({ width: text.length * 12 }), fillText: text => drawn.push(text) }, {
    get: (target, key) => target[key] ?? (() => {}),
  });
  globalThis.document = { body, activeElement: body, createElement(tag) {
    const node = new Element(tag);
    if (tag === 'canvas') node.getContext = () => context;
    return node;
  } };
  try {
    const scene = new THREE.Scene();
    const xr = { isPresenting: false, getSession: () => null, getCamera: () => new THREE.PerspectiveCamera(), addEventListener: () => {} };
    const states = [0, 1].map(() => ({ inputSource: null, controller: new THREE.Group() }));
    const calls = [];
    const backpack = {
      isWorn: () => isPackWorn(),
      takeOff: () => {
        calls.push('takeOff');
        if (!canTakeOffPack()) return { ok: false, message: 'Too heavy.' };
        setPackWorn(false);
        return { ok: true, message: 'Backpack set down in front of you.' };
      },
    };
    const menu = createSurvivorMenu({ scene, renderer: { xr }, states, backpack });
    // A click marks the menu dirty; the next frame's update redraws it.
    const click = action => { body.querySelector(`[data-action="${action}"]`).listeners.click(); menu.update(); };
    const lastDrawn = () => drawn.splice(0).join(' | ');

    addInventoryItem('stone', 3); // 24
    menu.setOpen(true);
    assert.ok(body.querySelector('[data-action="back"]'), 'a Back slot');
    let text = lastDrawn();
    assert.match(text, /24 \/ 40/, 'pockets only: the limit is 40');
    assert.match(text, /Wear a backpack to carry more/);
    assert.doesNotMatch(text, /half speed/);

    click('back');
    text = lastDrawn();
    assert.match(text, /Back is empty/);
    assert.match(text, /A pack adds/);
    assert.ok(!body.querySelector('[data-action="takeoff"]'), 'nothing to take off');

    setPackWorn(true);
    menu.update(); // notices the pack is on and redraws
    text = lastDrawn();
    assert.match(text, /24 \/ 100/, 'with the pack the limit is 100');
    assert.match(text, /Backpack/);
    assert.ok(body.querySelector('[data-action="takeoff"]'));
    assert.equal(body.querySelector('[data-action="takeoff"]').disabled, false, 'it fits in your pockets, so it can come off');

    addInventoryItem('stone', 3); // 48
    menu.update();
    lastDrawn();
    assert.equal(body.querySelector('[data-action="takeoff"]').disabled, true, 'too much for your pockets');
    click('takeoff');
    assert.deepEqual(calls, [], 'a disabled button does nothing');
    assert.equal(isPackWorn(), true);

    removeInventoryItem('stone', 3);
    menu.update();
    lastDrawn();
    click('takeoff');
    assert.deepEqual(calls, ['takeOff']);
    assert.equal(isPackWorn(), false);
    text = lastDrawn();
    assert.match(text, /set down in front of you/);
    assert.match(text, /\/ 40/);
    assert.equal(MENU_SIZE.width, 1600);
    menu.setOpen(false);
  } finally {
    globalThis.document = originalDocument;
    reset();
  }
});

test('without a backpack the menu is as it was: no Back slot, but the limit is the pockets', () => {
  reset();
  const originalDocument = globalThis.document;
  const body = new Element('body');
  const context = new Proxy({ measureText: text => ({ width: text.length * 12 }) }, { get: (target, key) => target[key] ?? (() => {}) });
  globalThis.document = { body, activeElement: body, createElement(tag) {
    const node = new Element(tag);
    if (tag === 'canvas') node.getContext = () => context;
    return node;
  } };
  try {
    const xr = { isPresenting: false, getSession: () => null, getCamera: () => new THREE.PerspectiveCamera(), addEventListener: () => {} };
    const menu = createSurvivorMenu({ scene: new THREE.Scene(), renderer: { xr }, states: [0, 1].map(() => ({ inputSource: null, controller: new THREE.Group() })) });
    menu.setOpen(true);
    assert.ok(!body.querySelector('[data-action="back"]'));
    assert.equal(getInventoryCount('stone'), 0);
    menu.setOpen(false);
  } finally {
    globalThis.document = originalDocument;
  }
});

// ---------------------------------------------------------------------------------------------- the save

test('the pack is saved as worn, or as lying where it was left, and put back the same way (src/save-game.js)', t => {
  reset();
  const { backpack, right, handTo, squeeze, handle } = world(t, { heightAt: () => 20 });
  const pack = backpack.debug.getObject();
  assert.deepEqual(backpack.snapshot(), { status: 'ground', x: PACK.spawn.x, z: PACK.spawn.z, yaw: PACK.spawn.yaw });

  backpack.debug.ground(310.126, -295.5, 0.7);
  assert.deepEqual(backpack.snapshot(), { status: 'ground', x: 310.13, z: -295.5, yaw: 0.7 });

  // in your hand it is saved as put down where the hand is
  handTo(right, handle());
  squeeze(right, true);
  assert.equal(backpack.getStatus(), 'held');
  const held = backpack.snapshot();
  assert.equal(held.status, 'ground');
  const where = pack.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(held.x - where.x) < 0.006 && Math.abs(held.z - where.z) < 0.006, 'under the pack, wherever the hand has taken it');
  squeeze(right, false);

  backpack.debug.wear();
  assert.deepEqual(backpack.snapshot(), { status: 'worn' });

  // put back: lying somewhere else, on the ground, facing the way it was
  assert.equal(backpack.restore({ status: 'ground', x: 12, z: -34, yaw: 1.1 }), true);
  assert.equal(backpack.getStatus(), 'ground');
  assert.equal(isPackWorn(), false, 'taking it from worn to lying takes it off you');
  assert.ok(Math.abs(pack.position.x - 12) < 1e-9 && Math.abs(pack.position.z + 34) < 1e-9);
  assert.ok(Math.abs(pack.rotation.y - 1.1) < 1e-9);
  assert.equal(pack.parent !== null, true);

  assert.equal(backpack.restore({ status: 'worn' }), true);
  assert.equal(backpack.isWorn(), true);
  assert.equal(isPackWorn(), true);
  assert.equal(getCarryCapacity(), 100);
  assert.equal(pack.parent, null, 'on your back, not in the world');
  assert.equal(backpack.restore({ status: 'worn' }), true, 'twice is the same as once');

  assert.equal(backpack.restore({ status: 'floating' }), false);
  assert.equal(backpack.restore(null), false);
  assert.equal(backpack.isWorn(), true, 'junk changes nothing');
  reset();
});
