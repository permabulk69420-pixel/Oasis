import * as THREE from 'three';
import { FIND_SHAPES, LODS, rockBody, bodyReach } from './find-shapes.js';
import { layoutFinds, footprintOf, heightOf, FINDS_VERSION } from './desert-finds.js';
import { createFindMaterials } from './find-materials.js';
import { createBurstPool } from './bursts.js';
import { createHaloInstances } from './glow-halos.js';
import { spawnDrop, hasDropSpawner } from './resource-drops.js';

// The things you break for a living out in the dunes. Rocks and crystals give way to a pickaxe, spire plants to an axe (src/desert-finds.js
// says where they are, src/find-shapes.js what they look like). Every node is drawn from a few instanced meshes (one per variant and
// level of detail), so a hundred of them are a handful of draw calls.
//
// A blow (src/weapon-hits.js hands this module the point of the tool and how hard it landed) takes health off the node, shakes it, throws
// chips, and for every `perDrop` of damage dealt a loose item pops out beside it: stone from rocks, crystal shards from crystals, fibre
// from spires. When the health is gone the node comes down (a rock sinks and crumbles, a crystal shatters, a spire falls over), the last
// items drop, and after `respawn` seconds it grows back. The wrong tool just rings off it: sparks, a shake and the jolt in your hand,
// but no damage. Every number is in MINING below.

export const MINING = Object.freeze({
  lodDistance: Object.freeze([70, 190]), // metres: the close level up to the first, the middle one up to the second, the far one beyond
  lodHysteresis: 6, // metres either side of a boundary where a node keeps the level it has
  drawDistance: Object.freeze({ rock: 470, crystal: 440, spire: 300 }),
  rebuildMove: 3.5, // metres the player walks before the levels are worked out again
  kinds: Object.freeze({
    //          health  per drop  drops    the last blow  seconds gone  seconds growing back
    rock: Object.freeze({ health: 120, perDrop: 30, drop: 'stone', bonus: 2, respawn: 900, regrow: 30, breakTime: 1.5 }),
    crystal: Object.freeze({ health: 70, perDrop: 24, drop: 'crystal', bonus: 1, respawn: 700, regrow: 35, breakTime: 0.5 }),
    spire: Object.freeze({ health: 44, perDrop: 22, drop: 'fibre', bonus: 1, respawn: 300, regrow: 45, breakTime: 1.1 }),
  }),
  // multiplies a kind's health: the big ones take more breaking
  variantHealth: Object.freeze({ mesa: 1.35, hoodoo: 1.15, boulder: 0.9, slab: 0.8, cluster: 1, fan: 0.85, spike: 1.4, tall: 1, squat: 0.85 }),
  // which tools work on which kind, and how well (1 = the tool's full damage). Anything else just rings off it.
  accepts: Object.freeze({
    rock: Object.freeze({ pickaxe: 1 }),
    crystal: Object.freeze({ pickaxe: 1 }),
    spire: Object.freeze({ axe: 1, pickaxe: 0.6, spear: 0.5 }),
  }),
  shake: Object.freeze({ decay: 4.2, frequency: 62, rockAmplitude: 0.014, crystalAmplitude: 0.02, spireAmplitude: 0.035, rockTilt: 0.012, spireTilt: 0.05 }),
  pop: Object.freeze({ time: 0.5, height: 0.55 }), // seconds an item takes to fly out and land, and how high it goes
  hitReach: 0.9, // a node is struck when the tool's point is inside this share of its footprint (an ellipse is narrower than its widest point)
  standOff: 0.28, // how far the player is kept from a rock's edge
  maxOwed: 40, // drops waiting for their model to load (very slow data)
  maxLoose: 90, // items lying about that came from mining; past this the oldest one that nobody holds is tidied away
  // the soft violet glow round a crystal cluster at night (one sprite each, one draw call): what makes a field a smudge of light across the dunes
  halo: Object.freeze({ radius: 2.7, height: 0.4, intensity: 0.5, colour: 0x9a5cff }),
});

