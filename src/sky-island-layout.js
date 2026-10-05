import { noise } from './world-math.js';
import { SKY_ISLAND, outlineRadius, topGround } from './sky-island-shape.js';

// Where the plants go on the island's top. Pure and seeded, so the same island grows the same grove every time.
export const SKY_TREES = Object.freeze({
  count: 90,            // at most
  attempts: 9000,
  spacing: 8,           // metres between palms, at least
  clearing: 38,         // radius round the island's centre kept open (somewhere to build, later)
  edgeMargin: 0.80,     // no trees past this fraction of the way to the lip
  groveAbove: 0.50,     // palms grow where the grove noise is above this
  scale: [0.9, 1.7],
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

// [{ x, z, yaw, scale }], all standing on the island's top.
export function layoutSkyTrees(config = SKY_ISLAND, rules = SKY_TREES) {
  const random = seeded(0x51a7e5 + config.seed);
  const trees = [];
  const cell = rules.spacing;
  const grid = new Map();
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  for (let attempt = 0; attempt < rules.attempts && trees.length < rules.count; attempt++) {
    const angle = random() * Math.PI * 2;
    const dist = Math.sqrt(random()) * config.radius * 1.15;
    const x = config.x + Math.cos(angle) * dist, z = config.z + Math.sin(angle) * dist;
    if (topGround(x, z, config) === null) continue;
    const edge = outlineRadius(Math.atan2(z - config.z, x - config.x), config);
    if (dist / edge > rules.edgeMargin) continue;
    if (dist < rules.clearing) continue;
    if (noise(x / 70 + 21, z / 70 - 9) < rules.groveAbove) continue;
    let tooClose = false;
    const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
    for (let a = -1; a <= 1 && !tooClose; a++) for (let b = -1; b <= 1 && !tooClose; b++) {
      for (const other of grid.get(`${gx + a},${gz + b}`) || []) if (Math.hypot(other.x - x, other.z - z) < rules.spacing) { tooClose = true; break; }
    }
    if (tooClose) continue;
    const tree = { x, z, yaw: random() * Math.PI * 2, scale: rules.scale[0] + random() * (rules.scale[1] - rules.scale[0]) };
    trees.push(tree);
    const k = key(x, z);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(tree);
  }
  return trees;
}
