import test from 'node:test';
import assert from 'node:assert/strict';
import { FERN_HARVEST, fernScale, isFernReady, nearestReadyFern, rollFibre } from '../src/fern-harvest.js';

test('a pulled fern is a stub, grows back smoothly, and is ready again only when full', () => {
  assert.equal(fernScale(Infinity), 1);
  assert.equal(fernScale(0), FERN_HARVEST.stubScale);
  let last = 0;
  for (let t = 0; t < FERN_HARVEST.regrow; t += 5) {
    const scale = fernScale(t);
    assert.ok(scale >= last && scale < 1, `grows steadily at ${t}s`);
    last = scale;
  }
  assert.equal(fernScale(FERN_HARVEST.regrow), 1);
  assert.equal(isFernReady(Infinity), true);
  assert.equal(isFernReady(0), false);
  assert.equal(isFernReady(FERN_HARVEST.regrow - 1), false);
  assert.equal(isFernReady(FERN_HARVEST.regrow), true);
});

test('a pull gives the whole range of fibre and nothing outside it', () => {
  const [min, max] = FERN_HARVEST.fibre;
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(rollFibre(() => i / 200));
  assert.deepEqual([...seen].sort(), Array.from({ length: max - min + 1 }, (_, i) => min + i));
  assert.equal(rollFibre(() => 0.999999), max);
});

test('a hand finds the nearest full-grown fern in reach, and not a stub, a far one or one it is above', () => {
  const ferns = [
    { id: 'far', x: 3, y: 0, z: 0, since: Infinity },
    { id: 'stub', x: 0.1, y: 0, z: 0, since: 10 },
    { id: 'near', x: 0.3, y: 0, z: 0, since: Infinity },
    { id: 'nearer', x: 0.2, y: 0, z: 0.1, since: Infinity },
  ];
  assert.equal(nearestReadyFern(ferns, 0, 0.5, 0).id, 'nearer');
  assert.equal(nearestReadyFern(ferns, 0, 2.5, 0), null, 'a hand held high over the fern is not in it');
  assert.equal(nearestReadyFern(ferns, 0, -0.5, 0), null, 'nor one below the ground');
  assert.equal(nearestReadyFern(ferns, 10, 0.5, 10), null);
  ferns[3].since = 0; ferns[2].since = 0;
  assert.equal(nearestReadyFern(ferns, 0, 0.5, 0), null, 'all pulled: nothing to take until they grow back');
});
