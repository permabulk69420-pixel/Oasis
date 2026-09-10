import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WATER } from './world.js';

const HIGH_URL = `${import.meta.env.BASE_URL}models/alien_desert_plant/alien_desert_plant_UV%20(1).glb`;
const LOW_URL = `${import.meta.env.BASE_URL}models/alien_desert_plant/alien_desert_plant_LOD1_UV.glb`;
const LOD_DISTANCE = 30;
const CULL_DISTANCE = 145;

const LAYOUT = [
  { angle: 0.60, radius: 1.50, yaw: 0.35, scale: 3.0 },
  { angle: 2.05, radius: 1.67, yaw: 2.20, scale: 3.0 },
  { angle: 3.72, radius: 1.54, yaw: 4.40, scale: 3.0 },
  { angle: 5.18, radius: 1.73, yaw: 5.55, scale: 3.0 },
];

function prepareSource(source) {
  source.updateMatrixWorld(true);
  source.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = false;
    object.receiveShadow = false;
  });
  return {
    source,
    bottom: new THREE.Box3().setFromObject(source).min.y,
  };
}

export function createAlienDesertPlants({ field, onError = console.warn }) {
  if (!field?.sample) throw new Error('Alien desert plants require the Oasis height field.');

  const group = new THREE.Group();
  group.name = 'Alien desert plants';
  const plants = [];
  const loader = new GLTFLoader();

  Promise.all([
    loader.loadAsync(HIGH_URL),
    loader.loadAsync(LOW_URL),
  ]).then(([highGltf, lowGltf]) => {
    const highSource = prepareSource(highGltf.scene);
    const lowSource = prepareSource(lowGltf.scene);

    for (let i = 0; i < LAYOUT.length; i++) {
      const item = LAYOUT[i];
      const x = WATER.x + Math.cos(item.angle) * WATER.radiusX * item.radius;
      const z = WATER.z + Math.sin(item.angle) * WATER.radiusZ * item.radius;
      const groundY = field.sample(x, z);

      const root = new THREE.Group();
      root.name = `Alien desert plant ${i + 1}`;
      root.position.set(x, groundY, z);
      root.rotation.y = item.yaw;

      const high = highSource.source.clone(true);
      high.name = 'High LOD';
      high.scale.setScalar(item.scale);
      high.position.y = -highSource.bottom * item.scale;

      const low = lowSource.source.clone(true);
      low.name = 'Low LOD';
      low.scale.setScalar(item.scale);
      low.position.y = -lowSource.bottom * item.scale;
      low.visible = false;

      root.add(high, low);
      group.add(root);
      plants.push({ root, high, low });
    }
  }).catch(error => {
    onError(`[Oasis alien plants] Failed to load plant LODs: ${error?.message || error}`);
  });

  function update(playerX, playerZ) {
    const lodSq = LOD_DISTANCE * LOD_DISTANCE;
    const cullSq = CULL_DISTANCE * CULL_DISTANCE;

    for (const plant of plants) {
      const dx = plant.root.position.x - playerX;
      const dz = plant.root.position.z - playerZ;
      const distanceSq = dx * dx + dz * dz;
      const visible = distanceSq <= cullSq;
      plant.root.visible = visible;
      if (!visible) continue;

      const useHigh = distanceSq < lodSq;
      plant.high.visible = useHigh;
      plant.low.visible = !useHigh;
    }
  }

  return { group, update };
}
