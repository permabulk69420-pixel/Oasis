import { noise, clamp, mix, smooth } from './world-math.js';

// A floating island (Kane, 5 Oct: a big lush home high above the desert, glide down to explore; nothing about how you get there is decided).
// This file is the pure shape: no three.js, so tests can run it. src/sky-island.js turns it into a mesh.
//
// The island is one surface of revolution, bent out of true by noise: a grassy top, a rounded lip, then a rocky underside
// that narrows to a point like an upside-down mountain. Rings run from the centre of the top, out to the lip, round it and down
// to the tip; each ring has the same number of steps around. The top's height is an exact function (`topHeight`), so walking
// on it later can use the same numbers as the picture.

export const SKY_ISLAND = Object.freeze({
  x: -150, z: 700,         // centre, metres. South-west of the pond, opposite the colossus plain (Kane's idea: far from the colossi)
  radius: 250,             // mean radius at the lip (about 500 m across)
  altitude: 250,           // the top's height above the desert at its centre
  thickness: 190,          // from the lip down to the lowest point
  relief: 7,               // hills on the top, metres
  dome: 6,                 // the top is a little higher in the middle
  lip: 5,                  // radius of the rounded edge
  around: 320,             // steps round
  topRings: 84, lipRings: 6, underRings: 78,
  seed: 11,
});

const TAU = Math.PI * 2;

function hash3(x, y, z) {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + 1337;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
// Smooth value noise in three dimensions, 0 to 1.
export function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = smooth(0, 1, x - ix), fy = smooth(0, 1, y - iy), fz = smooth(0, 1, z - iz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), fx), l(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), fx), fy),
    l(l(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), fx), l(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), fx), fy),
    fz);
}
function fbm3(x, y, z, seed) {
  return 0.55 * noise3(x + seed, y, z - seed) + 0.28 * noise3(x * 2.1 + 5, y * 2.1 - seed, z * 2.1) + 0.17 * noise3(x * 4.3 - 3, y * 4.3, z * 4.3 + seed);
}

// Noise that closes up round a circle (it is sampled on the circle, so there is no seam at angle 0).
function circle(theta, k, ox, oy, shift = 0) {
  return noise(Math.cos(theta) * k + ox + shift, Math.sin(theta) * k + oy + shift * 0.7);
}

// The island's radius at an angle: lobed, not round.
export function outlineRadius(theta, config = SKY_ISLAND) {
  const s = config.seed;
  const n = 0.62 * circle(theta, 1.15, s * 3.1, s * 1.7) + 0.38 * circle(theta, 2.6, s * 5.3, s * 2.9);
  return config.radius * (0.74 + 0.52 * n);
}

// Height of the top surface above the top's reference level, at a point as a fraction (rho) of the way to the lip.
// The hills die away towards the edge so the lip is a clean line.
export function topOffset(x, z, rho, config = SKY_ISLAND) {
  const s = config.seed;
  const broad = (noise(x / 95 + s, z / 95 - s) - 0.5) * 2;
  const fine = (noise(x / 31 - s * 2, z / 31 + s) - 0.5) * 2;
  const fade = 1 - smooth(0.70, 0.96, rho);
  const dome = config.dome * (1 - rho * rho);
  return dome + (broad * 0.8 + fine * 0.2) * config.relief * fade;
}

// The underside's pull-in and fins at an angle and a depth fraction v (0 at the lip, 1 at the tip).
function finRidge(theta, v, config) {
  const s = config.seed;
  const a = 1 - Math.abs(2 * circle(theta, 3.4, s * 7.1, s * 4.3, v * 0.55) - 1); // big fins
  const b = 1 - Math.abs(2 * circle(theta, 8.5, s * 2.3, s * 6.1, v * 1.1) - 1);  // small ones
  return a * 0.65 + b * 0.35;
}

function underRadius(v) { return Math.pow(1 - Math.pow(v, 1.2), 1.05); } // close to a cone, a little fuller at the top

// Where the ground is on top at (x, z), metres above the island's reference level, or null outside the top's edge.
export function topGround(x, z, config = SKY_ISLAND) {
  const dx = x - config.x, dz = z - config.z;
  const dist = Math.hypot(dx, dz);
  const theta = Math.atan2(dz, dx);
  const edge = outlineRadius(theta, config);
  const rho = dist / edge;
  if (rho > 1 - config.lip / edge) return null;
  return topOffset(x, z, rho, config);
}

