import * as THREE from 'three';

// How fast a hand is moving and turning, from its last few frames, so that letting go of something while swinging throws it.
// One short ring of samples per hand, allocated once; nothing is created per frame.

export const HAND_MOTION = Object.freeze({
  window: 0.1, // seconds of history the speed is measured over
  samples: 12,
  maxGap: 0.25, // a longer pause between samples (tracking lost, the app paused) starts the history again
  maxSpeed: 16, // m/s
  maxSpin: 22, // rad/s
});

const position = new THREE.Vector3();
const rotation = new THREE.Quaternion();
const older = new THREE.Quaternion();
const delta = new THREE.Quaternion();

function newTrack() {
  const n = HAND_MOTION.samples;
  return {
    time: new Float64Array(n), px: new Float64Array(n), py: new Float64Array(n), pz: new Float64Array(n),
    qx: new Float64Array(n), qy: new Float64Array(n), qz: new Float64Array(n), qw: new Float64Array(n),
    count: 0, head: 0, clock: 0,
  };
}

export function createHandMotion() {
  const tracks = new WeakMap();
  const trackOf = key => {
    let track = tracks.get(key);
    if (!track) { track = newTrack(); tracks.set(key, track); }
    return track;
  };

  // Call once a frame with the object that follows the hand (its world matrix must be current) and the frame time.
  function record(key, object, dt) {
    const t = trackOf(key);
    const last = t.count > 0 ? (t.head + HAND_MOTION.samples - 1) % HAND_MOTION.samples : -1;
    if (dt > HAND_MOTION.maxGap) t.count = 0;
    t.clock += dt;
    object.matrixWorld.decompose(position, rotation, scratchScale);
    const i = t.head;
    t.time[i] = t.clock;
    t.px[i] = position.x; t.py[i] = position.y; t.pz[i] = position.z;
    t.qx[i] = rotation.x; t.qy[i] = rotation.y; t.qz[i] = rotation.z; t.qw[i] = rotation.w;
    t.head = (i + 1) % HAND_MOTION.samples;
    t.count = Math.min(t.count + 1, HAND_MOTION.samples);
    return last;
  }

  // Fills velocity (m/s) and spin (rad/s, world axes); returns false when there is not enough history yet (both are zeroed).
  function measure(key, velocity, spin) {
    velocity.set(0, 0, 0);
    spin.set(0, 0, 0);
    const t = tracks.get(key);
    if (!t || t.count < 2) return false;
    const n = HAND_MOTION.samples;
    const newest = (t.head + n - 1) % n;
    let oldest = newest;
    for (let k = 1; k < t.count; k++) {
      const j = (newest - k + n) % n;
      if (t.time[newest] - t.time[j] > HAND_MOTION.window) break;
      oldest = j;
    }
    const span = t.time[newest] - t.time[oldest];
    if (oldest === newest || span < 1e-3) return false;
    velocity.set(t.px[newest] - t.px[oldest], t.py[newest] - t.py[oldest], t.pz[newest] - t.pz[oldest]).divideScalar(span);
    velocity.clampLength(0, HAND_MOTION.maxSpeed);
    older.set(t.qx[oldest], t.qy[oldest], t.qz[oldest], t.qw[oldest]);
    delta.set(t.qx[newest], t.qy[newest], t.qz[newest], t.qw[newest]).multiply(older.invert());
    if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
    const angle = 2 * Math.acos(Math.min(1, delta.w));
    const s = Math.sqrt(Math.max(0, 1 - delta.w * delta.w));
    if (s > 1e-6) spin.set(delta.x / s, delta.y / s, delta.z / s).multiplyScalar(angle / span);
    spin.clampLength(0, HAND_MOTION.maxSpin);
    return true;
  }

  return { record, measure };
}

const scratchScale = new THREE.Vector3();
