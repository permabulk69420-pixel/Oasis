import {
  Model, addTube, addRibbon, addLathe, addTrail, addBead, curve, resample, along, tubeFrames, rng, CYAN, PALE,
  add, sub, mul, cross, normalize, mix3, lerp, clamp01, smoothstep, rotateAbout, length,
} from './flora-kit.js';
import { TAU, DEG, lc, shade, glow, noise1, ROOT, BARK_DARK, BARK_PALE, MOSS, MOSS_LIGHT, BONE, BONE_DARK, STONE, STONE_LIGHT } from './island-flora-common.js';

// The island's landmarks: the twisted root arch at the grove's mouth, the standing stones, the broken ribcage and a few pale bones. They are the oasis's kind of thing:
// dark, old, with the glow in thin lines and seams (the veins on the hero tree's roots) rather than lamps. Built from the same kit as the plants (proper charts at a
// steady density), seeded and pure. Static: nothing in here sways.

const dash = (t, count, duty, soft = 0.12) => {
  const f = (t * count) % 1;
  return smoothstep(0, soft, f) * (1 - smoothstep(duty, duty + soft, f));
};

// ---------------------------------------------------------------------------------------------------------------------------------------- the root arch
// Two pillars of roots twisted round each other, reaching in over the path and growing together at the top, 6.4 metres up and five and a half across. Dashes of cyan
// glow run along three of the ropes the way the veins run on the hero tree's roots; a few aerial roots hang from the top, each tipped with a small bead.
function buildArch(lod, plan) {
  const m = new Model('root arch', { plan });
  const n = [64, 24, 9][lod];
  const axisAt = s => {
    const u = Math.abs(2 * s - 1);
    const x = -2.75 * Math.cos(Math.PI * s) * (1 + 0.04 * Math.sin(s * 11));
    const y = 6.4 * (1 - Math.pow(u, 1.9)) - 0.35 * Math.pow(u, 8);
    return [x, y, 0.28 * Math.sin(s * 7.3 + 1.0) * Math.sin(Math.PI * s)];
  };
  const axis = Array.from({ length: n }, (_, i) => axisAt(i / (n - 1)));
  const { N, B } = tubeFrames(axis, [0, 0, 1]);
  const bundle = s => 0.50 - 0.24 * Math.pow(Math.sin(Math.PI * s), 0.7);
  const ropeRadius = s => 0.17 + 0.17 * (Math.exp(-s * 10) + Math.exp(-(1 - s) * 10));
  const ropes = [
    { phase: 0.0, twist: 2.4, from: 0, to: 1 }, { phase: 1.26, twist: 2.4, from: 0, to: 1 }, { phase: 2.51, twist: 2.4, from: 0, to: 1 },
    { phase: 3.77, twist: 2.4, from: 0, to: 1 }, { phase: 5.03, twist: 2.4, from: 0, to: 1 },
    { phase: 0.6, twist: 2.4, from: 0, to: 0.56 }, { phase: 3.2, twist: 2.4, from: 0, to: 0.6 }, { phase: 1.9, twist: 2.4, from: 0.44, to: 1 }, { phase: 4.4, twist: 2.4, from: 0.4, to: 1 },
  ];
  const count = [9, 4, 2][lod];
  const sides = [7, 5, 4][lod];
  let trails = 0;
  ropes.slice(0, count).forEach((rope, k) => {
    const i0 = Math.round(rope.from * (n - 1)), i1 = Math.round(rope.to * (n - 1));
    const partial = rope.from > 0 || rope.to < 1;
    const path = [];
    for (let i = i0; i <= i1; i++) {
      const s = i / (n - 1);
      const theta = rope.phase + rope.twist * s * TAU;
      let spread = 0, drop = 0;
      if (partial) {
        const end = rope.to < 1 ? smoothstep(rope.to - 0.2, rope.to, s) : smoothstep(rope.from + 0.2, rope.from, s);
        spread = 0.55 * end; drop = -0.5 * end;
      }
      const off = add(mul(N[i], Math.cos(theta)), mul(B[i], Math.sin(theta)));
      path.push(add(add(axis[i], mul(off, bundle(s) + spread)), [0, drop, 0]));
    }
    const o = {
      radius: (t, i) => ropeRadius(lerp(rope.from, rope.to, t)) * (partial ? 1 - 0.55 * Math.pow(t < 0.5 && rope.from > 0 ? 1 - t * 2 : t > 0.5 && rope.to < 1 ? (t - 0.5) * 2 : 0, 2) : 1),
      sides, capStart: rope.from > 0 ? 'round' : 'none', capEnd: rope.to < 1 ? 'round' : 'none', capRings: 1, up: [0, 0, 1],
      shape: lod === 0 ? (t, a) => 1 + 0.12 * (noise1(a * 5 + k * 3, t * 14) - 0.5) : undefined,
      color: (t, a, i) => {
        const s = lerp(rope.from, rope.to, t);
        const low = Math.max(Math.exp(-s * 14), Math.exp(-(1 - s) * 14));
        return mix3(mix3(ROOT, BARK_PALE, 0.25 + 0.4 * noise1(a * 4 + k, t * 9)), shade(MOSS, 0.9), 0.55 * low * (0.5 + noise1(a * 6, t * 20)));
      },
    };
    addTube(m, `rope${k}`, path, o);
    if (lod === 0 && !partial && trails < 3) {
      const v = trails++;
      const dense = resample(path, path.length * 2 - 1);
      addTrail(m, `vein${v}`, dense, {
        ...o, shape: undefined, up: [0, 0, 1], width: 0.04, lift: 0.025, angle: t => 0.25 + v * 0.31 + 0.03 * Math.sin(t * 13 + v),
        radius: (t, i) => o.radius(t, i) * 1.03,
        color: () => ROOT, emit: t => glow(CYAN, 0.8 * dash(t, 15 + v * 2, 0.55) * (0.4 + 0.6 * Math.sin(Math.PI * t))),
      });
    }
  });
  // buttress roots splaying out on the ground at the feet of both pillars
  const feet = [[-1, 0], [1, 1]];
  const buttress = [4, 3, 0][lod];
  feet.forEach(([sgn, side]) => {
    for (let k = 0; k < buttress; k++) {
      const r = rng(9810 + side * 10 + k);
      const base = axisAt(side ? 1 : 0);
      const az = (side ? 0 : Math.PI) + (k - (buttress - 1) / 2) * 1.0 + (r() - 0.5) * 0.5;
      const out = [Math.cos(az), 0, Math.sin(az)];
      const R = 1.9 + r() * 1.2;
      const ctl = [[0.25, 1.35], [0.75, 0.8], [R * 0.55, 0.32], [R, 0.05], [R + 0.6, -0.16]].map(([o2, y]) => add(add([base[0] + sgn * 0.0, 0, base[2]], mul(out, o2)), [0, y, 0]));
      addTube(m, `buttress${side}_${k}`, curve(ctl, lod === 0 ? 3 : 1), {
        radius: t => 0.32 * Math.pow(1 - t, 0.75) + 0.04, sides: lod === 0 ? 7 : 4, capStart: 'none', capEnd: 'none', up: [0, 1, 0],
        color: (t, a) => mix3(ROOT, shade(MOSS, 0.9), 0.35 + 0.4 * t),
      });
    }
  });
  // aerial roots hanging from the top, each with a glowing bead at its tip
  if (lod < 2) {
    const r = rng(9850);
    const hangers = lod === 0 ? 8 : 4;
    for (let k = 0; k < hangers; k++) {
      const s = 0.5 + (r() - 0.5) * 0.34;
      const top = add(axisAt(s), [(r() - 0.5) * 0.5, -0.25, (r() - 0.5) * 0.5]);
      const L = 1.6 + r() * 2.2;
      const path = [];
      const rows = lod === 0 ? 7 : 3;
      for (let i = 0; i < rows; i++) {
        const u = i / (rows - 1);
        path.push([top[0] + Math.sin(u * 3 + k) * 0.12 * u, top[1] - L * u, top[2] + Math.cos(u * 2.5 + k) * 0.1 * u]);
      }
      addTube(m, `aerial${k}`, path, {
        radius: u => 0.05 * (1 - 0.7 * u) + 0.012, sides: lod === 0 ? 4 : 3, capStart: 'none', capEnd: 'none', up: [1, 0, 0], color: u => mix3(ROOT, BARK_PALE, 0.2 * u),
        emit: u => glow(CYAN, 0.2 * u * u),
      });
      const tip = path[path.length - 1];
      addBead(m, `aerialbead${k}`, [tip[0], tip[1] - 0.03, tip[2]], 0.04, { emit: CYAN, brightness: 1.0, sides: 5, rings: 1, color: ROOT, halo: lod === 0 && k % 3 === 0 ? 0.55 : 0 });
    }
  }
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------------------------- standing stones
// A weathered monolith: a faceted column that leans a little, narrows towards a slanted top, mossy at the foot, with seams of faint cyan light running up the edges
// between its faces (so the glow sits in the cracks, as in the oasis's crystals' veins and the roots).
function buildStone(lod, plan, { seed = 1, height = 4.2, base = 0.95, lean = 0.12, sides = 7, tilt = 0.5 } = {}) {
  const m = new Model(`stone ${seed}`, { plan });
  const r = rng(seed);
  const rows = [14, 6, 3][lod];
  const faceSides = [sides, Math.max(5, sides - 1), 5][lod];
  const corner = Array.from({ length: 12 }, () => 0.8 + r() * 0.42);          // each corner of the polygon stands out its own distance
  const slopeAngle = r() * TAU;
  const path = Array.from({ length: rows }, (_, i) => {
    const t = i / (rows - 1);
    return [lean * height * t, -0.3 + (height + 0.3) * t, 0.05 * Math.sin(t * 3 + seed)];
  });
  const radius = t => base * (1 - 0.3 * Math.pow(t, 0.9)) * (1 + 0.45 * Math.exp(-t * 10));
  const shape = (t, a) => corner[Math.round(a * faceSides) % faceSides] * (1 + 0.14 * (noise1(Math.round(a * faceSides) * 1.7 + seed, t * 7) - 0.5));
  // the top is a slanted cut: the points above 84% of the height sink on one side and rise on the other, in a plane
  const offset = (t, a) => [0, tilt * radius(t) * Math.cos(a * TAU + slopeAngle) * smoothstep(0.84, 1, t), 0];
  const o = {
    radius, sides: faceSides, capStart: 'none', capEnd: 'flat', up: [1, 0, 0], shape, offset, flat: true, capColor: STONE_LIGHT,
    color: (t, a) => {
      const bands = 0.5 + 0.5 * Math.sin(t * 17 + a * 9 + seed);
      const moss = Math.exp(-t * 9);
      return mix3(mix3(STONE, STONE_LIGHT, 0.25 + 0.45 * noise1(a * 6 + seed, t * 8) + 0.1 * bands), shade(MOSS, 0.9), Math.min(1, moss * (0.6 + 0.8 * noise1(a * 8, t * 12))));
    },
  };
  addTube(m, 'shaft', path, o);
  if (lod === 0) {
    // seams on a few corners: segments of different strength, fading with height
    const edges = [0, 2, 4].map(e => (e + Math.floor(seed)) % faceSides);
    edges.forEach((e, v) => {
      const a0 = e / faceSides;
      const dense = resample(path, rows * 2 - 1);
      addTrail(m, `seam${v}`, dense, {
        ...o, flat: false, capEnd: 'none', width: 0.05 * (1 - 0.3 * v / 3), lift: 0.022, angle: () => a0, shape, offset,
        color: () => STONE, emit: t => glow(CYAN, 0.6 * (0.3 + 0.7 * dash(t + v * 0.13, 4 + v, 0.72, 0.18)) * (1 - smoothstep(0.62, 0.95, t + v * 0.05))),
      });
    });
  }
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------------------------- the ribcage
// A broken ribcage lying in the hollow's mouth: a spine along the ground, ribs standing up from it in pairs and curving in over the top, some whole, some snapped
// off short with ragged ends, two ribs fallen beside it. Weathered the colour of old bone, mossy where it meets the ground.
let ribSpec = null;
function ribcageSpec() {
  if (ribSpec) return ribSpec;
  const r = rng(9921);
  const pairs = 9;
  const ribs = [];
  for (let k = 0; k < pairs; k++) {
    const mid = Math.sin(Math.PI * (k + 0.5) / pairs);
    for (const side of [-1, 1]) {
      const whole = r() < 0.4;
      ribs.push({
        k, side, a: 1.9 * (0.5 + 0.5 * mid) + (r() - 0.5) * 0.14, b: 2.3 * (0.45 + 0.55 * mid) + (r() - 0.5) * 0.18,
        psiMax: whole ? Math.PI * (0.8 + r() * 0.12) : Math.PI * (0.22 + r() * 0.5), z: (k - (pairs - 1) / 2) * 0.52 + (r() - 0.5) * 0.04, lean: 0.35 + r() * 0.3, thick: 0.125 + r() * 0.03, whole,
      });
    }
  }
  ribSpec = { pairs, ribs, spineY: 0.26 };
  return ribSpec;
}

function buildRibcage(lod, plan) {
  const spec = ribcageSpec();
  const m = new Model('ribcage', { plan });
  const bone = (a, t, k) => mix3(BONE_DARK, BONE, 0.5 + 0.5 * noise1(a * 5 + k, t * 6));
  // the spine: a row of vertebrae lying along z
  const spineRows = [spec.pairs, 5, 0][lod];
  for (let k = 0; k < spineRows; k++) {
    const z = lod === 0 ? (k - (spec.pairs - 1) / 2) * 0.52 : (k - 2) * 1.0;
    const o = [0.02 * Math.sin(k * 1.7), spec.spineY + 0.04, z];
    addLathe(m, `body${k}`, [[0, -0.25], [0.22, -0.22], [0.28, 0], [0.22, 0.22], [0, 0.25]], {
      origin: o, axis: [0, 0, 1], sides: lod === 0 ? 7 : 5, sx: 1.0, sz: 0.85, color: (t, a) => bone(a, t, k),
    });
    if (lod === 0) {
      addTube(m, `spine${k}`, [add(o, [0, 0.16, 0]), add(o, [0.02, 0.42, 0.03]), add(o, [0.05, 0.72 - (k % 3) * 0.1, 0.08])], {
        radius: t => 0.09 * (1 - 0.7 * t), sides: 5, capStart: 'none', capEnd: 'flat', up: [0, 0, 1], color: (t, a) => bone(a, t, k + 20), capColor: BONE,
      });
    }
  }
  // the ribs
  const keep = lod === 0 ? spec.ribs : lod === 1 ? spec.ribs.filter((_, i) => i % 2 === 0) : spec.ribs.filter(rib => rib.whole);
  keep.forEach((rib, idx) => {
    const steps = [18, 8, 4][lod];
    const centre = [0, spec.spineY - 0.04 + rib.b, rib.z];
    const path = [];
    for (let i = 0; i < steps; i++) {
      const psi = (i / (steps - 1)) * rib.psiMax;
      path.push([rib.side * rib.a * Math.sin(psi), centre[1] - rib.b * Math.cos(psi), rib.z + rib.lean * Math.sin(psi * 0.5) * (rib.z > 0 ? 1 : 0.6)]);
    }
    addTube(m, `rib${idx}`, path, {
      radius: t => rib.thick * (1 - 0.45 * t) + (rib.whole ? 0 : 0.012), sides: [7, 5, 4][lod], capStart: 'none', capEnd: rib.whole ? 'round' : 'flat', capRings: 1, up: [0, 0, 1],
      shape: lod === 0 ? (t, a) => 1 + 0.4 * Math.cos(a * TAU * 2) + 0.1 * (noise1(a * 4 + idx, t * 7) - 0.5) : (t, a) => 1 + 0.35 * Math.cos(a * TAU * 2),
      color: (t, a) => mix3(bone(a, t, idx), shade(MOSS, 0.8), 0.5 * Math.exp(-t * 14)), capColor: BONE,
    });
  });
  // two ribs that fell outside the cage
  if (lod < 2) {
    [[3.2, 0.6], [-2.6, -1.1]].forEach(([x, z], k) => {
      const r = rng(9940 + k);
      const dir = normalize([r() - 0.5, 0, r() - 0.5]);
      const side = cross(dir, [0, 1, 0]);
      const rows = lod === 0 ? 11 : 5;
      const path = Array.from({ length: rows }, (_, i) => {
        const u = i / (rows - 1);
        return add(add([x, 0.1, z], mul(dir, 1.9 * u)), add(mul(side, 0.8 * Math.sin(u * Math.PI * 0.8)), [0, 0.12 * Math.sin(u * Math.PI), 0]));
      });
      addTube(m, `fallen${k}`, path, {
        radius: t => 0.12 * (1 - 0.5 * t) + 0.015, sides: lod === 0 ? 7 : 4, capStart: 'round', capEnd: 'flat', capRings: 1, up: [0, 1, 0],
        color: (t, a) => mix3(bone(a, t, 40 + k), shade(MOSS, 0.8), 0.5 * (1 - t) * 0.7), capColor: BONE,
      });
    });
  }
  // a faint cyan fleck here and there in the cracks of the bone
  if (lod === 0) {
    const r = rng(9960);
    for (let k = 0; k < 9; k++) {
      const rib = spec.ribs[Math.floor(r() * spec.ribs.length)];
      const psi = (0.1 + r() * 0.8) * rib.psiMax;
      const at = [rib.side * rib.a * Math.sin(psi) * 1.02, spec.spineY - 0.04 + rib.b * (1 - Math.cos(psi)), rib.z];
      addBead(m, `fleck${k}`, at, 0.014, { emit: PALE, brightness: 0.55, sides: 4, rings: 1, color: BONE });
    }
  }
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------------------------- scattered bones
// A few pale bones lying together: a long shaft with a knob at each end, a curved rib piece, a vertebra and a broken shard. `variant` shuffles which and how.
function buildBones(lod, plan, variant = 0) {
  const m = new Model(`bones ${variant}`, { plan });
  const r = rng(9970 + variant * 13);
  const bone = (a, t, k) => mix3(BONE_DARK, BONE, 0.45 + 0.55 * noise1(a * 5 + k, t * 5));
  const pieces = lod === 0 ? 4 : lod === 1 ? 3 : 2;
  for (let k = 0; k < pieces; k++) {
    const az = (k / pieces) * TAU + variant * 0.9 + (r() - 0.5) * 0.7;
    const dir = [Math.cos(az), 0, Math.sin(az)];
    const origin = [(r() - 0.5) * 0.6, 0.06, (r() - 0.5) * 0.6];
    const L = 0.55 + r() * 0.7;
    const rad = 0.05 + r() * 0.022;
    const kind = (k + variant) % 3;
    if (kind === 0 || lod === 2) {
      const a = origin, b = add(origin, mul(dir, L));
      addTube(m, `shaft${k}`, [a, add(a, mul(dir, L * 0.5)), b], { radius: t => rad * (1 + 0.15 * Math.sin(t * Math.PI)), sides: [6, 5, 4][lod], capStart: 'none', capEnd: 'none', up: [0, 1, 0], color: (t, aa) => bone(aa, t, k) });
      if (lod < 2) for (const [end, name] of [[a, 'a'], [b, 'b']]) {
        const side = normalize(cross(dir, [0, 1, 0]));
        for (const sg of [-1, 1]) addBead(m, `knob${k}${name}${sg}`, add(add(end, mul(side, sg * rad * 0.7)), mul(dir, name === 'a' ? -rad * 0.3 : rad * 0.3)), rad * 1.3, { emit: [0, 0, 0], color: BONE, sides: lod === 0 ? 6 : 4, rings: lod === 0 ? 2 : 1 });
      }
    } else if (kind === 1) {
      const side = normalize(cross(dir, [0, 1, 0]));
      const rows = lod === 0 ? 8 : 4;
      const pts = Array.from({ length: rows }, (_, i) => {
        const u = i / (rows - 1);
        return add(add(origin, mul(dir, L * 0.9 * u)), add(mul(side, 0.35 * L * Math.sin(u * 1.6)), [0, 0.02 + 0.05 * u, 0]));
      });
      addTube(m, `curve${k}`, pts, { radius: t => 0.06 * (1 - 0.5 * t) + 0.015, sides: lod === 0 ? 6 : 4, capStart: 'round', capEnd: 'flat', capRings: 1, up: [0, 1, 0], color: (t, aa) => bone(aa, t, k), capColor: BONE });
    } else {
      addLathe(m, `vert${k}`, [[0, -0.1], [0.085, -0.08], [0.105, 0], [0.085, 0.08], [0, 0.1]], { origin: add(origin, [0, 0.05, 0]), axis: normalize([r() - 0.5, 0.3, r() - 0.5]), sides: lod === 0 ? 7 : 5, color: (t, aa) => bone(aa, t, k) });
    }
  }
  return m;
}

export const RUIN_MODELS = {
  rootArch: { build: buildArch, share: false },
  standingStoneA: { build: (lod, plan) => buildStone(lod, plan, { seed: 3, height: 4.4, base: 0.95, lean: 0.1, sides: 7, tilt: 0.55 }), share: false },
  standingStoneB: { build: (lod, plan) => buildStone(lod, plan, { seed: 8, height: 3.1, base: 0.8, lean: -0.16, sides: 6, tilt: -0.4 }), share: false },
  ribcage: { build: buildRibcage, share: false },
  bonesA: { build: (lod, plan) => buildBones(lod, plan, 0), share: false },
  bonesB: { build: (lod, plan) => buildBones(lod, plan, 1), share: false },
};
