import * as THREE from 'three';

// Wind-blown sand: the desert's constant, quiet motion.
//
// Four layers of camera-facing quads, all moved on the GPU from a single time uniform (no per-frame
// JavaScript per particle, no allocation):
//   near:    grains skimming past your feet in short hops, stretched along the wind,
//   streaks: the same further out,
//   veils:   long, soft, low sheets of sand hugging the ground and spilling over the crests,
//   wisps:   a few big, very soft clouds of dust rolling past.
// Each layer lives in a box that follows the player and wraps around, so the density never changes.
// The wind blows along the dunes (the same direction the sand ripples are drawn), gusts sweep across
// the land as slow waves, and sand lifts off the dune crests a little more. Near the oasis the air is
// calm, and nothing blows over the pond. Heights come from the same elevation texture the water uses.

export const WIND_SAND = Object.freeze({
  wind: [0.84, 0.54], // x, z: the direction the dunes were built for (see terrainHeight)
  layers: Object.freeze({
    // Close in, where grains cross your feet and are big enough to see: a small box with plenty of them.
    near: Object.freeze({
      radius: 8, // metres: the box around the player; grains fade out toward its edge
      count: 520,
      speed: [1.9, 4.6],
      length: [0.18, 0.70],
      width: [0.008, 0.018],
      height: 0.50, // the highest grains rise this far above the ground
      hop: 0.07, // how far a grain bounces
      alpha: 0.90,
      near: [0.35, 1.1], // fades out this close to the eye
      foreshorten: 0.22, // how short a streak looks when it points at you
      crest: 0.6, // extra lift and density on dune crests
      haze: 0.0, // 0 = sand coloured, 1 = pale dust haze
      soft: 1.1,
      seed: 20261002,
    }),
    streaks: Object.freeze({
      radius: 26,
      count: 700,
      speed: [1.7, 4.8],
      length: [0.40, 1.40],
      width: [0.010, 0.025],
      height: 0.70,
      hop: 0.10,
      alpha: 0.80,
      near: [0.5, 1.6],
      foreshorten: 0.22,
      crest: 0.9,
      haze: 0.1,
      soft: 1.15,
      seed: 20261003,
    }),
    // Soft veils hugging the ground and spilling over the crests: the part you see at a glance.
    veils: Object.freeze({
      radius: 24,
      count: 170,
      speed: [2.2, 4.4],
      length: [1.6, 4.5],
      width: [0.16, 0.42],
      height: 0.55,
      hop: 0.0,
      alpha: 0.45,
      near: [1.5, 4.0],
      foreshorten: 0.40,
      crest: 1.4,
      haze: 0.35,
      soft: 1.3,
      seed: 20261005,
    }),
    // Big, very soft clouds of dust rolling past.
    wisps: Object.freeze({
      radius: 34,
      count: 30,
      speed: [0.9, 1.7],
      length: [3.0, 7.0],
      width: [1.2, 2.4],
      height: 1.2,
      hop: 0.0,
      alpha: 0.16,
      near: [2.5, 7.0],
      foreshorten: 0.55,
      crest: 1.6,
      haze: 0.55,
      soft: 1.8,
      seed: 20261004,
    }),
  }),
  // Pixels tall that one eye renders in VR, used to keep thin grains from shimmering (desktop uses its canvas).
  vrViewHeight: 2000,
});

// Small seeded generator so the layout is the same every run (and testable).
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Random numbers for each particle, packed as two vec4 attributes. All values are in [0, 1).
export function createWindSandSeeds(count, seed = 1) {
  const random = mulberry32(seed);
  const a = new Float32Array(count * 4);
  const b = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i++) { a[i] = random(); b[i] = random(); }
  return { a, b };
}

