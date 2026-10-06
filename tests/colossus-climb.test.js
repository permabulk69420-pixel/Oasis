import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createColossusClimb, nearestOnHold } from '../src/colossus-climb.js';

// Climbing the Colossus: a squeeze by a crystal grabs it; pulling the hand down lifts you; you ride with the bone; letting go lets go.
function rigWithHand() {
  const rig = new THREE.Group();
  const grip = new THREE.Group(); rig.add(grip);
  const handAnchor = new THREE.Group(); grip.add(handAnchor);
  const handRoot = new THREE.Group(); handAnchor.add(handRoot);
  const gripSocket = new THREE.Object3D(); handRoot.add(gripSocket);
  const objectGrip = new THREE.Group(); grip.add(objectGrip);
  const buttons = [{ pressed: false }, { pressed: false }];
  const state = { grip, handAnchor, handRoot, gripSocket, objectGrip, handedness: 'right', inputSource: { gamepad: { buttons, hapticActuators: [] } } };
  return { rig, state, buttons };
}

test('nearestOnHold measures the gap to a tapered crystal', () => {
  const hold = { centre: new THREE.Vector3(0, 0, 0), axis: new THREE.Vector3(0, 1, 0), length: 0.46, radius: 0.12 };
  const out = new THREE.Vector3();
  const gap = nearestOnHold(hold, new THREE.Vector3(0.2, 0, 0), out);
  assert.ok(gap > 0.05 && gap < 0.12, `gap ${gap}`);
  assert.ok(out.x > 0.05 && out.x < 0.13 && Math.abs(out.y) < 1e-9);
});

test('grab, pull up, ride along, let go', async () => {
  const root = new THREE.Group();
  const bone = new THREE.Bone(); bone.name = 'spine_01'; bone.position.set(0, 2, -0.6); root.add(bone);
  const data = { bones: ['spine_01'], holds: [[0, 0, 0, 0, 0, 1, 0, 0.46, 0.12]] };
  const { rig, state, buttons } = rigWithHand();
  // the hand just beside the crystal (its axis is vertical through the bone, 0.12 m thick at the base)
  state.grip.position.set(0.2, 2, -0.6);
  rig.updateMatrixWorld(true); root.updateMatrixWorld(true);
  const climb = createColossusClimb({ states: [state], getRoot: () => root, getDistance: () => 10, data });
  await climb.ready;
  const head = new THREE.Vector3(0, 1.7, 0);
  assert.equal(climb.update(1 / 60, { rig, head }).climbing, false);
  buttons[1].pressed = true;
  assert.equal(climb.update(1 / 60, { rig, head }).climbing, true, 'grabbed');
  const y0 = rig.position.y;
  // pull the hand down 30 cm: you go up 30 cm
  state.grip.position.y -= 0.3;
  climb.update(1 / 60, { rig, head });
  assert.ok(Math.abs(rig.position.y - y0 - 0.3) < 1e-6, `rose ${rig.position.y - y0}`);
  // the Colossus walks a metre: you go with it
  const x0 = rig.position.x;
  bone.position.x += 1; root.updateMatrixWorld(true);
  climb.update(1 / 60, { rig, head });
  assert.ok(Math.abs(rig.position.x - x0 - 1) < 1e-6, `carried ${rig.position.x - x0}`);
  // the drawn hand is at the crystal's end, front on (here, with no contact solver, the stand-in's middle on the socket: 12 cm out from the end)
  const palm = state.gripSocket.getWorldPosition(new THREE.Vector3());
  const tip = new THREE.Vector3(bone.position.x, bone.position.y + 0.55 * 0.46 - 0.03, bone.position.z);
  assert.ok(Math.abs(palm.x - tip.x) < 0.05 && Math.abs(palm.z - tip.z) < 0.05, `the drawn hand is over the crystal's end (${palm.toArray().map(v => v.toFixed(2))})`);
  assert.ok(palm.y < tip.y + 0.02 && palm.y > tip.y - 0.2, 'and down on it');
  assert.equal(state.objectGrip.children.length, 1, 'the hand holds the crystal (its fitting bar)');
  // let go
  buttons[1].pressed = false;
  assert.equal(climb.update(1 / 60, { rig, head }).climbing, false);
  assert.equal(state.handAnchor.position.length(), 0, 'the hand model is back on the controller');
  assert.equal(state.objectGrip.children.length, 0, 'and holds nothing');
});

test('a squeeze too far from any crystal grabs nothing', async () => {
  const root = new THREE.Group();
  const bone = new THREE.Bone(); bone.name = 'spine_01'; root.add(bone);
  const { rig, state, buttons } = rigWithHand();
  state.grip.position.set(0.6, 0, 0);
  rig.updateMatrixWorld(true); root.updateMatrixWorld(true);
  const climb = createColossusClimb({ states: [state], getRoot: () => root, data: { bones: ['spine_01'], holds: [[0, 0, 0, 0, 0, 1, 0, 0.46, 0.12]] } });
  await climb.ready;
  buttons[1].pressed = true;
  assert.equal(climb.update(1 / 60, { rig, head: new THREE.Vector3() }).climbing, false);
});
