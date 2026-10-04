import * as THREE from 'three';

// Poses for the dune stinger (see tools/dune-stinger/build_stinger.py for the model and its skeleton).
//
// Every bone has an identity rest rotation, so a bone's rotation is a rotation about the world axes of the standing creature:
// +X is its left, +Y is up, +Z is forward. About Y a positive turn swings a forward-pointing bone to the creature's left; about Z a
// positive turn lifts a left-pointing bone (so it lifts a left leg, and the right legs mirror it); about X a positive turn tips an
// upward-pointing bone forward (the tail curls over further) and drops a forward-pointing one. The game walks, breathes and
// strikes it from a handful of numbers (a "pose") instead of baking animations, the same way as the bird (src/bird-pose.js).

const LEGS = 8; // pairs
const SEGMENTS = 8;
const TAILS = 4;

// Bone names are made once here, so posing a frame builds no strings.
const SEG_NAMES = Array.from({ length: SEGMENTS }, (_, i) => `Seg0${i + 1}`);
const TAIL_NAMES = Array.from({ length: TAILS }, (_, i) => `Tail${i + 1}`);
const LEG_NAMES = Array.from({ length: LEGS }, (_, i) => ({
  upperL: `Leg0${i + 1}_L_Upper`, lowerL: `Leg0${i + 1}_L_Lower`, upperR: `Leg0${i + 1}_R_Upper`, lowerR: `Leg0${i + 1}_R_Lower`,
}));

export const STINGER_BONES = Object.freeze([
  'Root', 'Head', 'Mandible_L', 'Mandible_R', 'Stinger',
  ...SEG_NAMES,
  ...TAIL_NAMES,
  ...LEG_NAMES.flatMap(leg => [leg.upperL, leg.lowerL, leg.upperR, leg.lowerR]),
]);

export const POSE_REST = Object.freeze({
  gait: 0, // 0 standing, 1 walking: how far the legs swing and lift, and how much the body ripples
  phase: 0, // radians along the walking cycle (the game advances it as the creature covers ground)
  turn: 0, // -1 to 1: the body bends into a turn, positive to the creature's left
  alert: 0, // 0 relaxed, 1 on guard: the tail curled up over the back, the mandibles opening
  headYaw: 0, // radians to the creature's left
  headPitch: 0, // radians, nose down is positive
});

// Where each joint goes. These are the numbers to tune when a pose looks wrong.
export const JOINTS = Object.freeze({
  swing: 0.46, // radians each hip swings fore and aft at full gait
  swingRear: 0.38, // the rear pair swing a little less
  lift: 0.18, // radians a hip lifts a leg while it is swinging forward
  kneeLift: 0.3, // and the knee swings the foot up this much more (a positive turn about Z lifts and extends a left foot)
  stanceFraction: 0.6, // of each cycle a foot is on the ground, moving back
  wave: 0.125, // cycles each leg is behind the one in front (a ripple that runs from the back to the front)
  ripple: 0.05, // radians each body segment sways from side to side while walking
  rippleLag: 0.55, // radians of phase between one segment and the next
  bob: 0.012, // metres (before scaling) the body rises and falls twice a cycle
  tailAlert: 0.16, // radians each of the four tail joints curls further over when on guard
  stingerAlert: 0.3,
  tailBend: 0.05, // radians each tail joint bends into a turn
  mandibleOpen: 0.42, // radians each mandible opens when on guard
  breathe: 0.012, // radians the body segments rock while it stands
  stride: 0.34, // metres (before scaling) the body travels per leg cycle; a foot sweeps back about 0.2 m in the 60% of it on the ground, 0.2 / 0.6
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

// The bone rotations for a pose. Writes into `out` (an object of THREE.Quaternions keyed by bone name, which createStingerPoser
// makes) and returns the metres the whole body rises (the game moves the Root bone by it). `time` drives the small constant
// motions: breathing, the tail's slow sway, the head's idle glances.
export function computePose(pose, time, out, joints = JOINTS) {
  const J = joints;
  const gait = clamp(pose.gait, 0, 1);
  const alert = clamp(pose.alert, 0, 1);
  const idle = 1 - gait * 0.7;

  // --- legs: a ripple of steps along each side, the two sides half a cycle apart
  const cycles = pose.phase / TAU;
  for (let i = 0; i < LEGS; i++) {
    const swing = (i >= LEGS - 2 ? J.swingRear : J.swing) * gait;
    for (let side = 0; side < 2; side++) {
      const left = side === 0;
      footCycle(cycles + i * J.wave + (left ? 0 : 0.5), J.stanceFraction);
      const lift = step.lift * gait;
      const upper = out[left ? LEG_NAMES[i].upperL : LEG_NAMES[i].upperR];
      const lower = out[left ? LEG_NAMES[i].lowerL : LEG_NAMES[i].lowerR];
      // A left leg points to +X: a positive turn about Y swings its foot backward and a positive turn about Z lifts it. The right leg is the mirror.
      const yaw = -step.fore * swing;
      const roll = lift * J.lift;
      const knee = lift * J.kneeLift;
      setEuler(upper, 0, left ? yaw : -yaw, left ? roll : -roll, 'ZYX');
      setEuler(lower, 0, 0, left ? knee : -knee);
    }
  }

  // --- body: a ripple of side-to-side sway while walking, bent into a turn, breathing while it stands
  const turn = clamp(pose.turn, -1, 1);
  const breathe = Math.sin(time * 1.5) * J.breathe * idle;
  for (let k = 0; k < SEGMENTS; k++) {
    const sway = Math.sin(pose.phase - k * J.rippleLag) * J.ripple * gait;
    setEuler(out[SEG_NAMES[k]], breathe * (k % 2 ? -1 : 1) * 0.6, turn * 0.04 + sway, 0);
  }

  // --- head and mandibles
  setEuler(out.Head, pose.headPitch, pose.headYaw, 0);
  const chew = Math.sin(time * 2.7) * 0.05 * idle;
  const open = alert * J.mandibleOpen + 0.05 + chew;
  setEuler(out.Mandible_L, 0, open, 0);
  setEuler(out.Mandible_R, 0, -open, 0);

  // --- tail and stinger: a slow sway, bent into a turn, and curled up over the back on guard
  for (let k = 0; k < TAILS; k++) {
    const sway = Math.sin(time * 0.9 + k * 0.7) * 0.035 * idle + Math.sin(pose.phase * 1 - k * 0.8) * 0.02 * gait;
    const nod = Math.sin(time * 0.6 + k * 0.5 + 1.3) * 0.025 * idle;
    setEuler(out[TAIL_NAMES[k]], alert * J.tailAlert + nod, sway - turn * J.tailBend, 0);
  }
  const flick = Math.max(0, Math.sin(time * 0.37 + 2.0)) ** 6; // an occasional twitch of the sting
  setEuler(out.Stinger, alert * J.stingerAlert + flick * 0.22 * idle, Math.sin(time * 1.1) * 0.04 * idle, 0);

  out.Root.identity();
  return Math.abs(Math.sin(pose.phase)) * J.bob * gait;
}

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
  return {
    bones,
    apply(pose, time, joints = JOINTS) {
      const bob = computePose(pose, time, rotations, joints);
      for (const name of STINGER_BONES) bones[name].quaternion.copy(rotations[name]);
      bones.Root.position.y = restY + bob;
    },
  };
}
