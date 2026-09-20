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
  axe: 10,
  torch: 5,
});

export function addInventoryItem(type, amount = 1) {
  if (typeof type !== 'string' || !type) return 0;
  const value = Number(amount);
  const delta = Number.isSafeInteger(value) && value > 0 ? value : 0;
  const current = counts.get(type) || 0;
  if (delta <= 0) return current;
  const next = current + delta;
  if (!Number.isSafeInteger(next)) return current;
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

// Snapshot keeps callers from mutating the shared resource pool.
export function getInventoryItems() {
  return Array.from(counts, ([type, count]) => ({ type, count }));
}

// Validate the whole transaction before touching any count: no partial spending.
export function exchangeInventoryItems(cost, output) {
  const spent = Object.entries(cost);
  const gained = Object.entries(output);
  if (!spent.length || !gained.length) return false;
  for (const [type, amount] of [...spent, ...gained]) {
    if (!type || !Number.isSafeInteger(amount) || amount <= 0) return false;
  }
  if (spent.some(([type, amount]) => getInventoryCount(type) < amount)) return false;
  const next = new Map(counts);
  for (const [type, amount] of spent) next.set(type, (next.get(type) || 0) - amount);
  for (const [type, amount] of gained) {
    const total = (next.get(type) || 0) + amount;
    if (!Number.isSafeInteger(total)) return false;
    next.set(type, total);
  }
  counts.clear();
  for (const [type, count] of next) if (count > 0) counts.set(type, count);
  return true;
}

export function removeInventoryItem(type, amount = 1) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || getInventoryCount(type) < amount) return false;
  const remaining = getInventoryCount(type) - amount;
  if (remaining) counts.set(type, remaining);
  else counts.delete(type);
  return true;
}
