import * as THREE from 'three';

// Loose things that fall: a tool you let go of, or throw. No physics engine: each thing is a thin rod (an axe, a torch, a spear)
// with a centre of mass, and it is simulated with the least that looks right:
//   in the air    gravity, a little drag, and either the spin your hand gave it or (for a spear) turning point-first along its flight;
//   on landing    it bounces a little and loses speed, a spear coming down point-first fast enough sticks in the sand,
//   settling      anything else topples about the end that touched until it lies along the ground, then rests (an axe also rolls its
//                 head flat), so it lies along a slope and not through it.
// The ground is a function (x, z) -> height; nothing else in the world is collided with, and things do not hit each other.
// Everything is allocation-free per step, so a few things in flight cost nothing. All numbers are in one table.

export const FALL = Object.freeze({
  gravity: 9.8,
  airDrag: 0.12, // per second
  slideDrag: 5, // per second, while it settles
  holdSlope: 0.7, // a settling thing stays put where the ground's normal points at least this far up (about 45 degrees of slope: sand grips, and no dune is steeper)
  maxSpeed: 28, // m/s
  maxSpin: 22, // rad/s
  spinDamp: 0.3, // per second
  bounce: 0.22, // how much of the speed into the ground comes back
  bounceMin: 1.0, // slower than this (m/s into the ground) there is no bounce
  friction: 0.5, // fraction of the sideways speed lost at each landing
  settleSpeed: 1.4, // below this speed after a landing, it starts to topple flat
  toppleAccel: 16, // rad/s^2 per unit of how steeply the rod stands
  toppleDamp: 1.2, // per second
  flatSin: 0.03, // the rod counts as lying flat when it is within about 2 degrees of the ground
  rollRate: 14, // how quickly an axe rolls its head flat
  alignRate: 7, // per second: how quickly a spear turns point-first along its flight
  alignMinSpeed: 2, // m/s sideways: slower than this (a drop) a spear does not turn point-first
  stickMinSpeed: 3, // m/s: slower than this a spear bounces and lies
  stickCos: 0.3, // the point must be within about 72 degrees of straight into the ground (a javelin thrown at a shallow angle still sticks)
  embedDepth: 0.2, // m, how far the point goes in
  maxTime: 12, // s: after this it is put to rest wherever it is
  substep: 1 / 90,
  maxSteps: 6,
  maxFrame: 0.05,
});

const UP = new THREE.Vector3(0, 1, 0);
const axis = new THREE.Vector3();
const normal = new THREE.Vector3();
const endBottom = new THREE.Vector3();
const endTop = new THREE.Vector3();
const pivot = new THREE.Vector3();
const other = new THREE.Vector3();
const dir = new THREE.Vector3();
const turn = new THREE.Vector3();
const edgeWorld = new THREE.Vector3();
const scratch = new THREE.Vector3();
const dq = new THREE.Quaternion();
const dq2 = new THREE.Quaternion();
const IDENTITY = new THREE.Quaternion();
const EPS = 0.25;

export function createBody(shape) {
  const bottom = shape.bottom;
  const top = shape.top;
  return {
    shape: {
      bottom,
      top,
      com: shape.com ?? (bottom + top) / 2,
      radius: shape.radius ?? 0.03,
      landing: shape.landing ?? 'lie',
      edge: shape.edge ? new THREE.Vector3().fromArray(shape.edge).normalize() : null,
    },
    phase: 'idle', // idle | air | settling | rest | stuck
    centre: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    velocity: new THREE.Vector3(),
    spin: new THREE.Vector3(),
    time: 0,
    topple: 0,
  };
}

const worldAxis = (body, out) => out.copy(UP).applyQuaternion(body.quaternion);

function ends(body) {
  worldAxis(body, axis);
  endBottom.copy(body.centre).addScaledVector(axis, body.shape.bottom - body.shape.com);
  endTop.copy(body.centre).addScaledVector(axis, body.shape.top - body.shape.com);
}

