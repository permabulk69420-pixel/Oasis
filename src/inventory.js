import { BUILDING_PIECES } from './building-kit.js';

const counts = new Map();

// Abstract carry-weight units. Everything you carry is one shared pool; what changes is how much of it you can
// carry before it slows you down. Your pockets take a little. A backpack you have put on (src/backpack.js)
// adds a lot, so with the pack the limit is the old flat 100.
export const POCKET_CARRY_WEIGHT = 40;
export const PACK_CARRY_BONUS = 60;
// Over the limit you walk at half speed, easing off to a standstill at this many times the limit.
export const ENCUMBERED_FACTOR = 2;

let packWorn = false;

const DEFAULT_ITEM_WEIGHT = 1;
const ITEM_WEIGHTS = Object.freeze({
  stick: 4,
  stone: 8,
  wood: 6,
  fibre: 1,
  axe: 10,
  torch: 5,
  spear: 10,
  pickaxe: 12,
  crystal: 4,
  campfire: 25,
  glider: 15,
  bow: 8,
  // The owner is testing buildings with a starter kit. Its pieces must not immobilise the player
  // (the existing campfire and glider already fill the pockets). Balance their carry weight later.
  ...Object.fromEntries(Object.keys(BUILDING_PIECES).map(type => [type, 0])),
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

// Take items out of the inventory (e.g. a tool moving to a hip slot). All or nothing.
export function removeInventoryItem(type, amount = 1) {
  const value = Number(amount);
  if (typeof type !== 'string' || !Number.isSafeInteger(value) || value <= 0) return false;
  const current = counts.get(type) || 0;
  if (current < value) return false;
  if (current === value) counts.delete(type);
  else counts.set(type, current - value);
  return true;
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

// Whether the backpack is on your back. Only src/backpack.js and the tests change it.
export function setPackWorn(value) {
  packWorn = Boolean(value);
  return packWorn;
}

export function isPackWorn() {
  return packWorn;
}

// How much you can carry before it slows you down.
export function getCarryCapacity(worn = packWorn) {
  return POCKET_CARRY_WEIGHT + (worn ? PACK_CARRY_BONUS : 0);
}

// At this much you cannot walk at all.
export function getMaxCarryWeight(worn = packWorn) {
  return getCarryCapacity(worn) * ENCUMBERED_FACTOR;
}

// The pack can only come off when everything in the inventory fits in your pockets, so taking it off never
// leaves you slowed or stuck.
export function canTakeOffPack() {
  return getInventoryWeight() <= getCarryCapacity(false);
}

export function getCarrySpeedMultiplier(weight = getInventoryWeight(), capacity = getCarryCapacity()) {
  const carried = Math.max(0, Number(weight) || 0);
  const limit = Math.max(1, Number(capacity) || 1);
  if (carried <= limit) return 1;
  const most = limit * ENCUMBERED_FACTOR;
  if (carried >= most) return 0;

  // Crossing the limit immediately halves locomotion speed, then the penalty
  // increases linearly until the player can no longer walk at twice the limit.
  const overload = (carried - limit) / (most - limit);
  return 0.5 * (1 - overload);
}

// Snapshot keeps callers from mutating the shared resource pool.
export function getInventoryItems() {
  return Array.from(counts, ([type, count]) => ({ type, count }));
}

// For the save: the whole pool as plain data, and back again. Whatever is not a sensible count is left out.
export const INVENTORY_LIMITS = Object.freeze({ maxTypes: 64, maxCount: 9999, maxTypeLength: 40 });

export function importInventoryItems(items) {
  counts.clear();
  if (!Array.isArray(items)) return 0;
  for (const item of items) {
    if (counts.size >= INVENTORY_LIMITS.maxTypes) break;
    const type = item?.type;
    const count = Number(item?.count);
    if (typeof type !== 'string' || !type || type.length > INVENTORY_LIMITS.maxTypeLength) continue;
    if (!Number.isSafeInteger(count) || count <= 0) continue;
    counts.set(type, Math.min(INVENTORY_LIMITS.maxCount, (counts.get(type) || 0) + count));
  }
  return counts.size;
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
