// utils/raidAppearance.js — how each raider LOOKED on a raid night, so a night recorded in
// raid_track_minutes can be replayed with bodies that look like the people who were there.
//
// WHY IT EXISTS
// raid_track_minutes (utils/raidTrack.js) says where every raider stood, minute by minute, and nothing
// about what they looked like (the guild lead, 2026-10-05: "mostly the theme and the view of the area and
// how we look as characters so if we animate something in the future it looks good"). Nothing in the raid
// feeds carries appearance, so it is derived from what the platform already holds:
//   characters         race (text), deity_id, and the two privacy flags
//   character_gear     the equipped items of a Quarmy export  → source 'quarmy'
//   character_inventory the worn rows of the inventory file    → source 'inventory' (only when there is no gear)
//   eqemu_items        idfile / material / color of those items (migration 20261006010000)
// A raider with none of the item data is still written, as source 'who', with race and deity only.
// A later Zeal change will read the real appearance off the entity (gender, face, hair, dyes); it writes
// to the same table as source 'zeal_entity' and uses lookHash() below, so the two never disagree on what
// "the same look" means (migration 20261006020000 has the column reference).
//
// WHEN IT RUNS
// raidTrack._writeMinute calls noteMinute() after a minute row lands. The first time a night_key gets a
// row in this process every raider of that minute is snapshotted; a raider not seen before is snapshotted
// in the minute they first appear; and everyone again once REFRESH_MS has passed (gear changes). A look
// that has not changed inserts nothing: the primary key is (guild, night, lower(name), look_hash) and the
// insert is ON CONFLICT DO NOTHING. Fire-and-forget: nothing here ever throws into the recorder.
//
// PRIVACY
// characters.exclude_from_stats = true → never written (the same rule as raid_track_minutes).
// characters.exclude_inventory = true  → written with NO item data (source 'who'): the gear and the
// inventory file are exactly what that flag withholds.
// Both flags are read from the full list of flagged characters and compared in lowercase, on every
// snapshot, and a snapshot that cannot read them writes nothing (fail closed).
//
// THE LOOK, in the client's terms
//   mat[7]    armor material per textured slot: head, chest, arms, wrist, hands, legs, feet (0 = none)
//   tint[7]   the dye of those slots (eqemu_items.color, unsigned 32-bit ARGB)
//   prim_it / sec_it   the model number of the primary / secondary weapon ('IT63' → 63)
// Only the nine slots above are visible; rings, ears, neck, back and the rest are not read.

'use strict';

const crypto = require('crypto');

const REFRESH_MS = 60 * 60 * 1000;    // a night is snapshotted again this often (gear changes mid-raid)
const MAX_NIGHTS = 3;                 // nights of in-process state kept
const NAME_CHUNK = 100;               // names per `in.(…)` read
const ITEM_CHUNK = 150;               // item ids per `in.(…)` read
const INSERT_CHUNK = 200;             // rows per insert

let _deps = {};
const _sb = () => _deps.supabase || require('./supabase');
const _guildId = () => process.env.SUPABASE_GUILD_ID || 'wolfpack';
const _enc = encodeURIComponent;

// ── Races ────────────────────────────────────────────────────────────────────
// The client's race numbers for the playable races. `characters.race` spells them out ('Dark Elf',
// and 'Half-Elf' from some feeds), so the key is lowercase with the hyphen made a space.
const RACE_IDS = {
  human: 1, barbarian: 2, erudite: 3, 'wood elf': 4, 'high elf': 5, 'dark elf': 6, 'half elf': 7,
  dwarf: 8, troll: 9, ogre: 10, halfling: 11, gnome: 12, iksar: 128, 'vah shir': 130, froglok: 330,
};
const _raceKey = (s) => String(s).trim().toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ');

/** The race as stored, or null for "we do not know" (the characters table holds 'UNKNOWN' and NULL). */
function cleanRace(race) {
  if (typeof race !== 'string') return null;
  const s = race.trim();
  return s && !/^unknown$/i.test(s) ? s : null;
}
function raceId(race) {
  const r = cleanRace(race);
  return r && RACE_IDS[_raceKey(r)] != null ? RACE_IDS[_raceKey(r)] : null;
}

