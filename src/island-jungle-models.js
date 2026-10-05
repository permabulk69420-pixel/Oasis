import { rng, add, sub, mul, normalize, cross, lerp, clamp01, smoothstep, rotateAbout, along } from './flora-kit.js';
import { CardModel, arch } from './foliage-cards.js';

// The island's tall growth (Kane, 6 Oct: dense and Ark-like, my own models only, textures fine): jungle giants with root buttresses and a painted leaf canopy, tree
// ferns, and leafy bushes. Built from the same cards as the undergrowth (src/foliage-cards.js, the painted atlases from tools/island-leaves): the crowns and bushes are
// ROSETTES, round bursts of leaves painted in the `canopy` atlas, laid as cards at every angle so they read as leaf mass from any side; the trunks are tubes wearing the
// tiling Bark Brown 02 photo (CC0). Three levels of detail each. A model's origin is its root on the ground (a trunk starts a little below it), +y up; the layout turns,
// scales and tints each copy. Pure and seeded: the same tree grows the same every time, and every level keeps the same cards (a coarser level keeps a spread subset, bigger).

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const UP = [0, 1, 0];

// A rosette card: the canopy sprite laid as a square card of `size` metres about `centre`, facing `normal`, turned `spin` radians about that normal. rows: 1 is a flat
// quad, 2 bends along its length too. `cup` raises the edges (a dish).
function rosette(model, sprite, centre, normal, size, spin, o = {}) {
  const n = normalize(normal);
  const T = rotateAbout(normalize(cross(n, Math.abs(n[1]) < 0.95 ? UP : [1, 0, 0])), n, spin);
  const A = cross(T, n);
  const half = size / 2;
  const path = o.rows === 1 ? [sub(centre, mul(T, half)), add(centre, mul(T, half))] : [sub(centre, mul(T, half)), centre, add(centre, mul(T, half))];
  model.card(sprite, path, { width: size, across: A, cols: o.cols ?? 3, cup: o.cup ?? 0, shade: o.shade, bias: o.bias });
}

// A card's direction: `side` is the share that face sideways (so a crown reads from the ground at a low angle as well as from above), the rest are tilted up by up to `tilt`.
function cardNormal(r, side, tilt) {
  const az = r() * TAU;
  if (r() < side) return normalize([Math.cos(az), 0.15 + 0.5 * r(), Math.sin(az)]);
  const t = r() * tilt;
  return normalize([Math.sin(t) * Math.cos(az), Math.cos(t), Math.sin(t) * Math.sin(az)]);
}

// ------------------------------------------------------------------------------------------------------------------------------------ jungle giants
export const JUNGLE_TREES = Object.freeze({
  jungleA: Object.freeze({ seed: 1201, height: 26, radius: 0.95, lean: 1.4, limbs: 6, buttress: { count: 5, reach: 2.6, height: 3.4 }, sprites: ['broad', 'broad', 'fan', 'slender', 'rusty'] }),
  jungleB: Object.freeze({ seed: 2207, height: 32, radius: 1.2, lean: 1.0, limbs: 7, buttress: { count: 6, reach: 2.9, height: 4.2 }, sprites: ['broad', 'fan', 'fan', 'slender', 'broad'] }),
  jungleC: Object.freeze({ seed: 3319, height: 21, radius: 0.8, lean: 2.0, limbs: 5, buttress: { count: 4, reach: 2.3, height: 2.8 }, sprites: ['slender', 'broad', 'rusty', 'fan', 'broad'] }),
});

const specCache = new Map();

