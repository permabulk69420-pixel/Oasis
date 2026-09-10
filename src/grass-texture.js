import * as THREE from 'three';

// Oasis ground PBR. The vertical grass geometry is generated separately.
export const GRASS_TEXTURES = {
  base: 'stylized-grass1_albedo.png',
  normal: 'stylized-grass1_normal-ogl.png',
  roughness: 'stylized-grass1_roughness.png',
};
export const GRASS_TILE_METRES = 3.2;

function configureTexture(texture, renderer, color = false) {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  texture.needsUpdate = true;
  return texture;
}

function replaceUniformTexture(uniforms, textureUniform, flagUniform, texture) {
  if (!uniforms[textureUniform]) uniforms[textureUniform] = { value: texture };
  else {
    uniforms[textureUniform].value?.dispose?.();
    uniforms[textureUniform].value = texture;
  }
  if (!uniforms[flagUniform]) uniforms[flagUniform] = { value: 1 };
  else uniforms[flagUniform].value = 1;
}

export function attachGrassTexture(renderer, uniforms) {
  const loader = new THREE.TextureLoader();
  const basePath = `${import.meta.env.BASE_URL}textures/grass/`;

  loader.load(
    `${basePath}${GRASS_TEXTURES.base}`,
    texture => replaceUniformTexture(
      uniforms,
      'uGrassBase',
      'uHasGrassBase',
      configureTexture(texture, renderer, true),
    ),
    undefined,
    () => console.warn('[Oasis grass] Diffuse texture unavailable; keeping the grass colour fallback.'),
  );

  loader.load(
    `${basePath}${GRASS_TEXTURES.normal}`,
    texture => replaceUniformTexture(
      uniforms,
      'uGrassNormal',
      'uHasGrassNormal',
      configureTexture(texture, renderer),
    ),
    undefined,
    () => console.warn('[Oasis grass] Normal texture unavailable; keeping the terrain normal fallback.'),
  );

  loader.load(
    `${basePath}${GRASS_TEXTURES.roughness}`,
    texture => replaceUniformTexture(
      uniforms,
      'uGrassRoughness',
      'uHasGrassRoughness',
      configureTexture(texture, renderer),
    ),
    undefined,
    () => console.warn('[Oasis grass] Roughness texture unavailable; keeping the grass roughness fallback.'),
  );
}
