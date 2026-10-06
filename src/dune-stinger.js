import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { HERO_TREE, SPAWN, basinRadius, isInPond } from './world.js';
import { createStingerPoser, plantedFeet, LEG_NAMES } from './stinger-pose.js';
import { createStinger, BRAIN } from './stinger-brain.js';
import { createBurstPool } from './bursts.js';
import { createShadowTexture, pickLod } from './alien-bird.js';
import { exposureGlow } from './glow.js';
import { skyLight } from './sky-environment.js';

// The dune stinger in the game: one of them lives in the dunes to the right of where you start. It wanders slowly; when it
// sees you it stalks you, rears its tail back (the warning, with its eyes flaring) and strikes where you were standing. It
// can be hurt by a spear or an axe moving fast enough (src/weapon-hits.js), backs away when hit and dies after a few good
// blows. The behaviour is in src/stinger-brain.js, the poses in src/stinger-pose.js, the model in tools/dune-stinger/v3/.
// This file makes the scene objects, puts the model on the ground (tilted to the slope), picks the level of detail, keeps the
// glowing eyes and sting bright at night, draws a soft shadow, and answers the question "is this point inside it?" for hits. It also
// does the fight's dust and chips: sand kicked up by the lunge, a ring of dust where the sting lands, chitin chips when a blow connects,
// a cloud when it falls, and then the dead body slowly sinks into the dune (the terrain hides it) until it is gone.

const BASE = import.meta.env?.BASE_URL ?? '/';

export const DUNE_STINGER = Object.freeze({
  files: [0, 1, 2].map(level => `${BASE}models/creatures/dune_stinger_lod${level}.glb`),
  scale: 2.5, // the body and claws are 1.5 m long in the model; at 2.5 it is a 3.8 m predator whose tail arches about 3.5 m high
  lodDistances: [0, 28, 80], // metres at which each model takes over from the one before
  lodHysteresis: 0.08,
  home: Object.freeze({ x: SPAWN.x + 46, z: SPAWN.z - 6 }), // in the dunes to the right of the start (facing the pond)
  hideBeyond: 280, // metres: past this nothing is drawn
  // How bright the glowing eyes and sting look (displayed brightness: the tone-mapping exposure is divided out)
  glow: Object.freeze({ day: 0.5, night: 0.4 }), // the model's cyan clips to white above about 0.5 displayed brightness; the flare in the windup is what takes it to white
  feet: Object.freeze({ half: 0.42, side: 0.55 }), // metres at scale 1 from the middle to where the ground is read: ahead/behind and to the sides (the toes stand at 0.48 to 0.61 out and 0.46 ahead to 0.36 behind)
  settle: 9, // per second: how quickly its height and tilt follow the ground
  shadow: Object.freeze({ opacity: 0.4, lift: 0.04, length: 1.05, width: 0.78 }), // metres at scale 1 (half of the shadow's size)
  flare: 1.8, // how much brighter the eyes and sting get in the windup and the strike (a multiple of the usual glow)
  // Where a blow can land: a capsule from one bone to another, radius in metres at scale 1. The end can also be a point [bone, x, y, z] in a
  // bone's own space (the sting's point, a claw's tip: every bone rests with no turn, so those are plain offsets from the bone).
  hitParts: Object.freeze([
    ['Head', 'Body', 0.25], ['Body', 'Seg03', 0.28], ['Seg03', 'Tail1', 0.24],
    ['Tail1', 'Tail2', 0.13], ['Tail2', 'Tail3', 0.125], ['Tail3', 'Tail4', 0.115], ['Tail4', 'Tail5', 0.105], ['Tail5', 'Stinger', 0.10],
    ['Stinger', ['Stinger', 0, -0.25, 0.26], 0.10],
    ['Claw_L_Fore', 'Claw_L_Finger', 0.16], ['Claw_L_Finger', ['Claw_L_Finger', -0.06, 0, 0.2], 0.13],
    ['Claw_R_Fore', 'Claw_R_Finger', 0.14], ['Claw_R_Finger', ['Claw_R_Finger', 0.05, 0, 0.17], 0.11],
  ]),
  // After it dies the body sinks into the sand: it starts `start` seconds after the death and is under (`depth` metres at scale 1) a little before it lingers out
  sink: Object.freeze({ start: 6, depth: 0.7, finish: BRAIN.deadLinger - 1.5 }),
  rise: 2.6, // seconds a new one takes to climb out of the sand at its home
  // The fight's effects. Sizes are multiples of the puffs' own sizes (the stinger is big, so about half its scale).
  fx: Object.freeze({
    size: 0.5,
    chitin: Object.freeze([0x1a0c06, 0x33180a, 0x52280f, 0x7d4a22, 0xa57a46]), // chips knocked off by a blow
    trickleEvery: 1.1, // seconds between the small clouds while it sinks
  }),
  broadRange: 7, // metres: a blow further than this from the middle of its body cannot touch it, so the balls are not worked out
});

