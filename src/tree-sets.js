// The models the oasis's regular trees can be drawn with. Each is a list of levels of detail: the file, and the distance (metres
// from the eye, for a tree at scale 1) from which that level is used.
//
//   palm  the banded blue palm made by tools/alien-tree/build_alien_tree.py: about 5,500, 1,900 and 560 triangles.
//   old   the first blue trees, kept so ?trees=old can show them side by side with the palm: 40,000, 24,000 and 12,500.
//
// A palm at scale 2 is twice as big on screen at any distance, so its levels start twice as far away (`scaleDistance`); the old
// models never did that, and ?trees=old shows them exactly as they were.
export const TREE_SETS = Object.freeze({
  palm: Object.freeze({
    name: 'Blue palm',
    scaleDistance: true,
    levels: Object.freeze([
      Object.freeze({ file: 'alien_tree_lod0.glb', distance: 0 }),
      Object.freeze({ file: 'alien_tree_lod1.glb', distance: 20 }),
      Object.freeze({ file: 'alien_tree_lod2.glb', distance: 55 }),
    ]),
  }),
  old: Object.freeze({
    name: 'First blue tree',
    scaleDistance: false,
    levels: Object.freeze([
      Object.freeze({ file: 'blue_alien_tree.glb', distance: 0 }),
      Object.freeze({ file: 'blue_alien_tree_optimized_code.glb', distance: 18 }),
      Object.freeze({ file: 'blue_alien_tree_lod3_ultra.glb', distance: 45 }),
    ]),
  }),
});

export const DEFAULT_TREE_SET = 'palm';

// The set named by a query string such as '?trees=old'; the palm for anything else.
export function pickTreeSet(search = '') {
  const wanted = new URLSearchParams(search).get('trees');
  return wanted && Object.hasOwn(TREE_SETS, wanted) ? TREE_SETS[wanted] : TREE_SETS[DEFAULT_TREE_SET];
}

// The distance a level is switched on at, for a tree at `scale`.
export function levelDistance(set, level, scale = 1) {
  return set.scaleDistance ? level.distance * Math.max(scale, 0.001) : level.distance;
}

// ?treelod=0|1|2 (the dev build only, see oasis-vegetation.js): every tree uses just that level, so one level can be judged on
// its own. null for anything else.
export function forcedTreeLevel(search = '', set = TREE_SETS[DEFAULT_TREE_SET]) {
  const raw = new URLSearchParams(search).get('treelod');
  if (raw === null || raw.trim() === '') return null;
  const level = Number(raw);
  return Number.isInteger(level) && level >= 0 && level < set.levels.length ? level : null;
}
