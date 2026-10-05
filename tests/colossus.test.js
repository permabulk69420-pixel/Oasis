import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { loadColossusSkeleton } from './helpers/colossus-model.js';
import { createColossus, COLOSSUS, mergeSkinnedByMaterial, patchColossusShader } from '../src/colossus.js';

function seeded(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A stand-in for a loaded level: the real skeleton, with a few tiny skinned triangles on it wearing the materials the real file has
function makeLevel() {
  const { rig, bones } = loadColossusSkeleton();
  const list = Object.values(bones);
  const skeleton = new THREE.Skeleton(list);
  const materials = {
    hide: Object.assign(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.033, 0.056, 0.068) }), { name: 'Colossus hide' }),
    plate: Object.assign(new THREE.MeshStandardMaterial({ color: new THREE.Color(0.62, 0.55, 0.39) }), { name: 'Colossus plate' }),
    glow: Object.assign(new THREE.MeshStandardMaterial({ emissive: new THREE.Color(0.0185, 0.63, 1) }), { name: 'Colossus glow' }),
    crystal: Object.assign(new THREE.MeshPhysicalMaterial({ emissive: new THREE.Color(0.0185, 0.63, 1), vertexColors: true }), { name: 'Colossus crystal' }),
  };
  const triangle = (dx) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([dx, 0, 0, dx + 1, 0, 0, dx, 1, 0], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
    return g;
  };
  const meshes = [];
  for (const [i, name] of [[0, 'hide'], [1, 'hide'], [2, 'hide'], [3, 'plate'], [4, 'plate'], [5, 'glow'], [6, 'crystal']]) {
    const mesh = new THREE.SkinnedMesh(triangle(i * 2), materials[name]);
    mesh.name = `${name} ${i}`;
    rig.add(mesh);
    mesh.bind(skeleton);
    meshes.push(mesh);
  }
  const scene = new THREE.Group();
  scene.add(rig);
  return { scene, meshes, materials };
}

function setup({ rng = seeded(3) } = {}) {
  const scene = new THREE.Scene();
  const requested = [];
  const stomps = [], trickles = [], prints = [], steps = [];
  let puffTime = 0;
  const colossus = createColossus({
    scene,
    field: { sample: () => 0 },
    sun: { value: new THREE.Vector3(0.6, 0.15, 0.4).normalize() },
    getExposure: () => 0.62,
    rng,
    load: async url => { requested.push(url); return makeLevel(); },
    puffs: { stomp: (x, z, o) => stomps.push({ x, z, ...o }), trickle: (x, z, o) => trickles.push({ x, z, ...o }), update: dt => { puffTime += dt; } },
    prints: { plantColossus: (x, z, yaw, side) => prints.push({ x, z, yaw, side }) },
    onFootfall: step => steps.push(step),
    onError: message => { throw new Error(message); },
  });
  return { scene, colossus, requested, stomps, trickles, prints, steps, get puffTime() { return puffTime; } };
}

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

test('the far level is fetched at once; the nearer ones only as you come within reach of it', async () => {
  const t = setup();
  await settle();
  assert.deepEqual(t.requested, [COLOSSUS.files[2]], 'only the 1.6 MB far level at the start');
  assert.ok(t.colossus.ready);
  // 1.5 km away: it is drawn from the far level, and the middle one is not asked for yet
  t.colossus.state.x = 0; t.colossus.state.z = 0;
  t.colossus.update(1 / 30, { x: 1500, z: 0 });
  await settle();
  assert.equal(t.colossus.list()[0].shown, 2);
  assert.deepEqual(t.requested, [COLOSSUS.files[2]]);
  // within 800 m the middle level starts to come, within 260 m the 42 MB close one
  t.colossus.update(1 / 30, { x: 700, z: 0 });
  await settle();
  assert.deepEqual(t.requested, [COLOSSUS.files[2], COLOSSUS.files[1]]);
  t.colossus.update(1 / 30, { x: 200, z: 0 });
  await settle();
  assert.deepEqual(t.requested, [COLOSSUS.files[2], COLOSSUS.files[1], COLOSSUS.files[0]]);
  t.colossus.update(1 / 30, { x: 200, z: 0 });
  assert.equal(t.colossus.list()[0].shown, 1, '160 m from its nearest part: the middle level');
  t.colossus.update(1 / 30, { x: 60, z: 0 });
  assert.equal(t.colossus.list()[0].shown, 0, 'at its feet: the close level');
});

