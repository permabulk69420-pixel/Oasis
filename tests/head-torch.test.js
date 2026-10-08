import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHeadTorch } from '../src/head-torch.js';
import { TORCH_SHADER_MARKERS } from '../src/night-fill.js';

function setup() {
  const scene = new THREE.Scene(), rig = new THREE.Group(), view = new THREE.PerspectiveCamera();
  scene.add(rig); rig.add(view);
  rig.position.set(20, 250, -30);
  view.position.y = 1.68;
  const states = ['left', 'right'].map(handedness => {
    const grip = new THREE.Group(); rig.add(grip); grip.position.set(0.5, 1, -0.4);
    return { handedness, grip, inputSource: { gamepad: {} } };
  });
  const materials = Object.values(TORCH_SHADER_MARKERS).map(markers => new THREE.ShaderMaterial({
    fragmentShader: `${markers.uniform}\nvoid main() { ${markers.light ?? markers.colour} }`,
  }));
  let exposure = 1;
  const torch = createHeadTorch({ scene, states, sand: materials[0], water: materials[1], getExposure: () => exposure });
  const update = (time, options = {}) => torch.update(view, { active: true, interactive: true, time, ...options });
  const reach = (index = 0) => states[index].grip.position.set(0.07, 1.78, -0.03);
  const away = (index = 0) => states[index].grip.position.set(0.5, 1, -0.4);
  return { scene, rig, view, states, materials, torch, update, reach, away, setExposure: value => { exposure = value; } };
}

test('either hand toggles once per head tap; holding and contact jitter do not repeat', () => {
  const f = setup();
  f.update(0); assert.equal(f.torch.enabled, false);
  f.reach(); f.update(100); assert.equal(f.torch.enabled, true);
  f.update(700); assert.equal(f.torch.enabled, true);
  f.states[0].grip.position.x = 0.16; f.update(800);
  f.reach(); f.update(900); assert.equal(f.torch.enabled, true);
  f.away(); f.update(1000);
  f.reach(); f.update(1100); assert.equal(f.torch.enabled, false);
  f.reach(1); f.update(1600); assert.equal(f.torch.enabled, true);
});

test('both hands together and a rapid second tap cannot toggle twice', () => {
  const f = setup(); f.update(0);
  f.reach(); f.reach(1); f.update(100); assert.equal(f.torch.enabled, true);
  f.away(); f.away(1); f.update(150);
  f.reach(); f.update(200); assert.equal(f.torch.enabled, true);
  f.update(800); assert.equal(f.torch.enabled, true);
  f.away(); f.update(900); f.reach(); f.update(1000); assert.equal(f.torch.enabled, false);
});

test('mouth, untracked hands, menus and session resume cannot accidentally toggle', () => {
  const f = setup(); f.update(0);
  f.states[0].grip.position.set(0, 1.59, -0.03); f.update(100);
  assert.equal(f.torch.enabled, false);
  f.states[0].grip.visible = false; f.reach(); f.update(200);
  f.states[0].grip.visible = true; f.update(300); assert.equal(f.torch.enabled, false);
  f.away(); f.update(400); f.reach(); f.update(500, { interactive: false });
  f.update(600); assert.equal(f.torch.enabled, false);
  f.away(); f.update(700); f.reach(); f.update(800); assert.equal(f.torch.enabled, true);
  f.update(900, { active: false, interactive: false }); assert.equal(f.torch.light.intensity, 0);
  f.update(1000); assert.equal(f.torch.enabled, true);
  f.states[0].inputSource = null; f.away(); f.update(1500);
  f.reach(); f.update(1600); assert.equal(f.torch.enabled, true);
});

test('beam follows the world head pose after movement and turning, with no meshes or shadows', () => {
  const f = setup(); f.update(0); f.reach(); f.update(100);
  f.rig.position.set(-10, 255, 12); f.rig.rotation.y = Math.PI / 2; f.view.rotation.x = -0.3;
  f.update(600);
  const expected = new THREE.Vector3(0, 0.08, -0.03).applyQuaternion(f.view.getWorldQuaternion(new THREE.Quaternion()))
    .add(f.view.getWorldPosition(new THREE.Vector3()));
  assert.ok(f.torch.light.position.distanceTo(expected) < 1e-8);
  const direction = f.torch.light.target.position.clone().sub(f.torch.light.position).normalize();
  assert.ok(direction.distanceTo(f.view.getWorldDirection(new THREE.Vector3())) < 1e-8);
  assert.equal(f.torch.light.castShadow, false);
  let meshes = 0; f.scene.traverse(object => { if (object.isMesh) meshes++; });
  assert.equal(meshes, 0);
});

