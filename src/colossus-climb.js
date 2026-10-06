import * as THREE from 'three';
import { pulseHaptics } from './haptics.js';
import { setHeldGripProfile, clearHeldGripProfile, GRIP_PROFILE } from './grip-poses.js';
import { attachHeldObject, setGripSurface } from './grip-contact.js';

// Climbing the Colossus (the owner, 7 Oct): its glowing crystals are hand-holds. Squeeze a grip with your hand on one and your hand clamps onto it
// (front on, fingers curled against it); pull that hand down and you pull yourself up; reach up with the other, grab the next, let the first go.
// Hand over hand. While you hold on you are carried with it as it walks; let go of everything and you fall (and land hard from high up, as any fall).
//
// The holds are read from the model by tools/colossus/extract_holds.py (public/models/colossus/colossus_01_holds.json): every crystal, in its bone's
// own frame (each crystal is weighted to one bone), so its place on the moving creature is that bone's world matrix times the point, on whichever
// level of detail is shown (they share one skeleton).
//
// How the pulling works: each hand that holds a crystal is pinned where it grabbed, in the crystal's bone's frame. Every frame the player (the rig) is
// moved by however far the real hand (the controller) has drifted from its pin, so the hand stays put on the crystal and you move instead (the average,
// when both hold). The drawn hand clamps the crystal FRONT ON (the owner: not round its side): the palm on the crystal's end, the one pointing out at
// you, pushing down it toward its base, the fingers curled down over its sides. The contact solver that fits held tools (src/adaptive-grip.js) is
// given an invisible stand-in for the crystal's end in front of the palm, so the fingers close until they touch it; the hand is then turned (fingers
// up and away, over the end) and moved so the stand-in lies on the real crystal's end.

export const CLIMB = Object.freeze({
  url: `${import.meta.env?.BASE_URL ?? '/'}models/colossus/colossus_01_holds.json`,
  reach: 0.14,           // metres from the palm to a crystal's surface that a squeeze still grabs
  end: Object.freeze({ length: 0.24, inset: 0.03 }),   // the stand-in for the crystal's end (metres long); the palm sits this far down from the tip
  near: 110,             // metres from the Colossus's middle within which holds are looked at at all
  taper: 0.65,           // the crystal's radius shrinks by this share from its base to its tip
  grabHaptic: Object.freeze([0.55, 45]),
  releaseHaptic: Object.freeze([0.2, 25]),
});

const GRIP_BUTTON = 1;

// The point on a hold's surface nearest to `p` (all world space), into `out`, and the gap from `p` to that surface (negative: inside it).
export function nearestOnHold(hold, p, out) {
  const { centre, axis, length, radius } = hold;
  const t0 = -0.45 * length, t1 = 0.55 * length;                 // (the grab point is 45% of the way from the base)
  const d = tmpA.copy(p).sub(centre);
  const t = THREE.MathUtils.clamp(d.dot(axis), t0, t1);
  const onAxis = tmpB.copy(centre).addScaledVector(axis, t);
  const radial = tmpC.copy(p).sub(onAxis);
  let r = radial.length();
  const rAt = radius * (1 - CLIMB.taper * (t - t0) / (t1 - t0));
  if (r < 1e-6) { radial.copy(axis).cross(UP).normalize(); if (radial.lengthSq() < 1e-6) radial.set(1, 0, 0); r = 0; }
  else radial.divideScalar(r);
  out.copy(onAxis).addScaledVector(radial, rAt);
  return r - rAt;
}
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3(), tmpD = new THREE.Vector3(), tmpE = new THREE.Vector3(), tmpF = new THREE.Vector3();
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), m1 = new THREE.Matrix4(), m2 = new THREE.Matrix4(), proxyPos = new THREE.Vector3(), scl = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

