import * as THREE from 'three';
import { SUN } from './world.js';
import { installOasisWater } from './oasis-water.js';
import { createWaterFireflies } from './water-fireflies.js';

export const DAY_SECONDS = 5 * 60;
export const NIGHT_SECONDS = 5 * 60;
export const CYCLE_SECONDS = DAY_SECONDS + NIGHT_SECONDS;

const TAU = Math.PI * 2;
const INITIAL_SUN = new THREE.Vector3(SUN.x, SUN.y, SUN.z).normalize();
const SUN_PATH_AZIMUTH = Math.atan2(INITIAL_SUN.z, INITIAL_SUN.x);
const INITIAL_PHASE = Math.asin(THREE.MathUtils.clamp(INITIAL_SUN.y, -1, 1)) / TAU;

const DAY_SKY_LIGHT = new THREE.Color(0xc4ddf0);
const NIGHT_SKY_LIGHT = new THREE.Color(0x02050a);
const DAY_GROUND_LIGHT = new THREE.Color(0x7a5438);
const NIGHT_GROUND_LIGHT = new THREE.Color(0x000102);
const SUNRISE_LIGHT = new THREE.Color(0xff9d62);
const NOON_LIGHT = new THREE.Color(0xfff1d5);
const MOON_LIGHT = new THREE.Color(0x9eb6e8);

function smoothstep(a, b, value) {
  const t = THREE.MathUtils.clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function phaseFromElapsed(elapsedSeconds) {
  if (elapsedSeconds < DAY_SECONDS) return 0.5 * (elapsedSeconds / DAY_SECONDS);
  return 0.5 + 0.5 * ((elapsedSeconds - DAY_SECONDS) / NIGHT_SECONDS);
}

function elapsedFromPhase(phase) {
  const wrapped = ((phase % 1) + 1) % 1;
  if (wrapped < 0.5) return wrapped * 2 * DAY_SECONDS;
  return DAY_SECONDS + (wrapped - 0.5) * 2 * NIGHT_SECONDS;
}

export function createDayNightCycle({ scene, renderer, materials }) {
  if (!scene || !renderer || !materials?.sand?.uniforms?.uSun) {
    throw new Error('Day/night cycle requires the scene, renderer, and Oasis environment materials.');
  }

  installOasisWater(materials.water, (message) => console.warn(message));
  const fireflies = createWaterFireflies({ scene });

  // Standard PBR assets (hands now; props/buildings later) use real scene lights.
  // The terrain/water/sky remain on their lightweight custom shaders.
  const hemisphere = new THREE.HemisphereLight(DAY_SKY_LIGHT, DAY_GROUND_LIGHT, 1.2);
  hemisphere.name = 'DayNight_Hemisphere';

  const sunlight = new THREE.DirectionalLight(NOON_LIGHT, 3.0);
  sunlight.name = 'DayNight_Sun';
  sunlight.castShadow = false;
  sunlight.target.name = 'DayNight_SunTarget';

  const moonlight = new THREE.DirectionalLight(MOON_LIGHT, 0.0);
  moonlight.name = 'DayNight_Moon';
  moonlight.castShadow = false;
  moonlight.target.name = 'DayNight_MoonTarget';

  scene.add(hemisphere, sunlight, sunlight.target, moonlight, moonlight.target);

  // createMaterials shares the same uSun/uCloudTime uniform objects across sand, sky and water.
  const sunDirection = materials.sand.uniforms.uSun.value;
  const cloudTime = materials.sand.uniforms.uCloudTime || null;
  const moonDirection = new THREE.Vector3();
  const tempSky = new THREE.Color();
  const tempGround = new THREE.Color();

  let elapsedSeconds = elapsedFromPhase(INITIAL_PHASE);
  let cloudSeconds = 0;
  let paused = false;
  let state = null;

  function apply() {
    const phase = phaseFromElapsed(elapsedSeconds);
    const angle = phase * TAU;
    const horizontal = Math.cos(angle);

    sunDirection.set(
      Math.cos(SUN_PATH_AZIMUTH) * horizontal,
      Math.sin(angle),
      Math.sin(SUN_PATH_AZIMUTH) * horizontal
    ).normalize();
    moonDirection.copy(sunDirection).multiplyScalar(-1);

    const sunHeight = sunDirection.y;
    const daylight = smoothstep(-0.07, 0.14, sunHeight);
    const moonAmount = smoothstep(0.05, 0.30, -sunHeight);
    const twilight = 1 - smoothstep(0.0, 0.32, Math.abs(sunHeight));
    const warmToWhite = smoothstep(0.03, 0.45, sunHeight);

    sunlight.position.copy(sunDirection).multiplyScalar(1000);
    sunlight.intensity = 3.0 * daylight;
    sunlight.color.copy(SUNRISE_LIGHT).lerp(NOON_LIGHT, warmToWhite);

    moonlight.position.copy(moonDirection).multiplyScalar(1000);
    moonlight.intensity = 0.10 * moonAmount;

    tempSky.copy(NIGHT_SKY_LIGHT).lerp(DAY_SKY_LIGHT, daylight);
    tempGround.copy(NIGHT_GROUND_LIGHT).lerp(DAY_GROUND_LIGHT, daylight);
    hemisphere.color.copy(tempSky);
    hemisphere.groundColor.copy(tempGround);
    hemisphere.intensity = 0.012 + daylight * 1.228 + twilight * 0.045;

    // Twilight remains readable, but once it has passed, unaided night vision should be poor.
    // This is intentional survival-game darkness: practical navigation should want a torch.
    const baseExposure = THREE.MathUtils.lerp(0.035, 1.05, daylight);
    renderer.toneMappingExposure = Math.max(baseExposure, 0.30 * twilight);

    state = {
      phase,
      hours: (6 + phase * 24) % 24,
      daylight,
      twilight,
      isDay: sunHeight >= 0,
      sunHeight
    };
  }

  function update(dt) {
    if (Number.isFinite(dt) && dt > 0) {
      if (!paused) elapsedSeconds = (elapsedSeconds + dt) % CYCLE_SECONDS;
      // Cloud drift is environmental motion, so pausing the accelerated sun cycle does not
      // freeze the wind. Wrap occasionally to keep the uniform numerically tidy.
      cloudSeconds = (cloudSeconds + dt) % 100000;
      if (cloudTime) cloudTime.value = cloudSeconds;
    }
    apply();
    fireflies.update(dt, state);
    return state;
  }

  function setTimeOfDay(hours) {
    if (!Number.isFinite(hours)) return state;
    const wrappedHours = ((hours % 24) + 24) % 24;
    const phase = ((wrappedHours - 6) / 24 + 1) % 1;
    elapsedSeconds = elapsedFromPhase(phase);
    apply();
    fireflies.update(0, state);
    return state;
  }

  function setPaused(value) {
    paused = Boolean(value);
    return paused;
  }

  apply();
  fireflies.update(0, state);

  return {
    update,
    setTimeOfDay,
    setPaused,
    isPaused: () => paused,
    getState: () => ({ ...state }),
    lights: { hemisphere, sunlight, moonlight },
    fireflies
  };
}
