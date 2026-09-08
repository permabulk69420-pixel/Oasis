import * as THREE from 'three';
import './style.css';
import { createHeightField, clamp, stickAxis, stickVector, pivotRig, SPAWN, WATER } from './world.js';
import { createTerrain } from './terrain.js';
import { createMaterials, createWater } from './materials.js';
import { createVRHands } from './hands.js';
import { createDayNightCycle } from './day-night.js';
import { createSandFootsteps } from './footsteps.js';
import { createGroundSticks } from './sticks.js';

const canvas = document.querySelector('#world');
const welcome = document.querySelector('#welcome');
const status = document.querySelector('#status');
const explore = document.querySelector('#explore');
const enterVR = document.querySelector('#enter-vr');
const seatedMode = document.querySelector('#seated-mode');
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
const footsteps = createSandFootsteps({
  onError: (message) => console.warn(message)
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
scene.add(createGroundSticks({
  field,
  onError: (message) => console.warn(message)
}));
const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), materials.sky);
sky.frustumCulled = false; sky.renderOrder = -10; sky.name = 'Sky'; scene.add(sky);
const dayNight = createDayNightCycle({ scene, renderer, materials });
rig.position.set(SPAWN.x, field.sample(SPAWN.x, SPAWN.z), SPAWN.z);

// Development-only camera fixtures for repeatable visual inspection. No travel shortcuts ship.
if (import.meta.env.DEV) {
  const view = new URLSearchParams(location.search).get('view');
  if (view === 'shore') {
    const dx = WATER.radiusX * 1.05, dz = WATER.radiusZ * 0.80;
    rig.position.set(WATER.x - dx, field.sample(WATER.x - dx, WATER.z + dz), WATER.z + dz);
    rig.rotation.y = -Math.atan2(dx, dz); camera.rotation.x = -0.13;
  }
  if (view === 'oasis') {
    rig.position.set(WATER.x - 88, WATER.y + 76, WATER.z + 86);
    rig.rotation.y = -Math.atan2(88, 86); camera.rotation.x = -0.58;
  }
  if (view === 'wide') {
    rig.position.set(-90, field.sample(-90, 30) + 8, 30);
    rig.rotation.y = -0.7; camera.rotation.x = -0.2;
  }
}

let playing = false;
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
const STANDING_EYE_HEIGHT = 1.68, JUMP_SPEED = 4.4, GRAVITY = 12.0;
const CROUCH_DEPTH = 0.58, CROUCH_RESPONSE = 12.0, RIGHT_STICK_BUTTON = 3;
let groundY = rig.position.y;
let seatedOffset = 0, seatedCalibrationPending = false;
let jumpHeight = 0, jumpVelocity = 0, jumpHeld = false;
let crouchOffset = 0, crouchActive = false, crouchButtonDown = false;

function clearInput() {
  keys.clear(); touchMove = { x: 0, z: 0 }; touchMoveId = null; touchLookId = null; mouseDragging = false;
  velocity.set(0, 0, 0); jumpHeld = false;
  crouchOffset = 0; crouchActive = false; crouchButtonDown = false;
  footsteps.reset(); movePad.firstElementChild.style.transform = '';
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
  if (['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight','Space'].includes(e.code)) {
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

  // Match dumbgame's XR start state: no hidden world yaw or desktop camera transform.
  groundY = field.sample(SPAWN.x, SPAWN.z);
  rig.position.set(SPAWN.x, groundY, SPAWN.z);
  rig.rotation.set(0, 0, 0);
  rig.scale.set(1, 1, 1);
  camera.position.set(0, 0, 0);
  camera.quaternion.identity();

  jumpHeight = 0; jumpVelocity = 0; jumpHeld = false;
  crouchOffset = 0; crouchActive = false; crouchButtonDown = false;
  seatedOffset = 0;
  seatedCalibrationPending = Boolean(seatedMode.checked);

  setPlaying(true); menu.hidden = true; touchControls.hidden = true;
  const session = renderer.xr.getSession();
  session.addEventListener('visibilitychange', clearInput);
});
renderer.xr.addEventListener('sessionend', () => {
  groundY = field.sample(head.x, head.z);
  rig.position.set(head.x, groundY, head.z);
  rig.rotation.y = -Math.atan2(WATER.x, -WATER.z);
  camera.position.set(0, 1.68, 0); camera.rotation.set(-0.045, 0, 0);
  camera.scale.set(1, 1, 1);
  camera.fov = 72; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  seatedOffset = 0; seatedCalibrationPending = false;
  jumpHeight = 0; jumpVelocity = 0; jumpHeld = false;
  crouchOffset = 0; crouchActive = false; crouchButtonDown = false;
  clearInput(); setPlaying(false); lastTime = 0;
});

