import { SPAWN, WATER, HERO_TREE, isInPond } from './world.js';
import { ROCK_VARIANTS, CRYSTAL_VARIANTS, SPIRE_VARIANTS, mulberry32 } from './find-shapes.js';

// Where the things worth walking out to are. Three kinds (src/find-shapes.js, src/mining.js):
//
//   rock     sandstone outcrops: mesas, hoodoos, boulders and slabs. A pickaxe breaks stone off them.
//   crystal  glowing violet (and now and then cyan) clusters. A pickaxe breaks shards off them. They shine at night, so a field of
//            them shows as a smudge of light across the dunes, long before you can see what it is.
//   spire    tall spiny alien plants. An axe cuts fibre from them.
//
// The layout is fixed (a seed, no randomness at run time), so the world is the same in every session and a node can be remembered by its
// id. Close to the start there are two outcrops, three spires and a patch of crystals on the stinger's ground (the first reward to be
// won). Everything else is out in the dunes: rock groups, crystal fields and spire groves, each at least FINDS.siteSpacing from the
// next, the richer ones further out. This module is pure (no three.js scene, no browser) so tests can check it.

export const FINDS_VERSION = 1; // bump when the layout changes, so a saved game does not point at nodes that moved

export const FINDS = Object.freeze({
  seed: 40104,
  worldLimit: 455, // nothing nearer than this to the edge of the world
  pondClear: 112, // metres from the middle of the pond (the grass band, the palms, the first sticks and stones live inside this)
  heroClear: 74, // metres from the hero tree
  spawnClear: 18, // nothing closer than this to where you start (the tools stand there)
  siteSpacing: 78, // between the middles of two far sites
  farMin: 105, // far sites start this far from the start...
  farMax: 410, // ...and end this far
  rockSites: 8,
  crystalSites: 9,
  spireSites: 7,
  stingerHome: Object.freeze({ x: SPAWN.x + 46, z: SPAWN.z - 6 }), // dune-stinger.js; the crystals near it are the first prize
  maxSlope: Object.freeze({ rock: 0.62, crystal: 0.5, spire: 0.5 }), // highest minus lowest ground under the footprint, in metres per metre of footprint radius
});

export const NODE_KINDS = Object.freeze(['rock', 'crystal', 'spire']);

const SPECS = Object.freeze({ rock: ROCK_VARIANTS, crystal: CRYSTAL_VARIANTS, spire: SPIRE_VARIANTS });

// Half the width of a node's footprint, before its scale: used to keep nodes apart and to stand the player off the solid ones.
export function footprintOf(kind, variant) {
  const spec = SPECS[kind]?.[variant];
  if (!spec) throw new Error(`Unknown ${kind} variant: ${variant}`);
  if (kind === 'rock') return Math.max(spec.rx, spec.rz) * 1.15; // the real body reaches a little past its nominal ellipse
  if (kind === 'crystal') return spec.spread * 1.5 + spec.thickness;
  return spec.leafLength * 0.55;
}

// Height of the node before its scale (the top of the shape).
export function heightOf(kind, variant) {
  const spec = SPECS[kind]?.[variant];
  if (!spec) throw new Error(`Unknown ${kind} variant: ${variant}`);
  if (kind === 'rock') return spec.height * (1 + 0.035 + spec.dome * 0.5);
  if (kind === 'crystal') return spec.height + spec.thickness * 1.1;
  return spec.height;
}

const TAU = Math.PI * 2;
const ring8 = Array.from({ length: 8 }, (_, i) => [Math.cos((i / 8) * TAU), Math.sin((i / 8) * TAU)]);

// Lowest, highest and average ground in a footprint of radius r.
export function groundUnder(heightAt, x, z, r) {
  let min = Infinity, max = -Infinity, sum = 0;
  const take = h => { min = Math.min(min, h); max = Math.max(max, h); sum += h; };
  take(heightAt(x, z));
  for (const [c, s] of ring8) take(heightAt(x + c * r, z + s * r));
  return { min, max, mean: sum / 9 };
}

