import * as THREE from 'three';

// Many copies of one model with levels of detail, drawn instanced (the island's palms: about 90 of them, each of which used to be its own THREE.LOD with its own two
// draw calls, so the grove alone was well over a hundred). Here every level is one InstancedMesh per part of the model (a palm is a trunk and its fronds), so ANY number
// of copies costs at most levels x parts draw calls (6 for the palms). Materials and geometry are the loaded model's own, shared, so whatever was done to them (the wind
// sway, the surface textures) still works: the wind code already reads the instance matrix.
//
// The level a copy is drawn at is picked by its distance from the eye exactly as THREE.LOD picked it (the last level whose distance has been reached), so nothing about how
// they look changes. Only a change of level rewrites the instance matrices; the rest of the time an update is one distance per copy.
// Nothing is culled by view (a copy behind you is drawn at its level). At 560 to 5,900 triangles a palm that costs less than rebuilding the instances whenever you turn your head.

// The level for a distance: thresholds[i] is the distance level i starts at (the first is 0). Same rule as THREE.LOD.
export function pickLevel(distance, thresholds) {
  let level = 0;
  for (let i = 1; i < thresholds.length; i++) {
    if (distance >= thresholds[i]) level = i; else break;
  }
  return level;
}

const matrix = new THREE.Matrix4();
const partMatrix = new THREE.Matrix4();
const rotation = new THREE.Quaternion();
const position = new THREE.Vector3();
const size = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// levels: [{ source (an Object3D, the loaded model of this level), distanceFor(scale) -> metres the level starts at for a copy of that scale }].
// items: [{ x, y, z (where the foot is), yaw, scale }]. Returns { group, update(x, y, z), levelOf, counts, drawCalls() }.
export function createInstancedLods({ name = 'Instanced levels', levels, items }) {
  const group = new THREE.Group();
  group.name = name;
  const total = items.length;
  const thresholds = items.map(item => levels.map((level, l) => (l === 0 ? 0 : level.distanceFor(item.scale ?? 1))));

  const rigs = levels.map((level, l) => {
    level.source.updateMatrixWorld(true);
    const parts = [];
    level.source.traverse(object => {
      if (object.isMesh) parts.push({ geometry: object.geometry, material: object.material, local: object.matrixWorld.clone() });
    });
    const meshes = parts.map((part, p) => {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, Math.max(total, 1));
      mesh.name = `${name} level ${l}${parts.length > 1 ? ` part ${p}` : ''}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false; // the copies are all over the island and move between levels; nothing to cull against
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.count = 0;
      mesh.visible = false;
      group.add(mesh);
      return mesh;
    });
    return { parts, meshes };
  });

  const levelOf = new Int8Array(total).fill(-1);
  const counts = new Array(levels.length).fill(0);

  // x, y, z: where the eye is. Returns true when any copy changed level (and the matrices were rewritten).
  function update(x, y, z) {
    let changed = false;
    for (let i = 0; i < total; i++) {
      const item = items[i];
      const level = pickLevel(Math.hypot(x - item.x, y - item.y, z - item.z), thresholds[i]);
      if (level !== levelOf[i]) { levelOf[i] = level; changed = true; }
    }
    if (!changed) return false;
    counts.fill(0);
    for (let i = 0; i < total; i++) {
      const l = levelOf[i];
      const slot = counts[l]++;
      const item = items[i];
      rotation.setFromAxisAngle(UP, item.yaw ?? 0);
      position.set(item.x, item.y, item.z);
      size.setScalar(item.scale ?? 1);
      matrix.compose(position, rotation, size);
      const rig = rigs[l];
      for (let p = 0; p < rig.meshes.length; p++) rig.meshes[p].setMatrixAt(slot, partMatrix.multiplyMatrices(matrix, rig.parts[p].local));
    }
    rigs.forEach((rig, l) => rig.meshes.forEach(mesh => {
      mesh.count = counts[l];
      mesh.visible = counts[l] > 0;
      mesh.instanceMatrix.needsUpdate = true;
    }));
    return true;
  }

  // How many draw calls the copies cost right now (a level nobody is at draws nothing).
  const drawCalls = () => rigs.reduce((sum, rig, l) => sum + (counts[l] > 0 ? rig.meshes.length : 0), 0);

  return { group, update, levelOf, counts, drawCalls, count: total, rigs };
}
