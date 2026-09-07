import * as THREE from 'three';
import { HALF_WORLD, GRID_STEP, SUN, clamp, smooth, noise, terrainHeight } from './world.js';

const CHUNK_SIZE = 62.5;
const LEVELS = [32, 16, 8, 4];

export function createTerrain(field, material) {
  const group = new THREE.Group();
  group.name = 'Desert — 1000 m × 1000 m';
  const chunks = [];
  // Static illumination is shared by every LOD; no shadow maps or extra render passes.
  const side = 513;
  const shade = new Float32Array(side * side);
  for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
    const px = x * GRID_STEP - HALF_WORLD, pz = z * GRID_STEP - HALF_WORLD;
    const h = field.vertex(x, z);
    let horizon = -10;
    for (let d = 4; d <= 72; d += 4) {
      const sx = px + SUN.x * d, sz = pz + SUN.z * d;
      const sh = Math.abs(sx) <= 500 && Math.abs(sz) <= 500 ? field.sample(sx, sz) : terrainHeight(sx, sz);
      horizon = Math.max(horizon, (sh - h - 0.2) / d);
    }
    shade[z * side + x] = 1 - smooth(SUN.y - 0.06, SUN.y + 0.05, horizon);
  }

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
      // R = static sunlight visibility; G = broad colour variation.
      colors.push(shade[clamp(iz, 0, 512) * side + clamp(ix, 0, 512)], noise(x * 0.019 + 9, z * 0.019), 1);
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
    outerPos.push(x, h, z); outerNormal.push(nx / len, 4 / len, nz / len); outerColor.push(1, 0.5, 1);
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

  function update(x, z) {
    for (const chunk of chunks) {
      const distance = Math.hypot(x - chunk.x, z - chunk.z);
      let level = distance < 140 ? 0 : distance < 280 ? 1 : distance < 470 ? 2 : 3;
      // Hysteresis prevents geometry flickering near a distance threshold.
      if (level > chunk.level && distance < [154, 298, 490][chunk.level]) level = chunk.level;
      if (level !== chunk.level) { chunk.mesh.geometry = chunk.geometries[level]; chunk.level = level; }
    }
  }
  update(0, 0);
  return { group, update, chunks };
}
