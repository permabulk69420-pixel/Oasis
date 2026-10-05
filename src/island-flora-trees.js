import {
  Model, addTube, addRibbon, addLathe, addTrail, addBead, curve, along, rng, CYAN, PALE,
  add, sub, mul, cross, normalize, mix3, lerp, clamp01, smoothstep, rotateAbout, length,
} from './flora-kit.js';
import { TAU, DEG, lc, shade, glow, noise1, LEAF, LEAF_LIGHT, BARK, BARK_DARK, BARK_PALE, MOSS } from './island-flora-common.js';

// The weeping glow-tree and the hanging vines. Both hang things off a frame: the trunk and limbs stay put (a little give at the ends), the strands, leaves and
// pods carry a per-vertex `sway` weight (0 still .. 1 free) that the flora renderer's hang patch reads. Each is the hero tree's cousin: a dark body with cyan
// veins, the glow in hanging pods and beads. Random choices are made once, up front, so every level of detail is the same tree.

const POD = lc(0.018, 0.045, 0.062);

// how much a limb gives in the wind at fraction t along it: nothing at the trunk, a hand's breadth at the tip
const limbSway = t => 0.1 * t * t;

// ---------------------------------------------------------------------------------------------------------------------------------------- the weeping tree
let treeCache = null;
function treeSpec() {
  if (treeCache) return treeCache;
  const r = rng(9101);
  const trunkCtl = [[0, -0.45, 0], [0.12, 0.9, 0.06], [0.42, 2.3, -0.08], [0.32, 3.5, 0.16], [0.12, 4.5, 0.1]];
  const fork = trunkCtl[trunkCtl.length - 1];
  const limbs = [];
  for (let k = 0; k < 5; k++) {
    const az = (k / 5) * TAU + 0.35 + (r() - 0.5) * 0.55;
    const out = [Math.cos(az), 0, Math.sin(az)];
    const across = [-Math.sin(az), 0, Math.cos(az)];
    const reach = 0.86 + r() * 0.3, rise = 0.88 + r() * 0.36, swing = (r() - 0.5) * 1.0;
    const ctl = [[0, -0.35], [0.7, 0.9], [1.9, 1.9], [3.1, 2.3], [4.0, 1.8], [4.7, 0.85]].map(([o, u], i) => {
      const bend = Math.sin((i / 5) * Math.PI) * swing;
      return add(add(fork, mul(out, o * reach)), add(mul(across, bend), [0, u * rise, 0]));
    });
    limbs.push({ az, out, across, ctl, fine: curve(ctl, 4), sub: [], weightAt: t => limbSway(t) });
  }
  // two side limbs on each main one, bowing outward and drooping
  for (const limb of limbs) {
    [0.4, 0.66].forEach((t, j) => {
      const { p, T } = along(limb.fine, t + (r() - 0.5) * 0.06);
      const flat = normalize([T[0], 0, T[2]], limb.out);
      const dir = rotateAbout(flat, [0, 1, 0], (j ? -1 : 1) * (38 + r() * 26) * DEG);
      const L = 1.7 + r() * 0.9;
      const ctl = [p, add(add(p, mul(dir, L * 0.35)), [0, 0.36, 0]), add(add(p, mul(dir, L * 0.7)), [0, 0.34, 0]), add(add(p, mul(dir, L)), [0, -0.45, 0])];
      limb.sub.push({ dir, ctl, fine: curve(ctl, 3), t, weightAt: u => limbSway(t + (1 - t) * u) + 0.04 * u });
    });
  }
  // the strands that hang from the limbs and side limbs, then the pods on some of them
  const strands = [];
  const hang = (owner, ts) => {
    for (const t of ts) {
      const at = clamp01(t + (r() - 0.5) * 0.05);
      const { p } = along(owner.fine, at);
      const clear = 0.8 + r() * 2.3;
      const L = Math.max(0.9, p[1] - clear);
      strands.push({
        p, L, phase: r() * TAU, drift: 0.1 + r() * 0.2, w0: owner.weightAt(at),
        pod: r() < 0.46, podSize: 0.085 + r() * 0.05, beads: [0.32 + r() * 0.12, 0.62 + r() * 0.12].filter(() => r() < 0.6),
      });
    }
  };
  limbs.forEach(limb => {
    hang(limb, [0.4, 0.52, 0.62, 0.73, 0.84, 0.95]);
    limb.sub.forEach(s => hang(s, [0.55, 0.78, 0.97]));
  });
  // shuffled order, so the coarser levels keep an even spread (every second strand, and so on)
  for (let i = strands.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [strands[i], strands[j]] = [strands[j], strands[i]]; }
  // leaves: long thin willow leaves drooping from the limbs
  const leaves = [];
  const leafOn = (owner, count, t0, t1) => {
    for (let k = 0; k < count; k++) {
      const t = lerp(t0, t1, (k + r() * 0.8) / count);
      const { p, T } = along(owner.fine, t);
      const side = r() < 0.5 ? -1 : 1;
      const lateral = normalize(cross(T, [0, 1, 0]), [1, 0, 0]);
      const dir = normalize(add(add(mul(lateral, side), mul(T, 0.5 + r() * 0.4)), [0, -0.15 - r() * 0.3, 0]));
      leaves.push({ p, dir, L: 0.6 + r() * 0.6, w: 0.15 + r() * 0.1, w0: owner.weightAt(t), tone: 0.8 + r() * 0.5 });
    }
  };
  limbs.forEach(limb => { leafOn(limb, 26, 0.2, 1.0); limb.sub.forEach(s => leafOn(s, 13, 0.18, 1.0)); });
  treeCache = { trunkCtl, fork, limbs, strands, leaves };
  return treeCache;
}

