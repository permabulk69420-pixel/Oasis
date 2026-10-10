// Metres, Y-up. Keep world shape independent of the renderer and locomotion.
import { clamp, mix, smooth, noise } from './world-math.js';
import { shapeTerrain, homeLive } from './zones.js';
export { clamp, mix, smooth, noise };

export const WORLD_SIZE = 1000;
export const HALF_WORLD = WORLD_SIZE / 2;
export const GRID_SEGMENTS = 512;
export const GRID_STEP = WORLD_SIZE / GRID_SEGMENTS;
export const WATER = Object.freeze({ x: 300, z: -400, y: 3.1, radiusX: 40, radiusZ: 34 });
// Start on a nearby dune crest so iteration happens around the oasis instead of a 500 m walk away.
export const SPAWN = Object.freeze({ x: 319, z: -292 });
// The 60 m crimson landmark tree, and the clearing kept free of other plants and rocks.
export const HERO_TREE = Object.freeze({ x: 372, z: -414, yaw: 0.55, groundInset: 0.55, clearRadius: 48 });
export const SUN = Object.freeze({ x: -0.728, y: 0.469, z: -0.499 });
function duneProfile(phase) {
  const p = phase - Math.floor(phase);
  // Long windward slope and a shorter lee slope, without a hard ridge normal.
  return p < 0.73
    ? 0.5 - 0.5 * Math.cos(Math.PI * p / 0.73)
    : 0.5 + 0.5 * Math.cos(Math.PI * (p - 0.73) / 0.27);
}

export function basinRadius(x, z) {
  const dx = (x - WATER.x) / WATER.radiusX;
  const dz = (z - WATER.z) / WATER.radiusZ;
  const angle = Math.atan2(dz, dx);
  const edge = 1 + 0.065 * Math.sin(angle * 3 + 0.4) + 0.045 * Math.sin(angle * 5 - 0.8);
  return Math.hypot(dx, dz) / edge;
}

// Ground cover follows the irregular shoreline, leaving a bare sandy bank.
// Stored in vertex colours: no grass meshes or extra draw calls.
export function grassCover(x, z) {
  const r = basinRadius(x, z);
  const edgeNoise = (noise(x * 0.18, z * 0.18) - 0.5) * 0.10;
  return smooth(1.12, 1.25, r + edgeNoise * 0.3)
    * (1 - smooth(1.80, 2.08, r + edgeNoise));
}

// The dunes and the oasis basin: the whole world before the zones (src/zones.js) were added, and still all of it inside the oasis square.
// `vary` (0 in the oasis square, easing to 1 beyond it: homeLive) is how far the dunes have stopped marching in step. Out in the desert a slow
// warp bends and stretches the ridges region by region (so they are not one set of parallel stripes), some places raise huge dunes and others
// flatten to open sand, and in patches a second set of ridges crosses the first. With vary at 0 nothing here changes the oasis by a hair.
export function homeHeight(x, z, vary = 0) {
  const wind = x * 0.84 + z * 0.54;
  const across = -x * 0.54 + z * 0.84;
  let bend = 44 * (noise(x * 0.0045 + 20, z * 0.0045) - 0.5)
    + 28 * Math.sin(across * 0.010) + 13 * Math.sin(across * 0.024 + 0.8);
  let size = 1, cross = 0, secondaryWeight = 1;
  if (vary > 0) {
    // Warp the ridge coordinate: a big slow bend (the ridges turn and spread apart over a kilometre) and a smaller one (they wander).
    bend += vary * (620 * (noise(x * 0.0011 + 70, z * 0.0011 - 50) - 0.5) + 150 * (noise(x * 0.0029 - 33, z * 0.0029 + 12) - 0.5));
    size = 1 + vary * (0.55 * smooth(0.58, 0.82, noise(x * 0.0017 + 3, z * 0.0017 - 8)) // some places: very tall dunes
      - 0.85 * smooth(0.58, 0.72, noise(x * 0.0022 - 12, z * 0.0022 + 4))); // others: almost flat sand
    secondaryWeight = 1 + vary * 2.4 * smooth(0.45, 0.75, noise(x * 0.0026 + 55, z * 0.0026 + 9));
    const crossing = smooth(0.50, 0.74, noise(x * 0.0019 - 61, z * 0.0019 + 27)); // a second set of ridges, about 40 degrees off the first
    if (crossing > 0) cross = vary * crossing * 8 * (duneProfile((x * 0.30 + z * 0.95 + bend * 0.5) / 95 + 3.1) - 0.5);
  }
  const wavelength = (wind + bend) / 113 + 0.61;
  const amplitude = 8 + 9 * noise(x * 0.0031 + 41, z * 0.0031 - 31);
  const mainDunes = amplitude * size * duneProfile(wavelength);
  const secondary = 3.8 * secondaryWeight * duneProfile((x * 0.94 + z * 0.34 + bend * 0.65) / 71 + 1.7)
    * (0.25 + 0.75 * noise(across * 0.008, wind * 0.005));
  const rolls = 7 * noise(x * 0.003 - 19, z * 0.003 + 17)
    + 1.0 * noise(x * 0.014 + 7, z * 0.014);
  let height = 5 + mainDunes + secondary + rolls + cross;
  const r = basinRadius(x, z);
  if (r < 3.2) {
    const bowl = WATER.y - 0.88 + 0.88 * Math.pow(r, 2.2);
    const apron = WATER.y + 0.55 + (r - 1.4) * 0.65;
    const basin = mix(bowl, apron, smooth(1.05, 1.5, r));
    // Keep the sandy bank and grass shelf gently sloped before blending into dunes.
    height = mix(basin, height, smooth(1.85, 3.2, r));
  }
  return height;
}

