import * as THREE from 'three';
import { grassCover, isInPond } from './world.js';

// Footprints in the sand: where you have walked, and where the dune stinger has. Each print is a small decal laid on the ground
// that darkens or lightens what is under it (so it takes the sand's own colour and light, by day, in firelight and at night), shaded
// like a dent in the sand lit from the sun's side. The wind fills them in: each one holds for the first part of its life, then
// softens, spreads a little and is gone. Every print of both kinds is one instanced draw call; unused slots draw nothing.
//
// Two rings of slots, one per kind, so the creature's many small prints cannot push yours out. Nothing is allocated per frame: a print
// is written into the slots when it is laid (a few times a second), and the rest is done by the vertex shader from the age.

export const PRINTS = Object.freeze({
  capacity: Object.freeze({ player: 480, stinger: 480 }),
  life: Object.freeze({ player: 150, stinger: 220 }), // seconds until the wind has filled one in
  hold: 0.18, // the first part of that life a print stays crisp
  stride: Object.freeze({ walk: 0.74, run: 1.05 }), // metres between one foot and the next
  runSpeed: 3.7, // m/s: faster than this and the stride is the long one
  half: 0.1, // each foot lands this far to the side of the line you walk
  turnOut: 0.12, // radians each foot points away from straight ahead
  size: Object.freeze({ player: 0.7, stinger: 0.34 }), // the decal square in metres (a stinger's is multiplied by its own scale)
  lift: 0.012, // metres above the sand, so the decal is never inside it...
  liftPerMetre: 0.00035, // ...and a little more the further away it is, as the depth buffer gets coarser
  fade: Object.freeze([34, 62]), // metres: prints thin out and are gone by the second number (nobody sees a footprint at 60 m)
  grassMax: 0.25, // no prints where the grass is thicker than this
  jump: 2.5, // a step bigger than this in one frame is a jump in position (a new session), not walking
  slope: 0.2, // metres either side of a print used to find which way the ground leans
});

const KIND = Object.freeze({ player: 0, stinger: 1 });

// How much of a print is left: 1 while it is fresh, easing to 0 as the wind fills it in. The shader does the same sum.
export function printStrength(age, life, hold = PRINTS.hold) {
  if (!(life > 0)) return 0;
  const t = Math.max(0, age) / life;
  if (t <= hold) return 1;
  if (t >= 1) return 0;
  const s = (t - hold) / (1 - hold);
  return 1 - s * s * (3 - 2 * s);
}

// ------------------------------------------------------------------------------------------------ walking: where your feet land
// step(x, z, { onGround, speed }) is called every frame with where you stand. It returns the print to lay (the same object every
// time, so read it at once) or null. Feet alternate, each a little to the side of the line you walk, pointing along it.
export function createStepper(config = PRINTS) {
  let lastX = NaN, lastZ = NaN, travelled = 0, alongX = 0, alongZ = 0, side = 1;
  const out = { x: 0, z: 0, yaw: 0, side: 1 };
  return {
    reset() { lastX = lastZ = NaN; travelled = alongX = alongZ = 0; },
    step(x, z, { onGround = true, speed = 0 } = {}) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
      if (!Number.isFinite(lastX)) { lastX = x; lastZ = z; return null; }
      const dx = x - lastX, dz = z - lastZ;
      lastX = x; lastZ = z;
      const moved = Math.hypot(dx, dz);
      if (moved > config.jump) { travelled = alongX = alongZ = 0; return null; }
      if (!onGround) return null; // in the air: the distance is not counted, and nothing is laid
      travelled += moved; alongX += dx; alongZ += dz;
      const stride = speed >= config.runSpeed ? config.stride.run : config.stride.walk;
      if (travelled < stride) return null;
      const length = Math.hypot(alongX, alongZ);
      if (length < stride * 0.4) { travelled = alongX = alongZ = 0; return null; } // went round in circles: no direction to point
      const fx = alongX / length, fz = alongZ / length;
      travelled = alongX = alongZ = 0;
      side = -side;
      // right of the way you face, the same cross product the shader uses: up x forward
      out.x = x + fz * side * config.half;
      out.z = z - fx * side * config.half;
      out.yaw = Math.atan2(fx, fz);
      out.side = side;
      return out;
    },
  };
}

