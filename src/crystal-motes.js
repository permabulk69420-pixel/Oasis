import * as THREE from 'three';
import { heightOf, footprintOf } from './desert-finds.js';
import { mulberry32 } from './find-shapes.js';
import { WIND, WIND_GLSL, windTime, windStrength } from './wind.js';

// Motes of light that lift off the crystal fields at night: a few tiny violet (now and then cyan) specks per crystal that rise from its shards,
// wander a little, lean downwind with the gusts and fade out, then start again. They are what makes a field of crystals look alive from a long
// way off (a slow shimmer above the glow halo), and a reason to walk over and look. Nothing about them affects play.
//
// Cost: one Points draw for every crystal in the world. The motion is all in the vertex shader (the CPU only sets a clock and, when a crystal is
// broken or grows back, that crystal's motes fade out or in), so there is no per-frame allocation and nothing to cull.
//
// This module also holds the layout, which is pure (no scene, no browser), so tests can check it.

export const MOTES = Object.freeze({
  seed: 7719,
  perNode: Object.freeze({ cluster: 10, fan: 8, spike: 12 }), // motes rising from one crystal, before it is scaled
  cyanShare: 0.2, // like the odd cyan shard among the violet ones (src/find-shapes.js)
  rise: Object.freeze([1.4, 3.6]), // metres a mote climbs in its life, for a crystal of scale 1 (grows with the square root of the scale)
  cycle: Object.freeze([7, 14]), // seconds from leaving the crystal to fading out
  size: Object.freeze([0.08, 0.17]), // metres across (the soft edge makes them look about two thirds of that)
  startHeight: Object.freeze([0.3, 1.0]), // where on the crystal a mote leaves it, as a share of the crystal's height
  spreadShare: 0.8, // how far from the middle, as a share of the crystal's footprint
  fadeNear: 70, // metres: motes start to thin out with distance here...
  fadeFar: 150, // ...and are gone here (they would only be shimmering specks, and the halo shows the field from further away)
  pointPixels: Object.freeze([2.2, 14]), // a mote is never drawn smaller or bigger than this, in pixels
  violet: Object.freeze([0.74, 0.55, 1.0]),
  cyan: Object.freeze([0.45, 0.92, 1.0]),
  brightness: 1.3,
  nightFrom: 0.5, // the same daylight measure the crystal halos use (exposure from 0.5 down to 0.07): they come in together at dusk
  nightTo: 0.07,
});

const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - (1 - t) * (1 - t) * (1 - t);

// How much of a crystal is there for its motes to rise from: 1 standing, growing back as it grows, 0 while it is breaking or gone.
export function lifeOf(node) {
  if (node.state === 'idle') return 1;
  if (node.state === 'growing') return easeOut(THREE.MathUtils.clamp(node.grow ?? 0, 0, 1));
  return 0;
}

// Where every mote starts. `nodes` is the desert finds list; only the crystals get motes. Returns flat arrays (one entry per mote) and, for each
// crystal, where its motes are in them, so a broken crystal can fade just its own.
export function layoutMotes(nodes, { seed = MOTES.seed } = {}) {
  const rng = mulberry32(seed);
  const crystals = nodes.filter(node => node.kind === 'crystal');
  const countOf = node => MOTES.perNode[node.variant] ?? 6;
  const count = crystals.reduce((sum, node) => sum + countOf(node), 0);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const rises = new Float32Array(count);
  const sizes = new Float32Array(count);
  const cools = new Float32Array(count);
  const ranges = [];
  let at = 0;
  for (const node of crystals) {
    const n = countOf(node);
    const top = heightOf('crystal', node.variant) * node.scale;
    const reach = footprintOf('crystal', node.variant) * node.scale * MOTES.spreadShare;
    ranges.push({ node, start: at, count: n });
    for (let i = 0; i < n; i++, at++) {
      const angle = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * reach;
      positions[at * 3] = node.x + Math.cos(angle) * r;
      positions[at * 3 + 1] = node.y + top * lerp(MOTES.startHeight[0], MOTES.startHeight[1], rng());
      positions[at * 3 + 2] = node.z + Math.sin(angle) * r;
      seeds[at] = rng();
      rises[at] = lerp(MOTES.rise[0], MOTES.rise[1], rng()) * Math.sqrt(node.scale);
      sizes[at] = lerp(MOTES.size[0], MOTES.size[1], rng());
      cools[at] = rng() < MOTES.cyanShare ? 1 : 0;
    }
  }
  return { count, positions, seeds, rises, sizes, cools, ranges };
}

