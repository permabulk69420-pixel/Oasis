import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { nightFill, NIGHT_FILL, TORCH_GLOW, torchGlow, patchNightFill, installNightFill } from '../src/night-fill.js';

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

test('patching also shares the torch uniforms, and the torch glow only shows at night', () => {
  for (const name of ['standard', 'lambert']) {
    const shader = fakeShader(THREE.ShaderLib[name].fragmentShader);
    assert.equal(patchNightFill(shader), true);
    assert.equal(shader.uniforms.uTorchPosition, torchGlow.position, `${name}: one shared torch position`);
    assert.equal(shader.uniforms.uTorchStrength, torchGlow.strength, `${name}: one shared torch strength`);
    assert.match(shader.fragmentShader, /uniform vec3 uTorchPosition;/);
    assert.match(shader.fragmentShader, /if \(uTorchStrength > 0\.001\)/, 'skipped entirely when no torch is lit');
    assert.match(shader.fragmentShader, /uTorchStrength \* uNightFill/, 'fades out by day with the night fill');
    // inverseTransformDirection normalises, which would put every pixel about a metre from the camera
    assert.doesNotMatch(shader.fragmentShader, /inverseTransformDirection\(-vViewPosition/);
  }
});

test('the torch glow is warm, reaches a sensible distance, and starts with no torch lit', () => {
  const [r, g, b] = TORCH_GLOW.colour;
  assert.ok(r > g && g > b, 'orange');
  assert.ok(TORCH_GLOW.near < TORCH_GLOW.far && TORCH_GLOW.far <= 20);
  assert.ok(TORCH_GLOW.floor > 0 && TORCH_GLOW.floor < 0.2, 'lights a dark surface a little, not a lot');
  assert.equal(torchGlow.strength.value, 0);
  assert.ok(torchGlow.position.value.y < -100, 'parked far below the world until a torch is lit');
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

test('the terrain and water shaders still contain the lines the torch light hooks into', async () => {
  const { TORCH_SHADER_MARKERS } = await import('../src/night-fill.js');
  const source = (await import('node:fs')).readFileSync(new URL('../src/materials.js', import.meta.url), 'utf8');
  for (const [shader, markers] of Object.entries(TORCH_SHADER_MARKERS)) {
    for (const [name, text] of Object.entries(markers)) {
      assert.equal(source.split(text).length - 1, 1, `${shader} shader: "${name}" marker "${text}" must appear exactly once in src/materials.js`);
    }
  }
});
