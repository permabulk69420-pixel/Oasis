import test from 'node:test';
import assert from 'node:assert/strict';
import { SAVE, SAVE_PARTS, cleanSave, wantsFresh, createSaveStore, createAutosave } from '../src/save-game.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: key => { data.delete(key); },
  };
}

const goodSave = () => ({
  version: SAVE.version,
  savedAt: 5,
  inventory: [{ type: 'stick', count: 3 }, { type: 'stone', count: 1 }],
  survival: { health: 90, stamina: 80, food: 70, water: 60 },
  time: 21.5,
  player: { x: 310, z: -290, yaw: 1 },
  tools: {
    kinds: ['axe', 'torch'],
    items: [
      { id: 'axe', at: 'hip', side: 'left' },
      { id: 'torch', at: 'ground', p: [300, 12, -300], q: [0, 0, 0, 1], fall: 'rest', data: { lit: true } },
    ],
  },
  fires: [{ x: 100.5, z: -20, lit: true }],
  pack: { status: 'ground', x: 319, z: -292, yaw: 0.5 },
  mining: { version: 1, waiting: { 'rock-1': 30 } },
});

// ---------------------------------------------------------------------------------------------- reading a save

test('a good save comes through the checks as it went in', () => {
  const clean = cleanSave(goodSave());
  assert.deepEqual(Object.keys(clean).sort(), ['savedAt', 'version', ...SAVE_PARTS].sort(), 'every part is there');
  assert.ok(Math.abs(clean.player.yaw - 1) < 1e-12 && Math.abs(clean.pack.yaw - 0.5) < 1e-12);
  clean.player.yaw = 1; clean.pack.yaw = 0.5; // a turn goes through atan2, which may differ in the last digit
  assert.deepEqual(clean, goodSave());
});

test('anything that is not a save of this version is not read', () => {
  for (const raw of [null, undefined, 5, 'save', [], {}, { version: SAVE.version + 1 }, { version: '1' }]) assert.equal(cleanSave(raw), null);
});

test('a part that is damaged is dropped and the rest is kept', () => {
  const clean = cleanSave({
    version: SAVE.version,
    inventory: [{ type: 'stick', count: 2 }],
    survival: 'plenty', time: NaN, player: { x: 'far', z: 3 }, tools: 7, fires: { x: 1 }, pack: { status: 'floating' }, mining: { version: 1, waiting: 'no' },
  });
  assert.deepEqual(Object.keys(clean).sort(), ['inventory', 'savedAt', 'version']);
  assert.deepEqual(clean.inventory, [{ type: 'stick', count: 2 }]);
});

test('numbers are held to what the game can really have', () => {
  const clean = cleanSave({
    version: SAVE.version,
    survival: { health: 500, stamina: -5, food: NaN, water: '50' },
    time: 25.5,
    player: { x: 9999, z: -9999, yaw: 7 },
  });
  assert.deepEqual(clean.survival, { health: 100, stamina: 0 }, 'clamped, and the ones that are not numbers left out');
  assert.equal(clean.time, 1.5);
  assert.equal(cleanSave({ version: SAVE.version, time: -1 }).time, 23);
  assert.equal(clean.player.x, SAVE.limit);
  assert.equal(clean.player.z, -SAVE.limit);
  assert.ok(Math.abs(clean.player.yaw) <= Math.PI + 1e-9, 'a turn is a turn');
  assert.equal(cleanSave({ version: SAVE.version, player: { x: 1, z: 2 } }).player.yaw, 0, 'no turn saved means none');
});

