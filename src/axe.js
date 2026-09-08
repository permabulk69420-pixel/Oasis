import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SPAWN, terrainHeight } from './world.js';
import { pulseHaptics } from './haptics.js';

const AXE_URL = `${import.meta.env.BASE_URL}models/axe/stone_survival_axe.glb`;
const CHOP_AUDIO_URLS = [1, 2, 3].map(index => `${import.meta.env.BASE_URL}audio/chopping/axe_chop_0${index}.mp3`);
const RIGHT_HAND = 'right';
const GRIP_BUTTON = 1;
const PICKUP_RADIUS = 0.52;

// Six clean axe impacts is enough to fell one of the regular blue alien trees.
const TREE_HITS_TO_FELL = 6;
const TREE_TRUNK_RADIUS = 0.72;
const TREE_CHOP_HEIGHT = 4.8;
const MIN_CHOP_SWING_SPEED = 1.25;
const HIT_COOLDOWN = 0.16;
const HIT_SHAKE_TIME = 0.16;
const FALL_DELAY = 0.10;
const FALL_DURATION = 1.25;
const FALL_ANGLE = Math.PI * 0.485;
const CHOP_VOLUME = 0.90;
const CHOP_HAPTIC_STRENGTH = 0.62;
const CHOP_HAPTIC_MS = 55;
const FELL_HAPTIC_STRENGTH = 0.90;
const FELL_HAPTIC_MS = 95;

// The GLB origin is already in the lower handle grip area. Its lowest point is
// about 13 cm below that pivot, so this keeps the upright test spawn on the sand.
const AXE_BOTTOM_BELOW_GRIP = 0.131;

const loader = new GLTFLoader();
const handPosition = new THREE.Vector3();
const axePosition = new THREE.Vector3();
const axeHeadPosition = new THREE.Vector3();
const treePosition = new THREE.Vector3();
const fallDirection = new THREE.Vector3();
const fallAxis = new THREE.Vector3();
const shakeAxis = new THREE.Vector3();
const previousGripLocal = new THREE.Vector3();
const currentGripLocal = new THREE.Vector3();
const previousGripQuaternion = new THREE.Quaternion();
const currentGripQuaternion = new THREE.Quaternion();
const temporaryQuaternion = new THREE.Quaternion();
const heldFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
const bladeForwardTwist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
const axeHeadLocal = new THREE.Vector3(0, 0.55, 0);

function prepareAxe(root) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = false;
    object.receiveShadow = false;
  });

  // Derive the useful chopping point once from the authored model rather than doing a
  // bounding-box traversal every XR frame. The pivot is down in the grip, so the upper
  // part of the bounds reliably tracks the stone head even if the asset is replaced later.
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  axeHeadLocal.set(
    (bounds.min.x + bounds.max.x) * 0.5,
    bounds.max.y - size.y * 0.10,
    (bounds.min.z + bounds.max.z) * 0.5,
  );
}

function makeChopAudio() {
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
    baseQuaternion: tree.quaternion.clone(),
    shakeTime: 0,
    shakeAxis: new THREE.Vector3(1, 0, 0),
    falling: false,
    fallen: false,
    fallDelay: 0,
    fallTime: 0,
    fallAxis: new THREE.Vector3(1, 0, 0),
  };
  return tree.userData.chopState;
}

