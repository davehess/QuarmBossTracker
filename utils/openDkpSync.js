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
const { getRaids, getRaid } = require('./opendkp');

const PER_RUN_DETAIL_LIMIT = 50;   // max getRaid() calls per sync invocation

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

// Extract the array of attendee character names from a Tick. OpenDKP's payload
// varies — sometimes it's Attendees: ["Hitya", "Statlander", ...], sometimes
// Characters: [123, 456] (IDs). We coerce to strings either way and let the
// downstream resolver figure it out.
function _tickAttendees(tick) {
  const raw = Array.isArray(tick?.Attendees) ? tick.Attendees
            : Array.isArray(tick?.Characters) ? tick.Characters
            : [];
  return raw.map(x => (typeof x === 'string' ? x : String(x))).filter(Boolean);
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

function _lootRow(raidId, item) {
  if (!item || !item.CharacterName || !item.ItemName) return null;
  return {
    raid_id:        raidId,
    item_id:        item.ItemId      ?? null,
    game_item_id:   item.GameItemId  ?? item.ItemId ?? null,
    item_name:      item.ItemName,
    character_name: item.CharacterName,
    dkp:            Number.isFinite(item.Dkp) ? item.Dkp : 0,
    notes:          item.Notes || null,
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

  const tickRows = (full.Ticks || []).map(t => _tickRow(full.RaidId, t)).filter(Boolean);
  const lootRows = (full.Items || []).map(i => _lootRow(full.RaidId, i)).filter(Boolean);

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
  const listResult = await syncRaidsList();
  if (listResult.error) return { phase: 'list', ...listResult };

  // Pull the freshly-upserted raid list (oldest first so backfills land in
  // chronological order — the web app pages from newest to oldest, so newer
  // ones are more visible if we get throttled).
  const raids = await supabase.select(
    'opendkp_raids',
    'select=raid_id,version&order=ts.desc'
  );
  if (!Array.isArray(raids)) return { phase: 'list', ...listResult, detail_error: 'select raids failed' };

  const candidates = [];
  for (const r of raids) {
    if (opts.full || await _raidNeedsDetail(r.raid_id, r.version)) {
      candidates.push(r.raid_id);
    }
    if (candidates.length >= PER_RUN_DETAIL_LIMIT) break;
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
    raids_fetched:    listResult.fetched,
    raids_upserted:   listResult.upserted,
    detail_synced:    candidates.length,
    detail_errors:    detailErrors,
    tick_rows_written: tickRowsWritten,
    loot_rows_written: lootRowsWritten,
  };
}

module.exports = { runSync, syncRaidsList, syncRaidDetail };
