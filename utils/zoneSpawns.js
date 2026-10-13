// utils/zoneSpawns.js — GET /api/agent/zone-spawns?zone=<short_name> (Mimic 2.9 spawn map).
//
// The guild lead, 2026-10-10: the spawn map is the 2.9 headline (docs/DESIGN-mimic-2.9-spawn-map.md,
// DECISIONS §216). Mimic draws every spawn point of the zone it is in and runs the timers; this module
// is the bot's half: one zone's points + who spawns at each, plus the cached wall layer.
//
// THE FRAME IS THE SERVER'S. x/y/z are eqemu_spawn2 as stored. The pipe reports (x,y) swapped against
// spawn2 (pipe (x,y) = spawn2 (y,x)) and the AGENT converts; do not "fix" that here.
//
// Reads (all bounded, PostgREST answers at most 1,000 rows and says nothing when it cut):
//   · eqemu_zone       one row by short_name                         → long_name, and "is this a zone?"
//   · eqemu_spawn2     paged on its primary key (selectAllPaged)     → the points, enabled only
//   · eqemu_spawnentry paged per chunk of group ids                  → who spawns at each group
//   · eqemu_npc_types  by id list, chunked                           → name, level, senses, specials
//   · zone_map_lines   one row, bands/segs/bounds ONLY               → the cached EQEmu wall layer
//   · eqemu_zone_grids one row, only when a point has a pathgrid     → the pather routes (null if absent)
//
// ⚠ NEVER SELECT zone_map_lines.brewall. It is third-party map art with no licence; it is stored for the
// website's own render and must not leave the website (the guild lead's standing line on the spectator map).
// MAP_SELECT below is the whole list of columns this module asks for, and test/zone-spawns.test.js pins
// the exact query string. If a row is missing the map is null: the website computes and caches it, the
// bot never does.
const crypto = require('crypto');
const zlib = require('zlib');
const mobSpecials = require('./mobSpecials');

const ZONE_RE = /^[a-z0-9_]{1,32}$/;
const MAP_SELECT = 'bands,segs,bounds';
// eqemu_spawn2.respawntime of an instanced spawn point. Not a real timer: the point stays, the timer goes.
const INSTANCE_SENTINEL_S = 1_700_000;
const CHUNK = 100;                       // ids per in.(...) list: ~700 chars of URL
const TTL_MS = 6 * 60 * 60 * 1000;       // the mirror syncs weekly; six hours is plenty fresh
const EMPTY_TTL_MS = 5 * 60 * 1000;      // a zone with no points is re-asked in five minutes, not six hours
const CACHE_MAX = 200;                   // zones kept (~0.5 MB each at the worst); far past what a guild visits

const NPC_SELECT = 'id,name,level,raid_target,see_invis,see_invis_undead,see_hide,see_improved_hide,special_abilities,npcspecialattks,aggroradius,assistradius,npc_faction_id';
const ARTICLE_RE = /^(a|an|the)\s/i;

