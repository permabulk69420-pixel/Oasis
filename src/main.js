import * as THREE from 'three';
import './style.css';
import { installAssetVersioning } from './asset-version.js';
import { createHeightField, clamp, stickAxis, stickVector, pivotRig, isInPond, SPAWN, WATER, HERO_TREE } from './world.js';
import { createTerrain } from './terrain.js';
import { createSkyIsland } from './sky-island.js';
import { createIslandScenery } from './sky-island-scenery.js';
import { ISLAND_START } from './sky-island-ground.js';
import { startPlace } from './start-place.js';
import { createFall, stepFall, fallDamage } from './player-fall.js';
import { WALK } from './zones.js';
import { TURBO, createTurboChord } from './turbo.js';
import { createMaterials, createWater } from './materials.js';
import { createVRHands } from './hands.js';
import { createDayNightCycle } from './day-night.js';
import { createSandFootsteps } from './footsteps.js';
import { createGroundSticks } from './sticks.js';
import { createGroundStones } from './stones.js';
import { createFarPickups } from './far-pickups.js';
import { createGroundFruit } from './glow-fruit.js';
import { createCampfires, campfireSite, campfireYaw, CAMPFIRE } from './campfire.js';
import { createWindSand, WIND_SAND } from './wind-sand.js';
import { createAlienBirds } from './alien-bird.js';
import { createDuneStinger } from './dune-stinger.js';
import { createSandPuffs } from './sand-puffs.js';
import { createFootprints } from './footprints.js';
import { createWeaponHits } from './weapon-hits.js';
import { createMining } from './mining.js';
import { createCrystalMotes } from './crystal-motes.js';
import { createGiantBones } from './giant-bones.js';
import { createColossus } from './colossus.js';
import { registerLooseFindDrops } from './loose-finds.js';
import { createBackpack, PACK } from './backpack.js';
import { SPEAR } from './spear.js';
import { stepBody } from './falling.js';
import { windTime, windStrength } from './wind.js';
import { createPlantPush, pushSettings } from './plant-push.js';
import { installNightFill } from './night-fill.js';
import { getSurvivalStats, updateSurvival, canSprint, restoreFood, restoreWater, damagePlayer, exportSurvival, importSurvival } from './survival.js';
import { createPlacement } from './placement.js';
import { createGlowGarden } from './glow-garden.js';
import { pulseHaptics } from './haptics.js';
import { createSurvivorMenu } from './survivor-menu.js';
import { getInventoryWeight, getCarryCapacity, getCarrySpeedMultiplier, addInventoryItem, removeInventoryItem, getInventoryItems, importInventoryItems } from './inventory.js';
import { createSaveStore, createAutosave, wantsFresh } from './save-game.js';

// Every model and texture asks for ?v=<build id>, so a new deploy is never answered from the browser's 10 minute cache.
installAssetVersioning();

installNightFill(); // moonlit fill for the lit (PBR) objects: before anything compiles
const canvas = document.querySelector('#world');
const welcome = document.querySelector('#welcome');
const status = document.querySelector('#status');
const explore = document.querySelector('#explore');
const enterVR = document.querySelector('#enter-vr');
const seatedMode = document.querySelector('#seated-mode');
const menu = document.querySelector('#menu');
const inventoryToggle = document.querySelector('#inventory-toggle');
const touchControls = document.querySelector('#touch-controls');
const movePad = document.querySelector('#move-pad');
const touchDevice = matchMedia('(pointer: coarse)').matches;
if (touchDevice) document.querySelector('#controls').textContent = 'Left pad to move · Drag the right side to look';
explore.disabled = true;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
} catch (error) {
  status.textContent = 'WebGL could not start. Try opening this page in Meta Quest Browser or a current desktop browser.';
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFramebufferScaleFactor(1.0);
renderer.xr.setFoveation(0.65);
renderer.setClearColor(0xacc5cc);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.07, 6500);
const rig = new THREE.Group();
rig.add(camera); scene.add(rig);
// Where a new game starts (src/start-place.js): the floating island by default, or the oasis with ?start=oasis. While you are on the
// island, `groundAt` gives the island's top; everything else in the world stays on the desert's ground.
const startsOnIsland = startPlace(location.search, import.meta.env.DEV) === 'island';
let onIsland = startsOnIsland;
const hands = createVRHands({
  renderer,
  scene,
  camera,
  gripDebug: import.meta.env.DEV && new URLSearchParams(location.search).get('gripDebug') === '1',
  onEat: ({ food, water }) => { restoreFood(food); restoreWater(water); },
  heightAt: (x, z) => groundAt(x, z), // the mesh-accurate ground, for tools that fall (the field and the island are made a few lines below)
  copyStart: startsOnIsland ? { from: SPAWN, to: ISLAND_START } : null, // a second set of the starting tools on the island (the oasis keeps its own)
  onError: (message) => console.warn('[Oasis hands]', message)
});
const footsteps = createSandFootsteps({
  onError: (message) => console.warn(message)
});
camera.position.set(0, 1.68, 0);
camera.rotation.order = 'YXZ';
camera.rotation.x = -0.045;
rig.rotation.y = -Math.atan2(WATER.x, -WATER.z);

// Yield a frame so the loading status is painted before constructing the terrain.
await new Promise(requestAnimationFrame);
const field = createHeightField();
const materials = createMaterials(renderer, field);
const terrain = createTerrain(field, materials.sand);
scene.add(terrain.group);
const skyIsland = createSkyIsland(materials.sand);
scene.add(skyIsland.group);
// The lake and its waterfall, the paths, the stone and the palm grove: scenery, nothing in play touches it (src/sky-island-scenery.js).
const skyScenery = createIslandScenery({ island: skyIsland, materials, getExposure: () => renderer.toneMappingExposure });
scene.add(skyScenery.group);
if (import.meta.env.DEV) window.__skyIsland = Object.assign(skyIsland, { scenery: skyScenery }); // dev only: for screenshots
// The ground under (x, z) for the player and what they carry: the island's top while you are on the island (and the point is over it),
// the desert's ground otherwise. Desert systems (rocks, grass, the creatures) keep reading `field` directly.
function groundAt(x, z) {
  if (onIsland) {
    const height = skyIsland.groundHeight(x, z);
    if (height !== null) return height;
  }
  return field.sample(x, z);
}
scene.add(createWater(field, materials.water));
const sticksGroup = createGroundSticks({
  field,
  onError: (message) => console.warn(message)
});
scene.add(sticksGroup);
const stonesGroup = createGroundStones({
  field,
  renderer,
  onError: (message) => console.warn(message)
});
scene.add(stonesGroup);
// Glow fruit around the veil tree. They follow the live sun vector for their night glow.
const glowFruit = createGroundFruit({ field, sunDirection: materials.sand.uniforms.uSun.value });
scene.add(glowFruit.group);
// Loose stones, sticks and fruit are a draw call each: past a few hundred metres from you (the island start is 600 m from the pond) they are not drawn.
const farPickups = createFarPickups({ groups: [sticksGroup, stonesGroup, glowFruit.group] });
// The oasis's glow plants: reeds at the water's edge, lantern blooms on the banks and round the hero tree.
const glowGarden = createGlowGarden({ field, getExposure: () => renderer.toneMappingExposure, sunDirection: materials.sand.uniforms.uSun.value, onError: message => console.warn(message), extra: skyScenery.glow });
scene.add(glowGarden.group);
// Plants give way to your feet and hands (src/wind.js PUSH; `?push=0` switches it off to compare).
const plantPush = createPlantPush({ rig, states: hands.states, enabled: pushSettings(location.search) });
if (import.meta.env.DEV) window.__glowGarden = glowGarden; // dev only: for screenshots
const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), materials.sky);
sky.frustumCulled = false; sky.renderOrder = -10; sky.name = 'Sky'; scene.add(sky);
const dayNight = createDayNightCycle({ scene, renderer, materials });
// Wind-blown sand and drifting dust. It shares the terrain's sun and pond uniforms and keeps its own window of the ground round the player.
const windSand = createWindSand({
  scene,
  uniforms: {
    uSun: materials.sand.uniforms.uSun,
    uWater: materials.sand.uniforms.uWater,
    uWaterRadii: materials.sand.uniforms.uWaterRadii,
  },
  field,
});
if (import.meta.env.DEV) {
  const gain = Number(new URLSearchParams(location.search).get('sandgain'));
  if (gain > 0) windSand.uniforms.uGain.value = gain; // dev only: exaggerate the sand to check it
}
const drawingSize = new THREE.Vector2();
const firstSpot = startsOnIsland ? ISLAND_START : SPAWN;
rig.position.set(firstSpot.x, groundAt(firstSpot.x, firstSpot.z), firstSpot.z);
if (startsOnIsland) rig.rotation.y = ISLAND_START.yaw;