function readInput() {
  if (renderer.xr.isPresenting) {
    const session = renderer.xr.getSession();
    if (session.visibilityState !== 'visible') return { x: 0, z: 0, turn: 0, fast: false, jump: false, crouchPressed: false };
    let x = 0, z = 0, turn = 0, fast = false, jump = false, crouchPressed = false;
    for (const source of session.inputSources) {
      const pad = source.gamepad;
      if (!pad) continue;
      const axes = pad.axes || [];
      // Same thumbstick selection and per-axis deadzone used by dumbgame.
      const axis = axes.length >= 4 ? axes.length - 2 : 0;
      if (source.handedness === 'left') {
        if (axes.length >= 2) {
          x = stickAxis(axes[axis] || 0, 0.15);
          z = stickAxis(axes[axis + 1] || 0, 0.15);
        }
        // xr-standard button 1 is the squeeze/grip control on Quest Touch controllers.
        fast = Boolean(pad.buttons[1]?.pressed);
      }
      if (source.handedness === 'right') {
        if (axes.length >= 2) turn = stickAxis(axes[axis] || 0, 0.15);
        // xr-standard button 3 is the right thumbstick click on Quest Touch controllers.
        crouchPressed = Boolean(pad.buttons[RIGHT_STICK_BUTTON]?.pressed);
        // xr-standard button 4 is A on the right Quest Touch controller.
        jump = Boolean(pad.buttons[4]?.pressed);
      }
    }
    return { x, z, turn, fast, jump, crouchPressed };
  }
  const x = Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + touchMove.x;
  const z = Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp')) + touchMove.z;
  const length = Math.max(1, Math.hypot(x, z));
  return { x: x / length, z: z / length,
    turn: Number(keys.has('ArrowRight') || keys.has('KeyE')) - Number(keys.has('ArrowLeft') || keys.has('KeyQ')),
    fast: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    jump: keys.has('Space'), crouchPressed: false };
}

function frame(time) {
  const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
  lastTime = time;
  dayNight.update(dt);
  hands.update(dt);
  rig.updateMatrixWorld(true);
  if (renderer.xr.isPresenting) renderer.xr.updateCamera(camera);
  const activeCamera = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  activeCamera.getWorldPosition(head);

  // local-floor still reports the real headset height while sitting. In seated mode,
  // measure it once at VR start and raise the entire player rig to a normal eye height.
  if (renderer.xr.isPresenting && seatedCalibrationPending) {
    const physicalEyeHeight = head.y - rig.position.y;
    if (physicalEyeHeight > 0.65 && physicalEyeHeight < 2.2) {
      seatedOffset = clamp(STANDING_EYE_HEIGHT - physicalEyeHeight, 0, 0.9);
      seatedCalibrationPending = false;
      rig.position.y += seatedOffset;
      head.y += seatedOffset;
    }
  }

  if (playing) {
    const input = readInput();

    // Right thumbstick click toggles artificial crouch; horizontal stick motion still smooth-turns.
    if (input.crouchPressed && !crouchButtonDown) crouchActive = !crouchActive;
    crouchButtonDown = input.crouchPressed;
    const desiredCrouchOffset = renderer.xr.isPresenting && crouchActive ? -CROUCH_DEPTH : 0;
    crouchOffset += (desiredCrouchOffset - crouchOffset) * (1 - Math.exp(-dt * CROUCH_RESPONSE));

    // Jump is edge-triggered so holding A cannot bunny-hop on every landing.
    if (input.jump && !jumpHeld && jumpHeight <= 0.001) jumpVelocity = JUMP_SPEED;
    jumpHeld = input.jump;
    if (jumpVelocity !== 0 || jumpHeight > 0) {
      jumpVelocity -= GRAVITY * dt;
      jumpHeight += jumpVelocity * dt;
      if (jumpHeight <= 0) { jumpHeight = 0; jumpVelocity = 0; }
    }

    const turn = -input.turn * TURN_SPEED * dt;
    if (turn) {
      // Same smooth-turn model as dumbgame: rotate the rig around the physical head.
      const rotated = pivotRig(rig.position.x, rig.position.z, head.x, head.z, turn);
      rig.position.x = rotated.x; rig.position.z = rotated.z; rig.rotation.y += turn;
    }

    if (renderer.xr.isPresenting) {
      // Movement follows the virtual body/turn yaw only. Head looking never steers locomotion.
      movementForward.set(-Math.sin(rig.rotation.y), 0, -Math.cos(rig.rotation.y));
      lastDirection.copy(movementForward);
    } else {
      activeCamera.getWorldDirection(direction);
      direction.y = 0;
      if (direction.lengthSq() < 0.001) direction.copy(lastDirection);
      direction.normalize();
      movementForward.copy(direction);
      lastDirection.copy(direction);
    }

    right.crossVectors(movementForward, up).normalize();
    target.copy(right).multiplyScalar(input.x).addScaledVector(movementForward, -input.z);
    if (target.lengthSq() > 1) target.normalize();
    target.multiplyScalar(input.fast ? FAST_SPEED : WALK_SPEED);
    velocity.lerp(target, 1 - Math.exp(-dt * (target.lengthSq() ? 18 : 28)));
    const dx = velocity.x * dt, dz = velocity.z * dt;
    const nextX = clamp(head.x + dx, -498, 498), nextZ = clamp(head.z + dz, -498, 498);
    const movedX = nextX - head.x, movedZ = nextZ - head.z;
    rig.position.x += movedX; rig.position.z += movedZ;
    head.x = nextX; head.z = nextZ;

    // Smooth the terrain-following base separately from seated height, crouch and jump height.
    const ground = field.sample(head.x, head.z);
    groundY += (ground - groundY) * (1 - Math.exp(-dt * 24));
    rig.position.y = groundY + seatedOffset + crouchOffset + jumpHeight;

    footsteps.update({
      distance: Math.hypot(movedX, movedZ),
      speed: Math.hypot(velocity.x, velocity.z),
      grounded: jumpHeight <= 0.001,
      active: true
    });
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
