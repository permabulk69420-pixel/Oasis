import { add, sub, mul, dot, cross, normalize, clamp01, mix3, rotateAbout, smoothstep, length } from './flora-kit.js';

// Textured foliage for the island (Kane, 6 Oct: "dense, Ark-like", real textures, no other people's models). A plant here is a handful of CARDS: curved strips whose
// texture is a leaf, a frond or a spray of leaves painted by tools/island-leaves/make_leaf_atlas.py (own art). Where the leaf is not, the texture is clear and the
// material cuts it out (alpha test), so a card is a silhouette of real leaves, not a quad. Pure (no three.js), so tests and the lab can build them.
//
// SPRITES says where each painted leaf lives in its 1024 x 1024 atlas, in pixels from the top left (the same table the painter writes to sprites.json; a test keeps the
// two in step). A card maps the WHOLE rectangle: u across (left edge to right edge), v from the base (the sprite's bottom edge) to the tip (its top edge).

export const ATLAS_SIZE = 1024;
export const SPRITES = Object.freeze({
  fern: Object.freeze({ sword: [0, 0, 512, 1024], lace: [512, 0, 512, 1024] }),
  broadleaf: Object.freeze({ heart: [0, 0, 496, 496], calathea: [512, 0, 496, 496], monstera: [0, 496, 496, 496], paddle: [512, 496, 496, 496], stem: [0, 992, 32, 32] }),
  shrub: Object.freeze({ privet: [0, 0, 512, 512], willow: [512, 0, 512, 512], compound: [0, 512, 512, 512], coin: [512, 512, 512, 512] }),
  vine: Object.freeze({ strandA: [0, 0, 256, 1024], strandB: [256, 0, 256, 1024], strandC: [512, 0, 256, 1024], strandD: [768, 0, 256, 1024] }),
  canopy: Object.freeze({ broad: [0, 0, 512, 512], slender: [512, 0, 512, 512], fan: [0, 512, 512, 512], rusty: [512, 512, 512, 512] }),
});

// How far up a leaf sprite (0 = its bottom edge, 1 = its top) the stalk joins: a heart has two lobes below the notch.
export const LEAF_ATTACH = Object.freeze({ heart: 0.123, monstera: 0.123, calathea: 0.0, paddle: 0.0 });

const TAU = Math.PI * 2;

export class CardModel {
  constructor(name, atlas) {
    this.name = name;
    this.atlas = atlas;
    this.sprites = SPRITES[atlas];
    if (!this.sprites) throw new Error(`foliage-cards: no atlas called ${atlas}`);
    this.positions = []; this.normals = []; this.colors = []; this.emits = []; this.sways = []; this.uvs = []; this.indices = [];
    this.halos = [];
    // Trunks and limbs (see trunk()) wear a tiling bark photo, not the leaf atlas, so they are kept apart and become the second material group of the mesh.
    this.bark = { positions: [], normals: [], colors: [], uvs: [], indices: [] };
  }

  get triangles() { return (this.indices.length + this.bark.indices.length) / 3; }
  get vertexCount() { return this.positions.length / 3; }

  _uv(rect, s, t) {
    const [rx, ry, rw, rh] = rect;
    const inset = 0.75;
    return [(rx + inset + (s * 0.5 + 0.5) * (rw - 2 * inset)) / ATLAS_SIZE, 1 - (ry + inset + (1 - t) * (rh - 2 * inset)) / ATLAS_SIZE];
  }

