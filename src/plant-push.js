import * as THREE from 'three';
import { PUSH, windPush } from './wind.js';

// Feeds the plants' give-way (src/wind.js, PUSH) with where you are: one point at your feet (under your head, on the floor) and one at each
// hand that is tracked. The shader does the rest. A few numbers written into three shared uniforms a frame, no allocation.
// `?push=0` switches it off in any build (to compare in the headset), `?push=1` forces it on.

const scratch = new THREE.Vector3();

export function pushSettings(search = '') {
  const value = new URLSearchParams(search).get('push');
  return value === '0' ? false : value === '1' ? true : PUSH.enabled;
}

// The pure part, for tests: fills the three uniform points. `feet` is {x, y, z} (y is the floor), `hands` is up to two {x, y, z} or null.
export function setPushPoints(points, feet, hands, enabled = true) {
  const [foot, left, right] = points;
  if (enabled && feet) foot.set(feet.x, feet.y + PUSH.feetHeight, feet.z, PUSH.feetRadius); else foot.set(0, -1000, 0, 0);
  const handPoints = [left, right];
  for (let i = 0; i < 2; i++) {
    const hand = enabled ? hands?.[i] : null;
    if (hand) handPoints[i].set(hand.x, hand.y, hand.z, PUSH.handRadius); else handPoints[i].set(0, -1000, 0, 0);
  }
  return points;
}

export function createPlantPush({ rig, states, enabled = true }) {
  const handSpots = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }];
  const feet = { x: 0, y: 0, z: 0 };
  function update(head) {
    feet.x = head.x; feet.z = head.z; feet.y = rig.position.y;
    const hands = [null, null];
    for (let i = 0; i < 2; i++) {
      const state = states[i];
      if (!state?.inputSource) continue; // not tracked (desktop, or a controller that is off)
      state.grip.getWorldPosition(scratch);
      handSpots[i].x = scratch.x; handSpots[i].y = scratch.y; handSpots[i].z = scratch.z;
      hands[i] = handSpots[i];
    }
    setPushPoints(windPush.value, feet, hands, enabled);
  }
  return { update };
}
