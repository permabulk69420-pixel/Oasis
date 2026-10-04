import * as THREE from 'three';

// Shared surface textures: the detail on bark and on leaves, drawn in code (no image files, no extra downloads) and meant to be
// reused by every model that has the same material: the palms now, later trees, logs, planks and so on. They hold only
// *detail* (a grey that multiplies the vertex colours the models already carry), so each model keeps its own colours and the
// same bark can sit on a teal trunk or a brown log.
//
// UV rules the models follow, so one texture fits them all:
//   bark  u runs once round the trunk, v is height in metres * BARK.tilesPerMetre (so the grain is the same size on every tree)
//   leaf  u runs across the leaf (the midrib is at 0.5), v runs along it once, tip at 1
//
// Both are seamless, small (128 x 128 and 64 x 128 grey pixels), mip-mapped, and cached: one texture each however many trees.

export const BARK = Object.freeze({
  size: 128,
  tilesPerMetre: 2, // v repeats every half metre of trunk
  fibreCells: 22, // fibres round the tile (many thin vertical streaks)
  fibreLength: 3, // cells down the tile: long streaks
  scarRows: 14, // faint horizontal scars per tile
  mean: 0.81, // the average grey; materials are brightened by 1/mean so the vertex colours keep their brightness
});

export const LEAF = Object.freeze({
  width: 64,
  height: 128,
  veins: 9, // fine veins on each side of the midrib
  ribWidth: 0.05,
  mean: 0.75,
});

// Which texture goes on which material name in the models (the glTF material names).
export const SURFACE_BY_MATERIAL = Object.freeze({
  'Banded teal bark': 'bark',
  'Waxy blue leaf tissue': 'leaf',
});

// A hash of two integers to [0, 1), the same everywhere.
function hash2(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Value noise that repeats every `px` cells across and `py` cells down (so the texture tiles).
function tileNoise(x, y, px, py, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const wrap = (v, p) => ((v % p) + p) % p;
  const a = hash2(wrap(x0, px), wrap(y0, py), seed);
  const b = hash2(wrap(x0 + 1, px), wrap(y0, py), seed);
  const c = hash2(wrap(x0, px), wrap(y0 + 1, py), seed);
  const d = hash2(wrap(x0 + 1, px), wrap(y0 + 1, py), seed);
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
}

const clamp01 = v => Math.min(1, Math.max(0, v));

// Bark: long vertical fibres, a few lumps, and faint dark scars across. Returns size*size greys in [0, 1].
export function barkGrey(u, v) {
  const f = BARK.fibreCells, l = BARK.fibreLength;
  const fibres = tileNoise(u * f, v * l, f, l, 1) * 0.65 + tileNoise(u * f * 2, v * l * 2, f * 2, l * 2, 2) * 0.35;
  const lumps = tileNoise(u * 5, v * 4, 5, 4, 3);
  // scars: thin dark lines across the trunk that wander and break up
  const rows = BARK.scarRows;
  const wander = tileNoise(u * 6, v * 2, 6, 2, 4) * 1.4;
  const line = Math.abs(((v * rows + wander) % 1 + 1) % 1 - 0.5); // 0 on a scar line
  const breaks = tileNoise(u * 9, v * rows, 9, rows, 5);
  const scar = (1 - clamp01(line / 0.07)) * clamp01((breaks - 0.35) * 3);
  const grey = 0.60 + 0.30 * fibres + 0.12 * lumps - 0.32 * scar;
  return clamp01(grey);
}

// A leaf: a light midrib, fine veins slanting out from it toward the tip, and a little noise.
export function leafGrey(u, v) {
  const across = Math.abs(u - 0.5) * 2; // 0 on the midrib, 1 at the edge
  const rib = Math.exp(-(across * across) / (LEAF.ribWidth * LEAF.ribWidth * 4));
  const slant = across * LEAF.veins - v * 3.0; // veins lean toward the tip
  const vein = 0.5 + 0.5 * Math.cos(slant * Math.PI * 2);
  const grain = tileNoise(u * 12, v * 24, 12, 24, 7);
  const edge = 1 - 0.12 * Math.pow(across, 3);
  const grey = (0.64 + 0.14 * vein + 0.10 * grain) * edge + 0.10 * rib;
  return clamp01(grey);
}

function greyToRGBA(width, height, fn) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const g = Math.round(fn((x + 0.5) / width, (y + 0.5) / height) * 255);
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = g;
      data[i + 3] = 255;
    }
  }
  return data;
}

export function barkPixels() { return greyToRGBA(BARK.size, BARK.size, barkGrey); }
export function leafPixels() { return greyToRGBA(LEAF.width, LEAF.height, leafGrey); }

function makeTexture(data, width, height, wrapU) {
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.wrapS = wrapU;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace; // detail to multiply, not a colour
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

const cache = {};

// The shared texture of a kind ('bark' or 'leaf'); built once.
export function surfaceTexture(kind) {
  if (cache[kind]) return cache[kind];
  if (kind === 'bark') cache.bark = makeTexture(barkPixels(), BARK.size, BARK.size, THREE.RepeatWrapping);
  else if (kind === 'leaf') cache.leaf = makeTexture(leafPixels(), LEAF.width, LEAF.height, THREE.ClampToEdgeWrapping);
  else throw new Error(`No surface texture called ${kind}`);
  cache[kind].name = `Shared ${kind} detail`;
  return cache[kind];
}

const MEAN = Object.freeze({ bark: BARK.mean, leaf: LEAF.mean });

// Put the shared textures on the materials of a loaded model that have a known name (SURFACE_BY_MATERIAL). Call it before the
// model is first drawn. Materials with other names are left alone.
export function applySurfaceTextures(root) {
  const done = new Set();
  root.traverse(object => {
    const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
    for (const material of materials) {
      const kind = SURFACE_BY_MATERIAL[material.name];
      if (!kind || done.has(material)) continue;
      done.add(material);
      material.map = surfaceTexture(kind);
      material.emissiveMap = material.map; // the models' small light of their own carries the detail too, so the shaded side is not flat
      material.color.setScalar(1 / MEAN[kind]);
      material.needsUpdate = true;
    }
  });
}
