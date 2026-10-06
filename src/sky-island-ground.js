import { terrainHeight } from './world.js';
import { SKY_ISLAND, topGround } from './sky-island-shape.js';
import { createIslandFeatures } from './sky-island-places.js';

// Where you stand on the floating island (the owner, 5 Oct: "spawn me up there"). Pure, so tests can run it; the mesh is in sky-island.js.
//
// The start is a flat, open stretch of the top near its north edge (the oasis side), found by searching the shape for the flattest
// ground well clear of every palm (tests/sky-island.test.js checks all of that, so a change to the shape or the palms that spoils it
// fails there). It faces -z like the oasis start does, so the sky (the ringed planet) sits where it always has.
export const ISLAND_START = Object.freeze({ x: -105, z: 635, yaw: 0 });

export function createSkyIslandGround(config = SKY_ISLAND, features = createIslandFeatures(config)) {
  const baseY = terrainHeight(config.x, config.z) + config.altitude;
  return {
    config, baseY, features,
    // World height of the top at (x, z), or null where there is no ground on top (off the edge). The places on it (lake, rise, hollow) are in the ground.
    groundHeight(x, z) { const h = topGround(x, z, config, features); return h === null ? null : baseY + h; },
  };
}
