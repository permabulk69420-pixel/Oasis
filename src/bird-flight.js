// Flight routes for the alien bird, and the planners that make them. Pure geometry with no three.js in it, so it
// runs (and is tested) in node.
//
// A route is a chain of cubic Bézier segments through waypoints. Every waypoint has a position, a direction of
// travel, a speed and a tag that says what the bird is doing from there to the next waypoint (cruising, soaring,
// flaring to land...). Asking a route for the point a distance along it gives the position, heading, speed, turn and
// tag, so the bird moves at the speed it should whatever the shape of the curve.
//
// Axes are the game's: metres, +y up. A heading is atan2(x, z) of the direction, so a bird flying toward +z has
// heading 0 and a heading that grows turns it to its left (towards +x).

const MIN_SAMPLES = 24;
const SAMPLE_SPACING = 1.0; // metres between the table entries that turn a distance into a position on the curve
const TAU = Math.PI * 2;

export const FLIGHT = Object.freeze({
  cruiseSpeed: 12.5, // m/s, flapping along
  soarSpeed: 10.5, // gliding in circles
  descendSpeed: 8.5,
  flareSpeed: 5.0, // when the last few metres of the landing begin
  touchSpeed: 0.6, // at the moment the feet touch
  clearance: 12, // metres above the ground that a route keeps, away from the landing and the take-off
});

export const TAGS = Object.freeze(['cruise', 'soar', 'descend', 'flare', 'touch', 'takeoff', 'climb']);

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const smooth = t => t * t * (3 - 2 * t);

export function wrapAngle(a) {
  let r = (a + Math.PI) % TAU;
  if (r < 0) r += TAU;
  return r - Math.PI;
}

const unit = (x, y, z) => {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
};

export function headingOf(dx, dz) {
  return Math.atan2(dx, dz);
}

// --- the route itself ------------------------------------------------------------------------------------------

export function createRoute(points) {
  if (!Array.isArray(points) || points.length < 2) throw new Error('A bird route needs at least two waypoints.');
  const segments = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const chord = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const [adx, ady, adz] = unit(...a.dir);
    const [bdx, bdy, bdz] = unit(...b.dir);
    const ha = a.handle ?? chord / 3;
    const hb = b.handle ?? chord / 3;
    const p = new Float64Array([
      a.x, a.y, a.z,
      a.x + adx * ha, a.y + ady * ha, a.z + adz * ha,
      b.x - bdx * hb, b.y - bdy * hb, b.z - bdz * hb,
      b.x, b.y, b.z,
    ]);
    const n = clamp(Math.ceil(chord / SAMPLE_SPACING), MIN_SAMPLES, 800);
    const table = new Float64Array(n + 1);
    let px = p[0], py = p[1], pz = p[2];
    for (let j = 1; j <= n; j++) {
      const t = j / n;
      const u = 1 - t;
      const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
      const x = w0 * p[0] + w1 * p[3] + w2 * p[6] + w3 * p[9];
      const y = w0 * p[1] + w1 * p[4] + w2 * p[7] + w3 * p[10];
      const z = w0 * p[2] + w1 * p[5] + w2 * p[8] + w3 * p[11];
      table[j] = table[j - 1] + Math.hypot(x - px, y - py, z - pz);
      px = x; py = y; pz = z;
    }
    const length = table[n];
    segments.push({ p, table, n, length, start: total, end: total + length, speed0: a.speed, speed1: b.speed, tag: a.tag ?? 'cruise' });
    total += length;
  }

  // Fills `out` with the state at distance `s` along the route and returns it. No allocation.
  function sample(s, out) {
    const d = clamp(s, 0, total);
    let k = 0;
    while (k < segments.length - 1 && d > segments[k].end) k++;
    const seg = segments[k];
    const u = clamp(d - seg.start, 0, seg.length);
    // binary search for the table entry the distance falls in
    let lo = 0;
    let hi = seg.n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (seg.table[mid] <= u) lo = mid; else hi = mid - 1;
    }
    const j = lo;
    const span = seg.table[j + 1] - seg.table[j];
    const t = (j + (span > 1e-9 ? clamp((u - seg.table[j]) / span, 0, 1) : 0)) / seg.n;
    const p = seg.p;
    const v = 1 - t;
    const w0 = v * v * v, w1 = 3 * v * v * t, w2 = 3 * v * t * t, w3 = t * t * t;
    out.x = w0 * p[0] + w1 * p[3] + w2 * p[6] + w3 * p[9];
    out.y = w0 * p[1] + w1 * p[4] + w2 * p[7] + w3 * p[10];
    out.z = w0 * p[2] + w1 * p[5] + w2 * p[8] + w3 * p[11];
    const d0 = 3 * v * v, d1 = 6 * v * t, d2 = 3 * t * t;
    const dx = d0 * (p[3] - p[0]) + d1 * (p[6] - p[3]) + d2 * (p[9] - p[6]);
    const dy = d0 * (p[4] - p[1]) + d1 * (p[7] - p[4]) + d2 * (p[10] - p[7]);
    const dz = d0 * (p[5] - p[2]) + d1 * (p[8] - p[5]) + d2 * (p[11] - p[8]);
    const speed3 = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1; // (Math.hypot would allocate on every call)
    out.tx = dx / speed3; out.ty = dy / speed3; out.tz = dz / speed3;
    // How fast the heading turns per metre of flight (positive turns the bird to its left).
    const ex = 6 * (v * (p[6] - 2 * p[3] + p[0]) + t * (p[9] - 2 * p[6] + p[3]));
    const ez = 6 * (v * (p[8] - 2 * p[5] + p[2]) + t * (p[11] - 2 * p[8] + p[5]));
    const horizontal = dx * dx + dz * dz;
    out.turn = horizontal > 1e-9 ? (dz * ex - dx * ez) / (horizontal * speed3) : 0;
    out.speed = lerp(seg.speed0, seg.speed1, smooth(seg.length > 1e-9 ? u / seg.length : 1));
    out.tag = seg.tag;
    out.segment = k;
    out.s = d;
    return out;
  }

  return { length: total, segments: segments.length, sample };
}

