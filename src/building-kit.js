// Dimensions and origins belong to the existing Blender kit, in metres (+Y up, north -Z).
export const BUILDING = Object.freeze({ grid: 3, wallHeight: 3, snapRange: 1.8, maxPieces: 256, perType: 128, stepHeight: 0.32, playerRadius: 0.23 });

const piece = (name, description, ingredients) => Object.freeze({ name, description, ingredients: Object.freeze(ingredients) });
export const BUILDING_PIECES = Object.freeze({
  foundation: piece('Foundation', 'A stone base with a timber floor. Place on fairly level ground; adjoining foundations snap together.', { wood: 4, stone: 4 }),
  floor: piece('Floor', 'A timber floor. Snap beside a foundation or floor, or onto the top of a wall for an upper storey.', { wood: 3, fibre: 2 }),
  wall: piece('Wall', 'A timber wall. Snap to a foundation or floor edge, or stack on another wall.', { wood: 3, fibre: 2 }),
  wall_door: piece('Doorway', 'A wall with a door opening. Snap to a floor edge, then fit a door into it.', { wood: 3, fibre: 2 }),
  wall_window: piece('Window wall', 'A timber wall with a barred window. Snap to a foundation or floor edge.', { wood: 3, fibre: 2 }),
  door: piece('Door', 'Fit into a doorway. Point and pull the trigger to open or close it; desktop: F.', { wood: 2, fibre: 2 }),
  roof: piece('Roof', 'A sloping timber roof. Snap onto a wall top; opposite slopes meet at the ridge.', { wood: 3, fibre: 3 }),
  stairs: piece('Stairs', 'Timber stairs between storeys. Snap the bottom or top to a floor edge; rotate to choose the direction.', { wood: 4, fibre: 2 }),
  pillar: piece('Pillar', 'A timber support. Snap to floor corners or stack on another pillar.', { wood: 2, fibre: 1 }),
});

export const BUILDING_START_KIT = Object.freeze({ foundation: 4, floor: 4, wall: 6, wall_door: 1, wall_window: 1, door: 1, roof: 4, stairs: 1, pillar: 2 });
export const isBuildingPiece = type => Object.prototype.hasOwnProperty.call(BUILDING_PIECES, type);
export const isTile = type => type === 'foundation' || type === 'floor';
export const isWall = type => ['wall', 'wall_door', 'wall_window'].includes(type);
export const quarterTurn = yaw => Math.round(yaw / (Math.PI / 2)) * Math.PI / 2;

export function buildingPoint(part, x, y, z) {
  const c = Math.cos(part.yaw), s = Math.sin(part.yaw);
  return { x: part.x + c * x + s * z, y: part.y + y, z: part.z - s * x + c * z };
}

export function foundationSite(x, z, yaw, heightAt) {
  let low = Infinity, high = -Infinity;
  const part = { x, y: 0, z, yaw };
  for (const dx of [-1.5, -0.75, 0, 0.75, 1.5]) for (const dz of [-1.5, -0.75, 0, 0.75, 1.5]) {
    const p = buildingPoint(part, dx, 0, dz), h = heightAt(p.x, p.z);
    if (!Number.isFinite(h)) return { low: 0, high: 0, y: 0, ok: false };
    low = Math.min(low, h); high = Math.max(high, h);
  }
  return { low, high, y: high + 0.12, ok: high - low <= 0.85 };
}

// Keep the complete pose, including storey height and the hinge's current angle. Old saves have no building part.
export function cleanBuildings(list) {
  if (!Array.isArray(list)) return undefined;
  const out = [], ids = new Set();
  for (const part of list.slice(0, BUILDING.maxPieces)) {
    if (!part || !isBuildingPiece(part.type) || ![part.x, part.y, part.z, part.yaw].every(Number.isFinite)) continue;
    if (Math.abs(part.x) > 2100 || Math.abs(part.z) > 2100 || part.y < -100 || part.y > 1000) continue;
    const id = Number.isSafeInteger(part.id) && part.id > 0 ? part.id : out.length + 1;
    if (ids.has(id)) continue;
    ids.add(id);
    const saved = { id, type: part.type, x: part.x, y: part.y, z: part.z, yaw: quarterTurn(part.yaw) };
    if (part.type === 'door') saved.open = part.open === true;
    out.push(saved);
  }
  return out;
}
