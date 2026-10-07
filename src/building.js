import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { skyLight } from './sky-environment.js';
import { BUILDING, BUILDING_PIECES, isBuildingPiece, isTile, isWall, quarterTurn, buildingPoint, foundationSite, cleanBuildings } from './building-kit.js';

const BASE = import.meta.env?.BASE_URL || './';
const EDGES = [{ x: 0, z: -1.5, yaw: Math.PI }, { x: 1.5, z: 0, yaw: Math.PI / 2 }, { x: 0, z: 1.5, yaw: 0 }, { x: -1.5, z: 0, yaw: -Math.PI / 2 }];
const OPEN_ANGLE = -Math.PI / 2;
const wallBox = [-1.5, 1.5, 0, 3, -0.1, 0.1];
// These boxes match the kit's simple colliders. Door/window gaps remain open; stairs use their actual treads below.
const BOXES = {
  foundation: [[-1.5, 1.5, -1, 0, -1.5, 1.5]], floor: [[-1.5, 1.5, -0.2, 0, -1.5, 1.5]], wall: [wallBox],
  wall_door: [[-1.5, -0.6, 0, 3, -0.1, 0.1], [0.6, 1.5, 0, 3, -0.1, 0.1], [-0.6, 0.6, 2.2, 3, -0.1, 0.1]],
  wall_window: [[-1.5, -0.5, 0, 3, -0.1, 0.1], [0.5, 1.5, 0, 3, -0.1, 0.1], [-0.5, 0.5, 0, 1, -0.1, 0.1], [-0.5, 0.5, 2, 3, -0.1, 0.1]],
  door: [[0, 1.2, 0, 2.2, -0.05, 0.05]], pillar: [[-0.15, 0.15, 0, 3, -0.15, 0.15]],
  stairs: Array.from({ length: 12 }, (_, i) => [-1.5, 1.5, 0, (i + 1) * 0.25, -(i + 1) * 0.25, -i * 0.25]),
};

function localPoint(part, x, z, yaw = part.yaw) {
  const dx = x - part.x, dz = z - part.z, c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: c * dx - s * dz, z: s * dx + c * dz };
}
const angleDistance = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const samePosition = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) < 0.08 && Math.abs(a.y - b.y) < 0.08;

// Candidates use the supplied kit's 3 m grid and snap origins, rather than a global world grid.
export function buildingCandidates(type, parts, turn = 0) {
  const candidates = [];
  const add = (part, x, y, z, yaw, pick = null) => {
    const p = buildingPoint(part, x, y, z);
    candidates.push({ type, ...p, yaw: quarterTurn(part.yaw + yaw), support: part.id, snapped: true, pick: pick ? buildingPoint(part, ...pick) : p });
  };
  for (const part of parts) {
    if (type === 'foundation' && part.type === 'foundation') {
      for (const edge of EDGES) add(part, edge.x * 2, 0, edge.z * 2, turn);
    } else if (type === 'floor') {
      if (isTile(part.type)) for (const edge of EDGES) add(part, edge.x * 2, 0, edge.z * 2, turn);
      if (isWall(part.type)) for (const side of [-1, 1]) add(part, 0, 3, side * 1.5, turn);
      if (part.type === 'stairs') add(part, 0, 3, -4.5, turn, [0, 3, -3]);
      if (part.type === 'pillar') add(part, 0, 3, 0, turn);
    } else if (isWall(type)) {
      const flip = Math.round(turn / (Math.PI / 2)) % 2 * Math.PI;
      if (isTile(part.type)) for (const edge of EDGES) add(part, edge.x, 0, edge.z, edge.yaw + flip);
      if (isWall(part.type)) {
        add(part, 0, 3, 0, flip);
        for (const side of [-1, 1]) add(part, side * 3, 0, 0, flip, [side * 1.5, 1.5, 0]);
      }
    } else if (type === 'door' && part.type === 'wall_door') {
      add(part, -0.6, 0, 0, 0, [0, 1, 0]);
    } else if (type === 'roof') {
      const flip = Math.round(turn / (Math.PI / 2)) % 2 * Math.PI;
      if (isWall(part.type)) add(part, 0, 3, 0, flip);
      if (part.type === 'floor') for (const edge of EDGES) add(part, edge.x, 0, edge.z, edge.yaw + flip);
      if (part.type === 'roof') {
        for (const side of [-1, 1]) add(part, side * 3, 0, 0, 0, [side * 1.5, 0.866, -1.5]);
        const yaw = Math.PI + flip;
        add(part, Math.sin(yaw) * 3, 0, -3 + Math.cos(yaw) * 3, yaw, [0, Math.sqrt(3), -3]);
      }
    } else if (type === 'stairs' && isTile(part.type)) {
      for (const edge of EDGES) {
        add(part, edge.x, 0, edge.z, edge.yaw + turn);
        // The top can join an existing upper floor, with the staircase extending outside it.
        const yaw = edge.yaw + turn;
        add(part, edge.x + Math.sin(yaw) * 3, -3, edge.z + Math.cos(yaw) * 3, yaw, [edge.x, 0, edge.z]);
      }
    } else if (type === 'pillar') {
      if (isTile(part.type)) for (const x of [-1.5, 1.5]) for (const z of [-1.5, 1.5]) add(part, x, 0, z, turn);
      if (part.type === 'pillar') add(part, 0, 3, 0, turn);
    }
  }
  return candidates;
}