// Everything the mesh needs, as plain arrays. `baseY` is the world height of the top's reference level.
export function buildIsland(baseY, config = SKY_ISLAND) {
  const A = config.around;
  const rings = []; // each ring: { pole: true, y, ... } or a row of A points built below
  const total = 1 + config.topRings + config.lipRings + config.underRings + 1;
  const positions = new Float32Array((total - 2) * A * 3 + 6);
  const colors = new Float32Array(positions.length);
  const zones = new Float32Array(positions.length);
  const indices = [];
  let w = 0;
  const put = (x, y, z, grass, rock, gv) => {
    positions[w * 3] = x; positions[w * 3 + 1] = y; positions[w * 3 + 2] = z;
    colors[w * 3] = 1; colors[w * 3 + 1] = gv; colors[w * 3 + 2] = grass;
    zones[w * 3] = rock;
    return w++;
  };
  const ringStart = [];
  const patchy = (x, z) => smooth(0.70, 0.82, noise(x / 42 + 7, z / 42 - 5));
  const variation = (x, z) => noise(x * 0.019 + 9, z * 0.019);

  // pole at the middle of the top
  const topCentre = put(config.x, baseY + topOffset(config.x, config.z, 0, config), config.z, 1, 0, variation(config.x, config.z));
  ringStart.push(topCentre);

  const lipRing0 = config.topRings; // index of the last top ring (the lip's start)
  const rowCount = config.topRings + config.lipRings + config.underRings;
  for (let i = 1; i <= rowCount; i++) {
    ringStart.push(w);
    for (let j = 0; j < A; j++) {
      const theta = (j / A) * TAU;
      const c = Math.cos(theta), s = Math.sin(theta);
      const edge = outlineRadius(theta, config);
      const lipStart = edge - config.lip; // radius where the rounding begins
      let r, y, grass, rock, nearX, nearZ;
      if (i <= config.topRings) {
        r = (i / config.topRings) * lipStart;
        const x = config.x + c * r, z = config.z + s * r;
        const rho = r / edge;
        y = baseY + topOffset(x, z, rho, config);
        const rockPatch = patchy(x, z) * (1 - smooth(0.80, 0.97, rho) * 0.5);
        grass = 1 - rockPatch * 0.92;
        rock = rockPatch;
      } else if (i <= config.topRings + config.lipRings) {
        const phi = ((i - config.topRings) / config.lipRings) * (Math.PI / 2);
        const x0 = config.x + c * lipStart, z0 = config.z + s * lipStart;
        const yLip = baseY + topOffset(x0, z0, lipStart / edge, config);
        r = lipStart + config.lip * Math.sin(phi);
        y = yLip - config.lip * (1 - Math.cos(phi));
        const t = phi / (Math.PI / 2);
        grass = 1 - smooth(0.0, 0.85, t);
        rock = smooth(0.0, 0.7, t);
      } else {
        const v = (i - config.topRings - config.lipRings) / config.underRings;
        const x0 = config.x + c * (edge - config.lip), z0 = config.z + s * (edge - config.lip);
        const yLip = baseY + topOffset(x0, z0, (edge - config.lip) / edge, config) - config.lip;
        // An upside-down mountain: ledges (the radius steps in, at different heights round the island), fins, then lumps cut in with 3D noise.
        const fin = finRidge(theta, v, config);
        const phase = circle(theta, 1.9, config.seed * 1.3, config.seed * 0.7);
        const K = 9;
        const q = v * K + phase * 0.9;
        const stair = Math.floor(q) + smooth(0.74, 1.0, q - Math.floor(q));
        const vEff = mix(v, clamp((stair - phase * 0.9) / K, 0, 1), 0.7 * smooth(0.04, 0.25, v));
        const amount = smooth(0.02, 0.4, v) * (1 - 0.3 * v);
        let radial = underRadius(vEff) * (1 - 0.30 * amount * (1 - fin)) + 0.05 * amount * fin;
        const yBase = yLip - config.thickness * v;
        const px = c * edge * radial, pz = s * edge * radial;
        const lump = fbm3((config.x + px) / 58, yBase / 58, (config.z + pz) / 58, config.seed) - 0.5;
        const chunk = fbm3((config.x + px) / 17, yBase / 17, (config.z + pz) / 17, config.seed * 3) - 0.5;
        const rough = 0.46 * lump + 0.14 * chunk;
        const ramp = smooth(0.0, 0.09, v) * (1 - 0.6 * smooth(0.85, 1.0, v));
        // the lumps fade out towards the tip, and the radius never collapses to nothing (that pinched the mesh into zero-area faces)
        const tipFade = Math.min(1, 0.12 + radial * 3);
        radial = Math.max(radial + rough * ramp * tipFade, radial * 0.35);
        r = edge * radial;
        y = yBase + 8 * chunk * ramp + 22 * lump * ramp;
        grass = 0; rock = 1;
      }
      const x = config.x + c * r, z = config.z + s * r;
      put(x, y, z, grass, rock, variation(x, z));
    }
  }
  // pole at the tip
  const tipY = baseY - config.lip - config.thickness;
  const tip = put(config.x, tipY, config.z, 0, 1, 0.5);

  // faces: a fan round the top pole, quads between rings, a fan round the tip pole
  for (let j = 0; j < A; j++) {
    const j2 = (j + 1) % A;
    indices.push(topCentre, ringStart[1] + j2, ringStart[1] + j);
  }
  for (let i = 1; i < rowCount; i++) {
    const a = ringStart[i], b = ringStart[i + 1];
    for (let j = 0; j < A; j++) {
      const j2 = (j + 1) % A;
      indices.push(a + j, a + j2, b + j, a + j2, b + j2, b + j);
    }
  }
  const last = ringStart[rowCount];
  for (let j = 0; j < A; j++) {
    const j2 = (j + 1) % A;
    indices.push(last + j, last + j2, tip);
  }

  // smooth normals: area-weighted sum of the faces round each point
  const normals = new Float32Array(positions.length);
  for (let f = 0; f < indices.length; f += 3) {
    const ia = indices[f] * 3, ib = indices[f + 1] * 3, ic = indices[f + 2] * 3;
    const ux = positions[ib] - positions[ia], uy = positions[ib + 1] - positions[ia + 1], uz = positions[ib + 2] - positions[ia + 2];
    const vx = positions[ic] - positions[ia], vy = positions[ic + 1] - positions[ia + 1], vz = positions[ic + 2] - positions[ia + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [ia, ib, ic]) { normals[k] += nx; normals[k + 1] += ny; normals[k + 2] += nz; }
  }
  for (let k = 0; k < normals.length; k += 3) {
    const len = Math.hypot(normals[k], normals[k + 1], normals[k + 2]) || 1;
    normals[k] /= len; normals[k + 1] /= len; normals[k + 2] /= len;
  }
  return { positions, normals, colors, zones, indices: Uint32Array.from(indices), vertexCount: w };
}

export { clamp, mix };
