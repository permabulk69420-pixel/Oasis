const counts = new Map();

// Abstract carry-weight units for now. The backpack/slot system can be layered on later
// without changing how resources are stored in this shared inventory pool.
export const BASE_CARRY_WEIGHT = 100;
export const MAX_ENCUMBERED_WEIGHT = 200;

const DEFAULT_ITEM_WEIGHT = 1;
const ITEM_WEIGHTS = Object.freeze({
  stick: 4,
  stone: 8,
  fibre: 1,
});

export function addInventoryItem(type, amount = 1) {
  if (typeof type !== 'string' || !type) return 0;
  const delta = Math.max(0, Math.floor(Number(amount) || 0));
  const current = counts.get(type) || 0;
  if (delta <= 0) return current;
  const next = current + delta;
  counts.set(type, next);
  return next;
}

export function getInventoryCount(type) {
  return counts.get(type) || 0;
}

export function getInventoryItemWeight(type) {
  return ITEM_WEIGHTS[type] ?? DEFAULT_ITEM_WEIGHT;
}

export function getInventoryWeight() {
  let total = 0;
  for (const [type, count] of counts) {
    total += count * getInventoryItemWeight(type);
  }
  return total;
}

export function getCarrySpeedMultiplier(weight = getInventoryWeight()) {
  const carried = Math.max(0, Number(weight) || 0);
  if (carried <= BASE_CARRY_WEIGHT) return 1;
  if (carried >= MAX_ENCUMBERED_WEIGHT) return 0;

  // Crossing 100 units immediately halves locomotion speed, then the penalty
  // increases linearly until the player can no longer walk at 200 units.
  const overload = (carried - BASE_CARRY_WEIGHT)
    / (MAX_ENCUMBERED_WEIGHT - BASE_CARRY_WEIGHT);
  return 0.5 * (1 - overload);
}
