import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadColossusSkeleton } from './helpers/colossus-model.js';
import { createColossusRig, COLOSSUS_BONES, JOINTS } from '../src/colossus-pose.js';
import { createColossusBrain } from '../src/colossus-brain.js';
import { createGait, createBodyMotion } from '../src/colossus-gait.js';

// These read Colossus 01's real skeleton out of its stopgap file (the three levels share one), so what they prove is about the real bones: their
// rest rotations, lengths and positions, not a tidy stand-in.

function seeded(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LEGS = ['BL', 'FL', 'BR', 'FR'];
const world = bone => new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);

// poses the rig the way the game's frame does: holder where the body is, then the bones
function pose(skeleton, rig, state, gait, motion, dt) {
  skeleton.holder.position.set(state.x, gait.out.groundY, state.z);
  skeleton.holder.rotation.set(0, state.yaw, 0);
  const info = rig.apply(motion.out, gait.out, dt);
  skeleton.holder.updateMatrixWorld(true);
  return info;
}

function makeRig(file) {
  const skeleton = loadColossusSkeleton(file);
  skeleton.holder.rotation.order = 'YXZ';
  const rig = createColossusRig(skeleton.rig, skeleton.holder);
  return { skeleton, rig };
}

test('the rig finds every bone in the real skeleton and reads its true leg lengths and where the feet are at rest', () => {
  const { rig } = makeRig();
  assert.ok(rig);
  const expected = { FL: [19.12, 17.14, 9, 19], FR: [19.12, 17.14, -9, 19], BL: [16.21, 17.20, 9, -19], BR: [16.21, 17.20, -9, -19] };
  for (const [name, [upper, lower, x, z]] of Object.entries(expected)) {
    const leg = rig.legs[name];
    assert.ok(Math.abs(leg.length1 - upper) < 0.05, `${name} thigh ${leg.length1}`);
    assert.ok(Math.abs(leg.length2 - lower) < 0.05, `${name} shin ${leg.length2}`);
    assert.ok(Math.abs(leg.home[0] - x) < 0.05 && Math.abs(leg.home[1] - z) < 0.05, `${name} home ${leg.home}`);
    assert.equal(leg.side, Math.sign(x));
    assert.ok(Math.abs(leg.ankle - 6) < 0.05, 'the ankle is about 6 m above the sole');
  }
});

test('a skeleton that is missing a bone is refused, so a bad file cannot half-pose', () => {
  const skeleton = loadColossusSkeleton();
  const bone = skeleton.bones.tail_08;
  bone.parent.remove(bone);
  assert.equal(createColossusRig(skeleton.rig, skeleton.holder), null);
});

test('through a two and a half minute walk every ankle is on the spot the planner gave it, the body is never held above what its legs allow, and nothing goes to NaN', () => {
  const { skeleton, rig } = makeRig();
  const brain = createColossusBrain({ rng: seeded(5) });
  brain.walk();
  const gait = createGait({ legs: Object.values(rig.legs).map(l => ({ name: l.name, home: l.home, offset: { BL: 0, FL: 0.25, BR: 0.5, FR: 0.75 }[l.name] })), groundAt: (x, z) => 4 * Math.sin(x * 0.01) + 3 * Math.cos(z * 0.013) });
  const motion = createBodyMotion();
  let worst = 0, frames = 0, fastest = 0;
  const dt = 1 / 30;
  for (let t = 0; t < 150; t += dt) {
    brain.update(dt);
    gait.update(brain.state, dt);
    motion.update(brain.state, gait.out, dt);
    const info = pose(skeleton, rig, brain.state, gait, motion, dt);
    assert.ok(info.heave <= info.limit + 1e-9, 'the body is higher than the legs allow');
    for (const name of LEGS) {
      const leg = rig.legs[name];
      const foot = world(leg.F.bone);
      const target = leg.ankleWorld;
      const miss = Math.hypot(foot.x - target[0], foot.y - target[1], foot.z - target[2]);
      worst = Math.max(worst, miss);
      assert.ok(Number.isFinite(foot.x + foot.y + foot.z));
    }
    skeleton.rig.traverse(o => { if (o.isBone) for (const v of [...o.quaternion.toArray(), ...o.position.toArray()]) assert.ok(Number.isFinite(v), `${o.name} went to ${v}`); });
    fastest = Math.max(fastest, brain.state.speed);
    frames++;
  }
  assert.ok(frames > 4000);
  assert.ok(fastest > 1, 'it did walk');
  assert.ok(worst < 0.05, `an ankle was ${worst.toFixed(3)} m off its target`);
});

