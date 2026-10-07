import * as THREE from 'three';
import { SPAWN } from './world.js';
import { setGripSurface } from './grip-contact.js';

export const BOW = Object.freeze({
  url: `${import.meta.env?.BASE_URL ?? '/'}models/bow/bow.glb`,
  spawn: Object.freeze({ x: SPAWN.x + 1.25, z: SPAWN.z - 2.1 }),
  fullDraw: 0.65,
  minDraw: 0.08,
});
export const BOW_GRIP = Object.freeze({ meshes: ['bow_mesh'], axis: [0, 1, 0], point: [0, 0, 0], halfLength: 0.052 });
export const BOW_HELD_ROTATION = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);

function socket(root, name) {
  const marker = root.getObjectByName(name);
  if (!marker) throw new Error(`Bow is missing its ${name} marker.`);
  return root.worldToLocal(marker.getWorldPosition(new THREE.Vector3()));
}

// The mesh has a Draw morph, but its marker empties do not follow that morph. The string
// interpolates the authored rest/drawn tip markers and passes through the actual nock.
export function setBowDraw(instance, draw = 0, nock = null) {
  const state = instance.state;
  if (!state.sockets) return;
  const amount = THREE.MathUtils.clamp(draw / BOW.fullDraw, 0, 1);
  for (const mesh of state.limbs) mesh.morphTargetInfluences[mesh.morphTargetDictionary.Draw] = amount;
  const positions = state.string.geometry.attributes.position;
  state.end.copy(state.sockets.top).lerp(state.sockets.topDrawn, amount);
  positions.setXYZ(0, state.end.x, state.end.y, state.end.z);
  const middle = nock || state.sockets.nock;
  positions.setXYZ(1, middle.x, middle.y, middle.z);
  state.end.copy(state.sockets.bottom).lerp(state.sockets.bottomDrawn, amount);
  positions.setXYZ(2, state.end.x, state.end.y, state.end.z);
  positions.needsUpdate = true;
}

export function createBowKind() {
  return {
    id: 'bow', name: 'Bow', url: BOW.url,
    groundBottom: 0.63, pickupRadius: 0.48, heldRotation: BOW_HELD_ROTATION,
    holster: { dir: [0.12, 1, 0.25], along: 0.12 },
    fall: { radius: 0.045, landing: 'lie', com: 0 },
    spawns: [BOW.spawn],
    prepare(instance) {
      const { root, state } = instance;
      setGripSurface(root, BOW_GRIP);
      root.updateWorldMatrix(true, true);
      state.sockets = {
        top: socket(root, 'string_top'), bottom: socket(root, 'string_bottom'),
        topDrawn: socket(root, 'string_top_drawn'), bottomDrawn: socket(root, 'string_bottom_drawn'),
        nock: socket(root, 'nock_rest'), rest: socket(root, 'arrow_rest'),
      };
      // An arrow sits at the rest's height, slightly to the side of the riser.
      state.sockets.nock.x = state.sockets.rest.x;
      state.sockets.nock.y = state.sockets.rest.y;
      state.limbs = [];
      state.end = new THREE.Vector3();
      root.traverse(mesh => {
        if (!mesh.isMesh) return;
        mesh.castShadow = mesh.receiveShadow = false;
        if (mesh.morphTargetDictionary?.Draw !== undefined) state.limbs.push(mesh);
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
      state.string = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xe8dcc0 }));
      state.string.name = 'Bow string';
      state.string.frustumCulled = false;
      root.add(state.string);
      setBowDraw(instance);
    },
    onDispose(instance) {
      instance.state.string.geometry.dispose();
      instance.state.string.material.dispose();
    },
  };
}
