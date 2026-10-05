import { createHeightField } from '../src/world.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  WIND, WIND_GLSL, SWAY, windTime, windStrength,
  windSwayGLSL, patchWindSway, addWindSway, addWindSwayToModel,
} from '../src/wind.js';
import { WIND_SAND, createWindSand } from '../src/wind-sand.js';
import { createOasisGrassRing } from '../src/oasis-grass-ring.js';

const fakeShader = vertexShader => ({ vertexShader, uniforms: {} });
const count = (text, part) => text.split(part).length - 1;

test('one wind direction, along the dunes, shared with the sand', () => {
  const [x, z] = WIND.direction;
  assert.ok(x > 0 && z > 0);
  assert.ok(Math.abs(Math.hypot(x, z) - 1) < 0.01, 'about a unit vector');
  assert.deepEqual(WIND_SAND.wind, WIND.direction);
});

test('the sand and the plants lean into the same gusts', () => {
  const sand = createWindSand({
    scene: new THREE.Scene(),
    uniforms: {
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uWater: { value: new THREE.Vector3(300, 3.1, -400) },
      uWaterRadii: { value: new THREE.Vector2(40, 34) },
    },
    field: createHeightField(),
  });
  const vertex = sand.meshes[0].material.vertexShader;
  assert.ok(vertex.includes(WIND_GLSL), 'the sand shader includes the shared wind functions');
  assert.match(vertex, /float gust = windGust\(xz, uWind, uTime\);/);
  assert.match(windSwayGLSL(SWAY.grass), /windGust\(base\.xz, dir, uWindTime\)/);
  sand.dispose();
});

test('every kind of plant has sane settings', () => {
  const names = new Set();
  for (const [key, p] of Object.entries(SWAY)) {
    assert.ok(!names.has(p.name), `${key} has its own name`);
    names.add(p.name);
    assert.ok(p.top > 0 && p.top < 10, `${key} top`);
    assert.ok(p.reach > 0 && p.reach <= 0.25, `${key} reach is a breeze, not a gale`);
    assert.ok(p.lean >= 0 && p.lean <= 1, `${key} lean`);
    assert.ok(p.bend >= 1 && p.bend <= 4, `${key} bend`);
    assert.ok(p.radial >= 0 && p.radial <= 1, `${key} radial`);
    assert.ok(p.rate > 0 && p.rate <= 2, `${key} rate`);
    assert.ok(p.flutter >= 0 && p.flutter <= 0.05, `${key} flutter`);
    assert.ok(p.shade >= 0 && p.shade <= 0.2, `${key} shade`);
    assert.ok(Object.isFrozen(p), `${key} is frozen`);
  }
  // heavy things swing slower than grass
  assert.ok(SWAY.trunk.rate < SWAY.grass.rate && SWAY.plantStem.rate < SWAY.grass.rate);
});

