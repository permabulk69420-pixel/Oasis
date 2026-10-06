import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createColossusBrain } from './colossus-brain.js';
import { createGait, createBodyMotion } from './colossus-gait.js';
import { createColossusRig } from './colossus-pose.js';
import { createShadowTexture, pickLod } from './alien-bird.js';
import { levelToShow } from './giant-bones.js';
import { exposureGlow } from './glow.js';

// Colossus 01 in the game: a 55 m four-legged walker that paces the gravel plain north of the oasis. It is passive: it walks, stands, breathes and looks
// about, and nothing it does affects play. The model is the owner's (public/models/colossus/, built in Blender: see tools/colossus/BRIEF.md and the check report
// beside it); the walk is entirely code (src/colossus-brain.js decides where it goes, src/colossus-gait.js where each foot is, src/colossus-pose.js turns
// that into bones). This file loads the three levels of detail, lights and hazes them like the rest of the world, puts a soft shadow on the ground
// under the body and each foot, and kicks up dust and footprints where a foot comes down.
//
// Levels: lod0 is 793k triangles and a 42 MB file, so it is only fetched when you are within a couple of hundred metres and only shown at the feet.
// lod1 and lod2 are STOPGAPS (meshopt decimations of lod0 on the same skeleton, made by tools/colossus/make_stopgap_lods.mjs) until real ones exist. lod1 and
// lod2 are also merged to a draw call per material (they are seen whole, from a distance); lod0 keeps its nine parts so the ones behind you are culled.

const BASE = import.meta.env?.BASE_URL ?? '/';

export const COLOSSUS = Object.freeze({
  files: Object.freeze([
    `${BASE}models/colossus/colossus_01_lod0.glb`,
    `${BASE}models/colossus/colossus_01_lod1_stopgap.glb`,
    `${BASE}models/colossus/colossus_01_lod2_stopgap.glb`,
  ]),
  lodDistances: Object.freeze([0, 70, 330]), // metres from the nearest part of it (see nearOffset) at which each level takes over
  lodHysteresis: 0.08,
  nearOffset: 40, // it is 128 m long and 31 m wide: distances are measured to its middle less this
  prefetch: Object.freeze([260, 800]), // lod0 starts downloading within this many metres, lod1 within the second; lod2 (1.6 MB) is fetched at once
  hideBeyond: 2800, // metres: past this nothing is drawn
  boundsPad: 16, // metres added to every part's bounding sphere (it bends outside the rest pose's bounds)
  // How bright the glowing seams and crystals look (displayed brightness: the exposure is divided out), and how much more the crystals get.
  // `far` lifts them with distance (from, to in metres; gain is the extra at `to`): a seam is a few centimetres wide, so from far off it covers a
  // fraction of a pixel and would fade out long before the animal does.
  glow: Object.freeze({ day: 0.42, night: 1.4, far: Object.freeze({ gain: 3.0, from: 60, to: 420 }) }),
  crystalBoost: 1.25,
  // The crystals' look (the owner: they looked like glowing plastic): cut facets that are glassy and dark straight on and bright at a glancing
  // angle, a glow that gathers toward the tip, a light inside that slides across the facets as you move, and a slow breath, each crystal in its
  // own time. `base` and `tip` scale the glow at either end; `rim` is the extra at the edges, `core` how much is left face on; `inner` the light
  // inside; `pulse` the breath (a share of the glow) and `rate` its speed; `body` darkens the crystal's own colour so the glow and the sky's
  // reflection carry it; `roughness` is the facets' polish.
  crystal: Object.freeze({ base: 0.12, tip: 2.4, rim: 2.8, core: 0.15, inner: 1.6, pulse: 0.35, rate: 1.6, body: 0.12, roughness: 0.06 }),
  // The model's colours are the brief's (a dark slate hide, ivory plates) and under this game's dim low sun they come out black. So: a lift on the
  // hide's colour and the plates', a soft sky light from above and warm bounce from below (times the surface colour, by day only), and a thin
  // sky-coloured sheen on the edges, so the shapes read in the shade. All of it fades out with the daylight: the night look is the glow and the
  // moonlit rim every lit object gets (src/night-fill.js).
  light: Object.freeze({ hide: 2.0, plate: 1.0, sky: 1.6, ground: Object.freeze([0.22, 0.14, 0.09]), sheen: 0.10 }),
  // Dust and prints where a foot comes down
  fx: Object.freeze({ stomp: 12, lift: 5, dustRange: 900, printRange: 1500 }),
  shadow: Object.freeze({
    body: Object.freeze({ width: 60, length: 150, opacity: 0.4, night: 0.1, shift: 20, lift: 0.22, segments: [14, 20] }),
    foot: Object.freeze({ width: 15, length: 18, opacity: 0.5, night: 0.16, lift: 0.3, segments: [6, 6] }),
    range: 1600, // metres: no shadows drawn past this
  }),
  // The same haze the ground has (src/materials.js `air`), so it does not stand out crisp against the distance
  haze: Object.freeze({ near: 0.00078, nearTo: 600, far: 0.00030 }),
});

