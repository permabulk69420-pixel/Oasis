import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getSurvivalStats, STAT_MAX } from './survival.js';
import { exposureGlow } from './glow.js';
import { pulseHaptics } from './haptics.js';

// The survival watch on the left wrist (the owner's note, 6 Oct): glance at it for health, hunger, water and stamina (bars, green to red) and the time
// of day; tap it with the other hand's index finger and the menu opens in front of you. The model is built in Blender (tools/watch/build_watch.py) in
// the left hand model's own space, so it is simply added to that hand. Its display (`Watch_Screen`) is a live canvas.
//
// The display dims when you are not looking at it and lights up when you turn it toward your eyes. It is drawn unaffected by the tone mapping, so it
// reads the same in the day as at night (dimmer at night so it does not dazzle).

export const WATCH = Object.freeze({
  url: 'models/watch/survival_watch.glb',
  canvas: 256,
  redrawEvery: 0.25,                       // seconds
  glance: Object.freeze({ cone: Math.cos(40 * Math.PI / 180), reach: 0.75, rise: 7, fall: 3 }),   // the face toward the eyes within 40 degrees, within 75 cm
  screen: Object.freeze({ idle: { day: 0.28, night: 0.12 }, lit: { day: 1.0, night: 0.62 } }),
  trim: Object.freeze({ day: 0.35, night: 0.5 }),
  tap: Object.freeze({ radius: 0.03, cooldown: 0.6 }),   // a fingertip this close to the display (metres) taps it
  low: 0.2,                                // a stat below this share blinks
});

const STATS = [
  { key: 'health', icon: 'heart' },
  { key: 'food', icon: 'food' },
  { key: 'water', icon: 'drop' },
  { key: 'stamina', icon: 'bolt' },
];

// green when full, amber at half, red when low
export function statColour(share) {
  const stops = [[0, [229, 64, 52]], [0.3, [240, 120, 52]], [0.55, [242, 196, 72]], [0.8, [96, 214, 120]], [1, [80, 222, 140]]];
  const v = Math.min(1, Math.max(0, share));
  for (let i = 1; i < stops.length; i++) {
    const [b, cb] = stops[i], [a, ca] = stops[i - 1];
    if (v <= b) {
      const t = (v - a) / (b - a);
      return `rgb(${ca.map((c, k) => Math.round(c + (cb[k] - c) * t)).join(',')})`;
    }
  }
  return 'rgb(80,222,140)';
}

