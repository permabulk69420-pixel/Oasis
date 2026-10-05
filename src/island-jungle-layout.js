import { noise, clamp, smooth } from './world-math.js';
import { SKY_ISLAND, outlineRadius, topPaint } from './sky-island-shape.js';
import { mulberry32 } from './find-shapes.js';
import { treeSpec } from './island-jungle-models.js';

// How overgrown the island is, and where the undergrowth goes (Kane, 6 Oct: "it's meant to be like a dense island area to explore, it's not great if you follow paths and
// can see everything"). One field says how thick the growth is at every point; the grass, the ferns, the big-leaf plants and the shrubs all read it, so the thickets and the
// glades are the same places for all of them. Pure and seeded. The start meadow is a clearing (open lawn, nothing tall), thinning into jungle over a few tens of metres;
// the grove and the hollow are thickest; the rocky rise, the rim's lip and the lake's edge are thin; bare stone has nothing on it.
export const JUNGLE = Object.freeze({
  seed: 0x4a17c3,
  cell: 2.4,                                           // metres: one plant at most a cell, so spacing is 2.4 m at its thickest
  clearing: Object.freeze({ radius: 13, fade: 26 }),   // round the meadow's centre (where you start): open inside `radius`, full growth by radius + fade
  rimOpen: Object.freeze({ from: 2.5, to: 15 }),       // metres in from the lip: nothing at `from`, full by `to`
  slopeLimit: 1.1,
  scale: Object.freeze([0.75, 1.45]),
  // plants: [type, group, weight]; the groups (fern, broad, shrub) take turns being the common one over the island, so there are patches of each
  plants: Object.freeze([['fernA', 'fern', 1], ['fernB', 'fern', 1], ['broadleafA', 'broad', 1], ['broadleafB', 'broad', 1], ['bushA', 'shrub', 1], ['bushB', 'shrub', 1], ['treeFernA', 'tall', 1], ['treeFernB', 'tall', 1]]),
});

// The tall trees (src/island-jungle-models.js): a jittered grid of cells, at most one tree a cell, denser where the growth is thicker, none near the meadow's centre (it
// is a clearing: open inside `openRadius`, full density by `fullRadius`), none near the rim, the shore, the rocky rise or the hollow.
export const JUNGLE_TREES_LAYOUT = Object.freeze({
  seed: 0x2b6e91,
  cell: 11.5,
  openRadius: 30, fullRadius: 72,
  rimMargin: 16, shoreMargin: 9, channelMargin: 8, hollowMargin: 7, riseShare: 0.85,
  stands: Object.freeze({ size: 64, from: 0.36, to: 0.6, floor: 0.08 }),      // the share of cells with a tree is `floor` in the open and 1 in a stand
  slopeLimit: 0.22,
  minGap: 8.5,
  scale: Object.freeze([0.85, 1.3]),
  types: Object.freeze(['jungleA', 'jungleB', 'jungleC']),
  vines: Object.freeze({ chance: 0.85, strand: 3.0, longest: 16 }),     // a hanging curtain from a limb of most trees; `strand` is the model's average strand length, metres
});

function cellStream(ix, iz, seed) {
  let n = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2147483647);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n = Math.imul(n ^ (n >>> 16), 2246822519);
  return mulberry32((n ^ (n >>> 15)) >>> 0);
}