// Everything that does not depend on the level of detail: the trunk's line, the limbs (and their forks), and every card (centre, normal, size, sprite) with a `rank`
// (0..1, evenly spread) that says when a coarser level drops it. The leaves are in BLOBS: a flattened ball of cards facing outward (round, so a crown reads as a mass of
// leaf from the ground at any angle) at the end of each limb and fork, on the top of the trunk and a few low down. Also `anchors`, points on the limbs where vines may hang.
export function treeSpec(name) {
  if (specCache.has(name)) return specCache.get(name);
  const def = JUNGLE_TREES[name];
  if (!def) throw new Error(`no jungle tree called ${name}`);
  const r = rng(def.seed);
  const H = def.height, R = def.radius;
  const theta = r() * TAU, phi1 = r() * TAU, phi2 = r() * TAU;
  const trunkAt = y => {
    const k = clamp01(y / H);
    const drift = def.lean * Math.pow(k, 1.4);
    return [Math.cos(theta) * drift + Math.sin(k * 4.1 + phi1) * 0.3 * def.lean * k, y, Math.sin(theta) * drift + Math.sin(k * 3.3 + phi2) * 0.3 * def.lean * k];
  };
  const radiusAt = y => R * (1 - 0.6 * Math.pow(clamp01(y / H), 1.2)) * (1 + 0.05 * Math.sin(y * 0.9 + phi1));
  const limbs = [], cards = [], anchors = [];
  let index = 0;
  const pickSprite = () => def.sprites[Math.floor(r() * def.sprites.length)];

  // A blob of leaf: `radius` metres across its half, flattened to 0.62 high. Cards sit on the shell facing out (and a little up), with a few inside to fill it.
  const blob = (centre, radius, tone) => {
    const shell = Math.round(7 + 2.2 * radius), inner = Math.round(2 + 0.7 * radius);
    for (let c = 0; c < shell + inner; c++) {
      const outer = c < shell;
      let d;
      if (outer) {
        const yy = lerp(-0.35, 1, (c + 0.5) / shell), ring = Math.sqrt(Math.max(0, 1 - yy * yy)), a = c * GOLDEN;
        d = [Math.cos(a) * ring, yy, Math.sin(a) * ring];
      } else {
        d = normalize([r() - 0.5, 0.2 + 0.7 * r(), r() - 0.5]);
      }
      const reach = outer ? 0.62 + 0.38 * r() : 0.15 + 0.4 * r();
      const pos = add(centre, [d[0] * radius * reach, d[1] * radius * 0.62 * reach, d[2] * radius * reach]);
      const normal = normalize([d[0] + (r() - 0.5) * 0.5, d[1] + 0.35 + (r() - 0.5) * 0.4, d[2] + (r() - 0.5) * 0.5]);
      cards.push({ centre: pos, normal, size: radius * (0.85 + 0.45 * r()), tone: tone * (0.85 + 0.25 * r()) * (0.72 + 0.28 * clamp01(0.5 + 0.5 * d[1])), sprite: pickSprite(), cluster: centre, spin: r() * TAU, rank: ((++index) * 0.6180339887) % 1 });
    }
  };

  // A limb from `start` along `dir` at elevation `elev`, rising a little more along its length, wandering sideways; its leaf blobs and (at depth 0) forks.
  const limb = (start, dir, elev, len, r0, depth) => {
    const side = normalize(cross(dir, UP));
    const wob = (r() - 0.5) * 0.16 * len, wob2 = r() * TAU;
    const path = arch(start, dir, elev, -(0.25 + 0.25 * r()), len, 7).map((p, i, all) => add(p, mul(side, wob * Math.sin(i / (all.length - 1) * Math.PI * 1.4 + wob2))));
    limbs.push({ path, r0, r1: depth === 0 ? 0.07 : 0.04 });
    if (depth === 0) {
      blob(add(along(path, 0.64).p, [0, 0.7, 0]), 2.4 + 0.6 * r(), 0.9 + 0.25 * r());
      const forks = 1 + (r() < 0.55 ? 1 : 0);
      for (let f = 0; f < forks; f++) {
        const t = 0.45 + 0.2 * f + 0.1 * r();
        const at = along(path, t);
        const turn = (f % 2 ? 1 : -1) * (0.5 + 0.35 * r());
        const forkDir = normalize(rotateAbout(dir, UP, turn));
        limb(at.p, forkDir, Math.max(elev, 0.4) + 0.12 * r(), len * (0.42 + 0.12 * r()), r0 * lerp(1, 0.07 / r0, Math.pow(t, 0.85)) * 0.8, 1);
      }
    }
    const tip = along(path, 1).p;
    blob(add(tip, [0, 0.8, 0]), depth === 0 ? 3.5 + 1.1 * r() : 2.5 + 0.8 * r(), 0.9 + 0.25 * r());
    if (depth === 0) for (const t of [0.5, 0.85]) anchors.push(add(along(path, t).p, [0, -0.1, 0]));
  };

  for (let k = 0; k < def.limbs; k++) {
    const u = (k + 0.25 + 0.5 * r()) / def.limbs;
    const y0 = H * lerp(0.46, 0.88, u);
    const az = k * GOLDEN + 0.6 * r();
    const dir = [Math.cos(az), 0, Math.sin(az)];
    const start = add(trunkAt(y0), mul(dir, -0.2));
    limb(start, dir, lerp(30, 52, u) * DEG + (r() - 0.5) * 0.15, H * lerp(0.36, 0.21, u) * (0.85 + 0.3 * r()), radiusAt(y0) * 0.62, 0);
  }
  // the top of the trunk: a broad dome
  const top = add(trunkAt(H), [0, 1.4, 0]);
  blob(top, 4.8 + 0.8 * r(), 1.0);
  // low clumps on the trunk under the limbs, so it is not bare from the ground to the first fork
  for (let c = 0; c < 3; c++) {
    const y = H * lerp(0.32, 0.5, r());
    blob(add(trunkAt(y), [(r() - 0.5) * 3, 0, (r() - 0.5) * 3]), 1.9 + 0.5 * r(), 0.8);
  }
  // Root fins (buttresses): thin sails of root standing on edge round the foot, tall at the trunk and sloping down to the ground a few metres out; and low snaking
  // surface roots between them.
  const fins = [], roots = [];
  const finPhase = (def.seed % 100) * 0.0628;
  const nFins = def.buttress.count;
  for (let k = 0; k < nFins; k++) {
    fins.push({ angle: finPhase + (k + (r() - 0.5) * 0.3) / nFins * TAU, length: R * (3.0 + 2.5 * r()), height: def.buttress.height * (0.9 + 0.45 * r()) * 0.65, thick: 0.8 + 0.4 * r(), bend: (r() - 0.5) * 0.6, curl: r() * TAU });
  }
  const nRoots = nFins + 3;
  for (let k = 0; k < nRoots; k++) {
    roots.push({ angle: finPhase + (k + 0.5 + (r() - 0.5) * 0.5) / nRoots * TAU + 0.2, length: R * (2.6 + 3.2 * r()), radius: R * (0.2 + 0.12 * r()), wander: 0.25 + 0.35 * r(), curl: r() * TAU });
  }
  const spec = { def, trunkAt, radiusAt, limbs, cards, anchors, fins, roots, finPhase, height: H, radius: R };
  specCache.set(name, spec);
  return spec;
}

