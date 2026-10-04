import * as THREE from 'three';
import { WIND, WIND_GLSL } from './wind.js';

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
  wind: WIND.direction, // x, z: the direction the dunes were built for (see terrainHeight)
  layers: Object.freeze({
    // Close in, where grains cross your feet and are big enough to see: a small box with plenty of them.
    near: Object.freeze({
      radius: 8, // metres: the box around the player; grains fade out toward its edge
      count: 380,
      speed: [1.9, 4.6],
      length: [0.05, 0.20],
      width: [0.004, 0.010],
      height: 0.50, // the highest grains rise this far above the ground
      hop: 0.07, // how far a grain bounces
      alpha: 0.32,
      near: [0.35, 1.1], // fades out this close to the eye
      round: 0.0, // 0 = a thin line, 1 = a round puff when seen end-on
      crest: 0.6, // extra lift and density on dune crests
      haze: 0.0, // 0 = sand coloured, 1 = pale dust haze
      soft: 1.1,
      seed: 20261002,
    }),
    streaks: Object.freeze({
      radius: 26,
      count: 320,
      speed: [1.7, 4.8],
      length: [0.10, 0.40],
      width: [0.006, 0.015],
      height: 0.70,
      hop: 0.10,
      alpha: 0.30,
      near: [0.5, 1.6],
      round: 0.0,
      crest: 0.9,
      haze: 0.1,
      soft: 1.15,
      seed: 20261003,
    }),
    // Soft veils hugging the ground and spilling over the crests: the part you see at a glance. Thick and patchy,
    // so they read as drifting plumes of sand and not as thin bright bars (see breakup).
    veils: Object.freeze({
      radius: 24,
      count: 300,
      speed: [2.2, 4.4],
      length: [1.4, 3.6],
      width: [0.30, 0.80],
      height: 0.42,
      hop: 0.0,
      alpha: 0.30,
      near: [1.5, 4.0],
      round: 0.7,
      crest: 1.4,
      haze: 0.25,
      breakup: 0.7, // 0 = a smooth sheet, 1 = broken up into patches that drift along it
      soft: 1.4,
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
      round: 0.9,
      crest: 1.6,
      haze: 0.55,
      breakup: 0.5,
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
  uniform float uRound;
  uniform float uCrest;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vTone;
  varying float vSeed;
  varying vec3 vWorld;
  ${WIND_GLSL}

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

    // A slow wave of stronger wind rolls across the dunes (the plants lean into the same gusts: wind.js).
    float gust = windGust(xz, uWind, uTime);

    // Sand lifts off where the ground turns over: a dune crest.
    float ground = groundAt(xz);
    float turning = groundAt(xz + uWind * 5.0) + groundAt(xz - uWind * 5.0) - 2.0 * ground;
    float crest = smoothstep(0.08, 0.9, -turning) * uCrest;

    float hop = abs(sin(uTime * (1.8 + 3.2 * aSeedB.z) + aSeedB.z * 61.0));
    float rise = 0.03 + pow(aSeedA.z, 2.2) * uHeight * (0.45 + 0.55 * gust) * (1.0 + 1.3 * crest) + hop * hop * uHop;
    vec3 world = vec3(xz.x, ground + rise, xz.y);
    vWorld = world;

    // The streak is a line in the world along the wind: project both of its ends, so it points the way real
    // perspective says it should (toward the vanishing point of the wind), then draw a quad around that line.
    vec4 mv = viewMatrix * vec4(world, 1.0);
    float depth = max(-mv.z, 0.05);
    vec3 windView = mat3(viewMatrix) * vec3(uWind.x, 0.0, uWind.y);
    float len = (uLength.x + uLength.y * aSeedB.x) * (0.75 + 0.5 * gust);
    float wid = uWidth.x + uWidth.y * aSeedB.y;
    // keep both ends in front of the camera
    float reach = abs(windView.z) > 0.001 ? (depth - 0.08) / abs(windView.z) : 10000.0;
    float halfLen = min(len * 0.5, max(reach, 0.0));
    vec4 clipA = projectionMatrix * vec4(mv.xyz - windView * halfLen, 1.0);
    vec4 clipB = projectionMatrix * vec4(mv.xyz + windView * halfLen, 1.0);
    vec4 clipC = projectionMatrix * mv;
    float aspect = projectionMatrix[1][1] / projectionMatrix[0][0];
    vec2 ndcA = clipA.xy / clipA.w;
    vec2 ndcB = clipB.xy / clipB.w;
    vec2 along = vec2((ndcB.x - ndcA.x) * aspect, ndcB.y - ndcA.y); // on screen, with square units
    float screenLen = length(along);
    vec2 dir = screenLen > 1e-6 ? along / screenLen : vec2(1.0, 0.0);
    float pixel = 2.0 / uViewHeight; // one pixel, in the same units
    float widthNdc = wid * projectionMatrix[1][1] / depth;
    float shownWid = max(widthNdc, pixel * 1.2);
    float shownLen = max(max(screenLen, pixel * 1.6), shownWid * uRound);
    vec2 offset = dir * (position.x * 0.5 * shownLen) + vec2(-dir.y, dir.x) * (position.y * 0.5 * shownWid);
    vec2 ndc = clipC.xy / clipC.w + vec2(offset.x / aspect, offset.y);
    gl_Position = vec4(ndc * clipC.w, clipC.z, clipC.w);
    vUv = position.xy;

    float edge = 1.0 - smoothstep(uRadius * 0.5, uRadius, length(rel));
    float nearFade = smoothstep(uNear.x, uNear.y, depth);
    float pond = length((xz - uWater.xz) / uWaterRadii);
    float calm = mix(0.10, 1.0, smoothstep(1.15, 2.6, pond));
    float dry = smoothstep(0.05, 0.5, ground - uWater.y);
    float thin = clamp(widthNdc / shownWid, 0.0, 1.0) * clamp(screenLen / shownLen, 0.0, 1.0);
    vAlpha = uGain * uAlpha * (0.45 + 0.55 * aSeedB.w) * (0.3 + 0.7 * gust) * (1.0 + 0.8 * crest)
      * edge * nearFade * calm * dry * thin;
    vTone = aSeedB.w;
    vSeed = fract(aSeedB.z * 7.31 + aSeedA.x * 3.17);
  }
`;

const FRAGMENT = /* glsl */`
  uniform vec3 uSun;
  uniform float uSoft;
  uniform float uHaze;
  uniform float uBreakup;
  uniform float uTime;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vTone;
  varying float vSeed;
  varying vec3 vWorld;

  // Value noise from a hash without sin(), so it is the same on every GPU.
  float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  void main() {
    float shape = (1.0 - vUv.x * vUv.x) * (1.0 - vUv.y * vUv.y);
    shape = pow(max(shape, 0.0), uSoft);
    shape *= 0.55 + 0.45 * (0.5 + 0.5 * vUv.x); // a little brighter at the leading end
    float a = shape * vAlpha;
    if (uBreakup > 0.0) {
      // Patches of denser and thinner sand, stretched along the wind and sliding down it, so a veil or a cloud is a
      // wisp with ragged edges and not a smooth bar.
      vec2 q = vec2(vUv.x * 1.3 - uTime * 0.25, vUv.y * 0.8) + vSeed * 41.0;
      float n = 0.65 * valueNoise(q * vec2(2.2, 1.4)) + 0.35 * valueNoise(q * vec2(5.5, 3.2) + 7.1);
      a *= mix(1.0, mix(0.30, 1.0, smoothstep(0.15, 0.90, n)), uBreakup); // thinner, never a hole
    }
    if (a < 0.004) discard;

    float day = smoothstep(-0.07, 0.16, uSun.y);
    vec3 ray = normalize(vWorld - cameraPosition);
    float backlit = pow(max(dot(ray, uSun), 0.0), 4.0); // dust glows when the sun is behind it
    vec3 sand = mix(vec3(0.80, 0.58, 0.35), vec3(0.96, 0.82, 0.60), vTone); // a little paler than the ground
    sand = mix(sand, vec3(0.88, 0.72, 0.52), uHaze); // big soft clouds are paler and greyer: dust haze
    vec3 ambient = mix(vec3(0.006, 0.009, 0.015), vec3(0.28, 0.34, 0.42), day);
    vec3 sun = vec3(1.23, 1.09, 0.86) * (0.55 + 0.9 * backlit) * day;
    // a few grains catch the light and flash
    float glint = smoothstep(0.86, 1.0, vTone) * (0.5 + 0.5 * sin(uTime * 13.0 + vWorld.x * 7.0 + vWorld.z * 3.0));
    // hazy layers are a touch darker, so a veil is the colour of the sand it drifts over and not a cream stripe
    float lift = mix(1.15, 0.92, smoothstep(0.0, 0.4, uHaze));
    gl_FragColor = vec4(sand * (ambient + sun) * (lift + 1.3 * glint * (1.0 - uHaze) * day), min(1.0, a * (1.0 + 0.8 * glint)));
    #include <tonemapping_fragment>
    // Faint moonlit dust at night, added after tone mapping like the terrain's own fill.
    gl_FragColor.rgb += sand * vec3(0.0060, 0.0090, 0.0165) * (1.0 - day);
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
      uRound: { value: layer.round },
      uCrest: { value: layer.crest },
      uSoft: { value: layer.soft },
      uHaze: { value: layer.haze },
      uBreakup: { value: layer.breakup ?? 0 },
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
