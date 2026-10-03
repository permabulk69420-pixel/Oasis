import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { POSE_REST, JOINTS, createBirdPoser } from '../../src/bird-pose.js';

// Development scratch page: a row of the bird in different poses, for judging the model and the pose numbers.
//   /tools/bird/lab.html?poses=rest,drink,glide,flapUp&lod=0&yaw=135&time=1&zoom=1
// yaw is in degrees (0 faces the camera's back, 180 faces the camera); time pins the streamers' flutter.
// Nothing here ships: it is not referenced by index.html.

const FEET_BELOW = 0.337;
const params = new URLSearchParams(location.search);
const lod = Number(params.get('lod') ?? 0);
const yaw = (Number(params.get('yaw') ?? 135)) * Math.PI / 180;
const time = Number(params.get('time') ?? 1);
const zoom = Number(params.get('zoom') ?? 1);
// joint overrides for tuning: ?j=foldShoulder.sweep:1.4,foldHand.bend:-0.5
const joints = JSON.parse(JSON.stringify(JOINTS));
for (const item of (params.get('j') ?? '').split(',').filter(Boolean)) {
  const [path, value] = item.split(':');
  const [group, key] = path.split('.');
  joints[group][key] = Number(value);
}
const wanted = (params.get('poses') ?? 'rest,drink,glide,flapUp,flapDown,land').split(',');

const flight = { fold: 0, legs: 1, stretch: 1, crest: -1, streamers: 0.8, tail: -0.1, sweep: 0.15 };
const SCENES = {
  rest: { pose: {} },
  look: { pose: { headYaw: 0.9, crest: 0.4 } },
  drink: { pose: { dip: 1, bodyPitch: 0.35, crest: 0.2 } },
  alert: { pose: { crest: 1, stretch: 0.15 } },
  crouch: { pose: { crouch: 1, fold: 0.6, bodyPitch: 0.25, stretch: 0.3 }, drop: 0.07 },
  glide: { pose: { ...flight, flap: 0.12, flex: -0.05 }, air: true },
  flapUp: { pose: { ...flight, flap: 0.8, flex: 0.45 }, air: true },
  flapDown: { pose: { ...flight, flap: -0.6, flex: -0.55 }, air: true },
  bank: { pose: { ...flight, flap: 0.12, flex: -0.05 }, air: true, roll: 0.5 },
  land: { pose: { ...flight, fold: 0, legs: 0.05, stretch: 0.45, crest: 0.6, tail: 0.5, bodyPitch: -0.7, flap: 0.7, flex: 0.3, sweep: 0.0 }, air: true },
};

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb2d9);
scene.add(new THREE.HemisphereLight(0xbcd4f2, 0xb98a5a, 1.3));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.8);
sun.position.set(-3, 5, 4);
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0xb98a5a, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const spacing = 2.0;
const names = wanted.filter(name => SCENES[name]);
const gltf = await new GLTFLoader().loadAsync(`/models/creatures/alien_bird_lod${lod}.glb`);
names.forEach((name, i) => {
  const spec = SCENES[name];
  const root = clone(gltf.scene);
  root.traverse(object => { if (object.isMesh) object.frustumCulled = false; });
  const poser = createBirdPoser(root);
  poser.apply({ ...POSE_REST, ...spec.pose }, time, spec.drop ?? 0, joints);
  const holder = new THREE.Group();
  holder.add(root);
  holder.rotation.order = 'YXZ';
  holder.rotation.set(0, yaw, spec.roll ?? 0);
  holder.position.set((i - (names.length - 1) / 2) * spacing, (spec.air ? 1.4 : 0) + FEET_BELOW, 0);
  scene.add(holder);
});

const camera = new THREE.PerspectiveCamera(24, window.innerWidth / window.innerHeight, 0.1, 100);
const view = params.get('view') ?? 'front';
const hasAir = names.some(name => SCENES[name].air);
const halfWidth = (names.length * spacing) / 2;
const halfHeight = hasAir ? 1.2 : 0.65;
const lookY = hasAir ? 1.45 : 0.6;
const tanHalf = Math.tan(camera.fov * Math.PI / 360);
const distance = Math.max(halfWidth / (tanHalf * camera.aspect), halfHeight / tanHalf) / zoom;
if (view === 'under') { camera.position.set(0, 0.05, distance * 0.55); camera.lookAt(0, lookY + 0.2, 0); }
else if (view === 'top') { camera.position.set(0, distance, 0.01); camera.lookAt(0, lookY, 0); }
else { camera.position.set(0, lookY + distance * 0.10, distance); camera.lookAt(0, lookY, 0); }
renderer.render(scene, camera);
window.__ready = true;
