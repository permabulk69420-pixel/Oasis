import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ALIEN_BIRD, daylightAt, pickLod, shadowPlacement, createDirector } from '../src/alien-bird.js';

function seeded(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('the settings are in a sensible shape, and every model file they name exists', () => {
  assert.equal(ALIEN_BIRD.files.length, 3, 'three levels of detail');
  for (const file of ALIEN_BIRD.files) {
    assert.match(file, /alien_bird_lod[012]\.glb$/);
    const onDisk = new URL(`../public/models/creatures/${file.split('/').pop()}`, import.meta.url);
    assert.ok(fs.existsSync(onDisk), `${file} is in public/models/creatures`);
  }
  const distances = ALIEN_BIRD.lodDistances;
  assert.equal(distances.length, ALIEN_BIRD.files.length);
  assert.equal(distances[0], 0);
  for (let i = 1; i < distances.length; i++) assert.ok(distances[i] > distances[i - 1], 'ascending distances');
  assert.ok(ALIEN_BIRD.lodHysteresis > 0 && ALIEN_BIRD.lodHysteresis < 0.3);
  assert.ok(ALIEN_BIRD.maxBirds >= 1);
  for (const [lo, hi] of [ALIEN_BIRD.firstVisit, ALIEN_BIRD.between]) assert.ok(lo > 0 && hi >= lo);
  assert.ok(ALIEN_BIRD.daylightStart > 0 && ALIEN_BIRD.daylightStart < 1);
  assert.ok(ALIEN_BIRD.visitChance > 0 && ALIEN_BIRD.visitChance < 1);
  assert.ok(Object.isFrozen(ALIEN_BIRD));
});

test('daylight follows the sun the way the day and night cycle does', () => {
  assert.equal(daylightAt(-1), 0);
  assert.equal(daylightAt(-0.07), 0);
  assert.equal(daylightAt(0.14), 1);
  assert.equal(daylightAt(1), 1);
  // the middle of the ramp is the middle of the light
  assert.ok(Math.abs(daylightAt((-0.07 + 0.14) / 2) - 0.5) < 1e-9);
  let last = -1;
  for (let h = -0.2; h <= 0.3; h += 0.01) {
    const value = daylightAt(h);
    assert.ok(value >= last - 1e-12, 'never gets darker as the sun climbs');
    assert.ok(value >= 0 && value <= 1);
    last = value;
  }
});

test('level of detail follows distance, with some give at each boundary', () => {
  const [, near, far] = ALIEN_BIRD.lodDistances;
  assert.equal(pickLod(0), 0);
  assert.equal(pickLod(near - 1), 0);
  assert.equal(pickLod(near * 1.2), 1);
  assert.equal(pickLod(far * 1.2), 2);
  assert.equal(pickLod(5000), 2);
  // just across a boundary the model stays as it was ...
  assert.equal(pickLod(near * 1.03, 0), 0);
  assert.equal(pickLod(near * 0.97, 1), 1);
  // ... until it is clearly across
  assert.equal(pickLod(near * 1.15, 0), 1);
  assert.equal(pickLod(near * 0.85, 1), 0);
  // a jump of several levels is made in one go, in either direction
  assert.equal(pickLod(500, 0), 2);
  assert.equal(pickLod(1, 2), 0);
});

test('a bird hovering right on a boundary does not flicker between models', () => {
  const [, near, far] = ALIEN_BIRD.lodDistances;
  for (const boundary of [near, far]) {
    let level = pickLod(boundary * 0.9);
    const start = level;
    for (let i = 0; i < 200; i++) {
      // wobbling a few percent either side of the boundary, as a flapping bird's distance does
      const distance = boundary * (1 + Math.sin(i * 0.9) * 0.04);
      level = pickLod(distance, level);
      assert.equal(level, start, `stays on level ${start} at ${distance.toFixed(1)} m`);
    }
  }
  // crossing each boundary out and back changes the model exactly once each way
  let level = 0;
  let changes = 0;
  const walk = d => { const next = pickLod(d, level); if (next !== level) changes++; level = next; };
  for (let d = 0; d <= 160; d += 0.25) walk(d);
  assert.equal(level, 2);
  for (let d = 160; d >= 0; d -= 0.25) walk(d);
  assert.equal(level, 0);
  assert.equal(changes, 4);
});

const flat = () => 0;

test('the shadow of a bird directly under a high sun is directly under the bird', () => {
  const out = {};
  const result = shadowPlacement(out, { x: 10, y: 8, z: -4, groundAt: flat, sun: { x: 0, y: 1, z: 0 } });
  assert.equal(result, out, 'writes into the object it is given, so nothing is allocated per frame');
  assert.equal(out.x, 10);
  assert.equal(out.z, -4);
  assert.equal(out.ground, 0);
  assert.equal(out.height, 8);
  assert.equal(out.stretch, 1);
  assert.ok(out.opacity > 0.2 && out.opacity <= ALIEN_BIRD.shadow.opacity);
});

test('a low sun throws the shadow away from the sun, long and stretched', () => {
  const sun = { x: 0.95, y: 0.3, z: 0 }; // the sun is off towards +x
  const out = shadowPlacement({}, { x: 0, y: 6, z: 0, groundAt: flat, sun });
  assert.ok(Math.abs(out.x - -(0.95 / 0.3) * 6) < 1e-9, `lands ${out.x.toFixed(1)} m the far side from the sun`);
  assert.equal(out.z, 0);
  assert.equal(out.stretch, 2.6, 'stretch is capped');
  assert.ok(Math.abs(out.azimuth - Math.PI / 2) < 1e-9, 'long axis points along the rays');
  const mid = shadowPlacement({}, { x: 0, y: 6, z: 0, groundAt: flat, sun: { x: 0.8, y: 0.6, z: 0 } });
  assert.ok(mid.stretch > 1 && mid.stretch < 2.6);
});

test('the shadow falls on the slope under the bird, not on flat ground at the bird\'s own spot', () => {
  const slope = (x, z) => 0.2 * x; // rises towards +x
  const sun = { x: 0.5, y: 0.5, z: 0 };
  const out = shadowPlacement({}, { x: 0, y: 10, z: 0, groundAt: slope, sun });
  assert.equal(out.ground, slope(out.x, out.z), 'it is drawn at the height of the ground where it lands');
  assert.ok(out.x < -10, 'the ground drops away to the shadow side, so the shadow is thrown further');
  // the exact answer is x = -12.5; two steps get within half a metre of it
  assert.ok(Math.abs(out.x - -12.5) < 0.6);
  assert.ok(Math.abs(out.height - (10 - out.ground)) < 1e-9);
});

test('the shadow grows and fades with height, and is gone with the light', () => {
  const at = (y, sun = { x: 0, y: 1, z: 0 }) => shadowPlacement({}, { x: 0, y, z: 0, groundAt: flat, sun });
  const low = at(1);
  const high = at(40);
  const veryHigh = at(500);
  assert.ok(high.width > low.width, 'a high bird\'s shadow is softer and wider');
  assert.ok(high.opacity < low.opacity);
  assert.ok(veryHigh.opacity > 0, 'but never quite gone');
  assert.ok(veryHigh.opacity >= ALIEN_BIRD.shadow.opacity * 0.25 - 1e-9, 'a fixed floor on how faint it gets');
  // dusk and dark
  assert.ok(at(2, { x: 0.9, y: 0.1, z: 0 }).opacity < at(2).opacity);
  assert.equal(at(2, { x: 0.9, y: 0.01, z: 0 }).opacity, 0);
  assert.equal(at(2, { x: 0.9, y: -0.4, z: 0 }).opacity, 0, 'no sun, no shadow');
  // sun height of zero or below never divides by nothing
  const flatSun = at(5, { x: 1, y: 0, z: 0 });
  assert.ok(Number.isFinite(flatSun.x) && Number.isFinite(flatSun.width));
  // a bird on the ground has a shadow right under it
  const standing = shadowPlacement({}, { x: 3, y: 0, z: 3, groundAt: flat, sun: { x: 0.6, y: 0.7, z: 0.2 } });
  assert.equal(standing.height, 0);
  assert.equal(standing.x, 3);
  assert.equal(standing.z, 3);
});

test('the shadow scales with the bird', () => {
  const small = shadowPlacement({}, { x: 0, y: 3, z: 0, groundAt: flat, sun: { x: 0, y: 1, z: 0 }, scale: 1 });
  const big = shadowPlacement({}, { x: 0, y: 3, z: 0, groundAt: flat, sun: { x: 0, y: 1, z: 0 }, scale: 2 });
  assert.ok(Math.abs(big.width - small.width * 2) < 1e-9);
});

const DAY = { daylight: 1, active: 0, visiting: false, nearPond: true };

// Runs the director for `seconds` of one-second steps; returns what it asked for and when.
function runDirector(director, seconds, conditions = () => DAY) {
  const events = [];
  for (let t = 1; t <= seconds; t++) {
    const next = director.update(1, conditions(t));
    if (next) events.push({ t, kind: next });
  }
  return events;
}

test('the first bird turns up after a short while of daylight', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const director = createDirector({ rng: seeded(seed) });
    const [first] = runDirector(director, 120);
    assert.ok(first, 'it comes');
    assert.ok(first.t >= ALIEN_BIRD.firstVisit[0] && first.t <= ALIEN_BIRD.firstVisit[1] + 1, `first at ${first.t} s`);
  }
});

