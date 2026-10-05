import * as THREE from 'three';
import { mulberry32 } from './find-shapes.js';
import { WIND, WIND_GLSL, windTime, windStrength } from './wind.js';

// Two kinds of drifting light for the island (the owner's brief for the overnight run: "seed puffs drifting near the meadow", and a passive glow-fly or two at the lake).
//   seed puffs  soft, pale, fine-rayed puffs that lift off the big pale night flowers, rise a little and drift downwind across the open ground, then fade; by day
//               they are pale ivory, at night they glow the oasis's pale cyan
//   glow-flies  a couple of dozen cyan-white lights that hover and loop over the lake's shallows at night, each pulsing slowly like a firefly
// Cost: two Points draws. All the motion is in the vertex shader (the CPU only sets a clock), so there is no per-frame allocation and nothing to cull. The layouts are
// pure (no scene, no browser), so tests can check them. Nothing about them affects play.

export const ISLAND_MOTES = Object.freeze({
  seed: 0x15ab07,
  puffs: Object.freeze({
    perFlower: 4,                         // puffs rising off one flower head
    leave: Object.freeze([1.15, 1.6]),    // metres above the ground where a puff leaves, times the flower's scale
    drift: Object.freeze([16, 38]),       // metres downwind over its life
    rise: Object.freeze([1.4, 3.8]),      // metres it climbs on the way (then it settles a little)
    cycle: Object.freeze([18, 40]),       // seconds from leaving the flower to fading out
    size: Object.freeze([0.15, 0.28]),    // metres across, with the soft edge
    pixels: Object.freeze([3.5, 28]),     // never drawn smaller or bigger than this, in pixels
    fadeNear: 45, fadeFar: 120,           // metres: thinned out from here, gone by there
    day: 0.62, night: 1.0,                // brightness by day and by night
    dayColour: Object.freeze([0.95, 0.96, 0.9]),
    nightColour: Object.freeze([0.5, 0.86, 1.0]),
  }),
  flies: Object.freeze({
    count: 26,
    height: Object.freeze([0.45, 2.1]),   // metres above the water
    inland: -2.5,                         // how far past the shore (metres, negative = on land) a fly may hover
    clearance: 0.5,                       // metres a fly keeps above the ground under it (the bank rises past the water), before its loop's own dip
    reach: Object.freeze([0.8, 2.6]),     // the size of the loop it flies
    rate: Object.freeze([0.14, 0.42]),    // radians a second
    pulse: Object.freeze([0.25, 0.7]),    // pulses a second
    size: Object.freeze([0.05, 0.085]),   // metres across
    pixels: Object.freeze([2.2, 9]),
    fadeNear: 40, fadeFar: 95,
    colour: Object.freeze([0.5, 0.9, 1.0]),
    brightness: 1.2,
  }),
  nightFrom: 0.5,                         // the same daylight measure the crystal motes and halos use (exposure from 0.5 down to 0.07)
  nightTo: 0.07,
});

const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------------------------------------------------------------------ layouts
// Where every puff starts: on a flower head. `flowers` is a list of flora items ({ x, y, z, scale }); returns flat arrays, one entry per puff.
export function layoutSeedPuffs(flowers, { seed = ISLAND_MOTES.seed, spec = ISLAND_MOTES.puffs } = {}) {
  const random = mulberry32(seed);
  const count = flowers.length * spec.perFlower;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const drifts = new Float32Array(count);
  const rises = new Float32Array(count);
  const sizes = new Float32Array(count);
  let at = 0;
  for (const flower of flowers) {
    for (let k = 0; k < spec.perFlower; k++, at++) {
      const angle = random() * Math.PI * 2, r = Math.sqrt(random()) * 0.35 * flower.scale;
      positions[at * 3] = flower.x + Math.cos(angle) * r;
      positions[at * 3 + 1] = flower.y + lerp(spec.leave[0], spec.leave[1], random()) * flower.scale;
      positions[at * 3 + 2] = flower.z + Math.sin(angle) * r;
      seeds[at] = random();
      drifts[at] = lerp(spec.drift[0], spec.drift[1], random());
      rises[at] = lerp(spec.rise[0], spec.rise[1], random());
      sizes[at] = lerp(spec.size[0], spec.size[1], random());
    }
  }
  return { count, positions, seeds, drifts, rises, sizes };
}

