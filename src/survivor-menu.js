import * as THREE from 'three';
import { ITEMS, RECIPES, getRecipeStatus, craftItem } from './crafting.js';
import {
  PACK_CARRY_BONUS, POCKET_CARRY_WEIGHT, canTakeOffPack, getCarryCapacity, getInventoryItems, getInventoryWeight,
  getInventoryItemWeight, getInventoryCount, isPackWorn,
} from './inventory.js';
import { getSurvivalStats } from './survival.js';

// Ark-style survivor menu: three floating glass panels (inventory/crafting, you, details)
// drawn into one canvas. The same canvas is a texture in VR and an overlay on desktop.
const WIDTH = 1600, HEIGHT = 960;
const PANEL_WIDTH_METRES = 1.9;
const C = {
  glass: 'rgba(7, 32, 40, 0.82)',
  glassDeep: 'rgba(4, 20, 26, 0.82)',
  tile: 'rgba(18, 58, 68, 0.70)',
  tileHover: 'rgba(36, 96, 108, 0.72)',
  edge: 'rgba(110, 222, 236, 0.55)',
  edgeSoft: 'rgba(110, 222, 236, 0.22)',
  hex: 'rgba(120, 230, 244, 0.06)',
  ink: '#eaf8f9',
  muted: '#93b9c0',
  dim: 'rgba(147, 185, 192, 0.55)',
  accent: '#7fe6f2',
  gold: '#f3c86e',
  warn: '#ef9079',
  bar: '#4cc3d3',
};

const GRID = { x: 48, y: 128, cols: 5, rows: 5, size: 104, gap: 8 };
const PANELS = {
  left: { x: 24, y: 24, w: 600, h: 912 },
  you: { x: 648, y: 24, w: 420, h: 912 },
  detail: { x: 1092, y: 24, w: 484, h: 912 },
};
const HIPS = { left: { x: 668, y: 322, label: 'Left hip' }, right: { x: 944, y: 322, label: 'Right hip' } };
const SLOT = 104;
// The backpack slot sits on the mannequin's back (it is drawn from behind), between the shoulders and the belt.
const BACK = { x: 806, y: 214, label: 'Back' };

export function hitMenuControl(controls, x, y) {
  return controls.find(control => x >= control.x && x <= control.x + control.w && y >= control.y && y <= control.y + control.h) || null;
}

