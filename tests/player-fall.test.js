import test from 'node:test';
import assert from 'node:assert/strict';
import { createFall, stepFall, fallDamage, FALL } from '../src/player-fall.js';

test('walking on slopes and small steps is not a fall', () => {
  const fall = createFall();
  assert.equal(stepFall(fall, 10.3, 10, 0.016), null);
  assert.equal(fall.active, false);
});

test('ground dropping away starts a fall that speeds up and lands on the ground', () => {
  const fall = createFall();
  let y = 270, steps = 0, landedAt = 0;
  while (steps++ < 5000) {
    const next = stepFall(fall, y, 20, 0.016);
    assert.notEqual(next, null);
    y = next;
    if (fall.landed) { landedAt = fall.landed; break; }
  }
  assert.equal(y, 20);
  assert.ok(landedAt > 60 && landedAt < 90, `about sqrt(2 g h) for 250 m (${landedAt})`);
  assert.equal(fall.active, false);
});

test('small drops cost nothing, big ones hurt, and it is capped', () => {
  assert.equal(fallDamage(FALL.safeSpeed), 0);
  assert.ok(fallDamage(15) > 0);
  assert.equal(fallDamage(80), FALL.maxDamage);
});
