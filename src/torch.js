import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SPAWN, terrainHeight } from './world.js';

const TORCH_URL = `${import.meta.env.BASE_URL}models/torch/handheld_fire_torch.glb`;
const RIGHT_HAND = 'right';
const GRIP_BUTTON = 1;
const B_BUTTON = 5;
const PICKUP_RADIUS = 0.58;
const TORCH_BOTTOM_BELOW_GRIP = 0.151;
const GROUND_GLOW_RADIUS = 6.5;
const GROUND_GLOW_RINGS = 3;
const GROUND_GLOW_SEGMENTS = 24;

const loader = new GLTFLoader();
const handPosition = new THREE.Vector3();
const torchPosition = new THREE.Vector3();
const flamePosition = new THREE.Vector3();

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

  const light = new THREE.PointLight(0xffa04a, 0, 8.0, 2.0);
  light.name = 'Torch warm light';
  light.castShadow = false;
  // Raise the light into the flame rather than lighting the shaft from inside the wrapped head.
  light.position.y = 0.16;
  group.add(light);

  return { group, material, light };
}

function createGroundGlow() {
  const positions = [];
  const intensity = [];
  const indices = [];
  const ringStarts = [0];

  positions.push(0, 0, 0);
  intensity.push(1);

  for (let ring = 1; ring <= GROUND_GLOW_RINGS; ring++) {
    ringStarts[ring] = positions.length / 3;
    const radiusFactor = ring / GROUND_GLOW_RINGS;
    for (let i = 0; i < GROUND_GLOW_SEGMENTS; i++) {
      const angle = i / GROUND_GLOW_SEGMENTS * Math.PI * 2;
      positions.push(Math.cos(angle) * radiusFactor, 0, Math.sin(angle) * radiusFactor);
      intensity.push(Math.pow(1 - radiusFactor, 1.45));
    }
  }

  const firstRing = ringStarts[1];
  for (let i = 0; i < GROUND_GLOW_SEGMENTS; i++) {
    indices.push(0, firstRing + i, firstRing + (i + 1) % GROUND_GLOW_SEGMENTS);
  }
  for (let ring = 2; ring <= GROUND_GLOW_RINGS; ring++) {
    const inner = ringStarts[ring - 1];
    const outer = ringStarts[ring];
    for (let i = 0; i < GROUND_GLOW_SEGMENTS; i++) {
      const next = (i + 1) % GROUND_GLOW_SEGMENTS;
      indices.push(inner + i, outer + i, inner + next);
      indices.push(inner + next, outer + i, outer + next);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aIntensity', new THREE.Float32BufferAttribute(intensity, 1));
  geometry.setIndex(indices);

  const material = new THREE.ShaderMaterial({
    name: 'Torch terrain glow',
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: { uGlow: { value: 0 } },
    vertexShader: /* glsl */`
      attribute float aIntensity;
      varying float vIntensity;
      void main() {
        vIntensity = aIntensity;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uGlow;
      varying float vIntensity;
      void main() {
        float alpha = vIntensity * uGlow;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(1.0, 0.38, 0.08, alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Torch terrain illumination';
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.visible = false;
  return { mesh, geometry, material };
}

function updateGroundGlow(glow, center) {
  const position = glow.geometry.attributes.position;
  let vertex = 0;
  position.setXYZ(vertex++, center.x, terrainHeight(center.x, center.z) + 0.045, center.z);
  for (let ring = 1; ring <= GROUND_GLOW_RINGS; ring++) {
    const radius = GROUND_GLOW_RADIUS * ring / GROUND_GLOW_RINGS;
    for (let i = 0; i < GROUND_GLOW_SEGMENTS; i++) {
      const angle = i / GROUND_GLOW_SEGMENTS * Math.PI * 2;
      const x = center.x + Math.cos(angle) * radius;
      const z = center.z + Math.sin(angle) * radius;
      position.setXYZ(vertex++, x, terrainHeight(x, z) + 0.045, z);
    }
  }
  position.needsUpdate = true;
}

export function createHeldTorch({ scene, states, onError = console.warn }) {
  if (!scene || !Array.isArray(states)) throw new Error('Torch requires the Oasis scene and VR hand states.');

  const groundGlow = createGroundGlow();
  scene.add(groundGlow.mesh);

  let root = null;
  let flameAnchor = null;
  let flame = null;
  let heldBy = null;
  let gripDown = false;
  let bDown = false;
  let lit = false;
  let elapsed = 0;

  function setLit(value) {
    lit = Boolean(value);
    if (flame) flame.group.visible = lit;
    if (groundGlow.mesh) groundGlow.mesh.visible = lit;
    if (!lit) {
      if (flame) flame.light.intensity = 0;
      groundGlow.material.uniforms.uGlow.value = 0;
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
    if (!root || !state?.objectGrip) return false;
    state.objectGrip.add(root);
    root.position.set(0, 0, 0);
    // The authored +Y torch axis points opposite the Quest hand socket's held-up direction.
    // Flip only while held; the world spawn remains authored upright.
    root.rotation.set(Math.PI, 0, 0);
    root.scale.set(1, 1, 1);
    heldBy = state;
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
    scene.add(root);
    placeOnGround(SPAWN.x + 0.75, SPAWN.z - 1.05);
  }, undefined, (error) => {
    onError(`[Oasis torch] Torch model failed to load: ${error?.message || error}`);
  });

  function update(dt) {
    elapsed += Number.isFinite(dt) ? dt : 0;
    const right = states.find((state) => state.handedness === RIGHT_HAND);
    const buttons = right?.inputSource?.gamepad?.buttons || [];
    const grip = Boolean(buttons[GRIP_BUTTON]?.pressed);
    const b = Boolean(buttons[B_BUTTON]?.pressed);

    if (right && root && !heldBy && grip && !gripDown) {
      right.objectGrip.updateWorldMatrix(true, false);
      right.objectGrip.getWorldPosition(handPosition);
      root.updateWorldMatrix(true, false);
      root.getWorldPosition(torchPosition);
      // Aim at the useful middle of the shaft rather than only the authored grip pivot,
      // so the upright test spawn is easy to pick up without crouching to the sand.
      torchPosition.y += 0.22;
      if (handPosition.distanceTo(torchPosition) <= PICKUP_RADIUS) grab(right);
    }
    if (heldBy && !grip) drop();

    if (heldBy === right && b && !bDown) setLit(!lit);
    gripDown = grip;
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
    flame.material.uniforms.uStrength.value = THREE.MathUtils.clamp(flicker, 0.78, 1.08);
    // The terrain shader gets its own cheap glow; this light only needs to illuminate nearby PBR props/hands.
    flame.light.intensity = 18 * THREE.MathUtils.clamp(flicker, 0.82, 1.08);
    groundGlow.material.uniforms.uGlow.value = 0.17 * THREE.MathUtils.clamp(flicker, 0.80, 1.05);
    updateGroundGlow(groundGlow, flamePosition);
  }

  return {
    update,
    drop,
    setLit,
    isLit: () => lit,
    isHeld: () => Boolean(heldBy),
    getObject: () => root,
  };
}
