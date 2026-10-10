import * as THREE from 'three';
import { ITEMS, RECIPES, getRecipeStatus, craftItem } from './crafting.js';
import {
  PACK_CARRY_BONUS, POCKET_CARRY_WEIGHT, canTakeOffPack, getCarryCapacity, getInventoryItems, getInventoryWeight,
  getInventoryItemWeight, getInventoryCount, isPackWorn,
} from './inventory.js';
import { pulseHaptics } from './haptics.js';
import { statColour } from './watch.js';
import { exposureGlow } from './glow.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { reflectMetal, gadgetReflection } from './gadget-env.js';
import { isBuildingPiece } from './building-kit.js';

// The watch menu (the owner, 6 Oct: the Ark-style menu was ugly; it now comes out of the survival watch; then: make it look part of the watch). It is
// the watch, scaled up: the screen is drawn like the watch's (dark teal, a faint instrument grid, green for what is chosen and the button to press,
// green to red for how full something is) inside a frame that is the watch's case (public/models/watch/watch_menu_frame.glb, built by
// tools/watch/build_menu_frame.py: the same gunmetal bezel, grip teeth, cyan marks and crown). On the screen: two tabs (Pack: what you carry and what you wear; Craft: what you can make), a grid of big tiles on the left and a card for the chosen one
// on the right with what you can do with it. Your health, food, water and stamina are on the watch, so they are not in here; the carried weight is in
// the header.
// VR: tap the watch (or press Y) and it grows out of the watch and hangs in front of you at about arm's length, a little below the eyes and tilted to
// face you. Poke it with either index finger (each press clicks once, with a tick in that hand), or point at it from further away and pull the trigger.
// Desktop: the same canvas as an overlay, with real buttons over it for the mouse and keyboard.
const WIDTH = 1280, HEIGHT = 800;
const PANEL_WIDTH_METRES = 0.64;
const C = {
  ink: '#eaf8f9',
  muted: '#9ec2c8',
  dim: 'rgba(158, 194, 200, 0.55)',
  accent: '#7fe6f2',
  accentSoft: 'rgba(127, 230, 242, 0.16)',
  gold: '#f3c86e',
  warn: '#ef9079',
  ok: '#60d678',
  green: '#50de8c',                          // the watch's full bar: what is chosen, and the button to press
  greenGlow: 'rgba(80, 222, 140, 0.5)',
  greenSoft: 'rgba(80, 222, 140, 0.18)',
};
const GRID = { x: 44, y: 128, cols: 5, rows: 3, size: 140, gap: 16 };
const CARD = { x: 852, y: 124, w: 400, h: 652 };
const SLOT = 104;
const WORN = { y: 638, label: 'Worn' };
const SLOTS = [
  { id: 'slot:left', side: 'left', label: 'Left hip', x: GRID.x },
  { id: 'back', side: null, label: 'Back', x: GRID.x + 128 },
  { id: 'slot:right', side: 'right', label: 'Right hip', x: GRID.x + 256 },
];

export function hitMenuControl(controls, x, y) {
  return controls.find(control => x >= control.x && x <= control.x + control.w && y >= control.y && y <= control.y + control.h) || null;
}

