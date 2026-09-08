import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WATER, terrainHeight } from './world.js';
import { addInventoryItem, getInventoryCount } from './inventory.js';

const STONE_URL = `${import.meta.env.BASE_URL}models/stone/vr_pickup_stone_uv_200.glb`;
const ROCK_TEXTURE = `${import.meta.env.BASE_URL}textures/rocks/pickup-rock/rock1.png`;
const GRIP_BUTTON = 1;
const PICKUP_RADIUS = 0.34;
const CHEST_Y_OFFSET = 0.38;
const CHEST_HORIZONTAL_RADIUS = 0.34;
const CHEST_VERTICAL_RADIUS = 0.25;

// Twelve hand-sized stones scattered across the sandy band around the oasis.
// Radius is normalized to the water ellipse, so ~1.0 is the shoreline.
const STONE_LAYOUT = [
  { angle: 0.18, radius: 1.16, yaw: 0.45, scale: 1.02 },
  { angle: 0.73, radius: 1.25, yaw: 2.10, scale: 0.94 },
  { angle: 1.21, radius: 1.19, yaw: 4.30, scale: 1.06 },
  { angle: 1.82, radius: 1.28, yaw: 1.35, scale: 0.97 },
  { angle: 2.31, radius: 1.14, yaw: 5.15, scale: 1.04 },
  { angle: 2.88, radius: 1.23, yaw: 3.40, scale: 0.92 },
  { angle: 3.42, radius: 1.18, yaw: 0.90, scale: 1.08 },
  { angle: 3.94, radius: 1.27, yaw: 4.70, scale: 0.96 },
  { angle: 4.46, radius: 1.15, yaw: 2.55, scale: 1.01 },
  { angle: 5.02, radius: 1.24, yaw: 5.75, scale: 0.95 },
  { angle: 5.48, radius: 1.20, yaw: 1.85, scale: 1.05 },
  { angle: 5.93, radius: 1.29, yaw: 3.05, scale: 0.98 },
];

const handPosition = new THREE.Vector3();
const stonePosition = new THREE.Vector3();
const headPosition = new THREE.Vector3();
const chestPosition = new THREE.Vector3();

function makeStoneMaterial(renderer) {
  const material = new THREE.MeshStandardMaterial({
    color: 0x745f4b,
    roughness: 0.92,
    metalness: 0,
  });
  material.name = 'Collectible stone — shared rock1';

  new THREE.TextureLoader().load(
    ROCK_TEXTURE,
    texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      if (renderer) texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      material.map = texture;
      material.color.set(0xffffff);
      material.needsUpdate = true;
    },
    undefined,
    () => console.warn('[Oasis stones] rock1.png could not be loaded; using the fallback stone colour.'),
  );

  return material;
}

export function createGroundStones({ field, renderer = null, onError = console.warn }) {
  if (!field?.sample) throw new Error('Ground stones require the Oasis height field.');

  const group = new THREE.Group();
  group.name = 'Loose oasis stones';

  const loader = new GLTFLoader();
  loader.load(STONE_URL, gltf => {
    const source = gltf.scene;
    source.name = 'Collectible stone source';
    source.updateMatrixWorld(true);

    const material = makeStoneMaterial(renderer);
    source.traverse(object => {
      if (!object.isMesh) return;
      object.material = material;
      object.castShadow = false;
      object.receiveShadow = false;
      if (!object.geometry.getAttribute('normal')) object.geometry.computeVertexNormals();
    });

    const bounds = new THREE.Box3().setFromObject(source);
    const sourceBottom = bounds.min.y;

    for (let i = 0; i < STONE_LAYOUT.length; i++) {
      const item = STONE_LAYOUT[i];
      const stone = source.clone(true);
      const x = WATER.x + Math.cos(item.angle) * WATER.radiusX * item.radius;
      const z = WATER.z + Math.sin(item.angle) * WATER.radiusZ * item.radius;
      stone.name = `Loose oasis stone ${i + 1}`;
      stone.position.set(
        x,
        field.sample(x, z) - sourceBottom * item.scale + 0.003,
        z,
      );
      stone.rotation.set(0, item.yaw, 0);
      stone.scale.setScalar(item.scale);
      stone.userData.collectibleResource = 'stone';
      stone.userData.looseStone = true;
      stone.userData.groundYaw = item.yaw;
      stone.userData.sourceBottom = sourceBottom;
      stone.userData.held = false;
      group.add(stone);
    }
  }, undefined, error => {
    onError(`[Oasis stones] Stone model failed to load: ${error?.message || error}`);
  });

  return group;
}

