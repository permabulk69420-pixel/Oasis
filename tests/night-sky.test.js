import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MILKY_WAY, MOON, NIGHT_SKY_GLSL, milkyWayPoint, bandFalloff } from '../src/night-sky.js';

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
