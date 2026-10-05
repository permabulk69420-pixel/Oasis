import * as THREE from 'three';
import { addWindSway, WIND_GLSL, WIND, windTime, windStrength } from './wind.js';
import { exposureGlow } from './glow.js';
import { createHaloInstances } from './glow-halos.js';
import { buildFloraLevels } from './island-flora-models.js';

// Draws the island's new plants and landmarks (src/island-flora-models.js builds them, src/island-flora-layout.js says where). One instanced mesh per model and
// level of detail, so a few dozen draw calls however many plants there are; each plant picks its level by distance and is left out past its draw distance. The
// bodies are plain dark standard materials (so the night fill, torch light and haze all work); the glow is a per-vertex colour (`emit`) multiplied into the
// material's emissive, so one mesh carries both and the glow follows the exposure like every other glow in the game (src/glow.js). Upright plants (ferns,
// flowers) sway with the wind module and give way to your feet and hands; hanging things (strands, vines) sway through a patch of their own that reads a
// per-vertex weight (`sway`), so a trunk stays still while its strands swing.

export const FLORA_LOOK = Object.freeze({
  glow: Object.freeze({ day: 0.5, night: 0.95 }),   // how bright the glow looks by day and by night (same as the lantern blooms)
  halo: Object.freeze({ distance: 55, cyanSlots: 360, paleSlots: 120, scale: 1 }),
  refresh: Object.freeze({ metres: 2, seconds: 0.5 }),
  lodHysteresis: 3,
});

// How each model is drawn: the level boundaries (metres: level 0 up to the first, level 1 up to the second, level 2 beyond), the draw distance, the material.
export const FLORA_RENDER = Object.freeze({
  fern: { lod: [24, 64], draw: 150, double: true, sway: { name: 'island-fern', top: 0.85, reach: 0.10, lean: 0.25, bend: 1.5, radial: 0.45, rate: 0.9, flutter: 0.012, shade: 0, push: 1, pushPad: 0.4 } },
  cushion: { lod: [16, 46], draw: 110 },
  mushrooms: { lod: [9, 26], draw: 70 },
  flower: { lod: [20, 56], draw: 150, double: true, sway: { name: 'island-flower', top: 1.65, reach: 0.12, lean: 0.3, bend: 1.8, radial: 0.12, rate: 0.55, flutter: 0.008, shade: 0, push: 1, pushPad: 0.3 } },
  fungusLog: { lod: [18, 50], draw: 120 },
  log: { lod: [18, 50], draw: 120 },
  driftwoodA: { lod: [18, 50], draw: 110 },
  driftwoodB: { lod: [18, 50], draw: 110 },
  driftwoodC: { lod: [18, 50], draw: 110 },
  weepingTree: { lod: [30, 80], draw: 300, double: true, hang: { reach: 0.42, rate: 0.55, flutter: 0.03 } },
  vines: { lod: [14, 40], draw: 130, double: true, hang: { reach: 0.3, rate: 0.7, flutter: 0.04 } },
  rootArch: { lod: [45, 120], draw: 360 },
  standingStoneA: { lod: [45, 130], draw: 360 },
  standingStoneB: { lod: [45, 130], draw: 360 },
  ribcage: { lod: [32, 95], draw: 300 },
  bonesA: { lod: [14, 40], draw: 120 },
  bonesB: { lod: [14, 40], draw: 120 },
});

