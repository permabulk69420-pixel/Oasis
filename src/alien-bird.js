import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { WATER, HERO_TREE, isInPond } from './world.js';
import { createBirdPoser } from './bird-pose.js';
import { createBird } from './bird-brain.js';

// The alien bird in the game: a handful of birds that come and go through the day. One now and then flies in from
// far off, circles the pond and lands on the bank to drink; others just cross the sky. It is all scenery and
// atmosphere: nothing here changes how the game plays. The behaviour is in src/bird-brain.js and
// src/bird-flight.js; the model and its poses are in src/bird-pose.js. This file makes the scene objects, picks the
// level of detail, and draws a soft shadow so a bird in the air has some weight over the dunes.

const BASE = import.meta.env?.BASE_URL ?? '/';

export const ALIEN_BIRD = Object.freeze({
  files: [0, 1, 2].map(level => `${BASE}models/creatures/alien_bird_lod${level}.glb`),
  scale: 1.2, // alien birds run a little bigger than herons
  lodDistances: [0, 32, 95], // metres at which each model takes over from the one before
  lodHysteresis: 0.08, // a bird right on a boundary does not flicker between models
  maxBirds: 2, // at once
  firstVisit: [12, 22], // seconds of daylight before the first bird shows up
  between: [45, 90], // seconds of daylight between one bird showing up and the next
  daylightStart: 0.6, // no new bird once the light is fading
  visitChance: 0.65, // of those that show up while the player is near the oasis, how many come to the pond
  pondRange: 230, // metres: how near the pond the player has to be for a bird to come and land there
  keepClear: { x: HERO_TREE.x, z: HERO_TREE.z, r: 20 }, // birds don't land among the glowing fruit
  shadow: { opacity: 0.42, lift: 0.05, size: 1.5 },
});

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const range = (rng, [lo, hi]) => lo + (hi - lo) * rng();

// ---- pure helpers (unit tested) ----

// How much of the day's light there is, from the height of the sun: the same curve the day/night cycle uses.
export function daylightAt(sunHeight) {
  return smoothstep(-0.07, 0.14, sunHeight);
}

// Which model to show at a distance: 0 is the detailed one. `current` and the hysteresis stop flicker at a boundary.
export function pickLod(distance, current = 0, distances = ALIEN_BIRD.lodDistances, hysteresis = ALIEN_BIRD.lodHysteresis) {
  let level = current;
  while (level < distances.length - 1 && distance > distances[level + 1] * (1 + hysteresis)) level++;
  while (level > 0 && distance < distances[level] * (1 - hysteresis)) level--;
  return level;
}

// Where a bird's shadow falls: on the ground along the sun's rays, longer when the sun is low, fainter the higher
// the bird and as the light goes. `sun` points from the world towards the sun. Writes into and returns `out`.
export function shadowPlacement(out, { x, y, z, groundAt, sun, scale = 1 }) {
  const sy = Math.max(sun.y, 0.05);
  let gx = x;
  let gz = z;
  for (let i = 0; i < 2; i++) {
    const h = Math.max(0, y - groundAt(gx, gz));
    gx = x - (sun.x / sy) * h;
    gz = z - (sun.z / sy) * h;
  }
  const ground = groundAt(gx, gz);
  const height = Math.max(0, y - ground);
  out.x = gx;
  out.z = gz;
  out.ground = ground;
  out.height = height;
  out.width = (ALIEN_BIRD.shadow.size + height * 0.035) * scale;
  out.stretch = Math.min(2.6, 1 / sy);
  out.azimuth = Math.atan2(sun.x, sun.z);
  out.opacity = ALIEN_BIRD.shadow.opacity * smoothstep(0.02, 0.22, sun.y) * (1 - clamp(height / 70, 0, 0.75));
  return out;
}

// When the next bird appears, and what kind. Daylight only; never more than `maxBirds`, and only one at the pond.
export function createDirector({ rng, config = ALIEN_BIRD }) {
  let timer = range(rng, config.firstVisit);
  return {
    get timer() { return timer; },
    // Development fixtures: make the next bird due in `seconds` of daylight.
    skipTo(seconds) { timer = Math.max(0, seconds); },
    // Returns 'visit', 'passing' or null.
    update(dt, { daylight, active, visiting, nearPond }) {
      if (daylight < config.daylightStart) return null;
      timer = Math.max(0, timer - dt);
      if (timer > 0 || active >= config.maxBirds) return null;
      timer = range(rng, config.between);
      return nearPond && !visiting && rng() < config.visitChance ? 'visit' : 'passing';
    },
  };
}