// onPlace(type, { hand }) starts placing an item (the campfire): the game shows a ghost to aim and confirm, and returns { ok, message }.
// `hand` is the VR hand whose trigger chose Place (it aims), or null. The menu closes on ok so the player can see the ghost.
// backpack ({ isWorn(), takeOff() -> { ok, message } }) is the pack you wear: the Back slot, and how much you can carry.
export function createSurvivorMenu({ scene, renderer, states, tools = null, backpack = null, onToggle = () => {}, onPlace = null }) {
  const controllers = states.map(state => state.controller);
  const surface = document.createElement('canvas');
  surface.width = WIDTH; surface.height = HEIGHT;
  surface.setAttribute('aria-hidden', 'true');
  const ctx = surface.getContext('2d');
  const overlay = document.createElement('section');
  overlay.id = 'survivor-menu'; overlay.hidden = true;
  overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Survivor inventory and crafting');
  const viewport = document.createElement('div'); viewport.className = 'survivor-viewport';
  const buttons = document.createElement('div'); buttons.className = 'survivor-buttons';
  const announcement = document.createElement('div'); announcement.className = 'sr-only';
  announcement.setAttribute('role', 'status');
  viewport.append(surface, buttons); overlay.append(viewport, announcement); document.body.append(overlay);

  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace; texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(PANEL_WIDTH_METRES, PANEL_WIDTH_METRES * HEIGHT / WIDTH),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, transparent: true, depthWrite: false }),
  );
  panel.name = 'Survivor inventory menu'; panel.visible = false; panel.renderOrder = 30;
  scene.add(panel);
  const raycaster = new THREE.Raycaster();
  const rotation = new THREE.Matrix4(), origin = new THREE.Vector3(), forward = new THREE.Vector3();
  const headPosition = new THREE.Vector3();
  const rays = controllers.map(controller => {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: C.accent, depthTest: false, toneMapped: false }));
    line.name = 'Inventory pointer'; line.renderOrder = 31; line.visible = false;
    controller.add(line); return line;
  });
  const triggerDown = controllers.map(() => false);
  let open = false, tab = 'inventory', page = 0;
  // What the details panel shows: an inventory item, a recipe, a hip slot or the back slot.
  let selected = { kind: 'recipe', id: RECIPES[0].id };
  let yDown = false, dirty = true, controls = [], hovered = '', message = '', snapshot = '', previousFocus = null;

  // ---- drawing helpers ----
  function font(size, weight = 400) { ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`; }
  function text(label, x, y, size = 24, color = C.ink, weight = 400, align = 'left') {
    font(size, weight); ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(label, x, y); ctx.textAlign = 'left';
  }
  function box(x, y, w, h, fill, stroke = null, width = 1.5) {
    ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.strokeRect(x + width / 2, y + width / 2, w - width, h - width); }
  }
  function hexPattern(x, y, w, h) {
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.strokeStyle = C.hex; ctx.lineWidth = 1.5;
    const r = 26, dx = r * Math.sqrt(3), dy = r * 1.5;
    for (let row = 0, py = y; py < y + h + r; row++, py += dy) {
      for (let px = x + (row % 2 ? dx / 2 : 0); px < x + w + dx; px += dx) {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 6 + i * Math.PI / 3;
          ctx[i ? 'lineTo' : 'moveTo'](px + r * Math.cos(a), py + r * Math.sin(a));
        }
        ctx.closePath(); ctx.stroke();
      }
    }
    ctx.restore();
  }
  function glassPanel({ x, y, w, h }) {
    box(x, y, w, h, C.glass);
    hexPattern(x, y, w, h);
    ctx.strokeStyle = C.edge; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    // Ark-style bright corner ticks.
    ctx.strokeStyle = C.accent; ctx.lineWidth = 4;
    for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(cx + sx * 26, cy + sy * 2); ctx.lineTo(cx + sx * 2, cy + sy * 2); ctx.lineTo(cx + sx * 2, cy + sy * 26); ctx.stroke();
    }
  }
  function bar(x, y, w, fraction, color = C.bar) {
    box(x, y, w, 8, 'rgba(110, 222, 236, 0.14)');
    box(x, y, Math.max(0, Math.min(1, fraction)) * w, 8, color);
  }
  function wrap(value, x, y, width, size = 22, color = C.muted, lineGap = 10) {
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
  function button(id, label, x, y, w, h, { primary = false, disabled = false } = {}) {
    const hover = addControl(id, label, x, y, w, h, disabled);
    const fill = disabled ? 'rgba(18, 58, 68, 0.35)' : primary ? (hover ? 'rgba(127, 230, 242, 0.42)' : 'rgba(127, 230, 242, 0.28)') : hover ? C.tileHover : C.tile;
    box(x, y, w, h, fill, disabled ? C.edgeSoft : primary ? C.accent : C.edge, 2);
    text(label, x + w / 2, y + h / 2 + 9, 25, disabled ? C.dim : C.ink, primary ? 600 : 500, 'center');
  }

  function icon(type, cx, cy, scale = 1) {
    ctx.save(); ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const handle = (x1, y1, x2, y2, width = 9) => {
      ctx.strokeStyle = '#6e4f33'; ctx.lineWidth = width + 3; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.strokeStyle = '#b48a5c'; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    };
    if (type === 'stick') {
      handle(-26, 24, 24, -24, 7);
      ctx.strokeStyle = '#b48a5c'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(4, -4); ctx.lineTo(-6, -24); ctx.stroke();
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

  // Ark-like tile: icon, count top-left, weight bottom-left.
  function tile(id, label, x, y, size, { type = null, count = null, weight = null, active = false, ready = false, faded = false } = {}) {
    const hover = id ? addControl(id, label, x, y, size, size) : false;
    box(x, y, size, size, hover ? C.tileHover : C.tile, active ? C.accent : ready ? C.gold : C.edgeSoft, active ? 3 : 1.5);
    if (!type) return;
    ctx.globalAlpha = faded ? 0.45 : 1;
    icon(type, x + size / 2, y + size / 2 + 2, size / 104);
    ctx.globalAlpha = 1;
    if (count !== null) text(`x${count}`, x + 8, y + 24, 19, C.ink, 600);
    if (weight !== null) text(weight, x + 8, y + size - 9, 16, C.muted);
  }

  // ---- panels ----
  function drawTabs() {
    const tabs = [['inventory', 'INVENTORY', 48, 230], ['crafting', 'CRAFTING', 340, 230]];
    for (const [id, label, x, w] of tabs) {
      const hover = addControl(id, label, x, 36, w, 64);
      const active = tab === id;
      text(label, x, 84, 42, active ? C.accent : hover ? C.muted : C.dim, 800);
      if (active) box(x, 96, w - 20, 3, C.accent);
    }
  }

  function drawInventory() {
    const items = getInventoryItems();
    const perPage = GRID.cols * GRID.rows;
    const pages = Math.max(1, Math.ceil(items.length / perPage)); page = Math.min(page, pages - 1);
    for (let i = 0; i < perPage; i++) {
      const item = items[page * perPage + i];
      const x = GRID.x + (i % GRID.cols) * (GRID.size + GRID.gap), y = GRID.y + Math.floor(i / GRID.cols) * (GRID.size + GRID.gap);
      if (!item) { tile(null, '', x, y, GRID.size); continue; }
      tile(`item:${item.type}`, `${ITEMS[item.type]?.name || item.type}, ${item.count}`, x, y, GRID.size, {
        type: item.type, count: item.count, weight: (item.count * getInventoryItemWeight(item.type)).toFixed(0),
        active: selected.kind === 'item' && selected.id === item.type,
      });
    }
    if (!items.length) text('Empty. Pick things up and let go at your chest to pack them.', GRID.x, 712, 21, C.muted);
    if (pages > 1) {
      button('previous', 'Previous', GRID.x, 700, 150, 52, { disabled: page === 0 });
      button('next', 'Next', GRID.x + 402, 700, 150, 52, { disabled: page === pages - 1 });
    }
  }

  function drawCrafting() {
    RECIPES.forEach((recipe, i) => {
      const x = GRID.x + (i % GRID.cols) * (GRID.size + GRID.gap), y = GRID.y + Math.floor(i / GRID.cols) * (GRID.size + GRID.gap);
      const { canCraft } = getRecipeStatus(recipe.id);
      tile(`recipe:${recipe.id}`, recipe.name, x, y, GRID.size, {
        type: recipe.output, active: selected.kind === 'recipe' && selected.id === recipe.id, ready: canCraft, faded: !canCraft,
      });
    });
    for (let i = RECIPES.length; i < GRID.cols * GRID.rows; i++) {
      tile(null, '', GRID.x + (i % GRID.cols) * (GRID.size + GRID.gap), GRID.y + Math.floor(i / GRID.cols) * (GRID.size + GRID.gap), GRID.size);
    }
    text('Gold edge: you have everything to craft it.', GRID.x, 712, 21, C.muted);
  }

  function drawLeft() {
    glassPanel(PANELS.left);
    drawTabs();
    if (tab === 'inventory') drawInventory(); else drawCrafting();
    const weight = getInventoryWeight();
    const capacity = getCarryCapacity();
    const heavy = weight > capacity;
    text('Carry weight', GRID.x, 790, 22, C.muted);
    text(`${weight} / ${capacity}`, GRID.x + 552, 790, 22, heavy ? C.warn : C.ink, 600, 'right');
    bar(GRID.x, 804, 552, weight / capacity, heavy ? C.warn : C.bar);
    if (heavy) text(`Over ${capacity} you walk at half speed.`, GRID.x, 846, 20, C.warn);
    else if (backpack && !isPackWorn()) text('Pockets only. Wear a backpack to carry more.', GRID.x, 846, 20, C.dim);
    if (message) text(message, GRID.x, 890, 22, C.gold, 500);
  }

  function drawFigure() {
    // A quiet glass mannequin, seen from behind so its left is your left.
    const cx = 858;
    ctx.fillStyle = 'rgba(127, 230, 242, 0.10)'; ctx.strokeStyle = C.edge; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, 160, 34, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 20, 196); ctx.lineTo(cx - 58, 212); ctx.lineTo(cx - 74, 318); ctx.lineTo(cx - 60, 322); ctx.lineTo(cx - 46, 252);
    ctx.lineTo(cx - 44, 340); ctx.lineTo(cx - 40, 500); ctx.lineTo(cx - 12, 500); ctx.lineTo(cx, 372);
    ctx.lineTo(cx + 12, 500); ctx.lineTo(cx + 40, 500); ctx.lineTo(cx + 44, 340); ctx.lineTo(cx + 46, 252);
    ctx.lineTo(cx + 60, 322); ctx.lineTo(cx + 74, 318); ctx.lineTo(cx + 58, 212); ctx.lineTo(cx + 20, 196); ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Belt line linking the two hip slots.
    ctx.strokeStyle = C.accent; ctx.lineWidth = 3; ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.moveTo(HIPS.left.x + SLOT, 370); ctx.lineTo(HIPS.right.x, 370); ctx.stroke(); ctx.setLineDash([]);
  }

  function drawYou() {
    glassPanel(PANELS.you);
    text('YOU', 672, 84, 42, C.accent, 800);
    text('Level 1 survivor', 1044, 84, 22, C.muted, 400, 'right');
    drawFigure();
    const slots = tools?.getHipSlots?.() || { left: null, right: null };
    for (const side of ['left', 'right']) {
      const { x, y, label } = HIPS[side];
      const type = slots[side];
      tile(`slot:${side}`, type ? `${label}: ${ITEMS[type]?.name}` : `${label}: empty`, x, y, SLOT, {
        type, active: selected.kind === 'slot' && selected.id === side,
      });
      text(label, x + SLOT / 2, y + SLOT + 30, 21, type ? C.ink : C.muted, 500, 'center');
    }
    if (backpack) {
      // The slot shows a faint pack when it is empty, so you can see what goes there.
      const worn = isPackWorn();
      tile('back', worn ? 'Back: backpack' : 'Back: empty', BACK.x, BACK.y, SLOT, {
        type: 'backpack', faded: !worn, active: selected.kind === 'back',
      });
      text(BACK.label, BACK.x + SLOT / 2, BACK.y + SLOT + 30, 21, worn ? C.ink : C.muted, 500, 'center');
    }

    const weight = getInventoryWeight();
    const live = getSurvivalStats();
    const stats = [
      ['Health', Math.round(live.health), 100], ['Stamina', Math.round(live.stamina), 100],
      ['Food', Math.round(live.food), 100], ['Water', Math.round(live.water), 100],
      ['Weight', weight, getCarryCapacity()],
    ];
    stats.forEach(([name, value, max], i) => {
      const y = 600 + i * 58;
      text(name, 672, y, 22, C.muted);
      text(`${value} / ${max}`, 1044, y, 22, name === 'Weight' && value > max ? C.warn : C.ink, 600, 'right');
      bar(672, y + 14, 372, value / max, name === 'Weight' && value > max ? C.warn : C.bar);
    });
    text('Eat glow fruit from the veil tree.', 672, 886, 19, C.dim);
    text('Wade into the pond to drink.', 672, 910, 19, C.dim);
  }

  function drawBackDetail(left, width) {
    const worn = isPackWorn();
    text(worn ? 'Backpack' : 'Back is empty', left, 84, 34, C.ink, 700);
    text(worn ? 'Worn' : 'Back slot', left, 120, 21, C.muted);
    tile(null, '', left, 148, 176, {});
    ctx.globalAlpha = worn ? 1 : 0.4;
    icon('backpack', left + 88, 238, 1.6);
    ctx.globalAlpha = 1;
    [['Carry limit', `${getCarryCapacity()}`], [worn ? 'Pack adds' : 'A pack adds', `+${PACK_CARRY_BONUS}`]].forEach(([name, value], i) => {
      text(name, left + 200, 196 + i * 56, 20, C.muted);
      text(value, left + 200, 222 + i * 56, 24, C.ink, 600);
    });
    wrap(worn
      ? 'Everything you pick up goes in here. Reach behind your back and grip to take it off, or use the button below.'
      : 'Pick up the backpack by its handle and let go behind your shoulder to put it on. Then you can carry much more.', left, 372, width, 22);
    if (!worn) return;
    const canOff = canTakeOffPack();
    if (!canOff) wrap(`Your pockets only hold ${POCKET_CARRY_WEIGHT}, so it can only come off when you carry that much or less.`, left, 520, width, 20, C.warn);
    button('takeoff', canOff ? 'Take off' : 'Too much to carry without it', left, 776, width, 72, { primary: canOff, disabled: !canOff });
    text(renderer.xr.isPresenting ? 'You pick the spot, then pull the trigger. Y backs out.' : 'You pick the spot, then click. Y backs out.', left, 872, 20, C.dim);
  }

  function drawDetail() {
    const p = PANELS.detail;
    glassPanel(p);
    button('close', 'Close', p.x + p.w - 128, 40, 104, 52);
    const left = p.x + 24, width = p.w - 48;
    if (selected.kind === 'back' && backpack) { drawBackDetail(left, width); footer(); return; }
    const status = selected.kind === 'recipe' ? getRecipeStatus(selected.id) : null;
    const slots = tools?.getHipSlots?.() || {};
    const type = selected.kind === 'item' ? selected.id
      : selected.kind === 'slot' ? slots[selected.id]
        : status?.recipe.output;
    const item = type ? ITEMS[type] : null;

    if (!item) {
      const empty = selected.kind === 'slot'
        ? [`${HIPS[selected.id].label} is empty`, 'Pick a tool in your inventory, then put it on this hip. You can also let go of a tool next to your hip in the world.']
        : ['Nothing selected', 'Point at something in your inventory to see what it is and what you can do with it.'];
      text(empty[0], left, 84, 34, C.ink, 700);
      wrap(empty[1], left, 140, width, 22);
      footer();
      return;
    }

    text(status ? status.recipe.name : item.name, left, 84, 34, C.ink, 700);
    text(item.category === 'TOOL' ? 'Tool' : item.category === 'STRUCTURE' ? 'Structure' : 'Resource', left, 120, 21, C.muted);
    tile(null, '', left, 148, 176, {});
    icon(type, left + 88, 238, 1.6);
    const facts = [
      [`Weight`, `${getInventoryItemWeight(type)} each`],
      [`In inventory`, `${getInventoryCount(type)}`],
    ];
    facts.forEach(([name, value], i) => {
      text(name, left + 200, 196 + i * 56, 20, C.muted);
      text(value, left + 200, 222 + i * 56, 24, C.ink, 600);
    });
    let y = wrap(status ? status.recipe.description : item.description, left, 372, width, 22);

    if (status) {
      y = Math.max(y + 8, 470);
      text('Needs', left, y, 21, C.muted); text('Have / need', left + width, y, 21, C.muted, 400, 'right');
      status.ingredients.forEach(({ type: need, owned, required }, i) => {
        const row = y + 44 + i * 50;
        icon(need, left + 18, row - 8, 0.4);
        text(ITEMS[need].name, left + 46, row, 24);
        text(`${owned} / ${required}`, left + width, row, 24, owned >= required ? C.accent : C.warn, 600, 'right');
      });
      button('craft', status.canCraft ? `Craft ${status.recipe.name.toLowerCase()}` : 'Not enough materials', left, 776, width, 72, { primary: status.canCraft, disabled: !status.canCraft });
    } else if (selected.kind === 'slot') {
      button('unequip', 'Back to inventory', left, 776, width, 72, { primary: true });
    } else if (item.equippable && tools) {
      text('Carry it on a hip', left, 690, 21, C.muted);
      const half = (width - 12) / 2;
      for (const [i, side] of ['left', 'right'].entries()) {
        const taken = slots[side];
        button(`equip:${side}`, taken === type ? `On ${side} hip` : `${HIPS[side].label}${taken ? ' (swap)' : ''}`, left + i * (half + 12), 712, half, 72, { primary: true, disabled: taken === type && getInventoryCount(type) < 1 });
      }
      text('Close the menu and grab it from your hip.', left, 822, 20, C.dim);
    } else if (item.placeable && onPlace) {
      const have = getInventoryCount(type) > 0;
      button('place', have ? `Place ${item.name.toLowerCase()}` : `No ${item.name.toLowerCase()} in inventory`, left, 776, width, 72, { primary: have, disabled: !have });
      text(renderer.xr.isPresenting ? 'You pick the spot, then pull the trigger. Y backs out.' : 'You pick the spot, then click. Y backs out.', left, 872, 20, C.dim);
    }
    footer();
  }

  function footer() {
    const p = PANELS.detail;
    text(renderer.xr.isPresenting ? 'Point and pull the trigger to choose' : 'Y or Esc closes', p.x + p.w / 2, 902, 19, C.dim, 400, 'center');
  }

  function draw() {
    dirty = false; controls = [];
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    drawLeft(); drawYou(); drawDetail();
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
      if (control.id === 'inventory' || control.id === 'crafting') node.setAttribute('aria-pressed', String(tab === control.id));
      node.style.cssText = `left:${control.x / WIDTH * 100}%;top:${control.y / HEIGHT * 100}%;width:${control.w / WIDTH * 100}%;height:${control.h / HEIGHT * 100}%`;
    }
  }

  function setHover(id) { if (hovered !== id) { hovered = id; dirty = true; } }
  function say(value) { message = value; announcement.textContent = value; }

  function activate(id, hand = null) {
    if (!open || controls.find(control => control.id === id)?.disabled) return;
    if (id === 'close') { setOpen(false); return; }
    message = '';
    if (id === 'inventory') {
      tab = id;
      const first = getInventoryItems()[0];
      if (selected.kind === 'recipe') selected = first ? { kind: 'item', id: first.type } : { kind: 'none' };
    }
    if (id === 'crafting') { tab = id; selected = { kind: 'recipe', id: RECIPES[0].id }; }
    if (id.startsWith('recipe:')) selected = { kind: 'recipe', id: id.slice(7) };
    if (id.startsWith('item:')) selected = { kind: 'item', id: id.slice(5) };
    if (id.startsWith('slot:')) {
      const side = id.slice(5);
      // Clicking an empty hip with a tool selected puts it there.
      const carrying = selected.kind === 'item' && ITEMS[selected.id]?.equippable;
      if (carrying && !tools?.getHipSlots()[side]) equip(selected.id, side);
      else selected = { kind: 'slot', id: side };
    }
    if (id === 'back') selected = { kind: 'back' };
    if (id === 'takeoff' && backpack) {
      const result = backpack.takeOff();
      say(result.message);
    }
    if (id.startsWith('equip:')) equip(selected.id, id.slice(6));
    if (id === 'unequip' && selected.kind === 'slot') {
      const type = tools?.getHipSlots()[selected.id];
      if (type && tools.unequip(selected.id)) { say(`${ITEMS[type].name} back in your inventory.`); selected = { kind: 'item', id: type }; tab = 'inventory'; }
    }
    if (id === 'previous') page = Math.max(0, page - 1);
    if (id === 'next') page++;
    if (id === 'craft') {
      const name = getRecipeStatus(selected.id)?.recipe.name;
      say(craftItem(selected.id) ? `Crafted: ${name}. It’s in your inventory.` : 'Not enough materials.');
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
      say(`${ITEMS[type].name} on your ${side} hip.`);
      selected = { kind: 'slot', id: side };
    } else say(getInventoryCount(type) < 1 ? `No ${ITEMS[type].name.toLowerCase()} in your inventory.` : `${ITEMS[type].name} isn’t ready yet.`);
  }

  function setOpen(value) {
    if (open === value) return;
    open = value; hovered = ''; message = ''; dirty = true;
    overlay.hidden = !open || renderer.xr.isPresenting; panel.visible = open && renderer.xr.isPresenting;
    if (open) {
      previousFocus = document.activeElement;
      if (tab === 'inventory' && selected.kind !== 'slot' && selected.kind !== 'back') {
        const first = getInventoryItems()[0];
        if (!(selected.kind === 'item' && getInventoryCount(selected.id) > 0)) selected = first ? { kind: 'item', id: first.type } : { kind: 'none' };
      }
      if (renderer.xr.isPresenting) {
        const view = renderer.xr.getCamera(); view.getWorldPosition(headPosition); view.getWorldDirection(forward);
        forward.y = 0; if (forward.lengthSq() < .01) forward.set(0, 0, -1); forward.normalize();
        panel.position.copy(headPosition).addScaledVector(forward, 1.5); panel.position.y -= .1;
        panel.rotation.set(0, Math.atan2(-forward.x, -forward.z), 0); panel.updateMatrixWorld(true);
      }
      draw();
      if (!renderer.xr.isPresenting) buttons.querySelector('[data-action="inventory"]')?.focus();
    } else {
      rays.forEach(ray => { ray.visible = false; });
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

  function update() {
    const session = renderer.xr.getSession();
    const visible = session?.visibilityState === 'visible';
    const sources = [...(session?.inputSources || [])];
    const y = visible && Boolean(sources.find(source => source.handedness === 'left')?.gamepad?.buttons[5]?.pressed);
    if (y && !yDown) setOpen(!open);
    yDown = y;
    if (session && !visible && open) setOpen(false);
    let hover = '', pendingAction = null, pendingHand = null;
    controllers.forEach((controller, index) => {
      // Use the connected hand source; source order can change after a reconnect.
      const source = states[index].inputSource;
      const pressed = visible && Boolean(source?.gamepad?.buttons[0]?.pressed);
      const line = rays[index]; line.visible = false;
      if (open && renderer.xr.isPresenting && visible && source?.targetRayMode === 'tracked-pointer' && controller.visible) {
        controller.updateWorldMatrix(true, false); origin.setFromMatrixPosition(controller.matrixWorld);
        rotation.extractRotation(controller.matrixWorld); forward.set(0, 0, -1).applyMatrix4(rotation);
        raycaster.set(origin, forward);
        const hit = raycaster.intersectObject(panel, false)[0];
        line.visible = true; line.scale.z = hit ? hit.distance : 1.8;
        if (hit?.uv) {
          const control = hitMenuControl(controls, hit.uv.x * WIDTH, (1 - hit.uv.y) * HEIGHT);
          if (control && !control.disabled) {
            hover = control.id;
            if (pressed && !triggerDown[index]) { pendingAction = control.id; pendingHand = states[index].handedness || null; }
          }
        }
      }
      triggerDown[index] = pressed;
    });
    if (pendingAction) activate(pendingAction, pendingHand);
    if (renderer.xr.isPresenting) setHover(hover);
    if (open) {
      const current = JSON.stringify([getInventoryItems(), tools?.getHipSlots?.(), Object.values(getSurvivalStats()).map(Math.round), isPackWorn()]);
      if (current !== snapshot) { snapshot = current; dirty = true; }
      if (dirty) draw();
    }
  }
  renderer.xr.addEventListener('sessionstart', () => { setOpen(false); yDown = false; triggerDown.fill(false); });
  renderer.xr.addEventListener('sessionend', () => { setOpen(false); yDown = false; triggerDown.fill(false); });
  return { update, setOpen, toggle: () => setOpen(!open), isOpen: () => open };
}

export const MENU_SIZE = Object.freeze({ width: WIDTH, height: HEIGHT, metres: PANEL_WIDTH_METRES });