const VERTEX = /* glsl */`
  attribute vec4 aSeedA; // x, z: place in the box, y: height, w: speed
  attribute vec4 aSeedB; // x: length, y: width, z: hop phase, w: brightness
  uniform float uTime;
  uniform vec3 uCenter;
  uniform vec2 uWind;
  uniform float uRadius;
  uniform float uGain;
  uniform sampler2D uElevation;
  uniform float uViewHeight;
  uniform vec3 uWater;
  uniform vec2 uWaterRadii;
  uniform vec2 uSpeed;
  uniform vec2 uLength;
  uniform vec2 uWidth;
  uniform vec2 uNear;
  uniform float uHeight;
  uniform float uHop;
  uniform float uAlpha;
  uniform float uFore;
  uniform float uCrest;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vTone;
  varying vec3 vWorld;

  float groundAt(vec2 p) {
    vec2 rg = texture2D(uElevation, ((p + 500.0) / 1000.0 * 512.0 + 0.5) / 513.0).rg;
    return dot(rg, vec2(256.0, 1.0)) * (255.0 * 64.0 / 65535.0);
  }

  void main() {
    float box = uRadius * 2.0;
    float speed = uSpeed.x + uSpeed.y * aSeedA.w;
    vec2 start = aSeedA.xy * box;
    vec2 rel = mod(start + uWind * speed * uTime - uCenter.xz + uRadius, box) - uRadius;
    vec2 xz = uCenter.xz + rel;

    // A slow wave of stronger wind rolls across the dunes.
    vec2 side = vec2(-uWind.y, uWind.x);
    float gust = 0.5 + 0.5 * sin(dot(xz, uWind) * 0.045 - uTime * 0.85 + 1.8 * sin(dot(xz, side) * 0.028 + uTime * 0.11));
    gust = gust * gust * (3.0 - 2.0 * gust);

    // Sand lifts off where the ground turns over: a dune crest.
    float ground = groundAt(xz);
    float turning = groundAt(xz + uWind * 5.0) + groundAt(xz - uWind * 5.0) - 2.0 * ground;
    float crest = smoothstep(0.08, 0.9, -turning) * uCrest;

    float hop = abs(sin(uTime * (1.8 + 3.2 * aSeedB.z) + aSeedB.z * 61.0));
    float rise = 0.03 + pow(aSeedA.z, 2.2) * uHeight * (0.45 + 0.55 * gust) * (1.0 + 1.3 * crest) + hop * hop * uHop;
    vec3 world = vec3(xz.x, ground + rise, xz.y);
    vWorld = world;

    // Camera-facing quad stretched along the wind as it appears on screen.
    vec4 mv = viewMatrix * vec4(world, 1.0);
    float depth = max(-mv.z, 0.05);
    vec3 windView = mat3(viewMatrix) * vec3(uWind.x, 0.0, uWind.y);
    float across = length(windView.xy);
    vec2 dir = across > 0.001 ? windView.xy / across : vec2(1.0, 0.0);
    float pixel = depth * 2.0 / (projectionMatrix[1][1] * uViewHeight);
    float len = (uLength.x + uLength.y * aSeedB.x) * (0.75 + 0.5 * gust);
    float wid = uWidth.x + uWidth.y * aSeedB.y;
    float shownLen = max(len * mix(uFore, 1.0, across / max(length(windView), 0.001)), pixel * 1.6);
    float shownWid = max(wid, pixel * 1.2);
    mv.xy += dir * position.x * shownLen * 0.5 + vec2(-dir.y, dir.x) * position.y * shownWid * 0.5;
    gl_Position = projectionMatrix * mv;
    vUv = position.xy;

    float edge = 1.0 - smoothstep(uRadius * 0.5, uRadius, length(rel));
    float nearFade = smoothstep(uNear.x, uNear.y, depth);
    float pond = length((xz - uWater.xz) / uWaterRadii);
    float calm = mix(0.10, 1.0, smoothstep(1.15, 2.6, pond));
    float dry = smoothstep(0.05, 0.5, ground - uWater.y);
    float thin = clamp(wid / shownWid, 0.0, 1.0);
    vAlpha = uGain * uAlpha * (0.45 + 0.55 * aSeedB.w) * (0.3 + 0.7 * gust) * (1.0 + 0.8 * crest)
      * edge * nearFade * calm * dry * thin;
    vTone = aSeedB.w;
  }
`;