test('the inventory keeps only real counts of reasonably named things', () => {
  const clean = cleanSave({
    version: SAVE.version,
    inventory: [
      { type: 'stick', count: 0 }, { type: 'stick', count: -2 }, { type: 'stick', count: 1.5 }, { type: 'stick', count: '3' },
      { type: '', count: 1 }, { type: 'x'.repeat(41), count: 1 }, { type: 7, count: 1 }, null, 'stick',
      { type: 'wood', count: 5 }, { type: 'stone', count: 1e9 },
    ],
  });
  assert.deepEqual(clean.inventory, [{ type: 'wood', count: 5 }, { type: 'stone', count: 9999 }]);
  const crowd = Array.from({ length: 200 }, (_, i) => ({ type: `t${i}`, count: 1 }));
  assert.equal(cleanSave({ version: SAVE.version, inventory: crowd }).inventory.length, SAVE.maxItems, 'a runaway list is cut off');
  assert.deepEqual(cleanSave({ version: SAVE.version, inventory: [] }).inventory, [], 'an empty pocket is a real answer');
});

test('tools: a hip needs a side, the world needs a place and a turn, and what a tool says about itself is plain', () => {
  const clean = cleanSave({
    version: SAVE.version,
    tools: {
      kinds: ['axe', 'torch', 7, ''],
      items: [
        { id: 'axe', at: 'hip', side: 'middle' }, // no such hip
        { id: 'axe', at: 'hip', side: 'right' },
        { id: 'spear', at: 'ground', p: [1, 2, NaN], q: [0, 0, 0, 1] }, // no place
        { id: 'spear', at: 'ground', p: [5000, 0, 0], q: [0, 0, 0, 1] }, // off the map
        { id: 'spear', at: 'ground', p: [1, 2, 3], q: [0, 0, 0, 0] }, // no turn
        { id: 'spear', at: 'ground', p: [1, 2, 3], q: [0, 0, 0, 1.5], fall: 'flying' }, // a turn that is a little long, an unknown way of lying
        { id: 'torch', at: 'ground', p: [1, 2, 3], q: [0, 0, 1, 0], fall: 'stuck', data: { lit: true, nested: { a: 1 }, long: 'x'.repeat(50), note: 'ok', count: 2 } },
        { id: 'torch', at: 'pocket' },
        { at: 'hip', side: 'left' },
      ],
    },
  });
  assert.deepEqual(clean.tools.items.map(item => `${item.id}:${item.at}`), ['axe:hip', 'spear:ground', 'torch:ground']);
  assert.deepEqual(clean.tools.items[1].q, [0, 0, 0, 1], 'a turn is made exactly one long');
  assert.equal(clean.tools.items[1].fall, undefined);
  assert.equal(clean.tools.items[2].fall, 'stuck');
  assert.deepEqual(clean.tools.items[2].data, { lit: true, note: 'ok', count: 2 }, 'only plain facts');
  assert.deepEqual(clean.tools.kinds, ['axe', 'torch', 'spear'], 'every kind in the save is listed, even if the list missed it');
});

test('fires, the pack and the broken rocks are held to the same standard', () => {
  const clean = cleanSave({
    version: SAVE.version,
    fires: [{ x: 5, z: 6, lit: true }, { x: 5, z: 6 }, { x: 9000, z: 0, lit: true }, { x: 'a', z: 1 }, null],
    pack: { status: 'ground', x: 1, z: 2 },
    mining: { version: 2, waiting: { a: 10.4, b: -3, c: NaN, ['x'.repeat(61)]: 5, d: 2e6, e: 7 } },
  });
  assert.deepEqual(clean.fires, [{ x: 5, z: 6, lit: true }, { x: 5, z: 6, lit: false }]);
  assert.deepEqual(clean.pack, { status: 'ground', x: 1, z: 2, yaw: 0 });
  assert.deepEqual(clean.mining, { version: 2, waiting: { a: 10, e: 7 } });
  assert.equal(cleanSave({ version: SAVE.version, pack: { status: 'ground', x: 1 } }).pack, undefined);
  assert.deepEqual(cleanSave({ version: SAVE.version, pack: { status: 'worn', x: 'junk' } }).pack, { status: 'worn' });
});

test('?fresh=1 asks for a new game, and only that does', () => {
  for (const search of ['?fresh=1', '?fresh', '?a=1&fresh=yes', '?fresh=true']) assert.equal(wantsFresh(search), true, search);
  for (const search of ['', '?x=1', '?fresh=0', '?fresh=false', '?fresh=off', '?fresh=No', '?freshly=1']) assert.equal(wantsFresh(search), false, search);
});