export function createHeldStones({ scene, states, renderer = null, onError = console.warn }) {
  if (!scene || !Array.isArray(states)) throw new Error('Stone grabbing requires the Oasis scene and VR hand states.');

  const heldByState = new Map();
  const gripDown = new Map();
  let stoneGroup = null;

  function getStoneGroup() {
    if (!stoneGroup || !stoneGroup.parent) stoneGroup = scene.getObjectByName('Loose oasis stones');
    return stoneGroup;
  }

  function grab(state, stone) {
    if (!state?.objectGrip || !stone || stone.userData.held) return false;
    if (state.objectGrip.children.length > 0) return false;

    state.objectGrip.add(stone);
    stone.position.set(0, 0, 0);
    stone.quaternion.identity();
    stone.userData.held = true;
    heldByState.set(state, stone);
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
    const stone = heldByState.get(state);
    if (!stone) return false;

    stone.removeFromParent();
    stone.userData.held = false;
    stone.userData.collected = true;
    heldByState.delete(state);
    addInventoryItem('stone', 1);
    return true;
  }

  function drop(state) {
    const stone = heldByState.get(state);
    if (!stone) return false;

    stone.updateWorldMatrix(true, false);
    stone.getWorldPosition(stonePosition);

    const group = getStoneGroup();
    if (group?.parent) group.attach(stone);
    else scene.attach(stone);

    const x = stonePosition.x;
    const z = stonePosition.z;
    const scale = Math.max(stone.scale.x, 0.001);
    const sourceBottom = Number.isFinite(stone.userData.sourceBottom) ? stone.userData.sourceBottom : -0.034;
    stonePosition.set(x, terrainHeight(x, z) - sourceBottom * scale + 0.003, z);
    if (stone.parent === group) group.worldToLocal(stonePosition);
    stone.position.copy(stonePosition);
    stone.rotation.set(0, stone.userData.groundYaw || 0, 0);
    stone.userData.held = false;
    heldByState.delete(state);
    return true;
  }

  function findNearestStone(state) {
    const group = getStoneGroup();
    if (!group?.visible || !state?.objectGrip) return null;

    state.objectGrip.updateWorldMatrix(true, false);
    state.objectGrip.getWorldPosition(handPosition);
    let nearest = null;
    let nearestDistanceSq = PICKUP_RADIUS * PICKUP_RADIUS;

    for (const stone of group.children) {
      if (!stone.userData?.looseStone || stone.userData.held) continue;
      stone.updateWorldMatrix(true, false);
      stone.getWorldPosition(stonePosition);
      const distanceSq = handPosition.distanceToSquared(stonePosition);
      if (distanceSq <= nearestDistanceSq) {
        nearest = stone;
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
      const heldStone = heldByState.get(state);

      if (heldStone && (!state.inputSource || !grip)) {
        if (state.inputSource && !grip && isHandAtChest(state)) store(state);
        else drop(state);
      } else if (!heldStone && grip && !wasDown && state.objectGrip.children.length === 0) {
        const stone = findNearestStone(state);
        if (stone) grab(state, stone);
      }

      gripDown.set(state, grip);
    }
  }

  return {
    update,
    dropAll: () => {
      for (const state of Array.from(heldByState.keys())) drop(state);
    },
    isHolding: handedness => {
      const state = states.find(item => item.handedness === handedness);
      return Boolean(state && heldByState.has(state));
    },
    getStoredCount: () => getInventoryCount('stone'),
  };
}
