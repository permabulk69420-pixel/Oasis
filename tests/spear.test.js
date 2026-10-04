import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createTools, holsterPose } from '../src/tools.js';
import { createSpearKind, SPEAR, SPEAR_GRIP, SPEAR_HELD_ROTATION, SPEAR_HOLSTER, SPEAR_THRUST_TILT } from '../src/spear.js';
import { createTorchKind } from '../src/torch.js';
import { createAxeKind } from '../src/axe.js';
import { terrainHeight } from '../src/world.js';
import { createSurvivorMenu } from '../src/survivor-menu.js';
import { ITEMS, RECIPES, craftItem, getRecipeStatus } from '../src/crafting.js';
import { addInventoryItem, getInventoryCount, getInventoryItemWeight, getInventoryItems, removeInventoryItem } from '../src/inventory.js';

// The spear as the game uses it: a stand-in model with the same part names as public/models/spear/spear.glb, driven through
// the real tools, crafting, inventory and menu code. (spear-model.test.js checks the real .glb file.)

function spearModel() {
  const root = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.265, 0.04), new THREE.MeshStandardMaterial({ name: 'Spear' }));
  shaft.name = 'Shaft';
  shaft.position.y = 0.1125;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.06), shaft.material);
  head.name = 'Spear';
  head.position.y = 0.75;
  const glow = new THREE.MeshStandardMaterial({ name: 'Glow', emissive: 0x40f2ff });
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.01, 6, 4), glow);
  bead.name = 'Bead';
  bead.position.set(0, 0.576, -0.04);
  root.add(shaft, head, bead);
  return root;
}

function stickModel(meshName) {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.6, 0.04));
  mesh.name = meshName;
  mesh.position.y = 0.25;
  scene.add(mesh);
  return scene;
}

function fixture(t, { exposure = { value: 1 } } = {}) {
  t.mock.method(GLTFLoader.prototype, 'load', (url, onLoad) => {
    const scene = url.includes('/spear/') ? spearModel() : stickModel(url.includes('/axe/') ? 'WoodenHandle' : 'WoodenShaft');
    onLoad({ scene, animations: [] });
  });
  const scene = new THREE.Scene();
  const rig = new THREE.Group();
  rig.position.set(300, 20, -300);
  scene.add(rig);
  const xrCamera = new THREE.PerspectiveCamera();
  xrCamera.position.copy(rig.position).add(new THREE.Vector3(0, 1.7, 0));
  xrCamera.updateMatrixWorld(true);
  const renderer = { xr: { isPresenting: true, getCamera: () => xrCamera } };
  const grip = new THREE.Group();
  const objectGrip = new THREE.Group();
  grip.add(objectGrip);
  rig.add(grip);
  const buttons = Array.from({ length: 6 }, () => ({ pressed: false, value: 0 }));
  const state = { handedness: 'right', grip, objectGrip, inputSource: { gamepad: { buttons } } };
  const tools = createTools({
    scene, rig, states: [state], renderer, onError: error => assert.fail(error),
    kinds: [
      createTorchKind({ scene, onError: () => {} }),
      createAxeKind({ scene, onError: () => {} }),
      createSpearKind({ getExposure: () => exposure.value }),
    ],
  });
  const handTo = world => { rig.updateMatrixWorld(true); grip.position.copy(rig.worldToLocal(world.clone())); grip.updateMatrixWorld(true); };
  const squeeze = value => { buttons[1].pressed = value; tools.update(0.016); };
  tools.update(0.016); // place the belt
  return { scene, rig, tools, state, handTo, squeeze, xrCamera, exposure };
}

function clearInventory(type) {
  removeInventoryItem(type, getInventoryCount(type));
}

const worldOf = object => object.getWorldPosition(new THREE.Vector3());

