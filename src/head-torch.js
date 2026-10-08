import * as THREE from 'three';
import { pulseHaptics } from './haptics.js';
import { TORCH_SHADER_MARKERS } from './night-fill.js';

// A focused beam with slower falloff so distant ground remains visible at night.
const ANGLE = Math.PI / 18, RANGE = 100, POWER = 140, PENUMBRA = 0.22, DECAY = 1;
const CONTACT = 0.23, RELEASE = 0.33, COOLDOWN_MS = 400;

// No mesh: a head-following beam, plus the same beam on the custom ground/water shaders.
export function createHeadTorch({ scene, states, sand, water, getExposure = () => 1 }) {
  const light = new THREE.SpotLight(0xfff1da, 0, RANGE, ANGLE, PENUMBRA, DECAY);
  light.name = 'Head torch';
  light.castShadow = false;
  scene.add(light, light.target);
  const uniforms = {
    uHeadTorchPosition: { value: light.position },
    uHeadTorchDirection: { value: new THREE.Vector3(0, 0, -1) },
    uHeadTorchPower: { value: 0 },
  };
  const declarations = /* glsl */`
    uniform vec3 uHeadTorchPosition;
    uniform vec3 uHeadTorchDirection;
    uniform float uHeadTorchPower;
    float headTorchBeam(vec3 point) {
      vec3 ray = point - uHeadTorchPosition;
      float d = length(ray);
      float cone = smoothstep(${Math.cos(ANGLE)}, ${Math.cos(ANGLE * (1 - PENUMBRA))},
        dot(ray / max(d, 0.001), uHeadTorchDirection));
      float fade = pow(clamp(1.0 - pow(d / ${RANGE.toFixed(1)}, 4.0), 0.0, 1.0), 2.0);
      return uHeadTorchPower * cone * fade / max(pow(d, ${DECAY.toFixed(1)}), 1.0);
    }`;
  const colour = `vec3(${light.color.r}, ${light.color.g}, ${light.color.b})`;
  for (const [material, markers, code] of [
    [sand, TORCH_SHADER_MARKERS.terrain, /* glsl */`
      if (uHeadTorchPower > 0.0) {
        vec3 toHead = normalize(uHeadTorchPosition - vWorld);
        // A grazing beam must still illuminate distant, nearly horizontal ground.
        light += ${colour} * headTorchBeam(vWorld) * (0.28 + 0.72 * max(dot(n, toHead), 0.0));
      }`],
    [water, TORCH_SHADER_MARKERS.water, /* glsl */`
      if (uHeadTorchPower > 0.0) {
        vec3 toHead = normalize(uHeadTorchPosition - vWorld);
        float beam = headTorchBeam(vWorld);
        transmission += ${colour} * beam * 0.1 * max(dot(normal, toHead), 0.0);
        reflectedColor += ${colour} * beam * pow(max(dot(reflect(-toHead, normal), view), 0.0), 92.0);
      }`],
  ]) {
    const marker = markers.light ?? markers.colour;
    if (!material?.fragmentShader.includes(markers.uniform) || !material.fragmentShader.includes(marker)) {
      throw new Error('Head torch lighting: missing ground/water shader marker');
    }
    Object.assign(material.uniforms, uniforms);
    material.fragmentShader = material.fragmentShader.replace(markers.uniform, `${markers.uniform}\n${declarations}`)
      .replace(marker, markers.light ? `${marker}\n${code}` : `${code}\n${marker}`);
    material.needsUpdate = true;
  }

  const head = new THREE.Vector3(), hand = new THREE.Vector3(), localHand = new THREE.Vector3();
  const rotation = new THREE.Quaternion(), inverseRotation = new THREE.Quaternion();
  const touching = new Map(states.map(state => [state, true]));
  let enabled = false, lastTap = -Infinity;

  function update(view, { active, interactive, time }) {
    view.updateWorldMatrix(true, false);
    view.getWorldPosition(head);
    view.getWorldQuaternion(rotation);
    inverseRotation.copy(rotation).invert();
    light.position.set(0, 0.08, -0.03).applyQuaternion(rotation).add(head);
    uniforms.uHeadTorchDirection.value.set(0, 0, -1).applyQuaternion(rotation);
    light.target.position.copy(light.position).add(uniforms.uHeadTorchDirection.value);
    for (const state of states) {
      if (!interactive || !state.inputSource || !state.grip.visible) {
        touching.set(state, true); // A resumed/reconnected hand must move away before tapping.
        continue;
      }
      state.grip.updateWorldMatrix(true, false);
      state.grip.getWorldPosition(hand);
      localHand.copy(hand).sub(head).applyQuaternion(inverseRotation);
      const distance = hand.distanceTo(light.position);
      if (distance >= RELEASE) touching.set(state, false);
      // Keep eating and reaching under the chin out of the head-tap zone.
      else if (distance <= CONTACT && localHand.y >= -0.06 && !touching.get(state)) {
        touching.set(state, true);
        if (time - lastTap >= COOLDOWN_MS) {
          enabled = !enabled;
          lastTap = time;
          pulseHaptics(state, 0.25, 40);
        }
      }
    }
    light.intensity = active && enabled ? POWER / Math.max(0.035, getExposure()) : 0;
    uniforms.uHeadTorchPower.value = light.intensity;
  }

  return { update, light, get enabled() { return enabled; } };
}
