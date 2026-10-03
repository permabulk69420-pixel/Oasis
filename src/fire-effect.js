import * as THREE from 'three';
import { WIND_SAND } from './wind-sand.js';

// A campfire's flame: a few upright billboards of scrolling fractal noise shaped like licking
// tongues (white-yellow core, orange body, red edge), a soft heat glow at the base and a handful of
// sparks drifting up. Everything is additive and drawn without tone mapping, so it reads the same at
// noon and at midnight; the cost is a few quads and a small point cloud per fire. Above the flame a
// thin plume of smoke rises, leans downwind and thins out: grey by day, glowing orange near the fire at night.

const NOISE_GLSL = /* glsl */`
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.7); a *= 0.5; }
    return v;
  }
`;

const FLAME_VERTEX = /* glsl */`
  uniform vec2 uSize;
  uniform float uGrow;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 centre = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    // Upright billboard: turns to face the viewer around the vertical axis only.
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    right.y = 0.0;
    right = normalize(right);
    vec3 world = centre + right * (position.x * uSize.x)
      + vec3(0.0, 1.0, 0.0) * (position.y * uSize.y * mix(0.35, 1.0, uGrow));
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const FLAME_FRAGMENT = /* glsl */`
  uniform float uTime;
  uniform float uStrength;
  uniform float uSeed;
  uniform float uSpeed;
  varying vec2 vUv;
  ${NOISE_GLSL}
  void main() {
    float y = vUv.y;
    float cx = vUv.x - 0.5;
    vec2 q = vec2(vUv.x * 3.2 + uSeed, y * 2.1 - uTime * 1.6 * uSpeed);
    float n1 = fbm(q);
    float n2 = fbm(q * 1.9 + vec2(4.1 + uSeed, -uTime * 2.7 * uSpeed));
    // tongues lean and lick sideways more toward the tip
    float x = cx - ((n1 - 0.5) * 0.55 + sin(uTime * 1.9 + uSeed * 3.0) * 0.07) * y;
    float tip = 0.88 + 0.12 * n2;
    float yy = y / tip;
    float width = mix(0.42, 0.02, pow(clamp(yy, 0.0, 1.0), 0.78));
    float body = 1.0 - smoothstep(width * 0.72, width, abs(x) + (n2 - 0.5) * 0.18 * y);
    float edge = smoothstep(0.0, 0.26, y) * (1.0 - smoothstep(0.72, 1.0, yy));
    float density = body * edge * (1.0 + 0.9 * (n1 - 0.5)) * 1.12;
    density *= 1.0 - smoothstep(0.55, 1.0, yy) * clamp(1.0 - n2 * 1.5, 0.0, 1.0);
    float a = clamp(density, 0.0, 1.0) * uStrength;
    if (a < 0.02) discard;
    float heat = clamp(1.0 - yy * 0.85 - abs(x) * 2.3 + (n1 - 0.5) * 0.45, 0.0, 1.0);
    vec3 colour = mix(vec3(0.85, 0.09, 0.01), vec3(1.0, 0.42, 0.035), smoothstep(0.0, 0.45, heat));
    colour = mix(colour, vec3(1.0, 0.82, 0.30), smoothstep(0.42, 0.85, heat));
    colour = mix(colour, vec3(1.0, 0.93, 0.66), smoothstep(0.88, 1.0, heat) * 0.5);
    gl_FragColor = vec4(colour * (0.78 + 0.42 * heat), a * 0.90);
  }
`;

const GLOW_FRAGMENT = /* glsl */`
  uniform float uStrength;
  varying vec2 vUv;
  void main() {
    vec2 d = vUv - 0.5;
    float r = length(d) * 2.0;
    float falloff = pow(clamp(1.0 - r, 0.0, 1.0), 2.4);
    if (falloff < 0.004) discard;
    gl_FragColor = vec4(vec3(1.0, 0.36, 0.07) * falloff * uStrength, falloff * uStrength);
  }
