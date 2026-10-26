// utils/softReserve.js — Soft Reserve (SR) per raid, the bot half (the guild lead, 2026-10-26; DECISIONS §448).
//
// Members pick the drops they want first claim on at wolfpack.quest/raid/sr (tables sr_rules + sr_picks, written by
// the web). This module reads them for one event and turns them into the lines and rankings the loot surfaces use.
// The rules twin is web/lib/softReserve.ts (normalizeRules, shownOn); the roll ranking twin is
// web/lib/rolls.ts rankWithReservers. Keep them in step: test/soft-reserve-bot.test.js runs both on the same cases.
//
// What the bot can and cannot ENFORCE:
//   • Event nights (rolls): enforced. If any reserver rolled, only reservers' rolls count, top N for N copies
//     (utils/rollLoot.js). A reserver who does not roll has passed; if no reserver rolled, everyone counts.
//   • Raid nights (OpenDKP bidding): the order is SHOWN, never enforced. OpenDKP settles by DKP and the bot cannot
//     reject a bid, so the loot card names the reservers and the note says "reservers bid first; an officer settles".
//   • An item nobody reserved is open to the whole raid either way.
//
// The bot's event ids are not Raid-Helper's: utils/raidEvents.js prefixes Raid-Helper's own with `rh:` but lets a
// Discord calendar event win when both describe one raid (mergeEventSources), so the id may be a Discord one.
// rhEventId() therefore falls back to the event's start time against rh_events (the same ±30 min twin rule).

'use strict';

const NAMES_CAP = 8;                    // names on a card line before "+N more"
const TWIN_MS = 30 * 60 * 1000;         // mergeEventSources' dedupe window

const VISIBILITIES = ['names', 'counts', 'hidden'];
const LOCK_MODES = ['start', 'time', 'first_loot', 'manual'];

/** Twin of web/lib/softReserve.ts normalizeRules (only the fields the bot reads). */
function normalizeRules(raw) {
  const r = raw || {};
  return {
    enabled: r.enabled !== false,
    visibility: VISIBILITIES.includes(r.visibility) ? r.visibility : 'counts',
    lock_mode: LOCK_MODES.includes(r.lock_mode) ? r.lock_mode : 'start',
    locked: r.locked === true,
    npc_ids: Array.isArray(r.npc_ids) ? r.npc_ids.map(Number).filter(n => Number.isInteger(n) && n > 0) : [],
  };
}

/**
 * Twin of web/lib/softReserve.ts shownOn(): what a surface may show of who reserved an item.
 * surface 'card' = the loot card at drop time (public to the raid), 'officer' = an officer-only reply.
 */
function shownOn(visibility, surface) {
  if (surface === 'officer') return 'names';
  if (surface === 'page') return visibility === 'names' ? 'names' : visibility === 'counts' ? 'counts' : 'none';
  return visibility === 'hidden' ? 'counts' : 'names';
}

/** "⭐ Soft Reserve (3): Aldenmar, Brackwyn, Corvale" — "+N more" past the cap; just the count when names are withheld. */
function reserverLine(names, shown = 'names', cap = NAMES_CAP) {
  const list = Array.isArray(names) ? names.filter(Boolean) : [];
  if (list.length === 0 || shown === 'none') return null;
  if (shown === 'counts') return `⭐ Soft Reserve (${list.length})`;
  const head = list.slice(0, cap).join(', ');
  const more = list.length > cap ? ` +${list.length - cap} more` : '';
  return `⭐ Soft Reserve (${list.length}): ${head}${more}`;
}

/** The Raid-Helper event id (rh_events.id) for a bot event, or null. Reads rh_events only when the id has no `rh:` prefix. */
async function rhEventId(ev, supabase) {
  if (!ev) return null;
  const id = String(ev.id || '');
  if (id.startsWith('rh:')) return id.slice(3) || null;
  if (!Number.isFinite(ev.startMs) || !supabase?.isEnabled?.()) return null;
  const guildId = supabase.guildId();
  const lo = new Date(ev.startMs - TWIN_MS).toISOString();
  const hi = new Date(ev.startMs + TWIN_MS).toISOString();
  let rows;
  try {
    rows = await supabase.select('rh_events',
      `guild_id=eq.${encodeURIComponent(guildId)}&start_time=gte.${encodeURIComponent(lo)}&start_time=lte.${encodeURIComponent(hi)}`
      + '&select=id,start_time&limit=10');
  } catch { return null; }
  const hits = (Array.isArray(rows) ? rows : []).filter(r => r?.id && r?.start_time);
  hits.sort((a, b) => Math.abs(Date.parse(a.start_time) - ev.startMs) - Math.abs(Date.parse(b.start_time) - ev.startMs));
  return hits[0]?.id || null;
}

/**
 * Everything SR knows about an event: { eventId, rules, byItem: Map<itemId, names[]>, itemNames: Map<itemId, name> }, or
 * null when there is no event, SR is off, or nobody reserved anything. Never throws (SR is an extra on the loot post).
 */
