import { COLOSSUS_BRAIN } from './colossus-brain.js';

// Colossus 01's footsteps and body motion, with no three.js in it (so a test can walk it in metres). The brain (src/colossus-brain.js) says where
// the body goes and keeps the gait clock; this decides where each foot is, when it lifts and lands, and how the body rides over the legs.
// src/colossus-pose.js turns the result into bones.
//
// A lateral-sequence walk (the way an elephant walks): hind left, front left, hind right, front right, each foot in the air for a quarter of the
// cycle, so three feet are always down. A foot that is down stays exactly where it landed (the world holds it), the body moves over it. A foot that
// lifts is aimed at the spot it would land if the body kept going the way it is going (from the brain's speed, turn and acceleration), half a stride
// ahead of where that leg sits at rest, so it lands where the body will be by then. Feet roll heel to toe on the ground, lift in a slow arc and come
// down hard (the descent is faster than the lift), and the landing is reported as an event for the dust and the footprints.

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

export const GAIT = Object.freeze({
  duty: 0.75, // the share of the cycle a foot is on the ground
  order: Object.freeze({ BL: 0, FL: 0.25, BR: 0.5, FR: 0.75 }), // each leg's phase offset
  lift: 3.4, // metres the ankle rises at the top of a full stride
  strokeFull: 12.5, // metres of stride at which the lift is full; shorter steps are lower
  lowestLift: 0.3, // share of the lift kept by the very smallest steps
  commit: 0.15, // the foot's landing spot is still adjusted until this far into the swing
  normalStep: 3, // metres either side of a foot where the ground is read for its tilt
  // The foot, in metres: where the ankle bone sits above the sole, and how far the sole reaches ahead of and behind the ankle
  foot: Object.freeze({ ankle: 5.99, front: 6.0, back: 6.5 }),
  // The foot's pitch (radians, positive is toes down, heel up) through a step
  pitch: Object.freeze({ strike: -0.17, toeOff: 0.24, rollIn: 0.14, rollOutFrom: 0.72, swingToe: 0.24, swingHeel: -0.17 }),
  curl: 0.34, // how far the toes hang down (radians) at the middle of a swing
  pivotFade: Object.freeze([0.3, 0.7]), // in a swing the heel or toe pivot is faded out between these two parts of the swing and back in at the other end
});

// The legs as the model has them at rest: the ankle's x and z (the hip is straight above), and where in the cycle the leg steps.
export const MODEL_LEGS = Object.freeze([
  Object.freeze({ name: 'BL', home: Object.freeze([9, -19]), offset: GAIT.order.BL }),
  Object.freeze({ name: 'FL', home: Object.freeze([9, 19]), offset: GAIT.order.FL }),
  Object.freeze({ name: 'BR', home: Object.freeze([-9, -19]), offset: GAIT.order.BR }),
  Object.freeze({ name: 'FR', home: Object.freeze([-9, 19]), offset: GAIT.order.FR }),
]);

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const frac = v => v - Math.floor(v);
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrapPi = a => { let w = (a + Math.PI) % TAU; if (w < 0) w += TAU; return w - Math.PI; };

// ---- the shapes of a step -------------------------------------------------------------------------------------------------------------------
// How high the foot is (0 to 1) a fraction u of the way through a swing: up slowly (it starts from rest: at a full stride the first tenth of a second
// is a few centimetres, never a kick), peaking a little past the middle, then down faster, so it lands with weight (about 6.7 m/s at the end).
export function swingLift(u) {
  const t = clamp(u, 0, 1);
  return Math.sin(Math.PI * Math.pow(t, 1.2));
}
// How far along the swing the foot has travelled: nearly nothing while it first leaves the ground, then a glide
export function swingTravel(u) { return smooth(0.08, 0.92, u); }
// The foot's pitch at the start of its stance (heel strike, rolling flat) to the end (the heel lifting for toe-off), by the fraction w of the stance
export function stancePitch(w, P = GAIT.pitch) {
  return P.strike * (1 - smooth(0, P.rollIn, w)) + P.toeOff * smooth(P.rollOutFrom, 1, w);
}
// ...and through the swing: the toes hang down as it leaves the ground, the foot levels, then the toes come up for the heel to land first
export function swingPitch(u, P = GAIT.pitch) {
  return P.swingToe * (1 - smooth(0, 0.5, u)) + P.swingHeel * smooth(0.55, 0.95, u);
}
// How much of the heel or toe pivot still shows in the ankle's position at a point in the swing (1 at both ends, 0 in the middle)
export function pivotWeight(u, [a, b] = GAIT.pivotFade) {
  return Math.max(1 - smooth(0, a, u), smooth(b, 1, u));
}

