import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BUILDING_PIECES, buildingPoint, foundationSite, cleanBuildings } from '../src/building-kit.js';
import { buildingCandidates, buildingOccupied, buildingSurface, pushOutOfBuildings, createBuildings } from '../src/building.js';
import { cleanSave, SAVE } from '../src/save-game.js';
import { placementRotateDown } from '../src/placement.js';
import { craftItem, ITEMS } from '../src/crafting.js';
import { addInventoryItem, getInventoryCount, importInventoryItems, getInventoryItems } from '../src/inventory.js';

const part = (type, x = 0, y = 0.12, z = 0, yaw = 0, id = 1) => ({ id, type, x, y, z, yaw });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} should equal ${b}`);

test('VR rotation uses X or B, leaving Y for the menu and A for jumping', () => {
  const buttons = Array.from({ length: 6 }, () => ({ pressed: false }));
  const state = { handedness: 'left', inputSource: { gamepad: { buttons } } };
  buttons[5].pressed = true;
  assert.equal(placementRotateDown(state), false);
  buttons[4].pressed = true;
  assert.equal(placementRotateDown(state), true);
  state.handedness = 'right'; buttons[5].pressed = false;
  assert.equal(placementRotateDown(state), false);
  buttons[5].pressed = true;
  assert.equal(placementRotateDown(state), true);
});

let templates;
async function fixture(options = {}) {
  if (!templates) {
    templates = {};
    for (const type of Object.keys(BUILDING_PIECES)) {
      const load = async suffix => {
        const data = await readFile(new URL(`../public/models/building/${type}${suffix}.glb`, import.meta.url));
        const model = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
        return model.scene;
      };
      templates[type] = { visual: await load(''), collider: await load('_collider') };
    }
  }
  return createBuildings({ scene: new THREE.Scene(), heightAt: () => 0, templates, ...options });
}

test('all nine existing kit pieces are placeable and craft atomically from gathered resources', () => {
  importInventoryItems([]);
  for (const [type, definition] of Object.entries(BUILDING_PIECES)) {
    assert.equal(ITEMS[type].placeable, true);
    const before = getInventoryItems();
    assert.equal(craftItem(type), false);
    assert.deepEqual(getInventoryItems(), before);
    for (const [resource, count] of Object.entries(definition.ingredients)) addInventoryItem(resource, count);
    assert.equal(craftItem(type), true);
    assert.equal(getInventoryCount(type), 1);
    for (const resource of Object.keys(definition.ingredients)) assert.equal(getInventoryCount(resource), 0);
  }
  importInventoryItems([]);
});

test('adjoining foundations and walls join a rotated local grid at the same height', () => {
  const base = part('foundation', 31.4, 8.12, -27.8, Math.PI / 2);
  const next = buildingCandidates('foundation', [base]).find(p => p.x < base.x);
  near(next.x, base.x - 3); near(next.y, base.y); near(next.z, base.z);
  assert.equal(buildingOccupied(next, [base]), false);
  assert.equal(buildingOccupied({ ...next, x: base.x }, [base]), true);
  for (const wall of buildingCandidates('wall', [base])) {
    near(Math.hypot(wall.x - base.x, wall.z - base.z), 1.5);
    near(wall.y, base.y);
  }
  const terrain = foundationSite(0, 0, Math.PI / 2, (x, z) => x * 0.02 + z * 0.01);
  assert.equal(terrain.ok, true); near(terrain.y, 0.645);
  assert.equal(foundationSite(0, 0, 0, x => x).ok, false);
});

test('upper floors and stair tops meet exactly, through every rotation', () => {
  for (const yaw of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const floor = part('floor', 10, 3.12, -5, yaw);
    for (const turn of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      for (const stairs of buildingCandidates('stairs', [floor], turn).filter(p => p.y < floor.y)) {
        const top = buildingPoint(stairs, 0, 3, -3);
        near(top.x, stairs.pick.x); near(top.y, stairs.pick.y); near(top.z, stairs.pick.z);
      }
    }
    const wall = buildingCandidates('wall', [floor])[0];
    const above = buildingCandidates('floor', [{ ...wall, id: 2 }])[0];
    near(above.y, floor.y + 3);
  }
});

test('flat roofs join edge to edge and remain level through every rotation', () => {
  for (const yaw of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const roof = part('roof', 4, 3.12, 6, yaw);
    const candidates = buildingCandidates('roof', [roof]);
    const opposite = candidates.find(p => Math.abs(p.x - roof.x) > 5 || Math.abs(p.z - roof.z) > 5);
    const firstHigh = buildingPoint(roof, 0, 0, -3);
    const secondHigh = buildingPoint(opposite, 0, 0, -3);
    near(firstHigh.x, secondHigh.x); near(firstHigh.y, secondHigh.y); near(firstHigh.z, secondHigh.z);
    near(Math.hypot(candidates[0].x - roof.x, candidates[0].z - roof.z), 3);
    for (const z of [-0.1, -1.5, -2.9]) {
      const p = buildingPoint(roof, 0, 0, z);
      near(buildingSurface([roof], p.x, p.z, roof.y, 0), roof.y);
    }
  }
});

test('the exported roof model and collider are flat, with level walking and arrow collision', async () => {
  const world = await fixture();
  for (const model of [world.createPreview('roof'), templates.roof.collider]) {
    const bounds = new THREE.Box3().setFromObject(model);
    near(bounds.max.y, 0); near(bounds.min.y, -0.16);
    near(bounds.min.x, -1.5); near(bounds.max.x, 1.5);
    near(bounds.min.z, -3); near(bounds.max.z, 0);
  }
  const roof = part('roof', 0, 3.6, 0);
  world.place(roof, { restore: true });
  for (const z of [-0.1, -1.5, -2.9]) {
    near(world.surfaceAt(0, z, 3.6, 0), 3.6);
    assert.ok(world.hitTest({ x: 0, y: 3.55, z }));
    assert.equal(world.hitTest({ x: 0, y: 4, z }), null);
  }
});

test('standing under an upper floor does not teleport you onto it; steps can be walked up', async () => {
  const foundation = part('foundation');
  const upper = part('floor', 0, 3.12, 0, 0, 2);
  near(buildingSurface([foundation, upper], 0, 0, 0.12, 0), 0.12);
  near(buildingSurface([foundation, upper], 0, 0, 3.12, 0), 3.12);
  const world = await fixture();
  world.place(part('stairs', 0, 0, 0), { restore: true });
  let x = 0, z = 0.5, y = 0;
  for (let i = 0; i < 80; i++) {
    const moved = world.move(x, z, x, z - 0.05, y);
    ({ x, z, y } = moved);
  }
  assert.ok(z < -3.1, `got stuck on stairs at ${z}`);
  // Leaving the top falls back to the ground; the last tread itself is exactly 3 m high.
  near(world.surfaceAt(0, -2.98, 3, 0), 3);
});

test('aiming at a future surface selects its unoccupied snap, including an upper balcony', async () => {
  const world = await fixture();
  world.place(part('foundation', 0, 0.6, 0, Math.PI / 2), { restore: true });
  world.place(part('foundation', 3, 0.6, 0, Math.PI, 2), { restore: true });
  const origin = new THREE.Vector3(0, 1.68, -7);
  const direction = new THREE.Vector3(0, 0.12, -3).sub(origin).normalize();
  const aim = world.aimSite('foundation', { origin, direction, head: origin, ground: { x: 0, z: -2.6 } });
  near(aim.x, 0); near(aim.z, -3);
  assert.equal(world.canPlace(aim).ok, true);
  world.place(part('wall', -1.5, 0.12, 0, -Math.PI / 2, 3), { restore: true });
  origin.set(-5.5, 1.68, 0);
  direction.set(-3, 3.12, 0).sub(origin).normalize();
  const balcony = world.aimSite('floor', { origin, direction, head: origin, ground: { x: -3.9, z: 0 } });
  near(balcony.x, -3); near(balcony.y, 3.12); near(balcony.z, 0);
});

test('walls stop fast movement, a doorway stays open, and only the swinging door blocks it', async () => {
  const world = await fixture();
  world.place(part('foundation'), { restore: true });
  world.place(part('wall_door', 0, 0.12, -1.5, 0, 2), { restore: true });
  const doorSite = buildingCandidates('door', world.list())[0];
  near(doorSite.x, -0.6); near(doorSite.z, -1.5);
  assert.equal(pushOutOfBuildings(world.list(), 0, -1.5, 0.12), null);
  const door = world.place(doorSite);
  const blocked = world.move(0, -0.8, 0, -2.2, 0.12);
  assert.ok(blocked.z >= -1.5 + 0.23, `tunnelled through the door: ${blocked.z}`);
  assert.ok(world.hitTest({ x: 0, y: 1, z: -1.5 }, 0.01));
  assert.equal(world.toggleDoor(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(0, -0.2, -1).normalize()), true);
  for (let i = 0; i < 90; i++) world.update(1 / 90);
  assert.equal(door.open, true);
  assert.equal(world.hitTest({ x: 0, y: 1, z: -1.5 }, 0.01), null);
  const through = world.move(0, -0.8, 0, -2.2, 0.12);
  assert.ok(through.z < -2.1);
  const wall = part('wall', 0, 0.12, 0);
  assert.ok(pushOutOfBuildings([wall], 0, 0, 0.12));
  world.place(part('wall', 3, 0.12, -1.5, 0, 4), { restore: true });
  assert.ok(world.move(3, 0, 3, -3, 0.12).z > -1.5);
});

test('the actual kit loads, renders by instancing, rejects occupied or steep sites, and saves complete poses', async () => {
  const world = await fixture();
  assert.equal(world.ready, true);
  for (const type of Object.keys(BUILDING_PIECES)) assert.ok(world.createPreview(type)?.isObject3D);
  const site = part('foundation', 0, foundationSite(0, 0, 0, () => 0).y);
  assert.equal(world.canPlace(site).ok, true);
  assert.equal(world.canPlace(part('foundation')).ok, false, 'reject a foundation whose stone base would be buried');
  assert.equal(world.canPlace({ ...site, y: 1.1 }).ok, false, 'reject a base floating above the terrain');
  world.place(site);
  assert.equal(world.blocksGrass(0, 0, 0), true);
  assert.equal(world.blocksGrass(20, 0, 0), false);
  assert.equal(world.canPlace(site).ok, false);
  world.place(part('wall_door', 0, 0.12, -1.5, Math.PI, 2), { restore: true });
  const door = buildingCandidates('door', world.list())[0];
  world.place(door, { open: true });
  const snapshot = world.snapshot();
  const saved = cleanSave({ version: SAVE.version, buildings: snapshot, player: { x: 0, y: 3.12, z: 0 } });
  near(saved.player.y, 3.12);
  assert.deepEqual(saved.buildings, snapshot);
  const restored = await fixture(); restored.restore(saved.buildings);
  assert.deepEqual(restored.snapshot(), snapshot);
  const meshes = world.group.children.filter(o => o.isInstancedMesh && o.count);
  assert.ok(meshes.length && meshes.every(o => o.instanceMatrix.version > 0));
  assert.equal((await fixture({ heightAt: x => x })).canPlace(site).ok, false);
  assert.equal((await fixture({ isWater: () => true })).canPlace(site).ok, false);
  assert.deepEqual(cleanBuildings([{ type: 'wall', x: NaN, y: 0, z: 0, yaw: 0 }, { type: 'unknown', x: 0, y: 0, z: 0, yaw: 0 }]), []);
});
