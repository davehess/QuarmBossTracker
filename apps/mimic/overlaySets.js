// overlaySets.js — named overlay sets (Mimic 3.0 step 1; DESIGN-mimic-3.0-overlay-builder.md R18 + R20,
// DECISIONS §83a).
//
// The guild lead, 2026-09-29: "we also need to build in multiple overlay modes per character, switchable
// via hotkeys or a simple pipe output that we pick up /pipe mimic load <overlay set name> or /pipe mimic
// save <overlay set name> the same load/save should also be available from taskbar or cycle through via
// command … we need our overlays arrangements to be stored locally in case of server issues".
//
// A set is a snapshot main.js takes: which overlays are on, where each one sits (with the screen setup it
// was saved on), how each is drawn (opacity, background, size) and the Timers canvas panels. Sets are
// not owned by a character — any character can load any set, which is what makes reuse between
// characters free. Each character keeps the sets it has used, in order, so `next` cycles that
// character's own modes.
//
// This file is the store and the command parser, nothing else: pure functions over a plain object plus
// an atomic file write, so the tests run it without Electron. It lives next to config.json and is read
// with no network — the database backup (R20) is the next step and copies this same JSON.
'use strict';
const fs = require('fs');
const path = require('path');

const MAX_SETS = 40;          // a set is a few KB; forty is far past any real use and bounds the file
const NAME_MAX = 32;

function cleanName(v) {
  const s = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  return s || null;
}
const keyOf = (name) => String(name).toLowerCase();

function empty() { return { version: 1, sets: {}, chars: {} }; }

// Whatever came off disk → a store every function below can trust.
function normalize(j) {
  const out = empty();
  if (!j || typeof j !== 'object') return out;
  for (const [k, s] of Object.entries(j.sets || {})) {
    const name = s && cleanName(s.name);
    if (!name || keyOf(name) !== k) continue;
    out.sets[k] = s;
  }
  for (const [c, v] of Object.entries(j.chars || {})) {
    if (!/^[a-z]+$/.test(c) || !v || typeof v !== 'object') continue;
    const list = Array.isArray(v.list) ? v.list.filter((k, i, a) => out.sets[k] && a.indexOf(k) === i) : [];
    out.chars[c] = { list, current: out.sets[v.current] ? v.current : null };
  }
  return out;
}

function load(file) {
  for (const f of [file, file + '.bak']) {
    try { return normalize(JSON.parse(fs.readFileSync(f, 'utf8'))); } catch { /* next */ }
  }
  return empty();
}

// Same shape as main.js saveConfig: .tmp, keep the whole current file as .bak, rename over.
function save(file, store) {
  const text = JSON.stringify(store, null, 2);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file + '.tmp', text);
    try { const cur = fs.readFileSync(file, 'utf8'); JSON.parse(cur); fs.writeFileSync(file + '.bak', cur); } catch { /* none yet, or torn */ }
    fs.renameSync(file + '.tmp', file);
  } catch {
    fs.writeFileSync(file, text);
  }
}

const charKey = (c) => (c && /^[A-Za-z]+$/.test(String(c)) ? String(c).toLowerCase() : null);

function _use(store, key, char) {
  const c = charKey(char);
  if (!c) return;
  const e = store.chars[c] || (store.chars[c] = { list: [], current: null });
  if (!e.list.includes(key)) e.list.push(key);
  e.current = key;
}

// Save (or overwrite) a set. → { ok, key, name, created } or { ok:false, error }.
function put(store, name, snapshot, char, now) {
  const n = cleanName(name);
  if (!n) return { ok: false, error: 'A set needs a name.' };
  const key = keyOf(n);
  const created = !store.sets[key];
  if (created && Object.keys(store.sets).length >= MAX_SETS) {
    return { ok: false, error: `You have ${MAX_SETS} sets already — delete one first.` };
  }
  store.sets[key] = Object.assign({}, snapshot, { name: n, savedAt: now || Date.now() });
  _use(store, key, char);
  return { ok: true, key, name: n, created };
}

