import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PUSH, SWAY, windPush, windSwayGLSL, patchWindSway } from '../src/wind.js';
import { setPushPoints, pushSettings } from '../src/plant-push.js';

const points = () => [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];

test('the shared uniform has three points: feet and two hands, all off to start with', () => {
  assert.equal(windPush.value.length, 3);
  for (const point of windPush.value) assert.equal(point.w, 0);
});

test('feet sit under the head on the floor, hands where the controllers are, each with its own reach', () => {
  const p = setPushPoints(points(), { x: 3, y: 10, z: -4 }, [{ x: 3.2, y: 10.9, z: -3.5 }, { x: 2.7, y: 10.5, z: -3.6 }]);
  assert.deepEqual([p[0].x, p[0].y, p[0].z, p[0].w], [3, 10 + PUSH.feetHeight, -4, PUSH.feetRadius]);
  assert.deepEqual([p[1].x, p[1].y, p[1].z, p[1].w], [3.2, 10.9, -3.5, PUSH.handRadius]);
  assert.deepEqual([p[2].x, p[2].y, p[2].z, p[2].w], [2.7, 10.5, -3.6, PUSH.handRadius]);
});

test('an untracked hand, or switching it off, turns the points off', () => {
  const p = setPushPoints(points(), { x: 0, y: 0, z: 0 }, [null, { x: 1, y: 1, z: 1 }]);
  assert.equal(p[0].w, PUSH.feetRadius);
  assert.equal(p[1].w, 0, 'no controller, no point');
  assert.equal(p[2].w, PUSH.handRadius);
  const off = setPushPoints(points(), { x: 0, y: 0, z: 0 }, [{ x: 1, y: 1, z: 1 }, { x: 2, y: 1, z: 1 }], false);
  for (const point of off) assert.equal(point.w, 0);
});

test('the radii are sensible: a hand reaches less than a foot, and both are well under a metre', () => {
  assert.ok(PUSH.handRadius < PUSH.feetRadius && PUSH.feetRadius < 1);
  assert.ok(PUSH.reachPerRadius > 0 && PUSH.reachPerRadius < 1);
});

test('?push=0 and ?push=1 override the default', () => {
  assert.equal(pushSettings('?push=0'), false);
  assert.equal(pushSettings('?x=1&push=1'), true);
  assert.equal(pushSettings(''), PUSH.enabled);
});

test('grass, ferns and the glow plants give way; a trunk does not', () => {
  assert.ok(SWAY.grass.push > 0 && SWAY.fern.push > 0);
  assert.equal(SWAY.trunk.push ?? 0, 0);
  assert.match(windSwayGLSL(SWAY.grass), /uniform vec4 uWindPush\[3\];/);
  assert.match(windSwayGLSL(SWAY.grass), /vec3 windPush\(vec3 worldPos, vec3 local, float size, float upright\)/);
  assert.doesNotMatch(windSwayGLSL(SWAY.trunk), /windPush/);
});

test('the patch adds the push for a plant that gives way and leaves the uniform off for one that does not', () => {
  const source = THREE.ShaderLib.standard.vertexShader;
  const grass = { vertexShader: source, uniforms: {} };
  assert.equal(patchWindSway(grass, SWAY.grass), true);
  assert.equal(grass.uniforms.uWindPush, windPush);
  assert.match(grass.vertexShader, /windMove\.xyz \+= windPush\( windWorld, position, windSize, windUpright \);/);
  const trunk = { vertexShader: source, uniforms: {} };
  assert.equal(patchWindSway(trunk, SWAY.trunk), true);
  assert.equal(trunk.uniforms.uWindPush, undefined);
  assert.doesNotMatch(trunk.vertexShader, /windPush/);
});
