import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createTools, holsterPose } from '../src/tools.js';
import { createPickaxeKind, PICKAXE, PICKAXE_GRIP, PICKAXE_HELD_ROTATION, PICKAXE_HOLSTER } from '../src/pickaxe.js';
import { createAxeKind } from '../src/axe.js';
import { createSpearKind } from '../src/spear.js';
import { createTorchKind } from '../src/torch.js';
import { terrainHeight } from '../src/world.js';
import { ITEMS, RECIPES, craftItem, getRecipeStatus } from '../src/crafting.js';
import { addInventoryItem, getInventoryCount, getInventoryItemWeight, removeInventoryItem } from '../src/inventory.js';
import { blowDamage } from '../src/weapon-hits.js';

// The pickaxe: the real .glb file (tools/pickaxe/build_pickaxe.py makes it), then the kind driven through the real tools code.

function readGlb() {
  const buffer = fs.readFileSync(new URL('../public/models/pickaxe/pickaxe.glb', import.meta.url));
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF', 'a binary glTF');
  const jsonLength = buffer.readUInt32LE(12);
  return { json: JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8')), bytes: buffer.length };
}

function nodeBounds(json, nodeName) {
  const node = json.nodes.find(n => n.name === nodeName);
  assert.ok(node, `the model has a ${nodeName} node`);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  for (const primitive of json.meshes[node.mesh].primitives) {
    const position = json.accessors[primitive.attributes.POSITION];
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], position.min[i]); max[i] = Math.max(max[i], position.max[i]); }
    triangles += json.accessors[primitive.indices].count / 3;
  }
  return { min, max, triangles };
}

test('the pickaxe model is two parts found by name, painted with vertex colours, within the hand-tool budget', () => {
  const { json, bytes } = readGlb();
  assert.deepEqual(json.nodes.map(n => n.name).sort(), ['Pickaxe', 'Shaft']);
  assert.ok(!json.skins && !json.animations && !json.images && !json.textures, 'a static prop with no textures');
  assert.deepEqual(json.materials.map(m => m.name).sort(), ['Glow', 'Pickaxe']);
  for (const material of json.materials) assert.ok(!material.doubleSided, `${material.name} is single sided (every part is a closed solid)`);
  const total = nodeBounds(json, 'Shaft').triangles + nodeBounds(json, 'Pickaxe').triangles;
  assert.ok(total >= 1500 && total <= 3000, `${total} triangles`);
  assert.ok(bytes <= 120_000, `${bytes} bytes`);
});

test('the haft runs from the butt to the top, the grip is at the origin, and the pick point is where the game says it is', () => {
  const { json } = readGlb();
  const shaft = nodeBounds(json, 'Shaft');
  assert.ok(shaft.min[1] > -0.33 && shaft.min[1] < -0.28, `the butt end is ${shaft.min[1]} m below the grip`);
  assert.ok(shaft.max[1] > 0.45 && shaft.max[1] < 0.55, `the haft's top is ${shaft.max[1]} m above the grip`);
  const whole = nodeBounds(json, 'Pickaxe');
  const reach = Math.max(whole.max[0], -whole.min[0]);
  assert.ok(Math.abs(whole.max[0] - PICKAXE.tip[0]) < 0.01, `the long pick's point is at x ${whole.max[0]}, tip says ${PICKAXE.tip[0]}`);
  assert.ok(whole.min[0] > -0.2 && reach < 0.31, 'the head is about half a metre across');
  assert.ok(PICKAXE.tip[1] < 0.45 && PICKAXE.tip[1] > 0.3, 'the pick has dropped below the head, curving down to its point');
  assert.ok(Math.abs(PICKAXE.groundBottom - (0.31 - 0.04)) < 0.02, 'planted with the butt end a few centimetres in the sand');
});

function pickaxeModel() {
  const root = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.81, 0.04), new THREE.MeshStandardMaterial({ name: 'Pickaxe' }));
  shaft.name = 'Shaft';
  shaft.position.y = 0.095;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.08, 0.07), shaft.material);
  head.name = 'Pickaxe';
  head.position.set(0.057, 0.42, 0);
  const glow = new THREE.MeshStandardMaterial({ name: 'Glow', emissive: 0x40f2ff });
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.01, 6, 4), glow);
  bead.name = 'Bead';
  bead.position.set(0, 0.34, -0.06);
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
    const scene = url.includes('/pickaxe/') ? pickaxeModel() : stickModel(url.includes('/axe/') ? 'WoodenHandle' : 'Shaft');
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
      createTorchKind({ scene, onError: () => {} }), createAxeKind({ scene, onError: () => {} }),
      createSpearKind({ getExposure: () => exposure.value }), createPickaxeKind({ getExposure: () => exposure.value }),
    ],
  });
  const handTo = world => { rig.updateMatrixWorld(true); grip.position.copy(rig.worldToLocal(world.clone())); grip.updateMatrixWorld(true); };
  const squeeze = value => { buttons[1].pressed = value; tools.update(0.016); };
  tools.update(0.016);
  return { scene, rig, tools, state, handTo, squeeze, exposure };
}