let devWindTime = null; // dev only: set by ?windtime=
let devThrows = null; // dev only: ?view=throws, a function called every frame until it has thrown its tools
// Development-only camera fixtures for repeatable visual inspection. No travel shortcuts ship.
if (import.meta.env.DEV) {
  const view = new URLSearchParams(location.search).get('view');
  if (view === 'shore') {
    const dx = WATER.radiusX * 1.05, dz = WATER.radiusZ * 0.80;
    rig.position.set(WATER.x - dx, field.sample(WATER.x - dx, WATER.z + dz), WATER.z + dz);
    rig.rotation.y = -Math.atan2(dx, dz); camera.rotation.x = -0.13;
  }
  if (view === 'turf') {
    // Looking down at the grass band just outside the water, for checking the ground texture.
    const dx = WATER.radiusX * 1.18, dz = WATER.radiusZ * 0.80;
    rig.position.set(WATER.x - dx, field.sample(WATER.x - dx, WATER.z + dz), WATER.z + dz);
    rig.rotation.y = -Math.atan2(dx, dz); camera.rotation.x = -0.62;
  }
  if (view === 'wade') { rig.position.set(WATER.x, field.sample(WATER.x, WATER.z), WATER.z); camera.rotation.x = -0.1; }
  if (view === 'oasis') {
    rig.position.set(WATER.x - 88, WATER.y + 76, WATER.z + 86);
    rig.rotation.y = -Math.atan2(88, 86); camera.rotation.x = -0.58;
  }
  // Aim the camera at a point: rig turns to face it, the camera tilts up or down to meet it.
  const aimAt = (px, pz, target, eye = 1.68) => {
    const groundY = groundAt(px, pz);
    rig.position.set(px, groundY, pz);
    const dx = target.x - px, dz = target.z - pz;
    rig.rotation.y = Math.atan2(-dx, -dz);
    camera.rotation.x = Math.atan2(target.y - (groundY + eye), Math.hypot(dx, dz));
  };
  const heroY = field.sample(HERO_TREE.x, HERO_TREE.z);
  if (view === 'hero') aimAt(HERO_TREE.x - 150, HERO_TREE.z + 150, { x: HERO_TREE.x, y: heroY + 38, z: HERO_TREE.z });
  if (view === 'approach') aimAt(HERO_TREE.x - 80, HERO_TREE.z + 80, { x: HERO_TREE.x, y: heroY + 22, z: HERO_TREE.z }, 1.7);
  if (view === 'glade') aimAt(HERO_TREE.x - 11, HERO_TREE.z + 12, { x: HERO_TREE.x + 3, y: heroY + 1.2, z: HERO_TREE.z - 4 }, 1.7);
  const fruit0 = glowFruit.slots[0];
  if (view === 'pack') aimAt(PACK.spawn.x - 0.9, PACK.spawn.z + 1.5, { x: PACK.spawn.x, y: field.sample(PACK.spawn.x, PACK.spawn.z) + 0.3, z: PACK.spawn.z }, 1.2);
  if (view === 'spear') aimAt(SPEAR.spawn.x - 0.7, SPEAR.spawn.z + 1.5, { x: SPEAR.spawn.x, y: field.sample(SPEAR.spawn.x, SPEAR.spawn.z) + 0.55, z: SPEAR.spawn.z }, 1.3);
  if (view === 'throws') {
    // Tools thrown and dropped in front of the camera, to look at how they land and lie (src/falling.js).
    const px = SPEAR.spawn.x + 3, pz = SPEAR.spawn.z + 5;
    const gy = field.sample(px, pz);
    const target = { x: px - 5, y: gy + 0.2, z: pz - 12 };
    aimAt(px, pz, target, 1.6);
    const fwd = new THREE.Vector3(target.x - px, 0, target.z - pz).normalize();
    const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const up = new THREE.Vector3(0, 1, 0);
    // Directions below are written as (sideways, up, forward) and turned into world axes here.
    const toWorld = d => new THREE.Vector3().addScaledVector(side, d.x).addScaledVector(up, d.y).addScaledVector(fwd, d.z).normalize();
    const pose = (lateral, dir) => ({
      origin: new THREE.Vector3(px, gy + 1.5, pz).addScaledVector(side, lateral).addScaledVector(fwd, 0.6),
      quaternion: new THREE.Quaternion().setFromUnitVectors(up, dir),
    });
    const throws = [
      ['spear', 0, new THREE.Vector3(0, -0.28, 1), 12, 0], // point-first, fast: sticks in the sand
      ['spear', 1.2, new THREE.Vector3(0, 0.1, 1), 6, 0], // slow and flat: lies where it lands
      ['axe', -1.0, new THREE.Vector3(0, 0.4, 1), 6, 9], // tumbling
      ['torch', -2.0, new THREE.Vector3(0, 1, 0.1), 1, 0], // dropped
      ['spear', 2.4, new THREE.Vector3(0, 1, 0), 0, 0], // dropped upright
    ];
    const todo = throws.slice();
    const landed = [];
    devThrows = () => {
      while (todo.length) {
        const [id, lateral, local, speed, tumble] = todo[0];
        const dir = toWorld(local);
        const start = pose(lateral, dir);
        const tool = hands.tools.throwTool(id, {
          ...start,
          velocity: dir.clone().multiplyScalar(speed),
          spin: side.clone().multiplyScalar(-tumble),
        });
        if (!tool) return false;
        // Headless browsers draw a few frames a second, so play the fall ahead here and the tools are already lying when the picture is taken.
        for (let i = 0; i < 900 && stepBody(tool.fall, 1 / 60, (x, z) => field.sample(x, z)); i++);
        landed.push(tool.fall.centre);
        todo.shift();
      }
      // Once they are all down, stand a few metres back from where they landed and look at them.
      const mid = new THREE.Vector3();
      const far = landed.slice(0, 3); // the two spears and the axe that flew forward
      for (const c of far) mid.add(c);
      mid.divideScalar(far.length);
      const standX = mid.x - fwd.x * 2.6, standZ = mid.z - fwd.z * 2.6;
      aimAt(standX, standZ, { x: mid.x, y: mid.y - 0.3, z: mid.z }, 1.6);
      return true;
    };
  }
  if (view === 'fruit' && fruit0) aimAt(fruit0.x + 1.1, fruit0.z + 0.8, { x: fruit0.x, y: field.sample(fruit0.x, fruit0.z) + 0.06, z: fruit0.z }, 1.2);
  if (view === 'orchard') aimAt(HERO_TREE.x - 34, HERO_TREE.z + 22, { x: HERO_TREE.x - 8, y: heroY + 0.2, z: HERO_TREE.z + 2 }, 1.7);
  if (view === 'base') aimAt(HERO_TREE.x - 16, HERO_TREE.z + 17, { x: HERO_TREE.x - 2, y: heroY + 1.5, z: HERO_TREE.z + 2 }, 1.3);
  if (view === 'under') aimAt(HERO_TREE.x - 30, HERO_TREE.z + 30, { x: HERO_TREE.x, y: heroY + 22, z: HERO_TREE.z });
  const hour = Number(new URLSearchParams(location.search).get('hour'));
  if (new URLSearchParams(location.search).has('hour') && Number.isFinite(hour)) { dayNight.setTimeOfDay(hour); dayNight.setPaused(true); }
  if (view === 'wide') {
    rig.position.set(-90, field.sample(-90, 30) + 8, 30);
    rig.rotation.y = -0.7; camera.rotation.x = -0.2;
  }
  // Across the wind on a dune crest, so blowing sand streams past the view.
  if (view === 'gust') {
    const px = SPAWN.x, pz = SPAWN.z;
    rig.position.set(px, field.sample(px, pz), pz);
    rig.rotation.y = Math.atan2(-0.54, 0.84); camera.rotation.x = -0.05;
  }
  const params = new URLSearchParams(location.search);
  // Stand at ?at=x,z (world metres) and look at ?look=x,z[,metres above the ground].
  const point = name => {
    const v = params.has(name) ? params.get(name).split(',').map(Number) : [];
    return v.length >= 2 && v.every(Number.isFinite) ? v : null;
  };
  const at = point('at'), look = point('look');
  if (at && look) aimAt(at[0], at[1], { x: look[0], y: groundAt(look[0], look[1]) + (look[2] ?? 1.5), z: look[1] }, 1.7);
  else if (at) rig.position.set(at[0], groundAt(at[0], at[1]), at[1]);
  // Look direction, in degrees: yaw turns the rig (0 faces -z, positive turns left), pitch tilts up.
  if (params.has('yaw') && Number.isFinite(Number(params.get('yaw')))) rig.rotation.y = Number(params.get('yaw')) * Math.PI / 180;
  if (params.has('pitch') && Number.isFinite(Number(params.get('pitch')))) camera.rotation.x = Number(params.get('pitch')) * Math.PI / 180;
  // Pin the sky clock (seconds), e.g. to catch a shooting star in a screenshot.
  if (params.has('skytime') && Number.isFinite(Number(params.get('skytime')))) dayNight.setCloudTime(Number(params.get('skytime')));
  // Pin the wind clock (seconds) so two screenshots can be compared, and turn the sway up to see which way it leans.
  if (params.has('windtime') && Number.isFinite(Number(params.get('windtime')))) devWindTime = Number(params.get('windtime'));
  if (Number(params.get('windgain')) > 0) windStrength.value = Number(params.get('windgain'));
  const eye = Number(new URLSearchParams(location.search).get('eye'));
  if (new URLSearchParams(location.search).has('eye') && eye > 0) camera.position.y = eye; // low camera for ground-level shots
}

