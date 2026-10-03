import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { findPodIslands, createPodHalos, clusterPoints, buildGroundLights, applyGroundLights } from '../src/glow-halos.js';

// Build an indexed UV-sphere-ish blob (an octahedron with a duplicated seam vertex, like a glTF
// export that splits vertices at UV seams) centred at (cx, cy, cz).
function blob(cx, cy, cz, r) {
  const v = [
    [r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r],
    [r, 0, 0], // duplicate of vertex 0 (seam)
  ].map(([x, y, z]) => [x + cx, y + cy, z + cz]);
  const faces = [
    [0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 6, 4],
    [0, 5, 2], [2, 5, 1], [1, 5, 3], [3, 5, 6],
  ];
  return { v, faces };
}

function merge(blobs) {
  const positions = [];
  const index = [];
  for (const { v, faces } of blobs) {
    const base = positions.length / 3;
    for (const p of v) positions.push(...p);
    for (const f of faces) index.push(f[0] + base, f[1] + base, f[2] + base);
  }
  return { positions: new Float32Array(positions), index: new Uint32Array(index) };
}

test('each separate pod becomes one island, even with duplicated seam vertices', () => {
  const { positions, index } = merge([blob(0, 0, 0, 1), blob(10, 5, -3, 2), blob(-20, 30, 8, 0.5)]);
  const islands = findPodIslands(positions, index);
  assert.equal(islands.length, 3);
  const sorted = [...islands].sort((a, b) => a.radius - b.radius);
  assert.deepEqual(sorted.map(i => +i.radius.toFixed(3)), [0.5, 1, 2]);
  const big = sorted[2];
  assert.deepEqual(big.center.map(n => +n.toFixed(3)), [10, 5, -3]);
});

test('pods that touch only through coincident vertices stay merged into one island', () => {
  // Two blobs sharing a single point are one connected island; that is acceptable (and rare).
  const a = blob(0, 0, 0, 1);
  const b = blob(2, 0, 0, 1);
  const { positions, index } = merge([a, b]);
  assert.equal(findPodIslands(positions, index).length, 1);
});

test('non-indexed geometry works too', () => {
  const { v, faces } = blob(4, 4, 4, 1);
  const positions = [];
  for (const f of faces) for (const i of f) positions.push(...v[i]);
  const islands = findPodIslands(new Float32Array(positions), null);
  assert.equal(islands.length, 1);
  assert.deepEqual(islands[0].center.map(n => +n.toFixed(3)), [4, 4, 4]);
});

test('createPodHalos places one instance per pod in the root space and toggles with night', () => {
  const { positions, index } = merge([blob(0, 0, 0, 1), blob(10, 0, 0, 1)]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  const pods = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  pods.name = 'Glow_Pods';
  const root = new THREE.Group();
  root.position.set(100, 20, -50);
  root.rotation.y = Math.PI / 2;
  root.add(pods);

  const halos = createPodHalos(root);
  assert.equal(halos.count, 2);
  assert.equal(halos.mesh.parent, root);
  assert.equal(halos.mesh.visible, false, 'hidden by default (daytime)');

  const m = new THREE.Matrix4();
  halos.mesh.getMatrixAt(0, m);
  const centers = [0, 1].map(i => {
    halos.mesh.getMatrixAt(i, m);
    return new THREE.Vector3().setFromMatrixPosition(m);
  });
  centers.sort((a, b) => a.x - b.x);
  assert.ok(centers[0].distanceTo(new THREE.Vector3(0, 0, 0)) < 1e-4);
  assert.ok(centers[1].distanceTo(new THREE.Vector3(10, 0, 0)) < 1e-4);

  halos.setNight(1);
  assert.equal(halos.mesh.visible, true);
  assert.ok(halos.material.uniforms.uIntensity.value > 0);
  halos.setNight(0);
  assert.equal(halos.mesh.visible, false);
});

test('createPodHalos returns null when the model has no pod mesh', () => {
  assert.equal(createPodHalos(new THREE.Group()), null);
});

function around(cx, cy, cz, n, spread = 1) {
  return Array.from({ length: n }, (_, i) => ({
    x: cx + Math.cos(i * 2.4) * spread,
    y: cy + (i % 3) * 0.3,
    z: cz + Math.sin(i * 2.4) * spread,
  }));
}

test('clusterPoints groups well separated pods and is deterministic', () => {
  const pods = [...around(0, 5, 0, 6), ...around(40, 20, 0, 4), ...around(0, 12, -50, 3)];
  const a = clusterPoints(pods, 3);
  const b = clusterPoints(pods, 3);
  assert.deepEqual(a.map(c => c.count).sort((x, y) => x - y), [3, 4, 6]);
  assert.deepEqual(a.map(c => c.center), b.map(c => c.center));
});

test('clusterPoints never returns more clusters than points', () => {
  assert.equal(clusterPoints(around(0, 0, 0, 2), 8).length, 2);
  assert.deepEqual(clusterPoints([], 8), []);
});

test('buildGroundLights gives low pods smaller, brighter pools than high pods', () => {
  const pods = [...around(0, 6, 0, 5), ...around(60, 30, 0, 5)];
  const lights = buildGroundLights(pods, () => 2, { maxLights: 2 });
  assert.equal(lights.length, 2);
  const low = lights.find(l => l.y < 15);
  const high = lights.find(l => l.y >= 15);
  assert.ok(low.radius < high.radius);
  assert.ok(low.strength > high.strength);
  assert.equal(Math.max(...lights.map(l => l.strength)), 1, 'strongest light is normalised to 1');
});

test('applyGroundLights fills uniform slots and zeroes unused ones', () => {
  const uniforms = {
    uPodLights: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
    uPodLightStrength: { value: [9, 9, 9, 9] },
    uPodLightArea: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
  applyGroundLights(uniforms, [
    { x: 10, y: 5, z: 20, radius: 12, strength: 1 },
    { x: 30, y: 8, z: 20, radius: 14, strength: 0.5 },
  ]);
  assert.deepEqual(uniforms.uPodLights.value[0].toArray(), [10, 5, 20, 12]);
  assert.deepEqual(uniforms.uPodLightStrength.value, [1, 0.5, 0, 0]);
  const area = uniforms.uPodLightArea.value;
  assert.equal(area.x, 20);
  assert.equal(area.y, 20);
  assert.ok(area.z >= 10 + 14, 'cull range covers the farthest pool');
  assert.doesNotThrow(() => applyGroundLights({}, []));
});