// ---------------------------------------------------------------------------------------------- storage

test('a first run has nothing to load; the next one gets back what was written', () => {
  const storage = memoryStorage();
  const first = createSaveStore({ storage, now: () => 1234 });
  assert.deepEqual(first.begin(), { save: null, note: 'none' });
  const bytes = first.write(goodSave());
  assert.ok(bytes > 100, 'it says how many bytes it wrote');
  assert.equal(JSON.parse(storage.getItem(SAVE.key)).savedAt, 1234, 'stamped with the time it was written');
  first.bootDone();
  const second = createSaveStore({ storage }).begin();
  assert.equal(second.note, 'loaded');
  assert.equal(second.save.inventory.length, 2);
  assert.equal(second.save.savedAt, 1234);
});

test('?fresh sets the old save aside instead of throwing it away', () => {
  const storage = memoryStorage({ [SAVE.key]: JSON.stringify(goodSave()) });
  const store = createSaveStore({ storage });
  assert.deepEqual(store.begin({ fresh: true }), { save: null, note: 'fresh' });
  assert.equal(storage.getItem(SAVE.key), null);
  assert.equal(JSON.parse(store.kept()).inventory.length, 2, 'it is still there to be looked at');
});

test('a save that cannot be read is set aside and the game starts clean', () => {
  for (const text of ['{not json', JSON.stringify({ version: 99 }), '[]', '5']) {
    const storage = memoryStorage({ [SAVE.key]: text });
    const store = createSaveStore({ storage });
    assert.deepEqual(store.begin(), { save: null, note: 'unreadable' }, text);
    assert.equal(storage.getItem(SAVE.key), null);
    assert.equal(store.kept(), text);
  }
});

test('two starts in a row that never got as far as drawing for a few seconds set the save aside', () => {
  const storage = memoryStorage({ [SAVE.key]: JSON.stringify(goodSave()) });
  const store = () => createSaveStore({ storage });
  assert.equal(store().begin().note, 'loaded', 'first try');
  assert.equal(store().begin().note, 'loaded', 'one failed start is forgiven');
  assert.equal(store().begin().note, 'crashed', 'the third start would be the third try at the same save');
  assert.equal(storage.getItem(SAVE.key), null);
  assert.ok(store().kept(), 'but it is kept');
  assert.equal(storage.getItem(SAVE.bootKey), '1', 'the clean start that follows counts as the first try');

  const good = memoryStorage({ [SAVE.key]: JSON.stringify(goodSave()) });
  for (let i = 0; i < 6; i++) {
    const s = createSaveStore({ storage: good });
    assert.equal(s.begin().note, 'loaded');
    s.bootDone();
  }
});

test('a save too big to be real is not written, and the last good one stays', () => {
  const storage = memoryStorage();
  const store = createSaveStore({ storage });
  assert.ok(store.write(goodSave()) > 0);
  const kept = storage.getItem(SAVE.key);
  const huge = { ...goodSave(), pack: { status: 'worn', pad: 'x'.repeat(SAVE.maxBytes) } };
  assert.equal(store.write(huge), 0);
  assert.equal(storage.getItem(SAVE.key), kept);
});

test('storage that is missing or refuses never makes anything throw', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('blocked'); } };
  const store = createSaveStore({ storage: broken });
  assert.deepEqual(store.begin({ fresh: true }), { save: null, note: 'fresh' });
  assert.deepEqual(store.begin(), { save: null, note: 'none' });
  assert.equal(store.write(goodSave()), 0);
  assert.equal(store.peek(), null);
  store.bootDone();
  const none = createSaveStore({ storage: null });
  assert.equal(none.available(), false);
  assert.equal(none.write(goodSave()), 0);
  assert.equal(none.begin().note, 'none');
  const circular = {}; circular.self = circular;
  assert.equal(createSaveStore({ storage: memoryStorage() }).write(circular), 0, 'something that cannot be written as text');
});

// ---------------------------------------------------------------------------------------------- the autosave