// ctx: { features (the island's places), config }. Returns the fields: thick(x, z) 0..1 how overgrown, cover(x, z) 0..1 how much grass grows, rimGap(x, z) metres in from the lip.
export function createJungleField(ctx, spec = JUNGLE) {
  const { features, config = SKY_ISLAND } = ctx;
  const { lake, places, channel } = features;
  const { meadow, grove, hollow, rise } = places;
  const paint = { grass: 1, stone: 0, gravel: 0, variation: 0 };
  const rimGap = (x, z) => outlineRadius(Math.atan2(z - config.z, x - config.x), config) - config.lip - Math.hypot(x - config.x, z - config.z);
  const channelDistance = (x, z) => {
    const dx = channel.bx - channel.ax, dz = channel.bz - channel.az;
    const t = clamp(((x - channel.ax) * dx + (z - channel.az) * dz) / (dx * dx + dz * dz), 0, 1);
    return Math.hypot(x - (channel.ax + dx * t), z - (channel.az + dz * t));
  };
  const clearingAt = (x, z) => smooth(spec.clearing.radius, spec.clearing.radius + spec.clearing.fade, Math.hypot(x - meadow.x, z - meadow.z));

  // What is under the growth: grass 0..1 (stone and gravel take it away), and whether the point is in or at the water or the spill channel.
  function bareness(x, z) {
    if (lake.signed(x, z) > -0.6 || channelDistance(x, z) < 2.4) return 1;
    topPaint(x, z, config, features, paint);
    return 1 - clamp(paint.grass - paint.stone * 0.5, 0, 1);
  }

  function thick(x, z) {
    const clear = clearingAt(x, z);
    if (clear <= 0) return 0;
    const n1 = noise(x / 64 + 11.3, z / 64 - 3.7), n2 = noise(x / 22 - 5.1, z / 22 + 9.2), n3 = noise(x / 8.5 + 2, z / 8.5 - 6);
    let d = 0.24 + 0.85 * n1 + 0.5 * (n2 - 0.5) + 0.25 * (n3 - 0.5);
    d += 0.38 * (1 - smooth(0, grove.radius * 1.7, Math.hypot(x - grove.x, z - grove.z)));
    d += 0.28 * (1 - smooth(0, hollow.radius * 2.4, Math.hypot(x - hollow.x, z - hollow.z)));
    d *= 1 - 0.5 * (1 - smooth(rise.radius * 0.35, rise.radius * 1.15, Math.hypot(x - rise.x, z - rise.z)));
    const rg = rimGap(x, z);
    d *= 0.2 + 0.8 * smooth(spec.rimOpen.from, spec.rimOpen.to, rg);
    const shore = -lake.signed(x, z);                       // metres from the water, outside it
    d *= 0.55 + 0.45 * smooth(1.5, 9, shore);
    d *= 1 - 0.95 * smooth(0.45, 0.95, bareness(x, z));
    return clamp(d * clear, 0, 1);
  }

  function cover(x, z) {
    const rg = rimGap(x, z);
    if (rg < 1.2) return 0;
    if (lake.signed(x, z) > -0.5 || channelDistance(x, z) < 2.0) return 0;
    topPaint(x, z, config, features, paint);
    return clamp(paint.grass - paint.stone * 0.6, 0, 1) * smooth(1.2, 4, rg);
  }
  const shore = (x, z) => -lake.signed(x, z);       // metres from the water, outside it (negative in it)
  return { thick, cover, rimGap, clearingAt, bareness, channelDistance, shore, features, config };
}

