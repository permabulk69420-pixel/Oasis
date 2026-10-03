import * as THREE from 'three';

// Soft night halos for glowing fruit.
//
// The veil tree's pods are plain emissive geometry; at night that gives bright little shapes with no
// light spilling off them. Real bioluminescence reads as a glow, so each pod gets one camera-facing
// additive sprite. All halos are one InstancedMesh (one draw call). Positions come from the model
// itself - every separate island of triangles in the 'Glow_Pods' mesh is one pod - so regenerating
// the tree with more, fewer or bigger pods needs no code change.

// Group triangles into connected islands (shared vertex position) and return a bounding sphere for
// each. `positions` is a flat xyz array, `index` a flat triangle index array (or null for
// non-indexed geometry). Pure function so it can be unit tested without a renderer.
export function findPodIslands(positions, index = null, { weld = 1e-3 } = {}) {
  const vertexCount = positions.length / 3;
  const triangleVertices = index ? index.length : vertexCount;
  const indexAt = index ? (i => index[i]) : (i => i);

  // Weld duplicated vertices (UV seams, hard edges) so an island stays one island.
  const keyToGroup = new Map();
  const group = new Int32Array(vertexCount);
  let groups = 0;
  for (let v = 0; v < vertexCount; v++) {
    const key = `${Math.round(positions[v * 3] / weld)},${Math.round(positions[v * 3 + 1] / weld)},${Math.round(positions[v * 3 + 2] / weld)}`;
    let g = keyToGroup.get(key);
    if (g === undefined) { g = groups++; keyToGroup.set(key, g); }
    group[v] = g;
  }

  const parent = Array.from({ length: groups }, (_, i) => i);
  const find = a => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i + 2 < triangleVertices; i += 3) {
    const a = group[indexAt(i)], b = group[indexAt(i + 1)], c = group[indexAt(i + 2)];
    union(a, b);
    union(b, c);
  }

  const bounds = new Map();
  for (let i = 0; i < triangleVertices; i++) {
    const v = indexAt(i);
    const root = find(group[v]);
    let box = bounds.get(root);
    if (!box) {
      box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      bounds.set(root, box);
    }
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[v * 3 + axis];
      if (value < box.min[axis]) box.min[axis] = value;
      if (value > box.max[axis]) box.max[axis] = value;
    }
  }

  return [...bounds.values()].map(({ min, max }) => ({
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    radius: Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2,
  }));
}

// Deterministic k-means for a handful of 3D points: farthest-point seeding (starting from the
// lowest point), then a few Lloyd passes. Returns clusters with centre, member count and members.
export function clusterPoints(points, k, iterations = 12) {
  if (!points.length) return [];
  k = Math.min(k, points.length);
  const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;

  let lowest = points[0];
  for (const p of points) if (p.y < lowest.y) lowest = p;
  const centres = [{ x: lowest.x, y: lowest.y, z: lowest.z }];
  while (centres.length < k) {
    let best = null, bestD = -1;
    for (const p of points) {
      let nearest = Infinity;
      for (const c of centres) nearest = Math.min(nearest, dist2(p, c));
      if (nearest > bestD) { bestD = nearest; best = p; }
    }
    centres.push({ x: best.x, y: best.y, z: best.z });
  }

  let assignment = new Array(points.length).fill(0);
  for (let pass = 0; pass < iterations; pass++) {
    assignment = points.map(p => {
      let bi = 0, bd = Infinity;
      centres.forEach((c, i) => { const d = dist2(p, c); if (d < bd) { bd = d; bi = i; } });
      return bi;
    });
    centres.forEach((c, i) => {
      let n = 0, x = 0, y = 0, z = 0;
      points.forEach((p, pi) => { if (assignment[pi] === i) { n++; x += p.x; y += p.y; z += p.z; } });
      if (n) { c.x = x / n; c.y = y / n; c.z = z / n; }
    });
  }

  return centres
    .map((c, i) => ({ center: { ...c }, members: points.filter((_, pi) => assignment[pi] === i) }))
    .filter(cluster => cluster.members.length)
    .map(cluster => ({ ...cluster, count: cluster.members.length }));
}

