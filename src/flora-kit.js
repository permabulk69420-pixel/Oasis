// A small modeller for the island's new plants and landmarks (Kane, 5 Oct: new models get proper non-overlapping UVs at a steady texel density, textures
// no bigger than 1k). Everything is built from three kinds of surface, each a grid of rows by columns:
//   tube    a ring swept along a path (trunks, limbs, vines, ribs, stalks), with round caps if wanted
//   ribbon  a strip along a path (leaves, fronds, petals, straps), flat or folded
//   lathe   a profile spun round an axis (caps, beads, flowers' bowls, cushions, bones' knobs)
// Because each surface is a grid, it unrolls into ONE chart whose coordinates are metres on the surface (u round or across, v along), so the texel density is
// the same everywhere by construction. The charts are then packed into a single square atlas (shelf packing, padded, never overlapping), at the highest
// density that fits. The packed atlas can be reused by a coarser level of detail built from the same chart keys, so every level shares one texture layout.
// Per vertex: position, smooth normal, colour (linear, dark: the plants are mostly black forms), `emit` (linear rgb of the glow, 0 where it is dark) and uv.
// Pure (no three.js), seeded by the caller, and cheap enough to build on load.

const TAU = Math.PI * 2;

// the oasis's glow colours, linear
export const CYAN = Object.freeze([0.03, 0.62, 1.0]);
export const PALE = Object.freeze([0.55, 0.86, 1.0]);

// A seeded random stream (mulberry32), so a model is the same every time.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------------------------------------------------------------------ vectors
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = a => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a, fallback = [0, 1, 0]) => { const l = length(a); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : fallback; };
export const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = x => Math.max(0, Math.min(1, x));
export const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// A point turned about an axis through the origin (Rodrigues).
export function rotateAbout(p, axis, angle) {
  const k = normalize(axis), c = Math.cos(angle), s = Math.sin(angle), d = dot(k, p) * (1 - c);
  const x = cross(k, p);
  return [p[0] * c + x[0] * s + k[0] * d, p[1] * c + x[1] * s + k[1] * d, p[2] * c + x[2] * s + k[2] * d];
}

// Catmull-Rom through the points (the ends are kept), `sub` points per span.
export function curve(points, sub = 6) {
  const out = [];
  const n = points.length;
  if (n < 3) return points.map(p => [...p]);
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(i + 2, n - 1)];
    for (let k = 0; k < sub; k++) {
      const t = k / sub, t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map(j => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push([...points[n - 1]]);
  return out;
}

// n points spread evenly along a polyline by length.
export function resample(path, n) {
  const lengths = [0];
  for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + length(sub(path[i], path[i - 1])));
  const total = lengths[lengths.length - 1];
  const out = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const d = (k / (n - 1)) * total;
    while (seg < path.length - 2 && lengths[seg + 1] < d) seg++;
    const span = lengths[seg + 1] - lengths[seg] || 1;
    out.push(mix3(path[seg], path[seg + 1], clamp01((d - lengths[seg]) / span)));
  }
  return out;
}

export function pathLength(path) {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += length(sub(path[i], path[i - 1]));
  return total;
}

// The point and unit tangent at fraction t (0..1) of a polyline's length.
export function along(path, t) {
  const total = pathLength(path);
  let want = clamp01(t) * total;
  for (let i = 1; i < path.length; i++) {
    const seg = length(sub(path[i], path[i - 1]));
    if (want <= seg || i === path.length - 1) {
      const f = seg > 0 ? clamp01(want / seg) : 0;
      return { p: mix3(path[i - 1], path[i], f), T: normalize(sub(path[i], path[i - 1])), index: i - 1 + f };
    }
    want -= seg;
  }
  return { p: [...path[path.length - 1]], T: [0, 1, 0], index: path.length - 1 };
}

