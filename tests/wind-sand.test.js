import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WIND_SAND, createWindSand, createWindSandSeeds } from '../src/wind-sand.js';
import { createHeightField } from '../src/world.js';

const field = createHeightField();

const uniforms = () => ({
  uSun: { value: new THREE.Vector3(0, 1, 0) },
  uWater: { value: new THREE.Vector3(300, 3.1, -400) },
  uWaterRadii: { value: new THREE.Vector2(40, 34) },
});

test('seeds are repeatable, in range, and differ by seed', () => {
  const one = createWindSandSeeds(50, 7);
  const again = createWindSandSeeds(50, 7);
  const other = createWindSandSeeds(50, 8);
  assert.equal(one.a.length, 200);
  assert.equal(one.b.length, 200);
  assert.deepEqual(Array.from(one.a), Array.from(again.a));
  assert.notDeepEqual(Array.from(one.a), Array.from(other.a));
  for (const value of [...one.a, ...one.b]) assert.ok(value >= 0 && value < 1, `${value} is in [0, 1)`);
});

test('layer settings are sane and the particle count stays small enough for the Quest', () => {
  const layers = Object.entries(WIND_SAND.layers);
  assert.ok(layers.length >= 3);
  let total = 0;
  for (const [name, layer] of layers) {
    total += layer.count;
    assert.ok(layer.count > 0 && Number.isInteger(layer.count), `${name} count`);
    assert.ok(layer.radius >= 4, `${name} radius`);
    for (const key of ['speed', 'length', 'width', 'near']) {
      assert.equal(layer[key].length, 2, `${name}.${key} is a pair`);
    }
    assert.ok(layer.length[1] > layer.length[0], `${name} length range`);
    assert.ok(layer.width[1] > layer.width[0], `${name} width range`);
    assert.ok(layer.near[1] > layer.near[0], `${name} near fade range`);
    assert.ok(layer.alpha > 0 && layer.alpha <= 1, `${name} alpha`);
    assert.ok(layer.haze >= 0 && layer.haze <= 1, `${name} haze`);
    assert.ok(layer.height > 0 && layer.height < 3, `${name} height`);
  }
  assert.ok(total <= 2500, `${total} particles is within budget`);
});

test('the wind runs along the dunes, which is the direction terrainHeight stretches them', () => {
  const [x, z] = WIND_SAND.wind;
  assert.ok(Math.abs(Math.hypot(x, z) - 1) < 0.01, 'unit length');
  assert.ok(Math.abs(x - 0.84) < 1e-9 && Math.abs(z - 0.54) < 1e-9);
});

test('createWindSand builds one instanced quad mesh per layer and follows the player', () => {
  const scene = new THREE.Scene();
  const sand = createWindSand({ scene, uniforms: uniforms(), field });
  assert.equal(sand.meshes.length, Object.keys(WIND_SAND.layers).length);
  assert.ok(scene.children.includes(sand.group));
  for (const mesh of sand.meshes) {
    assert.equal(mesh.frustumCulled, false, 'positions come from the shader, so culling must be off');
    assert.equal(mesh.material.transparent, true);
    assert.equal(mesh.material.depthWrite, false);
    assert.equal(mesh.geometry.getIndex().count, 6);
    assert.equal(mesh.geometry.attributes.aSeedA.count, mesh.geometry.instanceCount);
  }
  assert.equal(sand.count, Object.values(WIND_SAND.layers).reduce((sum, layer) => sum + layer.count, 0));

  sand.update(12.5, new THREE.Vector3(10, 20, -30), 900);
  assert.equal(sand.uniforms.uTime.value, 12.5);
  assert.equal(sand.uniforms.uViewHeight.value, 900);
  for (const mesh of sand.meshes) {
    const centre = mesh.material.uniforms.uCenter.value;
    assert.deepEqual([centre.x, centre.y, centre.z], [10, 20, -30]);
  }
  // A bad clock or viewport never poisons the uniforms.
  sand.update(Number.NaN, null, -5);
  assert.equal(sand.uniforms.uTime.value, 0);
  assert.equal(sand.uniforms.uViewHeight.value, 1);
});

test('the sun, pond and ground height are shared with the world, not copied', () => {
  const shared = uniforms();
  const sand = createWindSand({ scene: new THREE.Scene(), uniforms: shared, field });
  for (const mesh of sand.meshes) {
    assert.equal(mesh.material.uniforms.uSun, shared.uSun);
    assert.equal(mesh.material.uniforms.uWater, shared.uWater);
    assert.equal(mesh.material.uniforms.uGroundMap, sand.uniforms.uGroundMap, 'one ground window for every layer');
  }
});

test('the shaders read the world height and finish like the terrain does', () => {
  const sand = createWindSand({ scene: new THREE.Scene(), uniforms: uniforms(), field });
  const { vertexShader, fragmentShader } = sand.meshes[0].material;
  assert.match(vertexShader, /uGroundMap/);
  assert.match(vertexShader, /groundAt/);
  assert.match(fragmentShader, /tonemapping_fragment/);
  assert.match(fragmentShader, /colorspace_fragment/);
});

test('createWindSand refuses to start without what it needs', () => {
  assert.throws(() => createWindSand({ uniforms: uniforms(), field }), /scene/);
  assert.throws(() => createWindSand({ scene: new THREE.Scene(), uniforms: uniforms() }), /height field/);
  const missing = uniforms();
  delete missing.uWater;
  assert.throws(() => createWindSand({ scene: new THREE.Scene(), uniforms: missing, field }), /uWater/);
});

test('dispose removes the sand from the scene', () => {
  const scene = new THREE.Scene();
  const sand = createWindSand({ scene, uniforms: uniforms(), field });
  sand.dispose();
  assert.ok(!scene.children.includes(sand.group));
});