async function loadSoftReserve(ev, supabase) {
  try {
    if (!ev || !supabase?.isEnabled?.()) return null;
    const eventId = await rhEventId(ev, supabase);
    if (!eventId) return null;
    const enc = encodeURIComponent(eventId);
    const ruleRows = await supabase.select('sr_rules',
      `event_id=eq.${enc}&select=enabled,visibility,lock_mode,locked,npc_ids&limit=1`);
    const rules = normalizeRules(Array.isArray(ruleRows) ? ruleRows[0] : null);
    if (!rules.enabled) return null;
    const picks = await supabase.selectAllPaged('sr_picks',
      `event_id=eq.${enc}&select=character_name,npc_id,item_id`, 'character_name,npc_id,item_id');
    if (!Array.isArray(picks) || picks.length === 0) return { eventId, rules, byItem: new Map(), itemNames: new Map() };
    const byItem = new Map();
    for (const p of picks) {
      const k = Number(p.item_id);
      if (!byItem.has(k)) byItem.set(k, []);
      const list = byItem.get(k);
      if (!list.some(n => n.toLowerCase() === String(p.character_name).toLowerCase())) list.push(String(p.character_name));
    }
    for (const list of byItem.values()) list.sort((a, b) => a.localeCompare(b));
    const itemNames = new Map();
    const ids = [...byItem.keys()];
    const rows = await supabase.select('eqemu_items', `id=in.(${ids.join(',')})&select=id,name&limit=${ids.length}`);
    for (const r of (Array.isArray(rows) ? rows : [])) itemNames.set(Number(r.id), String(r.name));
    return { eventId, rules, byItem, itemNames };
  } catch (err) {
    console.warn('[soft-reserve] load failed:', err?.message);
    return null;
  }
}

/**
 * Sets item.reservers (names, alphabetical) and item.srShown ('names' | 'counts') on each /loot item that someone
 * reserved, matching by the game item id. Items nobody reserved are left alone. Returns the count marked.
 */
function applyReservers(items, sr) {
  if (!sr || !Array.isArray(items)) return 0;
  const shown = shownOn(sr.rules.visibility, 'card');
  let n = 0;
  for (const it of items) {
    const names = sr.byItem.get(Number(it.gameItemId));
    if (names && names.length) { it.reservers = names.slice(); it.srShown = shown; n++; }
  }
  return n;
}

/** Whether a character is among an item's reservers (case-insensitive). */
function isReserver(item, character) {
  const c = String(character || '').toLowerCase();
  return !!c && (item?.reservers || []).some(n => n.toLowerCase() === c);
}

/**
 * Lock mode `first_loot`: the first /loot post for the event closes picks. A no-op in every other mode and once locked.
 * Returns true when it wrote the lock.
 */
async function lockOnFirstLoot(sr, supabase) {
  if (!sr || sr.rules.lock_mode !== 'first_loot' || sr.rules.locked) return false;
  try {
    const out = await supabase.upsert('sr_rules', [{ event_id: sr.eventId, locked: true, updated_at: new Date().toISOString() }], 'event_id', { minimal: true, confirm: true });
    if (out) sr.rules.locked = true;
    return !!out;
  } catch (err) {
    console.warn('[soft-reserve] first-loot lock failed:', err?.message);
    return false;
  }
}

/**
 * A lookup for roll sessions: item name → reserver names, matching a roll's loosely named item to a reserved item by
 * the same tolerant match the looted-item link uses. `matcher` is rollLoot.itemsMatch (passed in: no cycle).
 */
function makeReserversFor(sr, matcher) {
  if (!sr || sr.byItem.size === 0) return () => null;
  const entries = [...sr.byItem.entries()].map(([id, names]) => ({ name: sr.itemNames.get(id), names })).filter(e => e.name);
  return (itemName) => {
    if (!itemName) return null;
    const hit = entries.find(e => matcher(itemName, e.name));
    return hit ? hit.names : null;
  };
}

/**
 * Rank a roll set with Soft Reserve (rules 2, 6, 7). `ranked` = first-roll-per-player entries, best first
 * ({ name, value, ... }); `n` = copies; `reservers` = names. Twin of web/lib/rolls.ts rankWithReservers.
 *   - no reservers: plain top n, sr null;
 *   - reservers but none rolled (all passed): plain top n (everyone counts), sr { reservers, rolled: 0 };
 *   - otherwise: only reservers' rolls count, top n of them; copies left over after the reservers fall to the
 *     rest of the raid by roll (a reserver who passes sends it to the next reserver, then to everyone);
 *     `ignored` = the non-reservers who would have won without SR.
 */
function rankWithReservers(ranked, n, reservers) {
  const set = new Set((reservers || []).map(r => String(r).toLowerCase()));
  if (set.size === 0) return { winners: ranked.slice(0, n), sr: null };
  const isSr = (r) => set.has(String(r.name).toLowerCase());
  const srRolled = ranked.filter(isSr);
  if (srRolled.length === 0) return { winners: ranked.slice(0, n), sr: { reservers: set.size, rolled: 0, ignored: [] } };
  const winners = srRolled.slice(0, n);
  if (winners.length < n) winners.push(...ranked.filter(r => !isSr(r)).slice(0, n - winners.length));
  const ignored = ranked.slice(0, n).filter(r => !isSr(r) && !winners.includes(r)).map(r => ({ name: r.name, value: r.value }));
  return { winners, sr: { reservers: set.size, rolled: srRolled.length, ignored } };
}

module.exports = {
  NAMES_CAP,
  normalizeRules, shownOn, reserverLine, rhEventId, loadSoftReserve, applyReservers, isReserver,
  lockOnFirstLoot, makeReserversFor, rankWithReservers,
};