// ------------------------------------------------------------------------------------------------------------------------------ packing
// Shelf packing of rectangles (metres) into a square of `size` pixels at `density` pixels a metre. Returns { rects: { key: { x, y, w, h } }, height } or null.
export function packCharts(charts, { size = 1024, padding = 3, density = 96 } = {}) {
  const items = charts.map(c => ({ key: c.key, w: Math.ceil(c.w * density) + 2 * padding, h: Math.ceil(c.h * density) + 2 * padding }));
  if (items.some(item => item.w > size || item.h > size)) return null;
  items.sort((a, b) => b.h - a.h || b.w - a.w || (a.key < b.key ? -1 : 1));
  const rects = {};
  let x = 0, y = 0, shelf = 0;
  for (const item of items) {
    if (x + item.w > size) { y += shelf; x = 0; shelf = 0; }
    if (shelf === 0) shelf = item.h;
    if (y + item.h > size) return null;
    rects[item.key] = { x, y, w: item.w, h: item.h };
    x += item.w;
  }
  return { rects, height: y + shelf };
}

// The densest packing that fits: starts at `density` and backs off a few percent at a time.
export function packAtlas(charts, { size = 1024, padding = 3, density = 96 } = {}) {
  let d = density;
  for (let attempt = 0; attempt < 80; attempt++) {
    const packed = packCharts(charts, { size, padding, density: d });
    if (packed) {
      let used = 0;
      for (const r of Object.values(packed.rects)) used += r.w * r.h;
      return { size, padding, density: d, rects: packed.rects, height: packed.height, utilisation: used / (size * Math.max(packed.height, 1)) };
    }
    d *= 0.94;
  }
  throw new Error('flora-kit: the charts do not fit one atlas');
}

// ------------------------------------------------------------------------------------------------------------------------------ the model
export class Model {
  constructor(name, { plan = null } = {}) {
    this.name = name;
    this.plan = plan;
    this.charts = [];
    this.chartIndex = new Map();
    this.positions = []; this.normals = []; this.colors = []; this.emits = []; this.sways = []; this.uvs = []; this.chartOf = []; this.indices = [];
    this.halos = [];
  }

  get triangles() { return this.indices.length / 3; }
  get vertexCount() { return this.positions.length / 3; }

  // A chart: w by h metres of surface. The key names it so a coarser level of detail can use the same place in the atlas.
  chart(key, w, h) {
    if (this.chartIndex.has(key)) throw new Error(`flora-kit: chart ${key} is used twice in ${this.name}`);
    const id = this.charts.length;
    this.charts.push({ key, w: Math.max(w, 1e-4), h: Math.max(h, 1e-4) });
    this.chartIndex.set(key, id);
    return id;
  }

  halo(p, radius, tone = 'cyan') { this.halos.push({ x: p[0], y: p[1], z: p[2], r: radius, tone }); }