// Where the glow-flies hover: over the lake's shallows and a little way onto its banks. `lake` is the island's lake (signed distance to the shore, positive in
// the water, plus its outline and local frame); `level` is the water's height in world metres; `ground(x, z)` (optional) keeps a fly off the bank it hovers over.
export function layoutGlowFlies(lake, level, { seed = ISLAND_MOTES.seed + 1, spec = ISLAND_MOTES.flies, ground = null } = {}) {
  const random = mulberry32(seed);
  const count = spec.count;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const reaches = new Float32Array(count);
  const rates = new Float32Array(count);
  const pulses = new Float32Array(count);
  const sizes = new Float32Array(count);
  const { minX, maxX, minZ, maxZ } = lake.bounds;
  let at = 0;
  // spread over the lake by rejection from its bounding box, then pushed apart: each fly keeps at least 4 m from the ones before it where it can
  for (let guard = 0; at < count && guard < 20000; guard++) {
    const x = lerp(minX, maxX, random()), z = lerp(minZ, maxZ, random());
    const s = lake.signed(x, z);
    if (s < spec.inland) continue;
    let close = false;
    for (let i = 0; i < at; i++) if (Math.hypot(positions[i * 3] - x, positions[i * 3 + 2] - z) < (guard < 12000 ? 4 : 1.5)) { close = true; break; }
    if (close) continue;
    const height = lerp(spec.height[0], spec.height[1], random());
    seeds[at] = random();
    reaches[at] = lerp(spec.reach[0], spec.reach[1], random());
    const under = ground ? ground(x, z) : null;
    positions[at * 3] = x;
    positions[at * 3 + 1] = Math.max(level + height, under === null ? -Infinity : under + spec.clearance + 0.22 * reaches[at]);
    positions[at * 3 + 2] = z;
    rates[at] = lerp(spec.rate[0], spec.rate[1], random());
    pulses[at] = lerp(spec.pulse[0], spec.pulse[1], random());
    sizes[at] = lerp(spec.size[0], spec.size[1], random());
    at++;
  }
  return { count: at, positions: positions.slice(0, at * 3), seeds: seeds.slice(0, at), reaches: reaches.slice(0, at), rates: rates.slice(0, at), pulses: pulses.slice(0, at), sizes: sizes.slice(0, at) };
}

// 0 in daylight, 1 in the dark (exposure falls from nightFrom to nightTo).
export function nightAmount(exposure) {
  return 1 - THREE.MathUtils.smoothstep(exposure, ISLAND_MOTES.nightTo, ISLAND_MOTES.nightFrom);
}

// ------------------------------------------------------------------------------------------------------------------------------ the draw
const f = n => n.toFixed(3);
const v3 = c => c.map(f).join(', ');

function pointsFor(name, geometry, material, renderOrder) {
  const points = new THREE.Points(geometry, material);
  points.name = name;
  points.visible = false;
  points.frustumCulled = false;       // spread over the island; each one fades with distance in the shader
  points.renderOrder = renderOrder;
  return points;
}

function attribute(geometry, name, array, size = 1) {
  geometry.setAttribute(name, new THREE.BufferAttribute(array, size));
}

