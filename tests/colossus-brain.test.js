import test from 'node:test';
import assert from 'node:assert/strict';
import { createColossusBrain, COLOSSUS_BRAIN, leashNorm, boundaryAfter, wrapPi } from '../src/colossus-brain.js';
import { AREA } from '../src/zones.js';

function seeded(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function run(brain, seconds, onStep, dt = 1 / 30) {
  for (let t = 0; t < seconds; t += dt) {
    brain.update(dt);
    onStep?.(brain.state);
  }
}

test('its leash is half of the gravel plain, and it starts inside it', () => {
  const plain = AREA.flats[0];
  assert.equal(COLOSSUS_BRAIN.leash.x, plain.x);
  assert.equal(COLOSSUS_BRAIN.leash.z, plain.z);
  assert.equal(COLOSSUS_BRAIN.leash.rx, plain.rx * 0.5);
  assert.equal(COLOSSUS_BRAIN.leash.rz, plain.rz * 0.5);
  assert.ok(leashNorm(COLOSSUS_BRAIN.start.x, COLOSSUS_BRAIN.start.z) < 0.5);
});

test('it walks about the plain for an hour without leaving it, never faster than its walking pace or turning faster than its limit', () => {
  const brain = createColossusBrain({ rng: seeded(11) });
  let farthest = 0, fastest = 0, turned = 0, walked = 0;
  run(brain, 3600, s => {
    farthest = Math.max(farthest, leashNorm(s.x, s.z));
    fastest = Math.max(fastest, s.speed);
    turned = Math.max(turned, Math.abs(s.turn));
    if (s.speed > 0.5) walked++;
    for (const key of ['x', 'z', 'yaw', 'speed', 'turn', 'cycles', 'calm']) assert.ok(Number.isFinite(s[key]), `${key} went ${s[key]}`);
  });
  assert.ok(farthest <= 1.02, `it reached ${farthest.toFixed(3)} of the leash`);
  assert.ok(fastest <= COLOSSUS_BRAIN.walkSpeed + 1e-6, `it hit ${fastest.toFixed(3)} m/s`);
  assert.ok(turned <= COLOSSUS_BRAIN.maxTurn + 1e-6, `it turned at ${turned.toFixed(4)} rad/s`);
  assert.ok(walked > 3600 * 30 * 0.15, 'it does walk, it is not a statue');
});

test('it speeds up and slows down gently: nothing faster than its acceleration limits', () => {
  const brain = createColossusBrain({ rng: seeded(3) });
  let most = 0, least = 0;
  run(brain, 1200, s => { most = Math.max(most, s.accel); least = Math.min(least, s.accel); });
  assert.ok(most <= COLOSSUS_BRAIN.accel * 1.02, `sped up at ${most.toFixed(3)} m/s2`);
  assert.ok(least >= -COLOSSUS_BRAIN.decel * 1.02, `slowed at ${least.toFixed(3)} m/s2`);
});

test('every stop finishes the step it was in: the gait clock holds on a quarter cycle with the speed at zero', () => {
  const brain = createColossusBrain({ rng: seeded(5) });
  let stops = 0;
  let before = 'stand';
  run(brain, 2400, s => {
    if (before !== 'stand' && s.mode === 'stand') {
      stops++;
      assert.equal(s.speed, 0);
      const quarters = s.cycles * 4;
      assert.ok(Math.abs(quarters - Math.round(quarters)) < 1e-9, `stopped at ${s.cycles} cycles`);
    }
    before = s.mode;
  });
  assert.ok(stops >= 5, `only ${stops} stops in 40 minutes`);
});

test('it stands between walks for 25 to 70 seconds, and the feet settle flat after a moment of standing', () => {
  const brain = createColossusBrain({ rng: seeded(21) });
  const stands = [];
  let since = null;
  let settled = false;
  run(brain, 2400, s => {
    if (s.mode === 'stand' && since === null) since = s.time;
    if (s.mode === 'stand' && s.calm >= 1) settled = true;
    if (s.mode !== 'stand' && since !== null) { stands.push(s.time - since); since = null; }
  });
  assert.ok(stands.length >= 5);
  for (const seconds of stands.slice(1)) {
    assert.ok(seconds >= COLOSSUS_BRAIN.stand[0] - 0.1 && seconds <= COLOSSUS_BRAIN.stand[1] + 2, `stood ${seconds.toFixed(1)} s`);
  }
  assert.ok(settled, 'the feet go flat while it stands');
});

test('the gait clock only runs while it moves, and it looks about while it stands', () => {
  const brain = createColossusBrain({ rng: seeded(8) });
  const gazes = new Set();
  let frozenWhileStanding = true;
  let last = brain.state.cycles;
  let was = brain.state.mode;
  run(brain, 600, s => {
    if (s.mode === 'stand') {
      if (was === 'stand' && s.cycles !== last) frozenWhileStanding = false; // (the frame it stops on snaps the clock to the step's end)
      gazes.add(Math.round(s.gaze.yaw * 100));
    }
    last = s.cycles;
    was = s.mode;
  });
  assert.ok(frozenWhileStanding, 'the clock ran while it stood');
  assert.ok(gazes.size >= 4, 'it turns its head to different places');
});

test('the same seed gives the same walk, and a huge frame time is treated as a tenth of a second', () => {
  const a = createColossusBrain({ rng: seeded(99) });
  const b = createColossusBrain({ rng: seeded(99) });
  run(a, 300);
  run(b, 300);
  assert.deepEqual({ x: a.state.x, z: a.state.z, yaw: a.state.yaw }, { x: b.state.x, z: b.state.z, yaw: b.state.yaw });
  const c = createColossusBrain({ rng: seeded(1) });
  const d = createColossusBrain({ rng: seeded(1) });
  c.update(30);
  d.update(0.1);
  assert.equal(c.state.time, d.state.time);
  c.update(-1);
  c.update(NaN);
  assert.equal(c.state.time, d.state.time);
});

test('it can be placed, stood still and sent off (for the dev fixtures)', () => {
  const brain = createColossusBrain({ rng: seeded(2) });
  brain.place(10, 20, 1);
  assert.deepEqual([brain.state.x, brain.state.z, brain.state.yaw], [10, 20, 1]);
  brain.stand();
  run(brain, 200);
  assert.equal(brain.state.mode, 'stand');
  assert.equal(brain.state.speed, 0);
  assert.equal(brain.state.cycles * 4 % 1, 0);
  const fresh = createColossusBrain({ rng: seeded(2), config: { ...COLOSSUS_BRAIN, stand: [1000, 1000] } });
  fresh.walk();
  assert.equal(fresh.state.mode, 'walk');
});

test('the small helpers: angles wrap, the next step boundary is a quarter cycle on', () => {
  assert.ok(Math.abs(wrapPi(3 * Math.PI) - Math.PI) < 1e-9 || Math.abs(wrapPi(3 * Math.PI) + Math.PI) < 1e-9);
  assert.ok(Math.abs(wrapPi(-4)) < Math.PI);
  assert.equal(boundaryAfter(0), 0);
  assert.equal(boundaryAfter(0.01), 0.25);
  assert.equal(boundaryAfter(0.25), 0.25);
  assert.equal(boundaryAfter(1.2501), 1.5);
  assert.equal(leashNorm(COLOSSUS_BRAIN.leash.x, COLOSSUS_BRAIN.leash.z), 0);
  assert.ok(Math.abs(leashNorm(COLOSSUS_BRAIN.leash.x + COLOSSUS_BRAIN.leash.rx, COLOSSUS_BRAIN.leash.z) - 1) < 1e-12);
});
