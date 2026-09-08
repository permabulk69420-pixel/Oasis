import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SPAWN, terrainHeight } from './world.js';

const AXE_URL = `${import.meta.env.BASE_URL}models/axe/stone_survival_axe.glb`;
const RIGHT_HAND = 'right';
const GRIP_BUTTON = 1;
const PICKUP_RADIUS = 0.52;

// The GLB origin is already in the lower handle grip area. Its lowest point is
// about 13 cm below that pivot, so this keeps the upright test spawn on the sand.
const AXE_BOTTOM_BELOW_GRIP = 0.131;

const loader = new GLTFLoader();
const handPosition = new THREE.Vector3();
const axePosition = new THREE.Vector3();
const heldFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
const bladeForwardTwist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);

function prepareAxe(root) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = false;
    object.receiveShadow = false;
  });
}

export function createHeldAxe({ scene, states, onError = console.warn }) {
  if (!scene || !Array.isArray(states)) throw new Error('Axe requires the Oasis scene and VR hand states.');

  let root = null;
  let heldBy = null;
  let gripDown = false;

  function placeOnGround(x, z) {
    if (!root) return;
    if (root.parent !== scene) scene.attach(root);
    root.position.set(x, terrainHeight(x, z) + AXE_BOTTOM_BELOW_GRIP, z);
    root.quaternion.identity();
    root.scale.set(1, 1, 1);
    root.updateMatrixWorld(true);
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

  function update() {
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
  }

  return {
    update,
    drop,
    isHeld: () => Boolean(heldBy),
    getObject: () => root,
  };
}