test('the spear stands planted in the sand a little way from the axe and torch, upright', t => {
  const { tools, scene } = fixture(t);
  const [spear] = tools.getInstances('spear');
  assert.ok(spear, 'one spear at the start');
  assert.equal(tools.getInstances('spear').length, 1);
  assert.equal(spear.root.parent, scene);
  const { x, z } = SPEAR.spawn;
  assert.ok(Math.abs(spear.root.position.x - x) < 1e-9 && Math.abs(spear.root.position.z - z) < 1e-9);
  assert.ok(Math.abs(spear.root.position.y - (terrainHeight(x, z) + SPEAR.groundBottom)) < 1e-9, 'its height follows the sand');
  assert.ok(spear.root.quaternion.angleTo(new THREE.Quaternion()) < 1e-6, 'standing straight up');
  assert.ok(SPEAR.groundBottom > 0.4 && SPEAR.groundBottom < 0.52, 'the butt end (0.52 m below the origin) goes a few centimetres into the sand');
  for (const id of ['axe', 'torch']) {
    for (const other of tools.getInstances(id)) {
      const apart = Math.hypot(other.root.position.x - x, other.root.position.z - z);
      assert.ok(apart > 0.9, `the spear is ${apart.toFixed(2)} m from the ${id}, so reaching for one never picks up the other`);
    }
  }
});

test('gripped by the wrap at the butt end, flipped like the torch and then tilted so the point goes forward, and nothing else on it casts a shadow', t => {
  const { tools, state, handTo, squeeze } = fixture(t);
  const [spear] = tools.getInstances('spear');
  assert.deepEqual(spear.root.userData.gripSurface, SPEAR_GRIP);
  assert.deepEqual(SPEAR_GRIP.meshes, ['Shaft'], 'the hand closes on the shaft, never the stone point or the tassel');
  assert.ok(SPEAR_GRIP.point[1] < -0.3 && SPEAR_GRIP.point[1] > -0.45, `the hand holds the back of the shaft (${SPEAR_GRIP.point[1]} m from the origin)`);
  assert.equal(SPEAR_GRIP.point[0], 0);
  assert.equal(SPEAR_GRIP.point[2], 0);
  assert.ok(0.52 + SPEAR_GRIP.point[1] > 0.06, 'a few centimetres of butt stay behind the fist');
  spear.root.traverse(object => { if (object.isMesh) assert.equal(object.castShadow || object.receiveShadow, false); });

  handTo(worldOf(spear.root).add(new THREE.Vector3(0.05, 0.1, 0.05)));
  squeeze(true);
  assert.equal(spear.heldBy, state, 'picked up from the sand by reaching for the middle of the shaft');
  assert.equal(state.objectGrip.children[0], spear.root);
  assert.ok(spear.root.quaternion.angleTo(SPEAR_HELD_ROTATION) < 1e-6);
  const expected = new THREE.Vector3(...SPEAR_GRIP.point).applyQuaternion(SPEAR_HELD_ROTATION).negate();
  assert.ok(spear.root.position.distanceTo(expected) < 1e-9, 'the grip point sits in the palm');
  const torch = tools.getInstances('torch')[0];
  assert.ok(Math.abs(SPEAR_HELD_ROTATION.angleTo(torch.kind.heldRotation) - THREE.MathUtils.degToRad(SPEAR_THRUST_TILT)) < 1e-6,
    'held like the torch, then turned about the palm normal so the point goes out in front of the fist');
  assert.ok(SPEAR_THRUST_TILT > 15 && SPEAR_THRUST_TILT < 80, 'enough to point forward, not so much that the fingers cannot close round the shaft');
});

test('on a hip it leans back with the point behind the shoulder and the butt well clear of the ground', () => {
  for (const side of ['left', 'right']) {
    const pose = holsterPose(SPEAR_HOLSTER, side);
    const shaftDir = new THREE.Vector3(0, 1, 0).applyQuaternion(pose.quaternion);
    const sign = side === 'left' ? -1 : 1;
    assert.ok(shaftDir.y > 0.7 && shaftDir.y < 0.95, `${side}: the point is up and leaning (${shaftDir.y.toFixed(2)})`);
    assert.ok(shaftDir.z > 0.3, `${side}: it leans back, not forward into your path`);
    assert.ok(shaftDir.x * sign > 0, `${side}: and a little outward, away from the body`);
    const at = modelY => new THREE.Vector3(0, modelY, 0).applyQuaternion(pose.quaternion).add(pose.position);
    assert.ok(at(SPEAR_HOLSTER.along).length() < 1e-9, `${side}: the chosen point of the shaft sits on the hip anchor`);
    // The belt anchor hangs 0.8 m under the head, so for a 1.7 m player it is 0.9 m up.
    const butt = at(-0.52);
    assert.ok(0.9 + butt.y > 0.2, `${side}: the butt end is ${(0.9 + butt.y).toFixed(2)} m off the ground at 1.7 m head height`);
    assert.ok(0.9 + butt.y < 0.6, `${side}: but it is not floating at the hip`);
    assert.ok(at(0.955).y < 0.8, `${side}: and the point stays below head height`);
  }
});

