import * as THREE from 'three';
import { createLakeWater, createFlowMaterial, createSpill } from './sky-island-lake.js';
import { layoutPaths, createPathIndex, createPathMesh } from './sky-island-paths.js';
import { layoutRocks, createRockMeshes } from './sky-island-rocks.js';
import { layoutSkyTrees, SKY_TREES } from './sky-island-layout.js';
import { createSkyIslandTrees } from './sky-island-trees.js';
import { layoutIslandGlow } from './sky-island-glow.js';
import { layoutIslandFlora } from './island-flora-layout.js';
import { createIslandFlora } from './island-flora.js';
import { createIslandMotes } from './island-motes.js';
import { createIslandGroundGlow } from './island-ground-glow.js';
import { createJungleField, layoutUndergrowth, layoutJungleTrees, layoutTreeVines } from './island-jungle-layout.js';
import { createIslandGrass } from './island-grass.js';

// Everything that makes the island a place rather than a lawn (Kane, 5 Oct: it is the player's home base): the lake and the waterfall, the paths, the
// stone, the palm grove. It is all set dressing, nothing in play touches it. The layouts are pure and seeded (so the island is the same every time),
// worked out in the order that lets each avoid the one before: paths first, then the palms, then the stone, which keeps off both, then the glow plants,
// then the new plants and landmarks (src/island-flora-layout.js), which keep off everything.
export const ISLAND_SCENERY = Object.freeze({
  paths: false,   // Kane, 6 Oct: "we shouldn't have paths... it's not great if you follow paths and can see everything". The code stays (src/sky-island-paths.js), nothing is laid.
});

export function createIslandScenery({ island, materials, getExposure = () => 1 }) {
  const group = new THREE.Group();
  group.name = 'Sky island scenery';
  const waterY = island.baseY + island.features.lakeSpec.level; // the lake's surface in world metres
  const anchor = { x: island.config.x, z: island.config.z, distance: 700 };

  const lake = createLakeWater({ island, material: materials.water });
  group.add(lake.mesh);
  const spill = createSpill({ island, material: createFlowMaterial(materials.water) });
  group.add(spill.mesh);

  const pathData = ISLAND_SCENERY.paths ? layoutPaths(island.features, island.config) : [];
  const pathIndex = createPathIndex(pathData);
  const paths = ISLAND_SCENERY.paths ? createPathMesh({ island, material: materials.sand, paths: pathData }) : { mesh: null, paths: pathData, triangles: 0 };
  if (paths.mesh) group.add(paths.mesh);

  const palmLayout = layoutSkyTrees(island.config, SKY_TREES, { features: island.features, pathIndex });
  const palms = createSkyIslandTrees({ island, layout: palmLayout });
  group.add(palms.group);

  const rockItems = layoutRocks({ ground: island.groundHeight, features: island.features, pathIndex, config: island.config, avoid: palmLayout, waterY });
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

  // the island's own plants and landmarks: the weeping glow-trees, the root arch, the standing stones, the ribcage, night flowers, cushions, logs, mushrooms, vines
  const floraItems = layoutIslandFlora({
    ground: island.groundHeight, features: island.features, pathIndex, paths: pathData, config: island.config, rocks: rockItems, waterY,
    obstacles: [
      ...palmLayout.map(p => ({ x: p.x, z: p.z, r: 0.7 * p.scale })),
      ...glowItems.map(item => ({ x: item.x, z: item.z, r: 0.5 * item.scale, soft: true })),
    ],
  });

  // how overgrown the island is, point by point (src/island-jungle-layout.js): the grass, the undergrowth and the tall trees all read this one field. The trees go first (they
  // keep off the palms, the stone and the big landmarks), then the undergrowth fills in round them.
  const jungleField = createJungleField({ features: island.features, config: island.config });
  const BIG = { weepingTree: 5.5, rootArch: 6, standingStoneA: 3, standingStoneB: 3, ribcage: 9, log: 2.5, fungusLog: 2.5 };
  const trees = layoutJungleTrees({
    ground: island.groundHeight,
    obstacles: [
      ...palmLayout.map(p => ({ x: p.x, z: p.z, r: 2.4 * p.scale })),
      ...rockItems.filter(item => item.r >= 0.3).map(item => ({ x: item.x, z: item.z, r: item.r + 1.6 })),
      ...floraItems.filter(item => BIG[item.type]).map(item => ({ x: item.x, z: item.z, r: BIG[item.type] * (item.scale ?? 1) })),
      ...glowItems.map(item => ({ x: item.x, z: item.z, r: 1.5 * item.scale })),
    ],
  }, jungleField);
  const treeVines = layoutTreeVines(trees, island.groundHeight);
  const undergrowth = layoutUndergrowth({
    ground: island.groundHeight, features: island.features, config: island.config,
    obstacles: [
      ...palmLayout.map(p => ({ x: p.x, z: p.z, r: 0.5 * p.scale })),
      ...rockItems.filter(item => item.r >= 0.3).map(item => ({ x: item.x, z: item.z, r: item.r * 0.9 })),
      ...trees.map(t => ({ x: t.x, z: t.z, r: 1.3 * t.scale })),
    ],
  }, jungleField);
  const flora = createIslandFlora({
    items: [...floraItems, ...undergrowth, ...trees, ...treeVines], getExposure, sunDirection: materials.sand.uniforms.uSun.value, anchor,
    onError: message => console.warn(message),
  });
  group.add(flora.group);

  // grass blades (the oasis's) over the meadow and the floor, made in chunks round you as you walk (src/island-grass.js)
  const grass = createIslandGrass({ ground: island.groundHeight, cover: jungleField.cover, thick: jungleField.thick });
  group.add(grass.group);

  // light that drifts: seed puffs lifting off the big pale night flowers, and glow-flies over the lake at night (src/island-motes.js)
  const motes = createIslandMotes({ flowers: floraItems.filter(item => item.type === 'flower'), lake: island.features.lake, level: waterY, ground: island.groundHeight, getExposure, anchor });
  group.add(motes.group);

  // the ground takes the plants' light at night: a soft pool under each glow-tree, stone, the arch and every group of glow plants (src/island-ground-glow.js)
  const groundGlow = createIslandGroundGlow({ flora: floraItems, glow: glowItems, ground: island.groundHeight, getExposure, anchor });
  group.add(groundGlow.group);

  let grassStarted = false;
  return {
    group, lake, spill, paths, palms, rocks, pathIndex, palmLayout, rockItems, glow, flora, floraItems, undergrowth, trees, treeVines, jungleField, grass, motes, groundGlow,
    triangles: lake.triangles + spill.triangles + paths.triangles + rocks.triangles + groundGlow.triangles,
    // every 100 ms (cheap): loads the palms when you are near the island, and picks the level of detail each is drawn at (y: the eye's height)
    update(x, z, y) { palms.update(x, z, y); },
    // every frame: the plants' glow follows the light, the nearest ones are drawn in detail, the motes drift and the ground takes the glow. viewHeight: pixels tall one eye's picture is
    updateFlora(head, dt, viewHeight) {
      flora.update(head, dt); motes.update(head, dt, viewHeight); groundGlow.update(head);
      const near = Math.hypot(head.x - anchor.x, head.z - anchor.z) < anchor.distance;
      grass.group.visible = near;
      if (near) grass.update(head.x, head.z, !grassStarted && (grassStarted = true));
    },
  };
}
