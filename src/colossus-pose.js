import * as THREE from 'three';
import { GAIT, ankleTarget, footFrame } from './colossus-gait.js';

// Poses Colossus 01's bones. The model has no animation in it: this reads the skeleton as the file rests (every bone but a few has a rotated rest
// frame, so nothing here assumes a bone's axes) and turns the planner's numbers (src/colossus-gait.js) into rotations.
//
// How:
// - A body bone is turned by an amount (pitch, yaw, roll) about the MODEL's axes (x to the left, y up, z ahead), whatever its own frame is: the model axis
//   is carried into the bone's rest frame once, at load (`axes`).
// - A leg is solved in the world: its hip is where the pelvis or shoulder put it, its ankle is where the planner says, and a two bone solver finds the knee
//   (the knee always bends forward and a little out). The thigh and shin are then turned to point along the solution. Each keeps its rest roll, as far as the
//   bend allows (its own rest frame is re-aimed, with the pole as the second direction), so the leg does not twist. The foot is laid on the ground at the
//   heading and pitch the planner gives, and the toe curls about the model's x axis.
// - The body rides at the height its legs allow: the hips are lifted off the lowest height at which no leg is over-stretched, minus a little knee bend.
//
// Every bone is set every frame it is posed (the file's own rest values are kept as the base), nothing is allocated, and only the level on show is posed.

export const COLOSSUS_BONES = Object.freeze({
  pelvis: 'pelvis',
  spine: Object.freeze(['spine_01', 'spine_02', 'spine_03', 'spine_04']),
  neck: Object.freeze(['neck_01', 'neck_02', 'neck_03', 'neck_04', 'neck_05', 'neck_06', 'head']),
  jaw: 'jaw',
  tail: Object.freeze(['tail_01', 'tail_02', 'tail_03', 'tail_04', 'tail_05', 'tail_06', 'tail_07', 'tail_08']),
  legs: Object.freeze({
    FL: Object.freeze(['leg_FL_upper', 'leg_FL_lower', 'leg_FL_foot', 'leg_FL_toe']),
    FR: Object.freeze(['leg_FR_upper', 'leg_FR_lower', 'leg_FR_foot', 'leg_FR_toe']),
    BL: Object.freeze(['leg_BL_upper', 'leg_BL_lower', 'leg_BL_foot', 'leg_BL_toe']),
    BR: Object.freeze(['leg_BR_upper', 'leg_BR_lower', 'leg_BR_foot', 'leg_BR_toe']),
  }),
});

const DEG = Math.PI / 180;

export const JOINTS = Object.freeze({
  reach: 0.985, // the share of its length a leg may stretch to
  kneeBend: 0.4, // metres lower than the highest the legs allow, so they stay a little bent
  heaveOmega: 2.0, // how quickly the body's height follows what the legs allow
  poleOut: 0.25, // how much of the knee's direction is sideways (outwards), the rest is forward
  breathHeave: 0.08, // metres the body rises and falls as it breathes
  breathPitch: 0.0045, // radians the ribs and shoulders rock as it breathes, shared along the spine
  breathShare: Object.freeze([0.1, 0.25, 0.3, 0.35]),
  neckShare: Object.freeze([0.05, 0.08, 0.12, 0.16, 0.2, 0.22, 0.17]), // each neck bone and the head: its share of where the gaze points
  neckLevel: 0.6, // how much of the body's pitch the neck cancels, so the head stays level
  tailYaw: Object.freeze([1.3, 1.9, 2.9, 3.8, 4.8, 5.8, 6.7, 7.7].map(d => d * DEG)), // swing of each tail bone at a full walk
  tailPitch: 0.7 * DEG,
  tailLag: 0.5, // radians of wave phase between one tail bone and the next
  tailIdle: 0.3, // the share of the swing it keeps while it stands
  spineRoll: 0.0,
});

