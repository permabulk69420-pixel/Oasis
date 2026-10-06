import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SPAWN, WATER } from './world.js';
import { pulseHaptics } from './haptics.js';
import { setHeldGripProfile, clearHeldGripProfile, GRIP_PROFILE } from './grip-poses.js';
import { attachHeldObject, setGripSurface } from './grip-contact.js';

// The sand sail kart (the owner's model, public/models/sand-kart/sand_sail_kart.glb): it waits on the sand by the oasis start. Grab its handle (either grip,
// one hand is enough) and you sit in it and it starts rolling; turn the handle like handlebars to steer (the sail rig swings on its mast pivot, up to 40
// degrees, and heels into the turn); let go and it coasts to a stop and you step off beside it. While you hold a grip your hand is locked onto it (the
// hand model sits on the bar, fingers closed round it). Seated, you are carried in the kart's own frame, so your view climbs, dips and rolls with it over
// the dunes. It follows the ground on its three wheels and stops against rocks.
// Desktop: F gets in (or lets go) when you stand by it, A and D steer.
// The model's own markers drive all of it: Grip_Left / Grip_Right (where a hand takes the handle), Sail_Rig_Pivot (the rig's yaw about +Y and lean about
// +Z), Seat_Anchor (where you sit), Wheel_Front / Wheel_Rear_L / Wheel_Rear_R (spin about +X). Forward is +Z, metres.

const GRIP_BUTTON = 1;
export const KART = Object.freeze({
  url: 'models/sand-kart/sand_sail_kart.glb',
  // the flattest patch of sand 5 to 16 m from where you start (checked under all three wheels), nose pointing away from the pond
  spawn: Object.freeze({ near: SPAWN, from: 5, to: 16, yaw: Math.atan2(SPAWN.x - WATER.x, SPAWN.z - WATER.z) }),
  grabRadius: 0.17,          // metres from a grip point that a squeezing hand takes the handle
  desktopReach: 4,           // metres: how near you must stand for F
  cruise: 22,                // m/s while you hold the handle (about 80 km/h)
  accel: 4.8,                // m/s per second, getting going (about 4.5 s to cruising)
  coast: 3.2,                // m/s per second, slowing once you let go (about 7 s from cruising)
  settle: 9,                 // how fast the kart's tilt follows the ground (1/s) when its wheels are on it; in the air it holds its attitude (airTilt)
  airTilt: 1.2,
  gravity: 9.8,              // off a crest faster than the ground falls away it flies (m/s/s)
  // the rider: the eye is pinned to a point above the seat in the kart's frame (it cannot drift into the seat whatever the kart does); the view takes only
  // part of the kart's pitch and roll, smoothed, so landings and ripples do not throw it about (the heading is followed exactly)
  eyeAboveSeat: 0.64,
  viewTilt: 0.45,            // share of the kart's pitch and roll the view takes
  viewResponse: 5,           // how fast the view's tilt follows (1/s)
  grip: Object.freeze({ radius: 0.04, length: 0.3 }),   // the invisible bar the fingers close on (the rubber grips are about 8 cm across)
  turn: 0.85,                // rad/s at full lock and cruising speed
  yawLimit: 40 * Math.PI / 180,
  leanLimit: 18 * Math.PI / 180,
  steerResponse: 9,          // how fast the rig follows your hands (1/s)
  seatDrop: 0.55,            // metres the floor is lowered while you sit, so a standing player's eyes come to a seated height
  stepOff: 1.6,              // metres to the side you are put when you get off
  stopped: 0.25,             // m/s: slow enough to step off
  rumble: Object.freeze({ every: 0.12, strength: 0.06, perSpeed: 0.012 }),
});

const up = new THREE.Vector3(0, 1, 0);
const WHEEL_FEET = Object.freeze([[0, 1.28], [0.99, -0.74], [-0.99, -0.74], [0, 0]]);     // where the wheels (and the belly) touch, in the kart's frame

// The flattest place for it near the start: the spread of the ground's height under its wheels and middle, on rings round the start point.
export function flattestSpot(heightAt, spawn = KART.spawn) {
  const s = Math.sin(spawn.yaw), c = Math.cos(spawn.yaw);
  let best = { x: spawn.near.x + spawn.from, z: spawn.near.z }, bestSpread = Infinity;
  for (let r = spawn.from; r <= spawn.to; r += 1.5) {
    for (let a = 0; a < Math.PI * 2; a += 0.35) {
      const x = spawn.near.x + Math.cos(a) * r, z = spawn.near.z + Math.sin(a) * r;
      if (Math.hypot((x - WATER.x) / WATER.radiusX, (z - WATER.z) / WATER.radiusZ) < 1.25) continue;     // not in or at the pond
      const hs = [[0, 0], [0, 1.6], [1.2, -1], [-1.2, -1], [0, -1.6]].map(([lx, lz]) => heightAt(x + lx * c + lz * s, z - lx * s + lz * c));
      const spread = Math.max(...hs) - Math.min(...hs);
      if (spread < bestSpread) { bestSpread = spread; best = { x, z }; }
    }
  }
  return best;
}