// Start (or restart) a fall: origin and quaternion are the model's pose in the world, velocity in m/s, spin in rad/s (world axes).
export function launch(body, { origin, quaternion, velocity, spin }) {
  body.quaternion.copy(quaternion);
  worldAxis(body, axis);
  body.centre.copy(origin).addScaledVector(axis, body.shape.com);
  body.velocity.copy(velocity).clampLength(0, FALL.maxSpeed);
  body.spin.copy(spin).clampLength(0, FALL.maxSpin);
  body.phase = 'air';
  body.time = 0;
  body.topple = 0;
}

// The model origin's world position for the body's current pose.
export function bodyOrigin(body, out) {
  worldAxis(body, axis);
  return out.copy(body.centre).addScaledVector(axis, -body.shape.com);
}

export const isMoving = body => body.phase === 'air' || body.phase === 'settling';

function groundNormal(heightAt, x, z, out) {
  const dx = (heightAt(x + EPS, z) - heightAt(x - EPS, z)) / (2 * EPS);
  const dz = (heightAt(x, z + EPS) - heightAt(x, z - EPS)) / (2 * EPS);
  return out.set(-dx, 1, -dz).normalize();
}

function embed(body, heightAt) {
  // The point goes a little way into the sand along the shaft and the spear stays there.
  worldAxis(body, axis);
  const tip = endTop;
  const x = tip.x;
  const z = tip.z;
  tip.set(x, heightAt(x, z), z).addScaledVector(axis, FALL.embedDepth);
  body.centre.copy(tip).addScaledVector(axis, body.shape.com - body.shape.top);
  body.velocity.set(0, 0, 0);
  body.spin.set(0, 0, 0);
  body.phase = 'stuck';
}

function rollEdgeFlat(body, n, dt) {
  const edge = body.shape.edge;
  if (!edge) return true;
  worldAxis(body, axis);
  edgeWorld.copy(edge).applyQuaternion(body.quaternion);
  edgeWorld.addScaledVector(axis, -edgeWorld.dot(axis));
  const length = edgeWorld.length();
  if (length < 1e-3) return true;
  edgeWorld.divideScalar(length);
  const lift = edgeWorld.dot(n);
  if (Math.abs(lift) < 0.04) return true;
  let g = scratch.crossVectors(axis, edgeWorld).dot(n);
  if (Math.abs(g) < 0.25) g = g < 0 ? -0.25 : 0.25; // standing exactly on edge: tip it one way
  const step = THREE.MathUtils.clamp(-FALL.rollRate * lift * g * dt, -0.2, 0.2);
  dq.setFromAxisAngle(axis, step);
  body.quaternion.premultiply(dq).normalize();
  return false;
}

