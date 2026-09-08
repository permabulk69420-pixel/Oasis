import * as THREE from 'three';

// Rebuild the existing Oasis water material in-place. The mesh already carries a
// per-vertex `waterDepth` attribute derived from the terrain heightfield, so we keep
// that useful geometry/data and replace the old opaque/fake-bottom rendering model.
//
// The result is intentionally conventional for mobile VR:
// - centimetre-scale vertex waves
// - analytic ripple normals (no normal-map texture fetch)
// - depth-based tint/opacity over the real terrain beneath the pool
// - Fresnel + cheap analytic sky/sun reflection
// - a readable but fixed shoreline contact band
// - no planar reflection camera, SSR, FFT ocean, refraction render target or particles
export function installOasisWater(material, onError = console.warn) {
  if (!material?.isShaderMaterial) {
    onError('[Oasis water] Rebuilt water requires the Oasis ShaderMaterial.');
    return false;
  }
  if (material.userData.oasisWaterV2) return true;
  if (!material.uniforms?.uTime || !material.uniforms?.uSun || !material.uniforms?.uElevation) {
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
    uniform vec3 uSun;
    uniform sampler2D uElevation;
    varying vec3 vWorld;
    varying float vDepth;

    float daylightLevel() {
      return smoothstep(-0.07, 0.16, uSun.y);
    }

    vec3 reflectedSky(vec3 ray, float daylight) {
      float h = clamp(ray.y * 0.5 + 0.5, 0.0, 1.0);
      vec3 dayHorizon = vec3(0.48, 0.62, 0.67);
      vec3 dayZenith = vec3(0.035, 0.18, 0.38);
      vec3 nightHorizon = vec3(0.006, 0.009, 0.016);
      vec3 nightZenith = vec3(0.002, 0.005, 0.014);
      vec3 horizon = mix(nightHorizon, dayHorizon, daylight);
      vec3 zenith = mix(nightZenith, dayZenith, daylight);
      return mix(horizon, zenith, pow(h, 0.62));
    }

    void main() {
      // The terrain itself defines the bank. When the displaced surface falls below it,
      // the water fragment disappears and the actual terrain remains visible underneath.
      if (vDepth <= 0.002) discard;

      float environmentDay = daylightLevel();
      vec3 toEye = cameraPosition - vWorld;
      float distance = length(toEye);
      vec3 view = toEye / max(distance, 0.001);
      vec2 p = vWorld.xz;

      // Analytic slopes for the same broad waves used by the vertex shader, plus two much
      // smaller high-frequency ripples. This gives visible moving water without textures.
      float c1 = cos(p.x * 0.34 + p.y * 0.19 - uTime * 0.82);
      float c2 = cos(p.x * -0.21 + p.y * 0.41 + uTime * 0.61 + 1.7);
      float c3 = cos(p.x * 0.53 + p.y * -0.27 - uTime * 0.47 + 3.1);
      float r1 = cos(p.x * 1.73 + p.y * 1.14 - uTime * 1.43);
      float r2 = cos(p.x * -1.29 + p.y * 2.07 + uTime * 1.08 + 0.8);

      float normalFade = 1.0 - smoothstep(35.0, 130.0, distance);
      float depthCalm = smoothstep(0.02, 0.30, vDepth);
      float dHdx = (c1 * 0.34 * 0.0078 + c2 * -0.21 * 0.0047 + c3 * 0.53 * 0.0026)
        + (r1 * 0.0060 - r2 * 0.0045) * depthCalm;
      float dHdz = (c1 * 0.19 * 0.0078 + c2 * 0.41 * 0.0047 + c3 * -0.27 * 0.0026)
        + (r1 * 0.0040 + r2 * 0.0072) * depthCalm;
      vec3 normal = normalize(vec3(-dHdx * normalFade, 1.0, -dHdz * normalFade));

      vec3 reflected = reflect(-view, normal);
      float facing = max(dot(normal, view), 0.0);
      float fresnel = 0.022 + 0.978 * pow(1.0 - facing, 5.0);

      // The actual terrain is rendered below the transparent surface. These colours are
      // therefore absorption/tint, not a painted fake bottom.
      float depthAmount = 1.0 - exp(-max(vDepth, 0.0) * 0.72);
      vec3 shallowWater = vec3(0.075, 0.31, 0.27);
      vec3 deepWater = vec3(0.020, 0.135, 0.19);
      vec3 transmission = mix(shallowWater, deepWater, depthAmount);
      transmission *= mix(0.11, 1.0, environmentDay);

      // Very restrained moving shallow light. Because the real sand is visible below this
      // remains a surface modulation instead of looking like a texture painted on the floor.
      float caustic = sin(p.x * 2.9 + uTime * 0.42 + r1 * 0.35)
        * sin(p.y * 3.2 - uTime * 0.36 + r2 * 0.28);
      transmission += vec3(0.035, 0.050, 0.030)
        * caustic * (1.0 - depthAmount) * environmentDay * 0.38;

      vec3 reflectedColor = reflectedSky(reflected, environmentDay);
      float sunGlint = pow(max(dot(reflected, uSun), 0.0), 260.0);
      reflectedColor += vec3(2.0, 1.72, 1.15) * sunGlint * environmentDay;

      // Keep this exact expression as the torch integration hook. Torch light modifies
      // transmission/reflectedColor before the final Fresnel blend.
      vec3 color = mix(transmission, reflectedColor, fresnel);

      // A stable shoreline contact cue. It changes brightness subtly with the existing
      // ripples but never moves the shoreline mask itself, so sloped banks cannot open holes.
      float edgeFade = smoothstep(0.002, 0.038, vDepth);
      float shoreBand = (1.0 - smoothstep(0.025, 0.135, vDepth)) * edgeFade;
      float shoreShimmer = 0.78 + 0.22 * sin(p.x * 0.58 - p.y * 0.46 + uTime * 0.92);
      vec3 shoreTint = mix(vec3(0.012, 0.016, 0.020), vec3(0.25, 0.31, 0.27), environmentDay);
      color += shoreTint * shoreBand * shoreShimmer * 0.16;

      // Readable clear water: shallow areas still show the sand strongly, but never become
      // visually invisible. Depth and grazing-angle reflection build opacity naturally.
      float waterAlpha = 0.22
        + depthAmount * 0.43
        + fresnel * 0.23
        + shoreBand * 0.10;
      waterAlpha *= edgeFade;

      gl_FragColor = vec4(color, clamp(waterAlpha, 0.0, 0.84));
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