  // A grid of vertices, rows by cols, from fn(i, j) -> { p, uv, color, emit }. Triangles run (i,j) (i,j+1) (i+1,j) and (i,j+1) (i+1,j+1) (i+1,j), which is
  // outward when j turns counter-clockwise about the direction i runs. `wrap`: the last column is the first again (a seam), so their normals are shared.
  // `flat`: every cell is its own pair of flat-shaded triangles. A row whose points all coincide is a pole (a tip): it takes the normal of the row beside it.
  grid(chart, rows, cols, fn, { wrap = false, flat = false } = {}) {
    const cells = [];
    for (let i = 0; i < rows; i++) {
      const row = [];
      for (let j = 0; j < cols; j++) row.push(fn(i, j));
      cells.push(row);
    }
    const area2 = (a, b, c) => {
      const n = cross(sub(b, a), sub(c, a));
      return n;
    };
    if (flat) {
      for (let i = 0; i + 1 < rows; i++) for (let j = 0; j + 1 < cols; j++) {
        for (const tri of [[[i, j], [i, j + 1], [i + 1, j]], [[i, j + 1], [i + 1, j + 1], [i + 1, j]]]) {
          const [a, b, c] = tri.map(([r, q]) => cells[r][q]);
          const n = area2(a.p, b.p, c.p);
          const l = length(n);
          if (l < 1e-10) continue;
          const nn = mul(n, 1 / l);
          const base = this.vertexCount;
          for (const q of [a, b, c]) this._vertex(chart, q, nn);
          this.indices.push(base, base + 1, base + 2);
        }
      }
      return;
    }
    const normals = cells.map(row => row.map(() => [0, 0, 0]));
    const addNormal = (i, j, n) => { const t = normals[i][j]; t[0] += n[0]; t[1] += n[1]; t[2] += n[2]; };
    const faces = [];
    for (let i = 0; i + 1 < rows; i++) for (let j = 0; j + 1 < cols; j++) {
      for (const tri of [[[i, j], [i, j + 1], [i + 1, j]], [[i, j + 1], [i + 1, j + 1], [i + 1, j]]]) {
        const [a, b, c] = tri.map(([r, q]) => cells[r][q]);
        const n = area2(a.p, b.p, c.p);
        if (length(n) < 1e-10) continue;
        for (const [r, q] of tri) addNormal(r, q, n);
        faces.push(tri);
      }
    }
    if (wrap) for (let i = 0; i < rows; i++) {
      const s = [normals[i][0][0] + normals[i][cols - 1][0], normals[i][0][1] + normals[i][cols - 1][1], normals[i][0][2] + normals[i][cols - 1][2]];
      normals[i][0] = [...s]; normals[i][cols - 1] = [...s];
    }
    // poles
    for (let i = 0; i < rows; i++) {
      const first = cells[i][0].p;
      if (cells[i].every(c => Math.abs(c.p[0] - first[0]) + Math.abs(c.p[1] - first[1]) + Math.abs(c.p[2] - first[2]) < 1e-9)) {
        const near = i === 0 ? 1 : i - 1;
        const sum = [0, 0, 0];
        for (let j = 0; j < cols; j++) { const n = normalize(normals[Math.min(rows - 1, Math.max(0, near))][j]); sum[0] += n[0]; sum[1] += n[1]; sum[2] += n[2]; }
        const pole = normalize(sum);
        for (let j = 0; j < cols; j++) normals[i][j] = pole;
      }
    }
    const base = this.vertexCount;
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) this._vertex(chart, cells[i][j], normalize(normals[i][j]));
    for (const tri of faces) this.indices.push(...tri.map(([r, q]) => base + r * cols + q));
  }

  _vertex(chart, v, n) {
    this.positions.push(v.p[0], v.p[1], v.p[2]);
    this.normals.push(n[0], n[1], n[2]);
    const c = v.color ?? [0.1, 0.1, 0.1];
    this.colors.push(c[0], c[1], c[2]);
    const e = v.emit ?? null;
    this.emits.push(e ? e[0] : 0, e ? e[1] : 0, e ? e[2] : 0);
    this.sways.push(Math.min(1, Math.max(0, v.sway ?? 0)));
    this.uvs.push(v.uv[0], v.uv[1]);
    this.chartOf.push(chart);
  }

  // Packs the charts and writes the final uvs. `plan` (from a finer level of detail's atlas) reuses its places. Returns typed arrays ready for a BufferGeometry.
  finish({ size = 1024, padding = 3, density = 96 } = {}) {
    let atlas;
    if (this.plan) {
      atlas = this.plan;
      for (const c of this.charts) {
        const r = atlas.rects[c.key];
        if (!r) throw new Error(`flora-kit: ${this.name} has a chart (${c.key}) its finer level does not`);
        if (c.w * atlas.density > r.w - 2 * atlas.padding + 1.5 || c.h * atlas.density > r.h - 2 * atlas.padding + 1.5) {
          throw new Error(`flora-kit: chart ${c.key} of ${this.name} is bigger than its place in the plan`);
        }
      }
    } else {
      atlas = packAtlas(this.charts, { size, padding, density });
    }
    const uvs = new Float32Array(this.uvs.length);
    for (let k = 0; k < this.chartOf.length; k++) {
      const r = atlas.rects[this.charts[this.chartOf[k]].key];
      uvs[k * 2] = (r.x + atlas.padding + this.uvs[k * 2] * atlas.density) / atlas.size;
      uvs[k * 2 + 1] = (r.y + atlas.padding + this.uvs[k * 2 + 1] * atlas.density) / atlas.size;
    }
    const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let k = 0; k < this.positions.length; k += 3) for (let a = 0; a < 3; a++) {
      bounds.min[a] = Math.min(bounds.min[a], this.positions[k + a]);
      bounds.max[a] = Math.max(bounds.max[a], this.positions[k + a]);
    }
    const count = this.vertexCount;
    return {
      name: this.name,
      positions: Float32Array.from(this.positions), normals: Float32Array.from(this.normals), colors: Float32Array.from(this.colors),
      emits: Float32Array.from(this.emits), sways: Float32Array.from(this.sways), uvs,
      indices: count > 65535 ? Uint32Array.from(this.indices) : Uint16Array.from(this.indices),
      triangles: this.triangles, vertexCount: count, bounds, halos: this.halos.map(h => ({ ...h })),
      atlas: { size: atlas.size, padding: atlas.padding, density: atlas.density, rects: atlas.rects, height: atlas.height, utilisation: atlas.utilisation },
      chartOf: Uint32Array.from(this.chartOf), charts: this.charts.map(c => ({ ...c })),
    };
  }
}

