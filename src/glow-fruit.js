import * as THREE from 'three';
import { HERO_TREE, isInPond, terrainHeight } from './world.js';
import { createHaloInstances } from './glow-halos.js';
import { attachHeldObject, setGripSurface } from './grip-contact.js';
import { pulseHaptics } from './haptics.js';

// Glow fruit: small cyan fruit that has fallen from the veil tree and lies around its base.
// Stone-sized and faintly luminous, so at night they are easy to spot. Grab one with the grip
// button and bring it to your mouth to eat it. Eaten fruit regrows slowly in the same spot.
// (The giant pods hanging in the tree stay scenery.)

export const FRUIT = Object.freeze({
  height: 0.13, // metres: a little bigger than the pickup stones
  radius: 0.05,
  food: 24,
  water: 6,
  respawnSeconds: 240,
  count: 14,
});

const GRIP_BUTTON = 1;
const PICKUP_RADIUS = 0.30;
export const MOUTH_RADIUS = 0.17;
const MOUTH_OFFSET = new THREE.Vector3(0, -0.11, -0.08); // below and in front of the eyes
const GROW_SECONDS = 2.5;
const GLOW_DAY = 1.0;
// Night exposure is ~0.035 against ~0.8 by day, so the night value has to be large for the fruit to
// read as a light source rather than a dim blue ball.
const GLOW_NIGHT = 40;
const HALO_RADIUS = 0.8;

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic scatter around the tree: outside the buttress roots, never in the pond, and never
// two fruit on top of each other.
export function fruitLayout({
  count = FRUIT.count,
  seed = 0x6c0ffee,
  center = HERO_TREE,
  minRadius = 13,
  maxRadius = 36,
  minSpacing = 3,
  blocked = (x, z) => isInPond(x, z) || Math.abs(x) > 495 || Math.abs(z) > 495,
} = {}) {
  const random = mulberry32(seed);
  const items = [];
  for (let attempt = 0; attempt < count * 80 && items.length < count; attempt++) {
    const radius = Math.sqrt(minRadius * minRadius + random() * (maxRadius * maxRadius - minRadius * minRadius));
    const angle = random() * Math.PI * 2;
    const x = center.x + Math.cos(angle) * radius;
    const z = center.z + Math.sin(angle) * radius;
    const yaw = random() * Math.PI * 2;
    const tilt = (random() - 0.5) * 0.6;
    if (blocked(x, z)) continue;
    if (items.some(item => Math.hypot(item.x - x, item.z - z) < minSpacing)) continue;
    items.push({ x, z, yaw, tilt });
  }
  return items;
}

// Where the mouth is in world space, from the head's world matrix.
export function mouthPosition(cameraMatrixWorld, out = new THREE.Vector3()) {
  return out.copy(MOUTH_OFFSET).applyMatrix4(cameraMatrixWorld);
}

// A plump lantern fruit: narrow neck at the top, round belly, softly pointed tip.
function createFruitGeometry() {
  const { height, radius } = FRUIT;
  const samples = 12;
  const points = [new THREE.Vector2(0.0005, -height / 2)];
  let peak = 0;
  const raw = [];
  for (let i = 0; i <= samples; i++) {
    const t = 0.03 + (0.94 * i) / samples; // 0.03 neck .. 0.97 tip
    const r = Math.sin(Math.PI * t ** 0.86) ** 0.62;
    peak = Math.max(peak, r);
    raw.push({ t, r });
  }
  // Bottom (tip) to top (neck) so lathe normals face outward.
  for (const { t, r } of raw.slice().reverse()) {
    points.push(new THREE.Vector2(Math.max((r / peak) * radius, 0.004), height / 2 - t * height));
  }
  points.push(new THREE.Vector2(0.0005, height / 2 + 0.004));
  return new THREE.LatheGeometry(points, 14);
}

