import * as THREE from 'three';

// Three materials in six 2K files. Albedo RGB uses sRGB and alpha is linear AO.
// Surface RG is the OpenGL normal's XY, B is roughness, A is height. Normal Z
// is reconstructed in the shader. See CREDITS.md for the original sources.
export const GRASS_TEXTURES = {
  base: 'grass-short_albedo.webp',
  normal: 'grass-short_surface.webp',
  patch: 'grass-loose_albedo.webp',
  patchNormal: 'grass-loose_surface.webp',
  litter: 'ground-litter_albedo.webp',
  litterNormal: 'ground-litter_surface.webp',
};
export const GRASS_TILE_METRES = 2.4;

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
  const layers = [
    [['base', 'Base', true], ['normal', 'Normal']],
    [['patch', 'Patch', true], ['patchNormal', 'PatchNormal']],
    [['litter', 'Litter', true], ['litterNormal', 'LitterNormal']],
  ];
  // Install each layer together so its colour never appears with another layer's
  // normal or roughness while downloads are still arriving.
  for (const layer of layers) {
    Promise.allSettled(layer.map(([file]) => loader.loadAsync(`${basePath}${GRASS_TEXTURES[file]}`))).then(results => {
      if (results.some(result => result.status === 'rejected')) {
        for (const result of results) if (result.status === 'fulfilled') result.value.dispose();
        console.warn(`[Oasis grass] ${GRASS_TEXTURES[layer[0][0]]} layer unavailable; keeping its fallback.`);
        return;
      }
      layer.forEach(([, name, color], index) => replaceUniformTexture(
        uniforms, `uGrass${name}`, `uHasGrass${name}`,
        configureTexture(results[index].value, renderer, color),
      ));
      if (layer[0][0] === 'base') {
        uniforms.uHasGrassRoughness.value = 1;
        uniforms.uHasGrassHeight.value = 1;
      }
    });
  }
}
