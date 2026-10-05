import test from 'node:test';
import assert from 'node:assert/strict';
import { aimGroundPoint, PLACEMENT } from '../src/placement.js';

const flat = () => 0;
const raw = { grid: 0 }; // no snapping, so the numbers can be exact
const near = (a, b, eps = 0.02) => assert.ok(Math.abs(a - b) < eps, `${a} is not within ${eps} of ${b}`);

test('a ray from eye height meets flat ground where the geometry says', () => {
  // eye 1.7 m up, pointing down at 45 degrees, forward is -z: lands 1.7 m ahead
  const aim = aimGroundPoint({ x: 0, y: 1.7, z: 0 }, { x: 0, y: -1, z: -1 }, flat, { x: 0, z: 0 }, raw);
  assert.equal(aim.hit, true);
  near(aim.x, 0); near(aim.z, -1.7);
});

test('it finds slopes, not just flat ground', () => {
  const hill = (x, z) => 0.5 * Math.max(0, -z - 1); // rises as you go ahead
  const aim = aimGroundPoint({ x: 0, y: 1.7, z: 0 }, { x: 0, y: -0.4, z: -1 }, hill, { x: 0, z: 0 }, raw);
  assert.equal(aim.hit, true);
  // on the hill: height there equals the ray height there
  const t = -aim.z;
  near(1.7 - 0.4 * t, hill(0, aim.z), 0.03);
});

test('pointing far ahead clamps to the reach, and pointing at your feet pushes out to the minimum', () => {
  const far = aimGroundPoint({ x: 0, y: 1.7, z: 0 }, { x: 0, y: -0.1, z: -1 }, flat, { x: 0, z: 0 }, raw);
  near(Math.hypot(far.x, far.z), PLACEMENT.maxReach, 1e-6);
  const feet = aimGroundPoint({ x: 0, y: 1.7, z: 0 }, { x: 0, y: -1, z: -0.05 }, flat, { x: 0, z: 0 }, raw);
  near(Math.hypot(feet.x, feet.z), PLACEMENT.minReach, 1e-6);
  near(feet.x, 0, 0.1); assert.ok(feet.z < 0, 'still out in front');
});

test('with no ground in sight (looking up or level at the sky) it goes straight ahead at the fallback reach', () => {
  const up = aimGroundPoint({ x: 3, y: 1.7, z: 3 }, { x: 1, y: 0.8, z: 0 }, flat, { x: 3, z: 3 }, raw);
  assert.equal(up.hit, false);
  near(up.x, 3 + PLACEMENT.fallbackReach, 1e-6); near(up.z, 3, 1e-6);
  const level = aimGroundPoint({ x: 0, y: 1.7, z: 0 }, { x: 0, y: 0, z: -1 }, flat, { x: 0, z: 0 }, raw);
  assert.equal(level.hit, false);
  near(level.z, -PLACEMENT.fallbackReach, 1e-6);
});

test('looking straight down still gives a spot (out in front), not NaN', () => {
  const down = aimGroundPoint({ x: 0, y: 1.7, z: 0 }, { x: 0, y: -1, z: 0 }, flat, { x: 0, z: 0 }, raw);
  assert.ok(Number.isFinite(down.x) && Number.isFinite(down.z));
  near(Math.hypot(down.x, down.z), PLACEMENT.minReach, 1e-6);
});

test('a hand held low still reaches ground ahead, and a hand inside a dune finds the surface', () => {
  const dune = (x, z) => (z < -1 ? 0.8 : 0);
  const aim = aimGroundPoint({ x: 0, y: 0.5, z: -2 }, { x: 0, y: -0.2, z: -1 }, dune, { x: 0, z: 0 }, raw);
  assert.equal(aim.hit, true);
  assert.ok(Number.isFinite(aim.x) && Number.isFinite(aim.z));
});

test('the spot snaps to the grid, so a shaking hand gives the same cell and the same turn', () => {
  const a = aimGroundPoint({ x: 0, y: 1.7, z: 0 }, { x: 0.001, y: -1, z: -1 }, flat, { x: 0, z: 0 });
  const b = aimGroundPoint({ x: 0, y: 1.7, z: 0 }, { x: 0.004, y: -1, z: -1.001 }, flat, { x: 0, z: 0 });
  assert.equal(a.x, b.x); assert.equal(a.z, b.z);
  near(a.x / PLACEMENT.grid, Math.round(a.x / PLACEMENT.grid), 1e-9);
});

test('it fills and returns the object it is given, so a per-frame caller allocates nothing', () => {
  const out = { x: 0, z: 0, hit: false };
  const result = aimGroundPoint({ x: 0, y: 1.7, z: 0 }, { x: 0, y: -1, z: -1 }, flat, { x: 0, z: 0 }, null, out);
  assert.equal(result, out);
  assert.equal(out.hit, true);
});
