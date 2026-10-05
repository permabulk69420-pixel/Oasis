import test from 'node:test';
import assert from 'node:assert/strict';
import { startPlace, DESERT_FIXTURES } from '../src/start-place.js';

test('a new game starts on the island unless the address asks for the oasis', () => {
  assert.equal(startPlace('', false), 'island');
  assert.equal(startPlace('?hour=14', true), 'island');
  assert.equal(startPlace('?start=oasis', false), 'oasis');
  assert.equal(startPlace('?start=oasis', true), 'oasis');
  assert.equal(startPlace('?start=island', true), 'island');
  assert.equal(startPlace('?start=nonsense', false), 'island');
});

test('a dev build keeps the oasis for the desert screenshot fixtures, unless told otherwise', () => {
  for (const key of DESERT_FIXTURES) assert.equal(startPlace(`?${key}=1`, true), 'oasis', key);
  assert.equal(startPlace('?at=-105,585&start=island', true), 'island');
  // production never reads the fixtures
  assert.equal(startPlace('?at=1,1&view=shore', false), 'island');
});