// A fin's centre line and its oval section (half width across, half height up) at each of `n` stations out from the trunk. The section reaches from just under the ground
// up to the fin's top edge, which comes down from its full height at the trunk to the ground at its far end.
function finShape(spec, fin, n) {
  const R = spec.radius;
  const rho0 = R * 0.55, rho1 = R + fin.length, floor = -0.35;
  const path = [], radii = [];
  for (let i = 0; i < n; i++) {
    const rho = lerp(rho0, rho1, Math.pow(i / (n - 1), 0.9));
    const s = clamp01((rho - R * 0.9) / (rho1 - R * 0.9));
    const top = fin.height * Math.pow(1 - s, 2.6);
    // the root wanders a little sideways as it runs out, so a fin is not a flat board
    const angle = fin.angle + fin.bend * s * Math.sin(s * 2.4 + fin.curl);
    path.push([Math.cos(angle) * rho, (top + floor) / 2, Math.sin(angle) * rho]);
    radii.push([lerp(0.3, 0.07, s) * fin.thick * Math.max(1, spec.radius), Math.max((top - floor) / 2, 0.12)]);
  }
  return { path, radii };
}

// A surface root: a round tube winding out from the foot along the ground, sinking into it at the far end.
function rootShape(spec, root, n) {
  const R = spec.radius;
  const path = [], radii = [];
  for (let i = 0; i < n; i++) {
    const s = i / (n - 1);
    const rho = lerp(R * 0.6, R + root.length, s);
    const angle = root.angle + root.wander * 0.5 * Math.sin(s * 4.2 + root.curl) * s;
    path.push([Math.cos(angle) * rho, 0.42 * root.radius / 0.3 * Math.pow(1 - s, 1.4) - 0.04 - 0.2 * s, Math.sin(angle) * rho]);
    radii.push(root.radius * lerp(1, 0.28, Math.pow(s, 0.8)));
  }
  return { path, radii };
}

function ringHeights(lod, H) {
  if (lod === 0) {
    const ys = [-0.5, 0, 0.45, 1.0, 1.7, 2.6, 3.8, 5.2, 6.8];
    for (let y = 9; y < H - 1.5; y += 2.4) ys.push(y);
    ys.push(H);
    return ys;
  }
  if (lod === 1) return [-0.5, 0.3, 1.6, 3.6, ...[0.26, 0.42, 0.58, 0.74, 0.88, 1.0].map(k => k * H)].filter((y, i, a) => i === 0 || y > a[i - 1] + 1.0);
  return [-0.5, 1.2, 0.3 * H, 0.65 * H, H];
}

