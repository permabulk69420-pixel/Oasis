import test from 'node:test';
import assert from 'node:assert/strict';
import { statSync, existsSync, readFileSync } from 'node:fs';
import {
  LODS, FIND_SHAPES, ROCK_VARIANTS, CRYSTAL_VARIANTS, SPIRE_VARIANTS, buildOutcrop, buildCrystalCluster, buildSpire,
  buildLooseCrystal, buildFibreBundle, mulberry32, hash3, rockBody, bodyReach, BODY_BUCKETS, BODY_MAX_HEIGHT,
} from '../src/find-shapes.js';

const EVERY = [];
for (const [kind, def] of Object.entries(FIND_SHAPES)) {
  for (const variant of Object.keys(def.variants)) for (let lod = 0; lod < LODS; lod++) EVERY.push({ kind, variant, lod, geometry: def.build(def.variants[variant], lod) });
}

const triangles = geometry => geometry.getAttribute('position').count / 3;

// Weld by position and look at every edge: a closed, consistently wound solid has each edge in exactly two triangles, running opposite ways.
function edgeReport(geometry) {
  const pos = geometry.getAttribute('position').array;
  const key = i => `${Math.round(pos[i] * 1e4)},${Math.round(pos[i + 1] * 1e4)},${Math.round(pos[i + 2] * 1e4)}`;
  const edges = new Map();
  let volume = 0;
  for (let t = 0; t < pos.length / 9; t++) {
    const o = t * 9;
    const ids = [key(o), key(o + 3), key(o + 6)];
    for (let e = 0; e < 3; e++) {
      const a = ids[e], b = ids[(e + 1) % 3];
      if (a === b) continue;
      const canonical = a < b ? `${a}|${b}` : `${b}|${a}`;
      const entry = edges.get(canonical) ?? { count: 0, sum: 0 };
      entry.count += 1; entry.sum += a < b ? 1 : -1;
      edges.set(canonical, entry);
    }
    volume += (pos[o] * (pos[o + 4] * pos[o + 8] - pos[o + 5] * pos[o + 7])
      - pos[o + 1] * (pos[o + 3] * pos[o + 8] - pos[o + 5] * pos[o + 6])
      + pos[o + 2] * (pos[o + 3] * pos[o + 7] - pos[o + 4] * pos[o + 6])) / 6;
  }
  let open = 0, inconsistent = 0;
  for (const { count, sum } of edges.values()) { if (count !== 2) open += 1; else if (sum !== 0) inconsistent += 1; }
  return { open, inconsistent, volume };
}

test('every shape at every level is finite, has colours, and gets simpler with distance', () => {
  for (const { kind, variant, lod, geometry } of EVERY) {
    const label = `${kind} ${variant} level ${lod}`;
    for (const name of ['position', 'normal', 'color']) {
      const attribute = geometry.getAttribute(name);
      assert.ok(attribute && attribute.count > 0, `${label}: has ${name}`);
      for (const v of attribute.array) assert.ok(Number.isFinite(v), `${label}: ${name} is finite`);
    }
    for (const v of geometry.getAttribute('color').array) assert.ok(v >= 0 && v <= 4, `${label}: colour in range`);
    assert.ok(geometry.userData.height > 0, `${label}: records its height`);
  }
  for (const [kind, def] of Object.entries(FIND_SHAPES)) {
    for (const variant of Object.keys(def.variants)) {
      const counts = EVERY.filter(e => e.kind === kind && e.variant === variant).map(e => triangles(e.geometry));
      assert.ok(counts[0] > counts[1] && counts[1] > counts[2], `${kind} ${variant}: ${counts.join(' > ')}`);
    }
  }
});

test('triangle budgets: cheap enough to scatter by the hundred on a Quest', () => {
  const closest = { rock: 1200, crystal: 300, spire: 1400 };
  for (const { kind, variant, lod, geometry } of EVERY) {
    if (lod === 0) assert.ok(triangles(geometry) <= closest[kind], `${kind} ${variant}: ${triangles(geometry)} tris`);
    if (lod === LODS - 1) assert.ok(triangles(geometry) <= 220, `${kind} ${variant}: far level ${triangles(geometry)} tris`);
  }
  assert.ok(triangles(buildLooseCrystal(1)) <= 120);
  assert.ok(triangles(buildFibreBundle(1)) <= 300);
});

test('rocks are closed, consistently wound solids with a positive volume at every level', () => {
  for (const { kind, variant, lod, geometry } of EVERY) {
    if (kind !== 'rock') continue;
    const { open, inconsistent, volume } = edgeReport(geometry);
    assert.equal(open, 0, `${variant} level ${lod}: open edges`);
    assert.equal(inconsistent, 0, `${variant} level ${lod}: inconsistent winding`);
    assert.ok(volume > 0.5, `${variant} level ${lod}: volume ${volume.toFixed(2)} (inside out if negative)`);
    assert.equal(geometry.userData.solid, true);
    const uv = geometry.getAttribute('uv');
    assert.ok(uv && uv.count === geometry.getAttribute('position').count, 'a rock has UVs for its texture');
  }
});

