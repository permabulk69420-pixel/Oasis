import * as THREE from 'three';

// Light from the sky for the solid (PBR) models (the owner, 7 Oct: the game had nothing for its metal, wood, stone and chitin to reflect, so they
// looked flat). An environment map painted from the day/night cycle's own sky: the zenith and the horizon in the sky light's colour, warmer toward
// the low sun, the sun itself as a bright soft spot, the desert's warm bounce below, and at night almost nothing (a faint cool moon glow), so the
// night stays as dark as it was. It is repainted as the sun moves (every couple of seconds, a few rows a frame, into the same small render target, so nothing new is made).
//
// OPT IN, model by model (`skyLight(root)`): the terrain, water, sky, foliage, glows and every material with its own shader code are never touched
// (a material that sets its own onBeforeCompile is skipped, as is one marked userData.noSkyLight), so nothing that was tuned changes. How strong it
// is follows the daylight. Dev: ?sky-env=0 turns it off (to compare), ?sky-env=2 doubles it.

export const SKY_ENV = Object.freeze({
  width: 128, height: 64,                 // the painted sky (a 32 px cube once filtered: these are soft reflections, the sun a soft highlight)
  rowsPerFrame: 4,                        // it is painted a few rows a frame (all at once it would cost a frame on the headset), then filtered
  repaintEvery: 1.5,                      // seconds, at most
  repaintAngle: 1.2 * Math.PI / 180,      // the sun moved this far
  repaintLight: 0.015,                    // or the daylight changed this much
  strength: Object.freeze({ day: 0.85, twilight: 0.55, night: 0.04 }),
  sun: Object.freeze({ core: 400, coreGain: 5.0, glow: 8, glowGain: 0.45 }),
});

const devScale = (() => {
  try {
    const v = new URLSearchParams(globalThis.location?.search ?? '').get('sky-env');
    return v === null ? 1 : Math.max(0, Number(v) || 0);
  } catch { return 1; }
})();

// The colour of the painted sky in a direction (x, y, z: unit), into out[0..2] (linear). Pure: tests and the painter share it.
export function skyRadiance(x, y, z, sky, out) {
  const { zenith, horizon, ground, sun, sunColor, sunAmount, moon, moonColor, moonAmount, warm } = sky;
  const s = Math.max(0, x * sun.x + y * sun.y + z * sun.z);
  let r, g, b;
  if (y >= 0) {
    const t = Math.pow(y, 0.55);
    // the horizon warms toward the sun (the sun is always low here)
    const w = warm * Math.pow(s, 2.5), k = 0.9 * sunAmount;                 // (toward the sun's colour at the sun's strength: nothing at night)
    const hr = horizon.r + (sunColor.r * k - horizon.r) * w, hg = horizon.g + (sunColor.g * k - horizon.g) * w, hb = horizon.b + (sunColor.b * k - horizon.b) * w;
    r = hr + (zenith.r - hr) * t; g = hg + (zenith.g - hg) * t; b = hb + (zenith.b - hb) * t;
  } else {
    // the desert's bounce: brightest just under the horizon, darker straight down
    const t = Math.min(1, -y * 1.6);
    const k = 1 - 0.45 * t;
    r = ground.r * k; g = ground.g * k; b = ground.b * k;
    // a thin blend across the horizon line
    const blend = Math.max(0, 1 + y * 12);
    r += (horizon.r - r) * blend * 0.5; g += (horizon.g - g) * blend * 0.5; b += (horizon.b - b) * blend * 0.5;
  }
  // the sun: a bright core and a wide glow (above or just below the horizon)
  const S = SKY_ENV.sun;
  const sunLight = sunAmount * (S.coreGain * Math.pow(s, S.core) + S.glowGain * Math.pow(s, S.glow));
  r += sunColor.r * sunLight; g += sunColor.g * sunLight; b += sunColor.b * sunLight;
  // the moon's faint glow
  const m = Math.max(0, x * moon.x + y * moon.y + z * moon.z);
  const moonLight = moonAmount * (0.5 * Math.pow(m, 300) + 0.06 * Math.pow(m, 6));
  r += moonColor.r * moonLight; g += moonColor.g * moonLight; b += moonColor.b * moonLight;
  out[0] = r; out[1] = g; out[2] = b;
  return out;
}

