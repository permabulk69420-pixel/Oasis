import test from 'node:test';
import assert from 'node:assert/strict';
import { createIslandFlora, createFloraMaterial, geometryFromLevel, floraLodFor, FLORA_LOOK, FLORA_RENDER } from '../src/island-flora.js';
import { buildFloraLevels } from '../src/island-flora-models.js';
import { exposureGlow } from '../src/glow.js';

const items = [
  { type: 'weepingTree', x: 0, y: 5, z: 0, yaw: 0, scale: 1 },
  { type: 'weepingTree', x: 50, y: 5, z: 0, yaw: 1, scale: 1.1 },
  { type: 'weepingTree', x: 150, y: 5, z: 0, yaw: 2, scale: 1 },
  { type: 'weepingTree', x: 400, y: 5, z: 0, yaw: 2, scale: 1 },
  { type: 'fern', x: 3, y: 5, z: 3, yaw: 0, scale: 1 },
  { type: 'fern', x: 40, y: 5, z: 3, yaw: 0, scale: 1 },
  { type: 'mushrooms', x: 4, y: 5, z: 1, yaw: 0, scale: 1.3 },
  { type: 'mushrooms', x: 200, y: 5, z: 0, yaw: 0, scale: 1.3 },
];

const make = (extra = {}) => createIslandFlora({ items, anchor: { x: 0, z: 0, distance: 700 }, getExposure: () => 0.035, sunDirection: { y: -1 }, onError: () => {}, ...extra });
const counts = (flora, type) => flora.built.get(type).meshes.map(m => m.count);

test('levels of detail: near, middle and far, and a model is left out past its draw distance', () => {
  const r = FLORA_RENDER.weepingTree;
  assert.equal(floraLodFor(r.lod[0] * 0.5, r), 0);
  assert.equal(floraLodFor((r.lod[0] + r.lod[1]) / 2, r), 1);
  assert.equal(floraLodFor(r.lod[1] * 1.5, r), 2);
  assert.equal(floraLodFor(r.draw + 1, r), -1);
  // a plant that has just crossed a boundary keeps its level for a few metres (no flicker at the edge)
  assert.equal(floraLodFor(r.lod[0] + FLORA_LOOK.lodHysteresis * 0.5, r, 0), 0);
  assert.equal(floraLodFor(r.lod[0] - FLORA_LOOK.lodHysteresis * 0.5, r, 1), 1);
  assert.equal(floraLodFor(r.lod[0] + FLORA_LOOK.lodHysteresis * 2, r, 0), 1);
});

test('one instanced mesh per model and level, built a model at a time, and the draw call count stays small', () => {
  const flora = make();
  assert.equal(flora.ready, false);
  let updates = 0;
  while (!flora.ready && updates < 20) { flora.update({ x: 0, z: 0 }, 1); updates++; }
  assert.equal(updates, 3, 'one model per update');
  assert.equal(flora.built.size, 3);
  const meshes = flora.group.children.filter(c => c.isInstancedMesh && c.name.startsWith('Island ') && c.name.includes('level'));
  assert.equal(meshes.length, 9, 'three levels of three models');
  assert.equal(flora.materials.length, 3);
  for (const m of meshes) assert.equal(m.frustumCulled, false);
});

test('each plant takes the level for its distance from the head, and the meshes with nothing to draw are hidden', () => {
  const flora = make();
  flora.buildAll();
  flora.update({ x: 0, z: 0 }, 1);
  // trees at 0, 50, 150 and 400 m: level 0 (< 30), 1 (< 80), 2 (to 300), and out
  assert.deepEqual(counts(flora, 'weepingTree'), [1, 1, 1]);
  // ferns at 3 and 40 m (level 0 to 24, level 1 to 64)
  assert.deepEqual(counts(flora, 'fern'), [1, 1, 0]);
  assert.deepEqual(counts(flora, 'mushrooms'), [1, 0, 0], 'the far mushrooms are past their 70 m');
  const fern = flora.built.get('fern').meshes;
  assert.equal(fern[2].visible, false, 'a mesh with nothing in it is not drawn');
  assert.equal(fern[0].visible, true);
  // walk to the far tree: it is level 0 now, the one at 150 m is 250 m off (far level), and the first two are out of range (past 300 m)
  flora.update({ x: 400, z: 0 }, 1);
  assert.deepEqual(counts(flora, 'weepingTree'), [1, 0, 1]);
  const tri = flora.triangles();
  const levels = buildFloraLevels('weepingTree');
  assert.ok(tri >= levels[0].triangles, `${tri} triangles`);
});

test('the triangle count is the sum over what is drawn', () => {
  const flora = make();
  flora.buildAll();
  flora.update({ x: 0, z: 0 }, 1);
  let want = 0;
  for (const [type, level] of [['weepingTree', [1, 1, 1]], ['fern', [1, 1, 0]], ['mushrooms', [1, 0, 0]]]) {
    const levels = buildFloraLevels(type);
    level.forEach((n, i) => { want += n * levels[i].triangles; });
  }
  assert.equal(flora.triangles(), want);
});

