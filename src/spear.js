import * as THREE from 'three';
import { SPAWN } from './world.js';
import { setGripSurface } from './grip-contact.js';
import { exposureGlow } from './glow.js';
import { pulseHaptics } from './haptics.js';

// The spear: a hand tool like the axe and the torch, and no more than that (it does not hurt or hunt anything). It stands
// planted in the sand by the other starting tools, can be crafted, gripped by the leather wrap, carried on a hip and packed
// away at the chest. The model is public/models/spear/spear.glb (tools/spear/build_spear.py); +Y runs up the shaft to the stone
// point, the butt end is 0.52 m below the origin and the origin is the middle of the leather grip.

const SPEAR_URL = `${import.meta.env?.BASE_URL ?? '/'}models/spear/spear.glb`;

export const SPEAR = Object.freeze({
  url: SPEAR_URL,
  // Planted upright in the sand by the starting tools: the butt end goes in a few centimetres.
  groundBottom: 0.48,
  // Reach for it anywhere along the middle of the shaft (the model's origin is the grip, about 0.5 m up).
  pickupRadius: 0.55,
  spawn: Object.freeze({ x: SPAWN.x - 2.0, z: SPAWN.z - 1.25 }),
  // How bright the little glowing bead on the tassel should look (the night exposure is undone), so you can find the spear in
  // the dark: a small cyan point by day, a clear one at night. Any brighter at night and the tone mapping bleaches it white.
  glow: Object.freeze({ day: 0.85, night: 0.65 }),
});

// What the fingers close on: the leather wrap in the middle of the shaft, never the point or the tassel. The hand sits near the
// balance point, so the spear is steady in one hand and the stone reaches about 0.95 m past the fist.
export const SPEAR_GRIP = Object.freeze({ meshes: ['Shaft'], axis: [0, 1, 0], point: [0, 0, 0] });

// How the spear lies in the hand. The torch and the axe stand up out of the fist; the spear is for poking, so it starts from the
// same flip (the authored +Y, up the shaft, points opposite the Quest hand socket's held-up direction) and then turns about the
// socket's X axis (the palm normal) by THRUST_TILT degrees, so the point goes out in front of the fist instead of up. With the
// forearm pitched about 30 degrees down, as it is when the controller is held ready, the shaft is level. It is the same for both
// hands (the hold lab, `item=spear&pitch=-30`, solves the grip on both with this tilt). More than about 80 degrees stops the
// fingers fitting round the shaft.
export const SPEAR_THRUST_TILT = 35;

// The throwing grip. Hold the same button that lights a torch (B on the right controller, X on the left) with the spear in your
// hand and the spear flips most of the way end for end in your fist: the point that stuck out in front for a poke now points back behind
// the hand, the way a javelin is carried cocked back, ready to be thrown forward. The flip is a turn about the palm normal, so the shaft
// stays on (nearly) the same line across the palm and the fingers close on it just the same (the hold lab solves it on both hands:
// `item=spear&pitch=-30&tilt=160`). It is 160 degrees, not the full 180, at the owner's word: he found a full half turn a bit much and
// wanted the point a touch short of dead behind. Let go of the button and it flips back to the poke. (A first try turned it only 40
// degrees and felt like nothing.) Letting go of the grip throws it (src/falling.js).
export const SPEAR_FLIP = 160; // degrees
export const SPEAR_THROW_TILT = SPEAR_THRUST_TILT + SPEAR_FLIP;
export const SPEAR_SWITCH = Object.freeze({
  rightButton: 5, // the same buttons as the torch's toggle (src/torch.js)
  leftButton: 4,
  turnSpeed: 900, // degrees per second, so the flip takes about a fifth of a second
  haptics: Object.freeze({ on: [0.35, 45], off: [0.2, 28] }),
});

const AXIS_X = new THREE.Vector3(1, 0, 0);
// The spear's rotation in the hand for a given tilt: the flip every held tool has, then the tilt about the palm normal.
export function spearHeldRotation(tilt, out = new THREE.Quaternion()) {
  return out.setFromAxisAngle(AXIS_X, Math.PI + THREE.MathUtils.degToRad(tilt));
}
export const SPEAR_HELD_ROTATION = spearHeldRotation(SPEAR_THRUST_TILT);