let playing = false;
let lastTime = 0, lodTime = -1, telemetryTime = -1;
let mouseDragging = false, touchLookId = null, touchMoveId = null;
let previousPointer = { x: 0, y: 0 };
let touchMove = { x: 0, z: 0 };
const keys = new Set();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3(0, 0, -1), movementForward = new THREE.Vector3(), right = new THREE.Vector3(), head = new THREE.Vector3();
const target = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
const lastDirection = new THREE.Vector3(0, 0, -1);
const WALK_SPEED = 2.6, FAST_SPEED = 5.2, TURN_SPEED = 1.4;
let turboActive = false;
const turboChord = createTurboChord();
function toggleTurbo() {
  turboActive = !turboActive;
  for (const state of hands.states) pulseHaptics(state, 0.45, 90);
}
const STANDING_EYE_HEIGHT = 1.68, JUMP_SPEED = 4.4, GRAVITY = 12.0;
const CROUCH_DEPTH = 0.58, CROUCH_RESPONSE = 12.0, LEFT_STICK_BUTTON = 3, RIGHT_STICK_BUTTON = 3;
let groundY = rig.position.y;
const fall = createFall();
let seatedOffset = 0, seatedCalibrationPending = false;
let jumpHeight = 0, jumpVelocity = 0, jumpHeld = false;
let crouchOffset = 0, crouchActive = false, crouchButtonDown = false;
let sprintActive = false, sprintButtonDown = false;
let drinkTick = 0;