// ------------------------------------------------------------------------------------------------------------------------------ tube
// Frames along a path by parallel transport (so a tube never twists on its own). `up` is a hint for the first normal.
export function tubeFrames(path, up = null) {
  const n = path.length;
  const T = path.map((p, i) => normalize(sub(path[Math.min(i + 1, n - 1)], path[Math.max(i - 1, 0)]), [0, 1, 0]));
  let first = up ? normalize(sub(up, mul(T[0], dot(up, T[0])))) : null;
  if (!first || length(sub(up ?? [0, 0, 0], mul(T[0], dot(up ?? [0, 0, 0], T[0])))) < 1e-6) {
    const ref = Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    first = normalize(sub(ref, mul(T[0], dot(ref, T[0]))));
  }
  const N = [first];
  for (let i = 1; i < n; i++) {
    const prev = N[i - 1];
    N.push(normalize(sub(prev, mul(T[i], dot(prev, T[i]))), prev));
  }
  const B = T.map((t, i) => cross(t, N[i]));
  return { T, N, B };
}

// A tube along `path` (an array of [x, y, z]). Options:
//   radius   a number, an array (one per point) or (t, i) => metres
//   sides    points round (default 6)
//   capStart, capEnd   'round' (default), 'flat' or 'none' (an open end, for a trunk that goes into the ground)
//   up       a hint for which way the seam faces
//   twist    radians the ring turns over the whole length
//   shape    (t, a) => multiplier on the radius at a point of the surface (bark, knots, ribs);   offset  (t, a) => [x, y, z] added to a point (a slanted top)
//   color    (t, a, i) => [r, g, b];   emit  (t, a, i) => [r, g, b] | null
//   capColor the colour of a flat end (a broken log shows pale wood);   flat     faceted: every face its own flat normal
export function addTube(model, key, path, o = {}) {
  const sides = o.sides ?? 6;
  const n = path.length;
  const base = path.map((p, i) => ({
    p, t: n > 1 ? i / (n - 1) : 0,
    r: typeof o.radius === 'function' ? o.radius(n > 1 ? i / (n - 1) : 0, i) : Array.isArray(o.radius) ? o.radius[i] : o.radius,
  }));
  const { T, N, B } = tubeFrames(path, o.up);
  const capStart = o.capStart ?? 'round', capEnd = o.capEnd ?? 'round';
  const K = o.capRings ?? 2;
  // the rings: optional round caps (a quarter circle in K steps, then a pole) before and after
  const rings = [];
  let s = 0;
  const startCap = [];
  if (capStart === 'round') {
    const r0 = base[0].r;
    startCap.push({ p: sub(base[0].p, mul(T[0], r0)), r: 0, idx: 0, t: 0 });       // the pole, then rings getting wider towards the first point
    for (let k = K; k >= 1; k--) {
      const phi = (k / (K + 1)) * (Math.PI / 2);
      startCap.push({ p: sub(base[0].p, mul(T[0], r0 * Math.sin(phi))), r: r0 * Math.cos(phi), idx: 0, t: 0 });
    }
  }
  const endCap = [];
  if (capEnd === 'round') {
    const r1 = base[n - 1].r;
    for (let k = 1; k <= K; k++) {
      const phi = (k / (K + 1)) * (Math.PI / 2);
      endCap.push({ p: add(base[n - 1].p, mul(T[n - 1], r1 * Math.sin(phi))), r: r1 * Math.cos(phi), idx: n - 1, t: 1 });
    }
    endCap.push({ p: add(base[n - 1].p, mul(T[n - 1], r1)), r: 0, idx: n - 1, t: 1 });
  }
  for (const c of startCap) rings.push(c);
  for (let i = 0; i < n; i++) rings.push({ p: base[i].p, r: base[i].r, idx: i, t: base[i].t });
  for (const c of endCap) rings.push(c);
  // arclength along the surface
  const v = [0];
  for (let i = 1; i < rings.length; i++) v.push(v[i - 1] + Math.hypot(length(sub(rings[i].p, rings[i - 1].p)), rings[i].r - rings[i - 1].r));
  let rmax = 0;
  for (const r of rings) rmax = Math.max(rmax, r.r);
  const W = TAU * rmax;
  let H = v[v.length - 1];
  const flatCaps = capStart === 'flat' || capEnd === 'flat';
  const capSpace = flatCaps ? 2 * rmax * ((capStart === 'flat' ? 1 : 0) + (capEnd === 'flat' ? 1 : 0)) : 0;
  const chart = model.chart(key, Math.max(W, flatCaps ? 2 * rmax : 0), H + capSpace);
  const turn = o.twist ?? 0;
  const point = (i, j) => {
    const ring = rings[i];
    const a = j / sides;
    const theta = a * TAU + turn * ring.t;
    const e = ring.idx;
    const radial = add(mul(N[e], Math.cos(theta)), mul(B[e], Math.sin(theta)));
    const rr = ring.r * (o.shape ? o.shape(ring.t, a) : 1);
    const p = add(add(ring.p, mul(radial, rr)), o.offset ? o.offset(ring.t, a) : [0, 0, 0]);
    return {
      p, uv: [W / 2 + (a - 0.5) * TAU * Math.max(ring.r, 1e-6), v[i]],
      color: o.color ? o.color(ring.t, a, ring.idx) : undefined, emit: o.emit ? o.emit(ring.t, a, ring.idx) : undefined,
      sway: o.sway ? o.sway(ring.t, a, ring.idx) : 0,
    };
  };
  model.grid(chart, rings.length, sides + 1, point, { wrap: true, flat: !!o.flat });
  // flat ends: a disc beyond each end, in the chart's spare room
  const disc = (end, at) => {
    const ring = end === 'start' ? rings[0] : rings[rings.length - 1];
    const e = ring.idx;
    const dir = end === 'start' ? mul(T[e], -1) : T[e];
    const centre = ring.p;
    const first = [];
    const m = model.vertexCount;
    const c = o.capColor ?? (o.color ? o.color(ring.t, 0, ring.idx) : undefined);
    const shift = j => (o.offset ? o.offset(ring.t, j / sides) : [0, 0, 0]);
    const mean = [0, 0, 0];
    for (let j = 0; j < sides; j++) { const d = shift(j); mean[0] += d[0] / sides; mean[1] += d[1] / sides; mean[2] += d[2] / sides; }
    model._vertex(chart, { p: add(centre, mean), uv: [W / 2, at], color: c, emit: undefined }, dir);
    for (let j = 0; j < sides; j++) {
      const theta = (j / sides) * TAU;
      const radial = add(mul(N[e], Math.cos(theta)), mul(B[e], Math.sin(theta)));
      const rr = o.shape ? o.shape(ring.t, j / sides) : 1;
      model._vertex(chart, { p: add(add(centre, mul(radial, ring.r * rr)), shift(j)), uv: [W / 2 + Math.cos(theta) * ring.r, at + Math.sin(theta) * ring.r], color: c, emit: undefined }, dir);
      first.push(m + 1 + j);
    }
    for (let j = 0; j < sides; j++) {
      const a = m + 1 + j, b = m + 1 + ((j + 1) % sides);
      if (end === 'start') model.indices.push(m, b, a); else model.indices.push(m, a, b);
    }
  };
  let offset = H;
  if (capStart === 'flat') { disc('start', offset + rmax); offset += 2 * rmax; }
  if (capEnd === 'flat') disc('end', offset + rmax);
  return { length: H, rings: rings.length };
}

