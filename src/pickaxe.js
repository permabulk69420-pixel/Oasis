import * as THREE from 'three';
import { SPAWN } from './world.js';
import { setGripSurface } from './grip-contact.js';
import { exposureGlow } from './glow.js';

// The pickaxe: a hand tool like the axe, for breaking rock and crystal (src/mining.js). It stands planted in the sand by the other
// starting tools, can be crafted, gripped by the leather wrap, carried on a hip and packed away at the chest. The model is
// public/models/pickaxe/pickaxe.glb (tools/pickaxe/build_pickaxe.py): +Y runs up the haft, the origin is the middle of the grip, the
// butt end is 0.31 m below it and the top of the haft 0.50 m above it. The head runs along X: the long pick curves down to a point
// at +X, the short flat adze edge is at -X. It is held like the axe (the long pick pointing forward), so an overhead swing brings
// the point down on whatever is in front of you.

const PICKAXE_URL = `${import.meta.env?.BASE_URL ?? '/'}models/pickaxe/pickaxe.glb`;

export const PICKAXE = Object.freeze({
  url: PICKAXE_URL,
  // Planted upright in the sand by the starting tools: the butt end goes in a few centimetres.
  groundBottom: 0.27,
  pickupRadius: 0.5,
  spawn: Object.freeze({ x: SPAWN.x - 3.1, z: SPAWN.z - 1.0 }),
  // The point of the pick, in model space (the long pick is 0.29 m out along X and has dropped 0.085 m below the head's middle).
  tip: Object.freeze([0.286, 0.343, 0]),
  // How bright the little glowing bead on the tassel should look, by day and by night (see the spear: any brighter bleaches white).
  glow: Object.freeze({ day: 0.85, night: 0.65 }),
});

// What the fingers close on: the leather wrap in the middle of the haft, never the head or the tassel.
// The hand takes it low on the haft, nearer the butt, the way a pickaxe is held (the wrap is in the middle, so the fist sits 14 cm below it).
export const PICKAXE_GRIP = Object.freeze({ meshes: ['Shaft'], axis: [0, 1, 0], point: [0, -0.14, 0] });

// Hip pose (see holsterPose in src/tools.js): upside down, the head hanging at the hip and the haft leaning back about 30 degrees with the
// handle end up behind the hip, so the hand that reaches for it closes on the handle, not on the head.
export const PICKAXE_HOLSTER = Object.freeze({ dir: [-0.10, -1, -0.55], along: -0.10 });

// The same flip the axe has (model +Y points opposite the hand socket's held-up direction), then a quarter turn about the haft so the
// head's long side (the pick) points forward.
const heldFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
const pickForwardTwist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
export const PICKAXE_HELD_ROTATION = heldFlip.clone().multiply(pickForwardTwist);

export function createPickaxeKind({ getExposure = () => 1 } = {}) {
  let glowMaterial = null;
  let appliedGlow = -1;
  return {
    id: 'pickaxe',
    name: 'Stone pickaxe',
    url: PICKAXE.url,
    groundBottom: PICKAXE.groundBottom,
    pickupLift: 0,
    pickupRadius: PICKAXE.pickupRadius,
    heldRotation: PICKAXE_HELD_ROTATION,
    holster: PICKAXE_HOLSTER,
    // When let go or thrown (src/falling.js): heavy at the head, which lies flat on the ground (the model's X is the head's long side).
    fall: { radius: 0.035, landing: 'lie', com: 0.30, edge: [1, 0, 0] },
    // A blow (src/weapon-hits.js): the point of the pick, swung fast enough. It breaks rock and crystal (src/mining.js) and hurts a
    // creature a little less than the axe does.
    hit: {
      damage: 26, // health taken off a creature, or mined off a rock, by a blow at full speed
      minSpeed: 2.3, // m/s of the point (relative to your body when held): slower than this does nothing
      fullSpeed: 5.8, // m/s: from here up it does the full damage
      radius: 0.05,
      point: out => out.fromArray(PICKAXE.tip),
    },
    spawns: [{ x: PICKAXE.spawn.x, z: PICKAXE.spawn.z }],
    createState: () => ({}),

    // The copies share their materials, so the glow is set once on the template's.
    prepareTemplate(root) {
      root.traverse(object => { if (object.material?.name === 'Glow') glowMaterial = object.material; });
    },
    prepare({ root }) {
      setGripSurface(root, PICKAXE_GRIP);
      root.traverse(object => {
        if (!object.isMesh) return;
        object.castShadow = false;
        object.receiveShadow = false;
      });
    },
    updateShared() {
      if (!glowMaterial) return;
      const intensity = exposureGlow(getExposure(), PICKAXE.glow);
      if (Math.abs(intensity - appliedGlow) > 0.01 * intensity) {
        glowMaterial.emissiveIntensity = intensity;
        appliedGlow = intensity;
      }
    },
  };
}