`;

// Sparks: all motion is computed from time in the vertex shader, so there is nothing to update per particle.
const SPARK_VERTEX = /* glsl */`
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uScale;
  uniform float uStrength;
  varying float vLife;
  varying float vTwinkle;
  void main() {
    float life = 1.6 + aSeed.x * 1.8;
    float t = fract(uTime / life + aSeed.y);
    float id = floor(uTime / life + aSeed.y);
    float r1 = fract(sin((aSeed.z + id) * 91.7) * 4375.5);
    float r2 = fract(sin((aSeed.w + id) * 53.3) * 9871.3);
    vec2 start = (vec2(r1, r2) - 0.5) * 0.30;
    float rise = 0.5 + aSeed.x * 0.9;
    vec3 local = vec3(start.x, 0.12 + rise * t * 1.6 - 0.35 * t * t, start.y);
    local.x += sin(uTime * 2.3 + aSeed.z * 20.0) * 0.12 * t + 0.10 * t * (r2 - 0.5);
    local.z += cos(uTime * 1.9 + aSeed.w * 20.0) * 0.12 * t;
    vec4 mv = modelViewMatrix * vec4(local, 1.0);
    gl_Position = projectionMatrix * mv;
    vLife = t;
    vTwinkle = 0.6 + 0.4 * sin(uTime * 17.0 + aSeed.z * 40.0);
    gl_PointSize = uScale * (0.030 + 0.020 * aSeed.x) * (1.0 - t * 0.7) * uStrength / max(-mv.z, 0.2);
  }
`;

const SPARK_FRAGMENT = /* glsl */`
  varying float vLife;
  varying float vTwinkle;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    float core = 1.0 - r;
    float fade = (1.0 - vLife) * smoothstep(0.0, 0.06, vLife);
    vec3 colour = mix(vec3(1.0, 0.25, 0.03), vec3(1.0, 0.75, 0.25), 1.0 - vLife);
    gl_FragColor = vec4(colour * core * fade * vTwinkle * 1.6, core * fade);
  }
`;


// Smoke: soft round puffs that rise from the top of the flame, lean downwind, grow and fade. Like the
// sparks, all motion is computed from time in the vertex shader.
const SMOKE_VERTEX = /* glsl */`
  attribute vec4 aSeed; // x: life, y: phase, z: size, w: swirl
  uniform float uTime;
  uniform float uGrow;
  uniform vec2 uWind;
  uniform float uHeight;
  varying vec2 vUv;
  varying float vPhase;
  varying float vSeed;
  varying float vNear;
  void main() {
    float life = 4.4 + aSeed.x * 3.2;
    float t = uTime / life + aSeed.y;
    float phase = fract(t);
    float cycle = floor(t);
    float r = fract(sin((aSeed.z + cycle) * 43.7) * 9371.3);
    vec3 centre = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float rise = phase * uHeight * mix(0.4, 1.0, uGrow);
    vec3 drift = vec3(uWind.x, 0.0, uWind.y) * (phase * phase * 2.2 + phase * 0.3);
    float swirl = sin(uTime * 0.7 + aSeed.w * 20.0 + phase * 4.0) * 0.14 * phase;
    vec3 world = centre + vec3(0.0, 0.55 + rise, 0.0) + drift + vec3(swirl, 0.0, -swirl * 0.7)
      + vec3(r - 0.5, 0.0, fract(r * 7.3) - 0.5) * 0.14;
    vec4 mv = viewMatrix * vec4(world, 1.0);
    float size = mix(0.20, 1.05, sqrt(phase)) * (0.8 + 0.4 * aSeed.z);
    mv.xy += position.xy * size * 0.5;
    gl_Position = projectionMatrix * mv;
    vUv = position.xy;
    vPhase = phase;
    vSeed = aSeed.z + cycle * 0.37;
    vNear = smoothstep(0.35, 1.4, -mv.z);
  }