// The bark: dark for the twilight, mossy near the ground and in patches, a little lighter where the limbs fork.
function barkShade(H, seed) {
  return (t, y, a) => {
    const low = 1 - smoothstep(0.5, 4.5, y);
    const patch = 0.5 + 0.5 * Math.sin(a * 3 + y * 0.7 + seed) * Math.sin(y * 0.35 - a * 2 + seed * 2);
    const moss = clamp01(low * (0.55 + 0.45 * patch) + 0.18 * patch * (1 - smoothstep(4, H * 0.7, y)));
    const k = 0.58 + 0.12 * smoothstep(0, H, y);
    return [k * (1 - 0.35 * moss), k * (1 + 0.1 * moss), k * (1 - 0.4 * moss)];
  };
}

function buildJungleTree(lod, name) {
  const spec = treeSpec(name);
  const { def, trunkAt, radiusAt, limbs, cards } = spec;
  const H = spec.height;
  const m = new CardModel(name, 'canopy');
  // trunk
  const ys = ringHeights(lod, H);
  const trunkPath = ys.map(y => (y < 0 ? [trunkAt(0)[0], y, trunkAt(0)[2]] : trunkAt(y)));
  m.trunk(trunkPath, {
    radius: (t, i, p) => radiusAt(Math.max(p[1], 0)) * (p[1] < 0 ? 1.0 : 1),
    sides: [28, 14, 8][lod], repeats: 3,
    buttress: { count: def.buttress.count, reach: 0.5, height: def.buttress.height * 0.8, power: 2.0, phase: spec.finPhase, sharp: 2.0 },
    shade: barkShade(H, def.seed % 17),
  });
  // root fins and surface roots
  if (lod < 2) {
    for (const fin of spec.fins) {
      const shape = finShape(spec, fin, lod === 0 ? 8 : 4);
      m.trunk(shape.path, { radius: (t, i) => shape.radii[i], frameUp: UP, sides: lod === 0 ? 10 : 6, repeats: 2, shade: barkShade(H, 3) });
    }
  }
  if (lod === 0) {
    for (const root of spec.roots) {
      const shape = rootShape(spec, root, 7);
      m.trunk(shape.path, { radius: (t, i) => shape.radii[i], sides: 6, repeats: 2, shade: barkShade(H, 7) });
    }
  }
  // limbs
  if (lod < 2) {
    for (const limb of limbs) {
      const path = lod === 0 ? limb.path : [limb.path[0], limb.path[2], limb.path[4], limb.path[6]];
      m.trunk(path, { radius: t => lerp(limb.r0, limb.r1, Math.pow(t, 0.8)), sides: lod === 0 ? 7 : 4, repeats: 2, shade: barkShade(H, 5) });
    }
  }
  // canopy cards
  const keep = [1, 0.55, 0.26][lod], boost = [1, 1.36, 1.85][lod];
  for (const card of cards) {
    if (card.rank > keep) continue;
    const size = card.size * boost;
    const centre = card.centre;
    rosette(m, card.sprite, centre, card.normal, size, card.spin, {
      rows: lod === 0 ? 2 : 1, cols: lod === 0 ? 3 : 2, cup: lod === 0 ? 0.1 : 0,
      shade: (t, s, p) => {
        const height = clamp01((p[1] - H * 0.4) / (H * 0.7));
        const k = card.tone * (0.72 + 0.4 * height);
        return [k, k * 1.0, k * 0.94];
      },
      bias: { fn: p => { const d = sub(p, card.cluster); return normalize([d[0], 0.9 * Math.abs(d[1]) + 1.1, d[2]]); }, mix: 0.6 },
    });
  }
  return m;
}

// ------------------------------------------------------------------------------------------------------------------------------------ tree ferns
// A thin dark trunk a few metres high with a crown of long arching fronds, the mid layer between the ferns and the giants.
const TREE_FERNS = Object.freeze({
  treeFernA: Object.freeze({ seed: 4411, height: 3.4, fronds: 14, size: 1.0 }),
  treeFernB: Object.freeze({ seed: 5527, height: 4.6, fronds: 13, size: 1.12 }),
});

