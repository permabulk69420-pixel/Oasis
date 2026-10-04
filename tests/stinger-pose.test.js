import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { STINGER_BONES, POSE_REST, JOINTS, computePose, createStingerPoser, footCycle } from '../src/stinger-pose.js';

// The real skeleton and skin weights, read from the model file, so a pose can be checked in metres.
function loadModel(level = 0) {
  const buf = fs.readFileSync(new URL(`../public/models/creatures/dune_stinger_lod${level}.glb`, import.meta.url));
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
  const bin = buf.subarray(20 + jsonLength + 8);
  const read = index => {
    const a = json.accessors[index];
    const view = json.bufferViews[a.bufferView];
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const Type = { 5126: Float32Array, 5121: Uint8Array, 5123: Uint16Array }[a.componentType];
    const stride = view.byteStride || width * Type.BYTES_PER_ELEMENT;
    const start = (view.byteOffset || 0) + (a.byteOffset || 0);
    return Array.from({ length: a.count }, (_, k) => Array.from({ length: width }, (_, c) => {
      const at = start + k * stride + c * Type.BYTES_PER_ELEMENT;
      return a.componentType === 5126 ? bin.readFloatLE(at) : a.componentType === 5121 ? bin.readUInt8(at) : bin.readUInt16LE(at);
    }));
  };
  const attributes = json.meshes[0].primitives[0].attributes;
  const positions = read(attributes.POSITION);
  const joints = read(attributes.JOINTS_0);
  const weights = read(attributes.WEIGHTS_0);
  const skin = json.skins[0];
  const names = skin.joints.map(j => json.nodes[j].name);
  const jointSet = new Set(skin.joints);
  const make = index => {
    const node = json.nodes[index];
    const bone = new THREE.Bone();
    bone.name = node.name;
    if (node.translation) bone.position.fromArray(node.translation);
    for (const child of node.children ?? []) if (jointSet.has(child)) bone.add(make(child));
    return bone;
  };
  const rootIndex = skin.joints.find(j => !json.nodes.some((n, i) => (n.children ?? []).includes(j) && jointSet.has(i)));
  const group = new THREE.Group();
  group.add(make(rootIndex));
  group.updateMatrixWorld(true);
  // the tip of each leg: the lowest vertex that its Lower bone moves most
  const tips = {};
  positions.forEach((p, k) => {
    let best = 0;
    for (let c = 1; c < 4; c++) if (weights[k][c] > weights[k][best]) best = c;
    const name = names[joints[k][best]];
    if (/^Leg0\d_[LR]_Lower$/.test(name) && (!tips[name] || p[1] < tips[name].y)) tips[name] = new THREE.Vector3(...p);
  });
  return { group, names, tips };
}

function quaternions() {
  return Object.fromEntries(STINGER_BONES.map(name => [name, new THREE.Quaternion()]));
}

test('every level of detail has every bone the poses move', () => {
  for (const level of [0, 1, 2]) {
    const { group } = loadModel(level);
    const poser = createStingerPoser(group);
    assert.ok(poser, `level ${level} has all ${STINGER_BONES.length} bones`);
    assert.equal(STINGER_BONES.length, 49);
  }
  const { group } = loadModel(0);
  group.getObjectByName('Mandible_R').removeFromParent();
  assert.equal(createStingerPoser(group), null, 'a model with a bone missing is refused, not half posed');
});

test('a pose gives a unit rotation for every bone', () => {
  const out = quaternions();
  for (const pose of [{}, { gait: 1, phase: 2.2 }, { gait: 0.5, phase: 6, turn: 1, alert: 1, headYaw: 1, headPitch: -0.3 }, { alert: 1, turn: -1 }]) {
    for (const time of [0, 3.3, 97]) {
      computePose({ ...POSE_REST, ...pose }, time, out);
      for (const name of STINGER_BONES) assert.ok(Math.abs(out[name].length() - 1) < 1e-6, `${name}`);
    }
  }
});

