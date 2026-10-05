import { AREA } from './zones.js';

// What Colossus 01 does when nobody is bothering it: it is passive. It paces the gravel plain north of the oasis, stands and looks about,
// walks to somewhere else on the plain, stands again. Nothing here reacts to the player and nothing affects play. Pure logic (no three.js),
// so it can be tested; src/colossus-gait.js turns this state into footsteps and src/colossus-pose.js into bones.
//
// Everything is slow on purpose: it speeds up and slows down over several steps, turns in wide arcs and never stops half way through a step.
// VR scale is carried by how slowly something that big moves. Units: metres, seconds, radians; yaw 0 faces +z and a positive turn is to the left (+x).

const FLATS = AREA.flats[0];
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

export const COLOSSUS_BRAIN = Object.freeze({
  // The ground it paces: half of the plain's ellipse, so it never leaves the level part (the plain's edge is warped by up to 22 percent).
  leash: Object.freeze({ x: FLATS.x, z: FLATS.z, rx: FLATS.rx * 0.5, rz: FLATS.rz * 0.5 }),
  start: Object.freeze({ x: FLATS.x + 70, z: FLATS.z + 40, yaw: 2.4 }),
  walkSpeed: 2.2, // m/s: a 55 m animal at a stately walk (a foot comes down about every 1.9 s)
  cycle: 7.6, // seconds for all four legs to step once
  accel: 0.24, // m/s2: it takes about 9 s to get going
  decel: 0.27,
  maxTurn: 0.055, // rad/s: a quarter turn takes half a minute
  turnLag: 4, // seconds the turn rate takes to follow what it wants
  steer: 0.5, // turn rate it wants per radian of heading error, per second
  sharpTurnSlowdown: 0.45, // walking speed lost in a turn of 90 degrees or more
  arrive: 24, // metres from the target at which it counts as there
  pick: Object.freeze({ distance: [140, 320], spread: 100 * DEG, tries: 18, inside: 0.88 }),
  stand: Object.freeze([25, 70]), // seconds it stands between walks
  calmAfter: 1.5, // seconds standing before the feet settle flat (see calm)
  breath: Object.freeze({ stand: 6.2, walk: 5.2 }), // seconds per breath
  tailIdle: 11, // seconds per slow swing of the tail while it stands
  // Where it looks, relative to the way its body faces (radians), and how long it keeps looking there (seconds)
  gaze: Object.freeze({
    stand: Object.freeze({ yaw: 55 * DEG, pitchUp: 9 * DEG, pitchDown: 8 * DEG, every: [5, 12], lowChance: 0.22, lowPitch: 30 * DEG, highChance: 0.1, highPitch: -12 * DEG }),
    walk: Object.freeze({ yaw: 22 * DEG, pitchUp: 4 * DEG, pitchDown: 3 * DEG, every: [6, 14], lowChance: 0.05, lowPitch: 14 * DEG, highChance: 0.05, highPitch: -6 * DEG }),
  }),
});