function stepOnce(body, dt, heightAt) {
  const { shape, velocity, spin, quaternion, centre } = body;
  const settling = body.phase === 'settling';
  body.time += dt;

  velocity.y -= FALL.gravity * dt;
  velocity.multiplyScalar(Math.exp(-(settling ? FALL.slideDrag : FALL.airDrag) * dt)).clampLength(0, FALL.maxSpeed);

  if (!settling) {
    const speed = velocity.length();
    if (shape.landing === 'stick' && Math.hypot(velocity.x, velocity.z) > FALL.alignMinSpeed) {
      // Thrown forward: turn point-first along the flight. (Merely dropped, it keeps whatever way it was pointing and falls flat.)
      worldAxis(body, axis);
      dir.copy(velocity).divideScalar(speed);
      dq.setFromUnitVectors(axis, dir);
      dq2.copy(IDENTITY).slerp(dq, 1 - Math.exp(-FALL.alignRate * dt));
      quaternion.premultiply(dq2).normalize();
      spin.multiplyScalar(Math.exp(-5 * dt));
    } else {
      const w = spin.length();
      if (w > 1e-4) {
        dq.setFromAxisAngle(turn.copy(spin).divideScalar(w), w * dt);
        quaternion.premultiply(dq).normalize();
        spin.multiplyScalar(Math.exp(-FALL.spinDamp * dt));
      }
    }
  }
  centre.addScaledVector(velocity, dt);

  ends(body);
  const r = shape.radius;
  const lowBottom = heightAt(endBottom.x, endBottom.z) + r - endBottom.y;
  const lowTop = heightAt(endTop.x, endTop.z) + r - endTop.y;
  const touchingTop = lowTop > lowBottom;
  const penetration = touchingTop ? lowTop : lowBottom;
  const contact = touchingTop ? endTop : endBottom;

  if (penetration > 0) {
    centre.y += penetration;
    endBottom.y += penetration;
    endTop.y += penetration;
    groundNormal(heightAt, contact.x, contact.z, normal);
    const into = velocity.dot(normal);
    if (into < 0) {
      if (!settling && shape.landing === 'stick' && touchingTop && velocity.length() >= FALL.stickMinSpeed) {
        worldAxis(body, axis);
        if (axis.dot(normal) <= -FALL.stickCos) { embed(body, heightAt); return; }
      }
      const bounce = -into > FALL.bounceMin && !settling ? FALL.bounce : 0;
      velocity.addScaledVector(normal, -into * (1 + bounce));
      if (settling && normal.y >= FALL.holdSlope) {
        velocity.addScaledVector(normal, -velocity.dot(normal)); // friction holds it on a gentle slope
        velocity.set(0, 0, 0);
      } else if (!settling) {
        const along = velocity.dot(normal);
        scratch.copy(velocity).addScaledVector(normal, -along).multiplyScalar(1 - FALL.friction);
        velocity.copy(scratch).addScaledVector(normal, along);
        spin.multiplyScalar(0.5);
      }
    }
    if (!settling && velocity.length() < FALL.settleSpeed) {
      body.phase = 'settling';
      body.topple = 0;
    }
  }

  if (body.phase === 'settling') {
    // Topple about whichever end is lowest until the rod lies along the ground.
    const lowEnd = endBottom.y - heightAt(endBottom.x, endBottom.z) <= endTop.y - heightAt(endTop.x, endTop.z);
    pivot.copy(lowEnd ? endBottom : endTop);
    other.copy(lowEnd ? endTop : endBottom);
    groundNormal(heightAt, pivot.x, pivot.z, normal);
    dir.copy(other).sub(pivot);
    const length = dir.length();
    if (length > 1e-6) dir.divideScalar(length);
    const standing = Math.max(0, dir.dot(normal));
    if (standing > FALL.flatSin) {
      body.topple = (body.topple + FALL.toppleAccel * standing * dt) * Math.exp(-FALL.toppleDamp * dt);
      const angle = Math.min(body.topple * dt, Math.asin(Math.min(1, standing)));
      turn.crossVectors(dir, normal);
      if (turn.lengthSq() < 1e-8) turn.set(1, 0, 0).addScaledVector(normal, -normal.x);
      turn.normalize();
      dq.setFromAxisAngle(turn, -angle);
      quaternion.premultiply(dq).normalize();
      centre.sub(pivot).applyQuaternion(dq).add(pivot);
    } else if (rollEdgeFlat(body, normal, dt) && velocity.lengthSq() < 0.01) {
      body.phase = 'rest';
      velocity.set(0, 0, 0);
      spin.set(0, 0, 0);
      return;
    }
  }

  if (body.time > FALL.maxTime) {
    body.phase = 'rest';
    velocity.set(0, 0, 0);
    spin.set(0, 0, 0);
  }
}

// Advance a falling body by dt seconds (in small steps). Returns true while it is still moving.
export function stepBody(body, dt, heightAt) {
  if (!isMoving(body)) return false;
  const frame = Math.min(Math.max(dt, 0), FALL.maxFrame);
  if (frame <= 0) return true;
  const steps = Math.min(FALL.maxSteps, Math.ceil(frame / FALL.substep));
  const h = frame / steps;
  for (let i = 0; i < steps && isMoving(body); i++) stepOnce(body, h, heightAt);
  return isMoving(body);
}
