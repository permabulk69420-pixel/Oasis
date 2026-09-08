import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WATER, terrainHeight } from './world.js';

const STICK_URL = `${import.meta.env.BASE_URL}models/stick/dead_ground_stick_vr_thin.glb`;
const GRIP_BUTTON = 1;
const PICKUP_RADIUS = 0.48;

// The stick is authored lengthwise on local X. Rotate it onto the same handle axis used
// by the axe so it sits naturally through the player's palm while held.
const heldFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
const stickToHandle = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
const heldRotation = heldFlip.clone().multiply(stickToHandle);
const handPosition = new THREE.Vector3();
const stickPosition = new THREE.Vector3();

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
      stick.userData.held = false;
      group.add(stick);
    }
  }, undefined, error => {
    onError(`[Oasis sticks] Stick model failed to load: ${error?.message || error}`);
  });

  return group;
}

export function createHeldSticks({ scene, states, onError = console.warn }) {
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
    stick.position.set(0, 0, 0);
    stick.quaternion.copy(heldRotation);
    stick.userData.held = true;
    heldByState.set(state, stick);
    return true;
  }

  function drop(state) {
    const stick = heldByState.get(state);
    if (!stick) return false;

    stick.updateWorldMatrix(true, false);
    stick.getWorldPosition(stickPosition);
    scene.attach(stick);

    const x = stickPosition.x;
    const z = stickPosition.z;
    const scale = Math.max(stick.scale.x, 0.001);
    const sourceBottom = Number.isFinite(stick.userData.sourceBottom) ? stick.userData.sourceBottom : -0.057;
    stick.position.set(x, terrainHeight(x, z) - sourceBottom * scale + 0.004, z);
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
        drop(state);
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
  };
}
