import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { createHeightField, SPAWN, WATER, HERO_TREE } from '../src/world.js';
import { layoutFinds } from '../src/desert-finds.js';
import { lineOfSight } from '../src/dune-stinger.js';
import { BONES, toWorld, groundUnder, layoutBones, levelToShow, createGiantBones } from '../src/giant-bones.js';

// The giant bones: where they lie (a pure layout on the real height field), how the three levels of detail are fetched and swapped, and what
// the six model files must hold (tools/giant-bones/build_bones.py makes them). Nothing here says how they look.

const field = createHeightField();
const finds = layoutFinds({ heightAt: field.sample }).nodes;
const sites = layoutBones({ heightAt: field.sample, finds });
const [skull, ribs, lone] = sites;
const away = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const tick = () => new Promise(resolve => setImmediate(resolve));

// ---- layout
test('the layout is the same every time, and it is a skull, a ribcage and a lone ribcage', () => {
  assert.deepEqual(layoutBones({ heightAt: field.sample, finds }), sites);
  assert.deepEqual(sites.map(s => s.id), ['skull0', 'ribs0', 'ribs1']);
  assert.deepEqual(sites.map(s => s.kind), ['skull', 'ribs', 'ribs']);
  for (const site of sites) {
    assert.ok(Number.isFinite(site.x) && Number.isFinite(site.y) && Number.isFinite(site.z) && Number.isFinite(site.yaw), `${site.id} has a place`);
    assert.ok(site.scale >= 1 && site.scale <= 2, `${site.id} scale ${site.scale}`);
    assert.ok(site.radius > 5, `${site.id} radius ${site.radius}`);
  }
  assert.throws(() => layoutBones({}), /heightAt/);
});

test('a flat world and a world with no finds still lay the bones out', () => {
  const flat = layoutBones({ heightAt: () => 5, finds: [] });
  assert.equal(flat.length, 3);
  for (const site of flat) assert.ok(Math.abs(site.pitch) < 1e-9 && Math.abs(site.roll) < 1e-9, 'level ground: nothing tilts');
});

test('the carcass is a walk away, with the open jaws facing the start and the ribs lying behind the skull', () => {
  const C = BONES.carcass;
  const skullDistance = away(skull, SPAWN);
  assert.ok(skullDistance >= C.distance[0] && skullDistance <= C.distance[1], `skull ${skullDistance} m away`);
  assert.ok(away(ribs, SPAWN) >= C.distance[0] && away(ribs, SPAWN) <= C.distance[1] + C.apart * C.scale, `ribs ${away(ribs, SPAWN)} m away`);
  assert.equal(skull.scale, C.scale);
  assert.equal(ribs.scale, C.scale);
  // the skull's snout (+Z in its model) points at the start, give or take the turn
  const toStart = Math.atan2(SPAWN.x - skull.x, SPAWN.z - skull.z);
  const off = Math.abs(Math.atan2(Math.sin(skull.yaw - toStart), Math.cos(skull.yaw - toStart)));
  assert.ok(off <= C.turn + 1e-9, `the skull is turned ${off} rad off the start`);
  // the ribs are further out, a skull-length behind
  assert.ok(away(ribs, SPAWN) > away(skull, SPAWN), 'the ribs are behind the skull');
  assert.ok(Math.abs(away(ribs, skull) - C.apart * C.scale) < 1.5, `the ribs are ${away(ribs, skull)} m from the skull`);
});

test('you can see the ribs from where you start, so there is something to walk towards', () => {
  const eye = field.sample(SPAWN.x, SPAWN.z) + BONES.eye;
  const top = site => field.sample(site.x, site.z) + BONES.height.ribs * site.scale * 0.7;
  assert.ok(lineOfSight(field.sample, SPAWN.x, eye, SPAWN.z, ribs.x, top(ribs), ribs.z), 'the ribs show over the dunes');
});

test('the lone ribcage is far from the carcass, out the other way, and inside the world', () => {
  const L = BONES.lone;
  assert.equal(lone.scale, L.scale);
  assert.ok(away(lone, SPAWN) >= L.distance[0] - 1 && away(lone, SPAWN) <= L.distance[1] + 1, `lone ribs ${away(lone, SPAWN)} m from the start`);
  assert.ok(away(lone, skull) >= L.awayFromCarcass, `lone ribs ${away(lone, skull)} m from the skull`);
  for (const site of sites) assert.ok(Math.abs(site.x) <= BONES.clear.worldLimit && Math.abs(site.z) <= BONES.clear.worldLimit, `${site.id} is inside the world`);
});

