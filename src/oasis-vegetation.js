import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WATER } from './world.js';

const BUSH_DRAW_DISTANCE = 180;
const BUSH_LOAD_DISTANCE = 230;
const TREE_DRAW_DISTANCE = 240;
const TREE_LOAD_DISTANCE = 275;

// Hand-placed in normalized shoreline space so the food plants feel discovered rather
// than evenly distributed. Values around 1.3-1.5 sit in the grass shelf outside the bank.
const BUSH_LAYOUT = [
  { angle: 0.28, radius: 1.34, scale: 1.02, yaw: 0.4 },
  { angle: 1.17, radius: 1.46, scale: 0.91, yaw: 2.1 },
  { angle: 2.06, radius: 1.38, scale: 1.08, yaw: 4.7 },
  { angle: 3.02, radius: 1.51, scale: 0.96, yaw: 1.2 },
  { angle: 4.12, radius: 1.41, scale: 1.04, yaw: 5.4 },
  { angle: 5.22, radius: 1.47, scale: 0.94, yaw: 3.3 },
];

// Sparse taller anchors across the expanded grass shelf. Scale/yaw variation keeps repeated
// copies from reading like a ring of clones while still sharing the same GLB geometry/materials.
const TREE_LAYOUT = [
  { angle: 0.54, radius: 1.70, scale: 1.16, yaw: 0.25 },
  { angle: 1.34, radius: 1.58, scale: 1.32, yaw: 2.65 },
  { angle: 2.16, radius: 1.84, scale: 1.03, yaw: 4.35 },
  { angle: 3.04, radius: 1.62, scale: 1.24, yaw: 1.15 },
  { angle: 3.91, radius: 1.91, scale: 0.96, yaw: 5.20 },
  { angle: 4.76, radius: 1.56, scale: 1.36, yaw: 3.45 },
  { angle: 5.57, radius: 1.78, scale: 1.10, yaw: 0.85 },
];

function radialPositions(layout) {
  return layout.map(item => ({
    ...item,
    x: WATER.x + Math.cos(item.angle) * WATER.radiusX * item.radius,
    z: WATER.z + Math.sin(item.angle) * WATER.radiusZ * item.radius,
  }));
}

function disableModelShadows(root) {
  root.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = false;
    object.receiveShadow = false;
  });
}

export function createOasisVegetation({ field }) {
  const group = new THREE.Group();
  group.name = 'Oasis vegetation';

  const bushes = radialPositions(BUSH_LAYOUT);
  const trees = radialPositions(TREE_LAYOUT);

  const bushGroup = new THREE.Group();
  bushGroup.name = 'Berry bushes';
  group.add(bushGroup);

  const treeGroup = new THREE.Group();
  treeGroup.name = 'Alien desert trees';
  group.add(treeGroup);

  let bushLoadStarted = false;
  let treeLoadStarted = false;
  let bushesReady = false;
  let treesReady = false;

  function ensureBushes() {
    if (bushLoadStarted) return;
    bushLoadStarted = true;
    const loader = new GLTFLoader();
    const url = `${import.meta.env.BASE_URL}models/berry-bush/desert_berry_bush_optimized.glb`;
    loader.load(url, gltf => {
      const source = gltf.scene;
      source.updateMatrixWorld(true);
      for (let i = 0; i < bushes.length; i++) {
        const item = bushes[i];
        const bush = source.clone(true);
        bush.name = `Berry bush ${i + 1}`;
        bush.position.set(item.x, field.sample(item.x, item.z) - 0.015, item.z);
        bush.rotation.y = item.yaw;
        bush.scale.setScalar(item.scale);
        bush.userData.foodSource = 'berries';
        bush.userData.berryBush = true;
        disableModelShadows(bush);
        bushGroup.add(bush);
      }
      bushesReady = true;
    }, undefined, error => {
      console.warn('[Oasis vegetation] Berry bush model unavailable.', error);
    });
  }

  function ensureTrees() {
    if (treeLoadStarted) return;
    treeLoadStarted = true;
    const loader = new GLTFLoader();
    const url = `${import.meta.env.BASE_URL}models/berry-bush/alien_desert_plant.glb`;
    loader.load(url, gltf => {
      const source = gltf.scene;
      source.updateMatrixWorld(true);
      for (let i = 0; i < trees.length; i++) {
        const item = trees[i];
        const tree = source.clone(true);
        tree.name = `Alien desert tree ${i + 1}`;
        tree.position.set(item.x, field.sample(item.x, item.z) - 0.02, item.z);
        tree.rotation.y = item.yaw;
        tree.scale.setScalar(item.scale);
        tree.userData.oasisTree = true;
        disableModelShadows(tree);
        treeGroup.add(tree);
      }
      treesReady = true;
    }, undefined, error => {
      console.warn('[Oasis vegetation] Alien desert tree model unavailable.', error);
    });
  }

  function update(x, z) {
    const distance = Math.hypot(x - WATER.x, z - WATER.z);
    bushGroup.visible = distance < BUSH_DRAW_DISTANCE;
    treeGroup.visible = distance < TREE_DRAW_DISTANCE;
    if (distance < BUSH_LOAD_DISTANCE) ensureBushes();
    if (distance < TREE_LOAD_DISTANCE) ensureTrees();
  }

  update(0, 0);
  return {
    group,
    update,
    bushGroup,
    treeGroup,
    get bushesReady() { return bushesReady; },
    get treesReady() { return treesReady; },
  };
}