export function buildingOccupied(site, parts) {
  for (const part of parts) {
    if (isTile(site.type) && isTile(part.type) && Math.abs(site.y - part.y) < 0.15) {
      // Every turn is a quarter turn, so square tile bounds remain axis aligned.
      if (Math.abs(site.x - part.x) < 2.98 && Math.abs(site.z - part.z) < 2.98) return true;
    } else if (isWall(site.type) && isWall(part.type) && Math.abs(site.y - part.y) < 0.15) {
      const p = localPoint(part, site.x, site.z), a = angleDistance(site.yaw, part.yaw);
      if (Math.min(a, Math.abs(Math.PI - a)) < 0.1 && Math.abs(p.x) < 2.98 && Math.abs(p.z) < 0.15) return true;
      if (Math.abs(a - Math.PI / 2) < 0.1 && Math.abs(p.x) < 1.4 && Math.abs(p.z) < 1.4) return true;
    } else if (site.type === part.type && samePosition(site, part) && (site.type !== 'roof' || angleDistance(site.yaw, part.yaw) < 0.1)) return true;
  }
  return false;
}

// A floor or roof above your head never becomes your ground. The reference is the current height of your feet.
export function buildingSurface(parts, x, z, feetY = Infinity, base = -Infinity, step = BUILDING.stepHeight) {
  let highest = base;
  for (const part of parts) {
    if (!isTile(part.type) && part.type !== 'stairs' && part.type !== 'roof') continue;
    const p = localPoint(part, x, z);
    if (Math.abs(p.x) > 1.5 + 1e-6) continue;
    let y;
    if (isTile(part.type)) {
      if (Math.abs(p.z) > 1.5 + 1e-6) continue;
      y = part.y;
    } else {
      if (p.z > 0 || p.z < -3) continue;
      y = part.y + (part.type === 'roof' ? -p.z / Math.sqrt(3) : Math.min(3, (Math.floor(-p.z / 0.25) + 1) * 0.25));
    }
    if (y <= feetY + step + 1e-6 && y > highest) highest = y;
  }
  return highest;
}

function boxesFor(part) {
  return BOXES[part.type] || [];
}

// Circle against the collider boxes in each piece's local frame, keeping door swings and openings accurate.
export function pushOutOfBuildings(parts, x, z, feetY, height = 1.68, radius = BUILDING.playerRadius) {
  let moved = false;
  for (let pass = 0; pass < 3; pass++) for (const part of parts) {
    if (Math.hypot(x - part.x, z - part.z) > 5) continue;
    const yaw = part.yaw + (part.type === 'door' ? (part.angle ?? (part.open ? OPEN_ANGLE : 0)) : 0);
    let p = localPoint(part, x, z, yaw);
    for (const [minX, maxX, minY, maxY, minZ, maxZ] of boxesFor(part)) {
      if (feetY >= part.y + maxY - 0.02 || feetY + height <= part.y + minY + 0.02) continue;
      // Walk up individual 25 cm stair treads, or a low foundation edge, without climbing through a wall.
      if ((isTile(part.type) || part.type === 'stairs') && part.y + maxY <= feetY + BUILDING.stepHeight) continue;
      const nx = Math.max(minX, Math.min(maxX, p.x)), nz = Math.max(minZ, Math.min(maxZ, p.z));
      let dx = p.x - nx, dz = p.z - nz, distance = Math.hypot(dx, dz);
      if (distance >= radius) continue;
      if (distance < 1e-7) {
        const sides = [p.x - minX, maxX - p.x, p.z - minZ, maxZ - p.z];
        const side = sides.indexOf(Math.min(...sides));
        if (side === 0) p.x = minX - radius; else if (side === 1) p.x = maxX + radius;
        else if (side === 2) p.z = minZ - radius; else p.z = maxZ + radius;
      } else { p.x += dx / distance * (radius - distance); p.z += dz / distance * (radius - distance); }
      const c = Math.cos(yaw), s = Math.sin(yaw);
      x = part.x + c * p.x + s * p.z; z = part.z - s * p.x + c * p.z;
      moved = true;
    }
  }
  return moved ? [x, z] : null;
}

