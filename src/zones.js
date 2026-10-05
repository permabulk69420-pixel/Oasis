// The first area: a desert moon, 4 km by 4 km, with the oasis (the old 1 km square) kept exactly as it was.
// Everything here is data plus a few shaping functions, so a later area is a new table, not new terrain code.
// One biome: dunes, with places where the bedrock comes through (ridges, mesas, a canyon), flat gravel and a salt pan.
import { clamp, mix, smooth, noise } from './world-math.js';

export const AREA = Object.freeze({
  name: 'Desert moon',
  // The walkable world (the mountain rim rises inside the last 140 m of it).
  bounds: Object.freeze({ minX: -1500, maxX: 2500, minZ: -2500, maxZ: 1500 }),
  // The oasis square. Inside it nothing here changes the height; outside it the zones fade in over `homeBlend` metres.
  home: Object.freeze({ minX: -500, maxX: 500, minZ: -500, maxZ: 500 }),
  homeBlend: 150,
  // Mountains round the edge: start `inset` metres inside the bounds and take `width` metres to reach full height.
  rim: Object.freeze({ inset: 140, width: 230, height: 190 }),
  rockBase: 9, // the level bedrock sits at under a ridge or mesa (dunes are about 5 to 30 m)
  // Flat gravel plains (the likely home of the first colossus) and salt pans: an ellipse pulled to a level.
  flats: [
    { x: -120, z: -1300, rx: 540, rz: 400, level: 11.5, seed: 3 },
  ],
  salt: [
    { x: 450, z: 950, rx: 650, rz: 370, level: 2.4, seed: 7 },
  ],
  // Flat-topped blocks with stepped cliffs. r is the radius of the cliff line, h the height above the bedrock level.
  mesas: [
    { x: 420, z: -1960, r: 190, h: 125, steps: 6, seed: 11 },   // the landmark: north of the oasis, seen across the dunes
    { x: -1080, z: -1800, r: 150, h: 90, steps: 5, seed: 12 },
    { x: 2020, z: 120, r: 150, h: 115, steps: 6, seed: 14 },
  ],
  // Badlands: a region where the dunes give way to bedrock cut into buttes and washes. Heights come from layered noise,
  // stepped into strata; `scale` is the noise frequency (about 1 / the size of a butte), lo and hi where a wash turns into a butte.
  badlands: [
    { x: 1750, z: -250, rx: 880, rz: 1050, h: 62, steps: 4, scale: 0.0034, lo: 0.475, hi: 0.53, seed: 41 },
    { x: -1050, z: 380, rx: 760, rz: 900, h: 46, steps: 3, scale: 0.0040, lo: 0.48, hi: 0.535, seed: 42 },
  ],
  // Long rock ridges (a polyline, a half width and a crest height).
  ridges: [
    { points: [[-820, -1520], [-640, -1800], [-200, -1930], [200, -1950]], width: 190, height: 88, steps: 5, seed: 21 }, // north wall of the flats
    { points: [[-820, -1520], [-760, -1100], [-700, -760]], width: 150, height: 66, steps: 4, seed: 22 },               // west wall of the flats
    { points: [[1000, -2300], [1120, -1800], [1020, -1400]], width: 160, height: 70, steps: 4, seed: 23 },
    { points: [[-800, 1330], [0, 1420], [900, 1380]], width: 140, height: 60, steps: 3, seed: 25 },
  ],
  // A mesa with a winding canyon cut across it from west to east: the cut follows z = z0 + sum of sines of x.
  plateaus: [
    { x: 1700, z: -1250, r: 330, h: 72, steps: 5, seed: 31,
      canyon: { z0: -1260, waves: [[60, 110, 0], [26, 47, 1.3]], floor: 2.2, halfFloor: 11, wall: 34 } },
  ],
});

const HOME_CX = (AREA.home.minX + AREA.home.maxX) / 2, HOME_CZ = (AREA.home.minZ + AREA.home.maxZ) / 2;
const HOME_HW = (AREA.home.maxX - AREA.home.minX) / 2, HOME_HH = (AREA.home.maxZ - AREA.home.minZ) / 2;