test('the pickaxe stands planted in the sand, clear of the other starting tools', t => {
  const { tools, scene } = fixture(t);
  const [pick] = tools.getInstances('pickaxe');
  assert.ok(pick, 'one pickaxe at the start');
  assert.equal(pick.root.parent, scene);
  const { x, z } = PICKAXE.spawn;
  assert.ok(Math.abs(pick.root.position.y - (terrainHeight(x, z) + PICKAXE.groundBottom)) < 1e-9, 'its height follows the sand');
  for (const id of ['axe', 'torch', 'spear']) {
    for (const other of tools.getInstances(id)) {
      const apart = Math.hypot(other.root.position.x - x, other.root.position.z - z);
      assert.ok(apart > 0.9, `the pickaxe is ${apart.toFixed(2)} m from the ${id}, so reaching for one never picks up the other`);
    }
  }
});

test('gripped by the leather wrap with the same flip the axe has, and the long pick pointing forward', t => {
  const { tools, state, handTo, squeeze } = fixture(t);
  const [pick] = tools.getInstances('pickaxe');
  assert.deepEqual(pick.root.userData.gripSurface, PICKAXE_GRIP);
  assert.deepEqual(PICKAXE_GRIP.meshes, ['Shaft']);
  pick.root.traverse(object => { if (object.isMesh) assert.equal(object.castShadow || object.receiveShadow, false); });
  handTo(pick.root.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0.05, 0.1, 0.05)));
  squeeze(true);
  assert.equal(pick.heldBy, state, 'picked up from the sand by reaching for the middle of the haft');
  assert.ok(pick.root.quaternion.angleTo(PICKAXE_HELD_ROTATION) < 1e-6);
  assert.ok(pick.root.quaternion.angleTo(tools.getInstances('axe')[0].kind.heldRotation) < 1e-6, 'held just like the axe, so a swing feels the same');
});

test('on a hip it leans back with the head behind the shoulder and the butt well clear of the ground', () => {
  for (const side of ['left', 'right']) {
    const pose = holsterPose(PICKAXE_HOLSTER, side);
    const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(pose.quaternion);
    assert.ok(dir.y > 0.7 && dir.z > 0.3, `${side}: the head is up and leaning back (${dir.toArray().map(n => n.toFixed(2))})`);
    const at = modelY => new THREE.Vector3(0, modelY, 0).applyQuaternion(pose.quaternion).add(pose.position);
    assert.ok(0.9 + at(-0.31).y > 0.35, `${side}: the butt end hangs ${(0.9 + at(-0.31).y).toFixed(2)} m off the ground at 1.7 m head height`);
    assert.ok(at(0.5).y < 0.7, `${side}: and the head stays below head height`);
  }
});

test('its blow is a point on the pick that moves with the tool, and it counts above a swing speed', t => {
  const { tools } = fixture(t);
  const [pick] = tools.getInstances('pickaxe');
  const point = pick.kind.hit.point(new THREE.Vector3(), pick);
  assert.deepEqual(point.toArray(), [...PICKAXE.tip]);
  assert.equal(blowDamage(pick.kind.hit, pick.kind.hit.minSpeed - 0.1), 0, 'a slow wave does nothing');
  assert.ok(blowDamage(pick.kind.hit, pick.kind.hit.fullSpeed) === pick.kind.hit.damage);
  assert.ok(pick.kind.hit.minSpeed > 1.5 && pick.kind.hit.minSpeed < 4, 'a real swing, not a nudge');
});

test('the crafting list has a pickaxe made from sticks and stones, and it is a tool you can put on a hip', () => {
  const recipe = RECIPES.find(r => r.id === 'pickaxe');
  assert.deepEqual(recipe.ingredients, { stick: 3, stone: 3 });
  assert.equal(recipe.output, 'pickaxe');
  assert.equal(ITEMS.pickaxe.category, 'TOOL');
  assert.equal(ITEMS.pickaxe.equippable, true);
  assert.ok(getInventoryItemWeight('pickaxe') >= getInventoryItemWeight('axe'), 'heavier than the axe');
  removeInventoryItem('stick', getInventoryCount('stick')); removeInventoryItem('stone', getInventoryCount('stone'));
  addInventoryItem('stick', 3); addInventoryItem('stone', 2);
  assert.equal(getRecipeStatus('pickaxe').canCraft, false, 'two stones are not enough');
  addInventoryItem('stone', 1);
  assert.equal(craftItem('pickaxe'), true);
  assert.equal(getInventoryCount('pickaxe'), 1);
  assert.equal(getInventoryCount('stick'), 0);
  removeInventoryItem('pickaxe', 1);
});