// ------------------------------------------------------------------------------------------------------------------------------ ribbon
// A strip along `path`. Options: width (number | (t, i) => metres), side ([x,y,z] | (t, i, T) => vector: which way across; default: horizontal and square to the path),
// fold (0..1: the edges lift toward the front by this share of the half width, so a leaf is cupped), cols (2 or 3), color (t, s, i) => rgb with s 0..1 across,
// emit (t, s, i) => rgb. Seen from the front (the side the normal points to) the winding is counter-clockwise; use a double-sided material for leaves.
export function addRibbon(model, key, path, o = {}) {
  const n = path.length;
  const cols = o.fold ? Math.max(3, o.cols ?? 3) : (o.cols ?? 2);
  const { T } = tubeFrames(path);
  const widthAt = (t, i) => (typeof o.width === 'function' ? o.width(t, i) : o.width);
  let wmax = 0;
  for (let i = 0; i < n; i++) wmax = Math.max(wmax, widthAt(n > 1 ? i / (n - 1) : 0, i));
  const v = [0];
  for (let i = 1; i < n; i++) v.push(v[i - 1] + length(sub(path[i], path[i - 1])));
  const chart = model.chart(key, wmax, v[n - 1]);
  model.grid(chart, n, cols, (i, j) => {
    const t = n > 1 ? i / (n - 1) : 0;
    const w = widthAt(t, i);
    let side = typeof o.side === 'function' ? o.side(t, i, T[i]) : o.side ?? cross(T[i], [0, 1, 0]);
    side = sub(side, mul(T[i], dot(side, T[i])));
    side = normalize(side, [1, 0, 0]);
    const front = normalize(cross(side, T[i]));
    const s = j / (cols - 1);                 // 0 .. 1 across
    const across = (s - 0.5) * w;
    const lift = o.fold ? Math.pow(Math.abs(s - 0.5) * 2, 2) * o.fold * w * 0.5 : 0;
    const p = add(add(path[i], mul(side, across)), mul(front, lift));
    return { p, uv: [wmax / 2 + across, v[i]], color: o.color ? o.color(t, s, i) : undefined, emit: o.emit ? o.emit(t, s, i) : undefined, sway: o.sway ? o.sway(t, s, i) : 0 };
  });
  return { length: v[n - 1], width: wmax };
}

