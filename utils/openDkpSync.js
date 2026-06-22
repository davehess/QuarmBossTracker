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
const { getRaids, getRaid, getCharacters, getAuctions, getAuction, getAudits, getAdjustments } = require('./opendkp');

const PER_RUN_DETAIL_LIMIT  = 50;   // max getRaid() calls per sync invocation
const AUCTION_PAGE_LIMIT    = 25;   // safety cap; OpenDKP "Include all" runs ~13 pages
const AUDIT_PAGE_LIMIT      = 25;   // safety cap; user reports ~15 audit pages currently
const BID_DETAIL_PER_RUN    = 50;   // per-auction bid fetches per incremental run
let _loggedLootShape       = false;  // one-shot diagnostic — unknown raid-detail items shape
let _loggedAuctionShape    = false;  // one-shot diagnostic — unknown auctions response shape
let _loggedBidShape        = false;  // one-shot diagnostic — unknown bid response shape
let _loggedAuditShape      = false;  // one-shot diagnostic — unknown audit response shape
let _loggedAdjustShape     = false;  // one-shot diagnostic — unknown adjustment response shape

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

// Map a raw auction object from /clients/wolfpack/auctions?page=N into an
// opendkp_auctions row. Confirmed shape (2026-05-28):
//   { AuctionId, State, ItemId, CreatedTimestamp, EndTimestamp, Notes,
//     Auctioneer, Item: { ItemId, Name, GameItemId }, Bids: [...] }
// No top-level Winner / BidAmount fields — winner is the highest bid in
// Bids[] (highest Value wins, ties broken by earliest Date).
function _auctionRow(a) {
  if (!a) return null;
  const auctionId = _lootField(a, 'AuctionId', 'AuctionID', 'Id', 'id');
  if (auctionId == null) return null;

  const itemName = (a.Item && (a.Item.Name || a.Item.ItemName))
                || _lootField(a, 'ItemName', 'Name');
  const itemId   = (a.Item && (a.Item.ItemId || a.Item.GameItemId))
                || _lootField(a, 'ItemId', 'GameItemId');
  if (!itemName) return null;

  // Pick the winning bid from Bids[]. Highest Value wins; ties go to the
  // earliest Date. Empty Bids[] → no winner (auction unawarded).
  // Bid.User is the OpenDKP account login (not the character); Bid.CharacterId
  // is the actual character the bid is for. Store both so the view can JOIN
  // characters.opendkp_id and surface the real character name.
  let winner = null;
  let winnerCharacterId = null;
  let bidAmount = null;
  const bids = Array.isArray(a.Bids) ? a.Bids
            : Array.isArray(a.bids) ? a.bids
            : [];
  if (bids.length > 0) {
    const top = bids.reduce((best, b) => {
      const v = Number(b?.Value ?? b?.value ?? 0);
      const bv = Number(best?.Value ?? best?.value ?? 0);
      if (v > bv) return b;
      if (v < bv) return best;
      // Tie: earlier date wins
      const ta = Date.parse(b?.Date || b?.date || b?.CreatedAt || '') || Infinity;
      const tb = Date.parse(best?.Date || best?.date || best?.CreatedAt || '') || Infinity;
      return ta < tb ? b : best;
    }, bids[0]);
    winner            = top?.User || top?.Name || top?.CharacterName || null;
    winnerCharacterId = Number.isFinite(Number(top?.CharacterId)) ? Number(top.CharacterId) : null;
    bidAmount         = Number.isFinite(Number(top?.Value)) ? Number(top.Value) : null;
  }

  return {
    auction_id:  Number(auctionId),
    raid_id:     _lootField(a, 'RaidId', 'RaidID', 'raid_id') || null,
    item_id:     Number.isFinite(Number(itemId)) ? Number(itemId) : null,
    item_name:   String(itemName),
    winner,
    winner_character_id: winnerCharacterId,
    bid_amount:  bidAmount,
    auctioneer:  _lootField(a, 'Auctioneer', 'auctioneer') || null,
    notes:       _lootField(a, 'Notes', 'notes') || null,
    state:       Number.isFinite(Number(a.State)) ? Number(a.State) : null,
    awarded_at:  _lootField(a, 'EndTimestamp', 'AwardedAt', 'UpdatedTimestamp') || null,
    created_at:  _lootField(a, 'CreatedTimestamp', 'CreatedAt', 'created_at') || null,
    end_at:      _lootField(a, 'EndTimestamp', 'EndAt', 'end_at') || null,
    fetched_at:  new Date().toISOString(),
  };
}

