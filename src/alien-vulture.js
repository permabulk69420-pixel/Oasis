import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { pickLod } from './alien-bird.js';
import { createVulturePoser, VULTURE_POSE } from './vulture-pose.js';

// Alien vultures (the owner's model, src/vulture-pose.js): a few of them always up over the desert, circling on the rising air the way vultures
// do, gliding on their four wings with a few slow beats now and then, banked into the turn. Each circle drifts with the wind; one that has drifted
// too far from you is put back somewhere out on the sand around you. Scenery only: nothing here changes how the game plays.

const BASE = import.meta.env?.BASE_URL ?? '/';

export const ALIEN_VULTURE = Object.freeze({
  files: [0, 1, 2].map(level => `${BASE}models/creatures/alien_vulture_lod${level}.glb`),
  count: 3,
  scale: 1.4, // the model is about 5 m across its front wings; these are big
  lodDistances: [0, 45, 140], // metres at which each model takes over from the one before
  lodHysteresis: 0.08,
  radius: [28, 70], // metres: each circle's size
  altitude: [38, 95], // metres above the ground at the circle's middle
  climb: 0.6, // metres a second up or down while it changes height
  speed: [9, 13], // metres a second along the circle
  drift: 1.6, // metres a second the circle drifts with the wind
  place: [180, 520], // metres from you that a new circle is put
  leave: 750, // metres: a circle further than this from you is put back nearer
  keepOff: 40, // metres: no circle over somewhere avoid() says to keep off (the sky island), with this margin
  flaps: Object.freeze({ every: [7, 18], beats: [2, 4], rate: 1.1 }), // seconds between bouts; wingbeats in a bout; beats a second
});

const range = (rng, [lo, hi]) => lo + (hi - lo) * rng();
const TAU = Math.PI * 2;

// ---- the flight (pure, unit tested) ----

// One vulture's circling. `groundAt(x, z)` is the ground's height; `avoid(x, z)` says whether to keep off a place. update() moves it on and fills
// `state`: where it is, which way it faces (yaw: 0 is +z, positive turns to its left), its bank and pitch, and its pose.
export function createVultureFlight({ rng, groundAt, avoid = () => false, config = ALIEN_VULTURE }) {
  const c = config;
  const state = {
    x: 0, y: 0, z: 0, yaw: 0, roll: 0, pitch: 0,
    cx: 0, cz: 0, radius: 40, angle: 0, turn: 1, speed: 11, altitude: 60, height: 60, wantHeight: 60,
    driftX: 0, driftZ: 0, flapIn: 5, beats: 0, wing: 0,
    pose: { ...VULTURE_POSE },
  };

  function clear(x, z, r) {
    if (avoid(x, z)) return false;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      if (avoid(x + Math.sin(a) * (r + c.keepOff), z + Math.cos(a) * (r + c.keepOff))) return false;
    }
    return true;
  }

  // a new circle somewhere out on the sand around (px, pz)
  function place(px, pz) {
    state.radius = range(rng, c.radius);
    for (let tries = 0; tries < 12; tries++) {
      const a = rng() * TAU, d = range(rng, c.place);
      const x = px + Math.sin(a) * d, z = pz + Math.cos(a) * d;
      if (!clear(x, z, state.radius)) continue;
      state.cx = x; state.cz = z;
      break;
    }
    state.angle = rng() * TAU;
    state.turn = rng() < 0.5 ? 1 : -1;
    state.speed = range(rng, c.speed);
    state.height = state.wantHeight = range(rng, c.altitude);
    const wind = rng() * TAU;
    state.driftX = Math.sin(wind) * c.drift;
    state.driftZ = Math.cos(wind) * c.drift;
    state.flapIn = range(rng, c.flaps.every) * rng();
    state.beats = 0;
    step(0);
  }

  function step(dt) {
    state.cx += state.driftX * dt;
    state.cz += state.driftZ * dt;
    // round the circle; the height eases toward one it picks now and then, as the rising air is stronger or weaker
    state.angle += (state.turn * state.speed / state.radius) * dt;
    if (rng() < dt / 25) state.wantHeight = range(rng, c.altitude);
    const dh = THREE.MathUtils.clamp(state.wantHeight - state.height, -c.climb * dt, c.climb * dt);
    state.height += dh;
    const ground = groundAt(state.cx, state.cz);
    state.x = state.cx + Math.sin(state.angle) * state.radius;
    state.z = state.cz + Math.cos(state.angle) * state.radius;
    state.y = ground + state.height;
    // facing along the circle; banked into it (the angle a turn of this size needs at this speed); nose up a touch while climbing
    state.yaw = Math.atan2(Math.cos(state.angle), -Math.sin(state.angle)) + (state.turn < 0 ? Math.PI : 0);
    state.roll = -state.turn * Math.atan(state.speed * state.speed / (state.radius * 9.8));
    state.pitch = dt > 0 ? THREE.MathUtils.clamp(dh / dt / state.speed, -0.2, 0.2) : 0;

    // a few slow beats now and then, then a glide
    const pose = state.pose;
    if (state.beats > 0) {
      state.wing += dt * c.flaps.rate * TAU;
      if (state.wing >= TAU) { state.wing -= TAU; state.beats--; }
    } else {
      state.wing = 0;
      state.flapIn -= dt;
      if (state.flapIn <= 0) { state.beats = Math.round(range(rng, c.flaps.beats)); state.flapIn = range(rng, c.flaps.every); }
    }
    const beating = state.beats > 0 ? 1 : 0;
    pose.flap = beating * 0.6 * Math.sin(state.wing);
    pose.flex = beating * -0.35 * Math.sin(state.wing - 0.9);
    pose.rear = beating * 0.4 * Math.sin(state.wing - 1.2);
    pose.tail = 0.08 * Math.sin(state.wing * 0.5) + state.pitch * 0.5;
  }

  return {
    state,
    place,
    // moves it on by dt seconds; (px, pz) is you, to put it back nearer if it has drifted too far
    update(dt, px, pz) {
      if (Math.hypot(state.cx - px, state.cz - pz) > c.leave) { place(px, pz); return; }
      step(dt);
    },
  };
}

