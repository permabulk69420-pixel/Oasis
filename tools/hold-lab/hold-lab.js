// A scratch page for judging how a hand holds something: it builds the hand exactly as the game does (grip space, hand
// offset, socket, adaptive finger grip) and attaches the item with the same call the game uses.
//
//   npm run dev, then open /tools/hold-lab/hold-lab.html?item=spear&side=right&pitch=-90
//
//   item    pack (the default, held by its carry handle) | spear | torch | axe | fruit: the game's own definitions, from
//           src/backpack.js, src/spear.js, src/torch.js, src/axe.js and src/glow-fruit.js
//   side    right | left
//   map     pack only: where the pack's X and Y axes point in the hand's grip-socket frame, e.g. "%2By,%2Bz" (a + must be
//           written %2B in a URL). The default is the game's own pose. The pack's Z follows from the other two.
//   tilt    degrees to turn the item about the hand socket's X axis (the palm normal) on top of the game's pose, to try an
//           angled grip; twist is degrees about the item's own long axis (Y)
//   pitch   degrees the hand is tipped about the world X axis: 0 is the controller pointing forward, -90 an arm hanging
//   roll    degrees about the forearm after that (positive turns the palm outward), default 0
//   point   grip point as "x,y,z" in the item's space, halfLength= for the length the fingers close on
//   debug   1 draws the contact outline the fingers close against
//   axes    1 draws the hand socket's axes (X red, Y green, Z blue) and the item's own
//   close   1 for three close-ups of the hand instead of the whole item
//   player  1 for what the player sees: three views from the eyes of someone holding it in the right hand (left for side=left)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { createAdaptiveGrip } from '../../src/adaptive-grip.js';
import { attachHeldObject, setGripSurface } from '../../src/grip-contact.js';
import { PACK_GRIP, PACK_HELD_ROTATION } from '../../src/backpack.js';
import { createSpearKind } from '../../src/spear.js';
import { createTorchKind } from '../../src/torch.js';
import { createAxeKind } from '../../src/axe.js';
import { createGroundFruit, fruitGripSurface } from '../../src/glow-fruit.js';

const params = new URLSearchParams(location.search);
const side = params.get('side') === 'left' ? 'left' : 'right';
const pitch = THREE.MathUtils.degToRad(Number(params.get('pitch') ?? -90));
const roll = THREE.MathUtils.degToRad(Number(params.get('roll') ?? 0));
const debug = params.get('debug') === '1';
const base = '../../public/models/';
const item = params.get('item') || 'pack';
const tilt = THREE.MathUtils.degToRad(Number(params.get('tilt') ?? 0));
const twist = THREE.MathUtils.degToRad(Number(params.get('twist') ?? 0));

function axisVector(token) {
  const sign = token.startsWith('-') ? -1 : 1;
  const axis = token.replace(/^[+-]/, '');
  return new THREE.Vector3(axis === 'x' ? sign : 0, axis === 'y' ? sign : 0, axis === 'z' ? sign : 0);
}

// What is held: its model, how the game sets it up, and the rotation the game holds it with.
const kinds = { spear: createSpearKind, torch: createTorchKind, axe: createAxeKind };
const kind = kinds[item]?.({ scene: new THREE.Scene(), onError: console.warn }) ?? null;
// The glow fruit has no model file: it is built in code, so take one of the game's own loose fruit.
const fruitMesh = item === 'fruit' ? createGroundFruit({ field: { sample: () => 0 } }).slots[0].fruit : null;
let itemUrl = `${base}backpack/backpack.glb`;
let rotation = PACK_HELD_ROTATION[side].clone();
let surface = { ...PACK_GRIP };
if (fruitMesh) {
  rotation = new THREE.Quaternion(); // the game attaches a fruit with no rotation
  surface = { ...fruitGripSurface(side) }; // the game picks this when a hand grabs a fruit
} else if (kind) {
  itemUrl = kind.url.replace(/^.*?models\//, base);
  rotation = kind.heldRotation.clone();
} else if (params.get('map')) {
  const [mx, my] = params.get('map').split(',');
  const x = axisVector(mx);
  const y = axisVector(my);
  const z = new THREE.Vector3().crossVectors(x, y);
  rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
// Angled-grip experiments: turn about the socket's X on the outside, about the item's own long axis on the inside.
rotation.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt));
rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), twist));

const loader = new GLTFLoader();
const [handGltf, packGltf] = await Promise.all([
  loader.loadAsync(`${base}hands/${side === 'left' ? 'Left' : 'Right'}Hand.glb`),
  fruitMesh ? { scene: fruitMesh } : loader.loadAsync(itemUrl),
]);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb4c7);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a68, 1.7));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(2, 4, 3);
scene.add(sun);
const floor = new THREE.GridHelper(4, 40, 0x6b7c8a, 0x80909c);
scene.add(floor);

