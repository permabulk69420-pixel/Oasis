import * as THREE from 'three';
import { pulseHaptics } from './haptics.js';

// Placing a campfire or a building piece: a see-through ghost follows where you aim, green where it can go and
// red where it can't, with a line of text saying what to press or why not. Nothing is spent until you confirm.
//
//   VR:      the hand that pressed Place aims (a faint line runs from it), its trigger places. Open the menu (Y) to back out.
//   Desktop: aim with the view centre, click or press Enter to place. Y (the menu) or Esc backs out.
//   Touch:   aim with the view centre, tap to place.

export const PLACEMENT = Object.freeze({
  minReach: 0.9, // metres from your head: never right on your feet
  maxReach: 6, // and never further than this, however far you point
  fallbackReach: 1.6, // where it goes when the aim finds no ground (looking at the sky)
  march: 0.12, // metres per step when walking the aim down to the ground
  marchLimit: 16, // how far along the aim to look for ground
  grid: 0.2, // the spot snaps to this grid: steadies a shaky hand and gives each cell its own fixed turn
  follow: 22, // how quickly the ghost catches up with the spot (per second)
  armDelay: 0.15, // seconds after starting before a trigger can place (the press that chose Place is still down)
  good: { colour: 0x8dffb4, opacity: 0.42 },
  bad: { colour: 0xff6a58, opacity: 0.38 },
  hapticOk: { intensity: 0.35, ms: 45 },
  hapticNo: { intensity: 0.5, ms: 90 },
});

// X on the left controller and B on the right; Y remains the menu/cancel button.
export function placementRotateDown(state) {
  return Boolean(state?.inputSource?.gamepad?.buttons?.[state.handedness === 'left' ? 4 : 5]?.pressed);
}

// ---- pure helper (unit tested) ----

// Where an aim ray meets the ground, as a spot to build on. `origin` and `direction` are {x,y,z} (direction need not be
// unit length); `head` is {x,z}, the player, used to keep the spot within reach. `heightAt(x, z)` is the ground height.
// Returns { x, z, hit } where hit is false if the ray never reached the ground (the spot is then straight ahead).
// `options` overrides PLACEMENT; `out` (an object) is filled and returned instead of a new one, so a per-frame caller allocates nothing.
export function aimGroundPoint(origin, direction, heightAt, head = origin, options = null, out = {}) {
  const { minReach, maxReach, fallbackReach, march, marchLimit, grid } = options ? { ...PLACEMENT, ...options } : PLACEMENT;
  const length = Math.hypot(direction.x, direction.y, direction.z) || 1;
  const dx = direction.x / length, dy = direction.y / length, dz = direction.z / length;
  const above = t => origin.y + dy * t - heightAt(origin.x + dx * t, origin.z + dz * t);

  let x, z, hit = false;
  if (dy < 0 || above(0) < 0) {
    let previous = 0;
    for (let t = march; t <= marchLimit + 1e-9; t += march) {
      if (above(t) <= 0) {
        let low = previous, high = t; // above(low) > 0, above(high) <= 0
        for (let i = 0; i < 12; i++) {
          const mid = (low + high) / 2;
          if (above(mid) > 0) low = mid; else high = mid;
        }
        const found = (low + high) / 2;
        x = origin.x + dx * found; z = origin.z + dz * found; hit = true;
        break;
      }
      previous = t;
    }
  }
  const flat = Math.hypot(dx, dz);
  const ahead = flat > 1e-3 ? { x: dx / flat, z: dz / flat } : { x: 0, z: -1 };
  if (!hit) {
    // ground too far to find: out at full reach if the aim is going down, else (sky) the short way ahead
    const far = dy < 0 ? maxReach : fallbackReach;
    x = head.x + ahead.x * far; z = head.z + ahead.z * far;
  }

  // keep it within reach of the player, measured sideways along the ground
  let rx = x - head.x, rz = z - head.z;
  const reach = Math.hypot(rx, rz);
  if (reach > maxReach || reach < minReach) {
    const target = Math.min(Math.max(reach, minReach), maxReach);
    const ux = reach > 1e-3 ? rx / reach : ahead.x, uz = reach > 1e-3 ? rz / reach : ahead.z;
    rx = ux * target; rz = uz * target;
    x = head.x + rx; z = head.z + rz;
  }
  if (grid > 0) { x = Math.round(x / grid) * grid; z = Math.round(z / grid) * grid; }
  out.x = x; out.z = z; out.hit = hit;
  return out;
}

// ---- the placement itself ----

const HINT = { width: 1024, height: 160 };

