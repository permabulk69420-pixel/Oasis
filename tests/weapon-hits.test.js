import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HITS, blowDamage, createWeaponHits } from '../src/weapon-hits.js';
import { createSpearKind } from '../src/spear.js';
import { createAxeKind } from '../src/axe.js';

const HIT = { damage: 30, minSpeed: 2, fullSpeed: 6, radius: 0.1 };

// A stand-in tool: a root at the origin with the hit point at the root, a kind with a hit entry, and a target that records blows.
function fixture({ held = true, hit = HIT } = {}) {
  const rig = new THREE.Group();
  const root = new THREE.Group();
  rig.add(root);
  rig.updateMatrixWorld(true);
  const instance = {
    root,
    kind: { hit: { ...hit, point: out => out.set(0, 0, 0) } },
    heldBy: held ? { handedness: 'right', inputSource: null } : null,
    fall: { phase: held ? 'held' : 'air', velocity: new THREE.Vector3(0, 0, -5), spin: new THREE.Vector3(1, 1, 1) },
  };
  const blows = [];
  const target = {
    hitTest: (point, radius) => point.distanceTo(new THREE.Vector3(0, 0, -1)) < 0.5 + radius,
    hurt: amount => { blows.push(amount); return true; },
  };
  const tools = { getInstances: () => [instance] };
  const hits = createWeaponHits({ tools, rig, targets: [target] });
  return { rig, root, instance, blows, target, hits };
}

// move the tool's root to z over dt and update
function moveTo(f, z, dt = 0.05) {
  f.root.position.z = z;
  f.rig.updateMatrixWorld(true);
  f.hits.update(dt);
}

test('blowDamage: nothing below the minimum speed, a share at the minimum, the full amount at full speed', () => {
  assert.equal(blowDamage(HIT, 0), 0);
  assert.equal(blowDamage(HIT, 1.99), 0);
  assert.equal(blowDamage(HIT, NaN), 0);
  assert.ok(Math.abs(blowDamage(HIT, 2) - 30 * HITS.minFraction) < 1e-9);
  assert.ok(Math.abs(blowDamage(HIT, 6) - 30) < 1e-9);
  assert.ok(Math.abs(blowDamage(HIT, 60) - 30) < 1e-9, 'never more than full');
  assert.ok(blowDamage(HIT, 4) > blowDamage(HIT, 3), 'faster hurts more');
});

test('a fast poke into the target hurts it once; a slow one does nothing', () => {
  const f = fixture();
  moveTo(f, 0); // first frame: no speed yet
  moveTo(f, -0.05); // 1 m/s: too slow, and not at the target anyway
  assert.equal(f.blows.length, 0);
  moveTo(f, -0.5, 0.05); // 9 m/s and at the target
  assert.equal(f.blows.length, 1);
  assert.ok(Math.abs(f.blows[0] - 30) < 1e-6, 'full speed, full damage');
  moveTo(f, -0.6, 0.05); // still fast inside the cooldown: one swing is one blow
  assert.equal(f.blows.length, 1);
  // after the cooldown it can land again
  for (let i = 0; i < 12; i++) moveTo(f, -0.6 - (i % 2 ? 0.2 : 0), 0.05);
  assert.ok(f.blows.length >= 2, 'a second blow lands after the cooldown');
  // a slow touch at the target does nothing
  const slow = fixture();
  moveTo(slow, -0.9);
  moveTo(slow, -0.91);
  assert.equal(slow.blows.length, 0);
});

test('a fast tool away from the target hurts nothing', () => {
  const f = fixture();
  f.root.position.set(5, 0, 0);
  f.rig.updateMatrixWorld(true);
  f.hits.update(0.05);
  f.root.position.set(5, 0, 1);
  f.rig.updateMatrixWorld(true);
  f.hits.update(0.05);
  assert.equal(f.blows.length, 0);
});

test('a held tool is measured against your body: walking into the target is not a blow, a swing is', () => {
  const f = fixture();
  f.hits.update(0.05);
  for (let i = 0; i < 6; i++) { // the whole rig runs at 9 m/s, the tool fixed in the hand
    f.rig.position.z -= 0.45;
    f.rig.updateMatrixWorld(true);
    f.hits.update(0.05);
  }
  f.rig.position.z = -0.9;
  f.rig.updateMatrixWorld(true);
  f.hits.update(0.05);
  assert.equal(f.blows.length, 0, 'running at it with the spear out does nothing');
  const g = fixture();
  moveTo(g, 0);
  moveTo(g, -0.5);
  assert.equal(g.blows.length, 1, 'the same speed with the hand is a blow');
});

test('a thrown tool is measured in the world, hurts, and bounces back', () => {
  const f = fixture({ held: false });
  f.instance.fall.velocity.set(0, 0, -9);
  moveTo(f, 0);
  moveTo(f, -0.45, 0.05);
  assert.equal(f.blows.length, 1);
  assert.ok(f.instance.fall.velocity.z > 0, 'bounced back the way it came');
  assert.ok(Math.abs(f.instance.fall.velocity.z) < 9 * 0.2, 'and lost most of its speed');
  assert.ok(f.instance.fall.velocity.y < 0, 'and drops');
  assert.ok(f.instance.fall.spin.length() < Math.sqrt(3), 'and its spin dies down');
});

test('a tool lying on the ground is never a weapon, and a target that refuses (already dead) starts no cooldown', () => {
  const f = fixture({ held: false });
  f.instance.fall.phase = 'ground';
  moveTo(f, 0);
  moveTo(f, -0.5);
  assert.equal(f.blows.length, 0);
  const g = fixture();
  let refuse = true;
  g.target.hurt = amount => { if (refuse) return false; g.blows.push(amount); return true; };
  moveTo(g, 0);
  moveTo(g, -0.5);
  assert.equal(g.blows.length, 0);
  refuse = false;
  moveTo(g, -0.7);
  assert.equal(g.blows.length, 1, 'no cooldown was spent on the refused blow');
});

test('tools without a hit entry are ignored, and a zero or tiny frame does nothing', () => {
  const f = fixture();
  delete f.instance.kind.hit;
  moveTo(f, 0);
  moveTo(f, -0.5);
  assert.equal(f.blows.length, 0);
  const g = fixture();
  g.hits.update(0);
  g.hits.update(NaN);
  assert.equal(g.blows.length, 0);
});

test('the spear and the axe carry hit entries: the spear hurts at the stone end, the axe at its head', () => {
  const spear = createSpearKind();
  const axe = createAxeKind({ scene: new THREE.Group() });
  for (const kind of [spear, axe]) assert.ok(kind.hit && kind.hit.damage > 0 && kind.hit.minSpeed < kind.hit.fullSpeed && kind.hit.radius > 0);
  const tip = spear.hit.point(new THREE.Vector3(), { kind: { shape: { top: 0.48 } } });
  assert.ok(tip.y > 0.3 && tip.x === 0 && tip.z === 0, 'the stone end of the shaft');
  const head = axe.hit.point(new THREE.Vector3(), { kind: axe });
  assert.ok(head.length() > 0.05, 'the axe head, not the hand');
  // four-ish spear pokes or three or four axe swings kill a 100 health creature at full speed
  assert.ok(Math.ceil(100 / spear.hit.damage) >= 3 && Math.ceil(100 / axe.hit.damage) >= 3, 'a fight is more than one blow');
});
