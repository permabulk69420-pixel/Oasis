// Saving. The game keeps itself in the browser's local storage, quietly, and picks up where you left off when the page comes back
// (the Quest browser reloads a page now and then, for instance when the headset has been off). There is no button and no menu:
//   * every few seconds, and whenever the page is hidden, the headset is taken off or the menu is closed, the state is written;
//   * on the way back in, whatever was saved is put back as soon as the part it belongs to has loaded (the tools and the campfire are
//     models, which arrive a moment after the page does);
//   * nothing is written until everything saved has been put back, so a slow load can never save an empty world over a full one;
//   * ?fresh=1 starts a new game (the old save is kept aside, not thrown away), and a save the game cannot read, or one that has
//     crashed the game twice in a row, is set aside the same way and the game starts clean.
// What is saved: what you carry, your health and food, the time of day, where you stand, the tools (on a hip, lying on the sand, or
// still standing where they were planted), campfires, the backpack, and the rocks you have broken. What is not: things that come back
// by themselves (trees regrow within minutes, loose sticks, stones and fruit are scattered again) and the creatures.
// This file knows nothing about the game's parts. It holds the format, the checks and the storage; src/main.js says what to read and
// write. Every number in a save is checked on the way in, so a damaged save can lose a part of the game but cannot break it.

import { cleanBuildings } from './building-kit.js';

export const SAVE = Object.freeze({
  key: 'oasis-save',
  keepKey: 'oasis-save-kept', // the last save that was set aside (a fresh start, a crash, or one that could not be read)
  bootKey: 'oasis-save-boot', // how many times in a row the game started and did not get as far as drawing a few seconds
  version: 1,
  interval: 10, // seconds between saves while playing
  bootOkAfter: 3, // seconds (of the clock on the wall, not of game time) of drawing after which the start counts as having worked
  bootOkFrames: 20, // and this many frames drawn
  failedBootsToReset: 2,
  maxBytes: 60000, // a save bigger than this is a bug; it is not written
  limit: 498, // the world's edge (the player cannot go further)
  worldRadius: 700, // anything placed further out than this in a save is not believed
  maxItems: 64,
});

const LIMITS = Object.freeze({ maxTypeLength: 40, maxCount: 9999, maxFalls: 4, maxMining: 4000, maxId: 60, maxData: 8 });
const FALL_PHASES = Object.freeze(['air', 'settling', 'rest', 'stuck']);
const SIDES = Object.freeze(['left', 'right']);

const isNumber = value => typeof value === 'number' && Number.isFinite(value);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const wrap = (value, size) => ((value % size) + size) % size;
const near = value => isNumber(value) && Math.abs(value) <= SAVE.worldRadius;
const vector = (list, length, ok) => Array.isArray(list) && list.length === length && list.every(ok);

// ------------------------------------------------------------------------------------------------ the checks, part by part
// Each returns the cleaned part, or undefined when there is nothing usable (and the game then keeps its own value for it).

function cleanInventory(list) {
  if (!Array.isArray(list)) return undefined;
  const out = [];
  for (const item of list.slice(0, SAVE.maxItems)) {
    const type = item?.type;
    const count = item?.count;
    if (typeof type !== 'string' || !type || type.length > LIMITS.maxTypeLength) continue;
    if (!Number.isSafeInteger(count) || count <= 0) continue;
    out.push({ type, count: Math.min(count, LIMITS.maxCount) });
  }
  return out;
}

function cleanSurvival(data) {
  if (!isObject(data)) return undefined;
  const out = {};
  for (const name of ['health', 'stamina', 'food', 'water']) if (isNumber(data[name])) out[name] = clamp(data[name], 0, 100);
  return Object.keys(out).length ? out : undefined;
}

function cleanTime(hours) {
  return isNumber(hours) ? wrap(hours, 24) : undefined;
}

function cleanPlayer(data) {
  if (!isObject(data) || !isNumber(data.x) || !isNumber(data.z)) return undefined;
  return {
    x: clamp(data.x, -SAVE.limit, SAVE.limit),
    z: clamp(data.z, -SAVE.limit, SAVE.limit),
    yaw: isNumber(data.yaw) ? Math.atan2(Math.sin(data.yaw), Math.cos(data.yaw)) : 0,
    ...(isNumber(data.y) ? { y: clamp(data.y, -100, 1000) } : {}),
  };
}

