import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { terrainHeight, isInPond } from './world.js';
import { createFireEffect } from './fire-effect.js';
import { createLoop } from './audio.js';
import { findTerrainMesh, TORCH_SHADER_MARKERS } from './night-fill.js';
import { pulseHaptics } from './haptics.js';
import { skyLight } from './sky-environment.js';

// Campfires: a placed structure (stone ring and logs) that you light with a burning torch.
// The model is built by tools/campfire/build_campfire.py. When lit, a flame and warm light
// sit at its FlameAnchor, the embers glow, the ground and water nearby catch the light, and a
// fire crackles with distance. Fire stays lit once started: fuel is a later feature.

const BASE = import.meta.env?.BASE_URL ?? '/';

export const CAMPFIRE = Object.freeze({
  url: `${BASE}models/campfire/campfire.glb`,
  audioUrl: `${BASE}audio/fire/torch_fire_crackle_loop.mp3`,
  audioVolume: 0.8,
  audioRange: 26, // metres: the crackle fades to nothing by here
  maxCount: 3, // also the size of the shader's light arrays
  placeDistance: 1.6, // metres in front of you
  minSpacing: 2.5, // no stacking fires
  igniteRadius: 0.5, // a lit torch this close to the logs lights them
  ignitePointHeight: 0.3, // above the ground at the fire's centre
  lightHeight: 0.7, // above the ground, higher than the log pile so the logs are not blown out
  lightRange: 17,
  lightIntensity: 150,
  lightDecay: 1, // gentler than physical falloff: near surfaces are not blown out, far ones still glow
  lightColor: 0xff9a45,
  fadeInSeconds: 1.6,
  footprint: 0.5, // radius of the stone ring: the ground is judged over this
  maxSlope: 0.30, // metres of height difference across the ring (about 17 degrees)
  emberGlow: 1.15, // coal glow at full strength, in displayed brightness
  fullLightExposure: 0.07, // at this tone-mapping exposure or darker the fire's light is at full strength
});

const FIRE_LIGHT_SLOTS = CAMPFIRE.maxCount;

// ---- pure helpers (unit tested) ----

// Where a campfire goes when placed: straight ahead on the ground.
export function campfireSpot(head, forward, distance = CAMPFIRE.placeDistance) {
  const length = Math.hypot(forward.x, forward.z);
  const fx = length > 1e-3 ? forward.x / length : 0;
  const fz = length > 1e-3 ? forward.z / length : -1;
  return { x: head.x + fx * distance, z: head.z + fz * distance };
}

// Ground under a campfire: its height (halfway between the highest and lowest point under the ring,
// the stones reach underground to cover the rest) and how much the ground tilts across it.
export function campfireSite(x, z, heightAt = terrainHeight, radius = CAMPFIRE.footprint) {
  const heights = [heightAt(x, z), heightAt(x + radius, z), heightAt(x - radius, z), heightAt(x, z + radius), heightAt(x, z - radius)];
  const low = Math.min(...heights), high = Math.max(...heights);
  return { y: (low + high) / 2, slope: high - low };
}

// The turn a fire at this spot gets: different for every fire, the same for the same spot (so a reloaded save puts it back the same way).
export function campfireYaw(x, z) {
  return ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1 + 1) % 1 * Math.PI * 2;
}

export function canPlaceCampfire(x, z, existing = [], heightAt = terrainHeight) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, message: 'Can’t build a fire there.' };
  if (existing.length >= CAMPFIRE.maxCount) return { ok: false, message: 'That’s enough fires for now.' };
  if (isInPond(x, z)) return { ok: false, message: 'You can’t build a fire in the water.' };
  if (existing.some(fire => Math.hypot(fire.x - x, fire.z - z) < CAMPFIRE.minSpacing)) {
    return { ok: false, message: 'There’s already a fire right here.' };
  }
  if (campfireSite(x, z, heightAt).slope > CAMPFIRE.maxSlope) {
    return { ok: false, message: 'The ground is too steep for a fire. Find flatter ground.' };
  }
  return { ok: true, message: '' };
}

// First lit flame within reach of the ignition point, or null. Flames are { position: Vector3 }.
export function findIgnitingFlame(flames, point, radius = CAMPFIRE.igniteRadius) {
  for (const flame of flames || []) {
    if (flame?.position && flame.position.distanceTo(point) <= radius) return flame;
  }
  return null;
}

