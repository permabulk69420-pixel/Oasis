import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SPEAR_GRIP } from '../src/spear.js';

// The spear model (tools/spear/build_spear.py makes it). These tests read the .glb directly: they check what the game
// relies on (the two named parts, the size, the grip, the budget, the materials), not how it looks.

const MAX_TRIANGLES = 3000;
const MIN_TRIANGLES = 1200;
const MAX_BYTES = 120_000;

function readGlb() {
  const buffer = fs.readFileSync(new URL('../public/models/spear/spear.glb', import.meta.url));
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF', 'a binary glTF');
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  return { json, bytes: buffer.length };
}

// Bounds and triangle count of a named part, or of just the primitives that use one material.
function partBounds(json, nodeName, materialName = null) {
  const node = json.nodes.find(n => n.name === nodeName);
  assert.ok(node, `the model has a ${nodeName} node`);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  for (const primitive of json.meshes[node.mesh].primitives) {
    assert.equal(primitive.mode ?? 4, 4, 'triangles only');
    if (materialName && json.materials[primitive.material].name !== materialName) continue;
    const position = json.accessors[primitive.attributes.POSITION];
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], position.min[i]);
      max[i] = Math.max(max[i], position.max[i]);
    }
    triangles += json.accessors[primitive.indices].count / 3;
  }
  return { min, max, triangles };
}

test('the spear is two parts the game finds by name, the wooden shaft and the head with its lashing and tassel', () => {
  const { json } = readGlb();
  assert.deepEqual(json.nodes.map(n => n.name).sort(), ['Shaft', 'Spear']);
  assert.equal(json.scenes[0].nodes.length, 2, 'both parts are at the top of the scene, so the game can grip the shaft alone');
  for (const node of json.nodes) {
    assert.ok(!node.matrix && !node.rotation && !node.scale && !node.translation, `${node.name} has no transform of its own`);
  }
  assert.ok(!json.skins && !json.animations && !json.cameras, 'a static prop: no skeleton, no animation, no camera');
});

test('it stays inside the Quest triangle and size budget (a hand-sized prop, so one level of detail on purpose)', () => {
  const { json, bytes } = readGlb();
  const total = partBounds(json, 'Shaft').triangles + partBounds(json, 'Spear').triangles;
  assert.ok(total <= MAX_TRIANGLES, `${total} triangles is over ${MAX_TRIANGLES}`);
  assert.ok(total >= MIN_TRIANGLES, `${total} triangles is suspiciously few`);
  assert.ok(bytes <= MAX_BYTES, `${bytes} bytes is over ${MAX_BYTES}`);
});

test('painted with vertex colours, no textures, and two single-sided materials, one of them a small glowing bead', () => {
  const { json } = readGlb();
  assert.ok(!json.images && !json.textures, 'no textures');
  assert.deepEqual(json.materials.map(m => m.name).sort(), ['Glow', 'Spear']);
  for (const material of json.materials) {
    assert.ok(!material.doubleSided, `${material.name} is single sided (every part is a closed solid)`);
  }
  const glow = json.materials.find(m => m.name === 'Glow');
  assert.ok(glow.emissiveFactor && Math.max(...glow.emissiveFactor) > 0.5, 'the bead is emissive');
  const wood = json.materials.find(m => m.name === 'Spear');
  assert.ok(!wood.emissiveFactor || wood.emissiveFactor.every(v => v === 0), 'the wood and stone are not emissive');
  for (const mesh of json.meshes) {
    for (const primitive of mesh.primitives) {
      for (const attribute of ['POSITION', 'NORMAL', 'COLOR_0']) {
        assert.ok(attribute in primitive.attributes, `${mesh.name} has ${attribute}`);
      }
    }
  }
  const bead = partBounds(json, 'Spear', 'Glow');
  assert.ok(bead.triangles > 0 && bead.triangles <= 200, `the glow is one small bead (${bead.triangles} triangles)`);
  for (let i = 0; i < 3; i++) assert.ok(bead.max[i] - bead.min[i] < 0.03, 'the bead is under 3 cm across');
  assert.ok(bead.max[1] < 0.7 && bead.max[1] > 0.45, 'it hangs from the tassel below the lashing, not on the point');
});

test('a real spear: about a metre and a half long, the grip at the origin, stone point at the top', () => {
  const { json } = readGlb();
  const shaft = partBounds(json, 'Shaft');
  const head = partBounds(json, 'Spear');
  const top = Math.max(shaft.max[1], head.max[1]);
  const length = top - shaft.min[1];
  assert.ok(length > 1.4 && length < 1.55, `${length.toFixed(3)} m long`);
  assert.ok(shaft.min[1] > -0.56 && shaft.min[1] < -0.48, `the butt end is ${(-shaft.min[1]).toFixed(3)} m below the origin`);
  assert.ok(head.max[1] > 0.9 && head.max[1] === top, 'the stone point is the highest thing');
  assert.ok(shaft.max[1] > 0.7 && shaft.max[1] < head.max[1], 'the shaft ends inside the lashing, below the tip');
  assert.ok(shaft.min[1] < -0.3 && shaft.max[1] > 0.5, 'the origin is on the shaft');
});

test('the leather grip wrap the hand closes on covers the whole fist, where the game puts the hand', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../tools/spear/build_spear.py', import.meta.url), 'utf8');
  const match = source.match(/^GRIP_LO, GRIP_HI = (-?[0-9.]+), (-?[0-9.]+)/m);
  assert.ok(match, 'wrap range found in the builder');
  const [lo, hi] = [Number(match[1]), Number(match[2])];
  assert.ok(lo < SPEAR_GRIP.point[1] - 0.04 && hi > SPEAR_GRIP.point[1] + 0.04, `the wrap ${lo} to ${hi} covers the whole fist around ${SPEAR_GRIP.point[1]}`);
});

test('the shaft is a pole a hand can close round, and the head and tassel stay close to its line', () => {
  const { json } = readGlb();
  const shaft = partBounds(json, 'Shaft');
  const head = partBounds(json, 'Spear');
  const width = shaft.max[0] - shaft.min[0];
  const depth = shaft.max[2] - shaft.min[2];
  assert.ok(width > 0.03 && width < 0.06, `the shaft is ${width.toFixed(3)} m across`);
  assert.ok(depth > 0.03 && depth < 0.06, `the shaft is ${depth.toFixed(3)} m deep`);
  assert.ok(head.max[0] - head.min[0] < 0.1, 'the point and lashing are under 10 cm wide');
  assert.ok(head.min[1] > 0.3, 'the head and tassel are all in the top third, so nothing hangs where the hand is');
  assert.ok(head.min[2] < -0.04 && head.max[2] < 0.05, 'the tassel hangs on the back (-Z) side, so the point faces the same way as the grip');
});
