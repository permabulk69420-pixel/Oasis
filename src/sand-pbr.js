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
    () => { /* Optional PBR map: procedural sand remains active when absent. */ },
  );
}

/**
 * Hot-swaps the optional dune-sand PBR set into the existing Quest-friendly sand shader.
 * The material is fully usable before/without these files, so the repo can be deployed
 * while the texture folder is still empty.
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

  // AO, metallic and height maps are intentionally unused for this terrain test.
}