// ── Visible slots ────────────────────────────────────────────────────────────
// lowercase label (as character_gear and the inventory file spell it) → [canonical slot, armor index].
// character_gear says 'Wrist1' and the inventory file 'Wrist'; both are the one wrist the client draws.
// A null index is a hand: its model comes from the item's idfile, not its material.
const VISIBLE = {
  head: ['Head', 0], chest: ['Chest', 1], arms: ['Arms', 2], wrist1: ['Wrist1', 3], wrist: ['Wrist1', 3],
  hands: ['Hands', 4], legs: ['Legs', 5], feet: ['Feet', 6], primary: ['Primary', null], secondary: ['Secondary', null],
};
const SLOT_ORDER = ['Head', 'Chest', 'Arms', 'Wrist1', 'Hands', 'Legs', 'Feet', 'Primary', 'Secondary'];
const INVENTORY_LABELS = ['Head', 'Chest', 'Arms', 'Wrist', 'Wrist1', 'Hands', 'Legs', 'Feet', 'Primary', 'Secondary'];

const _canonSlot = (label) => { const v = VISIBLE[String(label || '').trim().toLowerCase()]; return v ? v[0] : null; };
const _itNumber = (idfile) => { const m = /^IT(\d+)$/i.exec(String(idfile == null ? '' : idfile).trim()); return m ? parseInt(m[1], 10) : null; };
const _int = (v) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) ? n : 0; };

/**
 * The model columns of a raider's visible items.
 * `worn` is Map<canonical slot, item id>; `models` is Map<item id, {idfile, material, color}>, or null when the
 * catalog could not say what any item looks like (then mat/tint/prim_it/sec_it stay null: "unknown", which
 * must not read as "naked").
 */
function lookFromWorn(worn, models) {
  const list = SLOT_ORDER.filter(s => worn.has(s)).map(slot => {
    const id = worn.get(slot);
    const m = models ? models.get(id) : null;
    return { slot, item_id: id, idfile: m ? m.idfile ?? null : null, material: m ? m.material ?? null : null, color: m ? m.color ?? null : null };
  });
  if (!models) return { worn: list, mat: null, tint: null, prim_it: null, sec_it: null };
  const mat = [0, 0, 0, 0, 0, 0, 0];
  const tint = [0, 0, 0, 0, 0, 0, 0];
  let prim = null, sec = null;
  for (const w of list) {
    const idx = VISIBLE[w.slot.toLowerCase()][1];
    if (idx != null) { mat[idx] = _int(w.material); tint[idx] = _int(w.color); }
    else if (w.slot === 'Primary') prim = _itNumber(w.idfile);
    else sec = _itNumber(w.idfile);
  }
  return { worn: list, mat, tint, prim_it: prim, sec_it: sec };
}

// ── The hash ─────────────────────────────────────────────────────────────────
const _n = (v) => (v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v)) ? null : v);

/**
 * A stable id for what a body LOOKS like: the first 16 hex characters of sha256 over the visible fields in
 * a fixed order. Deity, worn items' ids and timestamps are not visible and are not in it. `look` is any
 * object carrying (some of) race_id, race, gender, face, hair_style, hair_color, beard_style, beard_color,
 * texture, height, mat, tint, prim_it, sec_it — the Zeal writer calls this with what it read.
 */
function lookHash(look) {
  const l = look || {};
  const arr = (a) => (Array.isArray(a) ? a.map(_n) : null);
  const race = _n(l.race_id) ?? (cleanRace(l.race) ? _raceKey(cleanRace(l.race)) : null);
  const fields = [
    race, _n(l.gender), _n(l.face), _n(l.hair_style), _n(l.hair_color), _n(l.beard_style), _n(l.beard_color),
    _n(l.texture), _n(l.height) == null ? null : Math.round(Number(l.height) * 100) / 100,
    arr(l.mat), arr(l.tint), _n(l.prim_it), _n(l.sec_it),
  ];
  return crypto.createHash('sha256').update(JSON.stringify(fields)).digest('hex').slice(0, 16);
}

/**
 * One raid_night_appearance row. `char` is the characters row (or null), `worn` Map<slot, item id> or null
 * when there is no item data, `source` one of 'quarmy' | 'inventory' | 'who'.
 */
