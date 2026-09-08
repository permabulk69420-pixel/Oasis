import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WATER, SUN } from './world.js';

const BUSH_DRAW_DISTANCE = 180;
const BUSH_LOAD_DISTANCE = 230;
const TREE_DRAW_DISTANCE = 240;
const TREE_LOAD_DISTANCE = 275;
const FERN_DRAW_DISTANCE = 170;
const FERN_LOAD_DISTANCE = 210;
const HERO_DRAW_DISTANCE = 420;
const HERO_LOAD_DISTANCE = 480;

// One 60 m landmark tree on the east-southeast side of the oasis. Its clearing is deliberately
// broad so the regular bushes, trees and ferns cannot spawn through the hero canopy/trunk area.
const HERO_TREE = Object.freeze({
  x: 372,
  z: -414,
  yaw: 0.55,
  groundInset: 0.55,
  clearRadius: 40,
});

// Keep the full tree nearby, then step down aggressively once individual leaves are small in VR.
const TREE_LODS = [
  { file: 'blue_alien_tree.glb', distance: 0 },
  { file: 'blue_alien_tree_optimized_code.glb', distance: 18 },
  { file: 'blue_alien_tree_lod3_ultra.glb', distance: 45 },
];

// Large ground foliage can step down sooner than the taller trees because the frond detail
// becomes difficult to resolve quickly at Quest resolution.
const FERN_LODS = [
  { file: 'large_purple_alien_fern_v2.glb', distance: 0 },
  { file: 'large_purple_alien_fern_v2_LOD1.glb', distance: 12 },
  { file: 'large_purple_alien_fern_v2_LOD2.glb', distance: 30 },
];

// The fern GLBs are authored Z-up; Three.js is Y-up.
const FERN_MODEL_X_ROTATION = -Math.PI / 2;

// Hand-placed in normalized shoreline space so the food plants feel discovered rather
// than evenly distributed. Keep all berry bushes at the model's original scale.
const BUSH_LAYOUT = [
  { angle: 0.28, radius: 1.34, scale: 1.00, yaw: 0.4 },
  { angle: 1.17, radius: 1.46, scale: 1.00, yaw: 2.1 },
  { angle: 2.06, radius: 1.38, scale: 1.00, yaw: 4.7 },
  { angle: 3.02, radius: 1.51, scale: 1.00, yaw: 1.2 },
  { angle: 4.12, radius: 1.41, scale: 1.00, yaw: 5.4 },
  { angle: 5.22, radius: 1.47, scale: 1.00, yaw: 3.3 },
];

// Sparse taller anchors kept safely inside the grass shelf. Scale/yaw variation keeps repeated
// copies from reading like a ring of clones while still sharing each LOD's geometry/materials.
const TREE_LAYOUT = [
  { angle: 0.54, radius: 1.55, scale: 1.16, yaw: 0.25 },
  { angle: 1.34, radius: 1.48, scale: 1.32, yaw: 2.65 },
  { angle: 2.16, radius: 1.63, scale: 1.03, yaw: 4.35 },
  { angle: 3.04, radius: 1.52, scale: 1.24, yaw: 1.15 },
  { angle: 3.91, radius: 1.66, scale: 0.96, yaw: 5.20 },
  { angle: 4.76, radius: 1.46, scale: 1.36, yaw: 3.45 },
  { angle: 5.57, radius: 1.60, scale: 1.10, yaw: 0.85 },
];

// Ferns form a few loose pockets around the oasis instead of an artificial-looking ring.
// Keep them at authored scale; rotation and spacing provide the variation.
const FERN_LAYOUT = [
  { angle: 0.18, radius: 1.24, scale: 1.00, yaw: 0.35 },
  { angle: 0.52, radius: 1.42, scale: 1.00, yaw: 2.15 },
  { angle: 0.78, radius: 1.31, scale: 1.00, yaw: 4.50 },
  { angle: 2.18, radius: 1.29, scale: 1.00, yaw: 1.05 },
  { angle: 2.48, radius: 1.51, scale: 1.00, yaw: 3.80 },
  { angle: 3.78, radius: 1.33, scale: 1.00, yaw: 5.55 },
  { angle: 4.08, radius: 1.57, scale: 1.00, yaw: 2.65 },
  { angle: 5.22, radius: 1.27, scale: 1.00, yaw: 4.10 },
  { angle: 5.54, radius: 1.48, scale: 1.00, yaw: 0.90 },
];

