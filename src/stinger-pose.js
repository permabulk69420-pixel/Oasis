import * as THREE from 'three';

// Poses for the dune stinger (see tools/dune-stinger/v3/build_stinger_v3.py for the model and its skeleton).
//
// Every bone has an identity rest rotation, so a bone's rotation is a rotation about the world axes of the standing creature:
// +X is its left, +Y is up, +Z is forward. About Y a positive turn swings a forward-pointing bone to the creature's left; about X a
// positive turn tips an upward-pointing bone forward (the tail curls over further) and drops a forward-pointing one (so a negative
// turn raises a claw). The game walks, breathes and strikes it from a handful of numbers (a "pose") instead of baking animations, the
// same way as the bird (src/bird-pose.js).
//
// The eight legs are solved, not swung: each foot has a spot on the ground and a path (slide back on the ground, lift, swing forward)
// and a small two-bone solver (`solveLeg`) bends the hip and the knee to put the claw tip exactly there. So a foot stays planted while
// the body walks over it, the legs bend deeper when the body crouches, and they fold up under it when it dies. The solver reads the
// leg lengths from the loaded skeleton, so it works for every level of detail and needs no table of numbers.

const LEGS = 4; // pairs
const SEGMENTS = 6;
const TAILS = 5;

// Bone names are made once here, so posing a frame builds no strings.
const SEG_NAMES = Array.from({ length: SEGMENTS }, (_, i) => `Seg0${i + 1}`);
const TAIL_NAMES = Array.from({ length: TAILS }, (_, i) => `Tail${i + 1}`);
export const LEG_NAMES = [];
for (let i = 0; i < LEGS; i++) {
  for (const side of ['L', 'R']) {
    const base = `Leg${i + 1}_${side}`;
    LEG_NAMES.push({ index: i, left: side === 'L', thigh: `${base}_Thigh`, shin: `${base}_Shin`, foot: `${base}_Foot`, toe: `${base}_Toe` });
  }
}
export const CLAW_NAMES = ['L', 'R'].map(side => ({ left: side === 'L', arm: `Claw_${side}_Arm`, fore: `Claw_${side}_Fore`, finger: `Claw_${side}_Finger` }));

export const STINGER_BONES = Object.freeze([
  'Root', 'Body', 'Head', 'Mandible_L', 'Mandible_R', 'Stinger',
  ...SEG_NAMES,
  ...TAIL_NAMES,
  ...LEG_NAMES.flatMap(leg => [leg.thigh, leg.shin, leg.foot, leg.toe]),
  ...CLAW_NAMES.flatMap(claw => [claw.arm, claw.fore, claw.finger]),
]);

export const POSE_REST = Object.freeze({
  gait: 0, // 0 standing, 1 walking: how far the feet slide and lift, and how much the body ripples
  phase: 0, // radians along the walking cycle (the game advances it as the creature covers ground)
  turn: 0, // -1 to 1: the body bends into a turn, positive to the creature's left
  alert: 0, // 0 relaxed, 1 on guard: the tail curled up over the back, the claws raised and open
  headYaw: 0, // radians to the creature's left
  headPitch: 0, // radians, nose down is positive
  windup: 0, // 0 to 1: crouched, the tail cocked up and back, the claws spread wide, the eyes and sting flaring (the warning before a strike)
  strike: 0, // 0 to 1: the tail whipped forward and down onto the aim point
  hurt: 0, // 0 to 1: flinching from a blow, the tail thrown up and the claws open
  dead: 0, // 0 to 1: legs folded in, tail drooped, the body down and dark
});

const STANCE = 0.6; // of each cycle a foot is on the ground, moving back
const SWEEP = 0.13; // metres each foot slides ahead of and behind its home spot in a stance (model scale 1)