// Vertical emissive gradient: dim neck, white-hot belly, cyan tip. 1 x N texture along the lathe.
function createFruitGlowTexture() {
  const rows = 32;
  const data = new Uint8Array(rows * 4);
  for (let y = 0; y < rows; y++) {
    const v = y / (rows - 1); // 0 tip .. 1 neck (lathe v follows point order)
    const belly = Math.sin(Math.PI * Math.min(Math.max((v - 0.05) / 0.9, 0), 1)) ** 0.9;
    const hot = Math.max(0, belly - 0.55) / 0.45;
    const r = 0.03 + 0.05 * belly + 0.75 * hot;
    const g = 0.22 + 0.55 * belly + 0.22 * hot;
    const b = 0.42 + 0.50 * belly + 0.08 * hot;
    data.set([r, g, b, 1].map(value => Math.round(Math.min(value, 1) * 255)), y * 4);
  }
  const texture = new THREE.DataTexture(data, 1, rows, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function smoothstep(a, b, value) {
  const t = THREE.MathUtils.clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

const worldPosition = new THREE.Vector3();

export function createGroundFruit({ field, sunDirection = null, layout = null } = {}) {
  if (!field?.sample) throw new Error('Glow fruit requires the Oasis height field.');

  const group = new THREE.Group();
  group.name = 'Glow fruit';

  const geometry = createFruitGeometry();
  const material = new THREE.MeshStandardMaterial({
    color: 0x062a3a,
    roughness: 0.38,
    metalness: 0,
    emissive: 0xffffff,
    emissiveMap: createFruitGlowTexture(),
    emissiveIntensity: GLOW_DAY,
  });
  material.name = 'Glow fruit';

  const places = layout || fruitLayout();
  const halos = createHaloInstances(places.length, { name: 'Glow fruit halos', color: 0x25c8ff, maxIntensity: 0.8 });
  group.add(halos.mesh);

  const slots = places.map((place, index) => ({ ...place, index, fruit: null, timer: 0 }));
  const restOffset = FRUIT.height * 0.42;

  function spawn(slot, grow = false) {
    const fruit = new THREE.Mesh(geometry, material);
    fruit.name = 'Fruit';
    fruit.position.set(slot.x, field.sample(slot.x, slot.z) + restOffset, slot.z);
    fruit.rotation.set(slot.tilt, slot.yaw, slot.tilt * 0.6);
    fruit.userData.collectibleResource = 'glow_fruit';
    fruit.userData.looseFruit = true;
    fruit.userData.gripProfile = 'large';
    fruit.userData.restOffset = restOffset;
    fruit.userData.slot = slot.index;
    fruit.userData.held = false;
    fruit.userData.grow = grow ? 0 : 1;
    setGripSurface(fruit, { meshes: ['Fruit'], point: [0, 0, 0] });
    fruit.scale.setScalar(grow ? 0.01 : 1);
    slot.fruit = fruit;
    group.add(fruit);
    return fruit;
  }
  slots.forEach(slot => spawn(slot));

  // Eaten fruit leaves its slot empty; a new one grows there after the respawn delay.
  function consume(fruit) {
    if (!fruit) return false;
    const slot = slots[fruit.userData.slot];
    fruit.removeFromParent();
    fruit.userData.held = false;
    fruit.userData.eaten = true;
    if (slot && slot.fruit === fruit) {
      slot.fruit = null;
      slot.timer = FRUIT.respawnSeconds;
    }
    halos.setInstance(fruit.userData.slot, worldPosition.set(0, 0, 0), 0);
    return true;
  }

  function update(dt) {
    const step = Math.max(0, Math.min(Number(dt) || 0, 1));
    const sunHeight = sunDirection ? sunDirection.y : 1;
    const night = 1 - smoothstep(-0.05, 0.25, sunHeight);
    material.emissiveIntensity = THREE.MathUtils.lerp(GLOW_DAY, GLOW_NIGHT, night);
    halos.setNight(night);

    for (const slot of slots) {
      if (!slot.fruit) {
        slot.timer -= step;
        if (slot.timer <= 0) spawn(slot, true);
      }
      const fruit = slot.fruit;
      if (!fruit) { halos.setInstance(slot.index, worldPosition, 0); continue; }
      if (fruit.userData.grow < 1) {
        fruit.userData.grow = Math.min(1, fruit.userData.grow + step / GROW_SECONDS);
        fruit.scale.setScalar(Math.max(0.01, fruit.userData.grow));
      }
      // Halos are in world space (the group sits at the origin); the fruit may be in a hand.
      fruit.getWorldPosition(worldPosition);
      halos.setInstance(slot.index, worldPosition, HALO_RADIUS * fruit.userData.grow);
    }
  }

  group.userData.glowFruit = { consume, slots, update };
  return { group, update, consume, slots, material, halos };
}

// Grab with the grip button, eat by bringing it to your mouth, let go to drop it.
export function createHeldFruit({ scene, states, renderer = null, camera = null, onEat = null }) {
  if (!scene || !Array.isArray(states)) throw new Error('Fruit grabbing requires the Oasis scene and VR hand states.');

  const heldByState = new Map();
  const gripDown = new Map();
  const handPosition = new THREE.Vector3();
  const fruitPosition = new THREE.Vector3();
  const mouth = new THREE.Vector3();
  let fruitGroup = null;

  function getGroup() {
    if (!fruitGroup || !fruitGroup.parent) fruitGroup = scene.getObjectByName('Glow fruit');
    return fruitGroup;
  }

  function headMatrix() {
    const active = renderer?.xr?.isPresenting ? renderer.xr.getCamera() : camera;
    return active?.matrixWorld || null;
  }

  function grab(state, fruit) {
    if (!state?.objectGrip || !fruit || fruit.userData.held) return false;
    if (!attachHeldObject(state, fruit)) return false;
    fruit.userData.held = true;
    heldByState.set(state, fruit);
    return true;
  }

  function drop(state) {
    const fruit = heldByState.get(state);
    if (!fruit) return false;
    fruit.updateWorldMatrix(true, false);
    fruit.getWorldPosition(fruitPosition);
    const group = getGroup();
    if (group?.parent) group.attach(fruit);
    else scene.attach(fruit);
    const rest = fruit.userData.restOffset ?? FRUIT.height * 0.42;
    fruitPosition.set(fruitPosition.x, terrainHeight(fruitPosition.x, fruitPosition.z) + rest, fruitPosition.z);
    if (fruit.parent === group) group.worldToLocal(fruitPosition);
    fruit.position.copy(fruitPosition);
    fruit.rotation.set(0.25, fruit.rotation.y, 0.15);
    fruit.userData.held = false;
    heldByState.delete(state);
    return true;
  }

  function eat(state, fruit) {
    heldByState.delete(state);
    const api = getGroup()?.userData.glowFruit;
    if (api) api.consume(fruit);
    else fruit.removeFromParent();
    pulseHaptics(state, 0.6, 90);
    onEat?.({ food: FRUIT.food, water: FRUIT.water, fruit });
    return true;
  }

  function findNearest(state) {
    const group = getGroup();
    if (!group?.visible || !state?.objectGrip) return null;
    state.objectGrip.updateWorldMatrix(true, false);
    state.objectGrip.getWorldPosition(handPosition);
    let nearest = null;
    let nearestSq = PICKUP_RADIUS * PICKUP_RADIUS;
    for (const fruit of group.children) {
      if (!fruit.userData?.looseFruit || fruit.userData.held) continue;
      fruit.updateWorldMatrix(true, false);
      fruit.getWorldPosition(fruitPosition);
      const distanceSq = handPosition.distanceToSquared(fruitPosition);
      if (distanceSq <= nearestSq) { nearest = fruit; nearestSq = distanceSq; }
    }
    return nearest;
  }

  function update() {
    const head = headMatrix();
    if (head) mouthPosition(head, mouth);

    for (const state of states) {
      const buttons = state.inputSource?.gamepad?.buttons || [];
      const grip = Boolean(buttons[GRIP_BUTTON]?.pressed);
      const wasDown = Boolean(gripDown.get(state));
      const held = heldByState.get(state);

      if (held) {
        held.updateWorldMatrix(true, false);
        held.getWorldPosition(fruitPosition);
        if (head && grip && state.inputSource && fruitPosition.distanceTo(mouth) <= MOUTH_RADIUS) eat(state, held);
        else if (!state.inputSource || !grip) drop(state);
      } else if (grip && !wasDown && state.objectGrip.children.length === 0) {
        const fruit = findNearest(state);
        if (fruit) grab(state, fruit);
      }
      gripDown.set(state, grip);
    }
  }

  return {
    update,
    dropAll: () => { for (const state of Array.from(heldByState.keys())) drop(state); },
    isHolding: handedness => {
      const state = states.find(item => item.handedness === handedness);
      return Boolean(state && heldByState.has(state));
    },
  };
}
