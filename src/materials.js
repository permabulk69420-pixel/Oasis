import * as THREE from 'three';
import { SUN, WATER } from './world.js';
import { attachSandPBR } from './sand-pbr.js';

const CLOUD_TEXTURE_SIZE = 256;

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
  // A tiny, deterministic, tileable two-channel FBM field. The GPU only samples this once
  // per cloud/shadow lookup; generating it at startup avoids expensive procedural noise per pixel.
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

const atmosphere = /* glsl */`
  uniform vec3 uSun;
  uniform sampler2D uCloudMap;
  uniform float uCloudTime;
  const float CLOUD_HEIGHT = 1250.0;
  const float CLOUD_SCALE = 1050.0;

  vec2 cloudWind() {
    // About 1.3 m/s across the cloud plane: visible movement without time-lapse speed.
    return vec2(0.00118, 0.00039) * uCloudTime;
  }
  float cloudNoise(vec2 worldXZ) {
    vec2 rg = texture2D(uCloudMap, worldXZ / CLOUD_SCALE + cloudWind()).rg;
    return rg.x * 0.78 + rg.y * 0.22;
  }
  float cloudDensity(vec2 worldXZ) {
    return smoothstep(0.47, 0.66, cloudNoise(worldXZ));
  }
  float cloudShadowDensity(vec2 worldXZ) {
    // The visible sky can get away with one tile because perspective hides the repetition.
    // Ground shadows cannot. Two differently scaled/rotated projections make the combined
    // repeat distance enormous while costing only one additional tiny texture lookup.
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
    return smoothstep(0.475, 0.625, broad * 0.88 + edge * 0.12);
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
    vec3 horizon = vec3(0.56, 0.65, 0.69);
    vec3 zenith = vec3(0.035, 0.19, 0.40);
    vec3 sky = mix(horizon, zenith, pow(altitude, 0.42));
    float facingSun = max(dot(ray, uSun), 0.0);
    sky += vec3(0.24, 0.19, 0.115) * pow(facingSun, 9.0);
    sky += vec3(0.46, 0.32, 0.13) * pow(facingSun, 140.0);
    return sky;
  }
  vec3 air(vec3 color, vec3 ray, float distance) {
    float haze = 1.0 - exp(-distance * 0.00078);
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
  for (let i = 0; i < field.heights.length; i++) {
    const value = Math.round(field.heights[i] / 64 * 65535);
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
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vData;
      void main() {
        vWorld = position;
        vNormal = normal;
        vData = color;
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
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vData;
      ${atmosphere}
      void main() {
        vec3 toEye = cameraPosition - vWorld;
        float distance = length(toEye);
        vec3 view = toEye / max(distance, 0.001);
        vec2 rotatedXZ = vec2(dot(vWorld.xz, vec2(0.84, 0.54)), dot(vWorld.xz, vec2(-0.54, 0.84)));
        vec2 pbrUv = rotatedXZ / 2.5;
        vec3 baseNormal = normalize(vNormal);

        // World-projected tangent basis keeps the texture aligned across all terrain LODs.
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

        vec3 mapNormal = texture2D(uPbrNormal, pbrUv).xyz * 2.0 - 1.0;
        vec3 mappedNormal = normalize(tangent * mapNormal.x + bitangent * mapNormal.y + baseNormal * max(mapNormal.z, 0.05));
        float normalFade = 1.0 - smoothstep(20.0, 70.0, distance);
        vec3 n = normalize(mix(baseNormal, mappedNormal, uHasPbrNormal * normalFade));

        float cloudLight = cloudShadow(vWorld);
        float sun = max(dot(n, uSun), 0.0) * mix(0.10, 1.0, vData.r) * cloudLight;
        vec3 proceduralBase = mix(vec3(0.61, 0.375, 0.165), vec3(0.77, 0.545, 0.285), vData.g);
        vec3 textureBase = texture2D(uPbrBase, pbrUv).rgb * mix(0.94, 1.06, vData.g);
        vec3 base = mix(proceduralBase, textureBase, uHasPbrBase);

        float roughnessMap = texture2D(uPbrRoughness, pbrUv).r;
        float roughness = mix(0.88, roughnessMap, uHasPbrRoughness);
        float poolDistance = length((vWorld.xz - uWater.xz) / vec2(28.0, 21.0));
        float wet = (1.0 - smoothstep(uWater.y + 0.05, uWater.y + 0.60, vWorld.y)) * (1.0 - smoothstep(1.1, 1.6, poolDistance));
        base = mix(base, base * vec3(0.49, 0.48, 0.43), wet * 0.80);
        roughness = mix(roughness, 0.30, wet * 0.70);

        vec3 ambient = mix(vec3(0.20, 0.23, 0.29), vec3(0.28, 0.35, 0.43), max(n.y, 0.0));
        vec3 light = ambient + vec3(1.23, 1.09, 0.86) * sun;
        vec3 halfVector = normalize(view + uSun);
        float specPower = mix(82.0, 7.0, roughness);
        float specStrength = mix(0.24, 0.018, roughness);
        float specular = pow(max(dot(n, halfVector), 0.0), specPower) * specStrength * mix(0.25, 1.0, vData.r) * cloudLight;
        vec3 color = base * light + vec3(1.0, 0.88, 0.70) * specular;
        color = air(color, -view, distance);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  attachSandPBR(renderer, sand.uniforms);

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
      void main() {
        vec3 ray = normalize(vRay);
        vec3 color = skyColor(ray);
        float sun = smoothstep(0.99996, 0.999989, dot(ray, uSun));
        color += vec3(7.0, 5.9, 4.0) * sun;

        // Intersect the view ray with a single high cloud plane. This is visually much richer
        // than a painted sky dome but costs just one tiny texture sample per sky pixel.
        float horizonFade = smoothstep(0.045, 0.19, ray.y);
        if (horizonFade > 0.001) {
          float planeDistance = max(CLOUD_HEIGHT - cameraPosition.y, 1.0) / max(ray.y, 0.06);
          vec2 cloudPoint = cameraPosition.xz + ray.xz * planeDistance;
          float rawCloud = cloudNoise(cloudPoint);
          float cloud = smoothstep(0.43, 0.66, rawCloud) * horizonFade;
          float dense = smoothstep(0.58, 0.76, rawCloud);
          float daylight = smoothstep(-0.07, 0.16, uSun.y);
          float twilight = 1.0 - smoothstep(0.0, 0.30, abs(uSun.y));
          vec3 cloudColor = mix(vec3(0.075, 0.09, 0.13), vec3(0.90, 0.91, 0.89), daylight);
          cloudColor *= 1.0 - dense * 0.17;
          float sunFacing = pow(max(dot(ray, uSun), 0.0), 7.0);
          cloudColor += vec3(0.48, 0.25, 0.10) * twilight * sunFacing * 0.65;
          color = mix(color, cloudColor, cloud * (0.56 + daylight * 0.22));
        }

        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
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
        float d = 3.0;
        for (int i = 0; i < 6; i++) {
          vec3 point = vWorld + ray * d;
          if (max(abs(point.x), abs(point.z)) > 499.0) break;
          if (groundAt(point.xz) > point.y + 0.05) {
            float dx = groundAt(point.xz + vec2(2.0, 0.0)) - groundAt(point.xz - vec2(2.0, 0.0));
            float dz = groundAt(point.xz + vec2(0.0, 2.0)) - groundAt(point.xz - vec2(0.0, 2.0));
            vec3 n = normalize(vec3(-dx, 4.0, -dz));
            vec3 sand = vec3(0.68, 0.46, 0.23) * (vec3(0.28, 0.35, 0.43) + vec3(1.23, 1.09, 0.86) * max(dot(n, uSun), 0.0));
            return air(sand, ray, d);
          }
          d *= 2.35;
        }
        return skyColor(ray);
      }
      void main() {
        if (vDepth <= 0.008) discard;
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
        bottom *= 1.0 + caustic * 0.045 * attenuation;
        vec3 transmission = mix(bottom, vec3(0.085, 0.235, 0.20), 1.0 - exp(-vDepth * 1.2));
        vec3 reflectedColor = reflectionColor(reflected);
        float glint = pow(max(dot(reflected, uSun), 0.0), 380.0);
        reflectedColor += vec3(2.0, 1.7, 1.15) * glint;
        vec3 color = mix(transmission, reflectedColor, fresnel);
        float shore = smoothstep(0.008, 0.09, vDepth);
        color = mix(vec3(0.32, 0.255, 0.15), color, shore);
        color = air(color, -view, distance);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  return { sand, sky, water, clouds };
}

export function createWater(field, material) {
  const geometry = new THREE.PlaneGeometry(58, 44, 64, 48);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(WATER.x, WATER.y, WATER.z);
  const pos = geometry.attributes.position;
  const depth = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) depth[i] = WATER.y - field.sample(pos.getX(i), pos.getZ(i));
  geometry.setAttribute('waterDepth', new THREE.BufferAttribute(depth, 1));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Shallow water';
  return mesh;
}