// Where each joint goes. These are the numbers to tune when a pose looks wrong. Angles are radians; lengths are metres at model scale 1.
export const JOINTS = Object.freeze({
  sweep: SWEEP,
  stanceFraction: STANCE,
  stride: (2 * SWEEP) / STANCE, // metres the body travels per leg cycle: the planted foot slides back exactly as fast as the body goes forward
  wave: 0.5, // cycles one leg is behind its neighbour on the same side: 0.5 is the alternating-tetrapod walk of an arachnid
  liftHeight: 0.09, // how high a foot swings off the ground
  liftOut: 0.03, // and how far out
  ripple: 0.06, // radians each abdomen plate sways from side to side while walking
  rippleLag: 0.5, // radians of phase between one plate and the next
  bob: 0.010, // metres the body rises and falls twice a cycle
  breathe: 0.012, // radians the body rocks while it stands
  alertRise: 0.025, // metres the body stands taller on guard
  crouch: 0.075, // metres the body sinks in the windup (the legs bend to keep their feet planted)
  windupPitch: 0.07, // radians the front of the body tips down in the windup
  strikePitch: 0.10, // and more in the strike
  deadSink: 0.10, // metres
  deadTuck: Object.freeze({ x: 0.45, y: 0.17, z: 0.55 }), // where a dead foot ends up: this share of its distance from the middle, this high above the ground
  // the tail: five joints and the sting. `Wind` is the offset of each joint, in radians, with the tail cocked (up and back); `Hit` with the tail thrown forward.
  tailAlert: 0.10, // extra curl of each joint on guard
  stingerAlert: 0.2,
  tailWind: Object.freeze([-0.42, -0.17, -0.17, -0.17, -0.17]),
  stingerWind: -0.3,
  tailHit: Object.freeze([0.98, 0.02, -0.25, -0.36, -0.25]),
  stingerHit: -0.94,
  tailHurt: Object.freeze([-0.25, -0.1, -0.1, -0.06, -0.06]),
  tailDead: Object.freeze([-1.2, -0.34, -0.16, 0.13, 0.16]), // the tail flops down behind it and lies on the sand
  stingerDead: 0.02,
  tailDeadYaw: 0.12, // radians each tail joint swings sideways more than the one before it, so the dead tail curls round to one side
  tailBend: 0.05, // radians each tail joint bends into a turn
  // the jaws
  jawOpen: 0.42,
  // the claws
  clawRaise: 0.30, // radians each arm lifts on guard
  clawRaiseWindup: 0.5,
  clawSpread: 0.16, // radians each arm swings outward on guard
  clawSpreadWindup: 0.34,
  clawBend: 0.18, // radians the elbow bends the forearm inward at rest-ish; more in a strike
  fingerClosed: -0.10, // radians: the movable finger's angle that just touches the other (closed)
  fingerGuard: 0.34, // open on guard
  fingerWindup: 0.70, // open wide
  fingerHurt: 0.55,
  fingerDead: 0.25,
});

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const smooth = t => t * t * (3 - 2 * t);
const TAU = Math.PI * 2;

const euler = new THREE.Euler();
function setEuler(out, x, y, z, order = 'XYZ') {
  euler.set(x, y, z, order);
  return out.setFromEuler(euler);
}

