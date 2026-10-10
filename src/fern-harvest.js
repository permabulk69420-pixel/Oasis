// Pulling fibre off the green ferns round the pond: close a hand on one with the grip button and you tear off a handful. The fern shrinks to a
// stub and grows back over a minute or two, so there are always ferns to pull but not an endless supply from one plant. The rules live here as
// plain functions; src/green-ferns.js holds the plants and src/fern-picking.js reads the hands.
export const FERN_HARVEST = Object.freeze({
  reach: 0.7, // metres, sideways, from the middle of a fern to the hand
  height: 1.4, // metres above the fern's base: a hand higher than this is over it, not in it
  fibre: Object.freeze([1, 2]), // fibre per pull
  regrow: 90, // seconds from stub to full size
  stubScale: 0.3, // how big the fern is right after a pull
});

// How big a fern is `since` seconds after it was pulled (Infinity if it never was): stub, then easing back up to full size.
export function fernScale(since, config = FERN_HARVEST) {
  if (!(since < config.regrow)) return 1;
  const t = Math.max(0, since) / config.regrow;
  return config.stubScale + (1 - config.stubScale) * (t * t * (3 - 2 * t));
}

export const isFernReady = (since, config = FERN_HARVEST) => !(since < config.regrow);

export const rollFibre = (random = Math.random, [min, max] = FERN_HARVEST.fibre) => min + Math.floor(random() * (max - min + 1));

// The nearest fern that is full grown and within reach of a hand at (x, y, z). Ferns are { x, y, z, since }.
export function nearestReadyFern(ferns, x, y, z, config = FERN_HARVEST) {
  let best = null, bestSq = config.reach * config.reach;
  for (const fern of ferns) {
    if (!isFernReady(fern.since, config)) continue;
    const dy = y - fern.y;
    if (dy < -0.15 || dy > config.height) continue;
    const dx = x - fern.x, dz = z - fern.z;
    const sq = dx * dx + dz * dz;
    if (sq <= bestSq) { best = fern; bestSq = sq; }
  }
  return best;
}
