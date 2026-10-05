import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WATER, SPAWN } from '../src/world.js';
import {
  CAMPFIRE, campfireSpot, canPlaceCampfire, findIgnitingFlame, campfireSite, crackleVolume,
  installFireLights, createCampfires,
} from '../src/campfire.js';

const FLAT = () => 20; // level ground

test('a campfire is placed straight ahead on the level, whichever way you are looking up or down', () => {
  const spot = campfireSpot({ x: 10, y: 1.7, z: 20 }, { x: 0, y: -0.6, z: -0.5 });
  assert.ok(Math.abs(spot.x - 10) < 1e-9);
  assert.ok(Math.abs(spot.z - (20 - CAMPFIRE.placeDistance)) < 1e-9);
  const diagonal = campfireSpot({ x: 0, z: 0 }, { x: 3, y: 0, z: -3 }, 2);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - 2) < 1e-9);
  // looking straight down gives no direction: it still picks somewhere sensible (forward is -z)
  assert.deepEqual(campfireSpot({ x: 5, z: 5 }, { x: 0, y: -1, z: 0 }, 1), { x: 5, z: 4 });
});

test('fires cannot go in the pond, on top of each other, or beyond the limit', () => {
  assert.equal(canPlaceCampfire(SPAWN.x + 4, SPAWN.z - 4, [], FLAT).ok, true);
  const pond = canPlaceCampfire(WATER.x, WATER.z, [], FLAT);
  assert.equal(pond.ok, false);
  assert.match(pond.message, /water/i);
  const near = canPlaceCampfire(SPAWN.x + 5, SPAWN.z - 4, [{ x: SPAWN.x + 4, z: SPAWN.z - 4 }], FLAT);
  assert.equal(near.ok, false);
  assert.equal(canPlaceCampfire(SPAWN.x + 4 + CAMPFIRE.minSpacing + 0.1, SPAWN.z - 4, [{ x: SPAWN.x + 4, z: SPAWN.z - 4 }], FLAT).ok, true);
  const full = Array.from({ length: CAMPFIRE.maxCount }, (_, i) => ({ x: SPAWN.x + i * 10, z: SPAWN.z }));
  assert.equal(canPlaceCampfire(SPAWN.x + 100, SPAWN.z + 100, full, FLAT).ok, false);
  assert.equal(canPlaceCampfire(NaN, 0, [], FLAT).ok, false);
});

test('only a flame within reach of the logs lights the fire', () => {
  const point = new THREE.Vector3(0, 0.3, 0);
  const close = { position: new THREE.Vector3(0.2, 0.5, 0.1) };
  const far = { position: new THREE.Vector3(1.5, 0.3, 0) };
  assert.equal(findIgnitingFlame([far], point), null);
  assert.equal(findIgnitingFlame([], point), null);
  assert.equal(findIgnitingFlame(undefined, point), null);
  assert.equal(findIgnitingFlame([far, close], point), close);
});

test('the ring sits halfway between the highest and lowest ground under it, and steep ground is refused', () => {
  const slope = (x) => 10 + x * 0.2; // 0.2 m of rise per metre
  const site = campfireSite(0, 0, slope, 0.5);
  assert.ok(Math.abs(site.y - 10) < 1e-9, 'halfway: the stones reach underground to cover the downhill side');
  assert.ok(Math.abs(site.slope - 0.2) < 1e-9);
  assert.deepEqual(campfireSite(3, 3, () => 7), { y: 7, slope: 0 });
  assert.equal(canPlaceCampfire(SPAWN.x, SPAWN.z, [], x => x * 0.2).ok, true, 'a gentle tilt is fine');
  const steep = canPlaceCampfire(SPAWN.x, SPAWN.z, [], x => x * 0.7);
  assert.equal(steep.ok, false);
  assert.match(steep.message, /steep/i);
  // water and spacing are reported before steepness
  assert.match(canPlaceCampfire(WATER.x, WATER.z, [], x => x * 0.7).message, /water/i);
});