const TMP = {
  v1: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3(), v4: new THREE.Vector3(), v5: new THREE.Vector3(),
  q1: new THREE.Quaternion(), q2: new THREE.Quaternion(), q3: new THREE.Quaternion(), q4: new THREE.Quaternion(),
  m: new THREE.Matrix4(),
};
// frameQuat's own scratch, so it never overwrites what a caller is holding
const FQ = { e1: new THREE.Vector3(), e2: new THREE.Vector3(), e3: new THREE.Vector3(), m: new THREE.Matrix4() };
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

// A rotation that carries the frame (u, then the direction p made square to u) to the world axes' order: columns u, p', u x p'. If p is along u, any square direction will do.
function frameQuat(u, p, out) {
  const e1 = FQ.e1.copy(u).normalize();
  const e2 = FQ.e2.copy(p).addScaledVector(e1, -p.dot(e1));
  if (e2.lengthSq() < 1e-10) {
    e2.set(Math.abs(e1.y) < 0.9 ? 0 : 1, Math.abs(e1.y) < 0.9 ? 1 : 0, 0);
    e2.addScaledVector(e1, -e2.dot(e1));
  }
  e2.normalize();
  const e3 = FQ.e3.crossVectors(e1, e2);
  FQ.m.makeBasis(e1, e2, e3);
  return out.setFromRotationMatrix(FQ.m);
}

// The bone's rest state in the model's frame (the frame of the node that holds the skeleton)
function readRest(bone, base) {
  const chain = [];
  for (let o = bone; o && o !== base.parent; o = o.parent) chain.push(o);
  chain.reverse();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  for (const o of chain) {
    p.add(new THREE.Vector3().copy(o.position).applyQuaternion(q));
    q.multiply(o.quaternion);
  }
  const inv = q.clone().invert();
  return {
    bone, q0: bone.quaternion.clone(), p0: bone.position.clone(), qw0: q, pw0: p, qw0inv: inv,
    // the model's axes as seen from the bone's own frame
    ax: X.clone().applyQuaternion(inv), ay: Y.clone().applyQuaternion(inv), az: Z.clone().applyQuaternion(inv),
  };
}

