import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addCrystalAttribute } from '../src/colossus.js';

// The crystal shader's coordinates: each crystal found on its own, 0 at its wide base and 1 at its tip, whichever way it points.
test('addCrystalAttribute runs each crystal from its base to its tip', () => {
  const up = new THREE.ConeGeometry(0.1, 0.5, 6).translate(0, 1, 0);              // tip at y 1.25, base at y 0.75
  const down = new THREE.ConeGeometry(0.1, 0.5, 6).rotateX(Math.PI).translate(2, 0, 0); // tip at y -0.25, base at y 0.25
  const geometry = mergeGeometries([up, down]);
  assert.equal(addCrystalAttribute(geometry), 2);
  const position = geometry.getAttribute('position');
  const crystal = geometry.getAttribute('oasisCrystal');
  const owns = new Set();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), along = crystal.getX(i);
    const expected = x < 1 ? (y - 0.75) / 0.5 : (0.25 - y) / 0.5;
    assert.ok(Math.abs(along - expected) < 1e-3, `vertex ${i}: ${along} not ${expected}`);
    owns.add(crystal.getY(i));
  }
  assert.equal(owns.size, 2); // one number per crystal, different crystals different
  for (const own of owns) assert.ok(own >= 0 && own < 1);
});
