import { createPositionalClips } from './audio.js';

// Colossus 01's sounds (the owner, 7 Oct): its footfalls boom across the plain (synthesised: tools/audio/make_sounds.py), and the first time you come
// near it, it growls (the owner's recording). No animation goes with the growl yet. Both come from where they happen and arrive late from far off,
// as sound does, so you see the dust before you hear the step.
const BASE = import.meta.env?.BASE_URL ?? '/';
export const COLOSSUS_AUDIO = Object.freeze({
  steps: [1, 2, 3, 4].map(n => `${BASE}audio/colossus/colossus_step_0${n}.mp3`),
  growlUrl: `${BASE}audio/colossus/colossus_growl.mp3`,
  speedOfSound: 343,
  step: Object.freeze({ volume: 1.0, refDistance: 35, rolloff: 1.1, range: 1400 }),   // heard out to 1.4 km (faint by then)
  growl: Object.freeze({ volume: 1.0, refDistance: 60, rolloff: 1.0,
    near: 150,          // metres: come this close and it growls
    rearm: 320,         // go this far away and it will growl again next time
    cooldown: 90,       // seconds, at least, between growls
    ahead: 48, up: 38 }),  // where its head is from the middle of its body (metres forward, up)
});

export function createColossusAudio({ onError = console.warn } = {}) {
  const C = COLOSSUS_AUDIO;
  const steps = createPositionalClips(C.steps, { volume: C.step.volume, refDistance: C.step.refDistance, rolloff: C.step.rolloff, onError });
  const growl = createPositionalClips([C.growlUrl], { volume: C.growl.volume, refDistance: C.growl.refDistance, rolloff: C.growl.rolloff, onError });
  let armed = true, since = Infinity;
  const at = { x: 0, y: 0, z: 0 };

  return {
    // a foot came down (colossus onFootfall): { x, y, z, power, distance (from you, metres) }
    footfall(step, head) {
      const d = Math.hypot(head.x - step.x, head.y - step.y, head.z - step.z);
      if (d > C.step.range) return;
      steps.play(step, { gain: 0.55 + 0.45 * Math.min(1, step.power ?? 1), delay: d / C.speedOfSound, rate: 0.94 + Math.random() * 0.12 });
    },
    // every frame: the Colossus ({ x, z, yaw }, its ground height) and you
    update(dt, colossus, groundY, head) {
      since += dt;
      if (!colossus) return;
      const d = Math.hypot(head.x - colossus.x, head.z - colossus.z);
      if (d > C.growl.rearm) armed = true;
      if (armed && d < C.growl.near && since > C.growl.cooldown) {
        at.x = colossus.x + Math.sin(colossus.yaw) * C.growl.ahead;
        at.z = colossus.z + Math.cos(colossus.yaw) * C.growl.ahead;
        at.y = groundY + C.growl.up;
        if (growl.play(at, { delay: Math.hypot(head.x - at.x, head.y - at.y, head.z - at.z) / C.speedOfSound })) { armed = false; since = 0; }
      }
    },
  };
}