test('hip, hand and chest: it holsters where you let go, comes off again, and packs away into the inventory', t => {
  const { tools, state, handTo, squeeze, xrCamera } = fixture(t);
  const [spear] = tools.getInstances('spear');
  handTo(worldOf(spear.root).add(new THREE.Vector3(0.05, 0.1, 0.05)));
  squeeze(true);
  assert.equal(spear.heldBy, state);

  handTo(worldOf(tools.belt.right));
  squeeze(false);
  assert.equal(spear.slot, 'right');
  assert.deepEqual(tools.getHipSlots(), { left: null, right: 'spear' });
  const pose = holsterPose(SPEAR_HOLSTER, 'right');
  assert.ok(spear.root.position.distanceTo(pose.position) < 1e-6 && spear.root.quaternion.angleTo(pose.quaternion) < 1e-6);
  assert.equal(spear.root.parent, tools.belt.right);

  squeeze(true);
  assert.equal(spear.heldBy, state, 'drawn from the hip again');
  const before = getInventoryCount('spear');
  handTo(worldOf(xrCamera).add(new THREE.Vector3(0, -0.38, -0.12)));
  squeeze(false);
  assert.equal(getInventoryCount('spear'), before + 1, 'let go at the chest, it goes in the inventory');
  assert.ok(!tools.getInstances('spear').includes(spear));
  assert.equal(getInventoryItemWeight('spear'), 10);

  assert.equal(tools.equip('spear', 'left'), true, 'and out again onto a hip from the menu');
  assert.deepEqual(tools.getHipSlots(), { left: 'spear', right: null });
  assert.equal(tools.getInstances('spear').find(instance => instance.slot === 'left').root.parent, tools.belt.left);
  assert.equal(getInventoryCount('spear'), before);
  clearInventory('spear');
});

test('the little bead on the tassel keeps its brightness in the dark, where the exposure is tiny', t => {
  const exposure = { value: 0.82 };
  const { tools } = fixture(t, { exposure });
  const [spear] = tools.getInstances('spear');
  const material = spear.root.getObjectByName('Bead').material;
  assert.equal(material.name, 'Glow');
  const shown = () => material.emissiveIntensity * exposure.value;

  tools.update(0.016);
  assert.ok(Math.abs(shown() - SPEAR.glow.day) < 0.02 * SPEAR.glow.day, `by day it shows ${shown().toFixed(2)}`);
  exposure.value = 0.035;
  tools.update(0.016);
  assert.ok(Math.abs(shown() - SPEAR.glow.night) < 0.02 * SPEAR.glow.night, `at night it shows ${shown().toFixed(2)}`);
  assert.ok(material.emissiveIntensity > 10, 'the night exposure is undone, so the emissive value is large');
  for (const value of [0.06, 0.1, 0.2, 0.35, 0.5, 0.7]) {
    exposure.value = value;
    tools.update(0.016);
    const low = Math.min(SPEAR.glow.day, SPEAR.glow.night), high = Math.max(SPEAR.glow.day, SPEAR.glow.night);
    assert.ok(shown() >= low - 0.02 && shown() <= high + 0.02, `exposure ${value}: shows ${shown().toFixed(2)}, inside ${low}..${high}`);
  }

  // Only touch the shared material when the light has really changed.
  let writes = 0;
  let stored = material.emissiveIntensity;
  Object.defineProperty(material, 'emissiveIntensity', { get: () => stored, set: value => { writes++; stored = value; } });
  for (let i = 0; i < 20; i++) tools.update(0.016);
  assert.equal(writes, 0, 'steady light, no writes');
  exposure.value = 0.036;
  tools.update(0.016);
  assert.equal(writes, 1);
});

