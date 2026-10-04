import fs from 'node:fs';
import * as THREE from 'three';

// The dune stinger's real skeleton and skin, read straight from a model file (no browser), so a pose can be checked in metres.
// Returns the bone hierarchy (a THREE.Group holding the Root bone, with the rest positions) and, for each vertex, its position and the bone
// that moves it most. `tipOf(bone)` is the vertex of that bone furthest from the bone's own origin (the sting's point, a claw's tip).
export function loadStingerModel(level = 0) {
  const buf = fs.readFileSync(new URL(`../../public/models/creatures/dune_stinger_lod${level}.glb`, import.meta.url));
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
  const bin = buf.subarray(20 + jsonLength + 8);
  const read = index => {
    const a = json.accessors[index];
    const view = json.bufferViews[a.bufferView];
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const Type = { 5126: Float32Array, 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array }[a.componentType];
    const stride = view.byteStride || width * Type.BYTES_PER_ELEMENT;
    const start = (view.byteOffset || 0) + (a.byteOffset || 0);
    return Array.from({ length: a.count }, (_, k) => Array.from({ length: width }, (_, c) => {
      const at = start + k * stride + c * Type.BYTES_PER_ELEMENT;
      return a.componentType === 5126 ? bin.readFloatLE(at) : a.componentType === 5121 ? bin.readUInt8(at) : a.componentType === 5123 ? bin.readUInt16LE(at) : bin.readUInt32LE(at);
    }));
  };
  const positions = [];
  const owners = [];
  const skin = json.skins[0];
  const names = skin.joints.map(j => json.nodes[j].name);
  for (const primitive of json.meshes[0].primitives) {
    const p = read(primitive.attributes.POSITION);
    const joints = read(primitive.attributes.JOINTS_0);
    const weights = read(primitive.attributes.WEIGHTS_0);
    p.forEach((point, k) => {
      let best = 0;
      for (let c = 1; c < 4; c++) if (weights[k][c] > weights[k][best]) best = c;
      positions.push(new THREE.Vector3(...point));
      owners.push(names[joints[k][best]]);
    });
  }
  const jointSet = new Set(skin.joints);
  const make = index => {
    const node = json.nodes[index];
    const bone = new THREE.Bone();
    bone.name = node.name;
    if (node.translation) bone.position.fromArray(node.translation);
    for (const child of node.children ?? []) if (jointSet.has(child)) bone.add(make(child));
    return bone;
  };
  const rootIndex = skin.joints.find(j => !json.nodes.some((n, i) => (n.children ?? []).includes(j) && jointSet.has(i)));
  const group = new THREE.Group();
  group.add(make(rootIndex));
  group.updateMatrixWorld(true);
  const restOrigin = {};
  group.traverse(o => { if (o.isBone) restOrigin[o.name] = o.getWorldPosition(new THREE.Vector3()); });
  // furthest vertex of each bone from its origin, in the bone's own frame (rest rotations are identity, so that is a plain difference)
  const tips = {};
  positions.forEach((p, k) => {
    const name = owners[k];
    const local = p.clone().sub(restOrigin[name]);
    if (!tips[name] || local.length() > tips[name].length()) tips[name] = local;
  });
  return { group, names, positions, owners, restOrigin, tipOf: name => tips[name].clone() };
}