// How far below the dune a body has sunk, in metres at scale 1: nothing until `start` seconds after it died, then a smooth slide down to
// `depth` by `finish`. And how far a new one still has to climb, `left` seconds before it is out of the sand.
const smooth01 = t => t * t * (3 - 2 * t);
export function sunkDepth(deadFor, sink = DUNE_STINGER.sink) {
  return smooth01(Math.min(1, Math.max(0, (deadFor - sink.start) / (sink.finish - sink.start)))) * sink.depth;
}
export function buriedWhileRising(left, rise = DUNE_STINGER.rise, sink = DUNE_STINGER.sink) {
  return smooth01(Math.min(1, Math.max(0, left / rise))) * sink.depth;
}

// Keeps it out of the pond, off the shore and clear of the hero tree
export function isBlocked(x, z) {
  return basinRadius(x, z) < 1.75 || Math.hypot(x - HERO_TREE.x, z - HERO_TREE.z) < HERO_TREE.clearRadius;
}

// True when no dune rises above the straight line between two points (it samples the ground every couple of metres, and ignores
// the first and last few so the ground it stands on does not hide it).
export function lineOfSight(groundAt, ax, ay, az, bx, by, bz, margin = 0.25, skip = 2.5) {
  const length = Math.hypot(bx - ax, bz - az);
  if (length < 2 * skip) return true;
  const steps = Math.ceil(length / 2.5);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (t * length < skip || (1 - t) * length < skip) continue;
    if (groundAt(ax + (bx - ax) * t, az + (bz - az) * t) > ay + (by - ay) * t - margin) return false;
  }
  return true;
}

