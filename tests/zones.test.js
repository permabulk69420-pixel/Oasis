import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeightField, terrainHeight, terrainSurface, GRID_STEP, HALF_WORLD, TILE } from '../src/world.js';
import { AREA, WALK } from '../src/zones.js';
import { TERRAIN, chooseTiles } from '../src/terrain-tiles.js';
import { GROUND_WINDOW, packHeight, unpackHeight } from '../src/ground-window.js';

const out = { rock: 0, salt: 0, gravel: 0 };

test('the oasis square is exactly the world it always was (heights taken from before the world grew)', () => {
  const reference = [[0, 0, 24.525322284], [319, -292, 25.578619169], [300, -400, 2.22], [372, -414, 4.397439247], [-480, 470, 10.516223364], [499, -499, 26.934497405],
    [-499, 499, 11.826799203], [123.4, -345.6, 20.50007678], [-250, -250, 11.288765466], [450, 300, 21.249603521], [-77.7, 12.3, 14.336293344], [310, -380, 2.622134694]];
  for (const [x, z, h] of reference) assert.ok(Math.abs(terrainHeight(x, z) - h) < 1e-6, `(${x}, ${z}) is ${terrainHeight(x, z)}, was ${h}`);
  // and nothing in it is anything but sand
  for (let i = 0; i < 400; i++) {
    const x = -500 + (i * 37.7) % 1000, z = -500 + (i * 91.3) % 1000;
    terrainSurface(x, z, out);
    assert.deepEqual([out.rock, out.salt, out.gravel], [0, 0, 0], `(${x}, ${z}) is sand`);
  }
});

test('the zones fade in over the homeBlend metres beyond the oasis square, with no step', () => {
  // walk out of the square on a line through a zone: the height never jumps
  let previous = terrainHeight(480, -400);
  for (let x = 481; x < 900; x += 1) {
    const h = terrainHeight(x, -400);
    assert.ok(Math.abs(h - previous) < 4, `a ${(h - previous).toFixed(1)} m step at x = ${x}`);
    previous = h;
  }
});

test('the gravel plain is flat and level, the salt pan flatter and lower, both clear of rock', () => {
  const plain = AREA.flats[0], pan = AREA.salt[0];
  const sample = (f, n) => Array.from({ length: n }, (_, i) => { const a = i * 2.4, r = Math.sqrt((i + 0.5) / n) * 0.55; return terrainSurface(f.x + Math.cos(a) * f.rx * r, f.z + Math.sin(a) * f.rz * r, { rock: 0, salt: 0, gravel: 0 }); });
  const plainH = sample(plain, 200), panH = sample(pan, 200);
  assert.ok(Math.max(...plainH) - Math.min(...plainH) < 3.5, 'the plain is level to a few metres');
  assert.ok(Math.max(...panH) - Math.min(...panH) < 0.2, 'the salt pan is flat');
  assert.ok(Math.max(...panH) < Math.min(...plainH), 'the pan is lower');
  terrainSurface(plain.x, plain.z, out); assert.ok(out.gravel > 0.9 && out.rock === 0, 'gravel in the middle of the plain');
  terrainSurface(pan.x, pan.z, out); assert.ok(out.salt > 0.9 && out.rock === 0, 'salt in the middle of the pan');
});

test('mesas and ridges stand well above the dunes, with rock showing', () => {
  for (const m of AREA.mesas) {
    assert.ok(terrainHeight(m.x, m.z) > AREA.rockBase + m.h * 0.8, `a mesa at ${m.x}, ${m.z} is ${terrainHeight(m.x, m.z).toFixed(0)} m`);
    terrainSurface(m.x, m.z, out); assert.ok(out.rock > 0.95);
  }
  for (const r of AREA.ridges) {
    const [x, z] = r.points[Math.floor(r.points.length / 2)];
    assert.ok(terrainHeight(x, z) > AREA.rockBase + r.height * 0.3, `a ridge at ${x}, ${z}`);
  }
});

test('the canyon is a cut through the plateau: a floor a few metres up between walls tens of metres high, and a way in at each end', () => {
  const p = AREA.plateaus[0], c = p.canyon;
  const centre = x => c.z0 + c.waves.reduce((s, [amp, len, phase]) => s + amp * Math.sin((x - p.x) / len + phase), 0);
  for (const x of [p.x - 100, p.x, p.x + 100]) {
    const floor = terrainHeight(x, centre(x));
    assert.ok(floor < AREA.rockBase + 12, `floor at x = ${x} is ${floor.toFixed(1)} m`);
    assert.ok(terrainHeight(x, centre(x) + 90) > floor + 40, `a wall beside the floor at x = ${x}`);
  }
  // you can walk from one side of the plateau to the other along the floor without climbing
  let worst = 0, previous = terrainHeight(p.x - p.r * 0.9, centre(p.x - p.r * 0.9));
  for (let x = p.x - p.r * 0.9; x <= p.x + p.r * 0.9; x += 2) { const h = terrainHeight(x, centre(x)); worst = Math.max(worst, Math.abs(h - previous)); previous = h; }
  assert.ok(worst < 4, `the canyon floor changes ${worst.toFixed(1)} m in 2 m at most`);
});

