import * as THREE from 'three';

// A small pool of flying bits: rock chips and crystal sparks that jump off a node when you hit it (src/mining.js). One instanced mesh, so a
// whole burst is a single draw call, and nothing is allocated while it runs. Each bit is thrown out with a velocity, falls under gravity,
// bounces once or twice on the sand (the ground comes from `heightAt`) and shrinks away. Colours come from the instance colour; the
// material decides whether they glow.

export const BURSTS = Object.freeze({
  gravity: 9.5,
  bounce: 0.32, // share of the downward speed kept (and thrown back up) when a bit lands
  friction: 0.55, // share of the sideways speed kept on each landing
  restSpeed: 0.9, // below this vertical speed after a landing a bit just lies there
  fadeTime: 0.4, // seconds spent shrinking at the end of its life
});

const scratch = new THREE.Object3D();
const euler = new THREE.Euler();
const colour = new THREE.Color();

export function createBurstPool({ capacity = 64, material, heightAt = () => 0, geometry = null } = {}) {
  if (!material) throw new Error('A burst pool needs a material');
  const shape = geometry ?? new THREE.OctahedronGeometry(0.5, 0);
  const mesh = new THREE.InstancedMesh(shape, material, capacity);
  mesh.name = 'Burst pool';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.count = 0;
  mesh.visible = false;

  const position = new Float32Array(capacity * 3);
  const velocity = new Float32Array(capacity * 3);
  const rotation = new Float32Array(capacity * 3);
  const spin = new Float32Array(capacity * 3);
  const size = new Float32Array(capacity);
  const life = new Float32Array(capacity); // seconds left; <= 0 means the slot is free
  const landed = new Uint8Array(capacity);
  let next = 0;
  let live = 0;

  // Throw `count` bits out of a point. `speed` is the typical launch speed, `along` an optional [x, y, z] direction they favour (a unit
  // vector; the bits fly in a cone about it), `colours` a list of hex colours chosen at random, `sizes` [min, max] edge length in metres.
  function emit(x, y, z, count, { speed = 3, along = null, spread = 1, colours = [0xffffff], sizes = [0.02, 0.05], lifetime = [0.9, 1.6], upward = 1.2 } = {}) {
    for (let n = 0; n < count; n++) {
      const i = next;
      next = (next + 1) % capacity;
      const p = i * 3;
      position[p] = x + (Math.random() - 0.5) * 0.06; position[p + 1] = y + (Math.random() - 0.5) * 0.06; position[p + 2] = z + (Math.random() - 0.5) * 0.06;
      // a random direction, pulled towards `along` when there is one
      let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
      const length = Math.hypot(dx, dy, dz) || 1;
      dx /= length; dy /= length; dz /= length;
      if (along) {
        const pull = 1 / Math.max(0.2, spread);
        dx = dx + along[0] * pull; dy = dy + along[1] * pull; dz = dz + along[2] * pull;
        const l2 = Math.hypot(dx, dy, dz) || 1;
        dx /= l2; dy /= l2; dz /= l2;
      }
      const v = speed * (0.45 + 0.75 * Math.random());
      velocity[p] = dx * v; velocity[p + 1] = Math.abs(dy) * v * 0.6 + upward + Math.random() * 0.8; velocity[p + 2] = dz * v;
      rotation[p] = Math.random() * 6.28; rotation[p + 1] = Math.random() * 6.28; rotation[p + 2] = Math.random() * 6.28;
      spin[p] = (Math.random() - 0.5) * 18; spin[p + 1] = (Math.random() - 0.5) * 18; spin[p + 2] = (Math.random() - 0.5) * 18;
      size[i] = sizes[0] + (sizes[1] - sizes[0]) * Math.random();
      life[i] = lifetime[0] + (lifetime[1] - lifetime[0]) * Math.random();
      landed[i] = 0;
      colour.setHex(colours[Math.floor(Math.random() * colours.length) % colours.length]);
      mesh.instanceColor.setXYZ(i, colour.r, colour.g, colour.b);
    }
    mesh.instanceColor.needsUpdate = true;
  }

  function update(dt) {
    if (!(dt > 0)) return;
    let highest = -1;
    live = 0;
    for (let i = 0; i < capacity; i++) {
      if (life[i] <= 0) continue;
      const p = i * 3;
      life[i] -= dt;
      if (life[i] <= 0) { writeHidden(i); continue; }
      if (!landed[i]) {
        velocity[p + 1] -= BURSTS.gravity * dt;
        position[p] += velocity[p] * dt; position[p + 1] += velocity[p + 1] * dt; position[p + 2] += velocity[p + 2] * dt;
        rotation[p] += spin[p] * dt; rotation[p + 1] += spin[p + 1] * dt; rotation[p + 2] += spin[p + 2] * dt;
        const floor = heightAt(position[p], position[p + 2]) + size[i] * 0.35;
        if (position[p + 1] < floor) {
          position[p + 1] = floor;
          const down = -velocity[p + 1];
          if (down < BURSTS.restSpeed) { landed[i] = 1; velocity[p] = velocity[p + 1] = velocity[p + 2] = 0; }
          else {
            velocity[p + 1] = down * BURSTS.bounce;
            velocity[p] *= BURSTS.friction; velocity[p + 2] *= BURSTS.friction;
            spin[p] *= 0.5; spin[p + 1] *= 0.5; spin[p + 2] *= 0.5;
          }
        }
      }
      const fade = Math.min(1, life[i] / BURSTS.fadeTime);
      scratch.position.set(position[p], position[p + 1], position[p + 2]);
      euler.set(rotation[p], rotation[p + 1], rotation[p + 2]);
      scratch.quaternion.setFromEuler(euler);
      scratch.scale.setScalar(size[i] * fade);
      scratch.updateMatrix();
      mesh.setMatrixAt(i, scratch.matrix);
      highest = i;
      live += 1;
    }
    // draw only up to the last live slot; hidden ones in between are collapsed to nothing
    mesh.count = highest + 1;
    mesh.visible = highest >= 0;
    mesh.instanceMatrix.needsUpdate = true;
  }

  function writeHidden(i) {
    scratch.position.set(0, -1000, 0);
    scratch.scale.setScalar(0);
    scratch.quaternion.identity();
    scratch.updateMatrix();
    mesh.setMatrixAt(i, scratch.matrix);
  }

  for (let i = 0; i < capacity; i++) writeHidden(i);

  return { mesh, emit, update, count: () => live, capacity };
}
