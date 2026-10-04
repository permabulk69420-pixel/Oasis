import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { terrainHeight } from '../src/world.js';
import { createTools } from '../src/tools.js';
import { createAxeKind } from '../src/axe.js';
import { createTorchKind } from '../src/torch.js';
import { createBody, launch, stepBody, bodyOrigin, isMoving, placeAtRest } from '../src/falling.js';
import {
  INVENTORY_LIMITS, addInventoryItem, getInventoryCount, getInventoryItems, getInventoryWeight, importInventoryItems, removeInventoryItem,
} from '../src/inventory.js';
import { SAVE, cleanSave } from '../src/save-game.js';
import {
  getSurvivalStats, resetSurvival, exportSurvival, importSurvival, updateSurvival, canSprint, STAT_MAX,
} from '../src/survival.js';

const ZERO = new THREE.Vector3();

// ---------------------------------------------------------------------------------------------- inventory and survival

test('the inventory goes out as plain data and comes back as it was, replacing what was there', () => {
  importInventoryItems([]);
  addInventoryItem('stick', 3); addInventoryItem('stone', 2); addInventoryItem('axe', 1);
  const saved = JSON.parse(JSON.stringify(getInventoryItems()));
  const weight = getInventoryWeight();
  importInventoryItems([{ type: 'fibre', count: 9 }]);
  assert.equal(getInventoryCount('stick'), 0, 'importing replaces; it does not add');
  assert.equal(importInventoryItems(saved), 3);
  assert.deepEqual(getInventoryItems().sort((a, b) => a.type.localeCompare(b.type)), saved.sort((a, b) => a.type.localeCompare(b.type)));
  assert.equal(getInventoryWeight(), weight);
  importInventoryItems([]);
});

test('the inventory ignores what is not a real count, and never grows past its limits', () => {
  importInventoryItems([
    { type: 'stick', count: 2 }, { type: 'stick', count: 1 }, { type: 'bad', count: 0 }, { type: 'bad', count: -1 },
    { type: 'bad', count: NaN }, { type: '', count: 1 }, { type: 'x'.repeat(INVENTORY_LIMITS.maxTypeLength + 1), count: 1 },
    { type: 'many', count: 1e12 }, { type: 'huge', count: 1e20 }, null, 'stick',
  ]);
  assert.equal(getInventoryCount('stick'), 3, 'two entries for one thing add up');
  assert.equal(getInventoryCount('bad'), 0);
  assert.equal(getInventoryCount('many'), INVENTORY_LIMITS.maxCount, 'a silly count is cut down');
  assert.equal(getInventoryCount('huge'), 0, 'and one that is not even a whole number the game can count is dropped');
  assert.equal(importInventoryItems('nothing'), 0);
  assert.equal(getInventoryItems().length, 0, 'something that is not a list empties it');
  importInventoryItems(Array.from({ length: 200 }, (_, i) => ({ type: `item${i}`, count: 1 })));
  assert.equal(getInventoryItems().length, INVENTORY_LIMITS.maxTypes);
  importInventoryItems([{ type: 'wood', count: INVENTORY_LIMITS.maxCount }, { type: 'wood', count: 5 }]);
  assert.equal(getInventoryCount('wood'), INVENTORY_LIMITS.maxCount);
  importInventoryItems([]);
});

test('the survival numbers go out rounded and come back, and a worn-out sprint starts fresh', () => {
  resetSurvival();
  updateSurvival(10, { sprinting: true });
  updateSurvival(0.5);
  const before = exportSurvival();
  assert.deepEqual(Object.keys(before).sort(), ['food', 'health', 'stamina', 'water']);
  for (const value of Object.values(before)) assert.equal(Math.round(value * 10), value * 10, 'one decimal');
  resetSurvival();
  assert.equal(importSurvival(JSON.parse(JSON.stringify(before))), true);
  assert.deepEqual(exportSurvival(), before);

  importSurvival({ stamina: 0 });
  assert.equal(canSprint(), false, 'no stamina, no sprint');
  importSurvival({ stamina: 60, food: NaN, water: 'wet', health: 1e9 });
  assert.equal(getSurvivalStats().stamina, 60);
  assert.equal(getSurvivalStats().health, STAT_MAX, 'clamped');
  assert.ok(getSurvivalStats().food > 0, 'a stat that is not a number keeps its value');
  assert.equal(canSprint(), true);
  assert.equal(importSurvival(null), false);
  resetSurvival();
});

// ---------------------------------------------------------------------------------------------- a body put down at rest

