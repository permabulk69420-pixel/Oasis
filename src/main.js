import * as THREE from 'three';
import './style.css';
import { createHeightField, clamp, stickAxis, stickVector, pivotRig, SPAWN, WATER } from './world.js';
import { createTerrain } from './terrain.js';
import { createMaterials, createWater } from './materials.js';
import { createVRHands } from './hands.js';

const canvas = document.querySelector('#world');
const welcome = document.querySelector('#welcome');
const status = document.querySelector('#status');
const explore = document.querySelector('#explore');
const enterVR = document.querySelector('#enter-vr');
const menu = document.querySelector('#menu');
const touchControls = document.querySelector('#touch-controls');
const movePad = document.querySelector('#move-pad');
const touchDevice = matchMedia('(pointer: coarse)').matches;
if (touchDevice) document.querySelector('#controls').textContent = 'Left pad to move · Drag the right side to look';
explore.disabled = true;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
} catch (error) {
  status.textContent = 'WebGL could not start. Try opening this page in Meta Quest Browser or a current desktop browser.';
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFramebufferScaleFactor(1.0);
renderer.xr.setFoveation(0.65);
renderer.setClearColor(0xacc5cc);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.07, 6500);
const rig = new THREE.Group();
rig.add(camera); scene.add(rig);
const hands = createVRHands({
  renderer,
  scene,
  onError: (message) => console.warn('[Oasis hands]', message)
});
camera.position.set(0, 1.68, 0);
camera.rotation.order = 'YXZ';
camera.rotation.x = -0.045;
rig.rotation.y = -Math.atan2(WATER.x, -WATER.z);

// Yield a frame so the loading status is painted before constructing the terrain.
await new Promise(requestAnimationFrame);
const field = createHeightField();
const materials = createMaterials(renderer, field);
const terrain = createTerrain(field, materials.sand);
scene.add(terrain.group);
scene.add(createWater(field, materials.water));
const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), materials.sky);
sky.frustumCulled = false; sky.renderOrder = -10; sky.name = 'Sky'; scene.add(sky);
rig.position.set(SPAWN.x, field.sample(SPAWN.x, SPAWN.z), SPAWN.z);

// Development-only camera fixtures for repeatable visual inspection. No travel shortcuts ship.
if (import.meta.env.DEV) {
  const view = new URLSearchParams(location.search).get('view');
  if (view === 'shore') {
    rig.position.set(WATER.x - 29, field.sample(WATER.x - 29, WATER.z + 19), WATER.z + 19);
    rig.rotation.y = -Math.atan2(29, 19); camera.rotation.x = -0.13;
  }
  if (view === 'wide') {
    rig.position.set(-90, field.sample(-90, 30) + 8, 30);
    rig.rotation.y = -0.7; camera.rotation.x = -0.2;
  }
}

let playing = false, xrAlign = false, xrHeadingReady = false, xrAnchor = new THREE.Vector3();
let lastTime = 0, lodTime = -1, telemetryTime = -1;
let mouseDragging = false, touchLookId = null, touchMoveId = null;
let previousPointer = { x: 0, y: 0 };
let touchMove = { x: 0, z: 0 };
const keys = new Set();
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3(0, 0, -1), movementForward = new THREE.Vector3(), right = new THREE.Vector3(), head = new THREE.Vector3();
const target = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
const lastDirection = new THREE.Vector3(0, 0, -1);
const WALK_SPEED = 2.6, FAST_SPEED = 5.2, TURN_SPEED = 1.4;

