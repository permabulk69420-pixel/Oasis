import test from 'node:test';
import assert from 'node:assert/strict';
import { addInventoryItem, getInventoryCount, getInventoryItems, getInventoryWeight, getCarrySpeedMultiplier, exchangeInventoryItems } from '../src/inventory.js';
import { craftItem, getRecipeStatus } from '../src/crafting.js';

// One progression through a fresh inventory also verifies no hidden starter resources.
test('gather, craft, and carry the axe and torch without partial spends or duplicate outputs', () => {
  assert.deepEqual(getInventoryItems(), []);
  assert.equal(craftItem('axe'), false);
  assert.equal(craftItem('unknown'), false);
  addInventoryItem('stick', 5);
  addInventoryItem('stone', 1);
  const before = getInventoryItems();
  assert.equal(getRecipeStatus('axe').canCraft, false);
  assert.equal(craftItem('axe'), false);
  assert.deepEqual(getInventoryItems(), before, 'missing stone must not consume sticks');
  addInventoryItem('stone', 2);
  assert.equal(getInventoryWeight(), 44);
  assert.equal(craftItem('axe'), true);
  assert.equal(getInventoryCount('axe'), 1);
  assert.equal(getInventoryCount('stick'), 2);
  assert.equal(getInventoryCount('stone'), 1);
  assert.equal(getInventoryWeight(), 26);
  assert.equal(craftItem('torch'), true);
  assert.equal(getInventoryCount('torch'), 1);
  assert.equal(getInventoryWeight(), 15);
  assert.equal(getInventoryCount('stick'), 0);
  assert.equal(getInventoryCount('stone'), 0);
  assert.equal(craftItem('torch'), false, 'repeated click cannot duplicate a tool');
  assert.equal(getInventoryCount('torch'), 1);
  const snapshot = getInventoryItems(); snapshot[0].count = 1000;
  assert.equal(getInventoryCount('axe'), 1, 'UI snapshots cannot mutate inventory');
  assert.equal(getCarrySpeedMultiplier(), 1);
});

test('invalid amounts and invalid transactions cannot corrupt the shared inventory', () => {
  const before = getInventoryItems();
  for (const amount of [Infinity, -Infinity, NaN, -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) addInventoryItem('stick', amount);
  assert.deepEqual(getInventoryItems(), before);
  for (const cost of [{}, { axe: -1 }, { axe: Infinity }, { axe: 1.5 }, { axe: 2 }]) {
    assert.equal(exchangeInventoryItems(cost, { torch: 1 }), false);
  }
  assert.equal(exchangeInventoryItems({ axe: 1 }, { torch: Infinity }), false);
  assert.deepEqual(getInventoryItems(), before);
});

test('the campfire recipe takes sticks and stones, never partially, and weighs something in the pack', () => {
  assert.equal(getRecipeStatus('campfire').recipe.output, 'campfire');
  const sticks = getInventoryCount('stick'), stones = getInventoryCount('stone');
  addInventoryItem('stick', 5);
  addInventoryItem('stone', 5);
  const before = getInventoryItems();
  assert.equal(getRecipeStatus('campfire').canCraft, false, 'one stick short');
  assert.equal(craftItem('campfire'), false);
  assert.deepEqual(getInventoryItems(), before, 'a failed craft spends nothing');
  addInventoryItem('stick', 1);
  const weight = getInventoryWeight();
  assert.equal(craftItem('campfire'), true);
  assert.equal(getInventoryCount('campfire'), 1);
  assert.equal(getInventoryCount('stick'), sticks);
  assert.equal(getInventoryCount('stone'), stones);
  assert.equal(getInventoryWeight(), weight - 6 * 4 - 5 * 8 + 25);
  assert.equal(craftItem('campfire'), false, 'repeated click cannot duplicate it');
});