// Mark a set in use by a character. → the set or null.
function use(store, name, char) {
  const n = cleanName(name);
  const key = n && keyOf(n);
  if (!key || !store.sets[key]) return null;
  _use(store, key, char);
  return store.sets[key];
}

// The set after (dir 1) or before (dir -1) the character's current one, among the sets that character
// has used. A character with fewer than two of its own cycles through every set, by name. → key|null.
function step(store, char, dir) {
  const c = charKey(char);
  const own = (c && store.chars[c] && store.chars[c].list) || [];
  const ring = own.length >= 2 ? own : Object.keys(store.sets).sort();
  if (!ring.length) return null;
  const cur = c && store.chars[c] ? store.chars[c].current : null;
  const i = ring.indexOf(cur);
  const d = dir < 0 ? -1 : 1;
  return ring[i < 0 ? (d > 0 ? 0 : ring.length - 1) : (i + d + ring.length) % ring.length];
}

function remove(store, name) {
  const n = cleanName(name);
  const key = n && keyOf(n);
  if (!key || !store.sets[key]) return false;
  delete store.sets[key];
  for (const e of Object.values(store.chars)) {
    e.list = e.list.filter(k => k !== key);
    if (e.current === key) e.current = null;
  }
  return true;
}

function current(store, char) {
  const c = charKey(char);
  return (c && store.chars[c] && store.chars[c].current) || null;
}

// For a menu or the Settings list: every set by name, flagged for this character.
function list(store, char) {
  const c = charKey(char);
  const e = (c && store.chars[c]) || { list: [], current: null };
  return Object.keys(store.sets).sort().map(k => ({
    key: k, name: store.sets[k].name, savedAt: store.sets[k].savedAt || 0,
    current: e.current === k, mine: e.list.includes(k),
    overlays: Object.values(store.sets[k].show || {}).filter(Boolean).length,
  }));
}

// `/pipe mimic <verb> [name]` → { verb, name?, on? } or null for anything that is not ours.
//   load <set> · save [set] (no name = over the current one) · next · prev
//   lock (flips) · lock on|off · unlock · group <canvas group name> (show / hide it)
// No delete from the game: one typo on a hotbar would lose a set. Settings deletes.
function parsePipeCommand(text) {
  const m = String(text == null ? '' : text).trim().match(/^mimic\s+([a-z]+)\b\s*(.*)$/i);
  if (!m) return null;
  const verb = m[1].toLowerCase();
  const arg = m[2].trim();
  if (verb === 'load') { const name = cleanName(arg); return name ? { verb, name } : null; }
  if (verb === 'save') return { verb, name: cleanName(arg) };
  if (verb === 'next' || verb === 'prev') return { verb };
  if (verb === 'unlock') return { verb: 'lock', on: false };
  // Show or hide a saved Canvas group by name: the same toggle as its hotkey.
  if (verb === 'group') { const name = cleanName(arg); return name ? { verb, name } : null; }
  // Arrange the Timers canvas (the pieces chooser opens with it): the fast way in from the game.
  if (verb === 'edit' || verb === 'arrange') {
    if (!arg) return { verb: 'edit', on: null };
    if (/^(on|yes|1)$/i.test(arg)) return { verb: 'edit', on: true };
    if (/^(off|no|0|done)$/i.test(arg)) return { verb: 'edit', on: false };
    return null;
  }
  if (verb === 'lock') {
    if (!arg) return { verb, on: null };
    if (/^(on|yes|1)$/i.test(arg)) return { verb, on: true };
    if (/^(off|no|0)$/i.test(arg)) return { verb, on: false };
    return null;
  }
  return null;
}

module.exports = { MAX_SETS, NAME_MAX, cleanName, keyOf, empty, normalize, load, save, put, use, step, remove, current, list, parsePipeCommand };
