import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WATER } from './world.js';

const TREE_SCALE = 2.0;
const TREE_LODS = [
  { file: 'blue_alien_tree.glb', distance: 0 },
  { file: 'blue_alien_tree_optimized_code.glb', distance: 18 },
  { file: 'blue_alien_tree_lod3_ultra.glb', distance: 45 },
];

// Use the old fern locations exactly. Every replacement tree uses the same 2x scale.
const REPLACEMENT_LAYOUT = [
  { angle: 0.18, radius: 1.24 },
  { angle: 0.52, radius: 1.42 },
  { angle: 0.78, radius: 1.31 },
  { angle: 2.18, radius: 1.29 },
  { angle: 2.48, radius: 1.51 },
  { angle: 3.78, radius: 1.33 },
  { angle: 4.08, radius: 1.57 },
  { angle: 5.22, radius: 1.27 },
  { angle: 5.54, radius: 1.48 },
];

function disableModelShadows(root) {
  root.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = false;
    object.receiveShadow = false;
  });
}

export function addFernReplacementTrees({ field, treeGroup, onError = console.warn }) {
  if (!field?.sample || !treeGroup) throw new Error('Fern replacement trees require the Oasis height field and tree group.');

  const loader = new GLTFLoader();
  const base = `${import.meta.env.BASE_URL}models/vegetation/alien-tree/`;

  Promise.all(TREE_LODS.map(async level => {
    const gltf = await loader.loadAsync(`${base}${level.file}`);
    const source = gltf.scene;
    source.updateMatrixWorld(true);
    disableModelShadows(source);
    return { ...level, source };
  })).then(levels => {
    for (let i = 0; i < REPLACEMENT_LAYOUT.length; i++) {
      const item = REPLACEMENT_LAYOUT[i];
      const x = WATER.x + Math.cos(item.angle) * WATER.radiusX * item.radius;
      const z = WATER.z + Math.sin(item.angle) * WATER.radiusZ * item.radius;

      const lod = new THREE.LOD();
      lod.name = `Alien desert tree replacement ${i + 1}`;
      lod.position.set(x, field.sample(x, z) - 0.02, z);
      lod.rotation.y = 0;
      lod.scale.setScalar(TREE_SCALE);
      lod.userData.oasisTree = true;

      for (const level of levels) {
        const model = level.source.clone(true);
        model.userData.oasisTree = true;
        lod.addLevel(model, level.distance);
      }

      treeGroup.add(lod);
    }
  }).catch(error => {
    onError(`[Oasis vegetation] Replacement alien trees unavailable: ${error?.message || error}`);
  });
}