const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// Merges every skinned mesh that shares a material into one (one draw call a material), on the same skeleton. Returns how many meshes were merged away.
export function mergeSkinnedByMaterial(root) {
  const groups = new Map();
  root.traverse(object => {
    if (!object.isSkinnedMesh || Array.isArray(object.material)) return;
    if (!groups.has(object.material)) groups.set(object.material, []);
    groups.get(object.material).push(object);
  });
  let merged = 0;
  for (const [material, meshes] of groups) {
    if (meshes.length < 2) continue;
    const geometry = mergeGeometries(meshes.map(mesh => mesh.geometry), false);
    if (!geometry) continue; // their attributes differ: leave them alone
    const first = meshes[0];
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = `${material.name || 'Colossus'} merged`;
    first.parent.add(mesh);
    mesh.bind(first.skeleton, first.bindMatrix);
    for (const old of meshes) { old.parent.remove(old); old.geometry.dispose(); }
    merged += meshes.length - 1;
  }
  return merged;
}

// Each crystal's own coordinates, for the crystal shader: an `oasisCrystal` vertex attribute of how far along the crystal the vertex is (0 at its
// base, 1 at its tip) and a number of the crystal's own (0 to 1, from where it is). The crystals are found as tools/colossus/extract_holds.py finds
// them: the vertices joined by faces or welded where they share a position (each crystal is a separate closed solid); its axis is its long
// direction and its base the wider end. Returns how many crystals it found.
export function addCrystalAttribute(geometry) {
  const position = geometry.getAttribute('position');
  const n = position.count;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  const at = new Map();
  const unique = new Uint8Array(n); // the first vertex at each position: a hard edge's copies would weigh its side more
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(position.getX(i) * 1e4)},${Math.round(position.getY(i) * 1e4)},${Math.round(position.getZ(i) * 1e4)}`;
    const first = at.get(key);
    if (first === undefined) { at.set(key, i); unique[i] = 1; } else join(first, i);
  }
  const index = geometry.index;
  if (index) for (let f = 0; f < index.count; f += 3) { join(index.getX(f), index.getX(f + 1)); join(index.getX(f), index.getX(f + 2)); }
  else for (let f = 0; f < n; f += 3) { join(f, f + 1); join(f, f + 2); }

  // the vertices of each crystal, together
  const group = new Int32Array(n);
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, groups.size);
    group[i] = groups.get(root);
  }
  const count = groups.size;
  const start = new Int32Array(count + 1);
  for (let i = 0; i < n; i++) start[group[i] + 1]++;
  for (let g = 0; g < count; g++) start[g + 1] += start[g];
  const members = new Int32Array(n);
  const fill = start.slice(0, count);
  for (let i = 0; i < n; i++) members[fill[group[i]]++] = i;

  const values = new Float32Array(n * 2);
  const p = new THREE.Vector3(), centre = new THREE.Vector3(), axis = new THREE.Vector3(), next = new THREE.Vector3();
  for (let g = 0; g < count; g++) {
    const from = start[g], to = start[g + 1];
    centre.set(0, 0, 0);
    let points = 0;
    for (let k = from; k < to; k++) if (unique[members[k]]) { centre.add(p.fromBufferAttribute(position, members[k])); points++; }
    centre.divideScalar(points);
    // its long direction: the spread's main axis, by repeated multiplication from the widest of the three
    let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
    for (let k = from; k < to; k++) {
      if (!unique[members[k]]) continue;
      p.fromBufferAttribute(position, members[k]).sub(centre);
      xx += p.x * p.x; xy += p.x * p.y; xz += p.x * p.z; yy += p.y * p.y; yz += p.y * p.z; zz += p.z * p.z;
    }
    axis.set(xx >= yy && xx >= zz ? 1 : 0, yy > xx && yy >= zz ? 1 : 0, zz > xx && zz > yy ? 1 : 0).addScalar(0.1).normalize();
    for (let it = 0; it < 24; it++) {
      next.set(xx * axis.x + xy * axis.y + xz * axis.z, xy * axis.x + yy * axis.y + yz * axis.z, xz * axis.x + yz * axis.y + zz * axis.z);
      if (next.lengthSq() < 1e-30) break;
      axis.copy(next).normalize();
    }
    let lo = Infinity, hi = -Infinity;
    for (let k = from; k < to; k++) {
      const t = p.fromBufferAttribute(position, members[k]).sub(centre).dot(axis);
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    const span = Math.max(hi - lo, 1e-6);
    // the base is the wider end: compare how far out the vertices in the first and last quarters are
    let wideLo = 0, nLo = 0, wideHi = 0, nHi = 0;
    for (let k = from; k < to; k++) {
      if (!unique[members[k]]) continue;
      p.fromBufferAttribute(position, members[k]).sub(centre);
      const t = p.dot(axis);
      const r = p.addScaledVector(axis, -t).length();
      if (t < lo + 0.25 * span) { wideLo += r; nLo++; }
      if (t > hi - 0.25 * span) { wideHi += r; nHi++; }
    }
    const flip = wideHi / Math.max(nHi, 1) > wideLo / Math.max(nLo, 1);
    const own = Math.abs(Math.sin(centre.x * 12.9898 + centre.y * 78.233 + centre.z * 37.719) * 43758.5453) % 1;
    for (let k = from; k < to; k++) {
      const i = members[k];
      const t = (p.fromBufferAttribute(position, i).sub(centre).dot(axis) - lo) / span;
      values[i * 2] = flip ? 1 - t : t;
      values[i * 2 + 1] = own;
    }
  }
  geometry.setAttribute('oasisCrystal', new THREE.BufferAttribute(values, 2));
  return count;
}

// The shader parts added to the colossus materials: the ground's haze; the day's soft sky light, bounce and edge sheen (see COLOSSUS.light); on the
// glowing materials the lift with distance; and (crystals only) the hue of the emissive taken from the vertex colour (glTF vertex colour only
// multiplies the base colour, so violet crystals would otherwise glow cyan) and their look (COLOSSUS.crystal, read from addCrystalAttribute's
// attribute: uCrystalA is base, tip, rim, core; uCrystalB is inner, pulse, rate and the clock).
export function patchColossusShader(shader, uniforms, { crystal = false, glow = crystal } = {}) {
  shader.uniforms.uHaze = uniforms.haze;
  shader.uniforms.uHazeRates = uniforms.rates;
  shader.uniforms.uSkyFill = uniforms.skyFill;
  shader.uniforms.uGroundFill = uniforms.groundFill;
  shader.uniforms.uSheen = uniforms.sheen;
  shader.uniforms.uGlowFar = uniforms.glowFar;
  const source = shader.fragmentShader;
  if (typeof source !== 'string' || source.includes('uHazeRates')) return false;
  shader.fragmentShader = source
    .replace('#include <common>', () => '#include <common>\nuniform vec3 uHaze;\nuniform vec3 uHazeRates;\nuniform vec3 uSkyFill;\nuniform vec3 uGroundFill;\nuniform vec3 uSheen;\nuniform vec3 uGlowFar;')
    .replace('#include <opaque_fragment>', () => `
  {
    // light from the sky above and the ground below, times the surface's colour, and a sheen on the edges that turn away from the eye
    vec3 skyNormal = normalize(normal);
    float skyUp = 0.5 + 0.5 * inverseTransformDirection(skyNormal, viewMatrix).y;
    float skyEdge = pow(1.0 - clamp(dot(skyNormal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
    outgoingLight += diffuseColor.rgb * mix(uGroundFill, uSkyFill, skyUp) + uSheen * skyEdge;
  }
#include <opaque_fragment>
  {
    float hazeDistance = length(vViewPosition);
    float haze = 1.0 - exp(-(min(hazeDistance, uHazeRates.z) * uHazeRates.x + max(hazeDistance - uHazeRates.z, 0.0) * uHazeRates.y));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, haze);
  }`);
  if (glow) {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', () => `#include <emissivemap_fragment>
  totalEmissiveRadiance *= 1.0 + uGlowFar.x * smoothstep(uGlowFar.y, uGlowFar.z, length(vViewPosition));`);
  }
  if (crystal) {
    shader.fragmentShader = shader.fragmentShader.replace('vec3 totalEmissiveRadiance = emissive;', `vec3 totalEmissiveRadiance = emissive;
#ifdef USE_COLOR
  {
    vec3 hue = vColor.rgb / max(max(vColor.r, max(vColor.g, vColor.b)), 0.001);
    float lumE = dot(emissive, vec3(0.2126, 0.7152, 0.0722));
    totalEmissiveRadiance = hue * min(lumE / max(dot(hue, vec3(0.2126, 0.7152, 0.0722)), 0.2), lumE * 5.0);
  }
#endif`);
    shader.uniforms.uCrystalA = uniforms.crystalA;
    shader.uniforms.uCrystalB = uniforms.crystalB;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', () => '#include <common>\nattribute vec2 oasisCrystal;\nvarying vec2 vCrystal;')
      .replace('#include <begin_vertex>', () => '#include <begin_vertex>\n  vCrystal = oasisCrystal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', () => '#include <common>\nvarying vec2 vCrystal;\nuniform vec4 uCrystalA;\nuniform vec4 uCrystalB;')
      .replace('#include <emissivemap_fragment>', () => `#include <emissivemap_fragment>
  {
    // a cut crystal: dim face on, bright at a glancing angle; the glow gathers toward the tip; a light inside that each facet sees in another
    // place, so it slides across them as you move; a slow breath, each crystal in its own time; and the edges toward the tip burn white
    float along = vCrystal.x, own = vCrystal.y;
    vec3 eye = normalize(vViewPosition);
    float facing = abs(dot(normal, eye));
    float rim = pow(1.0 - facing, 2.0);
    float body = mix(uCrystalA.x, uCrystalA.y, pow(along, 1.4));
    float inner = 0.5 + 0.5 * sin(along * 7.0 + facing * 5.0 + dot(normal, vec3(1.7, 2.3, 1.1)) + own * 6.2832);
    float breath = 1.0 + uCrystalB.y * sin(uCrystalB.w * uCrystalB.z + own * 6.2832);
    vec3 glowColour = totalEmissiveRadiance;
    totalEmissiveRadiance = glowColour * (body * mix(uCrystalA.w, 1.0, rim) + uCrystalB.x * inner * inner * along + uCrystalA.z * rim) * breath;
    totalEmissiveRadiance += vec3(dot(glowColour, vec3(0.2126, 0.7152, 0.0722))) * rim * along * 0.6;
  }`);
  }
  return true;
}

