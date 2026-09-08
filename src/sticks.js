import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WATER, terrainHeight } from './world.js';
import { addInventoryItem, getInventoryCount } from './inventory.js';

const STICK_URL = `${import.meta.env.BASE_URL}models/stick/dead_ground_stick_vr_thin.glb`;
const GRIP_BUTTON = 1;
const PICKUP_RADIUS = 0.48;
const CHEST_Y_OFFSET = 0.38;
const CHEST_HORIZONTAL_RADIUS = 0.34;
const CHEST_VERTICAL_RADIUS = 0.25;

// The stick is authored lengthwise on local X. Match the axe's proven handle axis,
// but anchor the hand to a thin section of the actual stick rather than the GLB origin.
const heldFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
const stickToHandle = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
const heldRotation = heldFlip.clone().multiply(stickToHandle);
const handPosition = new THREE.Vector3();
const stickPosition = new THREE.Vector3();
const localVertex = new THREE.Vector3();
const gripOffset = new THREE.Vector3();
const headPosition = new THREE.Vector3();
const chestPosition = new THREE.Vector3();

// Sparse placements around the grassy oasis shelf. Radius is in normalized shoreline space,
// matching the vegetation layout and keeping every stick safely outside the water.
const STICK_LAYOUT = [
  { angle: 0.42, radius: 1.34, yaw: 0.35, scale: 0.98 },
  { angle: 1.38, radius: 1.48, yaw: 2.10, scale: 1.04 },
  { angle: 2.33, radius: 1.57, yaw: 4.55, scale: 0.94 },
  { angle: 3.31, radius: 1.39, yaw: 1.25, scale: 1.07 },
  { angle: 4.45, radius: 1.63, yaw: 5.35, scale: 1.00 },
  { angle: 5.58, radius: 1.46, yaw: 3.65, scale: 0.96 },
];

function findNaturalGripPoint(source, bounds) {
  // Sample the authored mesh into bins along the stick's main X axis. We deliberately
  // search near either end (but not at the fragile tip) and choose the thinnest useful
  // section. This keeps the fist around a straight shaft even if the model origin sits
  // on a branch junction.
  const BIN_COUNT = 16;
  const bins = Array.from({ length: BIN_COUNT }, () => ({
    count: 0,
    sumX: 0,
    sumY: 0,
    sumZ: 0,
    minY: Infinity,
    maxY: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  }));
  const length = Math.max(bounds.max.x - bounds.min.x, 0.001);

  source.updateWorldMatrix(true, true);
  source.traverse(object => {
    if (!object.isMesh) return;
    const positions = object.geometry?.getAttribute?.('position');
    if (!positions) return;
    object.updateWorldMatrix(true, false);

    for (let i = 0; i < positions.count; i++) {
      localVertex.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      source.worldToLocal(localVertex);
      const t = THREE.MathUtils.clamp((localVertex.x - bounds.min.x) / length, 0, 0.999999);
      const bin = bins[Math.floor(t * BIN_COUNT)];
      bin.count += 1;
      bin.sumX += localVertex.x;
      bin.sumY += localVertex.y;
      bin.sumZ += localVertex.z;
      bin.minY = Math.min(bin.minY, localVertex.y);
      bin.maxY = Math.max(bin.maxY, localVertex.y);
      bin.minZ = Math.min(bin.minZ, localVertex.z);
      bin.maxZ = Math.max(bin.maxZ, localVertex.z);
    }
  });

  let best = null;
  let bestScore = Infinity;
  for (let i = 0; i < BIN_COUNT; i++) {
    const bin = bins[i];
    if (bin.count < 4) continue;
    const t = (i + 0.5) / BIN_COUNT;
    const nearLeftEnd = t >= 0.10 && t <= 0.32;
    const nearRightEnd = t >= 0.68 && t <= 0.90;
    if (!nearLeftEnd && !nearRightEnd) continue;

    const spanY = bin.maxY - bin.minY;
    const spanZ = bin.maxZ - bin.minZ;
    const thickness = Math.hypot(spanY, spanZ);
    const endDistance = Math.min(t, 1 - t);
    // Prefer a thin shaft, with a slight bias toward ~20% in from an end so the hand
    // is not balanced at the centre or hanging off the very tip.
    const score = thickness + Math.abs(endDistance - 0.20) * length * 0.12;
    if (score < bestScore) {
      bestScore = score;
      best = bin;
    }
  }

  if (!best) return bounds.getCenter(new THREE.Vector3());
  return new THREE.Vector3(
    best.sumX / best.count,
    best.sumY / best.count,
    best.sumZ / best.count,
  );
}

