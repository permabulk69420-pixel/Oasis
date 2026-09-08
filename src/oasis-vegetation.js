import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WATER } from './world.js';

const BUSH_DRAW_DISTANCE = 180;
const BUSH_LOAD_DISTANCE = 230;

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

function bushPositions() {
  return BUSH_LAYOUT.map(item => ({
    ...item,
    x: WATER.x + Math.cos(item.angle) * WATER.radiusX * item.radius,
    z: WATER.z + Math.sin(item.angle) * WATER.radiusZ * item.radius,
  }));
}

export function createOasisVegetation({ field }) {
  const group = new THREE.Group();
  group.name = 'Oasis vegetation';

  const bushes = bushPositions();
  const bushGroup = new THREE.Group();
  bushGroup.name = 'Berry bushes';
  group.add(bushGroup);

  let bushLoadStarted = false;
  let bushesReady = false;

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
        bush.traverse(object => {
          if (!object.isMesh) return;
          object.castShadow = false;
          object.receiveShadow = false;
        });
        bushGroup.add(bush);
      }
      bushesReady = true;
    }, undefined, error => {
      console.warn('[Oasis vegetation] Berry bush model unavailable.', error);
    });
  }

  function update(x, z) {
    const distance = Math.hypot(x - WATER.x, z - WATER.z);
    bushGroup.visible = distance < BUSH_DRAW_DISTANCE;
    if (distance < BUSH_LOAD_DISTANCE) ensureBushes();
  }

  update(0, 0);
  return { group, update, bushGroup, get bushesReady() { return bushesReady; } };
}
