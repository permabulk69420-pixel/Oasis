import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { BIRD_BONES, POSE_REST, JOINTS, computePose, createBirdPoser } from '../src/bird-pose.js';

// A skeleton with the real bone positions, built from the model file, so a pose can be checked in metres.
function loadSkeleton(missing = null) {
  const buffer = fs.readFileSync(new URL('../public/models/creatures/alien_bird_lod0.glb', import.meta.url));
  const json = JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString('utf8'));
  const joints = new Set(json.skins[0].joints);
  const make = index => {
    const node = json.nodes[index];
    const bone = new THREE.Bone();
    bone.name = node.name;
    if (node.translation) bone.position.fromArray(node.translation);
    for (const child of node.children ?? []) if (joints.has(child) && json.nodes[child].name !== missing) bone.add(make(child));
    return bone;
  };
  const root = [...joints].find(index => !json.nodes.some(node => (node.children ?? []).includes(index) && joints.has(json.nodes.indexOf(node))));
  const group = new THREE.Group();
  group.add(make(root));
  return group;
}

function posed(pose, time = 0, drop = 0, joints = JOINTS) {
  const group = loadSkeleton();
  const poser = createBirdPoser(group);
  poser.apply({ ...POSE_REST, ...pose }, time, drop, joints);
  group.updateMatrixWorld(true);
  const at = name => poser.bones[name].getWorldPosition(new THREE.Vector3());
  return { group, poser, at };
}

const FLIGHT = { fold: 0, legs: 1, stretch: 1, crest: -1, sweep: 0.15, tail: -0.1 };

test('a pose gives a unit rotation and a sane scale for every bone', () => {
  const rotations = {};
  const scales = {};
  for (const name of BIRD_BONES) {
    rotations[name] = new THREE.Quaternion();
    scales[name] = new THREE.Vector3(1, 1, 1);
  }
  for (const pose of [{}, FLIGHT, { ...FLIGHT, flap: 0.8, flex: 0.45 }, { dip: 1, crouch: 1, shake: 1, headYaw: 1.2 }]) {
    for (const time of [0, 1.7, 33]) {
      computePose({ ...POSE_REST, ...pose }, time, rotations, scales);
      for (const name of BIRD_BONES) {
        assert.ok(Math.abs(rotations[name].length() - 1) < 1e-6, `${name} is a unit quaternion`);
        assert.ok(scales[name].toArray().every(v => v > 0.3 && v <= 1.0001), `${name} scale ${scales[name].toArray()}`);
      }
    }
  }
});

test('only the wings are ever scaled, and only when folded', () => {
  const rotations = {};
  const scales = {};
  for (const name of BIRD_BONES) {
    rotations[name] = new THREE.Quaternion();
    scales[name] = new THREE.Vector3(1, 1, 1);
  }
  computePose({ ...POSE_REST, fold: 0 }, 0, rotations, scales);
  for (const name of BIRD_BONES) assert.deepEqual(scales[name].toArray(), [1, 1, 1], `${name} unscaled when the wings are out`);
  computePose({ ...POSE_REST, fold: 1 }, 0, rotations, scales);
  for (const name of BIRD_BONES) {
    const wing = name.startsWith('Wing');
    assert.equal(scales[name].toArray().every(v => v === 1), !wing, `${name}`);
  }
  assert.ok(Math.abs(scales.WingIn_L.x - JOINTS.foldShoulder.scale) < 1e-9);
  assert.ok(Math.abs(scales.WingOut_L.z - JOINTS.foldHand.scaleZ) < 1e-9);
});

test('left and right mirror each other in every pose', () => {
  for (const pose of [{}, { ...FLIGHT, flap: 0.7, flex: 0.3, sweep: 0.2 }, { fold: 0.5, shake: 1, legs: 0.5 }]) {
    const { at } = posed(pose, 2.3);
    for (const [l, r] of [['WingIn_L', 'WingIn_R'], ['WingOut_L', 'WingOut_R'], ['Leg_L', 'Leg_R'], ['Foot_L', 'Foot_R']]) {
      const a = at(l);
      const b = at(r);
      assert.ok(Math.abs(a.x + b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.z - b.z) < 1e-6, `${l} vs ${r}`);
    }
  }
});

