import * as THREE from 'three';

// The shapes of the things you find out in the dunes, made in code (no model files): sandstone outcrops, glowing crystal clusters
// and spire plants, each in three levels of detail, plus the two things you pick up from them (a crystal shard and a bundle of
// fibre). Every shape is a flat-shaded triangle soup with a colour on each vertex (and, for the rock, UVs for the sandstone
// texture), so a rock reads as facets of stone. The functions are pure: the same `spec` and level always give the same shape, so
// the tests can count triangles and check that every solid is closed and faces outward. Units are metres, +Y up, the base of each
// shape is at y = 0 and a little of it is buried below that so it sits in the sand.
//
//   rock    (buildOutcrop)  a stack of beds of sandstone, the hard ones standing out as ledges, with the texture's own strata
//                           running level round it. Cylindrical UVs so the beds stay horizontal; the tops use plain planar UVs.
//   crystal (buildCrystalCluster)  six-sided shards leaning out from a dark mound; colour runs from deep indigo at the foot to
//                           pale pink at the tip, and the material's glow is multiplied by it, so the tips shine most.
//   spire   (buildSpire)    a stem wrapped in tiers of stiff blades, the lowest drooping and the highest standing up, ending in a
//                           spike: an agave stacked like a pagoda, pale-edged and amber at the points. It is where the fibre comes from.

export const LODS = 3;

// ----------------------------------------------------------------------------- small helpers
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A repeatable value in [0, 1) for a small set of integers: the same ring and vertex always get the same nudge.
export function hash3(a, b, c = 0, seed = 0) {
  let n = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1274126177) + Math.imul(seed | 0, 2246822519);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = v => Math.min(1, Math.max(0, v));
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// sRGB hex to the linear colour a vertex colour attribute holds (three.js reads them as linear)
function lin(hex) {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const scalec = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// ----------------------------------------------------------------------------- a flat-shaded triangle soup
export class Soup {
  constructor() { this.position = []; this.normal = []; this.color = []; this.uv = []; this.triangles = 0; }

  // One triangle, wound counter-clockwise seen from outside. ca/cb/cc are the vertex colours, ua/ub/uc optional [u, v] pairs.
  tri(a, b, c, ca, cb = ca, cc = ca, ua = null, ub = null, uc = null) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-12) return; // a collapsed triangle adds nothing
    nx /= length; ny /= length; nz /= length;
    this.position.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.normal.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.color.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
    if (ua) this.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
    this.triangles += 1;
  }

  quad(a, b, c, d, ca, cb = ca, cc = ca, cd = ca, ua = null, ub = null, uc = null, ud = null) {
    this.tri(a, b, c, ca, cb, cc, ua, ub, uc);
    this.tri(a, c, d, ca, cc, cd, ua, uc, ud);
  }

  geometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3));
    if (this.uv.length === this.triangles * 6) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }
}

// ============================================================================= sandstone outcrops
// Texture density: the sandstone photo covers 1.83 m, so one repeat per 1.83 m.
export const ROCK_TEXTURE_SCALE = 1 / 1.83;

export const ROCK_VARIANTS = Object.freeze({
  // A flat-topped mesa of five beds, wider at the foot.
  mesa: Object.freeze({ seed: 11, height: 3.0, rx: 1.55, rz: 1.25, layers: 5, taper: 0.22, neck: 0, cap: 0.10, lean: 0.04, ledge: 0.26, rough: 0.10, dome: 0.05 }),
  // A tall pillar with a narrow waist and a heavy cap, eroded from the soft beds below.
  hoodoo: Object.freeze({ seed: 23, height: 4.4, rx: 0.85, rz: 0.78, layers: 6, taper: 0.05, neck: 0.38, cap: 0.55, lean: 0.07, ledge: 0.20, rough: 0.09, dome: 0.10 }),
  // A squat boulder of three beds with a domed top.
  boulder: Object.freeze({ seed: 37, height: 1.55, rx: 1.35, rz: 1.05, layers: 3, taper: 0.30, neck: 0, cap: 0, lean: 0.03, ledge: 0.16, rough: 0.14, dome: 0.30 }),
  // A long low slab leaning over to one side.
  slab: Object.freeze({ seed: 41, height: 1.15, rx: 1.75, rz: 0.85, layers: 2, taper: 0.18, neck: 0, cap: 0.06, lean: 0.20, ledge: 0.14, rough: 0.12, dome: 0.12 }),
});
export const ROCK_VARIANT_NAMES = Object.freeze(Object.keys(ROCK_VARIANTS));

// How finely each level is cut: points round a ring, rings per bed, and how many beds a coarse level keeps.
const ROCK_LOD = Object.freeze([
  Object.freeze({ k: 18, mids: 1, step: true }),
  Object.freeze({ k: 12, mids: 0, step: true }),
  Object.freeze({ k: 8, mids: 0, step: false }),
]);

