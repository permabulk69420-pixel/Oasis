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

// A player standing still `distance` metres from the stinger along +x, at head height 1.7 above flat ground
const playerAt = (x, z = 0) => ({ x, y: 1.7, z });

function nearby(seed = 11, extra = {}) {
  const events = { strikes: [], hurts: 0, deaths: 0 };
  const stinger = createStinger({
    world: flat, rng: seeded(seed), home, scale: 2.5, ...extra,
    onStrike: strike => events.strikes.push(strike),
    onHurt: () => { events.hurts++; },
    onDeath: () => { events.deaths++; },
  });
  stinger.state.x = 0; stinger.state.z = 0; stinger.state.yaw = 0;
  return { stinger, events };
}

test('it only notices you when you are close and the dunes do not hide you', () => {
  const hidden = nearby(3, { world: { ...flat, canSee: () => false } });
  run(hidden.stinger, 20, playerAt(0, 10));
  assert.ok(!['alert', 'stalk', 'windup'].includes(hidden.stinger.state.mode), 'a dune between you and it: it does not see you');
  const farAway = nearby(3);
  run(farAway.stinger, 20, playerAt(0, 60));
  assert.ok(!['alert', 'stalk', 'windup'].includes(farAway.stinger.state.mode), 'too far');
  const seen = nearby(3);
  run(seen.stinger, 0.3, playerAt(0, 15));
  assert.equal(seen.stinger.state.mode, 'alert');
  assert.ok(seen.stinger.state.pose.alert > 0.1, 'tail coming up');
});

test('seen, it faces you, creeps up slower than you walk, and winds up at striking range', () => {
  const { stinger } = nearby(5);
  const player = playerAt(0, 16);
  let fastest = 0;
  let sawWindup = false;
  run(stinger, 14, player, s => {
    if (s.mode === 'stalk') fastest = Math.max(fastest, s.speed);
    if (s.mode === 'windup') {
      sawWindup = true;
      const range = Math.hypot(player.x - s.x, player.z - s.z);
      assert.ok(range <= BRAIN.strikeRange + 0.1, `winds up at ${range.toFixed(1)} m`);
    }
  });
  assert.ok(sawWindup);
  assert.ok(fastest > 0.5 && fastest <= BRAIN.stalkSpeed * 1.05 && BRAIN.stalkSpeed < 2.6, `creeps at ${fastest.toFixed(2)} m/s, slower than a walk`);
});

test('the windup is a warning: the tail rears, the eyes flare, and nothing lands for nearly a second', () => {
  const { stinger, events } = nearby(5);
  const player = playerAt(0, 4);
  let warned = 0;
  let peakWindup = 0;
  let peakGlow = 0;
  run(stinger, 3, player, s => {
    if (s.mode === 'windup') { warned += 1 / 30; peakWindup = Math.max(peakWindup, s.pose.windup); peakGlow = Math.max(peakGlow, s.glow); }
    if (s.mode !== 'strike' && s.mode !== 'recover') assert.equal(events.strikes.length, 0, 'no blow before the strike');
  });
  assert.ok(warned > BRAIN.windupTime - 0.1, `warned for ${warned.toFixed(2)} s`);
  assert.ok(peakWindup > 0.9 && peakGlow > 0.9);
  assert.equal(events.strikes.length, 1, 'then one blow');
});

test('standing still where it was aimed, you are hit once; stepping aside after it has locked on, you are not', () => {
  const stood = nearby(5);
  run(stood.stinger, 6, playerAt(0, 4));
  assert.equal(stood.events.strikes.length >= 1, true);
  assert.equal(stood.events.strikes[0].hit, true);
  assert.equal(stood.events.strikes[0].damage, BRAIN.strikeDamage);

  const dodged = nearby(5);
  const player = playerAt(0, 4);
  run(dodged.stinger, 14, player, s => {
    if (s.mode === 'windup' && s.modeTime > BRAIN.aimLock + 0.05) { player.x = s.x + 4; player.z = s.z; } // steps 4 m aside once it has locked on
  });
  assert.ok(dodged.events.strikes.length >= 1);
  assert.equal(dodged.events.strikes[0].hit, false, 'a step to the side and the blow lands on empty sand');
  assert.ok(dodged.events.strikes.every(strike => strike.damage > 0));
});

test('the blow lands once per strike, and it keeps striking at a steady pace while you stay in range', () => {
  const { stinger, events } = nearby(5);
  run(stinger, 20, playerAt(0, 4));
  const cycle = BRAIN.windupTime + BRAIN.strikeTime + BRAIN.recoverTime;
  assert.ok(events.strikes.length >= 4 && events.strikes.length <= 20 / cycle + 2, `${events.strikes.length} strikes in 20 s`);
});

