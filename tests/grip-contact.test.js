import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { createAdaptiveGrip } from '../src/adaptive-grip.js';
import { attachHeldObject, createGripContact, setGripSurface } from '../src/grip-contact.js';
import { createGroundSticks } from '../src/sticks.js';
import { createVRHands } from '../src/hands.js';

async function loadAsset(path) {
  const bytes = await readFile(new URL(`../public/models/${path}`, import.meta.url));
  const loader = new GLTFLoader();
  // Contact checks use the actual GLB geometry and rigs, without browser image decoding.
  loader.register(() => ({ name: 'ContactTestTextures', loadTexture: async () => new THREE.Texture() }));
  return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}

const [left, right, axe, torch, stone, stick] = await Promise.all([
  loadAsset('hands/LeftHand.glb'), loadAsset('hands/RightHand.glb'),
  loadAsset('axe/stone_survival_axe.glb'), loadAsset('torch/handheld_fire_torch.glb'),
  loadAsset('stone/vr_pickup_stone_uv_200.glb'), loadAsset('stick/dead_ground_stick_vr_thin.glb'),
]);
const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
const axeRotation = flip.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2));
const stickRotation = flip.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2));

function handFixture(handedness, debug = false) {
  const asset = handedness === 'left' ? left : right;
  const root = clone(asset.scene);
  const scene = new THREE.Scene();
  const rig = new THREE.Group();
  rig.position.set(300, 23, -410); rig.rotation.y = 0.73; scene.add(rig);
  const grip = new THREE.Group(); rig.add(grip);
  const anchor = new THREE.Group();
  anchor.rotation.z = handedness === 'left' ? Math.PI / 2 : -Math.PI / 2;
  grip.add(anchor); anchor.add(root);
  const objectGrip = new THREE.Group(); grip.add(objectGrip);
  const socket = root.getObjectByName(`b_${handedness === 'left' ? 'l' : 'r'}_grip`);
  rig.updateMatrixWorld(true);
  new THREE.Matrix4().copy(grip.matrixWorld).invert().multiply(socket.matrixWorld)
    .decompose(objectGrip.position, objectGrip.quaternion, objectGrip.scale);
  const solver = createAdaptiveGrip({ root, clips: asset.animations, objectGrip, handedness, debug });
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(asset.animations.find(clip => clip.name === 'Grip'));
  action.play(); action.paused = true; action.time = 0.72; mixer.update(0);
  return { root, scene, rig, grip, objectGrip, solver, mixer };
}

