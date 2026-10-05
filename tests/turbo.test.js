import test from 'node:test';
import assert from 'node:assert/strict';
import { TURBO, createTurboChord } from '../src/turbo.js';

// feed a sequence of [time ms, left down, right down] and collect what comes out
const run = (steps) => {
  const chord = createTurboChord();
  return steps.map(([t, l, r]) => ({ t, ...chord.apply(l, r, t) }));
};
const toggles = out => out.filter(o => o.toggled).length;
const sprintFrames = out => out.filter(o => o.sprint).length;
const crouchFrames = out => out.filter(o => o.crouch).length;

test('turbo is ten times the usual speed', () => assert.equal(TURBO.multiplier, 10));

test('clicking both sticks together toggles turbo once, and neither stick does its own job', () => {
  const out = run([[0, 0, 0], [16, 1, 0], [50, 1, 1], [100, 1, 1], [150, 1, 1], [200, 0, 1], [250, 0, 0]]);
  assert.equal(toggles(out), 1);
  assert.equal(sprintFrames(out), 0);
  assert.equal(crouchFrames(out), 0);
});

test('a chord with the second click up to the window later still counts', () => {
  const out = run([[0, 0, 0], [10, 1, 0], [120, 1, 1], [200, 1, 1], [260, 0, 0]]);
  assert.equal(toggles(out), 1);
  assert.equal(sprintFrames(out) + crouchFrames(out), 0);
});

test('a quick tap on one stick still works, as a one frame press after the wait', () => {
  const left = run([[0, 0, 0], [10, 1, 0], [60, 1, 0], [90, 0, 0], [110, 0, 0]]);
  assert.equal(toggles(left), 0);
  assert.equal(sprintFrames(left), 1);
  const right = run([[0, 0, 0], [10, 0, 1], [60, 0, 1], [90, 0, 0], [110, 0, 0]]);
  assert.equal(crouchFrames(right), 1);
  assert.equal(toggles(right), 0);
});

test('holding one stick passes through once it is clearly on its own', () => {
  const out = run([[0, 0, 0], [10, 1, 0], [60, 1, 0], [150, 1, 0], [200, 1, 0], [260, 0, 0], [300, 0, 0]]);
  assert.equal(toggles(out), 0);
  assert.deepEqual(out.map(o => o.sprint), [false, false, false, true, true, false, false]);
});

test('two single clicks well apart are two clicks, not a chord', () => {
  const out = run([[0, 0, 0], [10, 1, 0], [60, 0, 0], [200, 0, 0], [400, 0, 1], [450, 0, 0], [600, 0, 0]]);
  assert.equal(toggles(out), 0);
  assert.equal(sprintFrames(out), 1);
  assert.equal(crouchFrames(out), 1);
});

test('after a chord is let go, the next chord toggles again, and an early release of one stick does not leak a click', () => {
  const out = run([[0, 0, 0], [10, 1, 1], [60, 1, 1], [80, 0, 1], [120, 0, 1], [160, 0, 0], [400, 1, 1], [450, 0, 0]]);
  assert.equal(toggles(out), 2);
  assert.equal(sprintFrames(out) + crouchFrames(out), 0);
});