export function createHeldAxe({ scene, states, onError = console.warn }) {
  if (!scene || !Array.isArray(states)) throw new Error('Axe requires the Oasis scene and VR hand states.');

  const chopAudio = makeChopAudio();
  let chopAudioIndex = 0;
  let root = null;
  let heldBy = null;
  let gripDown = false;
  let previousGripReady = false;
  let hitCooldown = 0;
  let hitRearmed = true;
  let treeGroup = null;

  function playChopSound() {
    const audio = chopAudio[chopAudioIndex % chopAudio.length];
    chopAudioIndex += 1;
    audio.currentTime = 0;
    audio.play().catch(error => {
      if (error?.name !== 'NotAllowedError') {
        onError(`[Oasis axe] Could not play chop audio: ${error?.message || error}`);
      }
    });
  }

  function placeOnGround(x, z) {
    if (!root) return;
    if (root.parent !== scene) scene.attach(root);
    root.position.set(x, terrainHeight(x, z) + AXE_BOTTOM_BELOW_GRIP, z);
    root.quaternion.identity();
    root.scale.set(1, 1, 1);
    root.updateMatrixWorld(true);
    previousGripReady = false;
    hitRearmed = true;
  }

  function grab(state) {
    if (!root || !state?.objectGrip) return false;
    state.objectGrip.add(root);
    root.position.set(0, 0, 0);

    // Keep the proven vertical flip, then twist 90 degrees around the axe's own handle
    // so the blade faces forward instead of left when the controller points forward.
    root.quaternion.copy(heldFlip).multiply(bladeForwardTwist);
    root.scale.set(1, 1, 1);
    heldBy = state;
    previousGripReady = false;
    hitRearmed = true;
    return true;
  }

  function drop() {
    if (!root || !heldBy) return false;
    root.updateWorldMatrix(true, false);
    root.getWorldPosition(axePosition);
    scene.attach(root);
    heldBy = null;
    placeOnGround(axePosition.x, axePosition.z);
    return true;
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
      const state = tree.userData.chopState;
      if (state?.falling || state?.fallen) continue;

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

  function hitTree(tree) {
    const state = ensureTreeChopState(tree);
    if (state.falling || state.fallen) return;

    tree.getWorldPosition(treePosition);
    fallDirection.set(treePosition.x - axeHeadPosition.x, 0, treePosition.z - axeHeadPosition.z);
    if (fallDirection.lengthSq() < 0.0001) fallDirection.set(0, 0, -1);
    fallDirection.normalize();

    // Tilt briefly away from the incoming axe blow.
    shakeAxis.set(fallDirection.z, 0, -fallDirection.x).normalize();
    state.shakeAxis.copy(shakeAxis);
    state.shakeTime = HIT_SHAKE_TIME;
    state.hits += 1;
    const isFellingHit = state.hits >= TREE_HITS_TO_FELL;
    playChopSound();
    pulseHaptics(
      heldBy,
      isFellingHit ? FELL_HAPTIC_STRENGTH : CHOP_HAPTIC_STRENGTH,
      isFellingHit ? FELL_HAPTIC_MS : CHOP_HAPTIC_MS,
    );

    if (isFellingHit) {
      state.falling = true;
      state.fallDelay = FALL_DELAY;
      state.fallTime = 0;
      state.fallAxis.copy(shakeAxis);
      tree.userData.choppedDown = true;
    }
  }

  function updateTreeAnimations(dt) {
    const group = getTreeGroup();
    if (!group) return;

    for (const tree of group.children) {
      const state = tree.userData?.chopState;
      if (!state || state.fallen) continue;

      if (state.shakeTime > 0 && !state.falling) {
        state.shakeTime = Math.max(0, state.shakeTime - dt);
        const remaining = state.shakeTime / HIT_SHAKE_TIME;
        const angle = Math.sin((1 - remaining) * Math.PI * 5.0) * 0.035 * remaining;
        temporaryQuaternion.setFromAxisAngle(state.shakeAxis, angle);
        tree.quaternion.copy(temporaryQuaternion).multiply(state.baseQuaternion);
        if (state.shakeTime <= 0) tree.quaternion.copy(state.baseQuaternion);
      }

      if (!state.falling) continue;
      if (state.fallDelay > 0) {
        state.fallDelay = Math.max(0, state.fallDelay - dt);
        continue;
      }

      state.fallTime += dt;
      const t = THREE.MathUtils.clamp(state.fallTime / FALL_DURATION, 0, 1);
      // Starts slowly, then gains speed like a top-heavy tree giving way at the base.
      const fallProgress = t * t * (3 - 2 * t);
      temporaryQuaternion.setFromAxisAngle(state.fallAxis, FALL_ANGLE * fallProgress);
      tree.quaternion.copy(temporaryQuaternion).multiply(state.baseQuaternion);

      if (t >= 1) {
        state.falling = false;
        state.fallen = true;
      }
    }
  }

  loader.load(AXE_URL, (gltf) => {
    root = gltf.scene;
    root.name = 'Stone survival axe';
    prepareAxe(root);
    scene.add(root);

    // Opposite side of the start from the torch so both pickups are easy to distinguish.
    placeOnGround(SPAWN.x - 0.85, SPAWN.z - 1.05);
  }, undefined, (error) => {
    onError(`[Oasis axe] Axe model failed to load: ${error?.message || error}`);
  });

  function update(dt = 0) {
    const safeDt = THREE.MathUtils.clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
    hitCooldown = Math.max(0, hitCooldown - safeDt);
    updateTreeAnimations(safeDt);

    const right = states.find((state) => state.handedness === RIGHT_HAND);
    const buttons = right?.inputSource?.gamepad?.buttons || [];
    const grip = Boolean(buttons[GRIP_BUTTON]?.pressed);

    if (right && root && !heldBy && grip && !gripDown) {
      right.objectGrip.updateWorldMatrix(true, false);
      right.objectGrip.getWorldPosition(handPosition);
      root.updateWorldMatrix(true, false);
      root.getWorldPosition(axePosition);

      // Target the useful middle of the handle for pickup rather than the sand-level pivot.
      axePosition.y += 0.14;
      if (handPosition.distanceTo(axePosition) <= PICKUP_RADIUS) grab(right);
    }

    if (heldBy && !grip) drop();
    gripDown = grip;

    if (!heldBy || !root || safeDt <= 0) {
      previousGripReady = false;
      return;
    }

    root.updateWorldMatrix(true, false);
    axeHeadPosition.copy(axeHeadLocal);
    root.localToWorld(axeHeadPosition);

    // Measure the controller motion in rig-local space so simply walking/running past a tree
    // cannot count as an axe swing. Physical hand translation and controller rotation do count.
    currentGripLocal.copy(heldBy.grip.position);
    currentGripQuaternion.copy(heldBy.grip.quaternion);
    let swingSpeed = 0;
    if (previousGripReady) {
      const linearSpeed = currentGripLocal.distanceTo(previousGripLocal) / safeDt;
      const dot = THREE.MathUtils.clamp(Math.abs(currentGripQuaternion.dot(previousGripQuaternion)), 0, 1);
      const angularSpeed = (2 * Math.acos(dot)) / safeDt;
      swingSpeed = linearSpeed + angularSpeed * Math.max(axeHeadLocal.length(), 0.35);
    }
    previousGripLocal.copy(currentGripLocal);
    previousGripQuaternion.copy(currentGripQuaternion);
    previousGripReady = true;

    const contactedTree = findTreeAtHead();
    if (!contactedTree) {
      hitRearmed = true;
      return;
    }

    if (hitRearmed && hitCooldown <= 0 && swingSpeed >= MIN_CHOP_SWING_SPEED) {
      hitTree(contactedTree);
      hitCooldown = HIT_COOLDOWN;
      hitRearmed = false;
    }
  }

  return {
    update,
    drop,
    isHeld: () => Boolean(heldBy),
    getObject: () => root,
  };
}
