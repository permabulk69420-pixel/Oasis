import { noise, clamp } from './world-math.js';
import { SKY_ISLAND, outlineRadius, undersidePoint } from './sky-island-shape.js';
import { mulberry32 } from './find-shapes.js';

// Where the island's new plants and landmarks go (Kane, 5 Oct: it is the player's home base, so each place has its own plants and the layout stays loose enough to
// build over later). Every plant type has its own spot:
//   meadow   (the start, kept clear)  big pale night flowers in drifts round its edge, one weeping glow-tree standing sentinel on the way to the lake
//   grove    the palms' shade: ferns, fungus logs, little glowing mushrooms, and the twisted root arch where the path goes in
//   lake     weeping glow-trees on the bay and the headland, driftwood and fallen logs on the shore, night flowers in the bay
//   rise     mossy cushions on the boulders, a fallen log or two
//   rim      the standing stones with their glow seams framing the view, vine curtains hanging off the lip, a drift of flowers
//   hollow   the broken ribcage in its mouth, pale bones, vines under the overhang, mushrooms, cushions
// plus glowing mushrooms along every path. Pure and seeded; the same island grows the same plants every time. Everything keeps off the paths (but the arch,
// which stands over one), the rocks, the palms and glow plants already placed, the water and the spill channel, and stands on the drawn ground.
export const ISLAND_FLORA = Object.freeze({
  seed: 0x7f10a3,
  // Kane, 6 Oct: "the log and some things are low quality assets... focus on good quality". These are not placed (their models stay in the code for a later,
  // better version): the mossy cushions, both logs, the driftwood, the bones, the ribcage and the standing stones.
  retired: Object.freeze(['cushion', 'fungusLog', 'log', 'driftwoodA', 'driftwoodB', 'driftwoodC', 'bonesA', 'bonesB', 'ribcage', 'standingStoneA', 'standingStoneB']),
  slopeLimit: 0.9,
  vineBulge: 0.45,            // how far the cliff may poke out past a rim curtain's anchor (the anchor moves out to meet it)
  vineSpacing: 15,            // metres along the rim between two curtains
  vineReach: 0.75,            // radians either side of the lookout the curtains are spread over (a couple more anywhere)
  count: Object.freeze({
    tree: 5, fern: 62, cushion: 46, mushrooms: 46, flower: 50, fungusLog: 5, log: 4, driftwood: 6, bones: 6, rimVines: 9,
  }),
  scale: Object.freeze({
    tree: [0.9, 1.12], fern: [0.8, 1.35], cushion: [0.8, 1.7], mushrooms: [1.1, 1.9], flower: [0.85, 1.45], log: [0.9, 1.15], driftwood: [0.9, 1.3], bones: [1.0, 1.6], rimVines: [2.0, 2.6],
  }),
});

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------------------------------------- stone surfaces
// The top of a boulder at (x, z): its ellipsoid (the layout's half sizes, turned by its yaw; its small tilts are left out), or null off the stone. The stones'
// shapes are a Blender kit (src/sky-island-rocks.js) that fills about this ellipsoid, a few centimetres either way.
export function boulderTop(item, x, z) {
  const [a, b, c] = item.half;
  const dx = x - item.x, dz = z - item.z, cy = Math.cos(item.yaw ?? 0), sy = Math.sin(item.yaw ?? 0);
  const u = (dx * cy - dz * sy) / a, w = (dx * sy + dz * cy) / c;
  const k = 1 - u * u - w * w;
  return k <= 0 ? null : item.y + b * Math.sqrt(k);
}

