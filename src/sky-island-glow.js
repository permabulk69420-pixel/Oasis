import { noise, clamp } from './world-math.js';
import { SKY_ISLAND, outlineRadius } from './sky-island-shape.js';
import { mulberry32 } from './find-shapes.js';

// Where the glow plants grow on the island (Kane, 5 Oct: the glow is what carries the island at night, and it marks each place so you can find your way
// in the dark). These are the oasis's own two plants, the glow reeds and the lantern blooms (src/glow-garden.js draws them: this file only says where).
// The lake is ringed with reeds in the shallows and blooms on its banks; each other place has a glow of its own: a loose ring of blooms round the meadow's
// edge (never on it), blooms among the grove's palms, at the foot of the rise and at the hollow's mouth, a few along the rim, and a pair here and there
// beside the paths. Pure and seeded. Everything keeps off the paths, the rocks, the palms, the water (blooms) and the spill channel.
export const ISLAND_GLOW = Object.freeze({
  seed: 0x6c0de,
  reed: Object.freeze({ count: 42, spacing: 3.8, scale: Object.freeze([0.85, 1.3]) }),
  lantern: Object.freeze({
    lake: 26, grove: 15, meadow: 9, rise: 8, rim: 6, hollow: 6, path: 14, spacing: 5.5, scale: Object.freeze([0.8, 1.25]),
  }),
  slopeLimit: 0.8,        // metres of height across a metre either side: steeper than that and nothing is planted
  pathClear: 1.3,         // metres from a path's edge
  meadowRing: Object.freeze({ from: 42, to: 62 }),
});