function clock() {
  let time = 1_000_000;
  return { now: () => time, advance: seconds => { time += seconds * 1000; } };
}

function rig(options = {}) {
  const storage = memoryStorage();
  const wall = clock();
  const store = createSaveStore({ storage, now: () => 42 });
  const log = [];
  const loaded = { tools: false, fires: false };
  const value = { inventory: ['a'], tools: 'T0', fires: 'F0' };
  const slots = [
    { key: 'inventory', read: () => value.inventory, write: data => log.push(['inventory', data]) },
    { key: 'tools', ready: () => loaded.tools, read: () => value.tools, write: data => log.push(['tools', data]) },
    { key: 'fires', ready: () => loaded.fires, read: () => value.fires, write: data => log.push(['fires', data]) },
    ...(options.extra || []),
  ];
  const autosave = createAutosave({ store, slots, save: options.save ?? null, enabled: options.enabled ?? true, onWarn: message => log.push(['warn', message]), now: wall.now });
  // a frame, some seconds after the last
  const frame = (seconds = 0.016) => { wall.advance(seconds); autosave.update(); };
  return { autosave, storage, store, log, loaded, value, wall, frame };
}
const saved = storage => JSON.parse(storage.getItem(SAVE.key));

test('nothing is written until every part has loaded, so a slow load cannot save an empty world', () => {
  const { autosave, storage, loaded, frame } = rig();
  frame();
  frame(SAVE.interval + 1); // the timer alone is not enough
  assert.equal(autosave.flush(), false);
  assert.equal(storage.getItem(SAVE.key), null);
  loaded.tools = true;
  frame(0.1);
  assert.equal(autosave.active, false, 'the fires have not come yet');
  assert.equal(autosave.flush(), false);
  loaded.fires = true;
  frame(0.1);
  assert.equal(autosave.active, true);
  assert.equal(autosave.flush(), true);
  assert.deepEqual(saved(storage), { version: SAVE.version, savedAt: 42, inventory: ['a'], tools: 'T0', fires: 'F0' });
});

test('what a save held is put back as soon as its part is there, once, and saving starts after the last one', () => {
  const save = { inventory: ['kept'], tools: 'T1', fires: 'F1' };
  const { autosave, log, loaded, storage, frame } = rig({ save });
  frame();
  assert.deepEqual(log, [['inventory', ['kept']]], 'the part that needs no loading goes straight back');
  loaded.tools = true;
  frame();
  assert.deepEqual(log.slice(1), [['tools', 'T1']]);
  assert.equal(autosave.active, false, 'still waiting for the fires');
  assert.deepEqual(autosave.status().waiting, ['fires']);
  assert.equal(storage.getItem(SAVE.key), null);
  loaded.fires = true;
  frame();
  frame();
  assert.deepEqual(log.slice(2), [['fires', 'F1']], 'each is put back exactly once');
  assert.equal(autosave.active, true);
  assert.equal(autosave.status().waiting.length, 0);
});

test('while playing it saves on a timer, and flush saves at once', () => {
  const { autosave, loaded, value, storage, frame } = rig();
  loaded.tools = loaded.fires = true;
  frame(0);
  assert.equal(autosave.status().writes, 0);
  for (let t = 0; t < SAVE.interval - 0.5; t += 0.5) frame(0.5);
  assert.equal(autosave.status().writes, 0, 'not yet');
  frame(0.5);
  assert.equal(autosave.status().writes, 1, 'on the interval');
  value.tools = 'T9';
  assert.equal(autosave.flush(), true);
  assert.equal(saved(storage).tools, 'T9');
  assert.equal(autosave.status().writes, 2);
  for (let t = 0; t < SAVE.interval - 1; t += 0.5) frame(0.5);
  assert.equal(autosave.status().writes, 2, 'a flush starts the interval again');
});

