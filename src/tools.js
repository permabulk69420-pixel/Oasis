import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { terrainHeight } from './world.js';
import { attachHeldObject } from './grip-contact.js';
import { isHandAtChest } from './chest-storage.js';
import { addInventoryItem, getInventoryCount, removeInventoryItem } from './inventory.js';
import { pulseHaptics } from './haptics.js';
import { createBody, launch, stepBody, bodyOrigin, isMoving, placeAtRest } from './falling.js';
import { createHandMotion } from './hand-motion.js';
import { skyLight } from './sky-environment.js';

// How close a hand must be to any part of a tool lying on the ground (or stuck in it) to pick it up.
const LYING_REACH = 0.3;

// Hand tools (axe, torch) as real objects that can be on the ground, in a hand, on a hip
// or packed in the inventory. Each tool type ("kind") supplies its model and behaviour;
// this module owns where every copy is and moves it between those places.

const GRIP_BUTTON = 1;
export const HIP_SIDES = Object.freeze(['left', 'right']);

// The belt follows the headset's position (a fixed drop below the eyes, so it also works
// seated or crouched) but never its facing.
// Where a relaxed arm hangs, not the belt line: a hand at your side sits well below your waist.
const HIP_DROP = 0.80;
const HIP_SIDE = 0.26;
// The body faces wherever the head looked when you start walking, so you can turn on the
// spot and then push the stick; looking around while standing never moves the hips.
const WALK_START = 0.35;
const FACE_TURN_MIN = 0.80; // ~45 degrees: smaller differences are ignored, so it rarely fires
const FACE_TURN_RATE = 4;
const BODY_DEADZONE = 0.22;
const BODY_DEADZONE_Y = 0.10;
const BODY_SETTLE_RATE = 0.3;
const HIP_FORWARD = -0.10;
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
const inverseParent = new THREE.Matrix4();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, -1);

function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

// Is a hand position inside a hip's holster zone? Horizontal distance and height are
// judged separately, so the zone is tall and narrow rather than a ball.
export function inHolsterZone(hand, anchor) {
  return Math.hypot(hand.x - anchor.x, hand.z - anchor.z) <= HOLSTER_RADIUS
    && Math.abs(hand.y - anchor.y) <= HOLSTER_HALF_HEIGHT;
}

// Hip pose, described by what you see rather than by Euler angles:
//   dir   where the tool's long axis (model +Y) points, in the belt frame as
//         [outward, up, backward] (outward is away from the body, mirrored per side)
//   edge  optional model-space direction (a blade) to roll the tool so it faces forward
//   along the model-Y point that sits on the hip anchor, so long tools hang from a sensible spot
export function holsterPose(holster = {}, side = 'right') {
  const sign = side === 'left' ? -1 : 1;
  const [out, up, back] = holster.dir || [0, 1, 0];
  const axis = new THREE.Vector3(sign * out, up, back).normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, axis);
  if (holster.edge) {
    const edge = new THREE.Vector3().fromArray(holster.edge).normalize().applyQuaternion(quaternion);
    const forward = FORWARD.clone().addScaledVector(axis, -FORWARD.dot(axis));
    if (forward.lengthSq() > 1e-6) {
      forward.normalize();
      const roll = Math.atan2(forward.dot(new THREE.Vector3().crossVectors(axis, edge)), forward.dot(edge));
      quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, roll));
    }
  }
  const position = new THREE.Vector3(0, holster.along ?? 0, 0).applyQuaternion(quaternion).negate();
  return { position, quaternion };
}

