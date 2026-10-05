import { SKY_ISLAND, outlineRadius, topOffset } from './sky-island-shape.js';
import { clamp, mix, smooth, noise } from './world-math.js';

// The island as a place (the owner, 5 Oct: it is going to be the player's home base, so it needs a lake and a handful of distinct places you can see from
// each other, joined by paths). This file is the pure layout: where each place is, how the ground is shaped for it, what colour the ground is, and
// the paths between them. No three.js, so tests can run it. The meshes that make it are in sky-island-lake.js, sky-island-paths.js and
// sky-island-rocks.js; what grows on it is in sky-island-flora.js.
//
// Everything is in world metres, +x east and -z north (the way the game faces at the start); heights are in the island's own units, metres above the
// top's reference level, the same as `topGround` (sky-island-shape.js). The six places, from the meadow where you start:
//   meadow  the open start (ISLAND_START), kept clear: nothing tall is put on it
//   lake    about 100 m by 50 m to the north-west, a bay on its east shore and a rocky headland on its south-west one; its far tip spills over the rim
//   grove   a shaded stand of the oasis's palms west of the meadow, in the low ground between it and the lake
//   rise    a rocky hill north-east of the meadow with a lookout ledge and a tall landmark rock you can see from anywhere on top
//   rim     the edge with a view: the cliff along the north, looking at the desert, the colossus plain and the planet, with the waterfall beside it
//   hollow  a sheltered nook dug into the hill south of the meadow, roofed by an overhang (a spot to build or camp later)

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

export const ISLAND_PLACES = Object.freeze({
  meadow: Object.freeze({ x: -105, z: 635, radius: 38 }),
  grove: Object.freeze({ x: -168, z: 622, radius: 30 }),
  rise: Object.freeze({ x: -38, z: 584, radius: 34, gain: 4.2, summit: Object.freeze({ x: -34, z: 580 }), ledge: Object.freeze({ x: -42, z: 556 }) }),
  hollow: Object.freeze({ x: -126, z: 706, radius: 15, floor: 1.6, yaw: 0 }),
  rim: Object.freeze({ x: -138, z: 452 }), // the lookout on the cliff edge
});

// The lake. `spill` is the direction (from the island's centre, degrees from +x towards +z) in which its far tip runs out over the rim.
export const ISLAND_LAKE = Object.freeze({
  spill: 257 * DEG,       // the point on the rim the water leaves by
  heading: 257 * DEG,     // the long axis, pointing at the spill (so the lake lies along the line from the island's middle to the rim where it spills)
  // The shoreline, hand drawn in the lake's own frame: u along the long axis towards the spill, v across (positive to the north-east), metres,
  // clockwise from the tip at the spill. A broad bay on the north-east shore, a spit of land reaching in from the south-west, a narrow tip at each end.
  shape: Object.freeze([
    [52, 0], [49, 6], [42, 12], [33, 17], [24, 24], [13, 29], [1, 28], [-8, 22], [-17, 18], [-28, 17], [-39, 13], [-48, 7], [-53, 0],
    [-49, -7], [-41, -12], [-30, -16], [-19, -19], [-9, -20], [-1, -17], [6, -9], [13, -4], [17, -6], [19, -12], [27, -13], [37, -11], [45, -7], [50, -3],
  ]),
  wobble: 0.9,            // metres of slow irregularity added to the hand-drawn line
  tipGap: 9,              // metres between the tip of the water and the rim's crest
  level: 2.7,             // the still water's height
  depth: 1.1,             // the deepest it gets: a wader's lake, you can always see over it
  shelf: 13,              // metres from the shore to the full depth
  bankSlope: 0.14,        // how steeply the bank rises away from the shore
  carveOuter: 30,         // metres out from the shore over which the ground is reshaped
  seed: 7,
  channelWidth: 3.6,      // the spill channel from the tip to the rim
});

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Distance from a point to a segment, and where along it
function segmentDistance(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const length2 = dx * dx + dz * dz;
  const t = length2 > 0 ? clamp(((px - ax) * dx + (pz - az) * dz) / length2, 0, 1) : 0;
  return { distance: Math.hypot(px - (ax + dx * t), pz - (az + dz * t)), t };
}

