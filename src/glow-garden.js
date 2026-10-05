import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WATER, HERO_TREE, basinRadius, isInPond } from './world.js';
import { addWindSwayToModel } from './wind.js';
import { exposureGlow } from './glow.js';
import { createHaloInstances, findPodIslands } from './glow-halos.js';

// The oasis's glow plants (Kane, 5 Oct: the oasis is barren and nothing connects to the hero tree's glow). Two plants, built in
// Blender (tools/glow-plants/build_glow_plants.py): a clump of glow reeds for the water's edge, and the lantern bloom for the banks
// and the foot of the hero tree. They are drawn as instanced meshes (one draw per material per level of detail, however many
// plants), they sway with the wind like the grass, and the bulbs and pods glow the same by day and by night. At night each bulb
// also gets a soft halo (the same sprites the hero tree's pods and the loose fruit use). The open desert stays bare on purpose.

export const GLOW_GARDEN = Object.freeze({
  seed: 5105,
  reed: Object.freeze({
    name: 'Glow reeds', file: 'glow_reed', count: 22, spacing: 5.5, scale: [0.85, 1.3], drawDistance: 170,
    sway: Object.freeze({ name: 'glow-reed', top: 1.4, reach: 0.11, lean: 0.25, bend: 1.8, radial: 0.25, rate: 0.8, flutter: 0.008, shade: 0.0, push: 1, pushPad: 0.2 }),
  }),
  lantern: Object.freeze({
    name: 'Lantern blooms', file: 'lantern_bloom', bankCount: 12, groveCount: 12, spacing: 7, scale: [0.8, 1.25], drawDistance: 190,
    sway: Object.freeze({ name: 'lantern-bloom', top: 1.7, reach: 0.07, lean: 0.28, bend: 2.0, radial: 0.35, rate: 0.6, flutter: 0.01, shade: 0.0, push: 1, pushPad: 0.35 }),
  }),
  lodDistance: Object.freeze([28, 75]), // metres: the close level up to the first, the middle one up to the second, the far one beyond
  lodHysteresis: 4,
  loadDistance: 260, // from the pond: the models are fetched when you come this close
  glow: Object.freeze({ day: 0.5, night: 0.95 }), // how bright the bulbs look (src/glow.js), by day and by night
  halo: Object.freeze({ distance: 70, radiusPerBulb: 4.4, cyanSlots: 700, violetSlots: 220 }),
  refresh: Object.freeze({ metres: 2, seconds: 0.5 }), // the levels and halos are re-chosen when you have moved this far or this long has passed
  grove: Object.freeze({ near: 11, far: 28 }), // lantern blooms round the hero tree: distance from its trunk, in metres
  slopeLimit: 0.7, // metres of height across a metre either side of a plant: steeper than that and it is not placed
});

// ---- pure layout (unit tested) ----

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Where every glow plant goes: [{ kind, x, z, yaw, scale }]. `heightAt(x, z)` is the ground the player sees.
export function layoutGlowGarden(heightAt, config = GLOW_GARDEN) {
  const rng = mulberry32(config.seed);
  const items = [];
  const slope = (x, z) => Math.max(
    Math.abs(heightAt(x + 1, z) - heightAt(x - 1, z)), Math.abs(heightAt(x, z + 1) - heightAt(x, z - 1)),
  ) / 2;
  const clear = (x, z, spacing) => items.every(item => Math.hypot(item.x - x, item.z - z) >= spacing);
  const heroDistance = (x, z) => Math.hypot(x - HERO_TREE.x, z - HERO_TREE.z);
  const scaleOf = range => range[0] + rng() * (range[1] - range[0]);

  function scatter(kind, count, spacing, range, candidate, accept) {
    let placed = 0;
    for (let attempt = 0; attempt < 4000 && placed < count; attempt++) {
      const { x, z } = candidate();
      if (!clear(x, z, spacing) || !accept(x, z)) continue;
      items.push({ kind, x, z, yaw: rng() * Math.PI * 2, scale: scaleOf(range) });
      placed++;
    }
  }

  // Reeds: round the water's edge, in the shallows and on the bank.
  scatter('reed', config.reed.count, config.reed.spacing, config.reed.scale, () => {
    const a = rng() * Math.PI * 2, r = 0.9 + rng() * 0.2;
    return { x: WATER.x + Math.cos(a) * WATER.radiusX * r, z: WATER.z + Math.sin(a) * WATER.radiusZ * r };
  }, (x, z) => {
    const ground = heightAt(x, z), basin = basinRadius(x, z);
    return basin > 0.9 && basin < 1.12 && ground > WATER.y - 0.32 && ground < WATER.y + 0.8
      && heroDistance(x, z) > config.grove.near && slope(x, z) < config.slopeLimit;
  });

  // Lantern blooms on the dry bank, then in a loose grove round the hero tree.
  const dry = (x, z) => !isInPond(x, z, heightAt(x, z)) && heightAt(x, z) > WATER.y + 0.12 && slope(x, z) < config.slopeLimit;
  scatter('lantern', config.lantern.bankCount, config.lantern.spacing, config.lantern.scale, () => {
    const a = rng() * Math.PI * 2, r = 1.15 + rng() * 0.45;
    return { x: WATER.x + Math.cos(a) * WATER.radiusX * r, z: WATER.z + Math.sin(a) * WATER.radiusZ * r };
  }, (x, z) => {
    const basin = basinRadius(x, z);
    return basin > 1.12 && basin < 1.65 && dry(x, z) && heroDistance(x, z) > config.grove.near;
  });
  scatter('lantern', config.lantern.groveCount, config.lantern.spacing * 0.85, config.lantern.scale, () => {
    const a = rng() * Math.PI * 2, d = config.grove.near + rng() * (config.grove.far - config.grove.near);
    return { x: HERO_TREE.x + Math.cos(a) * d, z: HERO_TREE.z + Math.sin(a) * d };
  }, dry);
  return items;
}