// `copyStart` ({ from: {x, z}, to: {x, z} }) stands a second set of the starting tools at another start point: each kind's `spawns` moved
// from `from` to `to` (the owner, 5 Oct: an extra copy of his tools on the floating island). The first set stays where it is.
export function createTools({ scene, states, kinds, renderer = null, camera = null, rig = null, heightAt = terrainHeight, copyStart = null, onError = console.warn }) {
  if (!scene || !Array.isArray(states) || !Array.isArray(kinds)) throw new Error('Tools require the scene, VR hand states and tool kinds.');

  const kindById = new Map(kinds.map(kind => [kind.id, kind]));
  const instances = [];
  // Tools that have been let go of or thrown and are still in the air or toppling (src/falling.js). Once one is lying still it
  // costs nothing and is only found again by findNearest, which then reaches along the whole tool, not just its origin.
  const falling = [];
  const handMotion = createHandMotion();
  const fallOrigin = new THREE.Vector3();
  const fallQuaternion = new THREE.Quaternion();
  const fallVelocity = new THREE.Vector3();
  const fallSpin = new THREE.Vector3();
  const segmentA = new THREE.Vector3();
  const segmentB = new THREE.Vector3();
  const segmentPoint = new THREE.Vector3();
  const segmentAlong = new THREE.Vector3();
  const gripDown = new Map();
  const slots = { left: null, right: null };
  const belt = {};
  for (const side of HIP_SIDES) {
    const anchor = new THREE.Group();
    anchor.name = `${side}-hip-slot`;
    (rig || scene).add(anchor);
    belt[side] = anchor;
  }
  let bodyYaw = 0;
  let bodyYawTarget = null;
  let wasWalking = false;
  let bodyCenter = null;
  let beforeInput = null;

  // Empty hips get a small soft dot while a hand holds a tool. When that hand is in the
  // zone a faint ghost of the held tool shows exactly how it will sit on the hip.
  const dotTexture = typeof document === 'undefined' ? null : (() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.35)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
  })();
  const ghostMaterial = new THREE.MeshBasicMaterial({
    color: 0xbfeff5, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false,
  });
  const markers = {};
  const ghosts = {};
  for (const side of HIP_SIDES) {
    const marker = new THREE.Sprite(new THREE.SpriteMaterial({
      map: dotTexture, color: 0xdff8fb, transparent: true, opacity: 0.2, depthTest: false, depthWrite: false, toneMapped: false,
    }));
    marker.scale.setScalar(0.09);
    marker.name = `${side}-hip-marker`;
    marker.renderOrder = 25;
    marker.visible = false;
    belt[side].add(marker);
    markers[side] = marker;
    ghosts[side] = { kind: null, object: null };
  }
  const wasInZone = new Map();

  for (const kind of kinds) {
    kind.template = null;
    loader.load(kind.url, gltf => {
      const template = gltf.scene;
      skyLight(template); // the sky's light on its wood, stone and metal (src/sky-environment.js)
      template.name = `${kind.name} template`;
      template.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(template);
      kind.shape = { bottom: box.min.y, top: box.max.y };
      kind.prepareTemplate?.(template);
      kind.template = template;
      const spots = [...(kind.spawns || [])];
      if (copyStart) for (const spot of kind.spawns || []) spots.push({ x: copyStart.to.x + (spot.x - copyStart.from.x), z: copyStart.to.z + (spot.z - copyStart.from.z) });
      for (const spot of spots) {
        const instance = spawn(kind.id);
        if (instance) instance.defaultSpawn = true; // standing where the game puts it at the start; a saved game replaces these
        toGround(instance, spot.x, spot.z);
      }
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
    const fallingIndex = falling.indexOf(instance);
    if (fallingIndex >= 0) falling.splice(fallingIndex, 1);
    instance.fall = null;
    instance.root.removeFromParent();
    if (instance.slot) slots[instance.slot] = null;
    const index = instances.indexOf(instance);
    if (index >= 0) instances.splice(index, 1);
  }

  function toGround(instance, x, z) {
    if (!instance) return;
    scene.attach(instance.root);
    instance.root.position.set(x, heightAt(x, z) + (instance.kind.groundBottom || 0), z);
    instance.root.quaternion.identity();
    instance.root.scale.set(1, 1, 1);
    instance.root.updateMatrixWorld(true);
  }

  function toHip(instance, side) {
    if (!instance || slots[side]) return false;
    const pose = holsterPose(instance.kind.holster, side);
    belt[side].add(instance.root);
    instance.root.position.copy(pose.position);
    instance.root.quaternion.copy(pose.quaternion);
    instance.root.scale.set(1, 1, 1);
    instance.slot = side;
    slots[side] = instance;
    return true;
  }

  function grab(instance, state) {
    if (!attachHeldObject(state, instance.root, instance.kind.heldRotation)) return false;
    if (instance.slot) { slots[instance.slot] = null; instance.slot = null; }
    const fallingIndex = falling.indexOf(instance);
    if (fallingIndex >= 0) falling.splice(fallingIndex, 1);
    instance.fall = null;
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

  function showGhost(side, kind) {
    for (const other of HIP_SIDES) {
      const ghost = ghosts[other];
      if (other !== side || !kind?.template) { if (ghost.object) ghost.object.visible = false; continue; }
      if (ghost.kind !== kind) {
        ghost.object?.removeFromParent();
        const object = kind.template.clone(true);
        object.traverse(node => {
          if (node.isMesh) { node.material = ghostMaterial; node.castShadow = false; node.receiveShadow = false; node.renderOrder = 24; }
          if (node.isLight || node.isPositionalAudio) node.visible = false;
        });
        const pose = holsterPose(kind.holster, other);
        object.position.copy(pose.position);
        object.quaternion.copy(pose.quaternion);
        belt[other].add(object);
        ghost.kind = kind;
        ghost.object = object;
      }
      ghost.object.visible = true;
    }
  }

  function updateMarkers() {
    for (const side of HIP_SIDES) markers[side].visible = false;
    if (!states.some(state => instances.some(instance => instance.heldBy === state))) showGhost(null, null);
    for (const state of states) {
      const held = instances.find(instance => instance.heldBy === state);
      if (!held || !state.inputSource) { wasInZone.set(state, null); continue; }
      const target = nearestEmptyHip(state);
      for (const side of HIP_SIDES) {
        if (slots[side] || !belt[side].visible) continue;
        const marker = markers[side];
        const near = side === target;
        marker.visible = true;
        marker.material.opacity = near ? 0.7 : 0.2;
        marker.scale.setScalar(near ? 0.13 : 0.09);
      }
      showGhost(target, held.kind);
      if (target && wasInZone.get(state) !== target) pulseHaptics(state, ...ZONE_ENTER_HAPTIC);
      wasInZone.set(state, target);
    }
  }

  // Let go of a tool in the open: it falls from where it is with the speed and turn of the hand, and lands (src/falling.js).
  function startFall(instance, state) {
    const { kind, root } = instance;
    root.updateWorldMatrix(true, false);
    root.getWorldPosition(fallOrigin);
    root.getWorldQuaternion(fallQuaternion);
    if (!kind.fall || !kind.shape) {
      toGround(instance, fallOrigin.x, fallOrigin.z);
      return;
    }
    handMotion.measure(state, fallVelocity, fallSpin);
    scene.attach(root);
    root.scale.set(1, 1, 1);
    const body = createBody({ ...kind.shape, ...kind.fall });
    launch(body, { origin: fallOrigin, quaternion: fallQuaternion, velocity: fallVelocity, spin: fallSpin });
    instance.fall = body;
    falling.push(instance);
  }

  // Throw a new tool out into the world from a pose (used by the dev fixture ?view=throws, and for anything that should drop a tool).
  // Returns the tool, or null while its model is still loading.
  function throwTool(id, { origin, quaternion, velocity, spin }) {
    const instance = spawn(id);
    if (!instance || !instance.kind.fall || !instance.kind.shape) return null;
    scene.add(instance.root);
    const body = createBody({ ...instance.kind.shape, ...instance.kind.fall });
    launch(body, { origin, quaternion, velocity, spin });
    instance.fall = body;
    falling.push(instance);
    return instance;
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
    startFall(instance, state);
    return 'ground';
  }

  const kindShape = instance => instance.kind.shape;
  function distanceToSegment(point, a, b) {
    segmentAlong.copy(b).sub(a);
    const length2 = segmentAlong.lengthSq();
    segmentPoint.copy(point).sub(a);
    const t = length2 > 1e-9 ? THREE.MathUtils.clamp(segmentPoint.dot(segmentAlong) / length2, 0, 1) : 0;
    segmentPoint.copy(a).addScaledVector(segmentAlong, t);
    return point.distanceTo(segmentPoint);
  }

  function findNearest(state) {
    state.objectGrip.updateWorldMatrix(true, false);
    state.objectGrip.getWorldPosition(handPosition);
    let best = null, bestDistance = Infinity;
    for (const instance of instances) {
      if (instance.heldBy) continue;
      if (instance.fall) {
        // Lying on the ground or stuck in the sand: reach for any part of it, not just its middle.
        if (isMoving(instance.fall)) continue;
        instance.root.updateWorldMatrix(true, false);
        segmentA.set(0, kindShape(instance).bottom, 0).applyMatrix4(instance.root.matrixWorld);
        segmentB.set(0, kindShape(instance).top, 0).applyMatrix4(instance.root.matrixWorld);
        const distance = distanceToSegment(handPosition, segmentA, segmentB);
        if (distance <= LYING_REACH && distance < bestDistance) { best = instance; bestDistance = distance; }
        continue;
      }
      const onHip = Boolean(instance.slot);
      if (onHip && !belt[instance.slot].visible) continue;
      if (onHip) belt[instance.slot].getWorldPosition(toolPosition);
      else {
        instance.root.updateWorldMatrix(true, false);
        instance.root.getWorldPosition(toolPosition);
      }
      if (!onHip) toolPosition.y += instance.kind.pickupLift || 0;
      const radius = onHip ? HIP_GRAB_RADIUS : instance.kind.pickupRadius || 0.5;
      const distance = handPosition.distanceTo(toolPosition);
      if (distance <= radius && distance < bestDistance) { best = instance; bestDistance = distance; }
    }
    return best;
  }

  function isWalking() {
    for (const state of states) {
      if (state.handedness !== 'left') continue;
      const axes = state.inputSource?.gamepad?.axes || [];
      if (axes.length < 2) continue;
      const index = axes.length >= 4 ? axes.length - 2 : 0;
      if (Math.hypot(axes[index] || 0, axes[index + 1] || 0) > WALK_START) return true;
    }
    return false;
  }

  function updateBelt(dt) {
    const presenting = Boolean(renderer?.xr?.isPresenting);
    const view = presenting ? renderer.xr.getCamera() : camera;
    // No body on desktop, so nothing floats under the camera there.
    for (const side of HIP_SIDES) belt[side].visible = presenting;
    if (!presenting) { bodyCenter = null; bodyYawTarget = null; }
    if (!view) return;
    // WebXR prepares the XR camera's world matrix; do not recompute it (see chest-storage.js).
    if (!presenting) view.updateWorldMatrix(true, false);
    headPosition.setFromMatrixPosition(view.matrixWorld);
    // Work in the rig's space, so the belt rides along with walking and stick-turning.
    const parent = belt.left.parent;
    parent.updateWorldMatrix(true, false);
    inverseParent.copy(parent.matrixWorld).invert();
    headPosition.applyMatrix4(inverseParent);
    headRotation.extractRotation(view.matrixWorld);
    headForward.set(0, 0, -1).applyMatrix4(headRotation).transformDirection(inverseParent);
    // The belt never turns with the head: it keeps the rig's facing and only follows where
    // the head is. Stick-turning the rig carries it round.
    const walking = isWalking();
    if (bodyYawTarget === null || !(dt > 0)) {
      bodyYaw = bodyYawTarget = 0;
      if (Math.hypot(headForward.x, headForward.z) > 0.15) bodyYaw = bodyYawTarget = Math.atan2(-headForward.x, -headForward.z);
    } else {
      if (walking && !wasWalking && Math.hypot(headForward.x, headForward.z) > 0.15) {
        const headYaw = Math.atan2(-headForward.x, -headForward.z);
        if (Math.abs(wrapAngle(headYaw - bodyYawTarget)) > FACE_TURN_MIN) bodyYawTarget = headYaw;
      }
      bodyYaw += wrapAngle(bodyYawTarget - bodyYaw) * (1 - Math.exp(-dt * FACE_TURN_RATE));
    }
    wasWalking = walking;
    // The body only moves when the head really travels: turning or tilting your head swings
    // the headset a few centimetres, and leaning a little shouldn't drag the hips with it.
    if (!bodyCenter || !(dt > 0)) bodyCenter = (bodyCenter || new THREE.Vector3()).copy(headPosition);
    else {
      const dx = headPosition.x - bodyCenter.x, dz = headPosition.z - bodyCenter.z;
      const distance = Math.hypot(dx, dz);
      if (distance > BODY_DEADZONE) {
        const pull = (distance - BODY_DEADZONE) / distance;
        bodyCenter.x += dx * pull;
        bodyCenter.z += dz * pull;
      }
      const dy = headPosition.y - bodyCenter.y;
      if (Math.abs(dy) > BODY_DEADZONE_Y) bodyCenter.y += dy - Math.sign(dy) * BODY_DEADZONE_Y;
      const settle = 1 - Math.exp(-dt * BODY_SETTLE_RATE);
      bodyCenter.x += (headPosition.x - bodyCenter.x) * settle;
      bodyCenter.z += (headPosition.z - bodyCenter.z) * settle;
      bodyCenter.y += (headPosition.y - bodyCenter.y) * settle;
    }
    const fx = -Math.sin(bodyYaw), fz = -Math.cos(bodyYaw);
    const rx = Math.cos(bodyYaw), rz = -Math.sin(bodyYaw);
    for (const side of HIP_SIDES) {
      const sign = side === 'left' ? -1 : 1;
      belt[side].position.set(
        bodyCenter.x + rx * HIP_SIDE * sign + fx * HIP_FORWARD,
        bodyCenter.y - HIP_DROP,
        bodyCenter.z + rz * HIP_SIDE * sign + fz * HIP_FORWARD,
      );
      belt[side].rotation.set(0, bodyYaw, 0);
      belt[side].updateMatrixWorld(true);
    }
  }

  function update(dt = 0) {
    const safeDt = THREE.MathUtils.clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
    updateBelt(safeDt);

    // Remember where each hand has been, so that letting go while swinging throws what it holds.
    for (const state of states) {
      if (!state.inputSource || !state.objectGrip) continue;
      state.objectGrip.updateWorldMatrix(true, false);
      handMotion.record(state, state.objectGrip, safeDt);
    }

    // Two-handed equipment reserves its other hand before ordinary pickups run.
    beforeInput?.(safeDt);

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

    for (let i = falling.length - 1; i >= 0; i--) {
      const { fall, root } = falling[i];
      const moving = stepBody(fall, safeDt, heightAt);
      bodyOrigin(fall, root.position);
      root.quaternion.copy(fall.quaternion);
      if (!moving) falling.splice(i, 1);
    }

    for (const kind of kinds) kind.updateShared?.(safeDt, instances.filter(instance => instance.kind === kind));
    for (const instance of instances) instance.kind.update?.(instance, safeDt, { states });
  }

  // Menu actions: move a tool between the inventory and a hip.
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

  // ---- the save (src/save-game.js) ----------------------------------------------------------------------------------------------
  // Every tool in the world: on a hip, or in the world with its pose (and, if it has fallen, whether it is still falling, lying or stuck
  // in the sand). A tool in a hand is saved as dropped from where it is. What a tool keeps about itself (a torch: lit) comes from the kind.
  const savePosition = new THREE.Vector3();
  const saveQuaternion = new THREE.Quaternion();
  const noMotion = new THREE.Vector3();
  const millimetres = value => Math.round(value * 1000) / 1000;
  const tenThousandths = value => Math.round(value * 10000) / 10000;

  function snapshot() {
    const items = [];
    for (const instance of instances) {
      const { kind, root } = instance;
      const entry = { id: kind.id };
      const extra = kind.saveState?.(instance);
      if (extra) entry.data = extra;
      if (instance.slot) {
        entry.at = 'hip';
        entry.side = instance.slot;
      } else {
        root.updateWorldMatrix(true, false);
        root.getWorldPosition(savePosition);
        root.getWorldQuaternion(saveQuaternion);
        entry.at = 'ground';
        entry.p = savePosition.toArray().map(millimetres);
        entry.q = saveQuaternion.toArray().map(tenThousandths);
        if (instance.heldBy) entry.fall = 'air';
        else if (instance.fall && instance.fall.phase !== 'idle') entry.fall = instance.fall.phase;
      }
      items.push(entry);
    }
    return { kinds: kinds.map(kind => kind.id), items };
  }

  function placeSaved(kind, entry) {
    const instance = spawn(kind.id);
    if (!instance) return null;
    if (entry.data) kind.loadState?.(instance, entry.data);
    if (entry.at === 'hip') {
      if (HIP_SIDES.includes(entry.side) && toHip(instance, entry.side)) return instance;
      // That hip is taken (a damaged save): into the pockets, so the tool is never lost.
      addInventoryItem(kind.id, 1);
      dispose(instance);
      return null;
    }
    if (!Array.isArray(entry.p) || entry.p.length !== 3 || !Array.isArray(entry.q) || entry.q.length !== 4) { dispose(instance); return null; }
    scene.add(instance.root);
    instance.root.position.fromArray(entry.p);
    instance.root.quaternion.fromArray(entry.q).normalize();
    instance.root.scale.set(1, 1, 1);
    instance.root.updateMatrixWorld(true);
    if (entry.fall && kind.fall && kind.shape) {
      const body = createBody({ ...kind.shape, ...kind.fall });
      const pose = { origin: instance.root.position, quaternion: instance.root.quaternion };
      if (entry.fall === 'rest' || entry.fall === 'stuck') placeAtRest(body, pose, entry.fall);
      else launch(body, { ...pose, velocity: noMotion, spin: noMotion });
      instance.fall = body;
      if (isMoving(body)) falling.push(instance);
    }
    return instance;
  }

  // Put the saved tools back: the ones standing in the sand at the start are taken away, except for kinds the save never heard of
  // (added since), which keep theirs. Needs every model loaded (ready). Returns how many tools were put back.
  function restoreSnapshot(data) {
    if (!data || !Array.isArray(data.items)) return 0;
    const known = new Set(Array.isArray(data.kinds) ? data.kinds : data.items.map(item => item?.id));
    for (const instance of instances.slice()) {
      if (instance.defaultSpawn && known.has(instance.kind.id)) dispose(instance);
    }
    let placed = 0;
    for (const entry of data.items) {
      const kind = kindById.get(entry?.id);
      if (kind?.template && placeSaved(kind, entry)) placed++;
    }
    return placed;
  }

  // Where the body is, for things that hang off it besides the hips (the pack on your back): the point the belt hangs
  // from under the head, in the rig's space, and the way the body faces. out is { center: Vector3, yaw }. False until
  // the first frame in VR (there is no body on desktop).
  function getBodyFrame(out) {
    if (!bodyCenter) return false;
    out.center.copy(bodyCenter);
    out.yaw = bodyYaw;
    return true;
  }

  return {
    update,
    equip,
    unequip,
    throwTool,
    setBeforeInput: callback => { beforeInput = callback; },
    getBodyFrame,
    snapshot,
    restoreSnapshot,
    get ready() { return kinds.every(kind => kind.template); },
    getHipSlots: () => ({ left: slots.left?.kind.id ?? null, right: slots.right?.kind.id ?? null }),
    canEquip: id => Boolean(kindById.get(id)),
    getInstances: kind => instances.filter(instance => !kind || instance.kind.id === kind),
    isHolding: handedness => instances.some(instance => instance.heldBy?.handedness === handedness),
    belt,
    markers,
  };
}
