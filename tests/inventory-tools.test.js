import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createInventoryTools } from '../src/inventory-tools.js';
import { createHeldAxe } from '../src/axe.js';
import { createHeldTorch, updateTorchLighting } from '../src/torch.js';
import { addInventoryItem, getInventoryCount } from '../src/inventory.js';
import { createGripHold } from '../src/grip-hold.js';

function mockAssets(t, pending = null) {
  const original = globalThis.Audio;
  globalThis.Audio = class {
    paused = true;
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  };
  t.after(() => { globalThis.Audio = original; });
  t.mock.method(GLTFLoader.prototype, 'load', (_url, success) => {
    const load = () => {
      const model = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(.1, .6, .1), new THREE.MeshBasicMaterial());
      mesh.position.y = .2; model.add(mesh);
      const flame = new THREE.Group(); flame.name = 'FlameAnchor'; model.add(flame);
      success({ scene: model });
    };
    if (pending) pending.push(load); else load();
  });
}
function hand(scene, handedness) {
  const grip = new THREE.Group(), objectGrip = new THREE.Group();
  grip.add(objectGrip); scene.add(grip);
  return { handedness, grip, objectGrip, inputSource: { gamepad: { buttons: Array.from({ length: 6 }, () => ({ pressed: false })) } } };
}

test('three-second grip must stay on the same item and source, and fires once', () => {
  const hold = createGripHold(), source = {};
  for (let i = 0; i < 29; i++) assert.equal(hold.update('axe', source, true, .1).complete, false);
  assert.equal(hold.update('axe', source, true, .1).complete, true);
  assert.equal(hold.update('axe', source, true, .1).complete, false);
  hold.update('axe', source, false, .1);
  for (let i = 0; i < 20; i++) hold.update('axe', source, true, .1);
  assert.ok(hold.update('torch', source, true, .1).progress < .1, 'changing item cancels old progress');
  hold.update(null, source, true, .1);
  assert.ok(hold.update('torch', source, true, .1).progress < .1, 'pointing away cancels');
  assert.ok(hold.update('torch', {}, true, .1).progress < .1, 'reconnection cancels');
  assert.equal(hold.update('torch', null, true, 100).complete, false);
  assert.equal(hold.update('torch', source, true, 100).complete, false, 'one stalled frame cannot equip');
});

test('equip consumes one inventory item, uses either hand, and drops/regrabs the actual tool', t => {
  mockAssets(t);
  const scene = new THREE.Scene();
  const left = hand(scene, 'left'), right = hand(scene, 'right');
  const tools = createInventoryTools({ scene, states: [left, right] });
  const axes = getInventoryCount('axe'), torches = getInventoryCount('torch');
  addInventoryItem('axe', 2); addInventoryItem('torch', 1);
  left.inputSource.gamepad.buttons[1].pressed = true;
  right.inputSource.gamepad.buttons[1].pressed = true;
  assert.equal(tools.equip('axe', left).ok, true);
  const leftAxe = left.objectGrip.children[0];
  assert.equal(leftAxe.name, 'Stone survival axe');
  assert.equal(getInventoryCount('axe'), axes + 1);
  assert.equal(tools.equip('torch', left).ok, false, 'occupied hand must retain inventory');
  assert.equal(getInventoryCount('torch'), torches + 1);
  assert.equal(tools.equip('axe', right).ok, true, 'second axe can equip independently');
  const rightAxe = right.objectGrip.children[0];
  assert.notEqual(leftAxe, rightAxe);
  assert.equal(getInventoryCount('axe'), axes);
  tools.update(.016);
  assert.equal(leftAxe.parent, left.objectGrip, 'right-hand grip cannot control the left axe');
  left.inputSource.gamepad.buttons[1].pressed = false; tools.update(.016);
  assert.equal(leftAxe.parent, scene);
  assert.equal(rightAxe.parent, right.objectGrip);
  left.grip.position.copy(leftAxe.position); left.grip.position.y += .14;
  left.inputSource.gamepad.buttons[1].pressed = true; tools.update(.016);
  assert.equal(leftAxe.parent, left.objectGrip, 'dropped axe can be picked up with left hand');
  left.inputSource = null; tools.update(.016);
  assert.equal(leftAxe.parent, scene, 'disconnect drops equipped tool');
  right.inputSource.gamepad.buttons[1].pressed = false; tools.update(.016);
  right.inputSource.gamepad.buttons[1].pressed = true;
  assert.equal(tools.equip('torch', right).ok, true);
  assert.equal(right.objectGrip.children[0].name, 'Handheld fire torch');
  assert.equal(getInventoryCount('torch'), torches);
});

