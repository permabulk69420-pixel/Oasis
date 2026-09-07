// Metres, Y-up. Keep world shape independent of the renderer and locomotion.
export const WORLD_SIZE = 1000;
export const HALF_WORLD = WORLD_SIZE / 2;
export const GRID_SEGMENTS = 512;
export const GRID_STEP = WORLD_SIZE / GRID_SEGMENTS;
export const WATER = Object.freeze({ x: 300, z: -400, y: 3.1, radiusX: 24, radiusZ: 17 });
export const SPAWN = Object.freeze({ x: 0, z: 0 });
export const SUN = Object.freeze({ x: -0.728, y: 0.469, z: -0.499 });
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const mix = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function hash(x, y) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + 1337;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

export function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(0, 1, x - ix), fy = smooth(0, 1, y - iy);
  return mix(mix(hash(ix, iy), hash(ix + 1, iy), fx), mix(hash(ix, iy + 1), hash(ix + 1, iy + 1), fx), fy);
}

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

export function terrainHeight(x, z) {
  const wind = x * 0.84 + z * 0.54;
  const across = -x * 0.54 + z * 0.84;
  const bend = 44 * (noise(x * 0.0045 + 20, z * 0.0045) - 0.5)
    + 28 * Math.sin(across * 0.010) + 13 * Math.sin(across * 0.024 + 0.8);
  const wavelength = (wind + bend) / 113 + 0.61;
  const amplitude = 8 + 9 * noise(x * 0.0031 + 41, z * 0.0031 - 31);
  const mainDunes = amplitude * duneProfile(wavelength);
  const secondary = 3.8 * duneProfile((x * 0.94 + z * 0.34 + bend * 0.65) / 71 + 1.7)
    * (0.25 + 0.75 * noise(across * 0.008, wind * 0.005));
  const rolls = 7 * noise(x * 0.003 - 19, z * 0.003 + 17)
    + 1.0 * noise(x * 0.014 + 7, z * 0.014);
  let height = 5 + mainDunes + secondary + rolls;
  const r = basinRadius(x, z);
  if (r < 4.8) {
    const bowl = WATER.y - 0.88 + 0.88 * Math.pow(r, 2.2);
    const apron = WATER.y + 1.1 + (r - 1.4) * 0.85;
    const basin = mix(bowl, apron, smooth(1.05, 1.7, r));
    height = mix(basin, height, smooth(1.6, 4.8, r));
  }
  return height;
}

export function createHeightField() {
  const side = GRID_SEGMENTS + 1;
  const heights = new Float32Array(side * side);
  for (let iz = 0; iz < side; iz++) {
    for (let ix = 0; ix < side; ix++) heights[iz * side + ix] = terrainHeight(ix * GRID_STEP - HALF_WORLD, iz * GRID_STEP - HALF_WORLD);
  }
  const vertex = (ix, iz) => heights[clamp(iz, 0, GRID_SEGMENTS) * side + clamp(ix, 0, GRID_SEGMENTS)];
  function sample(x, z) {
    const gx = clamp((x + HALF_WORLD) / GRID_STEP, 0, GRID_SEGMENTS - 0.00001);
    const gz = clamp((z + HALF_WORLD) / GRID_STEP, 0, GRID_SEGMENTS - 0.00001);
    const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
    const a = vertex(ix, iz), b = vertex(ix + 1, iz), c = vertex(ix, iz + 1), d = vertex(ix + 1, iz + 1);
    // Matches the rendered triangles exactly, including the diagonal.
    return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }
  return { heights, vertex, sample };
}

export function stickAxis(v, deadzone = 0.16) {
  return Math.abs(v) < deadzone ? 0 : Math.sign(v) * (Math.abs(v) - deadzone) / (1 - deadzone);
}

export function stickVector(x, z, deadzone = 0.16) {
  const length = Math.hypot(x, z);
  if (length <= deadzone) return { x: 0, z: 0 };
  const magnitude = Math.min(1, (length - deadzone) / (1 - deadzone));
  return { x: x / length * magnitude, z: z / length * magnitude };
}

export function pivotRig(x, z, pivotX, pivotZ, radians) {
  const dx = x - pivotX, dz = z - pivotZ, c = Math.cos(radians), s = Math.sin(radians);
  return { x: pivotX + c * dx + s * dz, z: pivotZ - s * dx + c * dz };
}