// ---------------------------------------------------------------------------------------------- the rules (no scene needed)
export function maxHealthOf(node) {
  return MINING.kinds[node.kind].health * (MINING.variantHealth[node.variant] ?? 1);
}

// A fresh node: layout entry plus its state. States: 'idle' (standing, can be hit), 'breaking' (coming down), 'gone' (waiting to
// grow back), 'growing' (coming back, cannot be hit yet).
export function createNodeState(entry) {
  const node = { ...entry, state: 'idle', timer: 0, shake: 0, sinceDrop: 0, grow: 1, fallX: 0, fallZ: 1, lod: -1, hitX: entry.x, hitY: entry.y + 1, hitZ: entry.z };
  node.maxHealth = maxHealthOf(node);
  node.health = node.maxHealth;
  return node;
}

// What a tool does to a node. Returns { accepted, dealt, drops, broke }: `accepted` is whether this tool works on it at all (a tool that
// does not still rings off, see mining.hurt), `drops` how many items to pop out now.
export function applyBlow(node, amount, toolId) {
  const result = { accepted: false, dealt: 0, drops: 0, broke: false };
  if (node.state !== 'idle' || !(amount > 0)) return result;
  const kind = MINING.kinds[node.kind];
  const multiplier = MINING.accepts[node.kind]?.[toolId] ?? 0;
  node.shake = 1;
  if (multiplier <= 0) return result;
  result.accepted = true;
  const dealt = amount * multiplier;
  result.dealt = dealt;
  node.health -= dealt;
  node.sinceDrop += dealt;
  while (node.sinceDrop >= kind.perDrop && node.health > 0) { node.sinceDrop -= kind.perDrop; result.drops += 1; }
  if (node.health <= 0) {
    node.health = 0;
    node.sinceDrop = 0;
    node.state = 'breaking';
    node.timer = 0;
    result.broke = true;
    result.drops += kind.bonus;
  }
  return result;
}

// Time passing for one node: shaking dies away, a broken node comes down, waits, grows back.
export function stepNode(node, dt) {
  node.shake = Math.max(0, node.shake - dt * MINING.shake.decay);
  const kind = MINING.kinds[node.kind];
  if (node.state === 'breaking') {
    node.timer += dt;
    if (node.timer >= kind.breakTime) { node.state = 'gone'; node.timer = kind.respawn; node.grow = 0; node.shake = 0; }
  } else if (node.state === 'gone') {
    node.timer -= dt;
    if (node.timer <= 0) { node.state = 'growing'; node.timer = 0; node.grow = 0; }
  } else if (node.state === 'growing') {
    node.timer += dt;
    node.grow = Math.min(1, node.timer / kind.regrow);
    if (node.grow >= 1) { node.state = 'idle'; node.grow = 1; node.health = node.maxHealth; node.sinceDrop = 0; }
  }
}

// Level of detail for a distance, with a little memory so a node on a boundary does not flicker between two levels.
export function lodFor(distance, previous = -1) {
  const [near, far] = MINING.lodDistance, h = MINING.lodHysteresis;
  let lod = distance < near ? 0 : distance < far ? 1 : 2;
  if (previous >= 0 && previous !== lod) {
    if (previous === 0 && distance < near + h) lod = 0;
    else if (previous === 1 && distance >= near - h && distance < far + h) lod = 1;
    else if (previous === 2 && distance >= far - h) lod = 2;
  }
  return lod;
}

// Is this point inside the node, for a tool tip with radius `radius`? A rock is its real body (how far it reaches in each direction up to head
// height) with the top of the shape above; the others are a cylinder as wide as the node's footprint and as tall as the node.
export function insideNode(node, x, y, z, radius = 0) {
  const dx = x - node.x, dz = z - node.z;
  const top = node.y + heightOf(node.kind, node.variant) * node.scale + radius;
  if (y < node.y - 0.4 - radius || y > top) return false;
  if (node.kind === 'rock') {
    const cos = Math.cos(node.yaw), sin = Math.sin(node.yaw);
    const reach = bodyReach(rockBody(node.variant), dx * cos - dz * sin, dx * sin + dz * cos) * node.scale + radius + 0.04;
    return dx * dx + dz * dz <= reach * reach;
  }
  const reach = footprintOf(node.kind, node.variant) * node.scale * MINING.hitReach + radius;
  return dx * dx + dz * dz <= reach * reach;
}

