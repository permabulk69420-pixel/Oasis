import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SPAWN, WATER, HERO_TREE } from './world.js';
import { layoutFinds } from './desert-finds.js';
import { mulberry32 } from './find-shapes.js';
import { lineOfSight } from './dune-stinger.js';
import { pickLod } from './alien-bird.js';
import { skyLight } from './sky-environment.js';

// The giant bones: the skull and the ribcage of something enormous, half buried in the dunes. They are landmarks, things you see on the
// skyline from the start and walk out to. One carcass lies 170 to 270 m from where you start, with the open-jawed skull facing back
// towards the start and the ribs behind it; a second, smaller ribcage lies much further out the other way.
//
// The models are built in Blender (tools/giant-bones/build_bones.py), three levels of detail each. Only the lowest level is fetched at start
// (about 100 KB); a better one is fetched when you walk towards the bones, so nobody pays for the close-up before they are near it. Nothing
// here affects the game: you can walk through them, and there is no sound. The layout is fixed by a seed and is pure (no three.js scene), so
// tests can check it.

const BASE = import.meta.env?.BASE_URL ?? '/';

export const BONES = Object.freeze({
  seed: 5207,
  file: (kind, level) => `${BASE}models/bones/giant_${kind}_lod${level}.glb`,
  kinds: Object.freeze(['skull', 'ribs']),
  lodDistances: Object.freeze([0, 75, 200]), // metres from the near edge of the bones, at scale 1 (they grow with the site's scale)
  lodHysteresis: 0.08,
  prefetch: 1.5, // the next better level starts downloading when you are within this multiple of the distance it takes over at
  hideBeyond: 900, // metres: past this nothing is drawn
  eye: 1.7, // metres: how high you see from when the layout asks "can the start see it?"
  // Half the footprint of each model at scale 1, in its own frame (x across, z along): where the ground is read for the slope.
  box: Object.freeze({ skull: { x: 3.4, zMin: -11, zMax: 5 }, ribs: { x: 5.5, zMin: -10, zMax: 10 } }),
  height: Object.freeze({ skull: 6.5, ribs: 11.5 }), // metres at scale 1: the highest point (the horns, the spine's spikes)
  sink: Object.freeze({ skull: 0.3, ribs: 0.5 }), // metres at scale 1 the model's own ground level is put below the sand
  maxRange: 2.2, // highest minus lowest ground under the footprint, in metres per unit of scale
  carcass: Object.freeze({ scale: 1.6, distance: [170, 270], idealDistance: 215, apart: 27, turn: 0.28, ribTurn: 0.22 }),
  lone: Object.freeze({ scale: 1.15, distance: [300, 430], awayFromCarcass: 240 }),
  clear: Object.freeze({ pond: 125, hero: 100, stinger: 75, finds: 8, worldLimit: 440 }),
  stingerHome: Object.freeze({ x: SPAWN.x + 46, z: SPAWN.z - 6 }), // dune-stinger.js
});

const TAU = Math.PI * 2;
const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

// Where the model's own origin and axes land in the world: yaw turns +Z (the animal's length) towards (sin yaw, cos yaw).
export function toWorld(site, lx, lz) {
  const c = Math.cos(site.yaw), s = Math.sin(site.yaw);
  return { x: site.x + (lx * c + lz * s) * site.scale, z: site.z + (-lx * s + lz * c) * site.scale };
}

// Ground heights in a 3 x 4 grid over the model's footprint: { min, max, mean, front, back, minusX, plusX } (front/back along its length; the
// model's +X is the animal's left).
export function groundUnder(heightAt, kind, x, z, yaw, scale) {
  const box = BONES.box[kind];
  const site = { x, z, yaw, scale };
  let min = Infinity, max = -Infinity, sum = 0, count = 0;
  const rows = [], cols = [];
  for (let i = 0; i < 4; i++) {
    const lz = box.zMin + (box.zMax - box.zMin) * (i / 3);
    for (let j = -1; j <= 1; j++) {
      const p = toWorld(site, j * box.x, lz);
      const h = heightAt(p.x, p.z);
      min = Math.min(min, h); max = Math.max(max, h); sum += h; count++;
      rows[i] = (rows[i] ?? 0) + h / 3;
      cols[j + 1] = (cols[j + 1] ?? 0) + h / 4;
    }
  }
  return { min, max, mean: sum / count, front: rows[3], back: rows[0], minusX: cols[0], plusX: cols[2], length: (box.zMax - box.zMin) * scale, width: 2 * box.x * scale };
}

