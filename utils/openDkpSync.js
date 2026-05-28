// utils/openDkpSync.js — Mirror OpenDKP raids/ticks/loot into Supabase.
//
// OpenDKP is the source of truth for guild raid history. This helper pulls the
// summary list via getRaids(), then fetches full detail (Ticks + Items) per
// raid we haven't synced yet (or where the upstream Version has bumped).
//
// Idempotent — all writes go through Supabase upsert with the dedup indexes
// from migration 20260528260000.
//
// Caller responsibilities:
//   - Provide SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (utils/supabase.js)
//   - Provide OpenDKP creds (utils/opendkp.js uses OPENDKP_CLIENT_ID,
//     OPENDKP_USERNAME, OPENDKP_PASSWORD, COGNITO_CLIENT_ID, OPENDKP_API_URL)
//
// Fail-open: any one raid that errors logs a warning and is skipped. We never
// throw — a stuck raid shouldn't kill the whole sync.

const supabase = require('./supabase');
const { getRaids, getRaid, getCharacters } = require('./opendkp');

const PER_RUN_DETAIL_LIMIT = 50;   // max getRaid() calls per sync invocation
let _loggedLootShape = false;      // one-shot diagnostic for unknown response shape

// Normalize the OpenDKP raid summary into the opendkp_raids row shape.
function _raidSummaryRow(r) {
  if (!r || !r.RaidId || !r.Timestamp) return null;
  return {
    raid_id:    r.RaidId,
    name:       r.Name || `Raid ${r.RaidId}`,
    ts:         new Date(r.Timestamp).toISOString(),
    pool_id:    r.Pool?.PoolId   ?? r.Pool?.IdPool ?? null,
    pool_name:  r.Pool?.Name     ?? r.Pool?.Description ?? null,
    attendance: r.Attendance     ?? null,
    version:    r.Version        ?? null,
    fetched_at: new Date().toISOString(),
  };
}

// Extract attendee character names from a Tick. Observed payload (2026-05-28):
// Attendees[] is an array of OBJECTS, not strings — shape roughly
//   { CharacterId, Name, ... } or similar. The recon docs assumed strings;
// that's wrong. We pull a name field with fallbacks and only stringify a raw
// ID when no name is available.
function _tickAttendees(tick) {
  const raw = Array.isArray(tick?.Attendees) ? tick.Attendees
            : Array.isArray(tick?.Characters) ? tick.Characters
            : [];
  return raw
    .map(x => {
      if (typeof x === 'string') return x;
      if (typeof x === 'number') return String(x);
      if (x && typeof x === 'object') {
        return x.Name
            || x.CharacterName
            || x.character
            || (x.CharacterId != null ? String(x.CharacterId) : null);
      }
      return null;
    })
    .filter(Boolean);
}

function _tickRow(raidId, tick) {
  if (!tick || tick.TickId == null) return null;
  return {
    tick_id:     tick.TickId,
    raid_id:     raidId,
    description: tick.Description || null,
    value:       tick.Value ?? null,
    attendees:   _tickAttendees(tick),
    fetched_at:  new Date().toISOString(),
  };
}

// Defensive against field-name variation across OpenDKP versions. Confirmed
// from the web UI (raid 96400, 2026-05-28): rows have Item, ItemID, DKP,
// Character, Notes columns. Underlying API field names not yet confirmed via
// raw response — we try the common variants until one of them gives us a
// non-null name + winner pair.
function _lootField(item, ...names) {
  for (const n of names) {
    if (item && item[n] != null && item[n] !== '') return item[n];
  }
  return null;
}

function _lootRow(raidId, item) {
  if (!item) return null;
  const itemName = _lootField(item, 'ItemName', 'Name', 'item_name', 'item');
  const charName = _lootField(item, 'CharacterName', 'Character', 'WinnerName', 'Winner',
                               'character_name', 'character', 'winner');
  const dkpRaw   = _lootField(item, 'Dkp', 'DKP', 'DkpSpent', 'Value', 'dkp', 'dkp_spent');
  const itemId   = _lootField(item, 'ItemId', 'ItemID', 'item_id');
  const gameItemId = _lootField(item, 'GameItemId', 'GameItem', 'game_item_id') ?? itemId;
  if (!itemName || !charName) return null;
  return {
    raid_id:        raidId,
    item_id:        Number.isFinite(itemId) ? itemId : null,
    game_item_id:   Number.isFinite(gameItemId) ? gameItemId : null,
    item_name:      String(itemName),
    character_name: String(charName),
    dkp:            Number.isFinite(dkpRaw) ? dkpRaw : 0,
    notes:          _lootField(item, 'Notes', 'notes') || null,
    fetched_at:     new Date().toISOString(),
  };
}