// Campfires: crafted, placed from the menu, lit by touching a lit torch to the logs.
const campfires = createCampfires({
  scene,
  heightAt: groundAt,
  getExposure: () => renderer.toneMappingExposure,
  onError: message => console.warn(message),
  getFlames: () => hands.tools.getInstances('torch')
    .filter(torch => torch.state.lit && torch.state.flameAnchor)
    .map(torch => {
      torch.state.flameAnchor.updateWorldMatrix(true, false);
      return { position: new THREE.Vector3().setFromMatrixPosition(torch.state.flameAnchor.matrixWorld), heldBy: torch.heldBy };
    }),
});
// Alien birds: now and then one flies in, circles the pond and lands to drink, or just crosses the sky.
const alienBirds = createAlienBirds({
  scene, renderer, camera, field,
  sunDirection: materials.sand.uniforms.uSun.value,
  getAvoid: () => campfires.list().map(fire => ({ x: fire.x, z: fire.z, r: 6 })),
  onError: message => console.warn(message),
});
// The dune stinger: one lives in the dunes to the right of the start. It wanders, stalks you when it sees you, and strikes with its
// tail (a warning first, and it lands where you were standing). Your spear and axe hurt it; a few good blows kill it.
const STINGER_HIT_HAPTIC = [1, 220];
// Puffs of sand and dust for anything heavy that lands on the dunes (the sting, a falling body), one draw call for all of them.
const sandPuffs = createSandPuffs({ scene, sun: materials.sand.uniforms.uSun, heightAt: groundAt });
// Footprints in the sand: yours as you walk, and the stinger's. The wind fills them in over a few minutes. One draw call.
const footprints = createFootprints({ scene, sun: materials.sand.uniforms.uSun, heightAt: groundAt });
const duneStinger = createDuneStinger({
  scene, renderer, camera, field, puffs: sandPuffs, prints: footprints,
  getExposure: () => renderer.toneMappingExposure,
  onError: message => console.warn(message),
  onPlayerHit: strike => {
    damagePlayer(strike.damage);
    for (const state of hands.states) pulseHaptics(state, ...STINGER_HIT_HAPTIC);
  },
});
// The things to find out in the dunes: sandstone outcrops and glowing crystal clusters (a pickaxe breaks stone and shards off them) and
// spiny spire plants (an axe cuts fibre from them). Rocks are solid. What they drop joins the loose stones and sticks.
const mining = createMining({
  scene, renderer, heightAt: field.sample,
  getExposure: () => renderer.toneMappingExposure,
  onError: message => console.warn(message),
});
registerLooseFindDrops({ stonesGroup, sticksGroup, materials: mining.materials, heightAt: field.sample });
// Motes of light that lift off the crystal fields at night (one draw; a crystal that is broken takes its motes with it).
const crystalMotes = createCrystalMotes({ scene, nodes: mining.nodes, getExposure: () => renderer.toneMappingExposure });
// The giant bones: the skull and ribs of something enormous, half buried far out in the dunes. Landmarks to walk to; nothing about them
// affects play (you can walk through them, and they make no sound). Only the smallest model is fetched at first, the rest as you near.
const giantBones = createGiantBones({ scene, camera, heightAt: field.sample, onError: message => console.warn(message) });
if (import.meta.env.DEV) window.__bones = giantBones; // dev only: for screenshots
// Colossus 01: a 55 m walker on the gravel plain north of the oasis. Passive: it paces, stands, breathes and looks about (src/colossus.js). Its feet raise
// dust and leave prints, and a footfall near you is felt in the controllers (the only thing it does to you).
const COLOSSUS_STEP_HAPTIC = Object.freeze({ range: 160, strength: 0.7, floor: 0.12, ms: 170 });
const colossus = createColossus({
  scene, renderer, camera, field, sun: materials.sand.uniforms.uSun, puffs: sandPuffs, prints: footprints,
  getExposure: () => renderer.toneMappingExposure,
  onError: message => console.warn(message),
  onFootfall: step => {
    const near = 1 - Math.hypot(head.x - step.x, head.z - step.z) / COLOSSUS_STEP_HAPTIC.range;
    if (near <= 0) return;
    for (const state of hands.states) pulseHaptics(state, COLOSSUS_STEP_HAPTIC.floor + COLOSSUS_STEP_HAPTIC.strength * near * near * step.power, COLOSSUS_STEP_HAPTIC.ms);
  },
});
if (import.meta.env.DEV) window.__colossus = colossus; // dev only: pose it for a screenshot (colossus.debug)
if (import.meta.env.DEV) window.__mining = mining; // dev only: lets a test strike a node without swinging a tool
if (import.meta.env.DEV) { window.__stinger = duneStinger; window.__sandPuffs = sandPuffs; window.__prints = footprints; window.__terrain = terrain; } // dev only: lets a screenshot script read or hurt the stinger and throw dust
const weaponHits = createWeaponHits({ tools: hands.tools, rig, targets: [duneStinger, mining] });
// Development-only: ?bird=perch|fly|flare puts a bird in view and stops time for it (?birdfreeze=0 lets it move),
// ?birdd=<metres> sets how far ahead, ?birdseed=<n> makes the bird's choices repeatable.
const devBirdParams = import.meta.env.DEV ? new URLSearchParams(location.search) : null;
let devBird = devBirdParams?.get('bird') ?? null;
if (devBirdParams?.has('birdseed')) alienBirds.debug.seed(Number(devBirdParams.get('birdseed')));
// ?birdwait=<seconds>: with no fixture, the next bird turns up that many seconds into the day (instead of 12 to 22)
if (devBirdParams?.has('birdwait')) alienBirds.debug.wait(Number(devBirdParams.get('birdwait')) || 0);
// Placing a campfire: the menu's Place button starts a ghost that follows your aim (src/placement.js); the item is only spent when you confirm.
const placement = createPlacement({
  scene, renderer, camera, states: hands.states, heightAt: groundAt,
  check: (x, z) => campfires.canPlace(x, z),
  siteAt: campfires.siteAt,
  makePreview: campfires.createPreview,
  yawAt: campfireYaw,
  radius: CAMPFIRE.footprint,
  inputMode: () => (renderer.xr.isPresenting ? 'vr' : touchDevice ? 'touch' : 'desktop'),
  onConfirm(x, z) {
    const check = campfires.canPlace(x, z);
    if (!check.ok) return check;
    if (!removeInventoryItem('campfire', 1)) return { ok: false, message: 'No campfire in your inventory.' };
    campfires.place(x, z);
    return { ok: true, message: 'Campfire placed. Light it with a torch.' };
  },
});
if (import.meta.env.DEV) window.__placement = placement; // dev only: for screenshots
function placeFromMenu(type, { hand = null } = {}) {
  if (type !== 'campfire') return { ok: false, message: 'You can’t place that.' };
  if (!campfires.ready) return { ok: false, message: 'The campfire is still loading. Try again in a moment.' };
  placement.start({ hand });
  return { ok: true, message: '' };
}
// On the island start the one pack stands by the island's tools instead (the oasis keeps no pack then: there is only one).
const packSpawn = startsOnIsland
  ? Object.freeze({ x: ISLAND_START.x + (PACK.spawn.x - SPAWN.x), z: ISLAND_START.z + (PACK.spawn.z - SPAWN.z), yaw: PACK.spawn.yaw })
  : PACK.spawn;
// The backpack: lies on the sand by the starting tools. Grab it by the handle and let go behind your shoulder to put it on;
// it then adds to how much you can carry (and is taken off again from the menu's Back slot).
const backpack = createBackpack({
  scene, states: hands.states, renderer, camera, rig, tools: hands.tools,
  heightAt: groundAt,
  spawn: packSpawn,
  getExposure: () => renderer.toneMappingExposure,
  onError: message => console.warn(message),
});
// Development-only: ?pack=worn starts with the backpack already on.
if (import.meta.env.DEV && new URLSearchParams(location.search).get('pack') === 'worn') backpack.debug.wear();
// Development-only: ?camp=lit or ?camp=unlit puts a campfire in view near the spawn point.
let devCamp = import.meta.env.DEV ? new URLSearchParams(location.search).get('camp') : null;