const zoneScratch = { rock: 0, salt: 0, gravel: 0 };
export function terrainHeight(x, z) { return shapeTerrain(x, z, homeHeight(x, z, homeLive(x, z)), zoneScratch); }
// The same, also reporting what the ground is made of: out.rock, out.salt, out.gravel (each 0 to 1).
export function terrainSurface(x, z, out) { return shapeTerrain(x, z, homeHeight(x, z, homeLive(x, z)), out); }

// True when ground at (x, z) sits under the pond's still water by enough to be wading, not just
// at the wet edge. `ground` is the terrain height there (pass field.sample for the live one).
export const WADE_DEPTH = 0.06;
export function isInPond(x, z, ground = terrainHeight(x, z)) {
  return basinRadius(x, z) < 1.4 && WATER.y - ground > WADE_DEPTH;
}

// The ground as a grid of GRID_STEP metres that reaches as far as anyone can walk. It is filled in lazily, a tile of
// TILE cells (62.5 m, the terrain chunk) at a time, with a one cell apron so a chunk and its normals live in one tile.
// `sample` matches the rendered triangles exactly, including the diagonal.
export const TILE = 32;
const TILE_SIDE = TILE + 3;
export function createHeightField() {
  const tiles = new Map();
  let lastKey = NaN, lastTile = null;
  function tile(tx, tz) {
    const key = (tx + 4096) * 8192 + (tz + 4096);
    if (key === lastKey) return lastTile;
    let data = tiles.get(key);
    if (!data) {
      data = new Float32Array(TILE_SIDE * TILE_SIDE);
      for (let iz = 0; iz < TILE_SIDE; iz++) {
        const z = (tz * TILE + iz - 1) * GRID_STEP - HALF_WORLD;
        for (let ix = 0; ix < TILE_SIDE; ix++) data[iz * TILE_SIDE + ix] = terrainHeight((tx * TILE + ix - 1) * GRID_STEP - HALF_WORLD, z);
      }
      tiles.set(key, data);
    }
    lastKey = key; lastTile = data;
    return data;
  }
  const vertex = (ix, iz) => {
    const tx = Math.floor(ix / TILE), tz = Math.floor(iz / TILE);
    return tile(tx, tz)[(iz - tz * TILE + 1) * TILE_SIDE + (ix - tx * TILE + 1)];
  };
  function sample(x, z) {
    const gx = (x + HALF_WORLD) / GRID_STEP, gz = (z + HALF_WORLD) / GRID_STEP;
    const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
    const a = vertex(ix, iz), b = vertex(ix + 1, iz), c = vertex(ix, iz + 1), d = vertex(ix + 1, iz + 1);
    return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }
  // One tile's samples (cells -1 to TILE + 1 on each axis, row length TILE + 3), for a chunk to read in one go.
  const chunkData = (tx, tz) => tile(tx, tz);
  const loaded = (tx, tz) => tiles.has((tx + 4096) * 8192 + (tz + 4096));
  // The oasis square as one array of (GRID_SEGMENTS + 1) squared heights, the way the water shaders read it.
  function homeHeights() {
    const side = GRID_SEGMENTS + 1, heights = new Float32Array(side * side);
    for (let iz = 0; iz < side; iz++) for (let ix = 0; ix < side; ix++) heights[iz * side + ix] = vertex(ix, iz);
    return heights;
  }
  return { vertex, sample, chunkData, loaded, homeHeights, tileCount: () => tiles.size };
}

export function stickAxis(v, deadzone = 0.16) {
  return Math.abs(v) < deadzone ? 0 : Math.sign(v) * (Math.abs(v) - deadzone) / (1 - deadzone);
}

export function stickVector(x, z, deadzone = 0.16) {
  // Deadzone each axis independently. A radial deadzone lets small sideways stick
  // noise leak through whenever the other axis is pushed hard, which makes a nominally
  // straight forward push drift diagonally on real VR controllers.
  let sx = stickAxis(x, deadzone);
  let sz = stickAxis(z, deadzone);
  const length = Math.hypot(sx, sz);
  if (length > 1) {
    sx /= length;
    sz /= length;
  }
  return { x: sx, z: sz };
}

export function pivotRig(x, z, pivotX, pivotZ, radians) {
  const dx = x - pivotX, dz = z - pivotZ, c = Math.cos(radians), s = Math.sin(radians);
  return { x: pivotX + c * dx + s * dz, z: pivotZ - s * dx + c * dz };
}