// Upsert the raid summary list. Returns { fetched, upserted }.
async function syncRaidsList() {
  if (!supabase.isEnabled()) return { fetched: 0, upserted: 0, error: 'supabase disabled' };
  let raids;
  try { raids = await getRaids(); }
  catch (err) { return { fetched: 0, upserted: 0, error: err?.message || String(err) }; }

  if (!Array.isArray(raids)) return { fetched: 0, upserted: 0, error: 'getRaids returned non-array' };

  const rows = raids.map(_raidSummaryRow).filter(Boolean);
  if (rows.length === 0) return { fetched: raids.length, upserted: 0 };

  const written = await supabase.upsert('opendkp_raids', rows, 'raid_id');
  return {
    fetched:  raids.length,
    upserted: Array.isArray(written) ? written.length : 0,
  };
}

// Pull existing ticks + loot for a raid_id so we know whether detail sync is
// needed. We re-sync if EITHER:
//   - we have zero ticks for it (never fetched detail), OR
//   - the upstream Version (from summary) is newer than ours.
async function _raidNeedsDetail(raidId, upstreamVersion) {
  const ticks = await supabase.select(
    'opendkp_ticks',
    `raid_id=eq.${raidId}&select=tick_id&limit=1`
  );
  if (!Array.isArray(ticks) || ticks.length === 0) return true;
  // Cheap version check
  if (upstreamVersion == null) return false;
  const ours = await supabase.select(
    'opendkp_raids',
    `raid_id=eq.${raidId}&select=version`
  );
  const ourVersion = Array.isArray(ours) ? ours[0]?.version : null;
  return ourVersion == null || ourVersion < upstreamVersion;
}

// Fetch full detail for one raid and upsert its ticks + loot. Returns
// { tick_rows_written, loot_rows_written } or { error }.
async function syncRaidDetail(raidId) {
  let full;
  try { full = await getRaid(raidId); }
  catch (err) { return { error: err?.message || String(err) }; }
  if (!full || !full.RaidId) return { error: 'getRaid returned empty' };

  // Refresh summary in case it shifted (version bumped, pool moved, etc.)
  const summaryRow = _raidSummaryRow(full);
  if (summaryRow) {
    await supabase.upsert('opendkp_raids', [summaryRow], 'raid_id');
  }

  // Look for items in multiple possible places — the API's field name for
  // the loot array hasn't been confirmed against a raw response. Web UI
  // shows columns Item/ItemID/DKP/Character/Notes but doesn't reveal the
  // wire format.
  const itemsArray = (() => {
    for (const key of ['Items', 'items', 'Loot', 'loot', 'Awards', 'awards', 'RaidItems']) {
      if (Array.isArray(full[key])) return full[key];
    }
    return [];
  })();

  // One-shot diagnostic: when the response has neither Items NOR Loot at
  // any of the expected names, log the top-level keys so we can see what
  // the actual shape is. The first raid_id to trip this logs once; we
  // throttle further raids in the same run via a module-level flag below.
  if (itemsArray.length === 0 && !_loggedLootShape) {
    _loggedLootShape = true;
    const keys = Object.keys(full || {}).filter(k => typeof full[k] !== 'function');
    console.log(`[opendkp-sync] raid ${raidId}: no items at expected keys. Top-level response keys:`,
      keys.join(', '));
    // Sample first 200 chars of full payload (redact-safe — these are raid
    // metadata, no creds).
    try {
      const sample = JSON.stringify(full).slice(0, 600);
      console.log(`[opendkp-sync] raid ${raidId} sample:`, sample);
    } catch {}
  }

  const tickRows = (full.Ticks || full.ticks || []).map(t => _tickRow(full.RaidId, t)).filter(Boolean);
  const lootRows = itemsArray.map(i => _lootRow(full.RaidId, i)).filter(Boolean);

  let tickWritten = 0, lootWritten = 0;
  if (tickRows.length > 0) {
    const w = await supabase.upsert('opendkp_ticks', tickRows, 'tick_id');
    tickWritten = Array.isArray(w) ? w.length : 0;
  }
  if (lootRows.length > 0) {
    // Composite dedup index — pass the columns the index references. PostgREST
    // resolves on_conflict by column list; with our partial-coalesce index this
    // works because all referenced columns are present in the row.
    const w = await supabase.upsert(
      'opendkp_loot',
      lootRows,
      'raid_id,game_item_id,character_name,dkp'
    );
    lootWritten = Array.isArray(w) ? w.length : 0;
  }

  return { tick_rows_written: tickWritten, loot_rows_written: lootWritten };
}

