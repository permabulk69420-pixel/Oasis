import * as THREE from 'three';
import { addWindSway, SWAY } from './wind.js';
import { createIslandPatchGeometry, ISLAND_RICH_BLADES as RICH_BLADES, ISLAND_LITE_BLADES as LITE_BLADES, ISLAND_RICH_TRIANGLES as RICH_TRIANGLES, ISLAND_LITE_TRIANGLES as LITE_TRIANGLES } from './island-grass-blades.js';

// Grass blades over the island's meadows and floor (Kane, 6 Oct: the day does not look dense or Ark-like; then "the grass looks trash": lime, rigid, every blade the same).
// The blades are the island's own patch (island-grass-blades.js: three kinds of blade, arched tips, dark roots, the same triangle count as the oasis's, which keeps its
// patch and look); the material and the wind are the oasis's. The field is clumped: a smooth noise thins it in places and varies its colour and height, so it is not an even
// carpet. The island is 190,000 square metres, far too many for one list, so the field is made in 8 m chunks round you
// as you walk: each chunk is a jittered grid of patches (one a cell, a cell about 0.9 m), made once from a seed, kept while you are within a few hundred metres, and written
// into two instanced meshes (rich blades near, lite blades further out) every couple of metres you move. A patch is dropped, not faded, with distance: each has a number
// 0..1 and survives while that is under the density for its distance, so the field thins out into the haze with no hard edge.
export const ISLAND_GRASS = Object.freeze({
  chunk: 8,
  cell: 0.9,
  rich: 22,                  // metres: nearer than this the 12-blade patch, beyond it the 6-blade one
  fullTo: 19,                // every patch within this, then thinning out to `thinTo`
  thinTo: 58,
  rebuildMetres: 2,
  chunksPerCall: 14,         // new chunks made per update (the rest next time), so walking never stalls on the field
  keepWithin: 120,           // chunks further than this are forgotten and remade if you come back
  maxRich: 3200,
  maxLite: 4800,
  tall: Object.freeze([0.9, 1.6]),   // the patch's height scale (the oasis's grass is 0.86 to 1.11): taller in the thicker places
  // the patch's colour (a blade's own root-to-tip colour multiplies it): teal-leaning and darker than the oasis's yellow-green, so the tips are not lime under the low sun
  tint: Object.freeze({ r: [0.07, 0.17], g: [0.26, 0.43], b: [0.07, 0.14] }),
  clump: Object.freeze({ big: 9, fine: 2.6, floor: 0.55, dry: 0.45 }),   // noise scales in metres; the least share of patches kept in a thin place; how far a dry patch shifts to olive
});

// Smooth value noise 0..1 (a hashed lattice, smoothstepped), so the clumps are the same every run and across chunk edges.
function lattice(ix, iz, salt) { return hash2(ix, iz, salt) / 4294967296; }
function valueNoise(x, z, salt) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = lattice(ix, iz, salt), b = lattice(ix + 1, iz, salt), c = lattice(ix, iz + 1, salt), d = lattice(ix + 1, iz + 1, salt);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const smooth = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