const SHADOW_SEGMENTS = 4;
const SHADOW_WIDTH_PROFILE = [0.18, 0.70, 1.00, 0.72, 0.18];
const SHADOW_SURFACE_OFFSET = 0.045;

// These are deliberately conservative footprints. The previous generic values made the regular
// trees enormous on the ground and still too faint to read. Low plants get their own compact
// profile instead of borrowing tree dimensions.
const SHADOW_STYLES = Object.freeze({
  tree: Object.freeze({
    materialName: 'Alien tree projected shadows',
    meshName: 'Alien tree shadows',
    opacity: 0.46,
    height: 10.5,
    footprintLength: 3.8,
    projectionScale: 0.34,
    maxLength: 18,
    width: 4.8,
    seedBase: 0.9,
  }),
  fern: Object.freeze({
    materialName: 'Purple fern projected shadows',
    meshName: 'Purple fern shadows',
    opacity: 0.42,
    height: 2.4,
    footprintLength: 2.2,
    projectionScale: 0.20,
    maxLength: 4.8,
    width: 3.4,
    seedBase: 2.8,
  }),
  hero: Object.freeze({
    materialName: 'Crimson hero projected shadow',
    meshName: 'Crimson hero tree shadow',
    opacity: 0.52,
    height: 60,
    footprintLength: 14,
    projectionScale: 0.24,
    maxLength: 52,
    width: 24,
    seedBase: 4.7,
  }),
});

function radialPositions(layout) {
  return layout.map(item => ({
    ...item,
    x: WATER.x + Math.cos(item.angle) * WATER.radiusX * item.radius,
    z: WATER.z + Math.sin(item.angle) * WATER.radiusZ * item.radius,
  }));
}

function clearOfHero(items) {
  const minDistanceSq = HERO_TREE.clearRadius * HERO_TREE.clearRadius;
  return items.filter(item => {
    const dx = item.x - HERO_TREE.x;
    const dz = item.z - HERO_TREE.z;
    return dx * dx + dz * dz >= minDistanceSq;
  });
}

