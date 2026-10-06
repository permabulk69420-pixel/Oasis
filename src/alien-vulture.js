import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { pickLod } from './alien-bird.js';
import { AREA } from './zones.js';
import { createVulturePoser, VULTURE_POSE } from './vulture-pose.js';

// Alien vultures (the owner's model, src/vulture-pose.js): a few of them that live over the Colossus's gravel plain, circling high on the rising
// air, gliding on their four wings with a few slow beats now and then, banked into the turn. Each circle wanders slowly from one place on the
// plain to another; they never leave it and follow nothing. Scenery only: nothing here changes how the game plays.

const PLAIN = AREA.flats[0];

const BASE = import.meta.env?.BASE_URL ?? '/';

export const ALIEN_VULTURE = Object.freeze({
  files: [0, 1, 2].map(level => `${BASE}models/creatures/alien_vulture_lod${level}.glb`),
  count: 3,
  scale: 1.4, // the model is about 5 m across its front wings; these are big
  lodDistances: [0, 45, 140], // metres at which each model takes over from the one before
  lodHysteresis: 0.08,
  hideBeyond: 2800, // metres: past this they are not drawn (as the Colossus is not)
  radius: [40, 90], // metres: each circle's size
  altitude: [75, 130], // metres above the ground at the circle's middle (the Colossus is 55 m tall)
  climb: 0.6, // metres a second up or down while it changes height
  speed: [9, 13], // metres a second along the circle
  // where they live: the middle of the Colossus's plain (src/zones.js), a circle's middle never outside this ellipse
  area: Object.freeze({ x: PLAIN.x, z: PLAIN.z, rx: PLAIN.rx * 0.6, rz: PLAIN.rz * 0.6 }),
  wander: 1.5, // metres a second a circle's middle drifts toward the next place on the plain it goes to
  flaps: Object.freeze({ every: [7, 18], beats: [2, 4], rate: 1.1 }), // seconds between bouts; wingbeats in a bout; beats a second
});

const range = (rng, [lo, hi]) => lo + (hi - lo) * rng();
const TAU = Math.PI * 2;

// ---- the flight (pure, unit tested) ----

// One vulture circling over the plain. `groundAt(x, z)` is the ground's height. start() puts it somewhere on the plain; update(dt) moves it on and
// fills `state`: where it is, which way it faces (yaw: 0 is +z, positive turns to its left), its bank and pitch, and its pose.
export function createVultureFlight({ rng, groundAt, config = ALIEN_VULTURE }) {
  const c = config;
  const state = {
    x: 0, y: 0, z: 0, yaw: 0, roll: 0, pitch: 0,
    cx: 0, cz: 0, tx: 0, tz: 0, radius: 60, angle: 0, turn: 1, speed: 11, height: 100, wantHeight: 100,
    flapIn: 5, beats: 0, wing: 0,
    pose: { ...VULTURE_POSE },
  };

  // a place on the plain, evenly over its ellipse
  function somewhere() {
    const a = rng() * TAU, r = Math.sqrt(rng());
    return [c.area.x + Math.sin(a) * r * c.area.rx, c.area.z + Math.cos(a) * r * c.area.rz];
  }

  function start() {
    state.radius = range(rng, c.radius);
    [state.cx, state.cz] = somewhere();
    [state.tx, state.tz] = somewhere();
    state.angle = rng() * TAU;
    state.turn = rng() < 0.5 ? 1 : -1;
    state.speed = range(rng, c.speed);
    state.height = state.wantHeight = range(rng, c.altitude);
    state.flapIn = range(rng, c.flaps.every) * rng();
    state.beats = 0;
    place();
    state.yaw = Math.atan2(state.turn * Math.cos(state.angle), -state.turn * Math.sin(state.angle));
  }

  function place() {
    state.x = state.cx + Math.sin(state.angle) * state.radius;
    state.z = state.cz + Math.cos(state.angle) * state.radius;
    state.y = groundAt(state.cx, state.cz) + state.height;
  }

  function update(dt) {
    if (!(dt > 0)) return;
    const x0 = state.x, z0 = state.z;
    // the circle's middle drifts to the next place on the plain, then picks another
    const gx = state.tx - state.cx, gz = state.tz - state.cz, gap = Math.hypot(gx, gz), most = c.wander * dt;
    if (gap <= most) { state.cx = state.tx; state.cz = state.tz; [state.tx, state.tz] = somewhere(); }
    else { state.cx += gx * most / gap; state.cz += gz * most / gap; }
    // round the circle; the height eases toward one it picks now and then, as the rising air is stronger or weaker
    state.angle += (state.turn * state.speed / state.radius) * dt;
    if (rng() < dt / 25) state.wantHeight = range(rng, c.altitude);
    const dh = THREE.MathUtils.clamp(state.wantHeight - state.height, -c.climb * dt, c.climb * dt);
    state.height += dh;
    place();
    // facing the way it actually goes; banked into the turn (the angle a turn of this size needs at this speed); nose up a touch while climbing
    if (Math.hypot(state.x - x0, state.z - z0) > 1e-6) state.yaw = Math.atan2(state.x - x0, state.z - z0);
    state.roll = -state.turn * Math.atan(state.speed * state.speed / (state.radius * 9.8));
    state.pitch = THREE.MathUtils.clamp(dh / dt / state.speed, -0.2, 0.2);

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

  return { state, start, update };
}

// ---- in the scene ----

export function createAlienVultures({ scene, renderer = null, camera = null, field, onError = () => {}, rng = Math.random }) {
  const cfg = ALIEN_VULTURE;
  const birds = [];
  let ready = false;
  let started = false;

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
        birds.push({ holder, levels, lod: 0, flight: createVultureFlight({ rng, groundAt: field.sample }) });
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
      if (!started) bird.flight.start();
      bird.flight.update(dt);
      const s = bird.flight.state;
      const distance = Math.hypot(head.x - s.x, head.y - s.y, head.z - s.z);
      bird.holder.visible = distance < cfg.hideBeyond;
      if (!bird.holder.visible) continue;
      bird.holder.position.set(s.x, s.y, s.z);
      bird.holder.rotation.set(-s.pitch, s.yaw, s.roll);
      const lod = pickLod(distance, bird.lod, cfg.lodDistances, cfg.lodHysteresis);
      if (lod !== bird.lod) { bird.levels[bird.lod].root.visible = false; bird.levels[lod].root.visible = true; bird.lod = lod; }
      bird.levels[lod].poser.apply(s.pose);
    }
    started = true;
  }

  return {
    update,
    get ready() { return ready; },
    list: () => birds.map(b => ({ x: Math.round(b.flight.state.x), y: Math.round(b.flight.state.y), z: Math.round(b.flight.state.z), lod: b.lod })),
  };
}
