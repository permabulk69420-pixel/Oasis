const counts = new Map();

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
