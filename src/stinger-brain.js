import { POSE_REST, JOINTS } from './stinger-pose.js';

// What one dune stinger does, as a small state machine with no three.js in it. Each frame it writes where it is, which way
// it faces and a pose (the numbers src/stinger-pose.js turns into bone rotations) into `stinger.state`, and src/dune-stinger.js
// puts a model there.
//
//   idle, turn, walk  patrol: stands about, glances, wanders short distances near its patch of dune
//   alert             it has seen you: stops, faces you, tail up, for a moment
//   stalk             creeps towards you with its tail up, slower than you walk
//   windup            crouches and draws its tail back and up, eyes and sting flaring: the warning. It follows you with its
//                     body until `aimLock`, then the strike is aimed at where you were, so a step to the side dodges it
//   strike            lunges and whips the tail over its head onto the aim point; the blow lands once, at `impactAt`
//   recover           the tail comes back; it is open to being hit
//   hurt              flinches from a blow, then
//   retreat           backs away from you (still facing you) for a few seconds, then comes back at you
//   return            gives up (you are too far, or it is too far from home) and walks home
//   dead              curls up, lies there a while, then is gone; a new one is back at its home some minutes later
//
// It does nothing to you except the strike, and the strike only hurts if you are still where it landed.

export const BRAIN = Object.freeze({
  // patrol
  walkSpeed: 1.25, // metres per second
  accel: 2.2, // per second: how quickly it speeds up and slows down
  turnRate: 1.5, // radians per second
  walkAngle: 0.35, // radians: it starts walking once it faces its spot to within this
  wanderRadius: 22, // metres from home
  idleRange: [3, 8], // seconds standing between one walk and the next
  hop: [6, 18], // metres: how far each wander goes
  maxSlope: 0.75, // rise over run: it will not walk up or across anything steeper
  stride: JOINTS.stride, // metres of walking per leg cycle at scale 1, so the feet do not slide
  glanceEvery: [1.8, 4.5], // seconds between idle glances
  // seeing you
  noticeDistance: 22, // metres: it spots you this close, if the dunes do not hide you
  eyeHeight: 0.55, // metres at scale 1: how high its eyes are above the ground, for seeing you over a dune
  alertTime: 0.9, // seconds it watches you before it comes
  loseDistance: 40, // metres: beyond this it gives up the chase
  leash: 48, // metres from home: it will not follow you further than this
  // stalking and the strike
  stalkSpeed: 1.15, // m/s: slower than you walk (2.6), so you can always back away
  stalkTurnRate: 2.4,
  strikeRange: 4.8, // metres: it starts the windup when you are this close (centre of its body to you)
  strikeReach: 0.95, // metres at scale 1 from the middle of its body to where the sting lands, ahead of it (see JOINTS in stinger-pose.js)
  windupTime: 0.95, // seconds of warning
  aimLock: 0.62, // seconds into the windup after which it no longer follows you
  strikeTime: 0.24,
  impactAt: 0.13, // seconds into the strike when the sting lands
  maxLunge: 2.6, // metres the body can rush forward during the strike
  hitRadius: 1.15, // metres from where the sting lands within which you are hit
  recoverTime: 1.3,
  strikeDamage: 18, // of your 100 health
  // being hurt
  health: 100,
  flinchTime: 0.5,
  retreatTime: [3.2, 5.0], // seconds backing away after a hit
  retreatSpeed: 1.7, // m/s
  // dying
  deadLinger: 40, // seconds the body lies there
  respawnAfter: 150, // seconds after it dies until a new one is at home
});

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const range = (rng, [lo, hi]) => lo + (hi - lo) * rng();
export const wrapAngle = a => { a %= TAU; if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU; return a; };
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);
const CHASE = new Set(['alert', 'stalk', 'windup', 'strike', 'recover', 'hurt', 'retreat']);

