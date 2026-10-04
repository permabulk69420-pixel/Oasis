import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SWAY } from '../src/wind.js';

// The blue palm's three models (tools/alien-tree/build_alien_tree.py makes them). These tests read the .glb files directly:
// they check what the game relies on (the material names the wind sways by, the size the sway profile and the axe's chop zone
// were cut for, the triangle budgets, the levels lining up), not how the tree looks.

const DIR = new URL('../public/models/vegetation/alien-tree/', import.meta.url);
const BARK = 'Banded teal bark';
const LEAF = 'Waxy blue leaf tissue';
const BUDGET = [[3500, 6000], [1000, 2000], [250, 700]]; // [at least, at most] triangles for each level
const OLD_TOP_LEVEL_TRIANGLES = 40_078;
const TRUNK_CHOP_TOP = 1.9; // src/axe.js TREE_CHOP_TOP

function readGlb(level) {
  const buffer = fs.readFileSync(new URL(`alien_tree_lod${level}.glb`, DIR));
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF', 'a binary glTF');
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  const binStart = 20 + jsonLength + 8; // past the JSON chunk and the header of the BIN chunk
  return { json, bin: buffer.subarray(binStart), bytes: buffer.length };
}

// The positions of one primitive, as [x, y, z] triples.
function positions({ json, bin }, primitive) {
  const accessor = json.accessors[primitive.attributes.POSITION];
  assert.equal(accessor.componentType, 5126, 'float positions');
  const view = json.bufferViews[accessor.bufferView];
  const stride = view.byteStride || 12;
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const out = [];
  for (let i = 0; i < accessor.count; i++) {
    const at = start + i * stride;
    out.push([bin.readFloatLE(at), bin.readFloatLE(at + 4), bin.readFloatLE(at + 8)]);
  }
  return out;
}

function primitiveFor(glb, materialName) {
  const primitives = glb.json.meshes[0].primitives.filter(p => glb.json.materials[p.material].name === materialName);
  assert.equal(primitives.length, 1, `one primitive uses ${materialName}`);
  return primitives[0];
}

function triangles(glb) {
  let total = 0;
  for (const primitive of glb.json.meshes[0].primitives) {
    assert.equal(primitive.mode ?? 4, 4, 'triangles only');
    total += glb.json.accessors[primitive.indices].count / 3;
  }
  return total;
}

const levels = [0, 1, 2].map(readGlb);

test('every level is one object, AlienTree, with the bark and the leaf material the wind picks its sway by', () => {
  levels.forEach(({ json }, level) => {
    assert.deepEqual(json.nodes.map(n => n.name), ['AlienTree'], `LOD${level}: one node`);
    const node = json.nodes[0];
    assert.ok(!node.matrix && !node.rotation && !node.scale && !node.translation, 'no transform of its own');
    assert.deepEqual(json.materials.map(m => m.name).sort(), [BARK, LEAF].sort(), `LOD${level}: materials`);
    assert.ok(!json.skins && !json.animations && !json.cameras, 'static: no skeleton, animation or camera');
    assert.ok(!json.images && !json.textures, 'painted with vertex colours, no textures');
    for (const primitive of json.meshes[0].primitives) {
      for (const attribute of ['POSITION', 'NORMAL', 'COLOR_0']) assert.ok(attribute in primitive.attributes, `${attribute}`);
    }
  });
});

test('the bark is single sided (closed solids), the leaves double sided (thin sheets)', () => {
  levels.forEach(({ json }, level) => {
    const bark = json.materials.find(m => m.name === BARK);
    const leaf = json.materials.find(m => m.name === LEAF);
    assert.ok(!bark.doubleSided, `LOD${level}: bark single sided`);
    assert.equal(leaf.doubleSided, true, `LOD${level}: leaves double sided`);
    // A flat floor of light of their own keeps the shaded side teal rather than black; it must stay small so it is nothing at
    // night, when the exposure is tiny but nothing else is lit.
    for (const material of [bark, leaf]) {
      const emissive = material.emissiveFactor || [0, 0, 0];
      assert.ok(Math.max(...emissive) > 0 && Math.max(...emissive) <= 0.1, `${material.name} emissive ${emissive}`);
    }
  });
});

