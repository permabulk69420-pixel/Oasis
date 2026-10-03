import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { terrainHeight } from './world.js';
import { attachHeldObject } from './grip-contact.js';
import { isHandAtChest } from './chest-storage.js';
import { addInventoryItem, getInventoryCount, removeInventoryItem } from './inventory.js';
import { pulseHaptics } from './haptics.js';

// Hand tools (axe, torch) as real objects that can be on the ground, in a hand, on a hip
// or packed in the backpack. Each tool type ("kind") supplies its model and behaviour;
// this module owns where every copy is and moves it between those places.

const GRIP_BUTTON = 1;
export const HIP_SIDES = Object.freeze(['left', 'right']);

// The belt follows the headset: a fixed drop below the eyes, so it also works seated or
// crouched. Body yaw trails head yaw so glancing sideways doesn't swing the belt round.
// Where a relaxed arm hangs, not the belt line: a hand at your side sits well below your waist.
const HIP_DROP = 0.80;
const HIP_SIDE = 0.20;
const HIP_FORWARD = 0.03;
const BODY_TURN_RATE = 2.4;
const HIP_GRAB_RADIUS = 0.24;
// Holster zone: a tall, forgiving ellipsoid around each hip. Wide enough to hit without
// looking, tall enough that a hand hanging at your side or lifted to your waist both count.
export const HOLSTER_RADIUS = 0.32;
export const HOLSTER_HALF_HEIGHT = 0.40;
const HOLSTER_HAPTIC = [0.32, 40];
const ZONE_ENTER_HAPTIC = [0.14, 14];
const STORE_HAPTIC = [0.34, 45];

const loader = new GLTFLoader();
const handPosition = new THREE.Vector3();
const toolPosition = new THREE.Vector3();
const anchorPosition = new THREE.Vector3();
const headPosition = new THREE.Vector3();
const headForward = new THREE.Vector3();
const headRotation = new THREE.Matrix4();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

// Is a hand position inside a hip's holster zone? Horizontal distance and height are
// judged separately, so the zone is tall and narrow rather than a ball.
export function inHolsterZone(hand, anchor) {
  return Math.hypot(hand.x - anchor.x, hand.z - anchor.z) <= HOLSTER_RADIUS
    && Math.abs(hand.y - anchor.y) <= HOLSTER_HALF_HEIGHT;
}

function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

// Lower end tilted out from the leg, then leaned forward/back. Mirrored per side.
export function holsterQuaternion(holster = {}, side = 'right') {
  const sign = side === 'left' ? -1 : 1;
  const q = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, sign * (holster.outward ?? 0.2));
  q.multiply(new THREE.Quaternion().setFromAxisAngle(X_AXIS, holster.pitch ?? 0));
  if (holster.flip) q.multiply(new THREE.Quaternion().setFromAxisAngle(X_AXIS, Math.PI));
  return q;
}