// The smallest height above the ground along a route, and how far along it is, sampled every `step` metres.
export function routeClearance(route, groundAt, step = 3) {
  const out = {};
  let lowest = Infinity;
  let at = 0;
  for (let s = 0; s <= route.length; s += step) {
    route.sample(s, out);
    const height = out.y - groundAt(out.x, out.z);
    if (height < lowest) { lowest = height; at = s; }
  }
  return { height: lowest, at };
}

// Builds a route from waypoints, lifting the free waypoints until the whole path clears the ground. A waypoint with
// `fixed: true` (the touchdown, the take-off) never moves; `clear` on a waypoint overrides the usual clearance, and a
// stretch that ends at a waypoint with `clear` of 1 or less (the landing) is not checked.
export function buildRoute(points, groundAt, clearance = FLIGHT.clearance) {
  const pts = points.map(p => ({ ...p }));
  const clearOf = p => p.clear ?? clearance;
  const out = {};
  for (let pass = 0; pass < 8; pass++) {
    for (const p of pts) {
      if (!p.fixed) p.y = Math.max(p.y, groundAt(p.x, p.z) + clearOf(p));
    }
    const route = createRoute(pts);
    let raised = false;
    for (let s = 0; s <= route.length; s += 2) {
      route.sample(s, out);
      const a = pts[out.segment];
      const b = pts[out.segment + 1];
      const need = Math.min(clearOf(a), clearOf(b)) * 0.8;
      if (need <= 0.8) continue;
      const margin = out.y - groundAt(out.x, out.z);
      if (margin < need) {
        const lift = need - margin + 0.5;
        if (!a.fixed) { a.y += lift; raised = true; }
        if (!b.fixed) { b.y += lift; raised = true; }
      }
    }
    if (!raised) return route;
  }
  return createRoute(pts);
}

// --- shapes ------------------------------------------------------------------------------------------------------

// Waypoints along a horizontal spiral about (cx, cz): the angle a (x = cx + r cos a, z = cz + r sin a) goes from a0 by
// `sweep` radians (the sign picks the direction), the radius from r0 to r1 and the height from y0 to y1.
export function arcPoints({ cx, cz, r0, r1 = r0, y0, y1 = y0, a0, sweep, step = Math.PI / 6, speed0, speed1 = speed0, tag }) {
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / step));
  const points = [];
  for (let j = 0; j <= n; j++) {
    const f = j / n;
    const a = a0 + sweep * f;
    const r = lerp(r0, r1, f);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    // derivative of the position with respect to f
    const dx = (r1 - r0) * ca - r * sa * sweep;
    const dz = (r1 - r0) * sa + r * ca * sweep;
    const dy = y1 - y0;
    const m = Math.hypot(dx, dy, dz) || 1;
    points.push({
      x: cx + r * ca, y: lerp(y0, y1, f), z: cz + r * sa,
      dir: [dx / m, dy / m, dz / m], handle: m / (3 * n), speed: lerp(speed0, speed1, f), tag,
    });
  }
  return points;
}

