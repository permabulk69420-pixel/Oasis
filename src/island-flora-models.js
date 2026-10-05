import {
  Model, addTube, addRibbon, addLathe, addBead, bulbProfile, curve, resample, rng, CYAN, PALE,
  add, sub, mul, dot, cross, normalize, mix3, lerp, clamp01, smoothstep, rotateAbout, length,
} from './flora-kit.js';
import {
  TAU, DEG, lc, shade, glow, noise1, MOSS, MOSS_LIGHT, FERN, FERN_LIGHT, LEAF, BARK, BARK_DARK, WOOD_CUT, BLEACHED, BLEACHED_DARK, STALK, PETAL, CAP, STEM,
} from './island-flora-common.js';
import { TREE_MODELS } from './island-flora-trees.js';
import { RUIN_MODELS } from './island-flora-ruins.js';

// The island's new plants and landmarks (Kane, 5 Oct: it is the player's home base, so it needs more than palms and the oasis's glow plants). They keep the
// oasis's look: dark forms, the glow in cyan (and a paler white-cyan for the big night flowers). Every model is built here from the shapes in flora-kit.js, in three
// levels of detail, each with its own packed UV atlas at one texel density (no textures yet: colour is per vertex, so the later PBR pass has clean UVs to paint on).
// A model's origin is at its root on the ground (a hanging one: where it hangs from), +y up, about a metre to a few metres across; the layout turns, scales and places it.
// This file holds the small ground plants and the fallen wood; the trees and vines are in island-flora-trees.js, the landmarks in island-flora-ruins.js. All pure and seeded.

