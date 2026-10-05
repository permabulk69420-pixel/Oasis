import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MILKY_WAY, MOON, NIGHT_SKY_GLSL, PLANET, PLANET_FRAME, milkyWayPoint, bandFalloff, planetCovers } from '../src/night-sky.js';
import { sunDirectionFor } from '../src/sun-path.js';
import { WATER } from '../src/world.js';

test('the Milky Way basis is orthonormal, so stars and the painted band line up', () => {
  const { normal, axisA, axisB, core } = MILKY_WAY;
  for (const v of [normal, axisA, axisB, core]) assert.ok(Math.abs(v.length() - 1) < 1e-9);
  assert.ok(Math.abs(normal.dot(axisA)) < 1e-9);
  assert.ok(Math.abs(normal.dot(axisB)) < 1e-9);
  assert.ok(Math.abs(axisA.dot(axisB)) < 1e-9);
  // the core lies on the band's centre line
  assert.ok(Math.abs(core.dot(normal)) < 1e-9);
});

test('the band is a great circle that crosses the sky, not one that hugs the horizon', () => {
  // Walk along the band: it must climb well above the horizon somewhere, and also dip below it.
  let highest = -1, lowest = 1;
  for (let lon = 0; lon < Math.PI * 2; lon += 0.05) {
    const y = milkyWayPoint(lon, 0).y;
    highest = Math.max(highest, y);
    lowest = Math.min(lowest, y);
  }
  assert.ok(highest > 0.9, `band climbs close to the zenith (${highest.toFixed(2)})`);
  assert.ok(lowest < -0.9);
  // its brightest part is a comfortable height above the horizon
  assert.ok(MILKY_WAY.core.y > 0.4 && MILKY_WAY.core.y < 0.75, `core height ${MILKY_WAY.core.y.toFixed(2)}`);
});

test('milkyWayPoint gives unit vectors at the requested distance from the band', () => {
  for (const lat of [-0.3, -0.1, 0, 0.1, 0.3]) {
    for (const lon of [0, 1, 2.5, 4, 6]) {
      const p = milkyWayPoint(lon, lat);
      assert.ok(Math.abs(p.length() - 1) < 1e-9);
      assert.ok(Math.abs(p.dot(MILKY_WAY.normal) - Math.sin(lat)) < 1e-9);
    }
  }
  const target = new THREE.Vector3();
  assert.equal(milkyWayPoint(1, 0.1, target), target, 'writes into the vector it is given');
});

test('the moon is bigger than the real one, but still just a disc in the sky', () => {
  const degrees = MOON.radius * 2 * 180 / Math.PI;
  assert.ok(degrees > 1.5 && degrees < 6, `${degrees.toFixed(1)} degrees across`);
});

test('the sky shader code defines the moon, the Milky Way and shooting stars, with matching constants', () => {
  for (const name of ['moonLight', 'milkyWayLight', 'shootingStarLight', 'nightHash']) {
    assert.match(NIGHT_SKY_GLSL, new RegExp(`\\b${name}\\(`), `${name} is defined`);
  }
  const constant = name => {
    const match = NIGHT_SKY_GLSL.match(new RegExp(`const vec3 ${name} = vec3\\(([^)]+)\\)`));
    assert.ok(match, `${name} is declared`);
    return match[1].split(',').map(Number);
  };
  const near = (a, b) => a.every((value, i) => Math.abs(value - b[i]) < 1e-5);
  assert.ok(near(constant('MW_N'), MILKY_WAY.normal.toArray()));
  assert.ok(near(constant('MW_A'), MILKY_WAY.axisA.toArray()));
  assert.ok(near(constant('MW_CORE'), MILKY_WAY.core.toArray()));
  assert.match(NIGHT_SKY_GLSL, /MOON_RADIUS = 0\.0300/);
});

