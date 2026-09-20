import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPickupNotice } from '../src/pickup-notice.js';

test('pickup notices display rock/stick labels, survive simultaneous storage, then expire in VR and desktop', () => {
  const previous = globalThis.document;
  const children = [];
  const ctx = new Proxy({}, { get: (target, key) => target[key] ?? (() => {}) });
  globalThis.document = {
    body: { append: node => children.push(node) },
    createElement: () => ({ style: {}, setAttribute() {}, getContext: () => ctx }),
  };
  try {
    const camera = new THREE.PerspectiveCamera();
    const events = {};
    const renderer = { xr: { isPresenting: true, addEventListener: (name, cb) => { events[name] = cb; } } };
    const notice = createPickupNotice({ camera, renderer });
    const hud = children[0], panel = camera.getObjectByName('Resource pickup notice');
    notice.show('stick'); notice.show('stone'); notice.update(0);
    assert.equal(hud.textContent, '1 stick\n1 rock');
    assert.equal(panel.visible, true); assert.equal(hud.hidden, true);
    notice.update(2); assert.equal(panel.visible, true);
    assert.ok(panel.material.opacity < 1);
    notice.update(.3); assert.equal(panel.visible, false);
    renderer.xr.isPresenting = false; notice.show('stone'); notice.update(0);
    assert.equal(hud.hidden, false); assert.equal(panel.visible, false);
    assert.equal(hud.textContent, '1 rock');
    events.sessionend(); assert.equal(hud.hidden, true);
  } finally { globalThis.document = previous; }
});
