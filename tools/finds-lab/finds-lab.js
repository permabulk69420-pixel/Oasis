// A scratch page that lays out every variant of one kind of find, one row per level of detail, lit like the game, so the shapes and
// the materials can be judged without walking out to them.
//
//   what    rock | crystal | spire | held (the shard and the fibre you pick up)
//   night   1 for the night light (the crystals' glow, tone-mapped as in the game)
//   cam     close | wide (default wide)
//   lod     only draw this level (0, 1 or 2)
import * as THREE from 'three';
import { installNightFill, nightFill } from '../../src/night-fill.js';
import { createFindMaterials } from '../../src/find-materials.js';
import {
  FIND_SHAPES, ROCK_VARIANTS, CRYSTAL_VARIANTS, SPIRE_VARIANTS, buildLooseCrystal, buildFibreBundle,
} from '../../src/find-shapes.js';

installNightFill();
const params = new URLSearchParams(location.search);
const what = params.get('what') || 'rock';
const night = params.get('night') === '1';
const onlyLod = params.has('lod') ? Number(params.get('lod')) : null;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(Number(params.get('w') ?? 1500), Number(params.get('h') ?? 800));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = night ? 0.035 : 0.82;
document.body.appendChild(renderer.domElement);
nightFill.value = night ? 1 : 0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(night ? 0x02040a : 0xa9c4cc);
const sun = new THREE.DirectionalLight(0xfff2dc, night ? 0.0 : 3.1);
sun.position.set(-7, 6, -5);
scene.add(sun, new THREE.HemisphereLight(0xcfe2ee, 0x9a7a55, night ? 0.0 : 1.2));
if (night) scene.add(new THREE.DirectionalLight(0x6f8cff, 8), new THREE.HemisphereLight(0x4a68c8, 0x101820, 4));

const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: night ? 0x201810 : 0xc79a62, roughness: 1 }));
ground.position.y = -0.0;
scene.add(ground);

const materials = createFindMaterials({ renderer, getExposure: () => renderer.toneMappingExposure });
const kinds = { rock: [FIND_SHAPES.rock, materials.rock, ROCK_VARIANTS], crystal: [FIND_SHAPES.crystal, materials.crystal, CRYSTAL_VARIANTS], spire: [FIND_SHAPES.spire, materials.spire, SPIRE_VARIANTS] };

let spacing = 5;
const target = new THREE.Vector3();
const camera = new THREE.PerspectiveCamera(40, renderer.domElement.width / renderer.domElement.height, 0.05, 400);
if (what === 'held') {
  const shard = new THREE.Mesh(buildLooseCrystal(), materials.crystal);
  shard.position.set(-0.12, 0.09, 0);
  const fibre = new THREE.Mesh(buildFibreBundle(), materials.fibre);
  fibre.position.set(0.15, 0.04, 0);
  scene.add(shard, fibre);
  camera.position.set(0.0, 0.35, 0.8);
  target.set(0, 0.1, 0);
} else {
  const [shape, material, variants] = kinds[what];
  const names = Object.keys(variants);
  const lods = onlyLod === null ? [0, 1, 2] : [onlyLod];
  lods.forEach((lod, row) => {
    names.forEach((name, column) => {
      const mesh = new THREE.Mesh(shape.build(variants[name], lod), material);
      mesh.position.set((column - (names.length - 1) / 2) * (what === 'rock' ? 5.2 : what === 'spire' ? 3.2 : 2.2), 0, -row * (what === 'rock' ? 6 : 3.6));
      scene.add(mesh);
    });
  });
  spacing = what === 'rock' ? 6 : 3.6;
  const depth = (lods.length - 1) * spacing;
  const heightScale = what === 'rock' ? 2.5 : what === 'spire' ? 1.1 : 0.7;
  if (params.get('cam') === 'close') {
    camera.position.set(0, heightScale * 0.9, 4.2 * (what === 'rock' ? 1.6 : 1));
    target.set(0, heightScale * 0.55, 0);
  } else {
    camera.position.set(0, heightScale * 2.2, (what === 'rock' ? 14 : what === 'spire' ? 8 : 6) + 0.2 * depth);
    target.set(0, heightScale * 0.55, -depth * 0.5);
  }
}
camera.lookAt(target);

let tick = 0;
function frame() {
  materials.update();
  renderer.render(scene, camera);
  if (++tick === 12) window.__ready = true;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
