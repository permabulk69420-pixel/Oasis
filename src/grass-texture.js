import * as THREE from 'three';

// Two coordinated 2K grass materials from Game Piggs, with a 2K leaf-litter layer
// from Poly Haven. All layers have matched colour, normal and AO/roughness maps;
// the two grass layers also provide height for terrain blending. See CREDITS.md.
export const GRASS_TEXTURES = {
  base: 'grass-short_albedo.jpg',
  normal: 'grass-short_normal.jpg',
  roughness: 'grass-short_arm.jpg',
  height: 'grass-short_height.png',
  patch: 'grass-loose_albedo.jpg',
  patchNormal: 'grass-loose_normal.jpg',
  patchRoughness: 'grass-loose_arm.jpg',
  patchHeight: 'grass-loose_height.png',
  litter: 'ground-litter_albedo.jpg',
  litterNormal: 'ground-litter_normal.jpg',
  litterRoughness: 'ground-litter_arm.jpg',
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
    [['base', 'Base', true], ['normal', 'Normal'], ['roughness', 'Roughness'], ['height', 'Height']],
    [['patch', 'Patch', true], ['patchNormal', 'PatchNormal'], ['patchRoughness', 'PatchRoughness'], ['patchHeight', 'PatchHeight']],
    [['litter', 'Litter', true], ['litterNormal', 'LitterNormal'], ['litterRoughness', 'LitterRoughness']],
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
    });
  }
}
