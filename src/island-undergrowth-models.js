import { rng, sub, normalize, lerp, smoothstep, rotateAbout } from './flora-kit.js';
import { CardModel, arch, LEAF_ATTACH } from './foliage-cards.js';
import { JUNGLE_MODELS } from './island-jungle-models.js';

// The island's undergrowth (Kane, 6 Oct: dense and Ark-like, real textures): giant ferns, big-leaf plants and hanging vines (and, from island-jungle-models.js, bushes, tree ferns and the tall trees), each a few dozen curved cards
// of leaf painted in tools/island-leaves (src/foliage-cards.js says how a card is built). Three levels of detail: the near one is a full plant, the coarser ones use
// fewer, wider cards (and are drawn instanced from further out, so a thicket of hundreds is a few draw calls). A plant's origin is its root on the ground, +y up;
// the layout turns, scales and tints each copy. Pure and seeded: the same plant grows the same every time, and every level grows the same leaves (each leaf has its
// own random stream, and a coarser level keeps the first few).

const DEG = Math.PI / 180;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

// Darker at the foot (the plants shade each other and the ground), full colour from about half a metre up.
const foot = (y, size) => 0.5 + 0.5 * smoothstep(0.0, 0.55 * size, y);

// ------------------------------------------------------------------------------------------------------------------------------------ giant ferns
// A clump of arching fronds from one crown: the inner ones stand up and are short, the outer ones lie out and droop. `sword` is the share that are the single-pinnate
// sword frond (the rest are the lacy double-cut one).
function buildFern(lod, { seed, sword = 0.6, size = 1, fronds = 14 }) {
  const m = new CardModel('fern', 'fern');
  const count = [fronds, Math.round(fronds * 0.65), Math.round(fronds * 0.45)][lod];
  const rows = [8, 5, 3][lod];
  for (let f = 0; f < count; f++) {
    const r = rng(seed + f * 31);
    const az = f * GOLDEN + (r() - 0.5) * 0.3;
    const outer = Math.pow(r(), 0.7);
    const len = size * (0.75 + 0.6 * r()) * (0.85 + 0.3 * outer) * [1, 1.08, 1.16][lod];
    const elev = lerp(80, 36, outer) * DEG + (r() - 0.5) * 0.15;
    const droop = lerp(35, 105, outer) * DEG;
    const dir = [Math.cos(az), 0, Math.sin(az)];
    const start = [dir[0] * (0.03 + 0.08 * outer), 0.04, dir[2] * (0.03 + 0.08 * outer)];
    const path = arch(start, dir, elev, droop, len, rows + 1);
    const sprite = r() < sword ? 'sword' : 'lace';
    const tone = 0.82 + 0.3 * r();
    const hue = [1.0, 1.0 + (r() - 0.5) * 0.12, 0.92 + 0.14 * r()];
    const roll = (r() - 0.5) * 0.5;
    m.card(sprite, path, {
      width: len * 0.42 * [1, 1.15, 1.3][lod],
      across: [-Math.sin(az), 0, Math.cos(az)],
      roll, cols: lod === 0 ? 3 : 2, fold: 0.18,
      shade: (t, s, p) => { const k = tone * foot(p[1], size); return [k * hue[0], k * hue[1], k * hue[2]]; },
      bias: { fn: p => [p[0] * 0.5, 1.0, p[2] * 0.5], mix: 0.35 },
    });
  }
  return m;
}

// ------------------------------------------------------------------------------------------------------------------------------------ big-leaf plants
// A rosette of big leaves on stalks: elephant ear, calathea, monstera, a torn banana leaf (each a sprite), their blades held out at about waist height and dropping
// at the tip. `kinds` picks which leaf sprites this plant wears.
const LEAF = Object.freeze({
  heart: { aspect: 0.92, size: 1.0 },
  calathea: { aspect: 0.56, size: 1.1 },
  monstera: { aspect: 0.94, size: 1.0 },
  paddle: { aspect: 0.50, size: 1.15 },
});

