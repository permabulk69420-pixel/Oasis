import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { layoutGlowGarden, glowLodFor, GLOW_GARDEN } from '../src/glow-garden.js';
import { createHeightField, WATER, HERO_TREE, basinRadius, isInPond } from '../src/world.js';

const field = createHeightField();
const items = layoutGlowGarden(field.sample);
const of = kind => items.filter(item => item.kind === kind);

test('the layout is the same every time', () => {
  assert.deepEqual(layoutGlowGarden(field.sample), items);
});

test('there are enough plants to matter and not enough to bury the oasis', () => {
  assert.ok(of('reed').length >= 14 && of('reed').length <= GLOW_GARDEN.reed.count, `${of('reed').length} reed clumps`);
  assert.ok(of('lantern').length >= 14 && of('lantern').length <= GLOW_GARDEN.lantern.bankCount + GLOW_GARDEN.lantern.groveCount, `${of('lantern').length} lantern blooms`);
});

test('reeds stand at the water, lantern blooms on dry ground, nothing in the pond', () => {
  for (const reed of of('reed')) {
    const b = basinRadius(reed.x, reed.z);
    assert.ok(b > 0.9 && b < 1.12, `reed at basin radius ${b.toFixed(2)}`);
    assert.ok(field.sample(reed.x, reed.z) > WATER.y - 0.35, 'not out in the deep');
  }
  for (const lantern of of('lantern')) {
    assert.ok(!isInPond(lantern.x, lantern.z, field.sample(lantern.x, lantern.z)), 'not wading');
    assert.ok(field.sample(lantern.x, lantern.z) > WATER.y, 'above the water line');
  }
});

test('plants keep their distance from each other, from the hero tree and from the existing reed patches', () => {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const gap = Math.hypot(items[i].x - items[j].x, items[i].z - items[j].z);
      assert.ok(gap >= 5.5 * 0.85 - 1e-9, `two plants ${gap.toFixed(1)} m apart`);
    }
    const heroGap = Math.hypot(items[i].x - HERO_TREE.x, items[i].z - HERO_TREE.z);
    assert.ok(heroGap >= GLOW_GARDEN.grove.near - 1e-9, `a plant ${heroGap.toFixed(1)} m from the hero tree's trunk`);
  }
});

test('some lantern blooms grow round the hero tree, so its glow has company', () => {
  const grove = of('lantern').filter(item => Math.hypot(item.x - HERO_TREE.x, item.z - HERO_TREE.z) <= GLOW_GARDEN.grove.far + 1e-9);
  assert.ok(grove.length >= 6, `${grove.length} in the grove`);
});

test('scales and turns vary, and stay in range', () => {
  for (const item of items) {
    const range = GLOW_GARDEN[item.kind].scale;
    assert.ok(item.scale >= range[0] && item.scale <= range[1]);
    assert.ok(item.yaw >= 0 && item.yaw < Math.PI * 2);
  }
  assert.ok(new Set(items.map(item => item.scale.toFixed(2))).size > items.length / 2);
});

test('levels of detail: close, middle, far, culled, and a plant keeps its level near a boundary', () => {
  const [near, far] = GLOW_GARDEN.lodDistance;
  assert.equal(glowLodFor(near - 5, 170), 0);
  assert.equal(glowLodFor(near + 20, 170), 1);
  assert.equal(glowLodFor(far + 20, 170), 2);
  assert.equal(glowLodFor(171, 170), -1);
  assert.equal(glowLodFor(near + 2, 170, 0), 0, 'a close plant stays close just past the boundary');
  assert.equal(glowLodFor(near - 2, 170, 1), 1, 'a middle one stays middle just inside it');
  assert.equal(glowLodFor(near + 20, 170, 0), 1, 'but not far past it');
});

test('the models exist, are small, and have three levels each', () => {
  for (const file of ['glow_reed', 'lantern_bloom']) {
    const sizes = [];
    for (let level = 0; level < 3; level++) {
      const path = new URL(`../public/models/vegetation/glow-plants/${file}_lod${level}.glb`, import.meta.url);
      assert.ok(existsSync(path), `${file} level ${level}`);
      sizes.push(statSync(path).size);
    }
    assert.ok(sizes[0] > sizes[1] && sizes[1] > sizes[2], `${file} gets smaller with distance`);
    assert.ok(sizes[0] < 400_000, `${file} close level is ${sizes[0]} bytes`);
  }
});