test('a body put down at rest stays exactly there, whether lying on the sand or stuck in it', () => {
  const shape = { bottom: -0.52, top: 0.955, com: 0.15, radius: 0.025, landing: 'stick' };
  for (const phase of ['rest', 'stuck']) {
    const body = createBody(shape);
    const origin = new THREE.Vector3(12, 3.4, -5);
    const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0.3, 0).normalize(), 1.2);
    const long = new THREE.Quaternion(quaternion.x * 2, quaternion.y * 2, quaternion.z * 2, quaternion.w * 2); // a turn that is not unit length
    placeAtRest(body, { origin, quaternion: long }, phase);
    assert.equal(body.phase, phase);
    assert.equal(isMoving(body), false);
    assert.ok(bodyOrigin(body, new THREE.Vector3()).distanceTo(origin) < 1e-9, 'the model origin is where it was left');
    assert.ok(Math.abs(body.quaternion.length() - 1) < 1e-9);
    const centre = body.centre.clone();
    assert.equal(stepBody(body, 0.05, () => 0), false, 'nothing moves it');
    assert.ok(body.centre.equals(centre));
  }
  const odd = placeAtRest(createBody(shape), { origin: ZERO, quaternion: new THREE.Quaternion() }, 'air');
  assert.equal(odd.phase, 'rest', 'only resting or stuck is believed');
});

// ---------------------------------------------------------------------------------------------- tools

function toolModel(meshName) {
  const scene = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.6, 0.04));
  mesh.name = meshName;
  mesh.position.y = 0.25;
  scene.add(mesh);
  return scene;
}

function world(t, { load = true } = {}) {
  t.mock.method(GLTFLoader.prototype, 'load', (url, onLoad) => {
    if (load) onLoad({ scene: toolModel(url.includes('/axe/') ? 'WoodenHandle' : 'WoodenShaft'), animations: [] });
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
    scene, rig, states: [state], renderer, onError: () => {},
    kinds: [createTorchKind({ scene, onError: () => {} }), createAxeKind({ scene, onError: () => {} })],
  });
  tools.update(0.016);
  return { scene, rig, tools, state, buttons, grip };
}

const settle = tools => {
  for (let i = 0; i < 900; i++) tools.update(0.016);
};
const quaternionNear = (a, b) => Math.abs(a.dot(b)) > 1 - 1e-6;
const clear = () => { importInventoryItems([]); };

test('tools: ready once every model has arrived, and not before', t => {
  assert.equal(world(t).tools.ready, true);
  assert.equal(world(t, { load: false }).tools.ready, false, 'the models never came');
});

test('tools: hips, a tool lying in the sand, a torch still burning and the ones standing at the start all come back as they were', t => {
  clear();
  const a = world(t);
  assert.equal(a.tools.getInstances().filter(instance => instance.defaultSpawn).length, 2, 'a torch and an axe stand at the start');

  addInventoryItem('axe', 1);
  assert.equal(a.tools.equip('axe', 'right'), true);
  const fallen = a.tools.throwTool('torch', {
    origin: new THREE.Vector3(310, terrainHeight(310, -295) + 1.2, -295),
    quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.4),
    velocity: new THREE.Vector3(1.5, 0, 0.5), spin: ZERO,
  });
  fallen.kind.setLit(fallen, true);
  settle(a.tools);
  assert.equal(fallen.fall.phase, 'rest', 'it has landed and is lying there');
  assert.equal(fallen.state.lit, true);

  const snapshot = JSON.parse(JSON.stringify(a.tools.snapshot()));
  assert.deepEqual(snapshot.kinds.sort(), ['axe', 'torch']);
  assert.equal(snapshot.items.length, a.tools.getInstances().length);
  const clean = cleanSave({ version: SAVE.version, tools: snapshot }).tools;
  assert.equal(clean.items.length, snapshot.items.length, 'the checks let all of it through');

  const b = world(t);
  assert.equal(b.tools.getInstances().length, 2, 'a new world starts with the two at the start');
  assert.equal(b.tools.restoreSnapshot(clean), snapshot.items.length);

  assert.deepEqual(b.tools.getHipSlots(), { left: null, right: 'axe' });
  assert.equal(b.tools.getInstances('axe').length, 2, 'the axe on the hip, and the one standing at the start');
  const axes = b.tools.getInstances('axe');
  assert.equal(axes.filter(instance => instance.defaultSpawn).length, 0, 'the ones the game put there are gone; the saved ones stand in their place');
  const torches = b.tools.getInstances('torch');
  assert.equal(torches.length, 2);
  const lying = torches.find(instance => instance.fall);
  const standing = torches.find(instance => !instance.fall);
  assert.ok(lying && standing);
  assert.equal(lying.fall.phase, 'rest');
  assert.equal(isMoving(lying.fall), false, 'so it can be picked up anywhere along its length');
  assert.equal(lying.state.lit, true, 'still burning');
  assert.equal(lying.state.flame.group.visible, true);
  assert.equal(standing.state.lit, false);
  assert.ok(lying.root.position.distanceTo(fallen.root.position) < 0.002, 'where it was left');
  assert.ok(quaternionNear(lying.root.quaternion, fallen.root.quaternion), 'turned as it was left');
  assert.equal(lying.root.parent, b.scene);
  const startSpot = standing.root.position;
  assert.ok(Math.abs(startSpot.y - (terrainHeight(startSpot.x, startSpot.z) + standing.kind.groundBottom)) < 0.002, 'the one standing in the sand still stands in it');
  assert.equal(getInventoryCount('axe'), 0, 'nothing leaked into the pockets');

  // and once more through the whole way: the restored world saves the same thing
  const again = JSON.parse(JSON.stringify(b.tools.snapshot()));
  const key = item => `${item.id}:${item.at}:${item.side ?? ''}:${item.fall ?? ''}`;
  assert.deepEqual(again.items.map(key).sort(), snapshot.items.map(key).sort());
  clear();
});