test('the crackle fades with distance', () => {
  assert.equal(crackleVolume(0), CAMPFIRE.audioVolume);
  assert.ok(crackleVolume(5) > crackleVolume(15));
  assert.equal(crackleVolume(CAMPFIRE.audioRange), 0);
  assert.equal(crackleVolume(1000), 0);
});

function fakeShader(kind) {
  const terrain = 'uniform float uGrassTileMetres;\nvoid main() {\n  vec3 light = ambient + sunColour() * sun;\n}';
  const water = 'uniform sampler2D uElevation;\nvoid main() {\n  vec3 color = mix(transmission, reflectedColor, fresnel);\n}';
  const material = new THREE.ShaderMaterial({ fragmentShader: kind === 'water' ? water : terrain, uniforms: {} });
  return material;
}

test('terrain and water shaders get the fire light once, and unknown shaders are left alone', () => {
  const uniforms = {
    uFirePositions: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    uFireStrengths: { value: [0, 0, 0] },
  };
  for (const kind of ['terrain', 'water']) {
    const material = fakeShader(kind);
    assert.equal(installFireLights(material, kind, uniforms), true);
    assert.ok(material.fragmentShader.includes('uFireStrengths'));
    assert.ok(material.fragmentShader.includes('uniform vec3 uFirePositions[3]'));
    assert.equal(material.uniforms.uFireStrengths, uniforms.uFireStrengths);
    const once = material.fragmentShader;
    assert.equal(installFireLights(material, kind, uniforms), true);
    assert.equal(material.fragmentShader, once, 'patching twice must not duplicate the code');
  }
  // the loop sits after the base light for terrain, and before the final colour for water
  const terrain = fakeShader('terrain'); installFireLights(terrain, 'terrain', uniforms);
  assert.ok(terrain.fragmentShader.indexOf('vec3 light =') < terrain.fragmentShader.indexOf('uFireStrengths[fi] > 0.001'));
  const water = fakeShader('water'); installFireLights(water, 'water', uniforms);
  assert.ok(water.fragmentShader.indexOf('uFireStrengths[fi] > 0.001') < water.fragmentShader.indexOf('vec3 color = mix('));
  const other = new THREE.ShaderMaterial({ fragmentShader: 'void main() {}' });
  assert.equal(installFireLights(other, 'terrain', uniforms), false);
  assert.equal(installFireLights(new THREE.MeshBasicMaterial(), 'terrain', uniforms), false);
});

test('the fire light patches the REAL terrain and water shaders (the sun colour line it hooks into drifted once and no fire lit the ground for a day)', async () => {
  const fs = await import('node:fs');
  const materials = fs.readFileSync(new URL('../src/materials.js', import.meta.url), 'utf8');
  const water = fs.readFileSync(new URL('../src/oasis-water.js', import.meta.url), 'utf8');
  const uniforms = { uFirePositions: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] }, uFireStrengths: { value: [0, 0, 0] } };
  // the terrain shader's fragment source as materials.js writes it, the water's as oasis-water.js rewrites it
  const terrainSource = materials.slice(materials.indexOf('fragmentShader: /* glsl */`', materials.indexOf('uGrassTileMetres')));
  assert.equal(installFireLights(new THREE.ShaderMaterial({ fragmentShader: terrainSource, uniforms: {} }), 'terrain', uniforms), true, 'the terrain shader no longer has the line the campfire light hooks into');
  assert.equal(installFireLights(new THREE.ShaderMaterial({ fragmentShader: water, uniforms: {} }), 'water', uniforms), true, 'the water shader no longer has the line the campfire light hooks into');
});

function makeTemplate() {
  const template = new THREE.Group();
  for (const name of ['Stones', 'Logs', 'Ash']) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshStandardMaterial());
    mesh.name = name;
    template.add(mesh);
  }
  const embers = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.1), new THREE.MeshStandardMaterial({ emissive: 0xff4400 }));
  embers.name = 'Embers';
  template.add(embers);
  const anchor = new THREE.Object3D();
  anchor.name = 'FlameAnchor';
  anchor.position.set(0, 0.14, 0);
  template.add(anchor);
  return template;
}

const SPOT = { x: SPAWN.x + 4, z: SPAWN.z - 4 };

