// utils/wornSets.js — worn-set history (migration 20261031130000, table character_worn_sets).
//
// The guild lead, 2026-10-31 (gear variations, option B "from most often captured"): a character's saved gear sets
// should be the combinations it is captured WEARING most. character_gear and character_inventory are replaced on every
// upload, so nothing kept that history; every accepted Quarmy or inventory upload now records the equipped slots here.
//
// Pure part (testable, no I/O): normaliseWornSlots, wornSlotsFromQuarmy, wornSlotsFromInventory, wornSetHash.
// I/O part (takes the supabase helper as an argument): recordWornSet, countUnchangedWornSet.
//
// READER (the gear page, no helper needed yet): the top 3 sets of a character, most often first, with when each was
// last worn — owner only, server side, one source at a time (prefer 'quarmy', which names every worn slot):
//   select=set_hash,slots,times_seen,first_seen,last_seen
//   &guild_id=eq.<guild>&character_name=ilike.<name>&source=eq.quarmy
//   &order=times_seen.desc,last_seen.desc&limit=3
// `slots` is {"Head": item_id, ...} in the gear page's slot names, so a set renders straight onto the slot cards and
// compares against the worn set by slot.

const crypto = require('crypto');

// The worn slots, in the gear page's vocabulary (web/app/character/[name]/gear/page.tsx SLOT_ORDER), plus Power Source.
// AMMO IS DELIBERATELY NOT HERE. It is a stack, not a piece of gear: the count and the stack swap with every fight
// (and the Quarmy export reports it as the slot's item), so including it would make one outfit hash as dozens of sets.
const WORN_SLOTS = [
  'Charm', 'Ear1', 'Head', 'Face', 'Ear2', 'Neck', 'Shoulders', 'Arms', 'Back',
  'Wrist1', 'Wrist2', 'Range', 'Hands', 'Primary', 'Secondary',
  'Fingers1', 'Fingers2', 'Chest', 'Legs', 'Feet', 'Waist', 'Power Source',
];

// The labels /output inventory uses for the worn slots (the paired ones un-numbered): lets a read of the stored
// inventory ask for just these rows instead of the whole snapshot, bank included.
const INVENTORY_WORN_LABELS = [...new Set(WORN_SLOTS.map(s => s.replace(/\d$/, '')))];

// A label as either feed writes it, folded for lookup: lower case, no spaces/underscores, "Finger" == "Fingers".
const _fold = (s) => String(s || '').toLowerCase().replace(/[\s_]+/g, '').replace(/^finger(?=\d|$)/, 'fingers');
const _CANON = new Map(WORN_SLOTS.map(s => [_fold(s), s]));
// The paired slots: the Quarmy export numbers them (Ear1, Wrist2, Fingers1); /output inventory does not.
const _PAIRS = { ear: ['Ear1', 'Ear2'], wrist: ['Wrist1', 'Wrist2'], fingers: ['Fingers1', 'Fingers2'] };

// entries: [{ slot, item_id }] from either feed. Returns { <slot>: item_id } over the worn vocabulary only: unknown
// labels (bags, bank, Ammo, Held) and empty slots (no item id) are dropped. An un-numbered paired label takes the
// first free number, in the order it appears.
function normaliseWornSlots(entries) {
  const out = {};
  const unnumbered = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || typeof e.slot !== 'string') continue;
    const itemId = parseInt(e.item_id, 10);
    if (!Number.isFinite(itemId) || itemId <= 0) continue;
    const key = _fold(e.slot);
    const canon = _CANON.get(key);
    if (canon) { if (!(canon in out)) out[canon] = itemId; continue; }
    if (_PAIRS[key]) unnumbered.push({ pair: _PAIRS[key], itemId });
  }
  for (const u of unnumbered) {
    const free = u.pair.find(s => !(s in out));
    if (free) out[free] = u.itemId;
  }
  return out;
}

