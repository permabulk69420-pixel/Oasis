import * as THREE from 'three';
import { SKY_ISLAND, noise3, outlineRadius } from './sky-island-shape.js';
import { clamp, mix, smooth, noise } from './world-math.js';
import { mulberry32 } from './find-shapes.js';

// The island's stone: boulders, the tall spire on the rise, the lookout ledge, the hollow's overhang, outcrops standing in the lake, stepping stones over the
// outflow, and small stones along the paths. All of it is set dressing in the terrain's own material (dark cool "island stone", see materials.js), baked
// into a few merged meshes, one per place, so each is culled on its own and the whole lot is a handful of draw calls. Shapes are flat shaded: a
// displaced icosphere cut by a few planes (fractured blocks) and tapered faceted columns (the spire). Pure up to `createRockMeshes`, so tests can run it.
// Everything is placed on the drawn ground (the mesh), sunk a little, away from the meadow, the paths and the water.

const TAU = Math.PI * 2;

export const ROCKS = Object.freeze({
  seed: 0x5ee1b0,
  maxTriangles: 90000,
  cell: 130,                // metres: stones in the same square are drawn as one mesh
  spire: Object.freeze({ height: 27 }),
});

// ---------------------------------------------------------------------------------------------------------------------------- shapes
const spheres = new Map();
function icosphere(detail) {
  if (spheres.has(detail)) return spheres.get(detail);
  const t = (1 + Math.sqrt(5)) / 2;
  const raw = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let verts = raw.map(([x, y, z]) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; });
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let d = 0; d < detail; d++) {
    const cache = new Map();
    const mid = (i, j) => {
      const key = i < j ? `${i}_${j}` : `${j}_${i}`;
      if (cache.has(key)) return cache.get(key);
      const a = verts[i], b = verts[j];
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const l = Math.hypot(m[0], m[1], m[2]);
      verts.push([m[0] / l, m[1] / l, m[2] / l]);
      cache.set(key, verts.length - 1);
      return verts.length - 1;
    };
    const next = [];
    for (const [a, b, c] of faces) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    faces = next;
  }
  const result = { verts, faces };
  spheres.set(detail, result);
  return result;
}

// A flat-shaded triangle soup in the terrain material's attributes: colour (1, tone, turf) and zone (0, -stone, 0). `moss` (0..1) puts turf on a face.
class RockSoup {
  constructor() { this.position = []; this.normal = []; this.color = []; this.zone = []; this.minX = Infinity; this.maxX = -Infinity; this.minZ = Infinity; this.maxZ = -Infinity; }
  get triangles() { return this.position.length / 9; }
  tri(a, b, c, tone, moss) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-9) return false;
    nx /= length; ny /= length; nz /= length;
    // turf on the faces that look up, in patches
    const cx = (a[0] + b[0] + c[0]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
    const m = moss * smooth(0.5, 0.9, ny) * (0.45 + 0.55 * noise(cx * 0.9 + 3, cz * 0.9 - 8));
    for (const p of [a, b, c]) {
      this.position.push(p[0], p[1], p[2]);
      this.normal.push(nx, ny, nz);
      this.color.push(1, tone, m);
      this.zone.push(0, -(1 - 0.8 * m), 0);
      if (p[0] < this.minX) this.minX = p[0]; if (p[0] > this.maxX) this.maxX = p[0];
      if (p[2] < this.minZ) this.minZ = p[2]; if (p[2] > this.maxZ) this.maxZ = p[2];
    }
    return true;
  }
}