const FRAGMENT = /* glsl */`
  uniform vec3 uSun;
  uniform float uSoft;
  uniform float uHaze;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vTone;
  varying vec3 vWorld;
  void main() {
    float shape = (1.0 - vUv.x * vUv.x) * (1.0 - vUv.y * vUv.y);
    shape = pow(max(shape, 0.0), uSoft);
    shape *= 0.55 + 0.45 * (0.5 + 0.5 * vUv.x); // a little brighter at the leading end
    float a = shape * vAlpha;
    if (a < 0.004) discard;

    float day = smoothstep(-0.07, 0.16, uSun.y);
    vec3 ray = normalize(vWorld - cameraPosition);
    float backlit = pow(max(dot(ray, uSun), 0.0), 4.0); // dust glows when the sun is behind it
    vec3 sand = mix(vec3(0.84, 0.62, 0.38), vec3(1.0, 0.90, 0.68), vTone); // paler than the ground so it shows
    sand = mix(sand, vec3(0.93, 0.82, 0.66), uHaze); // big soft clouds are paler and greyer: dust haze
    vec3 ambient = mix(vec3(0.006, 0.009, 0.015), vec3(0.28, 0.34, 0.42), day);
    vec3 sun = vec3(1.23, 1.09, 0.86) * (0.55 + 0.9 * backlit) * day;
    gl_FragColor = vec4(sand * (ambient + sun) * 1.3, a);
    #include <tonemapping_fragment>
    // Faint moonlit dust at night, added after tone mapping like the terrain's own fill.
    gl_FragColor.rgb += sand * vec3(0.0110, 0.0165, 0.0300) * (1.0 - day);
    #include <colorspace_fragment>
  }
`;

function buildLayer(name, layer, shared, center) {
  const { a, b } = createWindSandSeeds(layer.count, layer.seed);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute('aSeedA', new THREE.InstancedBufferAttribute(a, 4));
  geometry.setAttribute('aSeedB', new THREE.InstancedBufferAttribute(b, 4));
  geometry.instanceCount = layer.count;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uCenter: { value: center },
      uRadius: { value: layer.radius },
      uSpeed: { value: new THREE.Vector2(...layer.speed) },
      uLength: { value: new THREE.Vector2(layer.length[0], layer.length[1] - layer.length[0]) },
      uWidth: { value: new THREE.Vector2(layer.width[0], layer.width[1] - layer.width[0]) },
      uNear: { value: new THREE.Vector2(...layer.near) },
      uHeight: { value: layer.height },
      uHop: { value: layer.hop },
      uAlpha: { value: layer.alpha },
      uFore: { value: layer.foreshorten },
      uCrest: { value: layer.crest },
      uSoft: { value: layer.soft },
      uHaze: { value: layer.haze },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
    const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `Wind sand ${name}`;
  mesh.frustumCulled = false; // positions are computed in the vertex shader
  mesh.renderOrder = name === 'wisps' ? 3 : name === 'veils' ? 4 : 5; // fine grains on top of the soft clouds
  return mesh;
}

// uniforms: shared uniform objects { uSun, uWater, uWaterRadii, uElevation } from the terrain and water
// materials, so the sun, the pond and the height data stay in step without copying.
export function createWindSand({ scene, uniforms, layers = WIND_SAND.layers } = {}) {
  if (!scene) throw new Error('Wind sand needs the scene.');
  for (const key of ['uSun', 'uWater', 'uWaterRadii', 'uElevation']) {
    if (!uniforms?.[key]) throw new Error(`Wind sand needs the ${key} uniform.`);
  }
  const wind = new THREE.Vector2(...WIND_SAND.wind).normalize();
  const center = new THREE.Vector3();
  const shared = {
    uSun: uniforms.uSun,
    uWater: uniforms.uWater,
    uWaterRadii: uniforms.uWaterRadii,
    uElevation: uniforms.uElevation,
    uTime: { value: 0 },
    uWind: { value: wind },
    uGain: { value: 1 }, // overall strength; the dev build can turn it up with ?sandgain=
    uViewHeight: { value: 720 },
  };
  const group = new THREE.Group();
  group.name = 'Wind sand';
  const meshes = Object.entries(layers).map(([name, layer]) => buildLayer(name, layer, shared, center));
  meshes.forEach(mesh => group.add(mesh));
  group.renderOrder = 3;
  scene.add(group);

  return {
    group,
    meshes,
    uniforms: shared,
    count: meshes.reduce((total, mesh) => total + mesh.geometry.instanceCount, 0),
    // seconds: any steadily increasing clock. position: where the player is. viewHeight: pixels tall.
    update(seconds, position, viewHeight = 720) {
      shared.uTime.value = Number.isFinite(seconds) ? seconds % 3600 : 0;
      if (position) center.set(position.x, position.y, position.z);
      shared.uViewHeight.value = Math.max(1, viewHeight);
    },
    dispose() {
      for (const mesh of meshes) { mesh.geometry.dispose(); mesh.material.dispose(); }
      group.removeFromParent();
    },
  };
}
