import * as THREE from 'three';
import { createLakeWater, createFlowMaterial, createSpill } from './sky-island-lake.js';
import { layoutPaths, createPathIndex, createPathMesh } from './sky-island-paths.js';
import { layoutRocks, createRockMeshes } from './sky-island-rocks.js';
import { layoutSkyTrees, SKY_TREES } from './sky-island-layout.js';
import { createSkyIslandTrees } from './sky-island-trees.js';
import { layoutIslandGlow } from './sky-island-glow.js';

// Everything that makes the island a place rather than a lawn (Kane, 5 Oct: it is the player's home base): the lake and the waterfall, the paths, the
// stone, the palm grove. It is all set dressing, nothing in play touches it. The layouts are pure and seeded (so the island is the same every time),
// worked out in the order that lets each avoid the one before: paths first, then the palms, then the stone, which keeps off both.
export function createIslandScenery({ island, materials }) {
  const group = new THREE.Group();
  group.name = 'Sky island scenery';

  const lake = createLakeWater({ island, material: materials.water });
  group.add(lake.mesh);
  const spill = createSpill({ island, material: createFlowMaterial(materials.water) });
  group.add(spill.mesh);

  const pathData = layoutPaths(island.features, island.config);
  const pathIndex = createPathIndex(pathData);
  const paths = createPathMesh({ island, material: materials.sand, paths: pathData });
  group.add(paths.mesh);

  const palmLayout = layoutSkyTrees(island.config, SKY_TREES, { features: island.features, pathIndex });
  const palms = createSkyIslandTrees({ island, layout: palmLayout });
  group.add(palms.group);

  const rockItems = layoutRocks({ ground: island.groundHeight, features: island.features, pathIndex, config: island.config, avoid: palmLayout });
  const rocks = createRockMeshes({ island, material: materials.sand, items: rockItems });
  group.add(rocks.group);

  // the glow plants are the oasis garden's (src/glow-garden.js draws them); this says where on the island they go, off the paths, rocks and palms
  const glowItems = layoutIslandGlow({
    ground: island.groundHeight, features: island.features, pathIndex, paths: pathData, config: island.config,
    obstacles: [...rockItems.filter(item => item.r >= 0.3), ...palmLayout.map(p => ({ x: p.x, z: p.z, r: 0.7 * p.scale }))],
  });
  const glow = {
    items: glowItems.map(item => ({ ...item, y: island.groundHeight(item.x, item.z) })),
    anchor: { x: island.config.x, z: island.config.z, distance: 700 },
  };

  return {
    group, lake, spill, paths, palms, rocks, pathIndex, palmLayout, rockItems, glow,
    triangles: lake.triangles + spill.triangles + paths.triangles + rocks.triangles,
    // every frame (cheap): loads the palms when you are near the island
    update(x, z) { palms.update(x, z); },
  };
}