export function wrapPi(angle) {
  let a = (angle + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

// 0 at the middle of the leash ellipse, 1 on its edge
export function leashNorm(x, z, leash = COLOSSUS_BRAIN.leash) {
  return Math.hypot((x - leash.x) / leash.rx, (z - leash.z) / leash.rz);
}

// The next gait phase (in quarter cycles) at or after `cycles`: the instants at which one foot has just come down and the next has not yet lifted
export function boundaryAfter(cycles) {
  return Math.ceil(cycles * 4 - 1e-9) / 4 + 0; // (+ 0 turns a negative zero into a plain one)
}

export function createColossusBrain({ rng = Math.random, start = COLOSSUS_BRAIN.start, config = COLOSSUS_BRAIN } = {}) {
  const between = ([lo, hi]) => lo + (hi - lo) * rng();
  const state = {
    x: start.x, z: start.z, yaw: start.yaw,
    speed: 0, accel: 0, turn: 0,
    mode: 'stand', // 'stand' | 'walk' | 'stopping' | 'settle' (finishing the step it was in)
    moving: false,
    settleTo: 0, // the gait phase it is walking on to, to finish the step it was in
    cycles: 0, // the gait phase, counted without wrapping: one per full cycle of all four legs
    cycle: config.cycle,
    standFor: 0,
    standTime: between(config.stand),
    calm: 0, // 0 to 1: how settled it is while it stands, so the feet go flat
    target: { x: start.x, z: start.z },
    gaze: { yaw: 0, pitch: 0 },
    gazeTimer: 2 + 4 * rng(),
    breath: rng() * TAU,
    tail: rng() * TAU,
    time: 0,
  };

  function pickTarget() {
    const C = config.pick;
    for (let i = 0; i < C.tries; i++) {
      const angle = state.yaw + (rng() * 2 - 1) * C.spread;
      const distance = between(C.distance);
      const x = state.x + Math.sin(angle) * distance;
      const z = state.z + Math.cos(angle) * distance;
      if (leashNorm(x, z, config.leash) <= C.inside) { state.target.x = x; state.target.z = z; return; }
    }
    // everything ahead is off the plain: go back towards the middle of it
    const L = config.leash;
    state.target.x = L.x + (rng() * 2 - 1) * L.rx * 0.4;
    state.target.z = L.z + (rng() * 2 - 1) * L.rz * 0.4;
  }

  function pickGaze() {
    const G = state.moving ? config.gaze.walk : config.gaze.stand;
    state.gaze.yaw = (rng() * 2 - 1) * G.yaw;
    const roll = rng();
    if (roll < G.lowChance) { state.gaze.pitch = G.lowPitch * (0.8 + 0.4 * rng()); state.gaze.yaw *= 0.5; }
    else if (roll < G.lowChance + G.highChance) state.gaze.pitch = G.highPitch * (0.7 + 0.5 * rng());
    else state.gaze.pitch = (rng() * 2 - 1) * (rng() < 0.5 ? G.pitchUp : G.pitchDown) * 0.5;
    state.gazeTimer = between(G.every);
  }

  function beginWalk() {
    pickTarget();
    state.mode = 'walk';
    state.moving = true;
    state.standFor = 0;
  }

  function update(dt) {
    if (!(dt > 0)) return state;
    dt = Math.min(dt, 0.1);
    state.time += dt;
    const was = state.speed;

    if (state.mode === 'stand') {
      state.standFor += dt;
      state.calm = Math.min(1, Math.max(0, (state.standFor - config.calmAfter) / 2.5));
      if (state.standFor >= state.standTime) beginWalk();
    } else {
      state.calm = 0;
    }

    if (state.mode === 'walk' || state.mode === 'stopping') {
      // steer towards the target in a wide, lazy arc
      const dx = state.target.x - state.x, dz = state.target.z - state.z;
      const distance = Math.hypot(dx, dz);
      const error = wrapPi(Math.atan2(dx, dz) - state.yaw);
      const wanted = state.mode === 'walk' ? Math.max(-config.maxTurn, Math.min(config.maxTurn, error * config.steer)) : state.turn * 0.98;
      state.turn += (wanted - state.turn) * (1 - Math.exp(-dt / config.turnLag));
      const slow = 1 - config.sharpTurnSlowdown * Math.min(1, Math.abs(error) / (Math.PI / 2));
      let want = state.mode === 'walk' ? config.walkSpeed * slow : 0;
      if (state.mode === 'walk' && distance < config.arrive) { state.mode = 'stopping'; want = 0; }
      const rate = want > state.speed ? config.accel : config.decel;
      state.speed += Math.max(-rate * dt, Math.min(rate * dt, want - state.speed));
      state.yaw = wrapPi(state.yaw + state.turn * dt);
      state.x += Math.sin(state.yaw) * state.speed * dt;
      state.z += Math.cos(state.yaw) * state.speed * dt;
      if (state.mode === 'stopping' && state.speed <= 1e-3) { state.speed = 0; state.turn = 0; state.mode = 'settle'; state.settleTo = boundaryAfter(state.cycles); }
    }
    state.accel = (state.speed - was) / dt;

    // the gait clock runs while it moves, and on past a stop to the end of the step it was in, then holds there
    if (state.mode !== 'stand') {
      state.cycles += dt / state.cycle;
      if (state.mode === 'settle' && state.cycles >= state.settleTo) {
        state.cycles = state.settleTo;
        state.mode = 'stand';
        state.standFor = 0;
        state.standTime = between(config.stand);
        state.gazeTimer = 0.5;
      }
    }
    state.moving = state.mode !== 'stand';

    state.gazeTimer -= dt;
    if (state.gazeTimer <= 0) pickGaze();
    state.breath = (state.breath + dt * TAU / (state.moving ? config.breath.walk : config.breath.stand)) % (TAU * 1000);
    state.tail = (state.tail + dt * TAU / (state.moving ? state.cycle : config.tailIdle)) % (TAU * 1000);
    return state;
  }

  return {
    state,
    update,
    // dev: put it somewhere (the gait is left where it was)
    place(x, z, yaw = state.yaw) { state.x = x; state.z = z; state.yaw = yaw; state.target.x = x; state.target.z = z; },
    // dev: stand still or set off at once
    stand() { state.mode = 'stand'; state.speed = 0; state.turn = 0; state.moving = false; state.standFor = 0; state.standTime = 1e9; state.cycles = boundaryAfter(state.cycles); },
    walk() { if (state.mode === 'stand') beginWalk(); },
  };
}