test('a placed campfire starts cold with hidden embers and no light', () => {
  const scene = new THREE.Scene();
  const camp = createCampfires({ scene, template: makeTemplate(), heightAt: FLAT });
  assert.equal(camp.ready, true);
  const fire = camp.place(SPOT.x, SPOT.z);
  assert.ok(fire);
  assert.equal(camp.count, 1);
  assert.equal(fire.lit, false);
  assert.equal(fire.embers.material.emissiveIntensity, 0, 'cold coals do not glow');
  assert.equal(fire.fx.group.visible, false);
  assert.equal(fire.root.parent, scene);
  camp.update(0.016, new THREE.PerspectiveCamera());
  assert.equal(camp.light.intensity, 0);
  assert.deepEqual(camp.uniforms.uFireStrengths.value, [0, 0, 0]);
  // the ember material is its own copy: lighting one fire must not change the template or another fire
  const second = camp.place(SPOT.x + 10, SPOT.z);
  assert.notEqual(second.embers.material, fire.embers.material);
});

test('a lit torch held to the logs lights the fire; one held far away does not', () => {
  const scene = new THREE.Scene();
  let flames = [];
  const camp = createCampfires({ scene, template: makeTemplate(), heightAt: FLAT, getFlames: () => flames, getExposure: () => 0.035 });
  const fire = camp.place(SPOT.x, SPOT.z);
  const view = new THREE.PerspectiveCamera();
  view.position.set(SPOT.x + 3, fire.ignitionPoint.y + 1.4, SPOT.z);
  view.updateMatrixWorld(true);

  flames = [{ position: fire.ignitionPoint.clone().add(new THREE.Vector3(2, 0, 0)) }];
  camp.update(0.016, view);
  assert.equal(fire.lit, false, 'a torch two metres away does nothing');

  flames = [{ position: fire.ignitionPoint.clone().add(new THREE.Vector3(0.2, 0.1, 0)) }];
  camp.update(0.016, view);
  assert.equal(fire.lit, true);
  assert.equal(fire.fx.group.visible, true);

  // it fades in rather than popping on, then stays lit when the torch goes away
  assert.ok(camp.light.intensity < CAMPFIRE.lightIntensity * 0.2);
  flames = [];
  for (let i = 0; i < 60; i++) camp.update(0.05, view);
  assert.equal(fire.lit, true, 'the fire stays lit');
  assert.ok(camp.light.intensity > CAMPFIRE.lightIntensity * 0.7);
  assert.ok(camp.uniforms.uFireStrengths.value[0] > 0.7);
  assert.equal(camp.uniforms.uFireStrengths.value[1], 0);
  const slot = camp.uniforms.uFirePositions.value[0];
  assert.ok(Math.hypot(slot.x - fire.flamePosition.x, slot.z - fire.flamePosition.z) < 1e-6, 'light slot sits over the fire');
  assert.ok(Math.abs(slot.y - (fire.flamePosition.y + CAMPFIRE.lightHeight - 0.14)) < 1e-6, 'and at the light height');
});

test('the shared light follows the nearest lit fire and the shader slots fill in order', () => {
  const scene = new THREE.Scene();
  const camp = createCampfires({ scene, template: makeTemplate(), heightAt: FLAT, getExposure: () => 0.035 });
  const near = camp.place(SPOT.x, SPOT.z, { lit: true });
  const far = camp.place(SPOT.x + 20, SPOT.z, { lit: true });
  const cold = camp.place(SPOT.x, SPOT.z + 20);
  const view = new THREE.PerspectiveCamera();
  view.position.set(SPOT.x + 18, near.flamePosition.y + 1.5, SPOT.z);
  view.updateMatrixWorld(true);
  for (let i = 0; i < 40; i++) camp.update(0.05, view);
  assert.ok(Math.abs(camp.light.position.x - far.flamePosition.x) < 0.01, 'light sits at the closer fire');
  const strengths = camp.uniforms.uFireStrengths.value;
  assert.ok(strengths[0] > 0 && strengths[1] > 0 && strengths[2] === 0, 'two lit fires, one cold');
  camp.setLit(near, false);
  assert.equal(near.lit, false);
  assert.equal(near.embers.material.emissiveIntensity, 0);
  camp.update(0.05, view);
  assert.ok(camp.uniforms.uFireStrengths.value[1] === 0 && camp.uniforms.uFireStrengths.value[0] > 0);
  assert.equal(cold.lit, false);
});

