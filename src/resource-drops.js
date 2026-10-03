// Lets one system (chopping) spawn loose resources owned by another (sticks, logs)
// without either importing the other's internals. Spawners register once loaded.
const spawners = new Map();

export function registerDropSpawner(type, spawn) {
  spawners.set(type, spawn);
}

export function spawnDrop(type, x, z, yaw = 0) {
  const spawn = spawners.get(type);
  return spawn ? spawn(x, z, yaw) : null;
}

export function hasDropSpawner(type) {
  return spawners.has(type);
}
