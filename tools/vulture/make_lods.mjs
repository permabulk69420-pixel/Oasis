// Levels of detail for the alien vulture: simplifies the owner's model (lod0, copied unchanged) into lod1 and lod2 on the identical skeleton.
//
//   cd <a folder with: npm i @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer>
//   node make_lods.mjs Alien_Vulture.glb public/models/creatures
//
// The model is partly flat shaded (its faces do not share vertices), which would stop the simplifier collapsing anything, so the faces are joined
// where they share a position first; every surviving vertex keeps its own bone indices, weights, UV and colour, and the normals are made smooth
// (from a distance a smooth bird reads better than a faceted one). Nothing is re-skinned; the skeleton and node names are copied untouched.
//   lod1: about 35% of the triangles; lod2: about 12%.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';

const [, , input, outDir] = process.argv;
if (!input || !outDir) { console.error('usage: node make_lods.mjs Alien_Vulture.glb out_dir'); process.exit(1); }
const KEEP = { 1: 0.35, 2: 0.12 };

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(input, path.join(outDir, 'alien_vulture_lod0.glb'));

for (const lod of [1, 2]) {
  const doc = await io.read(input);
  let before = 0, after = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const positions = prim.getAttribute('POSITION').getArray();
      const n = positions.length / 3;
      const source = prim.getIndices() ? prim.getIndices().getArray() : Uint32Array.from({ length: n }, (_, i) => i);
      // one vertex for each position: the first one found there
      const first = new Map();
      const canon = new Uint32Array(n);
      for (let i = 0; i < n; i++) {
        const key = `${Math.round(positions[3 * i] * 1e5)},${Math.round(positions[3 * i + 1] * 1e5)},${Math.round(positions[3 * i + 2] * 1e5)}`;
        if (!first.has(key)) first.set(key, i);
        canon[i] = first.get(key);
      }
      const joined = Uint32Array.from(source, i => canon[i]);
      const target = Math.max(3, Math.floor(joined.length * KEEP[lod] / 3) * 3);
      const [kept] = MeshoptSimplifier.simplify(joined, Float32Array.from(positions), 3, target, 1, ['Sparse']) // Sparse: only the joined vertices are used, the rest of the array is ignored;
      // only the vertices still used, in order
      const remap = new Int32Array(n).fill(-1);
      const order = [];
      const indices = new Uint32Array(kept.length);
      for (let k = 0; k < kept.length; k++) {
        const v = kept[k];
        if (remap[v] < 0) { remap[v] = order.length; order.push(v); }
        indices[k] = remap[v];
      }
      for (const semantic of prim.listSemantics()) {
        const accessor = prim.getAttribute(semantic);
        const size = accessor.getElementSize();
        const array = accessor.getArray();
        const out = new array.constructor(order.length * size);
        order.forEach((v, j) => { for (let c = 0; c < size; c++) out[j * size + c] = array[v * size + c]; });
        const fresh = doc.createAccessor().setType(accessor.getType()).setArray(out).setNormalized(accessor.getNormalized()).setBuffer(accessor.getBuffer());
        prim.setAttribute(semantic, fresh);
      }
      // smooth normals, from the faces round each vertex
      const pos = prim.getAttribute('POSITION').getArray();
      const normals = new Float32Array(order.length * 3);
      for (let k = 0; k < indices.length; k += 3) {
        const [a, b, c] = [indices[k], indices[k + 1], indices[k + 2]];
        const ux = pos[3 * b] - pos[3 * a], uy = pos[3 * b + 1] - pos[3 * a + 1], uz = pos[3 * b + 2] - pos[3 * a + 2];
        const vx = pos[3 * c] - pos[3 * a], vy = pos[3 * c + 1] - pos[3 * a + 1], vz = pos[3 * c + 2] - pos[3 * a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const v of [a, b, c]) { normals[3 * v] += nx; normals[3 * v + 1] += ny; normals[3 * v + 2] += nz; }
      }
      for (let v = 0; v < order.length; v++) {
        const l = Math.hypot(normals[3 * v], normals[3 * v + 1], normals[3 * v + 2]) || 1;
        normals[3 * v] /= l; normals[3 * v + 1] /= l; normals[3 * v + 2] /= l;
      }
      if (prim.getAttribute('NORMAL')) prim.getAttribute('NORMAL').setArray(normals);
      prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(order.length > 65535 ? indices : Uint16Array.from(indices)).setBuffer(prim.getAttribute('POSITION').getBuffer()));
      before += source.length / 3;
      after += indices.length / 3;
    }
  }
  await doc.transform(prune());
  const out = path.join(outDir, `alien_vulture_lod${lod}.glb`);
  await io.write(out, doc);
  console.log(`lod${lod}: ${before} -> ${after} triangles, ${Math.round(fs.statSync(out).size / 1024)} KB`);
}
