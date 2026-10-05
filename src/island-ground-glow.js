import * as THREE from 'three';

// The island's ground takes the plants' light at night (Kane's brief for the overnight run: the glow carries the scene, and the darkness is liked, so this is
// light where there are lights, never a general brightening). Under each weeping glow-tree, standing stone, the root arch, the little mushroom patches and every
// group of glow plants there is a soft pool of the oasis tree's cyan on the ground, so the plants stand IN their light instead of floating over black.
//
// How: each pool is a small disc draped over the ground (a few triangles; the soft edge is worked out per pixel), all merged into ONE mesh, drawn additively
// after the ground, so it costs one draw call and almost nothing per pixel (nothing is looped per pixel, unlike the hero tree's pools in the terrain shader,
// which only have 8 slots; the island has about a hundred lights). The only per-frame work is one number: how dark it is. Pure layout, so tests can check it.

export const GROUND_GLOW = Object.freeze({
  lift: 0.1,                        // metres above the ground: clear of the path strips (0.06) and of the ground's own facets
  step: 1.7,                        // metres between the pool's vertices (it follows the ground at that grain)
  colour: Object.freeze([0.03, 0.23, 0.38]),   // linear light a pool adds at its middle at full strength: exactly the oasis tree's pools (POD_LIGHT_COLOR in materials.js)
  fade: Object.freeze([120, 200]),  // metres from the viewer: pools thin out from here and are gone there
  nightFrom: 0.5,                   // the same daylight measure the plants' glow, the halos and the motes use (exposure from 0.5 down to 0.07)
  nightTo: 0.07,
  // what lights the ground, by flora model name; radius is metres at scale 1 (times the item's scale), strength is 0 to 1
  kinds: Object.freeze({
    weepingTree: Object.freeze({ radius: 9.5, strength: 0.62 }),
    rootArch: Object.freeze({ radius: 6.5, strength: 0.34 }),
    standingStoneA: Object.freeze({ radius: 5.6, strength: 0.34 }),
    standingStoneB: Object.freeze({ radius: 4.8, strength: 0.3 }),
    mushrooms: Object.freeze({ radius: 2.1, strength: 0.17 }),
  }),
  // the glow plants (reeds and lantern blooms) light the ground in groups: everything inside one cell is one pool
  plants: Object.freeze({ cell: 7, radius: 2.7, radiusPerRoot: 0.55, radiusMax: 5.4, strength: 0.1, strengthPerPlant: 0.045, strengthMax: 0.34 }),
});

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Which pools there are: [{ kind, x, z, radius, strength }]. `flora` is the flora layout (items with a `type`), `glow` the glow plant layout (items with `x`, `z`, `scale`).
export function layoutGroundGlow({ flora = [], glow = [] } = {}, spec = GROUND_GLOW) {
  const pools = [];
  for (const item of flora) {
    const kind = spec.kinds[item.type];
    if (!kind) continue;
    pools.push({ kind: item.type, x: item.x, z: item.z, radius: kind.radius * (item.scale ?? 1), strength: kind.strength });
  }
  const P = spec.plants;
  const cells = new Map();
  for (const plant of glow) {
    const key = `${Math.floor(plant.x / P.cell)},${Math.floor(plant.z / P.cell)}`;
    let cell = cells.get(key);
    if (!cell) cells.set(key, cell = { x: 0, z: 0, n: 0 });
    cell.x += plant.x; cell.z += plant.z; cell.n++;
  }
  for (const cell of cells.values()) {
    pools.push({
      kind: 'plants', x: cell.x / cell.n, z: cell.z / cell.n,
      radius: Math.min(P.radiusMax, P.radius + P.radiusPerRoot * Math.sqrt(cell.n)),
      strength: Math.min(P.strengthMax, P.strength + P.strengthPerPlant * cell.n),
    });
  }
  return pools;
}

