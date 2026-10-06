import * as THREE from 'three';
import { SKY_ISLAND, outlineRadius, topPaint } from './sky-island-shape.js';
import { clamp, mix, noise } from './world-math.js';

// The island's paths (the owner, 5 Oct: it is the player's home base, so the places on it are joined by winding low paths). Each is worn earth and
// pebbles laid on the ground as a thin strip that fades into the turf at its edges, in the terrain's own material, so it takes the light, the haze and
// the night the same way. Paths are only a look (and a guide for where things grow): nothing about walking changes. The routes are hand placed
// (control points in world metres), then smoothed, kept out of the lake and away from the rim. Pure up to `createPathMesh`, so tests can run it.

export const PATH_SPEC = Object.freeze({
  step: 0.8,           // metres between samples along a path
  lift: 0.06,          // the strip floats this far over the ground, so the mesh's own facets never poke through it
  lakeMargin: 2.6,     // a path keeps this far from the water's edge...
  rimMargin: 4.6,      // ...and from the edge of the top
  wobble: 1.5,         // metres of meander laid over the hand-placed line
  across: Object.freeze([-1.6, -0.8, 0, 0.8, 1.6]),   // where the strip's vertices are, in half widths
  weight: Object.freeze([0, 0.85, 1, 0.85, 0]),       // how much of the path look each has: the outer two are the ground's own look
  stoneTop: 0.62,      // the share of dark stone in the middle of the path, over warm earth and pebbles
  gravelTop: 0.3,
  channelGap: 2.4,     // the strip stops this far from the spill channel's line (the path is stepping stones there)
});

// The routes. A loop round the lake (crossing the little outflow on stepping stones just above the fall), a trail to the rim lookout and on to the foot of
// the rise, one up to the standing stone on the rise and one back down to the meadow, one to the palm grove and one to the hollow.
export const ISLAND_PATHS = Object.freeze([
  { name: 'meadow to grove', width: 1.8, points: [[-117, 630], [-128, 626], [-144, 631], [-158, 625], [-166, 616]] },
  { name: 'grove to the lake', width: 1.7, points: [[-166, 616], [-168, 600], [-176, 585], [-186, 574]] },
  { name: 'lake, west shore', width: 1.7, points: [[-186, 574], [-199, 568], [-215, 558], [-225, 540], [-228, 518], [-228, 496], [-226, 477], [-218, 463], [-209, 455.5]] },
  { name: 'lake, east shore', width: 1.7, points: [[-209, 455.5], [-198, 455], [-186, 457], [-173, 464], [-161, 478], [-155, 498], [-157, 520], [-161, 542], [-166, 562], [-171, 580]] },
  { name: 'meadow to the lake', width: 1.9, wobble: 3.4, points: [[-114, 624], [-124, 611], [-141, 596], [-157, 586], [-171, 580]] },
  { name: 'lake to the rim', width: 1.8, wobble: 2.6, points: [[-161, 478], [-150, 466], [-139, 458.5]] },
  { name: 'rim to the rise', width: 1.9, points: [[-139, 458.5], [-119, 464], [-97, 479], [-75, 501], [-59, 525], [-49, 546], [-44, 557]] },
  { name: 'up the rise', width: 1.5, points: [[-44, 557], [-39, 566], [-33, 573], [-35, 578.5]] },
  { name: 'rise to the meadow', width: 1.9, wobble: 3.2, points: [[-44, 557], [-56, 580], [-72, 602], [-89, 620], [-98, 627]] },
  { name: 'meadow to the hollow', width: 1.7, wobble: 2.4, points: [[-107, 645], [-117, 656], [-112, 669], [-122, 681], [-117, 692], [-125, 699], [-126, 703]] },
]);

// Catmull-Rom through the control points (open ends), `sub` points per segment.
function smoothLine(points, sub = 8) {
  const out = [];
  const n = points.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(i + 2, n - 1)];
    for (let k = 0; k < sub; k++) {
      const t = k / sub, t2 = t * t, t3 = t2 * t;
      const cr = j => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3);
      out.push([cr(0), cr(1)]);
    }
  }
  out.push([...points[n - 1]]);
  return out;
}

