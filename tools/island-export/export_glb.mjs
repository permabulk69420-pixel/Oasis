// Writes island models out as real .glb files (Kane, 6 Oct: models are files you can open in Blender, not code that builds them at load).
//   node tools/island-export/export_glb.mjs jungleA jungleB jungleC     ->  public/models/island/<name>_lod0.glb, _lod1.glb, _lod2.glb   (what the game loads: no pictures inside, they are the game's own)
//   node tools/island-export/export_glb.mjs --textures --out <dir> jungleA   ->  the same files with the leaf atlas and the bark photo embedded, so any viewer or Blender shows the real tree
// UVs are glTF's (v = 0 at the top of the picture); the game's loader turns them back (src/island-glb.js).
// One mesh per level, one primitive per material: "Leaf cards" (the painted leaf atlas, `uv`) then "Bark" (the tiling bark photo). Attributes: POSITION, NORMAL, TEXCOORD_0,
// COLOR_0 (the tint multiplied into the texture), and the custom _EMIT (glow colour) and _SWAY (hanging sway weight) that the game reads. The model's origin is its root.
import fs from 'node:fs';
import path from 'node:path';
import { JUNGLE_MODELS } from '../../src/island-jungle-models.js';

const args = process.argv.slice(2);
const embed = args.includes('--textures');
const outArg = args.indexOf('--out');
const out = (outArg >= 0 ? path.resolve(args[outArg + 1]) : new URL('../../public/models/island/', import.meta.url).pathname).replace(/\/?$/, '/');
const names = args.filter((a, i) => !a.startsWith('--') && (outArg < 0 || i !== outArg + 1));
fs.mkdirSync(out, { recursive: true });
const pub = new URL('../../public/textures/', import.meta.url).pathname;
// the leaf atlas each model wears, and the bark photo (same files the game uses, src/island-flora.js)
const LEAF_ATLAS = { canopy: 'island-leaves/canopy.png' };
const BARK = { colour: 'bark/jungle_bark_colour.jpg', normal: 'bark/jungle_bark_normal.jpg' };

function glb(level, atlas = 'canopy') {
  const bin = [], views = [], accessors = [];
  const push = (typed, target) => {
    const bytes = Buffer.isBuffer(typed) ? typed : Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const offset = bin.reduce((n, b) => n + b.length, 0);
    bin.push(bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4));
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
    return views.length - 1;
  };
  const accessor = (typed, componentType, type, count, extra = {}) => { accessors.push({ bufferView: push(typed, extra.target), componentType, count, type, ...extra.rest }); return accessors.length - 1; };
  const split = (from, to) => {
    // the vertices a group of triangles uses, renumbered from 0 (a primitive carries its own vertices, as Blender's export does)
    const idx = level.indices.slice(from, from + to), map = new Map(), used = [];
    for (const v of idx) if (!map.has(v)) { map.set(v, used.length); used.push(v); }
    const take = (src, n) => { const a = new Float32Array(used.length * n); used.forEach((v, i) => a.set(src.subarray(v * n, v * n + n), i * n)); return a; };
    return { used, positions: take(level.positions, 3), normals: take(level.normals, 3), uvs: take(level.uvs, 2).map((v, i) => (i % 2 ? 1 - v : v)), colors: take(level.colors, 3), emits: take(level.emits, 3), sways: take(level.sways, 1), indices: Uint32Array.from(idx, v => map.get(v)) };
  };
  const groups = level.groups ?? [{ start: 0, count: level.indices.length, material: 0 }];
  const primitives = groups.map(g => {
    const p = split(g.start, g.count);
    let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < p.positions.length; k += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p.positions[k + a]); max[a] = Math.max(max[a], p.positions[k + a]); }
    const n = p.used.length;
    return {
      attributes: {
        POSITION: accessor(p.positions, 5126, 'VEC3', n, { target: 34962, rest: { min, max } }),
        NORMAL: accessor(p.normals, 5126, 'VEC3', n, { target: 34962 }),
        TEXCOORD_0: accessor(p.uvs, 5126, 'VEC2', n, { target: 34962 }),
        COLOR_0: accessor(p.colors, 5126, 'VEC3', n, { target: 34962 }),
        _EMIT: accessor(p.emits, 5126, 'VEC3', n, { target: 34962 }),
        _SWAY: accessor(p.sways, 5126, 'SCALAR', n, { target: 34962 }),
      },
      indices: accessor(p.indices, 5125, 'SCALAR', p.indices.length, { target: 34963 }),
      material: g.material,
    };
  });
  const images = embed ? [LEAF_ATLAS[atlas], BARK.colour, BARK.normal].map(file => { const bytes = fs.readFileSync(pub + file); return { bufferView: push(bytes, 0), mimeType: file.endsWith('.png') ? 'image/png' : 'image/jpeg', name: path.basename(file) }; }) : [];
  const json = {
    asset: { version: '2.0', generator: 'oasis island export' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: level.name, mesh: 0 }],
    materials: [
      { name: 'Leaf cards', doubleSided: true, alphaMode: 'MASK', alphaCutoff: 0.42, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1, ...(embed ? { baseColorTexture: { index: 0 } } : {}) } },
      { name: 'Bark', ...(embed ? { normalTexture: { index: 2 } } : {}), pbrMetallicRoughness: { baseColorFactor: embed ? [1, 1, 1, 1] : [0.4, 0.3, 0.22, 1], metallicFactor: 0, roughnessFactor: 1, ...(embed ? { baseColorTexture: { index: 1 } } : {}) } },
    ],
    ...(embed ? { samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }], textures: images.map((_, i) => ({ sampler: 0, source: i })), images } : {}),
    meshes: [{ name: level.name, primitives }],
    accessors, bufferViews: views, buffers: [{ byteLength: bin.reduce((n, b) => n + b.length, 0) }],
  };
  let jsonBytes = Buffer.from(JSON.stringify(json));
  jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20)]);
  const binBytes = Buffer.concat(bin);
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + binBytes.length, 8);
  const chunk = (type, data) => { const h = Buffer.alloc(8); h.writeUInt32LE(data.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, data]); };
  return Buffer.concat([header, chunk(0x4e4f534a, jsonBytes), chunk(0x004e4942, binBytes)]);
}

for (const name of names) {
  const model = JUNGLE_MODELS[name];
  if (!model) throw new Error(`no model called ${name}`);
  for (let lod = 0; lod < 3; lod++) {
    const level = model.build(lod).finish();
    const file = `${out}${name}_lod${lod}.glb`;
    fs.writeFileSync(file, glb(level));
    console.log(`${name}_lod${lod}.glb  ${level.triangles} triangles  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
  }
}
