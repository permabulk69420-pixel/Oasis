import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Every island plant, tree and landmark is a real .glb file (Kane, 6 Oct: models are built in headless Blender and saved as files, never built by code in
// the game): public/models/island/<name>_lod0.glb, _lod1, _lod2, made by tools/island-models/build.py. src/island-flora.js draws them, places them and picks
// the level by distance; this reads a file into the flora's own arrays.
// A file is one mesh with a primitive per material: "Leaf cards" (the painted leaf atlas) or "Body" (plain colour) first, then "Bark" (the tiling bark photo).
// Attributes: POSITION, NORMAL, TEXCOORD_0, COLOR_0 (shading baked in), and the custom _EMIT (glow colour) and _SWAY (hanging weight); a file without the custom
// ones has no glow and no sway. Empty nodes named halo_cyan / halo_pale mark the soft night halos (their scale is the radius). The origin is the root, +y up.
// To change a model: rebuild it (or edit it in Blender) and save it under the same name.

const cache = new Map();
export const glbLevelsFor = type => cache.get(type) ?? null;

// A parsed glTF scene as one level in the flora's own arrays: leaf (or body) primitives first, then bark.
export function levelFromScene(scene, name) {
  scene.updateMatrixWorld(true);
  const parts = [], halos = [];
  const at = new THREE.Vector3(), size = new THREE.Vector3();
  scene.traverse(object => {
    const halo = /^halo_(cyan|pale)/.exec(object.name);
    if (halo && !object.isMesh) {
      object.matrixWorld.decompose(at, new THREE.Quaternion(), size);
      halos.push({ x: at.x, y: at.y, z: at.z, r: size.x, tone: halo[1] });
      return;
    }
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    parts.push({ geometry: object.geometry.clone().applyMatrix4(object.matrixWorld), bark: /bark/i.test(materials[0]?.name ?? '') });
  });
  parts.sort((a, b) => Number(a.bark) - Number(b.bark));
  const vertices = parts.reduce((n, p) => n + p.geometry.attributes.position.count, 0);
  const positions = new Float32Array(vertices * 3), normals = new Float32Array(vertices * 3), uvs = new Float32Array(vertices * 2), colors = new Float32Array(vertices * 3).fill(1);
  const emits = new Float32Array(vertices * 3), sways = new Float32Array(vertices);
  const indices = [], groups = [];
  let offset = 0;
  const copy = (attribute, target, size, at) => {
    if (!attribute) return;
    for (let i = 0; i < attribute.count; i++) for (let k = 0; k < size; k++) target[(at + i) * size + k] = [attribute.getX, attribute.getY, attribute.getZ][k].call(attribute, i);
  };
  for (const { geometry, bark } of parts) {
    const a = geometry.attributes, n = a.position.count, start = indices.length;
    copy(a.position, positions, 3, offset); copy(a.normal, normals, 3, offset); copy(a.uv, uvs, 2, offset); copy(a.color, colors, 3, offset);
    for (let i = offset; i < offset + n; i++) uvs[i * 2 + 1] = 1 - uvs[i * 2 + 1];                 // glTF's v runs down the picture, the game's runs up
    copy(a._emit, emits, 3, offset); copy(a._sway, sways, 1, offset);
    const source = geometry.index ? geometry.index.array : Uint32Array.from({ length: n }, (_, i) => i);
    for (const v of source) indices.push(v + offset);
    const material = bark ? 1 : 0, last = groups[groups.length - 1];
    if (last && last.material === material) last.count += indices.length - start; else groups.push({ start, count: indices.length - start, material });
    offset += n;
  }
  const bounds = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(positions, 3));
  const hasBark = groups.some(g => g.material === 1);
  return {
    name, positions, normals, colors, emits, sways, uvs, indices: vertices > 65535 ? Uint32Array.from(indices) : Uint16Array.from(indices),
    triangles: indices.length / 3, vertexCount: vertices, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() }, halos, groups: hasBark ? groups : null,
  };
}

// Fetches the three levels of a model. Resolves with them (and remembers them for glbLevelsFor); rejects if a file is missing or unreadable.
const pending = new Map();
export function loadGlbLevels(type, base = import.meta.env.BASE_URL) {
  if (cache.has(type)) return Promise.resolve(cache.get(type));
  if (!pending.has(type)) {
    const loader = new GLTFLoader();
    pending.set(type, Promise.all([0, 1, 2].map(async lod => {
      const gltf = await loader.loadAsync(`${base}models/island/${type}_lod${lod}.glb`);
      return levelFromScene(gltf.scene, `${type} lod${lod}`);
    })).then(levels => { cache.set(type, levels); return levels; }));
  }
  return pending.get(type);
}