// The bones of a loaded level, or null if the file is missing one. `root` is the object that holds the skeleton (the glTF's scene), `holder` the
// object the game moves and turns (its yaw is the way the animal faces; it must have no scale).
export function createColossusRig(root, holder) {
  const find = name => { const o = root.getObjectByName(name); return o && o.isBone ? o : null; };
  const names = [COLOSSUS_BONES.pelvis, ...COLOSSUS_BONES.spine, ...COLOSSUS_BONES.neck, COLOSSUS_BONES.jaw, ...COLOSSUS_BONES.tail, ...Object.values(COLOSSUS_BONES.legs).flat()];
  const rest = {};
  for (const name of names) {
    const bone = find(name);
    if (!bone) return null;
    rest[name] = readRest(bone, root);
  }

  const legs = {};
  for (const [leg, [upper, lower, foot, toe]] of Object.entries(COLOSSUS_BONES.legs)) {
    const U = rest[upper], L = rest[lower], F = rest[foot], T = rest[toe];
    const parent = U.bone.parent;
    const parentRest = readRest(parent, root);
    const side = U.pw0.x >= 0 ? 1 : -1;
    const pole0 = new THREE.Vector3(side * JOINTS.poleOut, 0, 1).normalize();
    const u0 = new THREE.Vector3().subVectors(L.pw0, U.pw0);
    const v0 = new THREE.Vector3().subVectors(F.pw0, L.pw0);
    const length1 = u0.length(), length2 = v0.length();
    const frameUpper = frameQuat(u0, pole0, new THREE.Quaternion()).invert();
    const frameLower = frameQuat(v0, pole0, new THREE.Quaternion()).invert();
    legs[leg] = {
      name: leg, U, L, F, T, parent, parentRest, side, pole0, length1, length2, frameUpper, frameLower,
      home: [F.pw0.x, F.pw0.z], ankle: F.pw0.y,
      hip: new THREE.Vector3(), pole: new THREE.Vector3(), parentQ: new THREE.Quaternion(), ankleWorld: [0, 0, 0],
      foot: { ankle: F.pw0.y, front: GAIT.foot.front, back: GAIT.foot.back },
      frame: { f: [0, 0, 1], n: [0, 1, 0], side: [1, 0, 0] },
      limit: 0,
    };
  }

  const heave = { x: 0, v: 0, primed: false };
  const info = { heave: 0, limit: 0 };
  const pelvis = rest[COLOSSUS_BONES.pelvis];
  const q = new THREE.Quaternion();

  // Sets a body bone to its rest turned by pitch (the forward end going down), yaw (towards the left) and roll (the left side up), about the model's axes.
  function turn(name, pitch, yaw, roll) {
    const r = rest[name];
    q.copy(r.q0);
    if (pitch) q.multiply(TMP.q1.setFromAxisAngle(r.ax, pitch));
    if (yaw) q.multiply(TMP.q1.setFromAxisAngle(r.ay, yaw));
    if (roll) q.multiply(TMP.q1.setFromAxisAngle(r.az, roll));
    r.bone.quaternion.copy(q);
  }

  // Poses everything. `m` is the body motion (src/colossus-gait.js createBodyMotion().out), `gait` the planner's output.
  function apply(m, gait, dt) {
    const J = JOINTS;
    const breath = m.breath;
    const mf = m.move;

    // ---- the body
    pelvis.bone.position.set(pelvis.p0.x + m.sway, pelvis.p0.y, pelvis.p0.z);
    turn(COLOSSUS_BONES.pelvis, m.pitchDown, 0, m.roll);
    for (let i = 0; i < 4; i++) turn(COLOSSUS_BONES.spine[i], breath * J.breathPitch * J.breathShare[i], m.spineBend / 4, 0);
    // the neck and head carry the gaze; they lean against the body's pitch so the head stays level
    const neckPitch = m.gazePitch + m.nod - J.neckLevel * m.pitchDown;
    for (let i = 0; i < 7; i++) turn(COLOSSUS_BONES.neck[i], neckPitch * J.neckShare[i], m.gazeYaw * J.neckShare[i], 0);
    turn(COLOSSUS_BONES.jaw, m.jaw, 0, 0);
    const swing = J.tailIdle + (1 - J.tailIdle) * mf;
    for (let i = 0; i < 8; i++) {
      const wave = Math.sin(m.tail - i * J.tailLag);
      turn(COLOSSUS_BONES.tail[i], J.tailPitch * Math.sin(2 * m.tail - i * 0.4) * swing, J.tailYaw[i] * wave * swing + m.tailBias / 8, 0);
    }
    holder.updateMatrixWorld(true);

    // ---- where each hip is, the foot each leg must reach, and how high that lets the body ride
    let lowest = Infinity;
    for (const name of ['BL', 'FL', 'BR', 'FR']) {
      const leg = legs[name];
      const g = gait.legs.find(l => l.name === name);
      leg.g = g;
      leg.hip.setFromMatrixPosition(leg.U.bone.matrixWorld);
      leg.parentQ.setFromRotationMatrix(leg.parent.matrixWorld);
      leg.pole.copy(leg.pole0).applyQuaternion(leg.parentRest.qw0inv).applyQuaternion(leg.parentQ);
      footFrame(g, leg.frame);
      ankleTarget(g, leg.frame, leg.ankleWorld, leg.foot);
      const reach = (leg.length1 + leg.length2) * J.reach;
      const dx = leg.ankleWorld[0] - leg.hip.x, dz = leg.ankleWorld[2] - leg.hip.z;
      const dh2 = dx * dx + dz * dz;
      // the highest the hip may be above this ankle: the leg is straight at that height
      leg.limit = leg.ankleWorld[1] - leg.hip.y + Math.sqrt(Math.max(reach * reach - dh2, 4));
      if (leg.limit < lowest) lowest = leg.limit;
    }
    const want = lowest - J.kneeBend + breath * J.breathHeave;
    if (!heave.primed) { heave.x = want; heave.v = 0; heave.primed = true; }
    // a critically damped spring on the height; never above what the legs allow
    const w = J.heaveOmega;
    const dtc = Math.min(Math.max(dt, 0), 0.1);
    const d = heave.x - want, e = Math.exp(-w * dtc), t = (heave.v + w * d) * dtc;
    heave.x = want + (d + t) * e;
    heave.v = (heave.v - w * t) * e;
    const rise = Math.min(heave.x, lowest);
    info.heave = rise;
    info.limit = lowest;
    pelvis.bone.position.y = pelvis.p0.y + rise;

    // ---- the legs
    for (const name of ['BL', 'FL', 'BR', 'FR']) {
      const leg = legs[name];
      const g = leg.g;
      const hip = TMP.v1.copy(leg.hip);
      hip.y += rise;
      const target = TMP.v2.set(leg.ankleWorld[0], leg.ankleWorld[1], leg.ankleWorld[2]);
      const d3 = TMP.v3.subVectors(target, hip);
      let D = d3.length();
      const l1 = leg.length1, l2 = leg.length2;
      const maxD = (l1 + l2) * 0.999, minD = Math.abs(l1 - l2) + 0.05;
      D = Math.min(Math.max(D, minD), maxD);
      d3.setLength(D);
      const a = (l1 * l1 - l2 * l2 + D * D) / (2 * D);
      const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
      // the knee: along the line from hip to ankle by a, then out of the line towards the pole by h
      const knee = TMP.v4.copy(hip).addScaledVector(d3, a / D);
      const pole = TMP.v5.copy(leg.pole).addScaledVector(d3, -leg.pole.dot(d3) / (D * D));
      if (pole.lengthSq() < 1e-8) pole.set(0, 0, 1);
      pole.normalize();
      knee.addScaledVector(pole, h);
      const ankle = TMP.v2.copy(hip).add(d3);
      // thigh: points hip to knee; q = the frame of that direction and the pole, over the frame it had at rest, times its rest orientation
      const dirUpper = TMP.v3.subVectors(knee, hip);
      frameQuat(dirUpper, leg.pole, TMP.q1).multiply(leg.frameUpper).multiply(leg.U.qw0);
      const upperWorld = TMP.q1;
      leg.U.bone.quaternion.copy(TMP.q2.copy(leg.parentQ).invert().multiply(upperWorld));
      const dirLower = TMP.v3.subVectors(ankle, knee);
      frameQuat(dirLower, leg.pole, TMP.q3).multiply(leg.frameLower).multiply(leg.L.qw0);
      const lowerWorld = TMP.q3;
      leg.L.bone.quaternion.copy(TMP.q2.copy(upperWorld).invert().multiply(lowerWorld));
      // foot: laid on the ground at the planner's heading and pitch (positive pitch is heel up)
      const f = leg.frame;
      const c = Math.cos(g.pitch), s = Math.sin(g.pitch);
      // the sole's frame: x across, y up, z forward, turned about x by the pitch
      const fy = TMP.v3.set(f.n[0] * c + f.f[0] * s, f.n[1] * c + f.f[1] * s, f.n[2] * c + f.f[2] * s);
      const fz = TMP.v4.set(f.f[0] * c - f.n[0] * s, f.f[1] * c - f.n[1] * s, f.f[2] * c - f.n[2] * s);
      const fx = TMP.v5.set(f.side[0], f.side[1], f.side[2]);
      TMP.m.makeBasis(fx, fy, fz);
      const footWorld = TMP.q4.setFromRotationMatrix(TMP.m).multiply(leg.F.qw0);
      leg.F.bone.quaternion.copy(TMP.q2.copy(lowerWorld).invert().multiply(footWorld));
      // toe: its rest, curled about the model's x axis
      leg.T.bone.quaternion.copy(leg.T.q0).multiply(TMP.q2.setFromAxisAngle(leg.T.ax, g.curl));
    }
    return info;
  }

  return { apply, rest, legs, info, root, holder };
}