test('the shooting-star hash does not rely on sin(), which differs from GPU to GPU', () => {
  const hash = NIGHT_SKY_GLSL.match(/float nightHash\(float p\)[^\n]*/)[0];
  assert.ok(!/sin\(/.test(hash));
  // the same arithmetic in JavaScript stays in [0, 1) and varies from cycle to cycle
  const fract = x => x - Math.floor(x);
  const nightHash = p => { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); };
  const values = Array.from({ length: 40 }, (_, i) => nightHash(i + 7));
  for (const value of values) assert.ok(value >= 0 && value < 1);
  assert.ok(new Set(values.map(v => v.toFixed(4))).size > 35);
});

test('the Milky Way fades to exactly zero where it is skipped, so it has no outline against the dark sky', () => {
  // It used to stop at 0.02 of its peak: a step of a few brightness levels, plainly visible in a headset.
  assert.equal(bandFalloff(MILKY_WAY.cut), 0, 'nothing is left at the cut');
  assert.equal(bandFalloff(MILKY_WAY.cut / 2), 0, 'and nothing beyond it');
  assert.equal(bandFalloff(1), 1, 'the centre line keeps its full brightness');
  assert.ok(MILKY_WAY.cut > 0 && MILKY_WAY.cut <= 0.01, 'the cut is far down the tail, so the look of the band is untouched');
  assert.ok(Math.abs(bandFalloff(0.5) - 0.5) < 0.005 && Math.abs(bandFalloff(0.1) - 0.1) < 0.005, 'the middle of the band is unchanged');
  let previous = 0;
  for (let bell = 0; bell <= 1; bell += 0.01) {
    const value = bandFalloff(bell);
    assert.ok(value >= previous, 'brighter towards the centre line, never a dip');
    previous = value;
  }
  // The shader does the same sum, from the same constant, and no longer has a hard cut.
  assert.match(NIGHT_SKY_GLSL, new RegExp(`const float MW_CUT = ${MILKY_WAY.cut.toFixed(4)};`));
  assert.match(NIGHT_SKY_GLSL, /band = \(band - MW_CUT\) \/ \(1\.0 - MW_CUT\);/);
  assert.doesNotMatch(NIGHT_SKY_GLSL, /band < 0\.02/, 'the old hard cut at 0.02 is gone');
});

