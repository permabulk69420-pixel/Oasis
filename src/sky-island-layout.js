import { noise, clamp, smooth } from './world-math.js';
import { SKY_ISLAND, outlineRadius, topGround } from './sky-island-shape.js';
import { createIslandFeatures } from './sky-island-places.js';
import { layoutPaths, createPathIndex } from './sky-island-paths.js';

// Where the palms go on the island's top (Kane, 5 Oct: the palm grove is a shaded stand of the oasis's own palms, grouped, not spread evenly over the
// island). Pure and seeded, so the same island grows the same grove every time. Most of the palms are in the grove, between the meadow and the lake,
// close enough that their crowns overlap; a few lean over the lake, a loose broken ring stands round the meadow, a few are alone on the rim against the
// sky, a few flank the hollow, and a handful stand about on their own. None is on the meadow, a path, the water, the rise or the hollow's bowl.
export const SKY_TREES = Object.freeze({
  seed: 0x51a7e5,
  scale: Object.freeze([0.9, 1.7]),
  grove: Object.freeze({ count: 30, spacing: 4.5, edgeSpacing: 7.5, scale: Object.freeze([1.05, 1.75]) }), // taller towards the middle, where the shade is
  lakeside: Object.freeze({ count: 9, spacing: 9 }),
  meadowRing: Object.freeze({ count: 7, spacing: 12, from: 45, to: 78 }),
  rim: Object.freeze({ count: 4, spacing: 18, gap: Object.freeze([9, 22]) }),
  hollow: Object.freeze({ count: 4, spacing: 10 }),
  strays: Object.freeze({ count: 8, spacing: 24 }),
  clearing: 38,         // radius round the meadow's centre kept open (the start)
  pathClear: 1.7,       // metres from a path's edge
});

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// [{ x, z, yaw, scale, place }], all standing on the island's top. `ctx` may hold { features, pathIndex } (made when not given).
export function layoutSkyTrees(config = SKY_ISLAND, rules = SKY_TREES, ctx = {}) {
  const features = ctx.features ?? createIslandFeatures(config);
  const pathIndex = ctx.pathIndex ?? createPathIndex(layoutPaths(features, config));
  const { lake, places } = features;
  const random = seeded(rules.seed + config.seed);
  const trees = [];
  const cell = 8;
  const grid = new Map();
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  const rand = (lo, hi) => lo + random() * (hi - lo);
  const rimGap = (x, z) => outlineRadius(Math.atan2(z - config.z, x - config.x), config) - config.lip - Math.hypot(x - config.x, z - config.z);

  // Can a palm stand here, at least `spacing` from every other?
  function room(x, z, spacing) {
    if (topGround(x, z, config, features) === null || rimGap(x, z) < 7) return false;
    if (Math.hypot(x - places.meadow.x, z - places.meadow.z) < rules.clearing) return false;
    if (lake.signed(x, z) > -3.5) return false;
    if (Math.hypot(x - places.rise.x, z - places.rise.z) < places.rise.radius * 0.8) return false;
    if (Math.hypot(x - places.hollow.x, z - places.hollow.z) < places.hollow.radius * 1.15) return false;
    if (pathIndex.clearance(x, z) < rules.pathClear) return false;
    const gx = Math.floor(x / cell), gz = Math.floor(z / cell), reach = Math.ceil(spacing / cell);
    for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) {
      for (const other of grid.get(`${gx + a},${gz + b}`) || []) if (Math.hypot(other.x - x, other.z - z) < Math.min(spacing, other.spacing)) return false;
    }
    return true;
  }
  function plant(x, z, spacing, place, scale) {
    const tree = { x, z, yaw: random() * Math.PI * 2, scale, place, spacing };
    trees.push(tree);
    const k = key(x, z);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(tree);
  }
  function scatter(count, place, candidate, spacing, scaleRange, attempts = 3000) {
    let placed = 0;
    for (let n = 0; n < attempts && placed < count; n++) {
      const { x, z, spacing: s = spacing, scale = rand(scaleRange[0], scaleRange[1]) } = candidate();
      if (!room(x, z, s)) continue;
      plant(x, z, s, place, scale);
      placed++;
    }
    return placed;
  }

  // the grove: thickest in the middle, thinning out to its edge, the biggest palms in the shade's heart
  {
    const g = places.grove, R = 30;
    scatter(rules.grove.count, 'grove', () => {
      const a = random() * Math.PI * 2, d = Math.pow(random(), 0.8) * R * (0.85 + 0.3 * noise(Math.cos(a) * 2 + 5, Math.sin(a) * 2 - 3));
      const centrality = 1 - smooth(0, R, d);
      return {
        x: g.x + Math.cos(a) * d, z: g.z + Math.sin(a) * d,
        spacing: rules.grove.spacing + (rules.grove.edgeSpacing - rules.grove.spacing) * (1 - centrality),
        scale: rules.grove.scale[0] + (rules.grove.scale[1] - rules.grove.scale[0]) * clamp(centrality * 0.8 + random() * 0.3, 0, 1),
      };
    }, rules.grove.spacing, rules.grove.scale, 6000);
  }

  // leaning over the lake: on the banks, in twos and threes
  {
    let made = 0;
    for (let round = 0; round < 40 && made < rules.lakeside.count; round++) {
      const p = lake.outline[Math.floor(random() * lake.outline.length)];
      const c = lake.toWorld(0, 0);
      const dx = p.x - c.x, dz = p.z - c.z, l = Math.hypot(dx, dz) || 1;
      const base = rand(4.5, 10);
      for (let k = 0; k < 3 && made < rules.lakeside.count; k++) {
        const along = rand(-5, 5), out = base + rand(-1.5, 3);
        const x = p.x + dx / l * out - dz / l * along, z = p.z + dz / l * out + dx / l * along;
        if (room(x, z, rules.lakeside.spacing * 0.6)) { plant(x, z, rules.lakeside.spacing * 0.6, 'lake', rand(1.0, 1.55)); made++; }
      }
    }
  }

  // a loose ring round the meadow, with gaps where the paths and the view go
  scatter(rules.meadowRing.count, 'meadow', () => {
    const a = random() * Math.PI * 2, d = rand(rules.meadowRing.from, rules.meadowRing.to);
    return { x: places.meadow.x + Math.cos(a) * d, z: places.meadow.z + Math.sin(a) * d };
  }, rules.meadowRing.spacing, rules.scale);

  // alone on the rim, against the sky
  scatter(rules.rim.count, 'rim', () => {
    const a = Math.atan2(places.rim.z - config.z, places.rim.x - config.x) + rand(-0.32, 0.32);
    const edge = outlineRadius(a, config) - config.lip;
    const gap = rand(rules.rim.gap[0], rules.rim.gap[1]);
    return { x: config.x + Math.cos(a) * (edge - gap), z: config.z + Math.sin(a) * (edge - gap) };
  }, rules.rim.spacing, rules.scale);

  // flanking the hollow
  scatter(rules.hollow.count, 'hollow', () => {
    const a = random() * Math.PI * 2, d = places.hollow.radius * rand(1.2, 1.9);
    return { x: places.hollow.x + Math.cos(a) * d, z: places.hollow.z + Math.sin(a) * d };
  }, rules.hollow.spacing, rules.scale);

  // a few standing about on their own, where the ground is open
  scatter(rules.strays.count, 'stray', () => {
    const a = random() * Math.PI * 2, d = Math.sqrt(random()) * config.radius * 0.85;
    return { x: config.x + Math.cos(a) * d, z: config.z + Math.sin(a) * d };
  }, rules.strays.spacing, rules.scale, 4000);

  return trees.map(({ x, z, yaw, scale, place }) => ({ x, z, yaw, scale, place }));
}
