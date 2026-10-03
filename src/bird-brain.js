import { FLIGHT, buildRoute, planArrival, planPassing, planExit, pickLanding, wrapAngle, headingOf } from './bird-flight.js';
import { POSE_REST } from './bird-pose.js';

// What one alien bird does, as a small state machine with no three.js in it: it flies a route, lands on the bank
// of the pond, drinks and looks about, and leaves when it is time, when the player comes close, or when the light
// goes. Each frame it writes where it is, which way it faces and a pose (the numbers src/bird-pose.js turns into
// bone rotations) into `bird.state`, and src/alien-bird.js puts a model there.
//
//   flying  - following a route (arriving, passing through, or leaving)
//   perched - standing on the bank: settling, then idle / drinking / alert
//   crouch  - the half second before a take-off

export const BRAIN = Object.freeze({
  alertDistance: 24, // metres: the bird notices the player and stops what it is doing
  fleeDistance: 8, // metres: and flies off
  goAroundDistance: 14, // metres: a landing is called off if the player is this close to the spot
  settleTime: 1.0, // seconds spent folding the wings after touching down
  crouchTime: 0.38,
  stayRange: [26, 46], // seconds on the bank before it leaves of its own accord
  duskDaylight: 0.22, // below this daylight everything flying heads away and everything perched takes off
  wind: [0.84, 0.54], // the bird takes off roughly into this wind (it blows towards +x +z)
});

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const smooth = t => t * t * (3 - 2 * t);

// What the bird's body is doing on each stretch of a route: where the pose numbers want to be, and how it flaps.
// `burst` is [fewest flaps, most flaps, shortest glide, longest glide] (flaps in a row, then a glide, in seconds);
// no `burst` means it flaps all the time.
const STYLES = Object.freeze({
  cruise: { amp: 0.62, rate: 2.4, burst: [4, 7, 0.8, 2.2], sweep: 0.12, legs: 1, stretch: 1, crest: -1, tail: -0.08, bodyPitch: 0, fold: 0 },
  soar: { amp: 0.50, rate: 2.2, burst: [2, 3, 4.0, 8.0], sweep: 0.14, legs: 1, stretch: 1, crest: -1, tail: -0.1, bodyPitch: 0, fold: 0 },
  descend: { amp: 0.42, rate: 2.4, burst: [1, 3, 1.4, 3.0], sweep: 0.30, legs: 0.55, stretch: 0.8, crest: -0.2, tail: 0.1, bodyPitch: 0, fold: 0 },
  flare: { amp: 0.80, rate: 3.7, sweep: 0.0, legs: 0.0, stretch: 0.45, crest: 0.6, tail: 0.5, bodyPitch: -0.75, fold: 0 },
  touch: { amp: 0.80, rate: 3.7, sweep: 0.0, legs: 0.0, stretch: 0.45, crest: 0.6, tail: 0.5, bodyPitch: -0.75, fold: 0 },
  takeoff: { amp: 0.88, rate: 3.5, sweep: 0.0, legs: 0.0, stretch: 0.6, crest: -0.5, tail: 0.0, bodyPitch: 0.12, fold: 0 },
  climb: { amp: 0.72, rate: 2.9, sweep: 0.08, legs: 1, stretch: 1, crest: -1, tail: -0.1, bodyPitch: 0, fold: 0 },
});

// How quickly (per second) each pose number follows its target.
const RATES = Object.freeze({
  fold: 7, legs: 5, stretch: 5, crest: 7, sweep: 4, bodyPitch: 5, tail: 6, headYaw: 14, headPitch: 8, dip: 9,
  crouch: 10, bodyRoll: 4, shake: 20, streamers: 3,
});

