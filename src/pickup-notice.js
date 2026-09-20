import * as THREE from 'three';

export function createPickupNotice({ camera, renderer }) {
  const hud = document.createElement('div');
  hud.id = 'pickup-notice'; hud.hidden = true; hud.setAttribute('role', 'status');
  document.body.append(hud);
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 192;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.18), material);
  panel.name = 'Resource pickup notice'; panel.position.set(0, -0.25, -0.9);
  panel.renderOrder = 100; panel.visible = false; camera.add(panel);
  let entries = [];
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '600 36px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    entries.forEach((entry, index) => {
      ctx.fillStyle = 'rgba(8, 28, 31, 0.85)'; ctx.fillRect(76, index * 62 + 3, 360, 54);
      ctx.fillStyle = '#e7f2ec'; ctx.fillText(entry.label, 256, index * 62 + 30);
    });
    texture.needsUpdate = true;
    hud.textContent = entries.map(entry => entry.label).join('\n');
  }
  function show(type) {
    if (type !== 'stick' && type !== 'stone') return;
    entries = [...entries, { label: type === 'stone' ? '1 rock' : '1 stick', time: 2.2 }].slice(-3);
    draw();
  }
  function update(dt) {
    entries.forEach(entry => { entry.time -= Math.max(0, dt || 0); });
    const alive = entries.filter(entry => entry.time > 0);
    if (alive.length !== entries.length) { entries = alive; draw(); }
    hud.hidden = !entries.length || renderer.xr.isPresenting;
    panel.visible = entries.length > 0 && renderer.xr.isPresenting;
    const opacity = entries.length ? Math.min(1, entries.at(-1).time / 0.35) : 0;
    material.opacity = opacity; hud.style.opacity = String(opacity);
  }
  renderer.xr.addEventListener('sessionend', () => { entries = []; update(0); });
  return { show, update };
}