const SAND_TINT = lin(0xe8c9a0); // where the sand has drifted up against the foot of a rock, the colour of the nearby sand
const ROCK_WHITE = [1, 1, 1];

// Radius of the rock at height t (0 at the foot, 1 at the top) as a share of its widest, with the beds' ledges.
function rockProfile(spec, hardness, bounds, t) {
  const base = 1 - spec.taper * t;
  const neck = spec.neck * Math.exp(-(((t - 0.36) / 0.17) ** 2));
  const cap = spec.cap * smoothstep(0.80, 0.88, t);
  let layer = 0;
  while (layer < spec.layers - 1 && t >= bounds[layer + 1]) layer += 1;
  const here = 1 + (hardness[layer] - 0.5) * spec.ledge;
  // blend towards the next bed's ledge across a thin band at the boundary
  const w = 0.012;
  let value = here;
  if (layer + 1 < spec.layers) {
    const k = smoothstep(bounds[layer + 1] - w, bounds[layer + 1] + w * 0.2, t);
    value = lerp(here, 1 + (hardness[layer + 1] - 0.5) * spec.ledge, k);
  }
  const u = (t - bounds[layer]) / Math.max(1e-6, bounds[layer + 1] - bounds[layer]);
  const bulge = 1 + 0.035 * Math.sin(Math.PI * clamp01(u));
  return Math.max(0.18, (base - neck + cap) * value * bulge);
}

function ringHeights(spec, bounds, lod) {
  const { mids } = ROCK_LOD[lod];
  const ts = [-0.07, 0.0];
  for (let i = 0; i < spec.layers; i++) {
    const lo = bounds[i], hi = bounds[i + 1];
    const eps = Math.min(0.012, (hi - lo) * 0.18);
    ts.push(lo + (i === 0 ? 0.004 : eps));
    for (let m = 1; m <= mids; m++) ts.push(lo + (hi - lo) * (m / (mids + 1)));
    ts.push(hi - (i === spec.layers - 1 ? 0.012 : eps));
  }
  return ts;
}