// Joins arcs end to start: the junction keeps the later arc's tag and the average of the two directions.
export function joinPoints(...parts) {
  const out = [];
  for (const part of parts) {
    if (!part.length) continue;
    if (out.length) {
      const last = out.pop();
      const first = part[0];
      const d = unit(last.dir[0] + first.dir[0], last.dir[1] + first.dir[1], last.dir[2] + first.dir[2]);
      out.push({ ...first, dir: d, fixed: last.fixed || first.fixed });
      out.push(...part.slice(1));
    } else out.push(...part);
  }
  return out;
}

// The angle on a circle at which a bird coming from `from` can join it going round in direction `turn` (+1 or -1,
// the sign of the angle's growth): the one whose tangent is closest to the line from `from`.
export function tangentAngle(cx, cz, radius, from, turn, towards = true) {
  let best = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < 360; i++) {
    const a = (i / 360) * TAU;
    const px = cx + radius * Math.cos(a);
    const pz = cz + radius * Math.sin(a);
    const tx = -Math.sin(a) * turn;
    const tz = Math.cos(a) * turn;
    // joining: the line runs from `from` to the circle; leaving: from the circle to `from`
    const lx = towards ? px - from.x : from.x - px;
    const lz = towards ? pz - from.z : from.z - pz;
    const l = Math.hypot(lx, lz) || 1;
    const score = (lx * tx + lz * tz) / l;
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return best;
}

const mod = (a, m) => ((a % m) + m) % m;

// --- planners ----------------------------------------------------------------------------------------------------
// Each returns waypoints for buildRoute. `rng` is a function returning [0, 1).

// A visit to the pond: in from a long way off, round the pond, spiralling down, and a landing on the bank.
// `landing` is { x, z, groundY }; `start` is { x, z } far away.
export function planArrival({ pond, start, landing, groundAt, rng, feet = 0.4, laps = 0 }) {
  const radius = lerp(44, 54, rng());
  const yOrbit0 = pond.y + lerp(20, 26, rng());
  const spiralMagnitude = lerp(1.3, 1.8, rng());
  const landingAngle = Math.atan2(landing.z - pond.z, landing.x - pond.x);
  const landingRadius = Math.hypot(landing.x - pond.x, landing.z - pond.z);
  const flareLength = 10; // metres along the bank

  // Which way round the pond: whichever way makes the shorter circuit between where the bird joins the circle and
  // where it starts to spiral down (a coin toss when they are about the same).
  const options = [1, -1].map(turn => {
    const endAngle = landingAngle - turn * (flareLength / landingRadius);
    const spiralStart = endAngle - turn * spiralMagnitude;
    const entry = tangentAngle(pond.x, pond.z, radius, start, turn, true);
    let sweep = turn * mod(turn * (spiralStart - entry), TAU) + turn * laps * TAU;
    if (Math.abs(sweep) < Math.PI * 0.9) sweep += turn * TAU;
    return { turn, endAngle, spiralStart, entry, sweep };
  });
  const [first, second] = options;
  const pick = Math.abs(Math.abs(first.sweep) - Math.abs(second.sweep)) < Math.PI * 0.3
    ? options[rng() < 0.5 ? 0 : 1]
    : (Math.abs(first.sweep) < Math.abs(second.sweep) ? first : second);
  const { turn, endAngle, spiralStart, entry, sweep: orbitSweep } = pick;
  const spiralSweep = turn * spiralMagnitude;

  const endX = pond.x + landingRadius * Math.cos(endAngle);
  const endZ = pond.z + landingRadius * Math.sin(endAngle);
  const endY = groundAt(endX, endZ) + 3.4;
  const yDescent0 = landing.groundY + 13;
  const entryX = pond.x + radius * Math.cos(entry);
  const entryZ = pond.z + radius * Math.sin(entry);
  const startY = Math.max(start.y ?? 0, groundAt(start.x, start.z) + 30, yOrbit0 + 14);
  const toEntry = unit(entryX - start.x, yOrbit0 - startY, entryZ - start.z);

  const orbit = arcPoints({
    cx: pond.x, cz: pond.z, r0: radius, y0: yOrbit0, y1: yDescent0, a0: entry, sweep: orbitSweep,
    speed0: FLIGHT.soarSpeed, speed1: FLIGHT.soarSpeed, tag: 'soar',
  });
  const spiral = arcPoints({
    cx: pond.x, cz: pond.z, r0: radius, r1: landingRadius, y0: yDescent0, y1: endY, a0: spiralStart, sweep: spiralSweep,
    speed0: FLIGHT.descendSpeed, speed1: FLIGHT.flareSpeed, tag: 'descend',
  });
  spiral[spiral.length - 1].tag = 'flare';

  // The last ten metres run along the bank, nose first, down on to the sand.
  const tangent = [-Math.sin(landingAngle) * turn, 0, Math.cos(landingAngle) * turn];
  const touch = {
    x: landing.x, y: landing.groundY + feet, z: landing.z,
    dir: unit(tangent[0], -0.07, tangent[2]), speed: FLIGHT.touchSpeed, tag: 'touch', fixed: true, clear: 0,
  };
  const approach = { ...spiral[spiral.length - 1], clear: 2.4 };
  const body = joinPoints(orbit, spiral.slice(0, -1).concat([approach]));

  return [
    { x: start.x, y: startY, z: start.z, dir: toEntry, speed: FLIGHT.cruiseSpeed, tag: 'cruise' },
    ...body,
    touch,
  ];
}

