import * as THREE from 'three';

// The wind: one direction and one clock for everything that moves with it. The sand and dust
// (wind-sand.js) and the campfire smoke use the direction; the sand and the plants below share the
// gusts, so when a gust rolls through you see the sand pick up and the grass lean at the same moment.
//
// Plants sway in the vertex shader from a single time uniform: no per-plant JavaScript, no
// allocation, no extra draw calls, and nothing for the CPU to update beyond one number a frame. Where a
// plant stands decides when the wind reaches it, so ripples travel across the grass and whole stands
// of ferns and trees lean together.

export const WIND = Object.freeze({
  direction: Object.freeze([0.84, 0.54]), // x, z: along the dunes (see terrainHeight)
});

// Seconds. main.js sets it every frame (the dev build can freeze it with ?windtime=).
export const windTime = { value: 0 };
// 1 is the everyday breeze. A storm could push it up; the dev build can exaggerate it with ?windgain=.
export const windStrength = { value: 1 };

// Plants that give way to you (Kane, 5 Oct): up to three points push the plants near them away, your feet and both hands. All of it is in the
// vertex shader, from this one uniform array (src/plant-push.js fills it every frame): xyz is a point in the world, w is how far it reaches
// in metres (0 switches that point off). Nothing is remembered, so a plant springs back as soon as you move off it.
//   feetRadius, handRadius: how far from your feet / a hand a plant starts to bend
//   reachPerRadius:         how far the tip of a plant is shoved at the very centre, as a fraction of the radius
//   feetHeight:             metres above the floor the feet point sits at
export const PUSH = Object.freeze({
  enabled: true,
  feetRadius: 0.62,
  handRadius: 0.42,
  reachPerRadius: 0.55,
  feetHeight: 0.12,
});
export const windPush = { value: [new THREE.Vector4(0, -1000, 0, 0), new THREE.Vector4(0, -1000, 0, 0), new THREE.Vector4(0, -1000, 0, 0)] };

// Shared GLSL. windGust is the same wave the sand uses: 0 in a lull, 1 in a gust, and it depends only
// on where you are and the time.
export const WIND_GLSL = /* glsl */`
  // A hash without sin() (sin of a big number is not reliable across GPUs); the same everywhere.
  float windHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  // A slow wave of stronger wind rolling across the dunes.
  float windGust(vec2 xz, vec2 wind, float t) {
    vec2 side = vec2(-wind.y, wind.x);
    float g = 0.5 + 0.5 * sin(dot(xz, wind) * 0.045 - t * 0.85 + 1.8 * sin(dot(xz, side) * 0.028 + t * 0.11));
    return g * g * (3.0 - 2.0 * g);
  }
`;

// How each kind of plant moves. Heights and distances are in the model's own units (a plant scaled 2x
// moves twice as far), measured from the origin of the mesh, which every model here has at its roots.
//   top:     the height at which the plant bends all the way
//   reach:   how far that point moves downwind in a strong gust, in metres
//   lean:    how much of that it keeps in a lull (0 to 1)
//   bend:    1 bends the whole plant evenly, higher saves the bending for the top
//   radial:  extra bend for points far from the stem, so fronds move more than the trunk they hang from
//   rate:    how quickly it swings; heavy things are slow
//   flutter: a quick tremble on top, in metres (leaves, blades)
//   shade:   how much the colour brightens and dims as the wind rolls over it (the grass field)
//   push:    how much it gives way to your feet and hands (0 or left out: not at all, 1: fully); see PUSH
export const SWAY = Object.freeze({
  grass: Object.freeze({ name: 'grass', top: 0.50, reach: 0.14, lean: 0.25, bend: 1.7, radial: 0.0, rate: 1.0, flutter: 0.010, shade: 0.09, push: 1 }),
  fern: Object.freeze({ name: 'fern', top: 1.34, reach: 0.13, lean: 0.25, bend: 1.5, radial: 0.45, rate: 0.9, flutter: 0.012, shade: 0.0, push: 1 }),
  reed: Object.freeze({ name: 'reed', top: 1.75, reach: 0.12, lean: 0.25, bend: 2.0, radial: 0.0, rate: 0.8, flutter: 0.008, shade: 0.0 }),
  plantStem: Object.freeze({ name: 'plant-stem', top: 3.1, reach: 0.08, lean: 0.30, bend: 2.0, radial: 0.0, rate: 0.55, flutter: 0.0, shade: 0.0, push: 0.35 }),
  plantLeaf: Object.freeze({ name: 'plant-leaf', top: 3.1, reach: 0.08, lean: 0.30, bend: 2.0, radial: 0.0, rate: 0.55, flutter: 0.012, shade: 0.0, push: 0.35 }),
  trunk: Object.freeze({ name: 'trunk', top: 4.4, reach: 0.10, lean: 0.30, bend: 2.0, radial: 0.0, rate: 0.5, flutter: 0.0, shade: 0.0 }),
  foliage: Object.freeze({ name: 'foliage', top: 4.4, reach: 0.10, lean: 0.30, bend: 2.0, radial: 0.0, rate: 0.5, flutter: 0.014, shade: 0.0 }),
});