function createHint() {
  const canvas = document.createElement('canvas');
  canvas.width = HINT.width; canvas.height = HINT.height;
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 30;
  sprite.center.set(0.5, 0);
  let shown = null;
  function set(text, ok) {
    const key = `${ok ? 1 : 0}|${text}`;
    if (key === shown) return;
    shown = key;
    context.clearRect(0, 0, HINT.width, HINT.height);
    context.font = '600 52px system-ui, sans-serif';
    const wide = context.measureText(text).width;
    const size = wide > HINT.width - 120 ? Math.floor(52 * (HINT.width - 120) / wide) : 52;
    context.font = `600 ${size}px system-ui, sans-serif`;
    const w = Math.min(HINT.width - 8, context.measureText(text).width + 90);
    context.fillStyle = 'rgba(8, 14, 20, 0.78)';
    context.beginPath();
    context.roundRect((HINT.width - w) / 2, 22, w, 116, 58);
    context.fill();
    context.lineWidth = 5;
    context.strokeStyle = ok ? '#8dffb4' : '#ff7a68';
    context.stroke();
    context.fillStyle = '#f4fbff';
    context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(text, HINT.width / 2, 82);
    texture.needsUpdate = true;
  }
  return { sprite, set };
}

// scene, renderer, camera: three. states: the hand states (controller, inputSource, handedness). heightAt: the ground as the
// player sees it. check(x, z) -> { ok, message }. makePreview() -> an Object3D to ghost, or null while its model loads.
// siteAt(x, z) -> { y } is the height it will sit at. yawAt(x, z) -> the turn it will have. onConfirm(x, z) -> { ok, message }.
// inputMode() -> 'vr' | 'touch' | 'desktop', for the wording of the hint.
export function createPlacement({
  scene, renderer, camera, states = [], heightAt, siteAt, check, makePreview, yawAt = () => 0, onConfirm,
  inputMode = () => (renderer.xr.isPresenting ? 'vr' : 'desktop'), radius = 0.5,
  resolve = null,
}) {
  const materials = {
    good: new THREE.MeshBasicMaterial({ color: PLACEMENT.good.colour, transparent: true, opacity: PLACEMENT.good.opacity, depthWrite: false, toneMapped: false }),
    bad: new THREE.MeshBasicMaterial({ color: PLACEMENT.bad.colour, transparent: true, opacity: PLACEMENT.bad.opacity, depthWrite: false, toneMapped: false }),
  };
  const ringMaterials = {
    good: new THREE.MeshBasicMaterial({ color: PLACEMENT.good.colour, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide }),
    bad: new THREE.MeshBasicMaterial({ color: PLACEMENT.bad.colour, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide }),
  };
  const root = new THREE.Group();
  root.name = 'Placement ghost';
  root.visible = false;
  scene.add(root);

  const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.04, radius + 0.02, 40), ringMaterials.good);
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 28;
  root.add(ring);

  const hint = createHint();
  root.add(hint.sprite);

  const aimLineGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const aimLine = new THREE.Line(aimLineGeometry, new THREE.LineBasicMaterial({ color: 0xbfeff5, transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false }));
  aimLine.frustumCulled = false;
  aimLine.renderOrder = 27;
  aimLine.visible = false;
  scene.add(aimLine);

  let ghost = null, ghostMeshes = [];
  let active = false, hand = 'right', armed = false, age = 0, triggerWasDown = false;
  let valid = false, shownValid = null, message = '', haveSpot = false;
  let placementType = 'campfire', turn = 0, rotateWasDown = false;
  let spot = { x: 0, z: 0 };
  const shown = new THREE.Vector3();
  const origin = new THREE.Vector3(), direction = new THREE.Vector3(), head = new THREE.Vector3(), rotation = new THREE.Matrix4();
  const hintWorld = new THREE.Vector3(), aimed = { x: 0, z: 0, hit: false };

  function stateFor(side) {
    let fallback = null;
    for (let i = 0; i < states.length; i++) {
      if (states[i].handedness === side) return states[i];
      if (!fallback && states[i].inputSource) fallback = states[i];
    }
    return fallback;
  }

  function ensureGhost() {
    if (ghost) return true;
    const preview = makePreview?.(placementType);
    if (!preview) return false;
    ghost = preview;
    ghost.name = 'Placement preview';
    ghost.traverse(node => {
      if (!node.isMesh) return;
      node.material = materials.good;
      node.castShadow = false; node.receiveShadow = false;
      node.renderOrder = 26;
      ghostMeshes.push(node);
    });
    root.add(ghost);
    return true;
  }

  function paint(ok) {
    if (shownValid === ok) return;
    shownValid = ok;
    for (const mesh of ghostMeshes) mesh.material = ok ? materials.good : materials.bad;
    ring.material = ok ? ringMaterials.good : ringMaterials.bad;
  }

  function aimSource() {
    // returns true and fills origin/direction when there is something to aim with
    if (inputMode() === 'vr') {
      const state = stateFor(hand);
      const controller = state?.controller;
      if (!controller || !controller.visible) return null;
      controller.updateWorldMatrix(true, false);
      origin.setFromMatrixPosition(controller.matrixWorld);
      rotation.extractRotation(controller.matrixWorld);
      direction.set(0, 0, -1).applyMatrix4(rotation);
      return state;
    }
    camera.getWorldPosition(origin);
    camera.getWorldDirection(direction);
    return true;
  }

  function wording(ok, why) {
    if (!ok) return why || 'Can’t place that here.';
    const mode = inputMode();
    const rotation = placementType !== 'campfire' ? (mode === 'vr' ? ' · B / X rotate' : mode === 'touch' ? ' · Rotate below' : ' · R rotates') : '';
    if (mode === 'vr') return `Trigger to place${rotation}`;
    if (mode === 'touch') return `Tap to place${rotation}`;
    return `Click to place${rotation}`;
  }

  function start({ hand: which = null, type = 'campfire' } = {}) {
    if (ghost) { root.remove(ghost); ghost = null; ghostMeshes = []; }
    placementType = type; turn = 0; rotateWasDown = true;
    ring.scale.setScalar(type === 'campfire' ? 1 : 3);
    active = true;
    hand = which === 'left' || which === 'right' ? which : 'right';
    armed = false; age = 0; triggerWasDown = true; haveSpot = false; shownValid = null;
    root.visible = false;
    return true;
  }

  function stop() {
    active = false; root.visible = false; aimLine.visible = false;
  }

  function cancel() { if (active) stop(); }

  function buzz(setting) {
    if (inputMode() !== 'vr') return;
    const state = stateFor(hand);
    if (state) pulseHaptics(state, setting.intensity, setting.ms);
  }

  function confirm() {
    if (!active || !haveSpot) return false;
    if (!valid) { buzz(PLACEMENT.hapticNo); return false; }
    const result = onConfirm(spot.x, spot.z, spot, placementType);
    if (result?.ok) {
      buzz(PLACEMENT.hapticOk);
      // Building can continue with the next identical piece; each click still spends only one.
      if (result.repeat) { haveSpot = false; root.visible = false; }
      else stop();
      return true;
    }
    // something changed under us (no item left, or the spot was taken): say so and carry on aiming
    message = result?.message || message;
    if (result && /No .* in your inventory/i.test(result.message || '')) stop();
    buzz(PLACEMENT.hapticNo);
    return false;
  }

  function update(dt) {
    if (!active) return;
    age += dt;
    const vr = inputMode() === 'vr';
    const source = aimSource();
    if (!source) { root.visible = false; aimLine.visible = false; return; }
    if (vr) {
      const rotateDown = placementRotateDown(source);
      if (placementType !== 'campfire' && !rotateWasDown && rotateDown) rotate();
      rotateWasDown = rotateDown;
    }

    renderer.xr.isPresenting ? renderer.xr.getCamera().getWorldPosition(head) : camera.getWorldPosition(head);
    aimGroundPoint(origin, direction, heightAt, head, null, aimed);
    spot = resolve ? resolve({ type: placementType, origin, direction, head, ground: aimed, turn }) : { x: aimed.x, z: aimed.z };
    haveSpot = true;

    if (!ensureGhost()) { root.visible = false; return; }
    const verdict = check(spot.x, spot.z, spot, placementType, head);
    valid = Boolean(verdict.ok);
    message = verdict.message;
    paint(valid);

    const y = spot.y ?? siteAt(spot.x, spot.z).y;
    if (root.visible === false) shown.set(spot.x, y, spot.z);
    else {
      const k = spot.snapped ? 1 : 1 - Math.exp(-PLACEMENT.follow * dt);
      shown.x += (spot.x - shown.x) * k; shown.z += (spot.z - shown.z) * k; shown.y += (y - shown.y) * k;
    }
    root.position.copy(shown);
    root.visible = true;
    ghost.rotation.y = spot.yaw ?? yawAt(spot.x, spot.z);

    // the line of text floats above the fire and turns to face you, a little bigger the further it is
    hintWorld.set(shown.x, shown.y + (placementType === 'campfire' ? 0.95 : 1.35), shown.z);
    root.worldToLocal(hintWorld);
    hint.sprite.position.copy(hintWorld);
    hint.set(wording(valid, message), valid);
    const distance = Math.hypot(shown.x - head.x, shown.z - head.z);
    const scale = 1.25 * Math.min(Math.max(distance / 2.2, 0.9), 2.4);
    hint.sprite.scale.set(scale, scale * HINT.height / HINT.width, 1);

    if (vr) {
      const positions = aimLineGeometry.attributes.position;
      positions.setXYZ(0, origin.x, origin.y, origin.z);
      positions.setXYZ(1, shown.x, shown.y + 0.05, shown.z);
      positions.needsUpdate = true;
      aimLine.visible = true;

      const pad = (source.inputSource?.gamepad?.buttons || [])[0];
      const down = Boolean(pad?.pressed);
      if (!armed && age >= PLACEMENT.armDelay && !down) armed = true;
      if (armed && down && !triggerWasDown) confirm();
      triggerWasDown = down;
    } else aimLine.visible = false;
  }

  return {
    start, cancel, confirm, update, rotate,
    isActive: () => active,
    get valid() { return valid; },
    get message() { return message; },
    get spot() { return { ...spot }; },
    get type() { return placementType; },
    root,
  };

  function rotate() {
    if (!active || placementType === 'campfire') return false;
    turn = (turn + Math.PI / 2) % (Math.PI * 2); return true;
  }
}