export function createTools({ scene, states, kinds, renderer = null, camera = null, onError = console.warn }) {
  if (!scene || !Array.isArray(states) || !Array.isArray(kinds)) throw new Error('Tools require the scene, VR hand states and tool kinds.');

  const kindById = new Map(kinds.map(kind => [kind.id, kind]));
  const instances = [];
  const gripDown = new Map();
  const slots = { left: null, right: null };
  const belt = {};
  for (const side of HIP_SIDES) {
    const anchor = new THREE.Group();
    anchor.name = `${side}-hip-slot`;
    scene.add(anchor);
    belt[side] = anchor;
  }
  let bodyYaw = null;

  // A soft glowing marker on each empty hip while a hand is holding a tool; it brightens
  // when that hand is in the zone, so you can see where to let go.
  const markerGeometry = new THREE.SphereGeometry(0.1, 16, 12);
  const markers = {};
  for (const side of HIP_SIDES) {
    const marker = new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({
      color: 0x7fe6f2, transparent: true, opacity: 0.25, depthTest: false, depthWrite: false, toneMapped: false,
    }));
    marker.name = `${side}-hip-marker`;
    marker.renderOrder = 25;
    marker.visible = false;
    belt[side].add(marker);
    markers[side] = marker;
  }
  const wasInZone = new Map();

  for (const kind of kinds) {
    kind.template = null;
    loader.load(kind.url, gltf => {
      const template = gltf.scene;
      template.name = `${kind.name} template`;
      template.updateMatrixWorld(true);
      kind.prepareTemplate?.(template);
      kind.template = template;
      for (const spot of kind.spawns || []) toGround(spawn(kind.id), spot.x, spot.z);
    }, undefined, error => {
      onError(`[Oasis tools] ${kind.name} model failed to load: ${error?.message || error}`);
    });
  }

  function spawn(id) {
    const kind = kindById.get(id);
    if (!kind?.template) return null;
    const root = kind.template.clone(true);
    root.name = kind.name;
    root.userData.toolKind = id;
    const instance = { kind, root, heldBy: null, slot: null, state: kind.createState?.() || {} };
    kind.prepare?.(instance);
    instances.push(instance);
    return instance;
  }

  function dispose(instance) {
    instance.kind.onDispose?.(instance);
    instance.root.removeFromParent();
    if (instance.slot) slots[instance.slot] = null;
    const index = instances.indexOf(instance);
    if (index >= 0) instances.splice(index, 1);
  }

  function toGround(instance, x, z) {
    if (!instance) return;
    scene.attach(instance.root);
    instance.root.position.set(x, terrainHeight(x, z) + (instance.kind.groundBottom || 0), z);
    instance.root.quaternion.identity();
    instance.root.scale.set(1, 1, 1);
    instance.root.updateMatrixWorld(true);
  }

  function toHip(instance, side) {
    if (!instance || slots[side]) return false;
    const holster = instance.kind.holster || {};
    belt[side].add(instance.root);
    instance.root.position.set(0, holster.lift ?? 0, 0);
    instance.root.quaternion.copy(holsterQuaternion(holster, side));
    instance.root.scale.set(1, 1, 1);
    instance.slot = side;
    slots[side] = instance;
    return true;
  }

  function grab(instance, state) {
    if (!attachHeldObject(state, instance.root, instance.kind.heldRotation)) return false;
    if (instance.slot) { slots[instance.slot] = null; instance.slot = null; }
    instance.heldBy = state;
    instance.kind.onGrab?.(instance);
    return true;
  }

  function nearestEmptyHip(state) {
    let best = null, bestDistance = Infinity;
    state.grip.updateWorldMatrix(true, false);
    handPosition.setFromMatrixPosition(state.grip.matrixWorld);
    for (const side of HIP_SIDES) {
      if (slots[side] || !belt[side].visible) continue;
      belt[side].getWorldPosition(anchorPosition);
      if (!inHolsterZone(handPosition, anchorPosition)) continue;
      const distance = handPosition.distanceTo(anchorPosition);
      if (distance < bestDistance) { best = side; bestDistance = distance; }
    }
    return best;
  }

  function updateMarkers() {
    for (const side of HIP_SIDES) markers[side].visible = false;
    for (const state of states) {
      const held = instances.find(instance => instance.heldBy === state);
      if (!held || !state.inputSource) { wasInZone.set(state, null); continue; }
      const target = nearestEmptyHip(state);
      for (const side of HIP_SIDES) {
        if (slots[side] || !belt[side].visible) continue;
        const marker = markers[side];
        const near = side === target;
        marker.visible = true;
        marker.material.opacity = near ? 0.7 : 0.25;
        marker.scale.setScalar(near ? 1.35 : 1);
      }
      if (target && wasInZone.get(state) !== target) pulseHaptics(state, ...ZONE_ENTER_HAPTIC);
      wasInZone.set(state, target);
    }
  }

  function release(instance) {
    const state = instance.heldBy;
    instance.heldBy = null;
    instance.kind.onRelease?.(instance);
    // A disconnected controller always drops, so nothing is stored or holstered by accident.
    const side = state?.inputSource ? nearestEmptyHip(state) : null;
    if (side) {
      toHip(instance, side);
      pulseHaptics(state, ...HOLSTER_HAPTIC);
      return 'hip';
    }
    if (state?.inputSource && isHandAtChest(renderer, state)) {
      addInventoryItem(instance.kind.id, 1);
      dispose(instance);
      pulseHaptics(state, ...STORE_HAPTIC);
      return 'stored';
    }
    instance.root.updateWorldMatrix(true, false);
    instance.root.getWorldPosition(toolPosition);
    toGround(instance, toolPosition.x, toolPosition.z);
    return 'ground';
  }

  function findNearest(state) {
    state.objectGrip.updateWorldMatrix(true, false);
    state.objectGrip.getWorldPosition(handPosition);
    let best = null, bestDistance = Infinity;
    for (const instance of instances) {
      if (instance.heldBy) continue;
      const onHip = Boolean(instance.slot);
      if (onHip && !belt[instance.slot].visible) continue;
      instance.root.updateWorldMatrix(true, false);
      instance.root.getWorldPosition(toolPosition);
      if (!onHip) toolPosition.y += instance.kind.pickupLift || 0;
      const radius = onHip ? HIP_GRAB_RADIUS : instance.kind.pickupRadius || 0.5;
      const distance = handPosition.distanceTo(toolPosition);
      if (distance <= radius && distance < bestDistance) { best = instance; bestDistance = distance; }
    }
    return best;
  }

  function updateBelt(dt) {
    const presenting = Boolean(renderer?.xr?.isPresenting);
    const view = presenting ? renderer.xr.getCamera() : camera;
    // No body on desktop, so nothing floats under the camera there.
    for (const side of HIP_SIDES) belt[side].visible = presenting;
    if (!view) return;
    // WebXR prepares the XR camera's world matrix; do not recompute it (see chest-storage.js).
    if (!presenting) view.updateWorldMatrix(true, false);
    headPosition.setFromMatrixPosition(view.matrixWorld);
    headRotation.extractRotation(view.matrixWorld);
    headForward.set(0, 0, -1).applyMatrix4(headRotation);
    if (Math.hypot(headForward.x, headForward.z) > 0.15) {
      const headYaw = Math.atan2(-headForward.x, -headForward.z);
      if (bodyYaw === null || !(dt > 0)) bodyYaw = headYaw;
      else bodyYaw += wrapAngle(headYaw - bodyYaw) * (1 - Math.exp(-dt * BODY_TURN_RATE));
    }
    if (bodyYaw === null) return;
    const fx = -Math.sin(bodyYaw), fz = -Math.cos(bodyYaw);
    const rx = Math.cos(bodyYaw), rz = -Math.sin(bodyYaw);
    for (const side of HIP_SIDES) {
      const sign = side === 'left' ? -1 : 1;
      belt[side].position.set(
        headPosition.x + rx * HIP_SIDE * sign + fx * HIP_FORWARD,
        headPosition.y - HIP_DROP,
        headPosition.z + rz * HIP_SIDE * sign + fz * HIP_FORWARD,
      );
      belt[side].rotation.set(0, bodyYaw, 0);
      belt[side].updateMatrixWorld(true);
    }
  }

  function update(dt = 0) {
    const safeDt = THREE.MathUtils.clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
    updateBelt(safeDt);

    for (const state of states) {
      const grip = Boolean(state.inputSource?.gamepad?.buttons?.[GRIP_BUTTON]?.pressed);
      const wasDown = Boolean(gripDown.get(state));
      const held = instances.find(instance => instance.heldBy === state);
      if (held && (!state.inputSource || !grip)) release(held);
      else if (!held && grip && !wasDown && state.objectGrip && state.objectGrip.children.length === 0) {
        const instance = findNearest(state);
        if (instance) grab(instance, state);
      }
      gripDown.set(state, grip);
    }

    updateMarkers();

    for (const kind of kinds) kind.updateShared?.(safeDt, instances.filter(instance => instance.kind === kind));
    for (const instance of instances) instance.kind.update?.(instance, safeDt, { states });
  }

  // Menu actions: move a tool between the backpack and a hip.
  function equip(id, side) {
    if (!HIP_SIDES.includes(side) || !kindById.get(id)?.template) return false;
    if (getInventoryCount(id) < 1) return false;
    if (slots[side]) unequip(side);
    if (!removeInventoryItem(id, 1)) return false;
    const instance = spawn(id);
    if (!instance) { addInventoryItem(id, 1); return false; }
    toHip(instance, side);
    return true;
  }

  function unequip(side) {
    const instance = slots[side];
    if (!instance) return false;
    addInventoryItem(instance.kind.id, 1);
    dispose(instance);
    return true;
  }

  return {
    update,
    equip,
    unequip,
    getHipSlots: () => ({ left: slots.left?.kind.id ?? null, right: slots.right?.kind.id ?? null }),
    canEquip: id => Boolean(kindById.get(id)),
    getInstances: kind => instances.filter(instance => !kind || instance.kind.id === kind),
    isHolding: handedness => instances.some(instance => instance.heldBy?.handedness === handedness),
    belt,
    markers,
  };
}