function penetrationCount(root, objectGrip, contact) {
  root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
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

for (const handedness of ['left', 'right']) {
  for (const [name, asset, surface, rotation, scale = 1] of [
    ['axe', axe, { meshes: ['WoodenHandle'], axis: [0, 1, 0], point: [0, 0, 0] }, axeRotation],
    ['torch', torch, { meshes: ['WoodenShaft'], axis: [0, 1, 0], point: [0, 0, 0] }, flip],
    ['stone', stone, { meshes: ['Stone'], point: [0, 0, 0] }, null, 1.08],
  ]) {
    test(`${handedness} ${name}: the real skin closes around the grip without penetrating it`, () => {
      const f = handFixture(handedness);
      const object = asset.scene.clone(true);
      object.scale.setScalar(scale);
      setGripSurface(object, surface);
      assert.ok(attachHeldObject(f, object, rotation));
      const oldContact = createGripContact(object);
      assert.ok(penetrationCount(f.root, f.objectGrip, oldContact) > 30, 'fixture reproduces the existing clipping');
      assert.ok(f.solver.update(object, 0));
      const solved = f.solver.getState();
      assert.ok(solved.contact);
      for (let frame = 0; frame < 24; frame++) {
        // Reproduce the animation mixer writing the generic grip every frame.
        f.mixer.update(1 / 200);
        f.solver.update(object, 1 / 200);
        assert.equal(penetrationCount(f.root, f.objectGrip, solved.contact), 0, `closing frame ${frame}`);
      }
      assert.ok(solved.fingers.filter(finger => finger.amounts.some(amount => amount > 0.1 && amount < 0.95)).length >= 4,
        'fingers actually stop on the surface rather than always reaching a full fist');
      assert.ok(new Set(solved.fingers.flatMap(finger => finger.amounts.map(amount => amount.toFixed(2)))).size > 4,
        'different fingers and joints can wrap independently');
    });
  }
}

test('scaled loose sticks grip their chosen shaft, on either hand', t => {
  t.mock.method(GLTFLoader.prototype, 'load', (_, onLoad) => onLoad(stick));
  const group = createGroundSticks({ field: { sample: () => 0 } });
  for (const handedness of ['left', 'right']) {
    for (const original of [group.children[0], group.children[3]]) {
      const f = handFixture(handedness);
      const object = original.clone(true);
      const point = new THREE.Vector3().fromArray(object.userData.gripPoint);
      attachHeldObject(f, object, stickRotation);
      object.updateMatrix();
      assert.ok(point.applyMatrix4(object.matrix).length() < 1e-9, 'scaled grip point matches the socket before palm fitting');
      assert.ok(f.solver.update(object, 0.12));
      assert.ok(f.solver.getState().fingers.filter(finger => finger.name !== 'thumb').every(finger => finger.amounts[0] > 0.2),
        'the chosen shaft section lets all four fingers close instead of trapping one against a twig');
      assert.equal(penetrationCount(f.root, f.objectGrip, f.solver.getState().contact), 0);
    }
  }
});

test('a solved grip stays rigid through movement, rotation, trigger changes and a cached regrab', () => {
  const f = handFixture('right');
  const object = axe.scene.clone(true);
  setGripSurface(object, { meshes: ['WoodenHandle'], axis: [0, 1, 0], point: [0, 0, 0] });
  attachHeldObject(f, object, axeRotation); f.solver.update(object, 0.12);
  const contact = f.solver.getState().contact;
  const fittedMatrix = object.matrix.clone();
  f.rig.position.set(-200, 3, 150); f.rig.rotation.set(0.13, -1.2, 0.05);
  f.grip.position.set(0.3, 1.2, -0.4); f.grip.rotation.set(0.6, 0.3, -0.4);
  f.rig.updateMatrixWorld(true);
  for (let i = 0; i < 4; i++) {
    f.mixer.update(0.016); f.solver.update(object, 0.016);
    assert.ok(object.matrix.equals(fittedMatrix), 'hand animation never slides or pivots the item');
    assert.equal(penetrationCount(f.root, f.objectGrip, contact), 0);
  }
  f.scene.attach(object); f.solver.update(null);
  attachHeldObject(f, object, axeRotation); f.solver.update(object, 0.12);
  assert.ok(f.solver.getState().contact === contact, 'regrab reuses the cached contact solution');
  assert.ok(object.position.distanceTo(new THREE.Vector3().setFromMatrixPosition(fittedMatrix)) < 1e-9, 'no accumulated palm offset');
});

test('debug contours never occupy a hand; releasing clears the held contact', () => {
  const f = handFixture('left', true);
  const object = stone.scene.clone(true);
  setGripSurface(object, { meshes: ['Stone'], point: [0, 0, 0] });
  attachHeldObject(f, object); f.solver.update(object, 0.12);
  assert.equal(f.objectGrip.children.length, 1);
  assert.ok(f.grip.getObjectByName('Grip surface outline'));
  assert.equal(attachHeldObject(f, new THREE.Group()), false, 'one physical item per hand');
  object.removeFromParent();
  assert.equal(f.solver.update(null), false);
  assert.equal(f.solver.getState().contact, null);
  assert.equal(f.grip.getObjectByName('Grip contact diagnostics').visible, false);
  f.solver.dispose();
  assert.equal(f.grip.getObjectByName('Grip contact diagnostics'), undefined);
});

test('unsupported items preserve their transform and use authored poses', () => {
  const f = handFixture('right');
  const object = new THREE.Group();
  object.position.set(1, 2, 3); f.objectGrip.add(object);
  const original = object.position.clone();
  assert.equal(f.solver.update(object, 0.016), false);
  assert.ok(object.position.equals(original));
});

test('contact catches a face spanning the object even when every triangle vertex is outside', () => {
  const object = new THREE.Group();
  object.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)));
  setGripSurface(object, { point: [0, 0, 0] });
  const contact = createGripContact(object);
  const triangle = [new THREE.Vector3(-3, 0, -3), new THREE.Vector3(3, 0, -3), new THREE.Vector3(0, 0, 3)];
  assert.ok(triangle.every(point => !contact.contains(point)));
  assert.equal(contact.intersectsTriangle(...triangle), true);
  assert.equal(contact.intersectsTriangle(new THREE.Vector3(2, 3, 2), new THREE.Vector3(3, 2, 2), new THREE.Vector3(2, 2, 3)), false);
  contact.translate(new THREE.Vector3(10, 0, 0));
  assert.equal(contact.intersectsTriangle(...triangle), false, 'bounds and planes both follow palm fitting');
});