test('rocks are the size their variant says and stand with the foot just under the ground', () => {
  for (const [name, spec] of Object.entries(ROCK_VARIANTS)) {
    const geometry = buildOutcrop(spec, 0);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    assert.ok(box.max.y > spec.height * 0.95 && box.max.y < spec.height * 1.3, `${name} top ${box.max.y}`);
    assert.ok(box.min.y < 0 && box.min.y > -0.2 * spec.height, `${name} foot ${box.min.y}`);
    const body = rockBody(name);
    assert.equal(body.length, BODY_BUCKETS);
    for (const reach of body) assert.ok(reach > 0.4 * Math.min(spec.rx, spec.rz) && reach < 1.7 * Math.max(spec.rx, spec.rz), `${name} body reach ${reach}`);
  }
});

test('a rock body reaches as far as its mesh does, in every direction, below head height', () => {
  for (const [name, spec] of Object.entries(ROCK_VARIANTS)) {
    const pos = buildOutcrop(spec, 0).getAttribute('position').array;
    const body = rockBody(name);
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i + 1] > BODY_MAX_HEIGHT || pos[i + 1] < -0.3) continue;
      assert.ok(Math.hypot(pos[i], pos[i + 2]) <= bodyReach(body, pos[i], pos[i + 2]) + 1e-4, `${name}: a vertex pokes out of its own body`);
    }
  }
});

test('crystals shine most at the tips and stay dark at the foot', () => {
  for (const [name, spec] of Object.entries(CRYSTAL_VARIANTS)) {
    const geometry = buildCrystalCluster(spec, 0);
    const pos = geometry.getAttribute('position').array, col = geometry.getAttribute('color').array;
    const height = geometry.userData.height;
    let lowSum = 0, lowN = 0, highSum = 0, highN = 0;
    for (let i = 0; i < pos.length / 3; i++) {
      const luminance = col[i * 3] + col[i * 3 + 1] + col[i * 3 + 2];
      if (pos[i * 3 + 1] < height * 0.1 && pos[i * 3 + 1] > -0.2) { lowSum += luminance; lowN += 1; }
      else if (pos[i * 3 + 1] > height * 0.6) { highSum += luminance; highN += 1; }
    }
    assert.ok(lowN > 0 && highN > 0, `${name}: has both a foot and a tip`);
    assert.ok(highSum / highN > 2.5 * (lowSum / lowN), `${name}: tip ${highSum / highN} vs foot ${lowSum / lowN}`);
  }
});

test('shapes are the same every time (the layout and the saves rely on it)', () => {
  for (const kind of Object.keys(FIND_SHAPES)) {
    const def = FIND_SHAPES[kind];
    const variant = Object.keys(def.variants)[0];
    const a = def.build(def.variants[variant], 0).getAttribute('position').array;
    const b = def.build(def.variants[variant], 0).getAttribute('position').array;
    assert.deepEqual(Array.from(a), Array.from(b));
  }
  const gen = mulberry32(5), again = mulberry32(5);
  assert.equal(gen(), again());
  assert.equal(hash3(1, 2, 3), hash3(1, 2, 3));
});

test('the held crystal and fibre are hand-sized', () => {
  const crystal = buildLooseCrystal(2);
  crystal.computeBoundingBox();
  const size = crystal.boundingBox.getSize(new (crystal.boundingBox.min.constructor)());
  assert.ok(size.y > 0.12 && size.y < 0.24, `crystal ${size.y} m tall`);
  assert.ok(crystal.boundingBox.min.y > -0.1 && crystal.boundingBox.min.y < -0.07, 'foot at the bottom the pickup code expects');
  const fibre = buildFibreBundle(2);
  fibre.computeBoundingBox();
  assert.ok(fibre.boundingBox.max.x - fibre.boundingBox.min.x > 0.25 && fibre.boundingBox.max.x - fibre.boundingBox.min.x < 0.36, 'fibre is about 30 cm');
});

test('every spire variant is a tall plant', () => {
  for (const [name, spec] of Object.entries(SPIRE_VARIANTS)) {
    const geometry = buildSpire(spec, 0);
    geometry.computeBoundingBox();
    assert.ok(geometry.boundingBox.max.y > spec.height * 0.95, `${name} reaches ${geometry.boundingBox.max.y}`);
  }
});

test('the sandstone textures are real, credited, and small enough to load over mobile data', () => {
  for (const [file, limit] of [['sandstone_albedo.jpg', 260_000], ['sandstone_normal.jpg', 420_000]]) {
    const url = new URL(`../public/textures/sandstone/${file}`, import.meta.url);
    assert.ok(existsSync(url), `${file} exists`);
    const { size } = statSync(url);
    assert.ok(size > 30_000 && size < limit, `${file}: ${size} bytes`);
  }
  const credits = readFileSync(new URL('../public/textures/sandstone/CREDITS.md', import.meta.url), 'utf8');
  assert.match(credits, /Poly Haven/);
  assert.match(credits, /CC0/);
});