// Is the ground there level enough, and clear of everything else?
function fits(kind, x, z, yaw, scale, { heightAt, obstacles }) {
  const C = BONES.clear;
  if (Math.abs(x) > C.worldLimit || Math.abs(z) > C.worldLimit) return false;
  if (dist(x, z, WATER.x, WATER.z) < C.pond) return false;
  if (dist(x, z, HERO_TREE.x, HERO_TREE.z) < C.hero) return false;
  if (dist(x, z, BONES.stingerHome.x, BONES.stingerHome.z) < C.stinger) return false;
  const ground = groundUnder(heightAt, kind, x, z, yaw, scale);
  if (ground.max - ground.min > BONES.maxRange * scale) return false;
  const reach = Math.max(BONES.box[kind].x, BONES.box[kind].zMax, -BONES.box[kind].zMin) * scale;
  for (const o of obstacles) if (dist(x, z, o.x, o.z) < reach + o.radius + C.finds) return false;
  return true;
}

function siteOf(kind, x, z, yaw, scale, heightAt, index) {
  const ground = groundUnder(heightAt, kind, x, z, yaw, scale);
  const box = BONES.box[kind];
  const out = { id: `${kind}${index}`, kind, x, z, yaw, scale, pitch: 0, roll: 0 };
  if (kind === 'skull') {
    // the jaw lies on the sand, so the whole skull follows the lean of the ground
    out.pitch = -Math.atan2(ground.front - ground.back, (box.zMax - box.zMin) * scale * 0.75) * 0.8;
    out.roll = Math.atan2(ground.plusX - ground.minusX, 2 * box.x * scale) * 0.6;
    out.y = ground.mean - BONES.sink.skull * scale;
  } else {
    // arches stand upright whatever the ground does; the low side shows a little more of each rib
    out.y = ground.min + (ground.mean - ground.min) * 0.5 - BONES.sink.ribs * scale;
  }
  out.radius = Math.max(box.x, box.zMax, -box.zMin) * scale;
  return out;
}

// The fixed places: [skull, ribs, lone ribs]. Returns [] if `heightAt` is missing.
export function layoutBones({ heightAt, finds = null, seed = BONES.seed } = {}) {
  if (typeof heightAt !== 'function') throw new Error('layoutBones needs a heightAt(x, z) function');
  const rng = mulberry32(seed);
  const obstacles = (finds ?? layoutFinds({ heightAt }).nodes).map(n => ({ x: n.x, z: n.z, radius: n.radius ?? 3 }));
  const env = { heightAt, obstacles };
  const spawnY = heightAt(SPAWN.x, SPAWN.z) + BONES.eye;
  const sees = (x, z, up) => lineOfSight(heightAt, SPAWN.x, spawnY, SPAWN.z, x, heightAt(x, z) + up, z);

  // ---- the carcass: the skull faces the start, the ribs lie behind it along the same line
  const C = BONES.carcass;
  let best = null;
  const start = rng() * TAU;
  for (let a = 0; a < 72; a++) {
    const angle = start + (a / 72) * TAU;
    for (let r = C.distance[0]; r <= C.distance[1]; r += 15) {
      const sx = SPAWN.x + Math.cos(angle) * r, sz = SPAWN.z + Math.sin(angle) * r;
      const towardStart = Math.atan2(SPAWN.x - sx, SPAWN.z - sz);
      const yaw = towardStart + C.turn * (rng() < 0.5 ? -1 : 1);
      const rx = sx - Math.sin(yaw) * C.apart * C.scale, rz = sz - Math.cos(yaw) * C.apart * C.scale;
      const ribYaw = yaw + C.ribTurn * (rng() < 0.5 ? -1 : 1);
      if (!fits('skull', sx, sz, yaw, C.scale, env) || !fits('ribs', rx, rz, ribYaw, C.scale, env)) continue;
      const ribsSeen = sees(rx, rz, BONES.height.ribs * C.scale * 0.7);
      if (!ribsSeen) continue;
      const skullSeen = sees(sx, sz, BONES.height.skull * C.scale * 0.8);
      const score = -Math.abs(r - C.idealDistance) * 0.5 + (skullSeen ? 40 : 0) + rng() * 4;
      if (!best || score > best.score) best = { score, sx, sz, yaw, rx, rz, ribYaw };
    }
  }
  const sites = [];
  if (best) {
    sites.push(siteOf('skull', best.sx, best.sz, best.yaw, C.scale, heightAt, 0));
    sites.push(siteOf('ribs', best.rx, best.rz, best.ribYaw, C.scale, heightAt, 0));
  }

  // ---- the lone ribcage, far out in another direction (the start is near the edge of the world, so most directions run out of room)
  const L = BONES.lone;
  let lone = null;
  for (let a = 0; a < 72; a++) {
    const angle = (a / 72) * TAU;
    for (let r = L.distance[0]; r <= L.distance[1]; r += 20) {
      const x = SPAWN.x + Math.cos(angle) * r, z = SPAWN.z + Math.sin(angle) * r;
      const yaw = rng() * TAU;
      if (!fits('ribs', x, z, yaw, L.scale, env)) continue;
      const apart = best ? dist(x, z, best.sx, best.sz) : 1000;
      if (apart < L.awayFromCarcass) continue;
      const score = Math.min(apart, 420) * 0.04 + rng() * 6 + (sees(x, z, BONES.height.ribs * L.scale * 0.6) ? 6 : 0);
      if (!lone || score > lone.score) lone = { score, x, z, yaw };
    }
  }
  if (lone) sites.push(siteOf('ribs', lone.x, lone.z, lone.yaw, L.scale, heightAt, 1));
  return sites;
}