function buildRow({ guildId, nightKey, name, char, worn, models, source }) {
  const look = worn ? lookFromWorn(worn, models) : { worn: null, mat: null, tint: null, prim_it: null, sec_it: null };
  const race = cleanRace(char && char.race);
  const fields = {
    race, race_id: raceId(race),
    gender: null, face: null, hair_style: null, hair_color: null, beard_style: null, beard_color: null,
    texture: null, height: null,
    mat: look.mat, tint: look.tint, prim_it: look.prim_it, sec_it: look.sec_it,
  };
  return {
    guild_id: guildId,
    night_key: nightKey,
    name_key: String(name).toLowerCase(),
    look_hash: lookHash(fields),
    character_name: char && char.name ? char.name : String(name),
    source,
    ...fields,
    deity: char && Number(char.deity_id) > 0 ? Number(char.deity_id) : null,
    worn: look.worn,
  };
}

// ── Reads ────────────────────────────────────────────────────────────────────

const _inList = (names) => '(' + names.map(n => `"${String(n).replace(/["\\]/g, '')}"`).join(',') + ')';
const _chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const _cap = (s) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);

// Raid rosters and the character tables spell a name with the same capital letter in practice, and the
// `in.()` filter is case-sensitive, so ask for the name as given AND as Capitalised. Rows that come back are
// matched on lowercase, so either spelling lands on the right raider.
function _queryNames(given) {
  const set = new Set();
  for (const g of given) { set.add(g.name); set.add(_cap(g.name)); }
  return [...set];
}

// Lowercase names of the characters that opted out, or null when a list could not be read.
async function _flags(sb, guild) {
  const base = `guild_id=eq.${_enc(guild)}`;
  let stats = null, inv = null;
  try {
    stats = await sb.selectAllPaged('characters', `${base}&exclude_from_stats=eq.true&select=name`, 'name');
    inv = await sb.selectAllPaged('characters', `${base}&exclude_inventory=eq.true&select=name`, 'name');
  } catch { return null; }
  if (!Array.isArray(stats) || !Array.isArray(inv)) return null;
  const lower = (rows) => new Set(rows.map(r => String(r && r.name || '').toLowerCase()).filter(Boolean));
  return { stats: lower(stats), inv: lower(inv) };
}

// lowercase name → characters row (race, deity), or null when the read failed.
async function _characters(sb, guild, queryNames) {
  const out = new Map();
  for (const chunk of _chunks(queryNames, NAME_CHUNK)) {
    const rows = await sb.select('characters',
      `guild_id=eq.${_enc(guild)}&name=in.${_enc(_inList(chunk))}&select=name,race,deity_id&limit=${chunk.length}`);
    if (!Array.isArray(rows)) return null;
    for (const r of rows) if (r && r.name) out.set(String(r.name).toLowerCase(), r);
  }
  return out;
}

// lowercase name → Map<slot, item id> of EQUIPPED items. A character with any equipped row has a Quarmy export.
async function _gear(sb, guild, queryNames) {
  const out = new Map();
  for (const chunk of _chunks(queryNames, NAME_CHUNK)) {
    // guild and loc are pinned, so (character, slot) is the primary key that is left: a unique order.
    const rows = await sb.selectAllPaged('character_gear',
      `guild_id=eq.${_enc(guild)}&loc=eq.equipped&character=in.${_enc(_inList(chunk))}&select=character,slot,item_id`,
      'character,slot');
    if (!Array.isArray(rows)) return null;
    for (const r of rows) {
      if (!r || !r.character) continue;
      const k = String(r.character).toLowerCase();
      if (!out.has(k)) out.set(k, new Map());
      const slot = _canonSlot(r.slot);
      if (slot && Number(r.item_id) > 0) out.get(k).set(slot, Number(r.item_id));
    }
  }
  return out;
}

// Same shape from the worn rows of the inventory file.
async function _worn(sb, guild, queryNames) {
  const out = new Map();
  for (const chunk of _chunks(queryNames, NAME_CHUNK)) {
    const rows = await sb.selectAllPaged('character_inventory',
      `guild_id=eq.${_enc(guild)}&character_name=in.${_enc(_inList(chunk))}` +
      `&slot_label=in.${_enc('(' + INVENTORY_LABELS.join(',') + ')')}&select=character_name,slot_label,item_id`,
      'id');
    if (!Array.isArray(rows)) return null;
    for (const r of rows) {
      if (!r || !r.character_name) continue;
      const k = String(r.character_name).toLowerCase();
      if (!out.has(k)) out.set(k, new Map());
      const slot = _canonSlot(r.slot_label);
      if (slot && Number(r.item_id) > 0 && !out.get(k).has(slot)) out.get(k).set(slot, Number(r.item_id));
    }
  }
  return out;
}

