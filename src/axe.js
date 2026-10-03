import * as THREE from 'three';
import { SPAWN } from './world.js';
import { pulseHaptics } from './haptics.js';
import { setGripSurface } from './grip-contact.js';
import { spawnDrop } from './resource-drops.js';

const AXE_URL = `${import.meta.env?.BASE_URL ?? '/'}models/axe/stone_survival_axe.glb`;
const CHOP_AUDIO_URLS = [1, 2, 3].map(index => `${import.meta.env?.BASE_URL ?? '/'}audio/chopping/axe_chop_0${index}.mp3`);
const PICKUP_RADIUS = 0.52;

// Six clean axe impacts fells one of the regular blue alien trees.
export const TREE_HITS_TO_FELL = 6;
const TREE_TRUNK_RADIUS = 0.72;
const TREE_CHOP_HEIGHT = 4.8;
const MIN_CHOP_SWING_SPEED = 1.25;
const HIT_COOLDOWN = 0.16;
const HIT_SHAKE_TIME = 0.22;
const HIT_SHAKE_ANGLE = 0.035;
const FALL_DELAY = 0.10;
const FALL_DURATION = 1.25;
const FALL_ANGLE = Math.PI * 0.485;
// After landing: a short rest, then the trunk sinks away, leaving the drops behind.
const SETTLE_TIME = 1.2;
const SINK_DURATION = 2.4;
const SINK_DEPTH = 3.0;
export const REGROW_DELAY = 180;
const REGROW_DURATION = 5;
const CHOP_VOLUME = 0.90;
const CHOP_HAPTIC_STRENGTH = 0.62;
const CHOP_HAPTIC_MS = 55;
const FELL_HAPTIC_STRENGTH = 0.90;
const FELL_HAPTIC_MS = 95;

// What one felled tree leaves, in metres along the fallen trunk (scaled by tree size).
// Logs lie along the trunk line; sticks scatter around the crown.
export const TREE_DROPS = Object.freeze([
  Object.freeze({ type: 'wood', along: 1.6, side: 0.0 }),
  Object.freeze({ type: 'wood', along: 3.2, side: 0.35 }),
  Object.freeze({ type: 'stick', along: 5.0, side: -0.9 }),
  Object.freeze({ type: 'stick', along: 6.0, side: 0.8 }),
  Object.freeze({ type: 'stick', along: 7.1, side: -0.3 }),
]);

// The GLB origin is in the lower handle grip area; its lowest point is ~13 cm below.
const AXE_BOTTOM_BELOW_GRIP = 0.131;

const axeHeadPosition = new THREE.Vector3();
const treePosition = new THREE.Vector3();
const fallDirection = new THREE.Vector3();
const shakeAxis = new THREE.Vector3();
const temporaryQuaternion = new THREE.Quaternion();
const heldFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
const bladeForwardTwist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
const axeHeadLocal = new THREE.Vector3(0, 0.55, 0);

function makeChopAudio() {
  if (typeof Audio === 'undefined') return [];
  return CHOP_AUDIO_URLS.map(url => {
    const audio = new Audio(url);
    audio.preload = 'auto';
    audio.volume = CHOP_VOLUME;
    audio.playsInline = true;
    return audio;
  });
}

function ensureTreeChopState(tree) {
  if (tree.userData.chopState) return tree.userData.chopState;
  tree.userData.chopState = {
    hits: 0,
    basePosition: tree.position.clone(),
    baseQuaternion: tree.quaternion.clone(),
    baseScale: tree.scale.x,
    shakeTime: 0,
    shakeAxis: new THREE.Vector3(1, 0, 0),
    phase: 'standing', // standing → falling → settling → sinking → gone → regrowing → standing
    timer: 0,
    fallAxis: new THREE.Vector3(1, 0, 0),
    fallDirection: new THREE.Vector3(0, 0, -1),
  };
  return tree.userData.chopState;
}

