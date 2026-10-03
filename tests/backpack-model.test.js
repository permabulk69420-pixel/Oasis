import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The backpack model (tools/backpack/build_backpack.py makes it). These tests read the .glb directly: they check what
// the game relies on (the two named parts, the grip, the size, the budget, the materials), not how it looks.

const MAX_TRIANGLES = 4000;
const MIN_TRIANGLES = 2000;
const MAX_BYTES = 200_000;

function readGlb() {
  const buffer = fs.readFileSync(new URL('../public/models/backpack/backpack.glb', import.meta.url));
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF', 'a binary glTF');
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  return { json, bytes: buffer.length };
}

function partBounds(json, nodeName) {
  const node = json.nodes.find(n => n.name === nodeName);
  assert.ok(node, `the model has a ${nodeName} node`);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  for (const primitive of json.meshes[node.mesh].primitives) {
    assert.equal(primitive.mode ?? 4, 4, 'triangles only');
    const position = json.accessors[primitive.attributes.POSITION];
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], position.min[i]);
      max[i] = Math.max(max[i], position.max[i]);
    }
    triangles += json.accessors[primitive.indices].count / 3;
  }
  return { min, max, triangles };
}

test('the pack is two parts the game finds by name, the body and the carry handle, with nothing else in the scene', () => {
  const { json } = readGlb();
  const names = json.nodes.map(n => n.name).sort();
  assert.deepEqual(names, ['Backpack', 'CarryHandle']);
  assert.deepEqual(json.scenes[0].nodes.length, 2, 'both parts are at the top of the scene, so the game can set a grip on the handle alone');
  for (const node of json.nodes) {
    assert.ok(!node.matrix && !node.rotation && !node.scale && !node.translation, `${node.name} has no transform of its own`);
  }
  assert.ok(!json.skins && !json.animations && !json.cameras, 'a static prop: no skeleton, no animation, no camera');
});

test('it stays inside the Quest triangle and size budget', () => {
  const { json, bytes } = readGlb();
  const total = partBounds(json, 'Backpack').triangles + partBounds(json, 'CarryHandle').triangles;
  assert.ok(total <= MAX_TRIANGLES, `${total} triangles is over ${MAX_TRIANGLES}`);
  assert.ok(total >= MIN_TRIANGLES, `${total} triangles is suspiciously few`);
  assert.ok(bytes <= MAX_BYTES, `${bytes} bytes is over ${MAX_BYTES}`);
});

test('painted with vertex colours, no textures, and two single-sided materials, one of them glowing', () => {
  const { json } = readGlb();
  assert.ok(!json.images && !json.textures, 'no textures');
  assert.deepEqual(json.materials.map(m => m.name).sort(), ['Glow', 'Pack']);
  for (const material of json.materials) {
    assert.ok(!material.doubleSided, `${material.name} is single sided (every part is a closed solid)`);
  }
  const glow = json.materials.find(m => m.name === 'Glow');
  assert.ok(glow.emissiveFactor && Math.max(...glow.emissiveFactor) > 0.5, 'the glow trim is emissive');
  const pack = json.materials.find(m => m.name === 'Pack');
  assert.ok(!pack.emissiveFactor || pack.emissiveFactor.every(v => v === 0), 'the canvas is not emissive');
  for (const mesh of json.meshes) {
    for (const primitive of mesh.primitives) {
      for (const attribute of ['POSITION', 'NORMAL', 'COLOR_0']) {
        assert.ok(attribute in primitive.attributes, `${mesh.name} has ${attribute}`);
      }
    }
  }
});

test('it is a real rucksack: about half a metre tall, standing on its base with the origin at the middle of the bottom', () => {
  const { json } = readGlb();
  const body = partBounds(json, 'Backpack');
  const handle = partBounds(json, 'CarryHandle');
  const width = body.max[0] - body.min[0];
  const height = Math.max(body.max[1], handle.max[1]) - body.min[1];
  const depth = body.max[2] - body.min[2];
  assert.ok(width > 0.40 && width < 0.55, `${width.toFixed(3)} m wide`);
  assert.ok(height > 0.48 && height < 0.62, `${height.toFixed(3)} m tall`);
  assert.ok(depth > 0.30 && depth < 0.42, `${depth.toFixed(3)} m deep`);
  assert.ok(Math.abs(body.min[1]) < 1e-3, 'the bottom of the pack is at y = 0');
  assert.ok(Math.abs(body.min[0] + body.max[0]) < 0.01, 'centred side to side');
  assert.ok(body.min[2] < 0 && body.max[2] > 0, 'the back panel is behind the origin and the bedroll in front of it');
});

test('the carry handle is an arch over the top of the pack that a hand can close round, bar along the x axis', () => {
  const { json } = readGlb();
  const body = partBounds(json, 'Backpack');
  const handle = partBounds(json, 'CarryHandle');
  const span = handle.max[0] - handle.min[0];
  const rise = handle.max[1] - handle.min[1];
  const thick = handle.max[2] - handle.min[2];
  assert.ok(span > 0.13 && span < 0.20, `the arch spans ${span.toFixed(3)} m across the pack (x)`);
  assert.ok(rise > 0.05 && rise < 0.09, `the arch rises ${rise.toFixed(3)} m above the flap`);
  assert.ok(thick > 0.02 && thick < 0.045, `the strap is ${thick.toFixed(3)} m thick front to back`);
  assert.ok(handle.min[1] > body.max[1] - 0.02, 'the handle starts at the flap, not down the front of the pack');
  assert.ok(Math.abs(handle.min[0] + handle.max[0]) < 0.005, 'the handle is centred');
});
