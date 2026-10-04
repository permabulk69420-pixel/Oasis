import { POSE_REST, JOINTS } from './stinger-pose.js';

// What one dune stinger does, as a small state machine with no three.js in it: it stands about, turns, wanders slowly
// between spots near its home in the dunes, and when you come close it stops and watches you with its tail curled up
// over its back. That is all: it never chases you and nothing it does hurts you (what a stinger does to a player is a
// gameplay call that is not made yet). Each frame it writes where it is, which way it faces and a pose (the numbers
// src/stinger-pose.js turns into bone rotations) into `stinger.state`, and src/dune-stinger.js puts a model there.
//
//   idle  - standing, breathing, glancing about
//   turn  - stepping round on the spot to face its next spot
//   walk  - going there
//   watch - the player is near: stopped, facing them, tail up

export const BRAIN = Object.freeze({
  walkSpeed: 1.25, // metres per second
  accel: 2.2, // per second: how quickly it speeds up and slows down
  turnRate: 1.5, // radians per second
  walkAngle: 0.35, // radians: it starts walking once it faces its spot to within this
  wanderRadius: 22, // metres from home
  idleRange: [3, 8], // seconds standing between one walk and the next
  hop: [6, 18], // metres: how far each wander goes
  maxSlope: 0.75, // rise over run: it will not walk up or across anything steeper
  watchDistance: 15, // metres: it stops and watches
  watchRelease: 20, // and carries on once you are this far (so it doesn't flicker at the edge)
  stride: JOINTS.stride, // metres of walking per leg cycle at scale 1, so the feet do not slide
  glanceEvery: [1.8, 4.5], // seconds between idle glances
});

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const range = (rng, [lo, hi]) => lo + (hi - lo) * rng();
export const wrapAngle = a => { a %= TAU; if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU; return a; };
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);