function hash2(ix, iz, seed) {
  let n = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2147483647);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n = Math.imul(n ^ (n >>> 16), 2246822519);
  return (n ^ (n >>> 15)) >>> 0;
}
function stream(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The patches of one chunk: { count, matrices (16 floats each), colours (3 each), hash (0..1 each, the order they are dropped in) }.
// ground(x, z) -> world height or null; cover(x, z) -> 0..1 how much grass grows there (0 none); thick(x, z) -> 0..1 how overgrown (taller grass).
export function makeGrassChunk(cx, cz, { ground, cover, thick = () => 0.5 }, spec = ISLAND_GRASS, seed = 0x5eed) {
  const per = Math.round(spec.chunk / spec.cell);
  const step = spec.chunk / per;
  const matrices = [], colours = [], hashes = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), p = new THREE.Vector3(), s = new THREE.Vector3();
  for (let i = 0; i < per; i++) for (let j = 0; j < per; j++) {
    const r = stream(hash2(cx * per + i, cz * per + j, seed));
    const x = cx * spec.chunk + (i + 0.1 + 0.8 * r()) * step, z = cz * spec.chunk + (j + 0.1 + 0.8 * r()) * step;
    const c = cover(x, z);
    const keep = r(), yaw = r() * Math.PI * 2, sx = 0.88 + 0.24 * r(), sy = r(), sz = 0.88 + 0.24 * r(), tx = (r() - 0.5) * 0.08, tz = (r() - 0.5) * 0.08, tone = r(), hash = r();
    // clumps: a wide noise and a fine one make thick stands and thin places (never bare: `floor` of the patches stay), so it is not an even carpet
    const wide = valueNoise(x / spec.clump.big, z / spec.clump.big, 11), fine = valueNoise(x / spec.clump.fine + 17, z / spec.clump.fine - 5, 23);
    const clump = 0.6 * wide + 0.4 * fine;
    const density = spec.clump.floor + (1 - spec.clump.floor) * smooth(0.28, 0.68, clump);
    if (c <= 0.05 || keep > Math.min(1, (0.45 + c * 0.75) * density)) continue;
    const y = ground(x, z);
    if (y === null) continue;
    const th = thick01(thick(x, z));
    const high = spec.tall[0] + (spec.tall[1] - spec.tall[0]) * (0.2 * sy + 0.55 * th + 0.25 * clump);
    e.set(tx, yaw, tz);
    m.compose(p.set(x, y + 0.01, z), q.setFromEuler(e), s.set(sx, high, sz));
    matrices.push(...m.elements);
    // darker and bluer where it is thicker (a forest floor); thick clumps a touch greener, thin dry places shifted toward olive
    const k = 1 - 0.28 * th;
    const tn = 0.6 * tone + 0.4 * clump;
    const dry = spec.clump.dry * smooth(0.5, 0.2, fine) * (1 - th);
    colours.push((spec.tint.r[0] + tn * (spec.tint.r[1] - spec.tint.r[0])) * k * (1 + 0.8 * dry), (spec.tint.g[0] + tn * (spec.tint.g[1] - spec.tint.g[0])) * (1 - 0.12 * th),
      (spec.tint.b[0] + tn * (spec.tint.b[1] - spec.tint.b[0])) * (1 + 0.2 * th) * (1 - 0.4 * dry));
    hashes.push(hash);
  }
  return { count: hashes.length, matrices: Float32Array.from(matrices), colours: Float32Array.from(colours), hash: Float32Array.from(hashes) };
}
const thick01 = v => Math.max(0, Math.min(1, v));

// The share of patches kept at `d` metres from you.
export function grassKeep(d, spec = ISLAND_GRASS) {
  if (d <= spec.fullTo) return 1;
  if (d >= spec.thinTo) return 0;
  const t = (d - spec.fullTo) / (spec.thinTo - spec.fullTo);
  return 1 - t * t * (3 - 2 * t);
}