test('nothing lies on the pond, the hero tree, the stinger, a find, or on a steep slope', () => {
  const C = BONES.clear;
  for (const site of sites) {
    assert.ok(away(site, WATER) >= C.pond, `${site.id} is ${away(site, WATER)} m from the pond`);
    assert.ok(away(site, HERO_TREE) >= C.hero, `${site.id} is ${away(site, HERO_TREE)} m from the hero tree`);
    assert.ok(away(site, BONES.stingerHome) >= C.stinger, `${site.id} is ${away(site, BONES.stingerHome)} m from the stinger's home`);
    for (const find of finds) assert.ok(away(site, find) >= site.radius + (find.radius ?? 3) + C.finds - 1e-6, `${site.id} is on top of find ${find.id}`);
    const ground = groundUnder(field.sample, site.kind, site.x, site.z, site.yaw, site.scale);
    assert.ok(ground.max - ground.min <= BONES.maxRange * site.scale + 1e-9, `${site.id} stands on ground that varies by ${ground.max - ground.min} m`);
  }
});

test('the bones sit in the sand: the skull follows the ground, the ribs stand upright with their feet buried', () => {
  for (const site of sites) {
    const ground = groundUnder(field.sample, site.kind, site.x, site.z, site.yaw, site.scale);
    assert.ok(site.y <= ground.mean + 1e-9, `${site.id} does not float`);
    assert.ok(site.y >= ground.min - 2.5 * site.scale, `${site.id} is not buried deeper than its own length of rib`);
    if (site.kind === 'ribs') assert.ok(site.pitch === 0 && site.roll === 0, 'ribs stand upright');
    else assert.ok(Math.abs(site.pitch) < 0.5 && Math.abs(site.roll) < 0.5, `skull tilt ${site.pitch}, ${site.roll}`);
  }
});

test('toWorld turns the animal\'s length (+Z) towards (sin yaw, cos yaw) and scales it', () => {
  const site = { x: 10, z: 20, yaw: 0, scale: 2 };
  assert.deepEqual(toWorld(site, 0, 1), { x: 10, z: 22 });
  assert.deepEqual(toWorld(site, 1, 0), { x: 12, z: 20 });
  const turned = toWorld({ ...site, yaw: Math.PI / 2 }, 0, 1);
  assert.ok(Math.abs(turned.x - 12) < 1e-9 && Math.abs(turned.z - 20) < 1e-9, `${turned.x}, ${turned.z}`);
});

test('groundUnder reads the slope along and across a model', () => {
  const g = groundUnder((x, z) => 0.1 * x + 0.05 * z, 'ribs', 100, 100, 0, 1);
  const box = BONES.box.ribs;
  assert.ok(Math.abs(g.mean - (0.1 * 100 + 0.05 * 100)) < 1e-9);
  assert.ok(Math.abs(g.plusX - g.minusX - 0.1 * 2 * box.x) < 1e-9, 'across');
  assert.ok(Math.abs(g.front - g.back - 0.05 * (box.zMax - box.zMin)) < 1e-9, 'along');
  assert.ok(Math.abs(g.max - g.min - (0.1 * 2 * box.x + 0.05 * (box.zMax - box.zMin))) < 1e-9);
});

// ---- which level to show
test('levelToShow takes the wanted level, then the nearest better one, then the nearest worse one', () => {
  assert.equal(levelToShow(0, [true, true, true]), 0);
  assert.equal(levelToShow(0, [false, true, true]), 1, 'close level has not arrived: the middle one');
  assert.equal(levelToShow(0, [false, false, true]), 2);
  assert.equal(levelToShow(1, [true, false, true]), 0, 'a better one is already there: use it');
  assert.equal(levelToShow(2, [false, false, false]), -1, 'nothing yet');
});

// ---- the runtime
function fakeGltf() {
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })));
  return { scene };
}

function manualLoader() {
  const calls = [];
  const load = url => new Promise((resolve, reject) => calls.push({ url, level: Number(/lod(\d)/.exec(url)[1]), kind: /_(skull|ribs)_/.exec(url)[1], resolve: () => resolve(fakeGltf()), reject }));
  return { load, calls };
}

const levelOf = (list, id) => list.find(entry => entry.id === id);

test('only the far level of each model is fetched at the start, and nothing is shown until you are near enough', async () => {
  const { load, calls } = manualLoader();
  const scene = new THREE.Scene();
  createGiantBones({ scene, heightAt: field.sample, sites, load });
  await tick();
  assert.deepEqual(calls.map(c => `${c.kind}${c.level}`).sort(), ['ribs2', 'skull2']);
  assert.equal(scene.children.length, 3, 'one group per site');
  assert.ok(scene.children.every(g => !g.visible), 'hidden until the first update');
});

