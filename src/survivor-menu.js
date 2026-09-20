import * as THREE from 'three';
import { createGripHold } from './grip-hold.js';
import { ITEMS, RECIPES, getRecipeStatus, craftItem } from './crafting.js';
import { BASE_CARRY_WEIGHT, getInventoryCount, getInventoryItems, getInventoryWeight } from './inventory.js';

const WIDTH = 1440, HEIGHT = 900;
const C = { background: '#0a1b20', panel: '#112a30', cell: '#18383f', line: '#31565c', ink: '#e7f2ec', muted: '#99b7b8', accent: '#8ed4bf', gold: '#debd7e', missing: '#e9a18b' };
export function hitMenuControl(controls, x, y) {
  return controls.find(control => x >= control.x && x <= control.x + control.w && y >= control.y && y <= control.y + control.h) || null;
}

export function createSurvivorMenu({ scene, renderer, states, onToggle = () => {}, onEquip = () => ({ ok: false, message: 'Equipment unavailable.' }) }) {
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
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.76, 1.10), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  panel.name = 'Survivor inventory menu'; panel.visible = false;
  scene.add(panel);
  const raycaster = new THREE.Raycaster();
  const rotation = new THREE.Matrix4(), origin = new THREE.Vector3(), forward = new THREE.Vector3();
  const headPosition = new THREE.Vector3();
  const rays = controllers.map(controller => {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: C.accent, depthTest: false, toneMapped: false }));
    line.name = 'Inventory pointer'; line.renderOrder = 10; line.visible = false;
    controller.add(line); return line;
  });
  const triggerDown = controllers.map(() => false);
  const gripHolds = controllers.map(() => createGripHold());
  let equipProgress = 0, equipTarget = '';
  let open = false, tab = 'inventory', selection = 'axe', selectedItem = '', page = 0;
  let yDown = false, dirty = true, controls = [], hovered = '', message = '', snapshot = '', previousFocus = null;

  function rect(x, y, w, h, fill, stroke = null) {
    ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1); }
  }
  function text(label, x, y, size = 24, color = C.ink, weight = 400) {
    ctx.font = `${weight} ${size}px system-ui, sans-serif`; ctx.fillStyle = color; ctx.fillText(label, x, y);
  }
  function line(x, y, w) { rect(x, y, w, 1, C.line); }
  function control(id, label, x, y, w, h, { active = false, disabled = false } = {}) {
    controls.push({ id, label, x, y, w, h, disabled });
    rect(x, y, w, h, active ? '#29584f' : hovered === id && !disabled ? '#2d5057' : C.cell, active ? C.accent : C.line);
    text(label, x + 18, y + h / 2 + 8, 23, disabled ? C.muted : C.ink, active ? 600 : 400);
  }
  function icon(type, x, y, scale = 1) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale); ctx.lineCap = 'round';
    if (type === 'stick' || type === 'axe' || type === 'torch') {
      ctx.strokeStyle = '#b99a6c'; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(-17, 26); ctx.lineTo(15, -27); ctx.stroke();
      if (type === 'stick') { ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(2, -5); ctx.lineTo(-13, -22); ctx.stroke(); }
      if (type === 'axe') { ctx.fillStyle = '#a8b7b4'; ctx.beginPath(); ctx.moveTo(4, -24); ctx.lineTo(29, -34); ctx.lineTo(36, -8); ctx.lineTo(14, -5); ctx.closePath(); ctx.fill(); }
      if (type === 'torch') { ctx.fillStyle = C.gold; ctx.beginPath(); ctx.moveTo(4, -14); ctx.quadraticCurveTo(-4, -29, 20, -46); ctx.quadraticCurveTo(13, -27, 28, -24); ctx.quadraticCurveTo(26, -12, 4, -14); ctx.fill(); }
    } else if (type === 'stone') {
      ctx.fillStyle = '#a8b7b4'; ctx.beginPath(); ctx.moveTo(-30, 10); ctx.lineTo(-16, -23); ctx.lineTo(14, -29); ctx.lineTo(32, -3); ctx.lineTo(21, 23); ctx.lineTo(-10, 28); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#758e8e'; ctx.beginPath(); ctx.moveTo(-16, -23); ctx.lineTo(-4, 10); ctx.lineTo(21, 23); ctx.lineTo(-10, 28); ctx.lineTo(-30, 10); ctx.closePath(); ctx.fill();
    } else {
      ctx.strokeStyle = C.accent; ctx.lineWidth = 4;
      for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 12, 25); ctx.quadraticCurveTo(20 + i * 10, -5, i * 14, -30); ctx.stroke(); }
    }
    ctx.restore();
  }
  function draw() {
    dirty = false; controls = [];
    rect(0, 0, WIDTH, HEIGHT, C.background, C.line);
    rect(0, 0, 6, HEIGHT, C.accent);
    text('OASIS', 38, 57, 34, C.ink, 600); text('/  SURVIVOR', 172, 57, 22, C.muted);
    text('LEVEL 01', 1080, 54, 22, C.gold, 600);
    control('close', 'Close  /  Y', 1210, 24, 192, 52);
    line(38, 96, 1364);
    rect(28, 118, 640, 670, C.panel, C.line);
    rect(686, 118, 326, 670, C.panel, C.line);
    rect(1030, 118, 382, 670, C.panel, C.line);
    control('inventory', 'Inventory', 48, 138, 284, 56, { active: tab === 'inventory' });
    control('crafting', 'Crafting', 346, 138, 302, 56, { active: tab === 'crafting' });
    if (tab === 'inventory') drawInventory(); else drawCrafting();
    text('SURVIVOR STATS', 710, 168, 22, C.accent, 600);
    text('Level 1  /  0 XP', 710, 211, 24);
    text('Progression coming later', 710, 244, 18, C.muted);
    line(710, 266, 278);
    const stats = [['Health', '100 / 100'], ['Stamina', '100 / 100'], ['Food', '100 / 100'], ['Water', '100 / 100'], ['Melee damage', '100%'], ['Crafting skill', '100%']];
    stats.forEach(([name, value], i) => {
      const y = 306 + i * 65;
      text(name, 710, y, 20, C.muted); text(value, 866, y, 20);
      rect(710, y + 13, 278, 4, C.line); rect(710, y + 13, 278, 4, '#4f8d80');
    });
    text('Preview values', 710, 733, 20, C.gold);
    text('No skill effects yet', 710, 763, 18, C.muted);
    text('EQUIPMENT', 1054, 168, 22, C.accent, 600);
    text('Armour / weapons / gear', 1054, 207, 21, C.muted);
    rect(1054, 234, 334, 416, C.background, C.line);
    // A quiet mannequin outline reserves the future equipment space.
    ctx.strokeStyle = C.line; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(1221, 320, 35, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(1174, 491); ctx.lineTo(1174, 382); ctx.quadraticCurveTo(1221, 359, 1268, 382); ctx.lineTo(1268, 491);
    ctx.moveTo(1174, 382); ctx.lineTo(1137, 462); ctx.moveTo(1268, 382); ctx.lineTo(1305, 462);
    ctx.moveTo(1194, 491); ctx.lineTo(1185, 594); ctx.moveTo(1248, 491); ctx.lineTo(1257, 594); ctx.stroke();
    text('Equipment slots coming later', 1054, 700, 21, C.muted);
    text('Tools: hold grip for 3 seconds', 1054, 734, 20, C.muted);
    const weight = getInventoryWeight();
    text(`CARRY WEIGHT  ${weight} / ${BASE_CARRY_WEIGHT}`, 48, 830, 22, weight > BASE_CARRY_WEIGHT ? C.missing : C.accent, 600);
    text(equipTarget ? `Equipping ${ITEMS[equipTarget].name.toLowerCase()} · ${(equipProgress * 3).toFixed(1)} / 3 seconds` : message || 'Collect sticks and stones. Release them at your chest to store.', 48, 867, 21, message ? C.gold : C.muted);
    text(renderer.xr.isPresenting ? 'Point + trigger to select' : 'Y / Esc to close', 1080, 840, 19, C.muted);
    texture.needsUpdate = true;
    syncButtons();
  }
  function drawInventory() {
    const items = getInventoryItems();
    const pages = Math.max(1, Math.ceil(items.length / 6)); page = Math.min(page, pages - 1);
    text('BACKPACK', 48, 232, 20, C.muted, 600);
    text(`${items.length} item types`, 480, 232, 19, C.muted);
    for (let i = 0; i < 6; i++) {
      const item = items[page * 6 + i], x = 48 + (i % 3) * 204, y = 252 + Math.floor(i / 3) * 179;
      rect(x, y, 192, 165, C.cell, item?.type === selectedItem ? C.accent : C.line);
      if (item) {
        controls.push({ id: `item:${item.type}`, label: `${ITEMS[item.type]?.name || item.type}, ${item.count}`, x, y, w: 192, h: 165 });
        icon(item.type, x + 96, y + 62);
        text(`x${item.count}`, x + 132, y + 30, 22, C.accent, 600);
        text(ITEMS[item.type]?.name || item.type, x + 16, y + 126, 23);
        text(ITEMS[item.type]?.category || 'ITEM', x + 16, y + 151, 15, C.muted);
        if (equipTarget === item.type) rect(x + 2, y + 158, 188 * equipProgress, 5, C.accent);
      } else text('—', x + 86, y + 93, 24, C.line);
    }
    if (!items.length) {
      text('Your backpack is empty', 48, 658, 25);
      text('Gather resources around the water.', 48, 696, 22, C.muted);
    } else {
      const item = ITEMS[selectedItem];
      text(item?.name || 'Select an item to inspect it', 48, 658, 25);
      // Keep the description inside the left column at VR-readable text sizes.
      const description = item?.description || 'Tools: point at an item and hold grip for 3 seconds.';
      wrap(description, 48, 692, 590, 22);
    }
    if (pages > 1) {
      control('previous', 'Previous', 48, 724, 170, 46, { disabled: page === 0 });
      control('next', 'Next', 478, 724, 170, 46, { disabled: page === pages - 1 });
    }
  }
  function wrap(value, x, y, width, size = 22) {
    ctx.font = `400 ${size}px system-ui, sans-serif`;
    let row = '';
    for (const word of value.split(' ')) {
      if (ctx.measureText(`${row} ${word}`).width > width) { text(row, x, y, size, C.muted); row = word; y += size + 9; }
      else row = row ? `${row} ${word}` : word;
    }
    text(row, x, y, size, C.muted);
  }
  function drawCrafting() {
    text('HAND CRAFTING', 48, 232, 20, C.muted, 600);
    RECIPES.forEach((recipe, index) => {
      const x = 48 + index * 306;
      control(`recipe:${recipe.id}`, recipe.name, x, 252, 294, 110, { active: selection === recipe.id });
      icon(recipe.id, x + 245, 308, .8);
    });
    const { recipe, ingredients, canCraft } = getRecipeStatus(selection);
    text(recipe.name, 48, 409, 30, C.ink, 600);
    text(recipe.description, 48, 447, 22, C.muted);
    text('MATERIALS', 48, 497, 18, C.accent, 600); text('HAVE / NEED', 482, 497, 18, C.muted);
    ingredients.forEach(({ type, owned, required }, index) => {
      const y = 535 + index * 48;
      text(ITEMS[type].name, 48, y, 24); text(`${owned} / ${required}`, 518, y, 24, owned >= required ? C.accent : C.missing);
      line(48, y + 14, 600);
    });
    control('craft', canCraft ? 'Craft 1' : 'Need more materials', 48, 626, 600, 64, { active: canCraft, disabled: !canCraft });
    text(`Produces 1 ${recipe.name.toLowerCase()} in your inventory`, 48, 727, 21, C.muted);
    text('Starter recipe • no skill requirement', 48, 761, 19, C.muted);
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
  function activate(id) {
    if (!open || controls.find(control => control.id === id)?.disabled) return;
    if (id === 'close') { setOpen(false); return; }
    if (id === 'inventory' || id === 'crafting') { tab = id; message = ''; }
    if (id.startsWith('recipe:')) { selection = id.slice(7); message = ''; }
    if (id.startsWith('item:')) selectedItem = id.slice(5);
    if (id === 'previous') page = Math.max(0, page - 1);
    if (id === 'next') page++;
    if (id === 'craft') {
      message = craftItem(selection) ? `${ITEMS[selection].name} crafted — added to inventory.` : 'Not enough materials.';
      announcement.textContent = message;
    }
    dirty = true;
  }
  function setOpen(value) {
    if (open === value) return;
    open = value; hovered = ''; message = ''; dirty = true;
    gripHolds.forEach(hold => hold.reset()); equipProgress = 0; equipTarget = '';
    overlay.hidden = !open || renderer.xr.isPresenting; panel.visible = open && renderer.xr.isPresenting;
    if (open) {
      previousFocus = document.activeElement;
      if (renderer.xr.isPresenting) {
        const view = renderer.xr.getCamera(); view.getWorldPosition(headPosition); view.getWorldDirection(forward);
        forward.y = 0; if (forward.lengthSq() < .01) forward.set(0, 0, -1); forward.normalize();
        panel.position.copy(headPosition).addScaledVector(forward, 1.45); panel.position.y -= .08;
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
  function update(dt = 0) {
    const session = renderer.xr.getSession();
    const visible = session?.visibilityState === 'visible';
    const sources = [...(session?.inputSources || [])];
    const y = visible && Boolean(sources.find(source => source.handedness === 'left')?.gamepad?.buttons[5]?.pressed);
    if (y && !yDown) setOpen(!open);
    yDown = y;
    if (session && !visible && open) setOpen(false);
    let hover = '', pendingAction = null;
    let nextProgress = 0, nextTarget = '';
    const equips = [];
    controllers.forEach((controller, index) => {
      // Use the connected hand source; source order can change after a reconnect.
      const source = states[index].inputSource;
      const pressed = visible && Boolean(source?.gamepad?.buttons[0]?.pressed);
      const line = rays[index]; line.visible = false;
      let pointedTool = null;
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
            if (tab === 'inventory' && ['item:axe', 'item:torch'].includes(control.id)) pointedTool = control.id.slice(5);
            if (pressed && !triggerDown[index]) pendingAction = control.id;
          }
        }
      }
      const gripping = visible && Boolean(source?.gamepad?.buttons[1]?.pressed);
      const emptyHand = states[index].objectGrip?.children.length === 0;
      if (pointedTool && gripping && !emptyHand && message !== 'Free this hand first.') { message = 'Free this hand first.'; dirty = true; }
      const hold = gripHolds[index].update(
        pointedTool && emptyHand && getInventoryCount(pointedTool) > 0 ? pointedTool : null,
        source, gripping, dt,
      );
      if (hold.progress > nextProgress) { nextProgress = hold.progress; nextTarget = pointedTool; }
      if (hold.complete) equips.push({ type: pointedTool, state: states[index] });
      triggerDown[index] = pressed;
    });
    // Quantize the progress repaint to tenths of a second on Quest.
    if (Math.floor(nextProgress * 30) !== Math.floor(equipProgress * 30) || nextTarget !== equipTarget) dirty = true;
    equipProgress = nextProgress; equipTarget = nextTarget;
    for (const request of equips) {
      if (!open) break;
      const result = onEquip(request.type, request.state);
      if (result.ok) { setOpen(false); pendingAction = null; break; }
      message = result.message; announcement.textContent = message;
      equipProgress = 0; equipTarget = ''; dirty = true;
    }
    if (pendingAction) activate(pendingAction);
    if (renderer.xr.isPresenting) setHover(hover);
    if (open) {
      const current = JSON.stringify(getInventoryItems());
      if (current !== snapshot) { snapshot = current; dirty = true; }
      if (dirty) draw();
    }
  }
  renderer.xr.addEventListener('sessionstart', () => { setOpen(false); yDown = false; triggerDown.fill(false); });
  renderer.xr.addEventListener('sessionend', () => { setOpen(false); yDown = false; triggerDown.fill(false); });
  return { update, setOpen, toggle: () => setOpen(!open), isOpen: () => open };
}
