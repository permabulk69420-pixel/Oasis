import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getInventoryCount } from './inventory.js';
import { pulseHaptics } from './haptics.js';
import { createHandleHold, measureHandleRadius } from './handle-hold.js';

// The glider (the owner's model, public/models/glider/oasis_glider.glb), from the owner's note on 6 Oct: while it is in the inventory, raise both hands
// above your head and squeeze both grips and it appears over you and works. Let go with both hands and it folds back into the inventory.
// It sits on your hands: its bar runs from the left hand to the right and both hands lock onto its grips (src/handle-hold.js, as on the sand kart). It flies once there is more than a metre of air under your feet: walk off the island's edge or a cliff with it open, or open it while you
// fall and it catches you. Steering: lower one hand to bank and turn that way; push the bar out (away from you) to slow and float, pull it in to dive
// faster. The bar's reach when you opened it is the rest position. You touch down without harm. Desktop: G opens or closes it, A and D bank, W and S pitch.
// The model's markers: grip_left / grip_right (the hand sockets, 0.64 m apart, the bar along +X), its origin midway between them, forward -Z, up +Y.
// The bar's rubber grips are 3.8 cm across and run from 0.2 m to 0.44 m out from the middle.

const GRIP_BUTTON = 1;
export const GLIDER = Object.freeze({
  url: 'models/glider/oasis_glider.glb',
  aboveHead: 0.05,            // metres: both hands must be at least this far above the eyes to open it
  takeOff: 1.2,               // metres of air under your feet before it flies
  cruise: 14,                 // m/s with the bar at rest
  slow: 10, fast: 20,         // m/s with the bar pushed fully out / pulled fully in
  sink: 1.6,                  // m/s down at rest; more pulled in and in a bank
  diveSink: 3.6,
  bankSink: 0.8,
  maxBank: 35 * Math.PI / 180,
  bankDead: 3 * Math.PI / 180,  // hands this close to level fly straight
  speedResponse: 0.8, sinkResponse: 1.5,
  barReach: 0.22,             // metres the bar moves out or in from where you opened it, for full pitch
  pitchShow: 0.25,            // radians the glider's nose lifts at full push (it dips as much pulled in)
  grip: Object.freeze({ halfLength: 0.06 }),  // metres either side of a grip marker the hand may sit (inside the rubber, between its rings)
  desktop: Object.freeze({ above: 0.45, ahead: 0.25, bank: 30 * Math.PI / 180 }),
  stow: Object.freeze({ strength: 0.3, ms: 40 }),
});