// A bird crossing the sky and soaring in one lazy circle on the way, never landing. `centre` is the middle of the
// circle; `from` and `to` are the angles round it where the bird comes in and goes out of sight.
export function planPassing({ centre, groundAt, rng, reach = 230, radius: fixedRadius = null, altitude = null }) {
  const turn = rng() < 0.5 ? 1 : -1;
  const radius = fixedRadius ?? lerp(36, 48, rng());
  const from = rng() * TAU;
  const to = from + Math.PI + (rng() - 0.5) * 1.4;
  const start = { x: centre.x + reach * Math.cos(from), z: centre.z + reach * Math.sin(from) };
  const end = { x: centre.x + reach * Math.cos(to), z: centre.z + reach * Math.sin(to) };
  const base = groundAt(centre.x, centre.z);
  const y0 = base + (altitude ?? lerp(34, 48, rng()));
  const y1 = y0 + (altitude === null ? lerp(10, 18, rng()) : 0);
  const entry = tangentAngle(centre.x, centre.z, radius, start, turn, true);
  const exit = tangentAngle(centre.x, centre.z, radius, end, turn, false);
  let sweep = turn * mod(turn * (exit - entry), TAU) + turn * TAU * (rng() < 0.2 ? 1 : 0);
  if (Math.abs(sweep) < Math.PI * 1.1) sweep += turn * TAU;

  const entryX = centre.x + radius * Math.cos(entry);
  const entryZ = centre.z + radius * Math.sin(entry);
  const startY = Math.max(base + lerp(40, 60, rng()), groundAt(start.x, start.z) + 28);
  const endY = Math.max(y1 + lerp(14, 26, rng()), groundAt(end.x, end.z) + 28);

  const circle = arcPoints({
    cx: centre.x, cz: centre.z, r0: radius, y0, y1, a0: entry, sweep,
    speed0: FLIGHT.soarSpeed, speed1: FLIGHT.soarSpeed, tag: 'soar',
  });
  const last = circle[circle.length - 1];
  last.tag = 'cruise'; // the way out of the circle is the cruise stretch
  last.speed = FLIGHT.cruiseSpeed;
  return [
    { x: start.x, y: startY, z: start.z, dir: unit(entryX - start.x, y0 - startY, entryZ - start.z), speed: FLIGHT.cruiseSpeed, tag: 'cruise' },
    ...circle,
    { x: end.x, y: endY, z: end.z, dir: unit(end.x - last.x, endY - last.y, end.z - last.z), speed: FLIGHT.cruiseSpeed, tag: 'cruise' },
  ];
}

