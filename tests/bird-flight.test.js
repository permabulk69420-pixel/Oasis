import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeightField, WATER, SPAWN, HERO_TREE, isInPond } from '../src/world.js';
import {
  FLIGHT, createRoute, buildRoute, routeClearance, arcPoints, joinPoints, tangentAngle,
  planArrival, planPassing, planExit, pickLanding, wrapAngle,
} from '../src/bird-flight.js';

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
const groundAt = field.sample;
const pond = { x: WATER.x, z: WATER.z, y: WATER.y, radiusX: WATER.radiusX, radiusZ: WATER.radiusZ };
const inWater = (x, z) => isInPond(x, z, groundAt(x, z));
const flat = () => 3;

test('wrapAngle keeps angles within a half turn either side', () => {
  for (const a of [0, 1, -1, 3, -3, 3.5, -3.5, 7, -7, 100]) {
    const w = wrapAngle(a);
    assert.ok(w >= -Math.PI - 1e-9 && w <= Math.PI + 1e-9);
    assert.ok(Math.abs(Math.cos(w) - Math.cos(a)) < 1e-9 && Math.abs(Math.sin(w) - Math.sin(a)) < 1e-9);
  }
});

test('a straight route is as long as the line, with a steady heading and no turn', () => {
  const route = createRoute([
    { x: 0, y: 10, z: 0, dir: [1, 0, 0], speed: 10, tag: 'cruise' },
    { x: 100, y: 10, z: 0, dir: [1, 0, 0], speed: 14, tag: 'cruise' },
  ]);
  assert.ok(Math.abs(route.length - 100) < 0.01);
  const out = {};
  route.sample(0, out);
  assert.deepEqual([out.x, out.y, out.z], [0, 10, 0]);
  assert.ok(Math.abs(out.tx - 1) < 1e-9 && Math.abs(out.turn) < 1e-9 && out.speed === 10);
  route.sample(50, out);
  assert.ok(Math.abs(out.x - 50) < 0.01 && out.speed > 11.5 && out.speed < 12.5, 'the speed eases from 10 to 14');
  route.sample(1000, out);
  assert.ok(Math.abs(out.x - 100) < 1e-6 && out.speed === 14, 'past the end it stays at the end');
  assert.throws(() => createRoute([{ x: 0, y: 0, z: 0, dir: [1, 0, 0], speed: 1 }]), /two waypoints/);
});

test('a route moves at an even pace: equal distances along it are equal distances in space', () => {
  const rng = seeded(4);
  const landing = pickLanding({ pond, groundAt, inWater, player: { x: SPAWN.x, z: SPAWN.z }, rng });
  const route = buildRoute(planArrival({ pond, start: { x: pond.x + 200, z: pond.z + 150 }, landing, groundAt, rng }), groundAt);
  const a = {};
  const b = {};
  for (let s = 0; s < route.length - 0.5; s += 0.5) {
    route.sample(s, a);
    route.sample(s + 0.5, b);
    const pace = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 0.5;
    assert.ok(Math.abs(pace - 1) < 0.06, `pace ${pace} at ${s}`);
  }
});

test('a circle of waypoints is a circle, and the bird turns the way it goes round', () => {
  for (const sweep of [Math.PI * 2, -Math.PI * 2]) {
    const route = createRoute(arcPoints({ cx: 10, cz: -20, r0: 50, y0: 30, a0: 0.7, sweep, speed0: 10, tag: 'soar' }));
    const out = {};
    for (let s = 0; s <= route.length; s += 5) {
      route.sample(s, out);
      const r = Math.hypot(out.x - 10, out.z + 20);
      assert.ok(Math.abs(r - 50) < 0.3, `radius ${r}`);
      assert.ok(Math.abs(out.y - 30) < 1e-6);
      assert.ok(Math.abs(Math.abs(out.turn) - 1 / 50) < 0.002, `turn ${out.turn}`);
      assert.equal(Math.sign(out.turn), -Math.sign(sweep), 'a growing angle goes round to the right');
    }
    assert.ok(Math.abs(route.length - Math.PI * 2 * 50) < 2, `length ${route.length}`);
  }
});

test('joining arcs gives one waypoint at the join, with the later tag', () => {
  const a = arcPoints({ cx: 0, cz: 0, r0: 40, y0: 20, a0: 0, sweep: 1, speed0: 10, tag: 'soar' });
  const b = arcPoints({ cx: 0, cz: 0, r0: 40, r1: 30, y0: 20, y1: 10, a0: 1, sweep: 1, speed0: 8, tag: 'descend' });
  const joined = joinPoints(a, b);
  assert.equal(joined.length, a.length + b.length - 1);
  assert.equal(joined[a.length - 1].tag, 'descend');
  assert.ok(Math.abs(Math.hypot(...joined[a.length - 1].dir) - 1) < 1e-9);
});