// A rotation: tilt about x then z, then yaw about y (the order a rock is settled in), as nine numbers.
function rotation(yaw, tiltX, tiltZ) {
  const cx = Math.cos(tiltX), sx = Math.sin(tiltX), cz = Math.cos(tiltZ), sz = Math.sin(tiltZ), cy = Math.cos(yaw), sy = Math.sin(yaw);
  // R = Ry * Rz * Rx
  const rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  const ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const mul = (A, B) => [
    A[0] * B[0] + A[1] * B[3] + A[2] * B[6], A[0] * B[1] + A[1] * B[4] + A[2] * B[7], A[0] * B[2] + A[1] * B[5] + A[2] * B[8],
    A[3] * B[0] + A[4] * B[3] + A[5] * B[6], A[3] * B[1] + A[4] * B[4] + A[5] * B[7], A[3] * B[2] + A[4] * B[5] + A[5] * B[8],
    A[6] * B[0] + A[7] * B[3] + A[8] * B[6], A[6] * B[1] + A[7] * B[4] + A[8] * B[7], A[6] * B[2] + A[7] * B[5] + A[8] * B[8]];
  return mul(ry, mul(rz, rx));
}
const apply = (R, x, y, z) => [R[0] * x + R[1] * y + R[2] * z, R[3] * x + R[4] * y + R[5] * z, R[6] * x + R[7] * y + R[8] * z];

// A block of fractured stone. spec: { x, y, z (centre, world), yaw, tiltX, tiltZ, half: [a, b, c], seed, detail, cuts, flat, moss, tone }
export function addBoulder(soup, spec) {
  const { verts, faces } = icosphere(spec.detail);
  const rnd = mulberry32(spec.seed);
  const [a, b, c] = spec.half;
  const ox = rnd() * 64, oy = rnd() * 64, oz = rnd() * 64;
  const planes = [];
  for (let k = 0; k < spec.cuts; k++) {
    const phi = rnd() * TAU, ny = -0.1 + rnd() * 1.1, rr = Math.sqrt(Math.max(0, 1 - ny * ny));
    const n = [Math.cos(phi) * rr, ny, Math.sin(phi) * rr];
    planes.push({ n, d: Math.hypot(a * n[0], b * n[1], c * n[2]) * (0.62 + rnd() * 0.24) });
  }
  const R = rotation(spec.yaw, spec.tiltX, spec.tiltZ);
  const bottom = -b * spec.flat;
  const local = verts.map(([ux, uy, uz]) => {
    const lump = noise3(ux * 1.5 + ox, uy * 1.5 + oy, uz * 1.5 + oz) * 0.6 + noise3(ux * 3.3 + oy, uy * 3.3 + oz, uz * 3.3 + ox) * 0.4;
    const r = 1 + (lump - 0.5) * 0.7;
    let px = ux * r * a, py = uy * r * b, pz = uz * r * c;
    for (const pl of planes) {
      const t = px * pl.n[0] + py * pl.n[1] + pz * pl.n[2] - pl.d;
      if (t > 0) { px -= pl.n[0] * t; py -= pl.n[1] * t; pz -= pl.n[2] * t; }
    }
    const chip = (noise3(ux * 7 + oz, uy * 7 + ox, uz * 7 + oy) - 0.5) * 0.07 * Math.min(a, b, c);
    px += ux * chip; py += uy * chip; pz += uz * chip;
    return { x: px, y: Math.max(py, bottom), z: pz };
  });
  const world = local.map(p => { const q = apply(R, p.x, p.y, p.z); return [q[0] + spec.x, q[1] + spec.y, q[2] + spec.z]; });
  let n = 0;
  faces.forEach(([i, j, k], f) => {
    // the flat underside is buried: leave it out
    if (local[i].y <= bottom + 1e-4 && local[j].y <= bottom + 1e-4 && local[k].y <= bottom + 1e-4) return;
    const tone = clamp(spec.tone + (mulberry32(spec.seed + f * 31)() - 0.5) * 0.3, 0, 1);
    if (soup.tri(world[i], world[j], world[k], tone, spec.moss)) n++;
  });
  return n;
}

