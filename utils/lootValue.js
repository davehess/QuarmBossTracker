// utils/lootValue.js — what the Mimic Loot tab's "who looted what" list is worth.
//
// The guild lead, 2026-10-08: "quantify the loot tab with how much each item is worth and say how
// much each toon has looted equivalently in platinum from what you've seen, and time bound it."
//
// "Worth" is eqemu_items.price — the item's base merchant value in COPPER (1pp = 1000cp). It is the
// vendor figure the game itself prices an item at, not a bazaar price. ⚠ eqemu_items.nodrop is INVERTED on
// this Quarm mirror: false means NO DROP (it can only be sold to a merchant), true means tradeable. The
// guild lead, 2026-10-08, looking at the admin loot page: "All of these ND items are not actually no drop".
// Everything this file returns is in plain polarity: `nodrop: true` = NO DROP.
//
// Charm-pet gear is not loot (the guild lead, 2026-10-09: "when someone gives their charm pet items, they
// should not be counted as loot"). An item NAME is charm-pet gear when ANY eqemu_items row with that name has
// mr < 0 (charm pets wear negative magic resist on purpose), or its lower-cased name is in the officer table
// loot_pet_gear_names. The SQL twin is loot_value_rows (migration 20261009030000). The per-looter VALUE totals
// leave those rows out; the "who looted what" list (buildNightLootPanel) still shows them.
//
// Four pieces, all pure or injectable so test/night-loot-value.test.js runs the shipped code:
//   clampLootHours / lootWindowLabel — the window the panel accepts (12h · 24h · 7d · 30d);
//   lookupItemValues                 — exact-name price lookup, lowest id wins, 6h memory cache;
//   loadPetGearNames                 — the officer name list, fail-open (read failure = empty set);
//   buildLootValue                   — the per-looter totals over EVERY row in the window.

'use strict';

const LOOT_HOURS = [12, 24, 168, 720];
const PRICE_TTL_MS = 6 * 3600_000;
const PRICE_CACHE_MAX = 20_000;
const NAME_CHUNK = 50;          // names per request: a few KB of URL
const CHUNK_PARALLEL = 4;
const TOTALS_CAP = 300;

function clampLootHours(v) {
  const n = Number(v);
  return LOOT_HOURS.includes(n) ? n : 12;
}

function lootWindowLabel(hours) {
  if (hours === 168) return 'last 7d';
  if (hours === 720) return 'last 30d';
  return `last ${hours}h`;
}

// PostgREST in.() list member: double-quoted so a comma, paren or apostrophe in the name cannot
// split or end the list; a backslash or double quote inside the name is backslash-escaped.
function quoteInValue(name) {
  return '"' + String(name).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

const _cache = new Map();   // name -> { at, v: { value_cp, nodrop } | null }

function _cacheGet(cache, name, nowMs) {
  const e = cache.get(name);
  return (e && nowMs - e.at < PRICE_TTL_MS) ? e : null;
}

// name -> { value_cp, nodrop } for every name found in eqemu_items, null for a name that is not.
// `failed` is true when any chunk could not be read — those names are absent from the map (not null),
// so the caller counts them unpriced and knows not to cache the result.
async function lookupItemValues(supabase, names, { nowMs = Date.now(), cache = _cache } = {}) {
  const out = new Map();
  const todo = [];
  for (const name of new Set(names)) {
    const e = _cacheGet(cache, name, nowMs);
    if (e) out.set(name, e.v); else todo.push(name);
  }
  const chunks = [];
  for (let i = 0; i < todo.length; i += NAME_CHUNK) chunks.push(todo.slice(i, i + NAME_CHUNK));
  let failed = false;
  let next = 0;
  async function worker() {
    while (next < chunks.length) {
      const chunk = chunks[next++];
      let rows = null;
      try {
        rows = await supabase.selectAllPaged('eqemu_items',
          `name=in.(${encodeURIComponent(chunk.map(quoteInValue).join(','))})&select=id,name,price,nodrop,mr`, 'id');
      } catch { rows = null; }
      if (!Array.isArray(rows)) { failed = true; continue; }
      // Duplicate names exist across ids: the lowest id is the base item.
      const best = new Map();
      const negMr = new Set();      // names with ANY row at mr < 0 (a same-name row at mr 0 does not rescue it)
      for (const r of rows) {
        if (!r || typeof r.name !== 'string') continue;
        if (r.mr != null && Number(r.mr) < 0) negMr.add(r.name);
        const cur = best.get(r.name);
        if (!cur || r.id < cur.id) best.set(r.name, r);
      }
      for (const name of chunk) {
        const r = best.get(name);
        const v = r ? { value_cp: Number(r.price) || 0, nodrop: r.nodrop == null ? null : !r.nodrop, pet_gear: negMr.has(name) } : null;   // inverted column: false = NO DROP
        out.set(name, v);
        if (cache.size >= PRICE_CACHE_MAX) cache.clear();
        cache.set(name, { at: nowMs, v });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CHUNK_PARALLEL, chunks.length) }, worker));
  return { values: out, failed };
}

