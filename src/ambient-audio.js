import { createLoop } from './audio.js';

const AMBIENT_URL = `${import.meta.env.BASE_URL}audio/ambient/desert_ambient_end_loop_60s.mp3`;
const AMBIENT_VOLUME = 0.5;

const ambient = createLoop(AMBIENT_URL, { volume: AMBIENT_VOLUME });

const welcome = document.querySelector('#welcome');
const explore = document.querySelector('#explore');
const enterVR = document.querySelector('#enter-vr');
const menu = document.querySelector('#menu');

function startAmbient() {
  ambient.play();
}

function pauseAmbient() {
  ambient.pause();
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