// onPlace(type, { hand }) starts placing an item (the campfire): the game shows a ghost to aim and confirm, and returns { ok, message }.
// `hand` is the VR hand that chose Place (it aims), or null. The menu closes on ok so the player can see the ghost.
// backpack ({ isWorn(), takeOff() -> { ok, message } }) is the pack you wear: the Back slot, and how much you can carry.
// popOrigin(target): where the panel grows out of when it opens in VR (the watch), written into target; null if nowhere.
export function createSurvivorMenu({ scene, renderer, states, tools = null, backpack = null, onToggle = () => {}, onPlace = null, popOrigin = null }) {
  const controllers = states.map(state => state.controller);
  const surface = document.createElement('canvas');
  surface.width = WIDTH; surface.height = HEIGHT;
  surface.setAttribute('aria-hidden', 'true');
  const ctx = surface.getContext('2d');
  const overlay = document.createElement('section');
  overlay.id = 'survivor-menu'; overlay.hidden = true;
  overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Pack and crafting');
  const viewport = document.createElement('div'); viewport.className = 'survivor-viewport';
  const buttons = document.createElement('div'); buttons.className = 'survivor-buttons';
  const announcement = document.createElement('div'); announcement.className = 'sr-only';
  announcement.setAttribute('role', 'status');
  viewport.append(surface, buttons); overlay.append(viewport, announcement); document.body.append(overlay);

  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 4;
  const PANEL_HEIGHT_METRES = PANEL_WIDTH_METRES * HEIGHT / WIDTH;
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(PANEL_WIDTH_METRES, PANEL_HEIGHT_METRES),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
  );
  panel.name = 'Watch menu'; panel.visible = false; panel.renderOrder = 30;
  scene.add(panel);
  // the watch's case round the screen (its opening is the panel less a lip, so the canvas's rim is under the bezel)
  const frameTrim = [], frameMetal = [];
  new GLTFLoader().load(`${import.meta.env?.BASE_URL ?? '/'}models/watch/watch_menu_frame.glb`, gltf => {
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = false;
      if (o.material?.name?.startsWith('Menu_Glow')) frameTrim.push(o.material);
    });
    frameMetal.push(...reflectMetal(gltf.scene, renderer));
    panel.add(gltf.scene);
  }, undefined, error => console.warn(`[Watch menu] frame: ${error?.message || error}`));
  // a fingertip's mark on the glass while it is near: a ring that closes as the finger comes in
  const cursors = states.map(() => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.0055, 0.0075, 28), new THREE.MeshBasicMaterial({ color: C.green, toneMapped: false, transparent: true, depthTest: false, opacity: 0.9 }));
    ring.renderOrder = 32; ring.visible = false; panel.add(ring); return ring;
  });
  const raycaster = new THREE.Raycaster();
  const rotation = new THREE.Matrix4(), origin = new THREE.Vector3(), forward = new THREE.Vector3();
  const headPosition = new THREE.Vector3(), tip = new THREE.Vector3();
  const rays = controllers.map(controller => {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: C.accent, depthTest: false, toneMapped: false }));
    line.name = 'Menu pointer'; line.renderOrder = 31; line.visible = false;
    controller.add(line); return line;
  });
  const triggerDown = controllers.map(() => false);
  const pokeDown = controllers.map(() => false);
  let open = false, tab = 'pack', page = 0;
  // What the card shows: an inventory item, a recipe, a hip slot or the back slot.
  let selected = { kind: 'recipe', id: RECIPES[0].id };
  let yDown = false, dirty = true, controls = [], hovered = '', message = '', snapshot = '', previousFocus = null;

  // ---- drawing helpers ----
  function font(size, weight = 400) { ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`; }
  function text(label, x, y, size = 24, color = C.ink, weight = 400, align = 'left') {
    font(size, weight); ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(label, x, y); ctx.textAlign = 'left';
  }
  function rounded(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function wrap(value, x, y, width, size = 23, color = C.muted, lineGap = 9) {
    font(size);
    let row = '';
    for (const word of value.split(' ')) {
      if (row && ctx.measureText(`${row} ${word}`).width > width) { text(row, x, y, size, color); row = word; y += size + lineGap; }
      else row = row ? `${row} ${word}` : word;
    }
    if (row) text(row, x, y, size, color);
    return y + size + lineGap;
  }
  function addControl(id, label, x, y, w, h, disabled = false) {
    controls.push({ id, label, x, y, w, h, disabled });
    return hovered === id && !disabled;
  }
  function meter(x, y, w, h, fraction, color) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)'; rounded(x, y, w, h, h / 2); ctx.fill();
    const f = Math.max(0, Math.min(1, fraction));
    if (f > 0) { ctx.fillStyle = color; rounded(x, y, Math.max(h, w * f), h, h / 2); ctx.fill(); }
  }
  function button(id, label, x, y, w, h, { primary = false, disabled = false, size = 27 } = {}) {
    const hover = addControl(id, label, x, y, w, h, disabled);
    ctx.save();
    if (disabled) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.045)'; rounded(x, y, w, h, 18); ctx.fill();
      ctx.strokeStyle = 'rgba(158, 194, 200, 0.16)'; ctx.lineWidth = 1.5; ctx.stroke();
    } else if (primary) {
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, hover ? '#9cf2b8' : '#7fe6a2'); g.addColorStop(1, hover ? '#4fd685' : '#3cc474');
      ctx.shadowColor = C.greenGlow; ctx.shadowBlur = hover ? 26 : 14;
      ctx.fillStyle = g; rounded(x, y, w, h, 18); ctx.fill();
    } else {
      ctx.fillStyle = hover ? C.greenSoft : 'rgba(255, 255, 255, 0.06)'; rounded(x, y, w, h, 18); ctx.fill();
      ctx.strokeStyle = hover ? 'rgba(80, 222, 140, 0.75)' : 'rgba(80, 222, 140, 0.3)'; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.restore();
    text(label, x + w / 2, y + h / 2 + size * 0.36, size, disabled ? C.dim : primary ? '#03170c' : C.ink, primary ? 700 : 600, 'center');
  }

  function icon(type, cx, cy, scale = 1) {
    ctx.save(); ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const handle = (x1, y1, x2, y2, width = 9) => {
      ctx.strokeStyle = '#6e4f33'; ctx.lineWidth = width + 3; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.strokeStyle = '#b48a5c'; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    };
    if (isBuildingPiece(type)) {
      ctx.strokeStyle = '#c3a274'; ctx.lineWidth = 3;
      if (type === 'foundation' || type === 'floor') {
        const depth = type === 'foundation' ? 20 : 7;
        ctx.fillStyle = '#756b61'; ctx.beginPath(); ctx.moveTo(-36, 7); ctx.lineTo(0, 25); ctx.lineTo(36, 7); ctx.lineTo(36, 7 + depth); ctx.lineTo(0, 25 + depth); ctx.lineTo(-36, 7 + depth); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#78604b'; ctx.beginPath(); ctx.moveTo(-36, 7); ctx.lineTo(0, -13); ctx.lineTo(36, 7); ctx.lineTo(0, 25); ctx.closePath(); ctx.fill(); ctx.stroke();
        for (const n of [-18, 0, 18]) { ctx.beginPath(); ctx.moveTo(n - 18, 7 + n / 2); ctx.lineTo(n + 18, -13 + n / 2); ctx.stroke(); }
      } else if (type === 'roof') {
        ctx.fillStyle = '#806b50'; ctx.beginPath(); ctx.moveTo(-36, 17); ctx.lineTo(-13, -26); ctx.lineTo(36, -11); ctx.lineTo(13, 32); ctx.closePath(); ctx.fill(); ctx.stroke();
        for (const n of [0, 12, 24, 36]) { ctx.beginPath(); ctx.moveTo(-30 + n, 15 + n / 3); ctx.lineTo(-8 + n, -23 + n / 3); ctx.stroke(); }
      } else if (type === 'stairs') {
        ctx.fillStyle = '#78604b'; ctx.beginPath(); ctx.moveTo(-34, 34); ctx.lineTo(-34, 21);
        for (let n = 0; n < 6; n++) { ctx.lineTo(-34 + (n + 1) * 11, 21 - n * 11); ctx.lineTo(-34 + (n + 1) * 11, 10 - n * 11); }
        ctx.lineTo(32, 34); ctx.closePath(); ctx.fill(); ctx.stroke();
      } else if (type === 'pillar') {
        ctx.fillStyle = '#78604b'; ctx.fillRect(-9, -37, 18, 74); ctx.strokeRect(-9, -37, 18, 74);
        ctx.strokeStyle = '#c3a274'; ctx.lineWidth = 6; for (const y of [-29, 0, 29]) { ctx.beginPath(); ctx.moveTo(-11, y); ctx.lineTo(11, y); ctx.stroke(); }
      } else {
        const width = type === 'door' ? 22 : 34;
        ctx.fillStyle = '#78604b'; ctx.fillRect(-width, -35, width * 2, 70); ctx.strokeRect(-width, -35, width * 2, 70);
        ctx.strokeStyle = '#af8b61'; ctx.lineWidth = 2;
        for (let x = -width + 10; x < width; x += 10) { ctx.beginPath(); ctx.moveTo(x, -32); ctx.lineTo(x, 32); ctx.stroke(); }
        if (type === 'wall_door' || type === 'wall_window') {
          const y = type === 'wall_door' ? -17 : -12, h = type === 'wall_door' ? 52 : 25;
          ctx.fillStyle = '#123034'; ctx.fillRect(-13, y, 26, h); ctx.strokeStyle = C.accent; ctx.strokeRect(-13, y, 26, h);
          if (type === 'wall_window') for (const x of [-6, 6]) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.stroke(); }
        }
        if (type === 'door') { ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(13, 3, 3, 0, Math.PI * 2); ctx.fill(); }
      }
    } else if (type === 'axe') {
      handle(-22, 30, 14, -26);
      ctx.fillStyle = '#9fb0ad'; ctx.strokeStyle = '#5f7270'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(2, -26); ctx.lineTo(30, -36); ctx.quadraticCurveTo(40, -18, 32, -2); ctx.lineTo(10, -8); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#d8c29a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(4, -20); ctx.lineTo(16, -14); ctx.moveTo(1, -14); ctx.lineTo(13, -8); ctx.stroke();
    } else if (type === 'torch') {
      handle(-16, 32, 8, -10);
      ctx.fillStyle = '#4a3a2c'; ctx.fillRect(2, -18, 14, 14);
      ctx.fillStyle = C.gold; ctx.beginPath(); ctx.moveTo(4, -16); ctx.quadraticCurveTo(-6, -32, 14, -48); ctx.quadraticCurveTo(10, -30, 24, -28); ctx.quadraticCurveTo(24, -16, 4, -16); ctx.fill();
      ctx.fillStyle = '#fff1c4'; ctx.beginPath(); ctx.moveTo(8, -18); ctx.quadraticCurveTo(4, -28, 13, -36); ctx.quadraticCurveTo(13, -26, 18, -22); ctx.quadraticCurveTo(16, -17, 8, -18); ctx.fill();
    } else if (type === 'spear') {
      // a long shaft leaning right: stone point, cream lashing with a coral band, a tassel of two feathers and a cyan bead
      ctx.rotate(0.5);
      ctx.fillStyle = '#8fb0b4'; ctx.strokeStyle = '#35545c'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-5, -22); ctx.lineTo(-9.5, -32); ctx.lineTo(0, -52); ctx.lineTo(9.5, -32); ctx.lineTo(5, -22); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#cfe2e0'; ctx.beginPath(); ctx.moveTo(0, -52); ctx.lineTo(9.5, -32); ctx.lineTo(5, -22); ctx.lineTo(0, -22); ctx.closePath(); ctx.fill();
      handle(0, 42, 0, -20, 6);
      ctx.fillStyle = '#e3d5ac'; ctx.strokeStyle = '#8c7d52'; ctx.lineWidth = 2;
      ctx.fillRect(-6, -26, 12, 15); ctx.strokeRect(-6, -26, 12, 15);
      ctx.strokeStyle = '#e5603b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-6, -18.5); ctx.lineTo(6, -18.5); ctx.stroke();
      ctx.strokeStyle = '#e5603b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-3.5, 35); ctx.lineTo(3.5, 35); ctx.stroke();
      ctx.fillStyle = '#2fa3a8'; ctx.strokeStyle = '#1b6468'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-3, 0); ctx.quadraticCurveTo(-17, 6, -19, 27); ctx.quadraticCurveTo(-6, 20, -3, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e5603b'; ctx.strokeStyle = '#9b3a22';
      ctx.beginPath(); ctx.moveTo(3, 2); ctx.quadraticCurveTo(15, 9, 16, 26); ctx.quadraticCurveTo(5, 20, 3, 10); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(0, 5, 3.2, 0, Math.PI * 2); ctx.fill();
    } else if (type === 'bow') {
      ctx.strokeStyle = '#b48a5c'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(-12, -42); ctx.bezierCurveTo(40, -24, 40, 24, -12, 42); ctx.stroke();
      ctx.strokeStyle = '#e8dcc0'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-12, -42); ctx.lineTo(-12, 42); ctx.stroke();
      ctx.strokeStyle = C.accent; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-28, 0); ctx.lineTo(42, 0); ctx.lineTo(33, -6); ctx.moveTo(42, 0); ctx.lineTo(33, 6); ctx.stroke();
    } else if (type === 'pickaxe') {
      // a haft leaning right with a dark curved stone pick across the top: a long point one way, a short flat edge the other, cream lashing
      ctx.rotate(0.35);
      handle(0, 40, 0, -22, 7);
      ctx.fillStyle = '#4b4645'; ctx.strokeStyle = '#242021'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-17, -22); ctx.lineTo(-13, -31); ctx.quadraticCurveTo(0, -34, 14, -32); ctx.quadraticCurveTo(34, -29, 42, -6); ctx.quadraticCurveTo(24, -18, 0, -18); ctx.quadraticCurveTo(-8, -18, -17, -22); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#cbbfa6'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(14, -31); ctx.quadraticCurveTo(32, -27, 40, -8); ctx.stroke();
      ctx.fillStyle = '#e3d5ac'; ctx.strokeStyle = '#8c7d52'; ctx.lineWidth = 2;
      ctx.fillRect(-7, -37, 14, 22); ctx.strokeRect(-7, -37, 14, 22);
      ctx.strokeStyle = '#e5603b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-7, -29); ctx.lineTo(7, -29); ctx.moveTo(-7, -21); ctx.lineTo(7, -21); ctx.stroke();
      ctx.strokeStyle = '#e5603b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-3.5, 33); ctx.lineTo(3.5, 33); ctx.stroke();
      ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(8, -8, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2fa3a8'; ctx.beginPath(); ctx.moveTo(8, -5); ctx.quadraticCurveTo(14, 4, 11, 16); ctx.quadraticCurveTo(6, 8, 8, -5); ctx.fill();
    } else if (type === 'stone') {
      ctx.fillStyle = '#a9b6b3'; ctx.beginPath(); ctx.moveTo(-30, 10); ctx.lineTo(-16, -22); ctx.lineTo(14, -28); ctx.lineTo(32, -2); ctx.lineTo(20, 22); ctx.lineTo(-10, 27); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#74898a'; ctx.beginPath(); ctx.moveTo(-16, -22); ctx.lineTo(-4, 10); ctx.lineTo(20, 22); ctx.lineTo(-10, 27); ctx.lineTo(-30, 10); ctx.closePath(); ctx.fill();
    } else if (type === 'campfire') {
      // stone ring, crossed logs, a flame
      ctx.fillStyle = '#8fa09d'; ctx.strokeStyle = '#5b6d6b'; ctx.lineWidth = 2;
      for (const [sx, sy] of [[-30, 20], [-14, 28], [8, 30], [28, 22], [34, 8], [-36, 6]]) {
        ctx.beginPath(); ctx.ellipse(sx, sy, 10, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      handle(-24, 22, 18, -2, 8); handle(24, 22, -18, -2, 8);
      ctx.fillStyle = C.gold; ctx.beginPath(); ctx.moveTo(-10, 0); ctx.quadraticCurveTo(-18, -22, 0, -44); ctx.quadraticCurveTo(0, -26, 14, -22); ctx.quadraticCurveTo(20, -8, 10, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff1c4'; ctx.beginPath(); ctx.moveTo(-3, -1); ctx.quadraticCurveTo(-7, -14, 1, -24); ctx.quadraticCurveTo(3, -14, 7, -10); ctx.quadraticCurveTo(6, -2, -3, -1); ctx.fill();
    } else if (type === 'glider') {
      // a hang glider from the front: a wide swept wing with a coral leading edge and a cyan stripe, the kingpost and the A-frame with its bar below
      ctx.fillStyle = '#2f7c78'; ctx.strokeStyle = '#143a3b'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, -30); ctx.quadraticCurveTo(-26, -24, -46, -6); ctx.lineTo(-38, -2); ctx.quadraticCurveTo(-18, -12, 0, -14);
      ctx.quadraticCurveTo(18, -12, 38, -2); ctx.lineTo(46, -6); ctx.quadraticCurveTo(26, -24, 0, -30); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e5603b'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-45, -7); ctx.quadraticCurveTo(-26, -25, 0, -31); ctx.quadraticCurveTo(26, -25, 45, -7); ctx.stroke();
      ctx.strokeStyle = C.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-30, -11); ctx.quadraticCurveTo(0, -24, 30, -11); ctx.stroke();
      ctx.strokeStyle = '#cbbfa6'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(-16, 26); ctx.moveTo(0, -14); ctx.lineTo(16, 26); ctx.moveTo(-20, 26); ctx.lineTo(20, 26); ctx.stroke();
      ctx.strokeStyle = '#4c301f'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-17, 26); ctx.lineTo(-9, 26); ctx.moveTo(9, 26); ctx.lineTo(17, 26); ctx.stroke();
      ctx.strokeStyle = 'rgba(203, 191, 166, 0.6)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-18, 26); ctx.lineTo(-38, -2); ctx.moveTo(18, 26); ctx.lineTo(38, -2); ctx.stroke();
    } else if (type === 'backpack') {
      // a rucksack: carry handle, body, flap with a coral band and a cyan edge, a rolled mat on two leather straps
      ctx.strokeStyle = '#8a5a35'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, -28, 11, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = '#2f7c78'; ctx.strokeStyle = '#143a3b'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-26, -10); ctx.quadraticCurveTo(-27, -30, -8, -30); ctx.lineTo(8, -30); ctx.quadraticCurveTo(27, -30, 26, -10);
      ctx.lineTo(29, 26); ctx.quadraticCurveTo(29, 35, 20, 35); ctx.lineTo(-20, 35); ctx.quadraticCurveTo(-29, 35, -29, 26); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#3a8780'; ctx.fillRect(-37, 0, 10, 24); ctx.fillRect(27, 0, 10, 24);
      ctx.fillStyle = '#225f63'; ctx.beginPath(); ctx.moveTo(-25, -26); ctx.lineTo(25, -26); ctx.lineTo(26, -4); ctx.quadraticCurveTo(0, 4, -26, -4); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#e5603b'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-24, -8); ctx.quadraticCurveTo(0, 0, 24, -8); ctx.stroke();
      ctx.strokeStyle = C.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-25, -3); ctx.quadraticCurveTo(0, 5, 25, -3); ctx.stroke();
      ctx.fillStyle = '#e3d5ac'; ctx.strokeStyle = '#8c7d52'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-27, 14); ctx.lineTo(27, 14); ctx.arc(27, 22, 8, -Math.PI / 2, Math.PI / 2); ctx.lineTo(-27, 30); ctx.arc(-27, 22, 8, Math.PI / 2, Math.PI * 1.5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#4c301f'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-12, 2); ctx.lineTo(-12, 31); ctx.moveTo(12, 2); ctx.lineTo(12, 31); ctx.stroke();
    } else if (type === 'wood') {
      ctx.save(); ctx.rotate(-0.35);
      ctx.fillStyle = '#2f3a44'; ctx.fillRect(-30, -13, 50, 26);
      ctx.strokeStyle = '#46566a'; ctx.lineWidth = 2; for (let i = -24; i < 18; i += 9) { ctx.beginPath(); ctx.moveTo(i, -12); ctx.lineTo(i + 4, 12); ctx.stroke(); }
      ctx.fillStyle = '#9cc9c0'; ctx.beginPath(); ctx.ellipse(22, 0, 9, 14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#6f9d95'; ctx.beginPath(); ctx.ellipse(22, 0, 4.5, 7, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    } else if (type === 'crystal') {
      // three glowing shards: a tall one in the middle, two leaning out
      const shard = (x, y, w, h, lean, fill, light) => {
        ctx.save(); ctx.translate(x, y); ctx.rotate(lean);
        ctx.fillStyle = fill; ctx.strokeStyle = '#2b1752'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.lineTo(-w / 2, -h * 0.72); ctx.lineTo(0, -h); ctx.lineTo(w / 2, -h * 0.72); ctx.lineTo(w / 2, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = light; ctx.beginPath(); ctx.moveTo(0, -h); ctx.lineTo(w / 2, -h * 0.72); ctx.lineTo(w / 2, 0); ctx.lineTo(w * 0.1, 0); ctx.lineTo(w * 0.1, -h * 0.74); ctx.closePath(); ctx.fill();
        ctx.restore();
      };
      shard(-17, 26, 16, 38, -0.45, '#7a45d8', '#a97cf0');
      shard(18, 28, 15, 34, 0.5, '#6b4fe0', '#9a86f4');
      shard(0, 30, 21, 58, 0, '#a64ff0', '#e0a3ff');
      ctx.fillStyle = 'rgba(255, 240, 255, 0.85)'; ctx.beginPath(); ctx.arc(-4, -14, 2.6, 0, Math.PI * 2); ctx.fill();
    } else if (type === 'fibre') {
      // a bundle of pale strands tied with a cord
      ctx.strokeStyle = '#d9c58f'; ctx.lineWidth = 4;
      for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(i * 3.5, 34); ctx.quadraticCurveTo(i * 9, 0, i * 6.5 + 2, -34); ctx.stroke(); }
      ctx.strokeStyle = '#a3905f'; ctx.lineWidth = 1.5;
      for (let i = -3; i <= 3; i += 2) { ctx.beginPath(); ctx.moveTo(i * 3.5 + 2, 30); ctx.quadraticCurveTo(i * 9 + 2, 0, i * 6.5 + 4, -30); ctx.stroke(); }
      ctx.strokeStyle = '#e5603b'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-17, 5); ctx.lineTo(17, 5); ctx.stroke();
    } else {
      ctx.strokeStyle = C.accent; ctx.lineWidth = 4;
      for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 12, 25); ctx.quadraticCurveTo(20 + i * 10, -5, i * 14, -30); ctx.stroke(); }
    }
    ctx.restore();
  }

  // A tile: an icon on glass, a count badge, a cyan rim when chosen, a gold dot when a recipe is ready, faded when out of reach.
  function tile(id, label, x, y, size, { type = null, count = null, active = false, ready = false, faded = false, ghost = false } = {}) {
    const hover = id ? addControl(id, label, x, y, size, size) : false;
    ctx.save();
    const g = ctx.createLinearGradient(0, y, 0, y + size);
    const lift = hover ? 0.06 : 0;
    g.addColorStop(0, `rgba(255, 255, 255, ${(type ? 0.075 : 0.03) + lift})`);
    g.addColorStop(1, `rgba(255, 255, 255, ${(type ? 0.025 : 0.012) + lift})`);
    if (active) { ctx.shadowColor = C.greenGlow; ctx.shadowBlur = 22; }
    ctx.fillStyle = g; rounded(x, y, size, size, 20); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = active ? 3 : 1.5;
    ctx.strokeStyle = active ? C.green : ready ? 'rgba(243, 200, 110, 0.75)' : hover ? 'rgba(80, 222, 140, 0.55)' : type ? 'rgba(110, 222, 236, 0.16)' : 'rgba(110, 222, 236, 0.07)';
    ctx.stroke();
    ctx.restore();
    if (!type) return hover;
    ctx.globalAlpha = faded ? 0.38 : ghost ? 0.3 : 1;
    icon(type, x + size / 2, y + size / 2 + 3, size / 118);
    ctx.globalAlpha = 1;
    if (count !== null) {
      const label = `${count}`;
      font(22, 700);
      const w = Math.max(34, ctx.measureText(label).width + 18);
      ctx.fillStyle = 'rgba(3, 14, 17, 0.82)'; rounded(x + size - w - 8, y + 8, w, 30, 15); ctx.fill();
      text(label, x + size - 8 - w / 2, y + 30, 22, C.ink, 700, 'center');
    }
    if (ready) { ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(x + 20, y + 20, 7, 0, Math.PI * 2); ctx.fill(); }
    return hover;
  }

  // ---- the screen: the watch's (a dark teal gradient, a faint instrument grid, a soft vignette), edge to edge (the frame's bezel covers its rim)
  function drawScreen() {
    const g = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    g.addColorStop(0, '#0b1d22'); g.addColorStop(1, '#050d10');
    ctx.fillStyle = g; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.strokeStyle = 'rgba(110, 222, 236, 0.06)'; ctx.lineWidth = 1.5;
    for (let i = 40; i < WIDTH; i += 40) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, HEIGHT); ctx.stroke(); }
    for (let i = 40; i < HEIGHT; i += 40) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(WIDTH, i); ctx.stroke(); }
    const v = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, HEIGHT * 0.35, WIDTH / 2, HEIGHT / 2, WIDTH * 0.62);
    v.addColorStop(0, 'rgba(0, 0, 0, 0)'); v.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  function drawHeader() {
    // the tabs: one pill, two halves
    const x = GRID.x, y = 36, w = 400, h = 64;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'; rounded(x, y, w, h, 32); ctx.fill();
    for (const [i, id, label, glyph] of [[0, 'pack', 'Pack', 'backpack'], [1, 'craft', 'Craft', 'axe']]) {
      const tx = x + 4 + i * (w / 2), tw = w / 2 - 8;
      const hover = addControl(id, label, tx, y + 4, tw, h - 8);
      const active = tab === id;
      if (active || hover) {
        ctx.save();
        if (active) { ctx.shadowColor = C.greenGlow; ctx.shadowBlur = 16; }
        ctx.fillStyle = active ? C.greenSoft : 'rgba(255, 255, 255, 0.05)'; rounded(tx, y + 4, tw, h - 8, 28); ctx.fill();
        ctx.restore();
        if (active) { ctx.strokeStyle = 'rgba(80, 222, 140, 0.75)'; ctx.lineWidth = 2; rounded(tx, y + 4, tw, h - 8, 28); ctx.stroke(); }
      }
      ctx.globalAlpha = active ? 1 : 0.6;
      icon(glyph, tx + 46, y + h / 2 + 1, 0.42);
      ctx.globalAlpha = 1;
      text(label, tx + 80, y + 43, 30, active ? C.ink : C.muted, active ? 700 : 600);
    }
    // what you carry, against what you can
    const weight = getInventoryWeight(), capacity = getCarryCapacity(), heavy = weight > capacity;
    const mx = 724, mw = 400;
    text('Load', mx, 62, 22, C.muted, 600);
    text(`${weight} / ${capacity}`, mx + mw, 62, 22, heavy ? C.warn : C.ink, 700, 'right');
    if (heavy) text('Too heavy: you walk at half speed', mx, 112, 18, C.warn, 600);
    meter(mx, 76, mw, 10, weight / capacity, statColour(1 - weight / capacity));
    // close
    const cx = WIDTH - 72, cy = 68, r = 30;
    const hover = addControl('close', 'Close', cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = hover ? 'rgba(239, 144, 121, 0.28)' : 'rgba(255, 255, 255, 0.06)'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = hover ? C.warn : C.muted; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - 10, cy - 10); ctx.lineTo(cx + 10, cy + 10); ctx.moveTo(cx + 10, cy - 10); ctx.lineTo(cx - 10, cy + 10); ctx.stroke();
  }

  function gridAt(i) { return { x: GRID.x + (i % GRID.cols) * (GRID.size + GRID.gap), y: GRID.y + Math.floor(i / GRID.cols) * (GRID.size + GRID.gap) }; }

  function drawPack() {
    const items = getInventoryItems();
    const perPage = GRID.cols * GRID.rows;
    const pages = Math.max(1, Math.ceil(items.length / perPage)); page = Math.min(page, pages - 1);
    for (let i = 0; i < perPage; i++) {
      const item = items[page * perPage + i];
      const { x, y } = gridAt(i);
      if (!item) { tile(null, '', x, y, GRID.size); continue; }
      tile(`item:${item.type}`, `${ITEMS[item.type]?.name || item.type}, ${item.count}`, x, y, GRID.size, {
        type: item.type, count: item.count, active: selected.kind === 'item' && selected.id === item.type,
      });
    }
    if (!items.length) {
      text('Nothing in your pack yet', GRID.x + 382, GRID.y + 200, 28, C.ink, 600, 'center');
      text('Pick something up and let go of it at your chest.', GRID.x + 382, GRID.y + 240, 22, C.muted, 400, 'center');
    }
    // what you wear: the two hips and your back
    text(WORN.label.toUpperCase(), GRID.x, WORN.y - 14, 18, C.dim, 700);
    const hips = tools?.getHipSlots?.() || { left: null, right: null };
    for (const slot of SLOTS) {
      if (slot.side === null && !backpack) continue;
      const type = slot.side ? hips[slot.side] : 'backpack';
      const worn = slot.side ? Boolean(type) : isPackWorn();
      const active = slot.side ? selected.kind === 'slot' && selected.id === slot.side : selected.kind === 'back';
      tile(slot.id, slot.side ? `${slot.label}: ${type ? ITEMS[type]?.name : 'empty'}` : `Back: ${worn ? 'backpack' : 'empty'}`, slot.x, WORN.y, SLOT,
        { type: type || null, active, ghost: !worn });
      text(slot.label, slot.x + SLOT / 2, WORN.y + SLOT + 26, 19, worn ? C.ink : C.muted, 600, 'center');
    }
    if (pages > 1) {
      const px = GRID.x + 560;
      button('previous', '‹', px, WORN.y + 20, 64, 64, { disabled: page === 0, size: 36 });
      text(`${page + 1} / ${pages}`, px + 100, WORN.y + 62, 22, C.muted, 600, 'center');
      button('next', '›', px + 136, WORN.y + 20, 64, 64, { disabled: page === pages - 1, size: 36 });
    }
  }

  function drawCraft() {
    RECIPES.forEach((recipe, i) => {
      const { x, y } = gridAt(i);
      const { canCraft } = getRecipeStatus(recipe.id);
      tile(`recipe:${recipe.id}`, recipe.name, x, y, GRID.size, {
        type: recipe.output, active: selected.kind === 'recipe' && selected.id === recipe.id, ready: canCraft, faded: !canCraft,
      });
    });
    for (let i = RECIPES.length; i < GRID.cols * GRID.rows; i++) { const { x, y } = gridAt(i); tile(null, '', x, y, GRID.size); }
    ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(GRID.x + 8, WORN.y + 2, 7, 0, Math.PI * 2); ctx.fill();
    text('You have everything to make it', GRID.x + 26, WORN.y + 10, 22, C.muted);
  }

  // ---- the card for the chosen thing
  function cardFrame() {
    const { x, y, w, h } = CARD;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(255, 255, 255, 0.06)'); g.addColorStop(1, 'rgba(255, 255, 255, 0.02)');
    ctx.fillStyle = g; rounded(x, y, w, h, 28); ctx.fill();
    ctx.strokeStyle = 'rgba(127, 230, 242, 0.14)'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  function cardTop(type, title, kicker, { faded = false } = {}) {
    const { x, y, w } = CARD;
    const well = 132;
    ctx.save();
    const g = ctx.createRadialGradient(x + 24 + well / 2, y + 24 + well / 2, 10, x + 24 + well / 2, y + 24 + well / 2, well * 0.7);
    g.addColorStop(0, 'rgba(80, 222, 140, 0.16)'); g.addColorStop(1, 'rgba(110, 222, 236, 0.03)');
    ctx.fillStyle = g; rounded(x + 24, y + 24, well, well, 24); ctx.fill();
    ctx.restore();
    if (type) { ctx.globalAlpha = faded ? 0.4 : 1; icon(type, x + 24 + well / 2, y + 24 + well / 2 + 3, 1.06); ctx.globalAlpha = 1; }
    const tx = x + 24 + well + 20, tw = w - well - 68;
    let ty = y + 70;
    font(32, 700);
    // the title, on two lines if it needs them
    const words = title.split(' '); let line = '';
    const lines = [];
    for (const word of words) { if (line && ctx.measureText(`${line} ${word}`).width > tw) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word; }
    lines.push(line);
    for (const l of lines.slice(0, 2)) { text(l, tx, ty, 32, C.ink, 700); ty += 38; }
    if (kicker) {
      font(18, 700);
      const kw = ctx.measureText(kicker.toUpperCase()).width + 24;
      ctx.fillStyle = C.accentSoft; rounded(tx, ty - 10, kw, 30, 15); ctx.fill();
      text(kicker.toUpperCase(), tx + 12, ty + 11, 18, C.accent, 700);
      ty += 30;
    }
    return Math.max(y + 24 + well + 34, ty + 34);
  }
  function hint(value) { text(value, CARD.x + CARD.w / 2, CARD.y + CARD.h - 18, 18, C.dim, 500, 'center'); }
  const ACTION = { y: CARD.y + CARD.h - 132, h: 78 };
  const pointHint = () => (renderer.xr.isPresenting ? 'Poke it, or point and pull the trigger' : 'Click, or Y / Esc to close');

  function drawCard() {
    cardFrame();
    const left = CARD.x + 24, width = CARD.w - 48;
    if (selected.kind === 'back' && backpack) { drawBackCard(left, width); return; }
    const status = selected.kind === 'recipe' ? getRecipeStatus(selected.id) : null;
    const hips = tools?.getHipSlots?.() || {};
    const type = selected.kind === 'item' ? selected.id : selected.kind === 'slot' ? hips[selected.id] : status?.recipe.output;
    const item = type ? ITEMS[type] : null;
    if (!item) {
      const slot = SLOTS.find(s => s.side === selected.id);
      const [title, body] = selected.kind === 'slot'
        ? [`${slot?.label ?? 'Hip'} is empty`, 'Choose a tool in your pack and put it on this hip. You can also let go of a tool next to your hip.']
        : ['Nothing chosen', 'Choose something in your pack to see what it is and what you can do with it.'];
      const y = cardTop(null, title, null);
      wrap(body, left, y, width);
      hint(pointHint());
      return;
    }
    const kicker = item.category === 'TOOL' ? 'Tool' : item.category === 'STRUCTURE' ? 'Structure' : 'Resource';
    let y = cardTop(type, status ? status.recipe.name : item.name, kicker, { faded: status && !status.canCraft });
    y = wrap(status ? status.recipe.description : item.description, left, y, width, 22);
    if (status) {
      y = Math.max(y + 6, CARD.y + 330);
      text('NEEDS', left, y, 18, C.dim, 700);
      status.ingredients.forEach(({ type: need, owned, required }, i) => {
        const row = y + 22 + i * 62;
        const done = owned >= required;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'; rounded(left, row, width, 52, 16); ctx.fill();
        icon(need, left + 30, row + 26, 0.36);
        text(ITEMS[need].name, left + 60, row + 34, 23, C.ink, 600);
        text(`${Math.min(owned, 999)} / ${required}`, left + width - 16, row + 34, 23, done ? C.ok : C.warn, 700, 'right');
        meter(left + 60, row + 42, width - 76, 4, owned / required, done ? C.ok : C.warn);
      });
      button('make', status.canCraft ? 'Craft' : 'Need more', left, ACTION.y, width, ACTION.h, { primary: status.canCraft, disabled: !status.canCraft, size: 30 });
    } else {
      text(`${getInventoryCount(type)} in your pack  ·  ${getInventoryItemWeight(type)} each`, left, Math.max(y + 4, CARD.y + 330), 21, C.muted, 600);
      if (selected.kind === 'slot') {
        button('unequip', 'Back in the pack', left, ACTION.y, width, ACTION.h, { primary: true });
      } else if (item.equippable && tools) {
        text('PUT IT ON A HIP', left, ACTION.y - 18, 18, C.dim, 700);
        const half = (width - 14) / 2;
        for (const [i, side] of ['left', 'right'].entries()) {
          const taken = hips[side];
          const label = taken === type ? `On ${side}` : `${side === 'left' ? 'Left' : 'Right'}${taken ? ' (swap)' : ''}`;
          button(`equip:${side}`, label, left + i * (half + 14), ACTION.y, half, ACTION.h, { primary: true, disabled: taken === type && getInventoryCount(type) < 1, size: 26 });
        }
      } else if (item.placeable && onPlace) {
        const have = getInventoryCount(type) > 0;
        button('place', have ? 'Place it' : `None left`, left, ACTION.y, width, ACTION.h, { primary: have, disabled: !have, size: 30 });
      }
    }
    if (message) text(message, left, ACTION.y - (item.equippable && !status && selected.kind !== 'slot' ? 52 : 20), 21, C.gold, 600);
    hint(item.placeable && !status ? (renderer.xr.isPresenting ? 'Then aim and pull the trigger; Y backs out' : 'Then aim and click; Y backs out') : pointHint());
  }

  function drawBackCard(left, width) {
    const worn = isPackWorn();
    let y = cardTop('backpack', worn ? 'Backpack' : 'Back is empty', worn ? 'Worn' : 'Back', { faded: !worn });
    text(`Carry ${getCarryCapacity()}  ·  a pack adds ${PACK_CARRY_BONUS}`, left, y, 21, C.muted, 600);
    y = wrap(worn
      ? 'Everything you pick up goes in here. Reach over your shoulder and grip to take it off, or use the button.'
      : 'Pick up the backpack by its handle and let go of it behind your shoulder to wear it. Then you can carry much more.', left, y + 40, width, 22);
    if (message) text(message, left, ACTION.y - 20, 21, C.gold, 600);
    if (!worn) { hint(pointHint()); return; }
    const canOff = canTakeOffPack();
    if (!canOff) wrap(`Your pockets hold ${POCKET_CARRY_WEIGHT}: it can only come off when you carry that much or less.`, left, y + 8, width, 20, C.warn);
    button('takeoff', canOff ? 'Take it off' : 'Too heavy to take off', left, ACTION.y, width, ACTION.h, { primary: canOff, disabled: !canOff, size: canOff ? 30 : 25 });
    hint(pointHint());
  }

  function draw() {
    dirty = false; controls = [];
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    drawScreen();
    drawHeader();
    if (tab === 'pack') drawPack(); else drawCraft();
    drawCard();
    texture.needsUpdate = true;
    syncButtons();
  }

  function syncButtons() {
    // Reuse nodes so hovering or inventory updates never steal keyboard focus.
    const wanted = new Set(controls.map(control => control.id));
    for (const node of [...buttons.children]) if (!wanted.has(node.dataset.action)) node.remove();
    for (const control of controls) {
      let node = [...buttons.children].find(item => item.dataset.action === control.id);
      if (!node) {
        node = document.createElement('button'); node.dataset.action = control.id;
        node.addEventListener('click', () => activate(control.id));
        node.addEventListener('pointerenter', () => setHover(control.id));
        node.addEventListener('pointerleave', () => setHover(''));
        buttons.append(node);
      }
      node.textContent = control.label; node.setAttribute('aria-label', control.label);
      node.disabled = Boolean(control.disabled);
      if (control.id === 'pack' || control.id === 'craft') node.setAttribute('aria-pressed', String(tab === control.id));
      node.style.cssText = `left:${control.x / WIDTH * 100}%;top:${control.y / HEIGHT * 100}%;width:${control.w / WIDTH * 100}%;height:${control.h / HEIGHT * 100}%`;
    }
  }

  function setHover(id) { if (hovered !== id) { hovered = id; dirty = true; } }
  function say(value) { message = value; announcement.textContent = value; }

  function activate(id, hand = null) {
    if (!open || controls.find(control => control.id === id)?.disabled) return;
    if (id === 'close') { setOpen(false); return; }
    message = '';
    if (id === 'pack') {
      tab = id;
      const first = getInventoryItems()[0];
      if (selected.kind === 'recipe') selected = first ? { kind: 'item', id: first.type } : { kind: 'none' };
    }
    if (id === 'craft') { tab = id; if (selected.kind !== 'recipe') selected = { kind: 'recipe', id: RECIPES[0].id }; }
    if (id.startsWith('recipe:')) selected = { kind: 'recipe', id: id.slice(7) };
    if (id.startsWith('item:')) selected = { kind: 'item', id: id.slice(5) };
    if (id.startsWith('slot:')) {
      const side = id.slice(5);
      // Choosing an empty hip with a tool chosen puts it there.
      const carrying = selected.kind === 'item' && ITEMS[selected.id]?.equippable;
      if (carrying && !tools?.getHipSlots()[side]) equip(selected.id, side);
      else selected = { kind: 'slot', id: side };
    }
    if (id === 'back') selected = { kind: 'back' };
    if (id === 'takeoff' && backpack) say(backpack.takeOff().message);
    if (id.startsWith('equip:')) equip(selected.id, id.slice(6));
    if (id === 'unequip' && selected.kind === 'slot') {
      const type = tools?.getHipSlots()[selected.id];
      if (type && tools.unequip(selected.id)) { say(`${ITEMS[type].name} is back in your pack.`); selected = { kind: 'item', id: type }; tab = 'pack'; }
    }
    if (id === 'previous') page = Math.max(0, page - 1);
    if (id === 'next') page++;
    if (id === 'make') {
      const name = getRecipeStatus(selected.id)?.recipe.name;
      say(craftItem(selected.id) ? `Made: ${name}. It’s in your pack.` : 'Not enough materials.');
    }
    if (id === 'place' && onPlace) {
      const type = selected.kind === 'item' ? selected.id : getRecipeStatus(selected.id)?.recipe.output;
      const result = type && getInventoryCount(type) > 0 ? onPlace(type, { hand }) : null;
      if (result?.ok) { dirty = true; setOpen(false); return; }
      say(result?.message || `No ${ITEMS[type]?.name.toLowerCase() || 'item'} to place.`);
    }
    dirty = true;
  }

  function equip(type, side) {
    if (!tools) return;
    if (tools.equip(type, side)) {
      say(`${ITEMS[type].name} is on your ${side} hip.`);
      selected = { kind: 'slot', id: side };
    } else say(getInventoryCount(type) < 1 ? `No ${ITEMS[type].name.toLowerCase()} in your pack.` : `${ITEMS[type].name} isn’t ready yet.`);
  }

  // VR: the panel hangs in front of you at about arm's length, a little below the eyes, tilted up to face you. Opened from the watch (`from`, a world
  // position), it grows out of the watch to there.
  const PLACE = { distance: 0.5, below: 0.26, popSeconds: 0.3 };
  const POKE = { hover: 0.06, press: 0.008, release: 0.022, behind: 0.05, near: 0.16 };   // metres in front of (or behind) the glass
  const popFrom = new THREE.Vector3(), popTo = new THREE.Vector3(), local = new THREE.Vector3();
  let popStart = -1;
  function setOpen(value, from = null) {
    if (open === value) return;
    open = value; hovered = ''; message = ''; dirty = true;
    overlay.hidden = !open || renderer.xr.isPresenting; panel.visible = open && renderer.xr.isPresenting;
    pokeDown.fill(true);                                 // a finger already on the glass (the one that tapped the watch) has to leave it first
    if (open) {
      previousFocus = document.activeElement;
      if (tab === 'pack' && selected.kind !== 'slot' && selected.kind !== 'back') {
        const first = getInventoryItems()[0];
        if (!(selected.kind === 'item' && getInventoryCount(selected.id) > 0)) selected = first ? { kind: 'item', id: first.type } : { kind: 'none' };
      }
      if (renderer.xr.isPresenting) {
        const view = renderer.xr.getCamera(); view.getWorldPosition(headPosition); view.getWorldDirection(forward);
        forward.y = 0; if (forward.lengthSq() < .01) forward.set(0, 0, -1); forward.normalize();
        popTo.copy(headPosition).addScaledVector(forward, PLACE.distance); popTo.y -= PLACE.below;
        panel.rotation.set(-Math.atan2(PLACE.below, PLACE.distance), Math.atan2(-forward.x, -forward.z), 0, 'YXZ');
        panel.position.copy(popTo); panel.scale.setScalar(1);
        if (!from && popOrigin) from = popOrigin(popFrom);
        if (from) { popFrom.copy(from); popStart = performance.now(); panel.position.copy(from); panel.scale.setScalar(0.02); }
        else popStart = -1;
        panel.updateMatrixWorld(true);
      }
      draw();
      if (!renderer.xr.isPresenting) buttons.querySelector('[data-action="pack"]')?.focus();
    } else {
      rays.forEach(ray => { ray.visible = false; });
      cursors.forEach(c => { c.visible = false; });
      previousFocus?.focus?.({ preventScroll: true });
    }
    onToggle(open);
  }

  overlay.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const focusable = [...buttons.querySelectorAll('button:not(:disabled)')];
    const index = focusable.indexOf(document.activeElement);
    event.preventDefault(); focusable[(index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length]?.focus();
  });

  // The control under a point on the panel (panel-local metres), or null.
  function controlAt(lx, ly) {
    const u = lx / PANEL_WIDTH_METRES + 0.5, v = ly / PANEL_HEIGHT_METRES + 0.5;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    return hitMenuControl(controls, u * WIDTH, (1 - v) * HEIGHT);
  }

  function update() {
    if (open && renderer.xr.isPresenting) {
      const exposure = renderer.toneMappingExposure ?? 1;
      for (const m of frameTrim) m.emissiveIntensity = exposureGlow(exposure, { day: 0.35, night: 0.5 });
      for (const m of frameMetal) m.envMapIntensity = gadgetReflection(exposure);
      panel.material.color.setScalar(0.72 + 0.28 * THREE.MathUtils.smoothstep(exposure, 0.07, 0.5));   // a little dimmer at night, as the watch is
    }
    if (open && popStart >= 0) {
      const t = Math.min(1, (performance.now() - popStart) / (PLACE.popSeconds * 1000));
      const e = 1 - Math.pow(1 - t, 3);
      panel.position.lerpVectors(popFrom, popTo, e);
      panel.scale.setScalar(0.02 + 0.98 * e);
      panel.updateMatrixWorld(true);
      if (t >= 1) popStart = -1;
    }
    const session = renderer.xr.getSession();
    const visible = session?.visibilityState === 'visible';
    const sources = [...(session?.inputSources || [])];
    const y = visible && Boolean(sources.find(source => source.handedness === 'left')?.gamepad?.buttons[5]?.pressed);
    if (y && !yDown) setOpen(!open);
    yDown = y;
    if (session && !visible && open) setOpen(false);
    let hover = '', pendingAction = null, pendingHand = null;
    const ready = open && renderer.xr.isPresenting && visible && popStart < 0;
    controllers.forEach((controller, index) => {
      const state = states[index];
      const source = state.inputSource;
      const line = rays[index]; line.visible = false;
      const cursor = cursors[index]; cursor.visible = false;
      let near = false;
      // ---- poking with the index finger
      if (ready && state.indexTip && source) {
        state.indexTip.updateWorldMatrix(true, false);
        panel.worldToLocal(state.indexTip.getWorldPosition(tip));
        local.copy(tip);
        const depth = local.z;                            // (the panel is at full size here: local metres are world metres)
        const inside = Math.abs(local.x) <= PANEL_WIDTH_METRES / 2 && Math.abs(local.y) <= PANEL_HEIGHT_METRES / 2;
        near = inside && depth < POKE.near && depth > -POKE.behind;
        if (inside && depth < POKE.hover && depth > -POKE.behind) {
          const control = controlAt(local.x, local.y);
          if (control && !control.disabled) hover = control.id;
          cursor.visible = true;
          cursor.position.set(local.x, local.y, 0.002);
          const s = 0.6 + Math.max(0, Math.min(1, depth / POKE.hover)) * 1.2;
          cursor.scale.setScalar(s);
          cursor.material.opacity = pokeDown[index] ? 0.4 : 0.9;
          if (!pokeDown[index] && depth < POKE.press) {
            pokeDown[index] = true;
            if (control && !control.disabled) { pendingAction = control.id; pendingHand = state.handedness || null; }
            pulseHaptics(state, 0.3, 25);
          }
        }
        if (!inside || depth > POKE.release) pokeDown[index] = false;
      }
      // ---- pointing from further away, the trigger to choose
      const pressed = visible && Boolean(source?.gamepad?.buttons[0]?.pressed);
      if (ready && !near && source?.targetRayMode === 'tracked-pointer' && controller.visible) {
        controller.updateWorldMatrix(true, false); origin.setFromMatrixPosition(controller.matrixWorld);
        rotation.extractRotation(controller.matrixWorld); forward.set(0, 0, -1).applyMatrix4(rotation);
        raycaster.set(origin, forward);
        const hit = raycaster.intersectObject(panel, false)[0];
        line.visible = Boolean(hit); line.scale.z = hit ? hit.distance : 1;
        if (hit?.uv) {
          const control = hitMenuControl(controls, hit.uv.x * WIDTH, (1 - hit.uv.y) * HEIGHT);
          if (control && !control.disabled) {
            hover = hover || control.id;
            if (pressed && !triggerDown[index]) { pendingAction = control.id; pendingHand = state.handedness || null; }
          }
        }
      }
      triggerDown[index] = pressed;
    });
    if (pendingAction) activate(pendingAction, pendingHand);
    if (renderer.xr.isPresenting) setHover(hover);
    if (open) {
      const current = JSON.stringify([getInventoryItems(), tools?.getHipSlots?.(), isPackWorn()]);
      if (current !== snapshot) { snapshot = current; dirty = true; }
      if (dirty) draw();
    }
  }
  renderer.xr.addEventListener('sessionstart', () => { setOpen(false); yDown = false; triggerDown.fill(false); });
  renderer.xr.addEventListener('sessionend', () => { setOpen(false); yDown = false; triggerDown.fill(false); });
  return { update, setOpen, toggle: (from = null) => setOpen(!open, from), isOpen: () => open, debug: { draw, surface, state: () => ({ tab, selected, hovered }), select: s => { selected = s; dirty = true; }, tab: t => { tab = t; dirty = true; } } };
}