// The undergrowth: [{ type, x, y, z, yaw, scale, tint: [r, g, b] }], on the drawn ground. ctx: { ground, features, config, obstacles: [{ x, z, r }] }.
export function layoutUndergrowth(ctx, field = createJungleField(ctx), spec = JUNGLE) {
  const { ground, config = SKY_ISLAND, obstacles = [] } = ctx;
  const items = [];
  const grid = new Map();
  const cell = 8;
  for (const o of obstacles) {
    const k = `${Math.floor(o.x / cell)},${Math.floor(o.z / cell)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(o);
  }
  const blocked = (x, z, r) => {
    const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const o of grid.get(`${gx + a},${gz + b}`) || []) if (Math.hypot(o.x - x, o.z - z) < o.r + r) return true;
    return false;
  };
  const reach = config.radius * 1.3 + 20;
  const i0 = Math.floor((config.x - reach) / spec.cell), i1 = Math.floor((config.x + reach) / spec.cell);
  const j0 = Math.floor((config.z - reach) / spec.cell), j1 = Math.floor((config.z + reach) / spec.cell);
  const total = spec.plants.reduce((s, p) => s + p[2], 0);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const r = cellStream(i, j, spec.seed);
    const x = (i + 0.12 + 0.76 * r()) * spec.cell, z = (j + 0.12 + 0.76 * r()) * spec.cell;
    const roll = r(), pick = r(), yaw = r() * Math.PI * 2, sc = r(), tone = r(), warm = r();
    if (Math.hypot(x - config.x, z - config.z) > reach) continue;
    if (field.clearingAt(x, z) <= 0) continue;
    const g = ground(x, z);
    if (g === null || field.rimGap(x, z) < 2.5 || field.shore(x, z) < 0.25) continue;      // (thick() thins the growth at the water but does not stop it: nothing stands in the lake)
    const d = field.thick(x, z);
    if (roll > d * 0.95) continue;
    // which plant: the three groups take turns being the common one across the island
    const a = noise(x / 29 + 31, z / 29 - 17), b = noise(x / 29 - 9, z / 29 + 44), c = noise(x / 29 + 70, z / 29 + 12);
    const w = { fern: 0.12 + a * a * 1.7, broad: 0.12 + b * b * 1.7, shrub: 0.12 + c * c * 1.7, tall: 0.06 + 0.55 * d * noise(x / 40 + 5, z / 40 + 5) };
    let want = pick * (w.fern + w.broad + w.shrub + w.tall), group = 'tall';
    if (want < w.fern) group = 'fern'; else if (want < w.fern + w.broad) group = 'broad'; else if (want < w.fern + w.broad + w.shrub) group = 'shrub';
    const options = spec.plants.filter(p => p[1] === group);
    const type = options[Math.floor(tone * options.length) % options.length][0];
    const scale = spec.scale[0] + (spec.scale[1] - spec.scale[0]) * (0.35 * sc + 0.65 * Math.min(1, d + 0.2 * sc));
    if (blocked(x, z, (group === 'tall' ? 0.7 : 0.55) * scale)) continue;
    const slope = Math.max(Math.abs((ground(x + 1, z) ?? g) - (ground(x - 1, z) ?? g)), Math.abs((ground(x, z + 1) ?? g) - (ground(x, z - 1) ?? g))) / 2;
    if (slope > spec.slopeLimit) continue;
    const bright = 0.82 + 0.3 * tone;
    items.push({
      type, x, y: g - 0.03 * scale, z, yaw, scale,
      tint: [bright * (0.94 + 0.14 * warm), bright * (0.97 + 0.08 * (1 - warm)), bright * (0.9 + 0.2 * (1 - warm))],
    });
  }
  return items;
}

// The tall trees: [{ type, x, y, z, yaw, scale, tint }]. ctx: { ground, obstacles: [{ x, z, r }] } (what a tree keeps clear of, each with the radius a trunk and its roots need).
// Trees keep `minGap` metres from each other (their crowns overlap; their trunks do not).
export function layoutJungleTrees(ctx, field, spec = JUNGLE_TREES_LAYOUT) {
  const { ground, obstacles = [] } = ctx;
  const { config, features } = field;
  const { meadow, hollow, rise } = features.places;
  const items = [];
  const cell = 8, grid = new Map();
  for (const o of obstacles) {
    const k = `${Math.floor(o.x / cell)},${Math.floor(o.z / cell)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(o);
  }
  const blocked = (x, z, r) => {
    const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const o of grid.get(`${gx + a},${gz + b}`) || []) if (Math.hypot(o.x - x, o.z - z) < o.r + r) return true;
    return false;
  };
  const taken = new Map();
  const tooClose = (x, z) => {
    const gx = Math.floor(x / spec.minGap), gz = Math.floor(z / spec.minGap);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const t of taken.get(`${gx + a},${gz + b}`) || []) if (Math.hypot(t.x - x, t.z - z) < spec.minGap) return true;
    return false;
  };
  const reach = config.radius * 1.3 + 20;
  const i0 = Math.floor((config.x - reach) / spec.cell), i1 = Math.floor((config.x + reach) / spec.cell);
  const j0 = Math.floor((config.z - reach) / spec.cell), j1 = Math.floor((config.z + reach) / spec.cell);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const r = cellStream(i, j, spec.seed);
    const x = (i + 0.15 + 0.7 * r()) * spec.cell, z = (j + 0.15 + 0.7 * r()) * spec.cell;
    const roll = r(), pick = r(), yaw = r() * Math.PI * 2, sc = r(), tone = r();
    if (Math.hypot(x - config.x, z - config.z) > reach) continue;
    const clear = smooth(spec.openRadius, spec.fullRadius, Math.hypot(x - meadow.x, z - meadow.z));
    if (clear <= 0) continue;
    const g = ground(x, z);
    if (g === null || field.rimGap(x, z) < spec.rimMargin) continue;
    const d = field.thick(x, z);
    // groves and glades: a slow noise (a few tens of metres) puts the trees in stands with open ground between, so the island is not one even forest
    const stand = smooth(spec.stands.from, spec.stands.to, 0.65 * noise(x / spec.stands.size + 4.1, z / spec.stands.size - 9.3) + 0.35 * noise(x / (spec.stands.size * 0.38) - 2.2, z / (spec.stands.size * 0.38) + 6.6));
    if (roll > clear * (spec.stands.floor + (1 - spec.stands.floor) * stand) * clamp(0.35 + 1.1 * d, 0, 1)) continue;
    if (field.shore(x, z) < spec.shoreMargin || field.channelDistance(x, z) < spec.channelMargin || field.bareness(x, z) > 0.55) continue;
    if (Math.hypot(x - hollow.x, z - hollow.z) < hollow.radius + spec.hollowMargin || Math.hypot(x - rise.x, z - rise.z) < rise.radius * spec.riseShare) continue;
    const slope = Math.max(Math.abs((ground(x + 2, z) ?? g) - (ground(x - 2, z) ?? g)), Math.abs((ground(x, z + 2) ?? g) - (ground(x, z - 2) ?? g))) / 4;
    if (slope > spec.slopeLimit) continue;
    const scale = spec.scale[0] + (spec.scale[1] - spec.scale[0]) * sc;
    if (tooClose(x, z) || blocked(x, z, 2.2 * scale)) continue;
    // the tall kind where it is thickest, the short one in the thinner places
    // (the sum sits near the middle, so it is stretched about it: otherwise nearly every tree is the middle kind)
    const tallness = clamp(0.5 + 1.9 * (0.55 * d + 0.5 * noise(x / 55 + 3, z / 55 - 8) + 0.3 * (pick - 0.5) - 0.56), 0, 0.999);
    const type = spec.types[Math.floor(tallness * spec.types.length)];
    const item = { type, x, y: g - 0.25 * scale, z, yaw, scale, tint: [0.9 + 0.2 * tone, 0.95 + 0.1 * tone, 0.9 + 0.15 * (1 - tone)] };
    items.push(item);
    const k = `${Math.floor(x / spec.minGap)},${Math.floor(z / spec.minGap)}`;
    if (!taken.has(k)) taken.set(k, []);
    taken.get(k).push(item);
  }
  return items;
}