// Turn pod positions into a few ground-light pools. Low pods give small bright pools; high pods give
// big faint ones. `groundHeight(x, z)` is the terrain height under a point.
export function buildGroundLights(pods, groundHeight, { maxLights = 8 } = {}) {
  const clusters = clusterPoints(pods, maxLights);
  const lights = clusters.map(({ center, count }) => {
    const height = Math.max(center.y - groundHeight(center.x, center.z), 0.5);
    return {
      x: center.x,
      y: center.y,
      z: center.z,
      radius: 15 + height * 1.0,
      strength: Math.sqrt(count) / (1 + (height / 14) ** 2),
    };
  });
  const top = Math.max(...lights.map(l => l.strength), 1e-6);
  for (const light of lights) light.strength /= top;
  return lights;
}

// Write lights into the terrain material's uniform arrays (see materials.js). Unused slots are
// zeroed. uPodLightArea = (centre x, centre z, cull range, night gain).
export function applyGroundLights(uniforms, lights) {
  if (!uniforms?.uPodLights) return;
  const slots = uniforms.uPodLights.value;
  const strengths = uniforms.uPodLightStrength.value;
  for (let i = 0; i < slots.length; i++) {
    const light = lights[i];
    if (light) {
      slots[i].set(light.x, light.y, light.z, light.radius);
      strengths[i] = light.strength;
    } else {
      slots[i].set(0, -1000, 0, 1);
      strengths[i] = 0;
    }
  }
  let cx = 0, cz = 0;
  for (const l of lights) { cx += l.x; cz += l.z; }
  if (lights.length) { cx /= lights.length; cz /= lights.length; }
  let range = 0;
  for (const l of lights) range = Math.max(range, Math.hypot(l.x - cx, l.z - cz) + l.radius);
  const area = uniforms.uPodLightArea.value;
  area.x = cx; area.y = cz; area.z = range;
}

const HALO_VERTEX = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    // Instance scale is the halo radius in model units; modelMatrix carries any parent scale.
    float radius = length(instanceMatrix[0].xyz) * length(modelMatrix[0].xyz);
    vec4 corner = vec4(centre.xy + position.xy * 2.0 * radius, centre.z, 1.0);
    gl_Position = projectionMatrix * corner;
  }
`;

const HALO_FRAGMENT = /* glsl */`
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    if (d >= 1.0) discard;
    // Bright shoulder close to the fruit, long soft tail. Smooth to exactly zero at the quad edge.
    float falloff = pow(1.0 - d, 1.9);
    float core = pow(1.0 - d, 5.0);
    float a = (falloff * 0.62 + core * 0.55) * uIntensity;
    gl_FragColor = vec4(uColor, a);
    #include <colorspace_fragment>
  }
`;

// root: the loaded hero model; halos are added as its children so they follow its transform.
export function createPodHalos(root, {
  meshName = 'Glow_Pods',
  color = 0x16b8ff,
  radiusPerPod = 3.6,
  maxIntensity = 0.95,
} = {}) {
  let podMesh = null;
  root.traverse(object => { if (!podMesh && object.isMesh && object.name === meshName) podMesh = object; });
  if (!podMesh) return null;

  const geometry = podMesh.geometry;
  const positions = geometry.attributes.position.array;
  const islands = findPodIslands(positions, geometry.index?.array ?? null);
  if (!islands.length) return null;

  // Island centres are in the pod mesh's local space; bring them into the root's space.
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(podMesh.matrixWorld);
  const scaleToRoot = new THREE.Vector3().setFromMatrixScale(toRoot).x;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: 0 },
    },
    vertexShader: HALO_VERTEX,
    fragmentShader: HALO_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  material.name = 'Pod halo';

  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, islands.length);
  mesh.name = 'Pod halos';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.visible = false;

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const identity = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  islands.forEach((island, i) => {
    position.set(...island.center).applyMatrix4(toRoot);
    scale.setScalar(island.radius * scaleToRoot * radiusPerPod);
    matrix.compose(position, identity, scale);
    mesh.setMatrixAt(i, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  root.add(mesh);

  // 0 = full day (no halo), 1 = full night.
  function setNight(amount) {
    const night = THREE.MathUtils.clamp(amount, 0, 1);
    material.uniforms.uIntensity.value = night * maxIntensity;
    mesh.visible = night > 0.01;
  }

  // Pod centres and radii in world space (the model must already be placed in the scene).
  function worldPods() {
    podMesh.updateWorldMatrix(true, false);
    const worldScale = new THREE.Vector3().setFromMatrixScale(podMesh.matrixWorld).x;
    return islands.map(island => {
      const p = new THREE.Vector3(...island.center).applyMatrix4(podMesh.matrixWorld);
      return { x: p.x, y: p.y, z: p.z, radius: island.radius * worldScale };
    });
  }

  return { mesh, material, count: islands.length, setNight, worldPods };
}
