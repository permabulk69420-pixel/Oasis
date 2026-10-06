import * as THREE from 'three';
import { addWindSway, WIND_GLSL, WIND, windTime, windStrength } from './wind.js';
import { exposureGlow } from './glow.js';
import { createHaloInstances } from './glow-halos.js';
import { glbLevelsFor, loadGlbLevels } from './island-glb.js';

// Draws the island's plants and landmarks (each a .glb built in headless Blender by tools/island-models/build.py, read by src/island-glb.js; src/island-flora-layout.js
// and src/island-jungle-layout.js say where). One instanced mesh per model and
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

// ONE level rule for everything but the hero objects (Kane, 6 Oct): close level to 30 m, middle level to 70 m, the far level beyond. Do not give a plant its own numbers.
const STANDARD_LOD = Object.freeze([30, 70]);
// The heroes (the giant trees, the weeping tree, the root arch) keep their own, further out.

// How each model is drawn: the level boundaries (metres: level 0 up to the first, level 1 up to the second, level 2 beyond), the draw distance, the material.
const JUNGLE_BARK = Object.freeze({ colour: 'jungle_bark_colour.jpg', normal: 'jungle_bark_normal.jpg' });
export const LEAF_ALPHA_TEST = 0.42;

export const FLORA_RENDER = Object.freeze({
  fern: { lod: STANDARD_LOD, draw: 150, double: true, sway: { name: 'island-fern', top: 0.85, reach: 0.10, lean: 0.25, bend: 1.5, radial: 0.45, rate: 0.9, flutter: 0.012, shade: 0, push: 1, pushPad: 0.4 } },
  mushrooms: { lod: STANDARD_LOD, draw: 130 },
  flower: { lod: STANDARD_LOD, draw: 150, double: true, sway: { name: 'island-flower', top: 1.65, reach: 0.12, lean: 0.3, bend: 1.8, radial: 0.12, rate: 0.55, flutter: 0.008, shade: 0, push: 1, pushPad: 0.3 } },
  weepingTree: { lod: [30, 80], draw: 300, double: true, hang: { reach: 0.42, rate: 0.55, flutter: 0.03 } },
  vines: { lod: STANDARD_LOD, draw: 130, double: true, hang: { reach: 0.3, rate: 0.7, flutter: 0.04 } },
  rootArch: { lod: [45, 120], draw: 360 },
  // (Retired by Kane on 6 Oct as low quality, so not placed and not made: the mossy cushions, the logs and driftwood, the bones, the ribcage and the standing
  // stones. A better version comes back as a new model in tools/island-models/ with its line here.)
  // The textured undergrowth (public/models/island/): cards of painted leaf (`map`: public/textures/island-leaves/<map>.png), cut out by alpha. `tint`: each copy
  // may carry its own colour multiplier (item.tint). They are many (hundreds to thousands), so they are drawn only within `draw` metres and the coarse levels are cheap.
  fernA: { lod: STANDARD_LOD, draw: 260, double: true, map: 'fern', tint: true, sway: { name: 'island-fernA', top: 0.95, reach: 0.10, lean: 0.25, bend: 1.5, radial: 0.45, rate: 0.9, flutter: 0.010, shade: 0, push: 1, pushPad: 0.45 } },
  fernB: { lod: STANDARD_LOD, draw: 260, double: true, map: 'fern', tint: true, sway: { name: 'island-fernB', top: 1.05, reach: 0.10, lean: 0.25, bend: 1.5, radial: 0.45, rate: 0.85, flutter: 0.010, shade: 0, push: 1, pushPad: 0.45 } },
  broadleafA: { lod: STANDARD_LOD, draw: 260, double: true, map: 'broadleaf', tint: true, sway: { name: 'island-broadleafA', top: 1.2, reach: 0.08, lean: 0.25, bend: 1.6, radial: 0.35, rate: 0.7, flutter: 0.008, shade: 0, push: 1, pushPad: 0.45 } },
  broadleafB: { lod: STANDARD_LOD, draw: 260, double: true, map: 'broadleaf', tint: true, sway: { name: 'island-broadleafB', top: 1.3, reach: 0.08, lean: 0.25, bend: 1.6, radial: 0.35, rate: 0.7, flutter: 0.008, shade: 0, push: 1, pushPad: 0.45 } },
  bushA: { lod: STANDARD_LOD, draw: 270, double: true, map: 'canopy', tint: true, sway: { name: 'island-bushA', top: 1.6, reach: 0.07, lean: 0.25, bend: 1.8, radial: 0.25, rate: 0.8, flutter: 0.014, shade: 0, push: 0.8, pushPad: 0.5 } },
  bushB: { lod: STANDARD_LOD, draw: 270, double: true, map: 'canopy', tint: true, sway: { name: 'island-bushB', top: 1.9, reach: 0.07, lean: 0.25, bend: 1.8, radial: 0.25, rate: 0.8, flutter: 0.014, shade: 0, push: 0.8, pushPad: 0.5 } },
  vineCurtain: { lod: STANDARD_LOD, draw: 260, double: true, map: 'vine', tint: true, hang: { reach: 0.3, rate: 0.7, flutter: 0.04 } },
  // The tall growth (public/models/island/): the trunk wears a tiling bark photo (a second material on the same mesh), the leaves are cards of the canopy and fern atlases.
  treeFernA: { lod: STANDARD_LOD, draw: 330, double: true, map: 'fern', tint: true, bark: JUNGLE_BARK, sway: { name: 'island-treeFernA', top: 4.5, reach: 0.16, lean: 0.3, bend: 1.8, radial: 0.12, rate: 0.7, flutter: 0.014, shade: 0, push: 0 } },
  treeFernB: { lod: STANDARD_LOD, draw: 330, double: true, map: 'fern', tint: true, bark: JUNGLE_BARK, sway: { name: 'island-treeFernB', top: 5.6, reach: 0.18, lean: 0.3, bend: 1.8, radial: 0.12, rate: 0.65, flutter: 0.014, shade: 0, push: 0 } },
  jungleA: { lod: [60, 150], draw: 645, double: true, map: 'canopy', tint: true, bark: JUNGLE_BARK, sway: { name: 'island-jungleA', top: 30, reach: 0.5, lean: 0.3, bend: 2.0, radial: 0, rate: 0.4, flutter: 0.05, shade: 0, push: 0 } },
  jungleB: { lod: [60, 150], draw: 645, double: true, map: 'canopy', tint: true, bark: JUNGLE_BARK, sway: { name: 'island-jungleB', top: 36, reach: 0.55, lean: 0.3, bend: 2.0, radial: 0, rate: 0.36, flutter: 0.05, shade: 0, push: 0 } },
  jungleC: { lod: [60, 150], draw: 645, double: true, map: 'canopy', tint: true, bark: JUNGLE_BARK, sway: { name: 'island-jungleC', top: 25, reach: 0.45, lean: 0.3, bend: 2.0, radial: 0, rate: 0.45, flutter: 0.05, shade: 0, push: 0 } },
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

// Leaf cards are lit from the side they are seen on by their own (smooth, bushy) vertex normals: three flips the normal on a card's back face, which would make
// the far side of every leaf dark. This takes the flip out, so both faces take the same light.
function patchFoliage(material) {
  const own = Object.prototype.hasOwnProperty.call(material, 'onBeforeCompile') ? material.onBeforeCompile : null;
  material.onBeforeCompile = function onBeforeCompileFoliage(shader, renderer) {
    (own ?? Object.getPrototypeOf(this).onBeforeCompile)?.call(this, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
  };
  const key = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => `${key ? key() : ''}|island-foliage`;
  material.needsUpdate = true;
}

// The painted leaf atlases, one texture each, shared by every material that wears it. (Not built where there is no document, so tests can make materials.)
const leafTextures = new Map();
function leafTexture(name) {
  if (typeof document === 'undefined') return null;
  if (!leafTextures.has(name)) {
    const texture = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/island-leaves/${name}.png`);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    leafTextures.set(name, texture);
  }
  return leafTextures.get(name);
}

export function createFloraMaterial(name, render = {}) {
  // Painted leaf cards are matte (Lambert): a standard material's sheen caught the low warm sun at a glancing angle and turned green ferns tan.
  const material = render.map
    ? new THREE.MeshLambertMaterial({
      name: `Island ${name}`, vertexColors: true, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0, side: render.double ? THREE.DoubleSide : THREE.FrontSide,
    })
    : new THREE.MeshStandardMaterial({
      name: `Island ${name}`, vertexColors: true, roughness: render.roughness ?? 0.88, metalness: 0,
      emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0, side: render.double ? THREE.DoubleSide : THREE.FrontSide,
    });
  patchEmit(material);
  if (render.sway) addWindSway(material, render.sway);
  if (render.hang) patchHangSway(material, render.hang);
  if (render.map) {
    const map = leafTexture(render.map);
    // A plain alpha cut-out. (Alpha to coverage was tried first, for soft multisampled edges, and in the software renderer every leaf grew a pale web of one-pixel outlines at
    // dusk and by day; the same scene with a cut-out is clean, so the cut-out it is. The cut-off sits a little under a half so far-off cards, whose mip levels average the
    // cut-outs toward a faint alpha, keep most of their leaf.)
    if (map) { material.map = map; material.alphaTest = LEAF_ALPHA_TEST; }
    patchFoliage(material);
  }
  return material;
}

// The tiling bark of the tall trees' trunks and limbs: the photo's colour and its normal map (Poly Haven Bark Brown 02, CC0), lit matte.
const barkTextures = new Map();
function barkTexture(file, colour) {
  if (typeof document === 'undefined') return null;
  if (!barkTextures.has(file)) {
    const texture = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/bark/${file}`);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    if (colour) texture.colorSpace = THREE.SRGBColorSpace;
    barkTextures.set(file, texture);
  }
  return barkTextures.get(file);
}

export function createBarkMaterial(name, render) {
  const material = new THREE.MeshLambertMaterial({ name: `Island ${name} bark`, vertexColors: true });
  const map = barkTexture(render.bark.colour, true), normalMap = barkTexture(render.bark.normal, false);
  if (map) { material.map = map; material.normalMap = normalMap; }
  // the same lean as the leaves (the bark does not flutter), so a crown never comes away from its limbs
  if (render.sway) addWindSway(material, { ...render.sway, name: `${render.sway.name}-bark`, flutter: 0 });
  return material;
}

// The three levels of a model, once its file has loaded (loadIslandModels or the flora's own update fetches them).
export function levelsFor(type) {
  const levels = glbLevelsFor(type);
  if (!levels) throw new Error(`island model ${type} is not loaded`);
  return levels;
}
export const loadIslandModels = types => Promise.all([...new Set(types)].map(type => loadGlbLevels(type)));

export function geometryFromLevel(level) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(level.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(level.normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(level.colors, 3));
  geometry.setAttribute('emit', new THREE.BufferAttribute(level.emits, 3));
  geometry.setAttribute('sway', new THREE.BufferAttribute(level.sways, 1));
  geometry.setAttribute('uv', new THREE.BufferAttribute(level.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(level.indices, 1));
  if (level.groups) for (const g of level.groups) if (g.count > 0) geometry.addGroup(g.start, g.count, g.material);       // leaf cards, then bark
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

// Which level of detail at `distance`, or -1 past the draw distance. Coming closer a plant switches EXACTLY at the boundary (30 m and 70 m for the standard rule); only
// going away does it hold the finer level a few metres past the boundary, so it does not flicker back and forth when you stand on the line.
export function floraLodFor(distance, render, previous = -1) {
  if (distance > render.draw) return -1;
  const [near, far] = render.lod, h = FLORA_LOOK.lodHysteresis;
  let lod = distance < near ? 0 : distance < far ? 1 : 2;
  if (previous >= 0 && previous < lod) {
    if (previous === 0 && distance < near + h) lod = 0;
    else if (previous <= 1 && lod === 2 && distance < far + h) lod = 1;
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
  const tint = new THREE.Color();
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
    const levels = levelsFor(type);
    const list = byType.get(type);
    const material = createFloraMaterial(type, render);
    materials.push(material);
    const bark = render.bark ? createBarkMaterial(type, render) : null;
    if (bark) materials.push(bark);
    const meshes = levels.map((level, index) => {
      const mesh = new THREE.InstancedMesh(geometryFromLevel(level), bark ? [material, bark] : material, Math.max(list.length, 1));
      mesh.name = `Island ${type} level ${index}`;
      mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = false;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (render.tint) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(list.length, 1) * 3).fill(1), 3);   // each copy's own colour
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
      const drawSq = render.draw * render.draw;
      for (const item of byType.get(type)) {
        const dx = item.x - x, dz = item.z - z, dd = dx * dx + dz * dz;
        if (forceLod === null && dd > drawSq) { item.lod = -1; continue; }      // (the many small plants: a squared distance first, a square root only for those in range)
        const d = Math.sqrt(dd);
        item.lod = forceLod !== null ? forceLod : floraLodFor(d, render, item.lod);
        if (item.lod < 0) continue;
        const mesh = entry.meshes[item.lod], slot = counts[item.lod]++;
        mesh.setMatrixAt(slot, item.matrix);
        if (mesh.instanceColor) { const t = item.tint; tint.setRGB(t ? t[0] : 1, t ? t[1] : 1, t ? t[2] : 1); mesh.setColorAt(slot, tint); }
        if (item.lod === 0 && d < FLORA_LOOK.halo.distance && entry.halos.length) nearby.push({ item, entry, d });
      }
      entry.meshes.forEach((mesh, index) => {
        mesh.count = counts[index]; mesh.visible = counts[index] > 0; mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      });
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
  const requested = new Set(), failed = new Set();
  function update(head, dt = 0) {
    if (anchor && Math.hypot(head.x - anchor.x, head.z - anchor.z) > anchor.distance) {
      if (!away) { away = true; group.visible = false; }      // far from the island: nothing is drawn (the instanced meshes are never culled by the camera)
      return;
    }
    if (away) { away = false; group.visible = true; sinceRefresh = Infinity; }
    if (queue.length) {
      // every model is a file: all are fetched at once (a few tens of KB each), and one that has arrived is put together per frame. One that will not load is left out.
      for (const type of queue) if (!requested.has(type)) { requested.add(type); loadGlbLevels(type).catch(error => { failed.add(type); onError(`[Island flora] ${type}.glb: ${error?.message || error}`); }); }
      const index = queue.findIndex(type => glbLevelsFor(type) || failed.has(type));
      if (index >= 0) { const [type] = queue.splice(index, 1); if (!failed.has(type)) try { build(type); } catch (error) { onError(`[Island flora] ${error?.message || error}`); } }
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

  // (the lab: once loadIslandModels has fetched every file)
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
