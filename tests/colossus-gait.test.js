import test from 'node:test';
import assert from 'node:assert/strict';
import { createColossusBrain, COLOSSUS_BRAIN } from '../src/colossus-brain.js';
import {
  GAIT, MODEL_LEGS, MOTION, createGait, createBodyMotion, swingLift, swingTravel, stancePitch, swingPitch, pivotWeight, footFrame, ankleTarget,
} from '../src/colossus-gait.js';

function seeded(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// walks the brain, the planner and the body motion together for `seconds`, calling onFrame(state, gait, motion, events) every frame
function simulate({ seconds, seed = 4, groundAt = () => 0, onFrame, dt = 1 / 30, brain = createColossusBrain({ rng: seeded(seed) }) }) {
  const gait = createGait({ groundAt });
  const motion = createBodyMotion();
  const events = [];
  for (let t = 0; t < seconds; t += dt) {
    brain.update(dt);
    gait.update(brain.state, dt);
    motion.update(brain.state, gait.out, dt);
    events.length = 0;
    for (let k = 0; k < gait.out.eventCount; k++) events.push({ ...gait.out.events[k] });
    onFrame?.(brain.state, gait, motion, events);
  }
  return { brain, gait, motion };
}

test('a step has the shape of a heavy one: it lifts gently, peaks past the middle and comes down faster than it went up', () => {
  assert.equal(swingLift(0), 0);
  assert.ok(swingLift(1) < 1e-9);
  let peakAt = 0, peak = 0, upMost = 0, downMost = 0, previous = 0;
  for (let i = 1; i <= 400; i++) {
    const u = i / 400, h = swingLift(u);
    assert.ok(h >= 0 && h <= 1 + 1e-12);
    if (h > peak) { peak = h; peakAt = u; }
    upMost = Math.max(upMost, h - previous);
    downMost = Math.min(downMost, h - previous);
    previous = h;
  }
  assert.ok(peakAt > 0.45 && peakAt < 0.65, `peaks at ${peakAt}`);
  assert.ok(swingLift(0.05) < 0.15, 'the first moments of a lift are gentle');
  assert.ok(-downMost > upMost, 'it comes down harder than it goes up');
  let last = -1;
  for (let i = 0; i <= 100; i++) { const t = swingTravel(i / 100); assert.ok(t >= last - 1e-12); last = t; }
  assert.equal(swingTravel(0), 0);
  assert.equal(swingTravel(1), 1);
});

test('the foot rolls from heel to toe and the pitch carries on from one phase to the next without a jump', () => {
  assert.ok(Math.abs(stancePitch(1) - swingPitch(0)) < 1e-9, 'toe-off runs into the lift');
  assert.ok(Math.abs(swingPitch(1) - stancePitch(0)) < 1e-9, 'the landing runs into the heel strike');
  assert.ok(stancePitch(0) < 0 && stancePitch(1) > 0, 'heel first, toes last');
  assert.equal(pivotWeight(0), 1);
  assert.equal(pivotWeight(1), 1);
  assert.equal(pivotWeight(0.5), 0);
});

test('a foot that is down stays exactly where it landed, and never has more than one foot in the air', () => {
  const was = {};
  let planted = 0, moved = 0, airborne = 0;
  simulate({
    seconds: 400,
    onFrame(s, gait, motion, events) {
      let up = 0;
      for (const leg of gait.legs) {
        if (!leg.stance) up++;
        const landedNow = events.some(e => e.kind === 'down' && e.name === leg.name);
        const before = was[leg.name];
        if (leg.stance && before && !landedNow) {
          planted++;
          if (before.x !== leg.x || before.y !== leg.y || before.z !== leg.z || before.yaw !== leg.yaw) moved++;
          assert.equal(leg.raise, 0, `${leg.name} is down but raised ${leg.raise}`);
        }
        was[leg.name] = leg.stance ? { x: leg.x, y: leg.y, z: leg.z, yaw: leg.yaw } : null;
      }
      airborne = Math.max(airborne, up);
    },
  });
  assert.ok(planted > 1000, 'the check ran');
  assert.equal(moved, 0, `${moved} planted feet slid`);
  assert.equal(airborne, 1, 'a lateral-sequence walk keeps three feet down');
});

test('the feet land in order, hind left, front left, hind right, front right, and every landing follows a lift', () => {
  const order = ['BL', 'FL', 'BR', 'FR'];
  const downs = [];
  const lifted = { BL: 0, FL: 0, BR: 0, FR: 0 };
  const landed = new Set(); // (a foot that starts the run in the air has no lift of its own to match, once)
  simulate({
    seconds: 900,
    onFrame(s, gait, motion, events) {
      for (const e of events) {
        if (e.kind === 'up') lifted[e.name]++;
        else {
          downs.push(e.name);
          assert.ok(e.power >= 0.4 && e.power <= 1 + 1e-9, `power ${e.power}`);
          if (landed.has(e.name)) {
            assert.ok(lifted[e.name] >= 1, `${e.name} landed without a lift`);
            lifted[e.name]--;
          } else lifted[e.name] = 0;
          landed.add(e.name);
        }
      }
    },
  });
  assert.ok(downs.length > 40, `only ${downs.length} footfalls in 15 minutes`);
  for (let i = 1; i < downs.length; i++) {
    assert.equal(downs[i], order[(order.indexOf(downs[i - 1]) + 1) % 4], `${downs[i - 1]} was followed by ${downs[i]}`);
  }
});

test('at a full walk a foot travels a whole stride (the body\'s speed times a cycle), lands where it was aimed, and the landing is on the ground', () => {
  const ground = (x, z) => 3 * Math.sin(x * 0.02) + 2 * Math.cos(z * 0.03);
  const gait = createGait({ groundAt: ground });
  const s = { x: 100, z: -50, yaw: 0.6, speed: COLOSSUS_BRAIN.walkSpeed, accel: 0, turn: 0, cycles: 0, cycle: COLOSSUS_BRAIN.cycle, calm: 0, time: 0 };
  const dt = 1 / 30;
  const strokes = [];
  for (let t = 0; t < 300; t += dt) {
    s.x += Math.sin(s.yaw) * s.speed * dt;
    s.z += Math.cos(s.yaw) * s.speed * dt;
    s.cycles += dt / s.cycle;
    gait.update(s, dt);
    for (let k = 0; k < gait.out.eventCount; k++) {
      const e = gait.out.events[k];
      if (e.kind !== 'down') continue;
      assert.ok(Math.abs(e.y - ground(e.x, e.z)) < 1e-9, 'it lands on the ground');
      const leg = gait.legs.find(l => l.name === e.name);
      assert.ok(Math.abs(leg.x - e.x) < 1e-9 && Math.abs(leg.z - e.z) < 1e-9, 'it lands where the swing was aimed');
      strokes.push(leg.stroke); // (every one, the first of each leg included: a foot that starts in the air is aimed like the rest)
    }
  }
  assert.ok(strokes.length > 100, `only ${strokes.length} steps`);
  const expected = COLOSSUS_BRAIN.walkSpeed * COLOSSUS_BRAIN.cycle;
  for (const stroke of strokes) assert.ok(Math.abs(stroke - expected) < 0.2, `stroke ${stroke.toFixed(2)} m, expected ${expected.toFixed(2)}`);
});

test('turning, the outer feet take longer steps than the inner ones, but none is more than 45 percent longer than a straight stride', () => {
  const gait = createGait({ groundAt: () => 0 });
  const s = { x: 0, z: 0, yaw: 0, speed: COLOSSUS_BRAIN.walkSpeed, accel: 0, turn: COLOSSUS_BRAIN.maxTurn, cycles: 0, cycle: COLOSSUS_BRAIN.cycle, calm: 0, time: 0 };
  const dt = 1 / 30;
  const byLeg = { BL: [], FL: [], BR: [], FR: [] };
  for (let t = 0; t < 400; t += dt) {
    s.yaw += s.turn * dt;
    s.x += Math.sin(s.yaw) * s.speed * dt;
    s.z += Math.cos(s.yaw) * s.speed * dt;
    s.cycles += dt / s.cycle;
    gait.update(s, dt);
    for (let k = 0; k < gait.out.eventCount; k++) {
      const e = gait.out.events[k];
      if (e.kind === 'down' && t > 2 * s.cycle) byLeg[e.name].push(gait.legs.find(l => l.name === e.name).stroke);
    }
  }
  const mean = list => list.reduce((a, b) => a + b, 0) / list.length;
  const straight = COLOSSUS_BRAIN.walkSpeed * COLOSSUS_BRAIN.cycle;
  assert.ok(mean(byLeg.BR) > mean(byLeg.BL) && mean(byLeg.FR) > mean(byLeg.FL), 'a left turn: the right feet are on the outside and go further');
  for (const list of Object.values(byLeg)) for (const stroke of list) assert.ok(stroke < straight * 1.45, `stroke ${stroke.toFixed(2)} m`);
});

test('on a slope the feet follow the ground, their normals tilt with it and the body rides at the middle of them', () => {
  const slope = (x, z) => 0.2 * x + 0.05 * z;
  let checked = 0;
  simulate({
    seconds: 300,
    groundAt: slope,
    onFrame(s, gait) {
      let sum = 0;
      for (const leg of gait.legs) {
        sum += leg.y;
        assert.ok(Math.abs(Math.hypot(leg.nx, leg.ny, leg.nz) - 1) < 1e-6);
        if (leg.stance) assert.ok(Math.abs(leg.y - slope(leg.x, leg.z)) < 1e-9);
        if (leg.stance && leg.ny < 0.99) checked++;
      }
      assert.ok(Math.abs(gait.out.groundY - sum / 4) < 1e-9);
      assert.ok(Number.isFinite(gait.out.pitchDown) && Number.isFinite(gait.out.roll));
    },
  });
  assert.ok(checked > 1000, 'the normals did tilt');
});

test('standing, the feet settle flat and nothing is lifted', () => {
  const brain = createColossusBrain({ rng: seeded(6) });
  brain.stand();
  const { gait } = simulate({ seconds: 20, brain });
  for (const leg of gait.legs) {
    assert.ok(leg.raise === 0 && leg.pitch === 0 && leg.curl === 0, `${leg.name}: raise ${leg.raise}, pitch ${leg.pitch}, curl ${leg.curl}`);
    assert.equal(leg.pivot, 1);
  }
});

test('when the clock jumps (a teleport, a long frame) the feet are put back under it instead of striding across the gap', () => {
  const gait = createGait({ groundAt: () => 0 });
  const s = { x: 500, z: -700, yaw: 0.7, speed: 2.2, accel: 0, turn: 0, cycles: 3.1, cycle: COLOSSUS_BRAIN.cycle, calm: 0, time: 0 };
  gait.update(s, 1 / 30);
  assert.equal(gait.out.eventCount, 0, 'a reseat is not a footfall');
  const stride = s.speed * GAIT.duty * s.cycle;
  for (const leg of gait.legs) {
    const homeX = s.x + leg.hx * Math.cos(s.yaw) + leg.hz * Math.sin(s.yaw);
    const homeZ = s.z - leg.hx * Math.sin(s.yaw) + leg.hz * Math.cos(s.yaw);
    assert.ok(Math.hypot(leg.x - homeX, leg.z - homeZ) <= stride / 2 + 1, `${leg.name} is ${Math.hypot(leg.x - homeX, leg.z - homeZ).toFixed(1)} m from home`);
  }
  s.cycles = 40.3; s.x += 3000;
  gait.update(s, 1 / 30);
  assert.equal(gait.out.eventCount, 0);
  for (const leg of gait.legs) assert.ok(Math.hypot(leg.x - s.x, leg.z - s.z) < 40, `${leg.name} came along`);
});

const round = list => list.map(v => Math.round(v * 1e9) / 1e9 + 0);

test('the foot frame: heading along the ground, up the ground\'s normal, the left side across', () => {
  const flat = footFrame({ yaw: 0, nx: 0, ny: 1, nz: 0 });
  assert.deepEqual(round(flat.f), [0, 0, 1]);
  assert.deepEqual(round(flat.side), [1, 0, 0]);
  const turned = footFrame({ yaw: Math.PI / 2, nx: 0, ny: 1, nz: 0 });
  assert.deepEqual(round(turned.f), [1, 0, 0]);
  const tilted = footFrame({ yaw: 0.4, nx: 0.3, ny: 0.9, nz: -0.2 });
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  assert.ok(Math.abs(dot(tilted.f, tilted.n)) < 1e-9 && Math.abs(dot(tilted.side, tilted.n)) < 1e-9 && Math.abs(dot(tilted.f, tilted.side)) < 1e-9);
  assert.ok(Math.abs(Math.hypot(...tilted.f) - 1) < 1e-9 && Math.abs(Math.hypot(...tilted.side) - 1) < 1e-9);
});

test('the ankle sits a foot-height above the ground when flat, rises with the lift and rolls forward when the heel comes up', () => {
  const frame = footFrame({ yaw: 0, nx: 0, ny: 1, nz: 0 });
  const out = [0, 0, 0];
  const leg = { x: 10, y: 2, z: -5, pitch: 0, raise: 0, pivot: 1 };
  ankleTarget(leg, frame, out);
  assert.deepEqual(round(out), [10, 2 + GAIT.foot.ankle, -5]);
  leg.raise = 3;
  ankleTarget(leg, frame, out);
  assert.ok(Math.abs(out[1] - (2 + GAIT.foot.ankle + 3)) < 1e-9);
  leg.raise = 0; leg.pitch = 0.2;
  ankleTarget(leg, frame, out);
  assert.ok(out[2] > -5 && out[1] > 2 + GAIT.foot.ankle - 1e-9, 'heel up: the ankle moves forward and up about the toe');
  leg.pitch = -0.17;
  ankleTarget(leg, frame, out);
  assert.ok(out[2] < -5 + GAIT.foot.ankle * Math.sin(-0.17) + 1e-9, 'toe up: the ankle swings about the heel');
  leg.pitch = 0.2; leg.pivot = 0;
  ankleTarget(leg, frame, out);
  assert.ok(Math.abs(out[2] + 5) < 1e-9 && Math.abs(out[1] - (2 + GAIT.foot.ankle)) < 1e-9, 'with the pivot faded out the foot only lifts');
});

test('the four legs are the model\'s legs: left is +x, the hind pair 19 m behind the front pair', () => {
  assert.deepEqual(MODEL_LEGS.map(l => l.name), ['BL', 'FL', 'BR', 'FR']);
  for (const leg of MODEL_LEGS) {
    assert.equal(Math.sign(leg.home[0]), leg.name.endsWith('L') ? 1 : -1);
    assert.equal(Math.sign(leg.home[1]), leg.name.startsWith('F') ? 1 : -1);
  }
});

test('the body motion stays finite, breathes within range, leans into a turn and settles when it stops', () => {
  let widest = 0, maxBend = 0, breathLow = 1, breathHigh = -1, finite = true;
  const { motion, brain } = simulate({
    seconds: 900,
    seed: 9,
    onFrame(s, gait, motion) {
      for (const value of Object.values(motion.out)) if (!Number.isFinite(value)) finite = false;
      widest = Math.max(widest, Math.abs(motion.out.sway));
      maxBend = Math.max(maxBend, Math.abs(motion.out.spineBend));
      breathLow = Math.min(breathLow, motion.out.breath);
      breathHigh = Math.max(breathHigh, motion.out.breath);
    },
  });
  assert.ok(finite);
  assert.ok(widest <= MOTION.sway + MOTION.idleSway + 1e-6, `swayed ${widest.toFixed(2)} m`);
  assert.ok(maxBend > 0.2 * MOTION.bend, 'it leans into its turns');
  assert.ok(maxBend <= MOTION.bend * 1.0001);
  assert.ok(breathLow < -0.9 && breathHigh > 0.9 && breathLow >= -1 && breathHigh <= 1);
  assert.ok(motion.out.move >= 0 && motion.out.move <= 1);
  assert.ok(brain.state.time > 800);
});