// A hanging curtain of leafy strands from a limb of most trees (the `vineCurtain` model hangs down from its origin): where the limb is, as far down as the ground. [{ type, x, y, z, yaw, scale: [x, y, z] }]
export function layoutTreeVines(trees, ground, spec = JUNGLE_TREES_LAYOUT) {
  const items = [];
  trees.forEach((tree, index) => {
    const r = cellStream(Math.round(tree.x * 7), Math.round(tree.z * 7), spec.seed ^ 0x55aa);
    if (r() > spec.vines.chance) return;
    const model = treeSpec(tree.type);
    const c = Math.cos(tree.yaw), s = Math.sin(tree.yaw);
    const picks = model.anchors.length ? [Math.floor(r() * model.anchors.length)] : [];
    if (model.anchors.length > 3 && r() < 0.5) picks.push((picks[0] + 2 + Math.floor(r() * (model.anchors.length - 3))) % model.anchors.length);
    for (const k of picks) {
      const a = model.anchors[k];
      const x = tree.x + (a[0] * c + a[2] * s) * tree.scale, z = tree.z + (-a[0] * s + a[2] * c) * tree.scale;
      const g = ground(x, z);
      const top = tree.y + a[1] * tree.scale;
      const down = Math.min(Math.max(top - (g ?? tree.y) - 1.5, 3), spec.vines.longest) / spec.vines.strand;      // as far down as the ground, or `longest` metres
      items.push({ type: 'vineCurtain', x, y: top, z, yaw: r() * Math.PI * 2, scale: [1.5 + r(), down * (0.75 + 0.3 * r()), 1.5 + r()], tint: [0.9, 0.95, 0.9] });
    }
  });
  return items;
}
