import * as THREE from 'three';
import { installNightFill, nightFill } from '../../src/night-fill.js';
import { createIslandFlora, levelsFor, loadIslandModels } from '../../src/island-flora.js';
import { windTime } from '../../src/wind.js';

// Stands island models in a row, lit like the game (the real night fill, ACES tone mapping at the game's exposures).
//   models   comma-separated island model names (FLORA_RENDER in src/island-flora.js; the files in public/models/island/; default fern)
//   lod      0 | 1 | 2 | all (every level of each model, one row each; default 0)
//   night    1 for the night light (exposure 0.035, moonlit, glow) else a dusky day
//   cam      tq (default) | front | side | top | close | wide | up     d: camera distance, ty: target height, tx: target x
//   n        copies of each model in a row (default 1), gap: metres between models (default 3), s: scale
//   y        lift in metres (default: a model that hangs below its origin, like the vines, is lifted so it just clears the ground)
//   wind     the wind clock in seconds (default 0, still)
//   bg       the background colour as hex without the # (default: a night black or a dusky day blue-grey)
//   w, h     the picture size (default 1500 x 800)
const params = new URLSearchParams(location.search);
const night = params.get('night') === '1';
const names = (params.get('models') || 'fern').split(',');
const lodParam = params.get('lod') ?? '0';
const lods = lodParam === 'all' ? [0, 1, 2] : [Number(lodParam)];
const gap = Number(params.get('gap') ?? 3);
const copies = Number(params.get('n') ?? 1);
const scale = Number(params.get('s') ?? 1);
const camMode = params.get('cam') || 'tq';
windTime.value = Number(params.get('wind') ?? 0);

installNightFill();
nightFill.value = night ? 1 : 0;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(Number(params.get('w') ?? 1500), Number(params.get('h') ?? 800));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = night ? 0.035 : 0.62;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(params.has('bg') ? parseInt(params.get('bg'), 16) : night ? 0x02040a : 0x6f7d96);
if (night) {
  scene.add(new THREE.DirectionalLight(0x6f8cff, 8), new THREE.HemisphereLight(0x4a68c8, 0x101820, 4));
} else {
  const sun = new THREE.DirectionalLight(0xffd9b0, 3.0);
  sun.position.set(-6, 5, 4);
  scene.add(sun, new THREE.HemisphereLight(0x9fb2d8, 0x2d3a2c, 1.3));
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: night ? 0x0c1410 : 0x1c2a1c, roughness: 1 }));
scene.add(ground);

await loadIslandModels(names);
const rowCount = names.length * copies;
const items = [];
const floras = [];
let widest = 0;
lods.forEach((lod, row) => {
  const rowItems = [];
  names.forEach((name, i) => {
    const levels = levelsFor(name);
    const b = levels[0].bounds;
    widest = Math.max(widest, (b.max[0] - b.min[0]) * scale, (b.max[2] - b.min[2]) * scale);
    for (let c = 0; c < copies; c++) {
      const index = i * copies + c;
      rowItems.push({ type: name, x: (index - (rowCount - 1) / 2) * gap, y: params.has('y') ? Number(params.get('y')) : (b.min[1] < -1 ? -b.min[1] * scale + 0.05 : 0), z: (lods.length - 1 - row) * gap * 1.4, yaw: Number(params.get('yaw') ?? 0) + c * 0.9, scale });
    }
  });
  const flora = createIslandFlora({ items: rowItems, forceLod: lod, getExposure: () => renderer.toneMappingExposure, sunDirection: { y: night ? -1 : 0.6 } });
  flora.buildAll();
  scene.add(flora.group);
  floras.push(flora);
  items.push(...rowItems);
});
window.__flora = floras;

const width = (rowCount - 1) * gap + widest;
const depth = (lods.length - 1) * gap * 1.4;
const camera = new THREE.PerspectiveCamera(32, renderer.domElement.width / renderer.domElement.height, 0.02, 400);
const d = params.has('d') ? Number(params.get('d')) : Math.max(4, width * 0.95 + 2.5 + depth * 0.6);
const target = new THREE.Vector3(Number(params.get('tx') ?? 0), Number(params.get('ty') ?? 0.7), depth / 2);
const views = {
  tq: [d * 0.55, d * 0.35 + 0.8, d * 0.8 + depth / 2],
  front: [0.01, 1.1, d + depth / 2],
  side: [d, 1.1, depth / 2],
  top: [0.01, d, depth / 2 + 0.2],
  close: [d * 0.4, 0.9, d * 0.5 + depth / 2],
  wide: [d * 0.9, d * 0.5, d * 1.2 + depth / 2],
  up: [d * 0.3, 1.7, d * 0.35 + depth / 2],       // standing on the ground close by, looking up (set ty high)
};
camera.position.set(...(views[camMode] ?? views.tq));
camera.lookAt(target);

let tick = 0;
function frame() {
  for (const flora of floras) flora.update({ x: 0, z: 0 }, 0.6);
  renderer.render(scene, camera);
  if (++tick === 8) window.__ready = true;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
