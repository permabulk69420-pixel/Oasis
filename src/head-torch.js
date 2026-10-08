import * as THREE from 'three';
import { pulseHaptics } from './haptics.js';
import { TORCH_SHADER_MARKERS } from './night-fill.js';

// Layer a long-throw hot spot with a broad, dim spill. Wide penumbras make both
// edges disappear gradually instead of projecting a hard circle on nearby surfaces.
// Power is bounded at the source (no near-field inverse-square spike), and the
// range cutoff fades each layer smoothly. Match these profiles in the ground/water
// shader below so the VR world receives the same two layers as normal meshes.
const BEAM = Object.freeze({ angle: Math.PI / 10, range: 120, power: 1.10, penumbra: 0.78 });
const SPILL = Object.freeze({ angle: Math.PI * 52 / 180, range: 42, power: 0.25, penumbra: 0.88 });
const DECAY = 0;
// A deliberate tap near the upper headset, not a broad zone around the face.
const CONTACT = 0.11, RELEASE = 0.22, COOLDOWN_MS = 400;

// No mesh: a head-following beam, plus the same beam on the custom ground/water shaders.
export function createHeadTorch({ scene, states, sand, water, getExposure = () => 1 }) {
  const light = new THREE.SpotLight(0xfff1da, 0, BEAM.range, BEAM.angle, BEAM.penumbra, DECAY);
  light.name = 'Head torch beam';
  light.castShadow = false;
  const spill = new THREE.SpotLight(0xffe8c6, 0, SPILL.range, SPILL.angle, SPILL.penumbra, DECAY);
  spill.name = 'Head torch spill';
  spill.castShadow = false; // two shadow maps per eye would be too expensive on Quest
  scene.add(light, light.target, spill, spill.target);
  const uniforms = {
    uHeadTorchPosition: { value: light.position },
    uHeadTorchDirection: { value: new THREE.Vector3(0, 0, -1) },
    uHeadTorchPower: { value: 0 },
    uHeadTorchSpillPower: { value: 0 },
  };
  const declarations = /* glsl */`
    uniform vec3 uHeadTorchPosition;
    uniform vec3 uHeadTorchDirection;
    uniform float uHeadTorchPower;
    uniform float uHeadTorchSpillPower;
    float headTorchBeam(vec3 point) {
      vec3 ray = point - uHeadTorchPosition;
      float d = length(ray);
      float alignment = dot(ray / max(d, 0.001), uHeadTorchDirection);
      float core = smoothstep(${Math.cos(BEAM.angle)}, ${Math.cos(BEAM.angle * (1 - BEAM.penumbra))}, alignment);
      float halo = smoothstep(${Math.cos(SPILL.angle)}, ${Math.cos(SPILL.angle * (1 - SPILL.penumbra))}, alignment);
      float coreFade = pow(clamp(1.0 - pow(d / ${BEAM.range.toFixed(1)}, 4.0), 0.0, 1.0), 2.0);
      float spillFade = pow(clamp(1.0 - pow(d / ${SPILL.range.toFixed(1)}, 4.0), 0.0, 1.0), 2.0);
      return uHeadTorchPower * core * coreFade
        + uHeadTorchSpillPower * halo * spillFade;
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
    spill.position.copy(light.position);
    spill.target.position.copy(light.target.position);
    for (const state of states) {
      if (!interactive || !state.inputSource || !state.grip.visible) {
        touching.set(state, true); // A resumed/reconnected hand must move away before tapping.
        continue;
      }
      // Drawing/releasing a bowstring or handling an arrow/tool near the face
      // must not toggle the head torch. Require the hand to leave the zone
      // before a later, empty-handed tap can register.
      if (state.inputSource.gamepad?.buttons?.[1]?.pressed || state.objectGrip?.children?.length) {
        touching.set(state, true);
        continue;
      }
      state.grip.updateWorldMatrix(true, false);
      state.grip.getWorldPosition(hand);
      localHand.copy(hand).sub(head).applyQuaternion(inverseRotation);
      const distance = hand.distanceTo(light.position);
      if (distance >= RELEASE) touching.set(state, false);
      // Keep eating and reaching under the chin out of the head-tap zone.
      else if (distance <= CONTACT && localHand.y >= 0.04 && !touching.get(state)) {
        touching.set(state, true);
        if (time - lastTap >= COOLDOWN_MS) {
          enabled = !enabled;
          lastTap = time;
          pulseHaptics(state, 0.25, 40);
        }
      }
    }
    const exposure = Math.max(0.035, getExposure());
    light.intensity = active && enabled ? BEAM.power / exposure : 0;
    spill.intensity = active && enabled ? SPILL.power / exposure : 0;
    uniforms.uHeadTorchPower.value = light.intensity;
    uniforms.uHeadTorchSpillPower.value = spill.intensity;
  }

  return { update, light, spill, get enabled() { return enabled; } };
}
