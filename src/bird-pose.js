import * as THREE from 'three';

// Poses for the alien bird (see tools/bird/build_bird.py for the model and its skeleton).
//
// Every bone in the model has an identity rest rotation, so a bone's rotation is a rotation about the world axes
// of the standing bird: +X is its left, +Y is up, +Z is forward. A positive rotation about X leans an upright thing
// forward (nose down); about Y it turns the bird to its left; about Z it rolls the bird to its right (its left
// wing goes up). The model is built with its wings spread out and its legs hanging; the game folds, flaps and
// tucks them from a handful of numbers (a "pose") instead of baking animations.

export const BIRD_BONES = Object.freeze([
  'Root', 'Body', 'Neck1', 'Neck2', 'Head', 'Crest',
  'WingIn_L', 'WingOut_L', 'WingIn_R', 'WingOut_R',
  'Tail', 'Streamer_L', 'StreamerTip_L', 'Streamer_R', 'StreamerTip_R',
  'Leg_L', 'Foot_L', 'Leg_R', 'Foot_R',
]);

// The standing, wings-folded bird at rest.
export const POSE_REST = Object.freeze({
  fold: 1, // 0 wings out, 1 folded against the body
  flap: 0, // radians: the shoulder rolls up (positive) or down; the wing tip follows
  flex: 0, // radians: the hand bends up (positive) or down at the wrist, on top of the flap
  sweep: 0, // radians: the wings swept back
  legs: 0, // 0 hanging, 1 trailing straight back
  stretch: 0, // 0 neck held in an S, 1 stretched out forward for flying
  dip: 0, // 0 head up, 1 bowed to drink
  headYaw: 0, // radians, to the bird's left
  headPitch: 0, // radians, nose down is positive
  crest: 0, // -1 flat back, 0 relaxed, 1 raised
  bodyPitch: 0, // radians, nose down is positive
  bodyRoll: 0, // radians, right side down is positive
  crouch: 0, // 0 standing, 1 squatting (the body drops, the legs bend)
  tail: 0, // radians, the tail tip goes up when positive
  streamers: 0.25, // how much the tail streamers trail and flutter (0 limp, 1 whipping)
  shake: 0, // 0 to 1: a quick shiver of the folded wings
});

// Where each joint goes when it is fully "on". These are the numbers to tune when a pose looks wrong.
export const JOINTS = Object.freeze({
  // Folded wings: swept back along the flank (Ry), rolled so the top of the wing faces out (Rz) and shortened a little.
  // The hand carries the finger feathers, which fan out in the spread wing; when folded it is squeezed sideways
  // (scaleZ) so they lie nearly parallel, the way the primaries of a resting bird do.
  foldShoulder: Object.freeze({ sweep: 1.45, roll: -1.10, scale: 0.80 }),
  foldHand: Object.freeze({ bend: -0.15, roll: 0.0, scaleX: 1.0, scaleZ: 0.50 }),
  // The neck stretched out for flight, and bowed to drink (X rotations: positive leans forward).
  stretch: Object.freeze({ neck1: 0.70, neck2: 0.28, head: -1.19 }),
  dip: Object.freeze({ neck1: 0.95, neck2: 0.55, head: 0.35 }),
  legsTucked: Object.freeze({ leg: 1.45, foot: -0.55 }),
  crouchLegs: Object.freeze({ leg: -0.55, foot: 0.55 }),
});

const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const smooth = t => t * t * (3 - 2 * t);

const euler = new THREE.Euler();
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const qc = new THREE.Quaternion();

function setEuler(out, x, y, z, order = 'XYZ') {
  euler.set(x, y, z, order);
  return out.setFromEuler(euler);
}

// A rotation reflected across the bird's middle (the plane x = 0): left becomes right.
function mirror(q) {
  q.y = -q.y;
  q.z = -q.z;
  return q;
}