export function createGroundSticks({ field, onError = console.warn }) {
  if (!field?.sample) throw new Error('Ground sticks require the Oasis height field.');

  const group = new THREE.Group();
  group.name = 'Loose oasis sticks';

  const loader = new GLTFLoader();
  loader.load(STICK_URL, gltf => {
    const source = gltf.scene;
    source.name = 'Dead ground stick source';
    source.updateMatrixWorld(true);

    source.traverse(object => {
      if (!object.isMesh) return;
      object.castShadow = false;
      object.receiveShadow = false;
    });

    const bounds = new THREE.Box3().setFromObject(source);
    const sourceBottom = bounds.min.y;
    const naturalGripPoint = findNaturalGripPoint(source, bounds);

    for (let i = 0; i < STICK_LAYOUT.length; i++) {
      const item = STICK_LAYOUT[i];
      const stick = source.clone(true);
      const x = WATER.x + Math.cos(item.angle) * WATER.radiusX * item.radius;
      const z = WATER.z + Math.sin(item.angle) * WATER.radiusZ * item.radius;
      stick.name = `Loose oasis stick ${i + 1}`;
      stick.position.set(
        x,
        field.sample(x, z) - sourceBottom * item.scale + 0.004,
        z,
      );
      stick.rotation.y = item.yaw;
      stick.scale.setScalar(item.scale);
      stick.userData.collectibleResource = 'stick';
      stick.userData.looseStick = true;
      stick.userData.groundYaw = item.yaw;
      stick.userData.sourceBottom = sourceBottom;
      stick.userData.gripPoint = naturalGripPoint.toArray();
      stick.userData.held = false;
      group.add(stick);
    }
  }, undefined, error => {
    onError(`[Oasis sticks] Stick model failed to load: ${error?.message || error}`);
  });

  return group;
}