test('folded wings lie along the flank, behind and close to the body', () => {
  const { at } = posed({});
  const wrist = at('WingOut_L');
  const shoulder = at('WingIn_L');
  assert.ok(wrist.x < 0.2, `the wrist is ${wrist.x} m out; the spread wing puts it at 0.34`);
  assert.ok(wrist.z < shoulder.z - 0.1, 'the wrist is swept back from the shoulder');
  assert.ok(wrist.z > -0.4, 'but not past the tail');
  assert.ok(Math.abs(wrist.y - shoulder.y) < 0.12, 'and stays at about the same height');
});

test('spread wings reach out 0.34 m to the wrist and flap up and down', () => {
  const level = posed({ ...FLIGHT, sweep: 0 }).at('WingOut_L');
  const up = posed({ ...FLIGHT, sweep: 0, flap: 0.8 }).at('WingOut_L');
  const down = posed({ ...FLIGHT, sweep: 0, flap: -0.6 }).at('WingOut_L');
  assert.ok(level.x > 0.32 && level.x < 0.36, `out ${level.x}`);
  assert.ok(up.y > level.y + 0.15, 'positive flap raises the wing');
  assert.ok(down.y < level.y - 0.1, 'negative flap lowers it');
  assert.ok(Math.hypot(up.x, up.y - 0.055) > 0.3, 'the wing keeps its length');
});

test('sweeping the wings back moves the wrist back', () => {
  const straight = posed({ ...FLIGHT, sweep: 0 }).at('WingOut_L');
  const swept = posed({ ...FLIGHT, sweep: 0.5 }).at('WingOut_L');
  assert.ok(swept.z < straight.z - 0.1);
});

test('the legs hang to the ground and trail back when tucked', () => {
  const stand = posed({});
  assert.ok(Math.abs(stand.at('Foot_L').y + 0.337) < 0.01, 'feet are 0.337 m below the root');
  const tucked = posed({ legs: 1 });
  assert.ok(tucked.at('Foot_L').z < stand.at('Foot_L').z - 0.2, 'feet trail behind');
  assert.ok(tucked.at('Foot_L').y > stand.at('Foot_L').y + 0.15, 'and come up');
});

test('crouching drops the body and the head follows', () => {
  const stand = posed({});
  const crouch = posed({ crouch: 1 }, 0, 0.07);
  assert.ok(Math.abs(crouch.at('Body').y - (stand.at('Body').y - 0.07)) < 1e-6);
  assert.ok(crouch.at('Head').y < stand.at('Head').y - 0.05);
});

test('the neck stretches out forward for flight and bows down to drink', () => {
  const stand = posed({}).at('Head');
  const flying = posed({ stretch: 1 }).at('Head');
  const drinking = posed({ dip: 1 }).at('Head');
  assert.ok(flying.z > stand.z + 0.05 && flying.y < stand.y - 0.05, 'forward and lower');
  assert.ok(drinking.y < stand.y - 0.2, 'down');
  assert.ok(drinking.z > stand.z, 'and forward');
});

test('the streamers and crest keep moving, gently, and the pose is steady without them', () => {
  const a = posed({ streamers: 1 }, 0.4).at('StreamerTip_L');
  const b = posed({ streamers: 1 }, 1.9).at('StreamerTip_L');
  assert.ok(a.distanceTo(b) > 0.01, 'the streamer tip moves with time');
  assert.ok(a.distanceTo(b) < 0.4, 'but not wildly');
  const still1 = posed({ streamers: 0 }, 0.4).at('StreamerTip_L');
  const still2 = posed({ streamers: 0 }, 1.9).at('StreamerTip_L');
  assert.ok(still1.distanceTo(still2) < 1e-6, 'limp streamers hold still');
});

test('the poser needs a whole skeleton, and joint numbers can be overridden for tuning', () => {
  assert.equal(createBirdPoser(loadSkeleton('Crest')), null, 'a bone missing: no poser');
  const normal = posed({}).at('WingOut_L');
  const tuned = posed({}, 0, 0, { ...JOINTS, foldShoulder: { ...JOINTS.foldShoulder, sweep: 0.5 } }).at('WingOut_L');
  assert.ok(normal.distanceTo(tuned) > 0.1);
  assert.throws(() => { JOINTS.foldShoulder.sweep = 0; }, TypeError, 'the shipped numbers are frozen');
});