let _warnedModels = false;
// item id → { idfile, material, color }, or null when the catalog cannot say what ANY item looks like:
// the read failed (the columns are not there yet) or every value is NULL (the weekly sync has not filled
// them). Null is "unknown", which a look must not turn into "wearing nothing".
async function _itemModels(sb, ids) {
  const out = new Map();
  if (!ids.length) return out;
  let any = false;
  for (const chunk of _chunks(ids, ITEM_CHUNK)) {
    const rows = await sb.select('eqemu_items', `id=in.(${chunk.join(',')})&select=id,idfile,material,color&limit=${chunk.length}`);
    if (!Array.isArray(rows)) { out.clear(); any = false; break; }
    for (const r of rows) {
      if (!r || r.id == null) continue;
      out.set(Number(r.id), { idfile: r.idfile ?? null, material: r.material ?? null, color: r.color ?? null });
      if (r.material != null || r.idfile != null) any = true;
    }
  }
  if (!any && !_warnedModels) {
    _warnedModels = true;
    console.warn('[raid-appearance] eqemu_items has no model data (idfile/material/color) — looks carry race only until the catalog sync fills it');
  }
  return any ? out : null;
}

// ── The snapshot ─────────────────────────────────────────────────────────────

/**
 * Write one row per raider for `nightKey`, from the data the platform already holds. Rows whose look is
 * already stored are left alone. Never throws; resolves { ok, ... }:
 *   { ok: true, names, written, inserted, sources: { quarmy, inventory, who } }
 *   { ok: false, reason }   nothing was written (Supabase off, privacy flags or characters unreadable, insert failed)
 */
async function snapshotNight({ supabase, guildId, nightKey, names } = {}) {
  try {
    const sb = supabase || _sb();
    const guild = guildId || _guildId();
    if (!sb || !sb.isEnabled() || !nightKey) return { ok: false, reason: 'disabled' };

    const seen = new Set();
    const given = [];
    for (const n of Array.isArray(names) ? names : []) {
      const k = typeof n === 'string' ? n.trim().toLowerCase() : '';
      if (k && !seen.has(k)) { seen.add(k); given.push({ name: n.trim(), key: k }); }
    }
    const none = { ok: true, names: 0, written: 0, inserted: 0, sources: { quarmy: 0, inventory: 0, who: 0 } };
    if (!given.length) return none;

    const flags = await _flags(sb, guild);
    if (!flags) return { ok: false, reason: 'flags_unreadable' };
    const targets = given.filter(g => !flags.stats.has(g.key));
    if (!targets.length) return none;
    const queryNames = _queryNames(targets);

    const chars = await _characters(sb, guild, queryNames);
    if (!chars) return { ok: false, reason: 'characters_unreadable' };

    // Item data only for raiders who have not withheld it.
    const itemTargets = targets.filter(g => !flags.inv.has(g.key));
    const itemNames = _queryNames(itemTargets);
    const gear = itemTargets.length ? await _gear(sb, guild, itemNames) : new Map();
    if (!gear) return { ok: false, reason: 'gear_unreadable' };
    const bare = itemTargets.filter(g => !gear.has(g.key));   // no Quarmy export: try the inventory file
    const inventory = bare.length ? await _worn(sb, guild, _queryNames(bare)) : new Map();
    if (!inventory) return { ok: false, reason: 'inventory_unreadable' };

    const wornOf = new Map();        // key → { worn: Map, source }
    for (const g of itemTargets) {
      if (gear.has(g.key)) wornOf.set(g.key, { worn: gear.get(g.key), source: 'quarmy' });
      else if (inventory.has(g.key) && inventory.get(g.key).size) wornOf.set(g.key, { worn: inventory.get(g.key), source: 'inventory' });
    }
    const itemIds = [...new Set([...wornOf.values()].flatMap(w => [...w.worn.values()]))].sort((a, b) => a - b);
    const models = await _itemModels(sb, itemIds);

    const sources = { quarmy: 0, inventory: 0, who: 0 };
    const rows = targets.map(g => {
      const w = wornOf.get(g.key);
      const source = w ? w.source : 'who';
      sources[source]++;
      return buildRow({
        guildId: guild, nightKey, name: g.name, char: chars.get(g.key) || null,
        worn: w ? w.worn : null, models, source,
      });
    });

    // `?select=name_key` keeps the echo to the rows PostgREST really inserted (duplicates are absorbed), a few
    // bytes each; the array reply is also how a failed write tells itself apart from "nothing new".
    let inserted = 0;
    for (const chunk of _chunks(rows, INSERT_CHUNK)) {
      const res = await sb.insertIgnoreDuplicates('raid_night_appearance?select=name_key', chunk, { representation: true });
      if (!Array.isArray(res)) return { ok: false, reason: 'insert_failed' };
      inserted += res.length;
    }
    return { ok: true, names: targets.length, written: rows.length, inserted, sources };
  } catch (err) {
    console.warn('[raid-appearance] snapshot failed:', err && err.message);
    return { ok: false, reason: 'error' };
  }
}