// ------------------------------------------------------------------------------------------------ the slots
// Plain arrays, so the whole thing can be checked without a graphics card. A kind's slots run [base, base + capacity); the oldest is reused.
export function createPrintBook(capacity = PRINTS.capacity) {
  const names = Object.keys(KIND);
  const base = {}, size = {}, cursor = {};
  let total = 0;
  for (const name of names) { base[name] = total; size[name] = capacity[name]; cursor[name] = 0; total += capacity[name]; }
  const place = new Float32Array(total * 4); // x, y, z, the time it was laid
  const normal = new Float32Array(total * 4); // which way the ground leans (x, y, z) and the way the foot points
  const info = new Float32Array(total * 4); // size, side, kind, strength
  return {
    total, place, normal, info, base,
    laid: { player: 0, stinger: 0 },
    add(kindName, { x, y, z, nx, ny, nz, yaw, size: width, side, born, strength = 1 }) {
      const slot = base[kindName] + cursor[kindName];
      cursor[kindName] = (cursor[kindName] + 1) % size[kindName];
      const i = slot * 4;
      place[i] = x; place[i + 1] = y; place[i + 2] = z; place[i + 3] = born;
      normal[i] = nx; normal[i + 1] = ny; normal[i + 2] = nz; normal[i + 3] = yaw;
      info[i] = width; info[i + 1] = side; info[i + 2] = KIND[kindName]; info[i + 3] = strength;
      this.laid[kindName]++;
      return slot;
    },
  };
}

