import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SKY_ISLAND, buildIsland, makeMeshGround } from '../src/sky-island-shape.js';
import { createSkyIslandGround } from '../src/sky-island-ground.js';
import { layoutPaths, createPathIndex } from '../src/sky-island-paths.js';
import { layoutSkyTrees, SKY_TREES } from '../src/sky-island-layout.js';
import { layoutRocks } from '../src/sky-island-rocks.js';
import { layoutIslandGlow } from '../src/sky-island-glow.js';
import { layoutIslandFlora } from '../src/island-flora-layout.js';
import { GROUND_GLOW, layoutGroundGlow, buildGroundGlowMesh, groundGlowNight, createIslandGroundGlow } from '../src/island-ground-glow.js';

const ground = createSkyIslandGround(SKY_ISLAND);
const { features } = ground;
const drawn = makeMeshGround(buildIsland(ground.baseY, SKY_ISLAND, features), SKY_ISLAND);
const paths = layoutPaths(features, SKY_ISLAND);
const pathIndex = createPathIndex(paths);
const palms = layoutSkyTrees(SKY_ISLAND, SKY_TREES, { features, pathIndex });
const rocks = layoutRocks({ ground: drawn, features, pathIndex, config: SKY_ISLAND, avoid: palms });
const glow = layoutIslandGlow({ ground: drawn, features, pathIndex, paths, config: SKY_ISLAND, obstacles: [...rocks.filter(r => r.r >= 0.3), ...palms.map(p => ({ x: p.x, z: p.z, r: 0.7 * p.scale }))] });
const flora = layoutIslandFlora({
  ground: drawn, features, pathIndex, paths, config: SKY_ISLAND, rocks, waterY: ground.baseY + features.lakeSpec.level,
  obstacles: [...palms.map(p => ({ x: p.x, z: p.z, r: 0.7 * p.scale })), ...glow.map(g => ({ x: g.x, z: g.z, r: 0.5 * g.scale, soft: true }))],
});

test('every light the island has makes a pool: each glow-tree, the arch, both stones, the mushroom patches, and the glow plants in groups', () => {
  const pools = layoutGroundGlow({ flora, glow });
  const count = kind => pools.filter(p => p.kind === kind).length;
  assert.equal(count('weepingTree'), flora.filter(i => i.type === 'weepingTree').length);
  assert.ok(count('weepingTree') >= 4);
  assert.equal(count('rootArch'), 1);
  assert.equal(count('standingStoneA') + count('standingStoneB'), 2);
  assert.equal(count('mushrooms'), flora.filter(i => i.type === 'mushrooms').length);
  const plants = pools.filter(p => p.kind === 'plants');
  assert.ok(plants.length >= 15 && plants.length < glow.length, `${plants.length} plant pools for ${glow.length} plants: grouped, not one each`);
  assert.ok(pools.length <= 220, `${pools.length} pools`);
  for (const p of pools) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z) && p.radius > 0.5 && p.radius <= 15, `${p.kind} radius ${p.radius}`);
    assert.ok(p.strength > 0 && p.strength <= 0.7, `${p.kind} strength ${p.strength}`);
  }
  const trees = pools.filter(p => p.kind === 'weepingTree');
  for (const other of pools) if (other.kind !== 'weepingTree') for (const t of trees) assert.ok(other.strength < t.strength || other.radius < t.radius, 'a tree is the biggest light in its place');
});

test('a plain list in, nothing in: no flowers, ferns, logs or rocks make pools, and nothing is fine', () => {
  assert.equal(layoutGroundGlow({ flora: flora.filter(i => !GROUND_GLOW.kinds[i.type]), glow: [] }).length, 0);
  assert.equal(layoutGroundGlow().length, 0);
  assert.equal(layoutGroundGlow({ glow: [{ x: 10, z: 10, scale: 1 }, { x: 11, z: 10.5, scale: 1 }] }).length, 1, 'two plants a metre apart are one pool');
  assert.equal(layoutGroundGlow({ glow: [{ x: 10, z: 10, scale: 1 }, { x: 30, z: 10, scale: 1 }] }).length, 2);
});

