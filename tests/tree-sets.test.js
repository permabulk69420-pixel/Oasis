import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TREE_SETS, DEFAULT_TREE_SET, pickTreeSet, levelDistance, forcedTreeLevel } from '../src/tree-sets.js';

const MODELS = new URL('../public/models/vegetation/alien-tree/', import.meta.url);

test('every tree model the game can load is in the repo, nearest level first, switching on further and further out', () => {
  for (const [key, set] of Object.entries(TREE_SETS)) {
    assert.equal(set.levels.length, 3, `${key}: three levels of detail`);
    assert.equal(set.levels[0].distance, 0, `${key}: the first level starts at the tree`);
    set.levels.forEach((level, i) => {
      assert.ok(fs.existsSync(new URL(level.file, MODELS)), `${key}: ${level.file} exists`);
      if (i > 0) assert.ok(level.distance > set.levels[i - 1].distance, `${key}: level ${i} switches on further out`);
    });
    assert.ok(set.name, `${key} has a name`);
  }
});

test('the blue palm is the default; ?trees=old brings the first trees back, and nothing else gets in', () => {
  assert.equal(DEFAULT_TREE_SET, 'palm');
  assert.equal(pickTreeSet(''), TREE_SETS.palm);
  assert.equal(pickTreeSet('?view=shore&hour=12'), TREE_SETS.palm);
  assert.equal(pickTreeSet('?trees=old'), TREE_SETS.old);
  assert.equal(pickTreeSet('?trees=palm'), TREE_SETS.palm);
  for (const odd of ['?trees=', '?trees=nonsense', '?trees=__proto__', '?trees=constructor', '?trees=toString']) {
    assert.equal(pickTreeSet(odd), TREE_SETS.palm, odd);
  }
  assert.equal(pickTreeSet(), TREE_SETS.palm);
});

test('a palm at 2x is twice as big at any distance, so its levels start twice as far away; the first trees never did', () => {
  const palm = TREE_SETS.palm;
  assert.equal(levelDistance(palm, palm.levels[1], 1), palm.levels[1].distance);
  assert.equal(levelDistance(palm, palm.levels[1], 2), palm.levels[1].distance * 2);
  assert.equal(levelDistance(palm, palm.levels[0], 2), 0, 'the nearest level always starts at the tree');
  const old = TREE_SETS.old;
  assert.equal(levelDistance(old, old.levels[2], 2), old.levels[2].distance);
  assert.equal(levelDistance(palm, palm.levels[2]), palm.levels[2].distance, 'scale 1 when none is given');
});

test('?treelod=N (dev build only) forces one level, and ignores anything that is not a level', () => {
  assert.equal(forcedTreeLevel('?treelod=0'), 0);
  assert.equal(forcedTreeLevel('?treelod=1&hour=12'), 1);
  assert.equal(forcedTreeLevel('?treelod=2'), 2);
  for (const odd of ['', '?treelod=', '?treelod=3', '?treelod=-1', '?treelod=1.5', '?treelod=two', '?treelod= ', '?hour=12']) {
    assert.equal(forcedTreeLevel(odd), null, odd);
  }
  assert.equal(forcedTreeLevel(), null);
});
