import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PRINTS, printStrength, createStepper, createPrintBook, createFootprints } from '../src/footprints.js';
import { LEG_NAMES, POSE_REST, JOINTS, createStingerPoser, plantedFeet } from '../src/stinger-pose.js';
import { WATER, grassCover, terrainHeight } from '../src/world.js';
import { loadStingerModel } from './helpers/stinger-model.js';

// Walk the stepper along a straight line at a steady speed, a frame at a time, and collect the prints it lays.
function walkLine(stepper, from, to, { speed = 2.6, frame = 0.02, onGround = true } = {}) {
  const prints = [];
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const frames = Math.round(length / (speed * frame));
  for (let i = 0; i <= frames; i++) {
    const t = i / frames;
    const print = stepper.step(from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t, { onGround, speed });
    if (print) prints.push({ ...print });
  }
  return prints;
}

test('a print holds, then the wind fills it in, and it is gone by the end of its life', () => {
  assert.equal(printStrength(0, 100), 1);
  assert.equal(printStrength(100 * PRINTS.hold, 100), 1);
  assert.ok(printStrength(100 * (PRINTS.hold + 0.1), 100) < 1);
  assert.equal(printStrength(100, 100), 0);
  assert.equal(printStrength(1000, 100), 0);
  let last = 1;
  for (let age = 0; age <= 100; age += 2) {
    const s = printStrength(age, 100);
    assert.ok(s <= last + 1e-12, `never comes back at ${age}`);
    assert.ok(s >= 0 && s <= 1);
    last = s;
  }
  assert.ok(Math.abs(printStrength(100 * (PRINTS.hold + (1 - PRINTS.hold) / 2), 100) - 0.5) < 1e-9, 'half way through the fade it is half there');
  assert.equal(printStrength(10, 0), 0, 'no life, no print');
  assert.equal(printStrength(-5, 100), 1, 'a clock that went backwards is a fresh print');
});

test('the creature outlasts a person in the sand, and the numbers are sane', () => {
  assert.ok(PRINTS.life.stinger > PRINTS.life.player);
  assert.ok(PRINTS.hold > 0 && PRINTS.hold < 1);
  assert.ok(PRINTS.fade[0] < PRINTS.fade[1]);
  assert.ok(PRINTS.stride.run > PRINTS.stride.walk);
  assert.ok(PRINTS.lift > 0, 'the decal sits above the sand, not in it');
  // sixteen minutes of walking at one print a stride would not fit, but nobody sees a print older than its life, so the ring must hold a life's worth
  assert.ok(PRINTS.capacity.player >= PRINTS.life.player * 2.6 / PRINTS.stride.walk * 0.9, 'enough slots for a life of walking');
});

test('walking lays a print every stride, the feet alternate, each a little to the side of the way you go', () => {
  const stepper = createStepper();
  const prints = walkLine(stepper, { x: 0, z: 0 }, { x: 0, z: -10 }); // walking towards -z
  const expected = Math.floor(10 / PRINTS.stride.walk);
  assert.ok(Math.abs(prints.length - expected) <= 1, `about ${expected} prints in 10 m, got ${prints.length}`);
  for (let i = 1; i < prints.length; i++) {
    assert.equal(prints[i].side, -prints[i - 1].side, 'left, right, left...');
    const gap = Math.hypot(prints[i].x - prints[i - 1].x, prints[i].z - prints[i - 1].z);
    assert.ok(Math.abs(gap - Math.hypot(PRINTS.stride.walk, 2 * PRINTS.half)) < 0.08, `strides are even (${gap.toFixed(3)} m)`);
  }
  for (const print of prints) {
    assert.ok(Math.abs(Math.abs(print.x) - PRINTS.half) < 1e-6, 'a hand width off the line');
    assert.ok(Math.abs(print.yaw - Math.atan2(0, -1)) < 1e-6, 'pointing the way you walk');
  }
  // which side of the line a foot lands on follows its `side`: both of one side on the same side of the line, the other foot on the opposite one
  const right = prints.filter(p => p.side === 1), left = prints.filter(p => p.side === -1);
  assert.ok(right.every(p => Math.sign(p.x) === Math.sign(right[0].x)));
  assert.ok(left.every(p => Math.sign(p.x) === -Math.sign(right[0].x)), 'the two feet are on opposite sides');
});

test('the stride follows the direction of travel, and running spaces them wider', () => {
  const east = walkLine(createStepper(), { x: 0, z: 0 }, { x: 10, z: 0 });
  assert.ok(east.every(p => Math.abs(p.yaw - Math.PI / 2) < 1e-6), 'east is yaw +90 degrees');
  const diagonal = walkLine(createStepper(), { x: 0, z: 0 }, { x: 7, z: 7 });
  assert.ok(diagonal.every(p => Math.abs(p.yaw - Math.PI / 4) < 1e-6));
  const walking = walkLine(createStepper(), { x: 0, z: 0 }, { x: 20, z: 0 }, { speed: 2.6 });
  const running = walkLine(createStepper(), { x: 0, z: 0 }, { x: 20, z: 0 }, { speed: PRINTS.runSpeed + 0.5 });
  assert.ok(running.length < walking.length, `${running.length} running strides against ${walking.length} walking`);
});