// The officer list of charm-pet gear names, lower-cased. FAIL OPEN: a failed or malformed read yields an empty
// set (the mr < 0 rule still applies), it never throws and never blocks the panel.
async function loadPetGearNames(supabase) {
  try {
    const rows = await supabase.selectAllPaged('loot_pet_gear_names', 'select=item_name', 'item_name');
    if (!Array.isArray(rows)) return new Set();
    return new Set(rows.map(r => r?.item_name).filter(n => typeof n === 'string' && n).map(n => n.toLowerCase()));
  } catch { return new Set(); }
}

// Charm-pet gear: any same-name row at mr < 0 (v.pet_gear, set by lookupItemValues) or a name on the officer list.
function isPetGear(itemName, v, petGearNames) {
  if (v && v.pet_gear) return true;
  return !!petGearNames && petGearNames.has(String(itemName).toLowerCase());
}

// Totals over every looted row in the window (NOT just the displayed newest N). A row counts the same
// way buildNightLootPanel counts it, except charm-pet gear, which is left out of the totals (`pet_gear_items`
// says how many rows that was) while the list keeps showing it, and a row flagged `from_own_pet` (looted back off
// the looter's own pet's corpse, the guild lead, 2026-10-09), which is not loot at all: out of the totals AND the
// list (`own_pet_items` counts them; the panel body removes them before the list is built).
function buildLootValue(lootedRows, values, { nowMs = Date.now(), windowMs, petGearNames = null }) {
  const since = nowMs - windowMs;
  const by = new Map();
  let total = 0, priced = 0, unpriced = 0, petGear = 0, ownPet = 0;
  for (const l of (Array.isArray(lootedRows) ? lootedRows : [])) {
    const ms = l?.looted_at ? Date.parse(l.looted_at) : NaN;
    if (!Number.isFinite(ms) || ms < since || !l?.looter_character || !l?.item_name) continue;
    if (l.from_own_pet === true) { ownPet++; continue; }   // looted back off the looter's own pet's corpse: already theirs
    const v = values.get(String(l.item_name)) || null;
    if (isPetGear(l.item_name, v, petGearNames)) { petGear++; continue; }
    const key = String(l.looter_character).toLowerCase();
    let t = by.get(key);
    if (!t) { t = { looter: String(l.looter_character), items: 0, value_cp: 0, nodrop_items: 0 }; by.set(key, t); }
    t.items++;
    if (v) { t.value_cp += v.value_cp; total += v.value_cp; priced++; } else unpriced++;
    if (v && v.nodrop) t.nodrop_items++;
  }
  const totals = [...by.values()]
    .sort((a, b) => b.value_cp - a.value_cp || b.items - a.items || a.looter.localeCompare(b.looter))
    .slice(0, TOTALS_CAP);
  return { totals, total_value_cp: total, priced_items: priced, unpriced_items: unpriced, pet_gear_items: petGear, own_pet_items: ownPet };
}

function _resetPriceCache() { _cache.clear(); }

module.exports = { LOOT_HOURS, clampLootHours, lootWindowLabel, quoteInValue, lookupItemValues, loadPetGearNames, isPetGear, buildLootValue, _resetPriceCache };
