import test from 'node:test';
import assert from 'node:assert/strict';
import { createPickupToasts, TOAST } from '../src/pickup-toast.js';

test('gains of the same thing close together merge into one line', () => {
  const toasts = createPickupToasts();
  toasts.add('Wood', 1);
  toasts.update(0.5);
  toasts.add('Wood', 2);
  assert.deepEqual(toasts.visible(), [{ text: '+3 Wood', alpha: 1 }]);
});

test('a gain after the merge window starts a new line', () => {
  const toasts = createPickupToasts({ ...TOAST, mergeWindow: 1 });
  toasts.add('Wood', 1);
  toasts.update(1.2);
  toasts.add('Wood', 1);
  assert.deepEqual(toasts.visible().map(line => line.text), ['+1 Wood', '+1 Wood']);
});

test('different things get their own lines, and only the newest few show', () => {
  const toasts = createPickupToasts();
  toasts.add('Stick'); toasts.add('Stone'); toasts.add('Fibre');
  assert.deepEqual(toasts.visible().map(line => line.text), ['+1 Stone', '+1 Fibre']);
});

test('a line holds, fades, then goes', () => {
  const toasts = createPickupToasts();
  toasts.add('Fibre', 2);
  toasts.update(TOAST.hold - 0.1);
  assert.equal(toasts.visible()[0].alpha, 1);
  toasts.update(0.1 + TOAST.fade / 2);
  assert.ok(toasts.visible()[0].alpha > 0 && toasts.visible()[0].alpha < 1);
  toasts.update(TOAST.fade);
  assert.equal(toasts.active(), false);
});

test('nonsense gains are ignored', () => {
  const toasts = createPickupToasts();
  toasts.add('', 1); toasts.add('Wood', 0); toasts.add('Wood', -2); toasts.add('Wood', NaN);
  assert.equal(toasts.active(), false);
});