  // A strip of leaf along `path` ([[x, y, z], ...], base to tip). Options:
  //   width    metres (a number, or t => metres)               across   which way the strip is wide (a vector, or (t, i, tangent) => vector); made square to the path
  //   cols     columns across (2 flat, 3 or more to let `fold` and `cup` bend it)
  //   fold     the edges rise toward the front by this share of the half width, linearly (a V);     cup   the same, but as a bowl (squared)
  //   roll     radians the strip is turned about its own axis
  //   shade    (t, s, p) => [r, g, b] multiplier on the texture (a darker base, a tint)
  //   bias     { fn: p => [x, y, z], mix }: the vertex normals lean this way (a bush shades as one soft ball, not as separate cards)
  //   sway     (t, s, i) => 0..1, the weight a hanging strip is blown by
  card(sprite, path, o = {}) {
    const rect = this.sprites[sprite];
    if (!rect) throw new Error(`foliage-cards: ${this.atlas} has no sprite ${sprite}`);
    const n = path.length, cols = o.cols ?? 3;
    const T = path.map((p, i) => normalize(sub(path[Math.min(i + 1, n - 1)], path[Math.max(i - 1, 0)]), [0, 1, 0]));
    const grid = [];
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0;
      let A = typeof o.across === 'function' ? o.across(t, i, T[i]) : (o.across ?? [1, 0, 0]);
      A = sub(A, mul(T[i], dot(A, T[i])));
      A = normalize(A, Math.abs(T[i][1]) < 0.9 ? cross(T[i], [0, 1, 0]) : [1, 0, 0]);
      if (o.roll) A = rotateAbout(A, T[i], o.roll);
      const F = normalize(cross(A, T[i]));
      const w = typeof o.width === 'function' ? o.width(t) : o.width;
      const row = [];
      for (let j = 0; j < cols; j++) {
        const s = (j / (cols - 1)) * 2 - 1, edge = Math.abs(s);
        const lift = (o.fold ? o.fold * edge : 0) * w / 2 + (o.cup ? o.cup * edge * edge : 0) * w / 2;
        row.push({ p: add(add(path[i], mul(A, s * w / 2)), mul(F, lift)), s, t, i, n: [0, 0, 0] });
      }
      grid.push(row);
    }
    const base = this.vertexCount;
    for (let i = 0; i + 1 < n; i++) for (let j = 0; j + 1 < cols; j++) {
      const a = grid[i][j], b = grid[i][j + 1], c = grid[i + 1][j], d = grid[i + 1][j + 1];
      for (const [p, q, r] of [[a, b, c], [b, d, c]]) {
        const nn = cross(sub(q.p, p.p), sub(r.p, p.p));
        for (const v of [p, q, r]) { v.n[0] += nn[0]; v.n[1] += nn[1]; v.n[2] += nn[2]; }
      }
      const at = k => base + k.i * cols + Math.round((k.s * 0.5 + 0.5) * (cols - 1));
      this.indices.push(at(a), at(b), at(c), at(b), at(d), at(c));
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < cols; j++) {
      const v = grid[i][j];
      let nn = normalize(v.n, [0, 1, 0]);
      if (o.bias) nn = normalize(mix3(nn, normalize(o.bias.fn(v.p), [0, 1, 0]), o.bias.mix ?? 0.5), nn);
      const uv = this._uv(rect, v.s, v.t);
      const c = o.shade ? o.shade(v.t, v.s, v.p) : [1, 1, 1];
      this.positions.push(v.p[0], v.p[1], v.p[2]);
      this.normals.push(nn[0], nn[1], nn[2]);
      this.colors.push(c[0], c[1], c[2]);
      this.emits.push(0, 0, 0);
      this.sways.push(o.sway ? clamp01(o.sway(v.t, v.s, i)) : 0);
      this.uvs.push(uv[0], uv[1]);
    }
  }

  // A thin stalk: a few-sided tube along `path` that takes its colour from the atlas's `stem` swatch (so the atlas must have one).
  stem(path, radius, o = {}) {
    const rect = this.sprites.stem;
    if (!rect) throw new Error(`foliage-cards: ${this.atlas} has no stem swatch`);
    const n = path.length, sides = o.sides ?? 3;
    const T = path.map((p, i) => normalize(sub(path[Math.min(i + 1, n - 1)], path[Math.max(i - 1, 0)]), [0, 1, 0]));
    const base = this.vertexCount;
    const uv = this._uv(rect, 0, 0.5);
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0;
      const ref = Math.abs(T[i][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const N = normalize(cross(T[i], ref)), B = cross(T[i], N);
      const rr = typeof radius === 'function' ? radius(t) : radius;
      const c = o.shade ? o.shade(t, 0, path[i]) : [1, 1, 1];
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * TAU;
        const radial = add(mul(N, Math.cos(a)), mul(B, Math.sin(a)));
        const p = add(path[i], mul(radial, rr));
        this.positions.push(p[0], p[1], p[2]);
        this.normals.push(radial[0], radial[1], radial[2]);
        this.colors.push(c[0], c[1], c[2]);
        this.emits.push(0, 0, 0);
        this.sways.push(o.sway ? clamp01(o.sway(t)) : 0);
        this.uvs.push(uv[0], uv[1]);
      }
    }
    for (let i = 0; i + 1 < n; i++) for (let j = 0; j < sides; j++) {
      const a = base + i * sides + j, b = base + i * sides + (j + 1) % sides, c = a + sides, d = b + sides;
      this.indices.push(a, c, b, b, c, d);
    }
  }

  // A trunk, limb, root or stem: a tube along `path` ([[x, y, z], ...], base to tip) wearing the tiling bark photo (a second material, see island-flora.js). Options:
  //   radius    metres: a number, or (t, i, p) => metres for the ring at fraction t along the path; or [across, up] for an oval section (see frameUp)
  //   sides     round the tube (8 default)         repeats   how many times the photo wraps round (3 default)
  //   frameUp   a vector: the section's second axis is the world direction nearest this (so a root fin stands up on its edge); default carries a frame along the path
  //   buttress  { count, reach, height, power, phase, sharp }: ridges that flare out at the foot (sail roots). Each ring's radius is multiplied by
  //             1 + reach * lobe(angle) * (1 - smoothstep(0, height, y)) ^ power, y being the ring's height above the model's ground (y = 0)
  //   shade     (t, y, angle) => [r, g, b] multiplier on the photo (dark for the twilight, green with moss low down)
  // The photo's texels are kept square everywhere: each vertex's v advances by the distance moved along the surface, at the density u has round the tube there.
  trunk(path, o = {}) {
    const n = path.length, sides = o.sides ?? 8, reps = o.repeats ?? 3;
    const bark = this.bark;
    const T = path.map((p, i) => normalize(sub(path[Math.min(i + 1, n - 1)], path[Math.max(i - 1, 0)]), [0, 1, 0]));
    const frames = [];
    if (o.frameUp) {
      for (let i = 0; i < n; i++) {
        const B = normalize(sub(o.frameUp, mul(T[i], dot(o.frameUp, T[i]))), [0, 1, 0]);
        frames.push({ N: cross(B, T[i]), B });
      }
    } else {
      // carried along the path, so a bent limb does not twist
      let N = normalize(cross(T[0], Math.abs(T[0][2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]), [1, 0, 0]);
      for (let i = 0; i < n; i++) {
        N = normalize(sub(N, mul(T[i], dot(N, T[i]))), N);
        frames.push({ N, B: cross(T[i], N) });
      }
    }
    const b = o.buttress;
    const rings = [];
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0;
      const rr = typeof o.radius === 'function' ? o.radius(t, i, path[i]) : o.radius;
      const [rx, ry] = Array.isArray(rr) ? rr : [rr, rr];
      const flare = b ? Math.pow(1 - smoothstep(0, b.height, path[i][1]), b.power ?? 2) : 0;
      const ring = [];
      for (let j = 0; j < sides; j++) {
        const a = (j / sides) * TAU;
        let k = 1;
        if (b && flare > 0) {
          const lobe = Math.pow(0.5 + 0.5 * Math.cos(b.count * (a - (b.phase ?? 0))), b.sharp ?? 2.2);
          const wobble = 0.8 + 0.4 * Math.sin(a * 1.7 + (b.phase ?? 0) * 3.1);
          k = 1 + b.reach * lobe * wobble * flare;
        }
        const p = add(path[i], add(mul(frames[i].N, Math.cos(a) * rx * k), mul(frames[i].B, Math.sin(a) * ry * k)));
        ring.push({ p, a });
      }
      rings.push({ ring, t });
    }
    // v per vertex
    const vs = [];
    for (let i = 0; i < n; i++) {
      vs.push(new Array(sides).fill(0));
      if (i === 0) continue;
      for (let j = 0; j < sides; j++) {
        const here = rings[i].ring, prev = rings[i - 1].ring;
        const spacing = Math.max(length(sub(here[(j + 1) % sides].p, here[(j + sides - 1) % sides].p)) / 2, 0.02);
        vs[i][j] = vs[i - 1][j] + length(sub(here[j].p, prev[j].p)) * (reps / sides) / spacing;
      }
    }
    const base = bark.positions.length / 3;
    const stride = sides + 1;
    for (let i = 0; i < n; i++) {
      const { ring, t } = rings[i];
      const up = rings[Math.min(i + 1, n - 1)].ring, down = rings[Math.max(i - 1, 0)].ring;
      for (let j = 0; j <= sides; j++) {
        const jj = j % sides;
        const du = sub(ring[(jj + 1) % sides].p, ring[(jj + sides - 1) % sides].p), dv = sub(up[jj].p, down[jj].p);
        const nn = normalize(cross(du, dv), normalize(sub(ring[jj].p, path[i])));
        const c = o.shade ? o.shade(t, ring[jj].p[1], ring[jj].a) : [1, 1, 1];
        bark.positions.push(ring[jj].p[0], ring[jj].p[1], ring[jj].p[2]);
        bark.normals.push(nn[0], nn[1], nn[2]);
        bark.colors.push(c[0], c[1], c[2]);
        bark.uvs.push((j / sides) * reps, vs[i][jj]);
      }
    }
    for (let i = 0; i + 1 < n; i++) for (let j = 0; j < sides; j++) {
      const a = base + i * stride + j, bb = a + 1, c = a + stride, d = bb + stride;
      bark.indices.push(a, bb, c, bb, d, c);
    }
  }

  // The finished arrays. The leaf cards come first (material 0) and the bark after them (material 1, only if there is any: `groups` then says which indices are which).
  finish() {
    const cardVerts = this.vertexCount, barkVerts = this.bark.positions.length / 3, count = cardVerts + barkVerts;
    const positions = this.positions.concat(this.bark.positions);
    const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let k = 0; k < positions.length; k += 3) for (let a = 0; a < 3; a++) {
      bounds.min[a] = Math.min(bounds.min[a], positions[k + a]);
      bounds.max[a] = Math.max(bounds.max[a], positions[k + a]);
    }
    const indices = this.indices.concat(this.bark.indices.map(k => k + cardVerts));
    const groups = barkVerts ? [{ start: 0, count: this.indices.length, material: 0 }, { start: this.indices.length, count: this.bark.indices.length, material: 1 }] : null;
    return {
      name: this.name, atlasName: this.atlas,
      positions: Float32Array.from(positions), normals: Float32Array.from(this.normals.concat(this.bark.normals)), colors: Float32Array.from(this.colors.concat(this.bark.colors)),
      emits: Float32Array.from(this.emits.concat(new Array(barkVerts * 3).fill(0))), sways: Float32Array.from(this.sways.concat(new Array(barkVerts).fill(0))),
      uvs: Float32Array.from(this.uvs.concat(this.bark.uvs)),
      indices: count > 65535 ? Uint32Array.from(indices) : Uint16Array.from(indices),
      triangles: indices.length / 3, vertexCount: count, bounds, halos: [], groups,
      atlas: { name: this.atlas, size: ATLAS_SIZE },
    };
  }
}

// A path that leaves `base` along the horizontal direction `dir` (a unit vector) at `elev` radians above the horizontal and bends down by `droop` radians over its
// `len` metres (the droop comes on faster toward the tip, as a frond's does). n points.
export function arch(base, dir, elev, droop, len, n) {
  const pts = [[...base]];
  let p = [...base];
  const ds = len / (n - 1);
  for (let i = 1; i < n; i++) {
    const a = elev - droop * Math.pow((i - 0.5) / (n - 1), 1.6);
    p = add(p, [dir[0] * Math.cos(a) * ds, Math.sin(a) * ds, dir[2] * Math.cos(a) * ds]);
    pts.push(p);
  }
  return pts;
}
