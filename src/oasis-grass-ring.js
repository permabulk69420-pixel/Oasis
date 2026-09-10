import * as THREE from 'three';
import { WATER, grassCover, noise } from './world.js';

// Semi-realistic oasis grass for standalone Quest.
// This build is an isolated height test: patch footprint, density, LOD, draw calls and placement
// are unchanged from the previous build, while blade height is doubled so the visual difference
// is easy to judge in headset.
const MAX_PATCHES = 9000;
const GENERATION_ATTEMPTS = 56000;
const SECTOR_COUNT = 12;
const NEAR_SECTOR_DISTANCE = 74;
const MAX_DRAW_DISTANCE = 190;
const MOVE_REBUILD_DISTANCE = 2.25;

const RICH_BLADES = 12;
const LITE_BLADES = 6;
const RICH_TRIANGLES = RICH_BLADES * 4; // two ribbon segments per blade
const LITE_TRIANGLES = LITE_BLADES * 2; // one ribbon segment per blade

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

function fract(value) {
  return value - Math.floor(value);
}

// One instance is a grass PATCH rather than a bouquet tuft. Roots are spread over the patch and
// each blade has a small independent outward lean. The rich patch remains ~0.9-1.05 m wide, while
// this test doubles blade height from ~17-27 cm to roughly ~34-54 cm.
function createPatchGeometry(bladeCount, segments, rich) {
  const positions = [];
  const indices = [];
  let vertexIndex = 0;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let blade = 0; blade < bladeCount; blade++) {
    const radialT = Math.sqrt((blade + 0.45) / bladeCount);
    const angle = blade * goldenAngle + fract(blade * 0.381966) * 0.55;
    const rootRadius = radialT * (rich ? 0.46 : 0.43);
    const rootX = Math.cos(angle) * rootRadius;
    const rootZ = Math.sin(angle) * rootRadius;

    const leanAngle = angle + ((blade % 5) - 2) * 0.31;
    const dirX = Math.cos(leanAngle);
    const dirZ = Math.sin(leanAngle);
    const height = (rich ? 0.36 : 0.34) + ((blade * 37) % 7) / 7 * (rich ? 0.17 : 0.13);
    const lean = (rich ? 0.055 : 0.045) + ((blade * 19) % 5) / 5 * (rich ? 0.085 : 0.060);
    const width = (rich ? 0.018 : 0.021) + ((blade * 13) % 3) * 0.003;

    for (let segment = 0; segment <= segments; segment++) {
      const t = segment / segments;
      const curve = t * t;
      const centerX = rootX + dirX * lean * curve;
      const centerZ = rootZ + dirZ * lean * curve;
      const y = height * t;
      const taper = 1 - t * 0.88;
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

function buildPatchLayout(field) {
  const random = seededRandom();
  const patches = [];
  const inner = 1.10;
  const outer = 2.10;

  for (let attempt = 0; attempt < GENERATION_ATTEMPTS && patches.length < MAX_PATCHES; attempt++) {
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(inner * inner + random() * (outer * outer - inner * inner));
    const x = WATER.x + Math.cos(angle) * WATER.radiusX * radius;
    const z = WATER.z + Math.sin(angle) * WATER.radiusZ * radius;
    const cover = grassCover(x, z);
    if (cover <= 0.055) continue;

    // Preserve some broad natural variation, but do not punch conspicuous empty holes into a
    // short-grass field. The PBR grass ground texture carries the fine-scale gaps underneath.
    const patchNoise = noise(x * 0.105 + 37, z * 0.105 - 19);
    if (patchNoise < 0.11 && random() > 0.45) continue;
    if (random() > Math.min(1, 0.54 + cover * 0.68)) continue;

    const normalizedAngle = (angle + Math.PI * 2) % (Math.PI * 2);
    const sector = Math.floor(normalizedAngle / (Math.PI * 2) * SECTOR_COUNT) % SECTOR_COUNT;
    patches.push({
      x,
      z,
      y: field.sample(x, z) + 0.010,
      yaw: random() * Math.PI * 2,
      scaleX: 0.88 + random() * 0.24,
      scaleY: 0.86 + random() * 0.25,
      scaleZ: 0.88 + random() * 0.24,
      tiltX: (random() - 0.5) * 0.075,
      tiltZ: (random() - 0.5) * 0.075,
      tint: random(),
      sector,
    });
  }
  return patches;
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
  group.name = 'Oasis short grass field';

  const material = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
  });
  material.name = 'Short oasis grass';

  const richGeometry = createPatchGeometry(RICH_BLADES, 2, true);
  const liteGeometry = createPatchGeometry(LITE_BLADES, 1, false);
  const patches = buildPatchLayout(field);

  // Only two draw calls. Patches from near-facing sectors are rebuilt into the rich batch and the
  // rest into the lite batch, mirroring the successful mobile demo's sector-level LOD behaviour
  // without creating a separate mesh for every sector.
  const rich = createMesh(richGeometry, material, patches.length, 'Grass patches — rich sectors');
  const lite = createMesh(liteGeometry, material, patches.length, 'Grass patches — lite sectors');
  group.add(rich, lite);

  const sectorCenters = Array.from({ length: SECTOR_COUNT }, (_, sector) => {
    const angle = (sector + 0.5) / SECTOR_COUNT * Math.PI * 2;
    const radius = 1.58;
    return {
      x: WATER.x + Math.cos(angle) * WATER.radiusX * radius,
      z: WATER.z + Math.sin(angle) * WATER.radiusZ * radius,
    };
  });

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Euler(0, 0, 0, 'YXZ');
  const tint = new THREE.Color();
  let lastX = Infinity;
  let lastZ = Infinity;
  let stats = { rich: 0, lite: 0, triangles: 0 };

  function writeInstance(mesh, index, patch, lodScale) {
    position.set(patch.x, patch.y, patch.z);
    rotation.set(patch.tiltX, patch.yaw, patch.tiltZ);
    quaternion.setFromEuler(rotation);
    scale.set(
      patch.scaleX * lodScale,
      patch.scaleY,
      patch.scaleZ * lodScale,
    );
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);

    const c = patch.tint;
    tint.setRGB(0.14 + c * 0.11, 0.31 + c * 0.20, 0.045 + c * 0.055);
    mesh.setColorAt(index, tint);
  }

  function update(playerX, playerZ, force = false) {
    const movedX = playerX - lastX;
    const movedZ = playerZ - lastZ;
    if (!force && movedX * movedX + movedZ * movedZ < MOVE_REBUILD_DISTANCE * MOVE_REBUILD_DISTANCE) return;
    lastX = playerX;
    lastZ = playerZ;

    const sectorRich = sectorCenters.map(center =>
      Math.hypot(playerX - center.x, playerZ - center.z) < NEAR_SECTOR_DISTANCE
    );

    let richCount = 0;
    let liteCount = 0;
    const maxDrawSq = MAX_DRAW_DISTANCE * MAX_DRAW_DISTANCE;

    for (const patch of patches) {
      const dx = patch.x - playerX;
      const dz = patch.z - playerZ;
      if (dx * dx + dz * dz > maxDrawSq) continue;

      if (sectorRich[patch.sector]) {
        writeInstance(rich, richCount++, patch, 1.0);
      } else {
        // Unlike the previous per-tuft LOD, do not randomly delete most of the distant field.
        // Geometry gets cheaper, but ground coverage remains continuous.
        writeInstance(lite, liteCount++, patch, 0.98);
      }
    }

    rich.count = richCount;
    lite.count = liteCount;
    rich.instanceMatrix.needsUpdate = true;
    lite.instanceMatrix.needsUpdate = true;
    if (rich.instanceColor) rich.instanceColor.needsUpdate = true;
    if (lite.instanceColor) lite.instanceColor.needsUpdate = true;

    stats = {
      rich: richCount,
      lite: liteCount,
      triangles: richCount * RICH_TRIANGLES + liteCount * LITE_TRIANGLES,
    };
  }

  function dispose() {
    richGeometry.dispose();
    liteGeometry.dispose();
    material.dispose();
  }

  return {
    group,
    update,
    dispose,
    getStats: () => ({ ...stats, generated: patches.length }),
  };
}