// A flat soft-edged decal that lies on the ground: a grid of vertices rewritten every frame to follow the ground's height, so a long shadow does
// not sink into a swell or hang over a dip.
function createGroundDecal({ texture, segments, lift, order }) {
  const [sx, sz] = segments;
  const geometry = new THREE.PlaneGeometry(1, 1, sx, sz);
  const position = geometry.attributes.position;
  const across = new Float32Array(position.count);
  const along = new Float32Array(position.count);
  for (let i = 0; i < position.count; i++) { across[i] = position.getX(i); along[i] = -position.getY(i); }
  const material = new THREE.MeshBasicMaterial({
    map: texture, color: 0x000000, transparent: true, depthWrite: false, opacity: 0, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  position.setUsage(THREE.DynamicDrawUsage);
  return {
    mesh,
    place(cx, cz, yaw, width, length, groundAt, opacity) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const array = position.array;
      for (let i = 0; i < position.count; i++) {
        const lateral = across[i] * width, ahead = along[i] * length;
        const x = cx + lateral * c + ahead * s;
        const z = cz - lateral * s + ahead * c;
        array[i * 3] = x; array[i * 3 + 1] = groundAt(x, z) + lift; array[i * 3 + 2] = z;
      }
      position.needsUpdate = true;
      material.opacity = opacity;
      mesh.visible = opacity > 0.004;
    },
  };
}

export function createColossus({
  scene, renderer = null, camera = null, field, sun, getExposure = () => 1, rng = Math.random, onError = () => {}, puffs = null, prints = null,
  onFootfall = null, load = url => new GLTFLoader().loadAsync(url),
}) {
  const cfg = COLOSSUS;
  const brain = createColossusBrain({ rng });
  const state = brain.state;
  const motion = createBodyMotion();
  let gait = null; // made when the first model arrives, from that skeleton's own leg positions
  const holder = new THREE.Group();
  holder.name = 'Colossus 01';
  holder.rotation.order = 'YXZ';
  const levels = [null, null, null]; // { root, rig, glow: [{ material, boost }] }
  const promises = [null, null, null];
  const loaded = [false, false, false];
  const uniforms = {
    haze: { value: new THREE.Vector3(0.3, 0.3, 0.35) },
    rates: { value: new THREE.Vector3(cfg.haze.near, cfg.haze.far, cfg.haze.nearTo) },
    skyFill: { value: new THREE.Vector3() },
    groundFill: { value: new THREE.Vector3() },
    sheen: { value: new THREE.Vector3() },
    glowFar: { value: new THREE.Vector3(cfg.glow.far.gain, cfg.glow.far.from, cfg.glow.far.to) },
    crystalA: { value: new THREE.Vector4() },
    crystalB: { value: new THREE.Vector4() },
  };
  // the look's numbers, copied so a screenshot session can try others (debug.tune) without a reload
  const look = { ...cfg.light, ground: [...cfg.light.ground], glow: { ...cfg.glow }, crystal: { ...cfg.crystal } };
  const tints = []; // { material, base, kind }: the hide and plate colours as the model has them
  const glowMaterials = [];
  const crystalMaterials = []; // { material, base }: the crystal colour as the model has it
  let crystalClock = 0;
  let lod = 2;
  let shown = -1;
  let attached = false;
  let appliedGlow = -1;
  let frozen = false;
  let forced = -1;
  let ready = false;
  let distance = Infinity;
  const shadowTexture = createShadowTexture();
  const bodyShadow = createGroundDecal({ texture: shadowTexture, segments: cfg.shadow.body.segments, lift: cfg.shadow.body.lift, order: 1 });
  const footShadows = Array.from({ length: 4 }, () => createGroundDecal({ texture: shadowTexture, segments: cfg.shadow.foot.segments, lift: cfg.shadow.foot.lift, order: 2 }));
  bodyShadow.mesh.name = 'Colossus shadow';
  footShadows.forEach((s, i) => { s.mesh.name = `Colossus foot shadow ${i}`; });

  function prepare(root, level) {
    const own = [];
    root.traverse(object => {
      if (!object.isMesh) return;
      object.castShadow = object.receiveShadow = false;
      const material = object.material;
      if (material && !own.includes(material)) own.push(material);
      if (material?.name === 'Colossus crystal') addCrystalAttribute(object.geometry);
    });
    if (level > 0) mergeSkinnedByMaterial(root);
    root.traverse(object => {
      if (!object.isSkinnedMesh) return;
      // the rest pose's bounds, grown: it walks and bends outside them
      object.geometry.computeBoundingSphere();
      object.boundingSphere = object.geometry.boundingSphere.clone();
      object.boundingSphere.radius += cfg.boundsPad;
      object.frustumCulled = true;
    });
    const glow = [];
    for (const material of own) {
      const crystal = material.name === 'Colossus crystal';
      const glows = crystal || material.name === 'Colossus glow';
      if (glows) {
        glow.push({ material, boost: crystal ? cfg.crystalBoost : 1 });
        glowMaterials.push({ material, boost: crystal ? cfg.crystalBoost : 1 });
      }
      if (crystal) {
        crystalMaterials.push({ material, base: material.color.clone() });
        material.flatShading = true; // cut facets, each catching the sky its own way
      }
      if (material.name === 'Colossus hide' || material.name === 'Colossus plate') {
        tints.push({ material, base: material.color.clone(), kind: material.name === 'Colossus hide' ? 'hide' : 'plate' });
      }
      // chain to the material type's own patch (the moonlit night fill every standard material gets) before ours
      material.onBeforeCompile = function onBeforeCompileColossus(shader, rendererArg) {
        Object.getPrototypeOf(this).onBeforeCompile?.call(this, shader, rendererArg);
        patchColossusShader(shader, uniforms, { crystal, glow: glows });
      };
      material.customProgramCacheKey = () => `oasis-colossus${crystal ? '-crystal' : glows ? '-glow' : ''}`;
      material.needsUpdate = true;
    }
    applyTints();
    return glow;
  }

  function applyTints() {
    for (const { material, base, kind } of tints) material.color.copy(base).multiplyScalar(look[kind]);
    const c = look.crystal;
    for (const { material, base } of crystalMaterials) { material.color.copy(base).multiplyScalar(c.body); material.roughness = c.roughness; }
    uniforms.crystalA.value.set(c.base, c.tip, c.rim, c.core);
    uniforms.crystalB.value.set(c.inner, c.pulse, c.rate, crystalClock);
  }

  function attach(level, gltf) {
    const root = gltf.scene;
    const glow = prepare(root, level);
    root.visible = false;
    holder.add(root);
    const rig = createColossusRig(root, holder);
    if (!rig) { holder.remove(root); throw new Error(`Colossus level ${level} is missing a bone.`); }
    levels[level] = { root, rig, glow };
    if (!gait) {
      const legs = Object.values(rig.legs).map(leg => ({ name: leg.name, home: leg.home, offset: { BL: 0, FL: 0.25, BR: 0.5, FR: 0.75 }[leg.name] }));
      gait = createGait({ legs, groundAt: field.sample });
    }
    // compile the shaders now, with the level in the scene, so it does not stall a frame when it first comes into view
    if (renderer && camera) {
      const wasAttached = attached;
      holder.position.set(0, -1000, 0);
      root.visible = true;
      if (!wasAttached) scene.add(holder);
      try { renderer.compile(scene, camera); } catch (error) { onError(`[Oasis colossus] shader warm-up failed: ${error.message}`); }
      if (!wasAttached) scene.remove(holder);
      root.visible = false;
    }
    loaded[level] = true;
    shown = -2; // choose again
    ready = true;
  }

  function request(level) {
    if (promises[level]) return promises[level];
    promises[level] = Promise.resolve()
      .then(() => load(cfg.files[level]))
      .then(gltf => { attach(level, gltf); })
      .catch(error => onError(`[Oasis colossus] Colossus level ${level} could not load: ${error.message}`));
    return promises[level];
  }
  request(2);

  const sunLevel = () => sun?.value?.y ?? 0.3;
  function updateHaze() {
    const y = sunLevel();
    const day = smooth(-0.07, 0.16, y), high = smooth(0.02, 0.24, y);
    // the sky's colour at the horizon (src/materials.js skyColor, without the glow round the sun)
    const r = 0.006 + (0.30 + (0.34 - 0.30) * high - 0.006) * day;
    const g = 0.008 + (0.20 + (0.37 - 0.20) * high - 0.008) * day;
    const b = 0.014 + (0.21 + (0.42 - 0.21) * high - 0.014) * day;
    uniforms.haze.value.set(r, g, b);
    // the sky's own colour is the light that falls on it from above, and its sheen; the ground's bounce is warm and goes with the daylight
    uniforms.skyFill.value.set(r, g, b).multiplyScalar(look.sky);
    uniforms.sheen.value.set(r, g, b).multiplyScalar(look.sheen);
    uniforms.groundFill.value.set(look.ground[0], look.ground[1], look.ground[2]).multiplyScalar(day);
  }
  function updateGlow() {
    const intensity = exposureGlow(getExposure(), look.glow);
    if (Math.abs(intensity - appliedGlow) > 0.01 * intensity) {
      for (const { material, boost } of glowMaterials) material.emissiveIntensity = intensity * boost;
      appliedGlow = intensity;
    }
  }

  function footfalls() {
    const out = gait.out;
    for (let k = 0; k < out.eventCount; k++) {
      const e = out.events[k];
      const leg = gait.legs[e.leg];
      if (e.kind === 'down') {
        if (distance < cfg.fx.dustRange) puffs?.stomp(e.x, e.z, { size: cfg.fx.stomp, strength: e.power });
        if (distance < cfg.fx.printRange) prints?.plantColossus(e.x, e.z, leg.pyaw, leg.hx >= 0 ? 1 : -1);
        onFootfall?.({ x: e.x, y: e.y, z: e.z, power: e.power, distance });
      } else if (distance < cfg.fx.dustRange) puffs?.trickle(e.x, e.z, { size: cfg.fx.lift, count: 3, radius: 1.4 });
    }
  }

  function shadows() {
    const S = cfg.shadow;
    const day = smooth(-0.05, 0.2, sunLevel());
    const s = sun?.value;
    let ax = 0, az = 0;
    if (s) { const h = Math.hypot(s.x, s.z) || 1; ax = -s.x / h; az = -s.z / h; } // away from the sun
    const k = S.body.shift * day;
    bodyShadow.place(state.x + ax * k, state.z + az * k, state.yaw, S.body.width, S.body.length, field.sample, S.body.night + (S.body.opacity - S.body.night) * day);
    for (let i = 0; i < 4; i++) {
      const g = gait.legs[i];
      // dark while it stands on the ground, fading as the foot lifts away
      const planted = 1 - smooth(0, 6, g.raise);
      footShadows[i].place(g.x, g.z, g.yaw, S.foot.width, S.foot.length, field.sample, (S.foot.night + (S.foot.opacity - S.foot.night) * day) * planted);
    }
  }

  function setShown(level) {
    if (level === shown) return;
    for (let l = 0; l < levels.length; l++) if (levels[l]) levels[l].root.visible = l === level;
    shown = level;
  }

  function simulate(dt) {
    if (!frozen) brain.update(dt);
    if (!gait) return false;
    gait.update(state, dt);
    motion.update(state, gait.out, dt);
    return true;
  }

  function update(dt, head) {
    updateGlow();
    if (!(dt >= 0)) return;
    crystalClock = (crystalClock + dt) % 1e4;
    uniforms.crystalB.value.w = crystalClock;
    distance = Math.hypot(head.x - state.x, head.z - state.z);
    const visible = ready && distance < cfg.hideBeyond;
    if (!visible) {
      if (!frozen) brain.update(dt); // it carries on out of sight
      if (attached) { scene.remove(holder, bodyShadow.mesh, ...footShadows.map(s => s.mesh)); attached = false; }
      return;
    }
    const near = Math.max(0, distance - cfg.nearOffset);
    if (near < cfg.prefetch[1] * 1.0) request(1);
    if (near < cfg.prefetch[0]) request(0);
    lod = pickLod(near, lod, cfg.lodDistances, cfg.lodHysteresis);
    const wanted = forced >= 0 ? forced : lod;
    const show = levelToShow(wanted, loaded);
    if (show < 0) return;
    if (!attached) { scene.add(holder, bodyShadow.mesh, ...footShadows.map(s => s.mesh)); attached = true; }
    setShown(show);
    if (!simulate(dt)) return;
    updateHaze();
    holder.position.set(state.x, gait.out.groundY, state.z);
    holder.rotation.set(0, state.yaw, 0);
    levels[show].rig.apply(motion.out, gait.out, dt);
    footfalls();
    if (distance < cfg.shadow.range) shadows();
    else { bodyShadow.mesh.visible = false; for (const s of footShadows) s.mesh.visible = false; }
  }

  return {
    update,
    get ready() { return ready; },
    // the model on show (its bones are the climbing holds' frames: src/colossus-climb.js), or null; and how far you are from its middle
    get shownRoot() { return attached && shown >= 0 && levels[shown] ? levels[shown].root : null; },
    get distance() { return distance; },
    brain,
    state,
    list() {
      return ready ? [{ mode: state.mode, x: +state.x.toFixed(1), z: +state.z.toFixed(1), yaw: +state.yaw.toFixed(2), speed: +state.speed.toFixed(2), cycles: +state.cycles.toFixed(2), shown, loaded: loaded.slice(), distance: Math.round(distance) }] : [];
    },
    // development: pose it for a screenshot, or run it forward without drawing
    debug: {
      get gait() { return gait; },
      motion,
      levels,
      load: request,
      freeze(on = true) { frozen = on; },
      lod(level = -1) { forced = level; },
      // try other numbers for the look without a reload: { hide, plate, sky, sheen, ground: [r, g, b], glow: { day, night }, crystal: { ... } }
      tune(values = {}) {
        const { glow: glowValues, ground, crystal, ...rest } = values;
        Object.assign(look, rest);
        if (crystal) Object.assign(look.crystal, crystal);
        if (ground) look.ground = [...ground];
        if (glowValues) Object.assign(look.glow, glowValues);
        applyTints();
        appliedGlow = -1;
        updateHaze();
        uniforms.glowFar.value.set(look.glow.far.gain, look.glow.far.from, look.glow.far.to);
        return look;
      },
      // `walk` sets it walking straight ahead (so `advance` takes steps), at `speed`
      pose({ x = state.x, z = state.z, yaw = state.yaw, cycles = state.cycles, speed = state.speed, turn = state.turn, calm = 0, gaze = null, walk = false } = {}) {
        brain.place(x, z, yaw);
        state.cycles = cycles; state.speed = speed; state.turn = turn; state.calm = calm;
        if (walk) {
          state.mode = 'walk'; state.moving = true; state.standFor = 0;
          state.target.x = x + Math.sin(yaw) * 1500; state.target.z = z + Math.cos(yaw) * 1500;
        }
        if (gaze) { state.gaze.yaw = gaze[0]; state.gaze.pitch = gaze[1]; state.gazeTimer = 1e9; }
        gait?.reseat(state);
      },
      // runs the walk forward without drawing, with its dust and footprints, so a screenshot can follow a few steps
      advance(seconds, step = 1 / 30) {
        if (!gait) return;
        for (let t = 0; t < seconds; t += step) {
          brain.update(step);
          gait.update(state, step);
          motion.update(state, gait.out, step);
          footfalls();
          puffs?.update(step);
        }
      },
    },
  };
}
