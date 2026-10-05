import fs from 'node:fs';
import * as THREE from 'three';

// Colossus 01's real skeleton, read straight from a model file (no browser, no GLTFLoader): the bones with the rest positions and rotations the file
// gives them, under a group named like the file's own. The two stopgap levels carry exactly the same skeleton as lod0 (a 41 MB file), so tests read the
// smallest one by default. Returns { rig, holder, bones } with `holder` a Group above `rig` for the game's own transform.
export function loadColossusSkeleton(file = 'colossus_01_lod2_stopgap.glb') {
  const buf = fs.readFileSync(new URL(`../../public/models/colossus/${file}`, import.meta.url));
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
  const skin = json.skins[0];
  const joints = new Set(skin.joints);
  const bones = {};
  const make = index => {
    const node = json.nodes[index];
    const bone = new THREE.Bone();
    bone.name = node.name;
    if (node.translation) bone.position.fromArray(node.translation);
    if (node.rotation) bone.quaternion.fromArray(node.rotation);
    bones[bone.name] = bone;
    for (const child of node.children ?? []) if (joints.has(child)) bone.add(make(child));
    return bone;
  };
  const rootIndex = skin.joints.find(j => !json.nodes.some((n, i) => (n.children ?? []).includes(j) && joints.has(i)));
  const rig = new THREE.Group();
  rig.name = 'Colossus_01_Rig';
  rig.add(make(rootIndex));
  const holder = new THREE.Group();
  holder.add(rig);
  holder.updateMatrixWorld(true);
  return { rig, holder, bones, json };
}