export function buildOutcrop(spec, lod = 0) {
  const level = ROCK_LOD[Math.min(lod, LODS - 1)];
  const rng = mulberry32(spec.seed);
  // Beds: thicker at the foot, random cuts between.
  const cuts = [];
  for (let i = 1; i < spec.layers; i++) cuts.push(i / spec.layers + (rng() - 0.5) * 0.5 / spec.layers);
  cuts.sort((a, b) => a - b);
  const bounds = [0, ...cuts, 1];
  const hardness = Array.from({ length: spec.layers }, (_, i) => (i % 2 === 0 ? 0.55 + 0.45 * rng() : 0.45 * rng()));
  const twistStart = rng() * Math.PI * 2;
  const lobePhase = rng() * Math.PI * 2;
  const lobe = 0.07 + 0.07 * rng();
  // For the coarsest level, keep the silhouette: fewer rings, so only every other ledge survives.
  let ts = ringHeights(spec, bounds, lod);
  if (lod >= 2) ts = ts.filter((_, i) => i < 2 || i % 2 === 0 || i === ts.length - 1);
  const K = level.k;
  const height = spec.height;
  const soup = new Soup();
  const tint = lin(0xffffff);
  const rings = [];
  for (let j = 0; j < ts.length; j++) {
    const t = ts[j];
    const radius = rockProfile(spec, hardness, bounds, Math.max(0, t));
    const bury = t < 0 ? 0.88 + 0.12 * (1 + t / 0.07) : 1; // below the sand the foot pinches in a little
    const lean = spec.lean * height * Math.max(0, t) ** 1.6;
    const layerIndex = Math.min(spec.layers - 1, bounds.findIndex((b, i) => t >= b && t < (bounds[i + 1] ?? 2)) );
    const ring = [];
    for (let k = 0; k < K; k++) {
      const theta = (k / K) * Math.PI * 2 + twistStart * 0 + 0.35 * t;
      const c = Math.cos(theta), s = Math.sin(theta);
      const ellipse = (spec.rx * spec.rz) / Math.hypot(spec.rz * c, spec.rx * s);
      const shape = ellipse * (1 + lobe * Math.sin(3 * theta + lobePhase) + 0.04 * Math.sin(5 * theta + lobePhase * 1.7));
      // the same nudge runs up a whole bed (a crack or a rib), plus a little that is the ring's own
      const nudge = (hash3(k, Math.max(layerIndex, 0), 1, spec.seed) - 0.5) * 2 * 0.7 + (hash3(k, j, 2, spec.seed) - 0.5) * 2 * 0.3;
      const r = radius * bury * shape * (1 + spec.rough * nudge);
      const x = r * c + lean, z = r * s;
      ring.push([x, t * height, z]);
    }
    rings.push({ t, ring, layer: Math.max(layerIndex, 0) });
  }

  // colours: beds tinted a little by hardness, the foot blended into the sand, the top bleached
  const colourOf = (point, t, layer) => {
    const h = hardness[layer];
    let c = mixc([1.02, 0.93, 0.84], [1.12, 1.08, 0.92], h);
    c = scalec(c, 0.9 + 0.2 * hash3(Math.round(point[0] * 7), Math.round(point[2] * 7), layer, spec.seed));
    c = mixc(c, SAND_TINT, 0.62 * (1 - smoothstep(0.0, 0.16, t)));
    c = scalec(c, 1 + 0.10 * smoothstep(0.78, 1.0, t));
    return c;
  };

  const circumferenceTiles = Math.max(2, Math.round(Math.PI * (spec.rx + spec.rz) * ROCK_TEXTURE_SCALE));
  const wall = (a, b) => {
    for (let k = 0; k < K; k++) {
      const k2 = (k + 1) % K;
      const p0 = a.ring[k], p1 = a.ring[k2], p2 = b.ring[k2], p3 = b.ring[k];
      const flat = Math.abs(p0[1] - p3[1]) < 0.12 * height && Math.abs(p0[1] - p3[1]) < 0.45 * Math.hypot(p3[0] - p0[0], p3[2] - p0[2]);
      const u0 = (k / K) * circumferenceTiles, u1 = ((k + 1) / K) * circumferenceTiles;
      const planar = (p) => [p[0] * ROCK_TEXTURE_SCALE, p[2] * ROCK_TEXTURE_SCALE];
      const uvs = flat
        ? [planar(p0), planar(p1), planar(p2), planar(p3)]
        : [[u0, p0[1] * ROCK_TEXTURE_SCALE], [u1, p1[1] * ROCK_TEXTURE_SCALE], [u1, p2[1] * ROCK_TEXTURE_SCALE], [u0, p3[1] * ROCK_TEXTURE_SCALE]];
      // outward is anticlockwise from outside: lower ring a, upper ring b, going round with k
      soup.quad(p0, p3, p2, p1,
        colourOf(p0, a.t, a.layer), colourOf(p3, b.t, b.layer), colourOf(p2, b.t, b.layer), colourOf(p1, a.t, a.layer),
        uvs[0], uvs[3], uvs[2], uvs[1]);
    }
  };
  for (let j = 0; j + 1 < rings.length; j++) wall(rings[j], rings[j + 1]);

  // the rounded top: one more ring tucked in, then a shallow dome
  const top = rings[rings.length - 1];
  const centre = [top.ring.reduce((s, p) => s + p[0], 0) / K, top.ring[0][1], top.ring.reduce((s, p) => s + p[2], 0) / K];
  const rim = top.ring.map(p => [lerp(p[0], centre[0], 0.16), p[1] + 0.035 * height, lerp(p[2], centre[2], 0.16)]);
  const apex = [centre[0], centre[1] + (0.035 + spec.dome * 0.5) * height, centre[2]];
  const planar = p => [p[0] * ROCK_TEXTURE_SCALE, p[2] * ROCK_TEXTURE_SCALE];
  for (let k = 0; k < K; k++) {
    const k2 = (k + 1) % K;
    soup.quad(top.ring[k], rim[k], rim[k2], top.ring[k2],
      colourOf(top.ring[k], 1, top.layer), scalec(ROCK_WHITE, 1.1), scalec(ROCK_WHITE, 1.1), colourOf(top.ring[k2], 1, top.layer),
      planar(top.ring[k]), planar(rim[k]), planar(rim[k2]), planar(top.ring[k2]));
    soup.tri(rim[k2], rim[k], apex, scalec(ROCK_WHITE, 1.1), scalec(ROCK_WHITE, 1.1), scalec(ROCK_WHITE, 1.12), planar(rim[k2]), planar(rim[k]), planar(apex));
  }
  // the buried foot, closed so the solid has no hole
  const foot = rings[0];
  const underside = [centre[0], foot.ring[0][1] - 0.02 * height, centre[2]];
  for (let k = 0; k < K; k++) {
    const k2 = (k + 1) % K;
    soup.tri(foot.ring[k], foot.ring[k2], underside, tint, tint, tint, planar(foot.ring[k]), planar(foot.ring[k2]), planar(underside));
  }
  const geometry = soup.geometry();
  geometry.userData = { solid: true, height: height * (1 + 0.035 + spec.dome * 0.5), radius: Math.max(spec.rx, spec.rz) };
  return geometry;
}