test('walking up fetches the better levels, the worse level stays on screen until they arrive, and nothing far away is fetched twice', async () => {
  const { load, calls } = manualLoader();
  const scene = new THREE.Scene();
  const bones = createGiantBones({ scene, heightAt: field.sample, sites, load });
  await tick();
  calls.filter(c => c.level === 2).forEach(c => c.resolve());
  await tick();

  bones.update({ x: SPAWN.x, z: SPAWN.z });
  await tick();
  assert.equal(levelOf(bones.list(), 'skull0').shown, 2, 'the far model shows while the middle one is on its way');
  assert.ok(calls.some(c => c.kind === 'skull' && c.level === 1), 'the middle level is requested');
  assert.ok(!calls.some(c => c.level === 0), 'the close level is not fetched from the start');
  calls.filter(c => c.level === 1).forEach(c => c.resolve());
  await tick();
  bones.update({ x: SPAWN.x, z: SPAWN.z });
  assert.equal(levelOf(bones.list(), 'skull0').shown, 1);
  assert.equal(levelOf(bones.list(), 'ribs0').shown, 1);

  // now walk up to the ribs
  bones.update({ x: ribs.x + 30, z: ribs.z });
  await tick();
  assert.ok(calls.some(c => c.kind === 'ribs' && c.level === 0), 'the close ribs are requested when you are near');
  assert.equal(levelOf(bones.list(), 'ribs0').shown, 1, 'the middle level stays until the close one arrives');
  calls.filter(c => c.level === 0).forEach(c => c.resolve());
  await tick();
  bones.update({ x: ribs.x + 30, z: ribs.z });
  assert.equal(levelOf(bones.list(), 'ribs0').shown, 0);
  const requests = calls.map(c => `${c.kind}${c.level}`);
  assert.equal(new Set(requests).size, requests.length, 'each file is requested once, however many frames pass');
});

test('exactly one level of a model is visible, and far away nothing is drawn', async () => {
  const scene = new THREE.Scene();
  const bones = createGiantBones({ scene, heightAt: field.sample, sites, load: async () => fakeGltf() });
  await tick();
  await tick();
  bones.update({ x: ribs.x + 25, z: ribs.z });
  await tick();
  await tick();
  bones.update({ x: ribs.x + 25, z: ribs.z });
  const group = scene.children.find(g => g.name.includes('ribs0'));
  assert.ok(group.visible);
  assert.equal(group.children.filter(root => root.visible).length, 1, 'one level at a time');
  bones.update({ x: SPAWN.x - 5000, z: SPAWN.z - 5000 });
  assert.ok(scene.children.every(g => !g.visible), 'beyond hideBeyond nothing is drawn');
});

test('the groups sit where the layout says, and the models are single sided', async () => {
  const scene = new THREE.Scene();
  const bones = createGiantBones({ scene, heightAt: field.sample, sites, load: async () => fakeGltf() });
  await tick();
  await tick();
  sites.forEach((site, i) => {
    const group = scene.children[i];
    assert.deepEqual([group.position.x, group.position.y, group.position.z], [site.x, site.y, site.z]);
    assert.equal(group.scale.x, site.scale);
    assert.equal(group.rotation.y, site.yaw);
  });
  group: for (const group of scene.children) {
    for (const root of group.children) {
      root.traverse(object => { if (object.isMesh) assert.equal(object.material.side, THREE.FrontSide); });
      continue group;
    }
  }
  assert.equal(bones.sites, sites);
});

test('a level that fails to load says so once and the game carries on with the others', async () => {
  const errors = [];
  const { load, calls } = manualLoader();
  const bones = createGiantBones({ scene: new THREE.Scene(), heightAt: field.sample, sites, load, onError: message => errors.push(message) });
  await tick();
  calls.filter(c => c.kind === 'skull').forEach(c => c.reject(new Error('404')));
  calls.filter(c => c.kind === 'ribs').forEach(c => c.resolve());
  await tick();
  bones.update({ x: ribs.x + 60, z: ribs.z });
  bones.update({ x: ribs.x + 60, z: ribs.z });
  await tick();
  assert.equal(errors.length, 1);
  assert.match(errors[0], /skull/);
  assert.equal(levelOf(bones.list(), 'ribs0').shown, 2, 'the ribs are still there');
  assert.equal(levelOf(bones.list(), 'skull0').shown, -1, 'the skull is simply missing');
});

test('update with no position and no camera does nothing, and dispose takes the groups out of the scene', () => {
  const scene = new THREE.Scene();
  const bones = createGiantBones({ scene, heightAt: field.sample, sites, load: async () => fakeGltf() });
  assert.doesNotThrow(() => bones.update());
  assert.equal(scene.children.length, 3);
  bones.dispose();
  assert.equal(scene.children.length, 0);
});

