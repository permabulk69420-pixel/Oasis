import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { installNightFill, nightFill } from '../../src/night-fill.js';
import { exposureGlow } from '../../src/glow.js';
import { createStingerPoser, POSE_REST, JOINTS } from '../../src/stinger-pose.js';

// A scratch page that stands the dune stinger up in each of its poses, lit like the game, so the model and the poses can be judged
// without walking out to it. npm run dev, then open /tools/stinger-lab/stinger-lab.html?poses=rest,alert,windup,strike (see lab_shot.py).
//
//   poses   comma-separated: rest | walk | alert | windup | strike | hurt | dead | a name followed by key=value pairs after ":" is not supported;
//           use p.<key>=<number> for any pose number applied to every figure (p.gait=1&p.phase=2)
//   lod     0 | 1 | 2 (default 0)
//   cam     tq (three-quarter, default) | side | front | top | back | close
//   night   1 for the night light and glow
//   phase   radians along the walking cycle (default 0)
//   time    seconds for the idle motion (default 1.3)
//   joints  JSON of JOINTS overrides, e.g. {"stride":0.4}
//   gc      r,g,b: replaces the glow colour (to try a deeper cyan); gb  day,night: the displayed glow brightness (default 0.9,1.1)

const params = new URLSearchParams(location.search);
const night = params.get('night') === '1';
const lod = Number(params.get('lod') ?? 0);
const camMode = params.get('cam') || 'tq';
const names = (params.get('poses') || 'rest').split(',');
const time = Number(params.get('time') ?? 1.3);
const BASE = import.meta.env?.BASE_URL ?? '/';

installNightFill();
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
sun.position.set(-7, 6, 5);
scene.add(sun, new THREE.HemisphereLight(0xcfe2ee, 0x9a7a55, night ? 0.0 : 1.2));
if (night) scene.add(new THREE.DirectionalLight(0x6f8cff, 8), new THREE.HemisphereLight(0x4a68c8, 0x101820, 4));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: night ? 0x201810 : 0xc79a62, roughness: 1 }));
scene.add(ground);

const PRESETS = {
  rest: {},
  walk: { gait: 1, phase: 1.0 },
  walk2: { gait: 1, phase: 3.2 },
  walk3: { gait: 1, phase: 5.0 },
  alert: { alert: 1 },
  windup: { windup: 1, alert: 1 },
  strike: { windup: 1, strike: 1, alert: 1 },
  mid: { windup: 1, strike: 0.5, alert: 1 },
  hurt: { hurt: 1, alert: 1 },
  dead: { dead: 1 },
};
const overrides = {};
for (const [key, value] of params) if (key.startsWith('p.')) overrides[key.slice(2)] = Number(value);
if (params.has('phase')) overrides.phase = Number(params.get('phase'));
const joints = params.has('joints') ? { ...JOINTS, ...JSON.parse(params.get('joints')) } : JOINTS;

const spacing = Number(params.get('gap') ?? 2.4);
const glowMaterials = [];
new GLTFLoader().loadAsync(`${BASE}models/creatures/dune_stinger_lod${lod}.glb`).then(gltf => {
  names.forEach((name, index) => {
    const root = clone(gltf.scene);
    root.traverse(object => {
      if (!object.isMesh) return;
      object.frustumCulled = false;
      if (object.material?.name === 'Glow') {
        object.material = object.material.clone();
        if (params.has('gc')) object.material.emissive.setRGB(...params.get('gc').split(',').map(Number));
        glowMaterials.push({ material: object.material, flare: 0 });
      }
    });
    const poser = createStingerPoser(root);
    if (!poser) throw new Error('missing bone');
    const pose = { ...POSE_REST, ...(PRESETS[name] ?? {}), ...overrides };
    poser.apply(pose, time, joints);
    const flare = Math.max(pose.windup, pose.strike) * 0.9;
    for (const entry of glowMaterials.slice(-8)) entry.flare = flare;
    root.position.x = (index - (names.length - 1) / 2) * spacing;
    if (camMode === 'side') root.rotation.y = Math.PI / 2;
    scene.add(root);
    root.userData.poser = poser;
    window.__figures = (window.__figures ?? []).concat(root);
  });
  const width = (names.length - 1) * spacing;
  const camera = new THREE.PerspectiveCamera(32, renderer.domElement.width / renderer.domElement.height, 0.05, 100);
  const target = new THREE.Vector3(0, 0.55, 0);
  const d = params.has('d') ? Number(params.get('d')) : Math.max(3.4, width * 0.62 + 2.8);
  const views = {
    tq: [d * 0.62, 1.7 + width * 0.12, d * 0.8],
    side: [0.01, 0.8, d],
    front: [0.01, 0.9, d],
    back: [0.01, 1.0, -d],
    top: [0.01, d * 1.05, 0.2],
    close: [1.5, 1.0, 2.1],
  };
  camera.position.set(...(views[camMode] ?? views.tq));
  if (camMode === 'close') target.set(0, 0.32, 0.4);
  if (params.has('tx')) target.set(Number(params.get('tx')), Number(params.get('ty')), Number(params.get('tz')));
  camera.lookAt(target);
  const exposure = renderer.toneMappingExposure;
  const [glowDay, glowNight] = params.has('gb') ? params.get('gb').split(',').map(Number) : [0.5, 0.4];
  let tick = 0;
  function frame() {
    for (const entry of glowMaterials) entry.material.emissiveIntensity = exposureGlow(exposure, { day: glowDay, night: glowNight }) * (1 + entry.flare * 1.8);
    renderer.render(scene, camera);
    if (++tick === 6) window.__ready = true;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}).catch(error => { document.title = 'ERROR ' + error.message; console.error(error); window.__ready = true; });