test('the pools lie on the ground, a hand above it, and every triangle is real', () => {
  const pools = layoutGroundGlow({ flora, glow });
  const mesh = buildGroundGlowMesh(pools, drawn);
  assert.ok(mesh.triangles >= 2000 && mesh.triangles <= 24000, `${mesh.triangles} triangles`);
  assert.equal(mesh.positions.length, mesh.vertexCount * 3);
  assert.equal(mesh.locals.length, mesh.vertexCount * 2);
  assert.equal(mesh.strengths.length, mesh.vertexCount);
  let worst = 0;
  for (let i = 0; i < mesh.vertexCount; i++) {
    const x = mesh.positions[i * 3], y = mesh.positions[i * 3 + 1], z = mesh.positions[i * 3 + 2];
    assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z));
    const g = drawn(x, z);
    if (g === null) continue;   // a vertex past the lip is kept at its pool's height and its triangles are dropped
    worst = Math.max(worst, Math.abs(y - g - GROUND_GLOW.lift));
  }
  assert.ok(worst < 1e-3, `a pool vertex ${worst} m off the lift`);
  for (let i = 0; i < mesh.indices.length; i++) assert.ok(mesh.indices[i] < mesh.vertexCount);
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t], b = mesh.indices[t + 1], c = mesh.indices[t + 2];
    assert.ok(a !== b && b !== c && a !== c);
    for (const v of [a, b, c]) assert.notEqual(drawn(mesh.positions[v * 3], mesh.positions[v * 3 + 2]), null, 'a triangle with a corner off the island');
  }
  for (let i = 0; i < mesh.vertexCount; i++) {
    const r = Math.hypot(mesh.locals[i * 2], mesh.locals[i * 2 + 1]);
    assert.ok(r <= 1 + 1e-6, 'the disc coordinate stays inside the pool');
  }
});

test('every pool faces up: its triangles all wind the same way, so the one side that is drawn is the sky side', () => {
  const mesh = buildGroundGlowMesh(layoutGroundGlow({ flora, glow }), drawn);
  let up = 0, down = 0;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]].map(i => new THREE.Vector3(mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]));
    const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (normal.y > 0) up++; else down++;
  }
  assert.ok(up > 0 && down / (up + down) < 0.02, `${up} up, ${down} down`);
});

test('a pool with no ground under it is left out, and one half off the lip keeps only its island half', () => {
  const none = buildGroundGlowMesh([{ kind: 'plants', x: 5000, z: 5000, radius: 4, strength: 0.3 }], drawn);
  assert.equal(none.triangles, 0);
  assert.equal(none.vertexCount, 0);
  const full = buildGroundGlowMesh([{ kind: 'plants', x: SKY_ISLAND.x - 40, z: SKY_ISLAND.z + 30, radius: 4, strength: 0.3 }], drawn);
  const half = buildGroundGlowMesh([{ kind: 'plants', x: SKY_ISLAND.x + SKY_ISLAND.radius - 8, z: SKY_ISLAND.z, radius: 12, strength: 0.3 }], drawn);
  assert.ok(full.triangles > 20);
  assert.ok(half.triangles > 0);
});

test('night comes in as the exposure falls, the same measure as the plants and motes', () => {
  assert.equal(groundGlowNight(0.62), 0);
  assert.equal(groundGlowNight(0.035), 1);
  assert.ok(groundGlowNight(0.2) > 0 && groundGlowNight(0.2) < 1);
});

test('one additive draw, no depth writes, shaders that interpolated cleanly, only there at night and only near the island', () => {
  let exposure = 0.62;
  const anchor = { x: SKY_ISLAND.x, z: SKY_ISLAND.z, distance: 700 };
  const glowing = createIslandGroundGlow({ flora, glow, ground: drawn, getExposure: () => exposure, anchor });
  assert.equal(glowing.group.children.length, 1);
  const { mesh } = glowing;
  assert.equal(mesh.material.blending, THREE.AdditiveBlending);
  assert.equal(mesh.material.depthWrite, false);
  assert.equal(mesh.material.toneMapped, false);
  assert.ok(!/undefined|NaN|\[object/.test(mesh.material.vertexShader + mesh.material.fragmentShader), 'a bad interpolation in the shader');
  for (const [, name] of mesh.material.vertexShader.matchAll(/attribute\s+\w+\s+(\w+)\s*;/g)) assert.ok(mesh.geometry.getAttribute(name), `no ${name}`);
  const head = { x: SKY_ISLAND.x, z: SKY_ISLAND.z };
  glowing.update(head);
  assert.equal(glowing.group.visible, false, 'by day the ground is not lit');
  exposure = 0.035;
  glowing.update(head);
  assert.equal(glowing.group.visible, true);
  assert.equal(mesh.material.uniforms.uNight.value, 1);
  glowing.update({ x: 5000, z: 0 });
  assert.equal(glowing.group.visible, false, 'far from the island nothing is drawn');
  glowing.update(head);
  assert.equal(glowing.group.visible, true);
  glowing.dispose();
});

test('no ground and no plants is fine', () => {
  const none = createIslandGroundGlow({});
  assert.equal(none.group.children.length, 0);
  none.update({ x: 0, z: 0 });
  assert.equal(none.group.visible, false);
  none.dispose();
});

test('the pools are the oasis tree\'s cyan, no stronger, so the night is not brightened: only a pool\'s middle at full strength reaches that colour', () => {
  const [r, g, b] = GROUND_GLOW.colour;
  assert.ok(b > g && g > r, 'cyan: most blue, then green, least red');
  assert.deepEqual([r, g, b], [0.03, 0.23, 0.38], 'exactly the oasis tree\'s pool colour (POD_LIGHT_COLOR in materials.js)');
  for (const kind of Object.values(GROUND_GLOW.kinds)) assert.ok(kind.strength <= 0.7);
});
