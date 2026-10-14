// utils/charmPets.js — GET /api/agent/charm-pets?zone=<short_name> (Mimic Charm overlay, "Best pets here").
//
// The guild lead, 2026-10-14: "integrate a list of the better charm pets for the highest level charm a
// player has for the zone that they're in". The idea comes from a third-party site (eqpetfinder); the
// rules below are read from Project Quarm's server source (EQMacEmu zone/spells.cpp) and the data is our
// own mirror, so no code or data of theirs is used.
//
// WHAT THIS ROUTE DOES, AND DOES NOT DO
// -------------------------------------
// It answers one zone's charm CANDIDATES, once per zone, cached: every placed NPC that no charm spell can
// ever take, removed. It does NOT know the caster's spell. The spell-dependent half (level cap, body
// type of an animal / undead / summoned / plant charm) and the ranking live in the agent, which is what
// knows the spellbook. That keeps one cached body per zone, whatever the fleet casts.
//
// WHY AN NPC IS DROPPED HERE (EQMacEmu zone/spells.cpp `Mob::IsImmuneToSpell`, charm branch):
//   · class Merchant (41), Banker (40) or a guildmaster (20-34) is "immune to charm";
//   · special ability 14 (CharmImmunity) — Quarm's numbering, utils/mobSpecials.js, is the same as ours;
//   · Veksar, level 50 and up, is hard-coded immune;
//   · a placeholder body (immune to BOTH melee and magic) cannot be fought, let alone charmed;
//   · bodytype 11 / 60 / 64 / 66 are untargetable, a swarm pet or the nameless "invisible man";
//   · a raid target is dropped on purpose: Quarm gives raid bosses an "engage notice" (the server says
//     "too powerful for your charm"), a column our mirror does not carry, and nearly all of them are 14
//     anyway. A false "charm this" on a raid boss costs a pull; a missing one costs nothing.
// Not placed in the zone (no spawn2 row) means not listed: a scripted event spawn cannot be found by
// walking around.
//
// Reads (all bounded; PostgREST answers at most 1,000 rows and says nothing when it cut):
//   · eqemu_zone       one row by short_name                       → long_name, and "is this a zone?"
//   · eqemu_spawn2     paged on its primary key                    → the points (enabled only)
//   · eqemu_spawnentry paged per chunk of group ids                → who spawns at each group
//   · eqemu_npc_types  by id list, chunked                         → the stats
//   · eqemu_npc_spells walked up its parent_list, one read a hop   → "has a melee proc" (decoration)
const crypto = require('crypto');
const zlib = require('zlib');
const mobSpecials = require('./mobSpecials');
const npcProcs = require('./npcProcs');

const ZONE_RE = /^[a-z0-9_]{1,32}$/;
const CHUNK = 100;                       // ids per in.(...) list: ~700 chars of URL
const TTL_MS = 6 * 60 * 60 * 1000;       // the mirror syncs weekly; six hours is plenty fresh
const EMPTY_TTL_MS = 5 * 60 * 1000;      // a zone with no points, or a degraded build, is re-asked soon
const CACHE_MAX = 200;
const MAX_POINTS = 3;                    // spawn points kept per NPC: enough to walk to one
const PROC_HOPS = 4;                     // parent_list depth (same bound the mob-info walk uses)

const NPC_SELECT = 'id,name,level,maxlevel,hp,ac,mr,mindmg,maxdmg,attack_delay,bodytype,class,special_abilities,npcspecialattks,raid_target,npc_spells_id';

// Special-ability codes worth a "why" chip on a pet, as the stable tokens this route speaks. The agent
// reads these tokens, never the numbers (utils/mobSpecials.js: consumers match labels, not codes).
const TRAIT_CODES = Object.freeze({
  1: 'summon', 3: 'rampage', 4: 'area_rampage', 5: 'flurry', 6: 'triple', 7: 'dual', 10: 'magical',
});
const CHARM_IMMUNITY_CODE = 14;
const UNTARGETABLE_BODY = new Set([11, 60, 64, 66]);
const MAX_LEVEL = 65;

const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const num = (v) => (Number.isFinite(Number(v)) && v != null ? Number(v) : null);