function buildTreeFern(lod, name) {
  const def = TREE_FERNS[name];
  const m = new CardModel(name, 'fern');
  const r = rng(def.seed);
  const lean = [(r() - 0.5) * 0.7, (r() - 0.5) * 0.7];
  const H = def.height;
  const rings = [5, 3, 2][lod] + 1;
  const trunkPath = [];
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    trunkPath.push([lean[0] * t * t, -0.15 + (H + 0.15) * t, lean[1] * t * t]);
  }
  m.trunk(trunkPath, { radius: t => lerp(0.11, 0.065, t), sides: [7, 5, 4][lod], repeats: 2, shade: (t, y) => { const k = 0.42 + 0.1 * t; return [k, k * 0.92, k * 0.8]; } });
  const top = trunkPath[trunkPath.length - 1];
  const count = [def.fronds, Math.round(def.fronds * 0.7), Math.round(def.fronds * 0.5)][lod];
  const rows = [8, 5, 3][lod];
  for (let f = 0; f < count; f++) {
    const rf = rng(def.seed + f * 37);
    const az = f * GOLDEN + (rf() - 0.5) * 0.3;
    const outer = Math.pow(rf(), 0.65);
    const len = def.size * (1.5 + 1.1 * rf()) * (0.8 + 0.35 * outer) * [1, 1.06, 1.12][lod];
    const elev = lerp(78, 22, outer) * DEG + (rf() - 0.5) * 0.15;
    const droop = lerp(30, 100, outer) * DEG;
    const dir = [Math.cos(az), 0, Math.sin(az)];
    const start = [top[0] + dir[0] * 0.06, top[1] + 0.02 * f / count, top[2] + dir[2] * 0.06];
    const path = arch(start, dir, elev, droop, len, rows + 1);
    const tone = 0.85 + 0.3 * rf();
    m.card(rf() < 0.7 ? 'sword' : 'lace', path, {
      width: len * 0.42 * [1, 1.15, 1.3][lod], across: [-Math.sin(az), 0, Math.cos(az)], roll: (rf() - 0.5) * 0.4, cols: lod === 0 ? 3 : 2, fold: 0.16,
      shade: () => [tone, tone, tone * 0.94],
      bias: { fn: p => [(p[0] - top[0]) * 0.5, 1.0, (p[2] - top[2]) * 0.5], mix: 0.35 },
    });
  }
  return m;
}

// ------------------------------------------------------------------------------------------------------------------------------------ bushes
// A leafy mass about as high as you: rosettes at every angle packed into a ball. Soft ball shading so it reads as one bush, not a pile of cards.
const BUSHES = Object.freeze({
  bushA: Object.freeze({ seed: 6101, sprites: ['broad', 'fan', 'broad', 'rusty'], size: 1.0, cards: 26, height: 1.25, radius: 0.85 }),
  bushB: Object.freeze({ seed: 7243, sprites: ['slender', 'fan', 'slender', 'broad'], size: 1.15, cards: 24, height: 1.5, radius: 0.95 }),
});

function buildBush(lod, name) {
  const def = BUSHES[name];
  const m = new CardModel(name, 'canopy');
  const total = def.cards;
  const keep = [1, 0.62, 0.38][lod], boost = [1, 1.25, 1.55][lod];
  const centre = [0, def.height * 0.5, 0];
  for (let c = 0; c < total; c++) {
    const r = rng(def.seed + c * 19);
    const rank = ((c + 1) * 0.6180339887) % 1;
    const az = c * GOLDEN, up = Math.pow(r(), 0.75);
    const ring = Math.sqrt(1 - up * up);
    const radial = def.radius * (0.25 + 0.75 * r());
    const pos = [Math.cos(az) * ring * radial, 0.2 + up * def.height * 0.95 + (r() - 0.5) * 0.2, Math.sin(az) * ring * radial];
    const size = def.size * (0.7 + 0.5 * r()) * boost;
    if (rank > keep) continue;
    const tone = 0.8 + 0.3 * r();
    const sprite = def.sprites[Math.floor(r() * def.sprites.length)];
    rosette(m, sprite, pos, cardNormal(r, 0.45, 55 * DEG), size, r() * TAU, {
      rows: lod === 2 ? 1 : 2, cols: lod === 0 ? 3 : 2, cup: lod === 0 ? 0.08 : 0,
      shade: (t, s, p) => { const k = tone * (0.55 + 0.45 * smoothstep(0, def.height, p[1])); return [k, k, k * 0.95]; },
      bias: { fn: p => sub(p, centre), mix: 0.55 },
    });
  }
  return m;
}

// ------------------------------------------------------------------------------------------------------------------------------------ the table
export const JUNGLE_MODELS = Object.freeze({
  jungleA: { build: lod => buildJungleTree(lod, 'jungleA'), share: false },
  jungleB: { build: lod => buildJungleTree(lod, 'jungleB'), share: false },
  jungleC: { build: lod => buildJungleTree(lod, 'jungleC'), share: false },
  treeFernA: { build: lod => buildTreeFern(lod, 'treeFernA'), share: false },
  treeFernB: { build: lod => buildTreeFern(lod, 'treeFernB'), share: false },
  bushA: { build: lod => buildBush(lod, 'bushA'), share: false },
  bushB: { build: lod => buildBush(lod, 'bushB'), share: false },
});
