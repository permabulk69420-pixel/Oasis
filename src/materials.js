import * as THREE from 'three';
import { SUN, WATER, GRID_STEP, HALF_WORLD } from './world.js';
import { attachSandPBR } from './sand-pbr.js';
import { attachGrassTexture, GRASS_TILE_METRES } from './grass-texture.js';
import { GRASS_PBR_GLSL } from './grass-pbr.js';
import { NIGHT_SKY_GLSL } from './night-sky.js';

const CLOUD_TEXTURE_SIZE = 256;
const POD_LIGHT_SLOTS = 8; // ground-light pools under the veil tree's pods

function hash2(x, y, seed) {
  let h = Math.imul((x + seed) | 0, 0x45d9f3b) ^ Math.imul((y - seed) | 0, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967295;
}

function periodicValueNoise(u, v, frequency, seed) {
  const x = u * frequency;
  const y = v * frequency;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const tx0 = x - x0, ty0 = y - y0;
  const tx = tx0 * tx0 * (3 - 2 * tx0);
  const ty = ty0 * ty0 * (3 - 2 * ty0);
  const wrap = value => ((value % frequency) + frequency) % frequency;
  const a = hash2(wrap(x0), wrap(y0), seed);
  const b = hash2(wrap(x0 + 1), wrap(y0), seed);
  const c = hash2(wrap(x0), wrap(y0 + 1), seed);
  const d = hash2(wrap(x0 + 1), wrap(y0 + 1), seed);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

function cloudTexture() {
  // A tiny, deterministic, tileable two-channel FBM field. Multiple differently transformed
  // samples in the shaders break up its tile without needing a large cloud texture.
  const data = new Uint8Array(CLOUD_TEXTURE_SIZE * CLOUD_TEXTURE_SIZE * 4);
  for (let y = 0; y < CLOUD_TEXTURE_SIZE; y++) {
    const v = y / CLOUD_TEXTURE_SIZE;
    for (let x = 0; x < CLOUD_TEXTURE_SIZE; x++) {
      const u = x / CLOUD_TEXTURE_SIZE;
      const broad =
        periodicValueNoise(u, v, 3, 17) * 0.52 +
        periodicValueNoise(u, v, 6, 31) * 0.26 +
        periodicValueNoise(u, v, 12, 47) * 0.14 +
        periodicValueNoise(u, v, 24, 71) * 0.08;
      const detail =
        periodicValueNoise(u, v, 7, 113) * 0.54 +
        periodicValueNoise(u, v, 14, 137) * 0.27 +
        periodicValueNoise(u, v, 28, 163) * 0.13 +
        periodicValueNoise(u, v, 56, 191) * 0.06;
      const i = (y * CLOUD_TEXTURE_SIZE + x) * 4;
      data[i] = Math.round(THREE.MathUtils.clamp(broad, 0, 1) * 255);
      data[i + 1] = Math.round(THREE.MathUtils.clamp(detail, 0, 1) * 255);
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, CLOUD_TEXTURE_SIZE, CLOUD_TEXTURE_SIZE, THREE.RGBAFormat);
  texture.name = 'Procedural cloud field — 256px';
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export const atmosphere = /* glsl */`
  uniform vec3 uSun;
  uniform sampler2D uCloudMap;
  uniform float uCloudTime;
  const float CLOUD_HEIGHT = 1250.0;
  // Night fill (linear light, added after tone mapping). Tuned so the ground reads as a few
  // percent grey-blue under a moon: dark and tense, but not pitch black.
  const vec3 MOON_FILL = vec3(0.0026, 0.0039, 0.0070);
  const vec3 GRASS_NIGHT_FLOOR = vec3(0.12, 0.18, 0.24);
  // Gravel, bedrock and salt are darker than the sand (gravel about a third as bright), so by moonlight they went to pure black. The floor brings them up to about the sand's moonlit level, no more (half floor, half their own colour, so the texture survives).
  const vec3 ZONE_NIGHT_FLOOR = vec3(0.46, 0.36, 0.28);
  // Linear light added under the pods at peak (after tone mapping). Cyan, like the pods themselves.
  const vec3 POD_LIGHT_COLOR = vec3(0.030, 0.230, 0.380);
  const vec3 SKY_NIGHT_HORIZON = vec3(0.0030, 0.0046, 0.0085);
  const vec3 SKY_NIGHT_ZENITH = vec3(0.0006, 0.0013, 0.0032);
  const vec3 WATER_NIGHT_FILL = vec3(0.0013, 0.0024, 0.0042);

  float daylightLevel() {
    return smoothstep(-0.07, 0.16, uSun.y);
  }

  // The sun only ever climbs about 14 degrees (src/sun-path.js): 0 with it on the horizon, 1 at the top of its arc. The whole day is
  // a long golden hour, and this is how far from the red end of it we are.
  float sunHigh() {
    return smoothstep(0.02, 0.24, uSun.y);
  }

  vec3 sunColour() {
    return mix(vec3(1.40, 0.70, 0.34), vec3(1.25, 0.98, 0.70), sunHigh());
  }

  float twilightLevel() {
    return 1.0 - smoothstep(0.0, 0.30, abs(uSun.y));
  }

  vec2 cloudWind() {
    // About 1.3 m/s across the cloud plane: visible movement without time-lapse speed.
    return vec2(0.00118, 0.00039) * uCloudTime;
  }

  float skyCloudNoise(vec2 worldXZ) {
    // Three incommensurate projections of the same tiny texture. The scales, rotations,
    // offsets and drift rates are deliberately unrelated so no tile can stamp across the sky.
    vec2 wind = cloudWind();

    vec2 uvA = worldXZ / 2180.0 + wind * 0.91 + vec2(0.173, 0.617);

    vec2 rotatedB = vec2(
      dot(worldXZ, vec2(0.7986, -0.6018)),
      dot(worldXZ, vec2(0.6018, 0.7986))
    );
    vec2 uvB = rotatedB / 3719.0 + vec2(-wind.y, wind.x) * 0.57 + vec2(0.731, 0.284);

    vec2 rotatedC = vec2(
      dot(worldXZ, vec2(0.9272, 0.3746)),
      dot(worldXZ, vec2(-0.3746, 0.9272))
    );
    vec2 uvC = rotatedC / 6173.0 + wind * vec2(-0.31, 0.24) + vec2(0.413, 0.892);

    vec2 a = texture2D(uCloudMap, uvA).rg;
    vec2 b = texture2D(uCloudMap, uvB).rg;
    vec2 c = texture2D(uCloudMap, uvC).rg;

    float broad = a.r * 0.50 + b.r * 0.31 + c.r * 0.19;
    float detail = a.g * 0.49 + b.g * 0.32 + c.g * 0.19;
    return broad * 0.84 + detail * 0.16;
  }

  // Smooth world-space value noise, 0..1, for irregular terrain material patches.
  float groundHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float groundNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(groundHash(i), groundHash(i + vec2(1.0, 0.0)), u.x), mix(groundHash(i + vec2(0.0, 1.0)), groundHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  float cloudShadowDensity(vec2 worldXZ) {
    // Ground shadows also need anti-tiling, but only two projections are used here to keep
    // the terrain fragment shader cheap on Quest.
    vec2 wind = cloudWind();
    vec2 uvA = worldXZ / 1680.0 + wind * 0.74 + vec2(0.137, 0.619);
    vec2 rotated = vec2(
      dot(worldXZ, vec2(0.8192, -0.5735)),
      dot(worldXZ, vec2(0.5735, 0.8192))
    );
    vec2 uvB = rotated / 2713.0 + vec2(-wind.y, wind.x) * 0.43 + vec2(0.731, 0.284);
    vec2 a = texture2D(uCloudMap, uvA).rg;
    vec2 b = texture2D(uCloudMap, uvB).rg;
    float broad = a.r * 0.57 + b.r * 0.43;
    float edge = a.g * 0.55 + b.g * 0.45;
    return smoothstep(0.505, 0.645, broad * 0.88 + edge * 0.12);
  }

  float cloudShadow(vec3 worldPosition) {
    // Sample where a ray toward the sun intersects the cloud plane. The anti-tiled shadow
    // field stays broad and soft instead of stamping the same cloud cell across the desert.
    float daylight = smoothstep(0.04, 0.24, uSun.y);
    float invSunHeight = 1.0 / max(uSun.y, 0.18);
    vec2 cloudPoint = worldPosition.xz + uSun.xz * (CLOUD_HEIGHT - worldPosition.y) * invSunHeight;
    return 1.0 - cloudShadowDensity(cloudPoint) * 0.24 * daylight;
  }

  vec3 skyColor(vec3 ray) {
    float altitude = max(ray.y, 0.0);
    float daylight = daylightLevel();
    float high = sunHigh();
    // A twilight sky: a deep teal-indigo up high, a dusty rose-grey at the horizon (greyer and bluer when the sun is at the top of its arc),
    // and a wide warm glow round the sun.
    vec3 dayHorizon = mix(vec3(0.30, 0.20, 0.21), vec3(0.34, 0.37, 0.42), high);
    vec3 dayZenith = mix(vec3(0.012, 0.045, 0.125), vec3(0.022, 0.085, 0.215), high);
    vec3 nightHorizon = vec3(0.006, 0.008, 0.014);
    vec3 nightZenith = vec3(0.003, 0.006, 0.015);
    vec3 horizon = mix(nightHorizon, dayHorizon, daylight);
    vec3 zenith = mix(nightZenith, dayZenith, daylight);
    vec3 sky = mix(horizon, zenith, pow(altitude, 0.42));
    float facingSun = max(dot(ray, uSun), 0.0);
    float lowSun = 1.0 - 0.55 * high;
    sky += vec3(0.46, 0.20, 0.07) * pow(facingSun, 3.0) * lowSun * daylight;
    sky += vec3(0.70, 0.36, 0.13) * pow(facingSun, 24.0) * lowSun * daylight;
    sky += vec3(0.55, 0.36, 0.15) * pow(facingSun, 220.0) * daylight;
    return sky;
  }

  vec3 air(vec3 color, vec3 ray, float distance) {
    // Out to 600 m the haze is what it always was; beyond that it thickens more slowly, so mesas a kilometre or two off still read.
    float haze = 1.0 - exp(-(min(distance, 600.0) * 0.00078 + max(distance - 600.0, 0.0) * 0.00030));
    return mix(color, skyColor(ray), haze);
  }
`;

function solidTexture(r, g, b, a = 255) {
  const texture = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

export function createMaterials(renderer, field) {
  // Packed 16-bit height samples support cheap dune reflections in the small pool.
  // RGBA8 keeps filtering portable on mobile GPUs; no float-texture extension is required.
  const elevationData = new Uint8Array(513 * 513 * 4);
  const homeHeights = field.homeHeights();
  for (let i = 0; i < homeHeights.length; i++) {
    const value = Math.round(homeHeights[i] / 64 * 65535);
    elevationData[i * 4] = value >> 8;
    elevationData[i * 4 + 1] = value & 255;
    elevationData[i * 4 + 3] = 255;
  }
  const elevation = new THREE.DataTexture(elevationData, 513, 513, THREE.RGBAFormat);
  elevation.minFilter = elevation.magFilter = THREE.LinearFilter;
  elevation.needsUpdate = true;
  const clouds = cloudTexture();
  const shared = {
    uSun: { value: new THREE.Vector3(SUN.x, SUN.y, SUN.z).normalize() },
    uCloudMap: { value: clouds },
    uCloudTime: { value: 0 },
  };
  const sand = new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uWater: { value: new THREE.Vector3(WATER.x, WATER.y, WATER.z) },
      uWaterRadii: { value: new THREE.Vector2(WATER.radiusX, WATER.radiusZ) },
      uGrassBase: { value: solidTexture(255, 255, 255) },
      uGrassNormal: { value: solidTexture(128, 128, 242, 128) },
      uGrassPatch: { value: solidTexture(255, 255, 255) },
      uGrassPatchNormal: { value: solidTexture(128, 128, 242, 128) },
      uHasGrassPatch: { value: 0 },
      uGrassLitter: { value: solidTexture(64, 60, 36) },
      uGrassLitterNormal: { value: solidTexture(128, 128, 230, 128) },
      uHasGrassLitter: { value: 0 },
      uHasGrassLitterNormal: { value: 0 },
      uHasGrassBase: { value: 0 },
      uHasGrassNormal: { value: 0 },
      uHasGrassRoughness: { value: 0 },
      uHasGrassHeight: { value: 0 },
      uGrassTileMetres: { value: GRASS_TILE_METRES },
      uGrassSkyMap: { value: solidTexture(0, 0, 0) },
      uGrassSkyTexel: { value: new THREE.Vector2(1 / 336, 1 / 128) },
      uGrassSkyMaxMip: { value: 5 },
      uGrassSkyStrength: { value: 0 },
      uHasGrassSky: { value: 0 },
      uGrassSunRadiance: { value: new THREE.Vector3() },
      // Cyan light spilling from the veil tree's pods onto the ground (see glow-halos.js).
      uPodLights: { value: Array.from({ length: POD_LIGHT_SLOTS }, () => new THREE.Vector4(0, -1000, 0, 1)) },
      uPodLightStrength: { value: new Array(POD_LIGHT_SLOTS).fill(0) },
      uPodLightArea: { value: new THREE.Vector4(0, 0, 0, 0) },
      uPbrBase: { value: solidTexture(255, 255, 255) },
      uPbrNormal: { value: solidTexture(128, 128, 255) },
      uPbrRoughness: { value: solidTexture(255, 255, 255) },
      uPbrHeight: { value: solidTexture(128, 128, 128) },
      uHasPbrBase: { value: 0 },
      uHasPbrNormal: { value: 0 },
      uHasPbrRoughness: { value: 0 },
      uHasPbrHeight: { value: 0 },
    },
    vertexColors: true,
    vertexShader: /* glsl */`
      attribute vec3 zone; // rock, salt, gravel (0 to 1): what the ground is made of beyond the oasis (src/zones.js)
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vData;
      varying vec3 vZone;
      void main() {
        vWorld = position;
        vNormal = normal;
        vData = color;
        vZone = zone;
        gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D uPbrBase;
      uniform sampler2D uPbrNormal;
      uniform sampler2D uPbrRoughness;
      uniform sampler2D uPbrHeight;
      uniform float uHasPbrBase;
      uniform float uHasPbrNormal;
      uniform float uHasPbrRoughness;
      uniform float uHasPbrHeight;
      uniform vec3 uWater;
      uniform vec2 uWaterRadii;
      uniform vec4 uPodLights[${POD_LIGHT_SLOTS}];
      uniform float uPodLightStrength[${POD_LIGHT_SLOTS}];
      uniform vec4 uPodLightArea;
      uniform sampler2D uGrassBase;
      uniform sampler2D uGrassNormal;
      uniform sampler2D uGrassPatch;
      uniform sampler2D uGrassPatchNormal;
      uniform float uHasGrassPatch;
      uniform sampler2D uGrassLitter;
      uniform sampler2D uGrassLitterNormal;
      uniform float uHasGrassLitter;
      uniform float uHasGrassLitterNormal;
      uniform float uHasGrassBase;
      uniform float uHasGrassNormal;
      uniform float uHasGrassRoughness;
      uniform float uHasGrassHeight;
      uniform float uGrassTileMetres;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vData;
      varying vec3 vZone;
      ${atmosphere}
      ${GRASS_PBR_GLSL}
      void main() {
        vec3 toEye = cameraPosition - vWorld;
        float distance = length(toEye);
        vec3 view = toEye / max(distance, 0.001);
        vec2 rotatedXZ = vec2(dot(vWorld.xz, vec2(0.84, 0.54)), dot(vWorld.xz, vec2(-0.54, 0.84)));
        vec2 pbrUv = rotatedXZ / 2.5;
        vec2 grassUv = vWorld.xz / uGrassTileMetres;
        vec2 patchUv = vec2(dot(vWorld.xz, vec2(0.6, 0.8)), dot(vWorld.xz, vec2(-0.8, 0.6))) / uGrassTileMetres + vec2(0.31, 0.73);
        vec3 baseNormal = normalize(vNormal);
        float grass = clamp(vData.b, 0.0, 1.0);
        // The material patches stay fixed on the ground. Warped broad and fine
        // masks avoid stripes, a regular grid and camera-dependent layer changes.
        vec2 patchWarp = vec2(groundNoise(vWorld.xz * 0.033 + 11.7), groundNoise(vWorld.xz * 0.037 - 23.4)) * 8.0;
        float patchMask = smoothstep(0.32, 0.68,
          groundNoise((vWorld.xz + patchWarp) * 0.09) * 0.72
          + groundNoise(vWorld.xz * 0.27 + 17.3) * 0.28);
        float patchAmt = 0.0;
        float grassHeight = 0.5;
        float patchHeight = 0.5;
        if (grass > 0.001 && uHasGrassBase > 0.5 && uHasGrassPatch > 0.5) {
          grassHeight = texture2D(uGrassNormal, grassUv).a;
          patchHeight = texture2D(uGrassPatchNormal, patchUv).a;
          // Raised blades survive across the transition instead of dissolving
          // two unrelated surfaces into a flat crossfade.
          float blendFloor = max(grassHeight + 1.0 - patchMask, patchHeight + patchMask) - 0.24;
          float shortWeight = max(grassHeight + 1.0 - patchMask - blendFloor, 0.0) * (1.0 - patchMask);
          float looseWeight = max(patchHeight + patchMask - blendFloor, 0.0) * patchMask;
          patchAmt = looseWeight / max(shortWeight + looseWeight, 0.0001);
        }
        float litterAmt = grass > 0.001 && uHasGrassLitter > 0.5
          ? smoothstep(0.49, 0.70, groundNoise((vWorld.xz + patchWarp) * 0.045) * 0.7 + groundNoise(vWorld.xz * 0.19 + 7.1) * 0.3)
          : 0.0;
        vec2 litterUv = rotatedXZ / 3.4;
        float rockAmt = clamp(vZone.x, 0.0, 1.0);
        float saltAmt = clamp(vZone.y, 0.0, 1.0);
        float gravelAmt = clamp(vZone.z, 0.0, 1.0);
        // The floating island's own stone is stored as a negative salt value (zone.y below zero), so it needs no new attribute: dark, cool rock, the same
        // dark forms as the oasis, in place of the desert's warm strata.
        float stoneAmt = clamp(-vZone.y, 0.0, 1.0);

        // World-projected tangent basis keeps the sand texture aligned across all terrain LODs.
        vec3 tangentSeed = vec3(0.84, 0.0, 0.54);
        vec3 tangent = normalize(tangentSeed - baseNormal * dot(tangentSeed, baseNormal));
        vec3 bitangent = normalize(cross(tangent, baseNormal));

        // One-sample parallax from the height map gives close sand ripples visible depth
        // without tessellating/displacing the Quest terrain. It fades out quickly to avoid
        // stereo shimmer and unnecessary far-field texture work.
        float heightFade = 1.0 - smoothstep(7.0, 26.0, distance);
        if (uHasPbrHeight > 0.5 && heightFade > 0.001) {
          float height = texture2D(uPbrHeight, pbrUv).r - 0.5;
          vec3 viewTangent = vec3(dot(view, tangent), dot(view, bitangent), dot(view, baseNormal));
          float grazing = max(abs(viewTangent.z), 0.32);
          pbrUv -= (viewTangent.xy / grazing) * height * 0.022 * heightFade;
        }

        // Subtle grass relief; distance only fades the parallax, never selects
        // a material. All maps share the same projected UVs and layer weights.
        vec3 grassTangentSeed = vec3(1.0, 0.0, 0.0);
        vec3 grassTangent = normalize(grassTangentSeed - baseNormal * dot(grassTangentSeed, baseNormal));
        vec3 grassBitangent = normalize(cross(grassTangent, baseNormal));
        vec3 patchTangentSeed = vec3(0.6, 0.0, 0.8);
        vec3 patchTangent = normalize(patchTangentSeed - baseNormal * dot(patchTangentSeed, baseNormal));
        vec3 patchBitangent = normalize(cross(patchTangent, baseNormal));
        float grassHeightFade = (1.0 - smoothstep(5.0, 22.0, distance)) * grass;
        if (uHasGrassHeight > 0.5 && grassHeightFade > 0.001) {
          float blendedHeight = mix(grassHeight - 0.75, patchHeight - 0.72, patchAmt);
          if (litterAmt > 0.001) blendedHeight = mix(blendedHeight, texture2D(uGrassLitterNormal, litterUv).a - 0.365, litterAmt);
          vec3 grassViewTangent = vec3(
            dot(view, grassTangent),
            dot(view, grassBitangent),
            dot(view, baseNormal)
          );
          float grassGrazing = max(abs(grassViewTangent.z), 0.38);
          vec2 parallax = (grassViewTangent.xy / grassGrazing) * blendedHeight * 0.025 * grassHeightFade;
          grassUv -= parallax;
          patchUv -= vec2(dot(parallax, vec2(0.6, 0.8)), dot(parallax, vec2(-0.8, 0.6)));
          litterUv -= vec2(dot(parallax, vec2(0.84, 0.54)), dot(parallax, vec2(-0.54, 0.84)));
        }

        vec3 mapNormal = texture2D(uPbrNormal, pbrUv).xyz * 2.0 - 1.0;
        vec3 mappedNormal = normalize(tangent * mapNormal.x + bitangent * mapNormal.y + baseNormal * max(mapNormal.z, 0.05));
        float normalFade = 1.0 - smoothstep(20.0, 70.0, distance);
        vec3 sandNormal = normalize(mix(baseNormal, mappedNormal, uHasPbrNormal * normalFade * (1.0 - grass) * (1.0 - max(max(max(rockAmt, saltAmt), gravelAmt), stoneAmt))));
        vec3 grassNormal = baseNormal;
        if (grass > 0.001 && uHasGrassNormal > 0.5 && normalFade > 0.001) {
          vec3 grassMapNormal = grassPbrNormal(texture2D(uGrassNormal, grassUv).rg);
          vec3 grassMappedNormal = normalize(
            grassTangent * grassMapNormal.x
            + grassBitangent * grassMapNormal.y
            + baseNormal * max(grassMapNormal.z, 0.05)
          );
          if (patchAmt > 0.001) {
            vec3 patchMapNormal = grassPbrNormal(texture2D(uGrassPatchNormal, patchUv).rg);
            vec3 patchMappedNormal = normalize(patchTangent * patchMapNormal.x + patchBitangent * patchMapNormal.y + baseNormal * max(patchMapNormal.z, 0.05));
            grassMappedNormal = normalize(mix(grassMappedNormal, patchMappedNormal, patchAmt));
          }
          if (litterAmt > 0.001 && uHasGrassLitterNormal > 0.5) {
            vec3 litterMapNormal = grassPbrNormal(texture2D(uGrassLitterNormal, litterUv).rg);
            vec3 litterMappedNormal = normalize(tangent * litterMapNormal.x + bitangent * litterMapNormal.y + baseNormal * max(litterMapNormal.z, 0.05));
            grassMappedNormal = normalize(mix(grassMappedNormal, litterMappedNormal, litterAmt));
          }
          grassNormal = normalize(mix(baseNormal, grassMappedNormal, normalFade));
        }
        vec3 n = normalize(mix(sandNormal, grassNormal, grass));

        float environmentDay = daylightLevel();
        float cloudLight = cloudShadow(vWorld);
        float sun = max(dot(n, uSun), 0.0) * mix(0.10, 1.0, vData.r) * cloudLight * environmentDay;
        vec3 proceduralBase = mix(vec3(0.61, 0.375, 0.165), vec3(0.77, 0.545, 0.285), vData.g);
        vec3 textureBase = texture2D(uPbrBase, pbrUv).rgb * mix(0.94, 1.06, vData.g);
        vec3 base = mix(proceduralBase, textureBase, uHasPbrBase);
        if (grass > 0.001) {
          vec3 grassBase = mix(vec3(0.10, 0.15, 0.028), vec3(0.19, 0.25, 0.065), vData.g);
          if (uHasGrassBase > 0.5) {
            grassBase = texture2D(uGrassBase, grassUv).rgb;
            if (patchAmt > 0.001) grassBase = mix(grassBase, texture2D(uGrassPatch, patchUv).rgb, patchAmt);
            if (litterAmt > 0.001) grassBase = mix(grassBase, texture2D(uGrassLitter, litterUv).rgb, litterAmt);
            // Broad world-space colour drift on top (sunnier and drier here, deeper green there).
            grassBase *= mix(vec3(0.92, 0.98, 1.03), vec3(1.05, 1.04, 0.97), vData.g);
          }
          // Commit to turf colour a little earlier than the geometry cover so the sand-to-grass
          // transition is not a muddy brown mix.
          base = mix(base, grassBase, smoothstep(0.08, 0.65, grass));
        }

        // Bedrock, salt and gravel (the zones beyond the oasis). Inside the oasis square all three are zero, so nothing there changes.
        if (rockAmt + saltAmt + gravelAmt + stoneAmt > 0.002) {
          float grain = dot(textureBase, vec3(0.299, 0.587, 0.114));
          float steep = 1.0 - clamp(baseNormal.y, 0.0, 1.0);
          // Strata: soft bands of colour by height (one cycle about 6 m), wobbled so the layers do not run level. The bands fade
          // out with distance, or they would shimmer into stripes on far mountains; the broad colour by height stays.
          float wobble = sin(vWorld.x * 0.021 + vWorld.z * 0.017) * 1.6 + sin(vWorld.x * 0.063 - vWorld.z * 0.051) * 0.5;
          float strataNoise = (texture2D(uPbrBase, vWorld.xz * 0.011).r - 0.5) * 7.0 + (texture2D(uPbrBase, vWorld.xz * 0.0043 + 0.3).g - 0.5) * 10.0;
          float band = (vWorld.y + wobble + strataNoise) * 0.16;
          float bandFade = 1.0 - smoothstep(50.0, 400.0, distance);
          float b1 = mix(0.5, 0.5 + 0.5 * sin(band * 6.2832), bandFade);
          float b2 = mix(0.5, 0.5 + 0.5 * sin(band * 17.0 + 1.3), bandFade);
          float high = smoothstep(15.0, 130.0, vWorld.y);
          vec3 rockColour = mix(vec3(0.50, 0.22, 0.12), vec3(0.70, 0.52, 0.33), clamp(b1 * 0.7 + high * 0.45, 0.0, 1.0));
          rockColour = mix(rockColour, vec3(0.26, 0.16, 0.13), b2 * 0.30 * bandFade + steep * 0.22);
          rockColour *= 0.62 + 0.75 * grain;
          base = mix(base, rockColour, rockAmt);
          vec3 saltColour = vec3(0.80, 0.78, 0.72) * (0.90 + 0.20 * grain);
          base = mix(base, saltColour, saltAmt);
          // Pebbly mottling from the sand photo at another scale and angle (no hard cells), fading to its average with distance.
          float pebbles = dot(texture2D(uPbrBase, pbrUv * 2.9 + vec2(0.37, 0.61)).rgb, vec3(0.299, 0.587, 0.114));
          float speckFade = 1.0 - smoothstep(10.0, 90.0, distance);
          vec3 gravelColour = mix(vec3(0.46, 0.34, 0.24), vec3(0.64, 0.52, 0.38), vData.g) * (0.55 + 0.9 * grain) * mix(1.0, 0.45 + 1.1 * pebbles, speckFade);
          base = mix(base, gravelColour, gravelAmt);
          // The island's stone: near black blue-grey, a touch greener where the ground varies, mottled by the sand photo at another scale, darker down
          // the steep faces (a streaked, weathered look). Not tinted by the sun's red: it is dark rock under a low golden light.
          if (stoneAmt > 0.002) {
            float stoneGrain = dot(texture2D(uPbrBase, pbrUv * 1.7 + vec2(0.21, 0.83)).rgb, vec3(0.299, 0.587, 0.114));
            float stoneFine = dot(texture2D(uPbrBase, pbrUv * 6.3 + vec2(0.57, 0.12)).rgb, vec3(0.299, 0.587, 0.114));
            vec3 stoneColour = mix(vec3(0.060, 0.070, 0.086), vec3(0.082, 0.098, 0.100), vData.g);
            stoneColour *= 0.55 + 1.15 * stoneGrain + mix(0.0, 0.5 * (stoneFine - 0.5), 1.0 - smoothstep(6.0, 40.0, distance));
            stoneColour = mix(stoneColour, vec3(0.034, 0.044, 0.046), steep * 0.55);
            base = mix(base, stoneColour, stoneAmt);
          }
        }

        float roughnessMap = texture2D(uPbrRoughness, pbrUv).r;
        float roughness = mix(0.88, roughnessMap, uHasPbrRoughness);
        float grassRoughness = 0.95;
        float grassAO = 1.0;
        if (grass > 0.001 && uHasGrassRoughness > 0.5) {
          vec2 surface = vec2(texture2D(uGrassBase, grassUv).a, texture2D(uGrassNormal, grassUv).b);
          if (patchAmt > 0.001) surface = mix(surface, vec2(texture2D(uGrassPatch, patchUv).a, texture2D(uGrassPatchNormal, patchUv).b), patchAmt);
          if (litterAmt > 0.001) surface = mix(surface, vec2(texture2D(uGrassLitter, litterUv).a, texture2D(uGrassLitterNormal, litterUv).b), litterAmt);
          grassAO = clamp(surface.r, 0.0, 1.0);
          grassRoughness = clamp(surface.g, 0.0525, 1.0);
        }
        roughness = mix(roughness, grassRoughness, grass);
        roughness = mix(roughness, 0.95, max(max(rockAmt, gravelAmt), stoneAmt));
        float poolDistance = length((vWorld.xz - uWater.xz) / uWaterRadii);
        float wet = (1.0 - smoothstep(uWater.y + 0.05, uWater.y + 0.60, vWorld.y)) * (1.0 - smoothstep(1.1, 1.6, poolDistance));
        base = mix(base, base * vec3(0.49, 0.48, 0.43), wet * 0.80);
        roughness = mix(roughness, 0.30, wet * 0.70);

        vec3 dayAmbient = mix(vec3(0.13, 0.14, 0.21), vec3(0.17, 0.21, 0.31), max(n.y, 0.0));
        // Light bounced up from the sand reaches the undersides of overhangs and of the floating island (nothing else on the ground faces down).
        dayAmbient += vec3(0.30, 0.19, 0.10) * max(-n.y, 0.0) * 0.5;
        vec3 nightAmbient = mix(vec3(0.006, 0.009, 0.015), vec3(0.012, 0.018, 0.029), max(n.y, 0.0));
        vec3 ambient = mix(nightAmbient, dayAmbient, environmentDay);
        ambient *= mix(1.0, grassAO, grass);
        // All grass lights use the same non-metallic GGX BRDF. Existing light
        // hooks keep their original response on sand and stone.
        vec3 normalDerivative = max(abs(dFdx(baseNormal)), abs(dFdy(baseNormal)));
        float grassPerceptualRoughness = min(roughness + max(max(normalDerivative.x, normalDerivative.y), normalDerivative.z), 1.0);
        vec3 grassDirectLighting = grassPbrDirect(base, grassPerceptualRoughness, n, view, uSun)
          * uGrassSunRadiance * mix(0.10, 1.0, vData.r) * cloudLight;
        vec3 light = ambient + sunColour() * sun;
        vec3 halfVector = normalize(view + uSun);
        float specPower = mix(82.0, 7.0, roughness);
        float specStrength = mix(0.24, 0.018, roughness);
        float specular = pow(max(dot(n, halfVector), 0.0), specPower) * specStrength * mix(0.25, 1.0, vData.r) * cloudLight * environmentDay;
        vec3 color = base * light + vec3(1.0, 0.88, 0.70) * specular;
        if (grass > 0.001) {
          vec3 grassIndirect = base * ambient;
          if (uHasGrassSky > 0.5) grassIndirect = grassPbrIndirect(base, grassPerceptualRoughness, grassAO, n, view);
          color = mix(color, grassDirectLighting + grassIndirect, grass);
        }
        color = air(color, -view, distance);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        // Faint moonlit fill, added after tone mapping (the film curve crushes anything this dim
        // to pure black). It keeps dunes and shapes readable at night without touching the torch.
        // Turf is far darker than sand, so it gets a moonlit floor (cool blue-green) to stay readable.
        vec3 fillBase = mix(base, max(base, GRASS_NIGHT_FLOOR), grass);
        fillBase = mix(fillBase, max(fillBase * 0.5 + ZONE_NIGHT_FLOOR * 0.5, fillBase), clamp(max(rockAmt, max(saltAmt, gravelAmt)), 0.0, 1.0)); // lifted toward the floor, keeping half the texture
        fillBase = mix(fillBase, max(fillBase, vec3(0.085, 0.115, 0.155)), stoneAmt); // the island's stone: a faint cool floor, a little below the turf's
        gl_FragColor.rgb += fillBase * MOON_FILL * mix(0.55, 1.0, max(n.y, 0.0)) * (1.0 - environmentDay);
        // Cyan pools under the veil tree's glowing pods. Only evaluated near the tree and at night.
        if (uPodLightArea.w > 0.001 && length(vWorld.xz - uPodLightArea.xy) < uPodLightArea.z) {
          float podGlow = 0.0;
          for (int i = 0; i < ${POD_LIGHT_SLOTS}; i++) {
            vec3 toPod = uPodLights[i].xyz - vWorld;
            float podDistance = length(toPod);
            float falloff = 1.0 - smoothstep(0.0, uPodLights[i].w, podDistance);
            falloff *= falloff;
            float facing = 0.35 + 0.65 * max(dot(n, toPod / max(podDistance, 0.001)), 0.0);
            podGlow += falloff * facing * uPodLightStrength[i];
          }
          float podTint = 0.55 + 0.45 * clamp(dot(fillBase, vec3(0.33)) * 2.5, 0.0, 1.0);
          gl_FragColor.rgb += POD_LIGHT_COLOR * podGlow * podTint * uPodLightArea.w;
        }
        #include <colorspace_fragment>
      }
    `,
  });
  attachSandPBR(renderer, sand.uniforms);
  attachGrassTexture(renderer, sand.uniforms);

  const sky = new THREE.ShaderMaterial({
    uniforms: shared, side: THREE.BackSide, depthWrite: false,
    vertexShader: /* glsl */`
      varying vec3 vRay;
      void main() {
        vRay = position;
        vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
        gl_Position = p.xyww;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vRay;
      ${atmosphere}
      ${NIGHT_SKY_GLSL}
      void main() {
        vec3 ray = normalize(vRay);
        float daylight = daylightLevel();
        vec3 color = skyColor(ray);
        float sun = smoothstep(0.99996, 0.999989, dot(ray, uSun));
        color += vec3(7.0, 5.9, 4.0) * sun * daylight;

        // Intersect the view ray with a high cloud plane. The visible density field is built
        // from three unrelated projections, so the old obvious repeating cloud stamp is gone.
        float horizonFade = smoothstep(0.045, 0.19, ray.y);
        if (horizonFade > 0.001) {
          float planeDistance = max(CLOUD_HEIGHT - cameraPosition.y, 1.0) / max(ray.y, 0.06);
          vec2 cloudPoint = cameraPosition.xz + ray.xz * planeDistance;
          float rawCloud = skyCloudNoise(cloudPoint);
          // Keep the same cloud shapes and motion but let them disappear into near-black at night.
          float cloud = smoothstep(0.49, 0.65, rawCloud) * horizonFade * 0.86;
          float dense = smoothstep(0.60, 0.74, rawCloud);
          float twilight = twilightLevel();
          // slate and mauve on the far side of the sky, lit coral and gold where they face the low sun
          vec3 cloudColor = mix(vec3(0.005, 0.007, 0.012), mix(vec3(0.24, 0.22, 0.29), vec3(0.62, 0.60, 0.62), sunHigh()), daylight);
          cloudColor *= 1.0 - dense * 0.17;
          float sunFacing = pow(max(dot(ray, uSun), 0.0), 3.0);
          cloudColor += vec3(0.95, 0.45, 0.17) * sunFacing * (1.0 - 0.45 * sunHigh()) * daylight;
          color = mix(color, cloudColor, cloud * (0.32 + daylight * 0.46));
        }

        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        // Faint night-sky glow, brighter toward the horizon, so silhouettes read against it.
        gl_FragColor.rgb += mix(SKY_NIGHT_HORIZON, SKY_NIGHT_ZENITH, pow(max(ray.y, 0.0), 0.5)) * (1.0 - daylight);
        // The moon, the Milky Way and now and then a shooting star (see night-sky.js). The moon shows a bit
        // earlier than the stars, in the twilight.
        float starNight = 1.0 - smoothstep(-0.22, 0.025, uSun.y);
        float moonNight = 1.0 - smoothstep(-0.12, 0.10, uSun.y);
        if (moonNight > 0.01) gl_FragColor.rgb += moonLight(ray) * moonNight;
        if (starNight > 0.01) gl_FragColor.rgb += (milkyWayLight(ray) + shootingStarLight(ray, uCloudTime)) * starNight;
        // The great ringed planet this moon circles, laid over everything above (it is nearer than the stars and the Milky Way).
        vec4 planet = planetLight(ray, daylight);
        gl_FragColor.rgb = gl_FragColor.rgb * (1.0 - planet.a) + planet.rgb;
        #include <colorspace_fragment>
      }
    `,
  });
  const water = new THREE.ShaderMaterial({
    uniforms: { ...shared, uTime: { value: 0 }, uElevation: { value: elevation } },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      attribute float waterDepth;
      varying vec3 vWorld;
      varying float vDepth;
      void main() {
        vWorld = position; vDepth = waterDepth;
        gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform sampler2D uElevation;
      varying vec3 vWorld;
      varying float vDepth;
      ${atmosphere}
      float groundAt(vec2 p) {
        vec2 rg = texture2D(uElevation, ((p + 500.0) / 1000.0 * 512.0 + 0.5) / 513.0).rg;
        return dot(rg, vec2(256.0, 1.0)) * (255.0 * 64.0 / 65535.0);
      }
      vec3 reflectionColor(vec3 ray) {
        float environmentDay = daylightLevel();
        float d = 3.0;
        for (int i = 0; i < 6; i++) {
          vec3 point = vWorld + ray * d;
          if (max(abs(point.x), abs(point.z)) > 499.0) break;
          if (groundAt(point.xz) > point.y + 0.05) {
            float dx = groundAt(point.xz + vec2(2.0, 0.0)) - groundAt(point.xz - vec2(2.0, 0.0));
            float dz = groundAt(point.xz + vec2(0.0, 2.0)) - groundAt(point.xz - vec2(0.0, 2.0));
            vec3 n = normalize(vec3(-dx, 4.0, -dz));
            vec3 dayAmbient = vec3(0.28, 0.35, 0.43);
            vec3 nightAmbient = vec3(0.008, 0.012, 0.020);
            vec3 reflectedLight = mix(nightAmbient, dayAmbient, environmentDay);
            reflectedLight += sunColour() * max(dot(n, uSun), 0.0) * environmentDay;
            vec3 sand = vec3(0.68, 0.46, 0.23) * reflectedLight;
            return air(sand, ray, d);
          }
          d *= 2.35;
        }
        return skyColor(ray);
      }
      void main() {
        if (vDepth <= 0.008) discard;
        float environmentDay = daylightLevel();
        vec3 toEye = cameraPosition - vWorld;
        float distance = length(toEye);
        vec3 view = toEye / distance;
        vec2 p = vWorld.xz;
        float attenuation = (1.0 - smoothstep(25.0, 120.0, distance)) * smoothstep(0.0, 0.25, vDepth);
        float wx = sin(p.x * 2.8 + p.y * 1.7 - uTime * 1.35 + 0.4 * sin(p.y * 0.8));
        float wz = sin(p.x * -1.9 + p.y * 3.9 + uTime * 0.93 + 0.5 * sin(p.x * 0.7));
        vec3 normal = normalize(vec3((wx * 0.018 + wz * 0.011) * attenuation, 1.0, (wz * 0.015 + wx * 0.009) * attenuation));
        vec3 reflected = reflect(-view, normal);
        float fresnel = 0.025 + 0.975 * pow(1.0 - max(dot(normal, view), 0.0), 5.0);
        vec3 bottom = vec3(0.42, 0.355, 0.22);
        float caustic = sin(p.x * 4.0 + wx * 0.75 + uTime * 0.5) * sin(p.y * 3.8 + wz * 0.8 - uTime * 0.4);
        bottom *= 1.0 + caustic * 0.045 * attenuation * environmentDay;
        vec3 transmission = mix(bottom, vec3(0.085, 0.235, 0.20), 1.0 - exp(-vDepth * 1.2));
        transmission *= mix(0.055, 1.0, environmentDay);
        vec3 reflectedColor = reflectionColor(reflected);
        float glint = pow(max(dot(reflected, uSun), 0.0), 380.0);
        reflectedColor += vec3(2.0, 1.7, 1.15) * glint * environmentDay;
        vec3 color = mix(transmission, reflectedColor, fresnel);
        float shore = smoothstep(0.008, 0.09, vDepth);
        vec3 shoreColor = mix(vec3(0.010, 0.009, 0.007), vec3(0.32, 0.255, 0.15), environmentDay);
        color = mix(shoreColor, color, shore);
        color = air(color, -view, distance);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        gl_FragColor.rgb += WATER_NIGHT_FILL * shore * (1.0 - environmentDay);
        #include <colorspace_fragment>
      }
    `,
  });
  return { sand, sky, water, clouds };
}

export function createWater(field, material) {
  // Align to the terrain grid, including triangle diagonals, so the shoreline
  // depth interpolation agrees with the ground without needing a denser mesh.
  const step = GRID_STEP;
  const minX = Math.floor((WATER.x - WATER.radiusX * 1.2 + HALF_WORLD) / step) * step - HALF_WORLD;
  const maxX = Math.ceil((WATER.x + WATER.radiusX * 1.2 + HALF_WORLD) / step) * step - HALF_WORLD;
  const minZ = Math.floor((WATER.z - WATER.radiusZ * 1.2 + HALF_WORLD) / step) * step - HALF_WORLD;
  const maxZ = Math.ceil((WATER.z + WATER.radiusZ * 1.2 + HALF_WORLD) / step) * step - HALF_WORLD;
  const geometry = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ,
    Math.round((maxX - minX) / step), Math.round((maxZ - minZ) / step));
  geometry.rotateX(-Math.PI / 2);
  geometry.translate((minX + maxX) / 2, WATER.y, (minZ + maxZ) / 2);
  const pos = geometry.attributes.position;
  const depth = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) depth[i] = WATER.y - field.sample(pos.getX(i), pos.getZ(i));
  geometry.setAttribute('waterDepth', new THREE.BufferAttribute(depth, 1));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Shallow water';
  return mesh;
}
