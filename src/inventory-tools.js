import { createHeldAxe } from './axe.js';
import { createHeldTorch } from './torch.js';
import { getInventoryCount, removeInventoryItem } from './inventory.js';
import { pulseHaptics } from './haptics.js';

export function createInventoryTools({ scene, states, onError = console.warn }) {
  const factories = { axe: createHeldAxe, torch: createHeldTorch };
  const active = [];
  const reserve = new Map();
  function prepare(type) {
    const tool = factories[type]({ scene, states, onError, spawnOnGround: false });
    reserve.set(type, tool);
    return tool;
  }
  // Load off-scene so a finished hold can equip immediately, without spawning
  // extra starter pickups or taking an item before its model is available.
  prepare('axe'); prepare('torch');
  return {
    equip(type, state) {
      if (!Object.hasOwn(factories, type) || getInventoryCount(type) < 1) return { ok: false, message: 'That item is no longer in your inventory.' };
      if (!state?.inputSource?.gamepad?.buttons[1]?.pressed) return { ok: false, message: 'Hold grip to equip.' };
      if (!state.objectGrip || state.objectGrip.children.length) return { ok: false, message: 'Free this hand first.' };
      const tool = reserve.get(type) || prepare(type);
      if (!tool.getObject()) return { ok: false, message: 'Tool model is not ready. Release grip and try again.' };
      if (!tool.equip(state)) return { ok: false, message: 'Could not equip into this hand.' };
      // Synchronous hand attachment and decrement: no async gap for a second hand
      // to consume the same item. The checks above leave failed attempts untouched.
      removeInventoryItem(type);
      active.push(tool); reserve.delete(type);
      if (getInventoryCount(type) > 0) prepare(type);
      pulseHaptics(state, 0.45, 65);
      return { ok: true };
    },
    update(dt) {
      for (const tool of active) tool.update(dt);
      for (const type of ['axe', 'torch']) {
        if (getInventoryCount(type) > 0 && !reserve.has(type)) prepare(type);
      }
    },
  };
}
