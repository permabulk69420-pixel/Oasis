import * as THREE from 'three';
import { GRID_STEP, HALF_WORLD, clamp } from './world.js';

// A small square of the ground around the player, as a texture, for shaders that need the height of the sand
// anywhere the player can be (the wind-blown sand). The oasis' own water shaders keep their fixed texture of the old
// 1 km square; the world is now far bigger than a texture could cover. Heights are packed in two 8-bit channels over
// MIN_HEIGHT to MIN_HEIGHT + RANGE (so a mesa or the rim still fits). The window moves in whole grid cells.
export const GROUND_WINDOW = Object.freeze({ cells: 128, minHeight: -32, range: 256, recentre: 36 });

export function packHeight(h) {
  return Math.round(clamp((h - GROUND_WINDOW.minHeight) / GROUND_WINDOW.range, 0, 1) * 65535);
}
export function unpackHeight(value) { return value / 65535 * GROUND_WINDOW.range + GROUND_WINDOW.minHeight; }

export function createGroundWindow(field) {
  const n = GROUND_WINDOW.cells;
  const data = new Uint8Array(n * n * 4);
  const texture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  const uniforms = { uGroundMap: { value: texture }, uGroundOrigin: { value: new THREE.Vector2() } };
  let cx = NaN, cz = NaN, ix0 = 0, iz0 = 0;
  function fill(x, z) {
    ix0 = Math.floor((x + HALF_WORLD) / GRID_STEP) - n / 2;
    iz0 = Math.floor((z + HALF_WORLD) / GRID_STEP) - n / 2;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const value = packHeight(field.vertex(ix0 + i, iz0 + j)), k = (j * n + i) * 4;
      data[k] = value >> 8; data[k + 1] = value & 255; data[k + 3] = 255;
    }
    texture.needsUpdate = true;
    uniforms.uGroundOrigin.value.set(ix0 * GRID_STEP - HALF_WORLD, iz0 * GRID_STEP - HALF_WORLD);
    cx = x; cz = z;
  }
  return {
    uniforms, texture,
    // Re-centre once the player has moved a good way off the middle (the window is about 250 m across, the sand reaches about 40 m).
    update(x, z) { if (!(Math.hypot(x - cx, z - cz) < GROUND_WINDOW.recentre)) fill(x, z); },
    origin: () => ({ x: ix0 * GRID_STEP - HALF_WORLD, z: iz0 * GRID_STEP - HALF_WORLD }),
  };
}
