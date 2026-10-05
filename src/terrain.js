import * as THREE from 'three';
import { GRID_STEP, HALF_WORLD, TILE, SPAWN, noise, terrainSurface, grassCover } from './world.js';
import { AREA } from './zones.js';
import { TERRAIN, chooseTiles } from './terrain-tiles.js';
export { TERRAIN };
import { createPickupRocks } from './rocks.js';
import { createOasisVegetation } from './oasis-vegetation.js';
import { createOasisGrassRing } from './oasis-grass-ring.js';
import { createAlienDesertPlants } from './alien-desert-plants.js';
import { createGreenFerns } from './green-ferns.js';

const CHUNK = TERRAIN.chunk;
const rootR = TERRAIN.rootRange;
const surface = { rock: 0, salt: 0, gravel: 0 };

export function createTerrain(field, material) {
  const group = new THREE.Group();
  group.name = 'Desert moon';
  const scratchOut = { rock: 0, salt: 0, gravel: 0 };

  // ---- geometry ----------------------------------------------------------------------------------------------
  function buildGeometry(x0, z0, size, segments) {
    const stride = segments + 1, step = size / segments;
    const count = stride * stride;
    const pos = new Float32Array(count * 3), normals = new Float32Array(count * 3), colors = new Float32Array(count * 3), zone = new Float32Array(count * 3);
    const isChunk = size === CHUNK;
    const data = isChunk ? field.chunkData(Math.round((x0 + HALF_WORLD) / CHUNK), Math.round((z0 + HALF_WORLD) / CHUNK)) : null;
    const side = TILE + 3, cells = isChunk ? TILE / segments : 0;
    let v = 0;
    for (let j = 0; j <= segments; j++) {
      for (let i = 0; i <= segments; i++, v++) {
        const x = x0 + i * step, z = z0 + j * step;
        let h, nx, nz;
        if (isChunk) {
          const lx = i * cells + 1, lz = j * cells + 1;
          h = data[lz * side + lx];
          nx = data[lz * side + lx - 1] - data[lz * side + lx + 1];
          nz = data[(lz - 1) * side + lx] - data[(lz + 1) * side + lx];
          terrainSurface(x, z, scratchOut);
        } else {
          h = terrainSurface(x, z, scratchOut);
          nx = terrainSurface(x - GRID_STEP, z, surface) - terrainSurface(x + GRID_STEP, z, surface);
          nz = terrainSurface(x, z - GRID_STEP, surface) - terrainSurface(x, z + GRID_STEP, surface);
        }
        const ny = 2 * GRID_STEP, len = Math.hypot(nx, ny, nz);
        pos[v * 3] = x; pos[v * 3 + 1] = h; pos[v * 3 + 2] = z;
        normals[v * 3] = nx / len; normals[v * 3 + 1] = ny / len; normals[v * 3 + 2] = nz / len;
        // R is intentionally 1: a moving sun cannot use the old fixed-direction shadow mask.
        // G = broad colour variation; B = grass coverage.
        colors[v * 3] = 1; colors[v * 3 + 1] = noise(x * 0.019 + 9, z * 0.019); colors[v * 3 + 2] = grassCover(x, z);
        zone[v * 3] = scratchOut.rock; zone[v * 3 + 1] = scratchOut.salt; zone[v * 3 + 2] = scratchOut.gravel;
      }
    }
    const indices = [];
    for (let z = 0; z < segments; z++) for (let x = 0; x < segments; x++) {
      const a = z * stride + x, b = a + 1, c = a + stride, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
    // Buried skirts cover the cracks where neighbouring tiles of different detail meet (wider for coarser tiles).
    const drop = Math.min(24, 2.4 + 0.012 * step * step);
    const edges = [
      Array.from({ length: stride }, (_, i) => i),
      Array.from({ length: stride }, (_, i) => i * stride + segments),
      Array.from({ length: stride }, (_, i) => segments * stride + segments - i),
      Array.from({ length: stride }, (_, i) => (segments - i) * stride),
    ];
    const total = count + edges.length * stride;
    const outPos = new Float32Array(total * 3), outNormal = new Float32Array(total * 3), outColor = new Float32Array(total * 3), outZone = new Float32Array(total * 3);
    outPos.set(pos); outNormal.set(normals); outColor.set(colors); outZone.set(zone);
    let w = count;
    for (const edge of edges) {
      const start = w;
      for (const i of edge) {
        outPos[w * 3] = pos[i * 3]; outPos[w * 3 + 1] = pos[i * 3 + 1] - drop; outPos[w * 3 + 2] = pos[i * 3 + 2];
        for (let k = 0; k < 3; k++) { outNormal[w * 3 + k] = normals[i * 3 + k]; outColor[w * 3 + k] = colors[i * 3 + k]; outZone[w * 3 + k] = zone[i * 3 + k]; }
        w++;
      }
      for (let i = 0; i < segments; i++) indices.push(edge[i], edge[i + 1], start + i, edge[i + 1], start + i + 1, start + i);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(outNormal, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(outColor, 3));
    geo.setAttribute('zone', new THREE.BufferAttribute(outZone, 3));
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    return geo;
  }

  // Geometries made so far, by tile and detail; the least recently shown are dropped when there are too many.
  const cache = new Map();
  let clock = 0;
  const geometryOf = leaf => {
    let entry = cache.get(leaf.key);
    if (!entry) { entry = { geometry: buildGeometry(leaf.x, leaf.z, leaf.size, leaf.segments), used: clock }; cache.set(leaf.key, entry); }
    entry.used = clock;
    return entry.geometry;
  };

  // ---- showing them -----------------------------------------------------------------------------------------
  const shown = new Map(); // key -> mesh
  const spare = [];
  const wanted = new Set();
  let lastX = NaN, lastZ = NaN, pending = [];
  const stats = { leaves: 0, cached: 0, built: 0 };

  let tileState = null;
  function refresh(px, pz, immediate) {
    const now = chooseTiles(px, pz, 1, tileState);
    tileState = now.state;
    const show = now.tiles;
    wanted.clear();
    for (const leaf of show) wanted.add(leaf.key);
    clock++;
    // what is on screen now
    for (const [key, mesh] of shown) if (!wanted.has(key)) { group.remove(mesh); shown.delete(key); spare.push(mesh); }
    for (const leaf of show) {
      if (shown.has(leaf.key)) { cache.get(leaf.key).used = clock; continue; }
      const mesh = spare.pop() ?? new THREE.Mesh(undefined, material);
      mesh.geometry = geometryOf(leaf);
      mesh.name = `sand-${leaf.size}-${leaf.x}-${leaf.z}`;
      group.add(mesh); shown.set(leaf.key, mesh);
    }
    stats.leaves = show.length;
    // what will be needed soon: built a few at a time, nearest first
    const ahead = chooseTiles(px, pz, TERRAIN.lead).tiles;
    pending = ahead.filter(leaf => !cache.has(leaf.key)).sort((a, b) => a.near - b.near);
    for (const leaf of ahead) { const e = cache.get(leaf.key); if (e) e.used = clock; }
    if (immediate) { for (const leaf of pending) geometryOf(leaf); pending = []; }
    if (cache.size > TERRAIN.cacheLimit) {
      for (const [key, entry] of cache) {
        if (entry.used < clock - 40 && !wanted.has(key)) { entry.geometry.dispose(); cache.delete(key); }
        if (cache.size <= TERRAIN.cacheLimit * 0.8) break;
      }
    }
    stats.cached = cache.size;
  }

  function build(budgetMs) {
    const start = performance.now();
    while (pending.length && performance.now() - start < budgetMs) {
      const leaf = pending.shift();
      if (!cache.has(leaf.key)) { geometryOf(leaf); stats.built++; }
    }
  }

  // ---- the far horizon: the rim carried on out of sight, one mesh centred on the walkable area -------------------
  const cx = (AREA.bounds.minX + AREA.bounds.maxX) / 2, cz = (AREA.bounds.minZ + AREA.bounds.maxZ) / 2;
  const half = (rootR.maxX - rootR.minX) / 2;
  {
    const P = [], N = [], C = [], Z = [], I = [];
    const perimeter = [];
    const per = 128;
    for (let i = 0; i < per; i++) perimeter.push([-1 + i / (per / 2), -1]);
    for (let i = 0; i < per; i++) perimeter.push([1, -1 + i / (per / 2)]);
    for (let i = 0; i < per; i++) perimeter.push([1 - i / (per / 2), 1]);
    for (let i = 0; i < per; i++) perimeter.push([-1, 1 - i / (per / 2)]);
    const ringRadii = TERRAIN.horizonRings;
    for (const r of ringRadii) for (const [px, pz] of perimeter) {
      const x = cx + px * r, z = cz + pz * r, h = terrainSurface(x, z, surface);
      const nx = terrainSurface(x - 2, z, scratchOut) - terrainSurface(x + 2, z, scratchOut);
      const nz = terrainSurface(x, z - 2, scratchOut) - terrainSurface(x, z + 2, scratchOut);
      const len = Math.hypot(nx, 4, nz);
      P.push(x, h, z); N.push(nx / len, 4 / len, nz / len); C.push(1, 0.5, 0); Z.push(surface.rock, surface.salt, surface.gravel);
    }
    const n = perimeter.length;
    for (let r = 0; r < ringRadii.length - 1; r++) for (let i = 0; i < n; i++) {
      const a = r * n + i, b = r * n + (i + 1) % n, c = a + n, d = b + n;
      I.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    geo.setAttribute('zone', new THREE.Float32BufferAttribute(Z, 3));
    geo.setIndex(I); geo.computeBoundingSphere();
    const horizon = new THREE.Mesh(geo, material); horizon.name = 'Distant mountains'; group.add(horizon);
    void half;
  }

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
  const vegetation = createOasisVegetation({
    field,
    sunDirection: material.uniforms?.uSun?.value,
    groundGlowUniforms: material.uniforms,
  });
  group.add(vegetation.group);

  // Four sparse alien plants around the oasis shelf. Their authored high model is used inside
  // 30 m, then swapped to the supplied lower LOD; very distant plants are culled entirely.
  const alienPlants = createAlienDesertPlants({ field });
  group.add(alienPlants.group);

  // Ten green ferns around the oasis shelf, all at authored scale. The supplied lower LOD takes
  // over after 22 m.
  const greenFerns = createGreenFerns({ field });
  group.add(greenFerns.group);

  let nearbyTime = -Infinity;
  // Called every little while with the player's ground position. Tiles are re-chosen when the player has moved a few
  // metres, and new ones are built a little at a time, nearest first, so nothing is ever drawn late or in a rush.
  function update(x, z) {
    if (Math.hypot(x - lastX, z - lastZ) > 3) { refresh(x, z, false); lastX = x; lastZ = z; }
    build(TERRAIN.buildBudgetMs);
    const now = performance.now();
    if (now - nearbyTime > 340) {
      nearbyTime = now;
      pickupRocks.update(x, z);
      grassRing.update(x, z);
      vegetation.update(x, z);
      alienPlants.update(x, z);
      greenFerns.update(x, z);
    }
  }
  // Initialise tiles and nearby assets around the real player start, not the old world origin.
  refresh(SPAWN.x, SPAWN.z, true); lastX = SPAWN.x; lastZ = SPAWN.z;
  update(SPAWN.x, SPAWN.z);
  // Everything within reach of a teleport or a screenshot position is built up front.
  function jumpTo(x, z) { refresh(x, z, true); lastX = x; lastZ = z; update(x, z); }
  return { group, update, jumpTo, stats, shown, pickupRocks, grassRing, vegetation, alienPlants, greenFerns };
}
