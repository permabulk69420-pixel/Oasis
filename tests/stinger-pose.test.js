import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { STINGER_BONES, LEG_NAMES, CLAW_NAMES, POSE_REST, JOINTS, computePose, createStingerPoser, footCycle } from '../src/stinger-pose.js';
import { DUNE_STINGER } from '../src/dune-stinger.js';
import { loadStingerModel } from './helpers/stinger-model.js';

// The real skeleton and skin weights, read from the model file, so a pose can be checked in metres (model scale 1, the nose at +Z, feet on y = 0).
function quaternions() {
  return Object.fromEntries(STINGER_BONES.map(name => [name, new THREE.Quaternion()]));
}

function posed(pose, { level = 0, time = 0, joints = JOINTS } = {}) {
  const model = loadStingerModel(level);
  const poser = createStingerPoser(model.group);
  poser.apply({ ...POSE_REST, ...pose }, time, joints);
  model.group.updateMatrixWorld(true);
  const at = name => poser.bones[name].getWorldPosition(new THREE.Vector3());
  const tip = poser.bones.Stinger.localToWorld(model.tipOf('Stinger'));
  return { model, poser, at, tip };
}

test('every level of detail has every bone the poses move', () => {
  assert.equal(STINGER_BONES.length, 55);
  for (const level of [0, 1, 2]) {
    const { group } = loadStingerModel(level);
    assert.ok(createStingerPoser(group), `level ${level} has all ${STINGER_BONES.length} bones`);
  }
  const { group } = loadStingerModel(0);
  group.getObjectByName('Mandible_R').removeFromParent();
  assert.equal(createStingerPoser(group), null, 'a model with a bone missing is refused, not half posed');
});

test('a pose gives a unit rotation for every bone', () => {
  const { group } = loadStingerModel(0);
  const rig = createStingerPoser(group).rig;
  const out = quaternions();
  for (const pose of [{}, { gait: 1, phase: 2.2 }, { gait: 0.5, phase: 6, turn: 1, alert: 1, headYaw: 1, headPitch: -0.3 }, { alert: 1, turn: -1 }]) {
    for (const time of [0, 3.3, 97]) {
      computePose({ ...POSE_REST, ...pose }, time, out, JOINTS, rig);
      for (const name of STINGER_BONES) assert.ok(Math.abs(out[name].length() - 1) < 1e-6, `${name}`);
    }
  }
});

