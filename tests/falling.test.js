import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FALL, createBody, launch, stepBody, bodyOrigin, isMoving } from '../src/falling.js';
import { createHandMotion, HAND_MOTION } from '../src/hand-motion.js';

const flat = () => 0;
const slope = (rise) => (x) => x * rise; // rises along +x
const ZERO = new THREE.Vector3();
const spear = () => createBody({ bottom: -0.52, top: 0.955, com: 0.15, radius: 0.025, landing: 'stick' });
const axe = () => createBody({ bottom: -0.131, top: 0.438, com: 0.3, radius: 0.04, landing: 'lie', edge: [1, 0, 0] });

function run(body, heightAt, seconds = 8, dt = 1 / 72) {
  let lowest = Infinity;
  const end = new THREE.Vector3();
  for (let t = 0; t < seconds && isMoving(body); t += dt) {
    stepBody(body, dt, heightAt);
    for (const y of [body.shape.bottom, body.shape.top]) {
      end.set(0, y - body.shape.com, 0).applyQuaternion(body.quaternion).add(body.centre);
      lowest = Math.min(lowest, end.y - heightAt(end.x, end.z) - body.shape.radius);
    }
    assert.ok(Number.isFinite(body.centre.x + body.centre.y + body.centre.z), 'no NaN');
  }
  return lowest;
}
const axisOf = body => new THREE.Vector3(0, 1, 0).applyQuaternion(body.quaternion);

test('a tool let go of upright falls, lands, topples and lies flat on level ground, never going through it', () => {
  const body = createBody({ bottom: -0.131, top: 0.527, com: 0.2, radius: 0.04 });
  launch(body, { origin: new THREE.Vector3(0, 1.0, 0), quaternion: new THREE.Quaternion(), velocity: ZERO, spin: ZERO });
  const lowest = run(body, flat);
  assert.equal(body.phase, 'rest', 'it comes to rest');
  assert.ok(lowest > -0.02, `it never sinks into the ground (${lowest.toFixed(3)})`);
  assert.ok(Math.abs(axisOf(body).y) < 0.05, `it lies flat (axis y ${axisOf(body).y.toFixed(3)})`);
  assert.ok(Math.abs(body.centre.y - 0.04) < 0.02, `resting on its radius (${body.centre.y.toFixed(3)})`);
});

test('a bounce loses energy: it never rises as high as it was dropped from', () => {
  const body = createBody({ bottom: -0.1, top: 0.1, radius: 0.05 });
  launch(body, { origin: new THREE.Vector3(0, 2, 0), quaternion: new THREE.Quaternion(), velocity: ZERO, spin: ZERO });
  let landed = false, peak = 0;
  for (let t = 0; t < 3; t += 1 / 90) {
    stepBody(body, 1 / 90, flat);
    if (body.velocity.y > 0) landed = true;
    if (landed) peak = Math.max(peak, body.centre.y);
  }
  assert.ok(landed && peak < 1.0, `bounced up to ${peak.toFixed(2)} m from 2 m`);
});

test('on a slope it comes to rest lying along the slope, not across it', () => {
  const rise = 0.3;
  const body = createBody({ bottom: -0.131, top: 0.527, com: 0.2, radius: 0.04 });
  launch(body, { origin: new THREE.Vector3(0, 0.8, 0), quaternion: new THREE.Quaternion(), velocity: ZERO, spin: ZERO });
  const lowest = run(body, slope(rise));
  assert.equal(body.phase, 'rest');
  assert.ok(lowest > -0.03, `above the ground (${lowest.toFixed(3)})`);
  const normal = new THREE.Vector3(-rise, 1, 0).normalize();
  assert.ok(Math.abs(axisOf(body).dot(normal)) < 0.12, `along the slope (${axisOf(body).dot(normal).toFixed(3)})`);
});

test('a spear thrown point-first at the ground sticks, with the point in the sand and nothing moving', () => {
  const body = spear();
  const throwDir = new THREE.Vector3(1, -0.45, 0).normalize();
  launch(body, {
    origin: new THREE.Vector3(0, 1.6, 0), quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), throwDir),
    velocity: throwDir.clone().multiplyScalar(12), spin: ZERO,
  });
  run(body, flat);
  assert.equal(body.phase, 'stuck');
  assert.equal(body.velocity.length(), 0);
  const tip = new THREE.Vector3(0, body.shape.top - body.shape.com, 0).applyQuaternion(body.quaternion).add(body.centre);
  assert.ok(tip.y < -0.03 && tip.y > -0.35, `the point is ${(-tip.y).toFixed(2)} m into the sand`);
  assert.ok(axisOf(body).y < -0.2, 'still pointing down into it');
});

