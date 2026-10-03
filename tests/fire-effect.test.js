import test from 'node:test';
import assert from 'node:assert/strict';
import { createFireEffect } from '../src/fire-effect.js';

test('a fire has flames, a glow, sparks and a plume of smoke', () => {
  const fx = createFireEffect();
  const names = fx.group.children.map(child => child.name);
  assert.ok(names.includes('Smoke'));
  assert.ok(names.includes('Sparks'));
  assert.ok(names.includes('Heat glow'));
  assert.equal(names.filter(name => name === 'Flame layer').length, fx.flames.length);
  assert.ok(fx.smoke);
  assert.equal(fx.smoke.transparent, true);
  assert.equal(fx.smoke.depthWrite, false);
  fx.dispose();
});

test('smoke and sparks can be left out', () => {
  const fx = createFireEffect({ smoke: false, spark: false });
  const names = fx.group.children.map(child => child.name);
  assert.ok(!names.includes('Smoke'));
  assert.ok(!names.includes('Sparks'));
  assert.equal(fx.smoke, null);
  fx.update(1, 1, 1, 0.5); // still fine without them
  fx.dispose();
});

test('update drives the smoke: time, strength, fade-in and the time of day', () => {
  const fx = createFireEffect();
  fx.update(12.5, 1.0, 0.5, 0.75);
  const u = fx.smoke.uniforms;
  assert.equal(u.uTime.value, 12.5);
  assert.equal(u.uGrow.value, 0.5);
  assert.equal(u.uDay.value, 0.75);
  assert.ok(Math.abs(u.uStrength.value - 0.5) < 1e-9, 'strength follows the fade-in');
  // flicker above 1 never makes the smoke thicker than full
  fx.update(13, 1.08, 1, 0);
  assert.equal(u.uStrength.value, 1);
  assert.equal(u.uDay.value, 0, 'the time of day defaults sensibly and is passed through');
  fx.dispose();
});

test('the smoke leans the same way the sand blows', () => {
  const fx = createFireEffect();
  const wind = fx.smoke.uniforms.uWind.value;
  assert.ok(Math.abs(wind.length() - 1) < 1e-6);
  assert.ok(wind.x > 0 && wind.y > 0);
  fx.dispose();
});

test('smoke puffs are spread evenly over their life so the plume is steady from the start', () => {
  const fx = createFireEffect();
  const smokeMesh = fx.group.children.find(child => child.name === 'Smoke');
  const seeds = smokeMesh.geometry.getAttribute('aSeed');
  const phases = [];
  for (let i = 0; i < seeds.count; i++) phases.push(seeds.getY(i));
  assert.equal(smokeMesh.geometry.instanceCount, seeds.count);
  assert.ok(Math.min(...phases) === 0 && Math.max(...phases) < 1);
  assert.ok(new Set(phases).size === phases.length);
  for (let i = 0; i < seeds.count; i++) {
    for (const component of [seeds.getX(i), seeds.getZ(i), seeds.getW(i)]) assert.ok(component >= 0 && component < 1);
  }
  fx.dispose();
});
