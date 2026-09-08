import * as THREE from 'three';

// Seamless oasis grass/soil base. The vertical grass tufts are generated separately.
export const GRASS_TEXTURE = 'grass1.png';
export const GRASS_TILE_METRES = 3.2;

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