// Incremental sync entry point — list raids, then drill into the ones that
// need detail. PER_RUN_DETAIL_LIMIT caps how many getRaid() calls happen so a
// cold start doesn't hammer OpenDKP.
//
// opts.full = true forces detail fetch for every raid (use sparingly — only for
// manual /syncopendkp).
async function runSync(opts = {}) {
  // Characters first — uses bearer auth, works even when OPENDKP_CLIENT_ID
  // (the read-side base64 token) is missing. Independent of the raids flow
  // so a CLIENT_ID outage still keeps the roster fresh.
  const charResult = await syncCharacters().catch(err => ({ error: err?.message || String(err) }));

  // Raids list — uses _readHeaders → requires OPENDKP_CLIENT_ID. If this
  // fails we still surface the character sync result so the caller knows
  // SOMETHING worked.
  const listResult = await syncRaidsList();
  if (listResult.error) {
    return {
      phase: 'list',
      ...listResult,
      characters_upserted: charResult?.upserted ?? 0,
      characters_error:    charResult?.error || null,
    };
  }

  // Pull the freshly-upserted raid list (oldest first so backfills land in
  // chronological order — the web app pages from newest to oldest, so newer
  // ones are more visible if we get throttled).
  const raids = await supabase.select(
    'opendkp_raids',
    'select=raid_id,version&order=ts.desc'
  );
  if (!Array.isArray(raids)) {
    return {
      phase: 'list',
      ...listResult,
      detail_error: 'select raids failed',
      characters_upserted: charResult?.upserted ?? 0,
      characters_error:    charResult?.error || null,
    };
  }

  // PER_RUN_DETAIL_LIMIT is a guard against an enthusiastic background sync,
  // not the manual /syncopendkp full:true case. When the caller explicitly
  // asked for a full re-sync, run through everything.
  const cap = opts.full ? Infinity : PER_RUN_DETAIL_LIMIT;
  const candidates = [];
  for (const r of raids) {
    if (opts.full || await _raidNeedsDetail(r.raid_id, r.version)) {
      candidates.push(r.raid_id);
    }
    if (candidates.length >= cap) break;
  }

  let tickRowsWritten = 0;
  let lootRowsWritten = 0;
  let detailErrors    = 0;
  for (const raidId of candidates) {
    const res = await syncRaidDetail(raidId);
    if (res.error) { detailErrors++; console.warn(`[opendkp-sync] raid ${raidId}: ${res.error}`); continue; }
    tickRowsWritten += res.tick_rows_written || 0;
    lootRowsWritten += res.loot_rows_written || 0;
  }

  return {
    phase: 'done',
    raids_fetched:     listResult.fetched,
    raids_upserted:    listResult.upserted,
    detail_synced:     candidates.length,
    detail_errors:     detailErrors,
    tick_rows_written: tickRowsWritten,
    loot_rows_written: lootRowsWritten,
    characters_upserted: charResult?.upserted ?? 0,
    characters_error:    charResult?.error || null,
  };
}

// Pull the full OpenDKP character list and mirror into the characters table.
// The OpenDKP roster is the canonical class/race/rank source — the web app
// uses it directly rather than relying on the noisier who_observations table
// which depends on someone running the agent in-zone.
//
// Uses bearer auth (getCharacters), so this works even if OPENDKP_CLIENT_ID
// is unset on Railway (which is the current case).
//
// ParentId resolution: a character with ParentId == 0 is the family root
// (main); otherwise ParentId points to the root's CharacterId. We build a
// Map<CharacterId, Name> first so we can store main_name as the actual name,
// not just an integer.
async function syncCharacters() {
  if (!supabase.isEnabled()) return { error: 'supabase disabled', upserted: 0 };
  let chars;
  try { chars = await getCharacters(); }
  catch (err) { return { error: err?.message || String(err), upserted: 0 }; }
  if (!Array.isArray(chars)) return { error: 'getCharacters returned non-array', upserted: 0 };

  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
  const nowIso  = new Date().toISOString();

  // Build CharacterId → Name map for ParentId resolution. Names can repeat
  // across accounts in theory; we trust OpenDKP IDs for the lookup and only
  // use names downstream.
  const idToName = new Map();
  for (const c of chars) {
    if (c?.CharacterId && c?.Name) idToName.set(c.CharacterId, c.Name);
  }

  const rows = chars
    .filter(c => c && c.Name && !c.Deleted)
    .map(c => {
      const isRoot = c.ParentId === 0 || c.ParentId == null;
      const mainName = isRoot ? c.Name : (idToName.get(c.ParentId) || null);
      return {
        guild_id:   guildId,
        name:       c.Name,
        race:       c.Race  || null,
        class:      c.Class || null,
        rank:       c.Rank  || null,
        main_name:  mainName,
        opendkp_id: Number.isFinite(c.CharacterId) ? c.CharacterId : null,
        active:     c.Active === 1 || c.Active === true,
        updated_at: nowIso,
      };
    });

  if (rows.length === 0) return { upserted: 0 };

  // Batch in chunks so a huge guild roster doesn't single-shot a big PostgREST
  // payload. 200/batch is well under PostgREST's limit and matches our other
  // upsert helpers' implicit batching.
  const BATCH = 200;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const written = await supabase.upsert('characters', slice, 'guild_id,name');
    if (Array.isArray(written)) upserted += written.length;
  }
  return { upserted };
}

module.exports = { runSync, syncRaidsList, syncRaidDetail, syncCharacters };