function resample(line, step) {
  const lengths = [0];
  for (let i = 1; i < line.length; i++) lengths.push(lengths[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const total = lengths[lengths.length - 1];
  const count = Math.max(2, Math.round(total / step));
  const out = [];
  let seg = 0;
  for (let k = 0; k <= count; k++) {
    const d = (k / count) * total;
    while (seg < line.length - 2 && lengths[seg + 1] < d) seg++;
    const span = lengths[seg + 1] - lengths[seg] || 1;
    const t = clamp((d - lengths[seg]) / span, 0, 1);
    out.push([mix(line[seg][0], line[seg + 1][0], t), mix(line[seg][1], line[seg + 1][1], t)]);
  }
  return out;
}

// [{ name, width, samples: [{ x, z, along, tx, tz, half }] }]. `features` is from createIslandFeatures (the lake and the channel).
export function layoutPaths(features, config = SKY_ISLAND, routes = ISLAND_PATHS, spec = PATH_SPEC) {
  const { lake } = features;
  const lakeGradient = (x, z) => {
    const e = 1.5;
    const gx = lake.signed(x + e, z) - lake.signed(x - e, z), gz = lake.signed(x, z + e) - lake.signed(x, z - e);
    const length = Math.hypot(gx, gz) || 1;
    return [gx / length, gz / length];
  };
  const rimGap = (x, z) => {
    const dx = x - config.x, dz = z - config.z;
    return outlineRadius(Math.atan2(dz, dx), config) - config.lip - Math.hypot(dx, dz);
  };
  return routes.map((route, routeIndex) => {
    let line = resample(smoothLine(route.points), spec.step);
    // a slow meander laid over the hand-placed line (none at the two ends, so the routes still meet)
    const total = line.length;
    line = line.map(([x, z], i) => {
      const a = line[Math.max(i - 1, 0)], b = line[Math.min(i + 1, total - 1)];
      const tx = b[0] - a[0], tz = b[1] - a[1], length = Math.hypot(tx, tz) || 1;
      const taper = Math.min(1, i / 14, (total - 1 - i) / 14);
      const w = (noise(i * spec.step / 16 + routeIndex * 31, 4.7) - 0.5) * 2 * (route.wobble ?? spec.wobble) * taper;
      return [x - tz / length * w, z + tx / length * w];
    });
    // keep out of the lake and off the rim, then smooth the kinks that makes
    for (let pass = 0; pass < 5; pass++) {
      line = line.map(([x, z], i) => {
        if (i === 0 || i === total - 1) return [x, z];
        const s = lake.signed(x, z);
        if (s > -spec.lakeMargin) { const [gx, gz] = lakeGradient(x, z); x -= gx * (s + spec.lakeMargin); z -= gz * (s + spec.lakeMargin); }
        const gap = rimGap(x, z);
        if (gap < spec.rimMargin) { const dx = x - config.x, dz = z - config.z, d = Math.hypot(dx, dz) || 1; x -= dx / d * (spec.rimMargin - gap); z -= dz / d * (spec.rimMargin - gap); }
        return [x, z];
      });
      line = line.map(([x, z], i) => (i === 0 || i === total - 1) ? [x, z] : [
        (line[i - 1][0] + 2 * x + line[i + 1][0]) / 4, (line[i - 1][1] + 2 * z + line[i + 1][1]) / 4,
      ]);
    }
    const samples = [];
    let along = 0;
    for (let i = 0; i < total; i++) {
      const a = line[Math.max(i - 1, 0)], b = line[Math.min(i + 1, total - 1)];
      const tx = b[0] - a[0], tz = b[1] - a[1], length = Math.hypot(tx, tz) || 1;
      if (i > 0) along += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
      const half = route.width * 0.5 * (0.84 + 0.32 * noise(along / 11 + routeIndex * 17, 9.1));
      samples.push({ x: line[i][0], z: line[i][1], along, tx: tx / length, tz: tz / length, half });
    }
    return { name: route.name, width: route.width, samples };
  });
}

// How near a point is to any path: { distance, half } for the closest sample, within `reach` metres (distance Infinity when none).
export function createPathIndex(paths, reach = 12) {
  const cell = 8;
  const cells = new Map();
  const key = (i, j) => i * 100003 + j;
  for (const path of paths) {
    for (const s of path.samples) {
      const k = key(Math.floor(s.x / cell), Math.floor(s.z / cell));
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(s);
    }
  }
  return {
    nearest(x, z) {
      let best = { distance: Infinity, half: 0 };
      const ci = Math.floor(x / cell), cj = Math.floor(z / cell), r = Math.ceil(reach / cell);
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
        const list = cells.get(key(i, j));
        if (!list) continue;
        for (const s of list) {
          const d = Math.hypot(s.x - x, s.z - z);
          if (d < best.distance) best = { distance: d, half: s.half };
        }
      }
      return best;
    },
    // how far the point is from the path's own edge: negative on the path
    clearance(x, z) { const n = this.nearest(x, z); return n.distance - n.half; },
  };
}

// The strips as arrays for one mesh, in the terrain material's attributes: position, normal, colour (1, tone, turf) and zone (0, -stone, gravel).
export function buildPathStrips(paths, { ground, features, config = SKY_ISLAND, spec = PATH_SPEC }) {
  const positions = [], normals = [], colors = [], zones = [], indices = [];
  const channel = features.channel;
  const awayFromChannel = (x, z) => {
    const dx = channel.bx - channel.ax, dz = channel.bz - channel.az;
    const t = clamp(((x - channel.ax) * dx + (z - channel.az) * dz) / (dx * dx + dz * dz), 0, 1);
    return Math.hypot(x - (channel.ax + dx * t), z - (channel.az + dz * t)) > spec.channelGap + features.lakeSpec.channelWidth * 0.5;
  };
  const paint = { grass: 1, stone: 0, gravel: 0, variation: 0 };
  const perSample = spec.across.length;
  for (const path of paths) {
    let previous = -1; // index of the first vertex of the previous sample's row, or -1 when the strip is broken
    for (const s of path.samples) {
      const row = [];
      let ok = awayFromChannel(s.x, s.z);
      const nx = -s.tz, nz = s.tx;
      if (ok) {
        for (let k = 0; k < perSample; k++) {
          const off = spec.across[k] * s.half;
          const x = s.x + nx * off, z = s.z + nz * off;
          const g = ground(x, z);
          if (g === null) { ok = false; break; }
          row.push({ x, z, y: g + spec.lift, k });
        }
      }
      if (!ok) { previous = -1; continue; }
      const base = positions.length / 3;
      for (const v of row) {
        positions.push(v.x, v.y, v.z);
        const e = 0.7;
        const dhx = (ground(v.x + e, v.z) ?? v.y) - (ground(v.x - e, v.z) ?? v.y), dhz = (ground(v.x, v.z + e) ?? v.y) - (ground(v.x, v.z - e) ?? v.y);
        const nl = Math.hypot(dhx / (2 * e), 1, dhz / (2 * e));
        normals.push(-dhx / (2 * e) / nl, 1 / nl, -dhz / (2 * e) / nl);
        topPaint(v.x, v.z, config, features, paint);
        const p = spec.weight[v.k];
        const wear = 0.65 + 0.35 * noise(v.x / 3.1 + 5, v.z / 3.1 - 2); // the path is not the same everywhere: some stretches are bare earth, some stony
        const grass = paint.grass * (1 - 0.92 * p);
        const stone = Math.max(paint.stone, mix(paint.stone, spec.stoneTop * wear, p));
        const gravel = Math.max(paint.gravel, spec.gravelTop * p * (1.15 - 0.3 * wear));
        colors.push(1, paint.variation, grass);
        zones.push(0, -stone, gravel);
      }
      if (previous >= 0) {
        for (let k = 0; k + 1 < perSample; k++) {
          const a = previous + k, b = previous + k + 1, c = base + k, d = base + k + 1;
          indices.push(a, b, c, b, d, c);
        }
      }
      previous = base;
    }
  }
  return {
    positions: Float32Array.from(positions), normals: Float32Array.from(normals), colors: Float32Array.from(colors), zones: Float32Array.from(zones),
    indices: Uint32Array.from(indices), vertexCount: positions.length / 3,
  };
}

// In the game: one mesh for all the paths, in the terrain's own material (so the sun, haze, night and torch light all apply with no extra code).
export function createPathMesh({ island, material, paths = layoutPaths(island.features, island.config) }) {
  const data = buildPathStrips(paths, { ground: island.groundHeight, features: island.features, config: island.config });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
  geometry.setAttribute('zone', new THREE.BufferAttribute(data.zones, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Island paths';
  return { mesh, paths, triangles: data.indices.length / 3 };
}