// ---- where the ankle goes -------------------------------------------------------------------------------------------------------------------
// The leg's foot frame: the way it points (f, in the ground plane), up (n, the ground's normal) and across (side = n x f, towards the animal's left).
export function footFrame(leg, out = { f: [0, 0, 1], n: [0, 1, 0], side: [1, 0, 0] }) {
  const nl = Math.hypot(leg.nx, leg.ny, leg.nz) || 1;
  const nx = leg.nx / nl, ny = leg.ny / nl, nz = leg.nz / nl;
  const hx = Math.sin(leg.yaw), hz = Math.cos(leg.yaw);
  const d = hx * nx + hz * nz;
  let fx = hx - d * nx, fy = -d * ny, fz = hz - d * nz;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
  out.n[0] = nx; out.n[1] = ny; out.n[2] = nz;
  out.f[0] = fx; out.f[1] = fy; out.f[2] = fz;
  out.side[0] = ny * fz - nz * fy; out.side[1] = nz * fx - nx * fz; out.side[2] = nx * fy - ny * fx;
  return out;
}

// The ankle bone's world position for a leg: its place on the ground, lifted by the swing and rolled about the heel or the toe. Writes into `out` ([x, y, z]).
export function ankleTarget(leg, frame, out, foot = GAIT.foot) {
  const th = leg.pitch;
  const c = Math.cos(th), s = Math.sin(th);
  let along = 0, up = foot.ankle;
  if (th > 0) { // heel up: the foot turns about the front edge of its sole
    along = foot.front * (1 - c) + foot.ankle * s;
    up = foot.ankle * c + foot.front * s;
  } else if (th < 0) { // toe up: it turns about the heel
    along = -foot.back * (1 - c) + foot.ankle * s;
    up = foot.ankle * c - foot.back * s;
  }
  const w = leg.pivot;
  along *= w;
  up = foot.ankle + (up - foot.ankle) * w + leg.raise;
  out[0] = leg.x + frame.f[0] * along + frame.n[0] * up;
  out[1] = leg.y + frame.f[1] * along + frame.n[1] * up;
  out[2] = leg.z + frame.f[2] * along + frame.n[2] * up;
  return out;
}