export function createIslandMotes({ flowers = [], lake = null, level = 0, ground = null, getExposure = () => 0.035, anchor = null } = {}) {
  const group = new THREE.Group();
  group.name = 'Island motes';
  const wind = new THREE.Vector2(WIND.direction[0], WIND.direction[1]).normalize();
  const P = ISLAND_MOTES.puffs, F = ISLAND_MOTES.flies;
  const shared = {
    uTime: { value: 0 },
    uNight: { value: 0 },
    uViewHeight: { value: 720 },
    uWind: { value: wind },
    uWindTime: windTime,
    uWindStrength: windStrength,
  };

  // ---- seed puffs
  const puffLayout = layoutSeedPuffs(flowers);
  const puffGeometry = new THREE.BufferGeometry();
  attribute(puffGeometry, 'position', puffLayout.positions, 3);
  attribute(puffGeometry, 'aSeed', puffLayout.seeds);
  attribute(puffGeometry, 'aDrift', puffLayout.drifts);
  attribute(puffGeometry, 'aRise', puffLayout.rises);
  attribute(puffGeometry, 'aSize', puffLayout.sizes);
  const puffMaterial = new THREE.ShaderMaterial({
    name: 'Island seed puffs',
    uniforms: shared,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: /* glsl */`
      ${WIND_GLSL}
      attribute float aSeed;
      attribute float aDrift;
      attribute float aRise;
      attribute float aSize;
      uniform float uTime;
      uniform float uNight;
      uniform float uViewHeight;
      uniform vec2 uWind;
      uniform float uWindTime;
      uniform float uWindStrength;
      varying float vAlpha;
      varying float vSeed;

      void main() {
        float cycle = ${f(P.cycle[0])} + aSeed * ${f(P.cycle[1] - P.cycle[0])};
        float t = fract(uTime / cycle + aSeed * 13.7);
        float gust = windGust(position.xz, uWind, uWindTime) * uWindStrength;
        vec3 p = position;
        float travel = aDrift * t * (0.55 + 0.45 * t) * (0.75 + 0.5 * gust);
        vec2 across = vec2(-uWind.y, uWind.x);
        p.xz += uWind * travel + across * sin(t * 5.0 + aSeed * 31.0) * (0.5 + 1.8 * t);
        p.y += aRise * sin(t * 2.2) + 0.16 * sin(uTime * 0.9 + aSeed * 40.0);

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = max(-mv.z, 1.0);
        float fade = smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.66, 1.0, t));
        float twinkle = 0.82 + 0.18 * sin(uTime * (1.3 + aSeed * 1.7) + aSeed * 50.0);
        vAlpha = fade * twinkle * mix(${f(P.day)}, ${f(P.night)}, uNight) * (1.0 - smoothstep(${f(P.fadeNear)}, ${f(P.fadeFar)}, dist));
        vSeed = aSeed;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSize * 0.5 * uViewHeight * projectionMatrix[1][1] / dist, ${f(P.pixels[0])}, ${f(P.pixels[1])});
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uNight;
      uniform float uTime;
      varying float vAlpha;
      varying float vSeed;

      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        float radius = length(d) * 2.0;
        if (radius >= 1.0 || vAlpha <= 0.003) discard;
        float angle = atan(d.y, d.x) + vSeed * 6.2832 + uTime * 0.22 * (vSeed - 0.5);
        float rays = pow(abs(cos(angle * 3.5)), 14.0) * (1.0 - radius) * 0.65;
        float halo = pow(1.0 - radius, 2.2) * 0.3;
        float core = 1.0 - smoothstep(0.0, 0.2, radius);
        vec3 colour = mix(vec3(${v3(P.dayColour)}), vec3(${v3(P.nightColour)}), uNight);
        colour = mix(colour, vec3(1.0), core * 0.5);
        gl_FragColor = vec4(colour, (halo + rays + core * 0.7) * vAlpha);
      }
    `,
  });
  const puffs = pointsFor('Island seed puffs', puffGeometry, puffMaterial, 11);
  if (puffLayout.count > 0) group.add(puffs);

  // ---- glow-flies
  const flyLayout = lake ? layoutGlowFlies(lake, level, { ground }) : { count: 0, positions: new Float32Array(0), seeds: new Float32Array(0), reaches: new Float32Array(0), rates: new Float32Array(0), pulses: new Float32Array(0), sizes: new Float32Array(0) };
  const flyGeometry = new THREE.BufferGeometry();
  attribute(flyGeometry, 'position', flyLayout.positions, 3);
  attribute(flyGeometry, 'aSeed', flyLayout.seeds);
  attribute(flyGeometry, 'aReach', flyLayout.reaches);
  attribute(flyGeometry, 'aRate', flyLayout.rates);
  attribute(flyGeometry, 'aPulse', flyLayout.pulses);
  attribute(flyGeometry, 'aSize', flyLayout.sizes);
  const flyMaterial = new THREE.ShaderMaterial({
    name: 'Island glow-flies',
    uniforms: shared,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: /* glsl */`
      attribute float aSeed;
      attribute float aReach;
      attribute float aRate;
      attribute float aPulse;
      attribute float aSize;
      uniform float uTime;
      uniform float uNight;
      uniform float uViewHeight;
      varying float vAlpha;

      void main() {
        float phase = aSeed * 61.0;
        vec3 p = position;
        p.x += sin(uTime * aRate + phase) * aReach + sin(uTime * aRate * 2.3 + phase * 1.7) * aReach * 0.25;
        p.z += cos(uTime * aRate * 1.13 + phase * 1.31) * aReach + cos(uTime * aRate * 2.9 + phase) * aReach * 0.2;
        p.y += sin(uTime * aRate * 1.7 + phase * 0.73) * aReach * 0.22;

        float pulse = 0.5 + 0.5 * sin(uTime * aPulse * 6.2832 + phase * 2.4);
        pulse = smoothstep(0.2, 0.95, pulse);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = max(-mv.z, 1.0);
        vAlpha = uNight * (0.15 + 0.85 * pulse) * (1.0 - smoothstep(${f(F.fadeNear)}, ${f(F.fadeFar)}, dist));
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSize * 0.5 * uViewHeight * projectionMatrix[1][1] / dist, ${f(F.pixels[0])}, ${f(F.pixels[1])});
      }
    `,
    fragmentShader: /* glsl */`
      varying float vAlpha;

      void main() {
        float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
        if (radius >= 1.0 || vAlpha <= 0.003) discard;
        float halo = pow(1.0 - radius, 1.7);
        float core = 1.0 - smoothstep(0.0, 0.3, radius);
        vec3 colour = mix(vec3(${v3(F.colour)}), vec3(1.0), core * 0.6);
        gl_FragColor = vec4(colour, (halo * 0.38 + core * 0.62) * vAlpha * ${f(F.brightness)});
      }
    `,
  });
  const flies = pointsFor('Island glow-flies', flyGeometry, flyMaterial, 12);
  if (flyLayout.count > 0) group.add(flies);

  let elapsed = 0, away = false;

  // dt: seconds since the last frame. viewHeight: pixels tall one eye's picture is (a mote is a fixed size in the world, so it needs it).
  function update(head, dt = 0, viewHeight = 720) {
    if (anchor && head && Math.hypot(head.x - anchor.x, head.z - anchor.z) > anchor.distance) {
      if (!away) { away = true; group.visible = false; }
      return;
    }
    if (away) { away = false; group.visible = true; }
    if (Number.isFinite(dt) && dt > 0) elapsed = (elapsed + dt) % 100000;
    shared.uTime.value = elapsed;
    shared.uViewHeight.value = Math.max(1, viewHeight);
    const night = nightAmount(getExposure());
    shared.uNight.value = night;
    puffs.visible = puffLayout.count > 0;
    flies.visible = flyLayout.count > 0 && night > 0.01;
  }

  function dispose() {
    group.removeFromParent();
    for (const g of [puffGeometry, flyGeometry]) g.dispose();
    for (const m of [puffMaterial, flyMaterial]) m.dispose();
  }

  return { group, update, dispose, puffs, flies, puffLayout, flyLayout };
}
