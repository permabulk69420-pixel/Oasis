import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createTools } from '../src/tools.js';
import { createBowKind, BOW, BOW_HELD_ROTATION } from '../src/bow.js';
import { createArchery, ARCHERY, arrowSpeed } from '../src/archery.js';
import { createBackpack } from '../src/backpack.js';
import { setPackWorn } from '../src/inventory.js';
import { getHeldGripPose } from '../src/grip-poses.js';

function model(url) {
  const root = new THREE.Group();
  if (url.endsWith('/bow.glb')) {
    for (const [name, p] of Object.entries({
      string_top: [-0.00163, 0.625, 0.023957], string_bottom: [-0.00163, -0.625, 0.023957],
      string_top_drawn: [-0.00163, 0.575, 0.143957], string_bottom_drawn: [-0.00163, -0.575, 0.143957],
      nock_rest: [-0.00163, 0, 0.023957], arrow_rest: [-0.029, 0.072, -0.004],
    })) { const node = new THREE.Group(); node.name = name; node.position.fromArray(p); root.add(node); }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.035, 1.25, 0.1));
    mesh.name = 'bow_mesh'; mesh.morphTargetDictionary = { Draw: 0 }; mesh.morphTargetInfluences = [0]; root.add(mesh);
  } else if (url.endsWith('/quiver.glb')) {
    const opening = new THREE.Group(); opening.name = 'opening'; opening.position.set(0, 0.12, -0.058); root.add(opening);
  } else {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, 0.75));
    mesh.name = url.includes('backpack') ? 'CarryHandle' : 'arrow_mesh'; root.add(mesh);
  }
  return root;
}

function fixture(t, { side = 'left', targets = [], blockers = [], heightAt = () => 0 } = {}) {
  t.mock.method(GLTFLoader.prototype, 'load', (url, done) => done({ scene: model(url) }));
  const scene = new THREE.Scene(), rig = new THREE.Group(); scene.add(rig);
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 1.7, 0); rig.add(camera); scene.updateMatrixWorld(true);
  const renderer = { xr: { isPresenting: true, getCamera: () => camera } };
  const states = ['left', 'right'].map(handedness => {
    const grip = new THREE.Group(), objectGrip = new THREE.Group();
    // Hold the bow upright and aim down world -Z, using its current socket frame.
    objectGrip.quaternion.copy(BOW_HELD_ROTATION).invert(); grip.add(objectGrip); rig.add(grip);
    return { handedness, grip, objectGrip, inputSource: { gamepad: { buttons: [{ pressed: false }, { pressed: false }] } } };
  });
  const kind = createBowKind(); kind.spawns = [{ x: 0, z: -0.8 }];
  const tools = createTools({ scene, rig, states, renderer, camera, kinds: [kind], heightAt });
  const archery = createArchery({ scene, rig, states, tools, renderer, heightAt, targets, blockers });
  tools.setBeforeInput(archery.update);
  const tick = (dt = 1 / 90) => { rig.updateMatrixWorld(true); tools.update(dt); archery.updateDrawPose(); };
  const move = (state, point) => { state.grip.position.copy(point); tick(); };
  const squeeze = (state, pressed) => { state.inputSource.gamepad.buttons[1].pressed = pressed; tick(); };
  const bowHand = states.find(s => s.handedness === side), drawHand = states.find(s => s !== bowHand);
  tick();
  move(bowHand, tools.getInstances('bow')[0].root.position.clone()); squeeze(bowHand, true);
  move(bowHand, new THREE.Vector3(side === 'left' ? -0.3 : 0.3, 1.3, -0.4));
  const bow = tools.getInstances('bow')[0];
  assert.equal(bow.heldBy, bowHand);
  function takeArrow() {
    move(drawHand, archery.debug.getShoulder(new THREE.Vector3())); squeeze(drawHand, true);
    return archery.debug.arrows.at(-1);
  }
  function load() {
    const arrow = takeArrow();
    move(drawHand, bow.root.localToWorld(bow.state.sockets.nock.clone()));
    assert.equal(arrow.phase, 'nocked');
    return arrow;
  }
  function draw(distance, offset = new THREE.Vector3()) {
    const p = bow.state.sockets.nock.clone().add(new THREE.Vector3(0, 0, distance)).add(offset);
    move(drawHand, bow.root.localToWorld(p));
  }
  return { scene, rig, renderer, camera, states, tools, archery, bow, bowHand, drawHand, tick, move, squeeze, takeArrow, load, draw };
}