// ------------------------------------------------------------------------------------------------ drawing
const VERTEX = /* glsl */`
  attribute vec4 aPlace;   // x, y, z, born
  attribute vec4 aNormal;  // the ground's normal, and the way the foot points (radians; 0 is +z)
  attribute vec4 aInfo;    // size, side (+1 or -1), kind (0 foot, 1 claw), strength
  uniform float uTime;
  uniform vec2 uLife;      // seconds a foot's print and a claw's print last
  uniform float uHold;
  uniform vec2 uFade;
  uniform vec2 uLift;
  uniform float uTurn;
  uniform vec3 uSun;
  varying vec2 vP;
  varying vec3 vSun;       // the sun in the print's own frame: x to the right, y up out of the sand, z the way it points
  varying float vStrength;
  varying float vKind;
  varying float vSide;
  varying float vAge;
  void main() {
    float life = aInfo.z < 0.5 ? uLife.x : uLife.y;
    float age = max(uTime - aPlace.w, 0.0) / life;
    float s = clamp((age - uHold) / (1.0 - uHold), 0.0, 1.0);
    float fill = age >= 1.0 ? 0.0 : 1.0 - s * s * (3.0 - 2.0 * s);
    float dist = distance(cameraPosition, aPlace.xyz);
    float near = 1.0 - smoothstep(uFade.x, uFade.y, dist);
    vStrength = fill * near * aInfo.w;
    vKind = aInfo.z;
    vSide = aInfo.y;
    vAge = age;
    if (vStrength < 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; } // outside the picture: nothing is drawn
    vec3 up = normalize(aNormal.xyz);
    float turn = aNormal.w + aInfo.y * uTurn * (aInfo.z < 0.5 ? 1.0 : 0.0);
    vec3 ahead = vec3(sin(turn), 0.0, cos(turn));
    vec3 fwd = normalize(ahead - up * dot(ahead, up));
    vec3 right = cross(up, fwd);
    float size = aInfo.x * (1.0 + 0.25 * age); // the wind spreads it a little as it fills in
    vP = position.xy;
    vSun = vec3(dot(uSun, right), dot(uSun, up), dot(uSun, fwd));
    vec3 world = aPlace.xyz + (right * position.x + fwd * position.y) * (size * 0.5) + up * (uLift.x + dist * uLift.y);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

// The print is drawn as a height field: a dent with a low rim of pushed-up sand. Its slope is lit by the sun and the result is a
// number to multiply the ground by (1 away from the print, so it is invisible there).
const FRAGMENT = /* glsl */`
  uniform float uHold;
  varying vec2 vP;
  varying vec3 vSun;
  varying float vStrength;
  varying float vKind;
  varying float vSide;
  varying float vAge;

  // the width of a sole, from the heel (y = 0) to the toes (y = 1)
  float soleWidth(float y) {
    float w = mix(0.0, 0.125, smoothstep(0.0, 0.1, y));
    w = mix(w, 0.165, smoothstep(0.1, 0.26, y));
    w = mix(w, 0.14, smoothstep(0.3, 0.46, y));   // the arch
    w = mix(w, 0.22, smoothstep(0.5, 0.68, y));   // the ball of the foot
    w = mix(w, 0.195, smoothstep(0.72, 0.86, y));
    return mix(w, 0.0, smoothstep(0.9, 1.0, y));  // the toes, rounded off
  }

  // 0 outside, 1 deep inside; and the rim, 1 in a thin band just outside
  void shape(vec2 p, out float depth, out float rim) {
    float d;
    float wall;
    if (vKind < 0.5) {
      // a foot
      float y = (p.y + 0.47) / 0.94;
      float w = soleWidth(clamp(y, 0.0, 1.0));
      d = (y < 0.0 || y > 1.0) ? 9.0 : abs(p.x - 0.012 * (0.5 - y)) / max(w, 0.002) - 1.0;
      wall = 0.8;
    } else {
      // a claw: three points in a fan and one behind
      float a = length(p - vec2(-0.17, 0.12)) / 0.13 - 1.0;
      float b = length(p - vec2(0.17, 0.12)) / 0.13 - 1.0;
      float c = length(p - vec2(0.0, 0.3)) / 0.14 - 1.0;
      float e = length(p - vec2(0.0, -0.1)) / 0.1 - 1.0;
      d = min(min(a, b), min(c, e));
      wall = 0.9;
    }
    depth = 1.0 - smoothstep(-wall, 0.0, d);
    rim = smoothstep(0.0, 0.25, d) * (1.0 - smoothstep(0.25, 0.9, d));
  }
  float height(vec2 p) {
    float depth, rim;
    shape(p, depth, rim);
    return -depth + 0.16 * rim;
  }

  // How the sand is lit, roughly: some light that does not come from the sun, and the sun's share by how squarely the surface faces it.
  // The print is shaded by how much brighter or darker that makes the sand in the dent than the flat sand around it.
  const float AMBIENT = 0.42;
  const float DIRECT = 0.8;
  const float TILT = 0.055;  // the dent is about two centimetres deep on a 70 cm square, so its walls lean 20 to 35 degrees
  const float PACKED = 0.26; // pressed sand is a little darker than loose sand

  void main() {
    // the foot is mirrored for the other side
    vec2 p = vec2(vP.x * vSide, vP.y);
    float e = 0.04;
    float h0 = height(p);
    float hx = height(p + vec2(e, 0.0));
    float hy = height(p + vec2(0.0, e));
    vec2 slope = vec2(hx - h0, hy - h0) / e;
    vec3 n = normalize(vec3(-slope.x * vSide * TILT, 1.0, -slope.y * TILT));
    vec3 sun = vSun;
    float gate = smoothstep(0.0, 0.1, sun.y); // no sunlight at all when the sun is below the sand's horizon: night, or a slope turned away
    float level = AMBIENT + DIRECT * gate * max(sun.y, 0.0);
    float dent = AMBIENT + DIRECT * gate * max(dot(n, sun), 0.0);
    float depth, rim;
    shape(p, depth, rim);
    float shade = dent / level * (1.0 - PACKED * depth);
    // fading out as the wind fills it in; the edge of the quad is always 1
    float edge = 1.0 - smoothstep(0.78, 1.0, max(abs(vP.x), abs(vP.y)));
    float amount = vStrength * edge;
    gl_FragColor = vec4(vec3(mix(1.0, shade, amount)), 1.0);
  }