// The mesh data for a list of pools, merged: positions (world metres, on the ground), `local` (the position in the pool's own disc, -1 to 1: the soft
// edge is drawn from it) and strength, per vertex. A vertex with no ground under it (past the island's lip) is left out, with its triangles.
export function buildGroundGlowMesh(pools, ground, spec = GROUND_GLOW) {
  const positions = [], locals = [], strengths = [], indices = [];
  for (const pool of pools) {
    const around = clamp(Math.ceil((TAU * pool.radius) / spec.step), 10, 40);
    const rings = clamp(Math.ceil(pool.radius / spec.step), 2, 8);
    const base = positions.length / 3;
    const valid = [];
    const centre = ground(pool.x, pool.z);
    if (centre === null) continue;
    // vertex 0 is the middle; ring k (1..rings) starts at 1 + (k - 1) * around
    positions.push(pool.x, centre + spec.lift, pool.z); locals.push(0, 0); strengths.push(pool.strength); valid.push(true);
    for (let k = 1; k <= rings; k++) {
      const u = k / rings;
      for (let j = 0; j < around; j++) {
        const a = (j / around) * TAU;
        const c = Math.cos(a), s = Math.sin(a);
        const x = pool.x + c * u * pool.radius, z = pool.z + s * u * pool.radius;
        const h = ground(x, z);
        valid.push(h !== null);
        positions.push(x, h === null ? centre + spec.lift : h + spec.lift, z);
        locals.push(c * u, s * u);
        strengths.push(pool.strength);
      }
    }
    const at = (k, j) => k === 0 ? 0 : 1 + (k - 1) * around + ((j % around) + around) % around;
    const push = (a, b, c) => { if (valid[a] && valid[b] && valid[c]) indices.push(base + a, base + c, base + b); };   // wound so the front faces the sky (the ring runs clockwise seen from above)
    for (let j = 0; j < around; j++) push(0, at(1, j), at(1, j + 1));
    for (let k = 1; k < rings; k++) {
      for (let j = 0; j < around; j++) {
        const a = at(k, j), b = at(k, j + 1), c = at(k + 1, j), d = at(k + 1, j + 1);
        push(a, c, b);
        push(b, c, d);
      }
    }
  }
  return {
    positions: new Float32Array(positions),
    locals: new Float32Array(locals),
    strengths: new Float32Array(strengths),
    indices: positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
    vertexCount: positions.length / 3,
    triangles: indices.length / 3,
  };
}

// 0 in daylight, 1 in the dark (exposure falls from nightFrom to nightTo).
export function groundGlowNight(exposure, spec = GROUND_GLOW) {
  return 1 - THREE.MathUtils.smoothstep(exposure, spec.nightTo, spec.nightFrom);
}

const f = n => n.toFixed(3);

export function createIslandGroundGlow({ flora = [], glow = [], ground = null, getExposure = () => 0.035, anchor = null } = {}) {
  const group = new THREE.Group();
  group.name = 'Island ground glow';
  const pools = ground ? layoutGroundGlow({ flora, glow }) : [];
  const data = ground ? buildGroundGlowMesh(pools, ground) : { positions: new Float32Array(0), locals: new Float32Array(0), strengths: new Float32Array(0), indices: new Uint16Array(0), vertexCount: 0, triangles: 0 };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('aLocal', new THREE.BufferAttribute(data.locals, 2));
  geometry.setAttribute('aStrength', new THREE.BufferAttribute(data.strengths, 1));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();
  const uniforms = { uNight: { value: 0 }, uColour: { value: new THREE.Vector3(...GROUND_GLOW.colour) } };
  const material = new THREE.ShaderMaterial({
    name: 'Island ground glow',
    uniforms,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    vertexShader: /* glsl */`
      attribute vec2 aLocal;
      attribute float aStrength;
      varying vec2 vLocal;
      varying float vStrength;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vLocal = aLocal;
        vStrength = aStrength * (1.0 - smoothstep(${f(GROUND_GLOW.fade[0])}, ${f(GROUND_GLOW.fade[1])}, distance(world.xyz, cameraPosition)));
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uNight;
      uniform vec3 uColour;
      varying vec2 vLocal;
      varying float vStrength;
      void main() {
        float r = length(vLocal);
        float pool = 1.0 - smoothstep(0.0, 1.0, r);
        pool *= pool;
        vec3 light = uColour * (pool * vStrength * uNight);
        gl_FragColor = vec4(pow(light, vec3(0.4545)), 1.0);   // linear light to the screen's encoding, as the terrain shader does for the oasis tree's pools
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Island ground glow';
  mesh.frustumCulled = false;       // one merged mesh over the whole island, always small
  mesh.renderOrder = 8;
  if (data.triangles > 0) group.add(mesh);
  group.visible = false;

  let away = false;
  // Every frame (cheap): how dark it is, and put away at day and when you are far from the island.
  function update(head) {
    if (anchor && head && Math.hypot(head.x - anchor.x, head.z - anchor.z) > anchor.distance) { away = true; group.visible = false; return; }
    away = false;
    const night = groundGlowNight(getExposure());
    uniforms.uNight.value = night;
    group.visible = data.triangles > 0 && night > 0.01;
  }

  function dispose() {
    group.removeFromParent();
    geometry.dispose();
    material.dispose();
  }

  return { group, mesh, update, dispose, pools, triangles: data.triangles, get away() { return away; } };
}
