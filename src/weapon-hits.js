import * as THREE from 'three';
import { pulseHaptics } from './haptics.js';

// Hitting things with what you hold or throw. Every tool kind that can hurt something has a `hit` entry (src/spear.js, src/axe.js):
// the point on the tool that does the damage, how thick it is, how fast it must be moving to count and how much it does at full speed.
// Each frame the speed of that point is measured; if it is fast enough and inside a target, the target is hurt, by more the faster it
// was going. A held tool's speed is measured relative to your body, so walking into something with a spear out does nothing, and a
// thrown tool's in the world. It cannot hurt the same thing twice in half a second, so one swing is one blow. Nothing is allocated
// per frame. A target is anything with `hitTest(point, radius)` and `hurt(amount)`.

export const HITS = Object.freeze({
  cooldown: 0.5, // seconds before the same tool can land another blow
  minFraction: 0.35, // a blow that only just counts does this share of the full damage
  heldHaptic: [0.9, 90], // [strength, ms] in the hand that struck
  thrownBounce: 0.15, // a thrown tool bounces off with this much of its speed, back the way it came
});

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// How much a blow does: `speed` between the tool's minimum and its full speed scales between minFraction and 1 of its damage.
export function blowDamage(hit, speed) {
  if (!(speed >= hit.minSpeed)) return 0;
  const t = clamp((speed - hit.minSpeed) / Math.max(1e-6, hit.fullSpeed - hit.minSpeed), 0, 1);
  return hit.damage * (HITS.minFraction + (1 - HITS.minFraction) * t);
}

export function createWeaponHits({ tools, rig = null, targets = [] }) {
  const records = new WeakMap();
  const local = new THREE.Vector3();
  const world = new THREE.Vector3();
  const sample = new THREE.Vector3();

  function recordOf(instance) {
    let record = records.get(instance);
    if (!record) { record = { previous: new THREE.Vector3(), have: false, held: false, cool: 0 }; records.set(instance, record); }
    return record;
  }

  function update(dt) {
    if (!(dt > 1e-4)) return;
    for (const instance of tools.getInstances()) {
      const hit = instance.kind.hit;
      if (!hit) continue;
      const record = recordOf(instance);
      record.cool = Math.max(0, record.cool - dt);
      const held = Boolean(instance.heldBy);
      const flying = Boolean(instance.fall) && instance.fall.phase === 'air';
      if (!held && !flying) { record.have = false; continue; }

      instance.root.updateWorldMatrix(true, false);
      hit.point(local, instance);
      world.copy(local).applyMatrix4(instance.root.matrixWorld);
      sample.copy(world);
      if (held && rig) rig.worldToLocal(sample); // relative to your body, so walking is not a swing
      const speed = record.have && record.held === held ? sample.distanceTo(record.previous) / dt : 0;
      record.previous.copy(sample);
      record.have = true;
      record.held = held;

      if (record.cool > 0 || speed < hit.minSpeed) continue;
      const amount = blowDamage(hit, speed);
      for (const target of targets) {
        if (!target.hitTest(world, hit.radius)) continue;
        if (!target.hurt(amount)) continue;
        record.cool = HITS.cooldown;
        if (held) pulseHaptics(instance.heldBy, ...HITS.heldHaptic);
        else if (flying) {
          // a thrown tool bounces off and drops
          const { velocity, spin } = instance.fall;
          velocity.multiplyScalar(-HITS.thrownBounce);
          velocity.y = Math.min(velocity.y, 0) - 1;
          spin.multiplyScalar(0.3);
        }
        break;
      }
    }
  }

  return { update, addTarget: target => targets.push(target) };
}
