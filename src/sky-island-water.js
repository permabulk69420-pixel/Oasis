import { SKY_ISLAND, outlineRadius, undersidePoint } from './sky-island-shape.js';

// The island's water: the lake, the short channel that carries it to the rim, and the thin waterfall that spills over the edge and thins to mist long
// before it could reach the desert (the owner, 5 Oct: a real lake about 100 m by 50 m, "reuse the oasis pond's water look", no rivers). The lake is the
// pond's own water material (src/oasis-water.js) on a grid laid over the basin; the channel and the fall are ribbons with their own small shader.
// The builders here are pure (arrays only, no three.js) so tests can check them; the meshes are made in sky-island-lake.js.

export const SPILL = Object.freeze({
  grid: 1.5,                       // metres between the lake's water vertices
  margin: 5,                       // metres of water grid past the shoreline all round
  streamWidth: Object.freeze([3.0, 2.2]), // the channel's width at the lake and at the crest
  streamStep: 0.75,
  fallWidth: 2.2,                  // the fall as it leaves the lip
  mistWidth: 11,                   // how wide it has spread by the time it is mist
  mistFrom: 0.5,                   // the share of the fall's length at which it starts to widen and thin
  fallLength: 140,                 // metres from the lip down: the desert is 250 m below the top, so this ends well short of it
  fallStep: 4,
  out: 1.2, drift: 0.55,           // how far the fall stands out from the rim at depth h: out + drift * sqrt(h), metres
  clear: 3,                        // and never closer than this to the rock hanging under the island
  lift: 0.09,                      // the channel's height above the ground
});

// ---------------------------------------------------------------------------------------------------------------------------- the lake
// `ground(x, z)` is the world height of the ground; `lake` is from createLake (sky-island-places.js); `level` the water's world height.
export function buildLakeWater({ lake, ground, level, cell = SPILL.grid, margin = SPILL.margin }) {
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const p of lake.outline) {
    const { u, v } = lake.toLocal(p.x, p.z);
    uMin = Math.min(uMin, u); uMax = Math.max(uMax, u); vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
  }
  uMin -= margin; uMax += margin; vMin -= margin; vMax += margin;
  const nu = Math.ceil((uMax - uMin) / cell), nv = Math.ceil((vMax - vMin) / cell);
  const count = (nu + 1) * (nv + 1);
  const positions = new Float32Array(count * 3);
  const depth = new Float32Array(count);
  const inside = new Float32Array(count);
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const { x, z } = lake.toWorld(uMin + (i / nu) * (uMax - uMin), vMin + (j / nv) * (vMax - vMin));
      const k = j * (nu + 1) + i;
      positions[k * 3] = x; positions[k * 3 + 1] = level; positions[k * 3 + 2] = z;
      const g = ground(x, z);
      const s = lake.signed(x, z);
      inside[k] = s;
      let d = g === null ? -5 : level - g;
      // past the shoreline there is no water, however low the ground is (the spill channel's water is its own ribbon)
      if (s < 0) d = Math.min(d, -0.06);
      depth[k] = d;
    }
  }
  // only the cells that touch the lake: the rest of the grid is dry land
  const indices = [];
  const stride = nu + 1;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * stride + i, b = a + 1, c = a + stride, d = c + 1;
      if (Math.max(inside[a], inside[b], inside[c], inside[d]) < -0.2) continue;
      indices.push(a, c, b, b, c, d);
    }
  }
  return { positions, depth, indices: Uint32Array.from(indices), vertexCount: count };
}

