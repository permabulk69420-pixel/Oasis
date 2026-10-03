import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeightField, WATER, SPAWN, HERO_TREE, isInPond } from '../src/world.js';
import { createBird, BRAIN, sipDepth } from '../src/bird-brain.js';
import { wrapAngle, pickLanding } from '../src/bird-flight.js';

function seeded(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const field = createHeightField();
const world = {
  pond: { x: WATER.x, z: WATER.z, y: WATER.y, radiusX: WATER.radiusX, radiusZ: WATER.radiusZ },
  groundAt: field.sample,
  inWater: (x, z) => isInPond(x, z, field.sample(x, z)),
  avoid: () => [{ x: HERO_TREE.x, z: HERO_TREE.z, r: 18 }],
};
const SCALE = 1.2;
const FEET = 0.337 * SCALE;
const DT = 1 / 60;
const farPlayer = () => ({ x: SPAWN.x, y: field.sample(SPAWN.x, SPAWN.z), z: SPAWN.z });

function newBird(seed, start = 'visit', ctx = { player: farPlayer(), daylight: 1 }) {
  const bird = createBird({ world, rng: seeded(seed), scale: SCALE });
  if (start === 'visit') bird.startVisit(ctx);
  else if (start === 'passing') bird.startPassing(ctx);
  return bird;
}

// Runs the bird for `seconds`, calling `each(state, t)` every frame; returns the modes it went through, with times.
function run(bird, ctx, seconds, each = null) {
  const modes = [];
  let t = 0;
  while (t < seconds && bird.state.active) {
    bird.update(DT, ctx);
    t += DT;
    const key = bird.state.mode;
    if (modes.length === 0 || modes[modes.length - 1].mode !== key) modes.push({ mode: key, at: t });
    if (each) each(bird.state, t);
  }
  return { modes, t };
}

test('a whole visit: it flies in, lands, stays a while, takes off and goes', () => {
  for (const seed of [1, 2, 3, 4]) {
    const ctx = { player: farPlayer(), daylight: 1 };
    const bird = newBird(seed, 'visit', ctx);
    assert.equal(bird.state.active, true);
    assert.equal(bird.state.kind, 'visit');
    const { modes, t } = run(bird, ctx, 400);
    assert.deepEqual(modes.map(m => m.mode), ['flying', 'perched', 'crouch', 'flying', 'gone']);
    assert.equal(bird.state.active, false, 'and then it is gone');
    const perched = modes[2].at - modes[1].at; // from touching down to the crouch
    assert.ok(perched >= BRAIN.stayRange[0] - 0.1 && perched <= BRAIN.stayRange[1] + 0.1, `stays ${perched} s`);
    assert.ok(t > 70 && t < 180, `the whole visit takes ${t} s`);
  }
});

test('it touches down on the spot it chose, slowly, feet on the ground, then faces the water', () => {
  const ctx = { player: farPlayer(), daylight: 1 };
  const bird = newBird(7, 'visit', ctx);
  const spot = bird.landing;
  let touch = null;
  let last = null;
  let yawLater = null;
  run(bird, ctx, 200, (state, t) => {
    if (state.mode === 'flying' && !touch) last = { speed: state.speed };
    if (state.mode === 'perched' && !touch) touch = { x: state.x, y: state.y, z: state.z, t };
    if (touch && yawLater === null && t > touch.t + 6) yawLater = state.yaw;
  });
  assert.ok(touch, 'it landed');
  assert.ok(Math.hypot(touch.x - spot.x, touch.z - spot.z) < 0.2);
  assert.ok(Math.abs(touch.y - (spot.groundY + FEET)) < 0.05, 'standing on the ground');
  assert.ok(last.speed <= 0.8, `landed at ${last.speed} m/s`);
  assert.ok(Math.abs(wrapAngle(yawLater - spot.yawToWater)) < 0.5, `faces the water: ${yawLater} vs ${spot.yawToWater}`);
});

test('the pose stays sane the whole way through', () => {
  const ctx = { player: farPlayer(), daylight: 1 };
  for (const seed of [11, 12]) {
    const bird = newBird(seed, 'visit', ctx);
    run(bird, ctx, 400, state => {
      for (const [key, value] of Object.entries(state.pose)) assert.ok(Number.isFinite(value), `${key} is a number`);
      assert.ok(Number.isFinite(state.x + state.y + state.z + state.yaw + state.pitch + state.roll));
      assert.ok(state.pose.fold >= -0.01 && state.pose.fold <= 1.01, `fold ${state.pose.fold}`);
      assert.ok(state.pose.legs >= -0.01 && state.pose.legs <= 1.01, `legs ${state.pose.legs}`);
      assert.ok(state.pose.stretch >= -0.01 && state.pose.stretch <= 1.01);
      assert.ok(state.pose.flap > -0.9 && state.pose.flap < 1.1, `flap ${state.pose.flap}`);
      assert.ok(Math.abs(state.pose.flex) < 0.9, `flex ${state.pose.flex}`);
      assert.ok(Math.abs(state.roll) <= 0.8 && Math.abs(state.pitch) < 1.2);
      assert.ok(state.altitude > -0.05, `never underground: ${state.altitude}`);
    });
  }
});

test('it moves like a bird: never fast, and no sudden jumps once under way', () => {
  const ctx = { player: farPlayer(), daylight: 1 };
  const bird = newBird(21, 'visit', ctx);
  let previous = null;
  let worstJump = 0;
  let fastest = 0;
  run(bird, ctx, 400, (state, t) => {
    if (previous && t > 0.1) {
      const step = Math.hypot(state.x - previous.x, state.y - previous.y, state.z - previous.z);
      fastest = Math.max(fastest, step / DT);
      worstJump = Math.max(worstJump, Math.abs(wrapAngle(state.yaw - previous.yaw)));
    }
    previous = { x: state.x, y: state.y, z: state.z, yaw: state.yaw };
  });
  assert.ok(fastest < 16, `fastest ${fastest} m/s`);
  assert.ok(worstJump < 0.14, `turns at most ${worstJump} rad in a frame (8 rad/s is the limit)`);
});

test('walking up to a perched bird makes it crouch and fly off, away from you', () => {
  const ctx = { player: farPlayer(), daylight: 1 };
  const bird = newBird(3, 'visit', ctx);
  while (bird.state.mode !== 'perched') bird.update(DT, ctx);
  run(bird, ctx, 2, null); // it settles
  assert.equal(bird.state.mode, 'perched');
  ctx.player = { x: bird.state.x + 5, y: 0, z: bird.state.z };
  let t = 0;
  while (t < 1 && bird.state.mode === 'perched') { bird.update(DT, ctx); t += DT; }
  assert.equal(bird.state.mode, 'crouch', 'it crouches at once');
  assert.ok(t < 0.2);
  while (bird.state.mode === 'crouch') bird.update(DT, ctx);
  assert.equal(bird.state.mode, 'flying');
  assert.equal(bird.state.phase, 'takeoff');
  const d0 = Math.hypot(bird.state.x - ctx.player.x, bird.state.z - ctx.player.z);
  run(bird, ctx, 4, null);
  const d1 = Math.hypot(bird.state.x - ctx.player.x, bird.state.z - ctx.player.z);
  assert.ok(d1 > d0 + 20, `${d0} → ${d1}`);
  assert.ok(bird.state.altitude > 8, 'and climbing');
});

test('a player who stays well away is left in peace; one who comes nearer makes it alert', () => {
  const ctx = { player: farPlayer(), daylight: 1 };
  const bird = newBird(5, 'visit', ctx);
  while (bird.state.mode !== 'perched') bird.update(DT, ctx);
  run(bird, ctx, 3, null);
  assert.ok(['idle', 'drink'].includes(bird.state.phase));
  assert.ok(bird.state.pose.crest < 0.5, 'relaxed');
  // 15 m away
  const here = { x: bird.state.x, z: bird.state.z };
  ctx.player = { x: here.x - 15 * Math.sin(bird.state.yaw), y: 0, z: here.z - 15 * Math.cos(bird.state.yaw) }; // behind it
  run(bird, ctx, 2, null);
  assert.equal(bird.state.mode, 'perched');
  assert.equal(bird.state.phase, 'alert');
  assert.ok(bird.state.pose.crest > 0.6, 'crest up');
  assert.equal(bird.state.pose.dip < 0.05, true, 'no drinking while watching');
  // it ends up facing the player (body turned, or head turned)
  run(bird, ctx, 3, null);
  const toPlayer = Math.atan2(ctx.player.x - bird.state.x, ctx.player.z - bird.state.z);
  const facing = wrapAngle(bird.state.yaw + bird.state.pose.headYaw * 0.65 + bird.state.pose.headYaw * 0.35 - toPlayer);
  assert.ok(Math.abs(facing) < 0.5, `looking ${facing} rad off the player`);
  // and goes back to its business once they are well away
  ctx.player = farPlayer();
  run(bird, ctx, 6, null);
  assert.notEqual(bird.state.phase, 'alert');
});

test('it drinks: the head goes down to the water now and then', () => {
  const ctx = { player: farPlayer(), daylight: 1 };
  const bird = newBird(8, 'visit', ctx);
  while (bird.state.mode !== 'perched') bird.update(DT, ctx);
  let deepest = 0;
  let drinks = 0;
  let was = false;
  const stayed = run(bird, ctx, 20, state => {
    deepest = Math.max(deepest, state.pose.dip);
    const now = state.phase === 'drink';
    if (now && !was) drinks++;
    was = now;
  });
  assert.ok(deepest > 0.9, `dips to ${deepest}`);
  assert.ok(drinks >= 1, `drinks ${drinks} times in ${stayed.t.toFixed(0)} s`);
});

test('a sip is a dip, a pause with the head down, and back up', () => {
  assert.equal(sipDepth(0), 0);
  assert.ok(sipDepth(0.2) > 0 && sipDepth(0.2) < 1);
  assert.ok(sipDepth(0.8) > 0.9);
  assert.ok(sipDepth(1.4) > 0 && sipDepth(1.4) < 1);
  assert.equal(sipDepth(1.9), 0);
  assert.ok(Math.abs(sipDepth(0.7) - sipDepth(0.7 + 2.1)) < 1e-9, 'one sip after another');
});

test('at dusk a perched bird leaves, and a bird still arriving turns away and never lands', () => {
  const ctx = { player: farPlayer(), daylight: 1 };
  const perched = newBird(9, 'visit', ctx);
  while (perched.state.mode !== 'perched') perched.update(DT, ctx);
  run(perched, ctx, 2, null);
  ctx.daylight = 0.1;
  const { t } = run(perched, ctx, 90, null);
  assert.equal(perched.state.active, false, `gone after ${t} s`);
  assert.ok(t < 60);

  const arriving = newBird(9, 'visit', ctx);
  const dusk = { player: farPlayer(), daylight: 1 };
  const modes = [];
  let t2 = 0;
  while (arriving.state.active && t2 < 300) {
    if (t2 > 20) dusk.daylight = 0.1;
    arriving.update(DT, dusk);
    t2 += DT;
    if (modes[modes.length - 1] !== arriving.state.mode) modes.push(arriving.state.mode);
  }
  assert.ok(!modes.includes('perched'), `it never landed: ${modes}`);
  assert.equal(arriving.state.active, false);
});

test('it will not land on top of the player: a landing is called off', () => {
  const ctx = { player: farPlayer(), daylight: 1 };
  const bird = newBird(13, 'visit', ctx);
  const spot = bird.landing;
  ctx.player = { x: spot.x + 4, y: 0, z: spot.z };
  const modes = [];
  let t = 0;
  while (bird.state.active && t < 300) {
    bird.update(DT, ctx);
    t += DT;
    if (modes[modes.length - 1] !== bird.state.mode) modes.push(bird.state.mode);
  }
  assert.ok(!modes.includes('perched'), `no landing: ${modes}`);
  assert.equal(bird.state.active, false);
});

test('a bird crossing the sky never lands and goes away again', () => {
  const ctx = { player: farPlayer(), daylight: 1 };
  const bird = newBird(14, 'passing', ctx);
  assert.equal(bird.state.kind, 'passing');
  let lowest = Infinity;
  const { modes, t } = run(bird, ctx, 400, state => { lowest = Math.min(lowest, state.altitude); });
  assert.deepEqual(modes.map(m => m.mode), ['flying', 'gone']);
  assert.equal(bird.state.active, false);
  assert.ok(lowest > 12, `stays ${lowest} m up`);
  assert.ok(t > 40 && t < 120, `${t} s`);
});

test('gliding and flapping: it flaps hard flaring in to land and glides more than it flaps while soaring', () => {
  const ctx = { player: farPlayer(), daylight: 1 };
  const bird = newBird(15, 'visit', ctx);
  const amp = { soar: [], flare: [], cruise: [] };
  run(bird, ctx, 120, state => {
    if (state.mode === 'flying' && amp[state.phase]) amp[state.phase].push(Math.abs(state.pose.flap - 0.12));
  });
  const peak = list => list.reduce((a, b) => Math.max(a, b), 0);
  const gliding = list => list.filter(v => v < 0.08).length / list.length;
  assert.ok(peak(amp.flare) > 0.5, `flare flapping peaks at ${peak(amp.flare)}`);
  assert.ok(gliding(amp.soar) > 0.3, `soaring is gliding ${(gliding(amp.soar) * 100).toFixed(0)}% of the time`);
  assert.ok(gliding(amp.flare) < 0.2, 'flaring is not');
});

test('the same seed gives the same visit', () => {
  const trace = seed => {
    const ctx = { player: farPlayer(), daylight: 1 };
    const bird = newBird(seed, 'visit', ctx);
    const out = [];
    run(bird, ctx, 60, (state, t) => { if (Math.round(t * 60) % 120 === 0) out.push([state.x, state.y, state.z, state.pose.flap].map(v => +v.toFixed(5))); });
    return JSON.stringify(out);
  };
  assert.equal(trace(31), trace(31));
  assert.notEqual(trace(31), trace(32));
});

test('a bird can be placed on the bank for a fixture, and seeking jumps along a flight', () => {
  const ctx = { player: farPlayer(), daylight: 1 };
  const rng = seeded(2);
  const spot = pickLanding({ pond: world.pond, groundAt: world.groundAt, inWater: world.inWater, player: ctx.player, rng });
  const standing = createBird({ world, rng: seeded(3), scale: SCALE });
  standing.startPerched(spot);
  standing.update(DT, ctx);
  assert.equal(standing.state.mode, 'perched');
  assert.ok(standing.state.pose.fold > 0.95, 'wings folded');
  assert.ok(Math.abs(standing.state.y - (spot.groundY + FEET)) < 0.05);

  const flying = newBird(4, 'visit', ctx);
  flying.seek(300, ctx);
  assert.ok(Math.abs(flying.progress - 300) < 1);
  assert.equal(flying.state.mode, 'flying');
  assert.equal(flying.state.phase, 'soar');
});
