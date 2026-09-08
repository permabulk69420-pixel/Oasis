import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WATER } from './world.js';

const BUSH_DRAW_DISTANCE = 180;
const BUSH_LOAD_DISTANCE = 230;
const TREE_DRAW_DISTANCE = 240;
const TREE_LOAD_DISTANCE = 275;
const FERN_DRAW_DISTANCE = 170;
const FERN_LOAD_DISTANCE = 210;

// Keep the full tree nearby, then step down aggressively once individual leaves are small in VR.
const TREE_LODS = [
  { file: 'blue_alien_tree.glb', distance: 0 },
  { file: 'blue_alien_tree_optimized_code.glb', distance: 18 },
  { file: 'blue_alien_tree_lod3_ultra.glb', distance: 45 },
];

// Large ground foliage can step down sooner than the taller trees because the frond detail
// becomes difficult to resolve quickly at Quest resolution.
const FERN_LODS = [
  { file: 'large_purple_alien_fern_v2.glb', distance: 0 },
  { file: 'large_purple_alien_fern_v2_LOD1.glb', distance: 12 },
  { file: 'large_purple_alien_fern_v2_LOD2.glb', distance: 30 },
];

// Hand-placed in normalized shoreline space so the food plants feel discovered rather
// than evenly distributed. Keep all berry bushes at the model's original scale.
const BUSH_LAYOUT = [
  { angle: 0.28, radius: 1.34, scale: 1.00, yaw: 0.4 },
  { angle: 1.17, radius: 1.46, scale: 1.00, yaw: 2.1 },
  { angle: 2.06, radius: 1.38, scale: 1.00, yaw: 4.7 },
  { angle: 3.02, radius: 1.51, scale: 1.00, yaw: 1.2 },
  { angle: 4.12, radius: 1.41, scale: 1.00, yaw: 5.4 },
  { angle: 5.22, radius: 1.47, scale: 1.00, yaw: 3.3 },
];

// Sparse taller anchors kept safely inside the grass shelf. Scale/yaw variation keeps repeated
// copies from reading like a ring of clones while still sharing each LOD's geometry/materials.
const TREE_LAYOUT = [
  { angle: 0.54, radius: 1.55, scale: 1.16, yaw: 0.25 },
  { angle: 1.34, radius: 1.48, scale: 1.32, yaw: 2.65 },
  { angle: 2.16, radius: 1.63, scale: 1.03, yaw: 4.35 },
  { angle: 3.04, radius: 1.52, scale: 1.24, yaw: 1.15 },
  { angle: 3.91, radius: 1.66, scale: 0.96, yaw: 5.20 },
  { angle: 4.76, radius: 1.46, scale: 1.36, yaw: 3.45 },
  { angle: 5.57, radius: 1.60, scale: 1.10, yaw: 0.85 },
];

// Ferns form a few loose pockets around the oasis instead of an artificial-looking ring.
// Keep them at authored scale; rotation and spacing provide the variation.
const FERN_LAYOUT = [
  { angle: 0.18, radius: 1.24, scale: 1.00, yaw: 0.35 },
  { angle: 0.52, radius: 1.42, scale: 1.00, yaw: 2.15 },
  { angle: 0.78, radius: 1.31, scale: 1.00, yaw: 4.50 },
  { angle: 2.18, radius: 1.29, scale: 1.00, yaw: 1.05 },
  { angle: 2.48, radius: 1.51, scale: 1.00, yaw: 3.80 },
  { angle: 3.78, radius: 1.33, scale: 1.00, yaw: 5.55 },
  { angle: 4.08, radius: 1.57, scale: 1.00, yaw: 2.65 },
  { angle: 5.22, radius: 1.27, scale: 1.00, yaw: 4.10 },
  { angle: 5.54, radius: 1.48, scale: 1.00, yaw: 0.90 },
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
  const ferns = radialPositions(FERN_LAYOUT);

  const bushGroup = new THREE.Group();
  bushGroup.name = 'Berry bushes';
  group.add(bushGroup);

  const treeGroup = new THREE.Group();
  treeGroup.name = 'Alien desert trees';
  group.add(treeGroup);

  const fernGroup = new THREE.Group();
  fernGroup.name = 'Purple alien ferns';
  group.add(fernGroup);

  let bushLoadStarted = false;
  let treeLoadStarted = false;
  let fernLoadStarted = false;
  let bushesReady = false;
  let treesReady = false;
  let fernsReady = false;

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
    const base = `${import.meta.env.BASE_URL}models/vegetation/alien-tree/`;

    Promise.all(TREE_LODS.map(async level => {
      const gltf = await loader.loadAsync(`${base}${level.file}`);
      const source = gltf.scene;
      source.updateMatrixWorld(true);
      disableModelShadows(source);
      return { ...level, source };
    })).then(levels => {
      for (let i = 0; i < trees.length; i++) {
        const item = trees[i];
        const lod = new THREE.LOD();
        lod.name = `Alien desert tree ${i + 1}`;
        lod.position.set(item.x, field.sample(item.x, item.z) - 0.02, item.z);
        lod.rotation.y = item.yaw;
        lod.scale.setScalar(item.scale);
        lod.userData.oasisTree = true;

        for (const level of levels) {
          const model = level.source.clone(true);
          model.userData.oasisTree = true;
          lod.addLevel(model, level.distance);
        }

        treeGroup.add(lod);
      }
      treesReady = true;
    }).catch(error => {
      console.warn('[Oasis vegetation] Alien desert tree LOD models unavailable.', error);
    });
  }

  function ensureFerns() {
    if (fernLoadStarted) return;
    fernLoadStarted = true;
    const loader = new GLTFLoader();
    const base = `${import.meta.env.BASE_URL}models/vegetation/purple-alien-fern/`;

    Promise.all(FERN_LODS.map(async level => {
      const gltf = await loader.loadAsync(`${base}${level.file}`);
      const source = gltf.scene;
      source.updateMatrixWorld(true);
      disableModelShadows(source);
      return { ...level, source };
    })).then(levels => {
      for (let i = 0; i < ferns.length; i++) {
        const item = ferns[i];
        const lod = new THREE.LOD();
        lod.name = `Purple alien fern ${i + 1}`;
        lod.position.set(item.x, field.sample(item.x, item.z) - 0.015, item.z);
        lod.rotation.y = item.yaw;
        lod.scale.setScalar(item.scale);
        lod.userData.oasisFern = true;

        for (const level of levels) {
          const model = level.source.clone(true);
          model.userData.oasisFern = true;
          lod.addLevel(model, level.distance);
        }

        fernGroup.add(lod);
      }
      fernsReady = true;
    }).catch(error => {
      console.warn('[Oasis vegetation] Purple alien fern LOD models unavailable.', error);
    });
  }

  function update(x, z) {
    const distance = Math.hypot(x - WATER.x, z - WATER.z);
    bushGroup.visible = distance < BUSH_DRAW_DISTANCE;
    treeGroup.visible = distance < TREE_DRAW_DISTANCE;
    fernGroup.visible = distance < FERN_DRAW_DISTANCE;
    if (distance < BUSH_LOAD_DISTANCE) ensureBushes();
    if (distance < TREE_LOAD_DISTANCE) ensureTrees();
    if (distance < FERN_LOAD_DISTANCE) ensureFerns();
  }

  update(0, 0);
  return {
    group,
    update,
    bushGroup,
    treeGroup,
    fernGroup,
    get bushesReady() { return bushesReady; },
    get treesReady() { return treesReady; },
    get fernsReady() { return fernsReady; },
  };
}
