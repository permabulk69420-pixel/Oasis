import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SPAWN } from './world.js';
import { attachHeldObject, setGripSurface } from './grip-contact.js';
import { pulseHaptics } from './haptics.js';
import { canTakeOffPack, isPackWorn, setPackWorn } from './inventory.js';
import { exposureGlow } from './glow.js';

// The backpack: one physical pack. It lies on the sand near where you start. Grab it by its handle, reach behind your
// shoulder and let go there, and you are wearing it: it vanishes from your hand and the menu inventory grows (see
// src/inventory.js for how much). Reach back with an empty hand and grip to take it off again, or use Take off in the
// menu, which sets it down in front of you. All the numbers to tune are in PACK.

const GRIP_BUTTON = 1;

export const PACK = Object.freeze({
  url: `${import.meta.env?.BASE_URL ?? '/'}models/backpack/backpack.glb`,
  // Where it lies at the start: upright, facing the way you set off, a little to the right of the axe and torch.
  spawn: Object.freeze({ x: SPAWN.x + 2.0, z: SPAWN.z - 1.35, yaw: 0 }),
  // How near a hand has to be to the top of the pack to grab it. The pack stands 0.55 m tall, so a hand at hip height
  // reaches it without bending down.
  grabRadius: 0.50,
  // The base sinks a little into the sand, so it does not hover on a slope.
  settle: 0.02,
  footprint: Object.freeze({ halfWidth: 0.17, halfDepth: 0.11 }),
  // The back zone: a tall cylinder behind the shoulders, measured from the body (the point under the head that the belt
  // hangs from). Tall and forgiving, so a hand reaching over the shoulder or round the small of the back both count, but
  // it stops short of the chest, where other things are packed away.
  back: Object.freeze({ behind: 0.22, below: 0.34, radius: 0.28, halfHeight: 0.38 }),
  // "Take off" in the menu sets the pack on the ground this far in front of you.
  dropAhead: 0.75,
  // How bright the glowing trim should look (displayed brightness, so the night exposure is undone): faint by day,
  // a soft cyan beacon at night.
  glow: Object.freeze({ day: 0.85, night: 0.75 }),
  // [strength, milliseconds]. Behind your head there is nothing to see, so the tick when the hand reaches the back zone
  // is the only sign of where to let go: it has to be one you can feel on a Quest (0.14 for 14 ms was about at the
  // edge of what the actuator shows), and the pulse that confirms you are wearing it is firmer still.
  haptics: Object.freeze({ grab: [0.18, 28], enter: [0.4, 35], wear: [0.6, 60], refuse: [0.45, 70] }),
});

// What the fingers close on: just the top of the carry handle, a flat leather strap. (The whole arch would put the
// fingers on the outside of its hollow.) The handle bar is the pack's X axis.
export const PACK_GRIP = Object.freeze({ meshes: ['CarryHandle'], axis: [1, 0, 0], point: [0, 0.549, -0.010], halfLength: 0.04 });

// How the pack sits in the hand. The fingers wrap a bar along the grip socket's Y axis, so the handle bar (pack X) goes
// there; the pack's top (Y) goes along the socket's +Z, which is up the forearm, so when the arm hangs the pack hangs
// from the handle with its front facing out. The left hand is the mirror image of the right.
function heldRotation(side) {
  const x = new THREE.Vector3(0, side === 'left' ? 1 : -1, 0);
  const y = new THREE.Vector3(0, 0, 1);
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
export const PACK_HELD_ROTATION = { left: heldRotation('left'), right: heldRotation('right') };

// The centre of the back zone in the rig's space, from where the body is and which way it faces.
export function backZoneCentre(frame, out = new THREE.Vector3(), back = PACK.back) {
  const forwardX = -Math.sin(frame.yaw);
  const forwardZ = -Math.cos(frame.yaw);
  return out.set(frame.center.x - forwardX * back.behind, frame.center.y - back.below, frame.center.z - forwardZ * back.behind);
}

// Is a hand (world position) in the back zone (world position of its centre)?
export function inBackZone(hand, centre, back = PACK.back) {
  const dx = hand.x - centre.x;
  const dz = hand.z - centre.z;
  return dx * dx + dz * dz <= back.radius * back.radius && Math.abs(hand.y - centre.y) <= back.halfHeight;
}

// The brightness (emissiveIntensity) for the glowing trim so that it looks the same by day and night whatever the
// tone-mapping exposure is: bright enough to show by day, a soft beacon at night.
export function glowIntensity(exposure) {
  return exposureGlow(exposure, PACK.glow);
}

// Height for the pack's base at (x, z) facing yaw: the highest ground under its footprint, less a little sink.
export function packGroundHeight(heightAt, x, z, yaw, { halfWidth, halfDepth } = PACK.footprint, settle = PACK.settle) {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  let top = heightAt(x, z);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const lx = sx * halfWidth;
    const lz = sz * halfDepth;
    top = Math.max(top, heightAt(x + lx * cos + lz * sin, z - lx * sin + lz * cos));
  }
  return top - settle;
}