function clearInput() {
  keys.clear(); touchMove = { x: 0, z: 0 }; touchMoveId = null; touchLookId = null; mouseDragging = false;
  velocity.set(0, 0, 0); movePad.firstElementChild.style.transform = '';
}
function setPlaying(value) {
  playing = value; welcome.hidden = value; menu.hidden = !value;
  touchControls.hidden = !value || !touchDevice || renderer.xr.isPresenting;
  if (!value) clearInput();
}
function look(dx, dy) {
  if (!playing || renderer.xr.isPresenting) return;
  rig.rotation.y -= dx * 0.0024;
  camera.rotation.x = clamp(camera.rotation.x - dy * 0.0024, -1.40, 1.40);
}
explore.addEventListener('click', async () => {
  setPlaying(true);
  if (!touchDevice) {
    try { await canvas.requestPointerLock(); }
    catch { /* Drag-to-look and keyboard turning remain available. */ }
  }
});
menu.addEventListener('click', () => { document.exitPointerLock?.(); setPlaying(false); });
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && !touchDevice && !renderer.xr.isPresenting) setPlaying(false);
});
window.addEventListener('keydown', e => {
  if (e.code === 'Escape' && !renderer.xr.isPresenting) setPlaying(false);
  if (!playing || renderer.xr.isPresenting) return;
  if (['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight'].includes(e.code)) {
    e.preventDefault(); keys.add(e.code);
  }
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement === canvas) look(e.movementX, e.movementY);
});
canvas.addEventListener('pointerdown', e => {
  if (!playing || renderer.xr.isPresenting) return;
  if (e.pointerType === 'touch') {
    if (e.clientX < innerWidth * 0.40 || touchLookId !== null) return;
    touchLookId = e.pointerId;
  } else mouseDragging = true;
  previousPointer = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (document.pointerLockElement === canvas) return;
  if ((e.pointerType === 'touch' && e.pointerId !== touchLookId) || (e.pointerType !== 'touch' && !mouseDragging)) return;
  look(e.clientX - previousPointer.x, e.clientY - previousPointer.y);
  previousPointer = { x: e.clientX, y: e.clientY };
});
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(event, e => {
  if (touchLookId === e.pointerId) touchLookId = null;
  mouseDragging = false;
});
function updatePad(e) {
  const rect = movePad.getBoundingClientRect();
  touchMove = stickVector((e.clientX - rect.left - rect.width / 2) / 44, (e.clientY - rect.top - rect.height / 2) / 44, 0.08);
  movePad.firstElementChild.style.transform = `translate(${touchMove.x * 34}px,${touchMove.z * 34}px)`;
}
movePad.addEventListener('pointerdown', e => {
  if (touchMoveId !== null) return;
  touchMoveId = e.pointerId; movePad.setPointerCapture(e.pointerId); updatePad(e);
});
movePad.addEventListener('pointermove', e => { if (e.pointerId === touchMoveId) updatePad(e); });
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) movePad.addEventListener(event, e => {
  if (e.pointerId !== touchMoveId) return;
  touchMoveId = null; touchMove = { x: 0, z: 0 }; movePad.firstElementChild.style.transform = '';
});

enterVR.addEventListener('click', async () => {
  if (renderer.xr.isPresenting) return;
  enterVR.disabled = true; status.textContent = '';
  let session;
  try {
    session = await navigator.xr.requestSession('immersive-vr', {
      requiredFeatures: ['local-floor'], optionalFeatures: ['bounded-floor'],
    });
    await renderer.xr.setSession(session);
    renderer.xr.setFoveation(0.65);
    if (session.supportedFrameRates && session.updateTargetFrameRate) {
      const rates = Array.from(session.supportedFrameRates);
      const preferred = rates.includes(72) ? 72 : rates.find(rate => rate >= 72);
      if (preferred) await session.updateTargetFrameRate(preferred).catch(() => {});
    }
  } catch (error) {
    if (session) await session.end().catch(() => {});
    setPlaying(false);
    status.textContent = error.name === 'NotAllowedError' ? 'VR access was declined. Use Enter VR to try again.' : 'Could not enter VR. Open this page directly in Meta Quest Browser and try again.';
  } finally { enterVR.disabled = false; }
});
renderer.xr.addEventListener('sessionstart', () => {
  document.exitPointerLock?.(); clearInput();
  camera.getWorldPosition(xrAnchor); xrAlign = true; xrHeadingReady = false;
  setPlaying(true); menu.hidden = true; touchControls.hidden = true;
  const session = renderer.xr.getSession();
  session.addEventListener('visibilitychange', clearInput);
});
renderer.xr.addEventListener('sessionend', () => {
  rig.position.set(head.x, field.sample(head.x, head.z), head.z);
  rig.rotation.y = -Math.atan2(lastDirection.x, -lastDirection.z);
  camera.position.set(0, 1.68, 0); camera.rotation.set(-0.045, 0, 0);
  camera.scale.set(1, 1, 1);
  camera.fov = 72; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  xrHeadingReady = false;
  clearInput(); setPlaying(false); lastTime = 0;
});