test('no bird shows up in the dark or the half light, and the clock does not run then either', () => {
  const director = createDirector({ rng: seeded(7) });
  const before = director.timer;
  const events = runDirector(director, 5000, () => ({ ...DAY, daylight: ALIEN_BIRD.daylightStart - 0.01 }));
  assert.equal(events.length, 0);
  assert.equal(director.timer, before, 'the wait only counts down while it is light');
  // light returns: it takes the remaining wait, not a fresh one
  const [first] = runDirector(director, 100);
  assert.ok(first.t <= Math.ceil(before) + 1);
});

test('birds come one after another, spaced like the settings say', () => {
  const director = createDirector({ rng: seeded(11) });
  const events = runDirector(director, 3 * 3600);
  assert.ok(events.length > 100, `${events.length} birds in three hours of daylight`);
  for (let i = 1; i < events.length; i++) {
    const gap = events[i].t - events[i - 1].t;
    assert.ok(gap >= ALIEN_BIRD.between[0] - 1 && gap <= ALIEN_BIRD.between[1] + 1, `gap ${gap} s`);
  }
});

test('there is never a bird beyond the limit, and one is sent as soon as there is room', () => {
  const director = createDirector({ rng: seeded(3) });
  // wait out the first timer with the sky full
  const full = runDirector(director, 600, () => ({ ...DAY, active: ALIEN_BIRD.maxBirds }));
  assert.equal(full.length, 0);
  assert.equal(director.timer, 0, 'the timer has run out and is waiting for room');
  assert.ok(director.update(1, { ...DAY, active: ALIEN_BIRD.maxBirds - 1 }), 'room: it goes straight away');
  assert.ok(director.timer >= ALIEN_BIRD.between[0], 'and the next wait has started');
});