`;

const SMOKE_FRAGMENT = /* glsl */`
  uniform float uTime;
  uniform float uStrength;
  uniform float uDay;
  varying vec2 vUv;
  varying float vPhase;
  varying float vSeed;
  varying float vNear;
  ${NOISE_GLSL}
  void main() {
    float d = length(vUv);
    if (d > 1.0) discard;
    float n = fbm(vUv * 1.7 + vec2(vSeed * 13.1, vSeed * 7.7) + vec2(0.0, -uTime * 0.12));
    float body = 1.0 - smoothstep(0.22, 1.0, d + (n - 0.5) * 0.75);
    float a = body * smoothstep(0.0, 0.10, vPhase) * (1.0 - smoothstep(0.42, 1.0, vPhase)) * uStrength * vNear * 0.36;
    if (a < 0.008) discard;
    float low = 1.0 - smoothstep(0.0, 0.55, vPhase); // near the fire
    vec3 dayColour = mix(vec3(0.24, 0.23, 0.22), vec3(0.64, 0.62, 0.59), smoothstep(0.0, 0.6, vPhase) * (0.6 + 0.4 * n));
    // At night the smoke is only seen where the fire lights it from below.
    vec3 nightColour = vec3(0.012, 0.014, 0.020) + vec3(0.90, 0.34, 0.08) * low * low * 0.5 * (0.6 + 0.4 * n);
    gl_FragColor = vec4(mix(nightColour, dayColour, uDay), a);
  }