// 1 at the fire, 0 at `range` and beyond, falling off smoothly.
export function crackleVolume(distance, range = CAMPFIRE.audioRange, volume = CAMPFIRE.audioVolume) {
  if (!(distance < range)) return 0;
  const t = 1 - Math.max(0, distance) / range;
  return volume * t * t;
}

// ---- lighting the ground and water around a fire (custom shaders, like the torch) ----

// The lines of the terrain and water shaders the fire light hooks into are the torch's (src/night-fill.js TORCH_SHADER_MARKERS): one list, one test
// (tests/night-fill.test.js) that src/materials.js still has them. The campfire kept its own copy of the terrain's light line, the sun's colour
// became `sunColour()` in the twilight change (#97), and from then on no fire lit the ground and nothing said so but one console warning.
const TERRAIN_UNIFORM = TORCH_SHADER_MARKERS.terrain.uniform;
const TERRAIN_LIGHT = TORCH_SHADER_MARKERS.terrain.light;
const WATER_UNIFORM = TORCH_SHADER_MARKERS.water.uniform;
const WATER_COLOR = TORCH_SHADER_MARKERS.water.colour;

const FIRE_UNIFORMS = `uniform vec3 uFirePositions[${FIRE_LIGHT_SLOTS}];\n      uniform float uFireStrengths[${FIRE_LIGHT_SLOTS}];`;

const TERRAIN_BLOCK = `
        for (int fi = 0; fi < ${FIRE_LIGHT_SLOTS}; fi++) {
          if (uFireStrengths[fi] > 0.001) {
            vec3 fireVector = uFirePositions[fi] - vWorld;
            float fireDistance = length(fireVector);
            vec3 fireDirection = fireVector / max(fireDistance, 0.001);
            float fireFade = 1.0 - smoothstep(1.0, 17.0, fireDistance);
            fireFade *= 0.55 + 0.45 * fireFade;
            float fireDiffuse = max(dot(n, fireDirection), 0.0);
            light += vec3(13.0, 5.2, 1.5) * uFireStrengths[fi] * fireFade * (0.35 + 0.65 * fireDiffuse);
            if (grass > 0.001) grassDirectLighting += vec3(13.0, 5.2, 1.5) * uFireStrengths[fi] * fireFade * grassPbrDirect(base, grassPerceptualRoughness, n, view, fireDirection);
          }
        }`;

const WATER_BLOCK = `for (int fi = 0; fi < ${FIRE_LIGHT_SLOTS}; fi++) {
          if (uFireStrengths[fi] > 0.001) {
            vec3 fireVector = uFirePositions[fi] - vWorld;
            float fireDistance = length(fireVector);
            vec3 fireDirection = fireVector / max(fireDistance, 0.001);
            float fireFade = 1.0 - smoothstep(0.35, 15.0, fireDistance);
            fireFade *= fireFade;
            float fireFacing = max(dot(normal, fireDirection), 0.0);
            vec3 fireReflection = reflect(-fireDirection, normal);
            float fireGlint = pow(max(dot(fireReflection, view), 0.0), 92.0);
            float fireScatter = exp(-vDepth * 1.55) * (1.0 - fresnel);
            vec3 fireColor = vec3(1.0, 0.31, 0.065);
            transmission += fireColor * uFireStrengths[fi] * fireFade * fireScatter * (0.05 + 0.12 * fireFacing);
            reflectedColor += fireColor * uFireStrengths[fi] * fireFade * (0.03 * fireFacing + 2.4 * fireGlint);
          }
        }
        `;

// Adds the fire-light uniform arrays and loop to a terrain or water ShaderMaterial. Safe to call
// again: it only patches a material once. Returns false if the shader is not the expected one.
export function installFireLights(material, kind, uniforms) {
  if (!material?.isShaderMaterial) return false;
  if (material.userData.fireLightInstalled) return true;
  const uniformMarker = kind === 'water' ? WATER_UNIFORM : TERRAIN_UNIFORM;
  const codeMarker = kind === 'water' ? WATER_COLOR : TERRAIN_LIGHT;
  const source = material.fragmentShader;
  if (!source.includes(uniformMarker) || !source.includes(codeMarker)) return false;

  material.uniforms.uFirePositions = uniforms.uFirePositions;
  material.uniforms.uFireStrengths = uniforms.uFireStrengths;
  let patched = source.replace(uniformMarker, () => `${uniformMarker}\n      ${FIRE_UNIFORMS}`);
  patched = kind === 'water'
    ? patched.replace(codeMarker, () => `${WATER_BLOCK}${codeMarker}`)
    : patched.replace(codeMarker, () => `${codeMarker}${TERRAIN_BLOCK}`);
  material.fragmentShader = patched;
  material.userData.fireLightInstalled = true;
  material.needsUpdate = true;
  return true;
}

