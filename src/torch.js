import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SPAWN, terrainHeight } from './world.js';
import { pulseHaptics } from './haptics.js';

const TORCH_URL = `${import.meta.env?.BASE_URL ?? '/'}models/torch/handheld_fire_torch.glb`;
const TORCH_AUDIO_URL = `${import.meta.env?.BASE_URL ?? '/'}audio/fire/torch_fire_crackle_loop.mp3`;
const TORCH_AUDIO_VOLUME = 0.65;
const GRIP_BUTTON = 1;
const B_BUTTON = 5;
const PICKUP_RADIUS = 0.58;
const TORCH_BOTTOM_BELOW_GRIP = 0.151;

const loader = new GLTFLoader();
const handPosition = new THREE.Vector3();
const torchPosition = new THREE.Vector3();
const flamePosition = new THREE.Vector3();

// All torches share the existing single terrain/water light slot. Prefer a held
// lit torch; individual flames and point lights still belong to each physical tool.
const sceneLighting = new WeakMap();
function getSceneLighting(scene) {
  if (!sceneLighting.has(scene)) sceneLighting.set(scene, {
    position: { value: new THREE.Vector3(0, -1000, 0) },
    strength: { value: 0 },
    sources: [],
  });
  return sceneLighting.get(scene);
}
export function updateTorchLighting(scene) {
  const lighting = sceneLighting.get(scene);
  if (!lighting) return;
  const lit = lighting.sources.filter(source => source.active());
  const source = lit.find(source => source.held()) || lit[0];
  lighting.strength.value = source?.strength || 0;
  if (source) lighting.position.value.copy(source.position);
}

function prepareTorch(root) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = false;
    object.receiveShadow = false;
  });
}

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