test('only one bird at a time comes to drink, and only if you are near the pond', () => {
  const far = createDirector({ rng: seeded(21) });
  const farEvents = runDirector(far, 3600, () => ({ ...DAY, nearPond: false }));
  assert.ok(farEvents.length > 20);
  assert.ok(farEvents.every(event => event.kind === 'passing'), 'far from the pond they only fly over');

  const busy = createDirector({ rng: seeded(22) });
  const busyEvents = runDirector(busy, 3600, () => ({ ...DAY, visiting: true }));
  assert.ok(busyEvents.length > 20);
  assert.ok(busyEvents.every(event => event.kind === 'passing'), 'with one already at the pond, the next flies over');

  const near = createDirector({ rng: seeded(23) });
  const nearEvents = runDirector(near, 40 * 3600);
  const visits = nearEvents.filter(event => event.kind === 'visit').length;
  const share = visits / nearEvents.length;
  assert.ok(nearEvents.every(event => event.kind === 'visit' || event.kind === 'passing'));
  assert.ok(Math.abs(share - ALIEN_BIRD.visitChance) < 0.1, `${(share * 100).toFixed(0)}% come to the pond`);
});

test('the same seed gives the same sequence of birds', () => {
  const a = runDirector(createDirector({ rng: seeded(99) }), 3600);
  const b = runDirector(createDirector({ rng: seeded(99) }), 3600);
  const c = runDirector(createDirector({ rng: seeded(100) }), 3600);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('a development fixture can make the next bird due sooner', () => {
  const director = createDirector({ rng: seeded(5) });
  director.skipTo(2);
  assert.equal(director.timer, 2);
  const events = runDirector(director, 10);
  assert.equal(events[0].t, 2, 'it comes after two seconds of daylight');
  director.skipTo(-5);
  assert.equal(director.timer, 0, 'never negative');
});
