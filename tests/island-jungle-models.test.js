import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { UNDERGROWTH_MODELS, buildFoliageLevels } from '../src/island-undergrowth-models.js';
import { JUNGLE_MODELS, JUNGLE_TREES, treeSpec } from '../src/island-jungle-models.js';
import { FLORA_RENDER, levelsFor, floraLodFor, LEAF_ALPHA_TEST } from '../src/island-flora.js';

// The textured plants (Kane, 6 Oct: dense, Ark-like, own models, textures fine): the undergrowth and the jungle, each in three levels of detail.
const names = Object.keys(UNDERGROWTH_MODELS);
const treeNames = Object.keys(JUNGLE_TREES);
const withBark = new Set([...treeNames, 'treeFernA', 'treeFernB']);
// triangle ceilings per level: [level 0, 1, 2]. The giants are about 7,000 / 1,400 / 350; a plant by your feet is a few hundred.
const CEILING = { jungle: [9000, 2600, 520], plant: [1500, 600, 120] };
const ceilingOf = name => (treeNames.includes(name) ? CEILING.jungle : CEILING.plant);

test('every textured model is in the table and builds in three levels, each lighter than the last, inside its ceiling', () => {
  assert.ok(names.length >= 12, `${names.length} models`);
  for (const name of Object.keys(JUNGLE_MODELS)) assert.ok(UNDERGROWTH_MODELS[name], `${name} is missing from the undergrowth table`);
  for (const name of names) {
    const levels = buildFoliageLevels(name);
    assert.equal(levels.length, 3, name);
    assert.ok(levels[0].triangles > levels[1].triangles && levels[1].triangles > levels[2].triangles, `${name}: ${levels.map(l => l.triangles)}`);
    levels.forEach((level, lod) => assert.ok(level.triangles <= ceilingOf(name)[lod], `${name} level ${lod}: ${level.triangles} triangles`));
    assert.ok(levels[2].triangles >= 12, `${name}: the far level still has a shape`);
    assert.equal(levelsFor(name), levels, 'the renderer reads the same cached levels');
  }
});

test('the geometry is sound: finite numbers, indices inside the mesh, unit normals, uvs on the atlas, one set of bark groups where there is bark', () => {
  for (const name of names) for (const [lod, level] of buildFoliageLevels(name).entries()) {
    const tag = `${name} level ${lod}`;
    const n = level.vertexCount;
    assert.equal(level.positions.length, n * 3, tag);
    assert.equal(level.normals.length, n * 3, tag);
    assert.equal(level.uvs.length, n * 2, tag);
    assert.equal(level.colors.length, n * 3, tag);
    assert.equal(level.emits.length, n * 3, tag);
    assert.equal(level.sways.length, n, tag);
    assert.equal(level.indices.length % 3, 0, tag);
    assert.equal(level.indices.length / 3, level.triangles, tag);
    for (const k of level.indices) assert.ok(k < n, `${tag}: an index past the end`);
    for (const a of [level.positions, level.normals, level.uvs, level.colors, level.sways]) assert.ok(a.every(Number.isFinite), `${tag}: a bad number`);
    for (let i = 0; i < n; i += 7) assert.ok(Math.abs(Math.hypot(level.normals[i * 3], level.normals[i * 3 + 1], level.normals[i * 3 + 2]) - 1) < 1e-3, `${tag}: a normal that is not unit`);
    // the leaf cards read one painted atlas (uvs 0 to 1); the bark tiles (u runs round the trunk, v up it in metres), so only the cards are held to the atlas
    const cardIndices = withBark.has(name) ? level.indices.subarray(0, level.groups[0].count) : level.indices;
    for (const k of cardIndices) assert.ok(level.uvs[k * 2] >= -1e-6 && level.uvs[k * 2] <= 1 + 1e-6 && level.uvs[k * 2 + 1] >= -1e-6 && level.uvs[k * 2 + 1] <= 1 + 1e-6, `${tag}: a card uv off the atlas`);
    if (withBark.has(name)) {
      assert.deepEqual(level.groups.map(g => g.material), [0, 1], `${tag}: leaves then bark`);
      assert.equal(level.groups[0].count + level.groups[1].count, level.indices.length, tag);
      assert.equal(level.groups[1].start, level.groups[0].count, tag);
      assert.ok(level.groups[1].count > 0 && level.groups[0].count > 0, `${tag}: both a trunk and leaves`);
    } else {
      assert.equal(level.groups, null, `${tag}: one material`);
    }
  }
});