// Where the wind rolls over the ground: a ripple about ten metres long, in radians per metre and
// radians per second.
const RIPPLE = Object.freeze({ wave: 0.62, speed: 1.9 });

const num = value => Number(value).toFixed(5);

// The GLSL for one kind of plant. windSway returns the move in world metres (x, y, z) and a brightness
// factor (w). `base` is where the plant stands (world), `local` the vertex in the model, `size` the
// plant's scale, and `upright` fades the sway out for a tree that is falling over.
export function windSwayGLSL(profile) {
  const [dx, dz] = new THREE.Vector2(...WIND.direction).normalize().toArray();
  const flutter = profile.flutter > 0 ? /* glsl */`
    float shake = t * 2.6 + dot(local, vec3(7.3, 5.1, 6.7)) + phase;
    float shakeWeight = smoothstep(0.0, 0.25, h) * size * upright * uWindStrength * ${num(profile.flutter)} * (0.25 + 0.75 * gust);
    vec3 tremble = vec3(sin(shake), 0.5 * sin(shake * 1.31 + 1.7), cos(shake * 0.87 + 0.6)) * shakeWeight;`
    : 'vec3 tremble = vec3(0.0);';
  const shade = profile.shade > 0
    ? `float shade = 1.0 + ${num(profile.shade)} * (0.6 * roll + gust - 0.5);`
    : 'float shade = 1.0;';
  const push = profile.push > 0 ? /* glsl */`
    uniform vec4 uWindPush[3];
    // Where you are (feet and hands) shoves this point away, more the higher up the plant it is. worldPos is the vertex in the world.
    vec3 windPush(vec3 worldPos, vec3 local, float size, float upright) {
      float h = clamp(local.y / ${num(profile.top)} + length(local.xz) * ${num(profile.radial)}, 0.0, 1.0);
      float weight = pow(h, ${num(profile.bend)}) * upright * ${num(profile.push)};
      vec2 shove = vec2(0.0);
      for (int i = 0; i < 3; i++) {
        vec4 p = uWindPush[i];
        if (p.w > 0.0) {
          vec3 d = worldPos - p.xyz;
          float dist = length(d);
          if (dist < p.w) {
            float f = 1.0 - smoothstep(0.0, p.w, dist);
            shove += d.xz / max(length(d.xz), 0.08) * (f * f * p.w * ${num(PUSH.reachPerRadius)});
          }
        }
      }
      vec2 move = shove * weight;
      float len = length(move);
      float droop = min(0.5 * len * len / max(${num(profile.top)} * size, 0.05), 0.5 * len);
      return vec3(move.x, -droop, move.y);
    }` : '';
  return /* glsl */`
    uniform float uWindTime;
    uniform float uWindStrength;
    ${push}
    ${WIND_GLSL}
    vec4 windSway(vec3 base, vec3 local, float size, float upright) {
      const vec2 dir = vec2(${num(dx)}, ${num(dz)});
      vec2 side = vec2(-dir.y, dir.x);
      float t = uWindTime * ${num(profile.rate)};
      float gust = windGust(base.xz, dir, uWindTime);
      // where the ripple has got to; every plant a little out of step with its neighbours
      float phase = dot(base.xz, dir) * ${num(RIPPLE.wave)} - t * ${num(RIPPLE.speed)} + windHash(base.xz) * 1.2;
      float roll = 0.65 * sin(phase) + 0.35 * sin(phase * 2.17 + 1.3);

      // how far up the plant this point is (and how far out from the stem, for fronds)
      float h = clamp(local.y / ${num(profile.top)} + length(local.xz) * ${num(profile.radial)}, 0.0, 1.0);
      float weight = pow(h, ${num(profile.bend)}) * size * upright * uWindStrength;

      // always pushed downwind, harder in a gust, with the ripple swinging it back and forth
      float lean = ${num(profile.lean)} + ${num(1 - profile.lean)} * gust;
      float along = ${num(profile.reach)} * (0.65 * lean + 0.55 * roll * (0.35 + 0.65 * gust));
      float across = ${num(profile.reach * 0.2)} * sin(phase * 0.71 + 2.0) * (0.3 + 0.7 * gust);
      vec2 push = (dir * along + side * across) * weight;
      // a stem that leans is no longer as tall: it arcs down a little, which matters once a storm turns the wind up
      float droop = 0.5 * dot(push, push) / max(${num(profile.top)} * size, 0.05);
      ${flutter}
      ${shade}
      return vec4(push.x + tremble.x, tremble.y - droop, push.y + tremble.z, shade);
    }
  `;
}