// ------------------------------------------------------------------------------------------------------------------------------ trail
// A thin glowing strip lying on the surface of a tube (a vein up a trunk, a seam down a root): `path`, `radius`, `shape`, `up` and `twist` are the tube's own, so it
// follows the same surface; `angle(t)` is how far round (0..1 of a turn, 0 = where the tube's seam is) the strip runs at fraction t of the length, `lift` how far it
// stands off the surface (a centimetre or two, so the faceted tube never cuts through it). Options as for addRibbon otherwise (width, color, emit, sway).
export function addTrail(model, key, path, o = {}) {
  const n = path.length;
  const { T, N, B } = tubeFrames(path, o.up);
  const lift = o.lift ?? 0.016;
  const turn = o.twist ?? 0;
  const radiusAt = (t, i) => (typeof o.radius === 'function' ? o.radius(t, i) : Array.isArray(o.radius) ? o.radius[i] : o.radius);
  const spots = path.map((p, i) => {
    const t = n > 1 ? i / (n - 1) : 0;
    const a = o.angle(t);
    const theta = a * TAU + turn * t;
    const radial = add(mul(N[i], Math.cos(theta)), mul(B[i], Math.sin(theta)));
    const r = radiusAt(t, i) * (o.shape ? o.shape(t, a) : 1) + lift;
    return { point: add(p, mul(radial, r)), around: add(mul(N[i], -Math.sin(theta)), mul(B[i], Math.cos(theta))), a };
  });
  return addRibbon(model, key, spots.map(s => s.point), { ...o, side: (t, i) => spots[i].around, fold: 0, cols: 2 });
}