export function createSkyEnvironment({ renderer, dayNight }) {
  const W = SKY_ENV.width, H = SKY_ENV.height;
  const data = new Uint16Array(W * H * 4);
  const equirect = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  equirect.mapping = THREE.EquirectangularReflectionMapping;
  equirect.colorSpace = THREE.LinearSRGBColorSpace;
  equirect.magFilter = equirect.minFilter = THREE.LinearFilter;
  equirect.generateMipmaps = false;
  equirect.flipY = false;
  const pmrem = renderer?.isWebGLRenderer ? new THREE.PMREMGenerator(renderer) : null;
  let target = null;
  const materials = new Set();
  const lastSun = new THREE.Vector3(0, -1, 0);
  let lastDaylight = -1, sinceRepaint = Infinity, strength = 0;
  const sky = {
    zenith: new THREE.Color(), horizon: new THREE.Color(), ground: new THREE.Color(), sunColor: new THREE.Color(), moonColor: new THREE.Color(),
    sun: new THREE.Vector3(), moon: new THREE.Vector3(), sunAmount: 0, moonAmount: 0, warm: 0,
  };
  const px = [0, 0, 0];
  const ONE = THREE.DataUtils.toHalfFloat(1);

  function readSky() {
    const { hemisphere, sunlight, moonlight } = dayNight.lights;
    const state = dayNight.getState();
    sky.sun.copy(sunlight.position).normalize();
    sky.moon.copy(moonlight.position).normalize();
    // the hemisphere light's colours are the sky's and the ground's (times its intensity, as it lights things)
    const hi = hemisphere.intensity;
    sky.zenith.copy(hemisphere.color).multiplyScalar(hi * 0.85);
    sky.horizon.copy(hemisphere.color).multiplyScalar(hi * 1.1).lerp(sunlight.color.clone().multiplyScalar(hi), 0.25);
    sky.ground.copy(hemisphere.groundColor).multiplyScalar(hi * 0.9 + 0.35 * (sunlight.intensity / 3));
    sky.sunColor.copy(sunlight.color);
    sky.sunAmount = sunlight.intensity / 3;
    sky.moonColor.copy(moonlight.color);
    sky.moonAmount = moonlight.intensity / 0.14 * 0.04;
    sky.warm = 0.55 * (state.twilight ?? 0) + 0.2;
    return state;
  }

  // painting in progress: the next row, or -1 when idle
  let row = -1;
  function paintRows(count) {
    let i = row * W * 4;
    const end = Math.min(H, row + count);
    for (; row < end; row++) {
      // three's equirect lookup: v = asin(y) / pi + 0.5 (row 0 = v 0 = straight down, as the texture is not flipped), u = atan(z, x) / 2pi + 0.5
      const lat = ((row + 0.5) / H - 0.5) * Math.PI;
      const cy = Math.sin(lat), cr = Math.cos(lat);
      for (let col = 0; col < W; col++) {
        const lon = ((col + 0.5) / W - 0.5) * Math.PI * 2;
        skyRadiance(cr * Math.cos(lon), cy, cr * Math.sin(lon), sky, px);
        data[i++] = THREE.DataUtils.toHalfFloat(px[0]);
        data[i++] = THREE.DataUtils.toHalfFloat(px[1]);
        data[i++] = THREE.DataUtils.toHalfFloat(px[2]);
        data[i++] = ONE;
      }
    }
    if (row < H) return false;
    row = -1;
    equirect.needsUpdate = true;
    const next = pmrem.fromEquirectangular(equirect, target);
    if (!target) target = next;
    for (const m of materials) if (m.envMap !== target.texture) { m.envMap = target.texture; m.needsUpdate = true; }
    return true;
  }

  function update(dt) {
    if (!pmrem || devScale === 0) return;
    sinceRepaint += dt;
    const state = dayNight.getState();
    if (row >= 0) paintRows(target ? SKY_ENV.rowsPerFrame : H);          // (the first one all at once, at load)
    else {
      const sun = dayNight.lights.sunlight.position;
      const moved = lastSun.angleTo(sun) > SKY_ENV.repaintAngle || Math.abs((state.daylight ?? 0) - lastDaylight) > SKY_ENV.repaintLight;
      if ((moved && sinceRepaint >= SKY_ENV.repaintEvery) || !target) {
        readSky();                                                          // the sky as it is now, painted over the next frames
        lastSun.copy(sky.sun); lastDaylight = state.daylight ?? 0; sinceRepaint = 0;
        row = 0;
        if (!target) paintRows(H);
      }
    }
    const S = SKY_ENV.strength;
    const day = state.daylight ?? 1, dusk = state.twilight ?? 0;
    strength = Math.max(S.night + (S.day - S.night) * day, S.twilight * dusk * day) * devScale;
    for (const m of materials) m.envMapIntensity = strength * (m.userData.skyLightStrength ?? 1);
  }

  // Give a model's solid materials the sky's light (once each). strength: a multiplier for this model (1 = as the world). Returns how many it took.
  function skyLight(root, { strength: k = 1 } = {}) {
    if (!root || devScale === 0) return 0;
    let n = 0;
    root.traverse(o => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) continue;
        if (m.userData.noSkyLight || m.envMap) continue;                                    // its own environment (the watch), or opted out
        if (Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile')) continue;           // its own shader code: left exactly as it is
        if (materials.has(m)) continue;
        m.userData.skyLightStrength = k;
        if (target) { m.envMap = target.texture; m.needsUpdate = true; }
        m.envMapIntensity = strength * k;
        materials.add(m);
        n++;
      }
    });
    return n;
  }

  return { update, skyLight, get texture() { return target?.texture ?? null; }, get strength() { return strength; }, materials, equirect };
}

// The one the game uses (main.js makes it): modules call skyLight() on what they load, before or after it exists.
let shared = null;
const waiting = [];
export function setSkyEnvironment(env) {
  shared = env;
  for (const [root, options] of waiting.splice(0)) env.skyLight(root, options);
}
export function skyLight(root, options) {
  if (shared) return shared.skyLight(root, options);
  waiting.push([root, options]);
  return 0;
}
// The same for materials made in code (a list), not a loaded model.
export function skyLightMaterials(list, options) {
  return skyLight({ traverse: visit => { for (const material of list) visit({ isMesh: true, material }); } }, options);
}