export function createIslandGrass({ ground, cover, thick, spec = ISLAND_GRASS, seed = 0x5eed }) {
  const group = new THREE.Group();
  group.name = 'Island grass';
  // vertexColors: each blade runs dark at the root to lighter at the tip (multiplied by the instance's tint)
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide });
  material.name = 'Island grass';
  addWindSway(material, SWAY.grass);      // the oasis's wind

  const richGeometry = createIslandPatchGeometry(RICH_BLADES, 2, true);
  const liteGeometry = createIslandPatchGeometry(LITE_BLADES, 1, false);
  const mesh = (geometry, capacity, name) => {
    const m = new THREE.InstancedMesh(geometry, material, capacity);
    m.name = name; m.count = 0; m.frustumCulled = false; m.castShadow = m.receiveShadow = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    group.add(m);
    return m;
  };
  const rich = mesh(richGeometry, spec.maxRich, 'Island grass patches (rich)');
  const lite = mesh(liteGeometry, spec.maxLite, 'Island grass patches (lite)');

  const chunks = new Map();
  const field = { ground, cover, thick };
  let lastX = Infinity, lastZ = Infinity, pending = false;
  let stats = { rich: 0, lite: 0, chunks: 0, triangles: 0 };

  function chunkAt(cx, cz, budget) {
    const key = `${cx},${cz}`;
    let chunk = chunks.get(key);
    if (!chunk) {
      if (budget.left <= 0) { pending = true; return null; }
      budget.left--;
      chunk = makeGrassChunk(cx, cz, field, spec, seed);
      chunks.set(key, chunk);
    }
    return chunk;
  }

  // x, z: where you are. `force`: rebuild now whatever the distance moved, and make every missing chunk this call (the first fill).
  function update(x, z, force = false) {
    const moved = Math.hypot(x - lastX, z - lastZ);
    if (!force && !pending && moved < spec.rebuildMetres) return false;
    lastX = x; lastZ = z; pending = false;
    const budget = { left: force ? Infinity : spec.chunksPerCall };
    const reach = spec.thinTo + spec.chunk;
    const x0 = Math.floor((x - reach) / spec.chunk), x1 = Math.floor((x + reach) / spec.chunk);
    const z0 = Math.floor((z - reach) / spec.chunk), z1 = Math.floor((z + reach) / spec.chunk);
    let nr = 0, nl = 0;
    const ra = rich.instanceMatrix.array, rc = rich.instanceColor.array, la = lite.instanceMatrix.array, lc = lite.instanceColor.array;
    const richSq = spec.rich * spec.rich, thinSq = spec.thinTo * spec.thinTo;
    // the nearest chunks first, so a short budget fills what you are standing in
    const order = [];
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const dx = (cx + 0.5) * spec.chunk - x, dz = (cz + 0.5) * spec.chunk - z;
      order.push([cx, cz, dx * dx + dz * dz]);
    }
    order.sort((a, b) => a[2] - b[2]);
    for (const [cx, cz] of order) {
      const lo = Math.hypot((cx + 0.5) * spec.chunk - x, (cz + 0.5) * spec.chunk - z) - spec.chunk * 0.72;
      if (lo > spec.thinTo) continue;
      const chunk = chunkAt(cx, cz, budget);
      if (!chunk || !chunk.count) continue;
      const mats = chunk.matrices;
      for (let k = 0; k < chunk.count; k++) {
        const px = mats[k * 16 + 12] - x, pz = mats[k * 16 + 14] - z, d2 = px * px + pz * pz;
        if (d2 > thinSq) continue;
        if (d2 > spec.fullTo * spec.fullTo && chunk.hash[k] > grassKeep(Math.sqrt(d2), spec)) continue;
        if (d2 < richSq) {
          if (nr >= spec.maxRich) continue;
          ra.set(mats.subarray(k * 16, k * 16 + 16), nr * 16); rc.set(chunk.colours.subarray(k * 3, k * 3 + 3), nr * 3); nr++;
        } else {
          if (nl >= spec.maxLite) continue;
          la.set(mats.subarray(k * 16, k * 16 + 16), nl * 16); lc.set(chunk.colours.subarray(k * 3, k * 3 + 3), nl * 3); nl++;
        }
      }
    }
    rich.count = nr; lite.count = nl;
    rich.visible = nr > 0; lite.visible = nl > 0;
    for (const [m, n] of [[rich, nr], [lite, nl]]) {
      m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, Math.max(n, 1) * 16); m.instanceMatrix.needsUpdate = true;
      m.instanceColor.clearUpdateRanges(); m.instanceColor.addUpdateRange(0, Math.max(n, 1) * 3); m.instanceColor.needsUpdate = true;
    }
    // forget the far chunks (only when there are plenty)
    if (chunks.size > 900) {
      const far = spec.keepWithin * spec.keepWithin;
      for (const [key, chunk] of chunks) {
        const [cx, cz] = key.split(',').map(Number);
        const dx = (cx + 0.5) * spec.chunk - x, dz = (cz + 0.5) * spec.chunk - z;
        if (dx * dx + dz * dz > far) chunks.delete(key);
      }
    }
    stats = { rich: nr, lite: nl, chunks: chunks.size, triangles: nr * RICH_TRIANGLES + nl * LITE_TRIANGLES };
    return true;
  }

  function dispose() { richGeometry.dispose(); liteGeometry.dispose(); material.dispose(); }
  return { group, update, dispose, material, getStats: () => ({ ...stats }), chunks };
}
