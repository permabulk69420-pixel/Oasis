import { WATER } from './world.js';
import { AREA } from './zones.js';

// The sand is drawn as a quadtree of square tiles around the player: small and detailed close by, doubling in size
// (and halving in detail) with distance, out to the mountain rim. A tile splits into four when the player is within
// `split` metres of it. The smallest tile is the 62.5 m chunk the oasis has always used, with the same two levels of
// detail (32 or 16 segments), so the oasis looks exactly as it did.
export const TERRAIN = Object.freeze({
  chunk: 62.5,
  sizes: [
    { size: 62.5, segments: 16 },
    { size: 125, segments: 16, split: 240 },
    { size: 250, segments: 16, split: 360 },
    { size: 500, segments: 24, split: 680 },
    { size: 1000, segments: 32, split: 1250 },
  ],
  fineSegments: 32, fineDistance: 140, // a chunk this close is drawn at 32 segments (1.95 m, the height grid itself)
  hysteresis: 1.1,                     // a tile keeps its state until the player is this much past the threshold
  lead: 1.25,                          // tiles are built this far ahead of when they are needed
  rootSize: 1000,
  // Roots cover the walkable area and one more ring of rim mountains; beyond that a coarse horizon takes over.
  rootRange: { minX: AREA.bounds.minX - 1000, maxX: AREA.bounds.maxX + 1000, minZ: AREA.bounds.minZ - 1000, maxZ: AREA.bounds.maxZ + 1000 },
  horizonRings: [3000, 3300, 3800, 4600, 6000, 8500, 12000],
  cacheLimit: 900,
  buildBudgetMs: 6,
});

const CHUNK = TERRAIN.chunk;
// Chunks whose centre lies in this box are always drawn at full detail, so the shore stays on the water's own grid.
const POND = {
  x0: WATER.x - (WATER.radiusX * 1.12 + CHUNK / 2), x1: WATER.x + (WATER.radiusX * 1.12 + CHUNK / 2),
  z0: WATER.z - (WATER.radiusZ * 1.12 + CHUNK / 2), z1: WATER.z + (WATER.radiusZ * 1.12 + CHUNK / 2),
};


// Which tiles to draw for a player at (px, pz): { tiles, state }, tiles being a list of { key, size, x, z, segments, near } that covers the
// whole root range exactly once. `scale` stretches every distance (a little over 1 picks the tiles about to be needed). `state` is what was
// split or fine last time, so a tile keeps its state until the player is well past the threshold (pass the previous result's state, or null).
// The mesh name of a tile. The torch and fire lighting find the terrain material through names starting 'sand-' (night-fill.js findTerrainMesh).
export function tileName(leaf) { return `sand-${leaf.size}-${leaf.x}-${leaf.z}`; }

export function chooseTiles(px, pz, scale = 1, state = null) {
  const out = [], split = new Set(), fine = new Set();
  const rootR = TERRAIN.rootRange;
  const visit = (level, x0, z0) => {
    const { size, segments, split: limit } = TERRAIN.sizes[level];
    const key = `${size}:${x0}:${z0}`;
    const near = Math.hypot(Math.max(x0 - px, 0, px - (x0 + size)), Math.max(z0 - pz, 0, pz - (z0 + size)));
    if (level > 0) {
      const keepOpen = state && state.split.has(key);
      const forced = x0 + size > POND.x0 && x0 < POND.x1 && z0 + size > POND.z0 && z0 < POND.z1;
      if (forced || near < limit * scale * (keepOpen ? TERRAIN.hysteresis : 1)) {
        split.add(key);
        const h = size / 2;
        visit(level - 1, x0, z0); visit(level - 1, x0 + h, z0); visit(level - 1, x0, z0 + h); visit(level - 1, x0 + h, z0 + h);
        return;
      }
      out.push({ key: `${key}:${segments}`, size, x: x0, z: z0, segments, near });
      return;
    }
    // a chunk: full detail when close (with hysteresis); always full detail round the pond
    const mx = x0 + size / 2, mz = z0 + size / 2, d = Math.hypot(mx - px, mz - pz);
    const inPond = mx > POND.x0 && mx < POND.x1 && mz > POND.z0 && mz < POND.z1;
    const wasFine = state && state.fine.has(key);
    const isFine = inPond || d < TERRAIN.fineDistance * scale || (wasFine && d < TERRAIN.fineDistance * scale * TERRAIN.hysteresis);
    if (isFine) fine.add(key);
    const seg = isFine ? TERRAIN.fineSegments : segments;
    out.push({ key: `${key}:${seg}`, size, x: x0, z: z0, segments: seg, near });
  };
  const top = TERRAIN.sizes.length - 1, S = TERRAIN.rootSize;
  for (let z = rootR.minZ; z < rootR.maxZ; z += S) for (let x = rootR.minX; x < rootR.maxX; x += S) visit(top, x, z);
  return { tiles: out, state: { split, fine } };
}