export function createDuneStinger({
  scene, renderer = null, camera = null, field, getExposure = () => 1, rng = Math.random, onError = () => {}, onPlayerHit = () => {}, puffs = null, prints = null,
}) {
  const cfg = DUNE_STINGER;
  const scale = cfg.scale;
  const world = {
    groundAt: field.sample,
    blocked: (x, z) => isBlocked(x, z) || isInPond(x, z, field.sample(x, z)),
    canSee: (ax, ay, az, bx, by, bz) => lineOfSight(field.sample, ax, ay, az, bx, by, bz),
  };
  const lastHit = { x: 0, y: 0, z: 0, at: -10 }; // where the latest blow landed (hitTest notes it, hurt uses it), for the chips
  const chips = createBurstPool({
    capacity: 40, heightAt: field.sample,
    material: new THREE.MeshStandardMaterial({ name: 'Chitin chips', roughness: 0.5, metalness: 0.15 }),
  });
  scene.add(chips.mesh);
  const fxSize = cfg.fx.size * scale / 1.25; // the puffs are made for a 1.25 m body; this one is bigger
  const brain = createStinger({
    world, rng, home: cfg.home, scale,
    onStrike: strike => {
      puffs?.impact(strike.x, strike.z, { size: fxSize, strength: strike.hit ? 1.3 : 1 });
      if (strike.hit) onPlayerHit(strike);
    },
    onHurt: () => {
      const fresh = brain.state.time - lastHit.at < 0.25;
      const x = fresh ? lastHit.x : brain.state.x;
      const y = fresh ? lastHit.y : height + 0.5 * scale;
      const z = fresh ? lastHit.z : brain.state.z;
      chips.emit(x, y, z, 9, { speed: 3.2, colours: cfg.fx.chitin, sizes: [0.025, 0.06], lifetime: [0.8, 1.4], upward: 1.4 });
      puffs?.trickle(x, z, { size: fxSize * 0.8, count: 3, radius: 0.5 });
    },
    onDeath: () => {
      const { x, z } = brain.state;
      chips.emit(x, height + 0.5 * scale, z, 22, { speed: 4.2, colours: cfg.fx.chitin, sizes: [0.03, 0.08], lifetime: [1, 1.8], upward: 2 });
      puffs?.collapse(x, z, { size: fxSize });
    },
  });
  const state = brain.state;
  // the feet that came down this frame, for the footprints (eight at most; one per leg)
  const planted = LEG_NAMES.map(() => ({ x: 0, z: 0 }));
  let lastPhase = 0;
  const glowMaterials = [];
  const levels = [];
  const holder = new THREE.Group();
  holder.name = 'Dune stinger';
  holder.rotation.order = 'YXZ';
  holder.scale.setScalar(scale);
  let shadow = null;
  let lod = 0;
  let ready = false;
  let attached = false;
  let placed = false;
  let height = 0;
  let pitch = 0;
  let roll = 0;
  let appliedGlow = -1;
  let lastMode = 'idle';
  let trickleClock = 0;
  let emerge = 0; // seconds left of climbing out of the sand after a respawn
  let buried = 0; // metres the body is below the dune (a dead one sinks, a new one climbs out)
  let sunkPuffed = false;
  const up = new THREE.Vector3(0, 1, 0);
  const normal = new THREE.Vector3();
  const qTilt = new THREE.Quaternion();
  const qTurn = new THREE.Quaternion();

  function ground(x, z, yaw) {
    // Read the ground under the four corners of its stance, then fit a height and a tilt
    const f = cfg.feet.half * scale;
    const s = cfg.feet.side * scale;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const lx = Math.cos(yaw), lz = -Math.sin(yaw);
    const front = field.sample(x + fx * f, z + fz * f);
    const back = field.sample(x - fx * f, z - fz * f);
    const left = field.sample(x + lx * s, z + lz * s);
    const right = field.sample(x - lx * s, z - lz * s);
    return {
      y: (front + back + left + right) / 4,
      pitch: -Math.atan2(front - back, 2 * f),
      roll: Math.atan2(left - right, 2 * s),
    };
  }

  function updateGlow() {
    const flare = 1 + state.glow * cfg.flare;
    const alive = 1 - 0.85 * state.pose.dead;
    const intensity = exposureGlow(getExposure(), cfg.glow) * flare * alive;
    if (Math.abs(intensity - appliedGlow) > 0.01 * intensity) {
      for (const material of glowMaterials) material.emissiveIntensity = intensity;
      appliedGlow = intensity;
    }
  }

  // Is this point (a weapon's tip, say, with a radius for the weapon's own thickness) inside the stinger? Only worked out when it is close.
  // The ends of the capsules are read from the bones once per frame, the first time a blow asks.
  const parts = cfg.hitParts;
  const ends = new Float32Array(parts.length * 6);
  let endsStale = true;
  const endPoint = new THREE.Vector3();
  function readEnd(bones, spec, at) {
    if (typeof spec === 'string') endPoint.setFromMatrixPosition(bones[spec].matrixWorld);
    else endPoint.set(spec[1], spec[2], spec[3]).applyMatrix4(bones[spec[0]].matrixWorld);
    ends[at] = endPoint.x; ends[at + 1] = endPoint.y; ends[at + 2] = endPoint.z;
  }
  function refreshEnds() {
    holder.updateMatrixWorld(true);
    const { bones } = levels[lod].poser;
    for (let i = 0; i < parts.length; i++) {
      readEnd(bones, parts[i][0], i * 6);
      readEnd(bones, parts[i][1], i * 6 + 3);
    }
    endsStale = false;
  }
  function hitTest(point, radius = 0) {
    if (!ready || !attached || state.mode === 'dead') return false;
    const broad = cfg.broadRange * scale / 2.5 + radius;
    if ((point.x - state.x) ** 2 + (point.z - state.z) ** 2 > broad * broad || point.y < height - 0.5 || point.y > height + 4 * scale) return false;
    if (endsStale) refreshEnds();
    for (let i = 0; i < parts.length; i++) {
      const k = i * 6;
      const abx = ends[k + 3] - ends[k], aby = ends[k + 4] - ends[k + 1], abz = ends[k + 5] - ends[k + 2];
      const length2 = abx * abx + aby * aby + abz * abz;
      let t = length2 > 1e-9 ? ((point.x - ends[k]) * abx + (point.y - ends[k + 1]) * aby + (point.z - ends[k + 2]) * abz) / length2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = ends[k] + abx * t - point.x, dy = ends[k + 1] + aby * t - point.y, dz = ends[k + 2] + abz * t - point.z;
      const reach = parts[i][2] * scale + radius;
      if (dx * dx + dy * dy + dz * dz <= reach * reach) {
        lastHit.x = point.x; lastHit.y = point.y; lastHit.z = point.z; lastHit.at = state.time;
        return true;
      }
    }
    return false;
  }

  // A blow of `amount` health. Returns true if it landed.
  const hurt = amount => brain.hurt(amount);

  function update(dt, head) {
    chips.update(dt);
    if (!ready) return;
    brain.update(dt, head);
    const distance = Math.hypot(head.x - state.x, head.z - state.z);
    const visible = state.active && distance < cfg.hideBeyond;
    if (visible !== attached) {
      if (visible) scene.add(holder, shadow); else scene.remove(holder, shadow);
      attached = visible;
    }
    if (!visible) return;

    const g = ground(state.x, state.z, state.yaw);
    if (!placed) { height = g.y; pitch = g.pitch; roll = g.roll; placed = true; }
    else {
      const k = 1 - Math.exp(-cfg.settle * Math.max(dt, 0.001));
      height += (g.y - height) * k;
      pitch += (g.pitch - pitch) * k;
      roll += (g.roll - roll) * k;
    }
    // dust where it kicks off into a lunge; a dead body sinks, and a new one climbs out of the sand
    if (state.mode !== lastMode) {
      if (state.mode === 'strike') puffs?.kick(state.x, state.z, Math.sin(state.yaw), Math.cos(state.yaw), { size: fxSize, count: 7 });
      if (lastMode === 'dead') emerge = cfg.rise;
      lastMode = state.mode;
    }
    if (state.mode === 'dead') {
      const sinking = state.deadFor > cfg.sink.start && state.deadFor < cfg.sink.finish;
      buried = sunkDepth(state.deadFor) * scale;
      if (sinking) {
        trickleClock += dt;
        if (trickleClock > cfg.fx.trickleEvery) { trickleClock = 0; puffs?.trickle(state.x, state.z, { size: fxSize, count: 2, radius: 1.6 }); }
      }
      if (state.deadFor >= cfg.sink.finish && !sunkPuffed) { sunkPuffed = true; puffs?.collapse(state.x, state.z, { size: fxSize * 0.6 }); }
    } else {
      sunkPuffed = false;
      if (emerge > 0) {
        emerge = Math.max(0, emerge - dt);
        buried = buriedWhileRising(emerge) * scale;
        trickleClock += dt;
        if (trickleClock > cfg.fx.trickleEvery * 0.5) { trickleClock = 0; puffs?.trickle(state.x, state.z, { size: fxSize, count: 2, radius: 1.6 }); }
      } else buried = 0;
    }
    holder.position.set(state.x, height - buried, state.z);
    holder.rotation.set(pitch, state.yaw, roll);

    const head3 = Math.hypot(distance, head.y - height);
    const next = pickLod(head3, lod, cfg.lodDistances, cfg.lodHysteresis);
    if (next !== lod) { levels[lod].root.visible = false; levels[next].root.visible = true; lod = next; }
    levels[lod].poser.apply(state.pose, state.time);
    // footprints: every foot that came down while it walks leaves a small dent where it landed
    if (prints && state.mode !== 'dead' && state.pose.gait > 0.25 && buried === 0) {
      const count = plantedFeet(levels[lod].poser.rig, lastPhase, state.pose.phase, planted);
      const cos = Math.cos(state.yaw), sin = Math.sin(state.yaw);
      for (let i = 0; i < count; i++) {
        const foot = planted[i];
        // the model turned by the body's yaw and scaled, put where the body is
        prints.plant(state.x + (foot.x * cos + foot.z * sin) * scale, state.z + (-foot.x * sin + foot.z * cos) * scale, state.yaw, scale, foot.x >= 0 ? 1 : -1);
      }
    }
    lastPhase = state.pose.phase;
    endsStale = true;
    updateGlow();

    // a soft shadow under the body, lying on the slope
    const d = 1.5;
    normal.set(
      -(field.sample(state.x + d, state.z) - field.sample(state.x - d, state.z)) / (2 * d),
      1,
      -(field.sample(state.x, state.z + d) - field.sample(state.x, state.z - d)) / (2 * d),
    ).normalize();
    qTilt.setFromUnitVectors(up, normal);
    qTurn.setFromAxisAngle(up, state.yaw);
    shadow.quaternion.copy(qTilt).multiply(qTurn);
    shadow.position.set(state.x, field.sample(state.x, state.z) + cfg.shadow.lift, state.z);
    shadow.scale.set(cfg.shadow.width * scale * 2, 1, cfg.shadow.length * scale * 2);
    shadow.material.opacity = cfg.shadow.opacity * (1 - Math.min(1, buried / (cfg.sink.depth * scale)));
  }

  const loader = new GLTFLoader();
  Promise.all(cfg.files.map(url => loader.loadAsync(url)))
    .then(gltfs => {
      for (const gltf of gltfs) {
        const root = clone(gltf.scene);
        skyLight(root);
        root.traverse(object => {
          if (!object.isMesh) return;
          object.frustumCulled = false; // a skinned mesh's bounds are the rest pose; it bends well outside them
          if (object.material?.name === 'Glow' && !glowMaterials.includes(object.material)) glowMaterials.push(object.material);
        });
        const poser = createStingerPoser(root);
        if (!poser) throw new Error('A stinger model is missing a bone.');
        root.visible = levels.length === 0;
        holder.add(root);
        levels.push({ root, poser });
      }
      shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
        map: createShadowTexture(), color: 0x000000, transparent: true, depthWrite: false, opacity: cfg.shadow.opacity,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      }));
      shadow.name = 'Dune stinger shadow';
      shadow.renderOrder = 2;
      shadow.frustumCulled = false;
      // Compile the shaders now, with the stinger in the scene, so it does not stall a frame when it first comes into view.
      if (renderer && camera) {
        holder.position.set(0, -1000, 0);
        scene.add(holder);
        try { renderer.compile(scene, camera); } catch (error) { onError(`[Oasis stinger] shader warm-up failed: ${error.message}`); }
        scene.remove(holder);
      }
      ready = true;
    })
    .catch(error => onError(`[Oasis stinger] The dune stinger could not load: ${error.message}`));

  return {
    update,
    hitTest,
    hurt,
    get ready() { return ready; },
    get alive() { return state.mode !== 'dead'; },
    brain,
    list() {
      return ready ? [{ mode: state.mode, health: Math.round(state.health), x: +state.x.toFixed(1), y: +height.toFixed(2), z: +state.z.toFixed(1), yaw: +state.yaw.toFixed(2), speed: +state.speed.toFixed(2), lod }] : [];
    },
  };
}
