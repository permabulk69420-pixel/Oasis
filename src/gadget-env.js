import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Something to reflect for the watch and its menu's frame (the game has no environment map, so their gunmetal and steel would render flat black):
// one small studio environment, made once, shared. How much it shows follows the daylight (the caller sets envMapIntensity), so at night the metal
// stays dark and only the cyan marks and the screen light up.
let texture = null;
export function gadgetEnvironment(renderer) {
  if (texture || !renderer?.isWebGLRenderer) return texture;
  const pmrem = new THREE.PMREMGenerator(renderer);
  texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// envMapIntensity for the time of day, from the tone mapping exposure (as src/glow.js reads it)
export function gadgetReflection(exposure) {
  return 0.05 + 0.55 * THREE.MathUtils.smoothstep(exposure, 0.07, 0.5);
}

// Give a loaded model's metal (metalness > 0.5) the environment; returns the materials, for setting their intensity each frame.
export function reflectMetal(root, renderer) {
  const env = gadgetEnvironment(renderer);
  const metals = [];
  if (!env) return metals;
  root.traverse(o => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m?.isMeshStandardMaterial && m.metalness > 0.5 && !metals.includes(m)) { m.envMap = env; m.envMapIntensity = 0.5; m.needsUpdate = true; metals.push(m); }
    }
  });
  return metals;
}
