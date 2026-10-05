import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { addWindSwayToModel, SWAY } from './wind.js';
import { applySurfaceTextures } from './surface-textures.js';
import { pickTreeSet, levelDistance } from './tree-sets.js';
import { createInstancedLods } from './instanced-lods.js';

// The island's palms: the oasis's own blue palm models (three levels of detail, nothing new to download for anyone who has been to the
// oasis), set out by sky-island-layout.js (grouped into a grove and a few strays). They are scenery for now: not choppable, no projected shadow. They load when you are within
// LOAD_DISTANCE of the island (flat distance), because from the desert floor the top cannot be seen at all.
// All of them are drawn instanced (src/instanced-lods.js): a level of the palm is one mesh per material for every palm at that level, so about 90 palms cost at most six
// draw calls (each used to be its own LOD object with two, which made the grove 120 calls on its own).
const LOAD_DISTANCE = 700;
const EYE_HEIGHT = 1.7; // used when the caller does not say how high the eye is
const TREE_SET = pickTreeSet(globalThis.location?.search || '');

export function createSkyIslandTrees({ island, layout }) {
  const group = new THREE.Group();
  group.name = 'Sky island palms';
  let started = false;
  let ready = false;
  let lods = null;

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
      lods = createInstancedLods({
        name: 'Sky island palms',
        levels: levels.map(level => ({ source: level.source, distanceFor: scale => levelDistance(TREE_SET, level, scale) })),
        items: layout.map(item => ({ x: item.x, y: island.groundHeight(item.x, item.z) - 0.02, z: item.z, yaw: item.yaw, scale: item.scale })),
      });
      group.add(lods.group);
      ready = true;
    }).catch(error => console.warn('[Oasis sky island] Palm models unavailable.', error));
  }

  return {
    group, layout,
    get ready() { return ready; },
    get lods() { return lods; },
    // x, z: where you are; y: how high your eye is (optional)
    update(x, z, y) {
      const near = Math.hypot(x - island.config.x, z - island.config.z) < LOAD_DISTANCE;
      if (near && !started) load();
      group.visible = near;
      if (near && lods) lods.update(x, y ?? (island.groundHeight(x, z) ?? island.baseY) + EYE_HEIGHT, z);
    },
  };
}