// [{ kind: 'reed' | 'lantern', x, z, yaw, scale, place }]. ctx: { ground (the drawn ground), features, pathIndex, paths, obstacles: [{ x, z, r }], config }
export function layoutIslandGlow(ctx, spec = ISLAND_GLOW) {
  const { ground, features, pathIndex, paths = [], obstacles = [], config = SKY_ISLAND } = ctx;
  const { lake, places, channel } = features;
  const random = mulberry32(spec.seed);
  const items = [];
  const cell = 8;
  const grid = new Map();
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  const rand = (lo, hi) => lo + random() * (hi - lo);
  const rimGap = (x, z) => outlineRadius(Math.atan2(z - config.z, x - config.x), config) - config.lip - Math.hypot(x - config.x, z - config.z);
  const slope = (x, z) => Math.max(Math.abs((ground(x + 1, z) ?? 0) - (ground(x - 1, z) ?? 0)), Math.abs((ground(x, z + 1) ?? 0) - (ground(x, z - 1) ?? 0))) / 2;
  const channelDistance = (x, z) => {
    const dx = channel.bx - channel.ax, dz = channel.bz - channel.az;
    const t = clamp(((x - channel.ax) * dx + (z - channel.az) * dz) / (dx * dx + dz * dz), 0, 1);
    return Math.hypot(x - (channel.ax + dx * t), z - (channel.az + dz * t));
  };

  function room(x, z, spacing, opts = {}) {
    if (ground(x, z) === null || rimGap(x, z) < 5) return false;
    if (!opts.meadow && Math.hypot(x - places.meadow.x, z - places.meadow.z) < places.meadow.radius) return false;
    const s = lake.signed(x, z);
    if (opts.water ? s < -2.6 || s > 1.6 : s > -1.0) return false;
    if (channelDistance(x, z) < 3.2) return false;
    if (pathIndex.clearance(x, z) < spec.pathClear) return false;
    if (slope(x, z) > spec.slopeLimit) return false;
    for (const o of obstacles) if (Math.abs(o.x - x) < o.r + 1 && Math.abs(o.z - z) < o.r + 1 && Math.hypot(o.x - x, o.z - z) < o.r + 0.7) return false;
    const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const other of grid.get(`${gx + a},${gz + b}`) || []) if (Math.hypot(other.x - x, other.z - z) < spacing) return false;
    }
    return true;
  }
  function plant(kind, x, z, place, scaleRange) {
    const item = { kind, x, z, yaw: random() * Math.PI * 2, scale: rand(scaleRange[0], scaleRange[1]), place };
    items.push(item);
    const k = key(x, z);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(item);
  }
  function scatter(kind, count, place, candidate, spacing, scaleRange, opts = {}, attempts = 3000) {
    let made = 0;
    for (let n = 0; n < attempts && made < count; n++) {
      const { x, z } = candidate();
      if (!room(x, z, spacing, opts)) continue;
      plant(kind, x, z, place, scaleRange);
      made++;
    }
    return made;
  }
  const ring = (cx, cz, from, to) => () => { const a = random() * Math.PI * 2, d = rand(from, to); return { x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d }; };
  const lakeEdge = (inner, outer) => () => {
    const p = lake.outline[Math.floor(random() * lake.outline.length)];
    const c = lake.toWorld(0, 0);
    const dx = p.x - c.x, dz = p.z - c.z, l = Math.hypot(dx, dz) || 1, out = rand(inner, outer);
    return { x: p.x + dx / l * out, z: p.z + dz / l * out };
  };

  // reeds: in the shallows and on the shingle, in clumps (more where the noise is high)
  {
    let made = 0;
    for (let n = 0; n < 6000 && made < spec.reed.count; n++) {
      const { x, z } = lakeEdge(-1.6, 1.6)();
      if (noise(x / 14 + 3, z / 14 - 6) < 0.38) continue;
      if (!room(x, z, spec.reed.spacing, { water: true })) continue;
      plant('reed', x, z, 'lake', spec.reed.scale);
      made++;
    }
  }
  const L = spec.lantern;
  scatter('lantern', L.lake, 'lake', lakeEdge(3, 11), L.spacing, L.scale);
  scatter('lantern', L.grove, 'grove', ring(places.grove.x, places.grove.z, 4, 28), L.spacing, L.scale);
  // a loose ring round the meadow's edge, so the way home is a circle of lights in the dark
  {
    const base = random() * Math.PI * 2;
    for (let k = 0, made = 0; k < 12 && made < L.meadow; k++) {
      for (let n = 0; n < 60; n++) {
        const a = base + (k / 12) * Math.PI * 2 + rand(-0.2, 0.2), d = rand(spec.meadowRing.from, spec.meadowRing.to);
        const x = places.meadow.x + Math.cos(a) * d, z = places.meadow.z + Math.sin(a) * d;
        if (room(x, z, L.spacing)) { plant('lantern', x, z, 'meadow', L.scale); made++; break; }
      }
    }
  }
  scatter('lantern', L.rise, 'rise', ring(places.rise.x, places.rise.z, places.rise.radius * 0.6, places.rise.radius * 1.05), L.spacing, L.scale);
  scatter('lantern', L.rim, 'rim', () => {
    const a = Math.atan2(places.rim.z - config.z, places.rim.x - config.x) + rand(-0.12, 0.12);
    const gap = rand(7, 16), edge = outlineRadius(a, config) - config.lip;
    return { x: config.x + Math.cos(a) * (edge - gap), z: config.z + Math.sin(a) * (edge - gap) };
  }, L.spacing, L.scale);
  scatter('lantern', L.hollow, 'hollow', ring(places.hollow.x, places.hollow.z, 6, places.hollow.radius * 1.5), L.spacing, L.scale);
  // beside the paths: one every so often, a little way off the edge
  {
    const total = paths.reduce((s, p) => s + p.samples[p.samples.length - 1].along, 0);
    let made = 0;
    const every = total / (L.path + 1);
    for (const path of paths) {
      let next = rand(0.3, 1) * every;
      for (const s of path.samples) {
        if (s.along < next || made >= L.path) continue;
        const side = random() < 0.5 ? 1 : -1, off = s.half + rand(1.8, 3.2);
        const x = s.x - s.tz * off * side, z = s.z + s.tx * off * side;
        if (room(x, z, L.spacing)) { plant('lantern', x, z, 'path', L.scale); made++; next = s.along + every * rand(0.7, 1.3); }
        else next = s.along + 2;
      }
    }
  }
  return items;
}
