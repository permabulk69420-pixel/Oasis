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

// The exact text the torch code in src/torch.js hooks into in the terrain and water shaders (src/materials.js). If a shader edit changes one
// of these lines the torch light silently stops reaching the sand or the water (it did once, 5 Oct), so a test checks materials.js still has them.
export const TORCH_SHADER_MARKERS = Object.freeze({
  terrain: Object.freeze({
    uniform: 'uniform float uGrassTileMetres;',
    light: 'vec3 light = ambient + sunColour() * sun;',
  }),
  water: Object.freeze({
    uniform: 'uniform sampler2D uElevation;',
    colour: 'vec3 color = mix(transmission, reflectedColor, fresnel);',
  }),
});

// The terrain's shader material, found through the scene. Every sand tile and the distant mountains share one material, so any of them will do.
// The torch and the campfire both used to look for a tile called 'sand-0-0'; the 4 km quadtree (#107) names tiles by size and place, so that
// lookup came back empty and neither light reached the ground (Kane noticed on 5 Oct). Never look a tile up by its exact name.
export function findTerrainMesh(scene) {
  let found = null;
  scene.traverse(object => {
    if (!found && object.isMesh && object.material && typeof object.name === 'string'
      && (object.name.startsWith('sand-') || object.name === 'Distant mountains')) found = object;
  });
  return found;
}

// The lit torch, shared by everything that lights itself from it: the terrain and water shaders (src/torch.js injects
// their own loop) and, through this file, every standard material (grass, ferns, palms, hands, tools). The torch
// updates both fields every frame; strength 0 means no lit torch. World-space position, in metres.
export const torchGlow = {
  position: { value: new THREE.Vector3(0, -1000, 0) },
  strength: { value: 0 },
};

export const NIGHT_FILL = Object.freeze({
  // Linear light added after tone mapping, scaled by the surface colour (same as the terrain's fill).
  colour: [0.0026, 0.0039, 0.0070],
  // Added at grazing angles regardless of the surface colour, so dark silhouettes still separate from the sky.
  rim: [0.0060, 0.0095, 0.0170],
});

// Warm torch light on the lit materials. The scene's point light is physically scaled, so at night exposure (about 0.035)
// it comes out near black, which is why the sand and water have their own boosted torch term. This is the same idea
// for everything else, added after tone mapping so exposure does not crush it. `gain` scales the surface colour,
// `floor` lights even a very dark surface a little (light bounces), `near` and `far` are the fade distances in metres.
export const TORCH_GLOW = Object.freeze({
  colour: [1.0, 0.34, 0.09],
  gain: 0.7,
  floor: 0.075,
  near: 0.8,
  far: 12.0,
});

const fmt = ([r, g, b]) => `vec3(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)})`;
const num = value => value.toFixed(4);

export const NIGHT_FILL_UNIFORM = 'uniform float uNightFill;\nuniform vec3 uTorchPosition;\nuniform float uTorchStrength;';
export const NIGHT_FILL_CODE = /* glsl */`
  {
    vec3 nightNormal = normalize(normal);
    float moonUp = max(inverseTransformDirection(nightNormal, viewMatrix).y, 0.0);
    // abs: a leaf card seen from its back (its normal is not flipped, see patchFoliage in island-flora.js) used to read as full rim, a flat pale wash over every leaf
    float rim = pow(1.0 - clamp(abs(dot(nightNormal, normalize(vViewPosition))), 0.0, 1.0), 2.6);
    gl_FragColor.rgb += (diffuseColor.rgb * ${fmt(NIGHT_FILL.colour)} * (0.55 + 0.45 * moonUp)
      + ${fmt(NIGHT_FILL.rim)} * rim) * uNightFill;
    if (uTorchStrength > 0.001) {
      // the pixel's world position: the view-space offset turned back into world axes (not inverseTransformDirection, which normalises)
      vec3 torchFragment = cameraPosition + (vec4(-vViewPosition, 0.0) * viewMatrix).xyz;
      vec3 toTorch = uTorchPosition - torchFragment;
      float torchDistance = length(toTorch);
      vec3 torchDirection = toTorch / max(torchDistance, 0.001);
      float torchFade = 1.0 - smoothstep(${num(TORCH_GLOW.near)}, ${num(TORCH_GLOW.far)}, torchDistance);
      torchFade *= torchFade; // a bright pool near the flame that falls away quickly
      // wrapped, so blades and leaves that face away from the flame still catch some of it
      float torchFacing = 0.5 + 0.5 * dot(inverseTransformDirection(nightNormal, viewMatrix), torchDirection);
      gl_FragColor.rgb += (diffuseColor.rgb * ${num(TORCH_GLOW.gain)} + ${num(TORCH_GLOW.floor)})
        * ${fmt(TORCH_GLOW.colour)} * (torchFade * torchFacing * uTorchStrength * uNightFill);
    }
  }`;

// Adds the uniforms and the fill to a standard/physical/lambert fragment shader (the object three passes to
// onBeforeCompile). Returns false, leaving the shader alone, if it is not one of those or is already patched.
export function patchNightFill(shader, uniform = nightFill) {
  const source = shader?.fragmentShader;
  if (typeof source !== 'string' || source.includes('uNightFill')) return false;
  if (!source.includes('#include <common>') || !source.includes('#include <tonemapping_fragment>')) return false;
  // needs the surface colour and the shading normal (a basic material has neither lighting nor a normal)
  if (!source.includes('diffuseColor') || !source.includes('#include <normal_fragment_begin>')) return false;
  shader.uniforms.uNightFill = uniform;
  shader.uniforms.uTorchPosition = torchGlow.position;
  shader.uniforms.uTorchStrength = torchGlow.strength;
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