export function clockText(hours) {
  const h = ((hours % 24) + 24) % 24;
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function createWatch({ states, getDay, getExposure = () => 1, getHead, onTap = () => {}, onError = console.warn }) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = WATCH.canvas;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.flipY = false;                   // the model's UVs are glTF's (v = 0 at 12 o'clock): the canvas's top row goes there
  const screenMaterial = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  let template = null, watch = null, face = null, trim = null, wornOn = null;
  new GLTFLoader().load(`${import.meta.env.BASE_URL}${WATCH.url}`, gltf => {
    template = gltf.scene;
    template.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = false;
      if (o.material?.name?.startsWith('Watch_Screen')) o.material = screenMaterial;
      if (o.material?.name?.startsWith('Watch_Glass')) { o.material.transparent = true; o.material.depthWrite = false; o.renderOrder = 2; }
    });
  }, undefined, error => onError(`[Watch] ${error?.message || error}`));

  let brightness = 0, redrawIn = 0, tapCool = 0, blink = 0, lastKey = '', wasTouching = false;
  const facePos = new THREE.Vector3(), faceNormal = new THREE.Vector3(), toEye = new THREE.Vector3(), tip = new THREE.Vector3(), q = new THREE.Quaternion();

  // ---- the display
  function icon(kind, x, y, s, colour) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s / 24, s / 24);
    ctx.fillStyle = colour; ctx.strokeStyle = colour; ctx.lineWidth = 2.6; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    if (kind === 'heart') {
      ctx.moveTo(0, 9); ctx.bezierCurveTo(-13, 0, -11, -11, -5, -10); ctx.bezierCurveTo(-2, -10, 0, -7, 0, -5);
      ctx.bezierCurveTo(0, -7, 2, -10, 5, -10); ctx.bezierCurveTo(11, -11, 13, 0, 0, 9); ctx.fill();
    } else if (kind === 'food') {          // a drumstick
      ctx.ellipse(3, -3, 7.5, 6.5, -0.7, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-1, 2); ctx.lineTo(-7, 8); ctx.stroke();
      ctx.beginPath(); ctx.arc(-8.5, 9.5, 2.3, 0, Math.PI * 2); ctx.arc(-6, 11.5, 2.3, 0, Math.PI * 2); ctx.fill();
    } else if (kind === 'drop') {
      ctx.moveTo(0, -11); ctx.bezierCurveTo(4, -4, 8, 0, 8, 4); ctx.arc(0, 4, 8, 0, Math.PI); ctx.bezierCurveTo(-8, 0, -4, -4, 0, -11); ctx.fill();
    } else if (kind === 'bolt') {
      ctx.moveTo(3, -12); ctx.lineTo(-7, 2); ctx.lineTo(-1, 2); ctx.lineTo(-3, 12); ctx.lineTo(7, -2); ctx.lineTo(1, -2); ctx.closePath(); ctx.fill();
    } else if (kind === 'sun') {
      ctx.arc(0, 0, 5.5, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; ctx.moveTo(Math.cos(a) * 8.5, Math.sin(a) * 8.5); ctx.lineTo(Math.cos(a) * 11.5, Math.sin(a) * 11.5); }
      ctx.stroke();
    } else if (kind === 'moon') {
      ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.arc(5, -3, 8, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }
  function rounded(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function draw(stats, day, blinkOn) {
    const S = WATCH.canvas;
    ctx.clearRect(0, 0, S, S);
    const bg = ctx.createLinearGradient(0, 0, 0, S);
    bg.addColorStop(0, '#0b1d22'); bg.addColorStop(1, '#050d10');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, S, S);
    // a faint grid, like an instrument
    ctx.strokeStyle = 'rgba(110, 222, 236, 0.06)'; ctx.lineWidth = 1;
    for (let i = 16; i < S; i += 16) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, S); ctx.moveTo(0, i); ctx.lineTo(S, i); ctx.stroke(); }
    // the time and the sun or moon, with the day's progress under them
    const hours = day?.hours ?? 12;
    ctx.fillStyle = '#e8fbfc'; ctx.font = '700 50px system-ui, -apple-system, "Segoe UI", sans-serif'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.fillText(clockText(hours), 20, 66);
    icon(day?.isDay === false ? 'moon' : 'sun', 214, 46, 34, day?.isDay === false ? '#cfe3ff' : '#ffd36a');
    ctx.fillStyle = 'rgba(110, 222, 236, 0.18)'; rounded(20, 80, S - 40, 5, 2.5); ctx.fill();
    ctx.fillStyle = '#7fe6f2'; rounded(20, 80, Math.max(5, (S - 40) * (hours / 24)), 5, 2.5); ctx.fill();
    // the four bars
    STATS.forEach(({ key, icon: kind }, i) => {
      const share = Math.max(0, Math.min(1, (stats?.[key] ?? STAT_MAX) / STAT_MAX));
      const y = 104 + i * 38;
      const colour = statColour(share);
      const faint = share < WATCH.low && !blinkOn;
      icon(kind, 31, y + 11, 29, faint ? 'rgba(255,255,255,0.25)' : colour);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'; rounded(58, y, S - 78, 22, 6); ctx.fill();
      if (share > 0) { ctx.fillStyle = faint ? 'rgba(229, 64, 52, 0.35)' : colour; rounded(58, y, Math.max(12, (S - 78) * share), 22, 6); ctx.fill(); }
      ctx.fillStyle = 'rgba(255, 255, 255, 0.10)'; rounded(60, y + 2, Math.max(8, (S - 82) * share), 6, 3); ctx.fill();   // a shine on the bar
    });
    texture.needsUpdate = true;
  }

  // ---- worn on the left hand model (re-fitted whenever the hand model is replaced, as on a controller reconnect)
  function wear() {
    const left = states.find(s => s.handedness === 'left' && s.handRoot);
    const root = left?.handRoot || null;
    if (root === wornOn) return left;
    if (watch) watch.removeFromParent();
    wornOn = root;
    if (!root || !template) { watch = null; return left; }
    watch = template.clone(true);
    face = watch.getObjectByName('watch_face');
    trim = [];
    watch.traverse(o => { if (o.isMesh && o.material?.name?.startsWith('Watch_Glow')) { o.material = o.material.clone(); trim.push(o.material); } });
    root.add(watch);
    return left;
  }

  function update(dt, { presenting = true } = {}) {
    if (!template) return { glancing: false };
    const left = wear();
    if (!watch || !face) return { glancing: false };
    const exposure = getExposure();
    for (const m of trim) m.emissiveIntensity = exposureGlow(exposure, WATCH.trim);
    // ---- glancing: the face toward the eyes and near them
    face.updateWorldMatrix(true, false);
    face.getWorldPosition(facePos);
    faceNormal.set(0, 1, 0).applyQuaternion(face.getWorldQuaternion(q));
    const head = getHead();
    toEye.copy(head).sub(facePos);
    const distance = toEye.length();
    const glancing = presenting && distance < WATCH.glance.reach && faceNormal.dot(toEye.divideScalar(Math.max(distance, 1e-4))) > WATCH.glance.cone;
    brightness += ((glancing ? 1 : 0) - brightness) * (1 - Math.exp(-dt * (glancing ? WATCH.glance.rise : WATCH.glance.fall)));
    const day = getDay();
    const daylight = THREE.MathUtils.smoothstep(day?.daylight ?? 1, 0.05, 0.6);
    const lo = WATCH.screen.idle.night + (WATCH.screen.idle.day - WATCH.screen.idle.night) * daylight;
    const hi = WATCH.screen.lit.night + (WATCH.screen.lit.day - WATCH.screen.lit.night) * daylight;
    screenMaterial.color.setScalar(lo + (hi - lo) * brightness);
    // ---- the display (redrawn a few times a second, and only when what it shows has changed)
    blink = (blink + dt) % 1;
    redrawIn -= dt;
    if (redrawIn <= 0) {
      redrawIn = WATCH.redrawEvery;
      const stats = getSurvivalStats();
      const blinkOn = blink < 0.6;
      const key = [Object.values(stats).map(Math.round).join(','), clockText(day?.hours ?? 12), day?.isDay, blinkOn && Object.values(stats).some(v => v / STAT_MAX < WATCH.low)].join('|');
      if (key !== lastKey) { lastKey = key; draw(stats, day, blinkOn); }
    }
    // ---- a tap: the other hand's index fingertip arriving on the display (it has to leave again before the next tap)
    tapCool = Math.max(0, tapCool - dt);
    const right = states.find(s => s.handedness === 'right' && s.indexTip);
    let touching = false;
    if (presenting && right) {
      right.indexTip.updateWorldMatrix(true, false);
      right.indexTip.getWorldPosition(tip);
      touching = tip.distanceTo(facePos) < WATCH.tap.radius;
      if (touching && !wasTouching && tapCool === 0) {
        tapCool = WATCH.tap.cooldown;
        pulseHaptics(right, 0.25, 30);
        if (left) pulseHaptics(left, 0.18, 25);
        onTap(facePos.clone());
      }
    }
    wasTouching = touching;
    return { glancing, brightness };
  }

  return {
    update,
    get root() { return watch; },
    facePosition: target => (face ? face.getWorldPosition(target) : null),
    // dev: draw the display now (for screenshots)
    redraw() { lastKey = ''; redrawIn = 0; },
  };
}