// ---- the campfires in the world ----

const FLAME_SCALES = [[1.0, 1.0], [0.8, 0.85], [0.9, 0.7], [0.7, 0.9], [0.85, 0.78]];
const viewPosition = new THREE.Vector3();
const lightPosition = new THREE.Vector3();

// heightAt must be the ground the player actually sees (the terrain field's sample), and
// getExposure the renderer's tone-mapping exposure, so the coals glow the same by day and night.
export function createCampfires({
  scene, getFlames = () => [], getExposure = () => 1, heightAt = terrainHeight, template = null, onError = console.warn,
} = {}) {
  if (!scene) throw new Error('Campfires need the scene.');

  const instances = [];
  const uniforms = {
    uFirePositions: { value: Array.from({ length: FIRE_LIGHT_SLOTS }, () => new THREE.Vector3(0, -1000, 0)) },
    uFireStrengths: { value: new Array(FIRE_LIGHT_SLOTS).fill(0) },
  };
  // One shared light for every fire, moved to the nearest lit one. It always exists, so the
  // scene's light count never changes (which would force every material to recompile).
  const light = new THREE.PointLight(CAMPFIRE.lightColor, 0, CAMPFIRE.lightRange, CAMPFIRE.lightDecay);
  light.name = 'Campfire warm light';
  light.castShadow = false;
  scene.add(light);

  let model = template;
  let terrainReady = false, waterReady = false;
  let elapsed = 0;

  if (!model) {
    new GLTFLoader().load(CAMPFIRE.url, gltf => {
      model = gltf.scene;
      skyLight(model); // (its stones and logs; the fire's own shader is left alone)
      model.name = 'Campfire template';
      model.updateMatrixWorld(true);
    }, undefined, error => onError(`[Oasis campfire] Model failed to load: ${error?.message || error}`));
  }

  function ensureEnvironmentLighting() {
    if (!terrainReady) {
      const terrain = findTerrainMesh(scene);
      if (terrain?.material) {
        terrainReady = installFireLights(terrain.material, 'terrain', uniforms);
        if (!terrainReady) onError('[Oasis campfire] Could not add fire light to the terrain shader.');
      }
    }
    if (!waterReady) {
      const water = scene.getObjectByName('Shallow water');
      if (water?.material) {
        waterReady = installFireLights(water.material, 'water', uniforms);
        if (!waterReady) onError('[Oasis campfire] Could not add fire light to the water shader.');
      }
    }
  }

  function canPlace(x, z) {
    if (!model) return { ok: false, message: 'The campfire is still loading. Try again in a moment.' };
    return canPlaceCampfire(x, z, instances, heightAt);
  }

  // A copy of the fire's model for the placement ghost (null until it has loaded). The caller restyles it.
  function createPreview() {
    return model ? model.clone(true) : null;
  }

  function place(x, z, { lit = false } = {}) {
    if (!canPlace(x, z).ok) return null;
    const root = model.clone(true);
    root.name = 'Campfire';
    root.userData.campfire = true;
    const groundY = campfireSite(x, z, heightAt).y;
    root.position.set(x, groundY, z);
    // A different turn for every fire, but the same one for the same spot.
    root.rotation.y = campfireYaw(x, z);
    root.traverse(object => {
      if (!object.isMesh) return;
      object.castShadow = false;
      object.receiveShadow = false;
    });

    let anchor = root.getObjectByName('FlameAnchor');
    if (!anchor) {
      anchor = new THREE.Group();
      anchor.name = 'FlameAnchor_RuntimeFallback';
      anchor.position.set(0, 0.14, 0);
      root.add(anchor);
      onError('[Oasis campfire] FlameAnchor missing from the model; using a fallback.');
    }
    const embers = root.getObjectByName('Embers');
    if (embers?.material) {
      embers.material = embers.material.clone(); // own copy per fire: each glows on its own
      embers.material.emissiveIntensity = 0; // cold coals are just dark lumps
    }

    const fx = createFireEffect();
    fx.group.visible = false;
    anchor.add(fx.group);

    scene.add(root);
    root.updateMatrixWorld(true);
    const flamePosition = new THREE.Vector3().setFromMatrixPosition(anchor.matrixWorld);
    const fire = {
      root, x, z, anchor, embers, fx, flamePosition,
      ignitionPoint: new THREE.Vector3(x, groundY + CAMPFIRE.ignitePointHeight, z),
      lit: false, strength: 0, audio: null, seed: x * 0.37 + z * 0.61,
    };
    instances.push(fire);
    if (lit) setLit(fire, true);
    return fire;
  }

  function setLit(fire, value) {
    fire.lit = Boolean(value);
    fire.fx.group.visible = fire.lit;
    if (!fire.lit) {
      fire.strength = 0;
      if (fire.embers?.material) fire.embers.material.emissiveIntensity = 0;
      fire.audio?.pause();
    }
    return fire.lit;
  }

  function update(dt, view = null) {
    const step = THREE.MathUtils.clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
    elapsed += step;
    ensureEnvironmentLighting();

    if (view) view.getWorldPosition(viewPosition);
    else viewPosition.set(0, -1000, 0);

    if (instances.some(fire => !fire.lit)) {
      const flames = getFlames();
      if (flames?.length) {
        for (const fire of instances) {
          if (fire.lit) continue;
          const hit = findIgnitingFlame(flames, fire.ignitionPoint);
          if (!hit) continue;
          setLit(fire, true);
          pulseHaptics(hit.heldBy, 0.5, 90);
        }
      }
    }

    // The light is tuned for the night's tiny exposure. By day the same light would blow the stones out
    // white (and the sun makes it matter far less), so it fades as the exposure rises.
    const dayFactor = THREE.MathUtils.clamp(CAMPFIRE.fullLightExposure / Math.max(getExposure(), 0.02), 0.05, 1);
    const day = THREE.MathUtils.smoothstep(getExposure(), 0.07, 0.5); // 0 at night, 1 by day: the smoke's colour

    let nearest = null, nearestDistance = Infinity;
    let slot = 0;
    for (const fire of instances) {
      if (!fire.lit) continue;
      fire.strength = Math.min(1, fire.strength + step / CAMPFIRE.fadeInSeconds);
      const eased = fire.strength * fire.strength * (3 - 2 * fire.strength);
      const flicker = 0.90
        + Math.sin(elapsed * 11.3 + fire.seed) * 0.06
        + Math.sin(elapsed * 19.1 + fire.seed * 2.3) * 0.035
        + Math.sin(elapsed * 6.7 + fire.seed * 0.7) * 0.03;
      const strength = THREE.MathUtils.clamp(flicker, 0.78, 1.08);
      fire.fx.update(elapsed + fire.seed, strength, eased, day);
      if (fire.embers?.material) {
        // Displayed brightness is the same by day and night: undo the tone-mapping exposure.
        const glow = CAMPFIRE.emberGlow * (0.85 + (strength - 0.9) * 1.6) * eased;
        fire.embers.material.emissiveIntensity = glow / Math.max(getExposure(), 0.02);
      }

      const distance = fire.flamePosition.distanceTo(viewPosition);
      if (slot < FIRE_LIGHT_SLOTS) {
        uniforms.uFirePositions.value[slot].copy(fire.flamePosition).y += CAMPFIRE.lightHeight - 0.14;
        uniforms.uFireStrengths.value[slot] = strength * eased * dayFactor;
        slot++;
      }
      if (distance < nearestDistance) { nearest = fire; nearestDistance = distance; light.userData.strength = strength * eased; }

      const volume = crackleVolume(distance) * eased;
      if (volume > 0.004) {
        fire.audio ??= createLoop(CAMPFIRE.audioUrl, { volume, onError });
        fire.audio.setVolume(volume);
        fire.audio.play();
      } else fire.audio?.pause();
    }
    for (; slot < FIRE_LIGHT_SLOTS; slot++) uniforms.uFireStrengths.value[slot] = 0;

    if (nearest) {
      lightPosition.copy(nearest.flamePosition);
      lightPosition.y += CAMPFIRE.lightHeight - 0.14;
      light.position.copy(lightPosition);
      light.intensity = CAMPFIRE.lightIntensity * light.userData.strength * dayFactor;
    } else light.intensity = 0;
  }

  return {
    update,
    place,
    canPlace,
    createPreview,
    siteAt: (x, z) => campfireSite(x, z, heightAt),
    setLit,
    light,
    uniforms,
    get ready() { return Boolean(model); },
    get count() { return instances.length; },
    list: () => instances.slice(),
  };
}