// ---------------------------------------------------------------------------------------------------------------------------------------- ferns
// A clump of arching fronds (the grove's floor). Each frond is a thin rachis with pairs of narrow leaflets (level 0), a serrated single blade (level 1) or a few
// plain blades (level 2). Two unfurling fiddleheads in the middle carry a small cyan bead, the clump's only glow.
function buildFern(lod, plan) {
  const m = new Model('fern', { plan });
  const fronds = [11, 9, 5][lod];
  const steps = [9, 9, 4][lod];
  for (let f = 0; f < fronds; f++) {
    const r = rng(1000 + f * 7 + (lod === 2 ? 3 : 0));     // each frond has its own stream, so every level of detail grows the same fronds
    const az = (f / fronds) * TAU + (r() - 0.5) * 0.55;
    const radial = [Math.cos(az), 0, Math.sin(az)];
    const across = [-Math.sin(az), 0, Math.cos(az)];
    const len = 0.85 + r() * 0.6;
    const lean = (22 + r() * 30) * DEG;
    const bend = (70 + r() * 50) * DEG;
    const tone = 0.8 + r() * 0.4;
    const path = [];
    let px = 0.03 + r() * 0.04, py = 0;
    for (let i = 0; i < steps; i++) {
      const s = i / (steps - 1);
      path.push([radial[0] * px, py, radial[2] * px]);
      const ang = lean + bend * s * s;
      px += Math.sin(ang) * len / (steps - 1);
      py += Math.cos(ang) * len / (steps - 1);
    }
    const tangent = i => normalize(sub(path[Math.min(i + 1, steps - 1)], path[Math.max(i - 1, 0)]));
    const frondColour = (t, s) => mix3(shade(FERN, tone), shade(FERN_LIGHT, tone), clamp01(t * 0.9 + (1 - Math.abs(s - 0.5) * 2) * 0.1));
    if (lod === 0) {
      addRibbon(m, `rachis${f}`, path, { width: t => 0.02 * (1 - t * 0.6), side: across, color: t => shade(FERN, tone * (0.8 + 0.3 * t)) });
      const pairs = 12;
      for (let k = 0; k < pairs; k++) {
        const s = 0.16 + 0.8 * (k / (pairs - 1));
        const idx = Math.min(steps - 1, s * (steps - 1));
        const i0 = Math.floor(idx), fr = idx - i0;
        const a = mix3(path[i0], path[Math.min(i0 + 1, steps - 1)], fr);
        const T = tangent(Math.round(idx));
        const nf = normalize(cross(across, T));
        const reach = (0.05 + 0.2 * Math.pow(1 - s, 0.8)) * (0.85 + 0.3 * noise1(f * 3.1 + k, 2.2));
        for (const sign of [-1, 1]) {
          const out = add(mul(across, sign), [0, -0.12, 0]);
          const dir = normalize(add(mul(out, Math.cos(52 * DEG)), mul(T, Math.sin(52 * DEG))));
          const tip = add(a, mul(dir, reach));
          const mid = add(add(a, mul(dir, reach * 0.5)), mul(nf, 0.012));
          addRibbon(m, `p${f}_${k}_${sign}`, [a, mid, tip], {
            width: t => reach * 0.26 * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.05)) + 0.004, side: cross(dir, nf),
            color: t => mix3(shade(FERN, tone * 0.9), shade(FERN_LIGHT, tone), t),
          });
        }
      }
    } else if (lod === 1) {
      addRibbon(m, `frond${f}`, path, {
        width: (t, i) => (0.06 + 0.3 * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)) * Math.pow(1 - t, 0.25)) * (i % 2 ? 0.62 : 1),
        side: across, color: frondColour,
      });
    } else {
      addRibbon(m, `frond${f}`, path, { width: t => 0.04 + 0.22 * Math.sin(Math.PI * Math.min(1, 0.1 + t)), side: across, color: frondColour });
    }
  }
  // the fiddleheads
  if (lod < 2) {
    for (let k = 0; k < 2; k++) {
      const r = rng(5000 + k);
      const az = r() * TAU, off = 0.07 + r() * 0.05, h = 0.28 + r() * 0.12;
      const base = [Math.cos(az) * off, 0, Math.sin(az) * off];
      const out = [Math.cos(az), 0, Math.sin(az)];
      const rho = 0.045;
      const pts = [];
      const curl = lod === 0 ? 9 : 4;
      for (let i = 0; i < curl; i++) {
        const q = i / (curl - 1);
        const stem = 0.55;
        if (q < stem) pts.push(add(base, [0, h * (q / stem), 0]));
        else {
          const ang = ((q - stem) / (1 - stem)) * 250 * DEG;
          pts.push(add(add(base, [0, h, 0]), add(mul(out, rho * Math.sin(ang)), [0, rho * (1 - Math.cos(ang)), 0])));
        }
      }
      if (lod === 0) addTube(m, `fiddle${k}`, pts, { radius: t => 0.011 * (1 - 0.45 * t), sides: 4, color: () => FERN_LIGHT });
      const tip = pts[pts.length - 1];
      addBead(m, `fiddlebead${k}`, tip, lod === 0 ? 0.02 : 0.026, { emit: CYAN, halo: 0.2, brightness: 1.15, sides: lod === 0 ? 5 : 4 });
    }
  }
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------------------------- cushions
// A low lumpy dome of moss, half a metre across: it sits on a stone or on the ground. A few pale spore dots glow very faintly on the top.
function buildCushion(lod, plan) {
  const m = new Model('cushion', { plan });
  const r = rng(23);
  const sides = [16, 10, 6][lod], rings = [5, 3, 2][lod];
  const bumps = Array.from({ length: 8 }, () => ({ a: r(), t: 0.1 + r() * 0.75, w: 0.09 + r() * 0.08, k: 0.035 + r() * 0.05 }));
  const profile = bulbProfile(0.5, 0.3, rings);
  profile.unshift([0.53, -0.07]);
  const lump = (a, t) => {
    let sum = 0;
    for (const b of bumps) {
      const da = Math.min(Math.abs(a - b.a), 1 - Math.abs(a - b.a)) * 2.2, dt = (t - b.t);
      sum += b.k * Math.exp(-(da * da + dt * dt) / (b.w * b.w));
    }
    return sum;
  };
  addLathe(m, 'moss', profile, {
    sides, lift: (a, t) => lump(a, t) * smoothstep(0.05, 0.4, t) * (1 - smoothstep(0.82, 1, t)),
    radial: (a, t) => 1 + (noise1(a * 5, t * 4) - 0.5) * 0.14,
    color: (t, a) => mix3(shade(MOSS, 0.75 + 0.5 * noise1(a * 9, t * 6)), MOSS_LIGHT, smoothstep(0.25, 0.95, t) * (0.7 + 0.5 * noise1(a * 7 + 3, t * 5))),
  });
  if (lod === 0) {
    for (let k = 0; k < 6; k++) {
      const a = r() * TAU, t = 0.5 + r() * 0.4;
      const phi = t * (Math.PI / 2);
      const rr = 0.5 * Math.cos(phi) * 1.02, hh = 0.3 * Math.sin(phi) * 1.02 + 0.012;
      addBead(m, `spore${k}`, [Math.cos(a) * rr, hh, Math.sin(a) * rr], 0.012, { emit: PALE, brightness: 0.55, sides: 4, rings: 1, color: MOSS_LIGHT });
    }
  }
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------------------------- mushrooms
// A cluster of little glowing mushrooms, a hand across: dark caps whose gills glow cyan. Level 1: three plain ones. Level 2: one soft glowing disc.
function buildMushrooms(lod, plan) {
  const m = new Model('mushrooms', { plan });
  const r = rng(31);
  const count = [5, 3, 1][lod];
  const place = [[0, 0], [0.085, 0.03], [-0.06, 0.075], [0.03, -0.085], [-0.09, -0.04]];
  for (let k = 0; k < count; k++) {
    const R = (k === 0 ? 0.062 : 0.03 + r() * 0.03) * (lod === 2 ? 1.4 : 1);
    const H = R * (1.5 + r() * 0.9);
    const lean = (r() - 0.5) * 0.5;
    const base = [place[k][0], 0, place[k][1]];
    const top = add(base, [lean * H * 0.4, H, lean * H * 0.3]);
    if (lod < 2) {
      addTube(m, `stem${k}`, [base, mix3(base, top, 0.5), top], {
        radius: t => R * (0.2 - 0.04 * t), sides: lod === 0 ? 5 : 4, capStart: 'none', capEnd: 'none', color: () => STEM,
      });
    }
    const sides = lod === 0 ? 7 : lod === 1 ? 5 : 6;
    const profile = lod === 2
      ? [[0, 0], [R, 0.04 * R], [0, 0.04 * R]]
      : [[0, 0], [R * 0.82, 0.015 * R], [R, 0.10 * R], [R * 0.78, 0.46 * R], [R * 0.38, 0.72 * R], [0, 0.8 * R]].filter((_, i) => lod === 0 || i % 2 === 0 || i === 5);
    const tilt = [lean * 0.35, 1, lean * 0.25];
    addLathe(m, `cap${k}`, profile, {
      origin: top, axis: normalize(tilt), sides,
      color: t => mix3(CAP, shade(CAP, 1.7), smoothstep(0.35, 1, t)),
      emit: t => (lod === 2 ? glow(CYAN, 0.9) : glow(CYAN, t < 0.34 ? 1.25 : 0.2 * (1 - t) + 0.05)),
    });
    if (k === 0) m.halo(add(top, [0, R * 0.2, 0]), 0.3 + R * 2, 'cyan');
  }
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------------------------- night flowers
// A big pale flower on a long nodding stalk, the kind that opens at night: a cup of eight broad petals glowing white-cyan from the heart, a few stamens tipped with
// cyan beads, and two or three broad dark leaves at the foot. Level 1 has fewer, plainer petals; level 2 is a few cards.
function buildFlower(lod, plan) {
  const m = new Model('flower', { plan });
  const r = rng(41);
  const stalkPath = lod === 2 ? [[0, 0, 0], [0.09, 0.82, 0.02], [0.40, 1.27, 0.03]] : curve([[0, 0, 0], [0.03, 0.4, 0.01], [0.09, 0.82, 0.02], [0.22, 1.14, 0.03], [0.40, 1.27, 0.03]], lod === 0 ? 4 : 2);
  addTube(m, 'stalk', stalkPath, { radius: t => 0.016 - 0.006 * t, sides: [5, 4, 3][lod], capStart: 'none', capEnd: lod === 2 ? 'none' : 'round', color: t => mix3(STALK, shade(STALK, 1.6), t) });
  const end = stalkPath[stalkPath.length - 1];
  const axis = normalize([0.5, 0.85, 0.05]);
  const e1 = normalize(cross(axis, [0, 0, 1])), e2 = cross(axis, e1);
  const petals = [8, 5, 3][lod];
  const ring = (count, scale, phase, name) => {
    for (let k = 0; k < count; k++) {
      const a = phase + (k / count) * TAU + (r() - 0.5) * 0.1;
      const dir = add(mul(e1, Math.cos(a)), mul(e2, Math.sin(a)));
      const pts = [[0.02, 0.0], [0.11, 0.07], [0.19, 0.18], [0.23, 0.31]].map(([rr, hh]) => add(add(end, mul(axis, hh * scale)), mul(dir, rr * scale)));
      const steps = lod === 0 ? pts : lod === 1 ? [pts[0], pts[2], pts[3]] : [pts[0], pts[3]];
      addRibbon(m, `${name}${k}`, steps, {
        width: (t, i) => [[0.05, 0.14, 0.16, 0.05], [0.05, 0.16, 0.05], [0.12, 0.1]][lod][i] * scale, side: cross(dir, axis), fold: lod === 0 ? 0.35 : 0,
        color: t => mix3(shade(PETAL, 0.85), PETAL, t),
        emit: (t, s) => glow(PALE, lerp(0.95, 0.1, Math.pow(t, 0.8)) * (1 - 0.4 * Math.abs(s - 0.5) * 2)),
      });
    }
  };
  ring(petals, 1, 0, 'petal');
  if (lod === 0) ring(5, 0.62, 0.3, 'inner');
  m.halo(add(end, mul(axis, 0.12)), 0.75, 'pale');
  if (lod === 0) {
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + r() * 0.4;
      const dir = add(mul(e1, Math.cos(a) * 0.04), mul(e2, Math.sin(a) * 0.04));
      const tip = add(add(end, mul(axis, 0.16 + r() * 0.05)), dir);
      addTube(m, `stamen${k}`, [add(end, mul(axis, 0.02)), tip], { radius: 0.004, sides: 3, color: () => PETAL, capEnd: 'none', capStart: 'none' });
      addBead(m, `anther${k}`, tip, 0.012, { emit: CYAN, brightness: 1.2, sides: 4, rings: 1 });
    }
  }
  // leaves
  const leaves = lod === 0 ? 3 : 2;
  const rl = rng(4141);
  for (let k = 0; k < leaves; k++) {
    const a = (k / leaves) * TAU + 0.5 + rl() * 0.4;
    const out = [Math.cos(a), 0, Math.sin(a)];
    const L = 0.55 + rl() * 0.25;
    const pts = [0, 1, 2, 3].slice(0, lod === 2 ? 2 : 4).map((i, _, all) => {
      const s = i / (lod === 2 ? 1 : 3);
      return add([out[0] * 0.04, 0.03, out[2] * 0.04], add(mul(out, L * s * 0.9), [0, L * (0.55 * s - 0.5 * s * s), 0]));
    });
    addRibbon(m, `leaf${k}`, pts, {
      width: t => 0.2 * Math.sin(Math.PI * (0.1 + 0.85 * t)) + 0.01, side: cross(out, [0, 1, 0]), fold: lod === 0 ? 0.3 : 0,
      color: t => mix3(shade(LEAF, 0.8), shade(LEAF, 1.5), t),
    });
  }
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------------------------- fallen logs
// A fallen palm trunk lying along x, four and a half metres, banded like the living palms, one end snapped to a pale ragged cut, a couple of branch stubs, and
// stacks of glowing bracket fungus up its flank (`shelves`: the grove's fungus logs; the plain log has none). Every random choice is made once, up front, so each
// level of detail is the same log.
function buildLog(lod, plan, { shelves = true, seed = 53 } = {}) {
  const m = new Model(shelves ? 'fungus log' : 'log', { plan });
  const r = rng(seed);
  const rings = [14, 8, 4][lod], sides = [10, 7, 5][lod];
  const half = 2.25;
  const centreAt = t => [-half + t * 2 * half, 0.27 + 0.012 * Math.sin(t * 5) + 0.03 * Math.sin(t * 2.2), 0.07 * Math.sin(t * 3.2 + 1)];
  const radiusAt = t => 0.255 + 0.04 * Math.sin(t * Math.PI) - 0.03 * t;
  const stubs = [0, 1].map(k => ({ t: 0.25 + 0.35 * k + r() * 0.1, a: (0.1 + 0.5 * r()) * Math.PI * (k ? 1 : -1) * 0.5, lean: r() * 0.3 - 0.1 }));
  const stacks = Array.from({ length: 5 }, (_, k) => {
    const t = 0.12 + 0.76 * ((k + r() * 0.5) / 5);
    const alpha = (55 + r() * 40) * DEG;
    const count = 2 + Math.floor(r() * 2);
    const shelf = Array.from({ length: count }, (_, j) => ({ R: (0.09 + r() * 0.12) * (1 - j * 0.22), dx: (r() - 0.5) * 0.06 }));
    return { t, alpha, side: k % 2 ? 1 : -1, shelf };
  });
  const raw = Array.from({ length: rings }, (_, i) => centreAt(i / (rings - 1)));
  addTube(m, 'trunk', raw, {
    radius: t => radiusAt(t), sides, capStart: 'round', capEnd: 'flat', capRings: 1, up: [0, 1, 0],
    shape: (t, a) => 1 + 0.05 * Math.sin(a * TAU * 6 + t * 3) + 0.035 * (noise1(a * 6, t * 9) - 0.5),
    capColor: WOOD_CUT,
    color: (t, a) => {
      const band = 0.5 + 0.5 * Math.sin(t * 2 * half * 9.5);
      const down = 1 - Math.abs(2 * a - 1);                       // 1 at the underside, 0 on top
      return shade(mix3(BARK_DARK, BARK, band), 1 - 0.5 * smoothstep(0.4, 0.9, down));
    },
  });
  if (lod < 2) {
    stubs.forEach((stub, k) => {
      const x = -half + stub.t * 2 * half;
      const dir = normalize([stub.lean, Math.cos(stub.a), Math.sin(stub.a)]);
      const start = add([x, centreAt(stub.t)[1], centreAt(stub.t)[2]], mul(dir, 0.2));
      addTube(m, `stub${k}`, [start, add(start, mul(dir, 0.3)), add(start, mul(dir, 0.55))], { radius: t2 => 0.075 - 0.03 * t2, sides: lod === 0 ? 5 : 4, capStart: 'none', capEnd: 'flat', color: () => BARK });
    });
  }
  if (shelves && lod < 2) {
    stacks.slice(0, lod === 0 ? 5 : 4).forEach((stack, k) => {
      const c = centreAt(stack.t);
      const rad = radiusAt(stack.t) * 0.98;
      const contact = [c[0], c[1] + Math.cos(stack.alpha) * rad, c[2] + stack.side * Math.sin(stack.alpha) * rad];
      stack.shelf.slice(0, lod === 0 ? 3 : 1).forEach((sh, j) => {
        const R = sh.R;
        const origin = add(contact, [sh.dx, j * 0.07 + 0.01, 0]);
        const profile = [[0, 0], [R, 0], [R, 0.028], [R * 0.66, 0.055], [R * 0.3, 0.068], [0, 0.072]];
        addLathe(m, `shelf${k}_${j}`, lod === 0 ? profile : [profile[0], profile[1], profile[3], profile[5]], {
          origin, sides: lod === 0 ? 6 : 4, arc: Math.PI, turn: -Math.PI / 2, frame: [[0, 0, stack.side], [stack.side, 0, 0]],
          color: t => mix3(lc(0.045, 0.03, 0.05), lc(0.09, 0.06, 0.09), t),
          emit: t => (t < 0.5 ? glow(CYAN, 1.1) : glow(CYAN, 0.16)),
        });
        if (j === 0 && lod === 0) m.halo(add(origin, [0, 0.02, stack.side * R * 0.5]), 0.35, 'cyan');
      });
    });
  }
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------------------------- driftwood
// A bleached branched limb washed up on the shore, three to four metres, the grey of old bone.
function buildDriftwood(lod, plan, seed = 61) {
  const m = new Model(`driftwood ${seed}`, { plan });
  const r = rng(seed);
  const sides = [7, 5, 4][lod], per = [10, 5, 3][lod];
  const spineAt = t => [-1.7 + t * 3.4, 0.17 + 0.4 * t * (1 - t) + 0.04 * Math.sin(t * 7 + seed), 0.18 * Math.sin(t * 2.4 + seed * 0.1)];
  const specs = Array.from({ length: 3 }, (_, k) => ({
    t: 0.25 + 0.5 * (k + r() * 0.5) / 3,
    dir: normalize([0.55 + r() * 0.5, 0.4 + r() * 0.8, (r() - 0.5) * 1.8]),
    L: 0.9 + r() * 0.7,
  }));
  const spine = Array.from({ length: per }, (_, i) => spineAt(i / (per - 1)));
  const wood = (t, a) => mix3(BLEACHED_DARK, BLEACHED, 0.45 + 0.55 * noise1(a * 5 + seed, t * 7));
  addTube(m, 'main', spine, {
    radius: t => 0.13 * (1 - 0.55 * t) + 0.015, sides, capStart: 'flat', capEnd: 'round', capRings: 1,
    shape: (t, a) => 1 + 0.12 * (noise1(a * 4 + seed, t * 8) - 0.5) * 2, color: wood, capColor: BLEACHED,
  });
  specs.slice(0, [3, 2, 1][lod]).forEach((b, k) => {
    const origin = spineAt(b.t);
    const pts = [origin, add(origin, mul(b.dir, b.L * 0.5)), add(add(origin, mul(b.dir, b.L)), [0, -0.12, 0])];
    addTube(m, `branch${k}`, pts, { radius: t2 => 0.06 * (1 - 0.7 * t2) + 0.012, sides, capStart: 'none', capEnd: 'round', capRings: 1, color: wood });
  });
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------------------------- the table
// name -> { build(lod, plan) => Model, share: whether the coarser levels may reuse level 0's atlas (same charts), render: how it is drawn }
//   sway: 'upright' (the wind module's profile, plants give way to feet and hands) | 'hang' (own patch; per-vertex weights) | null
export const FLORA_MODELS = Object.freeze({
  fern: { build: buildFern, share: false },
  cushion: { build: buildCushion, share: false },
  mushrooms: { build: buildMushrooms, share: false },
  flower: { build: buildFlower, share: false },
  fungusLog: { build: (lod, plan) => buildLog(lod, plan, { shelves: true, seed: 53 }), share: true },
  log: { build: (lod, plan) => buildLog(lod, plan, { shelves: false, seed: 57 }), share: true },
  driftwoodA: { build: (lod, plan) => buildDriftwood(lod, plan, 61), share: true },
  driftwoodB: { build: (lod, plan) => buildDriftwood(lod, plan, 67), share: true },
  driftwoodC: { build: (lod, plan) => buildDriftwood(lod, plan, 71), share: true },
  ...TREE_MODELS,
  ...RUIN_MODELS,
});

const cache = new Map();

// The three finished levels of a model: [{ positions, normals, colors, emits, sways, uvs, indices, triangles, bounds, halos, atlas, ... }], cached.
export function buildFloraLevels(name) {
  if (cache.has(name)) return cache.get(name);
  const spec = FLORA_MODELS[name];
  if (!spec) throw new Error(`no island model called ${name}`);
  const levels = [];
  let plan = null;
  for (let lod = 0; lod < 3; lod++) {
    const model = spec.build(lod, spec.share && lod > 0 ? plan : null);
    const data = model.finish({ size: 1024, padding: 3, density: 96 });
    if (lod === 0) plan = { size: data.atlas.size, padding: data.atlas.padding, density: data.atlas.density, rects: data.atlas.rects, height: data.atlas.height };
    levels.push(data);
  }
  cache.set(name, levels);
  return levels;
}