function smoothstep(a, b, value) {
  const t = THREE.MathUtils.clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// Quest-friendly projected vegetation shadows: no shadow map and no extra render of the GLBs.
// Each vegetation class is one tiny dynamic strip mesh laid directly over the terrain.
function createProjectedVegetationShadow({ field, items, sunDirection, style }) {
  const verticesPerItem = SHADOW_SEGMENTS * 6;
  const positions = new Float32Array(items.length * verticesPerItem * 3);
  const shadowUv = new Float32Array(items.length * verticesPerItem * 2);
  const shadowSeed = new Float32Array(items.length * verticesPerItem);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('shadowUv', new THREE.BufferAttribute(shadowUv, 2));
  geometry.setAttribute('shadowSeed', new THREE.BufferAttribute(shadowSeed, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    uniforms: {
      uOpacity: { value: 0 },
    },
    vertexShader: /* glsl */`
      attribute vec2 shadowUv;
      attribute float shadowSeed;
      varying vec2 vShadowUv;
      varying float vShadowSeed;
      void main() {
        vShadowUv = shadowUv;
        vShadowSeed = shadowSeed;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uOpacity;
      varying vec2 vShadowUv;
      varying float vShadowSeed;
      void main() {
        float sideFade = 1.0 - smoothstep(0.54, 1.0, abs(vShadowUv.x));
        float startFade = smoothstep(0.0, 0.055, vShadowUv.y);
        float endFade = 1.0 - smoothstep(0.84, 1.0, vShadowUv.y);
        float broad = sin((vShadowUv.x * 3.9 + vShadowUv.y * 6.7 + vShadowSeed) * 6.2831853);
        float cross = sin((vShadowUv.x * 7.1 - vShadowUv.y * 4.3 + vShadowSeed * 1.7) * 6.2831853);
        float dapple = clamp(0.79 + broad * 0.13 + cross * 0.09, 0.52, 1.0);
        float alpha = sideFade * startFade * endFade * dapple * uOpacity;
        if (alpha < 0.008) discard;
        gl_FragColor = vec4(0.008, 0.010, 0.008, alpha);
      }
    `,
  });
  material.name = style.materialName;

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = style.meshName;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.visible = false;

  function rebuild() {
    const sunY = sunDirection.y;
    const horizontal = Math.hypot(sunDirection.x, sunDirection.z);
    const daylight = smoothstep(-0.01, 0.24, sunY);
    material.uniforms.uOpacity.value = style.opacity * daylight;
    if (daylight <= 0.001 || items.length === 0) return false;

    const dirX = horizontal > 0.001 ? -sunDirection.x / horizontal : 0;
    const dirZ = horizontal > 0.001 ? -sunDirection.z / horizontal : 1;
    const sideX = -dirZ;
    const sideZ = dirX;
    let p = 0;
    let u = 0;
    let s = 0;

    function writeVertex(x, z, uvX, uvY, seed) {
      positions[p++] = x;
      positions[p++] = field.sample(x, z) + SHADOW_SURFACE_OFFSET;
      positions[p++] = z;
      shadowUv[u++] = uvX;
      shadowUv[u++] = uvY;
      shadowSeed[s++] = seed;
    }

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      const item = items[itemIndex];
      const scale = item.scale || 1;
      const height = style.height * scale;
      const footprintLength = style.footprintLength * scale;
      const projection = height * horizontal / Math.max(sunY, 0.22) * style.projectionScale;
      const length = Math.min(style.maxLength * scale, footprintLength + projection);
      const width = style.width * scale * (0.97 + (itemIndex % 3) * 0.025);
      const seed = style.seedBase + itemIndex * 1.618;
      const station = [];

      for (let i = 0; i <= SHADOW_SEGMENTS; i++) {
        const t = i / SHADOW_SEGMENTS;
        const along = (t - 0.16) * length;
        const centerX = item.x + dirX * along;
        const centerZ = item.z + dirZ * along;
        const halfWidth = width * 0.5 * SHADOW_WIDTH_PROFILE[i];
        station.push({
          lx: centerX + sideX * halfWidth,
          lz: centerZ + sideZ * halfWidth,
          rx: centerX - sideX * halfWidth,
          rz: centerZ - sideZ * halfWidth,
          t,
        });
      }

      for (let i = 0; i < SHADOW_SEGMENTS; i++) {
        const a = station[i];
        const b = station[i + 1];
        writeVertex(a.lx, a.lz, -1, a.t, seed);
        writeVertex(a.rx, a.rz, 1, a.t, seed);
        writeVertex(b.lx, b.lz, -1, b.t, seed);
        writeVertex(a.rx, a.rz, 1, a.t, seed);
        writeVertex(b.rx, b.rz, 1, b.t, seed);
        writeVertex(b.lx, b.lz, -1, b.t, seed);
      }
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.shadowUv.needsUpdate = true;
    geometry.attributes.shadowSeed.needsUpdate = true;
    return true;
  }

  return { mesh, rebuild };
}

function disableModelShadows(root) {
  root.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = false;
    object.receiveShadow = false;
  });
}