// Saving (src/save-game.js): the game keeps itself in local storage and picks up where you left off. No button, no menu.
// ?fresh=1 starts a new game. A dev build saves nothing unless the address has ?save=1, so the screenshot fixtures stay repeatable.
const pageParams = new URLSearchParams(location.search);
const saveStore = createSaveStore();
// Off for now (the owner, 5 Oct: he is testing and wants a fresh world each time; a player-chosen save may come later). `?save=1` turns it on, in any build.
const savingEnabled = pageParams.get('save') === '1' && saveStore.available();
const askedFresh = wantsFresh(location.search);
const saveStart = savingEnabled ? saveStore.begin({ fresh: askedFresh }) : { save: null, note: 'off' };
if (askedFresh) { // so reloading the page does not start another new game
  try { const clean = new URL(location.href); clean.searchParams.delete('fresh'); history.replaceState(null, '', clean.href); } catch { /* the address stays as it is */ }
}
// Where a VR session starts: the start of the world, or where the saved game left you (and from then on, where you left VR).
let startPoint = { x: firstSpot.x, z: firstSpot.z, yaw: startsOnIsland ? ISLAND_START.yaw : 0 };
function placePlayer({ x, z, yaw }) {
  footprints.reset();
  startPoint = { x, z, yaw };
  onIsland = startsOnIsland && skyIsland.groundHeight(x, z) !== null; // a saved game from the oasis puts you back in the oasis
  groundY = groundAt(x, z);
  rig.position.set(x, groundY, z);
  rig.rotation.y = yaw;
}
const autosave = createAutosave({
  store: saveStore, save: saveStart.save, enabled: savingEnabled,
  onWarn: message => console.warn(message),
  slots: [
    { key: 'inventory', read: getInventoryItems, write: importInventoryItems },
    { key: 'survival', read: exportSurvival, write: importSurvival },
    { key: 'time', read: () => dayNight.getState().hours, write: hours => dayNight.setTimeOfDay(hours) },
    { key: 'player', read: () => ({ x: head.x, z: head.z, yaw: rig.rotation.y }), write: placePlayer },
    // the models arrive a moment after the page: these wait for them
    { key: 'tools', ready: () => hands.tools.ready, read: () => hands.tools.snapshot(), write: data => hands.tools.restoreSnapshot(data) },
    { key: 'fires', ready: () => campfires.ready, read: () => campfires.list().map(fire => ({ x: fire.x, z: fire.z, lit: fire.lit })), write: fires => { for (const fire of fires) campfires.place(fire.x, fire.z, { lit: fire.lit }); } },
    { key: 'pack', ready: () => backpack.ready, read: () => backpack.snapshot(), write: data => backpack.restore(data) },
    { key: 'mining', read: () => mining.serialize(), write: data => mining.restore(data) },
  ],
});
// TESTING (the owner, 5 Oct): a new game starts with a campfire in your pockets, so placing and lighting one needs no gathering first.
// Reload the page for another (saving is off, so every load is a new game). Empty this list when the real start is wanted.
const TESTING_START_KIT = Object.freeze({ campfire: 1 });
if (!saveStart.save) for (const [type, amount] of Object.entries(TESTING_START_KIT)) addInventoryItem(type, amount);
autosave.update(); // what is already loaded goes back now, before the first frame
if (import.meta.env.DEV) window.__save = { autosave, store: saveStore, start: saveStart.note, world: { THREE, renderer, scene, camera, rig, campfires, tools: hands.tools, backpack, mining, dayNight } }; // dev only: for the save's browser test
document.addEventListener('visibilitychange', () => { if (document.hidden) autosave.flush(); });
window.addEventListener('pagehide', () => autosave.flush());

const survivorMenu = createSurvivorMenu({
  scene, renderer, states: hands.states, tools: hands.tools, backpack, onPlace: placeFromMenu,
  onToggle(open) {
    keys.clear(); touchMove = { x: 0, z: 0 }; touchMoveId = null; touchLookId = null; mouseDragging = false;
    velocity.set(0, 0, 0); footsteps.reset(); movePad.firstElementChild.style.transform = '';
    if (!open) autosave.flush(); // you have just crafted or packed something
    touchControls.hidden = open || !playing || !touchDevice || renderer.xr.isPresenting;
    if (open) placement.cancel();
    if (open) document.exitPointerLock?.();
    else if (playing && !touchDevice && !renderer.xr.isPresenting) {
      // A close click/key is a user gesture; drag-to-look remains a fallback.
      canvas.requestPointerLock?.()?.catch(() => {});
    }
  },
});
inventoryToggle.addEventListener('click', () => survivorMenu.toggle());

