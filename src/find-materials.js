import * as THREE from 'three';
import { exposureGlow } from './glow.js';

// The materials of the things you find in the dunes (src/find-shapes.js, src/mining.js).
//
//   Sandstone  real 1k PBR sandstone (Poly Haven "Cliff Side", CC0: colour + normal in public/textures/sandstone/). The shapes carry UVs
//              that keep its beds level. The photo loads in the background (about 0.5 MB); until it arrives the rock is painted the
//              photo's average colour, so it is never a different colour while loading (the same lesson as the palm fronds).
//   Crystal    a glossy standard material whose glow is multiplied by the vertex colour (the shapes are dark at the foot and pale at
//              the tip), so the tips shine most. The glow is set with exposureGlow, so it looks the same by day and by night.
//   Spire      plain vertex-coloured standard material.
//   Shard      the same material as the crystal, for the small piece you hold; and "Fibre" for the straw bundle.

const BASE = import.meta.env?.BASE_URL ?? '/';
export const SANDSTONE = Object.freeze({
  albedo: `${BASE}textures/sandstone/sandstone_albedo.jpg`,
  normal: `${BASE}textures/sandstone/sandstone_normal.jpg`,
  average: 0x7c5331, // the photo's average colour (sRGB), used until it arrives
  roughness: 0.9,
  normalScale: 1.1,
  lift: Object.freeze([1.55, 1.38, 1.2]), // multiplies the colour map (a plain white would leave the photo as dark as it is)
});

// How bright the crystals look (displayed brightness, the exposure divided out), by day and by night. The emissive is also scaled
// by each vertex's colour, which tops out around 1, so these are the glow of the brightest tip.
export const CRYSTAL_GLOW = Object.freeze({ day: 0.55, night: 1.05 });

// Multiplies the emissive light by the vertex colour. Chains to the standard night fill first (src/night-fill.js), because a material
// with its own onBeforeCompile would otherwise lose it.
function glowFollowsVertexColour(material) {
  const nightFillPatch = THREE.MeshStandardMaterial.prototype.onBeforeCompile;
  material.onBeforeCompile = function onBeforeCompileCrystal(shader, renderer) {
    nightFillPatch?.call(this, shader, renderer);
    if (!shader.fragmentShader.includes('#include <emissivemap_fragment>')) return;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )\n  totalEmissiveRadiance *= clamp(vColor.rgb, 0.0, 4.0);\n#endif',
    );
  };
  material.customProgramCacheKey = () => 'oasis-crystal-glow';
}

export function createFindMaterials({ renderer = null, getExposure = () => 1, onError = () => {} } = {}) {
  const rock = new THREE.MeshStandardMaterial({
    name: 'Sandstone', vertexColors: true, color: SANDSTONE.average, roughness: SANDSTONE.roughness, metalness: 0,
  });
  const loader = new THREE.TextureLoader();
  const anisotropy = renderer ? Math.min(4, renderer.capabilities.getMaxAnisotropy()) : 1;
  const prepare = (texture, colour) => {
    texture.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = anisotropy;
    return texture;
  };
  loader.load(SANDSTONE.albedo, texture => {
    rock.map = prepare(texture, true);
    rock.color.setRGB(...SANDSTONE.lift); // above 1 on purpose: the photo is a dark, red rock and this lifts it towards the sand's warmth
    rock.needsUpdate = true;
  }, undefined, () => onError('[Oasis finds] The sandstone colour map could not be loaded; the rock keeps its average colour.'));
  loader.load(SANDSTONE.normal, texture => {
    rock.normalMap = prepare(texture, false);
    rock.normalScale.set(SANDSTONE.normalScale, SANDSTONE.normalScale);
    rock.needsUpdate = true;
  }, undefined, () => onError('[Oasis finds] The sandstone normal map could not be loaded; the rock stays smooth.'));

  const crystal = new THREE.MeshStandardMaterial({
    name: 'Crystal', vertexColors: true, roughness: 0.26, metalness: 0.05, emissive: 0xffffff, emissiveIntensity: 1,
  });
  glowFollowsVertexColour(crystal);

  const spire = new THREE.MeshStandardMaterial({ name: 'Spire plant', vertexColors: true, roughness: 0.62, metalness: 0 });
  const fibre = new THREE.MeshStandardMaterial({ name: 'Fibre', vertexColors: true, roughness: 0.95, metalness: 0 });
  // the flying bits (src/bursts.js) are coloured by their instance colour
  const chips = new THREE.MeshStandardMaterial({ name: 'Rock chips', roughness: 0.9, metalness: 0 });
  const sparks = new THREE.MeshStandardMaterial({ name: 'Crystal chips', roughness: 0.3, emissive: 0xffffff, emissiveIntensity: 1 });
  glowFollowsVertexColour(sparks);

  let applied = -1;
  // Call every frame (cheap): sets the crystals' glow when the light changes.
  function update() {
    const intensity = exposureGlow(getExposure(), CRYSTAL_GLOW);
    if (Math.abs(intensity - applied) > 0.01 * intensity) {
      crystal.emissiveIntensity = intensity;
      sparks.emissiveIntensity = intensity;
      applied = intensity;
    }
  }
  update();
  return { rock, crystal, spire, fibre, chips, sparks, update };
}