export function createOasisVegetation({ field, sunDirection = null }) {
  const group = new THREE.Group();
  group.name = 'Oasis vegetation';

  const bushes = clearOfHero(radialPositions(BUSH_LAYOUT));
  const trees = clearOfHero(radialPositions(TREE_LAYOUT));
  const ferns = clearOfHero(radialPositions(FERN_LAYOUT));
  const liveSun = sunDirection || new THREE.Vector3(SUN.x, SUN.y, SUN.z).normalize();

  const bushGroup = new THREE.Group();
  bushGroup.name = 'Berry bushes';
  group.add(bushGroup);

  const treeGroup = new THREE.Group();
  treeGroup.name = 'Alien desert trees';
  group.add(treeGroup);

  const fernGroup = new THREE.Group();
  fernGroup.name = 'Purple alien ferns';
  group.add(fernGroup);

  const heroGroup = new THREE.Group();
  heroGroup.name = 'Crimson hero tree';
  group.add(heroGroup);

  const regularTreeShadow = createProjectedVegetationShadow({
    field,
    items: trees,
    sunDirection: liveSun,
    style: SHADOW_STYLES.tree,
  });
  const fernShadow = createProjectedVegetationShadow({
    field,
    items: ferns,
    sunDirection: liveSun,
    style: SHADOW_STYLES.fern,
  });
  const heroTreeShadow = createProjectedVegetationShadow({
    field,
    items: [HERO_TREE],
    sunDirection: liveSun,
    style: SHADOW_STYLES.hero,
  });
  group.add(regularTreeShadow.mesh, fernShadow.mesh, heroTreeShadow.mesh);

  let bushLoadStarted = false;
  let treeLoadStarted = false;
  let fernLoadStarted = false;
  let heroLoadStarted = false;
  let bushesReady = false;
  let treesReady = false;
  let fernsReady = false;
  let heroReady = false;

  function ensureBushes() {
    if (bushLoadStarted) return;
    bushLoadStarted = true;
    const loader = new GLTFLoader();
    const url = `${import.meta.env.BASE_URL}models/berry-bush/desert_berry_bush_optimized.glb`;
    loader.load(url, gltf => {
      const source = gltf.scene;
      source.updateMatrixWorld(true);
      for (let i = 0; i < bushes.length; i++) {
        const item = bushes[i];
        const bush = source.clone(true);
        bush.name = `Berry bush ${i + 1}`;
        bush.position.set(item.x, field.sample(item.x, item.z) - 0.015, item.z);
        bush.rotation.y = item.yaw;
        bush.scale.setScalar(item.scale);
        bush.userData.foodSource = 'berries';
        bush.userData.berryBush = true;
        disableModelShadows(bush);
        bushGroup.add(bush);
      }
      bushesReady = true;
    }, undefined, error => {
      console.warn('[Oasis vegetation] Berry bush model unavailable.', error);
    });
  }

  function ensureTrees() {
    if (treeLoadStarted) return;
    treeLoadStarted = true;
    const loader = new GLTFLoader();
    const base = `${import.meta.env.BASE_URL}models/vegetation/alien-tree/`;

    Promise.all(TREE_LODS.map(async level => {
      const gltf = await loader.loadAsync(`${base}${level.file}`);
      const source = gltf.scene;
      source.updateMatrixWorld(true);
      disableModelShadows(source);
      return { ...level, source };
    })).then(levels => {
      for (let i = 0; i < trees.length; i++) {
        const item = trees[i];
        const lod = new THREE.LOD();
        lod.name = `Alien desert tree ${i + 1}`;
        lod.position.set(item.x, field.sample(item.x, item.z) - 0.02, item.z);
        lod.rotation.y = item.yaw;
        lod.scale.setScalar(item.scale);
        lod.userData.oasisTree = true;

        for (const level of levels) {
          const model = level.source.clone(true);
          model.userData.oasisTree = true;
          lod.addLevel(model, level.distance);
        }

        treeGroup.add(lod);
      }
      treesReady = true;
    }).catch(error => {
      console.warn('[Oasis vegetation] Alien desert tree LOD models unavailable.', error);
    });
  }

  function ensureFerns() {
    if (fernLoadStarted) return;
    fernLoadStarted = true;
    const loader = new GLTFLoader();
    const base = `${import.meta.env.BASE_URL}models/vegetation/purple-alien-fern/`;

    Promise.all(FERN_LODS.map(async level => {
      const gltf = await loader.loadAsync(`${base}${level.file}`);
      const source = gltf.scene;
      source.updateMatrixWorld(true);
      disableModelShadows(source);
      return { ...level, source };
    })).then(levels => {
      for (let i = 0; i < ferns.length; i++) {
        const item = ferns[i];
        const lod = new THREE.LOD();
        lod.name = `Purple alien fern ${i + 1}`;
        lod.position.set(item.x, field.sample(item.x, item.z) - 0.015, item.z);
        lod.rotation.y = item.yaw;
        lod.scale.setScalar(item.scale);
        lod.userData.oasisFern = true;

        for (const level of levels) {
          const model = level.source.clone(true);
          model.rotation.x = FERN_MODEL_X_ROTATION;
          model.userData.oasisFern = true;
          lod.addLevel(model, level.distance);
        }

        fernGroup.add(lod);
      }
      fernsReady = true;
    }).catch(error => {
      console.warn('[Oasis vegetation] Purple alien fern LOD models unavailable.', error);
    });
  }

  function ensureHeroTree() {
    if (heroLoadStarted) return;
    heroLoadStarted = true;
    const loader = new GLTFLoader();
    const url = `${import.meta.env.BASE_URL}models/vegetation/crimson-hero-tree/crimson_hero_tree_60m_optimized.glb`;
    loader.load(url, gltf => {
      const hero = gltf.scene;
      hero.name = 'Crimson hero tree — 60 m';
      hero.position.set(
        HERO_TREE.x,
        field.sample(HERO_TREE.x, HERO_TREE.z) - HERO_TREE.groundInset,
        HERO_TREE.z,
      );
      hero.rotation.y = HERO_TREE.yaw;
      hero.userData.oasisHeroTree = true;
      hero.updateMatrixWorld(true);
      disableModelShadows(hero);
      heroGroup.add(hero);
      heroReady = true;
    }, undefined, error => {
      console.warn('[Oasis vegetation] Crimson hero tree model unavailable.', error);
    });
  }

  function update(x, z) {
    const distance = Math.hypot(x - WATER.x, z - WATER.z);
    const heroDistance = Math.hypot(x - HERO_TREE.x, z - HERO_TREE.z);
    const shadowDaylight = liveSun.y > -0.01;
    bushGroup.visible = distance < BUSH_DRAW_DISTANCE;
    treeGroup.visible = distance < TREE_DRAW_DISTANCE;
    fernGroup.visible = distance < FERN_DRAW_DISTANCE;
    heroGroup.visible = heroDistance < HERO_DRAW_DISTANCE;
    regularTreeShadow.mesh.visible = treesReady && treeGroup.visible && shadowDaylight;
    fernShadow.mesh.visible = fernsReady && fernGroup.visible && shadowDaylight;
    heroTreeShadow.mesh.visible = heroReady && heroGroup.visible && shadowDaylight;
    if (regularTreeShadow.mesh.visible) regularTreeShadow.rebuild();
    if (fernShadow.mesh.visible) fernShadow.rebuild();
    if (heroTreeShadow.mesh.visible) heroTreeShadow.rebuild();
    if (distance < BUSH_LOAD_DISTANCE) ensureBushes();
    if (distance < TREE_LOAD_DISTANCE) ensureTrees();
    if (distance < FERN_LOAD_DISTANCE) ensureFerns();
    if (heroDistance < HERO_LOAD_DISTANCE) ensureHeroTree();
  }

  update(0, 0);
  return {
    group,
    update,
    bushGroup,
    treeGroup,
    fernGroup,
    heroGroup,
    regularTreeShadow: regularTreeShadow.mesh,
    fernShadow: fernShadow.mesh,
    heroTreeShadow: heroTreeShadow.mesh,
    get bushesReady() { return bushesReady; },
    get treesReady() { return treesReady; },
    get fernsReady() { return fernsReady; },
    get heroReady() { return heroReady; },
  };
}
