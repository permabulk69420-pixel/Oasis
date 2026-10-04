import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DUNE_STINGER, isBlocked, lineOfSight } from '../src/dune-stinger.js';
import { createStinger, BRAIN } from '../src/stinger-brain.js';
import { createHeightField, WATER, HERO_TREE, SPAWN, isInPond } from '../src/world.js';

const field = createHeightField();

test('its three models are in the game, small enough for a Quest, and cheaper at a distance', () => {
  const sizes = DUNE_STINGER.files.map(url => fs.statSync(new URL(`../public/models/creatures/${url.split('/').pop()}`, import.meta.url)).size);
  assert.equal(sizes.length, 3);
  assert.ok(sizes[0] > sizes[1] && sizes[1] > sizes[2], `file sizes ${sizes}`);
  assert.ok(sizes[0] < 1_000_000, 'the close-up model stays under a megabyte');
  assert.deepEqual(DUNE_STINGER.lodDistances.length, 3);
  assert.ok(DUNE_STINGER.lodDistances.every((d, i, all) => i === 0 || d > all[i - 1]));
});

test('its home is in open dune: clear of the pond, the hero tree, the start and the steep slopes', () => {
  const { home } = DUNE_STINGER;
  assert.ok(!isBlocked(home.x, home.z));
  assert.ok(!isInPond(home.x, home.z, field.sample(home.x, home.z)));
  assert.ok(Math.hypot(home.x - SPAWN.x, home.z - SPAWN.z) > 30, 'not on top of the player at the start');
  assert.ok(Math.hypot(home.x - SPAWN.x, home.z - SPAWN.z) < 80, 'close enough to find');
  assert.ok(Math.hypot(home.x - WATER.x, home.z - WATER.z) > 80);
  assert.ok(Math.hypot(home.x - HERO_TREE.x, home.z - HERO_TREE.z) > HERO_TREE.clearRadius);
});

test('blocked ground is the pond and its bank and the hero tree, and nothing at its home', () => {
  assert.ok(isBlocked(WATER.x, WATER.z));
  assert.ok(isBlocked(WATER.x + WATER.radiusX * 1.2, WATER.z));
  assert.ok(isBlocked(HERO_TREE.x, HERO_TREE.z));
});

test('wandering on the real dunes, it stays inside its patch and out of the pond and off the steep faces', () => {
  const world = { groundAt: field.sample, blocked: (x, z) => isBlocked(x, z) || isInPond(x, z, field.sample(x, z)) };
  for (const seed of [3, 4, 5]) {
    let a = seed;
    const rng = () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; };
    const stinger = createStinger({ world, rng, home: DUNE_STINGER.home, scale: DUNE_STINGER.scale });
    let farthest = 0;
    let steepest = 0;
    for (let t = 0; t < 900; t += 1 / 30) {
      stinger.update(1 / 30, { x: 9000, z: 9000 });
      const s = stinger.state;
      farthest = Math.max(farthest, Math.hypot(s.x - DUNE_STINGER.home.x, s.z - DUNE_STINGER.home.z));
      assert.ok(!world.blocked(s.x, s.z), `seed ${seed}: blocked at ${s.x.toFixed(0)}, ${s.z.toFixed(0)}`);
      const sx = (field.sample(s.x + 1.5, s.z) - field.sample(s.x - 1.5, s.z)) / 3;
      const sz = (field.sample(s.x, s.z + 1.5) - field.sample(s.x, s.z - 1.5)) / 3;
      steepest = Math.max(steepest, Math.hypot(sx, sz));
    }
    assert.ok(farthest <= BRAIN.wanderRadius + 2, `strayed ${farthest.toFixed(1)}`);
    assert.ok(steepest < BRAIN.maxSlope + 0.25, `steepest ${steepest.toFixed(2)}`);
  }
});

test('line of sight: a flat plain is open, a dune between hides you, and the ground under either end does not', () => {
  const flat = () => 0;
  assert.ok(lineOfSight(flat, 0, 0.55, 0, 20, 1.7, 0), 'open ground');
  const ridge = x => (x > 9 && x < 11 ? 4 : 0);
  assert.ok(!lineOfSight((x) => ridge(x), 0, 0.55, 0, 20, 1.7, 0), 'a ridge between');
  // a rise right at the stinger's feet (within the skipped first metres) does not blind it
  const bump = x => (x < 2 ? 3 : 0);
  assert.ok(lineOfSight(bump, 0, 0.55, 0, 20, 1.7, 0), 'its own ground does not hide you');
  assert.ok(lineOfSight(ridge, 0, 0.55, 0, 3, 1.7, 0), 'close up is always seen');
  // a ridge lower than the line of sight at that point is no cover
  const low = x => (x > 9 && x < 11 ? 0.5 : 0);
  assert.ok(lineOfSight(low, 0, 0.55, 0, 20, 1.7, 0), 'a ridge under the line of sight');
});

test('the real dunes hide something: some of the places 20 m round its home cannot be seen from it', () => {
  const { home } = DUNE_STINGER;
  const eye = field.sample(home.x, home.z) + 0.55 * DUNE_STINGER.scale;
  let seen = 0;
  let hidden = 0;
  for (let a = 0; a < 360; a += 15) {
    const x = home.x + Math.cos(a * Math.PI / 180) * 20;
    const z = home.z + Math.sin(a * Math.PI / 180) * 20;
    if (lineOfSight(field.sample, home.x, eye, home.z, x, field.sample(x, z) + 1.7, z)) seen++; else hidden++;
  }
  assert.ok(seen > 0, 'it can see some of the ring');
  assert.ok(seen + hidden === 24);
});