// The part of a rock you can touch or bump into: how far it reaches from its middle in each of 16 directions (before the node's scale),
// below head height. The player is kept out of it and a swing is tested against it (src/mining.js); the overhanging cap of a hoodoo is
// above your head, so it is left out.
export const BODY_BUCKETS = 16;
export const BODY_MAX_HEIGHT = 2.4;
const bodies = new Map();
export function rockBody(variant) {
  let body = bodies.get(variant);
  if (body) return body;
  const spec = ROCK_VARIANTS[variant];
  if (!spec) throw new Error(`Unknown rock variant: ${variant}`);
  const position = buildOutcrop(spec, 0).getAttribute('position').array;
  body = new Float32Array(BODY_BUCKETS);
  for (let i = 0; i < position.length; i += 3) {
    const y = position[i + 1];
    if (y > BODY_MAX_HEIGHT || y < -0.3) continue;
    const bucket = Math.floor((((Math.atan2(position[i + 2], position[i]) / (Math.PI * 2)) % 1 + 1) % 1) * BODY_BUCKETS) % BODY_BUCKETS;
    body[bucket] = Math.max(body[bucket], Math.hypot(position[i], position[i + 2]));
  }
  // a direction no vertex fell in (a coarse shape) takes its neighbours' reach
  for (let pass = 0; pass < 2; pass++) {
    for (let b = 0; b < BODY_BUCKETS; b++) {
      if (body[b] === 0) body[b] = Math.max(body[(b + 1) % BODY_BUCKETS], body[(b + BODY_BUCKETS - 1) % BODY_BUCKETS]);
    }
  }
  bodies.set(variant, body);
  return body;
}

// How far a rock body reaches in the direction of the local offset (lx, lz). Each of the 16 directions holds the farthest reach of any vertex
// in its slice, so within a slice the reach is that, rising towards the next slice's if that is farther: the outline never cuts a corner.
export function bodyReach(body, lx, lz) {
  const f = (((Math.atan2(lz, lx) / (Math.PI * 2)) % 1 + 1) % 1) * BODY_BUCKETS;
  const b0 = Math.floor(f) % BODY_BUCKETS, b1 = (b0 + 1) % BODY_BUCKETS;
  return body[b0] + Math.max(0, body[b1] - body[b0]) * (f - Math.floor(f));
}

// ============================================================================= crystal clusters
export const CRYSTAL_VARIANTS = Object.freeze({
  // seven shards, one tall one in the middle
  cluster: Object.freeze({ seed: 5, shards: 8, spread: 0.30, height: 1.05, thickness: 0.105, tilt: 0.62 }),
  // a wider, lower fan of shards
  fan: Object.freeze({ seed: 17, shards: 7, spread: 0.38, height: 0.78, thickness: 0.095, tilt: 0.95 }),
  // two or three great shards, the biggest crystals you will find
  spike: Object.freeze({ seed: 29, shards: 4, spread: 0.20, height: 1.55, thickness: 0.15, tilt: 0.40 }),
});
export const CRYSTAL_VARIANT_NAMES = Object.freeze(Object.keys(CRYSTAL_VARIANTS));

const CRYSTAL_SIDES = [6, 4, 3];
const CRYSTAL_SHARD_SHARE = [1, 0.7, 0.5]; // how many of the shards each coarser level keeps
const CRYSTAL = Object.freeze({
  foot: lin(0x1c0f45),
  low: lin(0x4b24b0),
  mid: lin(0x8f45ff),
  high: lin(0xd59bff),
  tip: lin(0xffe3ff),
  mound: lin(0x1d1620),
});
// The odd cyan shard among the violet ones (about one in five): cool against the warm sand, and it tells you this is not a mineral from home.
const CRYSTAL_CYAN = Object.freeze({
  foot: lin(0x082a45),
  low: lin(0x1565b0),
  mid: lin(0x30c8ff),
  high: lin(0x9deaff),
  tip: lin(0xe8ffff),
});
const crystalGradient = (s, palette = CRYSTAL) => {
  if (s < 0.45) return mixc(palette.foot, palette.low, smoothstep(0, 0.45, s));
  if (s < 0.8) return mixc(palette.low, palette.mid, smoothstep(0.45, 0.8, s));
  return mixc(palette.mid, palette.high, smoothstep(0.8, 1.0, s));
};

