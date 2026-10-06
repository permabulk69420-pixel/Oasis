import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createVultureFlight, ALIEN_VULTURE } from '../src/alien-vulture.js';
import { createVulturePoser, VULTURE_BONES, VULTURE_POSE } from '../src/vulture-pose.js';

function seeded(seed = 7) {
  let a = seed;
  return () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; };
}

test('a vulture circles out over the sand, facing where it flies and banked into the turn', () => {
  const flight = createVultureFlight({ rng: seeded(), groundAt: () => 5 });
  flight.place(0, 0);
  const s = flight.state;
  const d = Math.hypot(s.cx, s.cz);
  assert.ok(d >= ALIEN_VULTURE.place[0] - 1 && d <= ALIEN_VULTURE.place[1] + 1, `circle ${d} m away`);
  for (let i = 0; i < 300; i++) {
    const x0 = s.x, z0 = s.z;
    flight.update(1 / 30, 0, 0);
    assert.ok(Math.abs(Math.hypot(s.x - s.cx, s.z - s.cz) - s.radius) < 1e-6);
    const heading = Math.atan2(s.x - x0, s.z - z0);
    assert.ok(Math.abs(Math.atan2(Math.sin(heading - s.yaw), Math.cos(heading - s.yaw))) < 0.2, 'faces the way it flies (the drift with the wind aside)');
    // the circle's middle is on the side it banks toward: its left (+x of the bird) when the left wing is down (roll < 0)
    const leftX = Math.cos(s.yaw), leftZ = -Math.sin(s.yaw);
    const toCentre = (s.cx - s.x) * leftX + (s.cz - s.z) * leftZ;
    assert.ok(Math.sign(toCentre) === -Math.sign(s.roll), 'banks into the turn');
    const h = s.y - 5;
    assert.ok(h >= ALIEN_VULTURE.altitude[0] - 1 && h <= ALIEN_VULTURE.altitude[1] + 1);
  }
});

test('a vulture that has drifted too far is put back near you, and never over a place to keep off', () => {
  const flight = createVultureFlight({ rng: seeded(3), groundAt: () => 0, avoid: (x, z) => x > 0 && x < 2000 });
  flight.place(0, 0);
  const s = flight.state;
  assert.ok(s.cx + s.radius + ALIEN_VULTURE.keepOff < 0, 'keeps the whole circle off the place');
  flight.update(1 / 30, 5000, 0);
  assert.ok(Math.hypot(s.cx - 5000, s.cz) <= ALIEN_VULTURE.place[1] + 1, 'put back near you');
});

test('the vulture poser finds its bones and turns a wing about the model axes from its rest', () => {
  // a skeleton like the model's, every bone with a rotated rest (as Blender makes them)
  const root = new THREE.Group();
  const made = {};
  const parentOf = name => {
    if (name === 'root') return root;
    if (name === 'body') return made.root;
    if (name.startsWith('neck_base') || name === 'tail' || /^(wing_upper|rearwing_upper|thigh)/.test(name)) return made.body;
    const chain = { neck_mid: 'neck_base', neck_top: 'neck_mid', head: 'neck_top' };
    if (chain[name]) return made[chain[name]];
    const [part, side] = name.split('.');
    return made[`${{ wing_fore: 'wing_upper', wing_hand: 'wing_fore', rearwing_hand: 'rearwing_upper', shin: 'thigh', foot: 'shin' }[part]}.${side}`];
  };
  for (const name of VULTURE_BONES) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(name.endsWith('.L') ? 0.3 : name.endsWith('.R') ? -0.3 : 0, 0.2, 0);
    bone.quaternion.setFromEuler(new THREE.Euler(0.3, -0.7, 0.9));
    made[name] = bone;
    parentOf(name).add(bone);
  }
  const poser = createVulturePoser(root);
  assert.ok(poser);
  // the wing from shoulder to elbow, in the model's frame
  const wing = () => {
    root.updateMatrixWorld(true);
    return made['wing_fore.L'].getWorldPosition(new THREE.Vector3()).sub(made['wing_upper.L'].getWorldPosition(new THREE.Vector3()));
  };
  poser.apply({ ...VULTURE_POSE, flap: 0 });
  const level = wing();
  poser.apply({ ...VULTURE_POSE, flap: 0.5 });
  const raised = wing();
  // a flap of 0.5 is that much more roll about the forward axis (+Z), which lifts a wing that reaches out to the left
  const expected = level.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), 0.5);
  assert.ok(raised.distanceTo(expected) < 1e-6, `${raised.toArray()} not ${expected.toArray()}`);
  assert.equal(createVulturePoser(new THREE.Group()), null);
});
