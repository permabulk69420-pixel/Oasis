import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BOW, BOW_HELD_ROTATION, setBowDraw } from './bow.js';
import { attachHeldObject, setGripSurface } from './grip-contact.js';
import { pulseHaptics } from './haptics.js';
import { skyLight } from './sky-environment.js';

const BASE = import.meta.env?.BASE_URL ?? '/';
const FORWARD = new THREE.Vector3(0, 0, -1);
export const ARCHERY = Object.freeze({
  arrowUrl: `${BASE}models/bow/arrow.glb`, quiverUrl: `${BASE}models/bow/quiver.glb`,
  arrowLength: 0.75, nockRadius: 0.18, shoulderRadius: 0.32,
  pickupRadius: 0.25, hitRadius: 0.045, sweepStep: 0.06,
  maxArrows: 32, lifetime: 120, gravity: 9.81,
});
export function arrowSpeed(draw) {
  return 8 + 44 * THREE.MathUtils.clamp(draw / BOW.fullDraw, 0, 1);
}
export function arrowDamage(draw) {
  return 12 + 30 * THREE.MathUtils.clamp(draw / BOW.fullDraw, 0, 1);
}

// Grip holds everything: bow in either hand, arrow from the opposite shoulder, arrow
// to the string, pull, release. A nocked arrow reserves the drawing hand so pickups,
// the backpack, the glider and climbing cannot also claim it. Unlimited test ammo;
// old loose arrows are bounded and expire, with geometry/textures shared by all shots.
export function createArchery({ scene, rig, states, tools, renderer, heightAt = () => 0, targets = [], blockers = [], onError = console.warn }) {
  const loader = new GLTFLoader();
  let template = null, quiver = null;
  const arrows = [];
  const gripDown = new Map();
  const mount = new THREE.Group();
  mount.name = 'Bow quiver';
  mount.visible = false;
  (rig || scene).add(mount);
  const body = { center: new THREE.Vector3(), yaw: 0 };
  const shoulder = new THREE.Vector3(), hand = new THREE.Vector3(), local = new THREE.Vector3();
  const direction = new THREE.Vector3(), previousTip = new THREE.Vector3(), nextTip = new THREE.Vector3();
  const sample = new THREE.Vector3(), closest = new THREE.Vector3(), along = new THREE.Vector3();
  const opening = new THREE.Vector3(0, 0.12, -0.058);
  let shots = 0, hits = 0;

  loader.load(ARCHERY.arrowUrl, gltf => {
    template = gltf.scene;
    skyLight(template);
    template.userData.gripProfile = 'thin';
    setGripSurface(template, { meshes: ['arrow_mesh'], axis: [0, 0, -1], point: [0, 0, -0.04], halfLength: 0.035 });
  }, undefined, error => onError(`[Oasis bow] Arrow failed to load: ${error?.message || error}`));
  loader.load(ARCHERY.quiverUrl, gltf => {
    quiver = gltf.scene;
    skyLight(quiver);
    quiver.name = 'Shoulder quiver';
    const marker = quiver.getObjectByName('opening');
    if (marker) opening.copy(quiver.worldToLocal(marker.getWorldPosition(new THREE.Vector3())));
    mount.add(quiver);
  }, undefined, error => onError(`[Oasis bow] Quiver failed to load: ${error?.message || error}`));

  const squeezed = state => Boolean(state?.inputSource?.gamepad?.buttons?.[1]?.pressed);
  const empty = state => state?.objectGrip && state.objectGrip.children.length === 0;
  const heldBow = bow => Boolean(bow?.heldBy?.inputSource && squeezed(bow.heldBy) && bow.root.parent);
  function handPosition(state, out = hand) {
    state.objectGrip.updateWorldMatrix(true, false);
    return state.objectGrip.getWorldPosition(out);
  }
  function tip(arrow, out) {
    return out.copy(FORWARD).applyQuaternion(arrow.root.quaternion).multiplyScalar(ARCHERY.arrowLength).add(arrow.root.position);
  }
  function remove(arrow) {
    arrow.token?.removeFromParent();
    if (arrow.bow) { setBowDraw(arrow.bow); arrow.bow.state.arrow = null; }
    arrow.root.removeFromParent();
    const index = arrows.indexOf(arrow);
    if (index >= 0) arrows.splice(index, 1);
  }
  function newArrow() {
    if (!template) return null;
    if (arrows.length >= ARCHERY.maxArrows) {
      const oldest = arrows.find(arrow => arrow.phase === 'ground') || arrows.find(arrow => arrow.phase === 'flying');
      if (!oldest) return null;
      remove(oldest);
    }
    const arrow = { root: template.clone(true), phase: 'ground', heldBy: null, bow: null, drawBy: null,
      token: null, draw: 0, tick: 0, age: 0, damage: 0, velocity: new THREE.Vector3(), offset: new THREE.Vector3(), nock: new THREE.Vector3() };
    arrow.root.name = 'Arrow';
    arrows.push(arrow);
    return arrow;
  }
  function grab(arrow, state) {
    if (!attachHeldObject(state, arrow.root, BOW_HELD_ROTATION)) return false;
    arrow.phase = 'held'; arrow.heldBy = state; arrow.age = 0;
    pulseHaptics(state, 0.25, 30);
    return true;
  }
  function freeDrawHand(arrow) {
    arrow.token?.removeFromParent();
    arrow.token = null; arrow.drawBy = null;
  }
  function detachBow(arrow) {
    if (arrow.bow) { setBowDraw(arrow.bow); arrow.bow.state.arrow = null; }
    arrow.bow = null;
    freeDrawHand(arrow);
  }
  function drop(arrow) {
    scene.attach(arrow.root);
    detachBow(arrow);
    arrow.phase = 'flying'; arrow.heldBy = null; arrow.age = 0; arrow.damage = 0;
    arrow.velocity.set(0, -0.1, 0);
  }
  function placeNocked(arrow) {
    const bow = arrow.bow;
    arrow.root.position.copy(arrow.nock);
    direction.copy(bow.state.sockets.rest).sub(arrow.nock);
    if (direction.lengthSq() < 0.0064) direction.copy(FORWARD);
    else direction.normalize();
    arrow.root.quaternion.setFromUnitVectors(FORWARD, direction);
    setBowDraw(bow, arrow.draw, arrow.nock);
  }
  function beginDraw(arrow, state) {
    arrow.drawBy = state;
    arrow.token = new THREE.Group();
    arrow.token.name = 'Held bowstring';
    arrow.token.userData.gripProfile = 'pinch';
    state.objectGrip.add(arrow.token);
    local.copy(handPosition(state));
    arrow.bow.root.worldToLocal(local);
    arrow.offset.copy(local).sub(arrow.bow.state.sockets.nock);
    arrow.draw = arrow.tick = 0;
    pulseHaptics(state, 0.35, 35);
  }
  function nock(arrow, bow, state) {
    arrow.root.removeFromParent();
    bow.root.add(arrow.root);
    arrow.phase = 'nocked'; arrow.heldBy = null; arrow.bow = bow;
    bow.state.arrow = arrow;
    arrow.nock.copy(bow.state.sockets.nock);
    beginDraw(arrow, state);
    placeNocked(arrow);
  }
  function shoot(arrow) {
    const draw = arrow.draw, state = arrow.drawBy, bowHand = arrow.bow.heldBy;
    scene.attach(arrow.root);
    direction.copy(FORWARD).applyQuaternion(arrow.root.quaternion).normalize();
    detachBow(arrow);
    arrow.phase = 'flying'; arrow.age = 0; arrow.damage = arrowDamage(draw);
    arrow.velocity.copy(direction).multiplyScalar(arrowSpeed(draw));
    shots++;
    pulseHaptics(state, 0.65, 55); pulseHaptics(bowHand, 0.3, 35);
  }

  function updateQuiver(bow) {
    mount.visible = Boolean(bow && quiver && tools.getBodyFrame(body));
    if (!mount.visible) return;
    const side = bow.heldBy.handedness === 'left' ? 1 : -1;
    mount.position.set(side * 0.25, -0.13, 0.24).applyAxisAngle(THREE.Object3D.DEFAULT_UP, body.yaw).add(body.center);
    mount.rotation.set(0, body.yaw, -side * 0.15);
    mount.updateWorldMatrix(true, true);
    shoulder.copy(opening).applyMatrix4(mount.matrixWorld);
  }
  function nearShoulder(state) {
    return mount.visible && handPosition(state).distanceToSquared(shoulder) <= ARCHERY.shoulderRadius ** 2;
  }
  function nearNock(bow, state) {
    local.copy(bow.state.sockets.nock).applyMatrix4(bow.root.matrixWorld);
    return handPosition(state).distanceToSquared(local) <= ARCHERY.nockRadius ** 2;
  }
  function findArrow(state) {
    handPosition(state);
    let found = null, best = ARCHERY.pickupRadius;
    for (const arrow of arrows) {
      if (arrow.phase !== 'ground') continue;
      tip(arrow, nextTip);
      along.copy(nextTip).sub(arrow.root.position);
      const t = THREE.MathUtils.clamp(closest.copy(hand).sub(arrow.root.position).dot(along) / along.lengthSq(), 0, 1);
      closest.copy(arrow.root.position).addScaledVector(along, t);
      const distance = closest.distanceTo(hand);
      if (distance < best) { best = distance; found = arrow; }
    }
    return found;
  }

  function stop(arrow, point) {
    direction.copy(FORWARD).applyQuaternion(arrow.root.quaternion);
    arrow.root.position.copy(point).addScaledVector(direction, -ARCHERY.arrowLength + 0.025);
    arrow.velocity.set(0, 0, 0); arrow.phase = 'ground'; arrow.damage = 0; arrow.age = 0;
  }
  function stepFlight(arrow, dt) {
    const steps = Math.max(1, Math.ceil(dt * 180)), h = dt / steps;
    for (let step = 0; step < steps && arrow.phase === 'flying'; step++) {
      tip(arrow, previousTip);
      arrow.root.position.addScaledVector(arrow.velocity, h);
      arrow.root.position.y -= ARCHERY.gravity * h * h / 2;
      arrow.velocity.y -= ARCHERY.gravity * h;
      // A dropped arrow falls with its own orientation; a shot follows its flight.
      if (arrow.damage > 0) arrow.root.quaternion.setFromUnitVectors(FORWARD, direction.copy(arrow.velocity).normalize());
      tip(arrow, nextTip);
      const samples = Math.max(1, Math.ceil(previousTip.distanceTo(nextTip) / ARCHERY.sweepStep));
      for (let i = 0; i <= samples; i++) {
        sample.copy(previousTip).lerp(nextTip, i / samples);
        const ground = heightAt(sample.x, sample.z, sample.y);
        if (sample.y <= ground) { sample.y = ground; stop(arrow, sample); break; }
        if (blockers.some(blocker => blocker.hitTest(sample, ARCHERY.hitRadius))) { stop(arrow, sample); break; }
        if (arrow.damage <= 0) continue;
        for (const target of targets) {
          if (!target.hitTest(sample, ARCHERY.hitRadius) || !target.hurt(arrow.damage, { kind: { id: 'arrow' }, root: arrow.root })) continue;
          hits++; stop(arrow, sample);
          // Drop after a creature hit, rather than leaving the arrow hanging in the
          // air when the creature moves away. It cannot deal damage a second time.
          arrow.phase = 'flying'; arrow.velocity.set(0, -0.4, 0);
          return;
        }
        if (arrow.phase !== 'flying') break;
      }
      // The nock also meets the ground, so a dropped arrow cannot sink until its tip reaches it.
      if (arrow.phase === 'flying') {
        const p = arrow.root.position, ground = heightAt(p.x, p.z, p.y);
        if (p.y <= ground) { p.y = ground + 0.025; arrow.phase = 'ground'; arrow.damage = 0; arrow.velocity.set(0, 0, 0); }
      }
    }
  }

  function update(dt = 0) {
    const presenting = Boolean(renderer?.xr?.isPresenting);
    const visible = !renderer?.xr?.getSession?.() || renderer.xr.getSession().visibilityState === 'visible';
    const active = presenting && visible;
    const bows = tools.getInstances('bow');
    const bow = active ? bows.find(heldBow) : null;
    updateQuiver(bow);
    for (const arrow of [...arrows]) {
      if (arrow.phase === 'flying' || arrow.phase === 'ground') {
        arrow.age += dt;
        if (arrow.age > ARCHERY.lifetime) { remove(arrow); continue; }
        if (arrow.phase === 'flying' && dt > 0) stepFlight(arrow, dt);
        continue;
      }
      if (arrow.phase === 'held') {
        const state = arrow.heldBy;
        if (!active || !state.inputSource || !squeezed(state)) {
          if (active && state.inputSource && nearShoulder(state)) remove(arrow);
          else drop(arrow);
        } else {
          const held = bows.find(candidate => heldBow(candidate) && candidate.heldBy !== state && !candidate.state.arrow);
          if (held) {
            held.root.updateWorldMatrix(true, false);
            if (nearNock(held, state)) nock(arrow, held, state);
          }
        }
      }
      if (arrow.phase !== 'nocked') continue;
      if (!active || !heldBow(arrow.bow)) { drop(arrow); continue; }
      arrow.bow.root.updateWorldMatrix(true, false);
      const state = arrow.drawBy;
      if (!state) {
        const free = states.find(candidate => candidate !== arrow.bow.heldBy && candidate.inputSource && empty(candidate)
          && squeezed(candidate) && !gripDown.get(candidate) && nearNock(arrow.bow, candidate));
        if (free) beginDraw(arrow, free);
        continue;
      }
      if (!state.inputSource || !squeezed(state)) {
        if (state.inputSource && arrow.draw >= BOW.minDraw) shoot(arrow);
        else {
          freeDrawHand(arrow); arrow.draw = 0;
          arrow.nock.copy(arrow.bow.state.sockets.nock); placeNocked(arrow);
        }
        continue;
      }
      local.copy(handPosition(state)); arrow.bow.root.worldToLocal(local);
      const rest = arrow.bow.state.sockets.nock;
      arrow.nock.copy(local).sub(arrow.offset);
      arrow.nock.x = THREE.MathUtils.clamp(arrow.nock.x, rest.x - 0.35, rest.x + 0.35);
      arrow.nock.y = THREE.MathUtils.clamp(arrow.nock.y, rest.y - 0.35, rest.y + 0.35);
      arrow.nock.z = THREE.MathUtils.clamp(arrow.nock.z, rest.z, rest.z + BOW.fullDraw);
      arrow.draw = arrow.nock.z - rest.z;
      const tick = Math.floor(arrow.draw / BOW.fullDraw * 5 + 1e-6);
      if (tick > arrow.tick) pulseHaptics(state, tick === 5 ? 0.5 : 0.16, tick === 5 ? 45 : 18);
      arrow.tick = tick;
      placeNocked(arrow);
    }
    if (active) for (const state of states) {
      if (!state.inputSource || !empty(state) || !squeezed(state) || gripDown.get(state)) continue;
      const resting = findArrow(state);
      if (resting) grab(resting, state);
      else if (bow && state !== bow.heldBy && nearShoulder(state)) {
        const fresh = newArrow();
        if (fresh && !grab(fresh, state)) remove(fresh);
      }
    }
    for (const state of states) gripDown.set(state, squeezed(state));
  }
  function cancel() {
    for (const arrow of arrows) if (arrow.phase === 'held' || arrow.phase === 'nocked') drop(arrow);
    mount.visible = false;
    // Resuming with a grip already held must not take a new arrow.
    for (const state of states) gripDown.set(state, true);
  }
  return {
    update, cancel, get ready() { return Boolean(template && quiver); },
    list: () => ({ shots, hits, quiver: mount.visible, arrows: arrows.map(arrow => ({ phase: arrow.phase, draw: arrow.draw })) }),
    debug: { arrows, mount, getShoulder: out => out.copy(shoulder) },
  };
}
