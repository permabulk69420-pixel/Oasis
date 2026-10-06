// The vulture lab (dev server only): the alien vulture's three levels side by side (or one level in three poses with ?poses=1), posed by the
// game's own poser (src/vulture-pose.js), or one pose alone with ?pose=0..3 (standing, gliding, wings up, wings down).
// http://localhost:4173/tools/vulture/lab.html[?poses=1|pose=N][&view=side|top|front]
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { ALIEN_VULTURE } from '../../src/alien-vulture.js';
import { createVulturePoser, VULTURE_POSE } from '../../src/vulture-pose.js';

const params = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight); renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x7d8f9e);
scene.add(new THREE.HemisphereLight(0xffffff, 0x665544, 2.2));
const sun = new THREE.DirectionalLight(0xffeedd, 2.5); sun.position.set(20, 40, 30); scene.add(sun);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 200);
const view = params.get('view') || 'front';
camera.position.set(...{ front: [0, 3, 16], side: [16, 3, 0], top: [0, 16, 0.01] }[view]); camera.lookAt(0, 1.3, 0);

const gltfs = await Promise.all(ALIEN_VULTURE.files.map(url => new GLTFLoader().loadAsync(url)));
const poses = [{ ...VULTURE_POSE, stretch: 0, legs: 0 }, { ...VULTURE_POSE }, { ...VULTURE_POSE, flap: 0.6, flex: -0.3, rear: 0.35 }, { ...VULTURE_POSE, flap: -0.6, flex: 0.3, rear: -0.35 }];
const items = params.has('pose') ? [{ gltf: gltfs[0], pose: poses[Number(params.get('pose'))] }] : params.has('poses') ? poses.map(pose => ({ gltf: gltfs[0], pose })) : gltfs.map(gltf => ({ gltf, pose: VULTURE_POSE }));
items.forEach(({ gltf, pose }, i) => {
  const root = clone(gltf.scene);
  if (view === 'side') root.position.z = (i - (items.length - 1) / 2) * 5.5;
  else root.position.x = (i - (items.length - 1) / 2) * 5.5;
  scene.add(root);
  const poser = createVulturePoser(root);
  if (!poser) throw new Error('missing bone');
  poser.apply(pose);
});
renderer.render(scene, camera);
window.__vultureLab = { done: true };