test('nothing is laid in the air, standing still, turning on the spot, or after a jump in position', () => {
  const stepper = createStepper();
  assert.equal(stepper.step(5, 5), null, 'the first frame only learns where you are');
  assert.deepEqual(walkLine(stepper, { x: 5, z: 5 }, { x: 5, z: 15 }, { onGround: false }), [], 'a jump or a fall lays nothing');
  for (let i = 0; i < 200; i++) assert.equal(stepper.step(5, 15), null, 'standing still lays nothing');
  // a small circle: far enough in total, but it goes nowhere, so there is no direction to point the foot
  let laid = 0;
  for (let a = 0; a < Math.PI * 8; a += 0.05) if (stepper.step(5 + 0.15 * Math.cos(a), 15 + 0.15 * Math.sin(a))) laid++;
  assert.equal(laid, 0, 'shuffling in a circle lays nothing');
  // a new session puts you somewhere else: the long step is not a walk
  assert.equal(stepper.step(200, 200), null);
  assert.equal(stepper.step(Number.NaN, 3), null);
  assert.equal(stepper.step(200, Infinity), null);
  const after = walkLine(stepper, { x: 200, z: 200 }, { x: 200, z: 210 });
  assert.ok(after.length >= 10 / PRINTS.stride.walk - 2, 'and walking carries on from there');
  stepper.reset();
  assert.equal(stepper.step(0, 0), null, 'after a reset the first frame is only a position again');
});

test('each kind has its own ring of slots: the creature cannot push your prints out, and the oldest goes first', () => {
  const book = createPrintBook({ player: 4, stinger: 3 });
  assert.equal(book.total, 7);
  const fields = { x: 1, y: 2, z: 3, nx: 0, ny: 1, nz: 0, yaw: 0.5, size: 0.6, side: 1, born: 0 };
  const slots = [];
  for (let i = 0; i < 6; i++) slots.push(book.add('player', { ...fields, x: i, born: i }));
  assert.deepEqual(slots, [0, 1, 2, 3, 0, 1], 'the player ring wraps inside its own four slots');
  assert.equal(book.place[0], 4, 'slot 0 now holds print number 4');
  assert.equal(book.place[3], 4, 'and its birth time');
  const claw = book.add('stinger', { ...fields, x: 99 });
  assert.equal(claw, 4, 'the creature starts after the player slots');
  for (let i = 0; i < 10; i++) book.add('stinger', { ...fields, x: 100 + i });
  for (let slot = 0; slot < 4; slot++) assert.ok(book.place[slot * 4] < 6, `player slot ${slot} untouched by the creature`);
  assert.deepEqual(book.laid, { player: 6, stinger: 11 });
  assert.equal(book.info[4 * 4 + 2], 1, 'the kind is stored for the shader');
  assert.equal(book.info[0 * 4 + 2], 0);
});

test('the creature plants each of its eight feet once per cycle', () => {
  const model = loadStingerModel(0);
  const rig = createStingerPoser(model.group).rig;
  const out = LEG_NAMES.map(() => ({ x: 0, z: 0 }));
  assert.equal(LEG_NAMES.length, 8);
  const TAU = Math.PI * 2;
  let total = 0;
  const seen = new Set();
  for (let phase = 0.01; phase < TAU * 3; phase += 0.02) {
    const count = plantedFeet(rig, phase - 0.02, phase, out);
    total += count;
    for (let i = 0; i < count; i++) seen.add(`${out[i].x.toFixed(3)},${out[i].z.toFixed(3)}`);
  }
  assert.ok(Math.abs(total - 24) <= 1, `eight feet in three cycles is 24 prints (got ${total})`);
  assert.equal(seen.size, 8, 'at eight different spots');
  assert.equal(plantedFeet(rig, 1, 1, out), 0, 'standing still plants nothing');
  assert.equal(plantedFeet(rig, 2, 1, out), 0, 'a phase that went backwards plants nothing');
  assert.equal(plantedFeet(rig, 0, TAU * 3, out), 0, 'a jump of whole cycles is a new walk, not eight prints');
  assert.equal(plantedFeet(null, 0, 1, out), 0);
  let count = plantedFeet(rig, -0.001, TAU, out);
  assert.equal(count, 8, 'one full turn of the cycle plants all eight');
  const small = [{ x: 0, z: 0 }, { x: 0, z: 0 }];
  assert.equal(plantedFeet(rig, -0.001, TAU, small), 2, 'and the list given is never overrun');
});

