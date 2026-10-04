import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { HERO_TREE, SPAWN, basinRadius, isInPond } from './world.js';
import { createStingerPoser } from './stinger-pose.js';
import { createStinger } from './stinger-brain.js';
import { createShadowTexture, pickLod } from './alien-bird.js';
import { exposureGlow } from './glow.js';

// The dune stinger in the game: one of them lives in the dunes to the right of where you start. It stands about, wanders
// slowly and, when you come near, stops to watch you with its tail curled up. That is all it does: it never chases you and
// it cannot hurt you (what a stinger does to a player is not decided yet). The behaviour is in src/stinger-brain.js, the
// poses in src/stinger-pose.js, the model in tools/dune-stinger/ (v2). This file makes the scene objects, puts the model on
// the ground (tilted to the slope), picks the level of detail, keeps the glowing eyes and sting bright at night, and draws
// a soft shadow under it.

const BASE = import.meta.env?.BASE_URL ?? '/';

export const DUNE_STINGER = Object.freeze({
  files: [0, 1, 2].map(level => `${BASE}models/creatures/dune_stinger_lod${level}.glb`),
  scale: 2.5, // the model is a dog-sized 1.5 m long; at 2.5 it is a 3.7 m predator whose tail stands about 1.5 m high
  lodDistances: [0, 28, 80], // metres at which each model takes over from the one before
  lodHysteresis: 0.08,
  home: Object.freeze({ x: SPAWN.x + 46, z: SPAWN.z - 6 }), // in the dunes to the right of the start (facing the pond)
  hideBeyond: 280, // metres: past this nothing is drawn
  // How bright the glowing eyes and sting look (displayed brightness: the tone-mapping exposure is divided out)
  glow: Object.freeze({ day: 0.9, night: 1.1 }),
  feet: Object.freeze({ half: 0.55, side: 0.33 }), // metres at scale 1 from the middle to where the ground is read: ahead/behind and to the sides
  settle: 9, // per second: how quickly its height and tilt follow the ground
  shadow: Object.freeze({ opacity: 0.4, lift: 0.04, length: 1.25, width: 0.95 }), // metres at scale 1 (half of the shadow's size)
});

// Keeps it out of the pond, off the shore and clear of the hero tree
export function isBlocked(x, z) {
  return basinRadius(x, z) < 1.75 || Math.hypot(x - HERO_TREE.x, z - HERO_TREE.z) < HERO_TREE.clearRadius;
}

export function createDuneStinger({ scene, renderer = null, camera = null, field, getExposure = () => 1, rng = Math.random, onError = () => {} }) {
  const cfg = DUNE_STINGER;
  const scale = cfg.scale;
  const world = { groundAt: field.sample, blocked: (x, z) => isBlocked(x, z) || isInPond(x, z, field.sample(x, z)) };
  const brain = createStinger({ world, rng, home: cfg.home, scale });
  const state = brain.state;
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
    const intensity = exposureGlow(getExposure(), cfg.glow);
    if (Math.abs(intensity - appliedGlow) > 0.01 * intensity) {
      for (const material of glowMaterials) material.emissiveIntensity = intensity;
      appliedGlow = intensity;
    }
  }

  function update(dt, head) {
    if (!ready) return;
    brain.update(dt, head);
    const distance = Math.hypot(head.x - state.x, head.z - state.z);
    const visible = distance < cfg.hideBeyond;
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
    holder.position.set(state.x, height, state.z);
    holder.rotation.set(pitch, state.yaw, roll);

    const head3 = Math.hypot(distance, head.y - height);
    const next = pickLod(head3, lod, cfg.lodDistances, cfg.lodHysteresis);
    if (next !== lod) { levels[lod].root.visible = false; levels[next].root.visible = true; lod = next; }
    levels[lod].poser.apply(state.pose, state.time);
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
  }

  const loader = new GLTFLoader();
  Promise.all(cfg.files.map(url => loader.loadAsync(url)))
    .then(gltfs => {
      for (const gltf of gltfs) {
        const root = clone(gltf.scene);
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
    get ready() { return ready; },
    brain,
    list() {
      return ready ? [{ mode: state.mode, x: +state.x.toFixed(1), z: +state.z.toFixed(1), yaw: +state.yaw.toFixed(2), speed: +state.speed.toFixed(2), lod }] : [];
    },
  };
}