// A tapering faceted column leaning and twisting as it rises (the spire's blades). spec: { x, y, z (the foot, world), height, baseR, topR, sides, lean: [x, z] (metres at the top),
// twist (radians over the height), seed, tone, bury }
export function addColumn(soup, spec) {
  const rnd = mulberry32(spec.seed);
  const bury = spec.bury ?? 1.6;
  const rings = Math.max(3, Math.round((spec.height + bury) / 1.7));
  const ox = rnd() * 50, oz = rnd() * 50;
  const phase = rnd() * TAU;
  const sides = spec.sides;
  const jitter = Array.from({ length: sides }, () => 0.86 + rnd() * 0.26);
  const grid = [];
  for (let k = 0; k <= rings; k++) {
    const t = k / rings;
    const h = -bury + (spec.height + bury) * t;
    const u = h / spec.height;                                  // 0 at the foot, 1 at the top (negative below ground)
    const lean = Math.pow(Math.max(u, 0), 1.35);
    const cx = spec.x + spec.lean[0] * lean, cz = spec.z + spec.lean[1] * lean;
    const taper = mix(spec.baseR * (1 + 0.5 * Math.max(0, -u * 0.6)), spec.topR, Math.pow(clamp(u, 0, 1), 0.85));
    const strata = 1 + 0.075 * Math.sin(h * 1.9 + ox) + 0.05 * Math.sin(h * 4.3 + oz);
    const row = [];
    for (let s = 0; s < sides; s++) {
      const ang = phase + (s / sides) * TAU + spec.twist * clamp(u, 0, 1);
      const lump = 0.9 + 0.2 * noise3(Math.cos(ang) * 1.4 + ox, h * 0.35, Math.sin(ang) * 1.4 + oz);
      const r = taper * strata * jitter[s] * lump;
      row.push([cx + Math.cos(ang) * r, spec.y + h, cz + Math.sin(ang) * r]);
    }
    grid.push(row);
  }
  let n = 0;
  for (let k = 0; k < rings; k++) {
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      const a = grid[k][s], b = grid[k][s2], c = grid[k + 1][s], d = grid[k + 1][s2];
      const tone = clamp(spec.tone + (mulberry32(spec.seed + k * 977 + s * 13)() - 0.5) * 0.28, 0, 1);
      const moss = spec.moss ? spec.moss * (1 - smooth(0, 3.5, (a[1] + c[1]) / 2 - spec.y)) : 0;
      if (soup.tri(a, c, b, tone, moss)) n++;
      if (soup.tri(b, c, d, tone, moss)) n++;
    }
  }
  // the top: a broken point, off to one side
  const top = grid[rings];
  const apex = [top.reduce((s, p) => s + p[0], 0) / sides + (rnd() - 0.5) * spec.topR * 0.8, spec.y + spec.height + spec.topR * (0.5 + rnd() * 0.9), top.reduce((s, p) => s + p[2], 0) / sides + (rnd() - 0.5) * spec.topR * 0.8];
  for (let s = 0; s < sides; s++) if (soup.tri(top[s], apex, top[(s + 1) % sides], clamp(spec.tone + 0.08, 0, 1), 0)) n++;
  return n;
}

