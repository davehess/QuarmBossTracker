// utils/factionAssist.js — which faction a mob is on, which factions it will help, and
// which mobs in its zone will help IT. Feeds the mob-info answer (and so the zone packs,
// which are built by the same function) for Mimic's Target Info -> Faction tab.
//
// The guild lead, 2026-10-06, on "an enforcer" in Plane of Justice, where the tab said only
// "No faction change recorded for this mob.": "Faction should say the faction the mob is on
// and link to the faction page ... a High Guardian of Justice assisted the creature to attack
// me. Faction should also list who the creatures will assist."
//
// The EQEmu rule (NPC call for help, AIYellForHelp) as the catalog encodes it. A mob that
// is attacked calls for help, and a nearby mob answers when EITHER
//   - the helper's npc_faction lists the caller's PRIMARY faction with npc_value > 0
//     (1 = assist; the Guardians of Justice list KOS, which is why one came for the enforcer), OR
//   - the two share a primary faction and the helper's npc_faction has
//     ignore_primary_assist = 0 (the default; 36 of 1,622 npc_factions set it).
// A caller with no primary faction calls nobody. Distance is not in the catalog, so "in the
// same zone" (npc id = zoneid*1000 + n; docs/eqemu-catalog-cheatsheet.md) is the nearest
// honest answer: this says WHO CAN help, not who stood close enough on the night.
//
// ⚠ Names come from eqemu_faction_list_full, NOT eqemu_faction_list (the short table is
// missing rows), same trap _factionValueMap in index.js documents.
//
// Loaded once per six hours, the _factionValueMap way, and kept as ids so a lookup is a
// scan of one zone (the largest holds 406 faction-carrying NPCs). Measured against the
// mirror on 2026-10-06: 1,622 npc_factions, 2,695 assist entries, 15,920 NPCs, 2,123 faction
// names, about 243 KB of NPC names; roughly 22,000 rows over ~24 pages per rebuild.

const { npcDisplayName } = require('./supabase');

const TTL_MS = 6 * 3600 * 1000;
// A failed rebuild is retried in this long, not in six hours: a mob-info call during a
// database hiccup must not pin "no assist data" until the next cache turn.
const RETRY_MS = 5 * 60 * 1000;
const ASSISTED_BY_CAP = 12;

// ── Build the index from the four catalog tables (pure) ─────────────────────────────
//   names    [{ id, name }]                              eqemu_faction_list_full
//   factions [{ id, primaryfaction, ignore_primary_assist }]   eqemu_npc_faction
//   entries  [{ npc_faction_id, faction_id, npc_value }] eqemu_npc_faction_entries (assist rows only)
//   npcs     [{ id, name, npc_faction_id }]              eqemu_npc_types
function buildIndex({ names, factions, entries, npcs }) {
  const factionName = new Map();
  for (const r of names || []) factionName.set(Number(r.id), String(r.name || ''));

  const byNpcFaction = new Map();   // npc_faction id → { primary, ignore, assists:Set<faction id> }
  for (const f of factions || []) {
    byNpcFaction.set(Number(f.id), {
      primary: Number(f.primaryfaction) > 0 ? Number(f.primaryfaction) : 0,
      ignore: Number(f.ignore_primary_assist) > 0,
      assists: new Set(),
    });
  }
  for (const e of entries || []) {
    if (!(Number(e.npc_value) > 0)) continue;
    const f = byNpcFaction.get(Number(e.npc_faction_id));
    if (f) f.assists.add(Number(e.faction_id));
  }

  const byZone = new Map();         // zone id → [{ id, name, nf }]
  for (const n of npcs || []) {
    const id = Number(n.id), nf = Number(n.npc_faction_id);
    if (!(id > 0) || !(nf > 0)) continue;
    const name = npcDisplayName(n.name);
    if (!/[a-z]/i.test(name)) continue;   // the "_" placeholder names
    const zone = Math.floor(id / 1000);
    let list = byZone.get(zone);
    if (!list) { list = []; byZone.set(zone, list); }
    list.push({ id, name, nf });
  }
  return { factionName, byNpcFaction, byZone };
}

const _label = (ix, id) => ({ id, name: ix.factionName.get(id) || ('Faction ' + id) });
const _byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id - b.id);

