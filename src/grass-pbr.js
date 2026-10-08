import * as THREE from 'three';

// Non-metallic GGX/Smith/Schlick shading and the split-sum environment BRDF
// used by Three's physical materials. Sample the world's existing PMREM map;
// albedo and normal/roughness/AO use their original, separate colour spaces.
export const GRASS_PBR_GLSL = /* glsl */`
  uniform sampler2D uGrassSkyMap;
  uniform vec2 uGrassSkyTexel;
  uniform float uGrassSkyMaxMip;
  uniform float uGrassSkyStrength;
  uniform float uHasGrassSky;
  uniform vec3 uGrassSunRadiance;
  #define ENVMAP_TYPE_CUBE_UV
  ${THREE.ShaderChunk.cube_uv_reflection_fragment
    .replaceAll('CUBEUV_MAX_MIP', 'uGrassSkyMaxMip')
    .replaceAll('CUBEUV_TEXEL_WIDTH', 'uGrassSkyTexel.x')
    .replaceAll('CUBEUV_TEXEL_HEIGHT', 'uGrassSkyTexel.y')}

  vec3 grassPbrNormal(vec2 packedXY) {
    vec2 xy = packedXY * 2.0 - 1.0;
    return normalize(vec3(xy, sqrt(max(1.0 - dot(xy, xy), 0.0001))));
  }

  vec3 grassPbrDirect(vec3 albedo, float roughness, vec3 normal, vec3 viewDir, vec3 lightDir) {
    float dotNL = max(dot(normal, lightDir), 0.0);
    float dotNV = max(dot(normal, viewDir), 0.0);
    vec3 halfDir = normalize(lightDir + viewDir);
    float dotNH = max(dot(normal, halfDir), 0.0);
    float dotVH = max(dot(viewDir, halfDir), 0.0);
    float alpha = max(roughness * roughness, 0.00275625);
    float a2 = alpha * alpha;
    float gv = dotNL * sqrt(a2 + (1.0 - a2) * dotNV * dotNV);
    float gl = dotNV * sqrt(a2 + (1.0 - a2) * dotNL * dotNL);
    float visibility = 0.5 / max(gv + gl, 0.000001);
    float denominator = dotNH * dotNH * (a2 - 1.0) + 1.0;
    float distribution = a2 / (3.14159265 * denominator * denominator);
    float fresnel = exp2((-5.55473 * dotVH - 6.98316) * dotVH);
    vec3 F = vec3(0.04) * (1.0 - fresnel) + vec3(fresnel);
    return (albedo * (vec3(1.0) - F) / 3.14159265 + F * visibility * distribution) * dotNL;
  }

  vec3 grassPbrIndirect(vec3 albedo, float roughness, float ao, vec3 normal, vec3 viewDir) {
    float dotNV = max(dot(normal, viewDir), 0.0);
    vec4 r = roughness * vec4(-1.0, -0.0275, -0.572, 0.022) + vec4(1.0, 0.0425, 1.04, -0.04);
    float a004 = min(r.x * r.x, exp2(-9.28 * dotNV)) * r.x + r.y;
    vec2 fab = vec2(-1.04, 1.04) * a004 + r.zw;
    vec3 singleScattering = vec3(0.04) * fab.x + vec3(fab.y);
    float missingEnergy = 1.0 - (fab.x + fab.y);
    vec3 averageFresnel = vec3(0.04 + 0.96 / 21.0);
    vec3 multiScattering = singleScattering * averageFresnel / (vec3(1.0) - missingEnergy * averageFresnel) * missingEnergy;
    vec3 totalScattering = singleScattering + multiScattering;
    vec3 diffuse = albedo * (1.0 - max(max(totalScattering.r, totalScattering.g), totalScattering.b));
    vec3 reflection = normalize(mix(reflect(-viewDir, normal), normal, roughness * roughness));
    vec3 radiance = textureCubeUV(uGrassSkyMap, reflection, roughness).rgb * uGrassSkyStrength;
    vec3 diffuseSky = textureCubeUV(uGrassSkyMap, normal, 1.0).rgb * uGrassSkyStrength;
    float specularAO = clamp(pow(dotNV + ao, exp2(-16.0 * roughness - 1.0)) - 1.0 + ao, 0.0, 1.0);
    return radiance * singleScattering * specularAO + diffuseSky * (diffuse + multiScattering) * ao;
  }
`;

// Use the same scene lighting in desktop and XR. Three supplies cameraPosition
// separately for each XR eye, so the BRDF and relief follow the headset pose.
export function updateGrassPBRLighting(material, skyEnvironment, dayNight) {
  const u = material.uniforms;
  const sun = dayNight.lights.sunlight;
  u.uGrassSunRadiance.value.set(sun.color.r, sun.color.g, sun.color.b).multiplyScalar(sun.intensity);
  const texture = skyEnvironment.texture;
  const image = texture?.image;
  const ready = Boolean(texture && image?.width > 0 && image?.height > 0);
  u.uHasGrassSky.value = ready ? 1 : 0;
  u.uGrassSkyStrength.value = skyEnvironment.strength;
  if (ready) {
    u.uGrassSkyMap.value = texture;
    u.uGrassSkyTexel.value.set(1 / image.width, 1 / image.height);
    u.uGrassSkyMaxMip.value = Math.log2(image.height / 4);
  }
}