// Small facts a tool keeps about itself (a torch: lit). Plain true/false, numbers and short words only.
function cleanData(data) {
  if (!isObject(data)) return undefined;
  const out = {};
  for (const [name, value] of Object.entries(data).slice(0, LIMITS.maxData)) {
    if (name.length > LIMITS.maxTypeLength) continue;
    if (typeof value === 'boolean' || isNumber(value) || (typeof value === 'string' && value.length <= LIMITS.maxTypeLength)) out[name] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

function cleanTools(data) {
  if (!isObject(data) || !Array.isArray(data.items)) return undefined;
  const kinds = Array.isArray(data.kinds)
    ? data.kinds.filter(id => typeof id === 'string' && id && id.length <= LIMITS.maxTypeLength).slice(0, SAVE.maxItems)
    : [];
  const items = [];
  for (const item of data.items.slice(0, SAVE.maxItems)) {
    const id = item?.id;
    if (typeof id !== 'string' || !id || id.length > LIMITS.maxTypeLength) continue;
    const entry = { id };
    const extra = cleanData(item.data);
    if (extra) entry.data = extra;
    if (item.at === 'hip') {
      if (!SIDES.includes(item.side)) continue;
      entry.at = 'hip';
      entry.side = item.side;
    } else if (item.at === 'ground') {
      if (!vector(item.p, 3, near) || !vector(item.q, 4, isNumber)) continue;
      const length = Math.hypot(...item.q);
      if (!(length > 0.5 && length < 2)) continue; // not a turn at all
      entry.at = 'ground';
      entry.p = item.p;
      entry.q = item.q.map(v => v / length);
      if (FALL_PHASES.includes(item.fall)) entry.fall = item.fall;
    } else continue;
    items.push(entry);
    if (!kinds.includes(id)) kinds.push(id);
  }
  return { kinds, items };
}

function cleanFires(list) {
  if (!Array.isArray(list)) return undefined;
  const out = [];
  for (const fire of list.slice(0, SAVE.maxItems)) {
    if (!isObject(fire) || !near(fire.x) || !near(fire.z)) continue;
    out.push({ x: fire.x, z: fire.z, lit: fire.lit === true });
  }
  return out;
}

function cleanPack(data) {
  if (!isObject(data)) return undefined;
  if (data.status === 'worn') return { status: 'worn' };
  if (data.status === 'ground' && near(data.x) && near(data.z)) {
    return { status: 'ground', x: data.x, z: data.z, yaw: isNumber(data.yaw) ? Math.atan2(Math.sin(data.yaw), Math.cos(data.yaw)) : 0 };
  }
  return undefined;
}

// Which rocks are broken and how long each still has to wait (src/mining.js checks the rest, and knows its own version).
function cleanMining(data) {
  if (!isObject(data) || !isNumber(data.version) || !isObject(data.waiting)) return undefined;
  const waiting = {};
  for (const [id, seconds] of Object.entries(data.waiting).slice(0, LIMITS.maxMining)) {
    if (id.length <= LIMITS.maxId && isNumber(seconds) && seconds >= 0 && seconds <= 1e6) waiting[id] = Math.round(seconds);
  }
  return { version: data.version, waiting };
}

const CLEANERS = Object.freeze({
  inventory: cleanInventory, survival: cleanSurvival, time: cleanTime, player: cleanPlayer,
  tools: cleanTools, fires: cleanFires, buildings: cleanBuildings, pack: cleanPack, mining: cleanMining,
});
export const SAVE_PARTS = Object.freeze(Object.keys(CLEANERS));

// A save as it came out of storage (already parsed), or null when it is not one this version can read.
export function cleanSave(raw) {
  if (!isObject(raw) || raw.version !== SAVE.version) return null;
  const save = { version: SAVE.version, savedAt: isNumber(raw.savedAt) ? raw.savedAt : 0 };
  for (const [name, clean] of Object.entries(CLEANERS)) {
    const part = clean(raw[name]);
    if (part !== undefined) save[name] = part;
  }
  return save;
}

// ?fresh=1 (or anything but 0 / false / no / off) asks for a new game.
export function wantsFresh(search) {
  let value;
  try { value = new URLSearchParams(search).get('fresh'); } catch { return false; }
  return value !== null && !['0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

// ------------------------------------------------------------------------------------------------ storage
// Local storage can be missing or refuse (a private window, a full disk, a blocked site): nothing here ever throws.

export function browserStorage() {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function createSaveStore({ storage = browserStorage(), now = () => Date.now() } = {}) {
  const read = key => { try { return storage ? storage.getItem(key) : null; } catch { return null; } };
  const put = (key, text) => { try { storage?.setItem(key, text); return Boolean(storage); } catch { return false; } };
  const drop = key => { try { storage?.removeItem(key); } catch { /* nothing to do */ } };
  const setAside = text => { if (typeof text === 'string' && text) put(SAVE.keepKey, text); drop(SAVE.key); };

  // Start of a run: counts the start, then says what to do. The result is { save, note } with save null for a new game.
  // note is one of 'none' (nothing saved yet), 'loaded', 'fresh' (asked for), 'unreadable' and 'crashed'.
  function begin({ fresh = false } = {}) {
    const failedBoots = Number.parseInt(read(SAVE.bootKey), 10) || 0;
    put(SAVE.bootKey, String(failedBoots + 1));
    const text = read(SAVE.key);
    if (fresh) { setAside(text); return { save: null, note: 'fresh' }; }
    if (text === null) return { save: null, note: 'none' };
    if (failedBoots >= SAVE.failedBootsToReset) { setAside(text); put(SAVE.bootKey, '1'); return { save: null, note: 'crashed' }; }
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* damaged */ }
    const save = cleanSave(parsed);
    if (!save) { setAside(text); return { save: null, note: 'unreadable' }; }
    return { save, note: 'loaded' };
  }

  // The game has been drawing for a few seconds: the start worked.
  function bootDone() { drop(SAVE.bootKey); }

  function write(save) {
    let text;
    try { text = JSON.stringify({ ...save, version: SAVE.version, savedAt: now() }); } catch { return 0; }
    if (text.length > SAVE.maxBytes) return 0;
    return put(SAVE.key, text) ? text.length : 0;
  }

  return { begin, bootDone, write, available: () => Boolean(storage), peek: () => read(SAVE.key), kept: () => read(SAVE.keepKey) };
}

// ------------------------------------------------------------------------------------------------ the autosave
// slots: [{ key, ready?(), read(), write(data) }], one per part of the game (SAVE_PARTS). `ready` says the part has loaded.
// A slot is read for every save and written once, at the start, with what the save held for it.
// Time here is the clock on the wall (now, in milliseconds), not game time: a slow headset still saves every few seconds.
export function createAutosave({ store, slots, save = null, enabled = true, onWarn = console.warn, now = () => Date.now() } = {}) {
  const slotByKey = new Map(slots.map(slot => [slot.key, slot]));
  const waiting = new Map();
  const last = {};
  if (save) {
    for (const slot of slots) {
      if (save[slot.key] !== undefined) { waiting.set(slot.key, save[slot.key]); last[slot.key] = save[slot.key]; }
    }
  }
  let active = false; // everything saved has been put back, so saving is allowed
  let firstFrameAt = null;
  let frames = 0;
  let bootCounted = false;
  let lastWriteAt = 0;
  let writes = 0;
  let lastBytes = 0;
  let failures = 0;

  const ready = slot => { try { return slot.ready ? Boolean(slot.ready()) : true; } catch { return false; } };

  // What the game is now, part by part. A part that cannot be read keeps what it had before.
  function collect() {
    const out = {};
    for (const slot of slots) {
      try {
        const data = slot.read();
        if (data !== undefined && data !== null) { out[slot.key] = data; last[slot.key] = data; }
      } catch (error) {
        failures++;
        onWarn(`[Oasis save] Could not read ${slot.key}: ${error?.message || error}`);
        if (last[slot.key] !== undefined) out[slot.key] = last[slot.key];
      }
    }
    return out;
  }

  function flush() {
    if (!enabled || !active) return false;
    if (!slots.every(ready)) return false;
    lastBytes = store.write(collect());
    if (lastBytes) writes++;
    lastWriteAt = now();
    return lastBytes > 0;
  }

  // Once a frame. Puts back whatever has loaded, then saves on the timer.
  function update() {
    if (!enabled) return;
    const time = now();
    for (const [key, data] of waiting) {
      const slot = slotByKey.get(key);
      if (!slot || !ready(slot)) continue;
      waiting.delete(key);
      try { slot.write(data); } catch (error) {
        failures++;
        onWarn(`[Oasis save] Could not put back ${key}: ${error?.message || error}`);
        delete last[key];
      }
    }
    // The start counts as having worked once the game has been drawing for a few seconds, whether or not everything has loaded.
    firstFrameAt ??= time;
    frames++;
    if (!bootCounted && frames >= SAVE.bootOkFrames && time - firstFrameAt >= SAVE.bootOkAfter * 1000) { bootCounted = true; store.bootDone(); }
    if (!active && waiting.size === 0 && slots.every(ready)) { active = true; lastWriteAt = time; }
    if (!active) return;
    if (time - lastWriteAt >= SAVE.interval * 1000) flush();
  }

  return {
    update,
    flush,
    collect,
    get active() { return active; },
    status: () => ({ enabled, active, waiting: Array.from(waiting.keys()), writes, bytes: lastBytes, failures }),
  };
}