// "Gram_Dunnar" / "#The_Final_Arbiter" → "Gram Dunnar" / "The Final Arbiter" (utils/supabase.js npcDisplayName).
function cleanName(n) { return String(n || '').replace(/_/g, ' ').replace(/#/g, '').trim(); }

// 'Immune Pacify' → 'immune_pacify'. A label with an explanation after a dash ('Reverse Slow — slowing
// hastes it') keeps only the name; the label is the contract with mobSpecials, the slug is ours.
function slug(label) {
  return String(label).split(' — ')[0].toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function badgesFor(npc) {
  const out = [];
  if (npc.see_invis) out.push('eye');
  else if (npc.see_invis_undead) out.push('eye_undead');
  if (npc.see_hide || npc.see_improved_hide) out.push('hood');
  for (const label of mobSpecials.decodeSpecialLabels(npc.special_abilities, npc.npcspecialattks)) {
    const s = slug(label);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

// raid_target, or a board boss by name, or the odd one out of a multi-NPC group: a low-chance entry whose
// name is a proper name rather than "a ..." / "an ..." / "the ...". Name alone flags every guard and citizen.
function isNamed({ npc, name, chance, groupSize, bossNames }) {
  if (npc.raid_target) return true;
  if (bossNames.has(name.toLowerCase())) return true;
  return groupSize > 1 && Number(chance) < 50 && !ARTICLE_RE.test(name);
}

const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const num = (v) => (Number.isFinite(Number(v)) && v != null ? Number(v) : null);

// Returns { status: 400|404|503 } or { status: 200, payload } (payload.generated_at stamped here).
// `bosses` is data/bosses.json (objects with .name). A null read anywhere is a failed read, not an empty
// table: it answers 503 and nothing is cached.
async function build(supabase, zone, bosses) {
  const zrows = await supabase.select('eqemu_zone',
    `short_name=eq.${encodeURIComponent(zone)}&select=short_name,long_name&limit=1`);
  if (!Array.isArray(zrows)) return { status: 503 };
  if (!zrows.length) return { status: 400 };
  const longName = zrows[0].long_name || zone;

  const spawn2 = await supabase.selectAllPaged('eqemu_spawn2',
    `zone_short=eq.${encodeURIComponent(zone)}&enabled=eq.true&select=id,spawngroup_id,x,y,z,respawntime,variance,pathgrid`, 'id');
  if (!Array.isArray(spawn2)) return { status: 503 };

  const groupIds = [...new Set(spawn2.map(r => r.spawngroup_id).filter(g => g != null))];
  const entriesByGroup = new Map();   // spawngroup_id → [{ npc_id, chance }]
  for (const ids of chunks(groupIds, CHUNK)) {
    const rows = await supabase.selectAllPaged('eqemu_spawnentry',
      `spawngroup_id=in.(${ids.join(',')})&select=spawngroup_id,npc_id,chance`, 'spawngroup_id,npc_id');
    if (!Array.isArray(rows)) return { status: 503 };
    for (const r of rows) {
      if (!entriesByGroup.has(r.spawngroup_id)) entriesByGroup.set(r.spawngroup_id, []);
      entriesByGroup.get(r.spawngroup_id).push({ npc_id: r.npc_id, chance: r.chance });
    }
  }

  const npcIds = [...new Set([...entriesByGroup.values()].flat().map(e => e.npc_id).filter(i => i != null))];
  const npcs = new Map();
  for (const ids of chunks(npcIds, CHUNK)) {
    const rows = await supabase.select('eqemu_npc_types', `id=in.(${ids.join(',')})&select=${NPC_SELECT}&limit=${CHUNK}`);
    if (!Array.isArray(rows)) return { status: 503 };
    for (const r of rows) npcs.set(r.id, r);
  }

  const bossNames = new Set((bosses || []).map(b => String(b && b.name || '').toLowerCase()).filter(Boolean));
  const points = [];
  for (const sp of [...spawn2].sort((a, b) => a.id - b.id)) {
    const entries = (entriesByGroup.get(sp.spawngroup_id) || [])
      .slice().sort((a, b) => (Number(b.chance) || 0) - (Number(a.chance) || 0) || a.npc_id - b.npc_id);
    const list = [];
    for (const e of entries) {
      const npc = npcs.get(e.npc_id);
      if (!npc) continue;
      const name = cleanName(npc.name);
      list.push({
        name,
        level: num(npc.level),
        chance: num(e.chance),
        named: isNamed({ npc, name, chance: e.chance, groupSize: entries.length, bossNames }),
        raid_target: !!npc.raid_target,
        badges: badgesFor(npc),
        // How close you can get before it aggros, in game units (eqemu_npc_types.aggroradius; median 60). The Map's
        // aggro rings (the guild lead, 2026-10-13). 0 / missing = null: the server then falls back to its default.
        aggro: num(npc.aggroradius) > 0 ? num(npc.aggroradius) : null,
        // Its faction (eqemu_npc_types.npc_faction_id; 0 = none, so it aggros nobody) and how far it comes to help a
        // friend (assistradius; 0 / missing = null). The ring's colour and its dashed social ring (2026-10-13).
        fac: num(npc.npc_faction_id) > 0 ? num(npc.npc_faction_id) : 0,
        assist: num(npc.assistradius) > 0 ? num(npc.assistradius) : null,
      });
    }
    if (!list.length) continue;   // a point nobody spawns at is not a point
    const resp = num(sp.respawntime);
    points.push({
      id: sp.id, x: num(sp.x), y: num(sp.y), z: num(sp.z),
      respawn_s: resp == null || resp >= INSTANCE_SENTINEL_S ? null : resp,
      variance_s: num(sp.variance),
      grid: num(sp.pathgrid) > 0 ? num(sp.pathgrid) : null,   // 0 = stands still
      npcs: list,
    });
  }
  if (!points.length) return { status: 404 };

  // The routes the pathers walk (eqemu_zone_grids: one jsonb document per zone, see its migration). Only the
  // grids this zone's points name go out. The routes are decoration: a missing table (before the first
  // import) or a failed read leaves grids null and the map still answers; a FAILED read is cached briefly
  // (`degraded`) so a hiccup does not hide the routes for six hours.
  let grids = null;
  let degraded = false;
  const gridIds = [...new Set(points.map(p => p.grid).filter(g => g != null))].sort((a, b) => a - b);
  if (gridIds.length) {
    const grows = await supabase.select('eqemu_zone_grids', `zone_short=eq.${encodeURIComponent(zone)}&select=grids&limit=1`);
    if (!Array.isArray(grows)) degraded = true;
    else if (grows[0] && grows[0].grids && typeof grows[0].grids === 'object') {
      const picked = {};
      for (const id of gridIds) {
        const g = grows[0].grids[id];
        if (g && Array.isArray(g.pts) && g.pts.length) picked[id] = { type: g.type, type2: g.type2, pts: g.pts };
      }
      if (Object.keys(picked).length) grids = picked;
    }
  }

  const mrows = await supabase.select('zone_map_lines', `zone_short=eq.${encodeURIComponent(zone)}&select=${MAP_SELECT}&limit=1`);
  if (!Array.isArray(mrows)) return { status: 503 };
  const m = mrows[0];
  const map = m ? { bands: m.bands, segs: m.segs, bounds: m.bounds } : null;

  return { status: 200, degraded, payload: { zone, long_name: longName, generated_at: new Date().toISOString(), points, map, grids } };
}

// A weak validator over the CONTENT (generated_at left out) so a rebuild of unchanged data keeps its ETag
// and a Mimic revalidating after six hours still gets its 304.
function etagOf(payload) {
  const { generated_at: _g, ...content } = payload;
  return 'W/"' + crypto.createHash('sha1').update(JSON.stringify(content)).digest('hex').slice(0, 20) + '"';
}

const _cache = new Map();      // zone → { at, ttl, status, body?, gz?, etag? }
const _inflight = new Map();   // zone → Promise, so a fleet zoning in together costs one build
function _resetCache() { _cache.clear(); _inflight.clear(); }

// → { status, body?, gz?, etag? }.  `bosses` is data/bosses.json.
async function getZoneSpawns(supabase, zoneRaw, bosses, now = Date.now) {
  const zone = String(zoneRaw || '').trim().toLowerCase();
  if (!ZONE_RE.test(zone)) return { status: 400 };
  const hit = _cache.get(zone);
  if (hit && (now() - hit.at) < hit.ttl) return hit;
  if (_inflight.has(zone)) return _inflight.get(zone);
  const p = (async () => {
    const r = await build(supabase, zone, bosses);
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
  getZoneSpawns, etagMatches, _resetCache,
  // exported for the tests
  MAP_SELECT, INSTANCE_SENTINEL_S, cleanName, slug, badgesFor, isNamed,
};