export function layoutFinds({ heightAt, seed = FINDS.seed } = {}) {
  if (typeof heightAt !== 'function') throw new Error('layoutFinds needs a heightAt(x, z) function');
  const rng = mulberry32(seed);
  const rand = (a, b) => a + (b - a) * rng();
  const pick = list => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
  const nodes = [];
  const counts = { rock: 0, crystal: 0, spire: 0 };
  const sites = [];

  const distance = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
  const ponded = (x, z) => distance(x, z, WATER.x, WATER.z) < FINDS.pondClear * 0.6 || isInPond(x, z, heightAt(x, z)) || heightAt(x, z) < WATER.y + 0.4;

  // Can a node of this kind stand at (x, z)? Not in the pond or the hero tree's clearing, not on the start, not too steep, not touching another.
  function fits(kind, variant, x, z, scale, { ignoreSpawn = false, allowNearPond = false } = {}) {
    if (Math.abs(x) > FINDS.worldLimit || Math.abs(z) > FINDS.worldLimit) return false;
    if (!allowNearPond && distance(x, z, WATER.x, WATER.z) < FINDS.pondClear) return false;
    if (ponded(x, z)) return false;
    if (distance(x, z, HERO_TREE.x, HERO_TREE.z) < FINDS.heroClear) return false;
    if (!ignoreSpawn && distance(x, z, SPAWN.x, SPAWN.z) < FINDS.spawnClear) return false;
    if (kind === 'rock' && distance(x, z, FINDS.stingerHome.x, FINDS.stingerHome.z) < 14) return false;
    const radius = footprintOf(kind, variant) * scale;
    const ground = groundUnder(heightAt, x, z, radius);
    if (ground.max - ground.min > FINDS.maxSlope[kind] * radius) return false;
    for (const other of nodes) {
      const gap = radius + other.radius + (kind === 'rock' || other.kind === 'rock' ? 1.4 : 0.5);
      if (distance(x, z, other.x, other.z) < gap) return false;
    }
    return true;
  }

  function add(kind, variant, x, z, scale, site, extra = {}) {
    const radius = footprintOf(kind, variant) * scale;
    const ground = groundUnder(heightAt, x, z, radius);
    // A rock stands on its lowest corner (its foot is already buried a little); the others on the average.
    const height = kind === 'rock' ? ground.min + 0.04 * heightOf(kind, variant) * scale : ground.mean;
    const node = {
      id: `${kind[0]}${String(counts[kind]++).padStart(2, '0')}`,
      kind, variant, x, z, y: height, yaw: rng() * TAU, scale, radius, site, ...extra,
    };
    nodes.push(node);
    return node;
  }

  // Try the spot, then spiral outwards from it until something fits (up to `reach` metres). Returns the node or null.
  function addNear(kind, variant, x, z, scale, site, reach = 9, options) {
    for (let step = 0; step < 40; step++) {
      const r = step === 0 ? 0 : reach * Math.sqrt(step / 40);
      const a = step * 2.399963;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (fits(kind, variant, px, pz, scale, options)) return add(kind, variant, px, pz, scale, site, options?.extra);
    }
    return null;
  }

  // ---------------------------------------------------------------------- near the start: the first things to find
  const NEAR = { allowNearPond: true }; // the start is on the shelf just outside the pond's clear zone
  // Two outcrops to the left of the start, a short walk: where the first stone comes from.
  sites.push({ name: 'start rocks', x: SPAWN.x - 30, z: SPAWN.z - 2, kind: 'rock', near: true });
  addNear('rock', 'hoodoo', SPAWN.x - 40, SPAWN.z - 16, 1.0, 'start rocks', 10, NEAR);
  addNear('rock', 'boulder', SPAWN.x - 24, SPAWN.z + 14, 1.05, 'start rocks', 10, NEAR);
  // Spires on the sand behind the start: the first fibre.
  sites.push({ name: 'start spires', x: SPAWN.x + 14, z: SPAWN.z + 52, kind: 'spire', near: true });
  addNear('spire', 'tall', SPAWN.x + 12, SPAWN.z + 50, 1.0, 'start spires', 8, NEAR);
  addNear('spire', 'squat', SPAWN.x + 22, SPAWN.z + 58, 1.1, 'start spires', 8, NEAR);
  addNear('spire', 'tall', SPAWN.x + 6, SPAWN.z + 62, 0.9, 'start spires', 8, NEAR);
  // The first crystals grow on the stinger's ground, so they cost something to take.
  sites.push({ name: 'stinger crystals', x: FINDS.stingerHome.x, z: FINDS.stingerHome.z, kind: 'crystal', near: true });
  const patch = [['cluster', 20, 0.4], ['fan', 27, 2.2], ['cluster', 17, 3.9], ['fan', 31, 5.1], ['spike', 24, 1.3]];
  for (const [variant, radius, angle] of patch) {
    addNear('crystal', variant, FINDS.stingerHome.x + Math.cos(angle) * radius, FINDS.stingerHome.z + Math.sin(angle) * radius, rand(1.0, 1.3), 'stinger crystals', 7, NEAR);
  }

  // ---------------------------------------------------------------------- the far sites
  const kinds = [];
  for (let i = 0; i < FINDS.rockSites; i++) kinds.push('rock');
  for (let i = 0; i < FINDS.crystalSites; i++) kinds.push('crystal');
  for (let i = 0; i < FINDS.spireSites; i++) kinds.push('spire');
  // shuffle (Fisher-Yates with the seeded generator) so the kinds mix as you go outwards
  for (let i = kinds.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [kinds[i], kinds[j]] = [kinds[j], kinds[i]]; }

  for (const kind of kinds) {
    let placed = false;
    for (let attempt = 0; attempt < 400 && !placed; attempt++) {
      const angle = rng() * TAU;
      const far = rand(FINDS.farMin, FINDS.farMax);
      const cx = SPAWN.x + Math.cos(angle) * far, cz = SPAWN.z + Math.sin(angle) * far;
      if (Math.abs(cx) > FINDS.worldLimit - 25 || Math.abs(cz) > FINDS.worldLimit - 25) continue;
      if (distance(cx, cz, WATER.x, WATER.z) < FINDS.pondClear + 25) continue;
      if (distance(cx, cz, HERO_TREE.x, HERO_TREE.z) < FINDS.heroClear + 25) continue;
      if (sites.some(site => distance(cx, cz, site.x, site.z) < FINDS.siteSpacing)) continue;
      const richness = Math.min(1, (far - FINDS.farMin) / (FINDS.farMax - FINDS.farMin) * 0.7 + rng() * 0.45);
      const before = nodes.length;
      if (kind === 'rock') buildRockSite(cx, cz, richness, sites.length);
      else if (kind === 'crystal') buildCrystalSite(cx, cz, richness, sites.length);
      else buildSpireSite(cx, cz, richness, sites.length);
      if (nodes.length - before >= (kind === 'rock' ? 2 : 3)) {
        sites.push({ name: `${kind} site ${sites.length}`, x: cx, z: cz, kind, richness });
        placed = true;
      } else nodes.length = before; // too cramped or too steep: forget it and try elsewhere (counters only skip numbers, which is fine)
    }
  }

  function buildRockSite(cx, cz, richness, index) {
    const site = `rocks ${index}`;
    const names = Object.keys(ROCK_VARIANTS);
    const landmark = rng() < 0.55 ? 'hoodoo' : 'mesa';
    addNear('rock', landmark, cx, cz, rand(1.0, 1.25 + 0.35 * richness), site, 12);
    const companions = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < companions; i++) {
      const angle = rng() * TAU, r = rand(7, 17);
      addNear('rock', pick(names), cx + Math.cos(angle) * r, cz + Math.sin(angle) * r, rand(0.8, 1.3), site, 8);
    }
    // sometimes a crystal grows in the lee of the stone
    if (rng() < 0.4 + 0.3 * richness) {
      const angle = rng() * TAU, r = rand(9, 15);
      addNear('crystal', pick(['cluster', 'fan']), cx + Math.cos(angle) * r, cz + Math.sin(angle) * r, rand(0.9, 1.3), site, 6);
    }
  }

  function buildCrystalSite(cx, cz, richness, index) {
    const site = `crystals ${index}`;
    const count = 3 + Math.floor(richness * 4 + rng() * 2);
    for (let i = 0; i < count; i++) {
      const angle = rng() * TAU, r = rand(2, 7 + 14 * Math.sqrt(rng()));
      const big = richness > 0.5 && rng() < 0.4;
      const variant = big ? 'spike' : pick(['cluster', 'cluster', 'fan']);
      addNear('crystal', variant, cx + Math.cos(angle) * r, cz + Math.sin(angle) * r, rand(0.85, 1.25 + 0.4 * richness), site, 6);
    }
    // a rock or two to read the place by
    if (rng() < 0.5) addNear('rock', pick(['boulder', 'slab']), cx + rand(-18, 18), cz + rand(-18, 18), rand(0.9, 1.3), site, 8);
  }

  function buildSpireSite(cx, cz, richness, index) {
    const site = `spires ${index}`;
    const count = 4 + Math.floor(rng() * 5 + richness * 2);
    for (let i = 0; i < count; i++) {
      const angle = rng() * TAU, r = rand(1, 5 + 14 * Math.sqrt(rng()));
      addNear('spire', rng() < 0.6 ? 'tall' : 'squat', cx + Math.cos(angle) * r, cz + Math.sin(angle) * r, rand(0.85, 1.25), site, 5);
    }
  }

  return { nodes, sites };
}
