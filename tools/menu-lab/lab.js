// The menu lab (dev server only): the watch menu (src/survivor-menu.js) on its own, as the desktop overlay, with a pack of things in it.
// http://localhost:4173/tools/menu-lab/index.html?tab=pack&pick=item:axe   (tab: pack | craft; pick: item:<type> | recipe:<id> | slot:left | back | none;
// hover: a control id to draw hovered; empty=1 for an empty pack)
import * as THREE from 'three';
import { createSurvivorMenu } from '../../src/survivor-menu.js';
import { addInventoryItem } from '../../src/inventory.js';

const params = new URLSearchParams(location.search);
if (!params.get('empty')) for (const [type, n] of Object.entries({ stick: 9, stone: 6, wood: 4, fibre: 3, crystal: 2, axe: 1, torch: 1, campfire: 1, glider: 1 })) addInventoryItem(type, n);
const listeners = {};
const renderer = { xr: { isPresenting: false, getSession: () => null, addEventListener: (k, f) => { listeners[k] = f; } } };
const scene = new THREE.Scene();
const hips = { left: 'spear', right: null };
const tools = { getHipSlots: () => hips, equip: () => true, unequip: () => true };
const backpack = { isWorn: () => true, takeOff: () => ({ ok: true, message: 'Taken off.' }) };
const menu = createSurvivorMenu({ scene, renderer, states: [], tools, backpack, onPlace: () => ({ ok: true }) });
menu.setOpen(true);
menu.debug.tab(params.get('tab') || 'pack');
const pick = params.get('pick');
if (pick) {
  const [kind, id] = pick.split(':');
  menu.debug.select(kind === 'back' ? { kind: 'back' } : kind === 'slot' ? { kind: 'slot', id } : kind === 'none' ? { kind: 'none' } : { kind, id });
}
menu.update();
if (params.get('hover')) document.querySelector(`[data-action="${params.get('hover')}"]`)?.dispatchEvent(new Event('pointerenter'));
menu.update();
if (!params.get('vr')) window.__menuLab = true;

// ?vr=1: the VR panel in 3D, opened from a stand-in watch, and a right index finger poking the Craft tab (window.__menuLab becomes the result)
if (params.get('vr')) {
  const { createVRHands } = await import('../../src/hands.js');
  menu.setOpen(false);
  const r3 = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r3.setSize(innerWidth, innerHeight); r3.setPixelRatio(1); r3.outputColorSpace = THREE.SRGBColorSpace;
  document.body.innerHTML = ''; document.body.appendChild(r3.domElement);
  const s3 = new THREE.Scene(); s3.background = new THREE.Color(0x24323a);
  s3.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
  const camera = new THREE.PerspectiveCamera(90, innerWidth / innerHeight, 0.01, 50);
  const rig = new THREE.Group(); s3.add(rig); rig.add(camera); camera.position.set(0, 1.6, 0);
  const xrNodes = [new THREE.Group(), new THREE.Group()], xrGrips = [new THREE.Group(), new THREE.Group()];
  const pad = () => ({ buttons: [0, 1, 2, 3, 4, 5].map(() => ({ pressed: false, value: 0 })) });
  const sources = [{ handedness: 'left', gamepad: pad(), targetRayMode: 'tracked-pointer' }, { handedness: 'right', gamepad: pad(), targetRayMode: 'tracked-pointer' }];
  const xr = { isPresenting: true, getCamera: () => camera, getSession: () => ({ visibilityState: 'visible', inputSources: sources }), addEventListener: () => {}, getController: i => xrNodes[i], getControllerGrip: i => xrGrips[i] };
  const fake3 = { xr, toneMappingExposure: 1 };
  const hands = createVRHands({ renderer: fake3, scene: s3, parent: rig, camera, onError: m => console.warn(m) });
  sources.forEach((data, i) => xrNodes[i].dispatchEvent({ type: 'connected', data }));

  const vrMenu = createSurvivorMenu({ scene: s3, renderer: Object.assign(r3, { xr: Object.assign(r3.xr, xr) }), states: hands.states, tools, backpack, onPlace: () => ({ ok: true }), popOrigin: t => t.set(-0.12, 1.25, -0.32) });
  const right = hands.states.find(s => s.handedness === 'right');
  right.pointing = true;
  xrGrips[0].position.set(-0.2, 1.1, -0.3); xrGrips[1].position.set(0.2, 1.1, -0.25);
  for (let i = 0; i < 30; i++) { hands.update(1 / 60); }
  rig.updateMatrixWorld(true);
  vrMenu.setOpen(true);
  await new Promise(r => setTimeout(r, 400));
  vrMenu.update();
  const panel = s3.getObjectByName('Watch menu');
  // the Craft tab's centre on the canvas -> panel-local metres
  const W = 1280, H = 800, PW = 0.64, PH = PW * H / W;
  const at = (cx, cy, depth) => panel.localToWorld(new THREE.Vector3((cx / W - 0.5) * PW, (0.5 - cy / H) * PH, depth));
  const target = { x: 44 + 4 + 200 + 96, y: 68 };
  const tipW = new THREE.Vector3();
  const moveTipTo = world => { for (let k = 0; k < 8; k++) { rig.updateMatrixWorld(true); right.indexTip.updateWorldMatrix(true, false); right.indexTip.getWorldPosition(tipW); xrGrips[1].position.add(world.clone().sub(tipW)); } rig.updateMatrixWorld(true); };
  const frames = (n) => { for (let i = 0; i < n; i++) { hands.update(1 / 60); vrMenu.update(); } };
  moveTipTo(at(target.x, target.y, 0.04)); frames(5);
  moveTipTo(at(target.x, target.y, 0.003)); frames(5);
  const afterTab = vrMenu.debug.state ? vrMenu.debug.state() : null;
  moveTipTo(at(target.x, target.y, 0.03)); frames(3);
  // and leave the finger hovering over the first recipe for the picture
  moveTipTo(at(44 + 70, 128 + 70, 0.02)); frames(3);
  r3.render(s3, camera);
  if (params.get('angle')) camera.position.set(0.32, 1.42, -0.12);
  camera.lookAt(panel.position);
  r3.setAnimationLoop(() => { hands.update(1 / 60); vrMenu.update(); r3.render(s3, camera); });
  window.__menuLab = { state: afterTab };
}
