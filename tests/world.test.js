import test from 'node:test';
import assert from 'node:assert/strict';
import { WORLD_SIZE, WATER, SPAWN, GRID_STEP, GRID_SEGMENTS, createHeightField, terrainHeight, stickVector, stickAxis, pivotRig } from '../src/world.js';

const field = createHeightField();
test('the world is one kilometre square and water is 500 metres from the central spawn', () => {
  assert.equal(WORLD_SIZE, 1000);
  assert.equal(SPAWN.x, 0); assert.equal(SPAWN.z, 0);
  assert.equal(Math.hypot(WATER.x - SPAWN.x, WATER.z - SPAWN.z), 500);
});
test('the pool is a shallow basin with dry banks on every side', () => {
  const depth = WATER.y - field.sample(WATER.x, WATER.z);
  assert.ok(depth > 0.75 && depth < 1);
  for (let i = 0; i < 64; i++) {
    const a = i / 64 * Math.PI * 2;
    assert.ok(field.sample(WATER.x + Math.cos(a) * 29, WATER.z + Math.sin(a) * 22) > WATER.y);
  }
});
test('collision exactly follows all mesh vertices and both triangle interiors', () => {
  for (let iz = 2; iz < GRID_SEGMENTS; iz += 37) for (let ix = 2; ix < GRID_SEGMENTS; ix += 31) {
    const x = ix * GRID_STEP - 500, z = iz * GRID_STEP - 500;
    assert.ok(Math.abs(field.sample(x, z) - terrainHeight(x, z)) < 0.00001);
    const a = field.vertex(ix, iz), b = field.vertex(ix + 1, iz), c = field.vertex(ix, iz + 1), d = field.vertex(ix + 1, iz + 1);
    assert.ok(Math.abs(field.sample(x + GRID_STEP / 3, z + GRID_STEP / 3) - (a + b + c) / 3) < 1e-6);
    assert.ok(Math.abs(field.sample(x + GRID_STEP * 2 / 3, z + GRID_STEP * 2 / 3) - (b + c + d) / 3) < 1e-6);
  }
});
test('terrain samples stay finite across the playable square', () => {
  let min = Infinity, max = -Infinity;
  for (const height of field.heights) { assert.ok(Number.isFinite(height)); min = Math.min(min, height); max = Math.max(max, height); }
  assert.ok(max < 45 && min > 0);
  assert.ok(Number.isFinite(field.sample(500, 500)));
});
test('stick drift is rejected and diagonals cannot exceed full walking speed', () => {
  assert.deepEqual(stickVector(0.08, 0.08), { x: 0, z: 0 });
  assert.equal(stickAxis(0.1), 0);
  assert.equal(stickAxis(1), 1);
  const diagonal = stickVector(1, 1);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - 1) < 1e-10);
});
test('continuous turning preserves the headset pivot after room-scale movement', () => {
  const pivot = { x: 103, z: 47 }, origin = { x: 101, z: 46 };
  const angle = 0.23;
  const result = pivotRig(origin.x, origin.z, pivot.x, pivot.z, angle);
  const ox = pivot.x - origin.x, oz = pivot.z - origin.z;
  const rx = ox * Math.cos(angle) + oz * Math.sin(angle);
  const rz = -ox * Math.sin(angle) + oz * Math.cos(angle);
  assert.ok(Math.abs(result.x + rx - pivot.x) < 1e-10);
  assert.ok(Math.abs(result.z + rz - pivot.z) < 1e-10);
});