test('a model grows the same every time it is built', () => {
  for (const name of ['jungleB', 'treeFernA', 'bushA', 'fernB', 'vineCurtain']) {
    const cached = buildFoliageLevels(name);
    for (const lod of [0, 2]) {
      const again = UNDERGROWTH_MODELS[name].build(lod).finish();
      assert.equal(again.triangles, cached[lod].triangles, `${name} ${lod}`);
      assert.deepEqual(again.positions, cached[lod].positions, `${name} ${lod}`);
      assert.deepEqual(again.uvs, cached[lod].uvs, `${name} ${lod}`);
    }
  }
});

test('the giants are as tall as they are made to be, a coarser level keeps their height, and every limb has somewhere for a vine to hang', () => {
  for (const name of treeNames) {
    const def = JUNGLE_TREES[name], levels = buildFoliageLevels(name);
    const b = levels[0].bounds;
    assert.ok(b.max[1] >= def.height && b.max[1] <= def.height + 9, `${name} is ${b.max[1].toFixed(1)} m tall (made ${def.height})`);
    assert.ok(b.min[1] > -1.5 && b.min[1] < 0, `${name} starts a little under the ground (${b.min[1]})`);
    assert.ok(Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) > 12, `${name} has a wide crown`);
    for (const level of levels.slice(1)) assert.ok(level.bounds.max[1] > 0.8 * b.max[1], `${name}: a coarse level is a lot shorter`);
    const spec = treeSpec(name);
    assert.ok(spec.anchors.length >= 8, `${name}: ${spec.anchors.length} anchors`);
    for (const a of spec.anchors) assert.ok(a.every(Number.isFinite) && a[1] > 0.25 * def.height && a[1] < 1.3 * def.height, `${name}: an anchor at ${a}`);
    assert.ok(spec.fins.length >= 4 && spec.roots.length > spec.fins.length, `${name}: root fins and surface roots`);
    for (const fin of spec.fins) assert.ok(fin.height < def.buttress.height * 1.5 * 0.7, `${name}: a fin ${fin.height.toFixed(1)} m tall is a wall, not a root`);
  }
});

test('every model has a render rule, a draw distance past its level boundaries, and its painted atlas (and bark) on disk', () => {
  for (const name of names) {
    const render = FLORA_RENDER[name];
    assert.ok(render, `no render rule for ${name}`);
    assert.ok(render.lod[0] < render.lod[1] && render.lod[1] < render.draw, `${name}: ${render.lod} then ${render.draw}`);
    assert.ok(render.map, `${name} is a leaf card model`);
    const atlas = new URL(`../public/textures/island-leaves/${render.map}.png`, import.meta.url);
    assert.ok(existsSync(atlas), `no atlas ${render.map}`);
    assert.ok(statSync(atlas).size < 1_500_000, `${render.map} is a big download`);
    assert.equal(Boolean(render.bark), withBark.has(name), `${name}: bark only where the model has a trunk`);
    if (render.bark) for (const file of [render.bark.colour, render.bark.normal]) {
      const url = new URL(`../public/textures/bark/${file}`, import.meta.url);
      assert.ok(existsSync(url) && statSync(url).size < 800_000, `${file}`);
    }
    // the far level is drawn out to the draw distance, and nothing is skipped on the way
    const seen = [0, render.lod[0] - 1, render.lod[0] + 1, render.lod[1] - 1, render.lod[1] + 1, render.draw - 1].map(d => floraLodFor(d, render));
    assert.deepEqual(seen, [0, 0, 1, 1, 2, 2], name);
    assert.equal(floraLodFor(render.draw + 1, render), -1);
  }
  assert.ok(LEAF_ALPHA_TEST > 0.2 && LEAF_ALPHA_TEST < 0.5, 'a cut-out a little under a half');
});

test('the painted leaf texture credits and the bark credit are on file', async () => {
  const { readFileSync } = await import('node:fs');
  const credits = readFileSync(new URL('../public/textures/bark/CREDITS.md', import.meta.url), 'utf8');
  assert.match(credits, /Bark Brown 02/);
  assert.match(credits, /CC0/);
});