// Strata: the cliff rises in ledges, wobbled so the layers do not run level.
function strata(p, steps, x, z, seed) {
  const t = p * steps + 0.32 * (noise(x * 0.021 + seed, z * 0.021 - seed) - 0.5);
  const t0 = clamp(t, 0, steps), i = Math.floor(t0), f = t0 - i;
  return (i + smooth(0.30, 0.70, f)) / steps;
}

// 1 at the edge of a warped ellipse, less inside.
function warped(x, z, f) {
  const w = 1 + 0.44 * (noise(x * 0.0035 + f.seed, z * 0.0035 - f.seed) - 0.5) + 0.14 * (noise(x * 0.011 + f.seed * 2, z * 0.011 - f.seed) - 0.5);
  return Math.hypot((x - f.x) / (f.rx ?? f.r), (z - f.z) / (f.rz ?? f.r)) / w;
}

function polylineDistance(x, z, points) {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const ax = points[i][0], az = points[i][1], bx = points[i + 1][0], bz = points[i + 1][1];
    const dx = bx - ax, dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (d < best) best = d;
  }
  return best;
}

// Where a point sits in the area, for the places the ground is not just dunes.
// `out` receives rock (0 to 1: bedrock showing), salt and gravel (0 to 1); the return value is the new height.
export function shapeTerrain(x, z, dune, out) {
  out.rock = 0; out.salt = 0; out.gravel = 0;
  const b = AREA.bounds, rim = AREA.rim;
  // The home square is untouched; the zones fade in beyond it.
  const outside = Math.hypot(Math.max(Math.abs(x - HOME_CX) - HOME_HW, 0), Math.max(Math.abs(z - HOME_CZ) - HOME_HH, 0));
  const live = smooth(0, AREA.homeBlend, outside);
  if (live <= 0) return dune;
  let h = dune;

  for (const f of AREA.flats) {
    const w = (1 - smooth(0.72, 1.0, warped(x, z, f))) * live;
    if (w <= 0) continue;
    const level = f.level + 0.9 * (noise(x * 0.02, z * 0.02) - 0.5) * 2 + 0.22 * (noise(x * 0.13, z * 0.13) - 0.5) * 2;
    h = mix(h, level, w);
    out.gravel = Math.max(out.gravel, w);
  }
  for (const f of AREA.salt) {
    const w = (1 - smooth(0.70, 1.0, warped(x, z, f))) * live;
    if (w <= 0) continue;
    h = mix(h, f.level + 0.04 * (noise(x * 0.05, z * 0.05) - 0.5), w);
    out.salt = Math.max(out.salt, w);
  }

  // Badlands: bedrock in layers, cut into buttes with washes between them.
  let badRock = 0;
  for (const f of AREA.badlands) {
    const m = (1 - smooth(0.55, 1.0, warped(x, z, f))) * live;
    if (m <= 0) continue;
    const c = 0.55 * noise(x * f.scale + f.seed, z * f.scale - f.seed) + 0.30 * noise(x * f.scale * 2.3 - f.seed, z * f.scale * 2.3 + f.seed) + 0.15 * noise(x * f.scale * 5.1, z * f.scale * 5.1 + f.seed);
    const p = smooth(f.lo, f.hi, c);
    const top = AREA.rockBase + 0.3 * (dune - 12) + f.h * strata(p, f.steps, x, z, f.seed) * (0.65 + 0.35 * noise(x * 0.002 + f.seed, z * 0.002));
    h = mix(h, top, m);
    badRock = Math.max(badRock, m * smooth(0.04, 0.3, p));
    out.gravel = Math.max(out.gravel, m * (1 - smooth(0.0, 0.2, p)) * 0.8);
  }

  // Bedrock: take the tallest feature at this spot.
  let rockAdd = 0, mask = 0;
  const take = (p, add) => {
    mask = Math.max(mask, smooth(0, 0.35, p) * live);
    rockAdd = Math.max(rockAdd, add * live);
  };
  const mesaShape = (f) => {
    const n = warped(x, z, f);
    return 0.84 * (1 - smooth(0.70, 0.98, n)) + 0.16 * (1 - smooth(0.9, 1.3, n));
  };
  for (const f of AREA.mesas) {
    const p = mesaShape(f);
    if (p <= 0) continue;
    take(p, f.h * strata(p, f.steps, x, z, f.seed) + 3.5 * p * p * noise(x * 0.04 + f.seed, z * 0.04));
  }
  for (const f of AREA.ridges) {
    const d = polylineDistance(x, z, f.points);
    if (d > f.width * 1.05) continue;
    const crest = 0.55 + 0.45 * noise(x * 0.004 + f.seed, z * 0.004);
    const p = (1 - smooth(0.25, 1.0, d / f.width)) * crest * (0.92 + 0.16 * noise(x * 0.03, z * 0.03));
    take(p, f.height * strata(p, f.steps, x, z, f.seed));
  }
  for (const f of AREA.plateaus) {
    const p = mesaShape(f);
    if (p <= 0) continue;
    let add = f.h * strata(p, f.steps, x, z, f.seed) + 3.0 * p * p * noise(x * 0.04 + f.seed, z * 0.04);
    const c = f.canyon;
    if (c) {
      let cz = c.z0;
      for (const [amp, len, phase] of c.waves) cz += amp * Math.sin((x - f.x) / len + phase);
      const off = Math.abs(z - cz);
      const cut = 1 - smooth(c.halfFloor, c.halfFloor + c.wall, off);
      const floor = c.floor + 2.5 * noise(x * 0.03, z * 0.03);
      if (cut > 0 && add > floor) add = mix(add, floor, cut);
    }
    take(p, add);
  }
  if (mask > 0) {
    const detail = 2.4 * (noise(x * 0.05, z * 0.05) - 0.5) + 5 * Math.abs(noise(x * 0.013 + 5, z * 0.013) - 0.5) * mask;
    h = mix(h, AREA.rockBase + 4 * noise(x * 0.002, z * 0.002) + rockAdd + detail, mask);
    out.rock = mask;
    // Rock is not gravel or salt.
    out.gravel *= 1 - mask; out.salt *= 1 - mask;
  }

  out.rock = Math.max(out.rock, badRock);
  out.gravel *= 1 - out.rock;
  // The mountain rim: closes the area in on every side and carries on outside it.
  const e = Math.max(b.minX + rim.inset - x, x - (b.maxX - rim.inset), b.minZ + rim.inset - z, z - (b.maxZ - rim.inset), 0);
  if (e > 0) {
    const t = smooth(0, 1, e / rim.width);
    const gain = rim.height * Math.pow(t, 1.2) * (0.62 + 0.38 * noise(x * 0.006 + 3, z * 0.006 - 3)) + 20 * t * noise(x * 0.025, z * 0.025)
      + 46 * t * Math.pow(1 - Math.abs(2 * noise(x * 0.0085 + 9, z * 0.0085 - 4) - 1), 2) * (0.5 + 0.5 * noise(x * 0.004, z * 0.004));
    h += gain;
    const rimRock = smooth(0, 0.3, e / rim.width);
    out.rock = Math.max(out.rock, rimRock);
    out.gravel *= 1 - rimRock; out.salt *= 1 - rimRock;
  }
  return h;
}

// The walkable limit: 40 m inside the bounds, where the rim is already a steep mountain side.
export const WALK = Object.freeze({
  minX: AREA.bounds.minX + AREA.rim.inset - 100, maxX: AREA.bounds.maxX - AREA.rim.inset + 100,
  minZ: AREA.bounds.minZ + AREA.rim.inset - 100, maxZ: AREA.bounds.maxZ - AREA.rim.inset + 100,
});