// Hip pose (see holsterPose in src/tools.js): where the shaft points, as [outward, up, backward] from the belt, and which
// model-Y point sits on the hip anchor. The spear is longer than you can hang straight down, so it leans back about 33
// degrees with the stone point behind the shoulder; the butt end stays about 0.3 m off the ground for a 1.7 m head height
// (it only reaches the sand when the head drops below roughly 1.4 m, in a deep crouch).
export const SPEAR_HOLSTER = Object.freeze({ dir: [0.10, 1, 0.65], along: 0.20 });

export function createSpearKind({ getExposure = () => 1 } = {}) {
  let glowMaterial = null;
  let appliedGlow = -1;
  return {
    id: 'spear',
    name: 'Stone-tipped spear',
    url: SPEAR.url,
    groundBottom: SPEAR.groundBottom,
    pickupLift: 0,
    pickupRadius: SPEAR.pickupRadius,
    heldRotation: SPEAR_HELD_ROTATION,
    holster: SPEAR_HOLSTER,
    // When let go or thrown (src/falling.js): a thin rod, heavier at the stone end, whose point sticks in the sand if it lands point-first and fast.
    fall: { radius: 0.025, landing: 'stick', com: 0.15 },
    // A blow (src/weapon-hits.js): the stone point, fast enough. Held it is a poke or a swing; thrown, the point leads.
    hit: {
      damage: 34, // health taken off a creature by a blow at full speed
      minSpeed: 1.8, // m/s of the point (relative to your body when held): slower than this does nothing
      fullSpeed: 6, // m/s: from here up it does the full damage
      radius: 0.07,
      point: (out, instance) => out.set(0, instance.kind.shape.top - 0.06, 0),
    },
    spawns: [{ x: SPEAR.spawn.x, z: SPEAR.spawn.z }],
    createState: () => ({ tilt: SPEAR_THRUST_TILT, switchDown: false }),

    // The copies share their materials, so the glow is set once on the template's.
    prepareTemplate(root) {
      root.traverse(object => { if (object.material?.name === 'Glow') glowMaterial = object.material; });
    },
    prepare({ root }) {
      setGripSurface(root, SPEAR_GRIP);
      root.traverse(object => {
        if (!object.isMesh) return;
        object.castShadow = false;
        object.receiveShadow = false;
      });
    },
    // Hold the torch button to turn the spear to the throwing grip; let go to turn it back. Nothing is allocated here.
    update(instance, dt) {
      const { heldBy, state, root } = instance;
      if (!heldBy) {
        state.tilt = SPEAR_THRUST_TILT; // dropped or holstered: the tools code sets its pose, and the next pickup starts as a poke
        state.switchDown = false;
        return;
      }
      const button = heldBy.handedness === 'left' ? SPEAR_SWITCH.leftButton : SPEAR_SWITCH.rightButton;
      const pressed = Boolean(heldBy.inputSource?.gamepad?.buttons?.[button]?.pressed);
      if (pressed !== state.switchDown) {
        const [strength, ms] = pressed ? SPEAR_SWITCH.haptics.on : SPEAR_SWITCH.haptics.off;
        pulseHaptics(heldBy, strength, ms);
        state.switchDown = pressed;
      }
      const target = pressed ? SPEAR_THROW_TILT : SPEAR_THRUST_TILT;
      if (state.tilt === target) return;
      const step = SPEAR_SWITCH.turnSpeed * dt;
      state.tilt = Math.abs(target - state.tilt) <= step ? target : state.tilt + Math.sign(target - state.tilt) * step;
      spearHeldRotation(state.tilt, root.quaternion);
      root.position.fromArray(SPEAR_GRIP.point).multiply(root.scale).applyQuaternion(root.quaternion).negate();
    },
    updateShared() {
      if (!glowMaterial) return;
      const intensity = exposureGlow(getExposure(), SPEAR.glow);
      if (Math.abs(intensity - appliedGlow) > 0.01 * intensity) {
        glowMaterial.emissiveIntensity = intensity;
        appliedGlow = intensity;
      }
    },
  };
}