// ---------------------------------------------------------------------------------------------------------------------------- where it all goes
// `ctx`: { ground (the drawn ground), features (sky-island-places.js), pathIndex (sky-island-paths.js), config }. Returns [{ chunk, type, ...spec }].
export function layoutRocks(ctx, spec = ROCKS) {
  const { ground, features, pathIndex, config = SKY_ISLAND, avoid = [] } = ctx;
  const { lake, places, channel } = features;
  const rng = mulberry32(spec.seed);
  const items = [];
  const placed = [];
  const cell = 6;
  const grid = new Map();
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  const level = features.lakeSpec.level;
  const rand = (lo, hi) => lo + rng() * (hi - lo);
  const rimGap = (x, z) => outlineRadius(Math.atan2(z - config.z, x - config.x), config) - config.lip - Math.hypot(x - config.x, z - config.z);
  const channelDistance = (x, z) => {
    const dx = channel.bx - channel.ax, dz = channel.bz - channel.az;
    const t = clamp(((x - channel.ax) * dx + (z - channel.az) * dz) / (dx * dx + dz * dz), 0, 1);
    return Math.hypot(x - (channel.ax + dx * t), z - (channel.az + dz * t));
  };
  const centres = {
    meadow: places.meadow, lake: lake.toWorld(0, 0), grove: places.grove, rise: places.rise, rim: places.rim, hollow: places.hollow,
  };
  // which place a stone belongs to (the nearest one): used to group the stones, not to draw them (that is the cell, below)
  const placeOf = (x, z) => {
    let best = 'meadow', bestD = Infinity;
    for (const [name, c] of Object.entries(centres)) {
      const d = Math.hypot(x - c.x, z - c.z);
      if (d < bestD) { bestD = d; best = name; }
    }
    return best;
  };

  // is there room for a stone of radius r at (x, z)? opts: water (stand in the lake), meadow (allowed on the meadow), free (skip the spacing test)
  function room(x, z, r, opts = {}) {
    const g = ground(x, z);
    if (g === null || rimGap(x, z) < r + 5) return false;
    if (!opts.meadow && Math.hypot(x - places.meadow.x, z - places.meadow.z) < places.meadow.radius + r) return false;
    const s = lake.signed(x, z);
    if (opts.water) { if (s < r + 1.5) return false; } else if (s > -(opts.shore ? r * 0.45 : r * 0.5 + 0.3)) return false;
    if (pathIndex && !opts.onPath && pathIndex.clearance(x, z) < r * 0.8 + 0.4) return false;
    if (channelDistance(x, z) < 2.4 + r) return false;
    for (const t of avoid) if (Math.abs(t.x - x) < r + 1.6 && Math.abs(t.z - z) < r + 1.6 && Math.hypot(t.x - x, t.z - z) < r + 1.2) return false; // a trunk is there
    if (!opts.free) {
      const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        for (const o of grid.get(`${cx + i},${cz + j}`) || []) if (Math.hypot(o.x - x, o.z - z) < (r + o.r) * 0.85) return false;
      }
    }
    return true;
  }
  function remember(x, z, r) {
    const k = key(x, z);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push({ x, z, r });
    placed.push({ x, z, r });
  }

  function boulder(x, z, r, o = {}) {
    const squash = o.squash ?? rand(0.5, 0.85);
    const half = [r * rand(0.85, 1.3), r * squash, r * rand(0.85, 1.3)];
    let low = Infinity;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      const g = ground(x + Math.cos(a) * half[0] * 0.8, z + Math.sin(a) * half[2] * 0.8);
      if (g !== null) low = Math.min(low, g);
    }
    low = Math.min(low, ground(x, z));
    const flat = o.flat ?? 0.5;
    let y = low + half[1] * (o.sink ?? 0.42);
    if (o.minTop !== undefined && y + half[1] * 0.95 < o.minTop) y = o.minTop - half[1] * 0.95; // a stone in the water must stand clear of it
    y += o.raise ?? 0;
    const item = {
      place: o.chunk ?? placeOf(x, z), type: 'boulder', x, z, y, r,
      yaw: rng() * TAU, tiltX: (rng() - 0.5) * 0.3, tiltZ: (rng() - 0.5) * 0.3, half, seed: Math.floor(rng() * 1e9),
      detail: o.detail ?? (r < 0.6 ? 1 : r < 2.2 ? 2 : 3), cuts: o.cuts ?? 3 + Math.floor(rng() * 4), flat,
      moss: o.moss ?? rand(0.1, 0.55), tone: rng(),
    };
    items.push(item);
    remember(x, z, r);
    return item;
  }

  // a group of stones round (x, z): one big, a few middling, a few small
  function cluster(cx, cz, radius, big, o = {}) {
    let made = 0;
    const tries = (o.count ?? 7) * 14;
    const sizes = [big];
    for (let i = 1; i < (o.count ?? 7); i++) sizes.push(big * (i < 3 ? rand(0.45, 0.7) : rand(0.15, 0.4)));
    let idx = 0;
    for (let t = 0; t < tries && idx < sizes.length; t++) {
      const a = rng() * TAU, d = Math.sqrt(rng()) * radius;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      if (!room(x, z, sizes[idx], o)) continue;
      boulder(x, z, sizes[idx], { ...o, moss: o.moss });
      idx++; made++;
    }
    return made;
  }

  const rise = places.rise;
  // ---- the spire on the summit: five leaning blades of stone, the tallest 27 m, the landmark you can see from anywhere on the top
  {
    const sx = rise.summit.x, sz = rise.summit.z;
    const foot = ground(sx, sz);
    const blades = [
      { dx: 0, dz: 0, h: spec.spire.height, r0: 3.3, r1: 0.55, lean: [2.2, -1.4], twist: 0.7 },
      { dx: 3.4, dz: 1.2, h: 18, r0: 2.4, r1: 0.5, lean: [-1.4, 1.6], twist: -0.9 },
      { dx: -2.9, dz: 2.6, h: 13.5, r0: 2.1, r1: 0.45, lean: [1.1, 2.4], twist: 0.6 },
      { dx: -1.2, dz: -3.6, h: 9.5, r0: 1.7, r1: 0.4, lean: [-1.8, -0.8], twist: -0.5 },
      { dx: 4.6, dz: -2.2, h: 6.2, r0: 1.4, r1: 0.4, lean: [1.4, 0.5], twist: 0.8 },
    ];
    blades.forEach((bl, i) => items.push({
      place: 'rise', type: 'column', x: sx + bl.dx, z: sz + bl.dz, y: Math.min(foot, ground(sx + bl.dx, sz + bl.dz)), height: bl.h, baseR: bl.r0, topR: bl.r1,
      sides: 7 + (i % 3), lean: bl.lean, twist: bl.twist, seed: 7001 + i * 131, tone: 0.45 + 0.1 * i / 4, moss: 0.35, r: bl.r0 * 1.2,
    }));
    remember(sx, sz, 7);
    // a skirt of fallen blocks round its foot
    cluster(sx, sz, 9.5, 1.9, { count: 9, chunk: 'rise', moss: 0.25, free: false, meadow: true });
  }

  // ---- the lookout ledge on the rise's north-west face: a slab of rock jutting out along the slope, with blocks under its free edge
  {
    const lx = rise.ledge.x, lz = rise.ledge.z;
    const g = ground(lx, lz);
    const up = [rise.summit.x - lx, rise.summit.z - lz];
    const yaw = Math.atan2(-up[0], -up[1]); // the slab's long side (its local x) runs along the contour
    items.push({
      place: 'rise', type: 'boulder', x: lx, z: lz, y: g - 0.35, r: 4.6, yaw, tiltX: 0.0, tiltZ: 0.0,
      half: [4.8, 0.62, 2.9], seed: 31337, detail: 3, cuts: 3, flat: 1.0, moss: 0.18, tone: 0.55,
    });
    remember(lx, lz, 4.6);
    cluster(lx - up[0] / Math.hypot(...up) * -5, lz - up[1] / Math.hypot(...up) * -5, 5.5, 1.3, { count: 5, chunk: 'rise', free: false });
  }

  // ---- crags on the rise itself: a few big stones with scree round them, kept off the paths
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + rng() * 0.5, d = rand(11, 25);
    cluster(rise.x + Math.cos(a) * d, rise.z + Math.sin(a) * d, 5, rand(1.3, 2.4), { count: 6, chunk: 'rise', moss: 0.35 });
  }
  for (let t = 0, n = 0; t < 900 && n < 40; t++) {
    const a = rng() * TAU, d = Math.sqrt(rng()) * rise.radius * 1.15;
    const x = rise.x + Math.cos(a) * d, z = rise.z + Math.sin(a) * d, r = rand(0.22, 0.55);
    if (room(x, z, r)) { boulder(x, z, r, { chunk: 'rise', moss: 0.2, detail: 1 }); n++; }
  }

  // ---- the lake: stones along the shore in groups, a rocky headland, outcrops standing in the water, pebbles in the shallows
  {
    const outline = lake.outline;
    let count = 0;
    for (let i = 3; i < outline.length; i += 5) {
      if (count >= 16) break;
      const p = outline[i];
      if (Math.hypot(p.x - channel.ax, p.z - channel.az) < 14) continue;
      // step a little onto the land
      const c = lake.toWorld(0, 0);
      const dx = p.x - c.x, dz = p.z - c.z, l = Math.hypot(dx, dz) || 1;
      const x = p.x + dx / l * rand(1.5, 4), z = p.z + dz / l * rand(1.5, 4);
      if (cluster(x, z, 4.5, rand(0.7, 1.5), { count: rng() < 0.5 ? 4 : 3, chunk: 'lake', shore: true, moss: 0.4 }) > 0) count++;
    }
    // the headland: where the west shore reaches into the water
    const head = lake.toWorld(14, -9);
    cluster(head.x - 3, head.z + 1, 6, 2.1, { count: 9, chunk: 'lake', shore: true, moss: 0.3 });
    // outcrops in the water
    let outcrops = 0;
    for (let t = 0; t < 400 && outcrops < 3; t++) {
      const u = rand(-34, 30), v = rand(-12, 22);
      const p = lake.toWorld(u, v);
      if (lake.signed(p.x, p.z) < 9) continue;
      if (placed.some(o => Math.hypot(o.x - p.x, o.z - p.z) < 14)) continue;
      const big = rand(1.5, 2.3);
      if (!room(p.x, p.z, big, { water: true })) continue;
      boulder(p.x, p.z, big, { chunk: 'lake', squash: rand(0.95, 1.2), sink: 0.55, moss: 0.3, minTop: level + rand(0.9, 1.7) });
      for (let k = 0; k < 4; k++) {
        const a = rng() * TAU, d = big * rand(1.1, 2.0), r = big * rand(0.3, 0.6);
        const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        if (room(x, z, r, { water: true })) boulder(x, z, r, { chunk: 'lake', squash: rand(0.7, 1.0), sink: 0.5, moss: 0.2 });
      }
      outcrops++;
    }
    // pebbles in the shallows and on the shingle
    for (let t = 0, n = 0; t < 900 && n < 34; t++) {
      const p = outline[Math.floor(rng() * outline.length)];
      const c = lake.toWorld(0, 0);
      const dx = c.x - p.x, dz = c.z - p.z, l = Math.hypot(dx, dz) || 1, step = rand(-2.5, 2.2);
      const x = p.x + dx / l * step, z = p.z + dz / l * step, r = rand(0.16, 0.38);
      if (ground(x, z) === null || Math.hypot(x - channel.ax, z - channel.az) < 8 || rimGap(x, z) < 6) continue;
      if (pathIndex && pathIndex.clearance(x, z) < r + 0.4) continue;
      if (lake.signed(x, z) < -r * 0.3 ? !room(x, z, r, { free: true, shore: true }) : false) continue;
      boulder(x, z, r, { chunk: 'lake', detail: 1, sink: 0.35, moss: 0, squash: rand(0.5, 0.8) });
      n++;
    }
  }

  // ---- the grove: mossy stones among the palms
  cluster(places.grove.x - 6, places.grove.z + 4, 22, 1.5, { count: 8, chunk: 'grove', moss: 0.7 });
  cluster(places.grove.x + 9, places.grove.z - 8, 14, 1.1, { count: 5, chunk: 'grove', moss: 0.75 });

  // ---- the meadow's edge: a few big stones standing round it, none on it
  for (let k = 0; k < 4; k++) {
    const a = rng() * TAU, d = places.meadow.radius + rand(5, 22);
    cluster(places.meadow.x + Math.cos(a) * d, places.meadow.z + Math.sin(a) * d, 6, rand(1.0, 1.9), { count: 5, chunk: 'meadow', moss: 0.45 });
  }

  // ---- the rim: a broken wall of stones along the edge by the lookout, the lookout's own front left open
  {
    const base = Math.atan2(places.rim.z - config.z, places.rim.x - config.x);
    for (let k = 0; k < 7; k++) {
      const a = base + (k - 3) * 0.045 + rand(-0.01, 0.01);
      const edge = outlineRadius(a, config) - config.lip;
      const gap = rand(7, 13);
      const x = config.x + Math.cos(a) * (edge - gap), z = config.z + Math.sin(a) * (edge - gap);
      if (Math.abs(k - 3) <= 0) continue; // the way to the view
      cluster(x, z, 4, rand(0.9, 1.9), { count: 4, chunk: 'rim', moss: 0.35 });
    }
  }

  // ---- the hollow: a roof of rock over the nook's back, held up by blocks
  {
    const h = places.hollow;
    const floor = ground(h.x, h.z);
    const roofZ = h.z + 7.4;
    items.push({
      place: 'hollow', type: 'boulder', x: h.x - 0.5, z: roofZ, y: floor + 3.1, r: 5, yaw: 0.12, tiltX: -0.07, tiltZ: 0.03,
      half: [5.0, 0.8, 3.4], seed: 90210, detail: 3, cuts: 4, flat: 1.0, moss: 0.4, tone: 0.5,
    });
    remember(h.x, roofZ, 5);
    const supports = [[-5.4, 5.2, 2.2], [4.9, 5.6, 1.9], [-0.5, 9.4, 2.6], [-6.8, 1.0, 1.4], [6.4, 1.8, 1.5]];
    for (const [dx, dz, r] of supports) {
      const x = h.x + dx, z = h.z + dz;
      boulder(x, z, r, { chunk: 'hollow', free: true, squash: 0.95, moss: 0.35, raise: dz > 4 ? 0.4 : 0 });
    }
    cluster(h.x, h.z - 2, 11, 0.7, { count: 7, chunk: 'hollow', moss: 0.4, onPath: true });
  }

  // ---- the stepping stones over the outflow, just above the fall
  {
    const cross = [[-209.6, 455.6], [-208.0, 455.4], [-206.5, 455.4], [-205.0, 455.3], [-203.5, 455.3], [-202.2, 455.2]];
    cross.forEach(([x, z], i) => {
      const g = ground(x, z);
      if (g === null) return;
      const r = 0.62 + (i % 2) * 0.1;
      items.push({
        place: 'lake', type: 'boulder', x, z, y: g + 0.1, r, yaw: i * 1.3, tiltX: 0, tiltZ: 0, half: [r, 0.3, r * 0.9], seed: 4400 + i, detail: 2, cuts: 4, flat: 0.5,
        moss: 0.1, tone: 0.6, stepping: true,
      });
    });
  }

  // ---- small stones all over, thickest by the paths
  for (let t = 0, n = 0; t < 6000 && n < 90; t++) {
    const a = rng() * TAU, d = Math.sqrt(rng()) * config.radius * 0.9;
    const x = config.x + Math.cos(a) * d, z = config.z + Math.sin(a) * d, r = rand(0.12, 0.34);
    if (!room(x, z, r)) continue;
    const near = pathIndex ? pathIndex.nearest(x, z) : { distance: Infinity };
    if (near.distance > 9) continue; // they lie along the paths
    boulder(x, z, r, { detail: 1, moss: 0.15, sink: 0.35 });
    n++;
  }
  // each stone is drawn with the others in its patch of the island (a 130 m cell), so a mesh is small enough to be left out when it is behind you
  for (const item of items) item.chunk = `${Math.floor(item.x / spec.cell)}_${Math.floor(item.z / spec.cell)}`;
  return items;
}