// ---- the model files
const MODELS = {
  ribs: { node: 'GiantRibs', triangles: [24000, 6500, 2600], bytes: [700_000, 220_000, 120_000], top: BONES.height.ribs },
  skull: { node: 'GiantSkull', triangles: [18000, 5000, 1700], bytes: [500_000, 170_000, 70_000], top: BONES.height.skull },
};

function readGlb(kind, level) {
  const buffer = fs.readFileSync(new URL(`../public/models/bones/giant_${kind}_lod${level}.glb`, import.meta.url));
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF', 'a binary glTF');
  const jsonLength = buffer.readUInt32LE(12);
  return { json: JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8')), bytes: buffer.length };
}

function summary(json) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  for (const mesh of json.meshes) {
    for (const primitive of mesh.primitives) {
      assert.equal(primitive.mode ?? 4, 4, 'triangles only');
      const position = json.accessors[primitive.attributes.POSITION];
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], position.min[i]); max[i] = Math.max(max[i], position.max[i]); }
      triangles += json.accessors[primitive.indices].count / 3;
    }
  }
  return { min, max, triangles };
}

for (const kind of BONES.kinds) {
  test(`the ${kind} comes in three levels, each inside its triangle and download budget, each smaller than the last`, () => {
    const spec = MODELS[kind];
    const counts = [];
    for (let level = 0; level < 3; level++) {
      const { json, bytes } = readGlb(kind, level);
      const { triangles } = summary(json);
      assert.ok(triangles <= spec.triangles[level], `${kind} level ${level}: ${triangles} triangles is over ${spec.triangles[level]}`);
      assert.ok(bytes <= spec.bytes[level], `${kind} level ${level}: ${bytes} bytes is over ${spec.bytes[level]}`);
      counts.push(triangles);
    }
    assert.ok(counts[0] > counts[1] * 2 && counts[1] > counts[2] * 1.5, `levels thin out: ${counts.join(', ')}`);
    assert.ok(counts[0] >= 10000, 'the close level is a real model, not a placeholder');
  });

  test(`the ${kind} is one object with one single-sided vertex-coloured material and no textures, sized the way the layout assumes`, () => {
    const spec = MODELS[kind];
    for (let level = 0; level < 3; level++) {
      const { json } = readGlb(kind, level);
      assert.deepEqual(json.nodes.map(n => n.name), [spec.node], `${kind} level ${level}`);
      assert.ok(!json.skins && !json.animations && !json.images && !json.textures, 'a static, untextured prop');
      assert.deepEqual(json.materials.map(m => m.name), ['Bone']);
      assert.ok(!json.materials[0].doubleSided, 'single sided: every part is a closed solid');
      assert.ok(!json.materials[0].emissiveFactor || json.materials[0].emissiveFactor.every(v => v === 0), 'bone does not glow');
      for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
        for (const attribute of ['POSITION', 'NORMAL', 'COLOR_0']) assert.ok(primitive.attributes[attribute] !== undefined, `${kind} level ${level} has ${attribute}`);
      }
      const { min, max } = summary(json);
      assert.ok(max[1] <= spec.top, `${kind} level ${level} is ${max[1]} m tall, the layout allows for ${spec.top}`);
      assert.ok(max[1] >= spec.top - 1.5, `${kind} level ${level} is ${max[1]} m tall, much less than the ${spec.top} the layout assumes`);
      assert.ok(min[1] >= -3.2 && min[1] <= 0, `${kind} level ${level} bottom ${min[1]}: buried below the sand, but not far`);
    }
  });
}

test('the levels of a model match in size, so swapping them does not make it jump', () => {
  for (const kind of BONES.kinds) {
    const [a, b, c] = [0, 1, 2].map(level => summary(readGlb(kind, level).json));
    for (const other of [b, c]) {
      for (let i = 0; i < 3; i++) {
        assert.ok(Math.abs(other.min[i] - a.min[i]) < 0.6 && Math.abs(other.max[i] - a.max[i]) < 0.6, `${kind}: axis ${i} differs by more than half a metre`);
      }
    }
  }
});

test('every file the game asks for exists', () => {
  for (const kind of BONES.kinds) {
    for (let level = 0; level < 3; level++) {
      const file = BONES.file(kind, level).replace(/^\/?/, '');
      assert.ok(fs.existsSync(new URL(`../public/${file.replace(/^.*?models\//, 'models/')}`, import.meta.url)), `${file} exists`);
    }
  }
});
