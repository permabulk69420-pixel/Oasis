// The watch lab (dev server only): the survival watch on the game's left hand, through the game's own code (src/hands.js, src/watch.js), seen as you
// would glance at it. http://localhost:4173/tools/watch/index.html?view=glance&hour=14&food=40&water=15&stamina=80&health=100
// view: glance (the wrist turned toward your eyes, lit), away (the wrist turned away, dim), tap (the right index finger on it), close.
import * as THREE from 'three';
import { createVRHands } from '../../src/hands.js';
import { createWatch } from '../../src/watch.js';
import { importSurvival } from '../../src/survival.js';

const params = new URLSearchParams(location.search);
const view = params.get('view') || 'glance';
const hour = Number(params.get('hour') ?? 14);
importSurvival(Object.fromEntries(['health', 'food', 'water', 'stamina'].map(k => [k, Number(params.get(k) ?? 100)])));

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const night = hour < 6 || hour > 19;
renderer.toneMappingExposure = night ? 0.12 : 0.8;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(night ? 0x05080c : 0x7d8f9e);
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x6a5040, night ? 0.6 : 1.4));
const sun = new THREE.DirectionalLight(0xffe6c8, night ? 0.3 : 2.4); sun.position.set(2, 3, 1); scene.add(sun);
const camera = new THREE.PerspectiveCamera(view === 'close' ? 30 : 70, innerWidth / innerHeight, 0.01, 50);
const rig = new THREE.Group(); scene.add(rig); rig.add(camera);
camera.position.set(0, 1.6, 0);

const xrNodes = [new THREE.Group(), new THREE.Group()], xrGrips = [new THREE.Group(), new THREE.Group()];
const fake = { xr: { getController: i => xrNodes[i], getControllerGrip: i => xrGrips[i], isPresenting: true, getCamera: () => camera }, toneMappingExposure: 1 };
const hands = createVRHands({ renderer: fake, scene, parent: rig, camera, onError: m => console.warn(m) });
const pad = pressed => ({ buttons: [0, 1, 2, 3, 4, 5].map(i => ({ pressed: false, value: 0 })) });
xrNodes[0].dispatchEvent({ type: 'connected', data: { handedness: 'left', gamepad: pad() } });
xrNodes[1].dispatchEvent({ type: 'connected', data: { handedness: 'right', gamepad: pad() } });
const head = new THREE.Vector3();
let taps = 0;
const watch = createWatch({ states: hands.states, getDay: () => ({ hours: hour, isDay: !night, daylight: night ? 0 : 1 }), getExposure: () => renderer.toneMappingExposure,
  getHead: () => head, onTap: () => { taps++; } });

// the left controller held up in front of the chest, the back of the wrist turned toward the eyes (or away)
const L = xrGrips[0], R = xrGrips[1];
L.position.set(-0.05, 1.32, -0.34);
// controller frame: -Z forward along the fist; the watch face is on the back of the hand (+X for the left grip, roughly)
L.rotation.set(0.0, 0.0, 0.0);
const want = new THREE.Vector3();
await new Promise(resolve => { const t = setInterval(() => { if (watch.root) { clearInterval(t); resolve(); } watch.update(0.016); }, 50); });
// hold the left wrist up as you would to read a watch: the forearm across the chest, the fingers pointing right, the back of the wrist turned to the eyes
// (view=away: the palm turned up instead). The hand model's own axes (glTF): fingers -Z, back of the hand +Y.
camera.getWorldPosition(head);
rig.updateMatrixWorld(true);
const left = hands.states.find(s => s.handedness === 'left');
const face0 = watch.facePosition(new THREE.Vector3());
const toEye = head.clone().sub(face0).normalize();
const fingers = new THREE.Vector3(1, 0, 0).addScaledVector(toEye, -toEye.x).normalize();
const back = view === 'away' ? toEye.clone().negate() : toEye.clone();
const wantBasis = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(back, fingers.clone().negate()), back, fingers.clone().negate());   // x = y cross z
const wantRoot = new THREE.Quaternion().setFromRotationMatrix(wantBasis);
const rootInGrip = left.handRoot.getWorldQuaternion(new THREE.Quaternion()).premultiply(L.getWorldQuaternion(new THREE.Quaternion()).invert());
L.quaternion.copy(wantRoot.multiply(rootInGrip.invert()));
rig.updateMatrixWorld(true);
// keep the display where it was (move the controller so the face comes back to the same spot)
L.position.add(face0.clone().sub(watch.facePosition(new THREE.Vector3())));
rig.updateMatrixWorld(true);
// the right hand off to the side, or its index finger on the display for a tap
R.position.set(0.25, 1.15, -0.3);
for (let i = 0; i < 60; i++) { hands.update(1 / 60); watch.update(1 / 60); }
if (view === 'tap') {
  const tip = new THREE.Vector3();
  const right = hands.states.find(s => s.handedness === 'right');
  right.pointing = true;
  for (let i = 0; i < 30; i++) hands.update(1 / 60);
  const face = watch.facePosition(new THREE.Vector3());
  for (let k = 0; k < 6; k++) {
    rig.updateMatrixWorld(true);
    right.indexTip.updateWorldMatrix(true, false);
    right.indexTip.getWorldPosition(tip);
    R.position.add(face.clone().sub(tip).multiplyScalar(0.9));
    rig.updateMatrixWorld(true);
  }
}
const target = watch.facePosition(new THREE.Vector3());
if (view === 'close') { camera.position.copy(head).lerp(target, 0.55); }
camera.up.set(0, 1, 0); camera.lookAt(target);
camera.getWorldPosition(head);
let frames = 0;
renderer.setAnimationLoop(() => {
  hands.update(1 / 60);
  const r = watch.update(1 / 60, { presenting: true });
  renderer.render(scene, camera);
  if (++frames > 40) window.__watchLab = { ...r, taps };
});
