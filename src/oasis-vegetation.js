import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WATER, basinRadius, grassCover, noise } from './world.js';

const GRASS_TUFT_COUNT = 1400;
const GRASS_DRAW_DISTANCE = 120;
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

function seededRandom(seed = 0x6f617369) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function bushPositions() {
  return BUSH_LAYOUT.map(item => ({
    ...item,
    x: WATER.x + Math.cos(item.angle) * WATER.radiusX * item.radius,
    z: WATER.z + Math.sin(item.angle) * WATER.radiusZ * item.radius,
  }));
}

function createTuftGeometry() {
  const positions = [];
  const indices = [];
  const bladeCount = 6;

  // Six tapered blades make a readable tuft without alpha blending or texture overdraw.
  // Each blade is only three triangles and the material is double-sided.
  for (let i = 0; i < bladeCount; i++) {
    const angle = i * Math.PI / bladeCount + (i % 2) * 0.17;
    const sideX = Math.cos(angle), sideZ = Math.sin(angle);
    const leanAngle = angle + 1.13 + (i % 3) * 0.42;
    const leanX = Math.cos(leanAngle), leanZ = Math.sin(leanAngle);
    const spread = 0.025 + (i % 3) * 0.012;
    const centerX = Math.cos(angle + Math.PI * 0.5) * spread;
    const centerZ = Math.sin(angle + Math.PI * 0.5) * spread;
    const width = 0.050 - (i % 2) * 0.008;
    const base = positions.length / 3;

    positions.push(
      centerX - sideX * width, 0.00, centerZ - sideZ * width,
      centerX + sideX * width, 0.00, centerZ + sideZ * width,
      centerX + leanX * 0.018 - sideX * width * 0.46, 0.58, centerZ + leanZ * 0.018 - sideZ * width * 0.46,
      centerX + leanX * 0.018 + sideX * width * 0.46, 0.58, centerZ + leanZ * 0.018 + sideZ * width * 0.46,
      centerX + leanX * 0.065, 1.00, centerZ + leanZ * 0.065,
    );
    indices.push(
      base, base + 1, base + 2,
      base + 1, base + 3, base + 2,
      base + 2, base + 3, base + 4,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createGrassTufts(field, bushes) {
  const geometry = createTuftGeometry();
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.96,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, GRASS_TUFT_COUNT);
  mesh.name = 'Oasis grass tufts — instanced';
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  const random = seededRandom();
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const lush = new THREE.Color(0x526f24);
  const dry = new THREE.Color(0x8a8a3d);
  const yAxis = new THREE.Vector3(0, 1, 0);
  let count = 0;

  for (let attempt = 0; attempt < 18000 && count < GRASS_TUFT_COUNT; attempt++) {
    const x = WATER.x + (random() * 2 - 1) * WATER.radiusX * 1.78;
    const z = WATER.z + (random() * 2 - 1) * WATER.radiusZ * 1.78;
    const cover = grassCover(x, z);
    if (cover < 0.08) continue;

    const patch = 0.38 + noise(x * 0.10 + 11, z * 0.10 - 7) * 0.62;
    let nearBush = 0;
    for (const bush of bushes) {
      const distance = Math.hypot(x - bush.x, z - bush.z);
      nearBush = Math.max(nearBush, 1 - Math.min(distance / 4.5, 1));
    }
    const chance = Math.min(0.92, cover * (0.34 + patch * 0.52 + nearBush * 0.28));
    if (random() > chance) continue;

    const r = basinRadius(x, z);
    const outer = THREE.MathUtils.clamp((r - 1.22) / 0.48, 0, 1);
    const height = (0.20 + random() * 0.24) * (1 - outer * 0.22);
    const width = 0.78 + random() * 0.46;
    position.set(x, field.sample(x, z) + 0.018, z);
    quaternion.setFromAxisAngle(yAxis, random() * Math.PI * 2);
    scale.set(width, height, width);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(count, matrix);

    color.copy(lush).lerp(dry, outer * 0.72 + random() * 0.14);
    color.multiplyScalar(0.84 + random() * 0.24);
    mesh.setColorAt(count, color);
    count++;
  }

  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return mesh;
}

export function createOasisVegetation({ field }) {
  const group = new THREE.Group();
  group.name = 'Oasis vegetation';

  const bushes = bushPositions();
  const grass = createGrassTufts(field, bushes);
  group.add(grass);

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
    grass.visible = distance < GRASS_DRAW_DISTANCE;
    bushGroup.visible = distance < BUSH_DRAW_DISTANCE;
    if (distance < BUSH_LOAD_DISTANCE) ensureBushes();
  }

  update(0, 0);
  return { group, update, grass, bushGroup, get bushesReady() { return bushesReady; } };
}