export function createBuildings({ scene, heightAt, getFires = () => [], isWater = () => false, onChange = () => {}, onError = console.warn, templates = null } = {}) {
  const parts = [], models = new Map(), sharedMaterials = new Map();
  const group = new THREE.Group(); group.name = 'Player buildings'; scene.add(group);
  const raycaster = new THREE.Raycaster(), hitPoint = new THREE.Vector3(), projected = new THREE.Vector3(), pick = new THREE.Vector3();
  const colliders = [], colliderMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const dummy = new THREE.Object3D();
  let nextId = 1;

  function install(type, visual, collider) {
    visual.updateMatrixWorld(true); collider.updateMatrixWorld(true);
    visual.traverse(node => {
      if (!node.isMesh) return;
      const list = Array.isArray(node.material) ? node.material : [node.material];
      const materials = list.map(material => {
        if (!sharedMaterials.has(material.name)) sharedMaterials.set(material.name, material);
        return sharedMaterials.get(material.name);
      });
      node.material = Array.isArray(node.material) ? materials : materials[0];
    });
    skyLight(visual);
    const meshes = [], collision = [];
    visual.traverse(node => {
      if (!node.isMesh) return;
      const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
      const mesh = new THREE.InstancedMesh(geometry, node.material, BUILDING.perType);
      mesh.name = `Building ${type}`; mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(mesh); meshes.push(mesh);
    });
    collider.traverse(node => {
      if (node.isMesh) collision.push(node.geometry.clone().applyMatrix4(node.matrixWorld));
    });
    models.set(type, { visual, meshes, collision, count: 0 });
  }
  for (const type of Object.keys(BUILDING_PIECES)) {
    if (templates?.[type]) { install(type, templates[type].visual, templates[type].collider); continue; }
    const loader = new GLTFLoader();
    Promise.all([loader.loadAsync(`${BASE}models/building/${type}.glb`), loader.loadAsync(`${BASE}models/building/${type}_collider.glb`)])
      .then(([visual, collider]) => install(type, visual.scene, collider.scene))
      .catch(error => onError(`[Oasis building] ${type} failed to load: ${error?.message || error}`));
  }

  function updatePose(part) {
    dummy.position.set(part.x, part.y, part.z);
    dummy.rotation.set(0, part.yaw + (part.type === 'door' ? part.angle : 0), 0);
    dummy.updateMatrix();
    const model = models.get(part.type);
    for (const mesh of model.meshes) {
      mesh.setMatrixAt(part.index, dummy.matrix); mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    for (const collider of part.colliders) { collider.matrix.copy(dummy.matrix); collider.matrixWorld.copy(dummy.matrix); }
  }

  function canPlace(site, head = null) {
    if (!site || !isBuildingPiece(site.type)) return { ok: false, message: 'Choose a building piece.' };
    const model = models.get(site.type);
    if (!model) return { ok: false, message: 'This building piece is still loading.' };
    if (parts.length >= BUILDING.maxPieces || model.count >= BUILDING.perType) return { ok: false, message: 'Building limit reached.' };
    if (buildingOccupied(site, parts)) return { ok: false, message: 'There is already a piece there.' };
    if (site.type === 'foundation') {
      const ground = foundationSite(site.x, site.z, site.yaw, heightAt);
      if (!ground.ok || ground.high > site.y - 0.02 || ground.low < site.y - 1) return { ok: false, message: 'Find flatter ground for the foundation.' };
      for (const dx of [-1.5, 0, 1.5]) for (const dz of [-1.5, 0, 1.5]) {
        if (isWater(site.x + dx, site.z + dz, heightAt(site.x + dx, site.z + dz))) return { ok: false, message: 'Place foundations on dry land.' };
      }
    } else if (!site.support || !parts.some(part => part.id === site.support)) return { ok: false, message: site.type === 'door' ? 'Aim at a doorway.' : 'Aim at a foundation, floor or matching snap point.' };
    if (site.type === 'door' && parts.some(part => part.type === 'door' && samePosition(site, part))) return { ok: false, message: 'That doorway already has a door.' };
    if (site.type === 'stairs' && site.y < heightAt(site.x, site.z) - 0.15) return { ok: false, message: 'The stairs would be underground.' };
    for (const fire of getFires()) {
      const p = localPoint(site, fire.x, fire.z), fy = fire.y ?? heightAt(fire.x, fire.z);
      if (Math.abs(p.x) < 1.85 && Math.abs(p.z) < 1.85 && Math.abs(fy - site.y) < 0.5) return { ok: false, message: 'Move clear of the campfire.' };
    }
    if (head && pushOutOfBuildings([{ ...site, angle: 0 }], head.x, head.z, head.y - 1.68)) return { ok: false, message: 'Step out of the building piece before placing it.' };
    return { ok: true, message: '' };
  }

  function aimSite(type, { origin, direction, head, ground, turn = 0 }) {
    raycaster.set(origin, direction); raycaster.far = 10;
    const hit = raycaster.intersectObjects(colliders, false)[0];
    hitPoint.set(ground.x, heightAt(ground.x, ground.z), ground.z);
    if (hit && hit.point.distanceTo(head) <= 8) hitPoint.copy(hit.point);
    const candidates = buildingCandidates(type, parts, turn);
    let best = null, score = Infinity;
    for (const site of candidates) {
      if (Math.hypot(site.x - head.x, site.z - head.z) > 8 || Math.abs(site.y - head.y) > 6) continue;
      pick.set(site.pick.x, site.pick.y, site.pick.z);
      let d = hitPoint.distanceTo(pick);
      // Aim at the future surface, too. Ground beneath a low foundation lies farther along the
      // ray; using only that hit can wrongly select the occupied tile behind the intended snap.
      const t = Math.abs(direction.y) > 1e-4 ? (pick.y - origin.y) / direction.y : -1;
      if (t >= 0 && t <= 10 && (!hit || t <= hit.distance + BUILDING.snapRange)) {
        projected.copy(origin).addScaledVector(direction, t);
        d = projected.distanceTo(pick);
      }
      const tie = Math.hypot(site.x - head.x, site.z - head.z) * 0.002;
      if (d + tie < score) { best = site; score = d + tie; }
    }
    if (best && score <= BUILDING.snapRange) return best;
    const yaw = quarterTurn(Math.atan2(-direction.x, -direction.z)) + turn;
    const foundation = foundationSite(ground.x, ground.z, yaw, heightAt);
    return { type, x: ground.x, y: type === 'foundation' ? foundation.y : heightAt(ground.x, ground.z), z: ground.z, yaw, snapped: false, support: null };
  }

  function place(site, { restore = false, open = false, id = null } = {}) {
    if (!restore) { const check = canPlace(site); if (!check.ok) return null; }
    const model = models.get(site.type);
    if (!model || parts.length >= BUILDING.maxPieces || model.count >= BUILDING.perType) return null;
    const part = { id: id ?? nextId, type: site.type, x: site.x, y: site.y, z: site.z, yaw: site.yaw, index: model.count++, open, angle: open ? OPEN_ANGLE : 0, colliders: [] };
    nextId = Math.max(nextId, part.id + 1);
    for (const geometry of model.collision) {
      const mesh = new THREE.Mesh(geometry, colliderMaterial); mesh.matrixAutoUpdate = false; mesh.userData.building = part;
      part.colliders.push(mesh); colliders.push(mesh); // not added to the scene: only ray queries see colliders
    }
    for (const mesh of model.meshes) mesh.count = model.count;
    parts.push(part); updatePose(part);
    onChange(part);
    return part;
  }

  function toggleDoor(origin, direction, reach = 3) {
    raycaster.set(origin, direction); raycaster.far = reach;
    // Raycast the closed panel too, so an open door can be closed from the doorway.
    let found = null, nearest = reach;
    for (const part of parts) {
      if (part.type !== 'door') continue;
      for (const angle of [0, part.angle]) {
        const centre = buildingPoint({ ...part, yaw: part.yaw + angle }, 0.6, 1.1, 0);
        const aim = new THREE.Vector3(centre.x, centre.y, centre.z);
        const along = aim.clone().sub(origin).dot(direction);
        if (along < 0 || along > reach) continue;
        const closest = raycaster.ray.closestPointToPoint(aim, new THREE.Vector3());
        if (closest.distanceTo(aim) < 0.8 && along < nearest) { found = part; nearest = along; }
      }
    }
    if (!found) return false;
    const obstruction = raycaster.intersectObjects(colliders, false)[0];
    if (obstruction && obstruction.object.userData.building !== found && obstruction.distance < nearest - 0.15) return false;
    found.open = !found.open; return true;
  }

  function update(dt) {
    for (const part of parts) if (part.type === 'door') {
      const target = part.open ? OPEN_ANGLE : 0;
      if (Math.abs(target - part.angle) < 0.001) continue;
      part.angle += (target - part.angle) * Math.min(1, dt * 10);
      if (Math.abs(target - part.angle) < 0.001) part.angle = target;
      updatePose(part);
    }
  }

  function hitTest(point, radius = 0) {
    const { x, y, z } = point;
    for (const part of parts) {
      const p = localPoint(part, x, z, part.yaw + (part.type === 'door' ? part.angle : 0));
      const ly = y - part.y;
      for (const [minX, maxX, minY, maxY, minZ, maxZ] of boxesFor(part)) {
        if (p.x >= minX - radius && p.x <= maxX + radius && p.z >= minZ - radius && p.z <= maxZ + radius && ly >= minY - radius && ly <= maxY + radius) return { building: part };
      }
      if (part.type === 'roof' && Math.abs(p.x) <= 1.5 + radius && p.z >= -3 - radius && p.z <= radius) {
        const top = -p.z / Math.sqrt(3);
        if (ly >= top - 0.16 - radius && ly <= top + radius) return { building: part };
      }
    }
    return null;
  }

  return {
    group, place, canPlace, aimSite, update, toggleDoor, hitTest,
    readyFor: type => models.has(type), get ready() { return models.size === Object.keys(BUILDING_PIECES).length; },
    createPreview: type => models.get(type)?.visual.clone(true) || null,
    list: () => parts,
    surfaceAt: (x, z, feetY, base) => buildingSurface(parts, x, z, feetY, base),
    pushOut: (x, z, feetY, height, radius) => pushOutOfBuildings(parts, x, z, feetY, height, radius),
    blocksGrass(x, y, z) {
      for (const part of parts) {
        if ((!isTile(part.type) && part.type !== 'stairs') || part.y < y - 0.2 || part.y > y + 1.5) continue;
        const p = localPoint(part, x, z);
        if (Math.abs(p.x) <= 2.1 && (part.type === 'stairs' ? p.z >= -3.6 && p.z <= 0.6 : Math.abs(p.z) <= 2.1)) return true;
      }
      return false;
    },
    move(fromX, fromZ, toX, toZ, feetY, height = 1.68) {
      const dx = toX - fromX, dz = toZ - fromZ;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.12));
      let x = fromX, z = fromZ, y = feetY;
      for (let i = 0; i < steps; i++) {
        x += dx / steps; z += dz / steps;
        const support = buildingSurface(parts, x, z, y, Math.min(y, heightAt(x, z)));
        const clear = pushOutOfBuildings(parts, x, z, Math.max(y, support), height);
        if (clear) [x, z] = clear;
        y = buildingSurface(parts, x, z, y, Math.min(y, heightAt(x, z)));
      }
      return { x, z, y };
    },
    snapshot: () => parts.map(part => ({ id: part.id, type: part.type, x: part.x, y: part.y, z: part.z, yaw: part.yaw, ...(part.type === 'door' ? { open: part.open } : {}) })),
    restore(list) {
      const saved = cleanBuildings(list) || [];
      for (const part of saved) place(part, { restore: true, id: part.id, open: part.open });
      return saved.length;
    },
  };
}
