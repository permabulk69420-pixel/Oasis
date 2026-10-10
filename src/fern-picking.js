import * as THREE from 'three';
import { addInventoryItem } from './inventory.js';
import { pulseHaptics } from './haptics.js';
import { nearestReadyFern, rollFibre } from './fern-harvest.js';

const GRIP_BUTTON = 1;
const PULL_HAPTIC_STRENGTH = 0.45;
const PULL_HAPTIC_MS = 70;

// Squeeze the grip with an empty hand in a green fern and you pull fibre off it (rules in src/fern-harvest.js). It goes straight into your
// inventory, with nothing to pick up off the ground. Run it after the hands' own update, so a hand that just grabbed a stone, a tool or a fruit
// (it then holds something) is left alone.
export function createFernPicking({ states, greenFerns }) {
  const gripDown = new Map();
  const hand = new THREE.Vector3();

  function update(dt) {
    greenFerns.tick(dt);
    for (const state of states) {
      const grip = Boolean(state.inputSource?.gamepad?.buttons?.[GRIP_BUTTON]?.pressed);
      const wasDown = Boolean(gripDown.get(state));
      gripDown.set(state, grip);
      if (!grip || wasDown || !state.objectGrip || state.objectGrip.children.length > 0) continue;
      state.objectGrip.updateWorldMatrix(true, false);
      state.objectGrip.getWorldPosition(hand);
      const fern = nearestReadyFern(greenFerns.ferns, hand.x, hand.y, hand.z);
      if (!fern) continue;
      greenFerns.pull(fern);
      addInventoryItem('fibre', rollFibre());
      pulseHaptics(state, PULL_HAPTIC_STRENGTH, PULL_HAPTIC_MS);
    }
  }

  return { update };
}
