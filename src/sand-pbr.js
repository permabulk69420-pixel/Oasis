import * as THREE from 'three';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';

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
 * Hot-swaps the optional 2K sand PBR set into the existing Quest-friendly sand shader.
 * The material is fully usable before/without these files, so the repo can be deployed
 * while the texture folder is still empty.
 */
export function attachSandPBR(renderer, uniforms) {
  const textureLoader = new THREE.TextureLoader();
  const exrLoader = new EXRLoader();

  load(textureLoader, 'coast_sand_02_diff_2k.jpg', (texture) => {
    uniforms.uPbrBase.value = configure(texture, renderer, true);
    uniforms.uHasPbrBase.value = 1;
  });

  load(exrLoader, 'coast_sand_02_nor_gl_2k.exr', (texture) => {
    uniforms.uPbrNormal.value = configure(texture, renderer);
    uniforms.uHasPbrNormal.value = 1;
  });

  load(exrLoader, 'coast_sand_02_rough_2k.exr', (texture) => {
    uniforms.uPbrRoughness.value = configure(texture, renderer);
    uniforms.uHasPbrRoughness.value = 1;
  });

  // coast_sand_02_disp_2k.png intentionally is not loaded. Oasis already has true dune
  // geometry; vertex displacement here would require much denser terrain meshes and is
  // a poor trade on standalone Quest. The file can live beside the other maps for later.
}