export function createHeldTorch({ scene, states, onError = console.warn, spawnOnGround = true }) {
  if (!scene || !Array.isArray(states)) throw new Error('Torch requires the Oasis scene and VR hand states.');

  const lighting = getSceneLighting(scene);
  const terrainTorchPosition = lighting.position;
  const terrainTorchStrength = lighting.strength;
  const fireAudio = new Audio(TORCH_AUDIO_URL);
  fireAudio.loop = true;
  fireAudio.preload = 'auto';
  fireAudio.volume = TORCH_AUDIO_VOLUME;
  fireAudio.playsInline = true;

  let terrainLightingReady = false;
  let waterLightingReady = false;

  let root = null;
  let flameAnchor = null;
  let flame = null;
  let heldBy = null;
  const gripDown = new Map();
  let bDown = false;
  let lit = false;
  let elapsed = 0;
  const lightSource = {
    position: new THREE.Vector3(), strength: 0,
    active: () => lit && Boolean(root?.parent), held: () => Boolean(heldBy),
  };
  lighting.sources.push(lightSource);

  function ensureEnvironmentLighting() {
    if (!terrainLightingReady) {
      const terrainMesh = scene.getObjectByName('sand-0-0');
      if (terrainMesh?.material) {
        terrainLightingReady = installTerrainTorchLight(
          terrainMesh.material,
          terrainTorchPosition,
          terrainTorchStrength
        );
        if (!terrainLightingReady) onError('[Oasis torch] Could not inject torch lighting into terrain shader.');
      }
    }
    if (!waterLightingReady) {
      const waterMesh = scene.getObjectByName('Shallow water');
      if (waterMesh?.material) {
        waterLightingReady = installWaterTorchLight(
          waterMesh.material,
          terrainTorchPosition,
          terrainTorchStrength
        );
        if (!waterLightingReady) onError('[Oasis torch] Could not inject torch lighting into water shader.');
      }
    }
  }

  function startFireAudio() {
    if (!fireAudio.paused) return;
    fireAudio.play().catch((error) => {
      if (error?.name !== 'NotAllowedError') {
        onError(`[Oasis torch] Could not play fire audio: ${error?.message || error}`);
      }
    });
  }

  function stopFireAudio() {
    if (!fireAudio.paused) fireAudio.pause();
    fireAudio.currentTime = 0;
  }

  function setLit(value) {
    lit = Boolean(value);
    if (flame) flame.group.visible = lit;
    if (lit) {
      startFireAudio();
    } else {
      stopFireAudio();
      if (flame) flame.light.intensity = 0;
      lightSource.strength = 0;
    }
    return lit;
  }

  function placeOnGround(x, z) {
    if (!root) return;
    if (root.parent !== scene) scene.attach(root);
    root.position.set(x, terrainHeight(x, z) + TORCH_BOTTOM_BELOW_GRIP, z);
    root.quaternion.identity();
    root.scale.set(1, 1, 1);
    root.updateMatrixWorld(true);
  }

  function grab(state) {
    if (!root || heldBy || !state?.inputSource || !state?.objectGrip || state.objectGrip.children.length) return false;
    state.objectGrip.add(root);
    root.position.set(0, 0, 0);
    // The authored +Y torch axis points opposite the Quest hand socket's held-up direction.
    root.rotation.set(Math.PI, 0, 0);
    root.scale.set(1, 1, 1);
    heldBy = state;
    gripDown.set(state, true);
    return true;
  }

  function drop() {
    if (!root || !heldBy) return false;
    root.updateWorldMatrix(true, false);
    root.getWorldPosition(torchPosition);
    scene.attach(root);
    heldBy = null;
    placeOnGround(torchPosition.x, torchPosition.z);
    return true;
  }

  loader.load(TORCH_URL, (gltf) => {
    root = gltf.scene;
    root.name = 'Handheld fire torch';
    prepareTorch(root);
    flameAnchor = root.getObjectByName('FlameAnchor');
    if (!flameAnchor) {
      flameAnchor = new THREE.Group();
      flameAnchor.name = 'FlameAnchor_RuntimeFallback';
      flameAnchor.position.set(0, 0.525, 0);
      root.add(flameAnchor);
      onError('[Oasis torch] FlameAnchor missing from GLB; using runtime fallback.');
    }

    flame = createFlameEffect();
    flameAnchor.add(flame.group);
    flame.group.visible = false;
    if (spawnOnGround) scene.add(root);
    if (spawnOnGround) placeOnGround(SPAWN.x + 0.75, SPAWN.z - 1.05);
  }, undefined, (error) => {
    onError(`[Oasis torch] Torch model failed to load: ${error?.message || error}`);
  });

  function update(dt) {
    ensureEnvironmentLighting();
    elapsed += Number.isFinite(dt) ? dt : 0;
    if (heldBy && !heldBy.inputSource?.gamepad?.buttons[GRIP_BUTTON]?.pressed) drop();
    for (const state of states) {
      const grip = Boolean(state.inputSource?.gamepad?.buttons[GRIP_BUTTON]?.pressed);
      if (root?.parent === scene && !heldBy && grip && !gripDown.get(state) && state.objectGrip.children.length === 0) {
        state.objectGrip.updateWorldMatrix(true, false);
        state.objectGrip.getWorldPosition(handPosition);
        root.getWorldPosition(torchPosition);
        torchPosition.y += 0.22;
        if (handPosition.distanceTo(torchPosition) <= PICKUP_RADIUS) grab(state);
      }
      gripDown.set(state, grip);
    }
    // Keep B for ignition in either hand; left Y remains the inventory button.
    const right = states.find(state => state.handedness === 'right');
    const b = Boolean(right?.inputSource?.gamepad?.buttons[B_BUTTON]?.pressed);
    if (heldBy && b && !bDown) {
      const turningOn = !lit;
      setLit(turningOn);
      pulseHaptics(heldBy, turningOn ? 0.40 : 0.22, turningOn ? 55 : 28);
    }
    bDown = b;

    if (!root || !flameAnchor || !flame) return;
    flame.material.uniforms.uTime.value = elapsed;
    if (!lit) return;

    flameAnchor.updateWorldMatrix(true, false);
    flameAnchor.getWorldPosition(flamePosition);
    const flicker = 0.90
      + Math.sin(elapsed * 13.1) * 0.055
      + Math.sin(elapsed * 21.7 + 0.8) * 0.035
      + Math.sin(elapsed * 7.3 + 2.1) * 0.025;
    const strength = THREE.MathUtils.clamp(flicker, 0.80, 1.08);
    flame.material.uniforms.uStrength.value = strength;
    flame.light.intensity = 18 * THREE.MathUtils.clamp(flicker, 0.82, 1.08);
    lightSource.position.copy(flamePosition);
    lightSource.strength = strength;
  }

  return {
    update,
    equip: grab,
    drop,
    setLit,
    isLit: () => lit,
    isHeld: () => Boolean(heldBy),
    getObject: () => root,
  };
}