test('tangentAngle picks the point where the line from far away just grazes the circle', () => {
  const rng = seeded(11);
  for (let i = 0; i < 20; i++) {
    const from = { x: (rng() - 0.5) * 600, z: (rng() - 0.5) * 600 };
    if (Math.hypot(from.x, from.z) < 120) continue;
    for (const turn of [1, -1]) {
      const a = tangentAngle(0, 0, 50, from, turn, true);
      const px = 50 * Math.cos(a);
      const pz = 50 * Math.sin(a);
      const lx = px - from.x;
      const lz = pz - from.z;
      const l = Math.hypot(lx, lz);
      const dot = (lx * -Math.sin(a) * turn + lz * Math.cos(a) * turn) / l;
      assert.ok(dot > 0.99, `joins tangentially: ${dot}`);
    }
  }
});

test('the bank of the pond: a landing spot is dry, close to the water, clear of things and away from the player', () => {
  const player = { x: SPAWN.x, z: SPAWN.z };
  const avoid = [{ x: HERO_TREE.x, z: HERO_TREE.z, r: 18 }];
  for (let seed = 1; seed <= 12; seed++) {
    const spot = pickLanding({ pond, groundAt, inWater, player, avoid, rng: seeded(seed) });
    assert.ok(spot, 'there is somewhere to land');
    assert.ok(!inWater(spot.x, spot.z), 'not in the water');
    const r = Math.hypot(spot.x - pond.x, spot.z - pond.z);
    assert.ok(r > 25 && r < 50, `at the pond's edge: ${r}`);
    assert.ok(Math.hypot(spot.x - HERO_TREE.x, spot.z - HERO_TREE.z) >= 18, 'clear of the hero tree');
    assert.ok(Math.hypot(spot.x - player.x, spot.z - player.z) >= 22, 'not on top of the player');
    assert.ok(Math.abs(spot.groundY - groundAt(spot.x, spot.z)) < 1e-9);
    // it faces the water: the heading to the middle of the pond
    const toWater = Math.atan2(pond.x - spot.x, pond.z - spot.z);
    assert.ok(Math.abs(wrapAngle(spot.yawToWater - toWater)) < 1e-9);
  }
  assert.equal(pickLanding({ pond, groundAt, inWater, avoid: [{ x: pond.x, z: pond.z, r: 500 }], rng: seeded(1) }), null, 'nowhere left to land');
  // same seed, same spot
  const a = pickLanding({ pond, groundAt, inWater, player, rng: seeded(9) });
  const b = pickLanding({ pond, groundAt, inWater, player, rng: seeded(9) });
  assert.deepEqual(a, b);
});

test('an arrival ends on the landing spot, slowly, at the height of the bird’s feet, after a flare', () => {
  const player = { x: SPAWN.x, z: SPAWN.z };
  for (let seed = 1; seed <= 10; seed++) {
    const rng = seeded(seed * 17);
    const landing = pickLanding({ pond, groundAt, inWater, player, rng });
    const start = { x: pond.x + 260 * Math.cos(seed), z: pond.z + 260 * Math.sin(seed) };
    const route = buildRoute(planArrival({ pond, start, landing, groundAt, rng, feet: 0.4 }), groundAt);
    const out = {};
    route.sample(0, out);
    assert.ok(Math.hypot(out.x - start.x, out.z - start.z) < 1e-6, 'starts where it is told');
    assert.equal(out.tag, 'cruise');
    route.sample(route.length, out);
    assert.ok(Math.hypot(out.x - landing.x, out.z - landing.z) < 0.15, 'ends on the spot');
    assert.ok(Math.abs(out.y - (landing.groundY + 0.4)) < 0.05, 'feet on the ground');
    assert.ok(out.speed <= FLIGHT.touchSpeed + 1e-9, 'slow at the end');
    route.sample(route.length - 0.5, out);
    assert.equal(out.tag, 'flare', 'the last stretch is the flare');
    assert.ok(out.ty < 0.05 && out.ty > -0.5, 'coming down gently');
    // it goes through the phases in order
    const seen = [];
    for (let s = 0; s <= route.length; s += 1) {
      route.sample(s, out);
      if (seen[seen.length - 1] !== out.tag) seen.push(out.tag);
    }
    assert.deepEqual(seen, ['cruise', 'soar', 'descend', 'flare']);
    // round the pond, not across it
    let firstSoar = 0;
    while (firstSoar < route.length && (route.sample(firstSoar, out), out.tag !== 'soar')) firstSoar++;
    for (let s = firstSoar; s < route.length - 12; s += 3) {
      route.sample(s, out);
      const r = Math.hypot(out.x - pond.x, out.z - pond.z);
      assert.ok(r > 30 && r < 62, `circling the pond at ${r} m`);
    }
  }
});