// Extract inline bid rows from a list-endpoint auction. The bidding history
// lives directly in the auctions list response — no separate detail call
// needed. Bid shape (confirmed 2026-05-28):
//   { BidId, SessionId, CharacterId, User, Value, Rank, Date, ... }
function _bidsFromAuction(auctionId, a) {
  const bids = Array.isArray(a?.Bids) ? a.Bids
            : Array.isArray(a?.bids) ? a.bids
            : [];
  if (bids.length === 0) return [];
  // Sort by Value desc for stable position numbering
  const sorted = [...bids].sort((x, y) => Number(y?.Value || 0) - Number(x?.Value || 0));
  return sorted.map((b, i) => {
    const userLogin = b?.User || b?.Name || b?.CharacterName;
    if (!userLogin) return null;
    const valueRaw = b?.Value ?? b?.value;
    const charId   = Number(b?.CharacterId);
    return {
      auction_id:     Number(auctionId),
      position:       i + 1,
      // character_name retained for legacy display compatibility; the actual
      // character lookup happens via character_id → characters.opendkp_id.
      character_name: String(userLogin),
      user_login:     String(userLogin),
      character_id:   Number.isFinite(charId) ? charId : null,
      rank:           b?.Rank || b?.rank || null,
      value:          Number.isFinite(Number(valueRaw)) ? Number(valueRaw) : null,
      bid_at:         b?.Date || b?.date || b?.CreatedAt || null,
      fetched_at:     new Date().toISOString(),
    };
  }).filter(Boolean);
}

// Walk /clients/wolfpack/auctions?page=N until an empty page (or the safety
// cap) is hit. OpenDKP's "Include all" toggle issues exactly the same fetches
// pages 1..13 currently, so AUCTION_PAGE_LIMIT=25 is generous headroom.
// Map a raw bid entry from /clients/wolfpack/auctions/{id} into an
// opendkp_auction_bids row. Confirmed columns (from web UI for auction
// 994909): position #, Name, Rank, Value, Date. Defensive field-name
// matching like the other OpenDKP rows.
function _bidRow(auctionId, b, position) {
  if (!b) return null;
  const charName = _lootField(b, 'Name', 'CharacterName', 'Character', 'character_name', 'character');
  if (!charName) return null;
  const valueRaw = _lootField(b, 'Value', 'Bid', 'Dkp', 'DKP', 'value');
  const bidAt    = _lootField(b, 'Date', 'BidAt', 'Timestamp', 'CreatedAt', 'created_at', 'bid_at');
  return {
    auction_id:     Number(auctionId),
    position:       Number.isFinite(position) ? position : null,
    character_name: String(charName),
    rank:           _lootField(b, 'Rank', 'rank') || null,
    value:          Number.isFinite(valueRaw) ? Number(valueRaw) : null,
    bid_at:         bidAt || null,
    fetched_at:     new Date().toISOString(),
  };
}

// Fetch one auction's full detail and upsert its bids. Returns count
// written (or { error }).
async function syncAuctionBids(auctionId) {
  let detail;
  try { detail = await getAuction(auctionId); }
  catch (err) { return { error: err?.message || String(err), bids_written: 0 }; }
  if (!detail) return { bids_written: 0 };

  // Bids array could live at .Bids, .bids, or be the response itself if
  // the API returns just the array. Try the common spots.
  const bids = Array.isArray(detail)             ? detail
            : Array.isArray(detail?.Bids)        ? detail.Bids
            : Array.isArray(detail?.bids)        ? detail.bids
            : Array.isArray(detail?.Bidders)     ? detail.Bidders
            : null;

  if (!bids) {
    if (!_loggedBidShape) {
      _loggedBidShape = true;
      const keys = Object.keys(detail || {}).filter(k => typeof detail[k] !== 'function');
      console.log('[opendkp-sync] auction', auctionId, 'detail: no bids array. Keys:', keys.join(', '));
      try { console.log('[opendkp-sync] auction', auctionId, 'sample:', JSON.stringify(detail).slice(0, 600)); } catch {}
    }
    return { bids_written: 0 };
  }

  const rows = bids.map((b, i) => _bidRow(auctionId, b, i + 1)).filter(Boolean);
  if (rows.length === 0) return { bids_written: 0 };
  // Dedup by the unique key (auction_id, character_name, value) before the
  // upsert — PG 21000 ("ON CONFLICT DO UPDATE command cannot affect row a
  // second time") fires when two rows in the same payload target the same
  // conflict target, which happens when OpenDKP's bid history lists the
  // same character at the same DKP value twice (re-clicks, tie recordings).
  // Keep the row with the lowest position (= earliest entry in the bid
  // history, the canonical placement if it tied).
  const dedup = new Map();
  const posOf = r => Number.isFinite(r.position) ? r.position : Infinity;
  for (const r of rows) {
    const key = `${r.auction_id}|${(r.character_name || '').toLowerCase()}|${r.value}`;
    const cur = dedup.get(key);
    if (!cur || posOf(r) < posOf(cur)) dedup.set(key, r);
  }
  const written = await supabase.upsert('opendkp_auction_bids', [...dedup.values()], 'auction_id,character_name,value');
  return { bids_written: Array.isArray(written) ? written.length : 0 };
}

