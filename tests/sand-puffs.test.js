import test from 'node:test';
import assert from 'node:assert/strict';
import { createPuffSim, PUFFS } from '../src/sand-puffs.js';

function seeded(seed = 7) {
  let a = seed;
  return () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; };
}

function rig(options = {}) {
  const capacity = options.capacity ?? 32;
  const sim = createPuffSim({ capacity, random: seeded(), heightAt: options.heightAt ?? (() => 0) });
  const place = new Float32Array(capacity * 4);
  const look = new Float32Array(capacity * 4);
  return { sim, place, look, capacity };
}

test('a burst of puffs appears, swells, fades and is gone, and nothing is left drawing', () => {
  const { sim, place, look } = rig();
  sim.emit(10, 2, -5, 8, { life: [1, 1], alpha: 0.5, size: [0.5, 0.5] });
  let drawn = sim.update(0.1, place, look);
  assert.equal(drawn, 8);
  assert.equal(sim.live, 8);
  const early = look[0];
  assert.ok(early >= 0.5 && early < 0.5 * PUFFS.grow);
  for (let t = 0; t < 0.8; t += 0.1) drawn = sim.update(0.1, place, look);
  assert.ok(look[0] > early, 'it has spread');
  assert.ok(look[0] <= 0.5 * PUFFS.grow + 1e-6, 'but never past its full size');
  sim.update(0.5, place, look);
  assert.equal(sim.live, 0);
  for (let i = 0; i < 8; i++) assert.equal(look[i * 4 + 1], 0, 'a finished puff has no strength left');
});

test('puffs fade in and out: no pop at the start or the end, and never stronger than asked', () => {
  const { sim, place, look } = rig();
  sim.emit(0, 0, 0, 1, { life: [2, 2], alpha: 0.6 });
  let peak = 0;
  const alphas = [];
  for (let i = 0; i < 40; i++) {
    sim.update(0.05, place, look);
    alphas.push(look[1]);
    peak = Math.max(peak, look[1]);
  }
  assert.ok(alphas[0] < peak * 0.6, 'comes in gently');
  assert.ok(peak <= 0.6 + 1e-6);
  assert.ok(alphas[alphas.length - 1] < peak * 0.1, 'and ends gently');
});

test('puffs slow down in the air, drift up, and never sink into the dune', () => {
  const ground = (x) => 5 + Math.sin(x) * 0.5;
  const { sim, place, look } = rig({ heightAt: ground });
  sim.emit(3, 5, 0, 12, { outward: 5, up: -3, size: [0.6, 0.9], life: [2, 2] });
  let farthest = 0;
  let last = 0;
  for (let t = 0; t < 1.9; t += 0.05) {
    sim.update(0.05, place, look);
    for (let i = 0; i < 12; i++) {
      const radius = look[i * 4];
      assert.ok(place[i * 4 + 1] >= ground(place[i * 4]) + radius * PUFFS.floor - 1e-4, 'above the sand');
      assert.ok(Number.isFinite(place[i * 4]) && Number.isFinite(place[i * 4 + 2]));
      assert.ok(Math.abs(place[i * 4 + 3] - ground(place[i * 4])) < 1e-4, 'it knows the ground under it');
    }
    const d = Math.hypot(place[0] - 3, place[2]);
    last = d - farthest;
    farthest = Math.max(farthest, d);
  }
  assert.ok(farthest < 5 * 2 / PUFFS.drag + 1.5, `air slows them (${farthest.toFixed(2)} m)`);
  assert.ok(Math.abs(last) < 0.2, 'nearly still by the end');
});

test('a full pool reuses the oldest slots instead of growing', () => {
  const { sim, place, look, capacity } = rig({ capacity: 10 });
  sim.emit(0, 0, 0, 25, { life: [3, 3] });
  const drawn = sim.update(0.05, place, look);
  assert.equal(drawn, capacity);
  assert.equal(sim.live, capacity);
});

test('a shove along a direction sends the puffs that way', () => {
  const { sim, place, look } = rig();
  sim.emit(0, 0, 0, 10, { outward: 0, jitter: 0, push: [0, -1, 4], radius: 0.01, life: [1.5, 1.5] });
  for (let i = 0; i < 10; i++) sim.update(0.05, place, look);
  for (let i = 0; i < 10; i++) assert.ok(place[i * 4 + 2] < -0.3, `puff ${i} went back (${place[i * 4 + 2].toFixed(2)})`);
});

test('zero or negative time changes nothing', () => {
  const { sim, place, look } = rig();
  sim.emit(1, 1, 1, 3, {});
  assert.equal(sim.update(0, place, look), 0);
  assert.equal(sim.update(-1, place, look), 0);
});