// ---------------------------------------------------------------------------------------------------------------------------- the lake
export function createLake(config = SKY_ISLAND, spec = ISLAND_LAKE) {
  // the rim's crest where the water spills, and the lake's frame (u along the long axis towards the spill, v across, to the north-east)
  const edge = outlineRadius(spec.spill, config);
  const crest = { x: config.x + Math.cos(spec.spill) * (edge - config.lip), z: config.z + Math.sin(spec.spill) * (edge - config.lip) };
  const heading = spec.heading;
  const ux = Math.cos(heading), uz = Math.sin(heading);
  const vx = -uz, vz = ux;
  const tipU = spec.shape[0][0];
  const tip = { x: crest.x - ux * spec.tipGap, z: crest.z - uz * spec.tipGap };
  // the frame's origin (u = 0, v = 0) is placed so the first point of the outline sits at the tip
  const centre = { x: tip.x - ux * tipU, z: tip.z - uz * tipU };

  const toLocal = (x, z) => {
    const dx = x - centre.x, dz = z - centre.z;
    return { u: dx * ux + dz * uz, v: dx * vx + dz * vz };
  };
  const toWorld = (u, v) => ({ x: centre.x + u * ux + v * vx, z: centre.z + u * uz + v * vz });

  // a smooth closed curve through the hand-drawn points (Catmull-Rom), with a little slow irregularity so no edge is quite regular
  const random = mulberry32(spec.seed * 7919);
  const phases = [random() * TAU, random() * TAU, random() * TAU];
  const pts = spec.shape;
  const n = pts.length;
  const SUB = 6;
  const outline = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let k = 0; k < SUB; k++) {
      const t = k / SUB, t2 = t * t, t3 = t2 * t;
      const cr = j => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3);
      const along = (i + t) / n * TAU;
      const w = spec.wobble * (0.6 * Math.sin(along * 5 + phases[0]) + 0.3 * Math.sin(along * 9 + phases[1]) + 0.2 * Math.sin(along * 13 + phases[2]));
      // the wobble pushes along the line's local normal (towards +v on the tip's side is fine: it is small)
      outline.push(toWorld(cr(0), cr(1) + w));
    }
  }
  const OUTLINE_POINTS = outline.length;

  const inside = (x, z) => {
    let hit = false;
    for (let i = 0, j = OUTLINE_POINTS - 1; i < OUTLINE_POINTS; j = i++) {
      const a = outline[i], b = outline[j];
      if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) hit = !hit;
    }
    return hit;
  };

  // a cache of the signed distance to the shoreline (metres, positive in the water), on a 2 m grid, so the ground height is cheap to ask for
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of outline) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const margin = spec.carveOuter + 6;
  const cell = 2;
  const gx0 = Math.floor((minX - margin) / cell) * cell, gz0 = Math.floor((minZ - margin) / cell) * cell;
  const nx = Math.ceil((maxX + margin - gx0) / cell) + 1, nz = Math.ceil((maxZ + margin - gz0) / cell) + 1;
  const field = new Float32Array(nx * nz);
  const exactSigned = (x, z) => {
    let best = Infinity;
    for (let i = 0; i < OUTLINE_POINTS; i++) {
      const p = outline[i], q = outline[(i + 1) % OUTLINE_POINTS];
      const d = segmentDistance(x, z, p.x, p.z, q.x, q.z).distance;
      if (d < best) best = d;
    }
    return inside(x, z) ? best : -best;
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) field[j * nx + i] = exactSigned(gx0 + i * cell, gz0 + j * cell);

  // metres inside the shoreline (negative on land); far from the lake it is just the distance to the grid's edge, so it stays monotone
  function signed(x, z) {
    const fx = (x - gx0) / cell, fz = (z - gz0) / cell;
    if (fx < 0 || fz < 0 || fx > nx - 1 || fz > nz - 1) {
      const outX = Math.max(0, -fx, fx - (nx - 1)) * cell, outZ = Math.max(0, -fz, fz - (nz - 1)) * cell;
      return -(margin + Math.hypot(outX, outZ));
    }
    const i = Math.min(Math.floor(fx), nx - 2), j = Math.min(Math.floor(fz), nz - 2);
    const tx = fx - i, tz = fz - j;
    const f00 = field[j * nx + i], f10 = field[j * nx + i + 1], f01 = field[(j + 1) * nx + i], f11 = field[(j + 1) * nx + i + 1];
    return mix(mix(f00, f10, tx), mix(f01, f11, tx), tz);
  }

  return {
    spec, centre, tip, crest, heading, ux, uz, vx, vz, outline, bounds: { minX, maxX, minZ, maxZ },
    signed, inside, toLocal, toWorld,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------- the ground
// What the places do to the island's ground. `base` is the ground the shape gives (sky-island-shape.js `topOffset`); the result replaces it.
export function createIslandFeatures(config = SKY_ISLAND, lakeSpec = ISLAND_LAKE, places = ISLAND_PLACES) {
  const lake = createLake(config, lakeSpec);
  const L = lakeSpec;

  // the spill channel: from the tip of the water to the crest of the rim, a little below the water at its head and falling to the lip
  const channel = { ax: lake.tip.x, az: lake.tip.z, bx: lake.crest.x - lake.ux * 1.5, bz: lake.crest.z - lake.uz * 1.5 };

  const rise = places.rise;
  const hollow = places.hollow;

  function height(x, z, base) {
    let h = base;

    // the rocky rise: a hill with a rugged top
    {
      const d = Math.hypot(x - rise.x, z - rise.z) / rise.radius;
      if (d < 1) {
        const body = 1 - smooth(0.0, 1.0, d);
        const crag = (noise(x / 9 + 3, z / 9 - 4) - 0.5) * 2.4 * body;
        h += rise.gain * body * body * (1.15 - 0.15 * d) + crag * smooth(0.0, 0.5, body);
      }
    }

    // the hollow: a bite out of the north face of the hill south of the meadow, open to the meadow, with a lip of higher ground behind it
    {
      const dx = x - hollow.x, dz = z - hollow.z;
      const d = Math.hypot(dx, dz) / hollow.radius;
      if (d < 2.2) {
        const bowl = 1 - smooth(0.25, 1.25, d);
        const back = dz > 0 ? smooth(0.0, 1.0, dz / (hollow.radius * 1.6)) * (1 - smooth(1.1, 2.2, d)) : 0;
        h += -hollow.floor * 1.0 * bowl + 1.3 * back;
      }
    }

    // the lake
    const s = lake.signed(x, z);
    if (s >= 0) {
      // in the water the bed is a shallow bowl that shelves gently from the shore
      h = L.level - L.depth * Math.pow(smooth(0, L.shelf, s), 0.8);
    } else if (s > -L.carveOuter) {
      // on land: high ground is cut back to a bank that rises gently from the shore; low ground is only built up close to the water, so it holds it
      const bank = L.level + 0.12 + L.bankSlope * (-s);
      h = h > bank ? mix(h, bank, 1 - smooth(4, L.carveOuter, -s)) : mix(h, bank, 1 - smooth(1.5, 11, -s));
    }

    // the spill channel: a notch through the bank that carries the water to the rim, falling from just under the water level
    {
      const hit = segmentDistance(x, z, channel.ax, channel.az, channel.bx, channel.bz);
      const along = hit.t;
      const half = L.channelWidth * 0.5;
      const w = 1 - smooth(half, half + 4.5, hit.distance);
      if (w > 0) {
        const bed = mix(L.level - 0.1, 0.45, smooth(0.25, 1.0, along));
        h = mix(h, Math.min(h, bed), w);
      }
    }
    return h;
  }

  // how much of each ground kind a point has, starting from the shape's own values (grass 0..1, stone 0..1: the island's dark rock)
  function paint(x, z, out) {
    const s = lake.signed(x, z);
    if (s > -8) {
      // the shore: dark wet shingle that reaches further up the bank in some places than in others, no turf in the water, and a stony bed under it
      const reach = 1.2 + 3.6 * noise(x / 7 + 31, z / 7 - 17);
      const shingle = smooth(-reach, -0.15, s);
      out.stone = Math.max(out.stone, shingle);
      out.grass = Math.min(out.grass, 1 - shingle);
      out.gravel = Math.max(out.gravel, 0.35 * shingle * (1 - smooth(0.5, 3, s)));
    }
    {
      const d = Math.hypot(x - rise.x, z - rise.z) / rise.radius;
      if (d < 1.15) {
        // bare rock in patches (more of it nearer the top), turf in between
        const patch = smooth(0.36, 0.62, noise(x / 5.5 + 11, z / 5.5 + 5));
        const rocky = (1 - smooth(0.25, 1.1, d)) * mix(0.2 + 0.8 * patch, 1, 1 - smooth(0.12, 0.42, d)); // all bare rock at the very top
        out.stone = Math.max(out.stone, rocky);
        out.grass = Math.min(out.grass, 1 - rocky * 0.95);
      }
    }
    {
      const dx = x - hollow.x, dz = z - hollow.z;
      const d = Math.hypot(dx, dz) / hollow.radius;
      if (d < 1.6) {
        const inside = 1 - smooth(0.4, 1.5, d);
        out.stone = Math.max(out.stone, inside * 0.75);
        out.grass = Math.min(out.grass, 1 - inside * 0.8);
      }
    }
    return out;
  }

  return { lake, channel, height, paint, config, places, lakeSpec };
}

export { topOffset };