// ── One mob's three answers (pure) ──────────────────────────────────────────────────
// null when the index does not know the mob (no npc_faction): the caller adds no fields.
//   faction_primary          { id, name } | null
//   faction_assists          [{ id, name }]  factions it will help, its primary left out, by name
//   faction_assisted_by      [{ name, npc_id }]  mobs in its zone that would come for it
//   faction_assisted_by_more int, how many more than the cap
//
// ⚠ The list is ordered with the mobs that come through ANOTHER faction's entry first
// (the Guardians of Justice for a KOS enforcer), then the ones that merely share its primary
// faction, each group by name. By name alone the enforcer's list is 12 of the ~40 KOS mobs
// that share its faction, and the one that actually surprised the guild lead is cut off.
function assistFor(ix, npcId, { cap = ASSISTED_BY_CAP } = {}) {
  const id = Number(npcId);
  if (!ix || !(id > 0)) return null;
  const roster = ix.byZone.get(Math.floor(id / 1000)) || [];
  const me = roster.find(n => n.id === id);
  const mine = me && ix.byNpcFaction.get(me.nf);
  if (!mine) return null;

  const primary = mine.primary;
  const faction_assists = [...mine.assists]
    .filter(f => f !== primary)
    .map(f => _label(ix, f))
    .sort(_byName);

  const found = new Map();   // lower-cased display name → { name, id, cross }
  if (primary) {
    const mineKey = me.name.toLowerCase();
    for (const n of roster) {
      if (n.id === me.id) continue;
      const key = n.name.toLowerCase();
      if (key === mineKey) continue;        // its own kind never counts as help
      const h = ix.byNpcFaction.get(n.nf);
      if (!h) continue;
      const viaEntry = h.assists.has(primary);
      const viaPrimary = h.primary === primary && !h.ignore;
      if (!viaEntry && !viaPrimary) continue;
      const cross = viaEntry && h.primary !== primary;
      const prev = found.get(key);
      if (!prev || (cross && !prev.cross) || (cross === prev.cross && n.id < prev.id)) {
        found.set(key, { name: n.name, id: n.id, cross });
      }
    }
  }
  const helpers = [...found.values()].sort((a, b) =>
    (a.cross === b.cross ? 0 : a.cross ? -1 : 1)
    || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0)
    || a.id - b.id);

  return {
    faction_primary: primary ? _label(ix, primary) : null,
    faction_assists,
    faction_assisted_by: helpers.slice(0, cap).map(h => ({ name: h.name, npc_id: h.id })),
    faction_assisted_by_more: Math.max(0, helpers.length - cap),
  };
}

// ── The six-hour cache ──────────────────────────────────────────────────────────────
let _cache = { at: 0, index: null };
let _inflight = null;

// supabase is passed in (the module stays testable and index.js owns the client). Resolves to
// the index, or null while the catalog cannot be read; never throws.
async function getIndex(supabase) {
  if (_cache.at && Date.now() - _cache.at < TTL_MS) return _cache.index;
  if (!supabase || !supabase.isEnabled()) return null;
  // Several mob-info lookups arrive together on a cold cache (a zone pack builds three at a
  // time); they share one rebuild instead of each paging the catalog.
  if (_inflight) return _inflight;
  const rebuild = async () => {
    try {
      // ⚠ selectAllPaged, never one select with a big limit: PostgREST answers at most 1,000
      // rows and says nothing about the rest. Each order is the table's whole unique key
      // (npc_faction_id alone ties, and a tied walk skips rows). A failed page comes back
      // null and is NOT an empty table.
      const [names, factions, entries, npcs] = await Promise.all([
        supabase.selectAllPaged('eqemu_faction_list_full', 'id=gt.0&select=id,name', 'id'),
        supabase.selectAllPaged('eqemu_npc_faction', 'id=gt.0&select=id,primaryfaction,ignore_primary_assist', 'id'),
        supabase.selectAllPaged('eqemu_npc_faction_entries',
          'npc_value=gt.0&select=npc_faction_id,faction_id,npc_value', 'npc_faction_id,faction_id'),
        // Narrow on purpose: 18k rows, and egress is what the plan meters.
        supabase.selectAllPaged('eqemu_npc_types', 'npc_faction_id=gt.0&select=id,name,npc_faction_id', 'id'),
      ]);
      if (!names || !factions || !entries || !npcs) {
        console.warn('[faction-assist] a catalog page failed; not caching a partial index');
        _cache = { at: Date.now() - TTL_MS + RETRY_MS, index: _cache.index };   // keep a stale one
        return _cache.index;
      }
      _cache = { at: Date.now(), index: buildIndex({ names, factions, entries, npcs }) };
      return _cache.index;
    } catch (err) {
      console.warn('[faction-assist] index build failed:', err && err.message);
      _cache = { at: Date.now() - TTL_MS + RETRY_MS, index: _cache.index };
      return _cache.index;
    }
  };
  // .finally, not a finally block inside: that one would run before the assignment when the
  // build throws ahead of its first await, and leave a settled promise parked here for good.
  _inflight = rebuild().finally(() => { _inflight = null; });
  return _inflight;
}

function _resetCache() { _cache = { at: 0, index: null }; _inflight = null; }

module.exports = { buildIndex, assistFor, getIndex, _resetCache, ASSISTED_BY_CAP, TTL_MS, RETRY_MS };