// getRoot(): the Colossus model on show (its bones are found by name in it), or null. getDistance(): metres from you to its middle.
export function createColossusClimb({ states, getRoot, getDistance = () => 0, onError = console.warn, data = null }) {
  let holds = null, bones = [], boneNames = [], boundRoot = null;
  const ready = (data ? Promise.resolve(data) : fetch(CLIMB.url).then(r => { if (!r.ok) throw new Error(`${r.status} ${CLIMB.url}`); return r.json(); }))
    .then(json => {
      boneNames = json.bones;
      holds = json.holds.map(([bone, x, y, z, ax, ay, az, length, radius]) => ({
        bone, local: new THREE.Vector3(x, y, z), axisLocal: new THREE.Vector3(ax, ay, az).normalize(), length, radius,
        centre: new THREE.Vector3(), axis: new THREE.Vector3(),
      }));
    })
    .catch(error => onError(`[Colossus climb] ${error?.message || error}`));

  const grips = new Map();      // hand state -> { hold, pinLocal (the controller's grip point when it grabbed, in the bone's frame), node (the handle) }
  const homes = new Map();      // hand state -> the hand model's own place on the controller
  const down = new Map();       // hand state -> was squeezing last frame
  const pin = new THREE.Vector3(), palm = new THREE.Vector3(), surface = new THREE.Vector3(), sum = new THREE.Vector3();
  const inverse = new THREE.Matrix4(), rot = new THREE.Matrix3();

  function bind(root) {
    if (root === boundRoot) return;
    boundRoot = root;
    bones = boneNames.map(name => root?.getObjectByName(name) || null);
  }
  // the holds where they are now (only those on found bones)
  function place() {
    for (const h of holds) {
      const b = bones[h.bone];
      if (!b) { h.centre.set(NaN, NaN, NaN); continue; }
      h.centre.copy(h.local).applyMatrix4(b.matrixWorld);
      h.axis.copy(h.axisLocal).applyMatrix3(rot.setFromMatrix4(b.matrixWorld)).normalize();
    }
  }
  // where the hand really is (the controller's pose, the drawn hand put back where it belongs on it)
  function realPalm(s, target) {
    const home = homes.get(s);
    if (home && s.handAnchor) { s.handAnchor.position.copy(home.position); s.handAnchor.quaternion.copy(home.quaternion); }
    const node = s.gripSocket || s.objectGrip;
    node.updateWorldMatrix(true, false);
    return node.getWorldPosition(target);
  }
  function grab(s) {
    realPalm(s, palm);
    let best = null, bestGap = CLIMB.reach;
    for (const h of holds) {
      if (!(h.centre.x === h.centre.x)) continue;                         // (NaN: its bone is not on show)
      if (h.centre.distanceToSquared(palm) > 1.0) continue;
      const gap = nearestOnHold(h, palm, surface);
      if (gap < bestGap) { bestGap = gap; best = h; }
    }
    if (!best || !s.handAnchor || !s.gripSocket || s.objectGrip.children.length) return false;
    const bone = bones[best.bone];
    // the stand-in for the crystal's end, in front of the palm: a short cylinder as thick as the crystal near its tip, along the palm's normal
    const tipRadius = best.radius * (1 - CLIMB.taper * 0.85);
    const L = CLIMB.end.length;
    const proxy = new THREE.Mesh(new THREE.CylinderGeometry(tipRadius, tipRadius, L, 12), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    proxy.name = 'Colossus crystal end';
    proxy.userData.climbHold = true;
    setGripSurface(proxy, { axis: [0, 1, 0], point: [0, 0, 0], halfLength: L / 2, maxShift: L / 2 + 0.09, startShift: L / 2 - 0.01 });
    // its axis along the palm's normal (the hand model's -Y) in the grip socket's frame
    s.handRoot.updateWorldMatrix(true, false);
    const palmNormal = tmpA.set(0, -1, 0).applyQuaternion(s.handRoot.getWorldQuaternion(q1)).applyQuaternion(s.gripSocket.getWorldQuaternion(q2).invert()).normalize();
    if (!attachHeldObject(s, proxy, new THREE.Quaternion().setFromUnitVectors(UP, palmNormal))) return false;
    homes.set(s, { position: s.handAnchor.position.clone(), quaternion: s.handAnchor.quaternion.clone() });
    setHeldGripProfile(s, GRIP_PROFILE.MEDIUM);
    const pinLocal = palm.clone().applyMatrix4(inverse.copy(bone.matrixWorld).invert());
    grips.set(s, { hold: best, pinLocal, proxy });
    pulseHaptics(s, ...CLIMB.grabHaptic);
    return true;
  }
  function release(s, quiet = false) {
    const g = grips.get(s);
    if (!g) return;
    realPalm(s, palm);                                       // (puts the hand model back on the controller)
    g.proxy.removeFromParent(); g.proxy.geometry.dispose(); g.proxy.material.dispose();
    clearHeldGripProfile(s);
    homes.delete(s);
    grips.delete(s);
    if (!quiet && s.inputSource) pulseHaptics(s, ...CLIMB.releaseHaptic);
  }
  // the drawn hand on its crystal, front on: palm toward the crystal's base, fingers up and away from you over the end, the stand-in on the real end
  function placeHand(s, g, head) {
    const h = g.hold, anchor = s.handAnchor, socket = s.gripSocket;
    if (!anchor?.parent || !socket) return;
    realPalm(s, palm);
    anchor.updateMatrixWorld(true);
    // the stand-in as the solver left it, in the hand model's frame (objectGrip is the socket's frame)
    g.proxy.updateMatrix();
    m1.copy(anchor.matrixWorld).invert().multiply(socket.matrixWorld).multiply(g.proxy.matrix);
    m1.decompose(proxyPos, q1, scl);
    // the hand's frame: palm normal n down the crystal, fingers f across it, up and away from you
    const n = tmpA.copy(h.axis).negate();
    const away = tmpB.copy(h.centre).sub(head); away.y = 0;
    if (away.lengthSq() > 1e-6) away.normalize();
    const f = tmpC.set(0, 1, 0).addScaledVector(away, 0.6);
    f.addScaledVector(n, -f.dot(n));
    if (f.lengthSq() < 1e-6) f.copy(away.lengthSq() ? away : UP).addScaledVector(n, -n.dot(away)).normalize(); else f.normalize();
    const yAxis = tmpD.copy(n).negate(), zAxis = tmpE.copy(f).negate();      // the hand model: palm -Y, fingers -Z
    const xAxis = tmpF.crossVectors(yAxis, zAxis).normalize();
    m2.makeBasis(xAxis, yAxis, zAxis);
    q2.setFromRotationMatrix(m2);
    // the stand-in's middle: half its length in from the crystal's end (its near face on the end, a little down from the tip)
    const tipAlong = 0.55 * h.length - CLIMB.end.inset;
    const centre = tmpB.copy(h.centre).addScaledVector(h.axis, tipAlong).addScaledVector(n, CLIMB.end.length / 2);
    // so the hand model goes where that puts the stand-in
    const anchorPos = centre.sub(proxyPos.applyQuaternion(q2));
    m2.compose(anchorPos, q2, ONE);
    m2.premultiply(m1.copy(anchor.parent.matrixWorld).invert());
    m2.decompose(anchor.position, anchor.quaternion, scl);
    anchor.updateMatrixWorld(true);
  }

  // input: rig, head (moved with the rig), presenting, blocked (the glider is open, or a hand is busy), floorY(x, z): the lowest the feet may go
  // (the ground), rigOffset: the rig's height over the feet. Returns { climbing }.
  function update(dt, { rig, head, presenting = true, blocked = false, floorY = null, rigOffset = 0 }) {
    const root = holds && presenting && getDistance() < CLIMB.near ? getRoot() : null;
    if (!root) { for (const s of [...grips.keys()]) release(s, true); return { climbing: false }; }
    bind(root);
    root.updateMatrixWorld(true);
    place();
    // ---- hands take and leave holds
    for (const s of states) {
      const squeeze = Boolean(s.inputSource?.gamepad?.buttons?.[GRIP_BUTTON]?.pressed);
      const was = down.get(s) ?? false;
      down.set(s, squeeze);
      if (grips.has(s) && (!squeeze || !s.inputSource)) release(s);
      else if (squeeze && !was && !blocked && !grips.has(s) && s.inputSource && s.handAnchor && !s.objectGrip.children.length) grab(s);
    }
    if (!grips.size) return { climbing: false };
    // ---- you move so the hands stay on their holds (the average of what each hand asks)
    sum.set(0, 0, 0);
    for (const [s, g] of grips) {
      const bone = bones[g.hold.bone];
      pin.copy(g.pinLocal).applyMatrix4(bone.matrixWorld);
      sum.add(pin.sub(realPalm(s, palm)));
    }
    sum.divideScalar(grips.size);
    rig.position.add(sum);
    head.add(sum);
    // never below the ground
    if (floorY) {
      const floor = floorY(head.x, head.z) + rigOffset;
      if (rig.position.y < floor) { const up = floor - rig.position.y; rig.position.y += up; head.y += up; }
    }
    rig.updateMatrixWorld(true);
    // ---- the drawn hands on their crystals
    for (const [s, g] of grips) placeHand(s, g, head);
    return { climbing: true };
  }

  return {
    ready, update, release,
    get climbing() { return grips.size > 0; },
    holding: s => grips.has(s),
    get holds() { return holds; },
    // dev: the holds near a point (world), nearest first
    near(point, count = 5) {
      if (!holds) return [];
      return holds.filter(h => h.centre.x === h.centre.x).map(h => ({ h, d: h.centre.distanceTo(point) })).sort((a, b) => a.d - b.d).slice(0, count)
        .map(({ h, d }) => ({ bone: boneNames[h.bone], d: +d.toFixed(2), x: +h.centre.x.toFixed(2), y: +h.centre.y.toFixed(2), z: +h.centre.z.toFixed(2) }));
    },
  };
}