const MARKERS = ['#include <common>', '#include <begin_vertex>', '#include <project_vertex>'];

// Adds the sway to a standard/physical/lambert vertex shader (the object three passes to onBeforeCompile).
// Returns false, leaving the shader alone, if it is not one of those or is already patched.
export function patchWindSway(shader, profile) {
  const source = shader?.vertexShader;
  if (typeof source !== 'string' || source.includes('uWindTime')) return false;
  if (!MARKERS.every(marker => source.includes(marker))) return false;
  shader.uniforms.uWindTime = windTime;
  shader.uniforms.uWindStrength = windStrength;
  if (profile.push > 0) shader.uniforms.uWindPush = windPush;
  const colours = profile.shade > 0 ? /* glsl */`
    #if defined( USE_COLOR_ALPHA ) || defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
      vColor.rgb *= windMove.w;
    #endif` : '';
  const pushCode = profile.push > 0 ? /* glsl */`
      // and what you shove: the vertex's own place in the world, not the plant's root, so a patch of grass parts round your foot blade by blade
      vec3 windWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
      #ifdef USE_INSTANCING
        windWorld = ( modelMatrix * ( instanceMatrix * vec4( position, 1.0 ) ) ).xyz;
      #endif
      windMove.xyz += windPush( windWorld, position, windSize, windUpright );` : '';
  shader.vertexShader = source
    .replace('#include <common>', () => `#include <common>\n${windSwayGLSL(profile)}`)
    .replace('#include <begin_vertex>', () => /* glsl */`#include <begin_vertex>
      // where this plant stands: the instance, if there are many of them in one mesh
      vec3 windBase = modelMatrix[3].xyz;
      #ifdef USE_INSTANCING
        windBase = ( modelMatrix * vec4( instanceMatrix[3].xyz, 1.0 ) ).xyz;
      #endif
      float windSize = length( modelMatrix[1].xyz );
      float windUpright = smoothstep( 0.80, 0.95, modelMatrix[1].y / max( windSize, 0.0001 ) );
      vec4 windMove = windSway( windBase, position, windSize, windUpright );${colours}${pushCode}`)
    // after the position is projected: nudge it in the world's own directions, whatever the object's
    // rotation, scale or instance matrix
    .replace('#include <project_vertex>', () => /* glsl */`#include <project_vertex>
      mvPosition.xyz += mat3( viewMatrix ) * windMove.xyz;
      gl_Position = projectionMatrix * mvPosition;`);
  return true;
}

// Makes a material sway. Whatever the material would have compiled anyway (its own patch, or the night
// fill every standard material gets) still happens first.
export function addWindSway(material, profile) {
  if (!material || material.userData?.windSway) return material;
  const own = Object.prototype.hasOwnProperty.call(material, 'onBeforeCompile') ? material.onBeforeCompile : null;
  material.onBeforeCompile = function onBeforeCompileWithWindSway(shader, renderer) {
    const inherited = own ?? Object.getPrototypeOf(this).onBeforeCompile;
    inherited?.call(this, shader, renderer);
    patchWindSway(shader, profile);
  };
  // three shares compiled programs between materials with the same key: this one must not share with
  // the unpatched material, and each kind of plant has its own constants baked in.
  material.customProgramCacheKey = () => `oasis-wind-sway:${profile.name}`;
  material.userData.windSway = profile.name;
  material.needsUpdate = true;
  return material;
}

// Makes every material in a loaded model sway. `choose(material, mesh)` returns the profile for it (or
// nothing, to leave it still), usually by the material's name.
export function addWindSwayToModel(root, choose) {
  const seen = new Set();
  let count = 0;
  root.traverse(object => {
    if (!object.isMesh) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material || seen.has(material)) continue;
      seen.add(material);
      const profile = choose(material, object);
      if (!profile) continue;
      addWindSway(material, profile);
      count++;
    }
  });
  return count;
}
