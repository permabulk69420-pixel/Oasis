// Dev tool: finds tail joint angles for the stinger's poses, by random search over the real skeleton and the real pose code.
//   node tools/stinger-lab/tail_explore.mjs strike|wind|print
import * as THREE from 'three';
import { loadStingerModel } from '../../tests/helpers/stinger-model.js';
import { createStingerPoser, POSE_REST, JOINTS } from '../../src/stinger-pose.js';

const model = loadStingerModel(0);
const poser = createStingerPoser(model.group);
const tipLocal = model.tipOf('Stinger');
const tailBones = ['Tail1', 'Tail2', 'Tail3', 'Tail4', 'Tail5', 'Stinger'];
function measure(pose, joints) {
  poser.apply({ ...POSE_REST, ...pose }, 0, joints);
  model.group.updateMatrixWorld(true);
  const joint = tailBones.map(n => poser.bones[n].getWorldPosition(new THREE.Vector3()));
  const tip = poser.bones.Stinger.localToWorld(tipLocal.clone());
  return { joint, tip, head: poser.bones.Head.getWorldPosition(new THREE.Vector3()) };
}
function show(label, m) {
  console.log(label.padEnd(8), 'tip', m.tip.toArray().map(v => v.toFixed(2)).join(', '), '| joints (z,y):', m.joint.map(p => `${p.z.toFixed(2)},${p.y.toFixed(2)}`).join('  '));
}
const mode = process.argv[2] || 'print';
if (mode === 'print') {
  show('rest', measure({}, JOINTS));
  show('alert', measure({ alert: 1 }, JOINTS));
  show('windup', measure({ windup: 1, alert: 1 }, JOINTS));
  show('strike', measure({ windup: 1, strike: 1, alert: 1 }, JOINTS));
  show('hurt', measure({ hurt: 1 }, JOINTS));
  show('dead', measure({ dead: 1 }, JOINTS));
}
// clearance of the tail's centreline over the body: the body and its spikes top out at about 0.5 m between z = -0.65 and 0.45
function clearance(m) {
  let worst = 9;
  const pts = [new THREE.Vector3(0, 0.31, -0.655), ...m.joint, m.tip];
  for (let i = 0; i < pts.length - 1; i++) for (let s = 0; s <= 1; s += 0.1) {
    const p = pts[i].clone().lerp(pts[i + 1], s);
    if (p.z > -0.5 && p.z < 0.5) worst = Math.min(worst, p.y - 0.62);
  }
  return worst;
}
function search(label, build, score, steps = 40000) {
  let best = null;
  for (let i = 0; i < steps; i++) {
    const params = best && i > steps / 2 ? best.params.map((v, k) => v + (Math.random() - 0.5) * 0.12 * (1 - i / steps)) : build();
    const result = score(params);
    if (!best || result.score < best.score) best = { ...result, params };
  }
  console.log(label, 'best score', best.score.toFixed(4), 'params', best.params.map(v => v.toFixed(3)).join(', '));
  return best;
}
if (mode === 'strike') {
  const target = new THREE.Vector3(0, 0.05, 0.95);
  const best = search('strike', () => [1 + Math.random() * 1.4, -0.6 + Math.random() * 0.6, -0.6 + Math.random() * 0.6, -0.6 + Math.random() * 0.6, -0.6 + Math.random() * 0.6, -0.5 + Math.random()], p => {
    const j = { ...JOINTS, tailHit: p.slice(0, 5), stingerHit: p[5], tailWind: JOINTS.tailHit, stingerWind: JOINTS.stingerHit };
    const m = measure({ windup: 1, strike: 1, alert: 1 }, j);
    const clear = clearance(m);
    const smoothness = p.slice(1, 5).reduce((s, v, k, a) => s + (k ? (v - a[k - 1]) ** 2 : 0), 0);
    return { score: m.tip.distanceTo(target) * 3 + Math.max(0, 0.12 - clear) * 6 + smoothness * 0.3 + (m.tip.y < 0 ? 5 : 0), m };
  });
  show('strike', best.m);
  console.log('tailHit', JSON.stringify(best.params.slice(0, 5).map(v => +v.toFixed(2))), 'stingerHit', +best.params[5].toFixed(2), 'clearance', clearance(best.m).toFixed(2));
}
if (mode === 'dead') {
  // the tail lies on the sand behind the body, curling round to one side: every joint low, none under the ground, bending evenly
  const best = search('dead', () => [-1.2 + Math.random() * 1.2, -0.5 + Math.random() * 1.0, -0.5 + Math.random() * 1.0, -0.5 + Math.random() * 1.0, -0.5 + Math.random() * 1.0, -0.4 + Math.random() * 0.8, 0.05 + Math.random() * 0.2], p => {
    const j = { ...JOINTS, tailDead: p.slice(0, 5), stingerDead: p[5], tailDeadYaw: p[6] };
    const m = measure({ dead: 1 }, j);
    let score = 0;
    for (const q of [...m.joint.slice(1), m.tip]) score += Math.max(0, q.y - 0.22) * 2 + Math.max(0, 0.08 - q.y) * 8;
    score += Math.abs(m.tip.z + 1.5) * 0.4 + Math.max(0, 0.9 - Math.abs(m.tip.x)) * 0.5; // behind the body, off to one side
    score += p.slice(1, 5).reduce((s, v, k, a) => s + (k ? (v - a[k - 1]) ** 2 : 0), 0) * 0.2;
    return { score, m };
  });
  show('dead', best.m);
  console.log('tailDead', JSON.stringify(best.params.slice(0, 5).map(v => +v.toFixed(2))), 'stingerDead', +best.params[5].toFixed(2), 'tailDeadYaw', +best.params[6].toFixed(2));
}
