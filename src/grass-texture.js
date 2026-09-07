import * as THREE from 'three';

// Drop your seamless grass image in public/textures/grass/ and set its filename here.
// Example: export const GRASS_TEXTURE = 'grass_albedo.png';
export const GRASS_TEXTURE = null;
export const GRASS_TILE_METRES = 2.5;

export function attachGrassTexture(renderer, uniforms) {
  if (!GRASS_TEXTURE) return;
  new THREE.TextureLoader().load(
    `${import.meta.env.BASE_URL}textures/grass/${GRASS_TEXTURE}`,
    texture => {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      texture.needsUpdate = true;
      uniforms.uGrassBase.value.dispose();
      uniforms.uGrassBase.value = texture;
      uniforms.uHasGrassBase.value = 1;
    },
    undefined,
    () => console.warn('[Oasis grass] Texture unavailable; keeping the grass colour fallback.'),
  );
}