// One crystal: a prism that widens a little at the foot, then a pointed six-sided termination. `axis` is the way it points, `base` where it starts,
// `length` is the whole length measured from the point where it leaves the ground.
export function addShard(soup, { base, axis, length, radius, sides, turn = 0, tipOffset = 0, buried = 0.12, glow = 1, palette = CRYSTAL }) {
  const up = new THREE.Vector3(axis[0], axis[1], axis[2]).normalize();
  const helper = Math.abs(up.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(up, helper).normalize();
  const v = new THREE.Vector3().crossVectors(up, u).normalize();
  const point = (s, r, k, offset = 0) => {
    const a = turn + (k / sides) * Math.PI * 2;
    const along = s * length;
    return [
      base[0] + up.x * along + (u.x * Math.cos(a) + v.x * Math.sin(a)) * r + u.x * offset,
      base[1] + up.y * along + (u.y * Math.cos(a) + v.y * Math.sin(a)) * r + u.y * offset,
      base[2] + up.z * along + (u.z * Math.cos(a) + v.z * Math.sin(a)) * r + u.z * offset,
    ];
  };
  const sFoot = -buried, sShoulder = 0.70;
  const rFoot = radius * 1.18, rShoulder = radius;
  const apex = [
    base[0] + up.x * (length * 1.0 + radius * 1.1) + u.x * tipOffset,
    base[1] + up.y * (length * 1.0 + radius * 1.1) + u.y * tipOffset,
    base[2] + up.z * (length * 1.0 + radius * 1.1) + u.z * tipOffset,
  ];
  const apexSlope = length + radius * 1.1;
  const colourAt = (s, facet) => scalec(crystalGradient(clamp01((s * length) / apexSlope + 0.05), palette), facet);
  const tipColour = scalec(palette.tip, glow);
  for (let k = 0; k < sides; k++) {
    const k2 = (k + 1) % sides;
    const facet = 0.78 + 0.34 * hash3(k, sides, Math.round(length * 100));
    const a0 = point(sFoot, rFoot, k), a1 = point(sFoot, rFoot, k2);
    const b0 = point(sShoulder, rShoulder, k), b1 = point(sShoulder, rShoulder, k2);
    const cf = colourAt(0.0, facet), cm = colourAt(sShoulder, facet);
    // prism side (outward is anticlockwise seen from outside, a to b going up)
    soup.quad(a0, a1, b1, b0, scalec(cf, 0.8), scalec(cf, 0.8), cm, cm);
    // pyramid face up to the point
    soup.tri(b0, b1, apex, cm, cm, scalec(mixc(tipColour, palette.high, 0.2), facet * 1.1));
  }
}

const SPREAD_ANGLE = Math.PI * (3 - Math.sqrt(5)); // the golden angle, so shards fan out evenly

export function buildCrystalCluster(spec, lod = 0) {
  const rng = mulberry32(spec.seed);
  const soup = new Soup();
  const sides = CRYSTAL_SIDES[Math.min(lod, LODS - 1)];
  const count = Math.max(2, Math.round(spec.shards * CRYSTAL_SHARD_SHARE[Math.min(lod, LODS - 1)]));
  const turn0 = rng() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const main = i === 0;
    const angle = i * SPREAD_ANGLE + turn0;
    const rho = main ? 0 : spec.spread * Math.sqrt((i + 0.5) / count) * (0.75 + 0.35 * rng());
    const lean = main ? 0.06 + 0.06 * rng() : spec.tilt * (0.45 + 0.55 * (rho / spec.spread)) * (0.7 + 0.4 * rng());
    const length = spec.height * (main ? 1 : 0.34 + 0.5 * rng());
    const radius = spec.thickness * (main ? 1 : 0.46 + 0.34 * rng());
    const dir = [Math.sin(lean) * Math.cos(angle), Math.cos(lean), Math.sin(lean) * Math.sin(angle)];
    const cool = !main && hash3(i, 5, 2, spec.seed) < 0.24;
    addShard(soup, {
      base: [Math.cos(angle) * rho, 0, Math.sin(angle) * rho],
      axis: dir, length, radius, sides, turn: rng() * Math.PI, tipOffset: (rng() - 0.5) * radius * 0.5,
      glow: 0.85 + 0.3 * rng(), palette: cool ? CRYSTAL_CYAN : CRYSTAL,
    });
  }
  // the dark mound the crystals grow from: a low dome, a ring of 7 plates, darker than anything else so the glow stands out
  const ringPoints = lod === 0 ? 9 : lod === 1 ? 6 : 4;
  const mound = [];
  for (let k = 0; k < ringPoints; k++) {
    const a = (k / ringPoints) * Math.PI * 2 + 0.3;
    const r = spec.spread * (1.45 + 0.4 * hash3(k, 3, 0, spec.seed));
    mound.push([Math.cos(a) * r, -0.05, Math.sin(a) * r]);
  }
  const top = [0, spec.height * 0.13, 0];
  const dark = CRYSTAL.mound;
  for (let k = 0; k < ringPoints; k++) {
    const k2 = (k + 1) % ringPoints;
    const shade = 0.7 + 0.6 * hash3(k, 9, 0, spec.seed);
    soup.tri(mound[k], top, mound[k2], scalec(dark, shade * 0.7), scalec(dark, shade * 1.3), scalec(dark, shade * 0.7));
  }
  const geometry = soup.geometry();
  geometry.userData = { solid: false, height: spec.height + spec.thickness * 1.1, radius: spec.spread * 1.6 };
  return geometry;
}