test('three levels that shrink and stay inside their budgets, a long way under the first blue trees', () => {
  const counts = levels.map(triangles);
  counts.forEach((count, level) => {
    const [least, most] = BUDGET[level];
    assert.ok(count >= least && count <= most, `LOD${level}: ${count} triangles, expected ${least} to ${most}`);
  });
  assert.ok(counts[0] > counts[1] && counts[1] > counts[2], `the levels shrink: ${counts}`);
  assert.ok(counts[0] * 6 < OLD_TOP_LEVEL_TRIANGLES, 'the nearest level is under a sixth of the first blue tree');
  assert.ok(levels[0].bytes < 400_000, `the nearest level is ${levels[0].bytes} bytes`);
});

test('every level is the same tree: the same height, reach and crown, so nothing jumps when one takes over', () => {
  const bounds = levels.map(glb => {
    const all = glb.json.meshes[0].primitives.flatMap(p => positions(glb, p));
    const top = Math.max(...all.map(p => p[1]));
    const bottom = Math.min(...all.map(p => p[1]));
    const reach = Math.max(...all.map(p => Math.hypot(p[0], p[2])));
    return { top, bottom, reach };
  });
  for (const { top, bottom, reach } of bounds) {
    assert.ok(top > 4.3 && top < 4.7, `${top.toFixed(2)} m tall`);
    assert.ok(bottom < 0 && bottom > -0.2, `the foot sinks ${(-bottom).toFixed(2)} m`);
    assert.ok(reach > 1.9 && reach < 2.6, `the crown reaches ${reach.toFixed(2)} m out`);
  }
  for (const key of ['top', 'bottom', 'reach']) {
    const values = bounds.map(b => b[key]);
    assert.ok(Math.max(...values) - Math.min(...values) < 0.25, `${key} agrees across the levels: ${values.map(v => v.toFixed(2))}`);
  }
});

test('the wind sway profile is cut for a tree this tall (it bends all the way at its top)', () => {
  const top = Math.max(...positions(levels[0], primitiveFor(levels[0], LEAF)).map(p => p[1]));
  assert.ok(Math.abs(SWAY.foliage.top - top) < 0.4, `foliage sway top ${SWAY.foliage.top} against a ${top.toFixed(2)} m tree`);
  assert.equal(SWAY.trunk.top, SWAY.foliage.top, 'the trunk and the crown bend together');
});

test('the trunk stands straight on the origin up to the axe chop height, thick enough to hit', () => {
  levels.forEach((glb, level) => {
    // The trunk is a stack of rings of vertices. Take each ring from just above the roots to just over the chop height and check
    // that its centre is on the origin (the axe's zone is a cylinder there) and that it is about as thick as the zone assumes.
    const rings = new Map();
    for (const p of positions(glb, primitiveFor(glb, BARK))) {
      if (Math.hypot(p[0], p[2]) > 0.3 || p[1] < 0.9 || p[1] > TRUNK_CHOP_TOP + 0.15) continue;
      const key = p[1].toFixed(3);
      rings.set(key, [...(rings.get(key) || []), p]);
    }
    const complete = [...rings.entries()].filter(([, ring]) => ring.length >= 4);
    assert.ok(complete.length >= 2, `LOD${level}: rings of trunk vertices in the chop zone (${complete.length})`);
    for (const [y, ring] of complete) {
      const cx = ring.reduce((sum, p) => sum + p[0], 0) / ring.length;
      const cz = ring.reduce((sum, p) => sum + p[2], 0) / ring.length;
      assert.ok(Math.hypot(cx, cz) < 0.02, `LOD${level}: the trunk is ${Math.hypot(cx, cz).toFixed(3)} m off the origin at ${y} m`);
      const radius = Math.max(...ring.map(p => Math.hypot(p[0] - cx, p[2] - cz)));
      assert.ok(radius > 0.08 && radius < 0.16, `LOD${level}: trunk radius ${radius.toFixed(3)} m at ${y} m (the chop zone assumes about 0.12)`);
    }
  });
});

const CROWN_CENTRE = [0.364, -0.138]; // trunk_center(CROWN_Y) in build_alien_tree.py

test('the fronds stay out of the way of someone walking under the tree', () => {
  levels.forEach((glb, level) => {
    // The trunk leans toward the top, so "beside the trunk" is measured from the crown (where the veils hang), not from the base.
    const leaves = positions(glb, primitiveFor(glb, LEAF)).filter(p => Math.hypot(p[0] - CROWN_CENTRE[0], p[2] - CROWN_CENTRE[1]) > 0.45);
    const lowest = Math.min(...leaves.map(p => p[1]));
    assert.ok(lowest > 2.4, `LOD${level}: a frond hangs down to ${lowest.toFixed(2)} m`);
  });
});
