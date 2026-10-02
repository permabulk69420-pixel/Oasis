import * as THREE from 'three';
import { atmosphere } from './materials.js';

// Rebuild the existing Oasis water material in-place. The mesh already carries a
// per-vertex `waterDepth` attribute derived from the terrain heightfield, so we keep
// that useful geometry/data and replace the old opaque/fake-bottom rendering model.
//
// The result is intentionally conventional for mobile VR:
// - centimetre-scale vertex waves
// - analytic ripple normals (no normal-map texture fetch)
// - depth-based tint/opacity over the real terrain beneath the pool
// - Fresnel reflection of the real sky, drifting clouds and nearby dunes
// - two scrolling ripple layers from the existing noise texture
// - a readable but fixed shoreline contact band
// - no planar reflection camera, SSR, FFT ocean, refraction render target or particles
export function installOasisWater(material, onError = console.warn) {
  if (!material?.isShaderMaterial) {
    onError('[Oasis water] Rebuilt water requires the Oasis ShaderMaterial.');
    return false;
  }
  if (material.userData.oasisWaterV2) return true;
  if (!material.uniforms?.uTime || !material.uniforms?.uSun || !material.uniforms?.uElevation
    || !material.uniforms?.uCloudMap || !material.uniforms?.uCloudTime) {
    onError('[Oasis water] Existing water uniforms are incomplete.');
    return false;
  }

  // Keep the old uElevation uniform declaration as a compatibility marker for the torch
  // integration. The rebuilt shader does not sample it; the real terrain renders below us.
  material.vertexShader = /* glsl */`
    uniform float uTime;
    attribute float waterDepth;
    varying vec3 vWorld;
    varying float vDepth;

    float surfaceWave(vec2 p, float time) {
      // Calm oasis water: broad overlapping wavelets, measured in centimetres.
      float a = sin(p.x * 0.34 + p.y * 0.19 - time * 0.82);
      float b = sin(p.x * -0.21 + p.y * 0.41 + time * 0.61 + 1.7);
      float c = sin(p.x * 0.53 + p.y * -0.27 - time * 0.47 + 3.1);

      // Keep the bank calm while allowing a few millimetres of genuine lapping at the
      // terrain intersection. Deeper water gets the full ~1.5 cm motion.
      float deep = smoothstep(0.05, 0.55, max(waterDepth, 0.0));
      float amplitude = mix(0.005, 0.015, deep);
      return (a * 0.52 + b * 0.31 + c * 0.17) * amplitude;
    }

    void main() {
      vec3 displaced = position;
      float wave = surfaceWave(position.xz, uTime);
      displaced.y += wave;

      // waterDepth is the still-water height minus terrain height. Adding the physical
      // surface displacement gives a useful approximation of instantaneous local depth.
      vDepth = waterDepth + wave;
      vWorld = displaced;
      gl_Position = projectionMatrix * viewMatrix * vec4(displaced, 1.0);
    }
  `;

  material.fragmentShader = /* glsl */`
    uniform float uTime;
    uniform sampler2D uElevation;
    varying vec3 vWorld;
    varying float vDepth;
    ${atmosphere}

    float groundAt(vec2 p) {
      vec2 rg = texture2D(uElevation, ((p + 500.0) / 1000.0 * 512.0 + 0.5) / 513.0).rg;
      return dot(rg, vec2(256.0, 1.0)) * (255.0 * 64.0 / 65535.0);
    }

    // The same sky the player sees above: gradient, sun halo and the drifting cloud layer.
    // Reflecting real clouds is what stops the pond reading as a flat grey sheet.
    vec3 skyWithClouds(vec3 ray, float daylight) {
      vec3 color = skyColor(ray);
      float horizonFade = smoothstep(0.045, 0.19, ray.y);
      if (horizonFade > 0.001) {
        float planeDistance = max(CLOUD_HEIGHT - vWorld.y, 1.0) / max(ray.y, 0.06);
        float rawCloud = skyCloudNoise(vWorld.xz + ray.xz * planeDistance);
        float cloud = smoothstep(0.49, 0.65, rawCloud) * horizonFade * 0.86;
        vec3 cloudColor = mix(vec3(0.005, 0.007, 0.012), vec3(0.90, 0.91, 0.89), daylight);
        cloudColor *= 1.0 - smoothstep(0.60, 0.74, rawCloud) * 0.17;
        color = mix(color, cloudColor, cloud * (0.32 + daylight * 0.46));
      }
      return color;
    }

    // Short height-field march so low reflections pick up the surrounding dunes and bank.
    vec3 environmentReflection(vec3 ray, float daylight) {
      if (ray.y < 0.22) {
        float d = 2.5;
        for (int i = 0; i < 6; i++) {
          vec3 point = vWorld + ray * d;
          if (max(abs(point.x), abs(point.z)) > 499.0) break;
          if (groundAt(point.xz) > point.y + 0.05) {
            float dx = groundAt(point.xz + vec2(2.0, 0.0)) - groundAt(point.xz - vec2(2.0, 0.0));
            float dz = groundAt(point.xz + vec2(0.0, 2.0)) - groundAt(point.xz - vec2(0.0, 2.0));
            vec3 n = normalize(vec3(-dx, 4.0, -dz));
            vec3 light = mix(vec3(0.008, 0.012, 0.020), vec3(0.28, 0.35, 0.43), daylight);
            light += vec3(1.23, 1.09, 0.86) * max(dot(n, uSun), 0.0) * daylight;
            return air(vec3(0.68, 0.46, 0.23) * light * 0.78, ray, d);
          }
          d *= 2.3;
        }
      }
      return skyWithClouds(ray, daylight);
    }

    void main() {
      // The terrain itself defines the bank; below it the real ground stays visible.
      if (vDepth <= 0.002) discard;

      float environmentDay = daylightLevel();
      vec3 toEye = cameraPosition - vWorld;
      float distance = length(toEye);
      vec3 view = toEye / max(distance, 0.001);
      vec2 p = vWorld.xz;

      // Broad swell: analytic slopes matching the vertex waves.
      float c1 = cos(p.x * 0.34 + p.y * 0.19 - uTime * 0.82);
      float c2 = cos(p.x * -0.21 + p.y * 0.41 + uTime * 0.61 + 1.7);
      float c3 = cos(p.x * 0.53 + p.y * -0.27 - uTime * 0.47 + 3.1);
      vec2 slope = vec2(
        c1 * 0.34 * 0.0078 + c2 * -0.21 * 0.0047 + c3 * 0.53 * 0.0026,
        c1 * 0.19 * 0.0078 + c2 * 0.41 * 0.0047 + c3 * -0.27 * 0.0026
      );

      // Wind ripples: two layers of the existing mipmapped noise texture scrolling in
      // different directions (the classic two-normal-map trick, no extra texture).
      float rippleFade = 1.0 - smoothstep(45.0, 240.0, distance);
      float depthCalm = smoothstep(0.015, 0.22, vDepth);
      vec2 rA = texture2D(uCloudMap, p / 5.3 + vec2(uTime * 0.021, uTime * 0.013)).rg - 0.5;
      vec2 rB = texture2D(uCloudMap, vec2(p.y, -p.x) / 3.1 + vec2(-uTime * 0.017, uTime * 0.026)).rg - 0.5;
      float r1 = cos(p.x * 1.73 + p.y * 1.14 - uTime * 1.43);
      float r2 = cos(p.x * -1.29 + p.y * 2.07 + uTime * 1.08 + 0.8);
      slope += (rA * 0.085 + rB * 0.060 + vec2(r1 * 0.010 - r2 * 0.008, r1 * 0.007 + r2 * 0.011))
        * rippleFade * depthCalm;
      // Far away, ripples blur into a gentle roughness instead of shimmering.
      slope += vec2(0.0035) * (1.0 - rippleFade) * sin(p.x * 0.9 + p.y * 0.6 + uTime);

      vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
      vec3 reflected = reflect(-view, normal);
      reflected.y = abs(reflected.y);
      float facing = max(dot(normal, view), 0.0);
      // Slightly under-1 at grazing angles so a little of the water body always shows.
      float fresnel = 0.02 + 0.70 * pow(1.0 - facing, 5.0);

      // Absorption/tint layer over the real terrain bottom.
      float depthAmount = 1.0 - exp(-max(vDepth, 0.0) * 0.85);
      vec3 shallowWater = vec3(0.07, 0.40, 0.36);
      vec3 deepWater = vec3(0.010, 0.17, 0.21);
      vec3 transmission = mix(shallowWater, deepWater, depthAmount);
      transmission *= mix(0.11, 1.0, environmentDay);

      float caustic = sin(p.x * 2.9 + uTime * 0.42 + rA.x * 2.0)
        * sin(p.y * 3.2 - uTime * 0.36 + rB.y * 2.0);
      transmission += vec3(0.045, 0.065, 0.040)
        * caustic * (1.0 - depthAmount) * environmentDay * 0.45;

      // A faint oasis-green bias in reflections helps it read as fresh water, not a mirror.
      vec3 reflectedColor = environmentReflection(reflected, environmentDay) * vec3(0.80, 0.94, 0.96);
      float sunGlint = pow(max(dot(reflected, uSun), 0.0), 320.0);
      reflectedColor += vec3(2.4, 2.05, 1.4) * sunGlint * environmentDay;

      // Keep this exact expression as the torch integration hook. Torch light modifies
      // transmission/reflectedColor before the final Fresnel blend.
      vec3 color = mix(transmission, reflectedColor, fresnel);

      // Stable shoreline contact band with a gentle moving sheen.
      float edgeFade = smoothstep(0.002, 0.038, vDepth);
      float shoreBand = (1.0 - smoothstep(0.025, 0.135, vDepth)) * edgeFade;
      float shoreShimmer = 0.78 + 0.22 * sin(p.x * 0.58 - p.y * 0.46 + uTime * 0.92);
      vec3 shoreTint = mix(vec3(0.012, 0.016, 0.020), vec3(0.30, 0.34, 0.27), environmentDay);
      color += shoreTint * shoreBand * shoreShimmer * 0.18;

      float waterAlpha = 0.40 + depthAmount * 0.40 + fresnel * 0.18 + shoreBand * 0.08;
      waterAlpha *= edgeFade;

      gl_FragColor = vec4(color, clamp(waterAlpha, 0.0, 0.93));
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;

  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.DoubleSide;
  material.forceSinglePass = true;
  material.blending = THREE.NormalBlending;
  material.userData.oasisWaterV2 = true;
  material.userData.realBottomWaterInstalled = true;
  material.needsUpdate = true;
  return true;
}