// Quarmy payload: rows are already split by location, so the equipped list is the worn set.
function wornSlotsFromQuarmy(equipped) {
  return normaliseWornSlots((Array.isArray(equipped) ? equipped : []).map(e => ({ slot: e && e.slot, item_id: e && e.item_id })));
}

// Inventory payload: every slot is in one list, so the worn labels are picked out by the same vocabulary.
function wornSlotsFromInventory(rows) {
  return normaliseWornSlots((Array.isArray(rows) ? rows : []).map(r => ({ slot: r && r.slot_label, item_id: r && r.item_id })));
}

// Stable identity of a worn set: the sorted "slot:item_id" pairs, hashed. Order of the input never matters; null for
// an empty set (nothing worn is not a set worth recording).
function wornSetHash(slots) {
  const keys = Object.keys(slots || {}).sort();
  if (!keys.length) return null;
  return crypto.createHash('sha1').update(keys.map(k => `${k}:${slots[k]}`).join('|')).digest('hex');
}

// A set counts at most once an hour per character (per source). The unchanged-upload path counts time spent in a
// set, and a 10-minute uploader would otherwise add six a hour; a real change of the same set within the hour is not
// a second sighting either. last_seen still moves on every upload, counted_at is the cap's clock.
const COUNT_GAP_MS = 60 * 60 * 1000;

const _q = (guildId, character, source) =>
  `guild_id=eq.${encodeURIComponent(guildId)}&character_name=ilike.${encodeURIComponent(character)}&source=eq.${encodeURIComponent(source)}`;

// last_seen always moves; times_seen and counted_at move only when the hour has passed since the last count.
async function _bump(supabase, row, now) {
  const iso = new Date(now).toISOString();
  const t = Date.parse(row.counted_at);
  const due = !Number.isFinite(t) || now - t >= COUNT_GAP_MS;
  const patch = due ? { last_seen: iso, counted_at: iso, times_seen: (row.times_seen || 0) + 1 } : { last_seen: iso };
  await supabase.update('character_worn_sets', `id=eq.${row.id}`, patch);
  return due ? 'counted' : 'seen';
}

// Record one sighting of a worn set. A new set inserts with times_seen 1; a known one moves last_seen and, when the
// hour has passed, times_seen + 1. Returns 'new' | 'counted' | 'seen' | null (nothing to record).
async function recordWornSet(supabase, { guildId, character, source, slots, now = Date.now() }) {
  const hash = wornSetHash(slots);
  if (!hash || !character) return null;
  const iso = new Date(now).toISOString();
  const rows = await supabase.select('character_worn_sets',
    `select=id,times_seen,counted_at&${_q(guildId, character, source)}&set_hash=eq.${hash}&limit=1`);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    await supabase.insert('character_worn_sets', [{
      guild_id: guildId, character_name: character, source, set_hash: hash, slots,
      first_seen: iso, last_seen: iso, counted_at: iso, times_seen: 1,
    }]);
    return 'new';
  }
  return _bump(supabase, row, now);
}

// The unchanged-upload path: the file matches what was stored, so the character is still wearing the set it was last
// captured in (the row with the newest last_seen). Count it, under the hourly cap. When there is no history at all
// (an export that has not changed since this started), `loadSlots` supplies the stored worn set to seed it from.
// Returns 'counted' | 'seen' | 'new' | null.
async function countUnchangedWornSet(supabase, { guildId, character, source, loadSlots, now = Date.now() }) {
  if (!character) return null;
  const rows = await supabase.select('character_worn_sets',
    `select=id,times_seen,counted_at&${_q(guildId, character, source)}&order=last_seen.desc&limit=1`);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    if (typeof loadSlots !== 'function') return null;
    return recordWornSet(supabase, { guildId, character, source, slots: await loadSlots(), now });
  }
  return _bump(supabase, row, now);
}

module.exports = {
  WORN_SLOTS, INVENTORY_WORN_LABELS, COUNT_GAP_MS,
  normaliseWornSlots, wornSlotsFromQuarmy, wornSlotsFromInventory, wornSetHash,
  recordWornSet, countUnchangedWornSet,
};