// "a_firescale_crocodile" / "#Sir_Lindeal" → "a firescale crocodile" / "Sir Lindeal" — what `/target` takes.
function cleanName(n) { return String(n || '').replace(/_/g, ' ').replace(/#/g, '').trim(); }

// Can ANY charm spell ever take this row? `zone` is the short name (Veksar's rule).
function isCharmCandidate(row, zone) {
  if (!row || !/[a-z]/i.test(String(row.name || ''))) return false;   // the "_" placeholder names
  const cls = Number(row.class);
  if (cls === 40 || cls === 41 || (cls >= 20 && cls <= 34)) return false;
  const level = Number(row.level);
  if (!(level >= 1) || level > MAX_LEVEL) return false;
  if (UNTARGETABLE_BODY.has(Number(row.bodytype))) return false;
  if (row.raid_target) return false;
  const specials = mobSpecials.parseSpecials(row.special_abilities);
  if (specials.has(CHARM_IMMUNITY_CODE)) return false;
  if (mobSpecials.isPlaceholder(specials)) return false;
  if (zone === 'veksar' && level >= 50) return false;
  return true;
}

function traitsOf(row) {
  const out = [];
  const specials = mobSpecials.parseSpecials(row.special_abilities);
  if (specials.size) {
    for (const code of specials.keys()) {
      const t = TRAIT_CODES[code];
      if (t && !out.includes(t)) out.push(t);
    }
  } else if (row.npcspecialattks) {
    // The legacy single-letter column, read only when special_abilities is empty (mobSpecials does the same).
    const legacy = { S: 'summon', F: 'flurry', R: 'rampage', r: 'area_rampage', T: 'triple', m: 'magical' };
    for (const ch of String(row.npcspecialattks)) { const t = legacy[ch]; if (t && !out.includes(t)) out.push(t); }
  }
  return out;
}

// Rows → the payload's npcs. `pointsByNpc` is Map<npc_id, [[x,y,z]...]>, `procIds` a Set of npc ids with a
// melee proc. Same-name bodies with identical stats collapse into one entry (their points merge): a zone
// places "a decaying skeleton" on thirty spawn groups under several ids.
function buildNpcs(rows, pointsByNpc, procIds, zone) {
  const merged = new Map();
  for (const row of rows) {
    if (!isCharmCandidate(row, zone)) continue;
    const level = Number(row.level);
    const maxlevel = Number(row.maxlevel) > level ? Number(row.maxlevel) : 0;
    const entry = {
      id: row.id,
      name: cleanName(row.name),
      level,
      maxlevel,
      hp: num(row.hp) || 0,
      ac: num(row.ac) || 0,
      mr: num(row.mr) || 0,
      mindmg: num(row.mindmg) || 0,
      maxdmg: num(row.maxdmg) || 0,
      delay: num(row.attack_delay) > 0 ? Number(row.attack_delay) : 30,   // the catalog's default swing is 3.0 s
      bodytype: num(row.bodytype) || 0,
      class: num(row.class) || 0,
      traits: traitsOf(row),
      proc: procIds.has(row.id) ? 1 : 0,
      pts: (pointsByNpc.get(row.id) || []).slice(0, MAX_POINTS),
    };
    const key = [entry.name.toLowerCase(), entry.level, entry.maxlevel, entry.hp, entry.mindmg, entry.maxdmg, entry.delay, entry.bodytype].join('|');
    const prev = merged.get(key);
    if (!prev) { merged.set(key, entry); continue; }
    prev.id = Math.min(prev.id, entry.id);
    if (entry.proc) prev.proc = 1;
    for (const p of entry.pts) if (prev.pts.length < MAX_POINTS) prev.pts.push(p);
  }
  return [...merged.values()].sort((a, b) => (a.level - b.level) || (a.id - b.id));
}

// Returns { status: 400|404|503 } or { status: 200, degraded, payload }.
async function build(supabase, zone) {
  const zrows = await supabase.select('eqemu_zone',
    `short_name=eq.${encodeURIComponent(zone)}&select=short_name,long_name&limit=1`);
  if (!Array.isArray(zrows)) return { status: 503 };
  if (!zrows.length) return { status: 400 };
  const longName = zrows[0].long_name || zone;

  const spawn2 = await supabase.selectAllPaged('eqemu_spawn2',
    `zone_short=eq.${encodeURIComponent(zone)}&enabled=eq.true&select=id,spawngroup_id,x,y,z`, 'id');
  if (!Array.isArray(spawn2)) return { status: 503 };
  if (!spawn2.length) return { status: 404 };

  const pointsByGroup = new Map();   // spawngroup_id → [[x,y,z]...]
  for (const r of spawn2) {
    if (r.spawngroup_id == null || num(r.x) == null || num(r.y) == null) continue;
    if (!pointsByGroup.has(r.spawngroup_id)) pointsByGroup.set(r.spawngroup_id, []);
    pointsByGroup.get(r.spawngroup_id).push([Math.round(Number(r.x)), Math.round(Number(r.y)), Math.round(num(r.z) || 0)]);
  }

  const pointsByNpc = new Map();     // npc_id → [[x,y,z]...]
  const groupIds = [...pointsByGroup.keys()];
  for (const ids of chunks(groupIds, CHUNK)) {
    const rows = await supabase.selectAllPaged('eqemu_spawnentry',
      `spawngroup_id=in.(${ids.join(',')})&select=spawngroup_id,npc_id,chance`, 'spawngroup_id,npc_id');
    if (!Array.isArray(rows)) return { status: 503 };
    for (const e of rows) {
      if (e.npc_id == null) continue;
      if (!pointsByNpc.has(e.npc_id)) pointsByNpc.set(e.npc_id, []);
      const list = pointsByNpc.get(e.npc_id);
      for (const p of pointsByGroup.get(e.spawngroup_id) || []) if (list.length < MAX_POINTS) list.push(p);
    }
  }

  const rows = [];
  for (const ids of chunks([...pointsByNpc.keys()], CHUNK)) {
    const got = await supabase.select('eqemu_npc_types', `id=in.(${ids.join(',')})&select=${NPC_SELECT}&limit=${CHUNK}`);
    if (!Array.isArray(got)) return { status: 503 };
    for (const r of got) rows.push(r);
  }

  // Melee procs, only for the rows that survive the filter. A list that sets no proc inherits its parent's,
  // so walk parent_list one read per hop, up to PROC_HOPS. A failed read costs the chip, not the list.
  let degraded = false;
  const procIds = new Set();
  const keep = rows.filter(r => isCharmCandidate(r, zone));
  const startLists = [...new Set(keep.map(r => Number(r.npc_spells_id)).filter(v => v > 0))];
  if (startLists.length) {
    const listRows = new Map();      // npc_spells id → row
    let frontier = startLists;
    for (let hop = 0; hop <= PROC_HOPS && frontier.length && !degraded; hop++) {
      const next = new Set();
      for (const ids of chunks(frontier, CHUNK)) {
        const got = await supabase.select('eqemu_npc_spells',
          `id=in.(${ids.join(',')})&select=id,parent_list,attack_proc,proc_chance&limit=${CHUNK}`);
        if (!Array.isArray(got)) { degraded = true; break; }
        for (const l of got) {
          listRows.set(l.id, l);
          const p = Number(l.parent_list);
          if (p > 0 && !listRows.has(p)) next.add(p);
        }
      }
      frontier = [...next];
    }
    if (!degraded) {
      for (const r of keep) {
        const chain = [];
        const seen = new Set();
        let cur = Number(r.npc_spells_id);
        for (let i = 0; cur > 0 && !seen.has(cur) && i <= PROC_HOPS; i++) {
          seen.add(cur);
          const l = listRows.get(cur);
          if (!l) break;
          chain.push(l);
          cur = Number(l.parent_list);
        }
        if (npcProcs.resolveProcSlots(chain).some(s => s.kind === 'attack')) procIds.add(r.id);
      }
    }
  }

  const npcs = buildNpcs(rows, pointsByNpc, procIds, zone);
  return { status: 200, degraded, payload: { zone, long_name: longName, generated_at: new Date().toISOString(), npcs } };
}

// A weak validator over the CONTENT (generated_at left out) so a rebuild of unchanged data keeps its ETag
// and an agent revalidating after a day still gets its 304.
function etagOf(payload) {
  const { generated_at: _g, ...content } = payload;
  return 'W/"' + crypto.createHash('sha1').update(JSON.stringify(content)).digest('hex').slice(0, 20) + '"';
}

const _cache = new Map();      // zone → { at, ttl, status, body?, gz?, etag? }
const _inflight = new Map();   // zone → Promise, so a fleet zoning in together costs one build
function _resetCache() { _cache.clear(); _inflight.clear(); }

// → { status, body?, gz?, etag? }
async function getCharmPets(supabase, zoneRaw, now = Date.now) {
  const zone = String(zoneRaw || '').trim().toLowerCase();
  if (!ZONE_RE.test(zone)) return { status: 400 };
  const hit = _cache.get(zone);
  if (hit && (now() - hit.at) < hit.ttl) return hit;
  if (_inflight.has(zone)) return _inflight.get(zone);
  const p = (async () => {
    const r = await build(supabase, zone);
    if (r.status === 400 || r.status === 503) return { status: r.status };   // never cached
    let entry;
    if (r.status === 404) entry = { at: now(), ttl: EMPTY_TTL_MS, status: 404 };
    else {
      const body = JSON.stringify(r.payload);
      entry = { at: now(), ttl: r.degraded ? EMPTY_TTL_MS : TTL_MS, status: 200, body, gz: zlib.gzipSync(body), etag: etagOf(r.payload) };
    }
    _cache.delete(zone);
    _cache.set(zone, entry);
    if (_cache.size > CACHE_MAX) _cache.delete(_cache.keys().next().value);
    return entry;
  })().finally(() => _inflight.delete(zone));
  _inflight.set(zone, p);
  return p;
}

// Does an If-None-Match header (a list, weak or strong) name this ETag?
function etagMatches(header, etag) {
  if (!header || !etag) return false;
  const bare = (s) => s.trim().replace(/^W\//, '');
  return String(header).split(',').some(t => t.trim() === '*' || bare(t) === bare(etag));
}

module.exports = {
  getCharmPets, etagMatches, _resetCache,
  // exported for the tests
  isCharmCandidate, buildNpcs, cleanName, traitsOf, TRAIT_CODES, NPC_SELECT,
};
