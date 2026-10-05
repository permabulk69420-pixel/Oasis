import { terrainHeight } from './world.js';
import { SKY_ISLAND, topGround } from './sky-island-shape.js';

// Where you stand on the floating island (Kane, 5 Oct: "spawn me up there"). Pure, so tests can run it; the mesh is in sky-island.js.
//
// The start is a flat, open stretch of the top near its north edge (the oasis side), found by searching the shape for the flattest
// ground well clear of every palm (tests/sky-island.test.js checks all of that, so a change to the shape or the palms that spoils it
// fails there). It faces -z like the oasis start does, so the sky (the ringed planet) sits where it always has.
export const ISLAND_START = Object.freeze({ x: -105, z: 635, yaw: 0 });

export function createSkyIslandGround(config = SKY_ISLAND) {
  const baseY = terrainHeight(config.x, config.z) + config.altitude;
  return {
    config, baseY,
    // World height of the top at (x, z), or null where there is no ground on top (off the edge).
    groundHeight(x, z) { const h = topGround(x, z, config); return h === null ? null : baseY + h; },
  };
}
