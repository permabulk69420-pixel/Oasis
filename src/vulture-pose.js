import * as THREE from 'three';

// Poses for the alien vulture (the owner's model: public/models/creatures/alien_vulture_lod*.glb, made in Blender). Its bones are rotated at rest
// (each points along its own Y, as Blender makes them), so a pose turns a bone about the axes of the standing bird, +X its left, +Y up, +Z
// forward, on top of its rest rotation: the same convention as src/bird-pose.js. The model rests standing with its four wings spread; the
// game flaps, folds and tucks them from a handful of numbers, as it does the alien bird.

export const VULTURE_BONES = Object.freeze([
  'root', 'body', 'neck_base', 'neck_mid', 'neck_top', 'head', 'tail',
  'wing_upper.L', 'wing_fore.L', 'wing_hand.L', 'rearwing_upper.L', 'rearwing_hand.L', 'thigh.L', 'shin.L', 'foot.L',
  'wing_upper.R', 'wing_fore.R', 'wing_hand.R', 'rearwing_upper.R', 'rearwing_hand.R', 'thigh.R', 'shin.R', 'foot.R',
]);

// Gliding with its wings out.
export const VULTURE_POSE = Object.freeze({
  flap: 0, // radians: the front wings' shoulders roll up (positive) or down
  flex: 0, // radians: the wing tips bend up (positive) or down, on top of the flap
  rear: 0, // radians: the rear wings' roll (they follow the front ones a beat late)
  stretch: 1, // 0 neck up as it stands, 1 stretched out forward for flying
  headYaw: 0, // radians, to its left
  legs: 1, // 0 hanging as it stands, 1 tucked back under the tail
  tail: 0, // radians, the tip goes up when positive
});

const JOINTS = Object.freeze({
  dihedral: 0.10, // the wings held a little up in a glide, as a soaring bird's are
  stretch: Object.freeze({ base: 0.75, mid: 0.25, top: -0.35, head: -0.45 }),
  legs: Object.freeze({ thigh: 1.35, shin: 0.15, foot: 0.5 }),
});

const euler = new THREE.Euler();
const turn = new THREE.Quaternion();

// The poser for one copy of the model, or null if a bone is missing. apply(pose) sets the bones.
export function createVulturePoser(root) {
  // (the glTF loader drops the dots from node names: wing_upper.L comes in as wing_upperL)
  const wanted = new Map(VULTURE_BONES.map(name => [THREE.PropertyBinding.sanitizeNodeName(name), name]));
  const bones = {};
  root.traverse(object => { if (object.isBone && wanted.has(THREE.PropertyBinding.sanitizeNodeName(object.name))) bones[wanted.get(THREE.PropertyBinding.sanitizeNodeName(object.name))] = object; });
  if (VULTURE_BONES.some(name => !bones[name])) return null;
  // each bone's rest rotation, and its parent's rest rotation in the model's frame (to turn the model's axes into the bone's own)
  root.updateMatrixWorld(true);
  const rootInverse = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  const joints = {};
  for (const name of VULTURE_BONES) {
    const bone = bones[name];
    const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootInverse);
    joints[name] = { bone, rest: bone.quaternion.clone(), parent, parentInverse: parent.clone().invert() };
  }

  // the bone turned by (x, y, z) radians about the model's axes, from its rest
  function set(name, x, y, z) {
    const j = joints[name];
    turn.setFromEuler(euler.set(x, y, z, 'XYZ'));
    j.bone.quaternion.copy(j.parentInverse).multiply(turn).multiply(j.parent).multiply(j.rest);
  }

  return {
    apply(pose) {
      const p = pose;
      const s = JOINTS.stretch, l = JOINTS.legs;
      set('neck_base', s.base * p.stretch, 0, 0);
      set('neck_mid', s.mid * p.stretch, 0, 0);
      set('neck_top', s.top * p.stretch, p.headYaw * 0.5, 0);
      set('head', s.head * p.stretch, p.headYaw * 0.5, 0);
      set('tail', -p.tail, 0, 0);
      // the left wing rolls up about the forward axis (+Z); the right is its mirror
      for (const [side, sign] of [['L', 1], ['R', -1]]) {
        set(`wing_upper.${side}`, 0, 0, sign * (JOINTS.dihedral + p.flap));
        set(`wing_fore.${side}`, 0, 0, sign * p.flex * 0.5);
        set(`wing_hand.${side}`, 0, 0, sign * p.flex);
        set(`rearwing_upper.${side}`, 0, 0, sign * (JOINTS.dihedral + p.rear));
        set(`rearwing_hand.${side}`, 0, 0, sign * p.rear * 0.4);
        set(`thigh.${side}`, l.thigh * p.legs, 0, 0);
        set(`shin.${side}`, l.shin * p.legs, 0, 0);
        set(`foot.${side}`, l.foot * p.legs, 0, 0);
      }
    },
  };
}
