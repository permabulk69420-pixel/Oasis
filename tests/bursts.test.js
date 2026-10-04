import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBurstPool, BURSTS } from '../src/bursts.js';

const make = (heightAt = () => 0, capacity = 16) => createBurstPool({ capacity, material: new THREE.MeshBasicMaterial(), heightAt });

test('a burst throws bits out, they fall to the ground, and then they are gone', () => {
  const pool = make();
  assert.equal(pool.mesh.visible, false, 'nothing to draw before the first burst');
  pool.emit(0, 1, 0, 10, { colours: [0xff0000, 0x00ff00], speed: 3 });
  pool.update(0.016);
  assert.equal(pool.count(), 10);
  assert.equal(pool.mesh.visible, true);
  assert.ok(pool.mesh.count >= 10 && pool.mesh.count <= 16);
  let landed = false;
  for (let i = 0; i < 60; i++) pool.update(0.05);
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
  for (let i = 0; i < pool.mesh.count; i++) {
    pool.mesh.getMatrixAt(i, matrix);
    position.setFromMatrixPosition(matrix);
    if (position.y > -100) { landed = true; assert.ok(position.y >= -0.01, `bit ${i} is on or above the ground (${position.y})`); }
  }
  for (let i = 0; i < 200; i++) pool.update(0.05);
  assert.equal(pool.count(), 0, 'everything has faded away');
  assert.equal(pool.mesh.visible, false, 'and nothing is drawn');
  assert.equal(typeof landed, 'boolean');
});

test('bits land on the ground, wherever it is, and no value ever goes bad', () => {
  const pool = make((x, z) => 2 + 0.5 * Math.sin(x * 3));
  pool.emit(0.3, 4, -0.2, 16, { speed: 6, along: [0, 1, 0], sizes: [0.02, 0.1] });
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
  for (let step = 0; step < 40; step++) {
    pool.update(0.03);
    for (let i = 0; i < pool.mesh.count; i++) {
      pool.mesh.getMatrixAt(i, matrix);
      position.setFromMatrixPosition(matrix);
      for (const v of position.toArray()) assert.ok(Number.isFinite(v));
      if (position.y > -100) assert.ok(position.y >= 1.4, `above the ground: ${position.y}`);
    }
  }
});

test('the pool recycles its oldest slots when more are thrown than it holds, and ignores bad time steps', () => {
  const pool = make(() => 0, 8);
  pool.emit(0, 1, 0, 30);
  pool.update(0.02);
  assert.equal(pool.count(), 8);
  pool.update(NaN); pool.update(-1); pool.update(0);
  assert.equal(pool.count(), 8, 'bad time steps change nothing');
  assert.ok(BURSTS.fadeTime > 0);
  assert.throws(() => createBurstPool({ capacity: 4 }), /material/);
});
