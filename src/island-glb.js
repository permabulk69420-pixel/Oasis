import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Island models that are real .glb files (public/models/island/<name>_lod0.glb, _lod1, _lod2; Kane, 6 Oct: models are files you can open in Blender, not code that builds them).
// A file is one mesh with a primitive per material: "Leaf cards" (the painted leaf atlas) and "Bark". The game reads POSITION, NORMAL, TEXCOORD_0, COLOR_0 and the custom
// _EMIT (glow colour) and _SWAY (hanging weight); a file that lacks the custom ones just has no glow and no sway weight. The origin is the model's root, +y up.
// To swap a model: save a new file under the same name. src/island-flora.js still draws it, places it and picks its level by distance.
export const GLB_MODELS = Object.freeze(new Set(['jungleA', 'jungleB', 'jungleC']));

const cache = new Map();
export const glbLevelsFor = type => cache.get(type) ?? null;

// A parsed glTF scene as one level in the flora's own arrays: leaf primitives first, then bark (the same two groups the code-built models have).
export function levelFromScene(scene, name) {
  scene.updateMatrixWorld(true);
  const parts = [];
  scene.traverse(object => {
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
    triangles: indices.length / 3, vertexCount: vertices, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() }, halos: [], groups: hasBark ? groups : null,
  };
}

// Fetches the three levels of a model. Resolves with them (and remembers them for levelsFor); rejects if a file is missing or unreadable.
export async function loadGlbLevels(type, base = import.meta.env.BASE_URL) {
  if (cache.has(type)) return cache.get(type);
  const loader = new GLTFLoader();
  const levels = await Promise.all([0, 1, 2].map(async lod => {
    const gltf = await loader.loadAsync(`${base}models/island/${type}_lod${lod}.glb`);
    return levelFromScene(gltf.scene, `${type} lod${lod}`);
  }));
  cache.set(type, levels);
  return levels;
}