test('mountains close the world in on every side, and the walk limit is on their slope', () => {
  const mid = (AREA.bounds.minX + AREA.bounds.maxX) / 2, midZ = (AREA.bounds.minZ + AREA.bounds.maxZ) / 2;
  for (const [x, z] of [[WALK.minX, midZ], [WALK.maxX, midZ], [mid, WALK.minZ], [mid, WALK.maxZ]]) {
    assert.ok(terrainHeight(x, z) > 30, `the walk limit at ${x}, ${z} is ${terrainHeight(x, z).toFixed(0)} m up a slope`);
  }
  // beyond the bounds it stays high (a wall, not a cliff edge into nothing)
  for (const d of [100, 400, 1500]) assert.ok(terrainHeight(AREA.bounds.maxX + d, midZ) > 60, `${d} m past the east edge`);
  assert.ok(WALK.minX > AREA.bounds.minX && WALK.maxX < AREA.bounds.maxX && WALK.minZ > AREA.bounds.minZ && WALK.maxZ < AREA.bounds.maxZ);
});

test('the lazy height grid agrees with the terrain everywhere, across tile edges, and hands out whole tiles', () => {
  const field = createHeightField();
  for (const [x, z] of [[-1200, -2200], [2300, 1300], [31.2 * 62.5 - 500, 0], [0.01, -0.01], [-62.5 * 33 - 500, 777]]) {
    const ix = Math.round((x + HALF_WORLD) / GRID_STEP), iz = Math.round((z + HALF_WORLD) / GRID_STEP);
    assert.ok(Math.abs(field.vertex(ix, iz) - terrainHeight(ix * GRID_STEP - HALF_WORLD, iz * GRID_STEP - HALF_WORLD)) < 1e-4);
  }
  // a tile read in one go equals the same cells read one at a time, apron included
  const tx = 40, tz = -17, data = field.chunkData(tx, tz), side = TILE + 3;
  for (let j = -1; j <= TILE + 1; j += 5) for (let i = -1; i <= TILE + 1; i += 7) {
    assert.equal(data[(j + 1) * side + (i + 1)], field.vertex(tx * TILE + i, tz * TILE + j));
  }
  // sample stays continuous across a tile edge
  const x = tx * TILE * GRID_STEP - HALF_WORLD, z = tz * TILE * GRID_STEP - HALF_WORLD + 20;
  assert.ok(Math.abs(field.sample(x - 1e-6, z) - field.sample(x + 1e-6, z)) < 1e-3);
  assert.equal(field.homeHeights().length, 513 * 513);
});

test('every metre of the world is covered by exactly one tile, small near the player and larger far away', () => {
  const { tiles, state } = chooseTiles(319, -292);
  const r = TERRAIN.rootRange;
  assert.equal(tiles.reduce((sum, t) => sum + t.size * t.size, 0), (r.maxX - r.minX) * (r.maxZ - r.minZ), 'the tiles add up to the whole area');
  // no overlap: every tile's corner belongs to that tile alone
  for (const t of tiles) {
    const inside = tiles.filter(o => t.x >= o.x && t.x < o.x + o.size && t.z >= o.z && t.z < o.z + o.size);
    assert.equal(inside.length, 1, `${t.key} overlaps another tile`);
  }
  const at = (x, z) => tiles.find(t => x >= t.x && x < t.x + t.size && z >= t.z && z < t.z + t.size);
  assert.equal(at(319, -292).size, TERRAIN.chunk, 'chunks under the player');
  assert.equal(at(319, -292).segments, TERRAIN.fineSegments, 'at full detail');
  assert.ok(at(319 + 700, -292).size >= 250 && at(319 + 3000, -292).size >= 500);
  for (const t of tiles) assert.ok(t.size >= TERRAIN.chunk && t.segments >= 16 && t.segments <= 32);
  assert.ok(tiles.length < 420, `${tiles.length} tiles in all`);
  // the pond always has its full-detail chunks, wherever the player is
  const far = chooseTiles(-1000, 800).tiles;
  const pond = far.find(t => t.size === TERRAIN.chunk && 300 >= t.x && 300 < t.x + t.size && -400 >= t.z && -400 < t.z + t.size);
  assert.ok(pond && pond.segments === TERRAIN.fineSegments, 'the pond is drawn at full detail from afar');
  // hysteresis: a tile keeps its state just past the threshold
  const first = chooseTiles(0, 0, 1, null);
  const second = chooseTiles(8, 0, 1, first.state);
  assert.equal(second.tiles.length > 0, true);
});

test('the ground window packs heights to well under a centimetre across a mesa-to-salt-pan range', () => {
  for (const h of [-30, 0, 2.4, 15.123, 140, 220]) assert.ok(Math.abs(unpackHeight(packHeight(h)) - h) < 0.005, `${h}`);
  assert.equal(packHeight(-1000), 0); assert.equal(packHeight(1000), 65535);
  assert.ok(GROUND_WINDOW.cells * GRID_STEP > 200, 'a window covers more than the sand reaches');
});
