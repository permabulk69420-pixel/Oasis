import * as THREE from 'three';
import { atmosphere } from './materials.js';
import { buildLakeWater, buildSpill } from './sky-island-water.js';

// The island's water as meshes (the arrays come from sky-island-water.js): the lake, in the oasis pond's own water material, and the thin waterfall.

// The lake: the pond's own water material on the grid. `material` is materials.water (shared uniforms, the torch and fire light hooks, the night look).
export function createLakeWater({ island, material }) {
  const { lake } = island.features;
  const level = island.baseY + island.features.lakeSpec.level;
  const data = buildLakeWater({ lake, ground: island.groundHeight, level });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('waterDepth', new THREE.BufferAttribute(data.depth, 1));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Island lake';
  mesh.frustumCulled = true;
  return { mesh, level, triangles: data.indices.length / 3 };
}

// A small shader for the water that is moving: streaks scroll down the ribbon, the sky and the haze are the world's own (the same `atmosphere` the
// pond and the terrain use), and at night it keeps a faint cool glow so the fall can be seen from across the island and from the desert below.
export function createFlowMaterial(waterMaterial) {
  const uniforms = {
    uTime: waterMaterial.uniforms.uTime,
    uSun: waterMaterial.uniforms.uSun,
    uCloudMap: waterMaterial.uniforms.uCloudMap,
    uCloudTime: waterMaterial.uniforms.uCloudTime,
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.NormalBlending,
    vertexShader: /* glsl */`
      attribute float fade;
      varying vec2 vUv;
      varying float vFade;
      varying vec3 vWorld;
      uniform float uTime;
      void main() {
        vUv = uv;
        vFade = fade;
        vec3 p = position;
        // the long fall sways a little in the wind, more the further it has dropped
        float drop = max(0.0, uv.y - 8.0);
        p.xz += vec2(sin(uTime * 0.31 + drop * 0.035), cos(uTime * 0.23 + drop * 0.05)) * 0.0035 * drop * min(1.0, drop / 40.0);
        vWorld = p;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      varying vec2 vUv;
      varying float vFade;
      varying vec3 vWorld;
      ${atmosphere}
      float hash21(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      float valueNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        float across = abs(vUv.x * 2.0 - 1.0);
        float body = 1.0 - smoothstep(0.35, 1.0, across);
        // streaks run down the flow and scroll with it: faster on the fall than on the channel
        float speed = 2.4 + 4.0 * smoothstep(8.0, 20.0, vUv.y);
        float s1 = valueNoise(vec2(vUv.x * 9.0, vUv.y * 0.55 - uTime * speed));
        float s2 = valueNoise(vec2(vUv.x * 17.0 + 4.0, vUv.y * 1.1 - uTime * speed * 1.7));
        float streak = 0.5 * s1 + 0.5 * s2;
        // as it spreads into mist the streaks soften into a veil
        float mist = 1.0 - smoothstep(0.5, 1.0, vFade);
        streak = mix(streak, 0.55 + 0.25 * valueNoise(vWorld.xz * 0.2 + vUv.y * 0.02), mist);
        float alpha = body * vFade * (0.22 + 0.72 * smoothstep(0.25, 0.85, streak));
        float day = daylightLevel();
        vec3 view = normalize(cameraPosition - vWorld);
        vec3 cold = mix(vec3(0.05, 0.14, 0.19), vec3(0.62, 0.78, 0.82), day);
        vec3 foam = mix(vec3(0.10, 0.22, 0.28), vec3(1.0, 0.98, 0.94), day);
        vec3 color = mix(cold, foam, smoothstep(0.45, 0.95, streak));
        color = air(color, -view, length(cameraPosition - vWorld));
        gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.85));
        #include <tonemapping_fragment>
        // a faint cool glow by night, added after the tone mapping (which would crush it): the fall is a thread of pale light on the dark island
        gl_FragColor.rgb += vec3(0.010, 0.040, 0.062) * (1.0 - day) * (0.35 + 0.9 * streak) * body * vFade;
        #include <colorspace_fragment>
      }
    `,
  });
  material.name = 'Island flowing water';
  return material;
}

export function createSpill({ island, material }) {
  const { lake, channel, lakeSpec } = island.features;
  const data = buildSpill({ lake, channel, ground: island.groundHeight, config: island.config, spill: lakeSpec.spill });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
  geometry.setAttribute('fade', new THREE.BufferAttribute(data.fades, 1));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Island waterfall';
  mesh.frustumCulled = true;
  mesh.renderOrder = 2;
  return { mesh, crest: data.crest, bottom: data.bottom, triangles: data.indices.length / 3 };
}
