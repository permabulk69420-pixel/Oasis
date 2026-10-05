// STOPGAP levels of detail for Colossus 01: decimates Kane's lod0 into rough lod1 and lod2 files on the identical skeleton, so the game can switch
// by distance until the real lod1 and lod2 arrive. Clearly labelled (file names end in _stopgap, the glTF carries extras.stopgap = true).
//
//   cd <a folder with: npm i @gltf-transform/core @gltf-transform/extensions meshoptimizer>
//   node make_stopgap_lods.mjs colossus_01_lod0.glb out_dir
//
// How: meshoptimizer's edge-collapse simplifier, one primitive at a time, with a triangle target per material (no border locking: the pieces are closed solids, and flat-shaded ones have no shared vertices at all, which would lock every vertex). It only ever REMOVES vertices, so every
// surviving vertex keeps its own bone indices, weights, UVs, vertex colour and normal exactly (plates and crystals stay 100% on one bone), and the
// skeleton, the node names and the materials are copied untouched. Nothing is baked or re-skinned. Not a replacement for a hand-made level.
//   lod1: about 150,000 triangles; lod2: about 30,000 (the crystals are dropped: a 0.46 m crystal is under a pixel beyond about 200 m).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import path from 'node:path';
import fs from 'node:fs';

const [, , input, outDir] = process.argv;
if (!input || !outDir) { console.error('usage: node make_stopgap_lods.mjs colossus_01_lod0.glb out_dir'); process.exit(1); }
fs.mkdirSync(outDir, { recursive: true });

// triangles to keep per material, as a share of lod0's: [lod1, lod2]. 0 drops the primitive. 'every2' keeps every second whole crystal: the
// simplifier cannot thin tiny closed solids (any collapse would degenerate them), and at lod1 distances (over about 60 m) nobody can pick out one.
const KEEP = {
  1: { 'Colossus hide': 0.13, 'Colossus plate': 0.21, 'Colossus crystal': 'every2', 'Colossus glow': 0.6 },
  2: { 'Colossus hide': 0.026, 'Colossus plate': 0.05, 'Colossus crystal': 0, 'Colossus glow': 0.3 },
};

// every `step`-th closed piece (joined by shared positions) of a flat-shaded primitive, in the order the pieces first appear in the index list
function keepEveryNth(indices, positions, step) {
  const ids = new Map();
  const vid = new Int32Array(positions.length / 3);
  let n = 0;
  for (let i = 0; i < vid.length; i++) {
    const key = `${Math.round(positions[3 * i] * 1e4)},${Math.round(positions[3 * i + 1] * 1e4)},${Math.round(positions[3 * i + 2] * 1e4)}`;
    let id = ids.get(key);
    if (id === undefined) { id = n++; ids.set(key, id); }
    vid[i] = id;
  }
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let t = 0; t < indices.length; t += 3) {
    const a = find(vid[indices[t]]);
    parent[find(vid[indices[t + 1]])] = a;
    parent[find(vid[indices[t + 2]])] = a;
  }
  const rank = new Map();
  const out = [];
  for (let t = 0; t < indices.length; t += 3) {
    const root = find(vid[indices[t]]);
    if (!rank.has(root)) rank.set(root, rank.size);
    if (rank.get(root) % step === 0) out.push(indices[t], indices[t + 1], indices[t + 2]);
  }
  return Uint32Array.from(out);
}

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

for (const lod of [1, 2]) {
  const doc = await io.read(input);
  const root = doc.getRoot();
  let before = 0;
  let after = 0;
  for (const mesh of root.listMeshes()) {
    mesh.setName(mesh.getName().replace('_LOD0', `_LOD${lod}`));
    for (const prim of mesh.listPrimitives()) {
      const material = prim.getMaterial()?.getName();
      const rule = KEEP[lod][material] ?? 0.2;
      const share = typeof rule === 'number' ? rule : 1;
      const indices = prim.getIndices().getArray();
      const tris = indices.length / 3;
      before += tris;
      if (share <= 0) { mesh.removePrimitive(prim); prim.dispose(); continue; }
      const positions = prim.getAttribute('POSITION').getArray();
      const target = Math.max(12, Math.floor(tris * share)) * 3;
      // error 0.3 of the primitive's extent: the triangle target decides, not the error
      const kept = rule === 'every2' ? keepEveryNth(indices, positions, 2) : MeshoptSimplifier.simplify(new Uint32Array(indices), positions, 3, target, 0.3, [])[0];
      // keep only the vertices the new index list uses, in order, and carry every attribute across unchanged
      const remap = new Map();
      const order = [];
      for (const i of kept) if (!remap.has(i)) { remap.set(i, order.length); order.push(i); }
      for (const semantic of prim.listSemantics()) {
        const accessor = prim.getAttribute(semantic);
        const src = accessor.getArray();
        const size = accessor.getElementSize();
        const dst = new src.constructor(order.length * size);
        order.forEach((from, to) => { for (let k = 0; k < size; k++) dst[to * size + k] = src[from * size + k]; });
        accessor.setArray(dst);
      }
      const newIndices = new Uint32Array(kept.length);
      for (let i = 0; i < kept.length; i++) newIndices[i] = remap.get(kept[i]);
      prim.getIndices().setArray(order.length < 65535 ? new Uint16Array(newIndices) : newIndices);
      after += kept.length / 3;
    }
  }
  for (const node of root.listNodes()) node.setName(node.getName().replace('_LOD0', `_LOD${lod}`));
  await doc.transform(prune());
  root.setExtras({ stopgap: true, level: lod, source: path.basename(input), note: `Rough meshoptimizer decimation of Kane's lod0 on the identical skeleton, a stopgap until the real lod${lod} exists.` });
  const out = path.join(outDir, `colossus_01_lod${lod}_stopgap.glb`);
  await io.write(out, doc);
  console.log(`lod${lod}: ${before.toLocaleString()} -> ${Math.round(after).toLocaleString()} triangles, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB  ${out}`);
}