// ---------------------------------------------------------------------------------------------------------------------------- the geometry
// Items to arrays, one set per chunk: { name, positions, normals, colors, zones, bounds, triangles }.
export function buildRocks(items) {
  const soups = new Map();
  for (const item of items) {
    if (!soups.has(item.chunk)) soups.set(item.chunk, new RockSoup());
    const soup = soups.get(item.chunk);
    if (item.type === 'column') addColumn(soup, item); else addBoulder(soup, item);
  }
  const chunks = [];
  let triangles = 0;
  for (const [name, soup] of soups) {
    triangles += soup.triangles;
    chunks.push({
      name, positions: Float32Array.from(soup.position), normals: Float32Array.from(soup.normal), colors: Float32Array.from(soup.color), zones: Float32Array.from(soup.zone),
      triangles: soup.triangles, bounds: { minX: soup.minX, maxX: soup.maxX, minZ: soup.minZ, maxZ: soup.maxZ },
    });
  }
  return { chunks, triangles };
}

// In the game: one mesh per place, in the terrain's own material.
export function createRockMeshes({ island, material, items }) {
  const data = buildRocks(items);
  const group = new THREE.Group();
  group.name = 'Island stone';
  for (const chunk of data.chunks) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(chunk.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(chunk.normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(chunk.colors, 3));
    geometry.setAttribute('zone', new THREE.BufferAttribute(chunk.zones, 3));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `Island stone: ${chunk.name}`;
    group.add(mesh);
  }
  return { group, triangles: data.triangles, chunks: data.chunks, items };
}
