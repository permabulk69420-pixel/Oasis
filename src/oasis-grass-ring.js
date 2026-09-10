import * as THREE from 'three';
import { WATER, grassCover, noise } from './world.js';

// Short, semi-realistic oasis grass for standalone Quest.
// One rich tuft occupies more visual space than a single blade, so the ring can stay dense-looking
// without brute-forcing tens of thousands of separate instances.
const MAX_TUFTS = 7600;
const GENERATION_ATTEMPTS = 52000;
const BASE_HEIGHT = 0.20; // metres
const NEAR_DISTANCE = 24;
const MID_DISTANCE = 58;
const FAR_DISTANCE = 135;
const MOVE_REBUILD_DISTANCE = 1.75;

const FULL_BLADES = 9;
const MID_BLADES = 5;
const FAR_BLADES = 3;

function seededRandom(seed = 0x8a51f2d3) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createTuftGeometry(bladeCount, spread = 1) {
  const positions = [];
  const colors = [];
  const indices = [];

  // Geometry is authored at one metre and uniformly scaled per instance to ~20 cm.
  // Each blade is a tapered three-triangle ribbon with a real sideways lean.
  for (let blade = 0; blade < bladeCount; blade++) {
    const angle = (blade / bladeCount) * Math.PI * 2 + Math.sin(blade * 4.71) * 0.19;
    const sideX = Math.cos(angle);
    const sideZ = Math.sin(angle);
    const tangentX = -sideZ;
    const tangentZ = sideX;
    const radial = (0.045 + (blade % 3) * 0.018) * spread;
    const lean = (0.22 + (blade % 4) * 0.045) * spread;
    const width = 0.072 + (blade % 2) * 0.012;
    const height = 0.88 + (blade % 5) * 0.035;

    const rootX = sideX * radial;
    const rootZ = sideZ * radial;
    const midX = rootX + sideX * lean * 0.34;
    const midZ = rootZ + sideZ * lean * 0.34;
    const tipX = rootX + sideX * lean;
    const tipZ = rootZ + sideZ * lean;
    const base = positions.length / 3;

    positions.push(
      rootX - tangentX * width * 0.50, 0, rootZ - tangentZ * width * 0.50,
      rootX + tangentX * width * 0.50, 0, rootZ + tangentZ * width * 0.50,
      midX - tangentX * width * 0.34, height * 0.56, midZ - tangentZ * width * 0.34,
      midX + tangentX * width * 0.34, height * 0.56, midZ + tangentZ * width * 0.34,
      tipX, height, tipZ,
    );

    // Slight vertical colour gradient gives the little ribbons more depth without textures.
    colors.push(
      0.46, 0.58, 0.24,
      0.46, 0.58, 0.24,
      0.62, 0.72, 0.31,
      0.62, 0.72, 0.31,
      0.76, 0.82, 0.39,
    );

    indices.push(
      base, base + 2, base + 1,
      base + 1, base + 2, base + 3,
      base + 2, base + 4, base + 3,
    );
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildTuftLayout(field) {
  const random = seededRandom();
  const tufts = [];
  const extentX = WATER.radiusX * 2.16;
  const extentZ = WATER.radiusZ * 2.16;

  for (let attempt = 0; attempt < GENERATION_ATTEMPTS && tufts.length < MAX_TUFTS; attempt++) {
    const x = WATER.x + (random() * 2 - 1) * extentX;
    const z = WATER.z + (random() * 2 - 1) * extentZ;
    const cover = grassCover(x, z);
    if (cover <= 0.04) continue;

    // Patchiness prevents a synthetic carpet. The terrain PBR grass remains visible in the gaps.
    const patch = 0.68 + noise(x * 0.105 + 37, z * 0.105 - 19) * 0.46;
    if (random() > Math.min(1, cover * patch)) continue;

    const heightScale = 0.70 + random() * 0.55; // ~14–25 cm around the 20 cm nominal height.
    const yaw = random() * Math.PI * 2;
    const tint = random();
    const lodHash = random();
    tufts.push({
      x,
      z,
      y: field.sample(x, z) + 0.008,
      heightScale,
      yaw,
      tint,
      lodHash,
    });
  }
  return tufts;
}

function createMesh(geometry, material, capacity, name) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = name;
  mesh.count = 0;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // The instances move between LOD batches; distance culling already keeps these cheap and avoids
  // stale InstancedMesh bounds incorrectly hiding a whole batch on mobile/Quest browsers.
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

export function createOasisGrassRing({ field }) {
  const group = new THREE.Group();
  group.name = 'Oasis short grass ring';

  const material = new THREE.MeshLambertMaterial({
    color: 0xb8c46f,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  material.name = 'Short oasis grass';

  const fullGeometry = createTuftGeometry(FULL_BLADES, 1.0);
  const midGeometry = createTuftGeometry(MID_BLADES, 0.94);
  const farGeometry = createTuftGeometry(FAR_BLADES, 0.88);
  const tufts = buildTuftLayout(field);

  const full = createMesh(fullGeometry, material, tufts.length, 'Grass tufts — near');
  const mid = createMesh(midGeometry, material, tufts.length, 'Grass tufts — mid');
  const far = createMesh(farGeometry, material, tufts.length, 'Grass tufts — far');
  group.add(full, mid, far);

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Euler(0, 0, 0, 'YXZ');
  const tint = new THREE.Color();
  let lastX = Infinity;
  let lastZ = Infinity;
  let stats = { near: 0, mid: 0, far: 0, triangles: 0 };

  function writeInstance(mesh, index, tuft, lodScale) {
    position.set(tuft.x, tuft.y, tuft.z);
    rotation.set(0, tuft.yaw, 0);
    quaternion.setFromEuler(rotation);
    const s = BASE_HEIGHT * tuft.heightScale * lodScale;
    scale.setScalar(s);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);

    // Narrow natural variation, intentionally much less saturated than the alien foliage.
    const hue = 0.205 + (tuft.tint - 0.5) * 0.035;
    const saturation = 0.34 + tuft.tint * 0.08;
    const lightness = 0.62 + (tuft.tint - 0.5) * 0.08;
    tint.setHSL(hue, saturation, lightness);
    mesh.setColorAt(index, tint);
  }

  function update(playerX, playerZ, force = false) {
    const movedX = playerX - lastX;
    const movedZ = playerZ - lastZ;
    if (!force && movedX * movedX + movedZ * movedZ < MOVE_REBUILD_DISTANCE * MOVE_REBUILD_DISTANCE) return;
    lastX = playerX;
    lastZ = playerZ;

    let nearCount = 0;
    let midCount = 0;
    let farCount = 0;
    const nearSq = NEAR_DISTANCE * NEAR_DISTANCE;
    const midSq = MID_DISTANCE * MID_DISTANCE;
    const farSq = FAR_DISTANCE * FAR_DISTANCE;

    for (const tuft of tufts) {
      const dx = tuft.x - playerX;
      const dz = tuft.z - playerZ;
      const distanceSq = dx * dx + dz * dz;

      if (distanceSq < nearSq) {
        writeInstance(full, nearCount++, tuft, 1.0);
      } else if (distanceSq < midSq) {
        // Tiny grass no longer needs every tuft once it occupies only a few pixels in VR.
        if (tuft.lodHash < 0.72) writeInstance(mid, midCount++, tuft, 0.98);
      } else if (distanceSq < farSq) {
        if (tuft.lodHash < 0.34) writeInstance(far, farCount++, tuft, 0.94);
      }
    }

    full.count = nearCount;
    mid.count = midCount;
    far.count = farCount;
    full.instanceMatrix.needsUpdate = true;
    mid.instanceMatrix.needsUpdate = true;
    far.instanceMatrix.needsUpdate = true;
    if (full.instanceColor) full.instanceColor.needsUpdate = true;
    if (mid.instanceColor) mid.instanceColor.needsUpdate = true;
    if (far.instanceColor) far.instanceColor.needsUpdate = true;

    stats = {
      near: nearCount,
      mid: midCount,
      far: farCount,
      triangles: nearCount * FULL_BLADES * 3 + midCount * MID_BLADES * 3 + farCount * FAR_BLADES * 3,
    };
  }

  function dispose() {
    fullGeometry.dispose();
    midGeometry.dispose();
    farGeometry.dispose();
    material.dispose();
  }

  return {
    group,
    update,
    dispose,
    getStats: () => ({ ...stats, generated: tufts.length }),
  };
}