test('standing still, the legs do not move at all and the left and right mirror each other', () => {
  const rest = quaternions();
  computePose({ ...POSE_REST, gait: 0, phase: 0 }, 0, rest);
  const out = quaternions();
  for (const phase of [1, 2.5, 5]) {
    computePose({ ...POSE_REST, gait: 0, phase }, 4.4, out);
    for (const name of STINGER_BONES.filter(n => n.startsWith('Leg'))) assert.ok(out[name].angleTo(rest[name]) < 1e-9, `${name} stays put`);
  }
  const { group } = loadModel(0);
  const poser = createStingerPoser(group);
  poser.apply({ ...POSE_REST, alert: 1, headYaw: 0 }, 2.1);
  group.updateMatrixWorld(true);
  const at = name => poser.bones[name].getWorldPosition(new THREE.Vector3());
  for (const [l, r] of [['Mandible_L', 'Mandible_R'], ['Leg03_L_Lower', 'Leg03_R_Lower'], ['Leg08_L_Lower', 'Leg08_R_Lower']]) {
    const a = at(l);
    const b = at(r);
    assert.ok(Math.abs(a.x + b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.z - b.z) < 1e-6, `${l} mirrors ${r}`);
  }
});

test('a foot slides back at an even pace on the ground, then lifts and swings forward', () => {
  const cycle = [];
  for (let i = 0; i <= 20; i++) cycle.push({ ...footCycle(i / 20) });
  const stance = cycle.filter((s, i) => i / 20 < JOINTS.stanceFraction - 1e-9);
  assert.ok(stance.every(s => s.lift === 0), 'on the ground in the stance');
  for (let i = 1; i < stance.length; i++) assert.ok(stance[i].fore < stance[i - 1].fore, 'sliding back');
  const gaps = stance.slice(1).map((s, i) => stance[i].fore - s.fore);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) < 1e-9, 'at an even pace');
  const swing = cycle.filter((s, i) => i / 20 > JOINTS.stanceFraction + 1e-9 && i < 20);
  assert.ok(swing.every(s => s.lift > 0), 'lifted while swinging');
  assert.ok(Math.abs(cycle[0].fore - 1) < 1e-9 && Math.abs(cycle[20].fore - 1) < 1e-9, 'a cycle starts and ends at the front');
});

test('walking, no foot goes into the ground, it lifts a hand-width while swinging, and a planted foot only moves backward', () => {
  const { group, tips } = loadModel(0);
  const poser = createStingerPoser(group);
  const local = {};
  for (const [name, tip] of Object.entries(tips)) local[name] = poser.bones[name].worldToLocal(tip.clone());
  const tipAt = name => local[name].clone().applyMatrix4(poser.bones[name].matrixWorld);
  for (const name of Object.keys(tips)) {
    let highest = 0;
    let lowest = 0;
    let last = null;
    for (let i = 0; i < 60; i++) {
      poser.apply({ ...POSE_REST, gait: 1, phase: (i / 60) * Math.PI * 2 }, 0);
      group.updateMatrixWorld(true);
      const p = tipAt(name);
      highest = Math.max(highest, p.y);
      lowest = Math.min(lowest, p.y);
      last = p;
    }
    assert.ok(lowest > -0.02, `${name} stays above the ground (lowest ${lowest.toFixed(3)} m)`);
    assert.ok(highest > 0.05 && highest < 0.2, `${name} lifts ${highest.toFixed(3)} m while swinging`);
    assert.ok(last, name);
  }
  // front left leg: while its foot is planted (the first 60% of its cycle) it moves back along the body
  let previous = null;
  for (let i = 0; i < 30; i++) {
    poser.apply({ ...POSE_REST, gait: 1, phase: (i / 60) * Math.PI * 2 }, 0);
    group.updateMatrixWorld(true);
    const z = tipAt('Leg01_L_Lower').z;
    if (previous !== null) assert.ok(z < previous, 'planted foot moves back');
    previous = z;
  }
});

test('the whole body ripples while it walks, bends into a turn, and curls the tail up on guard', () => {
  const out = quaternions();
  computePose({ ...POSE_REST }, 0, out);
  const flatTail = out.Tail2.clone();
  computePose({ ...POSE_REST, alert: 1 }, 0, out);
  assert.ok(out.Tail2.angleTo(flatTail) > 0.1, 'tail curls');
  const { group } = loadModel(0);
  const poser = createStingerPoser(group);
  const stingAt = pose => { poser.apply({ ...POSE_REST, ...pose }, 0); group.updateMatrixWorld(true); return poser.bones.Stinger.getWorldPosition(new THREE.Vector3()); };
  const straight = stingAt({});
  const left = stingAt({ turn: 1 });
  assert.ok(left.x < straight.x - 0.02, 'bending to the left swings the tail out to the right');
  assert.ok(Math.abs(stingAt({ gait: 1, phase: 1 }).x - straight.x) > 0.003, 'the body sways side to side as it walks');
});