test('a model without the glow material does not break the spear', () => {
  const kind = createSpearKind({ getExposure: () => 0.04 });
  kind.prepareTemplate(stickModel('Shaft'));
  assert.doesNotThrow(() => kind.updateShared(0.016));
});

test('crafted from three sticks and a stone, all or nothing, and it is a carried tool', () => {
  assert.deepEqual(getInventoryItems(), [], 'a clean inventory');
  assert.equal(ITEMS.spear.category, 'TOOL');
  assert.equal(ITEMS.spear.equippable, true);
  assert.ok(ITEMS.spear.description.length > 20);
  const recipe = RECIPES.find(item => item.id === 'spear');
  assert.deepEqual({ ...recipe.ingredients }, { stick: 3, stone: 1 });
  assert.equal(recipe.output, 'spear');
  assert.ok(Object.isFrozen(recipe) && Object.isFrozen(recipe.ingredients), 'recipes cannot be edited at run time');

  addInventoryItem('stick', 2);
  addInventoryItem('stone', 1);
  assert.equal(getRecipeStatus('spear').canCraft, false, 'one stick short');
  assert.equal(craftItem('spear'), false);
  assert.equal(getInventoryCount('stick'), 2, 'a failed craft spends nothing');
  assert.equal(getInventoryCount('stone'), 1);
  addInventoryItem('stick', 1);
  assert.equal(craftItem('spear'), true);
  assert.equal(getInventoryCount('spear'), 1);
  assert.equal(getInventoryCount('stick'), 0);
  assert.equal(getInventoryCount('stone'), 0);
  assert.equal(craftItem('spear'), false, 'a double click cannot duplicate it');
  clearInventory('spear');
});

// A minimal DOM, as in survivor-menu.test.js: the menu code itself is the real implementation.
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.listeners = {}; this.attributes = {}; }
  append(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); } }
  setAttribute(k, v) { this.attributes[k] = v; }
  addEventListener(k, v) { this.listeners[k] = v; }
  remove() { this.parent.children = this.parent.children.filter(x => x !== this); }
  focus() { globalThis.document.activeElement = this; }
  querySelector(s) { return this.querySelectorAll(s)[0]; }
  querySelectorAll(s) {
    return this.children.flatMap(n => [n, ...(n.querySelectorAll?.('*') || [])])
      .filter(n => s === '*' || n.dataset?.action === s.match(/data-action="([^"]+)"/)?.[1]);
  }
}

test('the menu lists the spear recipe, crafts it, draws its icon, and puts it on a hip', () => {
  const originalDocument = globalThis.document;
  const body = new Element('body');
  const drawn = [];
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
    const slots = { left: null, right: null };
    const tools = {
      getHipSlots: () => ({ ...slots }),
      equip(type, side) { if (!removeInventoryItem(type, 1)) return false; slots[side] = type; return true; },
      unequip(side) { if (!slots[side]) return false; addInventoryItem(slots[side], 1); slots[side] = null; return true; },
    };
    const menu = createSurvivorMenu({ scene, renderer: { xr }, states: [], tools });
    const click = action => { body.querySelector(`[data-action="${action}"]`).listeners.click(); menu.update(); };
    addInventoryItem('stick', 3);
    addInventoryItem('stone', 1);
    menu.setOpen(true);
    menu.update();

    click('crafting');
    assert.ok(body.querySelector('[data-action="recipe:spear"]'), 'the spear is in the crafting list');
    assert.equal(RECIPES.length, 4, 'the axe, torch, spear and campfire');
    click('recipe:spear');
    assert.ok(drawn.includes('Stone-tipped spear'), 'the recipe page names the spear');
    assert.equal(body.querySelector('[data-action="craft"]').disabled, false, 'three sticks and a stone are enough');
    click('craft');
    assert.equal(getInventoryCount('spear'), 1);
    assert.equal(getInventoryCount('stick'), 0);

    click('inventory');
    click('item:spear');
    click('equip:right');
    assert.deepEqual(slots, { left: null, right: 'spear' }, 'out of the inventory and onto the right hip');
    assert.equal(getInventoryCount('spear'), 0);
  } finally {
    globalThis.document = originalDocument;
    clearInventory('spear');
  }
});
