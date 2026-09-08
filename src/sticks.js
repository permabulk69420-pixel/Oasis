import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WATER } from './world.js';

const STICK_URL = `${import.meta.env.BASE_URL}models/stick/dead_ground_stick_vr_thin.glb`;

// Sparse placements around the grassy oasis shelf. Radius is in normalized shoreline space,
// matching the vegetation layout and keeping every stick safely outside the water.
const STICK_LAYOUT = [
  { angle: 0.42, radius: 1.34, yaw: 0.35, scale: 0.98 },
  { angle: 1.38, radius: 1.48, yaw: 2.10, scale: 1.04 },
  { angle: 2.33, radius: 1.57, yaw: 4.55, scale: 0.94 },
  { angle: 3.31, radius: 1.39, yaw: 1.25, scale: 1.07 },
  { angle: 4.45, radius: 1.63, yaw: 5.35, scale: 1.00 },
  { angle: 5.58, radius: 1.46, yaw: 3.65, scale: 0.96 },
];

export function createGroundSticks({ field, onError = console.warn }) {
  if (!field?.sample) throw new Error('Ground sticks require the Oasis height field.');

  const group = new THREE.Group();
  group.name = 'Loose oasis sticks';

  const loader = new GLTFLoader();
  loader.load(STICK_URL, gltf => {
    const source = gltf.scene;
    source.name = 'Dead ground stick source';
    source.updateMatrixWorld(true);

    source.traverse(object => {
      if (!object.isMesh) return;
      object.castShadow = false;
      object.receiveShadow = false;
    });

    const bounds = new THREE.Box3().setFromObject(source);
    const sourceBottom = bounds.min.y;

    for (let i = 0; i < STICK_LAYOUT.length; i++) {
      const item = STICK_LAYOUT[i];
      const stick = source.clone(true);
      const x = WATER.x + Math.cos(item.angle) * WATER.radiusX * item.radius;
      const z = WATER.z + Math.sin(item.angle) * WATER.radiusZ * item.radius;
      stick.name = `Loose oasis stick ${i + 1}`;
      stick.position.set(
        x,
        field.sample(x, z) - sourceBottom * item.scale + 0.004,
        z,
      );
      stick.rotation.y = item.yaw;
      stick.scale.setScalar(item.scale);
      stick.userData.collectibleResource = 'stick';
      stick.userData.looseStick = true;
      group.add(stick);
    }
  }, undefined, error => {
    onError(`[Oasis sticks] Stick model failed to load: ${error?.message || error}`);
  });

  return group;
}