test('ground/water share the live beam and exposure compensation; handheld torch markers remain', () => {
  const f = setup(); f.update(0); f.reach(); f.update(100);
  f.setExposure(0.035); f.update(500);
  assert.ok(f.torch.light.intensity > 1000);
  for (const [index, material] of f.materials.entries()) {
    assert.equal(material.uniforms.uHeadTorchPower.value, f.torch.light.intensity);
    assert.equal(material.uniforms.uHeadTorchPosition.value, f.torch.light.position);
    for (const marker of Object.values(Object.values(TORCH_SHADER_MARKERS)[index])) assert.ok(material.fragmentShader.includes(marker));
  }
  f.away(); f.update(600); f.reach(); f.update(700);
  for (const material of f.materials) assert.equal(material.uniforms.uHeadTorchPower.value, 0);
});

test('head torch has a focused, long-range beam shared by terrain and water', () => {
  const f = setup(); f.update(0); f.reach(); f.update(100);
  const { light } = f.torch;
  assert.ok(light.angle <= Math.PI / 12, 'the full beam should be no wider than 30 degrees');
  assert.ok(light.distance >= 60, 'beam should extend well beyond the original 18 metres');
  assert.ok(light.intensity >= 100, 'the longer beam needs enough light to reach distant surfaces');
  assert.ok(light.penumbra <= 0.3, 'beam edge should stay relatively crisp');

  const sharedCone = `smoothstep(${Math.cos(light.angle)}, ${Math.cos(light.angle * (1 - light.penumbra))},`;
  for (const material of f.materials) {
    assert.ok(material.fragmentShader.includes(sharedCone), 'custom shaders should match spotlight focus');
    assert.ok(material.fragmentShader.includes(`d / ${light.distance.toFixed(1)}`), 'custom shaders should match spotlight range');
  }
});

test('slower attenuation makes distant ground visible without losing the focused beam', () => {
  const f = setup(); f.update(0); f.reach(); f.update(100);
  f.setExposure(0.035); f.update(500); // darkest night
  const { light } = f.torch;
  assert.equal(light.decay, 1, 'the standard-material spotlight must not use inverse-square falloff');
  assert.ok(light.distance >= 100);

  const terrainShader = f.materials[0].fragmentShader;
  const waterShader = f.materials[1].fragmentShader;
  for (const shader of [terrainShader, waterShader]) {
    assert.ok(shader.includes('max(pow(d, 1.0), 1.0)'), 'custom light falloff must match the spotlight decay');
  }
  assert.ok(terrainShader.includes('0.28 + 0.72 * max(dot(n, toHead), 0.0)'),
    'terrain should retain a minimum diffuse response at grazing angles');

  const farGroundLight = distance => {
    const fade = Math.pow(Math.max(1 - Math.pow(distance / light.distance, 4), 0), 2);
    const nearHorizontalFacing = 0.28 + 0.72 * (1.68 / Math.hypot(distance, 1.68));
    return light.intensity * fade / Math.max(Math.pow(distance, light.decay), 1) * nearHorizontalFacing;
  };
  assert.ok(farGroundLight(60) > 10, 'beam should remain substantial at 60 metres');
  assert.ok(farGroundLight(80) > 4, 'beam should remain visible beyond 80 metres');
});

test('head tap requires a small, upper-head contact zone', () => {
  const f = setup(); f.update(0);
  // Both are inside the old 23 cm zone but outside the reduced 11 cm contact.
  f.states[0].grip.position.set(0.16, 1.78, -0.03);
  f.update(100); assert.equal(f.torch.enabled, false);
  f.states[0].grip.position.set(0, 1.70, -0.03); // close to face, below tap region
  f.update(200); assert.equal(f.torch.enabled, false);
  f.away(); f.update(300);
  f.reach(); f.update(400); assert.equal(f.torch.enabled, true);
});

test('drawing and releasing an arrow beside the headset cannot toggle the torch', () => {
  const f = setup(); f.update(0);
  const state = f.states[0];
  state.inputSource.gamepad.buttons = [{ pressed: false }, { pressed: true }];
  f.reach(); f.update(100); assert.equal(f.torch.enabled, false);
  state.inputSource.gamepad.buttons[1].pressed = false;
  f.update(700); assert.equal(f.torch.enabled, false); // release while still next to headset
  f.away(); f.update(800); // only moving away rearms the tap
  f.reach(); f.update(900); assert.equal(f.torch.enabled, true);
});

test('a held arrow or bowstring prevents head taps until the hand leaves the zone', () => {
  const f = setup(); f.update(0);
  const state = f.states[0];
  state.objectGrip = new THREE.Group();
  const arrow = new THREE.Group();
  state.objectGrip.add(arrow);
  f.reach(); f.update(100); assert.equal(f.torch.enabled, false);
  state.objectGrip.remove(arrow);
  f.update(700); assert.equal(f.torch.enabled, false);
  f.away(); f.update(800);
  f.reach(); f.update(900); assert.equal(f.torch.enabled, true);
});