// Which level to show: the wanted one if it has arrived, else the nearest better one, else the nearest worse one. `loaded` is an array of booleans.
export function levelToShow(want, loaded) {
  for (let l = want; l >= 0; l--) if (loaded[l]) return l;
  for (let l = want + 1; l < loaded.length; l++) if (loaded[l]) return l;
  return -1;
}

const defaultLoader = url => new GLTFLoader().loadAsync(url);

export function createGiantBones({ scene, camera = null, heightAt, sites = null, onError = () => {}, load = defaultLoader } = {}) {
  const layout = sites ?? layoutBones({ heightAt });
  const groups = [];
  const models = { skull: [null, null, null], ribs: [null, null, null] };
  const promises = { skull: [null, null, null], ribs: [null, null, null] };

  for (const site of layout) {
    const group = new THREE.Group();
    group.name = `Giant ${site.kind} ${site.id}`;
    group.position.set(site.x, site.y, site.z);
    group.rotation.order = 'YXZ';
    group.rotation.set(site.pitch, site.yaw, site.roll);
    group.scale.setScalar(site.scale);
    group.visible = false;
    scene?.add(group);
    groups.push({
      site, group, roots: [null, null, null], loaded: [false, false, false], lod: 2, shown: -1, distance: Infinity,
      distances: BONES.lodDistances.map(v => v * site.scale),
    });
  }

  function attach(kind, level) {
    for (const entry of groups) {
      if (entry.site.kind !== kind || entry.roots[level]) continue;
      const root = models[kind][level].clone(true);
      root.visible = false;
      entry.group.add(root);
      entry.roots[level] = root;
      entry.loaded[level] = true;
      entry.shown = -2; // choose again
    }
  }

  // Start fetching a level (once). Returns the promise. Cheap to call every frame.
  function request(kind, level) {
    if (promises[kind][level]) return promises[kind][level];
    promises[kind][level] = Promise.resolve()
      .then(() => load(BONES.file(kind, level)))
      .then(gltf => {
        const root = gltf.scene;
        skyLight(root);
        root.traverse(object => {
          if (!object.isMesh) return;
          object.castShadow = object.receiveShadow = false;
          if (object.material) object.material.side = THREE.FrontSide;
        });
        models[kind][level] = root;
        attach(kind, level);
        return root;
      })
      .catch(error => onError(`[Oasis bones] A giant ${kind} model (level ${level}) could not load: ${error.message}`));
    return promises[kind][level];
  }

  for (const kind of BONES.kinds) if (layout.some(s => s.kind === kind)) request(kind, 2);

  const camPosition = new THREE.Vector3();
  // every frame, with where you are (the head): pick the level for how far away each is, fetch what is wanted, show what has arrived.
  // Allocates nothing.
  function update(position = null) {
    if (position) { camPosition.x = position.x; camPosition.z = position.z; }
    else if (camera) camera.getWorldPosition(camPosition);
    else return;
    for (let i = 0; i < groups.length; i++) {
      const entry = groups[i];
      const { site, group, roots } = entry;
      const d = entry.distance = dist(camPosition.x, camPosition.z, site.x, site.z);
      const visible = d < BONES.hideBeyond;
      if (group.visible !== visible) group.visible = visible;
      if (!visible) continue;
      const near = Math.max(0, d - site.radius * 0.5);
      entry.lod = pickLod(near, entry.lod, entry.distances, BONES.lodHysteresis);
      request(site.kind, entry.lod);
      if (entry.lod > 0 && near < entry.distances[entry.lod] * BONES.prefetch) request(site.kind, entry.lod - 1);
      const show = levelToShow(entry.lod, entry.loaded);
      if (show !== entry.shown) {
        for (let l = 0; l < roots.length; l++) if (roots[l]) roots[l].visible = l === show;
        entry.shown = show;
      }
    }
  }

  return {
    update,
    sites: layout,
    request,
    list() {
      return groups.map(({ site, shown, lod, distance }) => ({
        id: site.id, kind: site.kind, x: +site.x.toFixed(1), z: +site.z.toFixed(1), scale: site.scale, wanted: lod, shown,
        distance: Number.isFinite(distance) ? Math.round(distance) : null,
      }));
    },
    dispose() { for (const { group } of groups) scene?.remove(group); },
  };
}