test('it is in the scene only while you are within sight of it, and still goes about its business out of sight', async () => {
  const t = setup();
  await settle();
  const holder = () => t.scene.getObjectByName('Colossus 01');
  const start = { x: t.colossus.state.x, z: t.colossus.state.z };
  t.colossus.update(1 / 30, { x: start.x + 4000, z: start.z });
  assert.equal(holder(), undefined, 'past 2.8 km nothing is drawn');
  t.colossus.brain.walk();
  for (let i = 0; i < 30 * 120; i++) t.colossus.update(1 / 30, { x: start.x + 4000, z: start.z });
  assert.ok(Math.hypot(t.colossus.state.x - start.x, t.colossus.state.z - start.z) > 20, 'it walked on while nobody saw');
  t.colossus.update(1 / 30, { x: t.colossus.state.x + 400, z: t.colossus.state.z });
  assert.ok(holder(), 'back in range it is drawn again');
  assert.equal(t.scene.children.filter(o => o.name.startsWith('Colossus foot shadow')).length, 4, 'with its four foot shadows');
});

test('walking, every footfall raises dust and a print where the foot comes down, and the headset is told how hard', async () => {
  const t = setup();
  await settle();
  const near = { x: t.colossus.state.x + 120, z: t.colossus.state.z };
  t.colossus.brain.walk();
  for (let i = 0; i < 30 * 200; i++) t.colossus.update(1 / 30, near);
  assert.ok(t.stomps.length >= 20, `${t.stomps.length} footfalls in 200 s`);
  assert.equal(t.stomps.length, t.prints.length);
  assert.equal(t.stomps.length, t.steps.length);
  assert.ok(t.trickles.length >= 15, 'sand runs off a foot as it lifts');
  for (const stomp of t.stomps) assert.ok(stomp.size === COLOSSUS.fx.stomp && stomp.strength >= 0.4 && stomp.strength <= 1);
  for (const print of t.prints) assert.ok(print.side === 1 || print.side === -1);
  const sides = new Set(t.prints.map(p => p.side));
  assert.equal(sides.size, 2, 'left and right feet both');
  for (const step of t.steps) assert.ok(Number.isFinite(step.x + step.y + step.z + step.power) && step.distance > 0);
  assert.equal(t.colossus.list()[0].loaded[2], true);
});

test('dust only within 900 m and prints within 1500 m, but the headset is told of every footfall it can see', async () => {
  const run = async metres => {
    const t = setup();
    await settle();
    t.colossus.brain.walk();
    const head = { x: t.colossus.state.x + metres, z: t.colossus.state.z };
    for (let i = 0; i < 30 * 100; i++) t.colossus.update(1 / 30, head);
    return t;
  };
  const far = await run(1650);
  assert.equal(far.stomps.length, 0, 'past 900 m no dust');
  assert.equal(far.prints.length, 0, 'past 1.5 km no prints');
  assert.ok(far.steps.length > 5, 'but the footfalls are still reported');
  const middle = await run(1250);
  assert.equal(middle.stomps.length, 0, 'no dust at 1.25 km');
  assert.ok(middle.prints.length > 5, 'prints still show at 1.25 km: a 15 m foot is visible from there');
  const close = await run(300);
  assert.ok(close.stomps.length > 5 && close.prints.length === close.stomps.length);
});

test('merging by material: one mesh a material on the same skeleton, nothing lost, and the lone ones left alone', () => {
  const { scene, meshes } = makeLevel();
  const triangles = meshes.reduce((sum, m) => sum + m.geometry.attributes.position.count, 0);
  const skeleton = meshes[0].skeleton;
  const merged = mergeSkinnedByMaterial(scene);
  assert.equal(merged, 3, 'three hide meshes become one (2 merged away) and two plate meshes become one (1 more)');
  const after = [];
  scene.traverse(o => { if (o.isSkinnedMesh) after.push(o); });
  assert.equal(after.length, 4);
  assert.equal(after.reduce((sum, m) => sum + m.geometry.attributes.position.count, 0), triangles);
  for (const mesh of after) assert.equal(mesh.skeleton, skeleton, 'still one skeleton');
  assert.equal(new Set(after.map(m => m.material)).size, 4, 'one mesh per material');
  assert.equal(mergeSkinnedByMaterial(scene), 0, 'nothing left to merge');
});