export function createGlider({ scene, states, onError = console.warn }) {
  const root = new THREE.Group();
  root.name = 'Glider';
  root.visible = false;
  scene.add(root);
  let model = null;
  const grips = { left: null, right: null };
  new GLTFLoader().load(`${import.meta.env.BASE_URL}${GLIDER.url}`, gltf => {
    model = gltf.scene;
    model.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = false; o.frustumCulled = false; } });
    root.add(model);
    grips.left = model.getObjectByName('grip_left');
    grips.right = model.getObjectByName('grip_right');
    if (!grips.left || !grips.right) onError('[Glider] grip markers missing');
  }, undefined, error => onError(`[Glider] ${error?.message || error}`));

  let deployed = false, flying = false;
  let speed = 0, vy = 0, feetY = 0, bank = 0, pull = 0, reach0 = 0.1;
  const left = new THREE.Vector3(), right = new THREE.Vector3(), mid = new THREE.Vector3(), xAxis = new THREE.Vector3(), fwd = new THREE.Vector3();
  const nose = new THREE.Vector3(), back = new THREE.Vector3(), upv = new THREE.Vector3(), tmp = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const sideOf = s => s.handedness === 'left' ? 'left' : s.handedness === 'right' ? 'right' : null;
  const hand = side => states.find(s => sideOf(s) === side && s.inputSource);
  const squeezing = s => Boolean(s?.inputSource?.gamepad?.buttons?.[GRIP_BUTTON]?.pressed);

  // ---- the hands on the grips: src/handle-hold.js puts the hollow of each closed hand on its grip's axis (as on the sand kart and every handle)
  const hold = createHandleHold();
  const handles = {};
  function handleFor(side) {
    if (!handles[side]) {
      const node = grips[side];
      handles[side] = { node, axis: [1, 0, 0], halfLength: GLIDER.grip.halfLength, radius: measureHandleRadius(model, node, [1, 0, 0], GLIDER.grip.halfLength) };
    }
    return handles[side];
  }
  // where the hand's grip socket really is (the controller's pose, before the hold moves the hand model)
  const socketAt = (s, target) => hold.realSocket(s, target);

  function open(presenting, head, rig) {
    deployed = true; flying = false;
    root.visible = true;
    bank = 0; pull = 0;
    if (presenting) {
      const l = hand('left'), r = hand('right');
      const yaw = rig.rotation.y;
      fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      mid.copy(socketAt(l, left)).add(socketAt(r, right)).multiplyScalar(0.5);
      reach0 = THREE.MathUtils.clamp(tmp.copy(mid).sub(head).dot(fwd), -0.1, 0.35);
      for (const s of [l, r]) pulseHaptics(s, GLIDER.stow.strength, GLIDER.stow.ms);
    }
  }
  function close() {
    if (!deployed) return;
    deployed = false; flying = false;
    root.visible = false;
    hold.releaseAll();
    for (const s of states) if (s.inputSource) pulseHaptics(s, GLIDER.stow.strength * 0.6, GLIDER.stow.ms);
  }

  // The glider over the hands: its bar from the left hand to the right, its nose the way you face (square to the bar), lifted by how far the bar is
  // pushed out. Reads the bank and the push from the hands in VR.
  function pose(rig, head, presenting) {
    const yaw = rig.rotation.y;
    fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    if (presenting) {
      const l = hand('left'), r = hand('right');
      if (!l || !r) return;
      socketAt(l, left); socketAt(r, right);
      mid.copy(left).add(right).multiplyScalar(0.5);
      xAxis.copy(right).sub(left);
      const span = Math.max(xAxis.length(), 0.2);
      xAxis.normalize();
      const tilt = Math.asin(THREE.MathUtils.clamp((left.y - right.y) / span, -1, 1));   // + left hand higher: bank right
      const beyond = Math.max(0, Math.abs(tilt) - GLIDER.bankDead) * Math.sign(tilt);
      bank = THREE.MathUtils.clamp(beyond, -GLIDER.maxBank, GLIDER.maxBank);
      const reach = tmp.copy(mid).sub(head).dot(fwd);
      pull = THREE.MathUtils.clamp((reach - reach0) / GLIDER.barReach, -1, 1);       // + pushed out (slow), - pulled in (dive)
    } else {
      mid.copy(head).addScaledVector(fwd, GLIDER.desktop.ahead); mid.y += GLIDER.desktop.above;
      xAxis.set(Math.cos(yaw), 0, -Math.sin(yaw)).applyAxisAngle(fwd, bank);
    }
    nose.copy(fwd).addScaledVector(xAxis, -fwd.dot(xAxis));
    if (nose.lengthSq() < 1e-6) nose.set(0, 0, -1);
    nose.normalize().applyAxisAngle(xAxis, pull * GLIDER.pitchShow);
    back.copy(nose).negate();
    upv.crossVectors(back, xAxis).normalize();                                        // Y = Z x X
    basis.makeBasis(xAxis, upv, back);
    root.quaternion.setFromRotationMatrix(basis);
    root.position.copy(mid);
    root.updateMatrixWorld(true);
    if (presenting) {
      for (const side of ['left', 'right']) {
        const s = hand(side);
        if (squeezing(s) && hold.grab(s, handleFor(side))) hold.place(s); else hold.release(s);
      }
    }
  }

  // input:
  //   rig, head (the eyes' world position; x and z are moved with the flight), presenting
  //   groundAt(x, z, y): the ground under (x, z) for feet at height y (so the island counts only when you are above it)
  //   groundY: the feet's base height now; rigOffset: the rig's height over the feet (seated and crouch offsets)
  //   fallSpeed (m/s down, if falling), velocity (the walk, for the speed at take-off), bounds { minX, maxX, minZ, maxZ }
  //   desktop { toggle, bank (-1..1, + right), pitch (-1..1, + push out) }, blocked (riding the kart, or not playing)
  // Returns { flying, feetY, landed (true on the step you touch down) }. While flying it places the rig itself.
  function update(dt, { rig, head, presenting, groundAt, groundY, rigOffset = 0, fallSpeed = 0, velocity = null, bounds = null, desktop = {}, blocked = false }) {
    let landed = false;
    if (!model) return { flying: false, feetY: groundY, landed };
    const have = getInventoryCount('glider') > 0;
    // ---- opening and closing
    if (presenting) {
      const l = hand('left'), r = hand('right');
      if (!deployed) {
        const free = l && r && !l.objectGrip.children.length && !r.objectGrip.children.length;
        if (free && have && !blocked && squeezing(l) && squeezing(r)
          && socketAt(l, left).y > head.y + GLIDER.aboveHead && socketAt(r, right).y > head.y + GLIDER.aboveHead) open(true, head, rig);
      } else if (!l || !r || (!squeezing(l) && !squeezing(r))) close();
    } else if (desktop.toggle) {
      if (deployed) close(); else if (have && !blocked) open(false, head, rig);
    }
    if (deployed && (!have || blocked)) close();
    if (!deployed) return { flying: false, feetY: groundY, landed };
    if (!presenting) {
      bank += ((desktop.bank ?? 0) * GLIDER.desktop.bank - bank) * (1 - Math.exp(-dt * 3));
      pull += ((desktop.pitch ?? 0) - pull) * (1 - Math.exp(-dt * 3));
    }

    // ---- taking off: enough air under the feet (or already falling with it open)
    if (!flying && groundY - groundAt(head.x, head.z, groundY) > GLIDER.takeOff) {
      flying = true;
      feetY = groundY;
      speed = Math.max(GLIDER.slow, velocity ? Math.hypot(velocity.x, velocity.z) : 0);
      vy = -fallSpeed;
    }
    if (flying) {
      const target = pull >= 0 ? GLIDER.cruise + (GLIDER.slow - GLIDER.cruise) * pull : GLIDER.cruise + (GLIDER.fast - GLIDER.cruise) * -pull;
      const sink = GLIDER.sink + (GLIDER.diveSink - GLIDER.sink) * Math.max(0, -pull) + GLIDER.bankSink * Math.abs(bank) / GLIDER.maxBank;
      speed += (target - speed) * (1 - Math.exp(-dt * GLIDER.speedResponse));
      vy += (-sink - vy) * (1 - Math.exp(-dt * GLIDER.sinkResponse));
      // a banked turn (rate g tan(bank) / speed): the rig turns about the head, as the smooth turn does
      const turn = -9.8 * Math.tan(bank) / Math.max(speed, 4) * dt;
      const ox = rig.position.x - head.x, oz = rig.position.z - head.z, c = Math.cos(turn), s = Math.sin(turn);
      rig.position.x = head.x + ox * c + oz * s; rig.position.z = head.z - ox * s + oz * c;
      rig.rotation.y += turn;
      const yaw = rig.rotation.y;
      let nx = head.x - Math.sin(yaw) * speed * dt, nz = head.z - Math.cos(yaw) * speed * dt;
      if (bounds) { nx = THREE.MathUtils.clamp(nx, bounds.minX, bounds.maxX); nz = THREE.MathUtils.clamp(nz, bounds.minZ, bounds.maxZ); }
      rig.position.x += nx - head.x; rig.position.z += nz - head.z; head.x = nx; head.z = nz;
      feetY += vy * dt;
      const below = groundAt(head.x, head.z, feetY - vy * dt);
      if (feetY <= below) { feetY = below; flying = false; landed = true; speed = 0; vy = 0; }
      const lift = feetY + rigOffset - rig.position.y;
      rig.position.y += lift; head.y += lift;
    }
    rig.updateMatrixWorld(true);
    pose(rig, head, presenting);
    return { flying, feetY: flying || landed ? feetY : groundY, landed };
  }

  return {
    root, update, close,
    get deployed() { return deployed; },
    get flying() { return flying; },
    get state() { return { deployed, flying, speed, vy, feetY, bank, pull, reach0 }; },
  };
}