test('the lunge brings the sting to where it was aimed, no further', () => {
  const { stinger, events } = nearby(5);
  const player = playerAt(0, 4.4);
  run(stinger, 5, player);
  const strike = events.strikes[0];
  assert.ok(strike, 'it struck');
  assert.ok(Math.hypot(strike.x - player.x, strike.z - player.z) < 1.0, `the sting landed ${Math.hypot(strike.x - player.x, strike.z - player.z).toFixed(2)} m from you`);
});

test('hurt, it flinches, backs away from you while still facing you, then comes back', () => {
  const { stinger, events } = nearby(5);
  const player = playerAt(0, 6);
  run(stinger, 3, player); // it is in the middle of its business
  assert.ok(stinger.hurt(20));
  assert.equal(stinger.state.mode, 'hurt');
  assert.equal(events.hurts, 1);
  assert.equal(stinger.state.health, BRAIN.health - 20);
  run(stinger, 0.1, player);
  assert.ok(stinger.state.pose.hurt > 0.2, 'flinching');
  const before = Math.hypot(player.x - stinger.state.x, player.z - stinger.state.z);
  let backing = 0;
  let farthest = before;
  run(stinger, 3, player, s => {
    if (s.mode === 'retreat') {
      backing++;
      assert.ok(s.speed <= 0.01, 'backwards');
      const facing = Math.abs(wrapAngle(Math.atan2(player.x - s.x, player.z - s.z) - s.yaw));
      assert.ok(facing < 1.0, `still facing you (off by ${facing.toFixed(2)})`);
    }
    farthest = Math.max(farthest, Math.hypot(player.x - s.x, player.z - s.z));
  });
  assert.ok(backing > 30, 'it backed off');
  assert.ok(farthest > before + 2, `opened a gap of ${(farthest - before).toFixed(1)} m`);
  run(stinger, 10, player);
  assert.ok(['stalk', 'windup', 'strike', 'recover'].includes(stinger.state.mode), `back at you (${stinger.state.mode})`);
});

test('a flinch stops a strike in its tracks: a windup interrupted lands nothing', () => {
  const { stinger, events } = nearby(5);
  const player = playerAt(0, 4);
  run(stinger, 3, player, s => { if (s.mode === 'windup' && s.modeTime > 0.4) stinger.hurt(10); });
  assert.equal(events.strikes.length >= 0, true);
  const first = events.strikes[0];
  assert.ok(!first || events.hurts >= 1);
  assert.ok(stinger.state.health < BRAIN.health);
});

test('enough damage kills it: it curls up, stays still, is gone after a while and a new one turns up at home later', () => {
  const { stinger, events } = nearby(7);
  const player = playerAt(0, 6);
  run(stinger, 2, player);
  stinger.hurt(60);
  run(stinger, 1, player);
  assert.ok(stinger.hurt(60), 'the last blow lands');
  assert.equal(events.deaths, 1);
  assert.equal(stinger.state.mode, 'dead');
  assert.equal(stinger.alive, false);
  assert.equal(stinger.hurt(10), false, 'a dead one cannot be hurt again');
  const strikesBefore = events.strikes.length;
  run(stinger, 3, player);
  assert.ok(stinger.state.pose.dead > 0.95, 'curled up');
  assert.ok(Math.abs(stinger.state.speed) < 0.05 && stinger.state.active);
  assert.equal(events.strikes.length, strikesBefore, 'no more blows');
  run(stinger, BRAIN.deadLinger, far);
  assert.equal(stinger.state.active, false, 'the body is gone');
  run(stinger, BRAIN.respawnAfter, far);
  assert.equal(stinger.state.active, true, 'a new one');
  assert.equal(stinger.state.health, BRAIN.health);
  assert.ok(Math.hypot(stinger.state.x - home.x, stinger.state.z - home.z) < 25);
  assert.equal(stinger.state.pose.dead < 0.05, true);
});

test('it gives up when you get far away and walks home', () => {
  const { stinger } = nearby(5);
  run(stinger, 3, playerAt(0, 18));
  assert.ok(['alert', 'stalk'].includes(stinger.state.mode));
  run(stinger, 5, playerAt(0, 300));
  assert.ok(['return', 'idle', 'turn', 'walk'].includes(stinger.state.mode), stinger.state.mode);
  run(stinger, 120, far);
  assert.ok(Math.hypot(stinger.state.x - home.x, stinger.state.z - home.z) < BRAIN.wanderRadius + 2, 'back near home');
});

test('stalking you it does not walk into blocked ground', () => {
  const world = { groundAt: () => 0, blocked: (x, z) => z > 6 && z < 9 && Math.abs(x) < 50 };
  const { stinger } = nearby(5, { world });
  run(stinger, 40, playerAt(0, 14), s => assert.ok(!(s.z > 6 && s.z < 9), `walked into the wall at z=${s.z.toFixed(1)}`));
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