// ============================================================================= spire plants
export const SPIRE_VARIANTS = Object.freeze({
  tall: Object.freeze({ seed: 3, height: 2.1, tiers: 5, leaves: 7, leafLength: 1.05, width: 0.115, droop: 0.35 }),
  squat: Object.freeze({ seed: 8, height: 1.35, tiers: 4, leaves: 8, leafLength: 0.95, width: 0.125, droop: 0.5 }),
});
export const SPIRE_VARIANT_NAMES = Object.freeze(Object.keys(SPIRE_VARIANTS));

const SPIRE = Object.freeze({
  stemLow: lin(0x2e4a44), stemHigh: lin(0x6a8c7a),
  leafBase: lin(0x153e49), leafMid: lin(0x3a8088), leafEdge: lin(0xd6cfae), tip: lin(0xe08040),
  spike: lin(0xc9b98f),
});
const SPIRE_LOD = Object.freeze([
  Object.freeze({ segments: 4, cross: 4, stem: 6, leafShare: 1, bulbs: true }),
  Object.freeze({ segments: 2, cross: 3, stem: 5, leafShare: 0.8, bulbs: false }),
  Object.freeze({ segments: 1, cross: 3, stem: 4, leafShare: 0.5, bulbs: false }),
]);

// A blade: a thin lens along a curve that leaves the stem at `elevation` and bends down by `droop`. `cross` points round each section
// (4: a diamond with a ridge top and bottom; 3: a triangular prism). Closed at the foot, ending in a point.
export function addBlade(soup, { origin, azimuth, elevation, length, width, thickness, droop, segments, cross, colourOf }) {
  const out = new THREE.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth));
  const side = new THREE.Vector3(-Math.sin(azimuth), 0, Math.cos(azimuth));
  const centreAt = p => {
    const along = length * p;
    const rise = Math.sin(elevation) * along - droop * length * p * p;
    const reach = Math.cos(elevation) * along + 0.02 * length * p;
    return [origin[0] + out.x * reach, origin[1] + rise, origin[2] + out.z * reach];
  };
  const sections = [];
  for (let i = 0; i <= segments; i++) {
    const p = i / segments;
    const c = centreAt(p);
    const ahead = centreAt(Math.min(1, p + 0.02)), behind = centreAt(Math.max(0, p - 0.02));
    const tangent = new THREE.Vector3(ahead[0] - behind[0], ahead[1] - behind[1], ahead[2] - behind[2]).normalize();
    const normalUp = new THREE.Vector3().crossVectors(side, tangent).normalize(); // the leaf's top face
    const w = i === segments ? 0 : width * Math.sin(Math.PI * Math.min(1, 0.18 + 0.82 * Math.pow(p, 0.75))) * (1 - 0.35 * p);
    const th = i === segments ? 0 : thickness * (1 - 0.6 * p) + 0.004;
    const pts = [];
    if (cross === 4) {
      pts.push([c[0] - side.x * w, c[1] - side.y * w, c[2] - side.z * w]);
      pts.push([c[0] + normalUp.x * th, c[1] + normalUp.y * th, c[2] + normalUp.z * th]);
      pts.push([c[0] + side.x * w, c[1] + side.y * w, c[2] + side.z * w]);
      pts.push([c[0] - normalUp.x * th, c[1] - normalUp.y * th, c[2] - normalUp.z * th]);
    } else {
      pts.push([c[0] - side.x * w, c[1] - side.y * w, c[2] - side.z * w]);
      pts.push([c[0] + normalUp.x * th * 1.6, c[1] + normalUp.y * th * 1.6, c[2] + normalUp.z * th * 1.6]);
      pts.push([c[0] + side.x * w, c[1] + side.y * w, c[2] + side.z * w]);
    }
    sections.push({ p, pts, colours: pts.map((_, k) => colourOf(p, k, cross)) });
  }
  // the sides: orientation is fixed by the order below (checked by the tests: every blade face points away from its own axis)
  for (let i = 0; i < segments; i++) {
    const a = sections[i], b = sections[i + 1];
    for (let k = 0; k < cross; k++) {
      const k2 = (k + 1) % cross;
      if (i === segments - 1) soup.tri(a.pts[k], a.pts[k2], b.pts[0], a.colours[k], a.colours[k2], b.colours[0]);
      else soup.quad(a.pts[k], a.pts[k2], b.pts[k2], b.pts[k], a.colours[k], a.colours[k2], b.colours[k2], b.colours[k]);
    }
  }
  // the foot, closed against the stem
  const f = sections[0];
  const centre = [0, 1, 2].map(c => f.pts.reduce((s, p) => s + p[c], 0) / f.pts.length);
  for (let k = 0; k < cross; k++) soup.tri(f.pts[(k + 1) % cross], f.pts[k], centre, f.colours[k], f.colours[k], f.colours[k]);
}

