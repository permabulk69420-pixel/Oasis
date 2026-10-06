import * as THREE from 'three';

// The grass ground: two real photo scans (CC0; ambientCG Grass004 and Poly Haven Leafy Grass, toned to the world's dark palette by
// tools/textures/make_ground.py; credits in public/textures/grass/CREDITS.md). The grass is laid everywhere grass grows, the litter in soft patches over it
// (src/materials.js). The vertical grass blades are separate geometry on top of this.
export const GRASS_TEXTURES = {
  base: 'ground-grass_albedo.jpg',
  normal: 'ground-grass_normal.jpg',
  roughness: 'ground-grass_roughness.jpg',
  litter: 'ground-litter_albedo.jpg',
  litterNormal: 'ground-litter_normal.jpg',
};
export const GRASS_TILE_METRES = 2.4;      // the grass scan's repeat (a second, wider, turned sample hides it)

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

  for (const [file, uniform, flag] of [[GRASS_TEXTURES.litter, 'uGrassLitter', 'uHasGrassLitter'], [GRASS_TEXTURES.litterNormal, 'uGrassLitterNormal', 'uHasGrassLitterNormal']]) {
    loader.load(
      `${basePath}${file}`,
      texture => replaceUniformTexture(uniforms, uniform, flag, configureTexture(texture, renderer, file === GRASS_TEXTURES.litter)),
      undefined,
      () => console.warn(`[Oasis grass] ${file} unavailable; the ground goes without leaf litter.`),
    );
  }
}