// ---- the ringed planet
const degrees = radians => radians * 180 / Math.PI;
const unit = (azimuth, elevation) => new THREE.Vector3(Math.cos(elevation) * Math.cos(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.sin(azimuth));

test('the planet is a big ringed disc: three moons across, with rings reaching about twice as far out again, and the frame is orthonormal', () => {
  const discDegrees = PLANET.radius * 2 * 180 / Math.PI;
  assert.ok(discDegrees > 7 && discDegrees < 14, `${discDegrees.toFixed(1)} degrees across`);
  assert.ok(PLANET.ringInner > 1.05 && PLANET.ringOuter > PLANET.ringInner * 1.5 && PLANET.ringOuter < 3, 'rings start clear of the planet and stay modest');
  const { dir, right, up, axis } = PLANET_FRAME;
  for (const v of [dir, right, up, axis]) assert.ok(Math.abs(v.length() - 1) < 1e-9);
  assert.ok(Math.abs(dir.dot(right)) < 1e-9 && Math.abs(dir.dot(up)) < 1e-9 && Math.abs(right.dot(up)) < 1e-9);
  assert.ok(Math.abs(right.y) < 1e-9, 'right runs along the horizon');
  assert.ok(up.y > 0, 'up is up');
  // the rings are seen at a slant: edge on would be a line, face on a plain circle
  assert.ok(axis.z > 0.2 && axis.z < 0.6, `the rings are seen at an angle (the axis points ${axis.z.toFixed(2)} towards you)`);
  assert.ok(PLANET_FRAME.bound < Math.cos(PLANET.ringOuter * PLANET.radius), 'the bounding cone holds the whole ring system');
});

test('the planet hangs where you can see it from the start, clear of the horizon and of the sun and moon whatever the hour', () => {
  const direction = PLANET_FRAME.dir;
  const elevation = degrees(Math.asin(direction.y));
  assert.ok(elevation > 15 && elevation < 40, `${elevation.toFixed(0)} degrees up`);
  // the player starts facing the way main.js turns the rig: forward is (-sin yaw, -cos yaw)
  const yaw = -Math.atan2(WATER.x, -WATER.z);
  const forward = Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
  const bearing = Math.atan2(direction.z, direction.x);
  const off = Math.abs(degrees(Math.atan2(Math.sin(bearing - forward), Math.cos(bearing - forward))));
  assert.ok(off < 45, `${off.toFixed(0)} degrees off the way you first look`);
  let closestSun = 180, closestMoon = 180;
  const sun = new THREE.Vector3();
  for (let i = 0; i <= 2000; i++) {
    sunDirectionFor(i / 2000, sun);
    closestSun = Math.min(closestSun, degrees(Math.acos(direction.dot(sun))));
    closestMoon = Math.min(closestMoon, degrees(Math.acos(-direction.dot(sun))));
  }
  assert.ok(closestSun > 20, // the sun only climbs about 14 degrees now, so it passes lower than the planet's 21: well clear of the disc, but not 50 degrees away
     `the sun comes within ${closestSun.toFixed(0)} degrees of the planet`);
  assert.ok(closestMoon > 20, `the moon comes within ${closestMoon.toFixed(0)} degrees of the planet`);
});

test('stars behind the planet and its thick rings are hidden, and the rest of the sky is left alone', () => {
  const { dir, right, up, axis } = PLANET_FRAME;
  const at = (x, y) => dir.clone().addScaledVector(right, x * PLANET.radius).addScaledVector(up, y * PLANET.radius).normalize();
  assert.ok(planetCovers(at(0, 0)), 'the middle of the disc');
  assert.ok(planetCovers(at(0.9, 0.2)), 'near the edge of the disc');
  const minor = new THREE.Vector2(axis.x, axis.y).normalize(); // the way the rings tilt on the sky
  assert.ok(!planetCovers(at(minor.x * 1.25, minor.y * 1.25)), 'just off the disc along the line the rings tilt on: clear of both');
  assert.ok(!planetCovers(at(5, 5)), 'well away');
  assert.ok(!planetCovers(dir.clone().negate()), 'the other side of the sky');
  // a point on the ring plane between the inner and outer edge, on the sky: step along the plane's major axis
  const major = new THREE.Vector3(axis.y, -axis.x, 0).normalize(); // perpendicular to the axis's sky direction, in the frame's x-y plane
  const middle = (PLANET.ringInner + PLANET.ringOuter) / 2;
  assert.ok(planetCovers(at(major.x * middle, major.y * middle)), 'in the middle of the rings, out beside the planet');
  assert.ok(!planetCovers(at(major.x * (PLANET.ringOuter + 0.4), major.y * (PLANET.ringOuter + 0.4))), 'beyond the rings');
});

test('the sky shader draws the planet with constants that match, and a cheap early exit for the rest of the sky', () => {
  for (const name of ['planetLight', 'ringDensity']) assert.match(NIGHT_SKY_GLSL, new RegExp(`\\b${name}\\(`), `${name} is defined`);
  const constant = name => {
    const match = NIGHT_SKY_GLSL.match(new RegExp(`const vec3 ${name} = vec3\\(([^)]+)\\)`));
    assert.ok(match, `${name} is declared`);
    return match[1].split(',').map(Number);
  };
  const near = (a, b) => a.every((value, i) => Math.abs(value - b[i]) < 1e-5);
  assert.ok(near(constant('PL_DIR'), PLANET_FRAME.dir.toArray()));
  assert.ok(near(constant('PL_RIGHT'), PLANET_FRAME.right.toArray()));
  assert.ok(near(constant('PL_UP'), PLANET_FRAME.up.toArray()));
  assert.ok(near(constant('PL_AXIS'), PLANET_FRAME.axis.toArray()));
  assert.match(NIGHT_SKY_GLSL, new RegExp(`PL_RADIUS = ${PLANET.radius.toFixed(4)}`));
  assert.match(NIGHT_SKY_GLSL, /if \(dot\(ray, PL_DIR\) < PL_BOUND\) return vec4\(0\.0\)/, 'the rest of the sky pays one dot product');
});
