import * as THREE from 'three';

// Faint moonlight on the lit (PBR) objects: props, trees, hands and tools.
//
// At night the tone-mapping exposure is tiny, so anything lit only by scene lights goes pure black. The
// terrain, sky and water add a faint blue fill AFTER tone mapping to stay readable; this gives the standard
// materials the same: a little of their own colour, plus a thin cool rim where the surface turns away from
// you, so a cold campfire, a tree or your own hands read as shapes instead of holes. It is a few
// instructions per pixel and fades to nothing by day.

// 0 by day, 1 at full night. The day/night cycle sets it every frame.
export const nightFill = { value: 0 };

export const NIGHT_FILL = Object.freeze({
  // Linear light added after tone mapping, scaled by the surface colour (same as the terrain's fill).
  colour: [0.0026, 0.0039, 0.0070],
  // Added at grazing angles regardless of the surface colour, so dark silhouettes still separate from the sky.
  rim: [0.0060, 0.0095, 0.0170],
});

const fmt = ([r, g, b]) => `vec3(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)})`;

export const NIGHT_FILL_UNIFORM = 'uniform float uNightFill;';
export const NIGHT_FILL_CODE = /* glsl */`
  {
    vec3 nightNormal = normalize(normal);
    float moonUp = max(inverseTransformDirection(nightNormal, viewMatrix).y, 0.0);
    float rim = pow(1.0 - clamp(dot(nightNormal, normalize(vViewPosition)), 0.0, 1.0), 2.6);
    gl_FragColor.rgb += (diffuseColor.rgb * ${fmt(NIGHT_FILL.colour)} * (0.55 + 0.45 * moonUp)
      + ${fmt(NIGHT_FILL.rim)} * rim) * uNightFill;
  }`;

// Adds the uniform and the fill to a standard/physical/lambert fragment shader (the object three passes to
// onBeforeCompile). Returns false, leaving the shader alone, if it is not one of those or is already patched.
export function patchNightFill(shader, uniform = nightFill) {
  const source = shader?.fragmentShader;
  if (typeof source !== 'string' || source.includes('uNightFill')) return false;
  if (!source.includes('#include <common>') || !source.includes('#include <tonemapping_fragment>')) return false;
  // needs the surface colour and the shading normal (a basic material has neither lighting nor a normal)
  if (!source.includes('diffuseColor') || !source.includes('#include <normal_fragment_begin>')) return false;
  shader.uniforms.uNightFill = uniform;
  shader.fragmentShader = source
    .replace('#include <common>', () => `#include <common>\n${NIGHT_FILL_UNIFORM}`)
    .replace('#include <tonemapping_fragment>', () => `#include <tonemapping_fragment>${NIGHT_FILL_CODE}`);
  return true;
}

const PATCHED = Symbol.for('oasis.nightFill');

// Patches the built-in material types once, before anything compiles. A material that sets its own
// onBeforeCompile keeps its own and does not get the fill unless it chains to the original first, which
// is what addWindSway (wind.js) does, so swaying plants get both.
export function installNightFill(types = [THREE.MeshStandardMaterial, THREE.MeshPhysicalMaterial, THREE.MeshLambertMaterial]) {
  for (const type of types) {
    const proto = type.prototype;
    if (Object.prototype.hasOwnProperty.call(proto, PATCHED)) continue;
    const original = proto.onBeforeCompile;
    proto.onBeforeCompile = function onBeforeCompileWithNightFill(shader, renderer) {
      original?.call(this, shader, renderer);
      patchNightFill(shader);
    };
    Object.defineProperty(proto, PATCHED, { value: true });
  }
}
