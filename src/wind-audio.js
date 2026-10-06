import { createLoop } from './audio.js';

// Wind rushing past while you move fast (the owner, 7 Oct): gliding and riding the sand kart. One loop (the owner's recording, made into a seamless
// 22 s loop at a sensible level by tools/audio/make_sounds.py), louder, brighter and a little higher the faster you go, silent at a walk.
export const WIND_AUDIO = Object.freeze({
  url: `${import.meta.env?.BASE_URL ?? '/'}audio/wind/wind_rush_loop.mp3`,
  from: 3, full: 22,              // m/s: no wind below `from`, full wind at `full`
  volume: 0.75,                   // at full speed
  rate: Object.freeze([0.85, 1.12]),
  cutoff: Object.freeze([450, 9000]),   // the low-pass filter's hertz, slow to fast
  response: 2.5,                  // how fast it follows (per second)
});

export function createWindAudio({ onError = console.warn } = {}) {
  const W = WIND_AUDIO;
  const loop = createLoop(W.url, { volume: 0, filter: true, onError });
  let level = 0;
  return {
    // speed: m/s through the air (0 when walking)
    update(dt, speed) {
      const want = Math.min(1, Math.max(0, (speed - W.from) / (W.full - W.from)));
      level += (want - level) * (1 - Math.exp(-dt * W.response));
      if (level < 0.003) { if (loop.playing) loop.pause(); return; }
      if (!loop.playing) loop.play();
      loop.setVolume(W.volume * Math.pow(level, 1.4));
      loop.setRate(W.rate[0] + (W.rate[1] - W.rate[0]) * level);
      loop.setFilter(W.cutoff[0] * Math.pow(W.cutoff[1] / W.cutoff[0], level));
    },
    get level() { return level; },
  };
}