test('compound outlines leave the empty space between separate solids available to fingers', () => {
  const object = new THREE.Group();
  for (const x of [-3, 3]) {
    const part = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    part.position.x = x; object.add(part);
  }
  setGripSurface(object, { compound: true });
  const contact = createGripContact(object);
  assert.equal(contact.parts.length, 2);
  assert.equal(contact.contains(new THREE.Vector3()), false);
  assert.equal(contact.contains(new THREE.Vector3(-3, 0, 0)), true);
  assert.equal(contact.intersectsTriangle(new THREE.Vector3(-0.2, 0, 0), new THREE.Vector3(0.2, 0, 0), new THREE.Vector3(0, 0, 0.2)), false);
});

test('the real VR-hand path fits on pickup, blocks a second tool and returns to free pose on release', async t => {
  const originalAudio = globalThis.Audio;
  globalThis.Audio = class { paused = true; play() { this.paused = false; return Promise.resolve(); } pause() { this.paused = true; } };
  t.after(() => { if (originalAudio) globalThis.Audio = originalAudio; else delete globalThis.Audio; });
  t.mock.method(GLTFLoader.prototype, 'load', (url, onLoad) => {
    const source = url.endsWith('LeftHand.glb') ? left : url.endsWith('RightHand.glb') ? right : url.includes('/axe/') ? axe : torch;
    onLoad({ ...source, scene: clone(source.scene) });
  });
  const controllers = [new THREE.Group(), new THREE.Group()];
  const grips = [new THREE.Group(), new THREE.Group()];
  const scene = new THREE.Scene();
  const rig = new THREE.Group(); scene.add(rig);
  const hands = createVRHands({ scene, parent: rig, renderer: { xr: { getController: i => controllers[i], getControllerGrip: i => grips[i] } } });
  const input = { handedness: 'right', gamepad: { buttons: [{ value: 0 }, { pressed: false, value: 0 }] } };
  controllers[0].dispatchEvent({ type: 'connected', data: input });
  await new Promise(setImmediate);
  hands.update(0.016);
  const state = hands.states[0];
  const position = state.objectGrip.getWorldPosition(new THREE.Vector3());
  const axeObject = hands.axe.getObject(); const torchObject = hands.torch.getObject();
  // Put both tools' pickup points exactly on the hand; the torch is listed first, so it wins the tie.
  axeObject.position.copy(position).y -= 0.14; torchObject.position.copy(position).y -= 0.22;
  input.gamepad.buttons[1] = { pressed: true, value: 1 };
  hands.update(0.016);
  assert.equal(state.objectGrip.children.length, 1, 'overlapping pickups cannot stack two tools');
  assert.ok(state.objectGrip.children[0] === torchObject);
  assert.ok(state.adaptiveGrip.getState().contact, 'first pickup frame is fitted');
  for (let i = 0; i < 10; i++) hands.update(0.016);
  const heldMatrix = torchObject.matrix.clone();
  input.gamepad.buttons[0].value = 1; hands.update(0.016);
  assert.ok(torchObject.matrix.equals(heldMatrix), 'trigger cannot slide the tool');
  input.gamepad.buttons[0].value = 0;
  input.gamepad.buttons[1] = { pressed: false, value: 0 }; hands.update(0.016);
  assert.equal(state.objectGrip.children.length, 0);
  assert.equal(state.adaptiveGrip.getState().contact, null);
  assert.equal(state.mixerState.current.getClip().name, 'Open', 'release updates the free hand in the same frame');
});
