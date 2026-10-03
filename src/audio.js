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

// A looping sound with play/stop. Safe to call play() repeatedly.
export function createLoop(url, { volume = 1, onError = console.warn } = {}) {
  let gain = null;
  let source = null;
  let wanted = false;
  let buffer = null;
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
    source.connect(gain);
    source.start(0);
  }

  function stop() {
    if (!source) return;
    try { source.stop(); } catch { /* already stopped */ }
    source.disconnect();
    gain?.disconnect();
    source = gain = null;
  }

  return {
    ready,
    get playing() { return wanted; },
    play() { wanted = true; start(); },
    pause() { wanted = false; stop(); },
    setVolume(value) { volume = value; if (gain) gain.gain.value = value; },
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