// A soft round shadow, as a texture made in code (no image file, no canvas).
function createShadowTexture(size = 64) {
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = ((i + 0.5) / size) * 2 - 1;
      const v = ((j + 0.5) / size) * 2 - 1;
      const r2 = u * u + v * v;
      data[(j * size + i) * 4 + 3] = r2 < 1 ? Math.round(255 * Math.pow(1 - r2, 1.7)) : 0;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createAlienBirds({
  scene, renderer = null, camera = null, field, sunDirection, getAvoid = () => [], onError = () => {}, rng = Math.random,
}) {
  let source = rng; // swapped by the development fixtures
  const random = () => source();
  const cfg = ALIEN_BIRD;
  const scale = cfg.scale;

  const world = {
    pond: { x: WATER.x, z: WATER.z, y: WATER.y, radiusX: WATER.radiusX, radiusZ: WATER.radiusZ },
    groundAt: field.sample,
    inWater: (x, z) => isInPond(x, z, field.sample(x, z)),
    avoid: () => [cfg.keepClear, ...getAvoid()],
  };

  const director = createDirector({ rng: random });
  const ctx = { player: { x: 0, y: 0, z: 0 }, daylight: 1 };
  const avatars = [];
  const shadowGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const shadowTexture = createShadowTexture();
  const place = {};
  const shadowArgs = { x: 0, y: 0, z: 0, groundAt: field.sample, sun: sunDirection, scale }; // refilled each frame
  const directorState = { daylight: 1, active: 0, visiting: false, nearPond: false };
  const up = new THREE.Vector3(0, 1, 0);
  const normal = new THREE.Vector3();
  const qTilt = new THREE.Quaternion();
  const qTurn = new THREE.Quaternion();
  let ready = false;
  let frozen = false; // development: stop every bird where it is

  function createAvatar(templates) {
    const holder = new THREE.Group();
    holder.name = 'Alien bird';
    holder.rotation.order = 'YXZ';
    holder.scale.setScalar(scale);
    const levels = templates.map((template, i) => {
      const root = clone(template);
      root.traverse(object => { if (object.isMesh) object.frustumCulled = false; });
      root.visible = i === 0;
      holder.add(root);
      return { root, poser: createBirdPoser(root) };
    });
    const shadow = new THREE.Mesh(shadowGeometry, new THREE.MeshBasicMaterial({
      map: shadowTexture, color: 0x000000, transparent: true, depthWrite: false, opacity: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    shadow.name = 'Alien bird shadow';
    shadow.renderOrder = 2;
    shadow.frustumCulled = false;
    const brain = createBird({ world, rng: random, scale });
    return { holder, levels, shadow, brain, lod: 0, attached: false };
  }

  function attach(avatar) {
    if (avatar.attached) return;
    scene.add(avatar.holder, avatar.shadow);
    avatar.attached = true;
  }

  function detach(avatar) {
    if (!avatar.attached) return;
    scene.remove(avatar.holder, avatar.shadow);
    avatar.attached = false;
  }

  function updateAvatar(avatar, dt, head) {
    const { brain, holder, levels, shadow } = avatar;
    const state = brain.state;
    brain.update(frozen ? 0 : dt, ctx);
    if (!state.active) { detach(avatar); return; }

    holder.position.set(state.x, state.y + state.bob, state.z);
    holder.rotation.set(-state.pitch, state.yaw, state.roll);

    const distance = Math.sqrt((head.x - state.x) ** 2 + (head.y - state.y) ** 2 + (head.z - state.z) ** 2);
    const lod = pickLod(distance, avatar.lod);
    if (lod !== avatar.lod) {
      levels[avatar.lod].root.visible = false;
      levels[lod].root.visible = true;
      avatar.lod = lod;
    }
    levels[lod].poser?.apply(state.pose, state.time, state.drop);

    // the shadow, tilted to lie on the slope under it
    shadowArgs.x = state.x;
    shadowArgs.y = state.y;
    shadowArgs.z = state.z;
    shadowPlacement(place, shadowArgs);
    const d = 1.2;
    normal.set(
      -(field.sample(place.x + d, place.z) - field.sample(place.x - d, place.z)) / (2 * d),
      1,
      -(field.sample(place.x, place.z + d) - field.sample(place.x, place.z - d)) / (2 * d),
    ).normalize();
    qTilt.setFromUnitVectors(up, normal);
    qTurn.setFromAxisAngle(up, place.azimuth);
    shadow.quaternion.copy(qTilt).multiply(qTurn);
    shadow.position.set(place.x, place.ground + cfg.shadow.lift, place.z);
    shadow.scale.set(place.width, 1, place.width * place.stretch);
    shadow.material.opacity = place.opacity;
    shadow.visible = place.opacity > 0.01;
  }

  function nearestFree() {
    for (const avatar of avatars) if (!avatar.brain.state.active) return avatar;
    return null;
  }

  function update(dt, head) {
    if (!ready) return;
    ctx.daylight = daylightAt(sunDirection.y);
    ctx.player.x = head.x;
    ctx.player.y = head.y;
    ctx.player.z = head.z;

    let active = 0;
    let visiting = false;
    for (const avatar of avatars) {
      const state = avatar.brain.state;
      if (state.active) { active++; if (state.kind === 'visit') visiting = true; }
    }
    const nearPond = (head.x - WATER.x) ** 2 + (head.z - WATER.z) ** 2 < cfg.pondRange * cfg.pondRange;
    directorState.daylight = ctx.daylight;
    directorState.active = active;
    directorState.visiting = visiting;
    directorState.nearPond = nearPond;
    const next = frozen ? null : director.update(dt, directorState);
    if (next) {
      const avatar = nearestFree();
      if (avatar) {
        if (next === 'visit') avatar.brain.startVisit(ctx);
        else avatar.brain.startPassing(ctx);
        attach(avatar);
        updateAvatar(avatar, 0, head);
      }
    }
    for (const avatar of avatars) if (avatar.attached) updateAvatar(avatar, dt, head);
  }

  // ---- loading ----
  const loader = new GLTFLoader();
  Promise.all(cfg.files.map(url => loader.loadAsync(url)))
    .then(gltfs => {
      const templates = gltfs.map(gltf => gltf.scene);
      for (let i = 0; i < cfg.maxBirds; i++) avatars.push(createAvatar(templates));
      if (avatars.some(avatar => avatar.levels.some(level => !level.poser))) throw new Error('A bird model is missing a bone.');
      // Compile the shaders now, with a bird in the scene, so the first one to appear does not stall a frame.
      if (renderer && camera) {
        const warm = avatars[0];
        warm.holder.position.set(0, -1000, 0);
        scene.add(warm.holder);
        try { renderer.compile(scene, camera); } catch (error) { onError(`[Oasis bird] shader warm-up failed: ${error.message}`); }
        scene.remove(warm.holder);
      }
      ready = true;
    })
    .catch(error => onError(`[Oasis bird] The alien bird could not load: ${error.message}`));

  return {
    update,
    get ready() { return ready; },
    director,
    list() {
      return avatars.filter(avatar => avatar.brain.state.active).map(avatar => {
        const s = avatar.brain.state;
        return { kind: s.kind, mode: s.mode, phase: s.phase, x: +s.x.toFixed(1), y: +s.y.toFixed(1), z: +s.z.toFixed(1), altitude: +s.altitude.toFixed(1), lod: avatar.lod };
      });
    },
    // Development fixtures: put a bird somewhere repeatable and (optionally) stop time for it.
    debug: {
      seed(value) {
        let a = Number(value) | 0;
        source = () => {
          a = (a + 0x6D2B79F5) | 0;
          let t = Math.imul(a ^ (a >>> 15), 1 | a);
          t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      },
      freeze(value = true) { frozen = Boolean(value); },
      wait(seconds) { director.skipTo(seconds); },
      // Standing at (x, z), facing `yaw` (radians; omitted: towards the pond).
      perch({ x, z, yaw = null }) {
        const avatar = nearestFree();
        if (!avatar) return false;
        const groundY = field.sample(x, z);
        avatar.brain.startPerched({ x, z, groundY, yawToWater: yaw ?? Math.atan2(WATER.x - x, WATER.z - z) });
        attach(avatar);
        return true;
      },
      // Circling at (x, z), `altitude` metres up, at `radius`, `t` metres along the circle.
      fly({ x, z, altitude = 12, radius = 14, t = 0 }) {
        const avatar = nearestFree();
        if (!avatar) return false;
        avatar.brain.startPassing(ctx, { centre: { x, z }, radius, altitude });
        avatar.brain.seekNear('soar', ctx.player, t, ctx); // the point of the circle nearest the player, then `t` further on
        attach(avatar);
        return true;
      },
      // A visit to the pond, `t` metres along the route (or at the start of the last stretch with t = 'flare').
      visit({ t = 0 } = {}) {
        const avatar = nearestFree();
        if (!avatar) return false;
        avatar.brain.startVisit(ctx);
        const route = avatar.brain.route;
        avatar.brain.seek(t === 'flare' ? route.length - 6 : t, ctx);
        attach(avatar);
        return avatar.brain.landing;
      },
    },
  };
}