// ------------------------------------------------------------------------------------------------------------------------------ materials
// Multiplies the emissive by the vertex's own glow colour.
function patchEmit(material) {
  const own = Object.prototype.hasOwnProperty.call(material, 'onBeforeCompile') ? material.onBeforeCompile : null;
  material.onBeforeCompile = function onBeforeCompileWithEmit(shader, renderer) {
    (own ?? Object.getPrototypeOf(this).onBeforeCompile)?.call(this, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 emit;\nvarying vec3 vFloraEmit;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFloraEmit = emit;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFloraEmit;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vFloraEmit;');
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ''}|island-flora-emit`;
  material.needsUpdate = true;
}

// Hanging things: each vertex has a weight (0 still, 1 free) and is pushed downwind by it, harder in a gust, with the ripple swinging it back and forth. The wind module's
// gust wave and clock, so it moves with the grass and the sand; no push from your hands (a strand is not underfoot).
function patchHangSway(material, { reach = 0.35, rate = 0.7, flutter = 0.03 } = {}) {
  const own = Object.prototype.hasOwnProperty.call(material, 'onBeforeCompile') ? material.onBeforeCompile : null;
  const [dx, dz] = new THREE.Vector2(...WIND.direction).normalize().toArray();
  material.onBeforeCompile = function onBeforeCompileWithHang(shader, renderer) {
    (own ?? Object.getPrototypeOf(this).onBeforeCompile)?.call(this, shader, renderer);
    shader.uniforms.uWindTime = windTime;
    shader.uniforms.uWindStrength = windStrength;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float sway;
        uniform float uWindTime;
        uniform float uWindStrength;
        ${WIND_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 hangBase = modelMatrix[3].xyz;
        float hangSize = 1.0;
        #ifdef USE_INSTANCING
          hangBase = ( modelMatrix * vec4( instanceMatrix[3].xyz, 1.0 ) ).xyz;
          hangSize = length( instanceMatrix[1].xyz );
        #endif
        const vec2 hangDir = vec2(${dx.toFixed(5)}, ${dz.toFixed(5)});
        float hangGust = windGust(hangBase.xz, hangDir, uWindTime);
        float hangPhase = dot(hangBase.xz, hangDir) * 0.62 - uWindTime * ${rate.toFixed(3)} * 1.9 + windHash(hangBase.xz) * 1.2;
        float hangRoll = 0.65 * sin(hangPhase) + 0.35 * sin(hangPhase * 2.17 + 1.3);
        float hangPush = sway * hangSize * uWindStrength * ${reach.toFixed(4)} * (0.3 + 0.7 * hangGust) * (0.65 + 0.55 * hangRoll);
        float hangShake = sin(uWindTime * 2.3 + dot(position, vec3(5.1, 7.3, 6.1))) * sway * hangSize * ${flutter.toFixed(4)} * (0.3 + 0.7 * hangGust) * uWindStrength;
        vec3 hangMove = vec3(hangDir.x * hangPush + hangShake * 0.6, -abs(hangPush) * 0.18, hangDir.y * hangPush + hangShake);`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        mvPosition.xyz += mat3( viewMatrix ) * hangMove;
        gl_Position = projectionMatrix * mvPosition;`);
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ''}|island-flora-hang`;
  material.needsUpdate = true;
}

export function createFloraMaterial(name, render = {}) {
  const material = new THREE.MeshStandardMaterial({
    name: `Island ${name}`, vertexColors: true, roughness: render.roughness ?? 0.88, metalness: 0,
    emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0, side: render.double ? THREE.DoubleSide : THREE.FrontSide,
  });
  patchEmit(material);
  if (render.sway) addWindSway(material, render.sway);
  if (render.hang) patchHangSway(material, render.hang);
  return material;
}

export function geometryFromLevel(level) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(level.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(level.normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(level.colors, 3));
  geometry.setAttribute('emit', new THREE.BufferAttribute(level.emits, 3));
  geometry.setAttribute('sway', new THREE.BufferAttribute(level.sways, 1));
  geometry.setAttribute('uv', new THREE.BufferAttribute(level.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(level.indices, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

// Which level of detail at `distance`, or -1 past the draw distance; keeps the previous level a few metres either side of a boundary.
export function floraLodFor(distance, render, previous = -1) {
  if (distance > render.draw) return -1;
  const [near, far] = render.lod, h = FLORA_LOOK.lodHysteresis;
  let lod = distance < near ? 0 : distance < far ? 1 : 2;
  if (previous >= 0 && previous !== lod) {
    if (previous === 0 && distance < near + h) lod = 0;
    else if (previous === 1 && distance >= near - h && distance < far + h) lod = 1;
    else if (previous === 2 && distance >= far - h) lod = 2;
  }
  return lod;
}

// ------------------------------------------------------------------------------------------------------------------------------ the whole set
// items: [{ type, x, y, z, yaw, scale (number or [x, y, z]), tiltX, tiltZ }]. `forceLod` (the lab) draws every level the same.
export function createIslandFlora({ items, getExposure = () => 1, sunDirection = null, forceLod = null, anchor = null, onError = console.warn } = {}) {
  const group = new THREE.Group();
  group.name = 'Island flora';
  const position = new THREE.Vector3(), scale = new THREE.Vector3(), quaternion = new THREE.Quaternion(), euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const local = new THREE.Vector3();
  const byType = new Map();
  for (const item of items) {
    const sc = Array.isArray(item.scale) ? item.scale : [item.scale ?? 1, item.scale ?? 1, item.scale ?? 1];
    euler.set(item.tiltX ?? 0, item.yaw ?? 0, item.tiltZ ?? 0);
    const entry = {
      ...item, lod: -1,
      matrix: new THREE.Matrix4().compose(position.set(item.x, item.y, item.z), quaternion.setFromEuler(euler), scale.set(sc[0], sc[1], sc[2])),
      size: Math.max(sc[0], sc[2]),
    };
    if (!byType.has(item.type)) byType.set(item.type, []);
    byType.get(item.type).push(entry);
  }
  const cyanHalos = createHaloInstances(FLORA_LOOK.halo.cyanSlots, { name: 'Island flora halos', color: 0x25d0ff, maxIntensity: 0.7 });
  const paleHalos = createHaloInstances(FLORA_LOOK.halo.paleSlots, { name: 'Island flora pale halos', color: 0xcfeeff, maxIntensity: 0.5 });
  group.add(cyanHalos.mesh, paleHalos.mesh);
  const halosUsed = { cyan: 0, pale: 0 };

  const built = new Map();          // type -> { levels: [mesh], halos: [...], material }
  const queue = [...byType.keys()];
  const materials = [];
  let lastX = Infinity, lastZ = Infinity, sinceRefresh = Infinity;

  function build(type) {
    if (built.has(type)) return;
    const render = FLORA_RENDER[type];
    if (!render) throw new Error(`no render settings for island model ${type}`);
    const levels = buildFloraLevels(type);
    const list = byType.get(type);
    const material = createFloraMaterial(type, render);
    materials.push(material);
    const meshes = levels.map((level, index) => {
      const mesh = new THREE.InstancedMesh(geometryFromLevel(level), material, Math.max(list.length, 1));
      mesh.name = `Island ${type} level ${index}`;
      mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = false;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(mesh);
      return mesh;
    });
    built.set(type, { meshes, halos: levels[0].halos, material });
    sinceRefresh = Infinity;
  }

  function refresh(x, z) {
    const used = { cyan: 0, pale: 0 };
    const nearby = [];
    for (const [type, entry] of built) {
      const render = FLORA_RENDER[type];
      const counts = [0, 0, 0];
      for (const item of byType.get(type)) {
        const d = Math.hypot(item.x - x, item.z - z);
        item.lod = forceLod !== null ? forceLod : floraLodFor(d, render, item.lod);
        if (item.lod < 0) continue;
        entry.meshes[item.lod].setMatrixAt(counts[item.lod]++, item.matrix);
        if (item.lod === 0 && d < FLORA_LOOK.halo.distance && entry.halos.length) nearby.push({ item, entry, d });
      }
      entry.meshes.forEach((mesh, index) => { mesh.count = counts[index]; mesh.visible = counts[index] > 0; mesh.instanceMatrix.needsUpdate = true; });
    }
    nearby.sort((a, b) => a.d - b.d);
    for (const { item, entry } of nearby) {
      for (const halo of entry.halos) {
        const name = halo.tone === 'pale' ? 'pale' : 'cyan';
        const slots = name === 'pale' ? FLORA_LOOK.halo.paleSlots : FLORA_LOOK.halo.cyanSlots;
        if (used[name] >= slots) continue;
        local.set(halo.x, halo.y, halo.z).applyMatrix4(item.matrix);
        (name === 'pale' ? paleHalos : cyanHalos).setInstance(used[name]++, local, halo.r * item.size * FLORA_LOOK.halo.scale);
      }
    }
    for (const [name, halos] of [['cyan', cyanHalos], ['pale', paleHalos]]) {
      for (let i = used[name]; i < halosUsed[name]; i++) halos.setInstance(i, local.set(0, 0, 0), 0);
      halosUsed[name] = used[name];
    }
  }

  // Every frame: the glow follows the exposure. Now and then: levels of detail and halos. One model is built per call until all are (a few milliseconds each).
  let away = false;
  function update(head, dt = 0) {
    if (anchor && Math.hypot(head.x - anchor.x, head.z - anchor.z) > anchor.distance) {
      if (!away) { away = true; group.visible = false; }      // far from the island: nothing is drawn (the instanced meshes are never culled by the camera)
      return;
    }
    if (away) { away = false; group.visible = true; sinceRefresh = Infinity; }
    if (queue.length) {
      try { build(queue.shift()); } catch (error) { onError(`[Island flora] ${error?.message || error}`); }
    }
    if (!built.size) return;
    const intensity = exposureGlow(getExposure(), FLORA_LOOK.glow);
    for (const material of materials) material.emissiveIntensity = intensity;
    const sun = sunDirection ? sunDirection.y : -1;
    const night = 1 - THREE.MathUtils.smoothstep(sun, -0.05, 0.25);
    cyanHalos.setNight(night);
    paleHalos.setNight(night);
    sinceRefresh += dt;
    if (sinceRefresh >= FLORA_LOOK.refresh.seconds || Math.hypot(head.x - lastX, head.z - lastZ) >= FLORA_LOOK.refresh.metres) {
      sinceRefresh = 0; lastX = head.x; lastZ = head.z;
      refresh(head.x, head.z);
    }
  }

  function buildAll() { while (queue.length) build(queue.shift()); }

  return {
    group, update, buildAll, items: [...byType.values()].flat(), materials, built,
    get ready() { return queue.length === 0; },
    refresh,
    triangles() {
      let total = 0;
      for (const entry of built.values()) for (const mesh of entry.meshes) total += (mesh.geometry.index.count / 3) * mesh.count;
      return total;
    },
  };
}