// ── The trigger ──────────────────────────────────────────────────────────────

// night_key → { lastFullAt, seen: Set<lowercase name>, queue: Map<lowercase name, name>, running }
const _nights = new Map();

async function _drain(st, ctx) {
  while (st.queue.size) {
    const keys = [...st.queue.keys()];
    const batch = [...st.queue.values()];
    st.queue.clear();
    let res = null;
    try { res = await snapshotNight({ ...ctx, names: batch }); } catch { res = null; }
    // A failed snapshot leaves its names unseen, so the next minute's names list asks for them again.
    if (!res || !res.ok) break;
    for (const k of keys) st.seen.add(k);
    if (res.inserted) console.log(`[raid-appearance] ${ctx.nightKey}: ${res.inserted} new look(s) of ${res.names} raider(s) (quarmy ${res.sources.quarmy}, inventory ${res.sources.inventory}, race only ${res.sources.who})`);
  }
}

/**
 * Called by the raid-track recorder after it wrote a minute. `names` are that minute's raiders (opted-out
 * raiders already removed, though snapshotNight checks again). The first minute of a night, a raider's first
 * minute, and every REFRESH_MS after the last full pass each cause a snapshot. Returns a promise that never
 * rejects; callers do not need to wait for it.
 */
function noteMinute({ supabase, guildId, nightKey, nowMs, names } = {}) {
  try {
    if (!nightKey || !Array.isArray(names) || !names.length) return Promise.resolve(null);
    const t = Number.isFinite(nowMs) ? nowMs : Date.now();
    let st = _nights.get(nightKey);
    if (!st) {
      st = { lastFullAt: -Infinity, seen: new Set(), queue: new Map(), running: null };
      _nights.set(nightKey, st);
      while (_nights.size > MAX_NIGHTS) _nights.delete(_nights.keys().next().value);
    }
    const full = t - st.lastFullAt >= REFRESH_MS;
    if (full) st.lastFullAt = t;
    for (const n of names) {
      if (typeof n !== 'string' || !n) continue;
      const k = n.toLowerCase();
      if (full || !st.seen.has(k)) st.queue.set(k, n);
    }
    if (!st.queue.size) return Promise.resolve(null);
    // One pass at a time per night; names queued while it runs are picked up by its loop.
    if (!st.running) {
      const run = _drain(st, { supabase, guildId, nightKey }).catch(() => {});
      st.running = run;
      run.then(() => { if (st.running === run) st.running = null; });
    }
    return st.running;
  } catch { return Promise.resolve(null); }
}

// Test-only: drop all state and injected deps.
function _reset() { _nights.clear(); _deps = {}; _warnedModels = false; }
// Test-only: inject { supabase }.
function _setDeps(d = {}) { _deps = { ..._deps, ...d }; }
// Test-only: how much is held in memory.
function _state() {
  return { nights: [..._nights.entries()].map(([k, s]) => ({ night: k, seen: s.seen.size, queued: s.queue.size, running: !!s.running })) };
}

module.exports = {
  snapshotNight, noteMinute, lookHash, lookFromWorn, buildRow, raceId, cleanRace,
  RACE_IDS, REFRESH_MS, MAX_NIGHTS, SLOT_ORDER, INVENTORY_LABELS,
  _reset, _setDeps, _state,
};