// ------------------------------------------------------------------------------------------------------------------------------ lathe
// A profile [[radius, height], ...] spun about `axis` (default up) at `origin`. The profile runs bottom to top; a closed dome starts and ends on the axis
// (radius 0). Options: sides, sx / sz (an ellipse), origin, axis, turn (radians), arc (radians swept, default a full turn: less makes a half shelf or a petal cup),
// frame ([e1, e2]: where angle 0 points and which way it turns, default any), radial (a, t) => multiplier on the radius (lumps), lift (a, t) => metres along the
// axis, color (t, a) => rgb, emit (t, a) => rgb, sway (t, a) => 0..1, flat (faceted: every face its own normal).
export function addLathe(model, key, profile, o = {}) {
  const sides = o.sides ?? 8;
  const axis = normalize(o.axis ?? [0, 1, 0]);
  let e1, e2;
  if (o.frame) { e1 = normalize(o.frame[0]); e2 = normalize(o.frame[1]); } else {
    const ref = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    e1 = normalize(cross(axis, ref)); e2 = cross(axis, e1);
  }
  const origin = o.origin ?? [0, 0, 0];
  const sx = o.sx ?? 1, sz = o.sz ?? 1;
  const arc = o.arc ?? TAU;
  const full = arc >= TAU - 1e-6;
  const n = profile.length;
  const v = [0];
  for (let i = 1; i < n; i++) v.push(v[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
  let rmax = 0;
  for (const [r] of profile) rmax = Math.max(rmax, r);
  const W = arc * rmax * Math.max(sx, sz, 1e-6);
  const chart = model.chart(key, W, v[n - 1]);
  model.grid(chart, n, sides + 1, (i, j) => {
    const t = n > 1 ? i / (n - 1) : 0;
    const a = j / sides;
    const theta = a * arc + (o.turn ?? 0);
    const r = profile[i][0] * (o.radial ? o.radial(a, t) : 1);
    const h = profile[i][1] + (o.lift ? o.lift(a, t) : 0);
    const p = add(add(origin, mul(axis, h)), add(mul(e1, Math.cos(theta) * r * sx), mul(e2, Math.sin(theta) * r * sz)));
    return {
      p, uv: [W / 2 + (a - 0.5) * arc * Math.max(profile[i][0], 1e-6) * Math.max(sx, sz), v[i]],
      color: o.color ? o.color(t, a) : undefined, emit: o.emit ? o.emit(t, a) : undefined, sway: o.sway ? o.sway(t, a) : 0,
    };
  }, { wrap: full, flat: !!o.flat });
  return { length: v[n - 1] };
}

// A dome (a quarter of an ellipse from its rim to its apex): `rings` rows above the rim. `bottom` closes the underside with a flat disc first.
export function bulbProfile(radius, height, rings = 4, { bottom = false } = {}) {
  const out = [];
  if (bottom) out.push([0, 0]);
  for (let k = 0; k <= rings; k++) {
    const phi = (k / rings) * (Math.PI / 2);
    out.push([k === rings ? 0 : radius * Math.cos(phi), height * Math.sin(phi)]);
  }
  return out;
}

// A little glowing bead (an octahedron-ish ball): used for tips and berries. Returns nothing; adds a halo candidate if `halo` is given.
export function addBead(model, key, centre, radius, { color = [0.02, 0.05, 0.06], emit = CYAN, sides = 5, rings = 2, halo = 0, tone = 'cyan', brightness = 1 } = {}) {
  const profile = [[0, -radius]];
  for (let k = 1; k < rings * 2; k++) {
    const phi = -Math.PI / 2 + (k / (rings * 2)) * Math.PI;
    profile.push([radius * Math.cos(phi), radius * Math.sin(phi)]);
  }
  profile.push([0, radius]);
  addLathe(model, key, profile, { origin: centre, sides, color: () => color, emit: () => [emit[0] * brightness, emit[1] * brightness, emit[2] * brightness] });
  if (halo > 0) model.halo(centre, halo, tone);
}

// ------------------------------------------------------------------------------------------------------------------------------ checks
// How evenly the atlas is used: texels per metre of every triangle, as { median, min, max } (pixels per metre). Skips slivers.
export function texelDensity(data) {
  const out = [];
  const { positions, uvs, indices, atlas } = data;
  for (let k = 0; k + 2 < indices.length; k += 3) {
    const a = indices[k] * 3, b = indices[k + 1] * 3, c = indices[k + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const world = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    const ia = indices[k] * 2, ib = indices[k + 1] * 2, ic = indices[k + 2] * 2;
    const uvArea = 0.5 * Math.abs((uvs[ib] - uvs[ia]) * (uvs[ic + 1] - uvs[ia + 1]) - (uvs[ic] - uvs[ia]) * (uvs[ib + 1] - uvs[ia + 1])) * atlas.size * atlas.size;
    if (world < 1e-6 || uvArea < 1e-9) continue;
    out.push(Math.sqrt(uvArea / world));
  }
  out.sort((x, y) => x - y);
  if (!out.length) return { median: 0, min: 0, max: 0, p5: 0, p95: 0, count: 0 };
  return { median: out[Math.floor(out.length / 2)], min: out[0], max: out[out.length - 1], p5: out[Math.floor(out.length * 0.05)], p95: out[Math.floor(out.length * 0.95)], count: out.length };
}