test('a foot is reported where the posed toe really is when it comes down', () => {
  const model = loadStingerModel(0);
  const poser = createStingerPoser(model.group);
  const rig = poser.rig;
  const TAU = Math.PI * 2;
  const toe = new THREE.Vector3();
  const out = LEG_NAMES.map(() => ({ x: 0, z: 0 }));
  for (const phase of [0.4, 1.9, 3.3, 5.5]) {
    // the foot that lands just after `phase`: find the first phase above it where plantedFeet reports a foot
    let landing = phase;
    let count = 0;
    while (count === 0 && landing < phase + TAU) { landing += 0.005; count = plantedFeet(rig, landing - 0.005, landing, out); }
    assert.equal(count >= 1, true);
    poser.apply({ ...POSE_REST, gait: 1, phase: landing }, 0);
    model.group.updateMatrixWorld(true);
    // the reported foot is the one whose toe is furthest forward relative to its own home
    let best = Infinity;
    for (const leg of LEG_NAMES) {
      poser.bones[leg.toe].getWorldPosition(toe);
      for (let i = 0; i < count; i++) best = Math.min(best, Math.hypot(toe.x - out[i].x, toe.z - out[i].z));
    }
    assert.ok(best < 0.04, `at phase ${landing.toFixed(2)} a toe is within 4 cm of the print (${(best * 100).toFixed(1)} cm)`);
  }
  assert.ok(JOINTS.sweep > 0);
});

// ---------------------------------------------------------------------------------------------------------------- the drawing object
const SAND = { x: 336, z: -302 }; // dune sand near the start: not grass, not water

test('prints are laid on sand, with the ground height and lean, and not on grass or in the pond', () => {
  assert.ok(grassCover(SAND.x, SAND.z) <= PRINTS.grassMax, 'the test spot is sand');
  let grass = null;
  for (let x = WATER.x; x < WATER.x + 120 && !grass; x += 1) if (grassCover(x, WATER.z) > 0.8) grass = { x, z: WATER.z };
  assert.ok(grass, 'found a grassy spot beside the pond');
  const prints = createFootprints({ sun: new THREE.Vector3(0, 1, 0), heightAt: terrainHeight });
  assert.equal(prints.mesh.visible, false, 'nothing to draw until the first print');
  assert.equal(prints.plant(grass.x, grass.z, 0, 1), false, 'no prints on the grass');
  assert.equal(prints.plant(WATER.x, WATER.z, 0, 1), false, 'no prints under the water');
  assert.equal(prints.mesh.visible, false);
  assert.equal(prints.plant(SAND.x, SAND.z, 0.7, 2.5, 1), true);
  assert.equal(prints.mesh.visible, true);
  assert.deepEqual(prints.laid, { player: 0, stinger: 1 });
  const book = prints.book;
  const slot = book.base.stinger * 4;
  assert.ok(Math.abs(book.place[slot] - SAND.x) < 1e-6 && Math.abs(book.place[slot + 2] - SAND.z) < 1e-6);
  assert.ok(Math.abs(book.place[slot + 1] - terrainHeight(SAND.x, SAND.z)) < 1e-6, 'on the ground');
  const nx = book.normal[slot], ny = book.normal[slot + 1], nz = book.normal[slot + 2];
  assert.ok(Math.abs(Math.hypot(nx, ny, nz) - 1) < 1e-5 && ny > 0.5, 'a unit normal pointing up');
  assert.ok(Math.abs(book.info[slot] - PRINTS.size.stinger * 2.5) < 1e-6, 'sized by the creature');
  prints.dispose();
});

test('your own steps become prints, and a new session forgets where you were', () => {
  const prints = createFootprints({ sun: new THREE.Vector3(0, 1, 0), heightAt: terrainHeight });
  let laid = 0;
  for (let t = 0; t <= 9; t += 0.05) if (prints.walk(SAND.x + t, SAND.z, { onGround: true, speed: 2.6 })) laid++;
  assert.ok(laid >= 10, `ten metres of walking leaves a trail (${laid})`);
  assert.equal(prints.laid.player, laid);
  prints.reset();
  assert.equal(prints.walk(SAND.x + 100, SAND.z), false);
  assert.equal(prints.walk(SAND.x + 100.1, SAND.z), false, 'the first frames after a reset only learn the position');
  prints.update(12.5);
  assert.equal(prints.material.uniforms.uTime.value, 12.5, 'the clock the wind fill-in reads');
  prints.update(Number.NaN);
  assert.equal(prints.material.uniforms.uTime.value, 12.5, 'a bad clock is ignored');
  prints.dispose();
});

test('the drawing is one call, laid flat over the ground and multiplied into it', () => {
  const scene = new THREE.Scene();
  const prints = createFootprints({ scene, sun: new THREE.Vector3(0, 1, 0), heightAt: terrainHeight });
  assert.ok(scene.children.includes(prints.mesh), 'added to the scene');
  assert.equal(prints.mesh.geometry.index.count, 6, 'a quad per print');
  assert.equal(prints.book.total, PRINTS.capacity.player + PRINTS.capacity.stinger);
  assert.equal(prints.material.depthWrite, false);
  assert.equal(prints.material.side, THREE.DoubleSide, 'laid flat, the quad faces down: it must draw from both sides');
  assert.equal(prints.material.blendSrc, THREE.DstColorFactor, 'the ground is multiplied, not replaced');
  assert.equal(prints.mesh.frustumCulled, false, 'the vertex shader places the quads');
  prints.dispose();
  assert.ok(!scene.children.includes(prints.mesh), 'and removed again');
  assert.throws(() => createFootprints({}), /sun/i, 'it needs the sun to shade the dents');
});