// ---- in the scene ----

export function createAlienVultures({ scene, renderer = null, camera = null, field, avoid = () => false, onError = () => {}, rng = Math.random }) {
  const cfg = ALIEN_VULTURE;
  const birds = [];
  let ready = false;
  let placed = false;

  const loader = new GLTFLoader();
  Promise.all(cfg.files.map(url => loader.loadAsync(url)))
    .then(gltfs => {
      for (let i = 0; i < cfg.count; i++) {
        const holder = new THREE.Group();
        holder.name = 'Alien vulture';
        holder.rotation.order = 'YXZ';
        holder.scale.setScalar(cfg.scale);
        const levels = gltfs.map((gltf, level) => {
          const root = clone(gltf.scene);
          root.traverse(object => { if (object.isMesh) object.frustumCulled = false; });
          root.visible = level === 0;
          holder.add(root);
          return { root, poser: createVulturePoser(root) };
        });
        if (levels.some(level => !level.poser)) throw new Error('a vulture model is missing a bone');
        scene.add(holder);
        birds.push({ holder, levels, lod: 0, flight: createVultureFlight({ rng, groundAt: field.sample, avoid }) });
      }
      // compile the shaders now, so the first one in view does not stall a frame
      if (renderer && camera) {
        try { renderer.compile(scene, camera); } catch (error) { onError(`[Oasis vulture] shader warm-up failed: ${error.message}`); }
      }
      ready = true;
    })
    .catch(error => onError(`[Oasis vulture] The alien vulture could not load: ${error.message}`));

  function update(dt, head) {
    if (!ready) return;
    for (const bird of birds) {
      if (!placed) bird.flight.place(head.x, head.z);
      bird.flight.update(dt, head.x, head.z);
      const s = bird.flight.state;
      bird.holder.position.set(s.x, s.y, s.z);
      bird.holder.rotation.set(-s.pitch, s.yaw, s.roll);
      const distance = Math.hypot(head.x - s.x, head.y - s.y, head.z - s.z);
      const lod = pickLod(distance, bird.lod, cfg.lodDistances, cfg.lodHysteresis);
      if (lod !== bird.lod) { bird.levels[bird.lod].root.visible = false; bird.levels[lod].root.visible = true; bird.lod = lod; }
      bird.levels[lod].poser.apply(s.pose);
    }
    placed = true;
  }

  return {
    update,
    get ready() { return ready; },
    list: () => birds.map(b => ({ x: Math.round(b.flight.state.x), y: Math.round(b.flight.state.y), z: Math.round(b.flight.state.z), lod: b.lod })),
  };
}
