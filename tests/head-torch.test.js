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
  assert.ok(f.torch.spill.position.distanceTo(expected) < 1e-8, 'spill must track the same head position');
  const spillDirection = f.torch.spill.target.position.clone().sub(f.torch.spill.position).normalize();
  assert.ok(spillDirection.distanceTo(direction) < 1e-8, 'spill must follow the head direction');
  assert.equal(f.torch.light.castShadow, false);
  assert.equal(f.torch.spill.castShadow, false);
  let meshes = 0; f.scene.traverse(object => { if (object.isMesh) meshes++; });
  assert.equal(meshes, 0);
});

test('ground/water share the live beam and exposure compensation; handheld torch markers remain', () => {
  const f = setup(); f.update(0); f.reach(); f.update(100);
  f.setExposure(0.035); f.update(500);
  assert.ok(Math.abs(f.torch.light.intensity * 0.035 - 1.1) < 1e-8);
  assert.ok(Math.abs(f.torch.spill.intensity * 0.035 - 0.25) < 1e-8);
  for (const [index, material] of f.materials.entries()) {
    assert.equal(material.uniforms.uHeadTorchPower.value, f.torch.light.intensity);
    assert.equal(material.uniforms.uHeadTorchSpillPower.value, f.torch.spill.intensity);
    assert.equal(material.uniforms.uHeadTorchPosition.value, f.torch.light.position);
    for (const marker of Object.values(Object.values(TORCH_SHADER_MARKERS)[index])) assert.ok(material.fragmentShader.includes(marker));
  }
  f.away(); f.update(600); f.reach(); f.update(700);
  for (const material of f.materials) {
    assert.equal(material.uniforms.uHeadTorchPower.value, 0);
    assert.equal(material.uniforms.uHeadTorchSpillPower.value, 0);
  }
  assert.equal(f.torch.spill.intensity, 0);
});

test('headlamp has a long, soft centre and a genuinely wide, shorter spill', () => {
  const f = setup(); f.update(0); f.reach(); f.update(100);
  const { light, spill } = f.torch;

  assert.ok(light.angle >= Math.PI / 12 && light.angle <= Math.PI / 9,
    'central beam should be roughly 30 to 40 degrees wide');
  assert.ok(spill.angle >= Math.PI / 4 && spill.angle <= Math.PI / 3,
    'spill should illuminate a much wider field');
  assert.ok(light.distance >= 100, 'central beam should reach across distant terrain');
  assert.ok(spill.distance >= 35 && spill.distance <= 50, 'spill should fade around nearby objects');
  assert.ok(light.penumbra >= 0.7 && spill.penumbra >= 0.8, 'both edges should feather gradually');
  assert.ok(spill.intensity > 0 && spill.intensity < light.intensity / 3,
    'spill is a separate dim light, not another bright hotspot');
  assert.equal(light.decay, 0);
  assert.equal(spill.decay, 0);

  const coreCone = `smoothstep(${Math.cos(light.angle)}, ${Math.cos(light.angle * (1 - light.penumbra))}, alignment)`;
  const spillCone = `smoothstep(${Math.cos(spill.angle)}, ${Math.cos(spill.angle * (1 - spill.penumbra))}, alignment)`;
  for (const material of f.materials) {
    assert.ok(material.fragmentShader.includes(coreCone), 'ground/water must match the core cone');
    assert.ok(material.fragmentShader.includes(spillCone), 'ground/water must match the spill cone');
    assert.ok(material.fragmentShader.includes(`d / ${light.distance.toFixed(1)}`));
    assert.ok(material.fragmentShader.includes(`d / ${spill.distance.toFixed(1)}`));
    assert.ok(material.fragmentShader.includes('uHeadTorchSpillPower * halo * spillFade'),
      'ground/water should render a separate spill component');
    assert.ok(material.fragmentShader.includes('vec3 headTorchBeam'),
      'ground and water must preserve the separate beam and spill colours');
  }
});

test('close-range brightness is bounded while off-axis ground receives spill', () => {
  const f = setup(); f.update(0); f.reach(); f.update(100);
  const { light, spill } = f.torch;
  const smoothstep = (a, b, x) => {
    const u = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };
  const sample = (degrees, distance) => {
    const alignment = Math.cos(degrees * Math.PI / 180);
    return [light, spill].reduce((sum, part) => {
      const cone = smoothstep(Math.cos(part.angle), Math.cos(part.angle * (1 - part.penumbra)), alignment);
      const fade = Math.pow(Math.max(0, 1 - Math.pow(distance / part.distance, 4)), 2);
      return sum + part.intensity * cone * fade;
    }, 0);
  };

  assert.ok(sample(0, 3) < 1.5, 'nearby surfaces should not be overwhelmed');
  assert.ok(sample(0, 80) > 0.6, 'the central beam must retain useful long-range strength');
  assert.ok(sample(35, 12) > 0.10, 'outer halo should light surfaces far outside the core');
  assert.ok(sample(35, 12) < sample(0, 12) / 3, 'spill must remain softer and dimmer than the centre');
  assert.ok(sample(35, 65) < 0.01, 'spill should fade before becoming a distant broad searchlight');

  const coreAtNormalExposure = light.intensity;
  const spillAtNormalExposure = spill.intensity;
  f.setExposure(0.035); f.update(500); // darkest night
  assert.ok(Math.abs(light.intensity * 0.035 - coreAtNormalExposure) < 1e-8,
    'exposure change should preserve the effective core brightness');
  assert.ok(Math.abs(spill.intensity * 0.035 - spillAtNormalExposure) < 1e-8,
    'exposure change should preserve the effective spill brightness');
});

test('only the head-tap contact radius is reduced', () => {
  const f = setup(); f.update(0);
  // Previously in the 23 cm contact zone, but outside the 11 cm zone.
  f.states[0].grip.position.set(0.16, 1.78, -0.03);
  f.update(100); assert.equal(f.torch.enabled, false);
  // The original height rule is unchanged: lower-head taps remain valid.
  f.states[0].grip.position.set(0, 1.70, -0.03);
  f.update(200); assert.equal(f.torch.enabled, true);
  // Preserve the original 33 cm re-arm threshold.
  f.states[0].grip.position.set(0.26, 1.78, -0.03);
  f.update(700); f.reach(); f.update(800);
  assert.equal(f.torch.enabled, true);
  f.away(); f.update(900); f.reach(); f.update(1000);
  assert.equal(f.torch.enabled, false);
});

test('holding an object or squeezing the grip does not change original tap behaviour', () => {
  const f = setup(); f.update(0);
  const state = f.states[0];
  state.inputSource.gamepad.buttons = [{ pressed: false }, { pressed: true }];
  state.objectGrip = new THREE.Group();
  state.objectGrip.add(new THREE.Group());
  f.reach(); f.update(100);
  assert.equal(f.torch.enabled, true, 'grip and held objects must not suppress a legitimate tap');
  f.away(); f.update(700); f.reach(); f.update(800);
  assert.equal(f.torch.enabled, false, 'a second tap must also work while the grip is held');
});