test('the sway shader has the pieces it needs, and only the ones a plant uses', () => {
  const grass = windSwayGLSL(SWAY.grass);
  assert.match(grass, /uniform float uWindTime;/);
  assert.match(grass, /uniform float uWindStrength;/);
  assert.equal(count(grass, 'float windHash('), 1);
  assert.equal(count(grass, 'float windGust('), 1);
  assert.match(grass, /vec4 windSway\(vec3 base, vec3 local, float size, float upright\)/);
  assert.match(grass, /float shade = 1\.0 \+ 0\.09000/, 'grass brightens and dims in the wind');
  assert.match(grass, /vec3 tremble = vec3\(sin\(shake\)/, 'and trembles');
  assert.match(grass, /float droop = 0\.5 \* dot\(push, push\) \/ max\(0\.50000 \* size, 0\.05\);/, 'and arcs down as it leans');
  const trunk = windSwayGLSL(SWAY.trunk);
  assert.match(trunk, /float shade = 1\.0;/, 'a trunk does not change colour');
  assert.match(trunk, /vec3 tremble = vec3\(0\.0\);/, 'and does not tremble');
  // constants are baked in per kind of plant
  assert.notEqual(grass, trunk);
  assert.match(windSwayGLSL(SWAY.fern), /length\(local\.xz\) \* 0\.45000/);
});

test('the patch hooks into the standard, physical and lambert vertex shaders', () => {
  for (const name of ['standard', 'physical', 'lambert']) {
    const shader = fakeShader(THREE.ShaderLib[name].vertexShader);
    assert.equal(patchWindSway(shader, SWAY.fern), true, `${name} can be patched`);
    const text = shader.vertexShader;
    assert.equal(count(text, 'uniform float uWindTime;'), 1);
    assert.ok(text.indexOf('uniform float uWindTime;') > text.indexOf('#include <common>'));
    const move = text.indexOf('vec4 windMove = windSway(');
    const project = text.indexOf('#include <project_vertex>');
    const apply = text.indexOf('mvPosition.xyz += mat3( viewMatrix ) * windMove.xyz;');
    assert.ok(text.indexOf('#include <begin_vertex>') < move, 'the move is worked out after the vertex starts');
    assert.ok(move < project && project < apply, 'and applied after the vertex is projected, then re-projected');
    assert.match(text.slice(apply), /gl_Position = projectionMatrix \* mvPosition;/);
    // instanced plants (the grass) are placed by their instance, not by the mesh
    assert.match(text, /#ifdef USE_INSTANCING\s+windBase = \( modelMatrix \* vec4\( instanceMatrix\[3\]\.xyz, 1\.0 \) \)\.xyz;/);
    assert.equal(shader.uniforms.uWindTime, windTime);
    assert.equal(shader.uniforms.uWindStrength, windStrength);
  }
});

test('patching twice, or patching something else, changes nothing more', () => {
  const shader = fakeShader(THREE.ShaderLib.standard.vertexShader);
  assert.equal(patchWindSway(shader, SWAY.grass), true);
  const once = shader.vertexShader;
  assert.equal(patchWindSway(shader, SWAY.grass), false);
  assert.equal(shader.vertexShader, once);
  const raw = fakeShader('void main() { gl_Position = vec4(position, 1.0); }');
  assert.equal(patchWindSway(raw, SWAY.grass), false);
  assert.equal(raw.vertexShader, 'void main() { gl_Position = vec4(position, 1.0); }');
  assert.deepEqual(raw.uniforms, {});
  assert.equal(patchWindSway(null, SWAY.grass), false);
});

test('only the grass changes colour, and only where there is a colour to change', () => {
  const grass = fakeShader(THREE.ShaderLib.lambert.vertexShader);
  patchWindSway(grass, SWAY.grass);
  assert.match(grass.vertexShader, /defined\( USE_INSTANCING_COLOR \)[^]*vColor\.rgb \*= windMove\.w;/);
  const tree = fakeShader(THREE.ShaderLib.standard.vertexShader);
  patchWindSway(tree, SWAY.foliage);
  assert.ok(!tree.vertexShader.includes('windMove.w'));
});

test('addWindSway keeps whatever the material compiled before, and gets its own program', () => {
  class Fake {}
  const calls = [];
  Fake.prototype.onBeforeCompile = function inherited(shader) { calls.push('inherited'); shader.vertexShader += '/*seen*/'; };
  Fake.prototype.customProgramCacheKey = function original() { return 'original'; };
  const material = new Fake();
  material.userData = {};
  addWindSway(material, SWAY.grass);
  const shader = fakeShader(THREE.ShaderLib.lambert.vertexShader);
  material.onBeforeCompile(shader, null);
  assert.deepEqual(calls, ['inherited']);
  assert.match(shader.vertexShader, /seen/);
  assert.match(shader.vertexShader, /windSway/);
  assert.equal(material.customProgramCacheKey(), 'oasis-wind-sway:grass');
  assert.equal(material.userData.windSway, 'grass');
  // doing it again does not stack another wrapper
  const hook = material.onBeforeCompile;
  addWindSway(material, SWAY.fern);
  assert.equal(material.onBeforeCompile, hook);
  assert.equal(material.userData.windSway, 'grass');

  // a material with its own hook (instance level) still runs it first
  const own = new Fake();
  own.userData = {};
  own.onBeforeCompile = function ownHook(shaderArg) { calls.push('own'); shaderArg.vertexShader += '/*own*/'; };
  addWindSway(own, SWAY.trunk);
  const ownShader = fakeShader(THREE.ShaderLib.standard.vertexShader);
  own.onBeforeCompile(ownShader, null);
  assert.deepEqual(calls, ['inherited', 'own']);
  assert.match(ownShader.vertexShader, /\/\*own\*\//);
  assert.equal(own.customProgramCacheKey(), 'oasis-wind-sway:trunk');
  assert.notEqual(own.customProgramCacheKey(), material.customProgramCacheKey());
});

test('real materials get the night fill and the sway together', async () => {
  const { installNightFill } = await import('../src/night-fill.js');
  installNightFill();
  const material = new THREE.MeshLambertMaterial();
  addWindSway(material, SWAY.grass);
  const vertex = fakeShader(THREE.ShaderLib.lambert.vertexShader);
  material.onBeforeCompile(vertex, null);
  assert.match(vertex.vertexShader, /windSway/);
  // the fill is patched into the fragment shader of the same compile
  const both = { vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader, uniforms: {} };
  material.onBeforeCompile(both, null);
  assert.match(both.fragmentShader, /uNightFill/);
  assert.match(both.vertexShader, /uWindTime/);
});

test('addWindSwayToModel sways each material once and leaves unchosen ones alone', () => {
  const bark = new THREE.MeshStandardMaterial({ name: 'bark' });
  const leaf = new THREE.MeshStandardMaterial({ name: 'leaf' });
  const rock = new THREE.MeshStandardMaterial({ name: 'rock' });
  const root = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  root.add(new THREE.Mesh(geometry, bark), new THREE.Mesh(geometry, bark), new THREE.Mesh(geometry, [leaf, rock]));
  const asked = [];
  const swayed = addWindSwayToModel(root, material => {
    asked.push(material.name);
    if (material === leaf) return SWAY.foliage;
    if (material === bark) return SWAY.trunk;
    return null;
  });
  assert.equal(swayed, 2);
  assert.deepEqual(asked, ['bark', 'leaf', 'rock'], 'each material is asked about once');
  assert.equal(bark.userData.windSway, 'trunk');
  assert.equal(leaf.userData.windSway, 'foliage');
  assert.equal(rock.userData.windSway, undefined);
});

test('the oasis grass sways, rich and lite patches sharing one material', () => {
  const ring = createOasisGrassRing({ field: { sample: () => 0 } });
  const meshes = ring.group.children;
  assert.equal(meshes.length, 2);
  assert.equal(meshes[0].material, meshes[1].material, 'one material: one program');
  assert.equal(meshes[0].material.userData.windSway, 'grass');
  assert.equal(typeof meshes[0].material.onBeforeCompile, 'function');
  ring.dispose();
});
