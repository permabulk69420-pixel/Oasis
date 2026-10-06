// The grip lab (dev server only): a hand on a handle, through the game's own code (src/hands.js, src/adaptive-grip.js, src/handle-hold.js), with
// the controller held as a player would. It checks the fit and draws it, so a new handle can be checked without a headset.
//
//   npm run dev, then http://localhost:4173/tools/grip-lab/index.html?model=kart&side=right&view=end
//   python3 tools/grip-lab/grip_shot.py outdir           (every model, side and view, plus the numbers)
//
// Query: model (kart | glider), side (right | left), view (end | outside | above | front | wide), off (cm: where the controller is from the grip marker,
// "x,y,z" in the handle's frame, default "2,-3,1.5"), roll (degrees the controller is turned about the handle, default 0).
// window.__grip (once ready): { ok, radius, axisGap, inside, minRadial, palmShift, contact } where axisGap is how far the hollow of the hand (the solved
// bar's axis) is from the handle's axis (metres, should be 0), inside the number of hand skin vertices inside the handle (should be 0) and minRadial the
// closest the skin comes to the handle's axis (should be about the radius).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createVRHands } from '../../src/hands.js';
import { createHandleHold, measureHandleRadius } from '../../src/handle-hold.js';

const params = new URLSearchParams(location.search);
const MODELS = {
  kart: { url: 'models/sand-kart/sand_sail_kart.glb', grips: { left: 'Grip_Left', right: 'Grip_Right' }, axis: [0, 0, 1], halfLength: 0.1,
    // the rider holds the grips from behind, the fist pointing forward along them (the kart's +Z)
    point: { left: [0, 0, 1], right: [0, 0, 1] } },
  glider: { url: 'models/glider/oasis_glider.glb', grips: { left: 'grip_left', right: 'grip_right' }, axis: [1, 0, 0], halfLength: 0.06,
    // overhead, each fist pointing in toward the other hand
    point: { left: [1, 0, 0], right: [-1, 0, 0] } },
};
const which = MODELS[params.get('model')] ? params.get('model') : 'kart';
const spec = MODELS[which];
const side = params.get('side') === 'left' ? 'left' : 'right';
const view = params.get('view') || 'end';
const off = (params.get('off') || '2,-3,1.5').split(',').map(Number).map(v => v / 100);
const roll = THREE.MathUtils.degToRad(Number(params.get('roll') || 0));
const out = document.getElementById('out');

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8a99a8);
scene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(1, 2, 1.5); scene.add(sun);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 50);
const rig = new THREE.Group(); rig.name = 'rig'; rig.add(camera); scene.add(rig);

// the game's hands, with stand-in XR nodes and a squeezing controller
const xrNodes = [new THREE.Group(), new THREE.Group()], xrGrips = [new THREE.Group(), new THREE.Group()];
const fakeRenderer = { xr: { getController: i => xrNodes[i], getControllerGrip: i => xrGrips[i], isPresenting: false }, toneMappingExposure: 1 };
const hands = createVRHands({ renderer: fakeRenderer, scene, parent: rig, camera, onError: m => console.warn(m) });
const buttons = [{ pressed: false, value: 0 }, { pressed: true, value: 1 }, { pressed: false, value: 0 }, { pressed: false, value: 0 }, { pressed: false, value: 0 }];
xrNodes[0].dispatchEvent({ type: 'connected', data: { handedness: side, gamepad: { buttons } } });
const state = hands.states[0];