// ---- the planner ----------------------------------------------------------------------------------------------------------------------------
export function createGait({ legs = MODEL_LEGS, groundAt = () => 0, config = GAIT, walkSpeed = COLOSSUS_BRAIN.walkSpeed } = {}) {
  const duty = config.duty;
  const list = legs.map(def => ({
    name: def.name, offset: def.offset, hx: def.home[0], hz: def.home[1],
    stance: true, committed: true, upFired: true, u: 0, w: 0,
    // where it is planted (or lifted from), and where it is going
    px: 0, py: 0, pz: 0, pyaw: 0, pnx: 0, pny: 1, pnz: 0,
    tx: 0, ty: 0, tz: 0, tyaw: 0, tnx: 0, tny: 1, tnz: 0,
    // what the pose reads: the ankle's place on the ground, the foot's heading and normal, how high it is lifted, its pitch and toe curl
    x: 0, y: 0, z: 0, yaw: 0, nx: 0, ny: 1, nz: 0, raise: 0, pitch: 0, curl: 0, pivot: 1, stroke: 0,
  }));
  const events = Array.from({ length: list.length * 2 }, () => ({ kind: 'down', leg: 0, name: '', x: 0, y: 0, z: 0, power: 0 }));
  const out = { events, eventCount: 0, legs: list, groundY: 0, pitchDown: 0, roll: 0 };
  const pose = { x: 0, z: 0, yaw: 0, speed: 0 };
  const sample = { y: 0, nx: 0, ny: 1, nz: 0 };
  const wheelbase = Math.max(1, Math.max(...list.map(l => l.hz)) - Math.min(...list.map(l => l.hz)));
  const track = Math.max(1, Math.max(...list.map(l => l.hx)) - Math.min(...list.map(l => l.hx)));
  let seated = false;
  let lastCycles = NaN;

  // where the body will be (and how fast it will go) t seconds from now
  function predict(s, t) {
    const v1 = clamp(s.speed + (s.accel ?? 0) * t, 0, walkSpeed);
    const mid = s.yaw + s.turn * t * 0.5;
    pose.speed = v1;
    pose.yaw = s.yaw + s.turn * t;
    pose.x = s.x + Math.sin(mid) * (s.speed + v1) * 0.5 * t;
    pose.z = s.z + Math.cos(mid) * (s.speed + v1) * 0.5 * t;
    return pose;
  }

  function readGround(x, z) {
    const d = config.normalStep;
    sample.y = groundAt(x, z);
    const gx = (groundAt(x + d, z) - groundAt(x - d, z)) / (2 * d);
    const gz = (groundAt(x, z + d) - groundAt(x, z - d)) / (2 * d);
    const l = Math.hypot(gx, 1, gz);
    sample.nx = -gx / l; sample.ny = 1 / l; sample.nz = -gz / l;
  }

  // the world position of a point in the body's frame (x to the left, z ahead) for a body at (px, pz) facing yaw
  const worldX = (px, yaw, lx, lz) => px + lx * Math.cos(yaw) + lz * Math.sin(yaw);
  const worldZ = (pz, yaw, lx, lz) => pz - lx * Math.sin(yaw) + lz * Math.cos(yaw);

  function aim(leg, s, remaining) {
    predict(s, remaining);
    const half = 0.5 * pose.speed * duty * s.cycle;
    leg.tx = worldX(pose.x, pose.yaw, leg.hx, leg.hz + half);
    leg.tz = worldZ(pose.z, pose.yaw, leg.hx, leg.hz + half);
    leg.tyaw = pose.yaw;
  }

  function plant(leg, x, z, yaw) {
    readGround(x, z);
    leg.px = x; leg.pz = z; leg.pyaw = yaw;
    leg.py = sample.y; leg.pnx = sample.nx; leg.pny = sample.ny; leg.pnz = sample.nz;
  }

  function reseat(s) {
    const half = 0.5 * s.speed * duty * s.cycle;
    for (const leg of list) {
      const psi = frac(s.cycles - leg.offset);
      if (psi < duty) {
        const ahead = half * (1 - 2 * (psi / duty));
        plant(leg, worldX(s.x, s.yaw, leg.hx, leg.hz + ahead), worldZ(s.z, s.yaw, leg.hx, leg.hz + ahead), s.yaw);
        leg.stance = true;
      } else {
        // in the air: it lifted off from half a stride behind home where the body was then, and lands half a stride ahead of home where the body will be
        const u = (psi - duty) / (1 - duty);
        predict(s, -u * (1 - duty) * s.cycle);
        const behind = 0.5 * pose.speed * duty * s.cycle;
        plant(leg, worldX(pose.x, pose.yaw, leg.hx, leg.hz - behind), worldZ(pose.z, pose.yaw, leg.hx, leg.hz - behind), pose.yaw);
        aim(leg, s, (1 - u) * (1 - duty) * s.cycle);
        readGround(leg.tx, leg.tz);
        leg.ty = sample.y; leg.tnx = sample.nx; leg.tny = sample.ny; leg.tnz = sample.nz;
        leg.stance = false; leg.committed = true; leg.upFired = true;
      }
    }
    seated = true;
  }

  function event(kind, i, x, y, z, power) {
    if (out.eventCount >= events.length) return;
    const e = events[out.eventCount++];
    e.kind = kind; e.leg = i; e.name = list[i].name; e.x = x; e.y = y; e.z = z; e.power = power;
  }

  // Moves every foot on to the brain's state. `s` is the brain's state; dt the frame's seconds.
  function update(s, dt) {
    out.eventCount = 0;
    if (!seated || !(dt >= 0) || dt > 1.5 || !Number.isFinite(lastCycles) || Math.abs(s.cycles - lastCycles) > 1.2) reseat(s);
    lastCycles = s.cycles;
    const calm = clamp(s.calm ?? 0, 0, 1);
    let front = 0, back = 0, left = 0, right = 0, total = 0;
    for (let i = 0; i < list.length; i++) {
      const leg = list[i];
      const psi = frac(s.cycles - leg.offset);
      const swing = psi >= duty;
      if (swing && leg.stance) { // lifts off
        leg.stance = false; leg.committed = false; leg.upFired = false;
        aim(leg, s, (1 - duty) * s.cycle);
      } else if (!swing && !leg.stance) { // comes down
        leg.stance = true;
        const x = leg.tx, z = leg.tz;
        plant(leg, x, z, leg.tyaw);
        event('down', i, x, leg.py, z, 0.4 + 0.6 * clamp(leg.stroke / config.strokeFull, 0, 1));
      }
      if (swing) {
        const u = (psi - duty) / (1 - duty);
        leg.u = u;
        if (!leg.committed) {
          aim(leg, s, (1 - u) * (1 - duty) * s.cycle);
          if (u >= config.commit) {
            readGround(leg.tx, leg.tz);
            leg.ty = sample.y; leg.tnx = sample.nx; leg.tny = sample.ny; leg.tnz = sample.nz;
            leg.committed = true;
          } else { leg.ty = leg.py; leg.tnx = leg.pnx; leg.tny = leg.pny; leg.tnz = leg.pnz; }
        }
        if (!leg.upFired && u >= 0.06) {
          leg.upFired = true;
          event('up', i, leg.px, leg.py, leg.pz, 0.3);
        }
        const t = swingTravel(u);
        leg.x = mix(leg.px, leg.tx, t); leg.z = mix(leg.pz, leg.tz, t); leg.y = mix(leg.py, leg.ty, t);
        leg.yaw = leg.pyaw + wrapPi(leg.tyaw - leg.pyaw) * t;
        leg.nx = mix(leg.pnx, leg.tnx, t); leg.ny = mix(leg.pny, leg.tny, t); leg.nz = mix(leg.pnz, leg.tnz, t);
        leg.stroke = Math.hypot(leg.tx - leg.px, leg.tz - leg.pz);
        leg.raise = config.lift * clamp(leg.stroke / config.strokeFull, config.lowestLift, 1) * swingLift(u);
        leg.pitch = swingPitch(u, config.pitch);
        // the toes stay level at first (as they did in the stance), then hang a little through the middle of the swing
        leg.curl = -0.9 * Math.max(leg.pitch, 0) * (1 - smooth(0, 0.3, u)) + config.curl * Math.sin(Math.PI * clamp(u, 0, 1));
        leg.pivot = pivotWeight(u, config.pivotFade);
      } else {
        const w = psi / duty;
        leg.u = 0; leg.w = w;
        leg.x = leg.px; leg.y = leg.py; leg.z = leg.pz; leg.yaw = leg.pyaw;
        leg.nx = leg.pnx; leg.ny = leg.pny; leg.nz = leg.pnz;
        leg.raise = 0;
        leg.pitch = stancePitch(w, config.pitch);
        leg.curl = -0.9 * Math.max(leg.pitch, 0);
        leg.pivot = 1;
      }
      // standing still, the feet settle flat
      leg.pitch *= 1 - calm;
      leg.curl *= 1 - calm;
      if (leg.hz > 0) front += leg.y; else back += leg.y;
      if (leg.hx > 0) left += leg.y; else right += leg.y;
      total += leg.y;
    }
    const half = list.length / 2;
    out.groundY = total / list.length;
    out.pitchDown = Math.atan2(back / half - front / half, wheelbase);
    out.roll = Math.atan2(left / half - right / half, track);
    return out;
  }

  return { update, reseat: s => reseat(s), out, legs: list, get seated() { return seated; } };
}

