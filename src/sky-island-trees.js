import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { addWindSwayToModel, SWAY } from './wind.js';
import { applySurfaceTextures } from './surface-textures.js';
import { pickTreeSet, levelDistance } from './tree-sets.js';
import { layoutSkyTrees } from './sky-island-layout.js';

// The island's palms: the oasis's own blue palm models (three levels of detail, nothing new to download for anyone who has been to the
// oasis), set out by sky-island-layout.js. They are scenery for now: not choppable, no projected shadow. They load when you are within
// LOAD_DISTANCE of the island (flat distance), because from the desert floor the top cannot be seen at all.
const LOAD_DISTANCE = 700;
const TREE_SET = pickTreeSet(globalThis.location?.search || '');

export function createSkyIslandTrees({ island }) {
  const group = new THREE.Group();
  group.name = 'Sky island palms';
  const layout = layoutSkyTrees(island.config);
  let started = false;
  let ready = false;

  function load() {
    started = true;
    const loader = new GLTFLoader();
    const base = `${import.meta.env.BASE_URL}models/vegetation/alien-tree/`;
    Promise.all(TREE_SET.levels.map(async level => {
      const gltf = await loader.loadAsync(`${base}${level.file}`);
      const source = gltf.scene;
      source.updateMatrixWorld(true);
      source.traverse(object => { if (object.isMesh) { object.castShadow = false; object.receiveShadow = false; } });
      applySurfaceTextures(source);
      addWindSwayToModel(source, material => (material.name === 'Waxy blue leaf tissue' ? SWAY.foliage : SWAY.trunk));
      return { ...level, source };
    })).then(levels => {
      layout.forEach((item, i) => {
        const lod = new THREE.LOD();
        lod.name = `Sky island palm ${i + 1}`;
        lod.position.set(item.x, island.groundHeight(item.x, item.z) - 0.02, item.z);
        lod.rotation.y = item.yaw;
        lod.scale.setScalar(item.scale);
        levels.forEach(level => lod.addLevel(level.source.clone(true), levelDistance(TREE_SET, level, item.scale)));
        group.add(lod);
      });
      ready = true;
    }).catch(error => console.warn('[Oasis sky island] Palm models unavailable.', error));
  }

  return {
    group, layout,
    get ready() { return ready; },
    update(x, z) {
      const near = Math.hypot(x - island.config.x, z - island.config.z) < LOAD_DISTANCE;
      if (near && !started) load();
      group.visible = near;
    },
  };
}