function buildWeepingTree(lod, plan) {
  const spec = treeSpec();
  const m = new Model('weeping tree', { plan });
  const dens = [4, 2, 1][lod];
  // ---- the trunk, flared at the foot, with its bark ribs and three glowing veins
  const trunkPath = curve(spec.trunkCtl, dens);
  const trunkRadius = t => (0.60 - 0.27 * Math.pow(t, 0.7)) * (1 + 0.85 * Math.exp(-t * 8));
  const trunkShape = (t, a) => 1 + 0.07 * Math.sin(a * TAU * 5 + t * 2.4) + 0.05 * (noise1(a * 6, t * 8) - 0.5);
  const trunkOptions = {
    radius: (t, i) => trunkRadius(t), sides: [12, 8, 4][lod], capStart: 'none', capEnd: 'none', up: [1, 0, 0], shape: lod === 0 ? trunkShape : undefined,
    color: (t, a) => mix3(BARK_DARK, BARK, 0.5 + 0.5 * Math.sin(a * TAU * 3 + t * 5) * 0.8 + 0.2 * noise1(a * 5, t * 6)),
  };
  addTube(m, 'trunk', trunkPath, trunkOptions);
  if (lod === 0) {
    for (let v = 0; v < 3; v++) {
      const a0 = (v + 0.15) / 3;
      addTrail(m, `vein${v}`, trunkPath, {
        ...trunkOptions, width: t => 0.045 * (1 - 0.5 * t), lift: 0.02, angle: t => a0 + 0.045 * Math.sin(t * 9 + v * 2.1) + 0.02 * t,
        color: () => BARK_DARK, emit: t => glow(CYAN, 0.7 * (0.55 + 0.45 * Math.sin(t * 17 + v)) * (1 - 0.55 * t)),
      });
    }
  }
  // ---- the roots that flare out of the foot and go under the ground
  const rootCount = [5, 4, 0][lod];
  for (let k = 0; k < rootCount; k++) {
    const r = rng(9300 + k);
    const az = (k / rootCount) * TAU + 0.3 + (r() - 0.5) * 0.5;
    const out = [Math.cos(az), 0, Math.sin(az)];
    const R = 1.8 + r() * 1.0, wob = (r() - 0.5) * 0.5;
    const across = [-out[2], 0, out[0]];
    const ctl = [[0.35, 0.85], [0.8, 0.5], [R * 0.55, 0.17], [R, 0.0], [R + 0.5, -0.16]].map(([o, y], i) => add(add(mul(out, o), mul(across, wob * Math.sin((i / 4) * Math.PI))), [0, y, 0]));
    addTube(m, `root${k}`, curve(ctl, lod === 0 ? 3 : 1), {
      radius: t => 0.21 * Math.pow(1 - t, 0.9) + 0.03, sides: lod === 0 ? 6 : 4, capStart: 'none', capEnd: 'none', up: [0, 1, 0],
      color: (t, a) => mix3(BARK, BARK_DARK, t * 0.6),
    });
  }
  // ---- the limbs, with a vein along each and a little give at the ends
  const limbSides = [8, 5, 3][lod];
  const tipSway = (t, a, i) => limbSway(t);
  if (lod < 2) spec.limbs.forEach((limb, k) => {
    const path = lod === 2 ? limb.ctl.filter((_, i) => i % 2 === 0 || i === limb.ctl.length - 1) : curve(limb.ctl, dens);
    const o = {
      radius: t => 0.2 * (1 - 0.8 * Math.pow(t, 0.85)) + 0.025, sides: limbSides, capStart: 'none', capEnd: 'round', capRings: 1, up: [0, 1, 0],
      shape: lod === 0 ? (t, a) => 1 + 0.06 * Math.sin(a * TAU * 3 + t * 6 + k) : undefined,
      color: (t, a) => mix3(BARK, BARK_PALE, 0.2 * smoothstep(0.2, 1, t) + 0.15 * noise1(a * 5 + k, t * 4)), sway: tipSway,
    };
    addTube(m, `limb${k}`, path, o);
    if (lod === 0) {
      addTrail(m, `limbvein${k}`, path, {
        ...o, width: t => 0.032 * (1 - 0.6 * t), lift: 0.012, angle: t => 0.25 + 0.04 * Math.sin(t * 10 + k),
        color: () => BARK_DARK, emit: t => glow(CYAN, 0.55 * (0.6 + 0.4 * Math.sin(t * 21 + k * 1.7)) * (1 - t * 0.6)), sway: tipSway,
      });
    }
    if (lod < 2) {
      limb.sub.slice(0, lod === 0 ? 2 : 1).forEach((s, j) => {
        const sp = lod === 0 ? curve(s.ctl, 2) : s.ctl;
        addTube(m, `side${k}_${j}`, sp, {
          radius: t => 0.075 * (1 - 0.72 * t) + 0.018, sides: lod === 0 ? 5 : 3, capStart: 'none', capEnd: 'round', capRings: 1, up: [0, 1, 0],
          color: () => mix3(BARK, BARK_PALE, 0.25), sway: (t) => s.weightAt(t),
        });
      });
    }
  });
  // ---- leaves (level 0: every one; level 1: drapes; level 2: left to the skirt)
  if (lod === 0) {
    spec.leaves.forEach((l, k) => {
      const mid = add(add(l.p, mul(l.dir, l.L * 0.5)), [0, -0.04, 0]);
      const tip = add(add(l.p, mul(l.dir, l.L * 0.92)), [0, -l.L * 0.42, 0]);
      const out = add(l.p, mul(l.dir, 0.01));
      addRibbon(m, `leaf${k}`, [out, mid, tip], {
        width: (t, i) => [0.012, l.w, 0.01][i], side: cross(l.dir, [0, 1, 0]), fold: 0,
        color: t => mix3(shade(LEAF, l.tone), shade(LEAF_LIGHT, l.tone), t), sway: (t, s) => l.w0 + 0.3 * t,
      });
    });
  } else if (lod === 1) {
    spec.limbs.forEach((limb, k) => {
      for (let j = 0; j < 4; j++) {
        const t = 0.42 + j * 0.15;
        const { p, T } = along(limb.fine, t);
        const lateral = mul(normalize(cross(T, [0, 1, 0]), [1, 0, 0]), j % 2 ? -1 : 1);
        const path = [add(p, mul(lateral, 0.04)), add(add(p, mul(lateral, 0.45)), [0, -0.3, 0]), add(add(p, mul(lateral, 0.7)), [0, -1.0, 0]), add(add(p, mul(lateral, 0.75)), [0, -1.7, 0])];
        addRibbon(m, `drape${k}_${j}`, path, {
          width: (u, i) => [0.1, 0.55, 0.42, 0.08][i], side: T, fold: 0,
          color: u => mix3(shade(LEAF, 1.1), LEAF_LIGHT, u), sway: (u) => limbSway(t) + 0.3 * u,
        });
      }
    });
  }
  // ---- level 2: a bell of dark leaf that stands for the crown and the strands from far off
  if (lod === 2) {
    addLathe(m, 'crown', [[3.8, 1.7], [4.5, 2.5], [4.85, 3.5], [4.75, 4.7], [4.3, 5.8], [3.3, 6.8], [1.7, 7.5], [0.2, 7.8]], {
      sides: 10, color: (t, a) => mix3(shade(LEAF, 0.85), LEAF_LIGHT, 0.35 * (1 - t)), emit: t => glow(CYAN, 0.05 * (1 - t)), sway: t => 0.22 * (1 - t),
    });
  }
  // ---- the strands
  const strandCount = [spec.strands.length, 26, spec.strands.length][lod];
  const stride = lod === 1 ? Math.max(1, Math.floor(spec.strands.length / strandCount)) : 1;
  let podIndex = 0;
  for (let k = 0, used = 0; k < spec.strands.length && used < strandCount; k += stride, used++) {
    if (lod === 2 && podIndex >= 8) break;
    const s = spec.strands[k];
    if (lod === 2 && !s.pod) continue;
    const rows = [8, 4, 2][lod];
    const path = [];
    for (let i = 0; i < rows; i++) {
      const u = i / (rows - 1);
      path.push([s.p[0] + Math.sin(u * 4.2 + s.phase) * s.drift * u, s.p[1] - s.L * Math.pow(u, 0.96), s.p[2] + Math.cos(u * 3.4 + s.phase) * s.drift * u]);
    }
    const weight = u => s.w0 + (1 - s.w0) * Math.pow(u, 1.3);
    if (lod === 0) {
      addTube(m, `strand${k}`, path, {
        radius: u => 0.0135 - 0.004 * u, sides: 3, capStart: 'none', capEnd: s.pod ? 'none' : 'round', capRings: 1, up: [1, 0, 0],
        color: u => mix3(BARK_DARK, shade(BARK, 1.4), u), emit: u => glow(CYAN, 0.22 * Math.pow(u, 2.5)), sway: u => weight(u),
      });
    } else if (lod === 1) {
      addRibbon(m, `strand${k}`, path, { width: 0.05, side: [1, 0, 0], color: () => BARK_DARK, emit: u => glow(CYAN, 0.18 * u * u), sway: (u) => weight(u) });
    }
    const tip = path[path.length - 1];
    if (s.pod) {
      const R = s.podSize * (lod === 2 ? 1.7 : 1);
      const profile = [[0, 0], [R * 0.2, R * 0.2], [R * 0.82, R * 0.9], [R, R * 1.7], [R * 0.6, R * 2.6], [0, R * 3.0]];
      const rings = lod === 0 ? profile : lod === 1 ? [profile[0], profile[2], profile[3], profile[5]] : [profile[0], profile[3], profile[5]];
      addLathe(m, `pod${k}`, rings, {
        origin: [tip[0], tip[1] + R * 0.05, tip[2]], axis: [0, -1, 0], sides: [6, 4, 4][lod], color: () => POD,
        emit: t => glow(CYAN, 0.3 + 0.5 * smoothstep(0.1, 0.55, t) - 0.2 * smoothstep(0.85, 1, t)), sway: () => 1,
      });
      if (lod < 2 && podIndex % 2 === 0) m.halo([tip[0], tip[1] - R * 1.5, tip[2]], 0.9, 'cyan');
      podIndex++;
    }
    if (lod === 0) {
      s.beads.forEach((u, j) => {
        const at = path[Math.round(u * (rows - 1))];
        addBead(m, `bead${k}_${j}`, at, 0.026, { emit: CYAN, brightness: 0.8, sides: 4, rings: 1, color: BARK_DARK });
      });
    }
  }
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------------------------- vine curtains
// A hanging curtain of vines about three metres wide: a gnarled lip of root along the top (where it grips the stone or the earth) and a dozen vines of different
// lengths, each with small dark leaves in alternation and a few cyan beads, ending in a bead that glows. The origin is the middle of the lip; the vines hang to about
// four metres. `scale` in the layout makes them longer for the rim.
let vineCache = null;
function vineSpec() {
  if (vineCache) return vineCache;
  const r = rng(9701);
  const vines = [];
  const count = 12;
  for (let k = 0; k < count; k++) {
    const x = ((k + 0.5) / count - 0.5) * 3.1 + (r() - 0.5) * 0.12;
    const L = 1.5 + r() * 2.7 - 0.9 * Math.abs(x) / 1.55;
    const leafCount = Math.max(3, Math.round(L * 3.2));
    vines.push({
      x, L: Math.max(1.2, L), phase: r() * TAU, drift: 0.05 + r() * 0.08, z: (r() - 0.5) * 0.12,
      leaves: Array.from({ length: leafCount }, (_, i) => ({ u: (i + 0.5 + (r() - 0.5) * 0.5) / leafCount, side: i % 2 ? 1 : -1, size: 0.09 + r() * 0.05, tone: 0.8 + r() * 0.5 })),
      beads: [0.38 + r() * 0.1, 0.7 + r() * 0.1].filter(() => r() < 0.5),
      tipSize: 0.03 + r() * 0.015,
    });
  }
  vineCache = { vines, lip: [[-1.75, 0.08, 0.0], [-0.9, -0.06, 0.04], [0.1, 0.0, -0.03], [1.0, -0.07, 0.02], [1.8, 0.1, 0.0]] };
  return vineCache;
}

function buildVines(lod, plan) {
  const spec = vineSpec();
  const m = new Model('vines', { plan });
  const lip = curve(spec.lip, [3, 1, 1][lod]);
  addTube(m, 'lip', lip, {
    radius: t => 0.075 + 0.03 * Math.sin(t * 9) + 0.02 * (noise1(t * 7, 3) - 0.5), sides: [6, 4, 3][lod], capStart: 'round', capEnd: 'round', capRings: 1, up: [0, 1, 0],
    color: (t, a) => mix3(BARK_DARK, shade(MOSS, 0.9), 0.4 + 0.4 * noise1(t * 11, a * 4)),
  });
  const take = [spec.vines.length, 8, 5][lod];
  const stride = Math.max(1, Math.floor(spec.vines.length / take));
  let used = 0;
  for (let k = 0; k < spec.vines.length && used < take; k += stride, used++) {
    const v = spec.vines[k];
    const rows = [9, 5, 3][lod];
    const path = [];
    for (let i = 0; i < rows; i++) {
      const u = i / (rows - 1);
      path.push([v.x + Math.sin(u * 3.6 + v.phase) * v.drift * u, -v.L * Math.pow(u, 0.97), v.z + Math.cos(u * 2.9 + v.phase) * v.drift * u]);
    }
    const weight = u => 0.12 + 0.88 * Math.pow(u, 1.25);
    if (lod === 0) {
      addTube(m, `vine${k}`, path, {
        radius: u => 0.016 - 0.007 * u, sides: 3, capStart: 'none', capEnd: 'none', up: [0, 0, 1],
        color: u => mix3(BARK_DARK, shade(MOSS, 0.7), 0.3 + 0.5 * u), sway: weight,
      });
      v.leaves.forEach((leaf, j) => {
        const p = along(path, leaf.u).p;
        const out = [leaf.side * 0.7, -0.25, 0.25 * leaf.side];
        const dir = normalize(out);
        const tipL = add(p, mul(dir, leaf.size * 1.8));
        addRibbon(m, `leaf${k}_${j}`, [add(p, mul(dir, 0.004)), add(add(p, mul(dir, leaf.size)), [0, -0.01, 0]), tipL], {
          width: (u, i) => [0.006, leaf.size * 1.05, 0.006][i], side: cross(dir, [0, 0, 1]), fold: 0,
          color: u => mix3(shade(LEAF, leaf.tone), shade(LEAF_LIGHT, leaf.tone), u), sway: () => weight(leaf.u) + 0.05,
        });
      });
      v.beads.forEach((u, j) => addBead(m, `bead${k}_${j}`, along(path, u).p, 0.022, { emit: CYAN, brightness: 0.75, sides: 4, rings: 1, color: BARK_DARK, halo: 0 }));
      const tip = path[path.length - 1];
      addBead(m, `tip${k}`, [tip[0], tip[1] - v.tipSize * 0.6, tip[2]], v.tipSize, { emit: CYAN, brightness: 1.15, sides: 5, rings: 1, color: BARK_DARK });
      if (k % 4 === 0) m.halo([tip[0], tip[1], tip[2]], 0.45, 'cyan');
    } else if (lod === 1) {
      addRibbon(m, `vine${k}`, path, {
        width: u => 0.2 * (1 - 0.35 * u), side: [1, 0, 0], fold: 0, cols: 2,
        color: u => mix3(BARK_DARK, shade(LEAF, 1.2), 0.35 + 0.5 * u), sway: weight,
      });
      const tip = path[path.length - 1];
      addBead(m, `tip${k}`, [tip[0], tip[1] - v.tipSize * 0.6, tip[2]], v.tipSize * 1.3, { emit: CYAN, brightness: 1.1, sides: 4, rings: 1, color: BARK_DARK });
      if (k % 4 === 0) m.halo([tip[0], tip[1], tip[2]], 0.45, 'cyan');
    } else {
      addRibbon(m, `vine${k}`, path, { width: u => 0.3 * (1 - 0.3 * u), side: [1, 0, 0], fold: 0, color: u => mix3(BARK_DARK, shade(LEAF, 1.2), 0.5), sway: weight });
    }
  }
  return m;
}

export const TREE_MODELS = {
  weepingTree: { build: buildWeepingTree, share: false },
  vines: { build: buildVines, share: false },
};
