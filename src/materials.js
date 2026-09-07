import * as THREE from 'three';
import { SUN, WATER } from './world.js';

const atmosphere = /* glsl */`
  uniform vec3 uSun;
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

function sandDetail(renderer) {
  const size = 512, data = new Uint8Array(size * size * 4);
  let seed = 85741;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * Math.PI * 2, v = y / size * Math.PI * 2;
    const phase = u * 39 + 1.5 * Math.sin(v * 3) + 0.8 * Math.sin(v * 7 + u * 2);
    const ripple = Math.cos(phase) + 0.2 * Math.cos(phase * 2);
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const grain = seed / 4294967295;
    const i = (y * size + x) * 4;
    data[i] = Math.round(128 + ripple * 74);
    data[i + 1] = Math.round(128 + Math.sin(phase) * Math.cos(v * 3) * 12);
    data[i + 2] = Math.round(grain * 255);
    data[i + 3] = 255;
  }
  const map = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true; map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  map.needsUpdate = true;
  return map;
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
  const shared = { uSun: { value: new THREE.Vector3(SUN.x, SUN.y, SUN.z).normalize() } };
  const sand = new THREE.ShaderMaterial({
    uniforms: { ...shared, uDetail: { value: sandDetail(renderer) }, uWater: { value: new THREE.Vector3(WATER.x, WATER.y, WATER.z) } },
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
      uniform sampler2D uDetail;
      uniform vec3 uWater;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vData;
      ${atmosphere}
      void main() {
        vec3 toEye = cameraPosition - vWorld;
        float distance = length(toEye);
        vec2 uv = vec2(dot(vWorld.xz, vec2(0.84, 0.54)), dot(vWorld.xz, vec2(-0.54, 0.84))) / 8.0;
        vec3 detail = texture2D(uDetail, uv).rgb;
        float nearDetail = 1.0 - smoothstep(9.0, 32.0, distance);
        vec2 micro = (detail.rg * 2.0 - 1.0) * 0.14 * nearDetail;
        vec3 n = normalize(vNormal + vec3(micro.x * 0.84 - micro.y * 0.54, 0.0, micro.x * 0.54 + micro.y * 0.84));
        float sun = max(dot(n, uSun), 0.0) * mix(0.10, 1.0, vData.r);
        vec3 base = mix(vec3(0.61, 0.375, 0.165), vec3(0.77, 0.545, 0.285), vData.g);
        float fineGrain = (detail.b - 0.5) * 0.07 * (1.0 - smoothstep(1.5, 7.0, distance));
        base *= 1.0 + fineGrain;
        float poolDistance = length((vWorld.xz - uWater.xz) / vec2(28.0, 21.0));
        float wet = (1.0 - smoothstep(uWater.y + 0.05, uWater.y + 0.60, vWorld.y)) * (1.0 - smoothstep(1.1, 1.6, poolDistance));
        base = mix(base, base * vec3(0.49, 0.48, 0.43), wet * 0.80);
        vec3 ambient = mix(vec3(0.20, 0.23, 0.29), vec3(0.28, 0.35, 0.43), max(n.y, 0.0));
        vec3 light = ambient + vec3(1.23, 1.09, 0.86) * sun;
        vec3 color = base * light;
        color = air(color, -toEye / distance, distance);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
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
  return { sand, sky, water };
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
