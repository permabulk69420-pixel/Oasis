import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { nightFill, NIGHT_FILL, patchNightFill, installNightFill } from '../src/night-fill.js';

const fakeShader = fragmentShader => ({ fragmentShader, uniforms: {} });

test('the standard, physical and lambert fragment shaders still contain what the patch hooks into', () => {
  for (const name of ['standard', 'physical', 'lambert']) {
    const shader = fakeShader(THREE.ShaderLib[name].fragmentShader);
    assert.equal(patchNightFill(shader), true, `${name} fragment shader can be patched`);
    assert.match(shader.fragmentShader, /uniform float uNightFill;/);
    assert.match(shader.fragmentShader, /#include <tonemapping_fragment>\s*\{/);
  }
});

test('patching adds the fill after tone mapping, once, and shares one uniform', () => {
  const source = THREE.ShaderLib.standard.fragmentShader;
  const shader = fakeShader(source);
  assert.equal(patchNightFill(shader), true);
  const patched = shader.fragmentShader;
  assert.ok(patched.indexOf('#include <tonemapping_fragment>') < patched.indexOf('nightNormal'), 'fill comes after tone mapping');
  assert.ok(patched.indexOf('nightNormal') < patched.indexOf('#include <colorspace_fragment>'), 'and before the colour space conversion');
  assert.equal(shader.uniforms.uNightFill, nightFill);
  // a second pass leaves it alone
  assert.equal(patchNightFill(shader), false);
  assert.equal(shader.fragmentShader, patched);
});

test('shaders that are not the standard ones are left alone', () => {
  const shader = fakeShader('void main() { gl_FragColor = vec4(1.0); }');
  assert.equal(patchNightFill(shader), false);
  assert.equal(shader.fragmentShader, 'void main() { gl_FragColor = vec4(1.0); }');
  assert.deepEqual(shader.uniforms, {});
  assert.equal(patchNightFill(null), false);
  // a basic material has no lighting variables for the fill to use
  assert.equal(patchNightFill(fakeShader(THREE.ShaderLib.basic.fragmentShader)), false);
});

test('the fill is faint: dimmer than the terrain uses for a surface facing the moon, and cool in colour', () => {
  const [r, g, b] = NIGHT_FILL.colour;
  assert.ok(b > g && g > r, 'blue-grey');
  assert.ok(Math.max(...NIGHT_FILL.colour) < 0.01);
  const [rr, rg, rb] = NIGHT_FILL.rim;
  assert.ok(rb > rg && rg > rr);
  assert.ok(Math.max(...NIGHT_FILL.rim) < 0.03);
});

test('installNightFill hooks each material type once and keeps an existing hook', () => {
  class Fake {}
  const calls = [];
  Fake.prototype.onBeforeCompile = function original(shader) { calls.push('original'); shader.fragmentShader += '/*seen*/'; };
  installNightFill([Fake]);
  const hooked = Fake.prototype.onBeforeCompile;
  installNightFill([Fake]); // idempotent
  assert.equal(Fake.prototype.onBeforeCompile, hooked);

  const shader = fakeShader(THREE.ShaderLib.standard.fragmentShader);
  new Fake().onBeforeCompile(shader);
  assert.deepEqual(calls, ['original']);
  assert.match(shader.fragmentShader, /uNightFill/);
  assert.match(shader.fragmentShader, /seen/);
});

test('the real material types get the fill when installed', () => {
  installNightFill();
  const shader = fakeShader(THREE.ShaderLib.standard.fragmentShader);
  new THREE.MeshStandardMaterial().onBeforeCompile(shader);
  assert.equal(shader.uniforms.uNightFill, nightFill);
  const lambert = fakeShader(THREE.ShaderLib.lambert.fragmentShader);
  new THREE.MeshLambertMaterial().onBeforeCompile(lambert);
  assert.equal(lambert.uniforms.uNightFill, nightFill);
  // and a material with its own hook keeps it, without the fill unless it chains to the original
  const own = new THREE.MeshStandardMaterial();
  own.onBeforeCompile = shaderArg => { shaderArg.fragmentShader += '/*own*/'; };
  const ownShader = fakeShader(THREE.ShaderLib.standard.fragmentShader);
  own.onBeforeCompile(ownShader);
  assert.ok(!ownShader.uniforms.uNightFill);
});