// ---------------------------------------------------------------------------------------------------------------------------- the channel and the fall
// Returns { positions, uvs, fades, indices, spine } for one ribbon mesh: the stream from the tip of the water to the rim's crest, over the rounded
// lip, then the fall as two crossed sheets (one across the rim and one along it, so it reads from any side). In `uvs`, x runs 0 to 1 across the
// ribbon and y is the distance along the flow in metres (the shader scrolls streaks down it); `fades` is 0 to 1 opacity along the way: it comes in
// over the first metres, is full on the stream and the upper fall, and goes to nothing as the fall spreads into mist.
export function buildSpill({ lake, channel, ground, config = SKY_ISLAND, spill, spec = SPILL }) {
  const positions = [], uvs = [], fades = [], indices = [];
  const spine = [];
  const pushVertex = (x, y, z, u, v, fade) => { positions.push(x, y, z); uvs.push(u, v); fades.push(fade); return positions.length / 3 - 1; };
  const strip = (points, widthOf, axisOf, fadeOf) => {
    // points: [{ x, y, z, along }]; each gets a left and a right vertex
    let previous = -1;
    points.forEach((p, i) => {
      const w = widthOf(i) / 2;
      const [ax, az] = axisOf(i);
      const l = pushVertex(p.x - ax * w, p.y, p.z - az * w, 0, p.along, fadeOf(i));
      const r = pushVertex(p.x + ax * w, p.y, p.z + az * w, 1, p.along, fadeOf(i));
      if (previous >= 0) indices.push(previous, previous + 1, l, previous + 1, r, l);
      previous = l;
    });
  };

  // --- the channel: from the water's tip to the crest, following the carved bed
  const dx = channel.bx - channel.ax, dz = channel.bz - channel.az;
  const length = Math.hypot(dx, dz);
  const dirX = dx / length, dirZ = dz / length;
  const steps = Math.max(2, Math.ceil(length / spec.streamStep));
  const stream = [];
  let along = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = channel.ax + dx * t, z = channel.az + dz * t;
    stream.push({ x, y: ground(x, z) + spec.lift, z, along: along += length / steps });
  }
  const streamWidth = i => spec.streamWidth[0] + (spec.streamWidth[1] - spec.streamWidth[0]) * (i / steps);
  strip(stream, streamWidth, () => [-dirZ, dirX], i => Math.min(1, i / 3));
  spine.push(...stream);

  // --- the lip: the rounded edge, where the water curves over
  const cs = Math.cos(spill), sn = Math.sin(spill);
  const edge = outlineRadius(spill, config);
  const lipStart = edge - config.lip;
  const crestX = config.x + cs * lipStart, crestZ = config.z + sn * lipStart;
  const crestY = ground(crestX - cs * 0.01, crestZ - sn * 0.01);
  const lip = [];
  const lipSteps = 5;
  for (let i = 1; i <= lipSteps; i++) {
    const phi = (i / lipSteps) * (Math.PI / 2);
    const r = lipStart + config.lip * Math.sin(phi);
    const y = crestY - config.lip * (1 - Math.cos(phi)) + spec.lift * (1 - i / lipSteps);
    lip.push({ x: config.x + cs * r, y, z: config.z + sn * r, along: along + i * config.lip * 0.35 });
  }
  const lipAlong = lip[lip.length - 1].along;
  // join it to the end of the channel
  strip([stream[stream.length - 1], ...lip], i => spec.streamWidth[1] + (spec.fallWidth - spec.streamWidth[1]) * (i / lip.length), () => [-sn, cs], () => 1);
  spine.push(...lip);

  // --- the fall: two crossed vertical sheets, standing clear of the rock underneath
  const lipEnd = lip[lip.length - 1];
  const rockRadius = (h) => {
    let r = 0;
    for (const dv of [-0.03, 0, 0.03]) {
      for (const dth of [-0.02, 0, 0.02]) {
        const v = Math.min(1, Math.max(0, h / config.thickness + dv));
        r = Math.max(r, undersidePoint(spill + dth, v, lipEnd.y, config).r);
      }
    }
    return r;
  };
  const count = Math.round(spec.fallLength / spec.fallStep);
  const fall = [];
  for (let k = 0; k <= count; k++) {
    const h = k * spec.fallStep;
    const out = Math.max(spec.out + spec.drift * Math.sqrt(h), rockRadius(h) - edge + spec.clear);
    const r = edge + out;
    fall.push({ x: config.x + cs * r, y: lipEnd.y - h, z: config.z + sn * r, along: lipAlong + h });
  }
  // smooth the offset so a bulge in the rock does not kink the fall
  for (let pass = 0; pass < 3; pass++) {
    for (let k = 1; k < count; k++) {
      const a = fall[k - 1], b = fall[k], c = fall[k + 1];
      const r = (Math.hypot(a.x - config.x, a.z - config.z) + 2 * Math.hypot(b.x - config.x, b.z - config.z) + Math.hypot(c.x - config.x, c.z - config.z)) / 4;
      const rb = Math.max(r, Math.hypot(b.x - config.x, b.z - config.z) - 0.0);
      fall[k].x = config.x + cs * rb; fall[k].z = config.z + sn * rb;
    }
  }
  const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const widthOf = k => spec.fallWidth + (spec.mistWidth - spec.fallWidth) * smooth(spec.mistFrom, 1, k / count);
  const fadeOf = k => 1 - smooth(spec.mistFrom + 0.1, 1, k / count);
  strip(fall, widthOf, () => [-sn, cs], fadeOf);   // the sheet across the rim
  strip(fall, k => widthOf(k) * 0.85, () => [cs, sn], k => fadeOf(k) * 0.8); // and the one along it
  spine.push(...fall);
  return { positions: new Float32Array(positions), uvs: new Float32Array(uvs), fades: new Float32Array(fades), indices: Uint32Array.from(indices), spine, crest: { x: crestX, y: crestY, z: crestZ }, bottom: fall[fall.length - 1] };
}