test('nocking at the edge of reach keeps the arrow at the hand through sideways movement and overdraw', t => {
  const f = fixture(t), arrow = f.takeArrow();
  const rest = f.bow.state.sockets.nock.clone();
  f.move(f.drawHand, f.bow.root.localToWorld(rest.clone().add(new THREE.Vector3(0.15, 0, 0))));
  assert.equal(arrow.phase, 'nocked');
  const checkContact = () => {
    const nock = arrow.root.getWorldPosition(new THREE.Vector3());
    const hand = f.drawHand.objectGrip.getWorldPosition(new THREE.Vector3());
    assert.ok(nock.distanceTo(hand) < 1e-6, 'the snap tolerance must not become a permanent hand offset');
    const string = new THREE.Vector3().fromBufferAttribute(f.bow.state.string.geometry.attributes.position, 1);
    assert.ok(f.bow.root.localToWorld(string).distanceTo(nock) < 1e-6, 'string and arrow share the same nock');
  };
  checkContact();
  f.draw(1, new THREE.Vector3(0.45, 0.4, 0));
  checkContact();
  assert.equal(arrow.draw, BOW.fullDraw, 'power stops increasing while the arrow keeps following');
  f.rig.position.set(4, 2, -7); f.rig.rotation.y = 1.2;
  f.drawHand.grip.rotation.set(0.3, -0.4, 0.7); f.tick(); checkContact();
});