test('placement is refused in water, too close to another fire, and past the limit', () => {
  const scene = new THREE.Scene();
  const camp = createCampfires({ scene, template: makeTemplate(), heightAt: FLAT });
  assert.equal(camp.place(WATER.x, WATER.z), null);
  assert.ok(camp.place(SPOT.x, SPOT.z));
  assert.equal(camp.place(SPOT.x + 1, SPOT.z), null);
  assert.equal(camp.canPlace(SPOT.x + 1, SPOT.z).ok, false);
  assert.ok(camp.place(SPOT.x + 10, SPOT.z));
  assert.ok(camp.place(SPOT.x + 20, SPOT.z));
  assert.equal(camp.place(SPOT.x + 30, SPOT.z), null, 'the fourth fire is refused');
  assert.equal(camp.count, CAMPFIRE.maxCount);
});

test('the campfire keeps one shared light in the scene so the light count never changes', () => {
  const scene = new THREE.Scene();
  const camp = createCampfires({ scene, template: makeTemplate(), heightAt: FLAT });
  const lights = () => { let n = 0; scene.traverse(o => { if (o.isLight) n++; }); return n; };
  const before = lights();
  assert.equal(before, 1);
  camp.place(SPOT.x, SPOT.z, { lit: true });
  camp.place(SPOT.x + 10, SPOT.z, { lit: true });
  camp.update(0.05, new THREE.PerspectiveCamera());
  assert.equal(lights(), before);
});

test('lit coals glow the same by day and by night: the exposure is cancelled out', () => {
  const lit = exposure => {
    const scene = new THREE.Scene();
    const camp = createCampfires({ scene, template: makeTemplate(), heightAt: FLAT, getExposure: () => exposure });
    const fire = camp.place(SPOT.x, SPOT.z, { lit: true });
    const view = new THREE.PerspectiveCamera();
    for (let i = 0; i < 60; i++) camp.update(0.05, view);
    return fire.embers.material.emissiveIntensity * exposure; // what ends up on screen
  };
  const day = lit(0.82), night = lit(0.035);
  assert.ok(day > 0.5);
  assert.ok(Math.abs(day - night) / day < 0.02, `day ${day} night ${night}`);
});

test('a placed fire sits on the middle of the ground under it and turns the same way for the same spot', () => {
  const scene = new THREE.Scene();
  const camp = createCampfires({ scene, template: makeTemplate(), heightAt: x => 10 + x * 0.1 });
  const fire = camp.place(SPOT.x, SPOT.z);
  assert.ok(Math.abs(fire.root.position.y - (10 + SPOT.x * 0.1)) < 1e-6);
  const again = createCampfires({ scene: new THREE.Scene(), template: makeTemplate(), heightAt: FLAT }).place(SPOT.x, SPOT.z);
  assert.equal(again.root.rotation.y, fire.root.rotation.y);
});

test('by day the fire light and ground glow are mostly gone, so the stones are not blown out white', () => {
  const run = exposure => {
    const camp = createCampfires({ scene: new THREE.Scene(), template: makeTemplate(), heightAt: FLAT, getExposure: () => exposure });
    camp.place(SPOT.x, SPOT.z, { lit: true });
    const view = new THREE.PerspectiveCamera();
    for (let i = 0; i < 60; i++) camp.update(0.05, view);
    return { light: camp.light.intensity, ground: camp.uniforms.uFireStrengths.value[0] };
  };
  const night = run(0.035), dusk = run(0.2), day = run(0.82);
  assert.ok(night.light > 100 && night.ground > 0.7);
  assert.ok(day.light < night.light * 0.15 && day.ground < night.ground * 0.15, `day ${JSON.stringify(day)}`);
  assert.ok(dusk.light < night.light && dusk.light > day.light, 'it fades smoothly through dusk');
});