function readInput() {
  if (renderer.xr.isPresenting) {
    const session = renderer.xr.getSession();
    if (session.visibilityState !== 'visible') return { x: 0, z: 0, turn: 0, fast: false };
    let x = 0, z = 0, turn = 0, fast = false;
    for (const source of session.inputSources) {
      const pad = source.gamepad;
      if (!pad) continue;
      // xr-standard reserves axes 0/1 for the touchpad; Quest sticks are 2/3.
      const axis = pad.axes.length >= 4 ? 2 : 0;
      if (source.handedness === 'left') {
        const move = stickVector(pad.axes[axis] || 0, pad.axes[axis + 1] || 0);
        x = move.x; z = move.z; fast = !!pad.buttons[3]?.pressed;
      }
      if (source.handedness === 'right') turn = stickAxis(pad.axes[axis] || 0);
    }
    return { x, z, turn, fast };
  }
  const x = Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + touchMove.x;
  const z = Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp')) + touchMove.z;
  const length = Math.max(1, Math.hypot(x, z));
  return { x: x / length, z: z / length,
    turn: Number(keys.has('ArrowRight') || keys.has('KeyE')) - Number(keys.has('ArrowLeft') || keys.has('KeyQ')),
    fast: keys.has('ShiftLeft') || keys.has('ShiftRight') };
}

function frame(time) {
  const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
  lastTime = time;
  hands.update(dt);
  rig.updateMatrixWorld(true);
  if (renderer.xr.isPresenting) renderer.xr.updateCamera(camera);
  const activeCamera = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  activeCamera.getWorldPosition(head);
  if (xrAlign) {
    rig.position.x += xrAnchor.x - head.x; rig.position.z += xrAnchor.z - head.z;
    head.x = xrAnchor.x; head.z = xrAnchor.z; xrAlign = false;
  }
  if (renderer.xr.isPresenting && !xrHeadingReady) {
    activeCamera.getWorldDirection(lastDirection);
    lastDirection.y = 0;
    if (lastDirection.lengthSq() < 0.001) lastDirection.set(0, 0, -1);
    lastDirection.normalize();
    xrHeadingReady = true;
  }
  if (playing) {
    const input = readInput();
    const turn = -input.turn * TURN_SPEED * dt;
    if (turn) {
      // Turn around the headset, preserving room-scale offsets instead of orbiting the rig origin.
      const rotated = pivotRig(rig.position.x, rig.position.z, head.x, head.z, turn);
      rig.position.x = rotated.x; rig.position.z = rotated.z; rig.rotation.y += turn;
    }

    if (renderer.xr.isPresenting) {
      // Capture forward once on VR entry; only smooth turning changes locomotion heading after that.
      if (turn) lastDirection.applyAxisAngle(up, turn).normalize();
      movementForward.copy(lastDirection);
    } else {
      activeCamera.getWorldDirection(direction);
      direction.y = 0;
      if (direction.lengthSq() < 0.001) direction.copy(lastDirection);
      direction.normalize();
      movementForward.copy(direction);
      lastDirection.copy(direction);
    }

    right.crossVectors(movementForward, up);
    target.copy(right).multiplyScalar(input.x).addScaledVector(movementForward, -input.z);
    target.multiplyScalar(input.fast ? FAST_SPEED : WALK_SPEED);
    velocity.lerp(target, 1 - Math.exp(-dt * (target.lengthSq() ? 18 : 28)));
    const dx = velocity.x * dt, dz = velocity.z * dt;
    const nextX = clamp(head.x + dx, -498, 498), nextZ = clamp(head.z + dz, -498, 498);
    rig.position.x += nextX - head.x; rig.position.z += nextZ - head.z;
    head.x = nextX; head.z = nextZ;
    // Only the floor height changes. The camera never banks, bobs, or pitches with a dune.
    const ground = field.sample(head.x, head.z);
    rig.position.y += (ground - rig.position.y) * (1 - Math.exp(-dt * 24));
  }
  if (time - lodTime > 350) { terrain.update(head.x, head.z); lodTime = time; }
  materials.water.uniforms.uTime.value = time * 0.001;
  renderer.render(scene, camera);
  if (import.meta.env.DEV && time - telemetryTime > 1000) {
    canvas.dataset.position = JSON.stringify({ x: +head.x.toFixed(2), z: +head.z.toFixed(2), ground: +field.sample(head.x, head.z).toFixed(2), yaw: +rig.rotation.y.toFixed(3) });
    canvas.dataset.render = JSON.stringify({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures });
    telemetryTime = time;
  }
}
window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});
canvas.addEventListener('webglcontextlost', e => {
  e.preventDefault(); renderer.setAnimationLoop(null); setPlaying(false);
  status.textContent = 'The graphics session was interrupted. Reload the page to return to the desert.';
});
canvas.addEventListener('webglcontextrestored', () => location.reload());
renderer.setAnimationLoop(frame);
explore.disabled = false; status.textContent = '';
try {
  const supported = !!navigator.xr && await navigator.xr.isSessionSupported('immersive-vr');
  enterVR.disabled = !supported; enterVR.textContent = supported ? 'Enter VR' : 'VR unavailable';
} catch { enterVR.textContent = 'VR unavailable'; }