test('unloaded model and cancelled grip never spend inventory or spawn a world copy', t => {
  const pending = []; mockAssets(t, pending);
  const scene = new THREE.Scene(), left = hand(scene, 'left');
  const tools = createInventoryTools({ scene, states: [left] });
  const before = getInventoryCount('torch'); addInventoryItem('torch');
  left.inputSource.gamepad.buttons[1].pressed = true;
  assert.equal(tools.equip('torch', left).ok, false);
  assert.equal(getInventoryCount('torch'), before + 1);
  for (const load of pending) load();
  assert.equal(scene.children.length, 1, 'reserve models remain off-scene');
  left.inputSource.gamepad.buttons[1].pressed = false;
  assert.equal(tools.equip('torch', left).ok, false);
  assert.equal(getInventoryCount('torch'), before + 1);
  left.inputSource.gamepad.buttons[1].pressed = true;
  assert.equal(tools.equip('torch', left).ok, true);
  assert.equal(getInventoryCount('torch'), before);
});

test('left torch ignition uses B and shared terrain lighting follows a lit equipped torch', t => {
  mockAssets(t);
  const scene = new THREE.Scene(), left = hand(scene, 'left'), right = hand(scene, 'right');
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.ShaderMaterial({
    fragmentShader: 'uniform float uGrassTileMetres;\nvec3 light = ambient + vec3(1.23, 1.09, 0.86) * sun;',
  }));
  sand.name = 'sand-0-0'; scene.add(sand);
  const starter = createHeldTorch({ scene, states: [left, right] });
  const equipped = createHeldTorch({ scene, states: [left, right], spawnOnGround: false });
  left.inputSource.gamepad.buttons[1].pressed = true;
  assert.equal(equipped.equip(left), true);
  right.inputSource.gamepad.buttons[5].pressed = true;
  starter.update(.016); equipped.update(.016); updateTorchLighting(scene);
  assert.equal(equipped.isLit(), true);
  assert.ok(sand.material.uniforms.uTorchStrength.value > 0);
  assert.equal(equipped.getObject().parent, left.objectGrip);
  right.inputSource.gamepad.buttons[5].pressed = false;
  equipped.update(.016);
  right.inputSource.gamepad.buttons[5].pressed = true;
  equipped.update(.016); updateTorchLighting(scene);
  assert.equal(equipped.isLit(), false);
  assert.equal(sand.material.uniforms.uTorchStrength.value, 0);
});

test('an equipped axe uses left-hand swing motion for chopping', t => {
  mockAssets(t);
  const scene = new THREE.Scene(), left = hand(scene, 'left');
  const trees = new THREE.Group(); trees.name = 'Alien desert trees'; scene.add(trees);
  const tree = new THREE.Group(); tree.userData.oasisTree = true; trees.add(tree);
  const axe = createHeldAxe({ scene, states: [left], spawnOnGround: false });
  left.inputSource.gamepad.buttons[1].pressed = true; left.grip.position.set(0, 2, 0);
  assert.equal(axe.equip(left), true);
  axe.update(.016);
  left.grip.position.x = .1; axe.update(.016);
  assert.equal(tree.userData.chopState.hits, 1);
});