const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}${spec.url}`);
const model = gltf.scene;
scene.add(model);
model.updateMatrixWorld(true);
const node = model.getObjectByName(spec.grips[side]);
const radius = measureHandleRadius(model, node, spec.axis, spec.halfLength);
const handle = { node, axis: spec.axis, halfLength: spec.halfLength, radius };
const hold = createHandleHold();

// the handle's frame in the world: its axis, and two directions square to it
const c = node.getWorldPosition(new THREE.Vector3());
const nq = node.getWorldQuaternion(new THREE.Quaternion());
const axis = new THREE.Vector3().fromArray(spec.axis).applyQuaternion(nq).normalize();
const pointDir = new THREE.Vector3().fromArray(spec.point[side]).applyQuaternion(model.quaternion).normalize();
const u = new THREE.Vector3(0, 1, 0).addScaledVector(axis, -axis.y).normalize();       // up, square to the handle
const w = new THREE.Vector3().crossVectors(axis, u).normalize();

// wait for the hand model, then hold the controller by the grip: its -Z (the length of a held controller's handle) along the fist's pointing, turned by
// `roll` about it, its centre `off` from the grip marker
await new Promise(resolve => { const t = setInterval(() => { if (state.handAnchor && state.gripSocket) { clearInterval(t); resolve(); } }, 50); });
const g = xrGrips[0];
const result = {};
// the hand's own grip socket in the controller's frame: where the bone sits and which way its bar axis (+Y, the fist's axis) runs
rig.updateMatrixWorld(true);
const fist = new THREE.Vector3(0, 1, 0).applyQuaternion(state.gripSocket.getWorldQuaternion(new THREE.Quaternion())).applyQuaternion(g.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
result.socketYInController = fist.toArray().map(n => +n.toFixed(3));
result.socketInController = g.worldToLocal(state.gripSocket.getWorldPosition(new THREE.Vector3())).toArray().map(n => +n.toFixed(3));
// hold the controller as a hand round the handle would: the fist's axis along the handle (pointing `point`), the controller's ring (-Z) as near upward
// as that allows, then turned by `roll` about the handle
function frame(a, b) { const x = a.clone().normalize(), y = b.clone().addScaledVector(x, -b.dot(x)).normalize(); return new THREE.Matrix4().makeBasis(x, y, new THREE.Vector3().crossVectors(x, y)); }
const inController = frame(fist, new THREE.Vector3(0, 0, -1)), inWorld = frame(pointDir, new THREE.Vector3(0, 1, 0));
g.quaternion.setFromRotationMatrix(inWorld.multiply(inController.transpose()));
g.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(pointDir, roll));
g.position.copy(c).addScaledVector(axis, off[0]).addScaledVector(u, off[1]).addScaledVector(w, off[2]);
rig.updateMatrixWorld(true);
// line the controller up so the hand's own grip socket (not the controller origin) is at that point, as a hand reaching for it would be
state.gripSocket.updateWorldMatrix(true, false);
const socketNow = state.gripSocket.getWorldPosition(new THREE.Vector3());
g.position.add(new THREE.Vector3().copy(g.position).sub(socketNow));
rig.updateMatrixWorld(true);
let frames = 0;
function measure() {
  const st = state.adaptiveGrip?.getState();
  const bar = state.objectGrip.children[0];
  const barPos = bar ? bar.getWorldPosition(new THREE.Vector3()) : null;
  const rel = barPos ? barPos.clone().sub(c) : null;
  result.ok = true;
  result.radius = +radius.toFixed(4);
  result.contact = Boolean(st?.contact);
  result.palmShift = bar ? +bar.position.length().toFixed(4) : null;
  result.axisGap = rel ? +rel.addScaledVector(axis, -rel.dot(axis)).length().toFixed(4) : null;
  let inside = 0, minRadial = Infinity;
  const v = new THREE.Vector3();
  state.handRoot.updateMatrixWorld(true);
  state.handRoot.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
      v.sub(c);
      const along = v.dot(axis);
      if (Math.abs(along) > spec.halfLength + 0.05) continue;
      const r = v.addScaledVector(axis, -along).length();
      minRadial = Math.min(minRadial, r);
      if (r < radius - 0.002) inside++;
    }
  });
  result.inside = inside;
  result.minRadial = +minRadial.toFixed(4);
  window.__grip = result;
  out.textContent = `${which} ${side} ${view}\n` + JSON.stringify(result, null, 1);
}

function placeCamera() {
  const d = view === 'wide' ? 1.1 : 0.32;
  const dirs = { end: axis.clone().multiplyScalar(-1).addScaledVector(u, 0.15), outside: w.clone().multiplyScalar(side === 'left' ? -1 : 1).addScaledVector(u, 0.2),
    above: u.clone().addScaledVector(w, 0.15), front: w.clone().multiplyScalar(side === 'left' ? 1 : -1).addScaledVector(u, 0.2), wide: u.clone().multiplyScalar(0.6).addScaledVector(w, -1).addScaledVector(axis, -0.4) };
  const dir = (dirs[view] || dirs.end).normalize();
  camera.position.copy(c).addScaledVector(dir, d);
  camera.up.copy(view === 'above' ? axis : u);
  camera.lookAt(c);
}

renderer.setAnimationLoop(() => {
  hands.update(1 / 60);
  if (hold.grab(state, handle)) hold.place(state);
  rig.updateMatrixWorld(true);
  placeCamera();
  frames++;
  if (frames > 30) measure();
  renderer.render(scene, camera);
});