export function createBackpack({
  scene, states, renderer = null, camera = null, rig = null, tools = null,
  heightAt = () => 0, getExposure = () => 1, onError = console.warn,
}) {
  if (!scene || !Array.isArray(states)) throw new Error('The backpack needs the scene and the VR hand states.');

  let pack = null;
  let glow = null;
  let status = 'ground'; // 'ground', 'held' or 'worn'
  let heldBy = null;
  let yaw = PACK.spawn.yaw;
  let appliedGlow = -1;
  const gripDown = new Map();
  const inZone = new Map();
  // The back zone follows the body the same way the hip slots do.
  const backAnchor = new THREE.Group();
  backAnchor.name = 'back-slot';
  (rig || scene).add(backAnchor);
  const body = { center: new THREE.Vector3(), yaw: 0 };
  const zoneCentre = new THREE.Vector3();
  let zoneReady = false;
  const handPosition = new THREE.Vector3();
  const packPosition = new THREE.Vector3();
  const headPosition = new THREE.Vector3();
  const headForward = new THREE.Vector3();
  const pulse = (state, [strength, ms]) => pulseHaptics(state, strength, ms);

  const loader = new GLTFLoader();
  loader.load(PACK.url, gltf => {
    pack = gltf.scene;
    pack.name = 'Backpack';
    pack.userData.backpack = true;
    pack.userData.gripProfile = 'medium';
    setGripSurface(pack, PACK_GRIP);
    pack.traverse(object => {
      if (!object.isMesh) return;
      object.castShadow = false;
      object.receiveShadow = false;
      if (object.material?.name === 'Glow') glow = object.material;
    });
    if (status === 'ground') toGround(PACK.spawn.x, PACK.spawn.z, PACK.spawn.yaw);
    else if (status === 'worn') pack.removeFromParent();
  }, undefined, error => {
    onError(`[Oasis backpack] The backpack model failed to load: ${error?.message || error}`);
  });

  function toGround(x, z, facing) {
    if (!pack) return;
    yaw = facing;
    scene.add(pack);
    pack.position.set(x, packGroundHeight(heightAt, x, z, yaw), z);
    pack.rotation.set(0, yaw, 0);
    pack.scale.set(1, 1, 1);
    pack.visible = true;
    pack.updateMatrixWorld(true);
    status = 'ground';
    heldBy = null;
  }

  function headWorld() {
    const view = renderer?.xr?.isPresenting ? renderer.xr.getCamera() : camera;
    if (!view) return false;
    view.updateWorldMatrix(true, false);
    headPosition.setFromMatrixPosition(view.matrixWorld);
    return true;
  }

  // Facing the player, so the front (the flap, the bedroll and the glow) is what they see.
  function facingHead(x, z) {
    if (!headWorld()) return yaw;
    const dx = headPosition.x - x;
    const dz = headPosition.z - z;
    return dx * dx + dz * dz > 1e-4 ? Math.atan2(dx, dz) : yaw;
  }

  function handWorld(state) {
    state.grip.updateWorldMatrix(true, false);
    return handPosition.setFromMatrixPosition(state.grip.matrixWorld);
  }

  function handInBackZone(state) {
    return zoneReady && inBackZone(handWorld(state), zoneCentre);
  }

  function nearHandle(state) {
    state.objectGrip.updateWorldMatrix(true, false);
    state.objectGrip.getWorldPosition(handPosition);
    pack.updateWorldMatrix(true, false);
    packPosition.set(0, PACK_GRIP.point[1], 0).applyMatrix4(pack.matrixWorld);
    return handPosition.distanceToSquared(packPosition) <= PACK.grabRadius * PACK.grabRadius;
  }

  function holdIn(state) {
    const side = state.handedness === 'left' ? 'left' : 'right';
    if (!attachHeldObject(state, pack, PACK_HELD_ROTATION[side])) return false;
    pack.visible = true;
    status = 'held';
    heldBy = state;
    inZone.set(state, false);
    return true;
  }

  function grab(state) {
    if (!holdIn(state)) return false;
    pulse(state, PACK.haptics.grab);
    return true;
  }

  function wear(state) {
    pack.removeFromParent();
    status = 'worn';
    heldBy = null;
    setPackWorn(true);
    if (state) pulse(state, PACK.haptics.wear);
  }

  function drop(state) {
    pack.updateWorldMatrix(true, false);
    pack.getWorldPosition(packPosition);
    const x = packPosition.x;
    const z = packPosition.z;
    toGround(x, z, facingHead(x, z));
    inZone.set(state, false);
  }

  function release(state) {
    // A controller that has gone away always drops, so the pack is never put on by accident.
    if (state.inputSource && handInBackZone(state)) wear(state);
    else drop(state);
  }

  // Reach back with an empty hand and grip: take the pack off into that hand.
  function takeOffToHand(state) {
    if (!canTakeOffPack()) {
      pulse(state, PACK.haptics.refuse);
      return false;
    }
    setPackWorn(false);
    if (!holdIn(state)) {
      setPackWorn(true);
      return false;
    }
    pulse(state, PACK.haptics.grab);
    return true;
  }

  // The menu's Take off: set it down just in front of you.
  function takeOff() {
    if (status !== 'worn' || !pack) return { ok: false, message: 'You aren’t wearing a backpack.' };
    if (!canTakeOffPack()) return { ok: false, message: 'Your pockets can’t hold everything you carry, so the backpack has to stay on.' };
    if (!headWorld()) return { ok: false, message: 'Nowhere to put it down.' };
    const view = renderer?.xr?.isPresenting ? renderer.xr.getCamera() : camera;
    view.getWorldDirection(headForward);
    headForward.y = 0;
    if (headForward.lengthSq() < 0.01) headForward.set(0, 0, -1);
    headForward.normalize();
    const x = headPosition.x + headForward.x * PACK.dropAhead;
    const z = headPosition.z + headForward.z * PACK.dropAhead;
    setPackWorn(false);
    toGround(x, z, facingHead(x, z));
    return { ok: true, message: 'Backpack set down in front of you.' };
  }

  function updateBackZone() {
    zoneReady = Boolean(tools?.getBodyFrame?.(body));
    if (!zoneReady) return;
    backZoneCentre(body, backAnchor.position);
    backAnchor.rotation.y = body.yaw;
    backAnchor.updateWorldMatrix(true, false);
    backAnchor.getWorldPosition(zoneCentre);
  }

  function updateGlow() {
    if (!glow) return;
    const intensity = glowIntensity(getExposure());
    if (Math.abs(intensity - appliedGlow) > 0.01 * intensity) {
      glow.emissiveIntensity = intensity;
      appliedGlow = intensity;
    }
  }

  function update() {
    if (!pack) return;
    updateGlow();
    updateBackZone();
    for (const state of states) {
      const squeeze = Boolean(state.inputSource?.gamepad?.buttons?.[GRIP_BUTTON]?.pressed);
      const wasDown = gripDown.get(state) === true;
      if (status === 'held' && heldBy === state) {
        if (!state.inputSource || !squeeze) release(state);
        else {
          // a small tick as the hand reaches the back zone, so you can feel where to let go
          const inside = handInBackZone(state);
          if (inside && inZone.get(state) !== true) pulse(state, PACK.haptics.enter);
          inZone.set(state, inside);
        }
      } else if (squeeze && !wasDown && state.inputSource && state.objectGrip.children.length === 0) {
        if (status === 'ground' && nearHandle(state)) grab(state);
        else if (status === 'worn' && handInBackZone(state)) takeOffToHand(state);
      }
      gripDown.set(state, squeeze);
    }
  }

  return {
    update,
    takeOff,
    isWorn: () => status === 'worn',
    canTakeOff: () => status === 'worn' && canTakeOffPack(),
    getStatus: () => status,
    get ready() { return Boolean(pack); },
    list: () => {
      if (!pack || status === 'worn') return { status, worn: isPackWorn() };
      pack.getWorldPosition(packPosition);
      return { status, worn: isPackWorn(), x: +packPosition.x.toFixed(2), y: +packPosition.y.toFixed(2), z: +packPosition.z.toFixed(2) };
    },
    // Development fixtures and the tests.
    debug: {
      wear: () => { if (pack && status !== 'worn') wear(null); else if (!pack) { status = 'worn'; setPackWorn(true); } },
      ground: (x, z, facing = 0) => { if (status === 'worn') setPackWorn(false); toGround(x, z, facing); },
      getObject: () => pack,
      getZoneCentre: out => (zoneReady ? out.copy(zoneCentre) : null),
    },
  };
}