// The lowest vertices on the front of a stone's underside, for hanging things from an overhang: [{ x, y, z }] sorted along x.
export function undersideEdge(item, front) {
  // points over the stone's ellipsoid (flat underneath where it is cut, as the kit's pieces are), turned by its yaw
  const [a, b, c] = item.half, cy = Math.cos(item.yaw ?? 0), sy = Math.sin(item.yaw ?? 0), bottom = -b * (item.flat ?? 0.5);
  const verts = [];
  for (let i = 1; i < 16; i++) {
    const lat = Math.PI * (i / 16 - 0.5), ring = Math.cos(lat);
    for (let j = 0; j < 32; j++) {
      const lon = (j / 32) * TAU;
      const lx = Math.cos(lon) * ring * a, ly = Math.max(Math.sin(lat) * b, bottom), lz = Math.sin(lon) * ring * c;
      verts.push([item.x + lx * cy + lz * sy, item.y + ly, item.z - lx * sy + lz * cy]);
    }
  }
  const dir = Math.atan2(front[1], front[0]);
  const cs = Math.cos(dir), sn = Math.sin(dir);
  let far = -Infinity;
  for (const p of verts) far = Math.max(far, (p[0] - item.x) * cs + (p[2] - item.z) * sn);
  return verts.filter(p => (p[0] - item.x) * cs + (p[2] - item.z) * sn > far - 1.6).map(p => ({ x: p[0], y: p[1], z: p[2] }));
}