test('an arrival keeps well above the dunes until the landing', () => {
  const player = { x: SPAWN.x, z: SPAWN.z };
  for (let seed = 20; seed < 28; seed++) {
    const rng = seeded(seed);
    const landing = pickLanding({ pond, groundAt, inWater, player, rng });
    const towards = rng() * Math.PI * 2;
    const start = { x: pond.x + 260 * Math.cos(towards), z: pond.z + 260 * Math.sin(towards) };
    const route = buildRoute(planArrival({ pond, start, landing, groundAt, rng }), groundAt);
    const out = {};
    let lowest = Infinity;
    for (let s = 0; s < route.length - 14; s += 2) {
      route.sample(s, out);
      lowest = Math.min(lowest, out.y - groundAt(out.x, out.z));
    }
    assert.ok(lowest > 2, `${lowest} m above the ground at the lowest, before the last 14 m`);
  }
});

test('the route builder lifts waypoints over a ridge in the way', () => {
  const ridge = (x, z) => 3 + 40 * Math.exp(-((x - 100) ** 2) / 800);
  const points = [
    { x: 0, y: 25, z: 0, dir: [1, 0, 0], speed: 12, tag: 'cruise' },
    { x: 100, y: 25, z: 0, dir: [1, 0, 0], speed: 12, tag: 'cruise' },
    { x: 200, y: 25, z: 0, dir: [1, 0, 0], speed: 12, tag: 'cruise' },
  ];
  const before = routeClearance(createRoute(points), ridge, 2);
  assert.ok(before.height < 0, 'the plain route goes through the hill');
  const after = routeClearance(buildRoute(points, ridge, 12), ridge, 2);
  assert.ok(after.height > 8, `now clears it by ${after.height}`);
});

test('a bird crossing the sky soars once and never comes near the ground', () => {
  for (let seed = 1; seed <= 8; seed++) {
    const rng = seeded(seed * 5);
    const centre = { x: SPAWN.x + (rng() - 0.5) * 200, z: SPAWN.z + (rng() - 0.5) * 200 };
    const route = buildRoute(planPassing({ centre, groundAt, rng }), groundAt, 14);
    const clear = routeClearance(route, groundAt, 2);
    assert.ok(clear.height > 14, `clearance ${clear.height}`);
    const out = {};
    const seen = [];
    for (let s = 0; s <= route.length; s += 2) {
      route.sample(s, out);
      if (seen[seen.length - 1] !== out.tag) seen.push(out.tag);
    }
    assert.deepEqual(seen, ['cruise', 'soar', 'cruise']);
    route.sample(0, out);
    assert.ok(Math.hypot(out.x - centre.x, out.z - centre.z) > 150, 'comes from far off');
    route.sample(route.length, out);
    assert.ok(Math.hypot(out.x - centre.x, out.z - centre.z) > 150, 'and goes far off');
  }
});

test('taking off: up and away from where it stands, then a long way out', () => {
  const x = 320;
  const z = -300;
  const y = groundAt(x, z) + 0.4;
  for (const heading of [0, 1.5, -2.2, 3]) {
    const route = buildRoute(planExit({ x, y, z, heading, fromGround: true }), groundAt);
    const out = {};
    route.sample(0, out);
    assert.ok(Math.hypot(out.x - x, out.z - z) < 1e-6 && Math.abs(out.y - y) < 1e-6);
    assert.ok(out.ty > 0.7, 'starts by going up');
    assert.equal(out.tag, 'takeoff');
    route.sample(route.length, out);
    const away = (out.x - x) * Math.sin(heading) + (out.z - z) * Math.cos(heading);
    assert.ok(away > 200, `ends ${away} m out along its heading`);
    assert.ok(out.y - y > 40, 'and high up');
    assert.ok(routeClearance(route, groundAt, 2).height > 0.3);
  }
});

test('leaving from the air carries on in the direction it was flying, and turns away smoothly', () => {
  const route = buildRoute(planExit({ x: 300, y: 60, z: -300, dir: [0, 0, 1], speed: 9, heading: 0.5, fromGround: false }), groundAt);
  const out = {};
  route.sample(0, out);
  assert.ok(Math.abs(out.tz - 1) < 1e-9, 'the first direction is the one it was flying');
  assert.equal(out.speed, 9);
  route.sample(route.length, out);
  assert.ok((out.x - 300) ** 2 + (out.z + 300) ** 2 > 250 ** 2);
  let turned = 0;
  for (let s = 0; s < route.length; s += 2) {
    route.sample(s, out);
    turned = Math.max(turned, Math.abs(out.turn) * out.speed);
  }
  assert.ok(turned < 1.2, `the sharpest turn is ${turned} rad/s`);
});
