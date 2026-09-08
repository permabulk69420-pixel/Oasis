import * as THREE from 'three';
import { WATER } from './world.js';

const FIREFLY_COUNT = 28;

function smoothstep(a, b, value) {
  const t = THREE.MathUtils.clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

export function createWaterFireflies({ scene }) {
  if (!scene) throw new Error('Water fireflies require the Oasis scene.');

  const random = seededRandom(0x51f1e5);
  const positions = new Float32Array(FIREFLY_COUNT * 3);
  const seeds = new Float32Array(FIREFLY_COUNT);
  const sizes = new Float32Array(FIREFLY_COUNT);

  for (let i = 0; i < FIREFLY_COUNT; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * 0.84;
    const offset = i * 3;
    positions[offset] = WATER.x + Math.cos(angle) * WATER.radiusX * radius;
    positions[offset + 1] = WATER.y + 0.28 + random() * 1.30;
    positions[offset + 2] = WATER.z + Math.sin(angle) * WATER.radiusZ * radius;
    seeds[i] = random();
    sizes[i] = 0.025 + random() * 0.018;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const uniforms = {
    uTime: { value: 0 },
    uVisibility: { value: 0 },
  };

  const material = new THREE.ShaderMaterial({
    name: 'Oasis fireflies',
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */`
      attribute float aSeed;
      attribute float aSize;
      uniform float uTime;
      uniform float uVisibility;
      varying float vAlpha;
      varying float vSeed;

      void main() {
        vec3 p = position;
        float phase = aSeed * 37.0;
        p.x += sin(uTime * (0.22 + aSeed * 0.13) + phase) * 0.24;
        p.z += cos(uTime * (0.19 + aSeed * 0.11) + phase * 1.31) * 0.24;
        p.y += sin(uTime * (0.52 + aSeed * 0.28) + phase * 0.73) * 0.12;

        float pulse = 0.5 + 0.5 * sin(uTime * (1.15 + aSeed * 1.55) + phase * 2.4);
        pulse = smoothstep(0.18, 0.92, pulse);
        vAlpha = uVisibility * (0.22 + pulse * 0.78);
        vSeed = aSeed;

        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp(aSize * (420.0 / max(-mvPosition.z, 1.0)), 1.4, 7.0);
      }
    `,
    fragmentShader: /* glsl */`
      varying float vAlpha;
      varying float vSeed;

      void main() {
        vec2 delta = gl_PointCoord - vec2(0.5);
        float radius = length(delta) * 2.0;
        if (radius >= 1.0 || vAlpha <= 0.002) discard;

        float halo = 1.0 - smoothstep(0.10, 1.0, radius);
        float core = 1.0 - smoothstep(0.00, 0.28, radius);
        float alpha = (halo * 0.34 + core * 0.66) * vAlpha * 0.72;
        vec3 warm = vec3(1.0, 0.82, 0.22);
        vec3 green = vec3(0.62, 1.0, 0.30);
        vec3 color = mix(warm, green, vSeed * 0.55);
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'Oasis night fireflies';
  points.visible = false;
  points.frustumCulled = false;
  points.renderOrder = 12;
  scene.add(points);

  let elapsed = 0;

  function update(dt = 0, dayNightState = null) {
    if (Number.isFinite(dt) && dt > 0) elapsed = (elapsed + dt) % 100000;
    uniforms.uTime.value = elapsed;

    const daylight = Number.isFinite(dayNightState?.daylight) ? dayNightState.daylight : 1;
    // They begin to appear only at the tail end of twilight and are fully present in darkness.
    const visibility = 1 - smoothstep(0.015, 0.085, daylight);
    uniforms.uVisibility.value = visibility;
    points.visible = visibility > 0.002;
  }

  return { points, update };
}
