const AMBIENT_URL = `${import.meta.env.BASE_URL}audio/ambient/desert_ambient_end_loop_60s.mp3`;
const AMBIENT_VOLUME = 0.5;

const ambient = new Audio(AMBIENT_URL);
ambient.loop = true;
ambient.preload = 'metadata';
ambient.volume = AMBIENT_VOLUME;
ambient.playsInline = true;

const welcome = document.querySelector('#welcome');
const explore = document.querySelector('#explore');
const enterVR = document.querySelector('#enter-vr');
const menu = document.querySelector('#menu');

function startAmbient() {
  if (!ambient.paused) return;
  ambient.play().catch((error) => {
    // Browser autoplay policy can reject audio unless this runs from a player gesture.
    if (error?.name !== 'NotAllowedError') console.warn('[Oasis ambience] Could not play desert ambience:', error);
  });
}

function pauseAmbient() {
  if (!ambient.paused) ambient.pause();
}

// Start directly from the player's click so Quest Browser treats audio as user-initiated.
explore?.addEventListener('click', startAmbient);
enterVR?.addEventListener('click', startAmbient);
menu?.addEventListener('click', pauseAmbient);

// main.js exposes play state by hiding/showing the welcome screen. This also catches XR session end.
if (welcome) {
  const playStateObserver = new MutationObserver(() => {
    if (!welcome.hidden) pauseAmbient();
  });
  playStateObserver.observe(welcome, { attributes: true, attributeFilter: ['hidden'] });
}

window.addEventListener('pagehide', pauseAmbient);