// Which level of detail a plant at `distance` metres uses (0 close, 2 far), or -1 when it is too far to draw. A plant keeps the
// level it has for a few metres either side of a boundary, so it does not flicker between two.
export function glowLodFor(distance, drawDistance, previous = -1, config = GLOW_GARDEN) {
  if (distance > drawDistance) return -1;
  const [near, far] = config.lodDistance, h = config.lodHysteresis;
  let lod = distance < near ? 0 : distance < far ? 1 : 2;
  if (previous >= 0 && previous !== lod) {
    if (previous === 0 && distance < near + h) lod = 0;
    else if (previous === 1 && distance >= near - h && distance < far + h) lod = 1;
    else if (previous === 2 && distance >= far - h) lod = 2;
  }
  return lod;
}

// ---- in the game ----

const KINDS = ['reed', 'lantern'];
const BASE = `${import.meta.env?.BASE_URL ?? '/'}models/vegetation/glow-plants/`;
const LEVELS = 3;

const isGlow = material => material?.name === 'Glow' || material?.name === 'Glow violet';

export function createGlowGarden({ field, getExposure = () => 1, sunDirection = null, onError = console.warn } = {}) {
  const group = new THREE.Group();
  group.name = 'Oasis glow plants';
  const items = layoutGlowGarden(field.sample);
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), quaternion = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const item of items) {
    item.y = field.sample(item.x, item.z) - 0.04;
    item.matrix = new THREE.Matrix4().compose(
      position.set(item.x, item.y, item.z), quaternion.setFromAxisAngle(up, item.yaw), scale.setScalar(item.scale),
    );
    item.lod = -1;
  }
  const byKind = Object.fromEntries(KINDS.map(kind => [kind, items.filter(item => item.kind === kind)]));

  const cyanHalos = createHaloInstances(GLOW_GARDEN.halo.cyanSlots, { name: 'Glow plant halos', color: 0x25d0ff, maxIntensity: 0.7 });
  const violetHalos = createHaloInstances(GLOW_GARDEN.halo.violetSlots, { name: 'Glow plant violet halos', color: 0x9a55ff, maxIntensity: 0.7 });
  group.add(cyanHalos.mesh, violetHalos.mesh);
  const halosUsed = { cyan: 0, violet: 0 };

  const glowMaterials = new Set();
  const models = {}; // kind -> { levels: [{ meshes: [InstancedMesh] }], islands: { cyan: [], violet: [] } }
  let loadStarted = false, ready = false;
  let lastX = Infinity, lastZ = Infinity, sinceRefresh = Infinity;

  function load() {
    if (loadStarted) return;
    loadStarted = true;
    const loader = new GLTFLoader();
    Promise.all(KINDS.flatMap(kind => Array.from({ length: LEVELS }, async (_, level) => {
      const gltf = await loader.loadAsync(`${BASE}${GLOW_GARDEN[kind].file}_lod${level}.glb`);
      return { kind, level, source: gltf.scene };
    }))).then(loaded => {
      for (const kind of KINDS) {
        const capacity = Math.max(byKind[kind].length, 1);
        const model = { levels: [], islands: { cyan: [], violet: [] } };
        for (const { kind: k, level, source } of loaded) {
          if (k !== kind) continue;
          source.updateMatrixWorld(true);
          // every material sways with the same profile, so a bulb moves with its stalk
          addWindSwayToModel(source, () => GLOW_GARDEN[kind].sway);
          const meshes = [];
          source.traverse(object => {
            if (!object.isMesh) return;
            if (isGlow(object.material)) glowMaterials.add(object.material);
            if (level === 0 && isGlow(object.material)) {
              const islands = findPodIslands(object.geometry.attributes.position.array, object.geometry.index?.array ?? null);
              (object.material.name === 'Glow violet' ? model.islands.violet : model.islands.cyan).push(...islands);
            }
            const mesh = new THREE.InstancedMesh(object.geometry, object.material, capacity);
            mesh.name = `${GLOW_GARDEN[kind].name} level ${level} ${object.material.name}`;
            mesh.frustumCulled = false; // a few dozen plants: cheaper to always draw than to test
            mesh.castShadow = mesh.receiveShadow = false;
            mesh.count = 0;
            mesh.userData.glowGarden = true;
            group.add(mesh);
            meshes.push(mesh);
          });
          model.levels[level] = { meshes };
        }
        models[kind] = model;
      }
      ready = true;
      sinceRefresh = Infinity; // choose the levels straight away
    }).catch(error => onError(`[Oasis glow plants] The models could not be loaded: ${error?.message || error}`));
  }

  function refresh(x, z) {
    const counts = {};
    for (const kind of KINDS) {
      const model = models[kind];
      if (!model) continue;
      counts[kind] = new Array(LEVELS).fill(0);
      for (const item of byKind[kind]) {
        item.lod = glowLodFor(Math.hypot(item.x - x, item.z - z), GLOW_GARDEN[kind].drawDistance, item.lod);
        if (item.lod < 0) continue;
        for (const mesh of model.levels[item.lod].meshes) mesh.setMatrixAt(counts[kind][item.lod], item.matrix);
        counts[kind][item.lod]++;
      }
      model.levels.forEach((level, index) => {
        for (const mesh of level.meshes) { mesh.count = counts[kind][index]; mesh.instanceMatrix.needsUpdate = true; }
      });
    }
    // halos: the nearest plants' bulbs, as many as there are slots for
    const used = { cyan: 0, violet: 0 };
    const near = items.filter(item => item.lod >= 0 && Math.hypot(item.x - x, item.z - z) < GLOW_GARDEN.halo.distance)
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    for (const item of near) {
      const model = models[item.kind];
      if (!model) continue;
      for (const [name, halos, slots] of [['cyan', cyanHalos, GLOW_GARDEN.halo.cyanSlots], ['violet', violetHalos, GLOW_GARDEN.halo.violetSlots]]) {
        for (const island of model.islands[name]) {
          if (used[name] >= slots) break;
          position.set(...island.center).applyMatrix4(item.matrix);
          halos.setInstance(used[name]++, position, island.radius * item.scale * GLOW_GARDEN.halo.radiusPerBulb);
        }
      }
    }
    for (const [name, halos] of [['cyan', cyanHalos], ['violet', violetHalos]]) {
      for (let i = used[name]; i < halosUsed[name]; i++) halos.setInstance(i, position.set(0, 0, 0), 0);
      halosUsed[name] = used[name];
    }
  }

  // Every frame: the glow follows the exposure (so it looks the same whatever the light does) and the halos follow the night.
  // Now and then (when you have moved, or half a second has passed): which level of detail each plant is at.
  function update(head, dt = 0) {
    if (Math.hypot(head.x - WATER.x, head.z - WATER.z) < GLOW_GARDEN.loadDistance) load();
    if (!ready) return;
    const intensity = exposureGlow(getExposure(), GLOW_GARDEN.glow);
    for (const material of glowMaterials) material.emissiveIntensity = intensity;
    const sun = sunDirection ? sunDirection.y : -1;
    const night = 1 - THREE.MathUtils.smoothstep(sun, -0.05, 0.25);
    cyanHalos.setNight(night);
    violetHalos.setNight(night);
    sinceRefresh += dt;
    if (sinceRefresh >= GLOW_GARDEN.refresh.seconds || Math.hypot(head.x - lastX, head.z - lastZ) >= GLOW_GARDEN.refresh.metres) {
      sinceRefresh = 0; lastX = head.x; lastZ = head.z;
      refresh(head.x, head.z);
    }
  }

  return {
    group, update, items,
    get ready() { return ready; },
    get glowMaterials() { return glowMaterials; },
    debug: { refresh },
  };
}