test('the shader patch adds haze, sky light and the glow lift once, in the right places, and hue for the crystals', () => {
  const uniforms = {
    haze: { value: new THREE.Vector3() }, rates: { value: new THREE.Vector3() }, skyFill: { value: new THREE.Vector3() },
    groundFill: { value: new THREE.Vector3() }, sheen: { value: new THREE.Vector3() }, glowFar: { value: new THREE.Vector3() },
  };
  const source = '#include <common>\nvoid main() {\n vec3 totalEmissiveRadiance = emissive;\n#include <emissivemap_fragment>\n vec3 outgoingLight = vec3(0.0);\n#include <opaque_fragment>\n#include <tonemapping_fragment>\n}';
  const plain = { uniforms: {}, fragmentShader: source };
  assert.equal(patchColossusShader(plain, uniforms), true);
  assert.ok(plain.fragmentShader.includes('uHazeRates') && plain.fragmentShader.includes('uSkyFill') && plain.fragmentShader.includes('uSheen'));
  assert.ok(plain.fragmentShader.indexOf('uSkyFill, skyUp') < plain.fragmentShader.indexOf('#include <opaque_fragment>'), 'sky light goes into the light before it is written out');
  assert.ok(plain.fragmentShader.indexOf('mix(gl_FragColor.rgb, uHaze') > plain.fragmentShader.indexOf('#include <opaque_fragment>'), 'haze goes over the finished colour');
  assert.ok(!plain.fragmentShader.includes('uGlowFar.x *'), 'only glowing materials get the lift with distance');
  assert.ok(!plain.fragmentShader.includes('hue'));
  assert.equal(patchColossusShader(plain, uniforms), false, 'a second patch is refused');
  for (const key of ['uHaze', 'uHazeRates', 'uSkyFill', 'uGroundFill', 'uSheen', 'uGlowFar']) assert.ok(plain.uniforms[key], key);
  const glowing = { uniforms: {}, fragmentShader: source };
  patchColossusShader(glowing, uniforms, { glow: true });
  assert.ok(glowing.fragmentShader.includes('uGlowFar.x *') && !glowing.fragmentShader.includes('vec3 hue'));
  const crystal = { uniforms: {}, fragmentShader: source };
  patchColossusShader(crystal, uniforms, { crystal: true });
  assert.ok(crystal.fragmentShader.includes('uGlowFar.x *') && crystal.fragmentShader.includes('vec3 hue'), 'crystals take their glow hue from the vertex colour');
});

test('the look: the hide is lifted off black, the glow lifts with distance, and the numbers are in one table', () => {
  assert.ok(COLOSSUS.light.hide > 1 && COLOSSUS.light.sky > 0 && COLOSSUS.light.sheen > 0);
  assert.ok(COLOSSUS.glow.night > COLOSSUS.glow.day, 'the glow has to carry the night');
  assert.ok(COLOSSUS.glow.far.to > COLOSSUS.glow.far.from && COLOSSUS.glow.far.gain > 0);
  assert.deepEqual([...COLOSSUS.lodDistances], [0, 70, 330]);
  assert.ok(COLOSSUS.files.every(f => /colossus_01_lod[012](_stopgap)?\.glb$/.test(f)));
});

test('tuning the look in a dev session moves the material colours and the uniforms and nothing else', async () => {
  const t = setup();
  await settle();
  t.colossus.update(1 / 30, { x: t.colossus.state.x + 400, z: t.colossus.state.z });
  const level = t.colossus.debug.levels[2];
  let found = null;
  level.root.traverse(o => { if (o.isSkinnedMesh && o.material.name === 'Colossus hide') found = o.material; });
  assert.ok(found, 'the hide material is there');
  const before = found.color.g;
  t.colossus.debug.tune({ hide: COLOSSUS.light.hide * 2 });
  assert.ok(Math.abs(found.color.g - 2 * before) < 1e-9, 'twice the lift, twice the colour');
  t.colossus.debug.tune({ hide: COLOSSUS.light.hide });
  assert.ok(Math.abs(found.color.g - before) < 1e-9, 'and back again, from the model\'s own colour, not compounding');
});
