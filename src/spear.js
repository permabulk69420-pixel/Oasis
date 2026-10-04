import * as THREE from 'three';
import { SPAWN } from './world.js';
import { setGripSurface } from './grip-contact.js';
import { exposureGlow } from './glow.js';

// The spear: a hand tool like the axe and the torch, and no more than that (it does not hurt or hunt anything). It stands
// planted in the sand by the other starting tools, can be crafted, gripped by the leather wrap, carried on a hip and packed
// away at the chest. The model is public/models/spear/spear.glb (tools/spear/build_spear.py); +Y runs up the shaft to the stone
// point, the butt end is 0.52 m below the origin and the leather grip is down at the butt end, centred 0.39 m below the origin.

const SPEAR_URL = `${import.meta.env?.BASE_URL ?? '/'}models/spear/spear.glb`;

export const SPEAR = Object.freeze({
  url: SPEAR_URL,
  // Planted upright in the sand by the starting tools: the butt end goes in a few centimetres.
  groundBottom: 0.48,
  // Reach for it anywhere along the middle of the shaft (the model's origin is a point on the shaft about 0.5 m up).
  pickupRadius: 0.55,
  spawn: Object.freeze({ x: SPAWN.x - 2.0, z: SPAWN.z - 1.25 }),
  // How bright the little glowing bead on the tassel should look (the night exposure is undone), so you can find the spear in
  // the dark: a small cyan point by day, a clear one at night. Any brighter at night and the tone mapping bleaches it white.
  glow: Object.freeze({ day: 0.85, night: 0.65 }),
});

// What the fingers close on: the leather wrap at the butt end of the shaft, never the point or the tassel. Holding it this far back
// is the point of it: the stone reaches 1.3 m past the fist, so the spear pokes as far away as it can. The fist keeps a few
// centimetres of charred butt behind it.
export const SPEAR_GRIP = Object.freeze({ meshes: ['Shaft'], axis: [0, 1, 0], point: [0, -0.39, 0], halfLength: 0.1 });

// How the spear lies in the hand. The torch and the axe stand up out of the fist; the spear is for poking, so it starts from the
// same flip (the authored +Y, up the shaft, points opposite the Quest hand socket's held-up direction) and then turns about the
// socket's X axis (the palm normal) by THRUST_TILT degrees, so the point goes out in front of the fist instead of up. With the
// forearm pitched about 30 degrees down, as it is when the controller is held ready, the shaft is level. It is the same for both
// hands (the hold lab, `item=spear&pitch=-30`, solves the grip on both with this tilt). More than about 80 degrees stops the
// fingers fitting round the shaft.
export const SPEAR_THRUST_TILT = 35;
export const SPEAR_HELD_ROTATION = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI + THREE.MathUtils.degToRad(SPEAR_THRUST_TILT));

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
    spawns: [{ x: SPEAR.spawn.x, z: SPEAR.spawn.z }],

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
