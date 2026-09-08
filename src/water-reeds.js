import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WATER } from './world.js';

const REED_DRAW_DISTANCE = 150;
const REED_LOAD_DISTANCE = 190;

const REED_LODS = [
  { file: 'water_reeds_patch.glb', distance: 0 },
  { file: 'water_reeds_patch_lod1.glb', distance: 30 },
];

// One compact 2 × 2-ish patch on the near shoreline. The source GLB is about 1.7 m wide,
// so these overlapping offsets read as a single 3–4 m clump instead of four obvious copies.
const CLUSTER_CENTER = Object.freeze({
  x: WATER.x - 8.0,
  z: WATER.z + WATER.radiusZ * 0.92,
});

const REED_LAYOUT = Object.freeze([
  Object.freeze({ dx: -0.95, dz: -0.70, yaw: 0.18, scale: 1.00 }),
  Object.freeze({ dx:  0.82, dz: -0.46, yaw: 1.62, scale: 0.97 }),
  Object.freeze({ dx: -0.58, dz:  0.92, yaw: 3.08, scale: 1.04 }),
  Object.freeze({ dx:  1.05, dz:  0.88, yaw: 4.72, scale: 0.99 }),
]);

function makeSwayMaterial(sourceMaterial) {
  const material = sourceMaterial.clone();
  material.name = sourceMaterial.name ? `${sourceMaterial.name} — reed sway` : 'Water reed sway';

  material.onBeforeCompile = shader => {
    shader.uniforms.uReedTime = { value: 0 };
    material.userData.reedSwayShader = shader;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uReedTime;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float reedHeight = clamp((position.y + 0.02) / 1.75, 0.0, 1.0);
        float reedWeight = reedHeight * reedHeight * (3.0 - 2.0 * reedHeight);
        float reedPhase = uReedTime * 0.82
          + modelMatrix[3].x * 0.071
          + modelMatrix[3].z * 0.083
          + position.x * 0.63
          + position.z * 0.47;
        float reedSway = (sin(reedPhase) + 0.32 * sin(reedPhase * 1.91 + 1.4))
          * 0.045 * reedWeight;
        transformed.x += reedSway;
        transformed.z += reedSway * 0.38;`,
      );
  };

  // Three.js includes this in the shader-program cache key. The sway patch must not share a
  // compiled program with the unmodified material from the GLB.
  material.customProgramCacheKey = () => 'oasis-water-reeds-sway-v1';
  material.needsUpdate = true;
  return material;
}

function prepareSwayingSource(root) {
  const materialCache = new Map();

  root.traverse(object => {
    if (!object.isMesh) return;

    object.castShadow = false;
    object.receiveShadow = false;

    const replaceMaterial = sourceMaterial => {
      if (!materialCache.has(sourceMaterial)) materialCache.set(sourceMaterial, makeSwayMaterial(sourceMaterial));
      return materialCache.get(sourceMaterial);
    };

    object.material = Array.isArray(object.material)
      ? object.material.map(replaceMaterial)
      : replaceMaterial(object.material);

    // Keep animation fully on the GPU. This callback only changes one tiny time uniform before
    // rendering; no reed vertices or transforms are touched on the CPU each frame.
    object.onBeforeRender = () => {
      const now = performance.now() * 0.001;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        const shader = material.userData.reedSwayShader;
        if (shader) shader.uniforms.uReedTime.value = now;
      }
    };
  });

  root.updateMatrixWorld(true);
}

export function createWaterReeds({ field }) {
  const group = new THREE.Group();
  group.name = 'Water reeds — 4 patch cluster';

  let loadStarted = false;
  let ready = false;

  function ensureLoaded() {
    if (loadStarted) return;
    loadStarted = true;

    const loader = new GLTFLoader();
    const base = `${import.meta.env.BASE_URL}models/vegetation/water-reeds/`;

    Promise.all(REED_LODS.map(async level => {
      const gltf = await loader.loadAsync(`${base}${level.file}`);
      const source = gltf.scene;
      prepareSwayingSource(source);
      return { ...level, source };
    })).then(levels => {
      for (let i = 0; i < REED_LAYOUT.length; i++) {
        const item = REED_LAYOUT[i];
        const x = CLUSTER_CENTER.x + item.dx;
        const z = CLUSTER_CENTER.z + item.dz;

        const lod = new THREE.LOD();
        lod.name = `Water reeds ${i + 1}`;
        lod.position.set(x, field.sample(x, z) - 0.07, z);
        lod.rotation.y = item.yaw;
        lod.scale.setScalar(item.scale);
        lod.userData.oasisWaterReeds = true;

        for (const level of levels) {
          const model = level.source.clone(true);
          model.userData.oasisWaterReeds = true;
          lod.addLevel(model, level.distance);
        }

        group.add(lod);
      }
      ready = true;
    }).catch(error => {
      console.warn('[Water reeds] Reed LOD models unavailable.', error);
    });
  }

  function update(x, z) {
    const distance = Math.hypot(x - CLUSTER_CENTER.x, z - CLUSTER_CENTER.z);
    group.visible = distance < REED_DRAW_DISTANCE;
    if (distance < REED_LOAD_DISTANCE) ensureLoaded();
  }

  return {
    group,
    update,
    get ready() { return ready; },
  };
}
