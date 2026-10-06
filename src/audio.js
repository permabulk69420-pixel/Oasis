// One shared Web Audio context for loops and one-shots. Plain <audio> elements make Quest
// Browser show a media player (and treat the game like a music app); Web Audio does not.
// Without Web Audio (tests, old browsers) everything here quietly does nothing.

let context = null;
const bufferCache = new Map();

function getContext() {
  if (context) return context;
  const AudioContextClass = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AudioContextClass) return null;
  context = new AudioContextClass();
  return context;
}

// Browsers only let audio start from a player gesture, so any first interaction unlocks it.
export function unlockAudio() {
  const ctx = getContext();
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

if (typeof window !== 'undefined') {
  for (const type of ['pointerdown', 'click', 'touchend', 'keydown']) window.addEventListener(type, unlockAudio, { passive: true });
}

function loadBuffer(url, onError) {
  const ctx = getContext();
  if (!ctx) return Promise.resolve(null);
  if (!bufferCache.has(url)) {
    bufferCache.set(url, fetch(url)
      .then(response => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
        return response.arrayBuffer();
      })
      .then(data => ctx.decodeAudioData(data)));
  }
  return bufferCache.get(url).catch(error => {
    bufferCache.delete(url);
    onError?.(`[Oasis audio] Could not load ${url}: ${error?.message || error}`);
    return null;
  });
}

// A looping sound with play/stop. Safe to call play() repeatedly. `filter: true` puts a low-pass filter in its path (setFilter(hertz)), and
// setRate() changes its playback speed (and pitch): the wind uses both, rushing brighter and higher the faster you go.
export function createLoop(url, { volume = 1, filter = false, onError = console.warn } = {}) {
  let gain = null;
  let lowpass = null;
  let source = null;
  let wanted = false;
  let buffer = null;
  let rate = 1, cutoff = 20000;
  const ready = loadBuffer(url, onError).then(loaded => { buffer = loaded; if (wanted) start(); });

  function start() {
    const ctx = getContext();
    if (!ctx || !buffer || source) return;
    unlockAudio();
    gain = ctx.createGain();
    gain.gain.value = volume;
    gain.connect(ctx.destination);
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = rate;
    if (filter) {
      lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = cutoff;
      source.connect(lowpass); lowpass.connect(gain);
    } else source.connect(gain);
    // start somewhere in the loop rather than always at its first second
    source.start(0, Math.random() * buffer.duration);
  }

  function stop() {
    if (!source) return;
    try { source.stop(); } catch { /* already stopped */ }
    source.disconnect();
    lowpass?.disconnect();
    gain?.disconnect();
    source = gain = lowpass = null;
  }

  return {
    ready,
    get playing() { return wanted; },
    play() { wanted = true; start(); },
    pause() { wanted = false; stop(); },
    setVolume(value) { volume = value; if (gain) gain.gain.value = value; },
    setRate(value) { rate = value; if (source) source.playbackRate.value = value; },
    setFilter(hertz) { cutoff = hertz; if (lowpass) lowpass.frequency.value = hertz; },
  };
}

// ---- sounds placed in the world: the listener is the headset (call setListener every frame), each sound a panner where it happens.
// Distances: a sound is at full volume within `refDistance` metres and falls off as refDistance / distance beyond (the inverse model), so a
// big sound carries a long way. `delay` (seconds) lets a far sound arrive after it is seen, as sound does (about 343 m a second).
export function setListener(position, forward, up) {
  const ctx = context;                            // (only once something has made the context)
  if (!ctx) return;
  const l = ctx.listener;
  if (l.positionX) {
    const t = ctx.currentTime;
    l.positionX.setValueAtTime(position.x, t); l.positionY.setValueAtTime(position.y, t); l.positionZ.setValueAtTime(position.z, t);
    l.forwardX.setValueAtTime(forward.x, t); l.forwardY.setValueAtTime(forward.y, t); l.forwardZ.setValueAtTime(forward.z, t);
    l.upX.setValueAtTime(up.x, t); l.upY.setValueAtTime(up.y, t); l.upZ.setValueAtTime(up.z, t);
  } else {
    l.setPosition?.(position.x, position.y, position.z);
    l.setOrientation?.(forward.x, forward.y, forward.z, up.x, up.y, up.z);
  }
}

// One-shot sounds (variations, round robin) played at a place in the world.
export function createPositionalClips(urls, { volume = 1, refDistance = 20, rolloff = 1, maxDistance = 10000, onError = console.warn } = {}) {
  const buffers = [];
  let next = 0;
  for (const url of urls) loadBuffer(url, onError).then(buffer => { if (buffer) buffers.push(buffer); });
  return {
    get ready() { return buffers.length > 0; },
    // at: { x, y, z }; gain: times the clips' volume; delay: seconds before it is heard; rate: playback speed
    play(at, { gain: g = 1, delay = 0, rate = 1 } = {}) {
      const ctx = getContext();
      if (!ctx || !buffers.length || ctx.state !== 'running') return false;
      const source = ctx.createBufferSource();
      source.buffer = buffers[next++ % buffers.length];
      source.playbackRate.value = rate;
      const gain = ctx.createGain();
      gain.gain.value = volume * g;
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = refDistance;
      panner.rolloffFactor = rolloff;
      panner.maxDistance = maxDistance;
      if (panner.positionX) { panner.positionX.value = at.x; panner.positionY.value = at.y; panner.positionZ.value = at.z; }
      else panner.setPosition(at.x, at.y, at.z);
      source.connect(gain); gain.connect(panner); panner.connect(ctx.destination);
      source.onended = () => { source.disconnect(); gain.disconnect(); panner.disconnect(); };
      source.start(ctx.currentTime + Math.max(0, delay));
      return true;
    },
  };
}

// A set of one-shot variations, played round-robin so it never repeats back to back.
export function createClips(urls, { volume = 1, onError = console.warn } = {}) {
  const buffers = [];
  let next = 0;
  for (const url of urls) loadBuffer(url, onError).then(buffer => { if (buffer) buffers.push(buffer); });
  return {
    play() {
      const ctx = getContext();
      if (!ctx || !buffers.length) return;
      unlockAudio();
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      gain.gain.value = volume;
      source.buffer = buffers[next++ % buffers.length];
      source.connect(gain);
      gain.connect(ctx.destination);
      source.onended = () => { source.disconnect(); gain.disconnect(); };
      source.start(0);
    },
  };
}