test('knees bend forward and a little outwards, the thigh and shin keep their lengths, and every bone keeps the length the model gave it', () => {
  const { skeleton, rig } = makeRig();
  const brain = createColossusBrain({ rng: seeded(1) });
  brain.place(0, 0, 0);
  brain.stand();
  const gait = createGait({ groundAt: () => 0 });
  const motion = createBodyMotion();
  for (let t = 0; t < 12; t += 1 / 30) { brain.update(1 / 30); gait.update(brain.state, 1 / 30); motion.update(brain.state, gait.out, 1 / 30); pose(skeleton, rig, brain.state, gait, motion, 1 / 30); }
  for (const name of LEGS) {
    const leg = rig.legs[name];
    const hip = world(leg.U.bone), knee = world(leg.L.bone), ankle = world(leg.F.bone);
    assert.ok(knee.z > Math.max(hip.z, ankle.z) + 0.3, `${name}'s knee is not forward (${knee.z.toFixed(2)})`);
    assert.ok((knee.x - (hip.x + ankle.x) / 2) * leg.side > 0, `${name}'s knee is not out`);
    assert.ok(Math.abs(hip.distanceTo(knee) - leg.length1) < 1e-3 && Math.abs(knee.distanceTo(ankle) - leg.length2) < 1e-3);
  }
  const bad = [];
  skeleton.rig.traverse(o => {
    if (!o.isBone || !o.parent?.isBone || o.name === 'pelvis') return;
    const rest = rig.rest[o.name];
    if (rest && o.position.distanceTo(rest.p0) > 1e-6) bad.push(o.name);
  });
  assert.deepEqual(bad, [], 'a bone was moved, not turned');
});

test('the head goes where the gaze points: left is +x, a positive pitch lowers it', () => {
  const { skeleton, rig } = makeRig();
  const gait = createGait({ groundAt: () => 0 });
  const state = { x: 0, z: 0, yaw: 0, speed: 0, accel: 0, turn: 0, cycles: 0, cycle: 7.6, calm: 1, time: 0, gaze: { yaw: 0, pitch: 0 }, breath: 0, tail: 0 };
  const motion = createBodyMotion();
  const head = skeleton.bones.head;
  const settle = changes => {
    gait.update(state, 1 / 30);
    motion.update(state, gait.out, 1 / 30);
    Object.assign(motion.out, { jaw: 0, breath: 0, gazeYaw: 0, gazePitch: 0, nod: 0, spineBend: 0, tailBias: 0 }, changes);
    for (let i = 0; i < 4; i++) pose(skeleton, rig, state, gait, motion, 1 / 30);
    return world(head);
  };
  const ahead = settle({});
  const left = settle({ gazeYaw: 0.3 });
  const right = settle({ gazeYaw: -0.3 });
  const down = settle({ gazePitch: 0.2 });
  const up = settle({ gazePitch: -0.2 });
  assert.ok(left.x - ahead.x > 2, `looking left moved the head ${(left.x - ahead.x).toFixed(2)} m`);
  assert.ok(ahead.x - right.x > 2);
  assert.ok(ahead.y - down.y > 1, `looking down lowered it ${(ahead.y - down.y).toFixed(2)} m`);
  assert.ok(up.y - ahead.y > 1);
});

test('posing is repeatable: the same inputs give the same bones, and the bones are only ever turned from the rest the file gave', () => {
  const { skeleton, rig } = makeRig();
  const gait = createGait({ groundAt: () => 0 });
  const state = { x: 10, z: 20, yaw: 0.5, speed: 2.2, accel: 0, turn: 0.03, cycles: 0.4, cycle: 7.6, calm: 0, time: 3, gaze: { yaw: 0.1, pitch: 0.05 }, breath: 1, tail: 2 };
  const motion = createBodyMotion();
  gait.update(state, 1 / 30);
  motion.update(state, gait.out, 1 / 30);
  pose(skeleton, rig, state, gait, motion, 0);
  const first = [];
  skeleton.rig.traverse(o => { if (o.isBone) first.push(o.quaternion.clone(), o.position.clone()); });
  pose(skeleton, rig, state, gait, motion, 0);
  const second = [];
  skeleton.rig.traverse(o => { if (o.isBone) second.push(o.quaternion.clone(), o.position.clone()); });
  assert.equal(first.length, second.length);
  for (let i = 0; i < first.length; i++) assert.ok(first[i].equals ? first[i].equals(second[i]) : first[i].distanceTo(second[i]) < 1e-12, `bone ${i} changed`);
  assert.ok(JOINTS.reach <= 1 && JOINTS.reach > 0.9);
  assert.equal(COLOSSUS_BONES.neck.length, 7);
  assert.equal(COLOSSUS_BONES.tail.length, 8);
});