export function createSandKart({ scene, states, heightAt, pushOut = () => null, onError = console.warn }) {
  const root = new THREE.Group();
  root.name = 'Sand sail kart';
  scene.add(root);
  let model = null, pivot = null, grips = [], seat = null, wheels = [];
  const radii = new Map();

  new GLTFLoader().load(`${import.meta.env.BASE_URL}${KART.url}`, gltf => {
    model = gltf.scene;
    model.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = false; } });
    root.add(model);
    pivot = model.getObjectByName('Sail_Rig_Pivot');
    grips = ['Grip_Left', 'Grip_Right'].map(n => model.getObjectByName(n));
    seat = model.getObjectByName('Seat_Anchor');
    wheels = ['Wheel_Front', 'Wheel_Rear_L', 'Wheel_Rear_R'].map(n => model.getObjectByName(n)).filter(Boolean);
    for (const w of wheels) radii.set(w, Math.max(0.2, w.position.y));          // a wheel's hub sits its radius above the ground
    if (!pivot || grips.some(g => !g) || !seat) onError('[Sand kart] markers missing; it will not drive');
  }, undefined, error => onError(`[Sand kart] ${error?.message || error}`));

  // where it is: x, z on the ground, heading (radians about +Y; forward is (sin, cos))
  const state = { ...flattestSpot(heightAt), heading: KART.spawn.yaw, speed: 0, rigYaw: 0, rigLean: 0, wheelTurn: 0 };
  let riding = false, desktopHeld = false, desktopSteer = 0, rumbleIn = 0;
  const holders = new Map();          // hand state -> { grip (0 left, 1 right), ref (the hand's angle when steering began, null until seated) }
  // dev only: put it somewhere, hold the handle and steer without a headset (for screenshots)
  const debug = {
    forced: false, steerFixed: null,
    place(x, z, heading) { state.x = x; state.z = z; state.heading = heading; settle(); },
    hold(v = true) { desktopHeld = v; debug.forced = true; },
    steer(v) { debug.steerFixed = v; },
    flight() { return { airborne, vy }; },
    eye(target) { return target.copy(eyeLocal).applyMatrix4(root.matrixWorld); },
    // the lowest wheel's height above the sand (negative: sunk in)
    clearance() { return Math.min(...WHEEL_FEET.map(([lx, lz]) => { const p = new THREE.Vector3(lx, 0, lz).applyMatrix4(root.matrixWorld); return p.y - heightAt(p.x, p.z); })); },
  };
  const gripDown = new Map();
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), hand = new THREE.Vector3();
  const qYaw = new THREE.Quaternion(), qLean = new THREE.Quaternion(), qTilt = new THREE.Quaternion();
  const mat = new THREE.Matrix4(), mat2 = new THREE.Matrix4(), scl = new THREE.Vector3();
  const eyeLocal = new THREE.Vector3(), headInRig = new THREE.Vector3(), viewTilt = new THREE.Quaternion(), tiltWant = new THREE.Quaternion(), qHeading = new THREE.Quaternion();
  let vy = 0, lastGround = null, airborne = false;
  const kartTilt = new THREE.Quaternion();

  // The kart's place on the ground: height from its three wheels, tilted to lie on them; eased toward it over `dt` (0: at once).
  function settle(dt = 0) {
    const s = Math.sin(state.heading), c = Math.cos(state.heading);
    const at = (lx, lz) => { const x = state.x + lx * c + lz * s, z = state.z - lx * s + lz * c; return new THREE.Vector3(x, heightAt(x, z), z); };
    const front = at(0, 1.28), left = at(0.99, -0.74), right = at(-0.99, -0.74);
    const rear = left.clone().add(right).multiplyScalar(0.5);
    const normal = tmp.copy(right).sub(left).cross(tmp2.copy(front).sub(left)).normalize();
    if (normal.y < 0) normal.negate();
    const ground = (front.y + rear.y * 2) / 3;
    qTilt.setFromUnitVectors(up, normal);
    let y = ground;
    if (dt > 0) {
      // on the sand it rises and falls with it (so it carries that climb rate); where the sand drops away faster than gravity can pull it down, it flies
      vy -= KART.gravity * dt;
      y = root.position.y + vy * dt;
      if (y <= ground) {
        const rate = lastGround === null ? 0 : (ground - lastGround) / dt;
        vy = Math.max(-15, Math.min(15, rate));
        y = ground;
        airborne = false;
      } else airborne = true;
    } else vy = 0;
    lastGround = ground;
    root.position.set(state.x, y, state.z);
    // the tilt eases toward the ground's (slowly in the air, so it holds its attitude over a jump); the heading is always exactly the steering's
    if (dt > 0) kartTilt.slerp(qTilt, 1 - Math.exp(-dt * (airborne ? KART.airTilt : KART.settle))); else kartTilt.copy(qTilt);
    root.quaternion.copy(kartTilt).multiply(qHeading.setFromAxisAngle(up, state.heading));
    // the easing lags the ground on a climb at speed: never let a wheel sink into it (lift the kart until all three are on or above the sand)
    root.updateMatrixWorld(true);
    let sink = 0;
    for (const [lx, lz] of WHEEL_FEET) {
      tmp.set(lx, 0, lz).applyMatrix4(root.matrixWorld);
      sink = Math.max(sink, heightAt(tmp.x, tmp.z) - tmp.y);
    }
    if (sink > 0) { root.position.y += sink; vy = Math.max(vy, 0); airborne = false; root.updateMatrixWorld(true); }
  }
  settle();

  function gripWorld(i, target) { grips[i].updateWorldMatrix(true, false); return grips[i].getWorldPosition(target); }
  function handWorld(s, target) { s.objectGrip.updateWorldMatrix(true, false); return s.objectGrip.getWorldPosition(target); }
  // the controller itself (the real hand): steering reads this, since the drawn hand is locked onto the grip while held
  function controllerWorld(s, target) { s.grip.updateWorldMatrix(true, false); return s.grip.getWorldPosition(target); }

  // ---- the drawn hand locked onto a grip: the hand model is moved so its grip socket (the palm, fingers wrapping a bar along the socket's Y) sits on the
  // grip point, turned only as much as it takes to lay that bar along the handle (so the wrist keeps its own roll), and closed to a medium bar grip.
  const homes = new Map();             // hand state -> the hand model's own offset on the controller, to put back on release
  const anchorWorld = new THREE.Matrix4(), socketWorld = new THREE.Matrix4(), socketInAnchor = new THREE.Matrix4();
  const sPos = new THREE.Vector3(), sQuat = new THREE.Quaternion(), barNow = new THREE.Vector3(), barWant = new THREE.Vector3(), qAlign = new THREE.Quaternion();
  function lockHand(s, gripIndex) {
    const anchor = s.handAnchor, socket = s.gripSocket;
    if (!anchor || !socket) return;
    if (!homes.has(s)) {
      homes.set(s, { position: anchor.position.clone(), quaternion: anchor.quaternion.clone() });
      setHeldGripProfile(s, GRIP_PROFILE.LARGE);
      // an invisible bar the size of the rubber grip in the hand, so the fingers close until they touch it (as round any held tool's handle)
      if (s.objectGrip.children.length === 0) attachHeldObject(s, gripBar());
    }
    const home = homes.get(s);
    anchor.position.copy(home.position); anchor.quaternion.copy(home.quaternion);    // start from where the hand really is
    anchor.updateMatrixWorld(true);
    anchorWorld.copy(anchor.matrixWorld);
    socketWorld.copy(socket.matrixWorld);
    socketInAnchor.copy(anchorWorld).invert().multiply(socketWorld);
    socketWorld.decompose(sPos, sQuat, scl);
    const g = grips[gripIndex];
    g.updateWorldMatrix(true, false);
    barNow.set(0, 1, 0).applyQuaternion(sQuat);
    barWant.set(0, 0, 1).transformDirection(g.matrixWorld);                         // the handle's axis (+Z on the grip markers)
    if (barWant.dot(barNow) < 0) barWant.negate();                                  // whichever way round needs the smaller turn
    qAlign.setFromUnitVectors(barNow, barWant);
    sQuat.premultiply(qAlign);
    g.getWorldPosition(sPos);
    mat.compose(sPos, sQuat, scl);                                                  // where the socket should be
    mat2.copy(mat).multiply(socketInAnchor.invert());                               // so the hand model goes here
    mat.copy(anchor.parent.matrixWorld).invert().multiply(mat2);                    // in the controller's space
    mat.decompose(anchor.position, anchor.quaternion, scl);
    anchor.updateMatrixWorld(true);
  }
  function gripBar() {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(KART.grip.radius, KART.grip.radius, KART.grip.length, 12),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    bar.name = 'Kart grip bar';
    bar.userData.kartGrip = true;
    setGripSurface(bar, { axis: [0, 1, 0], point: [0, 0, 0], halfLength: KART.grip.length / 2 });
    return bar;
  }
  function unlockHand(s) {
    const home = homes.get(s);
    if (!home) return;
    if (s.handAnchor) { s.handAnchor.position.copy(home.position); s.handAnchor.quaternion.copy(home.quaternion); }
    for (const child of [...s.objectGrip.children]) if (child.userData.kartGrip) s.objectGrip.remove(child);
    clearHeldGripProfile(s);
    homes.delete(s);
  }

  // The rig yaw from the hands: the handle swings about the pivot's +Y axis, so a hand's angle round the pivot is the yaw. It is taken RELATIVE to where the
  // hand was when you sat down (sitting moves and turns you, so the hand rarely ends up exactly on the grip), plus the rig's yaw at that moment.
  function yawFromHands() {
    if (!holders.size) return null;
    let sum = 0;
    for (const [s, held] of holders) {
      root.worldToLocal(controllerWorld(s, hand));
      const g = grips[held.grip].position;         // the grip in the pivot's frame at rest
      const dx = hand.x - pivot.position.x, dz = hand.z - pivot.position.z;
      // rotation about +Y by a carries (x, z) to (x cos a + z sin a, -x sin a + z cos a): the angle from g to d
      const angle = Math.atan2(g.z * dx - g.x * dz, g.x * dx + g.z * dz);
      if (held.ref === null) held.ref = angle - state.rigYaw;
      let a = angle - held.ref;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      sum += a;
    }
    return sum / holders.size;
  }

  function seatWorld(target) { seat.updateWorldMatrix(true, false); return seat.getWorldPosition(target); }

  // ---- the player: seated, the rig carried with the kart
  function mount(rig, head) {
    riding = true;
    // where the head sits in the rig (the player's own height and lean), read before the rig is moved
    rig.updateMatrixWorld(true);
    headInRig.set(head.x, head.y, head.z);
    rig.worldToLocal(headInRig);
    // face the kart's forward (the rig looks down -Z), turning about the rig's origin, so the head's offset from it turns too
    const turn = state.heading + Math.PI - rig.rotation.y, c = Math.cos(turn), s = Math.sin(turn);
    const ox = head.x - rig.position.x, oz = head.z - rig.position.z;
    rig.rotation.y += turn;
    const hx = rig.position.x + ox * c + oz * s, hz = rig.position.z - ox * s + oz * c;
    seatWorld(tmp);
    rig.position.x += tmp.x - hx; rig.position.z += tmp.z - hz;
    rig.position.y = root.position.y - KART.seatDrop;
    head.x = tmp.x; head.z = tmp.z;
    // from now on the rig rides in the kart's frame (so it climbs, dips and rolls with it)
    // the eye is pinned above the seat (in the kart's frame) from now on; where the head sits in the rig now is kept, so leaning still moves the view
    root.worldToLocal(seatWorld(eyeLocal)).add(tmp2.set(0, KART.eyeAboveSeat, 0));
    viewTilt.identity();
  }
  function dismount(rig, head) {
    riding = false;
    rig.rotation.set(0, state.heading + Math.PI, 0);                                  // stand upright again, facing the way the kart points
    const s = Math.sin(state.heading), c = Math.cos(state.heading);
    const tx = state.x + c * KART.stepOff, tz = state.z - s * KART.stepOff;     // out to the kart's +X side
    rig.position.x += tx - head.x; rig.position.z += tz - head.z;
    return { x: tx, z: tz };
  }

  // input: { desktopToggle (edge), desktopSteer (-1..1, + is right) }; rig and head (x, y, z) so it can seat you and carry you.
  // Returns { riding, stepOff: { x, z } | null } for the caller's own ground following.
  function update(dt, { rig, head, desktopToggle = false, desktopSteer: steerIn = 0, presenting = false }) {
    if (!model || !pivot) return { riding: false, stepOff: null };
    // ---- hands take and leave the handle
    for (const s of states) {
      const squeeze = Boolean(s.inputSource?.gamepad?.buttons?.[GRIP_BUTTON]?.pressed);
      const was = gripDown.get(s) ?? false;
      if (holders.has(s) && (!squeeze || !s.inputSource)) { holders.delete(s); unlockHand(s); }
      else if (squeeze && !was && s.inputSource && s.objectGrip.children.length === 0) {
        handWorld(s, hand);
        let best = -1, bestD = KART.grabRadius;
        for (let i = 0; i < grips.length; i++) { const d = gripWorld(i, tmp).distanceTo(hand); if (d < bestD) { bestD = d; best = i; } }
        if (best >= 0) { holders.set(s, { grip: best, ref: null }); pulseHaptics(s, 0.35, 40); }
      }
      gripDown.set(s, squeeze);
    }
    if (!presenting && desktopToggle) {
      const near = Math.hypot(head.x - state.x, head.z - state.z) < KART.desktopReach;
      if (desktopHeld) desktopHeld = false; else if (near || riding) desktopHeld = true;
    }
    desktopSteer = debug.steerFixed ?? steerIn;
    const holding = holders.size > 0 || desktopHeld;
    if (holding && !riding) mount(rig, head);

    // ---- the handle: hands set the rig's yaw (or A/D on a desktop); it eases back to centre when let go
    const fromHands = riding ? yawFromHands() : null;
    const want = fromHands !== null ? fromHands : desktopHeld ? -desktopSteer * KART.yawLimit : 0;
    const target = Math.max(-KART.yawLimit, Math.min(KART.yawLimit, want));
    state.rigYaw += (target - state.rigYaw) * (1 - Math.exp(-dt * KART.steerResponse));

    // ---- driving: get going while held, coast down once let go; turn by the rig's yaw, more the faster it goes
    if (holding) state.speed = Math.min(KART.cruise, state.speed + KART.accel * dt);
    else state.speed = Math.max(0, state.speed - KART.coast * dt);
    const turnRate = KART.turn * (state.rigYaw / KART.yawLimit) * Math.min(1, state.speed / KART.cruise) * (state.speed > 0.05 ? 1 : 0);
    state.heading += turnRate * dt;
    state.x += Math.sin(state.heading) * state.speed * dt;
    state.z += Math.cos(state.heading) * state.speed * dt;
    const clear = pushOut(state.x, state.z);                         // a rock stops it dead
    if (clear) { state.x = clear[0]; state.z = clear[1]; state.speed = 0; }
    settle(dt);

    // the sail heels into the turn, the wheels roll
    state.rigLean += (-(state.rigYaw / KART.yawLimit) * KART.leanLimit * Math.min(1, state.speed / KART.cruise) - state.rigLean) * (1 - Math.exp(-dt * 3));
    qYaw.setFromAxisAngle(up, state.rigYaw);
    qLean.setFromAxisAngle(tmp.set(0, 0, 1), state.rigLean);
    pivot.quaternion.copy(qYaw).multiply(qLean);
    for (const w of wheels) w.rotation.x += state.speed * dt / radii.get(w);

    // ---- the rider is carried: moved and turned with the kart about its middle
    let stepOff = null;
    if (riding) {
      // the view: the kart's heading exactly, a smoothed share of its pitch and roll
      qHeading.setFromAxisAngle(up, state.heading);
      tiltWant.slerpQuaternions(qAlign.identity(), kartTilt, KART.viewTilt);          // a share of the kart's tilt
      viewTilt.slerp(tiltWant, 1 - Math.exp(-dt * KART.viewResponse));
      rig.quaternion.copy(viewTilt).multiply(qHeading.setFromAxisAngle(up, state.heading + Math.PI));
      // and the rig placed so the head (where it sat in the rig when you got in) lands on the eye point above the seat
      tmp.copy(eyeLocal).applyMatrix4(root.matrixWorld);
      rig.position.copy(tmp).sub(tmp2.copy(headInRig).applyQuaternion(rig.quaternion));
      rig.updateMatrixWorld(true);
      for (const [h, held] of holders) lockHand(h, held.grip);
      rumbleIn -= dt;
      if (rumbleIn <= 0 && state.speed > 1) {
        rumbleIn = KART.rumble.every;
        for (const h of holders.keys()) pulseHaptics(h, KART.rumble.strength + KART.rumble.perSpeed * state.speed, 30);
      }
      if (!holding && state.speed < KART.stopped) stepOff = dismount(rig, head);
    }
    return { riding, stepOff };
  }

  // The floor height for the rig while seated (the caller adds its own seated calibration).
  function rigFloorY() { return root.position.y - KART.seatDrop; }

  return {
    root, update, rigFloorY, state,
    get riding() { return riding; },
    get ready() { return Boolean(model && pivot); },
    // dev only: put it somewhere and set it going, for a screenshot
    debug,
  };
}