// Where one foot is in its cycle: `fore` runs from +1 (furthest forward) to -1 (furthest back), `lift` is how high it is off
// the ground (0 to 1). On the ground it slides back at an even pace; then it lifts and swings forward.
const step = { fore: 0, lift: 0 };
export function footCycle(cycle, stanceFraction = JOINTS.stanceFraction, out = step) {
  const u = cycle - Math.floor(cycle);
  if (u < stanceFraction) {
    out.fore = 1 - 2 * (u / stanceFraction);
    out.lift = 0;
  } else {
    const s = (u - stanceFraction) / (1 - stanceFraction);
    out.fore = -1 + 2 * smooth(s);
    out.lift = Math.sin(Math.PI * s);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------- the legs
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const sH = new THREE.Vector3(), sD = new THREE.Vector3(), sA = new THREE.Vector3(), sK = new THREE.Vector3(), sP = new THREE.Vector3();
const sThigh = new THREE.Vector3(), sShin = new THREE.Vector3(), sN = new THREE.Vector3(), sZ = new THREE.Vector3();
const sM = new THREE.Matrix4(), qThigh = new THREE.Quaternion(), qShin = new THREE.Quaternion(), qFoot = new THREE.Quaternion(), qBodyInv = new THREE.Quaternion();

// The rotation that takes the frame (x axis, y axis) to the frame (x, y) given; x and y must be perpendicular unit vectors.
function basisQuaternion(x, y, out) {
  sZ.crossVectors(x, y);
  sM.makeBasis(x, y, sZ);
  return out.setFromRotationMatrix(sM);
}

// Reads one leg's rest shape from the loaded skeleton. All rest rotations are identity, so a bone's position is its offset from its parent.
function legRest(bones, names, bodyRest) {
  const hip = bones[names.thigh].position.clone();
  const s = bones[names.shin].position.clone();
  const f = bones[names.foot].position.clone();
  const t = bones[names.toe].position.clone();
  const d = s.clone().add(f);
  const dHat = d.clone().normalize();
  const pole = s.clone().addScaledVector(dHat, -s.dot(dHat)).normalize();
  const n0 = s.clone().cross(f).normalize();
  const restInv1 = basisQuaternion(s.clone().normalize(), n0, new THREE.Quaternion()).invert();
  const restInv2 = basisQuaternion(f.clone().normalize(), n0, new THREE.Quaternion()).invert();
  const home = bodyRest.clone().add(hip).add(d).add(t); // the toe, in the Root's space
  const hipRoot = bodyRest.clone().add(hip);
  return {
    names, left: names.left, index: names.index,
    hip, s, f, t, L1: s.length(), L2: f.length(), pole, restInv1, restInv2,
    home, homeAngle: Math.atan2(home.x - hipRoot.x, home.z - hipRoot.z),
  };
}

// Bends one leg so its claw tip is at `target` (in the Root's space). Writes the local rotations of the thigh, shin and foot.
export function solveLeg(leg, bodyRest, qBody, target, outThigh, outShin, outFoot) {
  const H = sH.copy(leg.hip).applyQuaternion(qBody).add(bodyRest);
  // the foot keeps its rest shape, turned about the vertical by however far the toe has swung round the hip
  const psi = Math.atan2(target.x - H.x, target.z - H.z) - leg.homeAngle;
  qFoot.setFromAxisAngle(Y_AXIS, psi);
  const A = sA.copy(leg.t).applyQuaternion(qFoot).multiplyScalar(-1).add(target); // the ankle
  const d = sD.subVectors(A, H);
  let D = d.length();
  const maxD = (leg.L1 + leg.L2) * 0.985;
  const minD = Math.abs(leg.L1 - leg.L2) + 0.03;
  if (D > maxD || D < minD) {
    const clamped = clamp(D, minD, maxD);
    d.multiplyScalar(clamped / (D || 1));
    A.copy(H).add(d);
    D = clamped;
  }
  d.divideScalar(D);
  const a = (leg.L1 * leg.L1 - leg.L2 * leg.L2 + D * D) / (2 * D);
  const h = Math.sqrt(Math.max(0, leg.L1 * leg.L1 - a * a));
  // the knee bends the way it does at rest (up and out), taken off the line from hip to ankle
  sP.copy(leg.pole).applyQuaternion(qBody);
  sP.addScaledVector(d, -sP.dot(d));
  if (sP.lengthSq() < 1e-8) sP.set(0, 1, 0);
  sP.normalize();
  const K = sK.copy(H).addScaledVector(d, a).addScaledVector(sP, h);
  sThigh.subVectors(K, H);
  sShin.subVectors(A, K);
  sN.crossVectors(sThigh, sShin).normalize();
  sThigh.divideScalar(leg.L1);
  sShin.divideScalar(leg.L2);
  basisQuaternion(sThigh, sN, qThigh).multiply(leg.restInv1);
  basisQuaternion(sShin, sN, qShin).multiply(leg.restInv2);
  qBodyInv.copy(qBody).invert();
  outThigh.copy(qBodyInv).multiply(qThigh);
  outShin.copy(qThigh).invert().multiply(qShin);
  outFoot.copy(qShin).invert().multiply(qFoot);
}

// ---------------------------------------------------------------------------------------------------------------- the pose
const target = new THREE.Vector3();

// The bone rotations for a pose. Writes into `out` (an object of THREE.Quaternions keyed by bone name, which createStingerPoser
// makes) and returns the metres the whole body rises (the game moves the Root bone by it). `time` drives the small constant
// motions: breathing, the tail's slow sway, the head's idle glances. `rig` holds the legs' rest shapes (createStingerPoser makes
// it from the model); without one the legs stay in their rest pose.
export function computePose(pose, time, out, joints = JOINTS, rig = null) {
  const J = joints;
  const gait = clamp(pose.gait, 0, 1);
  const alert = clamp(pose.alert, 0, 1);
  const windup = clamp(pose.windup, 0, 1);
  const strike = clamp(pose.strike, 0, 1);
  const hurt = clamp(pose.hurt, 0, 1);
  const dead = clamp(pose.dead, 0, 1);
  const cocked = Math.max(windup, strike);
  const idle = (1 - gait * 0.7) * (1 - dead) * (1 - 0.8 * cocked);
  const cycles = pose.phase / TAU;

  // --- the body: breathing while it stands, tipping forward into the windup and the strike
  const breathe = Math.sin(time * 1.5) * J.breathe * idle;
  const bob = Math.abs(Math.sin(pose.phase)) * J.bob * gait + alert * J.alertRise * (1 - dead) - windup * J.crouch * (1 - strike * 0.4) - dead * J.deadSink;
  setEuler(out.Body, breathe * 0.5 + windup * J.windupPitch + strike * (J.strikePitch - J.windupPitch), 0, 0);

  // --- legs: each foot has a spot on the ground and a path; the solver bends the leg to reach it
  if (rig) {
    for (const leg of rig.legs) {
      footCycle(cycles + leg.index * J.wave + (leg.left ? 0 : 0.5), J.stanceFraction);
      const lift = step.lift * gait;
      const side = leg.left ? 1 : -1;
      target.copy(leg.home);
      target.x += side * (lift * J.liftOut + windup * 0.03);
      target.z += step.fore * J.sweep * gait;
      target.y = -bob + lift * J.liftHeight;
      if (dead > 0) {
        const tuck = J.deadTuck;
        target.x = lerpTo(target.x, rig.bodyRest.x + (leg.home.x - rig.bodyRest.x) * tuck.x, dead);
        target.z = lerpTo(target.z, rig.bodyRest.z + (leg.home.z - rig.bodyRest.z) * tuck.z, dead);
        target.y = lerpTo(target.y, tuck.y - bob * 0, dead);
      }
      solveLeg(leg, rig.bodyRest, out.Body, target, out[leg.names.thigh], out[leg.names.shin], out[leg.names.foot]);
      out[leg.names.toe].identity();
    }
  } else {
    for (const leg of LEG_NAMES) { out[leg.thigh].identity(); out[leg.shin].identity(); out[leg.foot].identity(); out[leg.toe].identity(); }
  }

  // --- the abdomen: a ripple of side-to-side sway while walking, bent into a turn, breathing, tipping forward into a strike
  const turn = clamp(pose.turn, -1, 1);
  for (let k = 0; k < SEGMENTS; k++) {
    const sway = Math.sin(pose.phase - k * J.rippleLag) * J.ripple * gait;
    setEuler(out[SEG_NAMES[k]], breathe * (k % 2 ? -1 : 1) * 0.6 + strike * 0.03, turn * 0.04 + sway, 0);
  }

  // --- head and jaws
  setEuler(out.Head, pose.headPitch + strike * 0.12 - windup * 0.06 - hurt * 0.2, clamp(pose.headYaw, -0.7, 0.7) * (1 - dead), 0);
  const chew = Math.sin(time * 2.7) * 0.05 * idle;
  const open = Math.min(1, alert + windup * 0.6 + strike + hurt) * J.jawOpen + 0.05 + chew + dead * 0.25;
  setEuler(out.Mandible_L, 0, open, 0);
  setEuler(out.Mandible_R, 0, -open, 0);

  // --- claws: held low and still at rest, raised and spread on guard, flung wide in the windup, snapping shut in the strike
  const walkSwing = Math.sin(pose.phase) * 0.07 * gait;
  for (const claw of CLAW_NAMES) {
    const sgn = claw.left ? 1 : -1;
    const raise = alert * J.clawRaise + windup * (J.clawRaiseWindup - J.clawRaise * alert) + hurt * 0.25 - dead * 0.35;
    const spread = alert * J.clawSpread + windup * (J.clawSpreadWindup - J.clawSpread * alert) - strike * 0.4 + hurt * 0.2 + dead * 0.15;
    const sway = Math.sin(time * 0.8 + (claw.left ? 0 : 1.7)) * 0.025 * idle;
    setEuler(out[claw.arm], -raise + sway + walkSwing * -sgn, sgn * (spread + 0.02), 0);
    setEuler(out[claw.fore], 0, -sgn * (J.clawBend * (0.4 + alert * 0.6) * (1 - dead) + strike * 0.5 + sway), 0);
    // the movable finger: shut a little less than touching, open on guard, wide in the windup, a sharp snap in the strike
    let fingerAngle = lerpTo(J.fingerClosed + 0.12, J.fingerGuard, alert);
    fingerAngle = lerpTo(fingerAngle, J.fingerWindup, windup);
    fingerAngle = lerpTo(fingerAngle, J.fingerClosed, smooth(strike));
    fingerAngle = lerpTo(fingerAngle, J.fingerHurt, hurt);
    fingerAngle = lerpTo(fingerAngle, J.fingerDead, dead);
    fingerAngle += Math.max(0, Math.sin(time * 0.43 + (claw.left ? 0.5 : 2.4))) ** 8 * 0.3 * idle; // an occasional click
    setEuler(out[claw.finger], 0, sgn * fingerAngle, 0);
  }

  // --- tail and sting: a slow sway, bent into a turn, curled up on guard, cocked, whipped forward, drooping when dead
  for (let k = 0; k < TAILS; k++) {
    const sway = Math.sin(time * 0.9 + k * 0.7) * 0.035 * idle + Math.sin(pose.phase - k * 0.8) * 0.02 * gait;
    const nod = Math.sin(time * 0.6 + k * 0.5 + 1.3) * 0.025 * idle;
    const curl = alert * J.tailAlert + cocked * J.tailWind[k] + strike * (J.tailHit[k] - J.tailWind[k]) + hurt * J.tailHurt[k] + dead * J.tailDead[k] + nod;
    setEuler(out[TAIL_NAMES[k]], curl, sway - turn * J.tailBend + dead * J.tailDeadYaw * (k + 1), 0);
  }
  const flick = Math.max(0, Math.sin(time * 0.37 + 2.0)) ** 6; // an occasional twitch of the sting
  setEuler(out.Stinger, alert * J.stingerAlert + cocked * J.stingerWind + strike * (J.stingerHit - J.stingerWind) + dead * J.stingerDead + flick * 0.22 * idle, Math.sin(time * 1.1) * 0.04 * idle, 0);

  out.Root.identity();
  return bob;
}

function lerpTo(a, b, t) { return a + (b - a) * t; }

// Finds the bones of a loaded (and cloned) stinger and poses them. Returns null if a bone is missing.
export function createStingerPoser(root) {
  const bones = {};
  root.traverse(object => {
    if (object.isBone && STINGER_BONES.includes(object.name)) bones[object.name] = object;
  });
  if (!STINGER_BONES.every(name => bones[name])) return null;
  const rotations = {};
  for (const name of STINGER_BONES) rotations[name] = new THREE.Quaternion();
  const restY = bones.Root.position.y;
  const bodyRest = bones.Body.position.clone();
  const rig = { bodyRest, legs: LEG_NAMES.map(names => legRest(bones, names, bodyRest)) };
  return {
    bones,
    rig,
    rotations,
    apply(pose, time, joints = JOINTS) {
      const bob = computePose(pose, time, rotations, joints, rig);
      for (const name of STINGER_BONES) bones[name].quaternion.copy(rotations[name]);
      bones.Root.position.y = restY + bob;
    },
  };
}
