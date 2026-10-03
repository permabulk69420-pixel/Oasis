import * as THREE from 'three';
import { SPAWN } from './world.js';
import { pulseHaptics } from './haptics.js';
import { setGripSurface } from './grip-contact.js';

const TORCH_URL = `${import.meta.env?.BASE_URL ?? '/'}models/torch/handheld_fire_torch.glb`;
const TORCH_AUDIO_URL = `${import.meta.env?.BASE_URL ?? '/'}audio/fire/torch_fire_crackle_loop.mp3`;
const TORCH_AUDIO_VOLUME = 0.65;
// B on the right controller, X on the left: toggles whichever torch that hand holds.
const TOGGLE_BUTTON = 5;
const LEFT_TOGGLE_BUTTON = 4;
const PICKUP_RADIUS = 0.58;
const TORCH_BOTTOM_BELOW_GRIP = 0.151;

const flamePosition = new THREE.Vector3();
const heldRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);

function createFlameEffect() {
  const group = new THREE.Group();
  group.name = 'Torch runtime flame';

  const uniforms = {
    uTime: { value: 0 },
    uStrength: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    name: 'Torch procedural flame',
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uStrength;
      varying vec2 vUv;
      void main() {
        float y = vUv.y;
        float sway = sin(uTime * 9.0 + y * 11.0) * 0.055
          + sin(uTime * 14.3 - y * 18.0) * 0.022;
        float width = mix(0.38, 0.035, pow(y, 0.72));
        float body = 1.0 - smoothstep(width * 0.50, width, abs(vUv.x - 0.5 - sway));
        float base = smoothstep(0.0, 0.09, y);
        float tip = 1.0 - smoothstep(0.78, 1.0, y + 0.035 * sin(uTime * 12.0));
        float flutter = 0.82 + 0.18 * sin(uTime * 18.0 + y * 23.0 + vUv.x * 7.0);
        float alpha = body * base * tip * flutter * uStrength;
        if (alpha < 0.018) discard;
        vec3 outer = vec3(1.0, 0.16, 0.015);
        vec3 inner = vec3(1.0, 0.78, 0.20);
        float core = 1.0 - smoothstep(0.02, max(width * 0.62, 0.025), abs(vUv.x - 0.5 - sway));
        vec3 color = mix(outer, inner, core * (1.0 - y * 0.42));
        gl_FragColor = vec4(color, alpha * 0.86);
      }
    `,
  });

  const geometry = new THREE.PlaneGeometry(0.125, 0.24, 1, 1);
  // Keep the entire additive flame above the authored anchor so it cannot wash over the shaft.
  geometry.translate(0, 0.14, 0);
  for (const yaw of [0, Math.PI / 3, Math.PI * 2 / 3]) {
    const flame = new THREE.Mesh(geometry, material);
    flame.rotation.y = yaw;
    flame.frustumCulled = false;
    flame.renderOrder = 20;
    group.add(flame);
  }

  const light = new THREE.PointLight(0xffa04a, 0, 12.0, 2.0);
  light.name = 'Torch warm light';
  light.castShadow = false;
  light.position.y = 0.16;
  group.add(light);

  return { group, material, light };
}

function installTerrainTorchLight(material, positionUniform, strengthUniform) {
  if (!material?.isShaderMaterial) return false;
  if (material.userData.torchLightInstalled) return true;

  const uniformMarker = 'uniform float uGrassTileMetres;';
  const lightMarker = 'vec3 light = ambient + vec3(1.23, 1.09, 0.86) * sun;';
  if (!material.fragmentShader.includes(uniformMarker) || !material.fragmentShader.includes(lightMarker)) return false;

  material.uniforms.uTorchPosition = positionUniform;
  material.uniforms.uTorchStrength = strengthUniform;
  material.fragmentShader = material.fragmentShader.replace(
    uniformMarker,
    `${uniformMarker}\n      uniform vec3 uTorchPosition;\n      uniform float uTorchStrength;`
  );
  material.fragmentShader = material.fragmentShader.replace(
    lightMarker,
    `${lightMarker}\n        if (uTorchStrength > 0.001) {\n          vec3 torchVector = uTorchPosition - vWorld;\n          float torchDistance = length(torchVector);\n          vec3 torchDirection = torchVector / max(torchDistance, 0.001);\n          float torchFade = 1.0 - smoothstep(0.8, 13.5, torchDistance);\n          torchFade *= 0.55 + 0.45 * torchFade;\n          float torchDiffuse = max(dot(n, torchDirection), 0.0);\n          float torchAmount = uTorchStrength * torchFade * (0.35 + 0.65 * torchDiffuse);\n          light += vec3(11.0, 4.6, 1.3) * torchAmount;\n        }`
  );
  material.userData.torchLightInstalled = true;
  material.needsUpdate = true;
  return true;
}

function installWaterTorchLight(material, positionUniform, strengthUniform) {
  if (!material?.isShaderMaterial) return false;
  if (material.userData.torchLightInstalled) return true;

  const uniformMarker = 'uniform sampler2D uElevation;';
  const colorMarker = 'vec3 color = mix(transmission, reflectedColor, fresnel);';
  if (!material.fragmentShader.includes(uniformMarker) || !material.fragmentShader.includes(colorMarker)) return false;

  material.uniforms.uTorchPosition = positionUniform;
  material.uniforms.uTorchStrength = strengthUniform;
  material.fragmentShader = material.fragmentShader.replace(
    uniformMarker,
    `${uniformMarker}\n      uniform vec3 uTorchPosition;\n      uniform float uTorchStrength;`
  );
  material.fragmentShader = material.fragmentShader.replace(
    colorMarker,
    `if (uTorchStrength > 0.001) {\n          vec3 torchVector = uTorchPosition - vWorld;\n          float torchDistance = length(torchVector);\n          vec3 torchDirection = torchVector / max(torchDistance, 0.001);\n          float torchFade = 1.0 - smoothstep(0.35, 12.0, torchDistance);\n          torchFade *= torchFade;\n          float torchFacing = max(dot(normal, torchDirection), 0.0);\n          vec3 torchReflection = reflect(-torchDirection, normal);\n          float torchGlint = pow(max(dot(torchReflection, view), 0.0), 92.0);\n          float shallowScatter = exp(-vDepth * 1.55) * (1.0 - fresnel);\n          vec3 torchColor = vec3(1.0, 0.31, 0.065);\n          transmission += torchColor * uTorchStrength * torchFade * shallowScatter * (0.045 + 0.11 * torchFacing);\n          reflectedColor += torchColor * uTorchStrength * torchFade * (0.025 * torchFacing + 2.25 * torchGlint);\n        }\n        ${colorMarker}`
  );
  material.userData.torchLightInstalled = true;
  material.needsUpdate = true;
  return true;
}

function makeFireAudio() {
  if (typeof Audio === 'undefined') return null;
  const audio = new Audio(TORCH_AUDIO_URL);
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = TORCH_AUDIO_VOLUME;
  audio.playsInline = true;
  return audio;
}

export function createTorchKind({ scene, onError = console.warn }) {
  // Terrain and water get one shared torch light, driven by the brightest lit torch.
  const terrainTorchPosition = { value: new THREE.Vector3(0, -1000, 0) };
  const terrainTorchStrength = { value: 0 };
  let terrainLightingReady = false;
  let waterLightingReady = false;
  let elapsed = 0;

  function ensureEnvironmentLighting() {
    if (!terrainLightingReady) {
      const terrainMesh = scene.getObjectByName('sand-0-0');
      if (terrainMesh?.material) {
        terrainLightingReady = installTerrainTorchLight(terrainMesh.material, terrainTorchPosition, terrainTorchStrength);
        if (!terrainLightingReady) onError('[Oasis torch] Could not inject torch lighting into terrain shader.');
      }
    }
    if (!waterLightingReady) {
      const waterMesh = scene.getObjectByName('Shallow water');
      if (waterMesh?.material) {
        waterLightingReady = installWaterTorchLight(waterMesh.material, terrainTorchPosition, terrainTorchStrength);
        if (!waterLightingReady) onError('[Oasis torch] Could not inject torch lighting into water shader.');
      }
    }
  }

  function setLit(instance, value) {
    const { state } = instance;
    state.lit = Boolean(value);
    if (state.flame) state.flame.group.visible = state.lit;
    if (state.lit) {
      state.audio ??= makeFireAudio();
      if (state.audio?.paused) {
        state.audio.play().catch(error => {
          if (error?.name !== 'NotAllowedError') onError(`[Oasis torch] Could not play fire audio: ${error?.message || error}`);
        });
      }
    } else {
      if (state.audio && !state.audio.paused) state.audio.pause();
      if (state.audio) state.audio.currentTime = 0;
      if (state.flame) state.flame.light.intensity = 0;
    }
    return state.lit;
  }

  return {
    id: 'torch',
    name: 'Handheld fire torch',
    url: TORCH_URL,
    groundBottom: TORCH_BOTTOM_BELOW_GRIP,
    pickupLift: 0.22,
    pickupRadius: PICKUP_RADIUS,
    // The authored +Y torch axis points opposite the Quest hand socket's held-up direction.
    heldRotation,
    // Rides at the hip, leaning back and out so a lit flame stays clear of your face.
    holster: { dir: [0.22, 1, 0.28], along: 0.12 },
    spawns: [{ x: SPAWN.x + 0.75, z: SPAWN.z - 1.05 }],

    prepare(instance) {
      const { root, state } = instance;
      setGripSurface(root, { meshes: ['WoodenShaft'], axis: [0, 1, 0], point: [0, 0, 0] });
      root.traverse(object => {
        if (!object.isMesh) return;
        object.castShadow = false;
        object.receiveShadow = false;
      });
      let anchor = root.getObjectByName('FlameAnchor');
      if (!anchor) {
        anchor = new THREE.Group();
        anchor.name = 'FlameAnchor_RuntimeFallback';
        anchor.position.set(0, 0.525, 0);
        root.add(anchor);
        onError('[Oasis torch] FlameAnchor missing from GLB; using runtime fallback.');
      }
      state.flameAnchor = anchor;
      state.flame = createFlameEffect();
      state.flame.group.visible = false;
      anchor.add(state.flame.group);
    },
    createState: () => ({ lit: false, toggleDown: false, flame: null, flameAnchor: null, audio: null }),
    onDispose(instance) { setLit(instance, false); },

    update(instance, dt) {
      const { heldBy, state } = instance;
      const button = heldBy?.handedness === 'left' ? LEFT_TOGGLE_BUTTON : TOGGLE_BUTTON;
      const pressed = Boolean(heldBy?.inputSource?.gamepad?.buttons?.[button]?.pressed);
      if (pressed && !state.toggleDown) {
        const turningOn = setLit(instance, !state.lit);
        pulseHaptics(heldBy, turningOn ? 0.40 : 0.22, turningOn ? 55 : 28);
      }
      state.toggleDown = pressed;
      if (!state.flame) return;
      state.flame.material.uniforms.uTime.value = elapsed;
    },

    updateShared(dt, torches) {
      ensureEnvironmentLighting();
      elapsed += dt;
      const flicker = 0.90
        + Math.sin(elapsed * 13.1) * 0.055
        + Math.sin(elapsed * 21.7 + 0.8) * 0.035
        + Math.sin(elapsed * 7.3 + 2.1) * 0.025;
      const strength = THREE.MathUtils.clamp(flicker, 0.80, 1.08);
      let lightSource = null;
      for (const torch of torches) {
        if (!torch.state.lit || !torch.state.flame) continue;
        torch.state.flame.material.uniforms.uStrength.value = strength;
        torch.state.flame.light.intensity = 18 * THREE.MathUtils.clamp(flicker, 0.82, 1.08);
        // A torch in hand lights the ground first; otherwise any lit one (e.g. on a hip).
        if (!lightSource || (torch.heldBy && !lightSource.heldBy)) lightSource = torch;
      }
      if (!lightSource) { terrainTorchStrength.value = 0; return; }
      lightSource.state.flameAnchor.updateWorldMatrix(true, false);
      lightSource.state.flameAnchor.getWorldPosition(flamePosition);
      terrainTorchPosition.value.copy(flamePosition);
      terrainTorchStrength.value = strength;
    },

    setLit,
  };
}