// `world.groundAt(x, z)` is the terrain height; `world.blocked(x, z)` is true where it must not go (the pond, the hero tree).
export function createStinger({ world, rng = Math.random, home, scale = 1, config = BRAIN }) {
  const cfg = config;
  const state = {
    active: true,
    mode: 'idle',
    x: home.x,
    z: home.z,
    yaw: rng() * TAU,
    speed: 0,
    time: 0,
    modeTime: 0,
    target: { x: home.x, z: home.z },
    pose: { ...POSE_REST },
    yawRate: 0,
  };
  const pose = state.pose;
  let idleFor = range(rng, [1, 3]);
  let glanceIn = range(rng, cfg.glanceEvery);
  let glanceYaw = 0;
  let glancePitch = 0;
  let watching = false;

  function slopeAt(x, z) {
    const d = 1.5;
    const sx = (world.groundAt(x + d, z) - world.groundAt(x - d, z)) / (2 * d);
    const sz = (world.groundAt(x, z + d) - world.groundAt(x, z - d)) / (2 * d);
    return Math.hypot(sx, sz);
  }

  // Free to stand or walk on: not blocked, and not too steep
  const walkable = (x, z) => !world.blocked(x, z) && slopeAt(x, z) <= cfg.maxSlope;

  // True when a straight walk from here to (x, z) stays on walkable ground
  function clearTo(x, z) {
    const dx = x - state.x;
    const dz = z - state.z;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 1.5));
    for (let i = 1; i <= steps; i++) if (!walkable(state.x + dx * (i / steps), state.z + dz * (i / steps))) return false;
    return true;
  }

  // Picks somewhere to go that is near home, a short way off and clear to walk to; false if it finds nothing
  function pickTarget() {
    for (let i = 0; i < 10; i++) {
      const angle = rng() * TAU;
      const distance = range(rng, cfg.hop);
      let x = state.x + Math.sin(angle) * distance;
      let z = state.z + Math.cos(angle) * distance;
      // never wander further than wanderRadius from home: pull the spot back inside
      const hx = x - home.x;
      const hz = z - home.z;
      const away = Math.hypot(hx, hz);
      if (away > cfg.wanderRadius) {
        x = home.x + (hx / away) * cfg.wanderRadius;
        z = home.z + (hz / away) * cfg.wanderRadius;
      }
      if (Math.hypot(x - state.x, z - state.z) < 3) continue;
      if (!clearTo(x, z)) continue;
      state.target.x = x;
      state.target.z = z;
      return true;
    }
    return false;
  }

  function setMode(mode) {
    state.mode = mode;
    state.modeTime = 0;
  }

  // Which way (radians, to its left) is the player from where it faces?
  function bearingTo(point) {
    return wrapAngle(Math.atan2(point.x - state.x, point.z - state.z) - state.yaw);
  }

  function update(dt, player) {
    if (dt <= 0) return state;
    state.time += dt;
    state.modeTime += dt;

    // the player coming close or going away
    const distance = Math.hypot(player.x - state.x, player.z - state.z);
    if (!watching && distance < cfg.watchDistance) { watching = true; setMode('watch'); }
    else if (watching && distance > cfg.watchRelease) { watching = false; idleFor = range(rng, [1, 2.5]); setMode('idle'); }

    let wantSpeed = 0;
    let wantYawRate = 0;
    let wantGait = 0;
    let wantAlert = 0;
    let turnTo = null;

    if (state.mode === 'watch') {
      wantAlert = 1;
      turnTo = Math.atan2(player.x - state.x, player.z - state.z);
    } else if (state.mode === 'idle') {
      idleFor -= dt;
      if (idleFor <= 0) {
        if (pickTarget()) setMode('turn');
        else idleFor = range(rng, cfg.idleRange);
      }
    } else {
      turnTo = Math.atan2(state.target.x - state.x, state.target.z - state.z);
    }

    if (turnTo !== null) {
      const diff = wrapAngle(turnTo - state.yaw);
      wantYawRate = clamp(diff * 3, -cfg.turnRate, cfg.turnRate);
      if (state.mode === 'turn' && Math.abs(diff) < cfg.walkAngle) setMode('walk');
      if (state.mode === 'watch' && Math.abs(diff) > 0.25) wantGait = 0.55 * clamp(Math.abs(diff) / 0.8, 0, 1);
      if (state.mode === 'turn') wantGait = 0.6;
    }
    if (state.mode === 'walk') {
      const toTarget = Math.hypot(state.target.x - state.x, state.target.z - state.z);
      const diff = wrapAngle(Math.atan2(state.target.x - state.x, state.target.z - state.z) - state.yaw);
      wantSpeed = cfg.walkSpeed * clamp(toTarget / 2.5, 0.25, 1) * (Math.abs(diff) > 0.9 ? 0.4 : 1);
      wantGait = 1;
      const ahead = 2.2;
      const nx = state.x + Math.sin(state.yaw) * ahead;
      const nz = state.z + Math.cos(state.yaw) * ahead;
      if (toTarget < 0.8 || !walkable(nx, nz)) { idleFor = range(rng, cfg.idleRange); setMode('idle'); wantSpeed = 0; wantGait = 0; }
    }

    // ease the speed and turn, then move
    state.speed += (wantSpeed - state.speed) * ease(cfg.accel, dt);
    state.yawRate += (wantYawRate - state.yawRate) * ease(8, dt);
    state.yaw = wrapAngle(state.yaw + state.yawRate * dt);
    state.x += Math.sin(state.yaw) * state.speed * dt;
    state.z += Math.cos(state.yaw) * state.speed * dt;

    // pose numbers
    const gaitTarget = state.mode === 'walk' ? clamp(0.35 + state.speed / cfg.walkSpeed * 0.65, 0, 1) : wantGait;
    pose.gait += (gaitTarget - pose.gait) * ease(5, dt);
    // legs cycle with the ground covered; when it steps round on the spot they just keep a slow beat
    const metres = state.speed * dt;
    const spin = Math.abs(state.yawRate) > 0.12 && state.speed < 0.3 ? 1.1 * Math.abs(state.yawRate) / cfg.turnRate : 0;
    pose.phase += TAU * (metres / (cfg.stride * scale) + spin * dt);
    pose.phase %= TAU * 1000;
    pose.turn += (clamp(state.yawRate / cfg.turnRate, -1, 1) - pose.turn) * ease(4, dt);
    pose.alert += (wantAlert - pose.alert) * ease(3, dt);

    // the head: on the player when watching, glancing about when idle, along the way when walking
    glanceIn -= dt;
    if (glanceIn <= 0) {
      glanceIn = range(rng, cfg.glanceEvery);
      glanceYaw = (rng() - 0.5) * 1.2;
      glancePitch = (rng() - 0.5) * 0.25;
    }
    let headYaw = glanceYaw * (state.mode === 'walk' ? 0.3 : 1);
    let headPitch = glancePitch;
    if (state.mode === 'watch') { headYaw = clamp(bearingTo(player), -0.9, 0.9); headPitch = 0.08; }
    pose.headYaw += (headYaw - pose.headYaw) * ease(4, dt);
    pose.headPitch += (headPitch - pose.headPitch) * ease(4, dt);
    return state;
  }

  return { state, update, get mode() { return state.mode; }, get watching() { return watching; } };
}