// Walk a point out of every standing rock it is inside (the rock's body plus a stand-off). Returns the corrected [x, z] or null if it was
// already clear. `nodes` are node states; only rocks that are up and not coming down block the way.
export function pushOutOfRocks(nodes, x, z, margin = MINING.standOff) {
  let moved = false;
  for (const node of nodes) {
    if (node.kind !== 'rock') continue;
    if (node.state === 'gone' || node.state === 'breaking' || (node.state === 'growing' && node.grow < 0.6)) continue;
    const dx = x - node.x, dz = z - node.z;
    const distance2 = dx * dx + dz * dz;
    const far = (footprintOf('rock', node.variant) * 1.6 * node.scale + margin);
    if (distance2 > far * far) continue;
    const cos = Math.cos(node.yaw), sin = Math.sin(node.yaw);
    const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
    const reach = bodyReach(rockBody(node.variant), lx, lz) * node.scale + margin;
    if (distance2 >= reach * reach) continue;
    // straight out from the middle until the edge
    const distance = Math.sqrt(distance2);
    const ux = distance > 1e-4 ? dx / distance : 1, uz = distance > 1e-4 ? dz / distance : 0;
    x = node.x + ux * (reach + 0.002);
    z = node.z + uz * (reach + 0.002);
    moved = true;
  }
  return moved ? [x, z] : null;
}

// ---------------------------------------------------------------------------------------------- the scene part
const easeOut = t => 1 - (1 - t) ** 3;
const easeIn = t => t * t;

const CHIP_COLOURS = [0xa0613a, 0xc58652, 0x8a4f31, 0xd3a273, 0x6e4330];
const SPARK_COLOURS = [0xb98cff, 0xe3c8ff, 0x7a46ff, 0x66d9ff];
const SPIRE_COLOURS = [0x3d7f86, 0x2c5f66, 0xd6cfae, 0xe08040];

const tmpPosition = new THREE.Vector3();
const tmpScale = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const tmpTilt = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpMatrix = new THREE.Matrix4();
const yAxis = new THREE.Vector3(0, 1, 0);
const tmpAxis = new THREE.Vector3();

