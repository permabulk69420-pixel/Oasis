import * as THREE from 'three';
import { SKY_ISLAND, buildIsland } from './sky-island-shape.js';
import { createSkyIslandGround } from './sky-island-ground.js';

// The floating island as a mesh (shape in sky-island-shape.js, the ground you walk on in sky-island-ground.js). It wears the terrain's own
// material, so the sun, the haze, the strata, the moonlit fill and the torch and fire light all work on it with no extra code. The material
// is single sided: the mesh's faces all point out. The mesh is named so it is NOT found as a terrain tile ('sand-...') by findTerrainMesh.
export function createSkyIsland(material, config = SKY_ISLAND) {
  const ground = createSkyIslandGround(config);
  const baseY = ground.baseY;
  const data = buildIsland(baseY, config);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
  geometry.setAttribute('zone', new THREE.BufferAttribute(data.zones, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Sky island';
  const group = new THREE.Group();
  group.name = 'Sky island group';
  group.add(mesh);
  return {
    group, mesh, baseY, config, ground,
    triangles: data.indices.length / 3,
    // World height of the top at (x, z), or null where there is no ground on top (off the edge).
    groundHeight: ground.groundHeight,
  };
}
