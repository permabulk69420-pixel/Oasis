import * as THREE from 'three';
import { buildLooseCrystal, buildFibreBundle } from './find-shapes.js';
import { registerDropSpawner } from './resource-drops.js';
import { setGripSurface } from './grip-contact.js';

// The two things you pick up that come from mining: a glowing crystal shard and a bundle of fibre cut from a spire plant. They are
// ordinary loose resources: the crystal lives in the loose stones' group and is picked up, carried to the chest and dropped just like a
// stone (src/stones.js); the fibre lives in the sticks' group and is handled like a stick or a log (src/sticks.js). Both are registered
// as drop spawners (src/resource-drops.js), which is how src/mining.js makes them appear.

const CRYSTAL_VARIANTS = 4;
const FIBRE_VARIANTS = 3;
export const LOOSE_FINDS = Object.freeze({
  crystalBottom: -0.085, // where the foot of the shard is in its own model space (so it can stand on the ground)
  fibreBottom: -0.0275, // the cord ring's radius: the bundle lies on that
  restHeight: 0.004,
});

export function createCrystalPickup(geometry, material, index = 0) {
  const crystal = new THREE.Group();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Crystal';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  crystal.add(mesh);
  crystal.name = `Loose crystal ${index}`;
  crystal.userData.collectibleResource = 'crystal';
  crystal.userData.looseStone = true; // picked up by the stone hands (src/stones.js)
  crystal.userData.sourceBottom = LOOSE_FINDS.crystalBottom;
  crystal.userData.gripProfile = 'medium';
  crystal.userData.held = false;
  setGripSurface(crystal, { meshes: ['Crystal'], point: [0, 0, 0] });
  return crystal;
}

export function createFibrePickup(geometry, material, index = 0) {
  const fibre = new THREE.Group();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Fibre';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  fibre.add(mesh);
  fibre.name = `Loose fibre ${index}`;
  fibre.userData.collectibleResource = 'fibre';
  fibre.userData.looseStick = true; // picked up by the stick hands (src/sticks.js)
  fibre.userData.sourceBottom = LOOSE_FINDS.fibreBottom;
  fibre.userData.gripProfile = 'medium';
  fibre.userData.held = false;
  setGripSurface(fibre, { meshes: ['Fibre'], axis: [1, 0, 0], alignAxis: [1, 0, 0], point: [0, 0, 0] });
  return fibre;
}

function placeOnGround(object, x, z, yaw, heightAt) {
  object.position.set(x, heightAt(x, z) - object.userData.sourceBottom * (object.scale.x || 1) + LOOSE_FINDS.restHeight, z);
  object.rotation.set(0, yaw, 0);
  object.userData.groundYaw = yaw;
  object.updateMatrixWorld(true);
}

// Registers the 'crystal' and 'fibre' drop spawners. `stonesGroup` and `sticksGroup` are the scene's loose-resource groups.
export function registerLooseFindDrops({ stonesGroup, sticksGroup, materials, heightAt }) {
  const crystalGeometries = Array.from({ length: CRYSTAL_VARIANTS }, (_, i) => buildLooseCrystal(i + 1));
  const fibreGeometries = Array.from({ length: FIBRE_VARIANTS }, (_, i) => buildFibreBundle(i + 1));
  let crystals = 0, fibres = 0;
  registerDropSpawner('crystal', (x, z, yaw) => {
    const index = crystals++;
    const crystal = createCrystalPickup(crystalGeometries[index % CRYSTAL_VARIANTS], materials.crystal, index);
    crystal.scale.setScalar(0.9 + (index % 3) * 0.12);
    stonesGroup.add(crystal);
    placeOnGround(crystal, x, z, yaw, heightAt);
    return crystal;
  });
  registerDropSpawner('fibre', (x, z, yaw) => {
    const index = fibres++;
    const fibre = createFibrePickup(fibreGeometries[index % FIBRE_VARIANTS], materials.fibre, index);
    sticksGroup.add(fibre);
    placeOnGround(fibre, x, z, yaw, heightAt);
    return fibre;
  });
  return { crystalGeometries, fibreGeometries };
}