test('standing still, the feet do not move and the left and right mirror each other', () => {
  const standing = posed({ gait: 0, phase: 0 }, { time: 2.1 });
  for (const phase of [1, 2.5, 5]) {
    const later = posed({ gait: 0, phase }, { time: 2.1 });
    for (const leg of LEG_NAMES) assert.ok(later.at(leg.toe).distanceTo(standing.at(leg.toe)) < 1e-9, `${leg.toe} stays put`);
  }
  const alert = posed({ alert: 1, headYaw: 0 }, { time: 2.1 });
  const pairs = [['Mandible_L', 'Mandible_R'], ...[1, 2, 3, 4].flatMap(i => [[`Leg${i}_L_Foot`, `Leg${i}_R_Foot`], [`Leg${i}_L_Toe`, `Leg${i}_R_Toe`]])];
  for (const [l, r] of pairs) {
    const a = alert.at(l);
    const b = alert.at(r);
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
  assert.ok(Math.abs(JOINTS.stride - (2 * JOINTS.sweep) / JOINTS.stanceFraction) < 1e-9, 'the body advances exactly as far as a planted foot slides back');
});

test('the feet stand on the ground: at rest, on guard, crouched in the windup and in the strike, every toe touches y = 0', () => {
  for (const pose of [{}, { alert: 1 }, { windup: 1, alert: 1 }, { windup: 1, strike: 1, alert: 1 }, { hurt: 1 }]) {
    const stance = posed(pose, { time: 0.7 });
    for (const leg of LEG_NAMES) {
      const y = stance.at(leg.toe).y;
      assert.ok(Math.abs(y) < 0.004, `${leg.toe} is ${y.toFixed(4)} m off the ground in ${JSON.stringify(pose)}`);
    }
  }
});

test('walking, no foot goes into the ground, it lifts a hand-width while swinging, and a planted foot slides back by exactly one stride', () => {
  const { poser, model } = posed({});
  const toeY = leg => poser.bones[leg.toe].getWorldPosition(new THREE.Vector3());
  for (const leg of LEG_NAMES) {
    let highest = 0;
    let lowest = 0;
    for (let i = 0; i < 60; i++) {
      poser.apply({ ...POSE_REST, gait: 1, phase: (i / 60) * Math.PI * 2 }, 0);
      model.group.updateMatrixWorld(true);
      const y = toeY(leg).y;
      highest = Math.max(highest, y);
      lowest = Math.min(lowest, y);
    }
    assert.ok(lowest > -0.01, `${leg.toe} stays above the ground (lowest ${lowest.toFixed(3)} m)`);
    assert.ok(highest > 0.05 && highest < 0.12, `${leg.toe} lifts ${highest.toFixed(3)} m while swinging`);
  }
  // front left leg: while its foot is planted (the first 60% of its cycle) it moves back along the body, 2 x sweep in all
  const first = LEG_NAMES.find(leg => leg.index === 0 && leg.left);
  const zs = [];
  const cycles = 60;
  for (let i = 0; i <= cycles * JOINTS.stanceFraction - 1e-9; i++) {
    poser.apply({ ...POSE_REST, gait: 1, phase: (i / cycles) * Math.PI * 2 }, 0);
    model.group.updateMatrixWorld(true);
    zs.push(toeY(first).z);
  }
  for (let i = 1; i < zs.length; i++) assert.ok(zs[i] < zs[i - 1] + 1e-9, 'planted foot moves back');
  const slid = zs[0] - zs[zs.length - 1];
  assert.ok(Math.abs(slid - 2 * JOINTS.sweep) < 0.02, `the planted foot slides back ${slid.toFixed(3)} m (2 x sweep is ${2 * JOINTS.sweep})`);
});

test('the whole body ripples while it walks, bends into a turn, and curls the tail up on guard', () => {
  const { group } = loadStingerModel(0);
  const rig = createStingerPoser(group).rig;
  const out = quaternions();
  computePose({ ...POSE_REST }, 0, out, JOINTS, rig);
  const flatTail = out.Tail2.clone();
  computePose({ ...POSE_REST, alert: 1 }, 0, out, JOINTS, rig);
  assert.ok(out.Tail2.angleTo(flatTail) > 0.05, 'tail curls');
  const stingAt = pose => posed(pose).at('Stinger');
  const straight = stingAt({});
  const left = stingAt({ turn: 1 });
  assert.ok(left.x < straight.x - 0.02, 'bending to the left swings the tail out to the right');
  assert.ok(Math.abs(stingAt({ gait: 1, phase: 1 }).x - straight.x) > 0.003, 'the body sways side to side as it walks');
});

test('the fight poses give unit rotations for every bone', () => {
  const { group } = loadStingerModel(0);
  const rig = createStingerPoser(group).rig;
  const out = quaternions();
  for (const pose of [{ windup: 1 }, { strike: 1 }, { windup: 0.5, strike: 0.5 }, { hurt: 1 }, { dead: 1 }, { hurt: 1, gait: 1, phase: 3, turn: -1 }, { windup: 3, strike: -2, hurt: 9, dead: -1 }]) {
    for (const time of [0, 12.5]) {
      computePose({ ...POSE_REST, ...pose }, time, out, JOINTS, rig);
      for (const name of STINGER_BONES) assert.ok(Math.abs(out[name].length() - 1) < 1e-6, `${name}`);
    }
  }
});

// the lowest height the tail's centre line passes over the body, minus the body's top (with its spikes) at about 0.5 m
function tailClearance(stinger) {
  const names = ['Tail1', 'Tail2', 'Tail3', 'Tail4', 'Tail5', 'Stinger'];
  const points = [...names.map(stinger.at), stinger.tip];
  let worst = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    for (let s = 0; s <= 1; s += 0.1) {
      const p = points[i].clone().lerp(points[i + 1], s);
      if (p.z > -0.5 && p.z < 0.5) worst = Math.min(worst, p.y - 0.5);
    }
  }
  return worst;
}

test('the windup cocks the tail high and back, and the strike arcs it over the body to land the sting ahead of the nose on the ground', () => {
  const rest = posed({});
  const windup = posed({ windup: 1, alert: 1 });
  const strike = posed({ windup: 1, strike: 1, alert: 1 });
  assert.ok(windup.at('Tail5').y > rest.at('Tail5').y - 0.05, 'the tail is held up in the windup');
  assert.ok(windup.tip.y > 1.3, `the sting is high in the windup (${windup.tip.y.toFixed(2)} m)`);
  assert.ok(windup.tip.z < 0.1 && strike.tip.z > 0.7, `drawn back, then thrown forward (${windup.tip.z.toFixed(2)} then ${strike.tip.z.toFixed(2)})`);
  assert.ok(strike.tip.z > strike.at('Head').z + 0.5, `the strike reaches well past the head (${strike.tip.z.toFixed(2)} vs ${strike.at('Head').z.toFixed(2)})`);
  assert.ok(Math.abs(strike.tip.x) < 0.1, 'and straight ahead, not sideways');
  assert.ok(strike.tip.y < 0.2 && strike.tip.y > -0.05, `it comes down onto the ground (${strike.tip.y.toFixed(2)} m)`);
  assert.ok(tailClearance(strike) > 0.05, `the tail goes over the body, not through it (clearance ${tailClearance(strike).toFixed(2)} m)`);
  assert.ok(tailClearance(rest) > 0.4 && tailClearance(windup) > 0.4, 'and at rest and in the windup it is well clear');
});

