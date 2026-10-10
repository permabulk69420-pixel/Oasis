import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WATER } from './world.js';
import { addWindSwayToModel, SWAY } from './wind.js';
import { FERN_HARVEST, fernScale } from './fern-harvest.js';

const HIGH_URL = `${import.meta.env.BASE_URL}models/vegetation/green-fern/ark_style_fern.glb`;
const LOW_URL = `${import.meta.env.BASE_URL}models/vegetation/green-fern/ark_style_fern_lod1_fixed.glb`;
const LOD_DISTANCE = 22;
const CULL_DISTANCE = 140;
const SCALE = 1.0;

const LAYOUT = [
  { angle: 0.22, radius: 1.30 },
  { angle: 0.78, radius: 1.46 },
  { angle: 1.36, radius: 1.27 },
  { angle: 1.98, radius: 1.43 },
  { angle: 2.62, radius: 1.31 },
  { angle: 3.18, radius: 1.49 },
  { angle: 3.82, radius: 1.28 },
  { angle: 4.42, radius: 1.45 },
  { angle: 5.04, radius: 1.32 },
  { angle: 5.66, radius: 1.47 },
];

function prepareSource(source) {
  addWindSwayToModel(source, () => SWAY.fern);
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

export function createGreenFerns({ field, onError = console.warn }) {
  if (!field?.sample) throw new Error('Green ferns require the Oasis height field.');

  const group = new THREE.Group();
  group.name = 'Green ferns';
  const ferns = [];
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
      root.name = `Green fern ${i + 1}`;
      root.position.set(x, groundY, z);

      const high = highSource.source.clone(true);
      high.name = 'High LOD';
      high.scale.setScalar(SCALE);
      high.position.y = -highSource.bottom * SCALE;

      const low = lowSource.source.clone(true);
      low.name = 'Low LOD';
      low.scale.setScalar(SCALE);
      low.position.y = -lowSource.bottom * SCALE;
      low.visible = false;

      root.add(high, low);
      group.add(root);
      ferns.push({ root, high, low, x, y: groundY, z, since: Infinity }); // `since`: seconds since it was pulled (Infinity: never)
    }
  }).catch(error => {
    onError(`[Oasis green ferns] Failed to load fern LODs: ${error?.message || error}`);
  });

  // Tear fibre off one: it drops to a stub (see src/fern-harvest.js) and grows back.
  function pull(fern) {
    fern.since = 0;
    fern.root.scale.setScalar(FERN_HARVEST.stubScale);
  }

  // Every frame: the pulled ones grow back.
  function tick(dt) {
    for (const fern of ferns) {
      if (!Number.isFinite(fern.since)) continue;
      fern.since += dt;
      if (fern.since >= FERN_HARVEST.regrow) { fern.since = Infinity; fern.root.scale.setScalar(1); }
      else fern.root.scale.setScalar(fernScale(fern.since));
    }
  }

  function update(playerX, playerZ) {
    const lodSq = LOD_DISTANCE * LOD_DISTANCE;
    const cullSq = CULL_DISTANCE * CULL_DISTANCE;

    for (const fern of ferns) {
      const dx = fern.root.position.x - playerX;
      const dz = fern.root.position.z - playerZ;
      const distanceSq = dx * dx + dz * dz;
      const visible = distanceSq <= cullSq;
      fern.root.visible = visible;
      if (!visible) continue;

      const useHigh = distanceSq < lodSq;
      fern.high.visible = useHigh;
      fern.low.visible = !useHigh;
    }
  }

  return { group, update, tick, pull, ferns };
}
