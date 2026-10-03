import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STAT_MAX, SURVIVAL_RATES, resetSurvival, getSurvivalStats, updateSurvival, canSprint, restoreFood, restoreWater,
} from '../src/survival.js';

function run(seconds, options, dt = 0.1) {
  for (let t = 0; t < seconds; t += dt) updateSurvival(dt, options);
}

test('stats start full and food and water drain slowly', () => {
  resetSurvival();
  assert.deepEqual(getSurvivalStats(), { health: 100, stamina: 100, food: 100, water: 100 });
  run(60);
  const s = getSurvivalStats();
  assert.ok(s.food < 100 && s.food > 97, `food after a minute: ${s.food}`);
  assert.ok(s.water < 100 && s.water > 95, `water after a minute: ${s.water}`);
  assert.equal(s.stamina, 100);
});

test('a full stat bar takes tens of minutes to empty', () => {
  resetSurvival();
  run(20 * 60, {}, 1);
  const s = getSurvivalStats();
  assert.ok(s.water > 5 && s.water < 20, `water after 20 min: ${s.water}`);
  assert.ok(s.food > 40, `food after 20 min: ${s.food}`);
});

test('standing in the pond refills water quickly, never above max', () => {
  resetSurvival();
  run(10 * 60, {}, 1);
  const low = getSurvivalStats().water;
  run(2, { inWater: true });
  assert.ok(getSurvivalStats().water > low + 40);
  run(10, { inWater: true });
  assert.equal(getSurvivalStats().water, STAT_MAX);
});

test('restoreFood and restoreWater clamp and ignore junk', () => {
  resetSurvival();
  run(5 * 60, {}, 1);
  const before = getSurvivalStats();
  restoreFood(-5); restoreFood(NaN); restoreWater('x');
  assert.deepEqual(getSurvivalStats(), before);
  restoreFood(1000); restoreWater(1000);
  assert.equal(getSurvivalStats().food, STAT_MAX);
  assert.equal(getSurvivalStats().water, STAT_MAX);
});

test('sprinting drains stamina; running dry blocks sprinting until it recovers', () => {
  resetSurvival();
  assert.ok(canSprint());
  run(10, { sprinting: true });
  assert.ok(getSurvivalStats().stamina < 60);
  run(10.2, { sprinting: true });
  assert.equal(getSurvivalStats().stamina, 0);
  assert.equal(canSprint(), false);
  // still no sprinting right after: it must climb back above the threshold first
  run(0.5, {});
  assert.equal(canSprint(), false);
  run(3, {});
  assert.ok(getSurvivalStats().stamina >= SURVIVAL_RATES.staminaMinToSprint);
  assert.equal(canSprint(), true);
});

test('stamina waits a moment after sprinting before it regenerates', () => {
  resetSurvival();
  run(5, { sprinting: true });
  const tired = getSurvivalStats().stamina;
  run(0.5, {});
  assert.equal(getSurvivalStats().stamina, tired, 'no regeneration inside the delay');
  run(2, {});
  assert.ok(getSurvivalStats().stamina > tired);
});

test('health only drops when food or water are empty, and never below the floor', () => {
  resetSurvival();
  run(60, {}, 1);
  assert.equal(getSurvivalStats().health, STAT_MAX, 'full health is untouched while fed');
  // starve: force water to zero without waiting 22 minutes
  run(30 * 60, {}, 1);
  const s = getSurvivalStats();
  assert.equal(s.water, 0);
  assert.ok(s.health < 100);
  run(60 * 60, {}, 1);
  assert.equal(getSurvivalStats().health, SURVIVAL_RATES.healthFloor, 'no death: health stops at the floor');
});

test('health recovers when fed and watered', () => {
  resetSurvival();
  run(30 * 60, {}, 1);
  assert.ok(getSurvivalStats().health < 100);
  const hurt = getSurvivalStats().health;
  restoreFood(100); restoreWater(100);
  run(60, {}, 1);
  assert.ok(getSurvivalStats().health > hurt);
});

test('bad dt values do nothing', () => {
  resetSurvival();
  updateSurvival(NaN); updateSurvival(-1); updateSurvival(0);
  assert.deepEqual(getSurvivalStats(), { health: 100, stamina: 100, food: 100, water: 100 });
});
