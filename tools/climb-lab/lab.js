// The climb lab (dev server only): the Colossus (lod0, at rest) with its climbing holds marked, and the game's right hand clamped on a crystal by the
// game's own climbing code (src/colossus-climb.js). http://localhost:4173/tools/climb-lab/index.html?view=foot|flank|hand|hands
//   foot, flank: the model with a red dot on every hold (they should sit in the crystals); hand: a hand on a foot crystal, close up; hands: both,
//   one pulled down (window.__climbLab reports how far the rig rose).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createVRHands } from '../../src/hands.js';
import { createColossusClimb } from '../../src/colossus-climb.js';

const params = new URLSearchParams(location.search);
const view = params.get('view') || 'foot';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x7d8f9e);
scene.add(new THREE.HemisphereLight(0xffffff, 0x665544, 2.2));
const sun = new THREE.DirectionalLight(0xffeedd, 2.5); sun.position.set(30, 60, 40); scene.add(sun);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.02, 600);
const rig = new THREE.Group(); scene.add(rig); rig.add(camera);

const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/colossus/colossus_01_lod0.glb`);
const model = gltf.scene; scene.add(model); model.updateMatrixWorld(true);
const xrNodes = [new THREE.Group(), new THREE.Group()], xrGrips = [new THREE.Group(), new THREE.Group()];
const fake = { xr: { getController: i => xrNodes[i], getControllerGrip: i => xrGrips[i], isPresenting: true, getCamera: () => camera }, toneMappingExposure: 1 };
const hands = createVRHands({ renderer: fake, scene, parent: rig, camera, onError: m => console.warn(m) });
const pads = [0, 1].map(() => ({ buttons: [0, 1, 2, 3, 4, 5].map(() => ({ pressed: false, value: 0 })), hapticActuators: [] }));
xrNodes[0].dispatchEvent({ type: 'connected', data: { handedness: 'left', gamepad: pads[0] } });
xrNodes[1].dispatchEvent({ type: 'connected', data: { handedness: 'right', gamepad: pads[1] } });
const climb = createColossusClimb({ states: hands.states, getRoot: () => model, getDistance: () => 10 });
await climb.ready;
await new Promise(r => { const t = setInterval(() => { if (hands.states.every(s => s.handAnchor)) { clearInterval(t); r(); } }, 50); });
climb.update(0, { rig, head: new THREE.Vector3(), presenting: true });     // places the holds
const holds = climb.holds.filter(h => h.centre.x === h.centre.x);
const result = { holds: holds.length };

// the foot holds: the lowest ones on the front left foot
const footHolds = holds.filter(h => climb.holds && h.centre.y < 3).sort((a, b) => a.centre.y - b.centre.y);
result.lowest = footHolds.slice(0, 3).map(h => h.centre.toArray().map(v => +v.toFixed(2)));

if (view === 'foot' || view === 'flank') {
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(view === 'foot' ? 0.05 : 0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2222, depthTest: false }), holds.length);
  dots.renderOrder = 10;
  holds.forEach((h, i) => dots.setMatrixAt(i, new THREE.Matrix4().makeTranslation(h.centre.x, h.centre.y, h.centre.z)));
  scene.add(dots);
  const box = new THREE.Box3().setFromObject(model);
  result.box = [box.min.toArray(), box.max.toArray()].map(a => a.map(v => +v.toFixed(1)));
  const target = view === 'foot' ? footHolds[0].centre.clone() : box.getCenter(new THREE.Vector3());
  const dir = new THREE.Vector3(1, 0.35, 0.6).normalize();
  camera.position.copy(target).addScaledVector(dir, view === 'foot' ? 4.5 : 150);
  camera.lookAt(target);
} else {
  // a hand reaching for a foot crystal from the side, a little below it; squeeze
  const h = footHolds[Math.min(4, footHolds.length - 1)];
  const out = new THREE.Vector3().crossVectors(h.axis, new THREE.Vector3(0, 1, 0)); if (out.lengthSq() < 1e-4) out.set(1, 0, 0); out.normalize();
  // which side faces away from the body: away from the model's centre line (x = 0)
  if (out.x * h.centre.x < 0) out.negate();
  const reachPoint = h.centre.clone().addScaledVector(out, h.radius + 0.06);
  const right = hands.states.find(s => s.handedness === 'right'), left = hands.states.find(s => s.handedness === 'left');
  const placeHand = (s, grip, at, facing) => {
    grip.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), facing, new THREE.Vector3(0, 1, 0)));
    grip.position.copy(at); rig.updateMatrixWorld(true);
    s.gripSocket.updateWorldMatrix(true, false);
    grip.position.add(at.clone().sub(s.gripSocket.getWorldPosition(new THREE.Vector3()))); rig.updateMatrixWorld(true);
  };
  const facing = out.clone().negate();            // the fist points into the crystal
  placeHand(right, xrGrips[1], reachPoint, facing);
  const head = reachPoint.clone().addScaledVector(out, 0.5).add(new THREE.Vector3(0, 0.4, 0));
  for (let i = 0; i < 20; i++) hands.update(1 / 60);
  pads[1].buttons[1].pressed = true; pads[1].buttons[1].value = 1;
  hands.update(1 / 60);
  result.grabbed = climb.update(1 / 60, { rig, head, presenting: true }).climbing;
  if (view === 'hands') {
    const h2 = holds.filter(o => o !== h && o.centre.y > h.centre.y + 0.4 && o.centre.distanceTo(h.centre) < 1.2)[0];
    if (h2) {
      const o2 = out.clone(); const p2 = h2.centre.clone().addScaledVector(o2, h2.radius + 0.06);
      placeHand(left, xrGrips[0], p2, facing);
      pads[0].buttons[1].pressed = true; pads[0].buttons[1].value = 1;
      hands.update(1 / 60);
      climb.update(1 / 60, { rig, head, presenting: true });
      const y0 = rig.position.y;
      xrGrips[1].position.y -= 0.25; xrGrips[0].position.y -= 0.25;    // pull both down
      climb.update(1 / 60, { rig, head, presenting: true });
      result.rose = +(rig.position.y - y0).toFixed(3);
    }
  }
  for (let i = 0; i < 20; i++) { hands.update(1 / 60); climb.update(1 / 60, { rig, head, presenting: true }); }
  const palm = right.gripSocket.getWorldPosition(new THREE.Vector3());
  const side = h.axis.clone().cross(out).normalize();
  const cam = params.get('cam') || 'side';
  const eye = cam === 'eye' ? head.clone() : cam === 'out' ? palm.clone().addScaledVector(out, 0.8).addScaledVector(h.axis, 0.1) : palm.clone().addScaledVector(side, 0.9).addScaledVector(out, 0.25);
  rig.updateMatrixWorld(true);
  camera.position.copy(rig.worldToLocal(eye.clone()));
  camera.updateMatrixWorld(true);
  camera.lookAt(palm);
  result.palmFromAxis = +(() => { const d = palm.clone().sub(h.centre); return d.addScaledVector(h.axis, -d.dot(h.axis)).length(); })().toFixed(3);
  result.palmAlong = +palm.clone().sub(h.centre).dot(h.axis).toFixed(3);
  result.radiusHere = +(h.radius * (1 - 0.65 * 0.45)).toFixed(3);
}
renderer.setAnimationLoop(() => { renderer.render(scene, camera); });
setTimeout(() => { window.__climbLab = result; }, 500);
