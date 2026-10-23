// utils/npcActors.js — which single-word names in a parse are MOBS, read from the catalog.
//
// The guild lead, 2026-10-23, after the Tower of Solusek Ro raid: "Jiva is a named mob but was counted as a
// player ... same for all the named bosses in sol ro." EQ character names and a great many Planes of Power
// NPC names (Jiva, Xuzl, Arlyxir, Rizlona, Galremos ...) are the same shape: one capitalised word. The ingest
// path told them apart by word count alone, so a single-word mob that appeared in an upload's damage list,
// healer list or TANK list (the boss is always in the tank list: it is the thing being hit) was written down
// as a raider: a kill-derived lockout for "Jiva" on Jiva, "Xuzl" locked on Arlyxir, a damage row for Galremos
// on two of the night's fights.
//
// The catalog knows better. eqemu_npc_types.id = zone_id * 1000 + n (docs/eqemu-catalog-cheatsheet.md), so
// every NPC a fight in a zone can name sits in one 1000-id block. A name that is in the block of the zone the
// boss died in, and that is not one of our characters, is a mob. The boss itself always is.
//
// Fail-open throughout: no database, a failed read or an unknown zone returns what is known so far, never throws.
'use strict';

const TTL_MS = 6 * 60 * 60 * 1000;
const MISS_MS = 5 * 60 * 1000;      // a failed read is retried in five minutes, never pinned for six hours

const _zoneNames = new Map();       // zone id -> { at, ttl, names:Set<lowercase single-word catalog names> }
const _bossZones = new Map();       // lowercase boss name -> { at, ttl, zones:number[] }
const _isCharacter = new Map();     // lowercase name -> { at, yes }

// Same shape the lockout code accepts as a character name (utils/killLockouts.js normalizeCharacterName).
const oneWord = (n) => /^[A-Za-z]{3,15}$/.test(String(n || ''));
const norm = (n) => String(n || '').replace(/^#+_?/, '').replace(/_/g, ' ').trim().toLowerCase();

function _fresh(e, now) { return !!e && (now - e.at) < e.ttl; }

// Every single-word NPC name in one zone's id block, lowercased. Empty (and short-lived) when the read fails.
async function zoneNpcNames(supabase, zoneId, now = Date.now()) {
  const zid = Number(zoneId);
  if (!(zid >= 1 && zid <= 999)) return new Set();
  const held = _zoneNames.get(zid);
  if (_fresh(held, now)) return held.names;
  const names = new Set();
  let ok = false;
  try {
    const lo = zid * 1000;
    const rows = await supabase.select('eqemu_npc_types', `id=gte.${lo}&id=lte.${lo + 999}&select=name&limit=1000`);
    if (Array.isArray(rows)) {
      ok = true;
      for (const r of rows) { const n = norm(r && r.name); if (oneWord(n)) names.add(n); }
    }
  } catch (e) { void e; }
  _zoneNames.set(zid, { at: now, ttl: ok ? TTL_MS : MISS_MS, names });
  return names;
}

// The zone id(s) a boss lives in: the caller's hint when it has one, else every zone the catalog holds an NPC of
// that exact name in.
async function bossZones(supabase, bossName, hintZoneId, now = Date.now()) {
  if (Number(hintZoneId) > 0) return [Number(hintZoneId)];
  const key = norm(bossName);
  if (!key) return [];
  const held = _bossZones.get(key);
  if (_fresh(held, now)) return held.zones;
  let zones = [], ok = false;
  try {
    const forms = [...new Set([String(bossName).trim(), String(bossName).trim().replace(/\s+/g, '_')])];
    const or = forms.map(f => `name.eq.${encodeURIComponent(f)}`).join(',');
    const rows = await supabase.select('eqemu_npc_types', `or=(${or})&select=id&limit=10`);
    if (Array.isArray(rows)) {
      ok = true;
      zones = [...new Set(rows.map(r => Math.floor(Number(r && r.id) / 1000)).filter(z => z >= 1 && z <= 999))];
    }
  } catch (e) { void e; }
  _bossZones.set(key, { at: now, ttl: ok ? TTL_MS : MISS_MS, zones });
  return zones;
}

// Which of these lowercase names are characters of ours? A player who shares a name with a mob in the zone must
// never be dropped, so a collision is checked against the roster (a handful of names, memoised).
async function _knownCharacters(supabase, lowerNames, guildId, now = Date.now()) {
  const out = new Set();
  const ask = [];
  for (const n of lowerNames) {
    const held = _isCharacter.get(n);
    if (_fresh(held, now)) { if (held.yes) out.add(n); }
    else ask.push(n);
  }
  if (!ask.length) return out;
  try {
    const list = ask.map(n => n.charAt(0).toUpperCase() + n.slice(1));
    const rows = await supabase.select('characters',
      `guild_id=eq.${encodeURIComponent(guildId)}&name=in.(${list.map(encodeURIComponent).join(',')})&select=name&limit=100`);
    if (Array.isArray(rows)) {
      const have = new Set(rows.map(r => String(r && r.name || '').toLowerCase()));
      for (const n of ask) { const yes = have.has(n); _isCharacter.set(n, { at: now, ttl: TTL_MS, yes }); if (yes) out.add(n); }
    }
  } catch (e) { void e; }
  return out;
}

/**
 * The names, among `names`, that are mobs and not raiders. Lowercased Set.
 *
 * @param {Iterable<string>} names  every name the parse lists as a damage dealer, healer or tank
 * @param {object} a
 * @param {object} a.supabase       utils/supabase
 * @param {string} a.bossName       the encounter's boss: always a mob
 * @param {number} [a.zoneId]       the zone the boss died in, when the caller knows it
 * @param {string} [a.guildId]
 */
async function npcNamesAmong(names, { supabase, bossName, zoneId, guildId } = {}) {
  const out = new Set();
  const bossKey = norm(bossName);
  const cands = new Set();
  for (const raw of names || []) {
    const n = norm(raw);
    if (!oneWord(n)) continue;          // multi-word and punctuated names are already filtered as mobs downstream
    if (n === bossKey) out.add(n); else cands.add(n);
  }
  if (!cands.size || !supabase || !(supabase.isEnabled ? supabase.isEnabled() : true)) return out;
  try {
    const zones = await bossZones(supabase, bossName, zoneId);
    const inZone = new Set();
    for (const z of zones) {
      const set = await zoneNpcNames(supabase, z);
      for (const n of cands) if (set.has(n)) inZone.add(n);
    }
    if (inZone.size) {
      const mine = await _knownCharacters(supabase, inZone, guildId || supabase.guildId());
      for (const n of inZone) if (!mine.has(n)) out.add(n);
    }
  } catch (e) { void e; }
  return out;
}

// Test seam.
function _reset() { _zoneNames.clear(); _bossZones.clear(); _isCharacter.clear(); }

module.exports = { npcNamesAmong, zoneNpcNames, bossZones, _reset };