// A way out: from the ground (a take-off, springing up and away) or from the air (leaving early). `heading` is the
// direction to leave in; `curve` bends the path a little so the bird banks as it goes.
export function planExit({ x, y, z, dir = null, speed = 0.6, heading, fromGround = true, curve = 0.1, reach = 300 }) {
  const turnBy = (h, k) => h + curve * k;
  const out = (h, dist, up) => [x + Math.sin(h) * dist, y + up, z + Math.cos(h) * dist];
  const points = [];
  if (fromGround) {
    points.push({ x, y, z, dir: unit(Math.sin(heading) * 0.55, 0.85, Math.cos(heading) * 0.55), speed: 2.2, tag: 'takeoff', fixed: true, clear: 0 });
    const p1 = out(heading, 3, 3.4);
    points.push({ x: p1[0], y: p1[1], z: p1[2], dir: unit(Math.sin(heading) * 0.8, 0.6, Math.cos(heading) * 0.8), speed: 6.5, tag: 'climb', clear: 0.5 });
    const p2 = out(turnBy(heading, 1), 15, 9.5);
    points.push({ x: p2[0], y: p2[1], z: p2[2], dir: unit(Math.sin(turnBy(heading, 1)) * 0.93, 0.36, Math.cos(turnBy(heading, 1)) * 0.93), speed: 9.5, tag: 'climb', clear: 4 });
  } else {
    points.push({ x, y, z, dir: dir ?? [Math.sin(heading), 0, Math.cos(heading)], speed, tag: 'climb' });
    const p1 = out(heading, 45, 8);
    points.push({ x: p1[0], y: p1[1], z: p1[2], dir: unit(Math.sin(turnBy(heading, 1)) * 0.95, 0.22, Math.cos(turnBy(heading, 1)) * 0.95), speed: FLIGHT.cruiseSpeed, tag: 'climb' });
  }
  const far = [[turnBy(heading, 2), 60, 26], [turnBy(heading, 3), 140, 44], [turnBy(heading, 4), reach, 66]];
  far.forEach(([h, dist, up], i) => {
    const p = out(h, dist + (fromGround ? 0 : 45), up + (fromGround ? 0 : 8));
    points.push({
      x: p[0], y: p[1], z: p[2], dir: unit(Math.sin(turnBy(h, 0.5)) * 0.95, 0.2, Math.cos(turnBy(h, 0.5)) * 0.95),
      speed: i === 0 ? 11 : FLIGHT.cruiseSpeed, tag: i === 0 ? 'climb' : 'cruise',
    });
  });
  return points;
}

// --- where to land -----------------------------------------------------------------------------------------------

// A spot on the dry bank of the pond for a bird to land and drink at, away from the player and anything in the way.
// Returns { x, z, groundY, angle, yawToWater } or null. `inWater(x, z)` says whether a point is in the pond;
// `avoid` is a list of { x, z, r }.
export function pickLanding({ pond, groundAt, inWater, player = null, avoid = [], rng, minPlayerDistance = 22, slopeMax = 0.3, preferDistance = 55 }) {
  const candidates = [];
  const count = 48;
  const offset = rng() * TAU;
  for (let i = 0; i < count; i++) {
    const angle = offset + (i / count) * TAU;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    // walk out from the middle of the pond to the first dry ground
    let radius = 10;
    const limit = Math.max(pond.radiusX, pond.radiusZ) * 1.8;
    while (radius < limit && inWater(pond.x + ca * radius, pond.z + sa * radius)) radius += 0.5;
    if (radius >= limit) continue;
    radius += 1.0;
    const x = pond.x + ca * radius;
    const z = pond.z + sa * radius;
    if (inWater(x, z)) continue;
    const slope = Math.hypot(groundAt(x + 1, z) - groundAt(x - 1, z), groundAt(x, z + 1) - groundAt(x, z - 1)) / 2;
    if (slope > slopeMax) continue;
    if (avoid.some(a => Math.hypot(a.x - x, a.z - z) < a.r)) continue;
    let score = rng() * 14;
    if (player) {
      const d = Math.hypot(player.x - x, player.z - z);
      if (d < minPlayerDistance) continue;
      score += Math.abs(d - preferDistance) * 0.5;
    }
    candidates.push({ x, z, groundY: groundAt(x, z), angle, score });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.score - b.score);
  const pick = candidates[Math.min(candidates.length - 1, Math.floor(rng() * 3))];
  // the direction from the bird to the middle of the pond, as a heading
  pick.yawToWater = headingOf(pond.x - pick.x, pond.z - pick.z);
  return pick;
}
