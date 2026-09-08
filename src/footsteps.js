const STEP_URLS = Array.from(
  { length: 9 },
  (_, index) => `${import.meta.env.BASE_URL}audio/footsteps/sand_step_${String(index + 1).padStart(2, '0')}.mp3`
);

const WALK_STRIDE = 1.12;
const RUN_STRIDE = 1.34;
const RUN_THRESHOLD = 3.7;
const MIN_MOVING_SPEED = 0.35;
const STEP_GAIN = 0.58;

function shuffledIndices(count) {
  const values = Array.from({ length: count }, (_, index) => index);
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

export function createSandFootsteps({ onError = console.warn } = {}) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    onError('[Oasis footsteps] Web Audio is unavailable; footsteps disabled.');
    return { update() {}, reset() {} };
  }

  const context = new AudioContextClass();
  const gain = context.createGain();
  gain.gain.value = STEP_GAIN;
  gain.connect(context.destination);

  let buffers = [];
  let bag = [];
  let bagCursor = 0;
  let distanceSinceStep = 0;
  let movingLastFrame = false;

  Promise.all(STEP_URLS.map(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
    return context.decodeAudioData(await response.arrayBuffer());
  })).then((loaded) => {
    buffers = loaded;
    bag = shuffledIndices(buffers.length);
  }).catch((error) => {
    onError(`[Oasis footsteps] Sand footsteps failed to load: ${error?.message || error}`);
  });

  function nextBuffer() {
    if (!buffers.length) return null;
    if (!bag.length || bagCursor >= bag.length) {
      const previous = bag.length ? bag[bag.length - 1] : -1;
      bag = shuffledIndices(buffers.length);
      if (bag.length > 1 && bag[0] === previous) [bag[0], bag[1]] = [bag[1], bag[0]];
      bagCursor = 0;
    }
    return buffers[bag[bagCursor++]];
  }

  function playStep(speed) {
    const buffer = nextBuffer();
    if (!buffer) return;
    if (context.state === 'suspended') context.resume().catch(() => {});
    if (context.state !== 'running') return;

    const source = context.createBufferSource();
    source.buffer = buffer;
    // Keep variation subtle enough that the sand recording still sounds natural.
    const speedBias = Math.min(Math.max((speed - 2.6) / 5.2, 0), 0.035);
    source.playbackRate.value = 0.97 + Math.random() * 0.06 + speedBias;
    source.connect(gain);
    source.start();
  }

  function reset() {
    distanceSinceStep = 0;
    movingLastFrame = false;
  }

  function update({ distance = 0, speed = 0, grounded = true, active = true } = {}) {
    const moving = active && grounded && speed >= MIN_MOVING_SPEED && distance > 0.0001;
    if (!moving) {
      if (!grounded || speed < MIN_MOVING_SPEED) reset();
      return;
    }

    const stride = speed >= RUN_THRESHOLD ? RUN_STRIDE : WALK_STRIDE;
    if (!movingLastFrame) {
      // The first audible footfall should arrive quickly after locomotion begins, not a full stride later.
      distanceSinceStep = stride * 0.62;
    }
    movingLastFrame = true;
    distanceSinceStep += distance;

    if (distanceSinceStep >= stride) {
      distanceSinceStep %= stride;
      playStep(speed);
    }
  }

  return { update, reset };
}