function buildBroadleaf(lod, { seed, kinds, size = 1, leaves = 12 }) {
  const m = new CardModel('broadleaf', 'broadleaf');
  const count = [leaves, Math.round(leaves * 0.75), Math.round(leaves * 0.5)][lod];
  const rows = [5, 4, 3][lod], cols = [5, 3, 2][lod];
  for (let l = 0; l < count; l++) {
    const r = rng(seed + l * 17);
    const az = l * GOLDEN + (r() - 0.5) * 0.25;
    const kind = kinds[Math.floor(r() * kinds.length)];
    const spec = LEAF[kind];
    const L = size * (0.65 + 0.5 * r()) * spec.size * [1, 1.06, 1.12][lod];
    const W = L * spec.aspect;
    const stemH = size * (0.32 + 0.6 * r());
    const reach = size * (0.12 + 0.4 * r());
    const dir = [Math.cos(az), 0, Math.sin(az)];
    const tone = 0.85 + 0.25 * r();
    const hue = [1.0, 1.0 + (r() - 0.5) * 0.1, 0.94 + 0.12 * r()];
    // the stalk: up from the root, curving out to where the blade joins
    const steps = lod === 0 ? 6 : 4;
    const stalk = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      stalk.push([dir[0] * reach * Math.pow(u, 2.2), stemH * (1 - Math.pow(1 - u, 2)), dir[2] * reach * Math.pow(u, 2.2)]);
    }
    if (lod < 2) m.stem(stalk, t => (0.026 - 0.011 * t) * Math.max(0.8, size), { sides: lod === 0 ? 4 : 3, shade: (t, s, p) => [foot(p[1], size) * 0.9, foot(p[1], size) * 0.9, foot(p[1], size) * 0.9] });
    const attach = stalk[stalk.length - 1];
    const e0 = (r() - 0.25) * 45 * DEG;
    const droop = (15 + 40 * r()) * DEG;
    const startBack = (LEAF_ATTACH[kind] ?? 0) * L;
    const start = [attach[0] - dir[0] * startBack, attach[1], attach[2] - dir[2] * startBack];
    const path = arch(start, dir, e0, droop, L, rows + 1);
    m.card(kind, path, {
      width: W, across: [-Math.sin(az), 0, Math.cos(az)], roll: (r() - 0.5) * 0.3, cols, cup: -0.16,
      shade: (t, s, p) => { const k = tone * foot(p[1], size) * (0.9 + 0.1 * t); return [k * hue[0], k * hue[1], k * hue[2]]; },
      bias: { fn: p => [p[0] * 0.3, 1.0, p[2] * 0.3], mix: 0.4 },
    });
  }
  return m;
}

// ------------------------------------------------------------------------------------------------------------------------------------ vine curtains
// A curtain of hanging leafy strands, hung from its origin down (the origin is where it is hung from, like the older `vines`): each strand a tall card, set in
// two crossing rows so it reads from every side. They sway through the hanging patch (the per-vertex `sway` weight is 0 at the top and 1 at the free end).
function buildVineCurtain(lod, { seed, strands = ['strandA', 'strandB', 'strandC', 'strandD'], size = 1, count = 8, span = 3.0 }) {
  const m = new CardModel('vine curtain', 'vine');
  const n = [count, Math.round(count * 0.7), Math.round(count * 0.5)][lod];
  const rows = [6, 4, 2][lod];
  for (let k = 0; k < n; k++) {
    const r = rng(seed + k * 29);
    const len = size * (2.3 + 1.3 * r());
    const x = ((k + 0.5) / n - 0.5) * span + (r() - 0.5) * 0.3;
    const z = (r() - 0.5) * 0.5;
    const yaw = (k % 2 ? 0.0 : 70 * DEG) + (r() - 0.5) * 0.4;
    const across = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const path = [];
    for (let i = 0; i <= rows; i++) {
      const u = i / rows;
      path.push([x + Math.sin(u * 4 + k) * 0.05 * u, -len * u, z + Math.cos(u * 3 + k * 2) * 0.05 * u]);
    }
    const sprite = strands[Math.floor(r() * strands.length)];
    const tone = 0.85 + 0.25 * r();
    m.card(sprite, path, {
      width: len * 0.30 * [1, 1.12, 1.25][lod], across, cols: 2,
      shade: () => [tone, tone, tone * 0.95],
      sway: t => Math.pow(t, 1.15),
      bias: { fn: () => [0, 1, 0], mix: 0.5 },
    });
  }
  return m;
}

// ------------------------------------------------------------------------------------------------------------------------------------ the table
export const UNDERGROWTH_MODELS = Object.freeze({
  fernA: { build: (lod) => buildFern(lod, { seed: 301, sword: 0.75, size: 1.25, fronds: 15 }), share: false },
  fernB: { build: (lod) => buildFern(lod, { seed: 733, sword: 0.30, size: 1.4, fronds: 14 }), share: false },
  broadleafA: { build: (lod) => buildBroadleaf(lod, { seed: 411, kinds: ['heart', 'calathea', 'heart'], size: 1.0, leaves: 12 }), share: false },
  broadleafB: { build: (lod) => buildBroadleaf(lod, { seed: 839, kinds: ['monstera', 'paddle', 'monstera'], size: 1.1, leaves: 11 }), share: false },
  vineCurtain: { build: (lod) => buildVineCurtain(lod, { seed: 617, count: 8 }), share: false },
  ...JUNGLE_MODELS,
});

const cache = new Map();

// The three finished levels of an undergrowth model (same shape as buildFloraLevels in island-flora-models.js: positions, normals, colors, emits, sways, uvs, indices,
// triangles, bounds, halos), cached.
export function buildFoliageLevels(name) {
  if (cache.has(name)) return cache.get(name);
  const spec = UNDERGROWTH_MODELS[name];
  if (!spec) throw new Error(`no undergrowth model called ${name}`);
  const levels = [0, 1, 2].map(lod => spec.build(lod).finish());
  cache.set(name, levels);
  return levels;
}