test('a spear dropped from the hand, or thrown too softly, does not stick: it lies on the ground', () => {
  const dropped = spear();
  launch(dropped, { origin: new THREE.Vector3(0, 1, 0), quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0.2, 0).normalize()), velocity: ZERO, spin: ZERO });
  run(dropped, flat);
  assert.equal(dropped.phase, 'rest');
  assert.ok(Math.abs(axisOf(dropped).y) < 0.06, 'lying flat');

  const soft = spear();
  const dir = new THREE.Vector3(1, -0.8, 0).normalize();
  launch(soft, { origin: new THREE.Vector3(0, 0.72, 0), quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir), velocity: dir.clone().multiplyScalar(FALL.stickMinSpeed * 0.3), spin: ZERO });
  run(soft, flat);
  assert.equal(soft.phase, 'rest', 'a gentle landing never sticks');

  const fromHeight = spear();
  launch(fromHeight, { origin: new THREE.Vector3(0, 1.5, 0), quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir), velocity: ZERO, spin: ZERO });
  run(fromHeight, flat);
  assert.equal(fromHeight.phase, 'stuck', 'dropped point-down from head height it does stick');
});

test('a spear thrown flat and fast lands on its side and does not stick', () => {
  const body = spear();
  const dir = new THREE.Vector3(1, 0.05, 0).normalize();
  launch(body, { origin: new THREE.Vector3(0, 1.2, 0), quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir), velocity: dir.clone().multiplyScalar(10), spin: ZERO });
  run(body, flat, 10);
  assert.equal(body.phase, 'rest');
  assert.ok(Math.abs(axisOf(body).y) < 0.08);
});

test('an axe comes to rest with its head flat, whatever way it was turned about its handle', () => {
  for (const roll of [0, 1, 2, 3, 4.5]) {
    const body = axe();
    launch(body, { origin: new THREE.Vector3(0, 0.9, 0), quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), roll), velocity: ZERO, spin: ZERO });
    run(body, flat, 10);
    assert.equal(body.phase, 'rest', `roll ${roll} rests`);
    const edge = new THREE.Vector3(1, 0, 0).applyQuaternion(body.quaternion);
    assert.ok(Math.abs(edge.y) < 0.12, `roll ${roll}: the head lies flat (edge y ${edge.y.toFixed(3)})`);
  }
});

test('anything stops by the time limit, and the origin it reports is where the model should be drawn', () => {
  const body = createBody({ bottom: -0.2, top: 0.4, com: 0.1, radius: 0.03 });
  launch(body, { origin: new THREE.Vector3(2, 3, -1), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(30, 5, 0), spin: new THREE.Vector3(40, 0, 0) });
  assert.ok(body.velocity.length() <= FALL.maxSpeed + 1e-9 && body.spin.length() <= FALL.maxSpin + 1e-9, 'launch speeds are capped');
  run(body, flat, FALL.maxTime + 2);
  assert.ok(!isMoving(body));
  const origin = bodyOrigin(body, new THREE.Vector3());
  const check = new THREE.Vector3(0, body.shape.com, 0).applyQuaternion(body.quaternion).add(origin);
  assert.ok(check.distanceTo(body.centre) < 1e-9);
});

test('hand motion: speed and turning are read from the last tenth of a second, capped, and restart after a pause', () => {
  const motion = createHandMotion();
  const hand = new THREE.Object3D();
  const key = {};
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  assert.equal(motion.measure(key, v, w), false, 'no history yet');
  const dt = 1 / 72;
  for (let i = 0; i < 20; i++) {
    hand.position.set(2.0 * i * dt, 1, 0);
    hand.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 3.0 * i * dt);
    hand.updateMatrixWorld(true);
    motion.record(key, hand, dt);
  }
  assert.equal(motion.measure(key, v, w), true);
  assert.ok(Math.abs(v.x - 2) < 0.05 && Math.abs(v.y) < 1e-6, `velocity ${v.toArray().map(n => n.toFixed(2))}`);
  assert.ok(Math.abs(w.z - 3) < 0.1, `spin ${w.toArray().map(n => n.toFixed(2))}`);
  hand.position.set(100, 1, 0); hand.updateMatrixWorld(true);
  motion.record(key, hand, dt);
  assert.ok(motion.measure(key, v, w) && v.length() <= HAND_MOTION.maxSpeed + 1e-9, 'a teleport does not fling it');
  motion.record(key, hand, 1.0);
  assert.equal(motion.measure(key, v, w), false, 'after a long pause the history starts again');
});