`;

// Prints are laid on the sand where it is not grass and not water.
const onSand = (x, z, ground) => !isInPond(x, z, ground) && grassCover(x, z) <= PRINTS.grassMax;

export function createFootprints({ scene = null, sun, heightAt = () => 0, capacity = PRINTS.capacity } = {}) {
  if (!sun) throw new Error('Footprints need the sun uniform.');
  const book = createPrintBook(capacity);
  const stepper = createStepper();
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const place = new THREE.InstancedBufferAttribute(book.place, 4);
  const normal = new THREE.InstancedBufferAttribute(book.normal, 4);
  const info = new THREE.InstancedBufferAttribute(book.info, 4);
  for (const attribute of [place, normal, info]) attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aPlace', place);
  geometry.setAttribute('aNormal', normal);
  geometry.setAttribute('aInfo', info);
  geometry.instanceCount = 0;
  const uTime = { value: 0 };
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime, uSun: sun, uHold: { value: PRINTS.hold },
      uLife: { value: new THREE.Vector2(PRINTS.life.player, PRINTS.life.stinger) },
      uFade: { value: new THREE.Vector2(...PRINTS.fade) },
      uLift: { value: new THREE.Vector2(PRINTS.lift, PRINTS.liftPerMetre) },
      uTurn: { value: PRINTS.turnOut },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide, // laid flat, the quad's front would face down
    // multiply: the ground under the print is darkened or lightened, never replaced
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.ZeroFactor,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Footprints';
  mesh.frustumCulled = false; // positions are set in the vertex shader
  mesh.renderOrder = 4; // after the ground, before the dust and the water
  mesh.visible = false;
  scene?.add(mesh);

  const fields = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, yaw: 0, size: 0, side: 1, born: 0, strength: 1 };

  function lay(kindName, x, z, yaw, side, size, strength = 1) {
    const y = heightAt(x, z);
    if (!onSand(x, z, y)) return false;
    const d = PRINTS.slope;
    const gx = (heightAt(x + d, z) - heightAt(x - d, z)) / (2 * d);
    const gz = (heightAt(x, z + d) - heightAt(x, z - d)) / (2 * d);
    const length = Math.hypot(gx, 1, gz);
    fields.x = x; fields.y = y; fields.z = z;
    fields.nx = -gx / length; fields.ny = 1 / length; fields.nz = -gz / length;
    fields.yaw = yaw; fields.size = size; fields.side = side; fields.strength = strength;
    fields.born = uTime.value;
    book.add(kindName, fields);
    place.needsUpdate = normal.needsUpdate = info.needsUpdate = true;
    geometry.instanceCount = book.total;
    mesh.visible = true;
    return true;
  }

  return {
    mesh, book, material,
    // every frame with where you stand: lays your feet's prints as you walk
    walk(x, z, { onGround = true, speed = 0 } = {}) {
      const print = stepper.step(x, z, { onGround, speed });
      return print ? lay('player', print.x, print.z, print.yaw, print.side, PRINTS.size.player) : false;
    },
    // forget where you were (a new VR session puts you somewhere else)
    reset() { stepper.reset(); },
    // a creature's foot has come down at (x, z), its body facing yaw; scale is the creature's size
    plant(x, z, yaw, scale = 1, side = 1) {
      return lay('stinger', x, z, yaw, side, PRINTS.size.stinger * scale);
    },
    update(seconds) { if (Number.isFinite(seconds)) uTime.value = seconds; },
    get laid() { return { ...book.laid }; },
    dispose() { scene?.remove(mesh); geometry.dispose(); material.dispose(); },
  };
}