export function createHeldSticks({ scene, states, renderer = null, onError = console.warn }) {
  if (!scene || !Array.isArray(states)) throw new Error('Stick grabbing requires the Oasis scene and VR hand states.');

  const heldByState = new Map();
  const gripDown = new Map();
  let stickGroup = null;

  function getStickGroup() {
    if (!stickGroup || !stickGroup.parent) stickGroup = scene.getObjectByName('Loose oasis sticks');
    return stickGroup;
  }

  function grab(state, stick) {
    if (!state?.objectGrip || !stick || stick.userData.held) return false;
    if (state.objectGrip.children.length > 0) return false;

    state.objectGrip.add(stick);
    stick.quaternion.copy(heldRotation);

    // Put the chosen shaft centre directly in the fist. Applying the model's held
    // rotation to the authored grip point and negating it gives the root translation
    // needed to make that local point coincide with the hand anchor.
    const point = Array.isArray(stick.userData.gripPoint)
      ? gripOffset.fromArray(stick.userData.gripPoint)
      : gripOffset.set(0, 0, 0);
    point.applyQuaternion(stick.quaternion).multiplyScalar(-1);
    stick.position.copy(point);

    stick.userData.held = true;
    heldByState.set(state, stick);
    return true;
  }

  function isHandAtChest(state) {
    if (!renderer?.xr?.isPresenting || !state?.objectGrip) return false;
    const xrCamera = renderer.xr.getCamera();
    if (!xrCamera) return false;

    xrCamera.updateWorldMatrix(true, false);
    xrCamera.getWorldPosition(headPosition);
    chestPosition.copy(headPosition);
    chestPosition.y -= CHEST_Y_OFFSET;

    state.objectGrip.updateWorldMatrix(true, false);
    state.objectGrip.getWorldPosition(handPosition);

    const horizontalDistance = Math.hypot(
      handPosition.x - chestPosition.x,
      handPosition.z - chestPosition.z,
    );
    const verticalDistance = Math.abs(handPosition.y - chestPosition.y);
    return horizontalDistance <= CHEST_HORIZONTAL_RADIUS && verticalDistance <= CHEST_VERTICAL_RADIUS;
  }

  function store(state) {
    const stick = heldByState.get(state);
    if (!stick) return false;

    stick.removeFromParent();
    stick.userData.held = false;
    stick.userData.collected = true;
    heldByState.delete(state);
    addInventoryItem('stick', 1);
    return true;
  }

  function drop(state) {
    const stick = heldByState.get(state);
    if (!stick) return false;

    stick.updateWorldMatrix(true, false);
    stick.getWorldPosition(stickPosition);

    // Return dropped sticks to the same registered group that pickup searches.
    // group.attach preserves the current world transform while re-parenting.
    const group = getStickGroup();
    if (group?.parent) group.attach(stick);
    else scene.attach(stick);

    const x = stickPosition.x;
    const z = stickPosition.z;
    const scale = Math.max(stick.scale.x, 0.001);
    const sourceBottom = Number.isFinite(stick.userData.sourceBottom) ? stick.userData.sourceBottom : -0.057;
    stickPosition.set(x, terrainHeight(x, z) - sourceBottom * scale + 0.004, z);
    if (stick.parent === group) group.worldToLocal(stickPosition);
    stick.position.copy(stickPosition);
    stick.rotation.set(0, stick.userData.groundYaw || 0, 0);
    stick.userData.held = false;
    heldByState.delete(state);
    return true;
  }

  function findNearestStick(state) {
    const group = getStickGroup();
    if (!group?.visible || !state?.objectGrip) return null;

    state.objectGrip.updateWorldMatrix(true, false);
    state.objectGrip.getWorldPosition(handPosition);
    let nearest = null;
    let nearestDistanceSq = PICKUP_RADIUS * PICKUP_RADIUS;

    for (const stick of group.children) {
      if (!stick.userData?.looseStick || stick.userData.held) continue;
      stick.updateWorldMatrix(true, false);
      stick.getWorldPosition(stickPosition);
      const distanceSq = handPosition.distanceToSquared(stickPosition);
      if (distanceSq <= nearestDistanceSq) {
        nearest = stick;
        nearestDistanceSq = distanceSq;
      }
    }
    return nearest;
  }

  function update() {
    for (const state of states) {
      const buttons = state.inputSource?.gamepad?.buttons || [];
      const grip = Boolean(buttons[GRIP_BUTTON]?.pressed);
      const wasDown = Boolean(gripDown.get(state));
      const heldStick = heldByState.get(state);

      if (heldStick && (!state.inputSource || !grip)) {
        // Releasing a held stick at the player's chest stores it instead of dropping it.
        // A controller disconnect still drops normally so it cannot grant inventory accidentally.
        if (state.inputSource && !grip && isHandAtChest(state)) store(state);
        else drop(state);
      } else if (!heldStick && grip && !wasDown && state.objectGrip.children.length === 0) {
        const stick = findNearestStick(state);
        if (stick) grab(state, stick);
      }

      gripDown.set(state, grip);
    }
  }

  return {
    update,
    dropAll: () => {
      for (const state of Array.from(heldByState.keys())) drop(state);
    },
    isHolding: (handedness) => {
      const state = states.find(item => item.handedness === handedness);
      return Boolean(state && heldByState.has(state));
    },
    getStoredCount: () => getInventoryCount('stick'),
  };
}
