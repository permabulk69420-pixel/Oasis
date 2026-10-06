import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { skyRadiance, createSkyEnvironment } from '../src/sky-environment.js';

// The sky's light for the solid models (src/sky-environment.js): it must be opt-in (no tuned shader changes) and leave the night dark.
const sky = (day) => ({
  zenith: new THREE.Color(0.6, 0.75, 0.9).multiplyScalar(day), horizon: new THREE.Color(0.8, 0.85, 0.9).multiplyScalar(day),
  ground: new THREE.Color(0.45, 0.3, 0.2).multiplyScalar(day), sunColor: new THREE.Color(1, 0.75, 0.5), moonColor: new THREE.Color(0.6, 0.7, 0.9),
  sun: new THREE.Vector3(1, 0.15, 0).normalize(), moon: new THREE.Vector3(-1, -0.15, 0).normalize(), sunAmount: day, moonAmount: 0.04 * (1 - day), warm: 0.4,
});
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

test('by day the sun is the brightest thing and the sky above outshines the ground', () => {
  const s = sky(1), at = (x, y, z) => lum(skyRadiance(x, y, z, s, [0, 0, 0]));
  const sun = at(s.sun.x, s.sun.y, s.sun.z), up = at(0, 1, 0), down = at(0, -1, 0), away = at(-1, 0.1, 0);
  assert.ok(sun > 4 * up, `sun ${sun} vs zenith ${up}`);
  assert.ok(up > down, `zenith ${up} vs ground ${down}`);
  assert.ok(at(0.95, 0.05, 0.3) > away, 'the horizon is warmer and brighter toward the sun');
});

test('at night it is all but black', () => {
  const s = sky(0);
  for (const d of [[0, 1, 0], [0, -1, 0], [1, 0.1, 0], [0, 0.3, 1]]) assert.ok(lum(skyRadiance(...d, s, [0, 0, 0])) < 0.01, `night at ${d}`);
});

test('it is opt in: custom shaders, its own environment and other material types are left alone', () => {
  const fakeDay = { lights: { hemisphere: new THREE.HemisphereLight(), sunlight: new THREE.DirectionalLight(), moonlight: new THREE.DirectionalLight() }, getState: () => ({ daylight: 1, twilight: 0 }) };
  const env = createSkyEnvironment({ renderer: null, dayNight: fakeDay });
  const plain = new THREE.MeshStandardMaterial();
  const custom = new THREE.MeshStandardMaterial(); custom.onBeforeCompile = () => {};
  const own = new THREE.MeshStandardMaterial(); own.envMap = new THREE.Texture();
  const marked = new THREE.MeshStandardMaterial(); marked.userData.noSkyLight = true;
  const basic = new THREE.MeshBasicMaterial();
  const shader = new THREE.ShaderMaterial();
  const root = new THREE.Group();
  for (const m of [plain, custom, own, marked, basic, shader]) root.add(new THREE.Mesh(new THREE.BufferGeometry(), m));
  assert.equal(env.skyLight(root), 1);
  assert.ok(env.materials.has(plain));
  for (const m of [custom, own, marked, basic, shader]) assert.ok(!env.materials.has(m));
  assert.equal(env.skyLight(root), 0, 'once each');
});