test('far from the island nothing is drawn and no work is done; coming back brings everything back', () => {
  const flora = make();
  flora.buildAll();
  flora.update({ x: 0, z: 0 }, 1);
  assert.equal(flora.group.visible, true);
  flora.update({ x: 5000, z: 0 }, 1);
  assert.equal(flora.group.visible, false);
  flora.update({ x: 10, z: 0 }, 1);
  assert.equal(flora.group.visible, true);
  assert.ok(flora.triangles() > 0);
});

test('a forced level draws every plant at that level (the lab)', () => {
  const flora = make({ forceLod: 2 });
  flora.buildAll();
  flora.update({ x: 0, z: 0 }, 1);
  assert.deepEqual(counts(flora, 'fern'), [0, 0, 2]);
  assert.deepEqual(counts(flora, 'weepingTree'), [0, 0, 4]);
});

test('halos light the nearest plants only, and clear when you walk away', () => {
  const flora = make();
  flora.buildAll();
  const cyan = flora.group.children.find(c => c.name === 'Island flora halos');
  assert.ok(cyan, 'the cyan halo mesh');
  const lit = () => { let n = 0; for (let i = 0; i < cyan.count; i++) if (cyan.instanceMatrix.array[i * 16] > 0) n++; return n; };
  assert.equal(lit(), 0, 'all hidden to start with');
  flora.update({ x: 0, z: 0 }, 1);
  const treeHalos = buildFloraLevels('weepingTree')[0].halos.filter(h => h.tone !== 'pale').length;
  assert.ok(treeHalos >= 3);
  assert.ok(lit() >= treeHalos, `${lit()} halos at the tree`);
  assert.equal(cyan.visible, true, 'at night the halos show');
  // by day they are switched off, not just dimmed
  const day = make({ sunDirection: { y: 0.6 } });
  day.buildAll();
  day.update({ x: 0, z: 0 }, 1);
  assert.equal(day.group.children.find(c => c.name === 'Island flora halos').visible, false);
  // far from every plant that is at level 0 there is nothing to light
  flora.update({ x: 300, z: 0 }, 1);
  assert.equal(lit(), 0);
});

test('the glow follows the exposure like every other glow in the game', () => {
  let exposure = 0.035;
  const flora = make({ getExposure: () => exposure });
  flora.buildAll();
  flora.update({ x: 0, z: 0 }, 1);
  const night = flora.materials[0].emissiveIntensity;
  assert.equal(night, exposureGlow(0.035, FLORA_LOOK.glow));
  exposure = 0.62;
  flora.update({ x: 0, z: 0 }, 1);
  const day = flora.materials[0].emissiveIntensity;
  assert.equal(day, exposureGlow(0.62, FLORA_LOOK.glow));
  assert.ok(night > day, 'brighter at night');
});

test('a model with no render rule is reported and the rest still draw', () => {
  const errors = [];
  const flora = createIslandFlora({ items: [...items, { type: 'nope', x: 0, y: 0, z: 0, scale: 1 }], anchor: { x: 0, z: 0, distance: 700 }, onError: e => errors.push(e) });
  for (let i = 0; i < 8; i++) flora.update({ x: 0, z: 0 }, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /nope/);
  assert.equal(flora.built.size, 3);
});

test('materials are plain dark standard materials: vertex colours, emissive from the glow attribute, no map, double sided for leaves', () => {
  const tree = createFloraMaterial('weepingTree', FLORA_RENDER.weepingTree);
  assert.equal(tree.vertexColors, true);
  assert.equal(tree.side, 2);
  assert.equal(tree.metalness, 0);
  assert.equal(tree.map, null);
  const stone = createFloraMaterial('standingStoneA', FLORA_RENDER.standingStoneA);
  assert.equal(stone.side, 0);
  // hanging models patch the vertex shader with their own sway, and the program cache keys differ so they do not share a program with the still ones
  assert.notEqual(tree.customProgramCacheKey(), stone.customProgramCacheKey());
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>\n#include <project_vertex>', fragmentShader: '#include <common>\n#include <emissivemap_fragment>' };
  tree.onBeforeCompile(shader, {});
  assert.match(shader.vertexShader, /attribute vec3 emit/);
  assert.match(shader.vertexShader, /attribute float sway/);
  assert.match(shader.fragmentShader, /totalEmissiveRadiance \*= vFloraEmit/);
  assert.ok(shader.uniforms.uWindTime && shader.uniforms.uWindStrength);
});

test('a level becomes a geometry with every attribute the shaders read', () => {
  const level = buildFloraLevels('fern')[0];
  const geometry = geometryFromLevel(level);
  for (const name of ['position', 'normal', 'color', 'emit', 'sway', 'uv']) assert.ok(geometry.getAttribute(name), name);
  assert.equal(geometry.index.count / 3, level.triangles);
  assert.ok(geometry.boundingSphere.radius > 0.5);
});