// Pose numbers are visited through fixed lists and refilled objects, so a frame creates no arrays or objects.
const POSE_KEYS = Object.keys(POSE_REST);
const OSC_KEYS = ['flap', 'flex', 'bodyPitch', 'tail'];
const BODY_KEYS = ['fold', 'legs', 'stretch', 'crest', 'sweep', 'bodyPitch', 'tail'];
const HEAD_KEYS = ['headYaw', 'headPitch'];
const DOWN_KEYS = ['dip', 'crouch'];
// Standing on the bank, and the half second of crouching before a take-off.
const PERCH_REST = Object.freeze({ fold: 1, legs: 0, stretch: 0, crest: 0, sweep: 0, bodyPitch: 0, tail: 0, headYaw: 0, headPitch: 0, dip: 0, crouch: 0, shake: 0, streamers: 0.25 });
const CROUCH_POSE = Object.freeze({ fold: 0.45, legs: 0, stretch: 0.35, crest: -0.4, sweep: 0, bodyPitch: 0.3, tail: 0, headYaw: 0, headPitch: 0, dip: 0, crouch: 1, shake: 0 });
const LOOK_EVERY = [1.1, 3.6]; // seconds between one look about and the next
const DRINK_EVERY = [8, 16];
const TAIL_EVERY = [4, 10];
const PERCH_KEYS = Object.keys(PERCH_REST);
const CROUCH_KEYS = Object.keys(CROUCH_POSE);

const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));
const range = (rng, [lo, hi]) => lo + (hi - lo) * rng();

// Turns `current` towards `target` (angles): quickly when far off, easing in, never faster than `maxRate` rad/s.
function turnToward(current, target, rate, maxRate, dt) {
  const step = wrapAngle(target - current) * (1 - Math.exp(-rate * dt));
  const limit = maxRate * dt;
  return current + clamp(step, -limit, limit);
}

// A sip: the head goes down, stays a moment, comes up, and a pause; `sips` of them.
const SIP_SECONDS = 2.1;
export function sipDepth(clock) {
  const t = clock % SIP_SECONDS;
  if (t < 0.45) return smooth(t / 0.45);
  if (t < 1.15) return 1 - 0.05 * Math.sin((t - 0.45) * 14);
  if (t < 1.65) return 1 - smooth((t - 1.15) / 0.5);
  return 0;
}

