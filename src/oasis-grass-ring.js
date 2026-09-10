import * as THREE from 'three';
import { WATER, grassCover, noise } from './world.js';

// Short semi-realistic oasis grass for standalone Quest.
// Important: height and footprint are intentionally decoupled. The mobile prototype looked full
// because each short-ish cluster occupied a broad patch of ground. Uniformly shrinking the whole
// tuft to 20 cm made the first Oasis pass look like sparse pins, so these blades stay ~15–25 cm tall
// while fanning/leaning across a much wider ~35–55 cm footprint.
const MAX_TUFTS = 18000;
const GENERATION_ATTEMPTS = 85000;
const NEAR_DISTANCE = 28;
const MID_DISTANCE = 68;
const FAR_DISTANCE = 150;
const MOVE_REBUILD_DISTANCE = 1.75;

const FULL_BLADES = 10;
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

// This deliberately mirrors the mobile proof-of-concept geometry: curved two-segment ribbons
// radiating from a small base, with substantial sideways lean. Geometry is authored around 1 m
// vertically and then instances use a small Y scale but a much larger X/Z scale.
function createTuftGeometry(bladeCount, segments, rich) {
  const positions = [];
  const indices = [];
  let vertexIndex = 0;

  for (let blade = 0; blade < bladeCount; blade++) {
    const angle = (blade / bladeCount) * Math.PI * 2 + ((blade % 3) - 1) * 0.12;
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    const baseRadius = 0.035 + (blade % 4) * 0.026;
    const rootX = dirX * baseRadius;
    const rootZ = dirZ * baseRadius;
    const height = (rich ? 0.72 : 0.66) + ((blade * 37) % 7) / 7 * (rich ? 0.28 : 0.20);
    const lean = (rich ? 0.18 : 0.14) + ((blade * 19) % 5) / 5 * (rich ? 0.20 : 0.12);
    const width = (rich ? 0.027 : 0.030) + ((blade * 13) % 3) * 0.004;

    for (let segment = 0; segment <= segments; segment++) {
      const t = segment / segments;
      const curve = t * t;
      const y = height * t;
      const centerX = rootX + dirX * lean * curve;
      const centerZ = rootZ + dirZ * lean * curve;
      const taper = 1 - t * 0.86;
      const widthX = -dirZ * width * taper;
      const widthZ = dirX * width * taper;
      positions.push(
        centerX - widthX, y, centerZ - widthZ,
        centerX + widthX, y, centerZ + widthZ,
      );
    }

    for (let segment = 0; segment < segments; segment++) {
      const a = vertexIndex + segment * 2;
      const c = a + 2;
      indices.push(a, a + 1, c, a + 1, c + 1, c);
    }
    vertexIndex += (segments + 1) * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildTuftLayout(field) {
  const random = seededRandom();
  const tufts = [];
  const inner = 1.10;
  const outer = 2.10;

  for (let attempt = 0; attempt < GENERATION_ATTEMPTS && tufts.length < MAX_TUFTS; attempt++) {
    // Area-correct elliptical-annulus sampling keeps the candidate density even while still using
    // the real grassCover() function as the final shoreline/shelf mask.
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(inner * inner + random() * (outer * outer - inner * inner));
    const x = WATER.x + Math.cos(angle) * WATER.radiusX * radius;
    const z = WATER.z + Math.sin(angle) * WATER.radiusZ * radius;
    const cover = grassCover(x, z);
    if (cover <= 0.04) continue;

    // Keep natural pockets and gaps, but much less aggressively than the first repo pass. The
    // existing PBR grass terrain texture remains visible underneath and bridges small holes.
    const patch = noise(x * 0.105 + 37, z * 0.105 - 19);
    if (patch < 0.18 && random() > 0.34) continue;
    if (random() > Math.min(1, 0.40 + cover * 0.78)) continue;

    tufts.push({
      x,
      z,
      y: field.sample(x, z) + 0.012,
      yaw: random() * Math.PI * 2,
      // Y controls blade height; X/Z control visual footprint. Keeping them separate is the key
      // difference from the bad first implementation.
      verticalScale: 0.205 + random() * 0.055,
      horizontalScale: 0.50 + random() * 0.18,
      stretchX: 0.90 + random() * 0.20,
      stretchZ: 0.90 + random() * 0.20,
      tiltX: (random() - 0.5) * 0.11,
      tiltZ: (random() - 0.5) * 0.11,
      tint: random(),
      lodHash: random(),
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
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

export function createOasisGrassRing({ field }) {
  const group = new THREE.Group();
  group.name = 'Oasis short grass ring';

  // Match the mobile prototype's straightforward shaded geometry. Per-instance colour variation
  // supplies the richness; avoiding a second material tint prevents the triple-multiply dullness
  // of the first Oasis pass.
  const material = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
  });
  material.name = 'Short oasis grass';

  const fullGeometry = createTuftGeometry(FULL_BLADES, 2, true);   // 40 tris / tuft
  const midGeometry = createTuftGeometry(MID_BLADES, 1, false);   // 10 tris / tuft
  const farGeometry = createTuftGeometry(FAR_BLADES, 1, false);   // 6 tris / tuft
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

  function writeInstance(mesh, index, tuft, horizontalLodScale, verticalLodScale) {
    position.set(tuft.x, tuft.y, tuft.z);
    rotation.set(tuft.tiltX, tuft.yaw, tuft.tiltZ);
    quaternion.setFromEuler(rotation);
    scale.set(
      tuft.horizontalScale * tuft.stretchX * horizontalLodScale,
      tuft.verticalScale * verticalLodScale,
      tuft.horizontalScale * tuft.stretchZ * horizontalLodScale,
    );
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);

    // Same darker natural palette that made the mobile proof read as grass instead of pale spikes.
    const c = tuft.tint;
    tint.setRGB(0.14 + c * 0.11, 0.31 + c * 0.20, 0.045 + c * 0.055);
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
        writeInstance(full, nearCount++, tuft, 1.0, 1.0);
      } else if (distanceSq < midSq) {
        if (tuft.lodHash < 0.72) writeInstance(mid, midCount++, tuft, 0.96, 0.98);
      } else if (distanceSq < farSq) {
        if (tuft.lodHash < 0.34) writeInstance(far, farCount++, tuft, 0.92, 0.95);
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
      triangles: nearCount * 40 + midCount * 10 + farCount * 6,
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