export function createAxeKind({ scene, onError = console.warn }) {
  const chopAudio = makeChopAudio();
  let chopAudioIndex = 0;
  let treeGroup = null;

  function playChopSound() {
    const audio = chopAudio[chopAudioIndex++ % Math.max(chopAudio.length, 1)];
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(error => {
      if (error?.name !== 'NotAllowedError') onError(`[Oasis axe] Could not play chop audio: ${error?.message || error}`);
    });
  }

  function getTreeGroup() {
    if (!treeGroup || !treeGroup.parent) treeGroup = scene.getObjectByName('Alien desert trees');
    return treeGroup;
  }

  function findTreeAtHead() {
    const group = getTreeGroup();
    if (!group?.visible) return null;
    let best = null;
    let bestDistanceSq = Infinity;
    for (const tree of group.children) {
      if (!tree.userData?.oasisTree) continue;
      const phase = tree.userData.chopState?.phase;
      if (phase && phase !== 'standing') continue;
      tree.getWorldPosition(treePosition);
      const scale = Math.max(tree.scale.x, 0.001);
      const dy = axeHeadPosition.y - treePosition.y;
      if (dy < 0.08 || dy > TREE_CHOP_HEIGHT * scale) continue;
      const dx = axeHeadPosition.x - treePosition.x;
      const dz = axeHeadPosition.z - treePosition.z;
      const distanceSq = dx * dx + dz * dz;
      const radius = TREE_TRUNK_RADIUS * scale;
      if (distanceSq <= radius * radius && distanceSq < bestDistanceSq) {
        best = tree;
        bestDistanceSq = distanceSq;
      }
    }
    return best;
  }

  function hitTree(tree, holder) {
    const state = ensureTreeChopState(tree);
    if (state.phase !== 'standing') return;
    tree.getWorldPosition(treePosition);
    fallDirection.set(treePosition.x - axeHeadPosition.x, 0, treePosition.z - axeHeadPosition.z);
    if (fallDirection.lengthSq() < 0.0001) fallDirection.set(0, 0, -1);
    fallDirection.normalize();

    // Tilt briefly away from the blow.
    shakeAxis.set(fallDirection.z, 0, -fallDirection.x).normalize();
    state.shakeAxis.copy(shakeAxis);
    state.shakeTime = HIT_SHAKE_TIME;
    state.hits += 1;
    const felling = state.hits >= TREE_HITS_TO_FELL;
    playChopSound();
    pulseHaptics(holder, felling ? FELL_HAPTIC_STRENGTH : CHOP_HAPTIC_STRENGTH, felling ? FELL_HAPTIC_MS : CHOP_HAPTIC_MS);

    if (felling) {
      state.phase = 'falling';
      state.timer = -FALL_DELAY;
      state.fallAxis.copy(shakeAxis);
      state.fallDirection.copy(fallDirection);
      tree.userData.choppedDown = true;
      // Its projected ground shadow goes with it.
      if (tree.userData.layoutItem) tree.userData.layoutItem.felled = true;
    }
  }

  function dropResources(state) {
    const scale = state.baseScale;
    const sideX = -state.fallDirection.z, sideZ = state.fallDirection.x;
    const trunkYaw = Math.atan2(-state.fallDirection.z, state.fallDirection.x);
    TREE_DROPS.forEach((drop, index) => {
      const x = state.basePosition.x + (state.fallDirection.x * drop.along + sideX * drop.side) * scale;
      const z = state.basePosition.z + (state.fallDirection.z * drop.along + sideZ * drop.side) * scale;
      // Logs roughly follow the trunk; sticks land at loose angles.
      const yaw = drop.type === 'wood' ? trunkYaw + (index % 2 ? 0.25 : -0.15) : trunkYaw + index * 1.9;
      spawnDrop(drop.type, x, z, yaw);
    });
  }

  function updateTrees(dt) {
    const group = getTreeGroup();
    if (!group) return;
    for (const tree of group.children) {
      const state = tree.userData?.chopState;
      if (!state) continue;

      if (state.phase === 'standing') {
        if (state.shakeTime <= 0) continue;
        state.shakeTime = Math.max(0, state.shakeTime - dt);
        const remaining = state.shakeTime / HIT_SHAKE_TIME;
        // Each hit shakes a little harder, so you can feel the tree giving way.
        const strength = HIT_SHAKE_ANGLE * (1 + state.hits * 0.25);
        const angle = Math.sin((1 - remaining) * Math.PI * 5.0) * strength * remaining;
        tree.quaternion.copy(temporaryQuaternion.setFromAxisAngle(state.shakeAxis, angle)).multiply(state.baseQuaternion);
        continue;
      }

      state.timer += dt;
      if (state.phase === 'falling') {
        if (state.timer < 0) continue;
        const t = THREE.MathUtils.clamp(state.timer / FALL_DURATION, 0, 1);
        // Slow start, then accelerating like a top-heavy tree giving way at the base.
        tree.quaternion.copy(temporaryQuaternion.setFromAxisAngle(state.fallAxis, FALL_ANGLE * t * t * t)).multiply(state.baseQuaternion);
        if (t >= 1) {
          state.phase = 'settling';
          state.timer = 0;
          dropResources(state);
        }
      } else if (state.phase === 'settling') {
        if (state.timer >= SETTLE_TIME) { state.phase = 'sinking'; state.timer = 0; }
      } else if (state.phase === 'sinking') {
        const t = THREE.MathUtils.clamp(state.timer / SINK_DURATION, 0, 1);
        tree.position.y = state.basePosition.y - SINK_DEPTH * t * t * state.baseScale;
        if (t >= 1) { state.phase = 'gone'; state.timer = 0; tree.visible = false; }
      } else if (state.phase === 'gone') {
        if (state.timer >= REGROW_DELAY) {
          state.phase = 'regrowing';
          state.timer = 0;
          tree.position.copy(state.basePosition);
          tree.quaternion.copy(state.baseQuaternion);
          tree.scale.setScalar(state.baseScale * 0.05);
          tree.visible = true;
        }
      } else if (state.phase === 'regrowing') {
        const t = THREE.MathUtils.clamp(state.timer / REGROW_DURATION, 0, 1);
        tree.scale.setScalar(state.baseScale * (0.05 + 0.95 * (1 - Math.pow(1 - t, 3))));
        if (t >= 1) {
          state.phase = 'standing';
          state.hits = 0;
          state.shakeTime = 0;
          tree.userData.choppedDown = false;
          if (tree.userData.layoutItem) tree.userData.layoutItem.felled = false;
        }
      }
    }
  }

  return {
    id: 'axe',
    name: 'Stone survival axe',
    url: AXE_URL,
    groundBottom: AXE_BOTTOM_BELOW_GRIP,
    pickupLift: 0.14,
    pickupRadius: PICKUP_RADIUS,
    // Keep the proven vertical flip, then twist so the blade faces forward in the hand.
    heldRotation: heldFlip.clone().multiply(bladeForwardTwist),
    // Hangs head-down from the belt with the handle up, ready to draw.
    holster: { flip: true, lift: 0.12, outward: 0.2, pitch: -0.1 },
    spawns: [{ x: SPAWN.x - 0.85, z: SPAWN.z - 1.05 }],

    prepareTemplate(root) {
      // Derive the chopping point once from the model: the pivot is in the grip, so the
      // top of the bounds tracks the stone head even if the asset is replaced later.
      const bounds = new THREE.Box3().setFromObject(root);
      const size = bounds.getSize(new THREE.Vector3());
      axeHeadLocal.set((bounds.min.x + bounds.max.x) * 0.5, bounds.max.y - size.y * 0.10, (bounds.min.z + bounds.max.z) * 0.5);
    },
    prepare({ root }) {
      setGripSurface(root, { meshes: ['WoodenHandle'], axis: [0, 1, 0], point: [0, 0, 0] });
      root.traverse(object => {
        if (!object.isMesh) return;
        object.castShadow = false;
        object.receiveShadow = false;
      });
    },
    createState: () => ({
      ready: false,
      cooldown: 0,
      rearmed: true,
      previousPosition: new THREE.Vector3(),
      previousQuaternion: new THREE.Quaternion(),
    }),
    onGrab({ state }) { state.ready = false; state.rearmed = true; },
    onRelease({ state }) { state.ready = false; state.rearmed = true; },
    updateShared: dt => updateTrees(dt),

    update({ root, heldBy, state }, dt) {
      state.cooldown = Math.max(0, state.cooldown - dt);
      if (!heldBy || dt <= 0) { state.ready = false; return; }

      root.updateWorldMatrix(true, false);
      axeHeadPosition.copy(axeHeadLocal);
      root.localToWorld(axeHeadPosition);

      // Measure controller motion in rig space so walking past a tree doesn't count as a swing.
      let swingSpeed = 0;
      if (state.ready) {
        const linear = heldBy.grip.position.distanceTo(state.previousPosition) / dt;
        const dot = THREE.MathUtils.clamp(Math.abs(heldBy.grip.quaternion.dot(state.previousQuaternion)), 0, 1);
        swingSpeed = linear + (2 * Math.acos(dot) / dt) * Math.max(axeHeadLocal.length(), 0.35);
      }
      state.previousPosition.copy(heldBy.grip.position);
      state.previousQuaternion.copy(heldBy.grip.quaternion);
      state.ready = true;

      const tree = findTreeAtHead();
      if (!tree) { state.rearmed = true; return; }
      if (state.rearmed && state.cooldown <= 0 && swingSpeed >= MIN_CHOP_SWING_SPEED) {
        hitTree(tree, heldBy);
        state.cooldown = HIT_COOLDOWN;
        state.rearmed = false;
      }
    },
  };
}
