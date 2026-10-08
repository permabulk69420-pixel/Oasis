import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { updateGrassPBRLighting } from '../src/grass-pbr.js';

test('grass follows the live scene sun and late sky map without recompiling the XR material', () => {
  const material = new THREE.ShaderMaterial({ uniforms: {
    uGrassSunRadiance: { value: new THREE.Vector3() },
    uGrassSkyMap: { value: null }, uGrassSkyTexel: { value: new THREE.Vector2() },
    uGrassSkyMaxMip: { value: 0 }, uGrassSkyStrength: { value: 0 }, uHasGrassSky: { value: 0 },
  } });
  const sun = new THREE.DirectionalLight(); sun.color.setRGB(1, 0.5, 0.25); sun.intensity = 3;
  const day = { lights: { sunlight: sun } }, env = { texture: null, strength: 0.85 };
  const version = material.version;
  updateGrassPBRLighting(material, env, day);
  assert.equal(material.uniforms.uHasGrassSky.value, 0);
  assert.deepEqual(material.uniforms.uGrassSunRadiance.value.toArray(), [3, 1.5, 0.75]);
  env.texture = new THREE.Texture({ width: 336, height: 128 });
  updateGrassPBRLighting(material, env, day);
  assert.equal(material.uniforms.uGrassSkyMap.value, env.texture);
  assert.equal(material.uniforms.uHasGrassSky.value, 1);
  assert.equal(material.uniforms.uGrassSkyMaxMip.value, 5);
  assert.deepEqual(material.uniforms.uGrassSkyTexel.value.toArray(), [1 / 336, 1 / 128]);
  sun.intensity = 0; env.strength = 0.04;
  updateGrassPBRLighting(material, env, day);
  assert.deepEqual(material.uniforms.uGrassSunRadiance.value.toArray(), [0, 0, 0]);
  assert.equal(material.uniforms.uGrassSkyStrength.value, 0.04);
  assert.equal(material.version, version);
  material.dispose(); env.texture.dispose();
});