export function createMining({ scene, renderer = null, heightAt, getExposure = () => 1, onError = console.warn, layout = null, rng = Math.random } = {}) {
  if (!scene || typeof heightAt !== 'function') throw new Error('Mining needs the scene and the height field.');
  const materials = createFindMaterials({ renderer, getExposure, onError });
  const found = layout ?? layoutFinds({ heightAt });
  const nodes = found.nodes.map(createNodeState);
  const byId = new Map(nodes.map(node => [node.id, node]));

  const group = new THREE.Group();
  group.name = 'Desert finds';
  scene.add(group);

  // one instanced mesh per variant and level, as big as the number of nodes of that variant
  const buckets = new Map(); // `${kind}:${variant}` -> [{ mesh, count }] by level
  const totals = new Map();
  for (const node of nodes) totals.set(`${node.kind}:${node.variant}`, (totals.get(`${node.kind}:${node.variant}`) ?? 0) + 1);
  const materialOf = { rock: materials.rock, crystal: materials.crystal, spire: materials.spire };
  for (const [key, capacity] of totals) {
    const [kind, variant] = key.split(':');
    const shape = FIND_SHAPES[kind];
    const levels = [];
    for (let lod = 0; lod < LODS; lod++) {
      const mesh = new THREE.InstancedMesh(shape.build(shape.variants[variant], lod), materialOf[kind], capacity);
      mesh.name = `${kind} ${variant} level ${lod}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false; // the bounding sphere would be the one it was made with; each level only holds nodes that are in range
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.count = 0;
      mesh.visible = false;
      group.add(mesh);
      levels.push({ mesh, count: 0 });
    }
    buckets.set(key, levels);
  }

  const crystalNodes = nodes.filter(node => node.kind === 'crystal');
  crystalNodes.forEach((node, i) => { node.haloIndex = i; });
  const halos = createHaloInstances(Math.max(1, crystalNodes.length), { name: 'Crystal halos', color: MINING.halo.colour, maxIntensity: MINING.halo.intensity });
  group.add(halos.mesh);

  const chips = createBurstPool({ capacity: 72, material: materials.chips, heightAt });
  const sparks = createBurstPool({ capacity: 56, material: materials.sparks, heightAt });
  chips.mesh.name = 'Rock chips'; sparks.mesh.name = 'Crystal sparks';
  scene.add(chips.mesh, sparks.mesh);

  let time = 0;
  let lastX = Infinity, lastZ = Infinity;
  let dirty = true;
  const owed = []; // drops that could not be made yet because their model had not loaded
  const pops = []; // items in the air: { object, from, to, t }
  const loose = []; // everything mining has dropped, oldest first, so a long session cannot fill the desert with stones
  for (const variant of new Set(nodes.filter(node => node.kind === 'rock').map(node => node.variant))) rockBody(variant); // worked out now, not on the first step beside a rock
  let candidate = null; // the node hitTest found, for the hurt that follows it
  const hitPoint = new THREE.Vector3();
  const playerPosition = new THREE.Vector3(); // where the player's head is, set each frame by update(): the direction a blow came from

  function setMatrix(node, mesh, index) {
    const kind = node.kind;
    let sx = node.scale, sy = node.scale, sz = node.scale;
    let ox = 0, oy = 0, oz = 0;
    tmpQuaternion.setFromAxisAngle(yAxis, node.yaw);
    const wobble = node.shake > 0 ? Math.sin(time * MINING.shake.frequency) * node.shake : 0;
    if (node.state === 'idle' || node.state === 'growing') {
      if (node.state === 'growing') {
        const g = easeOut(node.grow);
        if (kind === 'rock') { oy -= (1 - g) * heightOf(kind, node.variant) * node.scale * 0.95; sy *= 0.5 + 0.5 * g; }
        else { const s = 0.04 + 0.96 * g; sx *= s; sy *= s; sz *= s; }
      }
      if (wobble !== 0) {
        const amplitude = kind === 'rock' ? MINING.shake.rockAmplitude : kind === 'crystal' ? MINING.shake.crystalAmplitude : MINING.shake.spireAmplitude;
        ox += wobble * amplitude * node.fallZ; oz -= wobble * amplitude * node.fallX;
        const tilt = (kind === 'spire' ? MINING.shake.spireTilt : kind === 'rock' ? MINING.shake.rockTilt : 0.03) * wobble;
        tmpAxis.set(node.fallZ, 0, -node.fallX);
        tmpTilt.setFromAxisAngle(tmpAxis, tilt);
        tmpQuaternion.premultiply(tmpTilt);
      }
    } else if (node.state === 'breaking') {
      const t = Math.min(1, node.timer / MINING.kinds[kind].breakTime);
      if (kind === 'rock') {
        // a hard shake, then it slumps into the ground
        const slump = easeIn(Math.max(0, (t - 0.25) / 0.75));
        oy -= slump * heightOf(kind, node.variant) * node.scale * 1.05;
        sy *= 1 - 0.3 * slump; sx *= 1 + 0.12 * slump; sz *= 1 + 0.12 * slump;
        const jitter = Math.sin(time * 80) * (1 - t) * 0.03;
        ox += jitter * node.fallZ; oz -= jitter * node.fallX;
      } else if (kind === 'crystal') {
        const s = 1 - easeIn(t);
        sx *= s; sy *= s; sz *= s;
        tmpTilt.setFromAxisAngle(yAxis, t * 5);
        tmpQuaternion.premultiply(tmpTilt);
      } else {
        // a spire tips over away from the blow, then shrinks into the sand
        const fall = easeIn(Math.min(1, t / 0.7)) * (Math.PI / 2 - 0.1);
        tmpAxis.set(node.fallZ, 0, -node.fallX);
        tmpTilt.setFromAxisAngle(tmpAxis, fall);
        tmpQuaternion.premultiply(tmpTilt);
        const s = 1 - easeIn(Math.max(0, (t - 0.7) / 0.3));
        sx *= s; sy *= s; sz *= s;
      }
    }
    tmpPosition.set(node.x + ox, node.y + oy, node.z + oz);
    tmpScale.set(sx, sy, sz);
    tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
    mesh.setMatrixAt(index, tmpMatrix);
  }

  function rebuild(px, pz) {
    for (const levels of buckets.values()) for (const level of levels) level.count = 0;
    for (const node of nodes) {
      if (node.state === 'gone') { node.lod = -1; continue; }
      const d = Math.hypot(node.x - px, node.z - pz);
      if (d > MINING.drawDistance[node.kind] + node.radius) { node.lod = -1; continue; }
      node.lod = lodFor(d, node.lod);
      const level = buckets.get(`${node.kind}:${node.variant}`)[node.lod];
      setMatrix(node, level.mesh, level.count++);
    }
    for (const levels of buckets.values()) {
      for (const level of levels) {
        level.mesh.count = level.count;
        level.mesh.visible = level.count > 0;
        level.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    // the halos follow the crystals: gone while one is broken, growing with it as it comes back
    for (const node of crystalNodes) {
      const standing = node.state === 'idle' || node.state === 'growing';
      const near = Math.hypot(node.x - px, node.z - pz) <= MINING.drawDistance.crystal;
      const radius = standing && near ? MINING.halo.radius * node.scale * (node.variant === 'spike' ? 1.3 : 1) * (node.state === 'growing' ? easeOut(node.grow) : 1) : 0;
      tmpPosition.set(node.x, node.y + heightOf('crystal', node.variant) * node.scale * MINING.halo.height, node.z);
      halos.setInstance(node.haloIndex, tmpPosition, radius);
    }
    lastX = px; lastZ = pz;
    dirty = false;
  }

  // ------------------------------------------------------------------------------------------ drops
  function popFrom(object, fromX, fromY, fromZ) {
    if (!object) return;
    const to = object.position.clone();
    object.position.set(fromX, fromY, fromZ);
    pops.push({ object, fromX, fromY, fromZ, to, t: 0 });
  }

  function dropAround(node, type, count) {
    for (let n = 0; n < count; n++) {
      // on the side the blow came from (the player's side), a little to either hand, just outside the node
      const angle = Math.atan2(-node.fallZ, -node.fallX) + (rng() - 0.5) * 2.2;
      const reach = footprintOf(node.kind, node.variant) * node.scale * (node.kind === 'rock' ? 0.95 : 0.7) + 0.35 + rng() * 0.6;
      const x = node.x + Math.cos(angle) * reach, z = node.z + Math.sin(angle) * reach;
      const object = spawnDrop(type, x, z, rng() * Math.PI * 2);
      if (object) { popFrom(object, node.hitX, node.hitY, node.hitZ); keep(object); }
      else if (owed.length < MINING.maxOwed) owed.push({ type, x, z });
    }
  }

  function keep(object) {
    loose.push(object);
    for (let i = 0; loose.length > MINING.maxLoose && i < loose.length;) {
      const old = loose[i];
      if (!old.parent) { loose.splice(i, 1); continue; } // already picked up and stored
      if (old.userData.held) { i += 1; continue; }
      old.removeFromParent();
      loose.splice(i, 1);
    }
  }

  function settleOwed() {
    for (let i = owed.length - 1; i >= 0; i--) {
      const debt = owed[i];
      if (!hasDropSpawner(debt.type)) continue;
      const object = spawnDrop(debt.type, debt.x, debt.z, rng() * Math.PI * 2);
      if (object) { owed.splice(i, 1); keep(object); }
    }
  }

  function updatePops(dt) {
    for (let i = pops.length - 1; i >= 0; i--) {
      const pop = pops[i];
      const object = pop.object;
      if (object.userData.held || !object.parent) { pops.splice(i, 1); continue; }
      pop.t = Math.min(1, pop.t + dt / MINING.pop.time);
      const t = pop.t;
      object.position.set(
        pop.fromX + (pop.to.x - pop.fromX) * t,
        pop.fromY + (pop.to.y - pop.fromY) * t + MINING.pop.height * 4 * t * (1 - t),
        pop.fromZ + (pop.to.z - pop.fromZ) * t,
      );
      if (t >= 1) pops.splice(i, 1);
    }
  }

  // ------------------------------------------------------------------------------------------ effects
  function burst(node, x, y, z, count, big = false) {
    const along = [-node.fallX * 0.6, 0.5, -node.fallZ * 0.6]; // back towards the player
    if (node.kind === 'rock') chips.emit(x, y, z, count, { speed: big ? 3.6 : 2.6, along, spread: 1.2, colours: CHIP_COLOURS, sizes: big ? [0.05, 0.13] : [0.03, 0.08] });
    else if (node.kind === 'crystal') sparks.emit(x, y, z, count, { speed: big ? 3.4 : 2.4, along, spread: 1.3, colours: SPARK_COLOURS, sizes: big ? [0.03, 0.08] : [0.02, 0.055], lifetime: [0.7, 1.3] });
    else chips.emit(x, y, z, count, { speed: big ? 2.8 : 2.0, along, spread: 1.4, colours: SPIRE_COLOURS, sizes: [0.025, 0.06], lifetime: [0.6, 1.1] });
  }

  function ring(node, x, y, z) {
    // the sound of the wrong tool, as sparks: a handful of pale bits off the contact point
    sparks.emit(x, y, z, 6, { speed: 2.2, along: [-node.fallX * 0.5, 0.6, -node.fallZ * 0.5], spread: 1.0, colours: [0xfff1d0, 0xffd9a0], sizes: [0.012, 0.028], lifetime: [0.35, 0.7] });
  }

  // ------------------------------------------------------------------------------------------ the target weapon-hits uses
  function hitTest(point, radius = 0) {
    candidate = null;
    let best = Infinity;
    for (const node of nodes) {
      if (node.state !== 'idle') continue;
      if (!insideNode(node, point.x, point.y, point.z, radius)) continue;
      const d = (node.x - point.x) ** 2 + (node.z - point.z) ** 2;
      if (d < best) { best = d; candidate = node; }
    }
    if (candidate) hitPoint.copy(point);
    return Boolean(candidate);
  }

  function hurt(amount, instance = null) {
    const node = candidate;
    candidate = null;
    if (!node) return false;
    const toolId = instance?.kind?.id ?? '';
    // which way is "away from the player"? a spire falls that way and chips fly the other
    const fx = node.x - playerPosition.x, fz = node.z - playerPosition.z;
    const length = Math.hypot(fx, fz) || 1;
    node.fallX = fx / length; node.fallZ = fz / length;
    node.hitX = hitPoint.x; node.hitY = hitPoint.y; node.hitZ = hitPoint.z;
    const result = applyBlow(node, amount, toolId);
    dirty = true;
    if (!result.accepted) { ring(node, hitPoint.x, hitPoint.y, hitPoint.z); return true; }
    burst(node, hitPoint.x, hitPoint.y, hitPoint.z, result.broke ? 5 : 9);
    if (result.drops > 0) dropAround(node, MINING.kinds[node.kind].drop, result.drops);
    if (result.broke) {
      const bx = node.x, bz = node.z;
      const top = node.y + heightOf(node.kind, node.variant) * node.scale;
      const footprint = footprintOf(node.kind, node.variant) * node.scale;
      const count = node.kind === 'rock' ? 26 : node.kind === 'crystal' ? 22 : 12;
      for (let i = 0; i < 3; i++) {
        const a = rng() * Math.PI * 2;
        burst(node, bx + Math.cos(a) * footprint * 0.6, node.y + (0.2 + 0.6 * rng()) * (top - node.y), bz + Math.sin(a) * footprint * 0.6, Math.ceil(count / 3), true);
      }
    }
    return true;
  }

  function update(dt, head) {
    if (!(dt >= 0)) return;
    time += dt;
    if (head) playerPosition.copy(head);
    let animating = false;
    for (const node of nodes) {
      const was = node.state;
      stepNode(node, dt);
      if (node.state === 'breaking' || node.state === 'growing' || node.shake > 0 || was !== node.state) animating = true;
    }
    const px = head ? head.x : lastX, pz = head ? head.z : lastZ;
    if (dirty || animating || Math.hypot(px - lastX, pz - lastZ) > MINING.rebuildMove) rebuild(Number.isFinite(px) ? px : 0, Number.isFinite(pz) ? pz : 0);
    updatePops(dt);
    if (owed.length) settleOwed();
    chips.update(dt);
    sparks.update(dt);
    materials.update();
    halos.setNight(1 - THREE.MathUtils.smoothstep(getExposure(), 0.07, 0.5)); // the same daylight measure the glow materials use
  }

  // ------------------------------------------------------------------------------------------ the rest of the world's view of it
  function pushOut(x, z) {
    return pushOutOfRocks(nodes, x, z);
  }

  // Everything near a point, for telemetry and tests.
  function list(near = null, radius = 80) {
    return nodes
      .filter(node => !near || Math.hypot(node.x - near.x, node.z - near.z) <= radius)
      .map(node => ({ id: node.id, kind: node.kind, variant: node.variant, x: +node.x.toFixed(1), z: +node.z.toFixed(1), y: +node.y.toFixed(2), state: node.state, health: Math.round(node.health), lod: node.lod }));
  }

  // For the save: how long each broken node still has to wait (seconds), and put them back.
  function serialize() {
    const out = {};
    for (const node of nodes) {
      if (node.state === 'gone') out[node.id] = Math.round(node.timer);
      else if (node.state === 'breaking') out[node.id] = MINING.kinds[node.kind].respawn;
      else if (node.state === 'growing') out[node.id] = 0;
    }
    return { version: FINDS_VERSION, waiting: out };
  }
  function restore(data) {
    if (!data || data.version !== FINDS_VERSION || typeof data.waiting !== 'object') return false;
    for (const [id, seconds] of Object.entries(data.waiting)) {
      const node = byId.get(id);
      if (!node || !Number.isFinite(seconds)) continue;
      node.state = seconds > 0 ? 'gone' : 'growing';
      node.timer = Math.max(0, seconds);
      node.grow = 0;
      node.health = node.maxHealth;
    }
    dirty = true;
    return true;
  }

  return {
    update, hitTest, hurt, pushOut, list, serialize, restore,
    nodes, materials, group,
    stats: () => ({ nodes: nodes.length, owed: owed.length, pops: pops.length, loose: loose.length, chips: chips.count(), sparks: sparks.count() }),
    debug: {
      node: id => byId.get(id),
      // dev only: strike a node as if with a tool (no swing needed)
      strike(id, amount = 30, toolId = 'pickaxe', from = null) {
        const node = byId.get(id);
        if (!node) return null;
        if (from) playerPosition.set(from.x, from.y ?? node.y + 1.7, from.z);
        // a point on the side facing the player, half way up (or 1.2 m, whichever is lower)
        const reach = footprintOf(node.kind, node.variant) * node.scale * 0.8;
        const dx = playerPosition.x - node.x, dz = playerPosition.z - node.z;
        const d = Math.hypot(dx, dz) || 1;
        tmpPosition.set(node.x + (dx / d) * reach, node.y + Math.min(1.2, heightOf(node.kind, node.variant) * node.scale * 0.5), node.z + (dz / d) * reach);
        hitTest(tmpPosition, 0.05);
        const hit = hurt(amount, { kind: { id: toolId } });
        return { hit, health: node.health, state: node.state };
      },
      advance: (id, seconds) => { const node = byId.get(id); if (node) { for (let t = 0; t < seconds; t += 0.25) stepNode(node, Math.min(0.25, seconds - t)); dirty = true; } },
    },
  };
}