export function buildSpire(spec, lod = 0) {
  const level = SPIRE_LOD[Math.min(lod, LODS - 1)];
  const rng = mulberry32(spec.seed);
  const soup = new Soup();
  const H = spec.height;
  // the stem: a tapering prism with a slight bend, then the spike above the top tier
  const stemTop = H * 0.80;
  const bend = (y) => [0.05 * H * (y / H) ** 2, y, 0.02 * H * (y / H) ** 2];
  const stemSections = [];
  const stemRings = level.stem === 4 ? 3 : 5;
  for (let i = 0; i < stemRings; i++) {
    const f = i / (stemRings - 1);
    const y = f * stemTop;
    const r = lerp(0.125, 0.05, f) * (spec.height / 2);
    const centre = bend(y);
    const ring = [];
    for (let k = 0; k < level.stem; k++) {
      const a = (k / level.stem) * Math.PI * 2;
      ring.push([centre[0] + Math.cos(a) * r, y - (i === 0 ? 0.08 : 0), centre[2] + Math.sin(a) * r]);
    }
    stemSections.push({ ring, f });
  }
  const stemColour = f => mixc(SPIRE.stemLow, SPIRE.stemHigh, f);
  for (let i = 0; i + 1 < stemSections.length; i++) {
    const a = stemSections[i], b = stemSections[i + 1];
    for (let k = 0; k < level.stem; k++) {
      const k2 = (k + 1) % level.stem;
      soup.quad(a.ring[k], b.ring[k], b.ring[k2], a.ring[k2], stemColour(a.f), stemColour(b.f), stemColour(b.f), stemColour(a.f));
    }
  }
  const stemLast = stemSections[stemSections.length - 1];
  const spikeTop = [...bend(H)];
  spikeTop[1] = H;
  for (let k = 0; k < level.stem; k++) {
    soup.tri(stemLast.ring[(k + 1) % level.stem], stemLast.ring[k], spikeTop, stemColour(1), stemColour(1), SPIRE.spike);
  }
  const bottom = stemSections[0];
  const underside = [bend(0)[0], -0.1, bend(0)[2]];
  for (let k = 0; k < level.stem; k++) soup.tri(bottom.ring[k], bottom.ring[(k + 1) % level.stem], underside, stemColour(0));

  // tiers of blades, the lowest drooping wide, the highest standing up
  for (let j = 0; j < spec.tiers; j++) {
    const f = spec.tiers === 1 ? 0 : j / (spec.tiers - 1);
    const y = lerp(0.14, stemTop * 0.94, f ** 0.9);
    const n = Math.max(3, Math.round((spec.leaves - Math.floor(j * 0.7)) * level.leafShare));
    const length = spec.leafLength * (1 - 0.58 * f);
    const elevation = lerp(-0.12, 1.05, f);
    const turn = rng() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const base = bend(y);
      addBlade(soup, {
        origin: [base[0], y, base[2]],
        azimuth: turn + (i / n) * Math.PI * 2 + (rng() - 0.5) * 0.25,
        elevation: elevation + (rng() - 0.5) * 0.18,
        length: length * (0.9 + 0.2 * rng()), width: spec.width * (1 - 0.3 * f), thickness: 0.016, droop: spec.droop * (1 - 0.5 * f),
        segments: level.segments, cross: level.cross,
        colourOf: (p, k, cross) => {
          const edge = cross === 4 ? (k === 0 || k === 2) : (k === 0 || k === 2);
          let c = mixc(SPIRE.leafBase, SPIRE.leafMid, smoothstep(0, 0.6, p));
          if (edge) c = mixc(c, SPIRE.leafEdge, 0.65 * smoothstep(0.1, 0.9, p));
          return mixc(c, SPIRE.tip, smoothstep(0.82, 1.0, p));
        },
      });
    }
  }
  const geometry = soup.geometry();
  geometry.userData = { solid: false, height: H, radius: spec.leafLength * 0.9 };
  return geometry;
}