// The controller (grip space) up in the air where a hand would be, with the same hierarchy hands.js builds.
const grip = new THREE.Group();
grip.position.set(0, 0.95, 0);
grip.quaternion.setFromEuler(new THREE.Euler(pitch, 0, 0)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
scene.add(grip);
const handRoot = clone(handGltf.scene);
const anchor = new THREE.Group();
anchor.rotation.z = side === 'left' ? Math.PI / 2 : -Math.PI / 2;
anchor.add(handRoot);
grip.add(anchor);
const objectGrip = new THREE.Group();
grip.add(objectGrip);
const socket = handRoot.getObjectByName(`b_${side === 'left' ? 'l' : 'r'}_grip`);
scene.updateMatrixWorld(true);
new THREE.Matrix4().copy(grip.matrixWorld).invert().multiply(socket.matrixWorld)
  .decompose(objectGrip.position, objectGrip.quaternion, objectGrip.scale);

const pack = packGltf.scene;
if (kind) {
  kind.prepareTemplate?.(pack);
  kind.prepare?.({ root: pack, state: kind.createState?.() ?? {} });
  surface = pack.userData.gripSurface ? { ...pack.userData.gripSurface } : surface;
}
if (params.get('point')) surface.point = params.get('point').split(',').map(Number);
if (params.get('halfLength')) surface.halfLength = Number(params.get('halfLength'));
setGripSurface(pack, surface);
const state = { objectGrip };
const attached = attachHeldObject(state, pack, rotation);

const solver = createAdaptiveGrip({ root: handRoot, clips: handGltf.animations, objectGrip, handedness: side, debug });
const mixer = new THREE.AnimationMixer(handRoot);
const action = mixer.clipAction(handGltf.animations.find(clip => clip.name === 'Grip'));
action.play();
action.paused = true;
action.time = 0.72;
mixer.update(0);
let solved = false;
for (let i = 0; i < 4; i++) solved = solver.update(pack, 0.1);
scene.updateMatrixWorld(true);

if (params.get('axes') === '1') {
  const socketAxes = new THREE.AxesHelper(0.18);   // the hand's grip socket: X red, Y green (the bar axis), Z blue
  objectGrip.add(socketAxes);
  const packAxes = new THREE.AxesHelper(0.30);     // the pack's own axes
  pack.add(packAxes);
}
const worldUp = new THREE.Vector3(0, 1, 0).transformDirection(pack.matrixWorld);
const worldFront = new THREE.Vector3(0, 0, 1).transformDirection(pack.matrixWorld);
const worldBar = new THREE.Vector3(1, 0, 0).transformDirection(pack.matrixWorld);
const fmt = v => v.toArray().map(n => n.toFixed(2)).join(',');
console.log(item, 'axis Y in the world', fmt(worldUp), '| Z', fmt(worldFront), '| X', fmt(worldBar));
// Where the pack ended up, in the world, so the heights and the swing of it can be read off.
const bounds = new THREE.Box3().setFromObject(pack);
console.log('attached', attached, 'solved', solved, item, 'bounds', bounds.min.toArray().map(v => v.toFixed(3)).join(','), bounds.max.toArray().map(v => v.toFixed(3)).join(','));

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
const width = Number(params.get('w') ?? 1500);
const height = Number(params.get('h') ?? 520);
renderer.setSize(width, height);
document.body.style.margin = '0';
document.body.appendChild(renderer.domElement);
const close = params.get('close') === '1';
const player = params.get('player') === '1';
// The eyes of the person holding it: the hand is at the origin, 0.65 m below and a little to the side and ahead of the eyes.
const mirror = side === 'left' ? -1 : 1;
const views = player ? [
  { pos: [-0.22 * mirror, 1.62, 0.30], look: [0.0, 1.05, -0.9], fov: 75 },    // looking straight ahead
  { pos: [-0.22 * mirror, 1.62, 0.30], look: [0.05 * mirror, 0.95, -0.35], fov: 75 }, // looking down at the hand
  { pos: [-0.22 * mirror, 1.62, 0.30], look: [0.3 * mirror, 1.3, -0.9], fov: 100 },  // wide, with the hand low in the view
] : close ? [
  { pos: [0, 1.0, -0.75], look: [0, 0.9, 0], fov: 30 },   // the hand from the front
  { pos: [0.75, 1.0, 0], look: [0, 0.9, 0], fov: 30 },    // from the right
  { pos: [0.1, 1.65, -0.35], look: [0, 0.9, 0], fov: 30 }, // from above
] : [
  { pos: [0, 0.8, -2.2], look: [0, 0.65, 0] },   // from the front (the person faces -Z, so this is what they would see ahead)
  { pos: [2.2, 0.8, 0], look: [0, 0.65, 0] },    // from the right
  { pos: [-0.6, 2.4, -1.2], look: [0, 0.7, 0] }, // from above, in front
];
renderer.setScissorTest(true);
const cell = Math.floor(width / views.length);
views.forEach((view, i) => {
  const camera = new THREE.PerspectiveCamera(view.fov ?? 30, cell / height, 0.05, 30);
  camera.position.set(...view.pos);
  camera.lookAt(...view.look);
  renderer.setViewport(i * cell, 0, cell, height);
  renderer.setScissor(i * cell, 0, cell, height);
  renderer.render(scene, camera);
});
window.__ready = true;
document.title = 'ready';
