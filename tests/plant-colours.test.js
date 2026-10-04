import test from 'node:test';
import assert from 'node:assert/strict';
import { VERTEX_TINT, MATERIAL_BOOST, normaliseVertexColours } from '../src/plant-colours.js';

test('vertex colours keep their variation but each channel averages about 1', () => {
  const dark = new Float32Array([0.05, 0.10, 0.02, 0.15, 0.20, 0.06, 0.10, 0.15, 0.04]);
  const out = normaliseVertexColours(dark, 3);
  for (let c = 0; c < 3; c++) {
    const mean = (out[c] + out[3 + c] + out[6 + c]) / 3;
    assert.ok(Math.abs(mean - 1) < 0.05, `channel ${c} mean ${mean}`);
  }
  assert.ok(out[3] > out[0], 'the brighter vertex stays brighter');
});

test('no vertex gets brighter than the limit, and a flat colour becomes plain 1', () => {
  const spiky = new Float32Array([0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 1, 1, 1]);
  assert.ok(Math.max(...normaliseVertexColours(spiky, 3)) <= VERTEX_TINT.max + 1e-6);
  assert.deepEqual([...normaliseVertexColours(new Float32Array([0.2, 0.1, 0.05, 0.2, 0.1, 0.05]), 3)].map(v => +v.toFixed(3)), [1, 1, 1, 1, 1, 1]);
});

test('alpha is left alone and a black channel does not divide by zero', () => {
  const out = normaliseVertexColours(new Float32Array([0, 0.2, 0.2, 0.5, 0, 0.4, 0.4, 1]), 4);
  assert.equal(out[3], 0.5);
  assert.equal(out[7], 1);
  assert.ok(out.every(Number.isFinite));
});

test('both plant materials are lifted', () => {
  assert.deepEqual(Object.keys(MATERIAL_BOOST).sort(), ['Green to rust leaf tissue', 'Mature olive stems']);
});