export function createBird({ world, rng, scale = 1 }) {
  const feet = 0.337 * scale;
  const sink = 0.012 * scale;
  const state = {
    active: false,
    mode: 'gone', // flying | perched | crouch | gone
    kind: 'visit', // visit (lands at the pond) or passing (just crosses the sky)
    phase: 'gone', // the route tag, or what the perched bird is doing
    x: 0, y: 0, z: 0,
    yaw: 0, pitch: 0, roll: 0,
    speed: 0,
    altitude: 0, // above the ground below
    time: 0,
    drop: 0, // how far the body sinks in a crouch, metres
    bob: 0, // small vertical bob while flapping, metres
    pose: { ...POSE_REST },
  };

  const sampled = {};
  // `base` is the pose the bird is easing towards; `osc` is the flapping added on top each frame (kept apart so
  // the oscillation is never fed back into the smoothing); state.pose is the two added together.
  const base = { ...POSE_REST };
  const osc = { flap: 0, flex: 0, bodyPitch: 0, tail: 0 };
  const flap = { phase: 0, amp: 0, rate: 2.4, flapping: false, flapsLeft: 0, glide: 0, lastWrap: 0 };
  const want = { ...PERCH_REST }; // what a perched bird is easing towards, refilled every frame
  let route = null;
  let s = 0;
  let leaving = false; // the route is a way out
  let goAroundChecked = false;
  let landing = null;
  let perch = null;
  let crouch = null;
  let look = null;

  // --- starting -------------------------------------------------------------------------------------------------

  function reset(kind) {
    state.active = true;
    state.kind = kind;
    state.drop = 0;
    state.bob = 0;
    state.time = 0;
    Object.assign(base, POSE_REST, { fold: 0, legs: 1, stretch: 1, crest: -1, streamers: 0.8, sweep: 0.12, flap: 0.12, flex: -0.05 });
    leaving = false;
    goAroundChecked = false;
    landing = null;
    perch = null;
    crouch = null;
    flap.phase = rng() * TAU;
    flap.amp = 0.5;
    flap.flapping = true;
    flap.flapsLeft = 4;
    flap.glide = 0;
    flap.lastWrap = Math.floor(flap.phase / TAU);
  }

  function follow(next) {
    route = next;
    s = 0;
    route.sample(0, sampled);
    place();
    state.yaw = Math.atan2(sampled.tx, sampled.tz);
    state.pitch = Math.asin(clamp(sampled.ty, -1, 1));
    state.roll = 0;
    state.mode = 'flying';
    state.phase = sampled.tag;
  }

  // A visit to the pond, coming in from a long way off. `ctx.player` is where the player is, so the bird picks a spot
  // on the bank that can be seen and comes in over the player's side of the world.
  function startVisit(ctx, { distance = 260 } = {}) {
    const player = ctx.player ?? null;
    reset('visit');
    landing = pickLanding({
      pond: world.pond, groundAt: world.groundAt, inWater: world.inWater, player, avoid: world.avoid?.() ?? [], rng,
      minPlayerDistance: BRAIN.goAroundDistance + 8,
    });
    if (!landing) return startPassing(ctx);
    const towards = player
      ? Math.atan2(player.z - world.pond.z, player.x - world.pond.x) + (rng() - 0.5) * 1.0
      : rng() * TAU;
    const start = { x: world.pond.x + distance * Math.cos(towards), z: world.pond.z + distance * Math.sin(towards) };
    follow(buildRoute(planArrival({ pond: world.pond, start, landing, groundAt: world.groundAt, rng, feet }), world.groundAt));
    return true;
  }

  // A bird crossing the sky near the player, soaring once, going on its way.
  function startPassing(ctx, { centre = null, radius = null, altitude = null } = {}) {
    reset('passing');
    const player = ctx.player ?? { x: world.pond.x, z: world.pond.z };
    const reach = 80 + rng() * 120;
    const angle = rng() * TAU;
    const middle = centre ?? { x: player.x + reach * Math.cos(angle), z: player.z + reach * Math.sin(angle) };
    follow(buildRoute(planPassing({ centre: middle, groundAt: world.groundAt, rng, radius, altitude }), world.groundAt, radius === null ? 14 : 6));
    leaving = true; // it never lands; the end of the route is the end of the visit
    return true;
  }

  // A bird already standing on the bank (development fixtures and tests).
  function startPerched(at) {
    reset('visit');
    landing = at;
    perched(at);
    perch.clock = BRAIN.settleTime + 0.1;
    perch.sub = 'idle';
    state.yaw = at.yawToWater ?? 0;
    Object.assign(base, POSE_REST, { fold: 1 });
    return true;
  }

  function place() {
    state.x = sampled.x;
    state.y = sampled.y;
    state.z = sampled.z;
    state.speed = sampled.speed;
  }

  // --- landing and perching -------------------------------------------------------------------------------------

  function perched(spot) {
    state.mode = 'perched';
    state.x = spot.x;
    state.z = spot.z;
    state.y = spot.groundY + feet - sink;
    state.pitch = 0;
    state.roll = 0;
    state.speed = 0;
    perch = {
      spot, yawWater: spot.yawToWater, clock: 0,
      stay: range(rng, BRAIN.stayRange), sub: 'settle', subClock: 0,
      drinkIn: range(rng, [3, 7]), sips: 2, alertHold: 0, tailIn: range(rng, TAIL_EVERY), tailFor: 0,
    };
    look = { yaw: 0, pitch: 0, until: 0.8 };
    state.phase = 'settle';
    route = null;
  }

  function updatePerched(dt, ctx) {
    perch.clock += dt;
    perch.stay -= dt;
    const player = ctx.player;
    const dx = player ? player.x - state.x : Infinity;
    const dz = player ? player.z - state.z : Infinity;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const settled = perch.clock > BRAIN.settleTime;

    if (settled && (dist < BRAIN.fleeDistance || perch.stay <= 0 || ctx.daylight < BRAIN.duskDaylight)) {
      beginCrouch(dist < BRAIN.fleeDistance ? Math.atan2(state.x - player.x, state.z - player.z) + (rng() - 0.5) * 0.7 : null);
      return;
    }

    for (let i = 0; i < PERCH_KEYS.length; i++) want[PERCH_KEYS[i]] = PERCH_REST[PERCH_KEYS[i]];
    let facing = perch.yawWater;

    if (!settled) {
      perch.sub = 'settle';
      want.crest = 0.35;
      want.stretch = 0.15;
      want.shake = perch.clock > 0.55 ? 1 : 0; // a ruffle of the wings once they are folded
    } else {
      if (dist < BRAIN.alertDistance) perch.alertHold = 2.5;
      else perch.alertHold = Math.max(0, perch.alertHold - dt);
      const alert = perch.alertHold > 0;

      if (alert) {
        perch.sub = 'alert';
        want.crest = 0.9;
        want.stretch = 0.2;
        want.streamers = 0.4;
        if (player) {
          const toPlayer = headingOf(dx, dz);
          const rel = wrapAngle(toPlayer - state.yaw);
          want.headYaw = clamp(rel, -1.15, 1.15);
          // too far round to look: turn the body to face the player
          if (Math.abs(rel) > 1.1) facing = toPlayer;
          else facing = state.yaw;
        }
      } else if (perch.sub === 'drink') {
        perch.subClock += dt;
        const dip = sipDepth(perch.subClock);
        want.dip = dip;
        want.bodyPitch = 0.3 * dip;
        want.crest = 0.15;
        if (perch.subClock > perch.sips * SIP_SECONDS) {
          perch.sub = 'idle';
          perch.drinkIn = range(rng, DRINK_EVERY);
        }
      } else {
        perch.sub = 'idle';
        perch.drinkIn -= dt;
        if (perch.drinkIn <= 0) { perch.sub = 'drink'; perch.subClock = 0; perch.sips = rng() < 0.5 ? 2 : 3; }
        // quick looks about, now and then at the player
        look.until -= dt;
        if (look.until <= 0) {
          look.until = range(rng, LOOK_EVERY);
          const atPlayer = player && dist < 45 && rng() < 0.4;
          look.yaw = atPlayer ? clamp(wrapAngle(headingOf(dx, dz) - state.yaw), -1.1, 1.1) : (rng() - 0.5) * 1.7;
          look.pitch = (rng() - 0.5) * 0.3;
        }
        want.headYaw = look.yaw;
        want.headPitch = look.pitch;
        want.crest = Math.abs(look.yaw) > 0.6 ? 0.3 : 0;
        // and an occasional flick of the tail
        perch.tailIn -= dt;
        if (perch.tailIn <= 0) { perch.tailIn = range(rng, TAIL_EVERY); perch.tailFor = 0.3; }
        if (perch.tailFor > 0) { perch.tailFor -= dt; want.tail = 0.35; }
      }
    }

    for (let i = 0; i < PERCH_KEYS.length; i++) {
      const key = PERCH_KEYS[i];
      base[key] = damp(base[key], want[key], RATES[key] ?? 5, dt);
    }
    state.yaw = turnToward(state.yaw, facing, 3.2, 3.5, dt);
    state.phase = perch.sub;
    state.drop = 0;
    flap.amp = damp(flap.amp, 0, 10, dt);
  }

  // --- leaving --------------------------------------------------------------------------------------------------

  function beginCrouch(heading = null) {
    const into = Math.atan2(-BRAIN.wind[0], -BRAIN.wind[1]);
    const aim = heading ?? into + (rng() - 0.5) * 2.0;
    // long enough to swing round to the way it means to go (at most 8 rad/s)
    crouch = { clock: 0, heading: aim, duration: clamp(Math.abs(wrapAngle(aim - state.yaw)) / 7, BRAIN.crouchTime, 0.6) };
    state.mode = 'crouch';
    state.phase = 'crouch';
  }

  function updateCrouch(dt) {
    crouch.clock += dt;
    for (let i = 0; i < CROUCH_KEYS.length; i++) {
      const key = CROUCH_KEYS[i];
      base[key] = damp(base[key], CROUCH_POSE[key], RATES[key] ?? 6, dt);
    }
    state.yaw = turnToward(state.yaw, crouch.heading, 9, 8, dt);
    state.drop = damp(state.drop, 0.07, 12, dt); // model units: the bone moves before the bird is scaled
    if (crouch.clock >= crouch.duration) {
      state.drop = 0;
      leaving = true;
      goAroundChecked = true;
      const heading = crouch.heading;
      follow(buildRoute(planExit({ x: state.x, y: state.y, z: state.z, heading, fromGround: true, curve: (rng() < 0.5 ? -1 : 1) * 0.1 }), world.groundAt));
      flap.flapping = true;
      flap.amp = 0.3;
    }
  }

  // Heads away from wherever it is in the air: a landing called off, or the light gone.
  function leaveFromAir() {
    leaving = true;
    goAroundChecked = true;
    const heading = Math.atan2(sampled.tx, sampled.tz) + (rng() - 0.5) * 0.8;
    const dir = [sampled.tx, Math.max(sampled.ty, 0), sampled.tz];
    follow(buildRoute(planExit({
      x: state.x, y: state.y, z: state.z, dir, speed: Math.max(sampled.speed, 4), heading, fromGround: false, curve: (rng() < 0.5 ? -1 : 1) * 0.08,
    }), world.groundAt));
  }

  // --- flying ---------------------------------------------------------------------------------------------------

  function updateFlying(dt, ctx) {
    route.sample(s, sampled);
    s += sampled.speed * dt;
    route.sample(s, sampled);
    place();
    const tag = sampled.tag;

    if (!leaving && state.kind === 'visit') {
      if (ctx.daylight < BRAIN.duskDaylight && tag !== 'flare' && tag !== 'touch') { leaveFromAir(); return; }
      if (tag === 'flare' && !goAroundChecked) {
        goAroundChecked = true;
        const player = ctx.player;
        if (player && Math.sqrt((player.x - landing.x) ** 2 + (player.z - landing.z) ** 2) < BRAIN.goAroundDistance) { leaveFromAir(); return; }
      }
    }

    // which way it faces: along the path, banked into the turn
    const yaw = Math.atan2(sampled.tx, sampled.tz);
    state.yaw += wrapAngle(yaw - state.yaw);
    const flaring = tag === 'flare' || tag === 'touch';
    const pitchTarget = Math.asin(clamp(sampled.ty, -1, 1)) * (flaring ? 0.25 : 1);
    state.pitch = damp(state.pitch, pitchTarget, 4, dt);
    const bank = Math.atan(sampled.speed * sampled.speed * sampled.turn / 9.8) * 1.8;
    state.roll = damp(state.roll, -clamp(bank, -0.75, 0.75), 3, dt);
    state.phase = tag;

    wings(STYLES[tag] ?? STYLES.cruise, dt);

    if (s >= route.length - 1e-6) {
      if (leaving) { finish(); return; }
      perched(landing);
      return;
    }
  }

  // The flapping and the rest of the pose, from the style of the stretch of route being flown.
  function wings(style, dt) {
    for (let i = 0; i < BODY_KEYS.length; i++) {
      const key = BODY_KEYS[i];
      base[key] = damp(base[key], style[key], RATES[key], dt);
    }
    base.streamers = damp(base.streamers, 0.8, RATES.streamers, dt);
    for (let i = 0; i < HEAD_KEYS.length; i++) base[HEAD_KEYS[i]] = damp(base[HEAD_KEYS[i]], 0, 6, dt);
    for (let i = 0; i < DOWN_KEYS.length; i++) base[DOWN_KEYS[i]] = damp(base[DOWN_KEYS[i]], 0, 8, dt);
    base.shake = damp(base.shake, 0, 10, dt);
    base.flap = damp(base.flap, 0.12, 6, dt);
    base.flex = damp(base.flex, -0.05, 6, dt);

    // bursts of flaps with glides between, unless the style flaps all the time
    flap.rate = damp(flap.rate, style.rate, 3, dt);
    const wrap = Math.floor(flap.phase / TAU);
    if (style.burst) {
      if (flap.flapping) {
        if (wrap > flap.lastWrap) flap.flapsLeft -= wrap - flap.lastWrap;
        if (flap.flapsLeft <= 0) { flap.flapping = false; flap.glide = style.burst[2] + rng() * (style.burst[3] - style.burst[2]); }
      } else {
        flap.glide -= dt;
        if (flap.glide <= 0) {
          flap.flapping = true;
          flap.flapsLeft = Math.round(style.burst[0] + rng() * (style.burst[1] - style.burst[0]));
          flap.phase = Math.floor(flap.phase / TAU) * TAU + Math.PI / 2; // start from the top of the stroke
        }
      }
    } else {
      flap.flapping = true;
    }
    flap.lastWrap = Math.floor(flap.phase / TAU);
    flap.amp = damp(flap.amp, flap.flapping ? style.amp : 0, flap.flapping ? 6 : 4, dt);
    flap.phase += TAU * flap.rate * dt;
    const strength = flap.amp / 0.7;
    osc.flap = flap.amp * Math.sin(flap.phase);
    osc.flex = 0.5 * strength * Math.sin(flap.phase - 0.9);
    osc.bodyPitch = 0.045 * strength * Math.cos(flap.phase);
    osc.tail = -0.1 * strength * Math.cos(flap.phase);
    state.bob = 0.035 * strength * scale * Math.cos(flap.phase);
  }

  function finish() {
    state.active = false;
    state.mode = 'gone';
    state.phase = 'gone';
    route = null;
  }

  // --- the frame ------------------------------------------------------------------------------------------------

  function update(dt, ctx) {
    if (!state.active || dt <= 0) return state;
    state.time += dt;
    if (state.mode === 'flying') updateFlying(dt, ctx);
    else {
      if (state.mode === 'perched') updatePerched(dt, ctx);
      else if (state.mode === 'crouch') updateCrouch(dt);
      // standing, the flapping dies away
      for (let i = 0; i < OSC_KEYS.length; i++) osc[OSC_KEYS[i]] = damp(osc[OSC_KEYS[i]], 0, 12, dt);
      state.bob = damp(state.bob, 0, 12, dt);
      base.flap = damp(base.flap, 0, 10, dt);
      base.flex = damp(base.flex, 0, 10, dt);
    }
    if (state.active) {
      for (let i = 0; i < POSE_KEYS.length; i++) {
        const key = POSE_KEYS[i];
        state.pose[key] = base[key] + (osc[key] ?? 0);
      }
      state.altitude = state.y - world.groundAt(state.x, state.z);
    }
    return state;
  }

  return {
    state,
    update,
    startVisit,
    startPassing,
    startPerched,
    // development: where the route stands, and a jump along it (so a screenshot can catch a chosen moment)
    get route() { return route; },
    get progress() { return route ? s : 0; },
    seek(distance, ctx) {
      if (!route) return;
      s = clamp(distance, 0, route.length - 0.01);
      route.sample(s, sampled);
      place();
      this.update(1e-4, ctx);
    },
    // Jumps to the point on the route, among the stretches with this tag, that is nearest `point` in the plane,
    // and `offset` metres on from there.
    seekNear(tag, point, offset, ctx) {
      if (!route) return;
      let best = 0;
      let bestDistance = Infinity;
      for (let d = 0; d < route.length; d += 1) {
        route.sample(d, sampled);
        if (sampled.tag !== tag) continue;
        const away = Math.hypot(sampled.x - point.x, sampled.z - point.z);
        if (away < bestDistance) { bestDistance = away; best = d; }
      }
      this.seek(best + offset, ctx);
    },
    get landing() { return landing; },
    FLIGHT,
  };
}
