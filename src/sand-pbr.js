import * as THREE from 'three';

const ROOT = `${import.meta.env.BASE_URL}textures/sand/`;

function configure(texture, renderer, color = false) {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function load(loader, filename, onLoad) {
  loader.load(
    `${ROOT}${filename}`,
    onLoad,
    undefined,
    () => { /* Optional map: the material keeps its neutral fallback when absent. */ },
  );
}

/**
 * Loads the dune-sand material maps. Height is used only for a subtle near-field
 * parallax offset; the large dunes remain real terrain geometry.
 */
export function attachSandPBR(renderer, uniforms) {
  const textureLoader = new THREE.TextureLoader();

  load(textureLoader, 'sand-dunes1_albedo.png', (texture) => {
    uniforms.uPbrBase.value = configure(texture, renderer, true);
    uniforms.uHasPbrBase.value = 1;
  });

  load(textureLoader, 'sand-dunes1_normal-ogl.png', (texture) => {
    uniforms.uPbrNormal.value = configure(texture, renderer);
    uniforms.uHasPbrNormal.value = 1;
  });

  load(textureLoader, 'sand-dunes1_roughness.png', (texture) => {
    uniforms.uPbrRoughness.value = configure(texture, renderer);
    uniforms.uHasPbrRoughness.value = 1;
  });

  load(textureLoader, 'sand-dunes1_height.png', (texture) => {
    uniforms.uPbrHeight.value = configure(texture, renderer);
    uniforms.uHasPbrHeight.value = 1;
  });

  // AO and metallic remain intentionally unused. Sand is non-metallic, and the
  // normal/height pair already carries the small-scale relief we need here.
}
