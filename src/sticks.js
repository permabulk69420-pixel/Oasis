import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SPAWN } from './world.js';

const STICK_URL = `${import.meta.env.BASE_URL}models/stick/dead_ground_stick_vr_thin.glb`;

const STICK_LAYOUT = [
  { dx: 2.8, dz: 1.9, yaw: 0.35, scale: 0.98 },
  { dx: -3.5, dz: 2.6, yaw: 2.10, scale: 1.04 },
  { dx: 4.7, dz: -3.1, yaw: 4.55, scale: 0.94 },
  { dx: -5.2, dz: -2.4, yaw: 1.25, scale: 1.07 },
  { dx: 6.9, dz: 3.8, yaw: 5.35, scale: 1.00 },
  { dx: -7.6, dz: 4.9, yaw: 3.65, scale: 0.96 },
];

export function createGroundSticks({ field, onError = console.warn }) {
  if (!field?.sample) throw new Error('Ground sticks require the Oasis height field.');

  const group = new THREE.Group();
  group.name = 'Loose ground sticks';

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
      const x = SPAWN.x + item.dx;
      const z = SPAWN.z + item.dz;
      stick.name = `Loose stick ${i + 1}`;
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
