import * as THREE from 'three';
import { HALF_WORLD, GRID_STEP, WATER, SPAWN, clamp, noise, terrainHeight, grassCover } from './world.js';
import { createPickupRocks } from './rocks.js';
import { createOasisVegetation } from './oasis-vegetation.js';
import { createOasisGrassRing } from './oasis-grass-ring.js';
import { createWaterReeds } from './water-reeds.js';
import { createAlienDesertPlants } from './alien-desert-plants.js';
import { addFernReplacementTrees } from './fern-replacement-trees.js';
import { createGreenFerns } from './green-ferns.js';

const CHUNK_SIZE = 62.5;
const LEVELS = [32, 16, 8, 4];

export function createTerrain(field, material) {
  const group = new THREE.Group();
  group.name = 'Desert — 1000 m × 1000 m';
  const chunks = [];

  function geometry(cx, cz, segments) {
    const pos = [], normals = [], colors = [], indices = [];
    const stride = segments + 1;
    const step = CHUNK_SIZE / segments;
    function add(x, z, drop = 0) {
      const ix = Math.round((x + HALF_WORLD) / GRID_STEP), iz = Math.round((z + HALF_WORLD) / GRID_STEP);
      const h = field.vertex(ix, iz);
      const nx = field.vertex(ix - 1, iz) - field.vertex(ix + 1, iz);
      const nz = field.vertex(ix, iz - 1) - field.vertex(ix, iz + 1);
      const ny = 2 * GRID_STEP, len = Math.hypot(nx, ny, nz);
      pos.push(x, h - drop, z);
      normals.push(nx / len, ny / len, nz / len);
      // R is intentionally 1: a moving sun cannot use the old fixed-direction shadow mask.
      // G = broad colour variation; B = grass coverage.
      colors.push(1, noise(x * 0.019 + 9, z * 0.019), grassCover(x, z));
    }
    for (let z = 0; z <= segments; z++) for (let x = 0; x <= segments; x++) add(cx + x * step, cz + z * step);
    for (let z = 0; z < segments; z++) for (let x = 0; x < segments; x++) {
      const a = z * stride + x, b = a + 1, c = a + stride, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
    // Buried skirts cover the sub-metre edge differences between neighbouring LODs.
    const edges = [
      Array.from({ length: stride }, (_, i) => i),
      Array.from({ length: stride }, (_, i) => i * stride + segments),
      Array.from({ length: stride }, (_, i) => segments * stride + segments - i),
      Array.from({ length: stride }, (_, i) => (segments - i) * stride),
    ];
    for (const edge of edges) {
      const start = pos.length / 3;
      for (const i of edge) add(pos[i * 3], pos[i * 3 + 2], 2.4);
      for (let i = 0; i < segments; i++) indices.push(edge[i], edge[i + 1], start + i, edge[i + 1], start + i + 1, start + i);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    return geo;
  }
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const cx = x * CHUNK_SIZE - 500, cz = z * CHUNK_SIZE - 500;
    const geometries = LEVELS.map(n => geometry(cx, cz, n));
    const mesh = new THREE.Mesh(geometries[2], material);
    mesh.name = `sand-${x}-${z}`;
    group.add(mesh);
    chunks.push({ mesh, geometries, x: cx + 31.25, z: cz + 31.25, level: 2 });
  }

  // A coarse continuation keeps the horizon natural beyond the walkable square.
  const outerPos = [], outerNormal = [], outerColor = [], outerIndex = [];
  const rings = [500, 560, 660, 820, 1080, 1500, 2200, 3200];
  const perimeter = [];
  for (let i = 0; i < 128; i++) perimeter.push([-1 + i / 64, -1]);
  for (let i = 0; i < 128; i++) perimeter.push([1, -1 + i / 64]);
  for (let i = 0; i < 128; i++) perimeter.push([1 - i / 64, 1]);
  for (let i = 0; i < 128; i++) perimeter.push([-1, 1 - i / 64]);
  for (const r of rings) for (const [px, pz] of perimeter) {
    const x = px * r, z = pz * r, h = terrainHeight(x, z);
    const nx = terrainHeight(x - 2, z) - terrainHeight(x + 2, z);
    const nz = terrainHeight(x, z - 2) - terrainHeight(x, z + 2);
    const len = Math.hypot(nx, 4, nz);
    outerPos.push(x, h, z); outerNormal.push(nx / len, 4 / len, nz / len); outerColor.push(1, 0.5, 0);
  }
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < 512; i++) {
    const a = r * 512 + i, b = r * 512 + (i + 1) % 512, c = a + 512, d = b + 512;
    outerIndex.push(a, b, c, b, d, c);
  }
  const outerGeo = new THREE.BufferGeometry();
  outerGeo.setAttribute('position', new THREE.Float32BufferAttribute(outerPos, 3));
  outerGeo.setAttribute('normal', new THREE.Float32BufferAttribute(outerNormal, 3));
  outerGeo.setAttribute('color', new THREE.Float32BufferAttribute(outerColor, 3));
  outerGeo.setIndex(outerIndex); outerGeo.computeBoundingSphere();
  const horizon = new THREE.Mesh(outerGeo, material); horizon.name = 'Distant dune continuation'; group.add(horizon);

  // Small pickup rocks are cheap enough that LOD would add more complexity than value.
  // Keep one instanced mesh and only populate matrices for rocks within draw distance.
  const pickupRocks = createPickupRocks({ field });
  group.add(pickupRocks.mesh);

  // The PBR grass texture carries the ground cover; short fanned geometry gives the shelf real
  // close-range volume without turning every blade into an object or transparent billboard.
  const grassRing = createOasisGrassRing({ field });
  group.add(grassRing.group);

  // Larger oasis plants are lazy-loaded nearby.
  // Reuse the terrain shader's live sun vector so cheap projected tree shadows follow the day cycle.
  const vegetation = createOasisVegetation({ field, sunDirection: material.uniforms?.uSun?.value });
  vegetation.fernGroup.removeFromParent();
  vegetation.fernShadow.removeFromParent();
  addFernReplacementTrees({ field, treeGroup: vegetation.treeGroup });
  group.add(vegetation.group);

  // A small near-shore clump of four reed patches. The reeds use their own two-level LOD and
  // vertex-shader sway so the motion stays cheap on Quest.
  const waterReeds = createWaterReeds({ field });
  group.add(waterReeds.group);

  // Four sparse alien plants around the oasis shelf. Their authored high model is used inside
  // 30 m, then swapped to the supplied lower LOD; very distant plants are culled entirely.
  const alienPlants = createAlienDesertPlants({ field });
  group.add(alienPlants.group);

  // Ten green ferns around the oasis shelf, all at authored scale. The supplied lower LOD takes
  // over after 22 m.
  const greenFerns = createGreenFerns({ field });
  group.add(greenFerns.group);

  function update(x, z) {
    for (const chunk of chunks) {
      const distance = Math.hypot(x - chunk.x, z - chunk.z);
      let level = distance < 140 ? 0 : distance < 280 ? 1 : distance < 470 ? 2 : 3;
      // Hysteresis prevents geometry flickering near a distance threshold.
      if (level > chunk.level && distance < [154, 298, 490][chunk.level]) level = chunk.level;
      // Keep the shore on the same grid as water depth samples at all distances.
      // Otherwise a coarse terrain LOD can cut through the enlarged water surface.
      if (Math.abs(chunk.x - WATER.x) < WATER.radiusX * 1.12 + CHUNK_SIZE / 2
        && Math.abs(chunk.z - WATER.z) < WATER.radiusZ * 1.12 + CHUNK_SIZE / 2) level = 0;
      if (level !== chunk.level) { chunk.mesh.geometry = chunk.geometries[level]; chunk.level = level; }
    }
    pickupRocks.update(x, z);
    grassRing.update(x, z);
    vegetation.update(x, z);
    waterReeds.update(x, z);
    alienPlants.update(x, z);
    greenFerns.update(x, z);
  }
  // Initialise LOD and nearby assets around the real player start, not the old world origin.
  update(SPAWN.x, SPAWN.z);
  return { group, update, chunks, pickupRocks, grassRing, vegetation, waterReeds, alienPlants, greenFerns };
}