// ---- the body's own motion ------------------------------------------------------------------------------------------------------------------
// How the body sways, pitches and breathes, how the neck follows the gaze and the tail follows the turn. All of it through critically damped springs:
// the slow response is what gives it weight.
export const MOTION = Object.freeze({
  sway: 1.1, // metres the body shifts towards the feet that are down
  idleSway: 0.3, // metres of slow weight shifting while it stands
  idleSwayEvery: 17, // seconds
  rollGait: 0.5 * DEG,
  pitchGait: 0.35 * DEG,
  nod: 1.5 * DEG, // the head dips as a front foot lands
  bend: 4 * DEG, // the spine's bend into a turn at the fastest turn
  jaw: Object.freeze({ base: 1.5 * DEG, swing: 2.2 * DEG, every: 9 }),
  omega: Object.freeze({ body: 2.2, gaze: 1.1, bend: 0.8, nod: 2.4, tail: 0.9 }),
});

function springStep(sp, target, dt, w) {
  const d = sp.x - target;
  const e = Math.exp(-w * dt);
  const t = (sp.v + w * d) * dt;
  sp.x = target + (d + t) * e;
  sp.v = (sp.v - w * t) * e;
  return sp.x;
}

export function createBodyMotion({ config = MOTION, walkSpeed = COLOSSUS_BRAIN.walkSpeed, maxTurn = COLOSSUS_BRAIN.maxTurn } = {}) {
  const names = ['sway', 'pitch', 'roll', 'bend', 'gazeYaw', 'gazePitch', 'nod', 'tail'];
  const sp = Object.fromEntries(names.map(n => [n, { x: 0, v: 0 }]));
  let primed = false;
  const out = {
    sway: 0, pitchDown: 0, roll: 0, spineBend: 0, gazeYaw: 0, gazePitch: 0, nod: 0, jaw: 0, tailBias: 0,
    move: 0, breath: 0, tail: 0,
  };
  function update(s, ground, dt) {
    dt = clamp(dt, 0, 0.1);
    const mf = clamp(s.speed / walkSpeed, 0, 1);
    const c = s.cycles;
    const W = config.omega;
    const bendTarget = clamp(s.turn / maxTurn, -1, 1) * config.bend;
    const swayTarget = -config.sway * Math.cos(TAU * c) * mf + config.idleSway * Math.sin(TAU * s.time / config.idleSwayEvery) * (1 - mf);
    const targets = {
      sway: swayTarget,
      pitch: ground.pitchDown + config.pitchGait * Math.sin(2 * TAU * c) * mf,
      roll: ground.roll - config.rollGait * Math.cos(TAU * c) * mf,
      bend: bendTarget,
      gazeYaw: s.gaze.yaw,
      gazePitch: s.gaze.pitch,
      nod: config.nod * Math.cos(2 * TAU * (c - 0.25)) * mf,
      tail: -bendTarget * 0.8,
    };
    if (!primed) { for (const n of names) sp[n].x = targets[n]; primed = true; }
    out.sway = springStep(sp.sway, targets.sway, dt, W.body);
    out.pitchDown = springStep(sp.pitch, targets.pitch, dt, W.body);
    out.roll = springStep(sp.roll, targets.roll, dt, W.body);
    out.spineBend = springStep(sp.bend, targets.bend, dt, W.bend);
    out.gazeYaw = springStep(sp.gazeYaw, targets.gazeYaw, dt, W.gaze);
    out.gazePitch = springStep(sp.gazePitch, targets.gazePitch, dt, W.gaze);
    out.nod = springStep(sp.nod, targets.nod, dt, W.nod);
    out.tailBias = springStep(sp.tail, targets.tail, dt, W.tail);
    out.jaw = config.jaw.base + config.jaw.swing * (0.5 + 0.5 * Math.sin(TAU * s.time / config.jaw.every));
    out.move = mf;
    out.breath = Math.sin(s.breath);
    out.tail = s.tail;
    return out;
  }
  return { update, out };
}