function clearInput() {
  keys.clear(); touchMove = { x: 0, z: 0 }; touchMoveId = null; touchLookId = null; mouseDragging = false;
  velocity.set(0, 0, 0); jumpHeld = false;
  crouchOffset = 0; crouchActive = false; crouchButtonDown = false;
  sprintActive = false; sprintButtonDown = false;
  footsteps.reset(); movePad.firstElementChild.style.transform = '';
}
function setPlaying(value) {
  playing = value;
  if (!value) { placement.cancel(); survivorMenu.setOpen(false); }
  inventoryToggle.hidden = !value || renderer.xr.isPresenting;
  welcome.hidden = value; menu.hidden = !value;
  touchControls.hidden = !value || !touchDevice || renderer.xr.isPresenting;
  if (!value) clearInput();
}
function look(dx, dy) {
  if (!playing || survivorMenu.isOpen() || renderer.xr.isPresenting) return;
  rig.rotation.y -= dx * 0.0024;
  camera.rotation.x = clamp(camera.rotation.x - dy * 0.0024, -1.40, 1.40);
}
explore.addEventListener('click', async () => {
  setPlaying(true);
  if (!touchDevice) {
    try { await canvas.requestPointerLock(); }
    catch { /* Drag-to-look and keyboard turning remain available. */ }
  }
});
menu.addEventListener('click', () => { document.exitPointerLock?.(); setPlaying(false); });
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && !touchDevice && !renderer.xr.isPresenting && !survivorMenu.isOpen()) setPlaying(false);
});
window.addEventListener('keydown', e => {
  if (e.code === 'KeyT' && !e.repeat && playing && !renderer.xr.isPresenting) { toggleTurbo(); return; }
  if (placement.isActive() && e.code === 'Enter' && !e.repeat && playing && !renderer.xr.isPresenting) { e.preventDefault(); placement.confirm(); return; }
  if (playing && !renderer.xr.isPresenting && (e.code === 'KeyY' || (e.code === 'Escape' && survivorMenu.isOpen()))) {
    e.preventDefault(); if (!e.repeat) survivorMenu.toggle(); return;
  }
  if (e.code === 'Escape' && !renderer.xr.isPresenting) setPlaying(false);
  if (!playing || survivorMenu.isOpen() || renderer.xr.isPresenting) return;
  if (['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight','Space'].includes(e.code)) {
    e.preventDefault(); keys.add(e.code);
  }
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement === canvas) look(e.movementX, e.movementY);
});
canvas.addEventListener('pointerdown', e => {
  if (!playing || survivorMenu.isOpen() || renderer.xr.isPresenting) return;
  if (placement.isActive() && e.pointerType !== 'touch') { if (e.button === 0) placement.confirm(); return; }
  if (e.pointerType === 'touch') {
    if (e.clientX < innerWidth * 0.40 || touchLookId !== null) return;
    touchLookId = e.pointerId;
  } else mouseDragging = true;
  previousPointer = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (document.pointerLockElement === canvas) return;
  if ((e.pointerType === 'touch' && e.pointerId !== touchLookId) || (e.pointerType !== 'touch' && !mouseDragging)) return;
  look(e.clientX - previousPointer.x, e.clientY - previousPointer.y);
  previousPointer = { x: e.clientX, y: e.clientY };
});
// Touch: a quick tap with no drag places the ghost (a drag is looking round).
let tap = null;
canvas.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') tap = { id: e.pointerId, x: e.clientX, y: e.clientY, time: performance.now() }; });
canvas.addEventListener('pointerup', e => {
  if (tap && tap.id === e.pointerId && placement.isActive() && performance.now() - tap.time < 350 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 14) placement.confirm();
  if (tap && tap.id === e.pointerId) tap = null;
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(event, e => {
  if (touchLookId === e.pointerId) touchLookId = null;
  mouseDragging = false;
});
function updatePad(e) {
  const rect = movePad.getBoundingClientRect();
  touchMove = stickVector((e.clientX - rect.left - rect.width / 2) / 44, (e.clientY - rect.top - rect.height / 2) / 44, 0.08);
  movePad.firstElementChild.style.transform = `translate(${touchMove.x * 34}px,${touchMove.z * 34}px)`;
}
movePad.addEventListener('pointerdown', e => {
  if (touchMoveId !== null) return;
  touchMoveId = e.pointerId; movePad.setPointerCapture(e.pointerId); updatePad(e);
});
movePad.addEventListener('pointermove', e => { if (e.pointerId === touchMoveId) updatePad(e); });
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) movePad.addEventListener(event, e => {
  if (e.pointerId !== touchMoveId) return;
  touchMoveId = null; touchMove = { x: 0, z: 0 }; movePad.firstElementChild.style.transform = '';
});

enterVR.addEventListener('click', async () => {
  if (renderer.xr.isPresenting) return;
  enterVR.disabled = true; status.textContent = '';
  let session;
  try {
    session = await navigator.xr.requestSession('immersive-vr', {
      requiredFeatures: ['local-floor'], optionalFeatures: ['bounded-floor'],
    });
    await renderer.xr.setSession(session);
    renderer.xr.setFoveation(0.65);
    if (session.supportedFrameRates && session.updateTargetFrameRate) {
      const rates = Array.from(session.supportedFrameRates);
      const preferred = rates.includes(72) ? 72 : rates.find(rate => rate >= 72);
      if (preferred) await session.updateTargetFrameRate(preferred).catch(() => {});
    }
  } catch (error) {
    if (session) await session.end().catch(() => {});
    setPlaying(false);
    status.textContent = error.name === 'NotAllowedError' ? 'VR access was declined. Use Enter VR to try again.' : 'Could not enter VR. Open this page directly in Meta Quest Browser and try again.';
  } finally { enterVR.disabled = false; }
});
renderer.xr.addEventListener('sessionstart', () => {
  document.exitPointerLock?.(); clearInput();

  // Match dumbgame's XR start state: no hidden world yaw or desktop camera transform.
  footprints.reset();
  groundY = groundAt(startPoint.x, startPoint.z);
  rig.position.set(startPoint.x, groundY, startPoint.z);
  rig.rotation.set(0, startPoint.yaw, 0);
  rig.scale.set(1, 1, 1);
  camera.position.set(0, 0, 0);
  camera.quaternion.identity();

  jumpHeight = 0; jumpVelocity = 0; jumpHeld = false; fall.active = false; fall.speed = 0;
  crouchOffset = 0; crouchActive = false; crouchButtonDown = false;
  sprintActive = false; sprintButtonDown = false;
  seatedOffset = 0;
  seatedCalibrationPending = Boolean(seatedMode.checked);

  setPlaying(true); menu.hidden = true; touchControls.hidden = true;
  const session = renderer.xr.getSession();
  session.addEventListener('visibilitychange', () => {
    clearInput();
    if (session.visibilityState !== 'visible') autosave.flush(); // the headset came off
  });
});
renderer.xr.addEventListener('sessionend', () => {
  autosave.flush();
  if (savingEnabled) startPoint = { x: head.x, z: head.z, yaw: rig.rotation.y }; // the next session picks up from here, not from the start
  groundY = groundAt(head.x, head.z);
  rig.position.set(head.x, groundY, head.z);
  rig.rotation.y = onIsland ? ISLAND_START.yaw : -Math.atan2(WATER.x, -WATER.z);
  camera.position.set(0, 1.68, 0); camera.rotation.set(-0.045, 0, 0);
  camera.scale.set(1, 1, 1);
  camera.fov = 72; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  seatedOffset = 0; seatedCalibrationPending = false;
  jumpHeight = 0; jumpVelocity = 0; jumpHeld = false;
  crouchOffset = 0; crouchActive = false; crouchButtonDown = false;
  sprintActive = false; sprintButtonDown = false;
  clearInput(); setPlaying(false); lastTime = 0;
});

function readInput() {
  if (survivorMenu.isOpen()) return { x: 0, z: 0, turn: 0, fast: false, sprintPressed: false, jump: false, crouchPressed: false };
  if (renderer.xr.isPresenting) {
    const session = renderer.xr.getSession();
    if (session.visibilityState !== 'visible') return { x: 0, z: 0, turn: 0, fast: false, sprintPressed: false, jump: false, crouchPressed: false };
    let x = 0, z = 0, turn = 0, jump = false, crouchPressed = false, sprintPressed = false;
    for (const source of session.inputSources) {
      const pad = source.gamepad;
      if (!pad) continue;
      const axes = pad.axes || [];
      // Same thumbstick selection and per-axis deadzone used by dumbgame.
      const axis = axes.length >= 4 ? axes.length - 2 : 0;
      if (source.handedness === 'left') {
        if (axes.length >= 2) {
          x = stickAxis(axes[axis] || 0, 0.15);
          z = stickAxis(axes[axis + 1] || 0, 0.15);
        }
        // L3 toggles sprint; squeeze/grip is reserved for physical grabbing.
        sprintPressed = Boolean(pad.buttons[LEFT_STICK_BUTTON]?.pressed);
      }
      if (source.handedness === 'right') {
        if (axes.length >= 2) turn = stickAxis(axes[axis] || 0, 0.15);
        // xr-standard button 3 is the right thumbstick click on Quest Touch controllers.
        crouchPressed = Boolean(pad.buttons[RIGHT_STICK_BUTTON]?.pressed);
        // xr-standard button 4 is A on the right Quest Touch controller.
        jump = Boolean(pad.buttons[4]?.pressed);
      }
    }
    return { x, z, turn, fast: false, sprintPressed, jump, crouchPressed };
  }
  const x = Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + touchMove.x;
  const z = Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp')) + touchMove.z;
  const length = Math.max(1, Math.hypot(x, z));
  return { x: x / length, z: z / length,
    turn: Number(keys.has('ArrowRight') || keys.has('KeyE')) - Number(keys.has('ArrowLeft') || keys.has('KeyQ')),
    fast: keys.has('ShiftLeft') || keys.has('ShiftRight'), sprintPressed: false,
    jump: keys.has('Space'), crouchPressed: false };
}

function frame(time) {
  const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
  lastTime = time;
  autosave.update(); // first, so what a save puts back (where you stand, the tools) is in place before anything reads it
  dayNight.update(dt);
  glowFruit.update(dt);
  campfires.update(dt, renderer.xr.isPresenting ? renderer.xr.getCamera() : camera);
  if (devCamp && campfires.ready) {
    // The flattest spot within a few metres of the spawn point, so the ring sits level.
    let cx = SPAWN.x + 4, cz = SPAWN.z - 4, flattest = Infinity;
    for (let dx = -14; dx <= 14; dx += 2) {
      for (let dz = -14; dz <= 14; dz += 2) {
        const { slope } = campfireSite(SPAWN.x + dx, SPAWN.z + dz, field.sample);
        if (slope < flattest) { flattest = slope; cx = SPAWN.x + dx; cz = SPAWN.z + dz; }
      }
    }
    campfires.place(cx, cz, { lit: devCamp === 'lit' });
    const away = Number(new URLSearchParams(location.search).get('campd')) || 2.5; // metres from the fire
    const ox = away * 0.77, oz = away * 0.64;
    const px = cx + ox, pz = cz + oz, gy = field.sample(px, pz);
    rig.position.set(px, gy, pz); groundY = gy;
    rig.rotation.y = Math.atan2(ox, oz);
    camera.rotation.x = Math.atan2(field.sample(cx, cz) + 0.3 - (gy + STANDING_EYE_HEIGHT), away);
    devCamp = null;
  }
  rig.updateMatrixWorld(true);
  if (renderer.xr.isPresenting) renderer.xr.updateCamera(camera);
  // Resource storage compares controller and headset WORLD positions. Refresh
  // the XR camera first; its raw pose at frame start is reference-space local.
  hands.update(dt);
  placement.update(dt);
  if (import.meta.env.DEV && devThrows && devThrows()) devThrows = null;
  backpack.update(dt); // after the hands, so a tool or stone in reach is grabbed first
  const activeCamera = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  activeCamera.getWorldPosition(head);
  // One wind clock for the sand and the swaying plants, so their gusts line up.
  windTime.value = devWindTime ?? time * 0.001;
  const viewHeight = renderer.xr.isPresenting ? WIND_SAND.vrViewHeight : renderer.getDrawingBufferSize(drawingSize).y;
  windSand.update(windTime.value, head, viewHeight);
  alienBirds.update(dt, head);
  glowGarden.update(head, dt);
  skyScenery.updateFlora(head, dt, viewHeight);
  plantPush.update(head);
  weaponHits.update(dt);
  mining.update(dt, head);
  crystalMotes.update(dt, viewHeight);
  duneStinger.update(dt, head);
  sandPuffs.update(dt);
  footprints.update(time * 0.001);
  giantBones.update(head);
  colossus.update(dt, head);
  if (devBird && alienBirds.ready) {
    const params = devBirdParams;
    const spot = Number(params.get('birdd')) || (devBird === 'perch' ? 9 : 20);
    const ahead = { x: -Math.sin(rig.rotation.y), z: -Math.cos(rig.rotation.y) };
    const x = head.x + ahead.x * spot, z = head.z + ahead.z * spot;
    if (devBird === 'perch') {
      // side on to the camera, so the whole bird shows
      alienBirds.debug.perch({ x, z, yaw: Math.atan2(ahead.x, ahead.z) + Math.PI / 2 });
    } else if (devBird === 'fly') {
      alienBirds.debug.fly({ x, z, altitude: Number(params.get('birdalt')) || 12, radius: 14, t: Number(params.get('birdt')) || 0 });
    } else if (devBird === 'flare') {
      // coming in to land: stand `spot` metres to one side of the bird (the dry side) and look at it
      const landing = alienBirds.debug.visit({ t: 'flare' });
      const bird = landing ? alienBirds.list()[0] : null;
      if (bird) {
        const along = Math.atan2(landing.x - bird.x, landing.z - bird.z);
        let side = 1, best = -1;
        for (const s of [1, -1]) {
          const d = Math.hypot(bird.x + s * Math.cos(along) * spot - WATER.x, bird.z - s * Math.sin(along) * spot - WATER.z);
          if (d > best) { best = d; side = s; }
        }
        const px = bird.x + side * Math.cos(along) * spot, pz = bird.z - side * Math.sin(along) * spot;
        const gy = field.sample(px, pz);
        rig.position.set(px, gy, pz); groundY = gy;
        const dx = bird.x - px, dz = bird.z - pz;
        rig.rotation.y = Math.atan2(-dx, -dz);
        camera.rotation.x = Math.atan2(bird.y - (gy + STANDING_EYE_HEIGHT), Math.hypot(dx, dz));
      }
    }
    if (params.get('birdfreeze') !== '0') alienBirds.debug.freeze(true);
    devBird = null;
  }
  survivorMenu.update();

  // local-floor still reports the real headset height while sitting. In seated mode,
  // measure it once at VR start and raise the entire player rig to a normal eye height.
  if (renderer.xr.isPresenting && seatedCalibrationPending) {
    const physicalEyeHeight = head.y - rig.position.y;
    if (physicalEyeHeight > 0.65 && physicalEyeHeight < 2.2) {
      seatedOffset = clamp(STANDING_EYE_HEIGHT - physicalEyeHeight, 0, 0.9);
      seatedCalibrationPending = false;
      rig.position.y += seatedOffset;
      head.y += seatedOffset;
    }
  }

  if (playing) {
    const input = readInput();
    if (renderer.xr.isPresenting) { // both thumbstick clicks at once toggle ultra-fast movement (src/turbo.js)
      const clicks = turboChord.apply(input.sprintPressed, input.crouchPressed, time);
      input.sprintPressed = clicks.sprint; input.crouchPressed = clicks.crouch;
      if (clicks.toggled) toggleTurbo();
    }

    if (renderer.xr.isPresenting) {
      if (input.sprintPressed && !sprintButtonDown) sprintActive = !sprintActive;
      sprintButtonDown = input.sprintPressed;
    } else {
      sprintButtonDown = false;
    }

    // Right thumbstick click toggles artificial crouch; horizontal stick motion still smooth-turns.
    if (input.crouchPressed && !crouchButtonDown) crouchActive = !crouchActive;
    crouchButtonDown = input.crouchPressed;
    const desiredCrouchOffset = renderer.xr.isPresenting && crouchActive ? -CROUCH_DEPTH : 0;
    crouchOffset += (desiredCrouchOffset - crouchOffset) * (1 - Math.exp(-dt * CROUCH_RESPONSE));

    // Jump is edge-triggered so holding A cannot bunny-hop on every landing.
    if (input.jump && !jumpHeld && jumpHeight <= 0.001) jumpVelocity = JUMP_SPEED;
    jumpHeld = input.jump;
    if (jumpVelocity !== 0 || jumpHeight > 0) {
      jumpVelocity -= GRAVITY * dt;
      jumpHeight += jumpVelocity * dt;
      if (jumpHeight <= 0) { jumpHeight = 0; jumpVelocity = 0; }
    }

    const turn = -input.turn * TURN_SPEED * dt;
    if (turn) {
      // Same smooth-turn model as dumbgame: rotate the rig around the physical head.
      const rotated = pivotRig(rig.position.x, rig.position.z, head.x, head.z, turn);
      rig.position.x = rotated.x; rig.position.z = rotated.z; rig.rotation.y += turn;
    }

    if (renderer.xr.isPresenting) {
      // Movement follows the virtual body/turn yaw only. Head looking never steers locomotion.
      movementForward.set(-Math.sin(rig.rotation.y), 0, -Math.cos(rig.rotation.y));
      lastDirection.copy(movementForward);
    } else {
      activeCamera.getWorldDirection(direction);
      direction.y = 0;
      if (direction.lengthSq() < 0.001) direction.copy(lastDirection);
      direction.normalize();
      movementForward.copy(direction);
      lastDirection.copy(direction);
    }

    right.crossVectors(movementForward, up).normalize();
    target.copy(right).multiplyScalar(input.x).addScaledVector(movementForward, -input.z);
    if (target.lengthSq() > 1) target.normalize();
    const carrySpeedMultiplier = getCarrySpeedMultiplier();
    // Out of stamina cancels the sprint toggle; it returns once stamina has recovered a little.
    if (sprintActive && !canSprint()) sprintActive = false;
    const sprinting = (renderer.xr.isPresenting ? sprintActive : input.fast) && canSprint();
    target.multiplyScalar((sprinting ? FAST_SPEED : WALK_SPEED) * carrySpeedMultiplier * (turboActive ? TURBO.multiplier : 1));
    velocity.lerp(target, 1 - Math.exp(-dt * (target.lengthSq() ? 18 : 28)));
    const dx = velocity.x * dt, dz = velocity.z * dt;
    const nextX = clamp(head.x + dx, WALK.minX, WALK.maxX), nextZ = clamp(head.z + dz, WALK.minZ, WALK.maxZ);
    const movedX = nextX - head.x, movedZ = nextZ - head.z;
    rig.position.x += movedX; rig.position.z += movedZ;
    head.x = nextX; head.z = nextZ;
    // rocks are solid: walk out of any you have walked into
    const clear = onIsland ? null : mining.pushOut(head.x, head.z); // (the rocks are in the desert, 250 m below the island)
    if (clear) {
      rig.position.x += clear[0] - head.x; rig.position.z += clear[1] - head.z;
      head.x = clear[0]; head.z = clear[1];
    }

    // Smooth the terrain-following base separately from seated height, crouch and jump height.
    if (onIsland && skyIsland.groundHeight(head.x, head.z) === null) onIsland = false; // walked off the edge: the desert's ground is 250 m down
    const ground = groundAt(head.x, head.z);
    const falling = stepFall(fall, groundY, ground, dt); // the ground dropped away (the island's edge, a cliff): fall, then land
    if (falling === null) groundY += (ground - groundY) * (1 - Math.exp(-dt * 24));
    else groundY = falling;
    if (fall.landed) {
      const hurt = fallDamage(fall.landed);
      if (hurt > 0) { damagePlayer(hurt); for (const state of hands.states) pulseHaptics(state, 1, 250); }
    }
    rig.position.y = groundY + seatedOffset + crouchOffset + jumpHeight;

    // Survival: slow drain, sprint costs stamina, wading into the pond refills water.
    const wading = isInPond(head.x, head.z, ground);
    updateSurvival(dt, { sprinting: sprinting && Math.hypot(velocity.x, velocity.z) > 0.6, inWater: wading });
    if (wading && getSurvivalStats().water < 99.5) {
      drinkTick -= dt;
      if (drinkTick <= 0) {
        for (const state of hands.states) pulseHaptics(state, 0.12, 25);
        drinkTick = 0.7;
      }
    } else drinkTick = 0;

    footsteps.update({
      distance: Math.hypot(movedX, movedZ),
      speed: Math.hypot(velocity.x, velocity.z),
      grounded: jumpHeight <= 0.001,
      active: true
    });
    footprints.walk(head.x, head.z, { onGround: jumpHeight <= 0.001, speed: Math.hypot(velocity.x, velocity.z) });
  }
  if (time - lodTime > 100) { terrain.update(head.x, head.z, velocity.length()); skyScenery.update(head.x, head.z, head.y); farPickups.update(head.x, head.z); lodTime = time; }
  materials.water.uniforms.uTime.value = time * 0.001;
  renderer.render(scene, camera);
  if (import.meta.env.DEV && time - telemetryTime > 1000) {
    canvas.dataset.position = JSON.stringify({ x: +head.x.toFixed(2), z: +head.z.toFixed(2), ground: +groundAt(head.x, head.z).toFixed(2), onIsland, yaw: +rig.rotation.y.toFixed(3) });
    canvas.dataset.render = JSON.stringify({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures });
    canvas.dataset.birds = JSON.stringify(alienBirds.list());
    canvas.dataset.stinger = JSON.stringify(duneStinger.list());
    canvas.dataset.bones = JSON.stringify(giantBones.list());
    canvas.dataset.colossus = JSON.stringify(colossus.list());
    canvas.dataset.save = JSON.stringify(autosave.status());
    canvas.dataset.finds = JSON.stringify({ stats: mining.stats(), near: mining.list(head, 60) });
    canvas.dataset.pack = JSON.stringify(backpack.list());
    canvas.dataset.campfires = JSON.stringify(campfires.list().map(fire => ({ x: +fire.x.toFixed(1), z: +fire.z.toFixed(1), lit: fire.lit })));
    canvas.dataset.survival = JSON.stringify(Object.fromEntries(Object.entries(getSurvivalStats()).map(([k, v]) => [k, +v.toFixed(1)])));
    canvas.dataset.inventory = JSON.stringify({ weight: getInventoryWeight(), capacity: getCarryCapacity(), speedMultiplier: getCarrySpeedMultiplier() });
    telemetryTime = time;
  }
}
window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});
canvas.addEventListener('webglcontextlost', e => {
  e.preventDefault(); renderer.setAnimationLoop(null); setPlaying(false);
  status.textContent = 'The graphics session was interrupted. Reload the page to return to the desert.';
});
canvas.addEventListener('webglcontextrestored', () => location.reload());
renderer.setAnimationLoop(frame);
explore.disabled = false; status.textContent = '';
try {
  const supported = !!navigator.xr && await navigator.xr.isSessionSupported('immersive-vr');
  enterVR.disabled = !supported; enterVR.textContent = supported ? 'Enter VR' : 'VR unavailable';
} catch { enterVR.textContent = 'VR unavailable'; }