test('a part that fails to go back is reported and left out; it never stops the others or the saving', () => {
  const { autosave, log, loaded, frame } = rig({
    save: { inventory: ['x'], tools: 'T1' },
    extra: [{ key: 'player', read: () => ({ x: 1 }), write: () => { throw new Error('no ground'); } }],
  });
  frame();
  loaded.tools = loaded.fires = true;
  frame();
  assert.ok(autosave.active);
  assert.equal(log.filter(line => line[0] === 'warn').length, 0, 'the player part had no data in this save, so nothing to put back');

  const withPlayer = rig({
    save: { inventory: ['x'], tools: 'T1', player: { x: 5 } },
    extra: [{ key: 'player', read: () => ({ x: 1 }), write: () => { throw new Error('no ground'); } }],
  });
  withPlayer.loaded.tools = withPlayer.loaded.fires = true;
  withPlayer.frame();
  assert.equal(withPlayer.log.filter(line => line[0] === 'warn').length, 1);
  assert.ok(withPlayer.log.some(line => line[0] === 'tools'), 'the others went back');
  assert.ok(withPlayer.autosave.active, 'and the game goes on saving');
  assert.equal(withPlayer.autosave.status().failures, 1);
});

test('a part that cannot be read keeps what the last good save had, not nothing', () => {
  let broken = false;
  const { autosave, storage, loaded, frame } = rig({
    extra: [{ key: 'player', read: () => { if (broken) throw new Error('lost'); return { x: 7 }; }, write() {} }],
  });
  loaded.tools = loaded.fires = true;
  frame();
  autosave.flush();
  assert.deepEqual(saved(storage).player, { x: 7 });
  broken = true;
  assert.equal(autosave.flush(), true);
  assert.deepEqual(saved(storage).player, { x: 7 }, 'the last good reading is carried over');
  assert.equal(autosave.status().failures, 1);
});

test('turned off, it neither puts anything back nor writes', () => {
  const { autosave, storage, log, loaded, frame } = rig({ enabled: false, save: { inventory: ['x'] } });
  loaded.tools = loaded.fires = true;
  frame();
  frame(100);
  assert.equal(autosave.flush(), false);
  assert.equal(storage.getItem(SAVE.key), null);
  assert.deepEqual(log, []);
  assert.equal(autosave.status().enabled, false);
});

test('the start counts as having worked after a few seconds of drawing on the wall clock, even if a model never loads', () => {
  const calls = [];
  const wall = clock();
  const store = { write: () => 1, bootDone: () => calls.push('done') };
  const autosave = createAutosave({ store, now: wall.now, slots: [{ key: 'tools', ready: () => false, read: () => 1, write() {} }] });
  autosave.update();
  wall.advance(SAVE.bootOkAfter + 1);
  autosave.update();
  assert.deepEqual(calls, [], 'a few seconds with hardly a frame drawn is not a start that worked');
  for (let i = 0; i < SAVE.bootOkFrames; i++) autosave.update();
  autosave.update();
  assert.deepEqual(calls, ['done'], 'once');
  assert.equal(autosave.active, false, 'but it never saves over a world it could not load');

  const early = [];
  const quick = createAutosave({ store: { write: () => 1, bootDone: () => early.push('done') }, now: wall.now, slots: [] });
  for (let i = 0; i < 100; i++) quick.update(); // plenty of frames in no time at all
  assert.deepEqual(early, [], 'and a crash a moment after the start is not a start that worked');
});

test('a slow game still saves on time, because the timer is the wall clock, not game time', () => {
  const { autosave, loaded, frame } = rig();
  loaded.tools = loaded.fires = true;
  frame();
  for (let i = 0; i < 4; i++) frame(SAVE.interval / 3); // four slow frames
  assert.equal(autosave.status().writes, 1);
  frame(-50); // the clock going backwards changes nothing
  assert.equal(autosave.status().writes, 1);
});

test('a slot whose readiness check throws counts as not ready', () => {
  const autosave = createAutosave({ store: { write: () => 1, bootDone() {} }, slots: [{ key: 'tools', ready: () => { throw new Error('x'); }, read: () => 1, write() {} }] });
  autosave.update();
  assert.equal(autosave.active, false);
  assert.equal(autosave.flush(), false);
});