// Keep the actual skin, bones and clips. Omit materials to load the GLB in Node
// without an image decoder; textures cannot affect the finger contact positions.
async function authoredHand(side) {
  const bytes = await readFile(new URL(`../public/models/hands/${side === 'left' ? 'Left' : 'Right'}Hand.glb`, import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  delete json.materials; delete json.textures; delete json.images;
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  const content = Buffer.from(JSON.stringify(json));
  const paddedLength = Math.ceil(content.length / 4) * 4;
  const binaryChunk = bytes.subarray(20 + jsonLength);
  const glb = Buffer.alloc(20 + paddedLength + binaryChunk.length, 0x20);
  bytes.copy(glb, 0, 0, 12); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(paddedLength, 12); glb.writeUInt32LE(0x4e4f534a, 16);
  content.copy(glb, 20); binaryChunk.copy(glb, 20 + paddedLength);
  return new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
}

for (const side of ['left', 'right']) test(`the ${side} drawing hand's authored Pinch pose remains connected on the first frame and while moving`, async t => {
  const gltf = await authoredHand(side);
  const f = fixture(t, { side: side === 'left' ? 'right' : 'left' });
  const state = f.drawHand;
  const anchor = new THREE.Group(); anchor.rotation.z = side === 'left' ? Math.PI / 2 : -Math.PI / 2;
  state.grip.add(anchor); anchor.add(gltf.scene); state.handRoot = gltf.scene;
  state.indexTip = gltf.scene.getObjectByName(`b_${side[0]}_index_ignore`);
  const thumbTip = gltf.scene.getObjectByName(`b_${side[0]}_thumb_ignore`);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const action = mixer.clipAction(gltf.animations.find(clip => clip.name === 'Pinch'));
  action.play(); action.paused = true;
  const arrow = f.load();
  const checkContact = () => {
    const pinch = state.indexTip.getWorldPosition(new THREE.Vector3()).add(thumbTip.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
    assert.ok(arrow.root.getWorldPosition(new THREE.Vector3()).distanceTo(pinch) < 1e-6, 'nock stays between thumb and index after the current frame animation');
  };
  action.time = 1; mixer.update(1 / 90); f.archery.updateDrawPose(); checkContact();
  state.grip.rotation.set(0.25, -0.45, 0.8);
  f.draw(0.9, new THREE.Vector3(0.4, -0.4, 0)); checkContact();
  f.rig.position.set(-5, 1.2, 4); f.rig.rotation.y = -0.9; f.tick(); checkContact();
});

for (const side of ['left', 'right']) test(`a ${side}-handed bow nocks, bends and fires along the visible arrow`, t => {
  const f = fixture(t, { side });
  assert.equal(f.archery.list().quiver, true);
  const arrow = f.load();
  assert.equal(f.drawHand.objectGrip.children[0].name, 'Held bowstring');
  assert.equal(getHeldGripPose(f.drawHand).animation, 'Pinch');
  f.draw(BOW.fullDraw, new THREE.Vector3(0.10, 0.04, 0));
  assert.ok(Math.abs(arrow.draw - BOW.fullDraw) < 1e-6);
  assert.ok(Math.abs(f.bow.state.limbs[0].morphTargetInfluences[0] - 1) < 1e-6);
  const visibleDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(arrow.root.getWorldQuaternion(new THREE.Quaternion()));
  f.squeeze(f.drawHand, false);
  assert.equal(arrow.phase, 'flying'); assert.equal(f.archery.list().shots, 1);
  assert.ok(arrow.velocity.clone().normalize().distanceTo(visibleDirection) < 1e-6);
  assert.ok(Math.abs(arrow.velocity.length() - arrowSpeed(BOW.fullDraw)) < 1e-6);
  assert.equal(f.drawHand.objectGrip.children.length, 0);
  assert.equal(f.bow.state.limbs[0].morphTargetInfluences[0], 0);
  f.tick(0.05); assert.ok(arrow.velocity.y < visibleDirection.y * arrowSpeed(BOW.fullDraw), 'gravity bends the flight down');
});

test('a short pull can be relaxed, then the nocked arrow drawn again without taking another', t => {
  const f = fixture(t), arrow = f.load();
  f.draw(0.025); f.squeeze(f.drawHand, false);
  assert.equal(arrow.phase, 'nocked'); assert.equal(f.archery.list().shots, 0);
  assert.equal(f.drawHand.objectGrip.children.length, 0);
  f.move(f.drawHand, f.bow.root.localToWorld(f.bow.state.sockets.nock.clone())); f.squeeze(f.drawHand, true);
  f.draw(0.4); f.squeeze(f.drawHand, false);
  assert.equal(f.archery.list().shots, 1); assert.equal(f.archery.debug.arrows.length, 1);
});

for (const interruption of ['bow released', 'draw hand disconnected', 'session hidden']) test(`${interruption} cannot fire a shot or leave a reserved hand`, t => {
  const f = fixture(t); f.load(); f.draw(0.5);
  if (interruption === 'bow released') f.squeeze(f.bowHand, false);
  else if (interruption === 'draw hand disconnected') { f.drawHand.inputSource = null; f.tick(); }
  else { f.renderer.xr.isPresenting = false; f.archery.cancel(); f.tick(); }
  assert.equal(f.archery.list().shots, 0);
  assert.equal(f.drawHand.objectGrip.children.length, 0);
  assert.equal(f.bow.state.limbs[0].morphTargetInfluences[0], 0);
});

test('a fast arrow hits a thin target between frames once, then remains recoverable', t => {
  let damage = 0, calls = 0;
  const target = { hitTest: point => Math.abs(point.z + 4) < 0.035, hurt: amount => { damage += amount; calls++; return true; } };
  const f = fixture(t, { targets: [target] }), arrow = f.load();
  f.draw(0.65); f.squeeze(f.drawHand, false);
  for (let i = 0; i < 40; i++) f.tick(0.05);
  assert.equal(calls, 1); assert.ok(damage > 40); assert.equal(arrow.phase, 'ground');
  f.move(f.drawHand, arrow.root.position.clone()); f.squeeze(f.drawHand, true);
  assert.equal(arrow.phase, 'held'); assert.equal(arrow.heldBy, f.drawHand);
});

test('rock collision stops an arrow before a creature behind it, without mining', t => {
  let damage = 0;
  const blocker = { hitTest: point => Math.abs(point.z + 2) < 0.05 };
  const target = { hitTest: point => Math.abs(point.z + 4) < 0.1, hurt: () => { damage++; return true; } };
  const f = fixture(t, { targets: [target], blockers: [blocker] }), arrow = f.load();
  f.draw(0.65); f.squeeze(f.drawHand, false);
  for (let i = 0; i < 6; i++) f.tick(0.05);
  assert.equal(damage, 0); assert.equal(arrow.phase, 'ground');
  assert.ok(arrow.root.position.z > -2);
});

test('quiver access takes priority over removing a worn backpack, and putting an arrow back frees the hand', t => {
  const f = fixture(t);
  const backpack = createBackpack({ scene: f.scene, rig: f.rig, states: f.states, tools: f.tools, renderer: f.renderer, camera: f.camera });
  backpack.debug.wear(); backpack.update();
  const arrow = f.takeArrow(); backpack.update();
  assert.equal(backpack.getStatus(), 'worn'); assert.equal(arrow.phase, 'held');
  f.squeeze(f.drawHand, false); backpack.update();
  assert.equal(f.archery.debug.arrows.length, 0); assert.equal(f.drawHand.objectGrip.children.length, 0);
  setPackWorn(false);
});

test('terrain stops arrows, loose shots expire, and repeated shooting stays within the object budget', t => {
  const f = fixture(t);
  for (let n = 0; n < ARCHERY.maxArrows + 5; n++) { f.load(); f.draw(0.3); f.squeeze(f.drawHand, false); }
  assert.equal(f.archery.debug.arrows.length, ARCHERY.maxArrows);
  for (let i = 0; i < 80; i++) f.tick(0.05);
  assert.ok(f.archery.debug.arrows.every(arrow => arrow.phase === 'ground'));
  for (const arrow of f.archery.debug.arrows) arrow.age = ARCHERY.lifetime;
  f.tick(); assert.equal(f.archery.debug.arrows.length, 0);
});