export function createCrystalMotes({ scene, nodes, getExposure = () => 0.035 }) {
  if (!scene) throw new Error('Crystal motes need the scene.');
  const layout = layoutMotes(nodes);
  const lives = new Float32Array(layout.count).fill(1);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(layout.positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(layout.seeds, 1));
  geometry.setAttribute('aRise', new THREE.BufferAttribute(layout.rises, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(layout.sizes, 1));
  geometry.setAttribute('aCool', new THREE.BufferAttribute(layout.cools, 1));
  const lifeAttribute = new THREE.BufferAttribute(lives, 1);
  lifeAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aLife', lifeAttribute);

  const uniforms = {
    uTime: { value: 0 },
    uNight: { value: 0 },
    uViewHeight: { value: 720 },
    uWind: { value: new THREE.Vector2(WIND.direction[0], WIND.direction[1]) },
    uWindTime: windTime,
    uWindStrength: windStrength,
  };

  const material = new THREE.ShaderMaterial({
    name: 'Crystal motes',
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    vertexShader: /* glsl */`
      ${WIND_GLSL}
      attribute float aSeed;
      attribute float aRise;
      attribute float aSize;
      attribute float aCool;
      attribute float aLife;
      uniform float uTime;
      uniform float uNight;
      uniform float uViewHeight;
      uniform vec2 uWind;
      uniform float uWindTime;
      uniform float uWindStrength;
      varying float vAlpha;
      varying float vCool;

      void main() {
        float cycle = ${MOTES.cycle[0].toFixed(2)} + aSeed * ${(MOTES.cycle[1] - MOTES.cycle[0]).toFixed(2)};
        float t = fract(uTime / cycle + aSeed * 13.7);
        float gust = windGust(position.xz, uWind, uWindTime) * uWindStrength;

        vec3 p = position;
        p.y += aRise * t * (0.6 + 0.4 * t);
        float lean = t * (0.5 + 1.6 * gust) * aRise * 0.35;
        p.x += sin(uTime * 0.37 + aSeed * 41.0) * 0.30 * t + uWind.x * lean;
        p.z += cos(uTime * 0.31 + aSeed * 27.0) * 0.30 * t + uWind.y * lean;

        float twinkle = 0.7 + 0.3 * sin(uTime * (2.3 + aSeed * 3.1) + aSeed * 61.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = max(-mv.z, 1.0);
        float fade = smoothstep(0.0, 0.14, t) * (1.0 - smoothstep(0.45, 1.0, t));
        vAlpha = uNight * aLife * fade * twinkle * (1.0 - smoothstep(${MOTES.fadeNear.toFixed(1)}, ${MOTES.fadeFar.toFixed(1)}, dist));
        vCool = aCool;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSize * 0.5 * uViewHeight * projectionMatrix[1][1] / dist, ${MOTES.pointPixels[0].toFixed(2)}, ${MOTES.pointPixels[1].toFixed(2)});
      }
    `,
    fragmentShader: /* glsl */`
      varying float vAlpha;
      varying float vCool;

      void main() {
        float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
        if (radius >= 1.0 || vAlpha <= 0.003) discard;
        float halo = pow(1.0 - radius, 1.6);
        float core = 1.0 - smoothstep(0.0, 0.34, radius);
        vec3 colour = mix(vec3(${MOTES.violet.map(v => v.toFixed(3)).join(', ')}), vec3(${MOTES.cyan.map(v => v.toFixed(3)).join(', ')}), vCool);
        colour = mix(colour, vec3(1.0), core * 0.55);
        gl_FragColor = vec4(colour, (halo * 0.35 + core * 0.65) * vAlpha * ${MOTES.brightness.toFixed(2)});
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'Crystal motes';
  points.visible = false;
  points.frustumCulled = false; // the motes are spread across the whole world; each one fades with distance in the shader
  points.renderOrder = 12;
  scene.add(points);

  let elapsed = 0;
  let changed = false;

  // dt: seconds since the last frame. viewHeight: how many pixels tall one eye's picture is (a mote is a fixed size in the world, so it needs it).
  function update(dt = 0, viewHeight = 720) {
    if (Number.isFinite(dt) && dt > 0) elapsed = (elapsed + dt) % 100000;
    uniforms.uTime.value = elapsed;
    uniforms.uViewHeight.value = Math.max(1, viewHeight);
    // A crystal that was broken, or is growing back, takes its motes with it.
    for (const range of layout.ranges) {
      const life = lifeOf(range.node);
      if (Math.abs(lives[range.start] - life) < 0.004) continue;
      lives.fill(life, range.start, range.start + range.count);
      changed = true;
    }
    if (changed) { lifeAttribute.needsUpdate = true; changed = false; }
    const night = 1 - THREE.MathUtils.smoothstep(getExposure(), MOTES.nightTo, MOTES.nightFrom);
    uniforms.uNight.value = night;
    points.visible = night > 0.01 && layout.count > 0;
  }

  function dispose() {
    scene.remove(points);
    geometry.dispose();
    material.dispose();
  }

  return { points, update, dispose, count: layout.count, layout };
}