// The bone rotations and scales for a pose. Writes into `out` (an object of THREE.Quaternions keyed by bone name)
// and `scales` (THREE.Vector3s keyed by bone name, only the wing bones are ever not 1), which createBirdPoser
// makes, and returns `out`. `time` drives the small constant motions: streamers, crest, breathing.
export function computePose(pose, time, out, scales, joints = JOINTS) {
  const p = pose;
  const J = joints;
  const fold = clamp(p.fold, 0, 1);

  // --- body: pitch and roll (the legs hang from the root, so they stay put while the body tips)
  setEuler(out.Body, p.bodyPitch + 0.06 * p.crouch, 0, p.bodyRoll, 'XYZ');

  // --- neck: S-curved at rest, stretched out forward in flight, bowed to drink
  const st = clamp(p.stretch, 0, 1);
  const dp = clamp(p.dip, 0, 1);
  const breathe = Math.sin(time * 1.6) * 0.012 * (1 - st);
  const n1 = J.stretch.neck1 * st + J.dip.neck1 * dp + breathe;
  const n2 = J.stretch.neck2 * st + J.dip.neck2 * dp - breathe;
  const hd = J.stretch.head * st + J.dip.head * dp + p.headPitch;
  setEuler(out.Neck1, n1, 0, 0);
  setEuler(out.Neck2, n2, p.headYaw * 0.35, 0);
  setEuler(out.Head, hd, p.headYaw * 0.65, 0);

  // --- crest: flat when flying, raised when alert, with a little flutter
  const crest = clamp(p.crest, -1, 1);
  setEuler(out.Crest, (crest < 0 ? crest * 0.65 : crest * 0.4) + Math.sin(time * 5.3) * 0.03, 0, 0);

  // --- wings. Spread: swept back (Ry) then rolled up or down (Rz). Folded: tucked against the flank.
  const sweepOpen = p.sweep;
  const shoulderSpread = setEuler(qa, 0, sweepOpen, p.flap, 'ZYX');
  const shoulderFold = setEuler(qb, 0, J.foldShoulder.sweep, J.foldShoulder.roll, 'ZYX');
  const shake = Math.sin(time * 38) * 0.05 * p.shake;
  out.WingIn_L.copy(shoulderSpread).slerp(shoulderFold, smooth(fold));
  out.WingIn_L.multiply(setEuler(qc, 0, 0, shake, 'XYZ'));
  out.WingIn_R.copy(out.WingIn_L);
  mirror(out.WingIn_R);

  const handSpread = setEuler(qa, 0, 0, p.flex, 'ZYX');
  const handFold = setEuler(qb, 0, J.foldHand.bend, J.foldHand.roll, 'ZYX');
  out.WingOut_L.copy(handSpread).slerp(handFold, smooth(fold));
  out.WingOut_R.copy(out.WingOut_L);
  mirror(out.WingOut_R);

  // folding also shortens the wing and squeezes the hand (see JOINTS)
  const f = smooth(fold);
  scales.WingIn_L.setScalar(mix(1, J.foldShoulder.scale, f));
  scales.WingIn_R.copy(scales.WingIn_L);
  scales.WingOut_L.set(mix(1, J.foldHand.scaleX, f), 1, mix(1, J.foldHand.scaleZ, f));
  scales.WingOut_R.copy(scales.WingOut_L);

  // --- legs: hanging, trailing back in flight, bent when crouching
  const tuck = clamp(p.legs, 0, 1);
  const crouch = clamp(p.crouch, 0, 1);
  const leg = J.legsTucked.leg * tuck + J.crouchLegs.leg * crouch;
  const foot = J.legsTucked.foot * tuck + J.crouchLegs.foot * crouch;
  setEuler(out.Leg_L, leg, 0, 0);
  setEuler(out.Foot_L, foot, 0, 0);
  out.Leg_R.copy(out.Leg_L);
  out.Foot_R.copy(out.Foot_L);

  // --- tail and its two streamers
  setEuler(out.Tail, p.tail, 0, 0);
  const s = clamp(p.streamers, 0, 1);
  setEuler(out.Streamer_L, Math.sin(time * 1.9) * 0.07 * s - 0.05 * s, 0.05 + Math.sin(time * 2.3 + 0.7) * 0.10 * s, 0);
  setEuler(out.StreamerTip_L, Math.sin(time * 2.4 + 1.2) * 0.14 * s, Math.sin(time * 2.9 + 0.1) * 0.20 * s, 0);
  setEuler(out.Streamer_R, Math.sin(time * 1.7 + 2.0) * 0.07 * s - 0.05 * s, -0.05 + Math.sin(time * 2.1 + 3.1) * 0.10 * s, 0);
  setEuler(out.StreamerTip_R, Math.sin(time * 2.2 + 0.4) * 0.14 * s, Math.sin(time * 2.7 + 2.2) * 0.20 * s, 0);

  out.Root.identity();
  return out;
}

// Finds the bones of a loaded (and cloned) bird and poses them. Returns null if a bone is missing.
export function createBirdPoser(root) {
  const bones = {};
  root.traverse(object => {
    if (object.isBone && BIRD_BONES.includes(object.name)) bones[object.name] = object;
  });
  if (!BIRD_BONES.every(name => bones[name])) return null;
  const rotations = {};
  const scales = {};
  for (const name of BIRD_BONES) {
    rotations[name] = new THREE.Quaternion();
    scales[name] = new THREE.Vector3(1, 1, 1);
  }
  const restY = bones.Body.position.y;
  return {
    bones,
    // `drop` is how far the body sinks (metres), for crouching.
    apply(pose, time, drop = 0, joints = JOINTS) {
      computePose(pose, time, rotations, scales, joints);
      for (const name of BIRD_BONES) {
        bones[name].quaternion.copy(rotations[name]);
        bones[name].scale.copy(scales[name]);
      }
      bones.Body.position.y = restY - drop;
    },
  };
}