test('tools: a kind the save never heard of keeps its starting tool; a hip that is already taken sends the tool to the pockets', t => {
  clear();
  const { tools } = world(t);
  tools.restoreSnapshot({ kinds: ['axe'], items: [{ id: 'axe', at: 'hip', side: 'left' }] });
  assert.deepEqual(tools.getHipSlots(), { left: 'axe', right: null });
  assert.equal(tools.getInstances('axe').length, 1, 'the axe standing at the start is replaced by the saved one');
  assert.equal(tools.getInstances('torch').length, 1, 'the torch was not in the save, so it still stands there');
  assert.equal(tools.getInstances('torch')[0].defaultSpawn, true);

  const crowded = world(t).tools;
  const placed = crowded.restoreSnapshot({
    kinds: ['axe', 'torch'],
    items: [{ id: 'axe', at: 'hip', side: 'left' }, { id: 'torch', at: 'hip', side: 'left' }],
  });
  assert.equal(placed, 1);
  assert.deepEqual(crowded.getHipSlots(), { left: 'axe', right: null });
  assert.equal(getInventoryCount('torch'), 1, 'not lost: it went in the pockets');
  assert.equal(crowded.getInstances('torch').length, 0);

  assert.equal(crowded.restoreSnapshot(null), 0);
  assert.equal(crowded.restoreSnapshot({ items: 'x' }), 0);
  assert.equal(crowded.restoreSnapshot({ kinds: [], items: [{ id: 'nonesuch', at: 'hip', side: 'left' }, { id: 'axe', at: 'ground', p: [1, 2], q: [0, 0, 0, 1] }] }), 0, 'junk entries are skipped');
  clear();
});

test('tools: one in your hand when the game was saved comes back dropped from where your hand was', t => {
  clear();
  const a = world(t);
  const axe = a.tools.getInstances('axe')[0];
  const from = new THREE.Vector3(300.4, terrainHeight(300.4, -300.2) + 1.3, -300.2);
  a.rig.updateMatrixWorld(true);
  a.grip.position.copy(a.rig.worldToLocal(from.clone()));
  a.grip.updateMatrixWorld(true);
  axe.root.position.copy(from); // within reach of the hand
  a.scene.attach(axe.root);
  a.buttons[1].pressed = true;
  a.tools.update(0.016);
  assert.equal(axe.heldBy, a.state, 'in the hand');
  const snapshot = a.tools.snapshot();
  const entry = snapshot.items.find(item => item.id === 'axe');
  assert.equal(entry.at, 'ground');
  assert.equal(entry.fall, 'air', 'it will be dropped');

  const b = world(t);
  b.tools.restoreSnapshot(cleanSave({ version: SAVE.version, tools: JSON.parse(JSON.stringify(snapshot)) }).tools);
  const restored = b.tools.getInstances('axe')[0];
  assert.ok(isMoving(restored.fall), 'falling');
  const startY = restored.root.position.y;
  settle(b.tools);
  assert.equal(restored.fall.phase, 'rest');
  assert.ok(restored.root.position.y < startY, 'down on the sand');
  assert.ok(Math.abs(restored.root.position.x - entry.p[0]) < 3 && Math.abs(restored.root.position.z - entry.p[2]) < 3, 'near where the hand was');
  clear();
});
