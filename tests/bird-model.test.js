import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BIRD_BONES } from '../src/bird-pose.js';

// The alien bird's three models (tools/bird/build_bird.py makes them). These tests read the .glb files directly:
// they check what the game relies on (the skeleton, the triangle budget, the materials), not how it looks.

const LEVELS = [
  { name: 'lod0', maxTriangles: 2400, minTriangles: 1500, maxBytes: 100_000 },
  { name: 'lod1', maxTriangles: 1000, minTriangles: 500, maxBytes: 50_000 },
  { name: 'lod2', maxTriangles: 350, minTriangles: 150, maxBytes: 25_000 },
];

function readGlb(name) {
  const buffer = fs.readFileSync(new URL(`../public/models/creatures/alien_bird_${name}.glb`, import.meta.url));
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF', `${name} is a binary glTF`);
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  return { json, bytes: buffer.length };
}

function triangles(json) {
  let total = 0;
  for (const mesh of json.meshes) {
    for (const primitive of mesh.primitives) {
      assert.equal(primitive.mode ?? 4, 4, 'triangles only');
      total += json.accessors[primitive.indices].count / 3;
    }
  }
  return total;
}

test('every level of detail is under its triangle and size budget, and each is lighter than the one before', () => {
  let previous = Infinity;
  for (const level of LEVELS) {
    const { json, bytes } = readGlb(level.name);
    const count = triangles(json);
    assert.ok(count <= level.maxTriangles, `${level.name}: ${count} triangles is over ${level.maxTriangles}`);
    assert.ok(count >= level.minTriangles, `${level.name}: ${count} triangles is suspiciously few`);
    assert.ok(count < previous, `${level.name} must be lighter than the level before`);
    assert.ok(bytes <= level.maxBytes, `${level.name}: ${bytes} bytes is over ${level.maxBytes}`);
    previous = count;
  }
});

test('all three levels share one skeleton, the one the pose code drives', () => {
  for (const level of LEVELS) {
    const { json } = readGlb(level.name);
    assert.equal(json.skins.length, 1, `${level.name} has one skin`);
    const names = json.skins[0].joints.map(index => json.nodes[index].name);
    assert.deepEqual([...names].sort(), [...BIRD_BONES].sort(), `${level.name} bones match BIRD_BONES`);
  }
});

test('bones are plain translations, so a bone rotation is a rotation of the standing bird about its own axes', () => {
  for (const level of LEVELS) {
    const { json } = readGlb(level.name);
    for (const index of json.skins[0].joints) {
      const node = json.nodes[index];
      assert.ok(!node.matrix, `${node.name} has no matrix`);
      assert.ok(!node.scale || node.scale.every(v => Math.abs(v - 1) < 1e-6), `${node.name} has no scale`);
      const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
      assert.ok(Math.abs(x) + Math.abs(y) + Math.abs(z) < 1e-5 && Math.abs(w - 1) < 1e-5, `${node.name} has no rest rotation`);
    }
  }
});

test('the bird is skinned, at most four bones to a vertex, with no animations baked in', () => {
  for (const level of LEVELS) {
    const { json } = readGlb(level.name);
    assert.ok(!json.animations || json.animations.length === 0, `${level.name} has no baked animations`);
    for (const mesh of json.meshes) {
      for (const primitive of mesh.primitives) {
        assert.ok('JOINTS_0' in primitive.attributes && 'WEIGHTS_0' in primitive.attributes, 'skinned');
        assert.ok(!('JOINTS_1' in primitive.attributes), 'four bones or fewer');
        assert.ok('POSITION' in primitive.attributes && 'NORMAL' in primitive.attributes);
        assert.ok('COLOR_0' in primitive.attributes, 'painted with vertex colours, no textures');
      }
    }
    assert.ok(!json.textures && !json.images, `${level.name} has no textures`);
  }
});

test('few draw calls, opaque and single sided', () => {
  for (const level of LEVELS) {
    const { json } = readGlb(level.name);
    const primitives = json.meshes.reduce((sum, mesh) => sum + mesh.primitives.length, 0);
    assert.ok(primitives <= 2, `${level.name}: ${primitives} primitives (the bird and its glow)`);
    for (const material of json.materials) {
      assert.ok(!material.doubleSided, `${material.name} is single sided`);
      assert.ok(!material.alphaMode || material.alphaMode === 'OPAQUE', `${material.name} is opaque`);
    }
  }
});

test('the standing bird is about a metre tall with a tail behind it, wings spread in the bind pose', () => {
  const { json } = readGlb('lod0');
  const primitive = json.meshes[0].primitives[0];
  const position = json.accessors[primitive.attributes.POSITION];
  const [minX, minY, minZ] = position.min;
  const [maxX, maxY, maxZ] = position.max;
  assert.ok(minY > -0.4 && minY < -0.3, `feet at ${minY}`);
  assert.ok(maxY > 0.35 && maxY < 0.75, `crest at ${maxY}`);
  assert.ok(maxX - minX > 1.1 && maxX - minX < 1.9, `wing span ${maxX - minX}`);
  assert.ok(minZ < -0.6 && maxZ > 0.2, `tail to ${minZ}, beak to ${maxZ}`);
});