// ---------------------------------------------------------------------------------------------------------------------------- the layout
// [{ type, x, y, z, yaw, scale, tiltX, tiltZ, place }] in world metres (the model name `type` is a key of FLORA_MODELS). ctx: { ground (the drawn ground), features,
// pathIndex, paths (the path data), config, obstacles: [{ x, z, r }] (palms, glow plants), rocks (the rock layout), waterY (the lake's surface in world metres) }.
export function layoutIslandFlora(ctx, spec = ISLAND_FLORA) {
  const { ground, features, pathIndex, paths = [], config = SKY_ISLAND, obstacles = [], rocks = [] } = ctx;
  const { lake, places, channel } = features;
  const waterY = ctx.waterY ?? features.lakeSpec.level;
  const retired = new Set(spec.retired ?? []);
  const wants = (...types) => types.some(type => !retired.has(type));
  const random = mulberry32(spec.seed);
  const rand = (lo, hi) => lo + random() * (hi - lo);
  const items = [];
  const cell = 8;
  const grid = new Map();
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  const add = (map, x, z, o) => { const k = key(x, z); if (!map.has(k)) map.set(k, []); map.get(k).push(o); };
  for (const o of obstacles) add(grid, o.x, o.z, { x: o.x, z: o.z, r: o.r });
  for (const o of rocks) if (o.r >= 0.3 && !o.stepping) add(grid, o.x, o.z, { x: o.x, z: o.z, r: o.type === 'column' ? o.baseR : o.r * 0.9 });
  const rimGap = (x, z) => outlineRadius(Math.atan2(z - config.z, x - config.x), config) - config.lip - Math.hypot(x - config.x, z - config.z);
  const slope = (x, z) => Math.max(Math.abs((ground(x + 1, z) ?? 0) - (ground(x - 1, z) ?? 0)), Math.abs((ground(x, z + 1) ?? 0) - (ground(x, z - 1) ?? 0))) / 2;
  const channelDistance = (x, z) => {
    const dx = channel.bx - channel.ax, dz = channel.bz - channel.az;
    const t = clamp(((x - channel.ax) * dx + (z - channel.az) * dz) / (dx * dx + dz * dz), 0, 1);
    return Math.hypot(x - (channel.ax + dx * t), z - (channel.az + dz * t));
  };
  const lakeCentre = lake.toWorld(0, 0);
  const meadow = places.meadow;

  // is there room for something of radius r at (x, z)? opts: pathGap (metres from a path's edge, default r + 0.8), rim (default r + 5), slope, meadow (allowed on it),
  // shore (allowed down to the waterline), free (skip the spacing test against what has been placed: for things that sit on a stone)
  function room(x, z, r, opts = {}) {
    if (ground(x, z) === null || rimGap(x, z) < (opts.rim ?? r + 5)) return false;
    if (!opts.meadow && Math.hypot(x - meadow.x, z - meadow.z) < meadow.radius + (opts.meadowGap ?? 2)) return false;
    if (lake.signed(x, z) > -(opts.shore ? 0.6 : r + 1.4)) return false;
    if (channelDistance(x, z) < 3 + r) return false;
    if (!opts.onPath && pathIndex.clearance(x, z) < (opts.pathGap ?? r + 0.8)) return false;
    if (slope(x, z) > (opts.slope ?? spec.slopeLimit)) return false;
    if (!opts.free) {
      const gx = Math.floor(x / cell), gz = Math.floor(z / cell), reach = Math.ceil((r + 4) / cell);
      for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) {
        for (const o of grid.get(`${gx + a},${gz + b}`) || []) {
          const gap = o.soft ? (r + o.r) * 0.55 : r + o.r + (o.pad ?? 0.3);
          if (Math.hypot(o.x - x, o.z - z) < gap) return false;
        }
      }
    }
    return true;
  }
  function put(type, x, z, o = {}) {
    const scale = o.scale ?? 1;
    const item = {
      type, x, z, y: (o.y ?? ground(x, z)) - (o.sink ?? 0) * scale, yaw: o.yaw ?? random() * TAU, scale, tiltX: o.tiltX ?? 0, tiltZ: o.tiltZ ?? 0, place: o.place,
    };
    items.push(item);
    if (o.r !== undefined && !o.free) add(grid, x, z, { x, z, r: o.r, soft: o.soft, pad: o.pad });
    return item;
  }
  const ring = (cx, cz, from, to) => () => { const a = random() * TAU, d = rand(from, to); return { x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d }; };
  const disc = (cx, cz, radius) => () => { const a = random() * TAU, d = Math.sqrt(random()) * radius; return { x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d }; };
  const lakeEdge = (inner, outer, filter = () => true) => () => {
    for (let k = 0; k < 40; k++) {
      const p = lake.outline[Math.floor(random() * lake.outline.length)];
      const dx = p.x - lakeCentre.x, dz = p.z - lakeCentre.z, l = Math.hypot(dx, dz) || 1, out = rand(inner, outer);
      const q = { x: p.x + dx / l * out, z: p.z + dz / l * out, p };
      if (filter(lake.toLocal(p.x, p.z))) return q;
    }
    return { x: lakeCentre.x, z: lakeCentre.z };
  };
  // a log or driftwood lying along its local x: tilted to the ground at both ends
  function lie(type, x, z, yaw, length, place, o = {}) {
    length *= o.scale ?? 1;
    const dx = Math.cos(yaw) * length / 2, dz = -Math.sin(yaw) * length / 2;
    const a = ground(x - dx, z - dz), b = ground(x + dx, z + dz), mid = ground(x, z);
    if (a === null || b === null || mid === null) return null;
    const pitch = Math.atan2(b - a, length);
    if (Math.abs(pitch) > 0.42) return null;
    return put(type, x, z, { ...o, yaw, y: (a + b) / 2 + 0.03, tiltZ: pitch, place, scale: o.scale ?? 1 });
  }
  const path = name => paths.find(p => p.name === name);

  // ---- the root arch: standing over the path where it goes into the grove, its opening along the way
  {
    const route = path('meadow to grove');
    let best = null;
    // with no path to follow (the island has none now) the arch stands at the grove's edge on the line to the meadow, its opening along that line
    if (!route) {
      const toMeadow = Math.atan2(meadow.z - places.grove.z, meadow.x - places.grove.x);
      for (let d = 22; d <= 34 && !best; d += 1.5) for (const da of [0, 0.12, -0.12, 0.25, -0.25, 0.4, -0.4]) {
        const a = toMeadow + da, x = places.grove.x + Math.cos(a) * d, z = places.grove.z + Math.sin(a) * d;
        if (Math.hypot(x - meadow.x, z - meadow.z) < meadow.radius + 4 || ground(x, z) === null || rimGap(x, z) <= 12 || slope(x, z) > 0.4) continue;
        let clear = true;
        for (const k of [-3, -1.5, 0, 1.5, 3]) {
          const px = x + Math.cos(a) * k, pz = z + Math.sin(a) * k;
          if (ground(px, pz) === null || lake.signed(px, pz) > -2) clear = false;
          for (const o of grid.get(key(px, pz)) || []) if (Math.hypot(o.x - px, o.z - pz) < o.r + 0.9) clear = false;
        }
        if (clear) best = { s: { x, z }, yaw: Math.atan2(Math.cos(a), Math.sin(a)) };   // the passage runs along (sin yaw, cos yaw)
      }
    }
    if (route) for (const s of route.samples) {
      const dg = Math.hypot(s.x - places.grove.x, s.z - places.grove.z);
      if (Math.hypot(s.x - meadow.x, s.z - meadow.z) < meadow.radius + 2 || dg > 34 || dg < 14) continue;
      const yaw = Math.atan2(s.tx, s.tz);
      const across = [Math.cos(yaw), -Math.sin(yaw)];
      let cost = Math.abs(dg - 27) * 0.05 + slope(s.x, s.z) * 3;
      let ok = ground(s.x, s.z) !== null && rimGap(s.x, s.z) > 12;
      for (const side of [-1, 1]) for (const reach of [2.75, 4.2]) {
        const fx = s.x + across[0] * side * reach, fz = s.z + across[1] * side * reach;
        const g = ground(fx, fz);
        if (g === null) { ok = false; break; }
        cost += Math.abs(g - ground(s.x, s.z)) * 0.5;
        for (const o of grid.get(key(fx, fz)) || []) if (Math.hypot(o.x - fx, o.z - fz) < o.r + 1.1) cost += 5;
        for (const [nx, nz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) for (const o of grid.get(key(fx + nx * cell, fz + nz * cell)) || []) if (Math.hypot(o.x - fx, o.z - fz) < o.r + 1.1) cost += 5;
      }
      // the passage itself must be clear of trunks
      for (const k of [-3, -1.5, 0, 1.5, 3]) {
        const px = s.x + s.tx * k, pz = s.z + s.tz * k;
        for (const dx of [-cell, 0, cell]) for (const dz of [-cell, 0, cell]) for (const o of grid.get(key(px + dx, pz + dz)) || []) if (Math.hypot(o.x - px, o.z - pz) < o.r + 0.9) cost += 8;
      }
      if (ok && (!best || cost < best.cost)) best = { s, yaw, cost };
    }
    if (best) {
      const { s, yaw } = best;
      put('rootArch', s.x, s.z, { yaw, scale: 1, y: ground(s.x, s.z) - 0.05, place: 'grove', r: 3.2, pad: 0.5, free: true });
      add(grid, s.x, s.z, { x: s.x, z: s.z, r: 3.4, pad: 0 });
    }
  }

  // ---- the standing stones: a pair on the rim's lookout, one each side of the view, two different shapes
  if (wants('standingStoneA', 'standingStoneB')) {
    const base = Math.atan2(places.rim.z - config.z, places.rim.x - config.x);
    const edge = outlineRadius(base, config) - config.lip;
    // each takes the nearest spot to the one it wants that has room: scanned outward over a small patch, kept on its own side of the view
    const tries = [];
    for (let a = -5; a <= 5; a++) for (let g = -5; g <= 5; g++) tries.push({ da: a * 0.0065, dg: g * 1.7 });
    tries.sort((p, q) => Math.hypot(p.da * edge, p.dg) - Math.hypot(q.da * edge, q.dg));
    for (const [type, dth, gap] of [['standingStoneA', -0.034, 17], ['standingStoneB', 0.036, 15]]) {
      for (const t of tries) {
        const th = base + dth + t.da, d = gap + t.dg;
        if (Math.sign(dth) * (dth + t.da) < 0.012) continue;           // not across the middle of the view
        const x = config.x + Math.cos(th) * (edge - d), z = config.z + Math.sin(th) * (edge - d);
        if (!room(x, z, 1.3, { slope: 0.6, pathGap: 2.2 })) continue;
        put(type, x, z, { scale: 1, place: 'rim', r: 1.3, sink: 0.12, pad: 0.8 });
        break;
      }
    }
  }

  // ---- the weeping glow-trees
  {
    const treeRoom = (x, z, o = {}) => room(x, z, 2.4, { slope: 0.55, pathGap: 2.6, shore: false, ...o });
    const plantTree = (x, z, place) => put('weepingTree', x, z, { scale: rand(...spec.scale.tree), place, r: 2.4, pad: 2.5, sink: 0.1 });
    // sentinels and lake trees: the best spot near each target (nearest that has room, searched in rings)
    const nearest = (tx, tz, place, minSep = 9) => {
      for (let radius = 0; radius <= 18; radius += 1.5) for (let k = 0; k < 14; k++) {
        const a = random() * TAU;
        const x = tx + Math.cos(a) * radius, z = tz + Math.sin(a) * radius;
        if (!treeRoom(x, z)) continue;
        if (items.some(i => i.type === 'weepingTree' && Math.hypot(i.x - x, i.z - z) < minSep)) continue;
        plantTree(x, z, place);
        return true;
      }
      return false;
    };
    // standing sentinel at the meadow's edge on the way to the lake
    const route = path('meadow to the lake');
    if (route) {
      const s = route.samples.find(q => Math.hypot(q.x - meadow.x, q.z - meadow.z) > meadow.radius + 12) ?? route.samples[Math.floor(route.samples.length / 3)];
      nearest(s.x - s.tz * 9, s.z + s.tx * 9, 'meadow', 12);
    } else {
      const toLake = Math.atan2(lakeCentre.z - meadow.z, lakeCentre.x - meadow.x);
      nearest(meadow.x + Math.cos(toLake + 0.12) * (meadow.radius + 16), meadow.z + Math.sin(toLake + 0.12) * (meadow.radius + 16), 'meadow', 12);
    }
    // the lake: two on the bay (the broad north-east shore), one on the headland, one on the south shore
    nearest(...Object.values(lake.toWorld(8, 38)), 'lake', 11);
    nearest(...Object.values(lake.toWorld(-18, 33)), 'lake', 11);
    nearest(...Object.values(lake.toWorld(15, -26)), 'lake', 11);
    nearest(...Object.values(lake.toWorld(-30, -27)), 'lake', 11);
  }

  // ---- the ribcage in the hollow's mouth, with bones about it
  if (wants('ribcage')) {
    const h = places.hollow;
    const roof = rocks.find(i => i.place === 'hollow' && i.half && i.half[0] > 4.5);
    let best = null;
    for (let k = 0; k < 400; k++) {
      const x = h.x + rand(-9, 9), z = h.z + rand(-17, -4);
      if (!room(x, z, 3.3, { slope: 0.45, pathGap: 2.0, rim: 12, meadow: false })) continue;
      if (Math.hypot(x - h.x, z - h.z) > h.radius * 1.4) continue;
      const roofGap = roof ? Math.hypot(x - roof.x, z - roof.z) - roof.half[0] : 9;
      const cost = slope(x, z) * 4 + Math.abs(Math.hypot(x - h.x, z - h.z) - h.radius * 0.9) * 0.1 + (roofGap < 5 ? 10 : 0);
      if (!best || cost < best.cost) best = { x, z, cost };
    }
    if (best) {
      put('ribcage', best.x, best.z, { yaw: Math.PI / 2 + rand(-0.25, 0.25), place: 'hollow', r: 3.4, pad: 0.4, sink: 0.04 });
      add(grid, best.x, best.z, { x: best.x, z: best.z, r: 3.6, pad: 0 });
    }
  }

  // ---- logs and driftwood
  if (wants('driftwoodA', 'fungusLog', 'log')) {
    const shore = lakeEdge(1.5, 4.5, p => true);
    let n = 0;
    for (let k = 0; k < 4000 && n < 6; k++) {
      const q = shore();
      const yaw = random() * TAU;
      if (!room(q.x, q.z, 1.6, { shore: true, pathGap: 1.6, slope: 0.4 })) continue;
      const type = ['driftwoodA', 'driftwoodB', 'driftwoodC'][n % 3];
      if (lie(type, q.x, q.z, yaw, 3.4, 'lake', { r: 1.5, scale: rand(...spec.scale.driftwood), pad: 0 })) n++;
    }
    n = 0;
    for (let k = 0; k < 4000 && n < spec.count.fungusLog; k++) {
      const c = disc(places.grove.x, places.grove.z, 26)();
      if (!room(c.x, c.z, 2.2, { pathGap: 1.6, slope: 0.4 })) continue;
      if (lie('fungusLog', c.x, c.z, random() * TAU, 4.5, 'grove', { r: 2.0, scale: rand(...spec.scale.log) })) n++;
    }
    n = 0;
    const spots = [[places.rise.x - 26, places.rise.z + 24, 14], [meadow.x - 62, meadow.z + 6, 10], [places.rise.x - 12, places.rise.z - 30, 14], [lakeCentre.x + 28, lakeCentre.z + 36, 14]];
    for (let k = 0; k < 4000 && n < spec.count.log; k++) {
      const [cx, cz, rad] = spots[n % spots.length];
      const c = disc(cx, cz, rad)();
      if (!room(c.x, c.z, 2.2, { pathGap: 1.8, slope: 0.4 })) continue;
      if (lie('log', c.x, c.z, random() * TAU, 4.5, n % 2 ? 'rise' : 'meadow', { r: 2.0, scale: rand(...spec.scale.log) })) n++;
    }
  }

  // ---- scattered bones: round the ribcage, in the hollow, and a couple elsewhere
  if (wants('bonesA', 'bonesB')) {
    const cage = items.find(i => i.type === 'ribcage');
    const spots = [];
    if (cage) { spots.push(['hollow', cage.x + 5, cage.z + 1, 4], ['hollow', cage.x - 5, cage.z - 1, 4]); }
    spots.push(['hollow', places.hollow.x, places.hollow.z, 9], ['rise', places.rise.x - 20, places.rise.z + 8, 12], ['grove', places.grove.x + 10, places.grove.z + 14, 10], ['lake', lakeCentre.x + 30, lakeCentre.z + 30, 12]);
    let n = 0;
    for (let k = 0; k < 4000 && n < spec.count.bones; k++) {
      const [place, cx, cz, rad] = spots[n % spots.length];
      const c = disc(cx, cz, rad)();
      if (!room(c.x, c.z, 0.9, { pathGap: 1.2, slope: 0.5 })) continue;
      put(n % 2 ? 'bonesB' : 'bonesA', c.x, c.z, { scale: rand(...spec.scale.bones), place, r: 0.8, sink: 0.01 });
      n++;
    }
  }

  // ---- ferns: the grove's floor in drifts, a few more at the foot of the rise and round the hollow
  {
    let n = 0;
    const grove = places.grove;
    for (let k = 0; k < 12000 && n < spec.count.fern; k++) {
      const wide = n > spec.count.fern * 0.8;
      const c = wide ? ring(places.hollow.x, places.hollow.z, 8, 24)() : disc(grove.x, grove.z, 30)();
      if (noise(c.x / 7 + 3, c.z / 7 - 5) < (wide ? 0.4 : 0.34)) continue;
      if (!room(c.x, c.z, 0.9, { pathGap: 1.0, slope: 0.7 })) continue;
      put('fern', c.x, c.z, { scale: rand(...spec.scale.fern), place: wide ? 'hollow' : 'grove', r: 0.9, soft: true });
      n++;
    }
  }

  // ---- big pale night flowers: loose drifts at the meadow's edge, in the lake's bay, on the rim, and at the grove's edge
  {
    const drifts = [];
    const base = random() * TAU;
    for (let k = 0; k < 6; k++) { const a = base + (k / 6) * TAU + rand(-0.2, 0.2); drifts.push(['meadow', meadow.x + Math.cos(a) * rand(44, 56), meadow.z + Math.sin(a) * rand(44, 56), 6]); }
    drifts.push(['lake', ...Object.values(lake.toWorld(20, 31)), 6], ['lake', ...Object.values(lake.toWorld(-4, 31)), 6], ['lake', ...Object.values(lake.toWorld(-33, 19)), 5]);
    const rimA = Math.atan2(places.rim.z - config.z, places.rim.x - config.x);
    const rimEdge = outlineRadius(rimA, config) - config.lip;
    drifts.push(['rim', config.x + Math.cos(rimA + 0.04) * (rimEdge - 12), config.z + Math.sin(rimA + 0.04) * (rimEdge - 12), 5]);
    drifts.push(['grove', places.grove.x + 30, places.grove.z - 8, 6], ['grove', places.grove.x - 22, places.grove.z + 24, 6]);
    let n = 0;
    for (const [place, cx, cz, rad] of drifts) {
      const want = Math.round(spec.count.flower / drifts.length);
      let got = 0;
      for (let k = 0; k < 300 && got < want && n < spec.count.flower; k++) {
        const c = disc(cx, cz, rad)();
        if (!room(c.x, c.z, 0.7, { pathGap: 1.1, slope: 0.6, meadowGap: 1 })) continue;
        put('flower', c.x, c.z, { scale: rand(...spec.scale.flower), place, r: 0.7, soft: true });
        got++; n++;
      }
    }
  }

  // ---- mossy cushions: on the boulders that are big enough and flat enough on top
  if (wants('cushion')) {
    const candidates = rocks.filter(i => i.type === 'boulder' && !i.stepping && i.r >= 0.9 && i.r < 4.4 && Math.abs(i.tiltX) < 0.2 && Math.abs(i.tiltZ) < 0.2);
    // shuffle
    for (let i = candidates.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [candidates[i], candidates[j]] = [candidates[j], candidates[i]]; }
    let n = 0;
    for (const rock of candidates) {
      if (n >= spec.count.cushion) break;
      for (let k = 0; k < 6; k++) {
        const a = random() * TAU, d = Math.sqrt(random()) * rock.half[0] * 0.4;
        const x = rock.x + Math.cos(a) * d, z = rock.z + Math.sin(a) * d;
        const top = boulderTop(rock, x, z);
        if (top === null) continue;
        const sc = clamp(rock.r * 0.55, 0.8, 1.9) * rand(0.8, 1.1);
        // flat enough here, and the cushion's whole foot is on the stone
        const around = [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]].map(([dx, dz]) => boulderTop(rock, x + dx * sc, z + dz * sc));
        if (around.some(h => h === null || Math.abs(h - top) > 0.22 * sc)) continue;
        if (lake.signed(x, z) > -0.5 && top < waterY + 0.4) continue;
        if (items.some(i => i.type === 'cushion' && Math.hypot(i.x - x, i.z - z) < 1.6 * sc)) continue;
        put('cushion', x, z, { y: top, sink: 0.05, scale: sc, place: rock.place, free: true });
        n++;
        break;
      }
    }
    // and a few on the ground at the foot of logs and in the grove
    for (let k = 0; k < 600 && n < spec.count.cushion + 6; k++) {
      const c = disc(places.grove.x, places.grove.z, 28)();
      if (!room(c.x, c.z, 0.6, { pathGap: 1.0, slope: 0.6 })) continue;
      put('cushion', c.x, c.z, { scale: rand(0.9, 1.5), place: 'grove', r: 0.6, soft: true, sink: 0.06 });
      n++;
    }
  }

  // ---- little glowing mushrooms: along every path, and round the logs, the stones and the hollow
  {
    let n = 0;
    const total = paths.reduce((s, p) => s + p.samples[p.samples.length - 1].along, 0);
    const want = Math.round(spec.count.mushrooms * 0.7);
    const every = total / want;
    for (const route of paths) {
      let next = rand(0.2, 1) * every;
      for (const s of route.samples) {
        if (s.along < next || n >= want) continue;
        const side = random() < 0.5 ? 1 : -1, off = s.half + rand(0.5, 1.6);
        const x = s.x - s.tz * off * side, z = s.z + s.tx * off * side;
        if (room(x, z, 0.35, { onPath: true, pathGap: 0.2, slope: 0.7, meadowGap: 0.6 }) && pathIndex.clearance(x, z) > 0.3) {
          put('mushrooms', x, z, { scale: rand(...spec.scale.mushrooms), place: 'path', r: 0.4, soft: true });
          n++; next = s.along + every * rand(0.7, 1.3);
        } else next = s.along + 1.5;
      }
    }
    // in small groups: round the arch, and under the palms, at the hollow's mouth, along the lake's banks and at the foot of the rise
    const anchors = items.filter(i => i.type === 'rootArch').map(i => ({ x: i.x, z: i.z, place: i.place, spread: 3.2 }));
    for (const [place, cx, cz, rad, groups] of [['grove', places.grove.x, places.grove.z, 28, 5], ['hollow', places.hollow.x, places.hollow.z, 14, 2], ['lake', lakeCentre.x, lakeCentre.z, 55, 4], ['rise', places.rise.x, places.rise.z, 30, 2]]) {
      for (let g = 0, tries = 0; g < groups && tries < 600; tries++) {
        const c = disc(cx, cz, rad)();
        if (!room(c.x, c.z, 1.2, { slope: 0.5, meadowGap: 6 })) continue;
        anchors.push({ x: c.x, z: c.z, place, spread: 2.2 });
        g++;
      }
    }
    for (let k = 0; k < 3000 && n < spec.count.mushrooms && anchors.length; k++) {
      const anchor = anchors[k % anchors.length];
      const a = random() * TAU, d = rand(0.4, anchor.spread);
      const x = anchor.x + Math.cos(a) * d, z = anchor.z + Math.sin(a) * d;
      if (!room(x, z, 0.35, { pathGap: 0.9, slope: 0.7, meadowGap: 0.6 })) continue;
      put('mushrooms', x, z, { scale: rand(...spec.scale.mushrooms), place: anchor.place, r: 0.4, soft: true });
      n++;
    }
  }

  // ---- vine curtains: off the rim's lip, and under the hollow's overhang
  {
    const rimA = Math.atan2(places.rim.z - config.z, places.rim.x - config.x);
    const spill = features.lakeSpec.spill;
    const wrap = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
    let n = 0;
    for (let k = 0; k < 3000 && n < spec.count.rimVines; k++) {
      const th = n < spec.count.rimVines - 2 ? rimA + rand(-spec.vineReach, spec.vineReach) : random() * TAU;
      if (Math.abs(wrap(th - spill)) < 0.075) continue;
      const scale = rand(...spec.scale.rimVines);
      const edge = outlineRadius(th, config);
      const lipStart = edge - config.lip;
      const g = ground(config.x + Math.cos(th) * (lipStart - 1.2), config.z + Math.sin(th) * (lipStart - 1.2));
      if (g === null) continue;
      const yLip = g;
      const hang = 4.2 * scale;                                   // the longest vine
      // clear air all the way down: how far the cliff pokes out past the lip over the curtain's width (the anchor moves out by as much, up to `vineBulge`)
      let bulge = 0;
      for (const dth of [-1.5 / edge * scale, 0, 1.5 / edge * scale]) {
        for (let q = 1; q <= 24; q++) {
          const v = (hang * q / 24) / config.thickness;
          bulge = Math.max(bulge, undersidePoint(th + dth, v, yLip - config.lip, config).r - (edge + 0.2));
        }
      }
      if (bulge > spec.vineBulge) continue;
      const radius = edge + 0.3 + bulge;
      if (items.some(i => i.type === 'vines' && Math.abs(wrap(i.theta - th)) * edge < spec.vineSpacing)) continue;
      const tx = -Math.sin(th), tz = Math.cos(th);
      const item = put('vines', config.x + Math.cos(th) * radius, config.z + Math.sin(th) * radius, {
        y: yLip - config.lip - 0.35, yaw: Math.atan2(-tz, tx), scale, place: 'rim', free: true,
      });
      item.theta = th;
      n++;
    }
    // under the overhang: three short curtains along the front of its underside
    const roof = rocks.find(i => i.place === 'hollow' && i.half && i.half[0] > 4.5);
    if (roof) {
      const edge = undersideEdge(roof, [0, -1]);
      const low = edge.reduce((m, p) => Math.min(m, p.y), Infinity);
      const row = edge.filter(p => p.y < low + 0.9).sort((a, b) => a.x - b.x);
      if (row.length >= 3) {
        for (const f of [0.2, 0.5, 0.8]) {
          const p = row[Math.floor(f * (row.length - 1))];
          const item = put('vines', p.x, p.z, { y: p.y + 0.08, yaw: rand(-0.15, 0.15), scale: rand(0.75, 1.0), place: 'hollow', free: true });
          item.overhang = true;
        }
      }
    }
  }
  return items.map(({ theta, overhang, ...item }) => item);
}