// ============================================================================= the things you pick up
// A single crystal to hold: a main shard and two small ones, about 17 cm long. The mesh is called "Crystal" so the grip code finds it.
export function buildLooseCrystal(seed = 1) {
  const rng = mulberry32(seed * 977 + 13);
  const soup = new Soup();
  addShard(soup, { base: [0, -0.085, 0], axis: [0.03, 1, 0.02], length: 0.15, radius: 0.030, sides: 6, turn: rng(), tipOffset: 0.004, buried: 0.0, glow: 1.0 });
  addShard(soup, { base: [0.020, -0.085, 0.004], axis: [0.45, 1, 0.15], length: 0.085, radius: 0.017, sides: 6, turn: rng(), buried: 0.0, glow: 0.9 });
  addShard(soup, { base: [-0.016, -0.085, -0.010], axis: [-0.40, 1, -0.2], length: 0.06, radius: 0.014, sides: 6, turn: rng(), buried: 0.0, glow: 0.9 });
  const geometry = soup.geometry();
  geometry.userData = { solid: false, height: 0.17 };
  return geometry;
}

// A bundle of pale strands tied in the middle with a red cord, 30 cm long, lying along X. The mesh is called "Fibre".
const STRAW = lin(0xd8c48c), STRAW_DARK = lin(0xa08a58), CORD = lin(0xe5603b);
export function buildFibreBundle(seed = 1) {
  const rng = mulberry32(seed * 7919 + 3);
  const soup = new Soup();
  const strands = 9;
  const length = 0.30;
  const segments = 4;
  for (let s = 0; s < strands; s++) {
    const a = (s / strands) * Math.PI * 2 + rng() * 0.4;
    const spread = 0.012 + 0.014 * rng();
    const flare = 0.020 + 0.016 * rng(); // the ends splay out
    const radius = 0.0042;
    const sections = [];
    for (let i = 0; i <= segments; i++) {
      const p = i / segments;
      const x = (p - 0.5) * length * (0.92 + 0.12 * rng());
      const off = spread * 0.35 + flare * Math.abs(p - 0.5) * 2 * Math.abs(p - 0.5) * 2;
      const y = Math.cos(a) * off + 0.004 * Math.sin(p * 7 + s);
      const z = Math.sin(a) * off;
      const r = i === 0 || i === segments ? 0 : radius * (1 - 0.35 * Math.abs(p - 0.5) * 2);
      sections.push({ x, y, z, r, p });
    }
    for (let i = 0; i < segments; i++) {
      const q0 = sections[i], q1 = sections[i + 1];
      const ring = (q, k) => {
        const t = (k / 3) * Math.PI * 2;
        return [q.x, q.y + Math.cos(t) * q.r, q.z + Math.sin(t) * q.r];
      };
      const c0 = mixc(STRAW_DARK, STRAW, 0.5 + 0.5 * hash3(s, i, 1)), c1 = mixc(STRAW_DARK, STRAW, 0.5 + 0.5 * hash3(s, i + 1, 1));
      for (let k = 0; k < 3; k++) {
        const k2 = (k + 1) % 3;
        if (i === 0) soup.tri(ring(q0, k), ring(q1, k2), ring(q1, k), c0, c1, c1);
        else if (i === segments - 1) soup.tri(ring(q0, k), ring(q0, k2), ring(q1, k), c0, c0, c1);
        else soup.quad(ring(q0, k), ring(q0, k2), ring(q1, k2), ring(q1, k), c0, c0, c1, c1);
      }
    }
  }
  // the cord: a short ring round the middle
  const cordSections = [-0.012, 0.012];
  const ringAt = (x, r, k) => [x, Math.cos((k / 8) * Math.PI * 2) * r, Math.sin((k / 8) * Math.PI * 2) * r];
  for (let k = 0; k < 8; k++) {
    const k2 = (k + 1) % 8;
    soup.quad(ringAt(cordSections[0], 0.0275, k), ringAt(cordSections[0], 0.0275, k2), ringAt(cordSections[1], 0.0275, k2), ringAt(cordSections[1], 0.0275, k), CORD);
    soup.tri(ringAt(cordSections[1], 0.0275, k), ringAt(cordSections[1], 0.0275, k2), [cordSections[1], 0, 0], CORD);
    soup.tri(ringAt(cordSections[0], 0.0275, k2), ringAt(cordSections[0], 0.0275, k), [cordSections[0], 0, 0], CORD);
  }
  const geometry = soup.geometry();
  geometry.userData = { solid: false, length };
  return geometry;
}

// Every find shape, by kind: what mining.js builds its instanced meshes from.
export const FIND_SHAPES = Object.freeze({
  rock: Object.freeze({ variants: ROCK_VARIANTS, build: buildOutcrop }),
  crystal: Object.freeze({ variants: CRYSTAL_VARIANTS, build: buildCrystalCluster }),
  spire: Object.freeze({ variants: SPIRE_VARIANTS, build: buildSpire }),
});
