import test from 'node:test';
import assert from 'node:assert/strict';
import { createStinger, BRAIN, wrapAngle } from '../src/stinger-brain.js';

function seeded(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const flat = { groundAt: () => 0, blocked: () => false };
const far = { x: 5000, z: 5000 };
const home = { x: 0, z: 0 };

function run(stinger, seconds, player = far, onStep = null, dt = 1 / 30) {
  for (let t = 0; t < seconds; t += dt) {
    stinger.update(dt, player);
    onStep?.(stinger.state);
  }
}

test('left alone it wanders near home, never faster than its walking pace, and never stops moving about for long', () => {
  const stinger = createStinger({ world: flat, rng: seeded(7), home });
  let farthest = 0;
  let fastest = 0;
  let walked = 0;
  run(stinger, 1200, far, s => {
    farthest = Math.max(farthest, Math.hypot(s.x, s.z));
    fastest = Math.max(fastest, s.speed);
    if (s.speed > 0.3) walked++;
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z) && Number.isFinite(s.yaw) && Number.isFinite(s.pose.phase));
  });
  assert.ok(farthest <= BRAIN.wanderRadius + 2, `strayed ${farthest.toFixed(1)} m`);
  assert.ok(fastest <= BRAIN.walkSpeed * 1.05, `fastest ${fastest.toFixed(2)} m/s`);
  assert.ok(walked > 1200 * 30 * 0.1, 'it does walk about, not just stand there');
});

test('it never walks into the pond or a blocked spot, nor up a slope that is too steep', () => {
  // a wall of blocked ground to the east and a steep ramp to the north
  const world = {
    groundAt: (x, z) => (z > 6 ? (z - 6) * 2 : 0),
    blocked: (x, z) => x > 8,
  };
  for (const seed of [1, 2, 3, 4]) {
    const stinger = createStinger({ world, rng: seeded(seed), home });
    run(stinger, 900, far, s => {
      assert.ok(s.x < 8.5, `seed ${seed}: reached x=${s.x.toFixed(1)}`);
      assert.ok(s.z < 8, `seed ${seed}: climbed the ramp, z=${s.z.toFixed(1)}`);
    });
  }
});

test('when you come near it stops, turns to face you and curls its tail up; when you leave it carries on', () => {
  const stinger = createStinger({ world: flat, rng: seeded(11), home });
  run(stinger, 20); // let it get moving
  const player = { x: stinger.state.x + 10, z: stinger.state.z + 4 };
  run(stinger, 8, player);
  const s = stinger.state;
  assert.equal(s.mode, 'watch');
  assert.ok(s.speed < 0.05, 'stopped');
  assert.ok(s.pose.alert > 0.95, 'tail up');
  const facing = wrapAngle(Math.atan2(player.x - s.x, player.z - s.z) - s.yaw);
  assert.ok(Math.abs(facing) < 0.15, `facing you (off by ${facing.toFixed(2)})`);
  // it never closes in on you while watching
  const before = Math.hypot(player.x - s.x, player.z - s.z);
  run(stinger, 20, player);
  assert.ok(Math.hypot(player.x - s.x, player.z - s.z) >= before - 0.5, 'it stays where it is');
  // between the two distances it keeps watching, beyond the larger one it goes back to its business
  run(stinger, 2, { x: s.x + (BRAIN.watchDistance + BRAIN.watchRelease) / 2, z: s.z });
  assert.equal(stinger.state.mode, 'watch');
  run(stinger, 30, far);
  assert.notEqual(stinger.state.mode, 'watch');
  assert.ok(stinger.state.pose.alert < 0.05, 'tail down again');
});

test('the legs only step while it is moving or turning, and the cycle follows the ground it covers', () => {
  const stinger = createStinger({ world: flat, rng: seeded(5), home, scale: 2.5 });
  let moved = 0;
  let cycles = 0;
  let last = stinger.state.pose.phase;
  let lastX = stinger.state.x;
  let lastZ = stinger.state.z;
  run(stinger, 300, far, s => {
    const d = Math.hypot(s.x - lastX, s.z - lastZ);
    let dp = s.pose.phase - last;
    if (dp < -Math.PI) dp += Math.PI * 2 * 1000; // wrapped
    if (s.mode === 'idle' && s.speed < 0.01 && Math.abs(s.yawRate) < 0.01 && s.pose.gait < 0.02) assert.ok(Math.abs(dp) < 5e-3, 'standing still, the legs do not cycle');
    if (s.speed > 0.8 && d > 0) { moved += d; cycles += dp / (Math.PI * 2); }
    last = s.pose.phase; lastX = s.x; lastZ = s.z;
  });
  assert.ok(moved > 20, 'it walked');
  const metresPerCycle = moved / cycles;
  assert.ok(Math.abs(metresPerCycle - BRAIN.stride * 2.5) < 0.05, `${metresPerCycle.toFixed(2)} m per cycle`);
});

test('the same seed gives the same wander', () => {
  const trace = seed => {
    const stinger = createStinger({ world: flat, rng: seeded(seed), home });
    run(stinger, 120);
    return [stinger.state.x, stinger.state.z, stinger.state.yaw];
  };
  assert.deepEqual(trace(9), trace(9));
  assert.notDeepEqual(trace(9), trace(10));
});