// `world.groundAt(x, z)` is the terrain height; `world.blocked(x, z)` is true where it must not go (the pond, the hero tree);
// `world.canSee(ax, ay, az, bx, by, bz)` (optional) says whether the dunes leave a line of sight between two points.
// `onStrike({ hit, x, z })` is called when the sting lands; `onHurt`/`onDeath` when it is hit or dies.
export function createStinger({ world, rng = Math.random, home, scale = 1, config = BRAIN, onStrike = null, onHurt = null, onDeath = null }) {
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
    health: cfg.health,
    target: { x: home.x, z: home.z },
    aim: { x: home.x, z: home.z },
    pose: { ...POSE_REST },
    yawRate: 0,
    deadFor: 0,
    glow: 0, // 0 to 1: how much the eyes and sting flare above their usual glow (the windup, the strike)
  };
  const pose = state.pose;
  let idleFor = range(rng, [1, 3]);
  let glanceIn = range(rng, cfg.glanceEvery);
  let glanceYaw = 0;
  let glancePitch = 0;
  let aggro = false; // it knows where you are
  let alertDelay = 0;
  let retreatFor = 0;
  let struck = false;
  let lunge = 0; // metres per second during the strike
  let stuckFor = 0;
  let retreatBlocked = false;

  function slopeAt(x, z) {
    const d = 1.5;
    const sx = (world.groundAt(x + d, z) - world.groundAt(x - d, z)) / (2 * d);
    const sz = (world.groundAt(x, z + d) - world.groundAt(x, z - d)) / (2 * d);
    return Math.hypot(sx, sz);
  }

  const walkable = (x, z) => !world.blocked(x, z) && slopeAt(x, z) <= cfg.maxSlope;

  function clearTo(x, z) {
    const dx = x - state.x;
    const dz = z - state.z;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 1.5));
    for (let i = 1; i <= steps; i++) if (!walkable(state.x + dx * (i / steps), state.z + dz * (i / steps))) return false;
    return true;
  }

  function pickTarget() {
    for (let i = 0; i < 10; i++) {
      const angle = rng() * TAU;
      const distance = range(rng, cfg.hop);
      let x = state.x + Math.sin(angle) * distance;
      let z = state.z + Math.cos(angle) * distance;
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

  const bearing = (x, z) => Math.atan2(x - state.x, z - state.z);
  const bearingFrom = (point) => wrapAngle(bearing(point.x, point.z) - state.yaw);

  function sees(player) {
    if (!world.canSee) return true;
    const eye = world.groundAt(state.x, state.z) + cfg.eyeHeight * scale;
    return world.canSee(state.x, eye, state.z, player.x, player.y, player.z);
  }

  function goHome() {
    state.target.x = home.x;
    state.target.z = home.z;
    aggro = false;
    setMode('return');
  }

  function die() {
    setMode('dead');
    state.deadFor = 0;
    state.health = 0;
    aggro = false;
    onDeath?.(state);
  }

  // Something hit it. `amount` is health taken off. Does nothing once it is dead.
  function hurt(amount) {
    if (state.mode === 'dead' || !(amount > 0)) return false;
    state.health = Math.max(0, state.health - amount);
    onHurt?.(state, amount);
    if (state.health <= 0) { die(); return true; }
    aggro = true;
    retreatFor = range(rng, cfg.retreatTime);
    struck = false;
    lunge = 0;
    setMode('hurt');
    return true;
  }

  function respawn() {
    state.active = true;
    state.x = home.x;
    state.z = home.z;
    state.yaw = rng() * TAU;
    state.speed = 0;
    state.health = cfg.health;
    state.yawRate = 0;
    for (const key of Object.keys(POSE_REST)) pose[key] = POSE_REST[key];
    state.glow = 0;
    aggro = false;
    idleFor = range(rng, [2, 5]);
    setMode('idle');
  }

  function update(dt, player) {
    if (dt <= 0) return state;
    state.time += dt;
    state.modeTime += dt;
    const mode = state.mode;

    if (mode === 'dead') {
      state.deadFor += dt;
      state.speed *= Math.exp(-6 * dt);
      state.yawRate = 0;
      state.x += Math.sin(state.yaw) * state.speed * dt;
      state.z += Math.cos(state.yaw) * state.speed * dt;
      if (state.deadFor > cfg.deadLinger) state.active = false;
      if (state.deadFor > cfg.respawnAfter) respawn();
      easePose(dt, { dead: 1, gait: 0, windup: 0, strike: 0, hurt: 0, alert: 0 }, 4);
      state.glow += (0 - state.glow) * ease(3, dt);
      return state;
    }

    const distance = Math.hypot(player.x - state.x, player.z - state.z);
    const fromHome = Math.hypot(state.x - home.x, state.z - home.z);

    // noticing you
    if (!CHASE.has(state.mode) && state.mode !== 'return' && distance < cfg.noticeDistance && sees(player)) {
      aggro = true;
      alertDelay = cfg.alertTime;
      setMode('alert');
    }
    // giving up
    if (aggro && (distance > cfg.loseDistance || fromHome > cfg.leash) && state.mode !== 'strike' && state.mode !== 'windup' && state.mode !== 'hurt') goHome();

    let wantSpeed = 0;
    let wantYawRate = 0;
    let wantGait = 0;
    let turnTo = null;
    let turnRate = cfg.turnRate;
    const want = { alert: 0, windup: 0, strike: 0, hurt: 0 };
    let rate = 6;
    let glowTarget = 0;

    switch (state.mode) {
      case 'idle': {
        idleFor -= dt;
        if (idleFor <= 0) {
          if (pickTarget()) setMode('turn');
          else idleFor = range(rng, cfg.idleRange);
        }
        break;
      }
      case 'turn':
      case 'walk': {
        turnTo = bearing(state.target.x, state.target.z);
        if (state.mode === 'turn') {
          wantGait = 0.6;
          if (Math.abs(wrapAngle(turnTo - state.yaw)) < cfg.walkAngle) setMode('walk');
        } else {
          const toTarget = Math.hypot(state.target.x - state.x, state.target.z - state.z);
          const diff = wrapAngle(turnTo - state.yaw);
          wantSpeed = cfg.walkSpeed * clamp(toTarget / 2.5, 0.25, 1) * (Math.abs(diff) > 0.9 ? 0.4 : 1);
          wantGait = 1;
          const nx = state.x + Math.sin(state.yaw) * 2.2;
          const nz = state.z + Math.cos(state.yaw) * 2.2;
          if (toTarget < 0.8 || !walkable(nx, nz)) { idleFor = range(rng, cfg.idleRange); setMode('idle'); wantSpeed = 0; wantGait = 0; }
        }
        break;
      }
      case 'return': {
        turnTo = bearing(state.target.x, state.target.z);
        const toHome = Math.hypot(state.target.x - state.x, state.target.z - state.z);
        const diff = wrapAngle(turnTo - state.yaw);
        wantSpeed = cfg.walkSpeed * clamp(toHome / 2.5, 0.25, 1) * (Math.abs(diff) > 0.9 ? 0.3 : 1);
        wantGait = Math.abs(diff) > 0.9 && wantSpeed < 0.3 ? 0.6 : 1;
        const nx = state.x + Math.sin(state.yaw) * 2.2;
        const nz = state.z + Math.cos(state.yaw) * 2.2;
        if (toHome < 2 || !walkable(nx, nz)) { idleFor = range(rng, cfg.idleRange); setMode('idle'); wantSpeed = 0; wantGait = 0; }
        break;
      }
      case 'alert': {
        want.alert = 1;
        turnTo = bearing(player.x, player.z);
        turnRate = cfg.stalkTurnRate;
        const diff = wrapAngle(turnTo - state.yaw);
        if (Math.abs(diff) > 0.3) wantGait = 0.55;
        alertDelay -= dt;
        if (alertDelay <= 0) setMode('stalk');
        break;
      }
      case 'stalk': {
        want.alert = 1;
        turnTo = bearing(player.x, player.z);
        turnRate = cfg.stalkTurnRate;
        const diff = wrapAngle(turnTo - state.yaw);
        if (distance <= cfg.strikeRange && Math.abs(diff) < 0.5) { setMode('windup'); struck = false; break; }
        const nx = state.x + Math.sin(state.yaw) * 2.0;
        const nz = state.z + Math.cos(state.yaw) * 2.0;
        const clear = walkable(nx, nz);
        if (Math.abs(diff) < 0.9 && clear && distance > cfg.strikeRange * 0.8) {
          wantSpeed = cfg.stalkSpeed;
          wantGait = 1;
          stuckFor = 0;
        } else {
          wantGait = Math.abs(diff) > 0.3 ? 0.55 : 0;
          if (!clear) { stuckFor += dt; if (stuckFor > 4) { stuckFor = 0; goHome(); } }
        }
        break;
      }
      case 'windup': {
        want.windup = 1;
        rate = 7;
        glowTarget = 1;
        turnRate = cfg.stalkTurnRate;
        if (state.modeTime < cfg.aimLock) {
          state.aim.x = player.x;
          state.aim.z = player.z;
        }
        turnTo = bearing(state.aim.x, state.aim.z);
        if (state.modeTime >= cfg.windupTime) {
          // the lunge: close the gap between where the sting will land and where it is aimed
          const toAim = Math.hypot(state.aim.x - state.x, state.aim.z - state.z);
          const lungeLength = clamp(toAim - cfg.strikeReach * scale, 0, cfg.maxLunge);
          lunge = lungeLength / cfg.impactAt;
          struck = false;
          setMode('strike');
        }
        break;
      }
      case 'strike': {
        want.strike = 1;
        rate = 26;
        glowTarget = 1;
        turnTo = bearing(state.aim.x, state.aim.z);
        turnRate = 6;
        if (state.modeTime < cfg.impactAt) {
          wantSpeed = lunge;
        } else if (!struck) {
          struck = true;
          lunge = 0;
          const tipX = state.x + Math.sin(state.yaw) * cfg.strikeReach * scale;
          const tipZ = state.z + Math.cos(state.yaw) * cfg.strikeReach * scale;
          const hit = Math.hypot(player.x - tipX, player.z - tipZ) <= cfg.hitRadius;
          onStrike?.({ hit, x: tipX, z: tipZ, damage: cfg.strikeDamage });
        }
        if (state.modeTime >= cfg.strikeTime) setMode('recover');
        break;
      }
      case 'recover': {
        want.strike = 0.0;
        want.windup = 0;
        want.alert = 1;
        rate = 3.5;
        if (state.modeTime >= cfg.recoverTime) setMode(distance < cfg.loseDistance ? 'stalk' : 'return');
        break;
      }
      case 'hurt': {
        want.hurt = 1;
        rate = 16;
        if (state.modeTime >= cfg.flinchTime) { retreatBlocked = false; setMode('retreat'); }
        break;
      }
      case 'retreat': {
        want.alert = 1;
        retreatFor -= dt;
        turnTo = bearing(player.x, player.z);
        turnRate = cfg.stalkTurnRate;
        const bx = state.x - Math.sin(state.yaw) * 2.0;
        const bz = state.z - Math.cos(state.yaw) * 2.0;
        if (walkable(bx, bz)) { wantSpeed = -cfg.retreatSpeed; wantGait = 1; }
        else { retreatBlocked = true; wantGait = 0.4; }
        if (retreatFor <= 0 || (retreatBlocked && state.modeTime > 1.2)) setMode(distance < cfg.loseDistance ? 'stalk' : 'return');
        break;
      }
      default: break;
    }

    // turning
    if (turnTo !== null) {
      const diff = wrapAngle(turnTo - state.yaw);
      wantYawRate = clamp(diff * 3, -turnRate, turnRate);
    }
    // speed: the lunge is not eased, and the body stops dead when the sting lands
    if (state.mode === 'strike') state.speed = state.modeTime < cfg.impactAt ? wantSpeed : 0;
    else {
      const quick = state.mode === 'retreat' || state.mode === 'stalk' ? 2 : state.mode === 'walk' || state.mode === 'return' || state.mode === 'idle' || state.mode === 'turn' ? 1 : 6;
      state.speed += (wantSpeed - state.speed) * ease(cfg.accel * quick, dt);
    }
    state.yawRate += (wantYawRate - state.yawRate) * ease(8, dt);
    state.yaw = wrapAngle(state.yaw + state.yawRate * dt);
    state.x += Math.sin(state.yaw) * state.speed * dt;
    state.z += Math.cos(state.yaw) * state.speed * dt;

    // pose numbers
    const gaitTarget = wantGait >= 1 ? clamp(0.35 + Math.abs(state.speed) / cfg.walkSpeed * 0.65, 0.35, 1) : wantGait;
    pose.gait += (Math.max(gaitTarget, state.mode === 'strike' ? 0.8 : 0) - pose.gait) * ease(5, dt);
    const metres = state.speed * dt;
    const spin = Math.abs(state.yawRate) > 0.12 && Math.abs(state.speed) < 0.3 ? 1.1 * Math.abs(state.yawRate) / cfg.turnRate : 0;
    pose.phase += TAU * (metres / (cfg.stride * scale) + spin * dt);
    pose.phase %= TAU * 1000;
    pose.turn += (clamp(state.yawRate / cfg.turnRate, -1, 1) - pose.turn) * ease(4, dt);
    easePose(dt, { alert: want.alert, windup: want.windup, strike: want.strike, hurt: want.hurt, dead: 0 }, rate);
    state.glow += (glowTarget - state.glow) * ease(10, dt);

    // the head: on you when it knows where you are, glancing about otherwise
    glanceIn -= dt;
    if (glanceIn <= 0) {
      glanceIn = range(rng, cfg.glanceEvery);
      glanceYaw = (rng() - 0.5) * 1.2;
      glancePitch = (rng() - 0.5) * 0.25;
    }
    let headYaw = glanceYaw * (state.mode === 'walk' ? 0.3 : 1);
    let headPitch = glancePitch;
    if (aggro && CHASE.has(state.mode)) { headYaw = clamp(bearingFrom(player), -0.9, 0.9); headPitch = 0.08; }
    pose.headYaw += (headYaw - pose.headYaw) * ease(5, dt);
    pose.headPitch += (headPitch - pose.headPitch) * ease(5, dt);
    return state;
  }

  function easePose(dt, targets, rate) {
    const k = ease(rate, dt);
    for (const key in targets) pose[key] += (targets[key] - pose[key]) * k;
  }

  return {
    state,
    update,
    hurt,
    get mode() { return state.mode; },
    get alive() { return state.mode !== 'dead'; },
  };
}
