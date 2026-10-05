import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { pickLevel, createInstancedLods } from '../src/instanced-lods.js';

// A stand-in for a loaded model: a trunk and a crown, the crown offset up the trunk in the model's own space (a glTF node can carry a transform).
const barkMaterial = new THREE.MeshBasicMaterial({ name: 'bark' });
const leafMaterial = new THREE.MeshBasicMaterial({ name: 'leaf', side: THREE.DoubleSide });
function model(sides) {
  const root = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 6, sides), barkMaterial);
  trunk.position.y = 3;
  const crown = new THREE.Mesh(new THREE.SphereGeometry(2, sides, Math.max(3, sides / 2)), leafMaterial);
  crown.position.y = 6.5;
  root.add(trunk, crown);
  return root;
}
const levelsOf = () => [0, 20, 55].map((distance, l) => ({ source: model([16, 8, 4][l]), distanceFor: scale => distance * scale }));
const items = [
  { x: 0, y: 0, z: 0, yaw: 0, scale: 1 },
  { x: 30, y: 2, z: 0, yaw: Math.PI / 2, scale: 1 },
  { x: 0, y: 0, z: 100, yaw: 1, scale: 1.5 },
  { x: -10, y: 1, z: 5, yaw: 2, scale: 2 },
];

test('the level is the last one whose distance has been reached, like THREE.LOD', () => {
  assert.equal(pickLevel(0, [0, 20, 55]), 0);
  assert.equal(pickLevel(19.99, [0, 20, 55]), 0);
  assert.equal(pickLevel(20, [0, 20, 55]), 1);
  assert.equal(pickLevel(54, [0, 20, 55]), 1);
  assert.equal(pickLevel(55, [0, 20, 55]), 2);
  assert.equal(pickLevel(1e6, [0, 20, 55]), 2);
  assert.equal(pickLevel(5, [0]), 0);
  // THREE.LOD itself agrees
  for (const d of [0, 10, 19.9, 20, 33, 54.9, 55, 200]) {
    const lod = new THREE.LOD();
    [0, 20, 55].forEach((dist, i) => lod.addLevel(new THREE.Group().add(new THREE.Mesh()), dist));
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(d, 0, 0);
    camera.updateMatrixWorld(true);
    lod.update(camera);
    assert.equal(lod.getCurrentLevel(), pickLevel(d, [0, 20, 55]), `at ${d} m`);
  }
});

test('every copy is drawn at exactly one level, and the draw calls are levels in use times parts, however many copies', () => {
  const lods = createInstancedLods({ name: 'test', levels: levelsOf(), items });
  assert.equal(lods.group.children.length, 6, 'three levels of two parts');
  assert.equal(lods.drawCalls(), 0, 'nothing drawn before the first update');
  assert.ok(lods.update(0, 0, 0));
  assert.equal(lods.counts.reduce((a, b) => a + b, 0), items.length);
  // item 0 is at the eye (level 0), item 1 is 30 m away (level 1), item 2 is 100 m away (level 2: 100 >= 55 x 1.5), item 3 is 11 m away with scale 2 (level 0: 11 < 20 x 2)
  assert.deepEqual(Array.from(lods.levelOf), [0, 1, 2, 0]);
  assert.deepEqual(lods.counts, [2, 1, 1]);
  assert.equal(lods.drawCalls(), 6);
  const big = Array.from({ length: 90 }, (_, i) => ({ x: (i % 10) * 9, y: 0, z: Math.floor(i / 10) * 9, yaw: i, scale: 1 + (i % 3) * 0.2 }));
  const many = createInstancedLods({ name: 'many', levels: levelsOf(), items: big });
  many.update(40, 1.7, 40);
  assert.equal(many.counts.reduce((a, b) => a + b, 0), 90);
  assert.ok(many.drawCalls() <= 6, `${many.drawCalls()} draw calls for 90 copies`);
  // only the levels with someone at them are visible
  const lone = createInstancedLods({ name: 'lone', levels: levelsOf(), items: [items[0]] });
  lone.update(0, 0, 0);
  assert.equal(lone.drawCalls(), 2);
  assert.deepEqual(lone.group.children.map(m => m.visible), [true, true, false, false, false, false]);
});

test('an update that changes no level rewrites nothing; moving across a boundary moves the copy to the next level', () => {
  const lods = createInstancedLods({ name: 'test', levels: levelsOf(), items });
  assert.ok(lods.update(0, 0, 0));
  assert.equal(lods.update(0.5, 0, 0), false, 'a half metre changes no level');
  assert.equal(lods.update(1, 0, 0), false);
  assert.ok(lods.update(12, 0, 0), 'item 1 is now 18 m away');
  assert.equal(lods.levelOf[1], 0);
  assert.ok(lods.update(-30, 0, 0));
  assert.equal(lods.levelOf[0], 1);
  assert.equal(lods.levelOf[1], 2);
});

test('each copy lands where it should: position, turn and size, with the model\'s own offsets kept', () => {
  const lods = createInstancedLods({ name: 'test', levels: levelsOf(), items });
  lods.update(0, 0, 0);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const slotOf = i => { let slot = 0; for (let k = 0; k < i; k++) if (lods.levelOf[k] === lods.levelOf[i]) slot++; return slot; };
  items.forEach((item, i) => {
    const rig = lods.rigs[lods.levelOf[i]];
    const [trunk, crown] = rig.meshes;
    trunk.getMatrixAt(slotOf(i), m);
    m.decompose(p, q, s);
    // the trunk's own centre is 3 m up the model, which turns with the copy and grows with its scale
    const expect = new THREE.Vector3(0, 3 * item.scale, 0).add(new THREE.Vector3(item.x, item.y, item.z));
    assert.ok(p.distanceTo(expect) < 1e-5, `trunk of ${i} at ${p.toArray()} not ${expect.toArray()}`);
    assert.ok(Math.abs(s.x - item.scale) < 1e-6 && Math.abs(s.y - item.scale) < 1e-6);
    const yaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
    assert.ok(Math.abs(Math.atan2(Math.sin(yaw - item.yaw), Math.cos(yaw - item.yaw))) < 1e-5, `turn of ${i}`);
    crown.getMatrixAt(slotOf(i), m);
    m.decompose(p, q, s);
    assert.ok(Math.abs(p.y - (item.y + 6.5 * item.scale)) < 1e-5, 'the crown sits 6.5 m up the model');
  });
});

test('geometry and materials are the loaded model\'s own (so the wind sway and textures already on them still apply), and nothing is culled or shadowed', () => {
  const lods = createInstancedLods({ name: 'test', levels: levelsOf(), items });
  for (const rig of lods.rigs) {
    assert.equal(rig.meshes[0].material, barkMaterial);
    assert.equal(rig.meshes[1].material, leafMaterial);
    for (const [i, mesh] of rig.meshes.entries()) {
      assert.equal(mesh.geometry, rig.parts[i].geometry);
      assert.equal(mesh.frustumCulled, false);
      assert.equal(mesh.castShadow, false);
      assert.ok(mesh.isInstancedMesh);
      assert.equal(mesh.instanceMatrix.usage, THREE.DynamicDrawUsage);
    }
  }
});

test('no copies is fine', () => {
  const lods = createInstancedLods({ name: 'none', levels: levelsOf(), items: [] });
  assert.equal(lods.update(0, 0, 0), false);
  assert.equal(lods.drawCalls(), 0);
});
