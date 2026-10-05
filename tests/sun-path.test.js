import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sunDirectionFor, swing, INITIAL_SUN, INITIAL_PHASE, SUN_ARC, SUN_PEAK_DEGREES, SUNRISE_BEARING } from '../src/sun-path.js';

// The sun's path through the day (and so the moon's, always opposite). It used to jump 63 degrees across the sky at noon and again at
// midnight; these tests keep it one smooth arc with the heights the game was tuned on.

const TAU = Math.PI * 2;
const degrees = radians => radians * 180 / Math.PI;
const angleBetween = (a, b) => degrees(Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)));
const sunAt = phase => sunDirectionFor(phase, new THREE.Vector3());

test('at the starting time the sun is on the side of the sky the game has always started it, and low', () => {
  const flat = v => Math.atan2(v.z, v.x);
  const start = sunAt(INITIAL_PHASE);
  assert.ok(Math.abs(Math.atan2(Math.sin(flat(start) - flat(INITIAL_SUN)), Math.cos(flat(start) - flat(INITIAL_SUN)))) < 1e-6, 'same bearing as INITIAL_SUN');
  assert.ok(INITIAL_PHASE > 0 && INITIAL_PHASE < 0.25, 'the game starts in the morning');
  assert.ok(start.y > 0, 'with the sun up');
});

test('a twilight planet: the sun never climbs past its peak, a hand or so above the horizon', () => {
  assert.ok(SUN_PEAK_DEGREES >= 8 && SUN_PEAK_DEGREES <= 20, 'a low sun is the point');
  let highest = -1;
  for (let i = 0; i <= 2000; i++) highest = Math.max(highest, sunAt(i / 2000).y);
  assert.ok(Math.abs(degrees(Math.asin(highest)) - SUN_PEAK_DEGREES) < 0.01);
});

test('the sun moves smoothly: no jump anywhere in the cycle, at noon and midnight included', () => {
  const steps = 40000;
  let previous = sunAt(0);
  let biggest = 0;
  for (let i = 1; i <= steps; i++) {
    const now = sunAt(i / steps);
    biggest = Math.max(biggest, angleBetween(previous, now));
    previous = now;
  }
  // a cycle is 360 seconds; 40,000 steps is a step of nine milliseconds. The old path jumped 63 degrees in one.
  assert.ok(biggest < 0.05, `the biggest step is ${biggest.toFixed(4)} degrees`);
  assert.ok(angleBetween(sunAt(1), sunAt(0)) < 1e-9, 'the end of the cycle is the start of the next');
});

test('the heights climb linearly to the peak at noon, and mirror it by night', () => {
  for (const phase of [0, 0.03, 0.08, 0.12, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 0.9]) {
    const wanted = Math.asin(Math.sin(phase * TAU)) * SUN_ARC;
    assert.ok(Math.abs(Math.asin(sunAt(phase).y) - wanted) < 1e-9, `phase ${phase}`);
  }
  assert.ok(Math.abs(degrees(Math.asin(sunAt(0.25).y)) - SUN_PEAK_DEGREES) < 0.01, 'noon height');
  assert.ok(Math.abs(degrees(Math.asin(sunAt(0.75).y)) + SUN_PEAK_DEGREES) < 0.01, 'midnight depth');
  assert.ok(Math.abs(sunAt(0).y) < 1e-12 && Math.abs(sunAt(0.5).y) < 1e-12, 'it crosses the horizon at sunrise and sunset');
});

test('it rises and sets on opposite sides, and swings half way round by noon', () => {
  const rise = sunAt(0), noon = sunAt(0.25), set = sunAt(0.5);
  assert.ok(angleBetween(rise, set) > 179.99, 'opposite horizon points');
  const bearing = v => Math.atan2(v.z, v.x);
  const turn = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
  assert.ok(Math.abs(bearing(rise) - SUNRISE_BEARING) < 1e-9 || Math.abs(turn(bearing(rise), SUNRISE_BEARING)) < 1e-9);
  assert.ok(Math.abs(degrees(turn(bearing(rise), bearing(noon))) + 90) < 1e-6, 'a quarter turn to noon, the way the x-z angle decreases');
  assert.ok(Math.abs(degrees(turn(bearing(noon), bearing(set))) + 90) < 1e-6, 'and another quarter to sunset');
});

test('the swing eases: slow near the horizons, quickest at noon, and always the same way round', () => {
  assert.equal(swing(0), 0);
  assert.ok(Math.abs(swing(Math.PI) - Math.PI) < 1e-12 && Math.abs(swing(TAU) - TAU) < 1e-12, 'half a turn per half cycle');
  const rate = angle => (swing(angle + 1e-6) - swing(angle - 1e-6)) / 2e-6;
  assert.ok(rate(1e-3) < 1e-4, 'nearly still at sunrise');
  assert.ok(Math.abs(rate(Math.PI / 2) - 2) < 1e-6, 'twice the average at noon');
  for (let a = 0.01; a < TAU; a += 0.01) assert.ok(swing(a) > swing(a - 0.01), 'never turns back');
});

test('the moon, opposite the sun, never jumps either', () => {
  let previous = sunAt(0).clone().negate();
  for (let i = 1; i <= 20000; i++) {
    const now = sunAt(i / 20000).clone().negate();
    assert.ok(angleBetween(previous, now) < 0.1, `moon step at ${i}`);
    previous = now;
  }
});