test('hurt throws the tail up, and dead lays it on the sand behind, with the legs curled in and the body down', () => {
  const rest = posed({});
  const hurt = posed({ hurt: 1 });
  const dead = posed({ dead: 1 });
  assert.ok(hurt.tip.y > rest.tip.y + 0.15, `a flinch throws the tail up (${hurt.tip.y.toFixed(2)} vs ${rest.tip.y.toFixed(2)})`);
  assert.ok(dead.tip.y < 0.3 && dead.tip.z < -1.0, `the tail lies low behind it when dead (${dead.tip.y.toFixed(2)} m up, ${dead.tip.z.toFixed(2)} m behind the middle)`);
  const { group } = loadStingerModel(0);
  const rig = createStingerPoser(group).rig;
  const out = quaternions();
  const living = quaternions();
  computePose({ ...POSE_REST }, 0, living, JOINTS, rig);
  const sink = computePose({ ...POSE_REST, dead: 1 }, 0, out, JOINTS, rig);
  assert.ok(sink < -0.05, 'the body sinks');
  assert.ok(out.Leg1_L_Thigh.angleTo(living.Leg1_L_Thigh) > 0.2, 'the legs curl up');
  for (const leg of LEG_NAMES) assert.ok(dead.at(leg.toe).y > 0.08, `${leg.toe} is lifted off the ground when dead`);
});

test('the claws lift on guard and swing wide in the windup', () => {
  // the finger's height above the body's own joint, so the crouch of the windup does not count
  const finger = pose => { const p = posed(pose, { time: 3 }); const f = p.at('Claw_L_Finger'); f.y -= p.at('Body').y; return f; };
  const rest = finger({});
  const guard = finger({ alert: 1 });
  const wind = finger({ windup: 1, alert: 1 });
  assert.ok(guard.y > rest.y + 0.05, `the claws lift on guard (${guard.y.toFixed(2)} vs ${rest.y.toFixed(2)})`);
  assert.ok(wind.y > guard.y - 0.001, `and stay up in the windup (${wind.y.toFixed(2)})`);
  assert.ok(wind.x > guard.x + 0.03 && guard.x > rest.x, `the claws swing wider on guard, and wider again in the windup (${rest.x.toFixed(2)}, ${guard.x.toFixed(2)}, ${wind.x.toFixed(2)})`);
  assert.equal(CLAW_NAMES.length, 2);
});

test('hit capsules: every bone they name exists, and together they cover the body, the tail and the claws', () => {
  const model = loadStingerModel(0);
  const names = new Set(STINGER_BONES);
  const rest = model.restOrigin;
  const point = spec => {
    if (typeof spec === 'string') { assert.ok(names.has(spec), `${spec} is a bone`); return rest[spec].clone(); }
    assert.ok(names.has(spec[0]), `${spec[0]} is a bone`);
    return new THREE.Vector3(spec[1], spec[2], spec[3]).add(rest[spec[0]]);
  };
  const capsules = DUNE_STINGER.hitParts.map(([a, b, r]) => ({ a: point(a), b: point(b), r }));
  const distance = (p, c) => {
    const ab = c.b.clone().sub(c.a);
    const t = Math.max(0, Math.min(1, p.clone().sub(c.a).dot(ab) / Math.max(ab.lengthSq(), 1e-9)));
    return p.distanceTo(c.a.clone().addScaledVector(ab, t)) - c.r;
  };
  for (const [label, pattern] of [['body', /^(Body|Head|Seg\d+)$/], ['tail', /^(Tail\d|Stinger)$/], ['claws', /^Claw_/]]) {
    let total = 0;
    let inside = 0;
    model.positions.forEach((p, k) => {
      if (!pattern.test(model.owners[k])) return;
      total++;
      if (capsules.some(c => distance(p, c) <= 0)) inside++;
    });
    assert.ok(inside / total > 0.94, `${label}: ${(100 * inside / total).toFixed(0)}% of the skin is inside a hit capsule`);
  }
});