//
// Incremental sync (default): walk page 1 only (50 most recent auctions —
// covers any newly-settled bids since the last run).
// Full sync (opts.full): walk all pages until empty.
async function syncAuctions(opts = {}) {
  if (!supabase.isEnabled()) return { error: 'supabase disabled', upserted: 0, pages: 0 };
  const maxPages = opts.full ? AUCTION_PAGE_LIMIT : 1;

  let pagesWalked    = 0;
  let totalUpserted  = 0;

  let bidsWritten = 0;

  for (let page = 1; page <= maxPages; page++) {
    let arr;
    try { arr = await getAuctions(page); }
    catch (err) {
      return { error: err?.message || String(err), upserted: totalUpserted, pages: pagesWalked, bids_written: bidsWritten };
    }

    // Confirmed shape (2026-05-28): { TotalPages, CurrentPage, BidResults: [...] }
    const list = Array.isArray(arr?.BidResults)    ? arr.BidResults
              : Array.isArray(arr)                 ? arr
              : Array.isArray(arr?.auctions)       ? arr.auctions
              : Array.isArray(arr?.data)           ? arr.data
              : null;

    if (!list) {
      if (!_loggedAuctionShape) {
        _loggedAuctionShape = true;
        const keys = Object.keys(arr || {}).filter(k => typeof arr[k] !== 'function');
        console.log('[opendkp-sync] auctions page ' + page + ' unexpected shape — top-level keys:', keys.join(', '));
        try { console.log('[opendkp-sync] auctions sample:', JSON.stringify(arr).slice(0, 600)); } catch {}
      }
      return { error: 'unexpected auctions shape', upserted: totalUpserted, pages: pagesWalked, bids_written: bidsWritten };
    }

    if (list.length === 0) break;
    pagesWalked++;

    // Auction rows
    const auctionRows = list.map(_auctionRow).filter(Boolean);
    if (auctionRows.length > 0) {
      const written = await supabase.upsert('opendkp_auctions', auctionRows, 'auction_id');
      if (Array.isArray(written)) totalUpserted += written.length;
    }

    // Bid rows live inline in each auction's Bids[] — no detail call needed.
    // Flatten across all auctions on this page, upsert as one batch.
    const allBids = list.flatMap(a => {
      const auctionId = a?.AuctionId ?? a?.AuctionID ?? a?.Id;
      if (auctionId == null) return [];
      return _bidsFromAuction(auctionId, a);
    });
    if (allBids.length > 0) {
      const written = await supabase.upsert(
        'opendkp_auction_bids',
        allBids,
        'auction_id,character_name,value',
      );
      if (Array.isArray(written)) bidsWritten += written.length;
    }

    // Stop if the API said this is the last page.
    if (arr?.TotalPages && arr?.CurrentPage && arr.CurrentPage >= arr.TotalPages) break;
  }

  return {
    upserted:       totalUpserted,
    pages:          pagesWalked,
    bids_written:   bidsWritten,
    // Kept for backwards-compat with the /syncopendkp reply formatter
    auctions_detailed: pagesWalked, // bids are now extracted inline, not via per-auction calls
    bid_errors:        0,
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
// needed. We re-sync if ANY of:
//   - we have zero ticks for it (never fetched detail), OR
//   - ANY tick has an empty/null attendees array (we captured the tick row
//     mid-raid before attendance was finalized, or a fetch returned partial
//     data — this is the bug behind the wildly-low attendance %: empty-
//     attendee ticks still count in the denominator but credit nobody, so
//     regulars like Rorschach/Gonner read far below their true RA). Forcing
//     a re-fetch until every tick is populated backfills the real attendance.
//   - the upstream Version (from summary) is newer than ours.
// Empty-tick re-fetch only matters for raids the attendance page actually
// reads (last ~90 days). Re-checking attendees on ancient raids every sync
// would pull every tick's full attendee array forever — wasted egress. Cap
// the attendee-emptiness check to this window; older raids use the cheap
// "has any tick" check.
const EMPTY_TICK_RECHECK_DAYS = 100;
async function _raidNeedsDetail(raidId, upstreamVersion, raidTs) {
  const recentEnough = raidTs
    ? (Date.now() - new Date(raidTs).getTime()) <= EMPTY_TICK_RECHECK_DAYS * 86400000
    : false;
  if (recentEnough) {
    // Pull attendees so we can detect empty-attendee ticks (detail captured
    // mid-raid before attendance was finalized) and force a backfill re-fetch
    // until every tick is populated — the fix for attendance % reading far
    // below OpenDKP's truth.
    const ticks = await supabase.select(
      'opendkp_ticks',
      `raid_id=eq.${raidId}&select=tick_id,attendees`
    );
    if (!Array.isArray(ticks) || ticks.length === 0) return true;
    const hasEmptyTick = ticks.some(t => !Array.isArray(t.attendees) || t.attendees.length === 0);
    if (hasEmptyTick) return true;
  } else {
    // Cheap existence check for older raids.
    const ticks = await supabase.select(
      'opendkp_ticks',
      `raid_id=eq.${raidId}&select=tick_id&limit=1`
    );
    if (!Array.isArray(ticks) || ticks.length === 0) return true;
  }
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
    'select=raid_id,version,ts&order=ts.desc'
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
    if (opts.full || await _raidNeedsDetail(r.raid_id, r.version, r.ts)) {
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

  // Auctions: incremental walks page 1 only (~50 most-recent entries cover
  // anything settled since the last sync); full walks pages 1..13ish until
  // exhausted. Bid-Amount + Winner + RaidId per row → this is the canonical
  // loot source going forward (opendkp_loot_recent view reads from
  // opendkp_auctions, not from the per-raid Items[] data).
  const auctionsResult = await syncAuctions(opts).catch(err =>
    ({ error: err?.message || String(err), upserted: 0, pages: 0 }));

  // Audits + adjustments: full walks every time for now (~15 pages each).
  // These are the canonical sources for officer-driven changes (rank moves,
  // main switches, manual DKP corrections) and feed the era timeline on the
  // character page.
  const auditsResult      = await syncAudits().catch(err =>
    ({ error: err?.message || String(err), upserted: 0, pages: 0 }));
  const adjustmentsResult = await syncAdjustments().catch(err =>
    ({ error: err?.message || String(err), upserted: 0, pages: 0 }));

  return {
    phase: 'done',
    raids_fetched:     listResult.fetched,
    raids_upserted:    listResult.upserted,
    detail_synced:     candidates.length,
    detail_errors:     detailErrors,
    tick_rows_written: tickRowsWritten,
    loot_rows_written: lootRowsWritten,
    auctions_upserted:  auctionsResult?.upserted ?? 0,
    auctions_pages:     auctionsResult?.pages ?? 0,
    auction_bids_written:  auctionsResult?.bids_written ?? 0,
    auctions_detailed:     auctionsResult?.auctions_detailed ?? 0,
    auction_bid_errors:    auctionsResult?.bid_errors ?? 0,
    auctions_error:    auctionsResult?.error || null,
    audits_upserted:        auditsResult?.upserted ?? 0,
    audits_pages:           auditsResult?.pages ?? 0,
    audits_error:           auditsResult?.error || null,
    adjustments_upserted:   adjustmentsResult?.upserted ?? 0,
    adjustments_pages:      adjustmentsResult?.pages ?? 0,
    adjustments_error:      adjustmentsResult?.error || null,
    characters_upserted: charResult?.upserted ?? 0,
    characters_error:    charResult?.error || null,
  };
}

// Pluck a likely ID/timestamp from any OpenDKP-style record. Shapes vary
// across endpoints (AuditId / AdjustmentId / etc.) so we accept any of the
// common variants.
function _firstNumber(row, ...keys) {
  for (const k of keys) {
    const v = row?.[k];
    if (v == null) continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function _firstString(row, ...keys) {
  for (const k of keys) {
    const v = row?.[k];
    if (v == null) continue;
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

// Walk a paginated list endpoint and upsert raw rows into the given table.
// Used for both /audits and /adjustments since we don't yet know the exact
// field shape — we store the full payload as JSONB and surface an ID +
// timestamp for indexing.
async function _syncListEndpoint({
  label, fetchPage, table, idKeys, tsKeys, shapeFlag,
}) {
  if (!supabase.isEnabled()) return { error: 'supabase disabled', upserted: 0, pages: 0 };

  let pagesWalked   = 0;
  let totalUpserted = 0;

  for (let page = 1; page <= AUDIT_PAGE_LIMIT; page++) {
    let arr;
    try { arr = await fetchPage(page); }
    catch (err) { return { error: err?.message || String(err), upserted: totalUpserted, pages: pagesWalked }; }

    // OpenDKP wraps list payloads inside { TotalPages, CurrentPage, <KEY> }
    // where <KEY> varies per endpoint: BidResults (auctions), Audits, Adjustments,
    // Items, Results — and in some cases the response IS a bare array. We accept
    // all of those, plus a capitalized form derived from the endpoint label
    // ("audits" → "Audits") as the primary fallback.
    const capLabel = label ? label.charAt(0).toUpperCase() + label.slice(1) : null;
    const list = Array.isArray(arr?.BidResults) ? arr.BidResults
              : Array.isArray(arr?.Audits)     ? arr.Audits
              : Array.isArray(arr?.Adjustments) ? arr.Adjustments
              : (capLabel && Array.isArray(arr?.[capLabel])) ? arr[capLabel]
              : Array.isArray(arr?.Results)    ? arr.Results
              : Array.isArray(arr?.Items)      ? arr.Items
              : Array.isArray(arr)             ? arr
              : Array.isArray(arr?.data)       ? arr.data
              : null;

    if (!list) {
      if (!shapeFlag.value) {
        shapeFlag.value = true;
        const keys = Object.keys(arr || {}).filter(k => typeof arr[k] !== 'function');
        console.log(`[opendkp-sync] ${label} page ${page} unexpected shape — top-level keys:`, keys.join(', '));
        try { console.log(`[opendkp-sync] ${label} sample:`, JSON.stringify(arr).slice(0, 600)); } catch {}
      }
      return { error: `unexpected ${label} shape`, upserted: totalUpserted, pages: pagesWalked };
    }

    if (list.length === 0) break;
    pagesWalked++;

    if (!shapeFlag.value && list[0]) {
      shapeFlag.value = true;
      const keys = Object.keys(list[0]).filter(k => typeof list[0][k] !== 'function');
      console.log(`[opendkp-sync] ${label} first row keys:`, keys.join(', '));
    }

    const rows = list.map(row => {
      const id = _firstNumber(row, ...idKeys);
      if (id == null) return null;
      const tsRaw = _firstString(row, ...tsKeys);
      return {
        [idKeys[0].toLowerCase().replace(/id$/, '_id')]: id,
        ts:         tsRaw ? new Date(tsRaw).toISOString() : null,
        raw:        row,
        fetched_at: new Date().toISOString(),
      };
    }).filter(Boolean);

    if (rows.length > 0) {
      const pkCol = Object.keys(rows[0])[0];
      const written = await supabase.upsert(table, rows, pkCol);
      if (Array.isArray(written)) totalUpserted += written.length;
    }

    if (arr?.TotalPages && arr?.CurrentPage && arr.CurrentPage >= arr.TotalPages) break;
  }

  return { upserted: totalUpserted, pages: pagesWalked };
}

async function syncAudits() {
  const flag = { value: _loggedAuditShape };
  const res  = await _syncListEndpoint({
    label:     'audits',
    fetchPage: getAudits,
    table:     'opendkp_audits',
    idKeys:    ['AuditId', 'Id', 'audit_id'],
    tsKeys:    ['Timestamp', 'CreatedAt', 'Date', 'timestamp'],
    shapeFlag: flag,
  });
  _loggedAuditShape = flag.value;
  return res;
}

async function syncAdjustments() {
  const flag = { value: _loggedAdjustShape };
  const res  = await _syncListEndpoint({
    label:     'adjustments',
    fetchPage: getAdjustments,
    table:     'opendkp_adjustments',
    idKeys:    ['AdjustmentId', 'Id', 'adjustment_id'],
    tsKeys:    ['Timestamp', 'CreatedAt', 'Date', 'timestamp'],
    shapeFlag: flag,
  });
  _loggedAdjustShape = flag.value;
  return res;
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
// Pull every page of characters. OpenDKP's /characters endpoint paginates
// (the web UI exposes page-size + page controls), and a single un-paged call
// only returns the first slice — that's how active level-60 mains like Dant
// went missing from our mirror. We walk ?page=N until a page yields no NEW
// CharacterIds (handles both real pagination AND an endpoint that ignores
// ?page and returns the same full list every time — the new-id check stops
// us after the second page in that case). Accepts a flat-array response or a
// { Results | Characters | data } wrapper. Caps at 40 pages for safety.
const CHAR_PAGE_LIMIT = 40;
async function _fetchAllCharacters() {
  const byId   = new Map();   // CharacterId -> char
  const noId   = [];          // chars without a CharacterId (kept, can't dedup)
  let pagesWalked = 0;
  for (let page = 1; page <= CHAR_PAGE_LIMIT; page++) {
    let resp;
    try { resp = await getCharacters({ page }); }
    catch (err) { if (page === 1) throw err; break; }  // page-1 failure is fatal; later pages just stop
    const list = Array.isArray(resp)            ? resp
              : Array.isArray(resp?.Results)    ? resp.Results
              : Array.isArray(resp?.Characters) ? resp.Characters
              : Array.isArray(resp?.data)       ? resp.data
              : null;
    if (!list || list.length === 0) break;
    pagesWalked++;
    let newOnThisPage = 0;
    for (const c of list) {
      if (!c) continue;
      if (Number.isFinite(c.CharacterId)) {
        if (!byId.has(c.CharacterId)) { byId.set(c.CharacterId, c); newOnThisPage++; }
      } else {
        noId.push(c); newOnThisPage++;
      }
    }
    // No new characters on this page → endpoint either has no more, or is
    // ignoring ?page and replaying the same set. Either way, stop.
    if (newOnThisPage === 0) break;
    if (resp?.TotalPages && resp?.CurrentPage && resp.CurrentPage >= resp.TotalPages) break;
  }
  return { chars: [...byId.values(), ...noId], pagesWalked };
}

async function syncCharacters() {
  if (!supabase.isEnabled()) return { error: 'supabase disabled', upserted: 0 };
  let chars, pagesWalked;
  try { ({ chars, pagesWalked } = await _fetchAllCharacters()); }
  catch (err) { return { error: err?.message || String(err), upserted: 0 }; }
  if (!Array.isArray(chars)) return { error: 'getCharacters returned non-array', upserted: 0 };
  console.log(`[opendkp-sync] characters: fetched ${chars.length} across ${pagesWalked} page(s)`);

  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
  const nowIso  = new Date().toISOString();

  // Build CharacterId → Name map for ParentId resolution. Names can repeat
  // across accounts in theory; we trust OpenDKP IDs for the lookup and only
  // use names downstream.
  const idToName = new Map();
  for (const c of chars) {
    if (c?.CharacterId && c?.Name) idToName.set(c.CharacterId, c.Name);
  }

  // Officer family-link overrides (/admin/links). OpenDKP parentage is
  // routinely incomplete — rank "Raid Alt" with ParentId 0 (Adiwen) splits
  // one human into two families. When main_name_override is set, it wins
  // over the ParentId resolution so the officer's fix survives every sync.
  const overrideByName = new Map();
  try {
    const ov = await supabase.select('characters',
      `select=name,main_name_override&guild_id=eq.${encodeURIComponent(guildId)}&main_name_override=not.is.null`);
    for (const r of Array.isArray(ov) ? ov : []) {
      if (r?.name && r?.main_name_override) overrideByName.set(String(r.name).toLowerCase(), r.main_name_override);
    }
  } catch { /* overrides unavailable — fall back to OpenDKP parentage */ }

  // Keep Deleted=true characters in the upsert. OpenDKP keeps historical
  // loot pointing at deleted CharacterIds; dropping them here used to make
  // 45% of auction winner_character_ids unresolvable, which made the loot
  // leaderboard fall through to raw bidder strings. The deleted flag lets
  // live-roster views filter them back out (WHERE NOT deleted) while
  // preserving name resolution for historic awards.
  const rows = chars
    .filter(c => c && c.Name)
    .map(c => {
      const isRoot = c.ParentId === 0 || c.ParentId == null;
      const mainName = overrideByName.get(c.Name.toLowerCase())
        || (isRoot ? c.Name : (idToName.get(c.ParentId) || null));
      return {
        guild_id:   guildId,
        name:       c.Name,
        race:       c.Race  || null,
        class:      c.Class || null,
        rank:       c.Rank  || null,
        main_name:  mainName,
        opendkp_id: Number.isFinite(c.CharacterId) ? c.CharacterId : null,
        active:     c.Active === 1 || c.Active === true,
        deleted:    c.Deleted === 1 || c.Deleted === true,
        updated_at: nowIso,
      };
    });

  if (rows.length === 0) return { upserted: 0 };

  // Dedup by (guild_id, lower(name)) BEFORE upserting. OpenDKP rosters
  // frequently contain duplicate character names — the same toon registered
  // twice, a main + a stale dupe, etc. (the live roster shows "Fronzz" listed
  // twice). The upsert conflict target is (guild_id, name), so two rows with
  // the same name in ONE PostgREST batch trigger Postgres's "ON CONFLICT DO
  // UPDATE command cannot affect row a second time" error — which fails the
  // ENTIRE batch and silently drops up to 200 unrelated characters. THIS is
  // why Ashieron / Abrahms / Damyu / Ghalix never imported despite being
  // clearly present in OpenDKP: they happened to share a batch with a
  // duplicate-name pair. Collapse duplicates first, keeping the best row.
  const RANK_SCORE = {
    'Pack Leader': 6, 'Officer': 5, 'Raid Pack': 4,
    'Recruit': 3, 'Raid Alt': 2, 'Non-raid Alt': 1, 'Inactive': 0,
  };
  const _score = (r) =>
      (r.deleted ? -5000 : 0)
    + (r.active ? 1000 : 0)
    + (RANK_SCORE[r.rank] != null ? RANK_SCORE[r.rank] * 10 : 0)
    + (r.opendkp_id != null ? 1 : 0);
  const byName = new Map();   // lower(name) -> best row
  for (const r of rows) {
    const k = r.name.toLowerCase();
    const prev = byName.get(k);
    if (!prev || _score(r) > _score(prev)) byName.set(k, r);
  }
  const deduped = [...byName.values()];
  const droppedDupes = rows.length - deduped.length;
  if (droppedDupes > 0) {
    console.log(`[opendkp-sync] characters: collapsed ${droppedDupes} duplicate-name row(s) before upsert`);
  }

  // Batch in chunks so a huge guild roster doesn't single-shot a big PostgREST
  // payload. 200/batch is well under PostgREST's limit and matches our other
  // upsert helpers' implicit batching. supabase.upsert returns null (not a
  // throw) on failure — so on a null/failed batch, fall back to per-row
  // upserts so a single bad row can't silently drop the other ~199.
  const BATCH = 200;
  let upserted = 0;
  let failedRows = 0;
  for (let i = 0; i < deduped.length; i += BATCH) {
    const slice = deduped.slice(i, i + BATCH);
    const written = await supabase.upsert('characters', slice, 'guild_id,name');
    if (Array.isArray(written)) {
      upserted += written.length;
      continue;
    }
    // Batch failed — retry each row individually.
    console.warn(`[opendkp-sync] characters: batch ${i}-${i + slice.length} failed; retrying ${slice.length} row(s) individually`);
    for (const row of slice) {
      const one = await supabase.upsert('characters', [row], 'guild_id,name');
      if (Array.isArray(one)) upserted += one.length;
      else { failedRows++; console.warn(`[opendkp-sync] character "${row.name}" upsert failed`); }
    }
  }
  return { upserted, pages: pagesWalked, dropped_dupes: droppedDupes, failed_rows: failedRows };
}

module.exports = { runSync, syncRaidsList, syncRaidDetail, syncCharacters, syncAuctions, syncAudits, syncAdjustments };