`;

// Layers: size (width, height) in metres, offset from the anchor, noise seed and scroll speed.
const FLAME_LAYERS = [
  { size: [0.80, 1.20], offset: [0.00, 0.00], seed: 1.7, speed: 1.00 },
  { size: [0.60, 0.95], offset: [0.12, 0.08], seed: 5.3, speed: 1.25 },
  { size: [0.56, 0.88], offset: [-0.11, -0.09], seed: 9.1, speed: 0.90 },
  { size: [0.88, 0.62], offset: [0.02, -0.12], seed: 13.6, speed: 1.50 },
];
const SPARK_COUNT = 36;
const SMOKE_COUNT = 14;

export function createFireEffect({ spark = true, smoke = true } = {}) {
  const group = new THREE.Group();
  group.name = 'Campfire flame';

  const planeGeometry = new THREE.PlaneGeometry(1, 1);
  planeGeometry.translate(0, 0.5, 0);

  const flames = FLAME_LAYERS.map(layer => {
    const material = new THREE.ShaderMaterial({
      name: 'Campfire flame layer',
      uniforms: {
        uTime: { value: 0 }, uStrength: { value: 1 }, uSeed: { value: layer.seed }, uSpeed: { value: layer.speed },
        uSize: { value: new THREE.Vector2(...layer.size) }, uGrow: { value: 1 },
      },
      vertexShader: FLAME_VERTEX,
      fragmentShader: FLAME_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(planeGeometry, material);
    mesh.position.set(layer.offset[0], 0, layer.offset[1]);
    mesh.frustumCulled = false;
    mesh.renderOrder = 20;
    mesh.name = 'Flame layer';
    group.add(mesh);
    return material;
  });

  // Heat glow: a soft orange disc billboard low in the fire, so the air around it glows.
  const glowMaterial = new THREE.ShaderMaterial({
    name: 'Campfire heat glow',
    uniforms: { uStrength: { value: 0.5 }, uSize: { value: new THREE.Vector2(2.4, 2.4) }, uGrow: { value: 1 } },
    vertexShader: /* glsl */`
      uniform vec2 uSize;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 centre = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 world = centre + right * (position.x * uSize.x) + up * (position.y * uSize.y);
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: GLOW_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const glowGeometry = new THREE.PlaneGeometry(1, 1);
  const glow = new THREE.Mesh(glowGeometry, glowMaterial);
  glow.position.y = 0.32;
  glow.frustumCulled = false;
  glow.renderOrder = 19;
  glow.name = 'Heat glow';
  group.add(glow);

  let sparkMaterial = null, sparkGeometry = null;
  if (spark) {
    sparkGeometry = new THREE.BufferGeometry();
    const seeds = new Float32Array(SPARK_COUNT * 4);
    for (let i = 0; i < SPARK_COUNT; i++) {
      // fixed pseudo-random numbers: the same sparks every time, spread over the cycle
      seeds[i * 4] = (Math.sin(i * 12.9898) * 43758.5453) % 1 * 0.5 + 0.5;
      seeds[i * 4 + 1] = i / SPARK_COUNT;
      seeds[i * 4 + 2] = (Math.sin(i * 78.233 + 1.3) * 12345.678) % 1 * 0.5 + 0.5;
      seeds[i * 4 + 3] = (Math.sin(i * 39.346 + 2.1) * 24681.357) % 1 * 0.5 + 0.5;
    }
    sparkGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARK_COUNT * 3), 3));
    sparkGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    sparkMaterial = new THREE.ShaderMaterial({
      name: 'Campfire sparks',
      uniforms: { uTime: { value: 0 }, uScale: { value: 900 }, uStrength: { value: 1 } },
      vertexShader: SPARK_VERTEX,
      fragmentShader: SPARK_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const points = new THREE.Points(sparkGeometry, sparkMaterial);
    points.frustumCulled = false;
    points.renderOrder = 21;
    points.name = 'Sparks';
    group.add(points);
  }

  let smokeMaterial = null, smokeGeometry = null;
  if (smoke) {
    smokeGeometry = new THREE.InstancedBufferGeometry();
    smokeGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    smokeGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(SMOKE_COUNT * 4);
    for (let i = 0; i < SMOKE_COUNT; i++) {
      seeds[i * 4] = ((Math.sin(i * 17.31 + 0.7) * 43758.5453) % 1 + 1) % 1;
      seeds[i * 4 + 1] = i / SMOKE_COUNT; // spread evenly over the cycle
      seeds[i * 4 + 2] = ((Math.sin(i * 51.77 + 2.9) * 24634.6345) % 1 + 1) % 1;
      seeds[i * 4 + 3] = ((Math.sin(i * 7.13 + 4.2) * 12345.6789) % 1 + 1) % 1;
    }
    smokeGeometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    smokeGeometry.instanceCount = SMOKE_COUNT;
    smokeMaterial = new THREE.ShaderMaterial({
      name: 'Campfire smoke',
      uniforms: {
        uTime: { value: 0 }, uStrength: { value: 1 }, uGrow: { value: 1 }, uDay: { value: 0 },
        uWind: { value: new THREE.Vector2(...WIND_SAND.wind).normalize() }, uHeight: { value: 2.5 },
      },
      vertexShader: SMOKE_VERTEX,
      fragmentShader: SMOKE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const plume = new THREE.Mesh(smokeGeometry, smokeMaterial);
    plume.frustumCulled = false;
    plume.renderOrder = 18;
    plume.name = 'Smoke';
    group.add(plume);
  }

  // time in seconds, strength 0..1.1 (flicker already applied), grow 0..1 (fade-in), day 0..1 (night to day)
  function update(time, strength = 1, grow = 1, day = 0) {
    for (const material of flames) {
      material.uniforms.uTime.value = time;
      material.uniforms.uStrength.value = strength * grow;
      material.uniforms.uGrow.value = grow;
    }
    glowMaterial.uniforms.uStrength.value = 0.30 * strength * grow;
    if (sparkMaterial) {
      sparkMaterial.uniforms.uTime.value = time;
      sparkMaterial.uniforms.uStrength.value = grow;
    }
    if (smokeMaterial) {
      smokeMaterial.uniforms.uTime.value = time;
      smokeMaterial.uniforms.uStrength.value = Math.min(1, strength) * grow;
      smokeMaterial.uniforms.uGrow.value = grow;
      smokeMaterial.uniforms.uDay.value = day;
    }
  }

  function dispose() {
    planeGeometry.dispose(); glowGeometry.dispose(); sparkGeometry?.dispose(); smokeGeometry?.dispose();
    for (const material of flames) material.dispose();
    glowMaterial.dispose(); sparkMaterial?.dispose(); smokeMaterial?.dispose();
  }

  return { group, update, dispose, flames, glow: glowMaterial, sparks: sparkMaterial, smoke: smokeMaterial };
}
