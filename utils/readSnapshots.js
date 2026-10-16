// utils/readSnapshots.js — guild-wide table reads that several handlers used to make separately.
//
// The same raid_roster window was read three times in the same second (the raid split, the Extended Target
// bundle, the buff-queue bundle) and the same characters table twice (the buff-queue bundle, di-status).
// Each handler now asks here, and one coalesced read (utils/ttlCache.js) answers all of them.
//
// The cache is keyed by the Supabase client object (a WeakMap), so the bot's one client shares a snapshot
// and a test's fake client starts with none.
//
// ⚠ The rows are SHARED between handlers. Read them; to change a row, copy it first.

const { cached } = require('./ttlCache');

const ROSTER_WINDOW_MS = 15 * 60 * 1000;     // the widest window any reader wanted (the buff queue's)
const ROSTER_TTL_MS = 4_000;
const CLASSES_TTL_MS = 5 * 60 * 1000;        // a character's class changes on officer action, never mid-fight

const _byClient = new WeakMap();
function _mapFor(client, name) {
  let m = _byClient.get(client);
  if (!m) { m = {}; _byClient.set(client, m); }
  return m[name] || (m[name] = new Map());
}
const _rows = (v) => Array.isArray(v);       // a failed read is null: answer the burst, keep nothing

// Every uploader's raid_roster rows captured in the last 15 minutes, with the union of the columns the
// readers use. Readers narrow it in JS: the raid split wants the last two minutes (groupRaids drops older
// uploads itself), Extended Target wants the rows whose loc_at is fresh. → rows, or null when the read failed.
function raidRoster(supabase, guildId) {
  return cached(_mapFor(supabase, 'roster'), guildId, ROSTER_TTL_MS, () => {
    // The bot receives every roster upload: once it has been receiving them for the whole window, the rows
    // are already in memory (utils/liveMemory.js; null while cold, and then the read below runs as before).
    const mem = require('./liveMemory').rosterRowsSince(guildId, ROSTER_WINDOW_MS);
    if (mem) return mem;
    const since = new Date(Date.now() - ROSTER_WINDOW_MS).toISOString();
    // Paged: one row per (uploader, name), ~1,000 at peak. A truncated read drops whole uploaders.
    return supabase.selectAllPaged('raid_roster',
      `guild_id=eq.${encodeURIComponent(guildId)}&captured_at=gte.${encodeURIComponent(since)}`
      + '&select=name,class,group_num,rank,level,hp_pct,uploaded_by_discord_id,captured_at,loc_x,loc_y,loc_z,heading,loc_at',
      'uploaded_by_discord_id.asc,name');
  }, { shouldCache: _rows });
}

// name + class of every character that has a class. → rows, or null when the read failed.
function characterClasses(supabase, guildId) {
  return cached(_mapFor(supabase, 'classes'), guildId, CLASSES_TTL_MS, () =>
    supabase.select('characters',
      `guild_id=eq.${encodeURIComponent(guildId)}&class=not.is.null&select=name,class`),
  { shouldCache: _rows });
}

module.exports = { raidRoster, characterClasses, ROSTER_WINDOW_MS };
