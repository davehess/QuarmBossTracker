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

// ── #138: dedup an upsert batch by its exact on_conflict key ──────────────────
// PostgREST/Postgres reject the ENTIRE upsert batch with SQLSTATE 21000 ("ON
// CONFLICT DO UPDATE command cannot affect row a second time") the moment two
// rows in one payload share the conflict-target key — so every row in that batch
// silently fails to mirror (verified live against zhtoekwakucbckvatfky). OpenDKP
// data produces such collisions on ~every sync: a bid history listing the same
// character at the same DKP value twice (re-clicks / tie recordings), or the
// same item awarded to the same character for the same DKP twice in one raid's
// Items[]. This is why runner-up bid data was so sparse (#124) and why loot for
// affected raids never mirrored (#138). Collapse a batch to one row per conflict
// key BEFORE the upsert.
//
// `keyCols` MUST be the EXACT on_conflict columns. Set `nullsNotDistinct: true`
// for an index declared NULLS NOT DISTINCT (opendkp_loot_dedup_plain) so NULLs
// collapse together the way the DB's arbiter does; leave it false (default) for
// a plain unique index (opendkp_auction_bids_dedup), where a NULL in any key
// column makes the row un-collidable in Postgres and so it MUST be kept (never
// over-collapse a row the DB would have accepted). On a collision
// `preferNewer(candidate, incumbent)` picks the survivor (true → candidate
// wins); default keeps the first row seen. Pure + exported for tests. Returns
// { rows, dropped }.
function dedupByConflictKey(rows, keyCols, opts = {}) {
  const arr  = Array.isArray(rows) ? rows : [];
  const cols = Array.isArray(keyCols) ? keyCols : [keyCols];
  const preferNewer      = typeof opts.preferNewer === 'function' ? opts.preferNewer : null;
  const nullsNotDistinct = !!opts.nullsNotDistinct;
  const kept = new Map();
  let nullSeq = 0;
  for (const r of arr) {
    let hasNull = false;
    const parts = cols.map(c => {
      const v = r == null ? undefined : r[c];
      if (v === undefined || v === null) { hasNull = true; return '\u0000'; }
      return String(v);
    });
    const key = (hasNull && !nullsNotDistinct)
      ? '\u0000nulldistinct\u0000' + (nullSeq++)   // plain index: NULL ⇒ never collides
      : parts.join('\u0001');
    const cur = kept.get(key);
    if (cur === undefined) { kept.set(key, r); continue; }
    if (preferNewer && preferNewer(r, cur)) kept.set(key, r);
  }
  return { rows: [...kept.values()], dropped: arr.length - kept.size };
}

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
      raw:            b,   // see _bidRow — bid_at is NULL fleet-wide; keep the payload
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
    // Verbatim payload. bid_at is NULL on every row despite the matcher above
    // trying six names and the OpenDKP web UI showing a Date column — so the
    // API uses some other key. Ties are broken by who bid FIRST, so this is an
    // award-correctness gap, not cosmetics. Keeping the raw object makes the
    // next sync reveal the real field name; the fix is then one _lootField entry.
    raw:            b,
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
      // Minimal-return: the auction upsert often batches more than 1000
      // rows on a full sync, and PostgREST caps the representation response
      // at max-rows (default 1000), which made the "upserted" count read
      // 1000 even when more rows were written (Hitya 2026-06-23: "12,797
      // actual auctions but the report said 1000"). All rows ARE written;
      // count from the input length.
      await supabase.upsert('opendkp_auctions', auctionRows, 'auction_id', { minimal: true });
      totalUpserted += auctionRows.length;
    }

    // Bid rows live inline in each auction's Bids[] — no detail call needed.
    // Flatten across all auctions on this page, upsert as one batch.
    const allBids = list.flatMap(a => {
      const auctionId = a?.AuctionId ?? a?.AuctionID ?? a?.Id;
      if (auctionId == null) return [];
      return _bidsFromAuction(auctionId, a);
    });
    if (allBids.length > 0) {
      // #138 — collapse rows sharing the (auction_id, character_name, value)
      // conflict key or PostgREST rejects the WHOLE batch (21000) and no bids
      // for this page mirror. The colliding pair carries the same `value` (it's
      // in the key), so keep the later bid_at.
      const { rows: bidRows, dropped } = dedupByConflictKey(
        allBids,
        ['auction_id', 'character_name', 'value'],
        { preferNewer: (a, b) => String(a.bid_at || '') > String(b.bid_at || '') },
      );
      if (dropped > 0) console.log(`[opendkp-sync] auction bids: collapsed ${dropped} duplicate-key row(s) before upsert (#138)`);
      // Same minimal-return rationale — bid payloads on a full sync exceed
      // the 1000-row response cap.
      await supabase.upsert(
        'opendkp_auction_bids',
        bidRows,
        'auction_id,character_name,value',
        { minimal: true },
      );
      bidsWritten += bidRows.length;
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
// How many recent raids the routine pass asks for, and how often we still take
// the whole list so an upstream EDIT to an older raid cannot hide forever.
function _raidsCount()          { return _envNum('OPENDKP_RAIDS_COUNT', 25); }
function _raidsFullEveryHours() { return _envNum('OPENDKP_RAIDS_FULL_HOURS', 24); }
let _lastRaidsFullAt = 0;
let _loggedRaidsShape = false;

// PURE so the decision can be tested as BEHAVIOUR rather than by grepping the
// source for the right words. The first version of this test asserted only
// that `_raidsFullEveryHours` appeared in the file, which stayed green when a
// mutation forced useCount=true and deleted the periodic heal entirely — a
// test that cannot fail is worse than no test, because it manufactures
// confidence.
function _raidsFetchMode(nowMs, lastFullAtMs, count, fullEveryHours) {
  const n = Number(count);
  // ⚠ DISABLED 2026-08-27, mid-raid. `?count=N` was added in 3.1.83 on the
  // assumption that it returns the NEWEST N raids. That assumption was never
  // verified and the evidence says it is wrong: the mirror's newest raid stayed
  // at #101101 (8-26) all through the 8-27 raid, while #101157 existed upstream
  // and the UNCOUNTED full fetch (once a day) was the only thing that ever
  // advanced it. An ordering assumption on a paginated endpoint is exactly the
  // mistake that cost us the audits walk — page 1 of /auctions is oldest-first,
  // proved by probe — and I made it again from a Postman doc that documents the
  // parameter but not its order.
  //
  // The raid mirror feeds attendance, ticks and loot attribution, so a silently
  // stale one is expensive. Full list every pass until `count`'s ordering is
  // PROVED against production, the same standard the audits fast path had to
  // meet. Re-enable with OPENDKP_RAIDS_COUNT once proved.
  const usable = false && Number.isInteger(n) && n > 0;
  const fullDue = (nowMs - (lastFullAtMs || 0)) >= fullEveryHours * 3600 * 1000;
  return { useCount: usable && !fullDue, count: usable ? n : null, fullDue };
}

async function syncRaidsList() {
  if (!supabase.isEnabled()) return { fetched: 0, upserted: 0, error: 'supabase disabled' };
  // Full list on a schedule, newest-N otherwise. A raid summary is append-only
  // in practice, so pulling all 412 every 30 minutes was ~90 KB a pass to
  // re-learn rows that had not moved.
  const count = _raidsCount();
  const { useCount } = _raidsFetchMode(Date.now(), _lastRaidsFullAt, count, _raidsFullEveryHours());
  let raids;
  try { raids = await getRaids(useCount ? { count } : {}); }
  catch (err) { return { fetched: 0, upserted: 0, error: err?.message || String(err) }; }
  if (!useCount) _lastRaidsFullAt = Date.now();

  // ⚠ /raids is NOT reliably a bare array. Measured 2026-08-28 03:05 UTC,
  // mid-raid: an uncounted call returned 11,469 bytes with ZERO errors and
  // `Array.isArray` false, which aborted the whole sync. Every sibling list
  // endpoint on this API wraps its rows ({ Results }, { Items }, { Raids }, or
  // a { TotalPages, CurrentPage, … } page object) — /auctions and /audits both
  // do, which is why _rowsFromListPayload exists. Accept the same shapes here
  // instead of assuming the one that happened to work.
  const raidList = Array.isArray(raids) ? raids
                 : Array.isArray(raids?.Results) ? raids.Results
                 : Array.isArray(raids?.Raids)   ? raids.Raids
                 : Array.isArray(raids?.Items)   ? raids.Items
                 : Array.isArray(raids?.data)    ? raids.data
                 : null;
  if (!raidList) {
    // Log the shape ONCE rather than guess at it a third time tonight — the
    // same probe pattern the audits walk uses. Two diagnoses were already wrong
    // for want of this line.
    if (!_loggedRaidsShape) {
      _loggedRaidsShape = true;
      const keys = Object.keys(raids || {}).filter(k => typeof raids[k] !== 'function');
      console.log('[opendkp-sync] raids unexpected shape — top-level keys:', keys.join(', '));
      try { console.log('[opendkp-sync] raids sample:', JSON.stringify(raids).slice(0, 600)); } catch { /* */ }
    }
    return { fetched: 0, upserted: 0, error: 'getRaids returned non-array' };
  }
  raids = raidList;

  const rows = raids.map(_raidSummaryRow).filter(Boolean);
  if (rows.length === 0) return { fetched: raids.length, upserted: 0 };

  // Minimal-return: same 1000-row PostgREST cap that hit the auctions upsert
  // (Hitya 2026-06-23). We're at 385 raids today but the count will grow,
  // and getting capped silently 18 months from now is exactly the failure
  // mode we just fixed elsewhere. Count from the input length.
  await supabase.upsert('opendkp_raids', rows, 'raid_id', { minimal: true });
  return {
    fetched:  raids.length,
    upserted: rows.length,
    scope:    useCount ? `newest ${count}` : 'full',
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
    // #138 — collapse rows sharing the (raid_id, game_item_id, character_name,
    // dkp) conflict key first. The arbiter PostgREST resolves for this
    // on_conflict is opendkp_loot_dedup_plain, which is NULLS NOT DISTINCT — so
    // a NULL game_item_id collapses too. Without this, one duplicate award pair
    // (same item→same char→same dkp twice in Items[]) 21000s the whole batch and
    // NO loot for this raid mirrors.
    const { rows: dedupLoot, dropped } = dedupByConflictKey(
      lootRows,
      ['raid_id', 'game_item_id', 'character_name', 'dkp'],
      { nullsNotDistinct: true, preferNewer: (a, b) => String(a.fetched_at || '') > String(b.fetched_at || '') },
    );
    if (dropped > 0) console.log(`[opendkp-sync] raid ${full.RaidId} loot: collapsed ${dropped} duplicate-key row(s) before upsert (#138)`);
    // Composite dedup index — pass the columns the index references. PostgREST
    // resolves on_conflict by column list; with our partial-coalesce index this
    // works because all referenced columns are present in the row.
    const w = await supabase.upsert(
      'opendkp_loot',
      dedupLoot,
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
// ── Off-raid sync cadence (Hitya, 2026-08-27: "cut down the number of calls as
// much as possible outside of raid times") ─────────────────────────────────
// The mirror sync runs every 30 minutes, around the clock, and it is now the
// bulk of what OpenDKP sees from us: over a recent 12h window, /auctions cost
// 26 calls / 11.9 MB, /characters 65 / 8.9 MB, /raids/{id} 245 / 1.5 MB — all
// of it maintenance, none of it urgent.
//
// The same argument that made the live DKP check raids-only applies here, and
// harder: DKP moves per TICK, raids are when ticks happen, and a raid is also
// the only time new raids, new auctions and new loot appear. Between raids the
// sync overwhelmingly re-learns that nothing changed.
//
// So: full cadence inside a raid window (and the hour before it, so the board
// is current when the pull starts), and once every few hours otherwise.
// Deliberately a SKIP rather than a re-scheduled timer — the interval stays a
// dumb 30-minute tick and this decides whether the pass is worth making, which
// is the same shape as _skipForIdleBackoff and needs no restart to re-arm.
//
// ⚠ The cost is latency on an OFF-RAID officer edit (a manual adjustment, a
// corrected tick): it lands in the mirror within OPENDKP_OFFRAID_SYNC_HOURS
// rather than 30 minutes. That is the same trade already accepted for the
// audits idle backoff, which caps at 6h. Bidding is unaffected — the loot panel
// reads _panelAuctions on demand, not this sync.
// ⚠ SLOTS, NOT AN ELAPSED INTERVAL, and the difference is load-bearing.
// `_lastSyncSlot` is process-local, and `main` takes 12-42 pushes a day. With a
// relative "has it been 3 hours" test, either every boot forces a sync (the
// redeploy amplification we just spent two days removing from the audits walk)
// or a cold process adopts the clock and a bot restarting more often than the
// interval NEVER syncs at all — starved indefinitely, silently, and it would
// look exactly like working. Anchoring to fixed clock blocks makes both
// impossible: a restart re-adopts the CURRENT block, and the next block still
// arrives on schedule no matter how many times we deploy.
let _lastSyncSlot = null;

function _offRaidSyncIntervalMs() {
  return _envNum('OPENDKP_OFFRAID_SYNC_HOURS', 3) * 3600 * 1000;
}

// Pure: should this scheduled pass actually run? `adopt` is the cold-process
// case — take the current block without spending a pass on it.
function _syncPassWanted({ nowMs, lastSlot, inRaid, offRaidIntervalMs }) {
  if (inRaid) return { run: true, reason: 'raid-window', adopt: null };
  const slot = Math.floor(nowMs / offRaidIntervalMs);
  if (lastSlot == null) return { run: false, reason: 'off-raid-cold', adopt: slot };
  if (slot > lastSlot)  return { run: true,  reason: 'off-raid-due',  adopt: null };
  return { run: false, reason: 'off-raid-throttled', adopt: null };
}

// The raid window, widened an hour EARLIER than _inRaidWindow so the board is
// already current when the pull starts. (_inRaidWindow itself is shared with
// the idle backoff and deliberately left alone.)
function _inSyncRaidWindow(now = new Date()) {
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  if (![0, 3, 4].includes(day)) return false;
  const h = et.getHours();
  return h >= 18 || h < 1;
}

async function runSync(opts = {}) {
  // ⚠ The manual path is NEVER throttled. /syncopendkp is an officer saying
  // "go now", usually BECAUSE something looks wrong or they just made an
  // off-raid adjustment — precisely the moment the off-raid throttle would
  // otherwise swallow the request and report success having done nothing.
  // `full` implies force too: nobody asks for a full sweep and means "maybe".
  if (!opts.force && !opts.full) {
    const ivl = _offRaidSyncIntervalMs();
    const d = _syncPassWanted({
      nowMs: Date.now(), lastSlot: _lastSyncSlot,
      inRaid: _inSyncRaidWindow(), offRaidIntervalMs: ivl,
    });
    if (d.adopt != null) _lastSyncSlot = d.adopt;
    if (!d.run) return { phase: 'skipped', skipped: d.reason };
    _lastSyncSlot = Math.floor(Date.now() / ivl);
  }

  // Characters first — uses bearer auth, works even when OPENDKP_CLIENT_ID
  // (the read-side base64 token) is missing. Independent of the raids flow
  // so a CLIENT_ID outage still keeps the roster fresh.
  const charResult = await syncCharacters().catch(err => ({ error: err?.message || String(err) }));

  // Raids list — uses _readHeaders → requires OPENDKP_CLIENT_ID. If this
  // fails we still surface the character sync result so the caller knows
  // SOMETHING worked.
  const listResult = await syncRaidsList();
  // ⚠ A raids failure used to RETURN HERE, killing the entire pass — audits,
  // adjustments, auctions, loot folding, tick detail, all of it. Seen live
  // 2026-08-28 mid-raid: one bad response shape on /raids took the whole
  // mirror offline and the only symptom was `phase: "list"` in a log line.
  // The raid list is one input among several; the rest do not depend on it
  // having succeeded, so they now run regardless and the error is reported
  // alongside their results rather than instead of them.
  if (listResult.error) {
    console.warn('[opendkp-sync] raids list failed, continuing with the rest:', listResult.error);
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

  // Audits + adjustments: the page walk is still full (~15 pages each — the
  // API has no "since" filter), but the WRITE is watermarked and DO NOTHING,
  // so a walk that finds nothing new costs zero row writes. See
  // _syncListEndpoint for why that mattered.
  // These are the canonical sources for officer-driven changes (rank moves,
  // main switches, manual DKP corrections) and feed the era timeline on the
  // character page.
  const auditsResult      = await syncAudits().catch(err =>
    ({ error: err?.message || String(err), upserted: 0, pages: 0 }));
  const adjustmentsResult = await syncAdjustments().catch(err =>
    ({ error: err?.message || String(err), upserted: 0, pages: 0 }));

  // Reconcile (#110): AFTER syncAudits so the audit trigger sees this cycle's
  // fresh "Raid Updated"/"Raid Deleted" rows. Scoped re-pull of recent raids'
  // loot + diff → removes ghosts left by upstream deletions/edits. Fail-open.
  const reconcileResult = await reconcileRecentLoot({ full: !!opts.full, dryRun: !!opts.dryRun }).catch(err =>
    ({ error: err?.message || String(err) }));

  // Fold newly-mirrored awards into loot_observations (#37). AFTER reconcile so
  // ghosts from upstream deletions are already gone — folding first would copy
  // a row that is about to be removed. Fail-open: the Loot tab's counts are a
  // nicety and must never be able to fail an OpenDKP sync.
  const lootFoldResult = await foldLootObservations({ dryRun: !!opts.dryRun }).catch(err =>
    ({ error: err?.message || String(err) }));

  return {
    phase: 'done',
    raids_fetched:     listResult.fetched,
    raids_upserted:    listResult.upserted,
    raids_error:       listResult.error || null,
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
    audits_offered:         auditsResult?.offered ?? 0,
    audits_full_sweep:      !!auditsResult?.full_sweep,
    audits_error:           auditsResult?.error || null,
    adjustments_upserted:   adjustmentsResult?.upserted ?? 0,
    adjustments_pages:      adjustmentsResult?.pages ?? 0,
    adjustments_offered:    adjustmentsResult?.offered ?? 0,
    adjustments_full_sweep: !!adjustmentsResult?.full_sweep,
    adjustments_error:      adjustmentsResult?.error || null,
    reconcile_scanned:  reconcileResult?.raids_scanned ?? 0,
    reconcile_removed:  reconcileResult?.loot_removed ?? 0,
    reconcile_upserted: reconcileResult?.loot_upserted ?? 0,
    reconcile_aborted:  reconcileResult?.aborted ?? false,
    reconcile_skipped:  reconcileResult?.skipped || null,
    reconcile_error:    reconcileResult?.error || null,
    loot_fold_raids:    lootFoldResult?.raids_folded ?? 0,
    loot_fold_rows:     lootFoldResult?.rows_written ?? 0,
    loot_fold_pending:  lootFoldResult?.raids_pending ?? 0,
    loot_fold_error:    lootFoldResult?.error || null,
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

// 'AuditId' → 'audit_id'. The mirror's PK column name is derived from the
// first id key, so the walk can read its watermark before it has any rows.
function _pkColFor(idKeys) {
  return idKeys[0].toLowerCase().replace(/id$/, '_id');
}

// Highest id already mirrored, or 0 if the table is empty / unreadable. A read
// failure returning 0 is the safe direction: every row is then "new" and gets
// offered, and DO NOTHING absorbs the ones we already had.
async function _maxMirroredId(table, pkCol) {
  try {
    const rows = await supabase.select(table, `select=${pkCol}&order=${pkCol}.desc&limit=1`);
    const top  = Array.isArray(rows) && rows[0] && Number(rows[0][pkCol]);
    return Number.isFinite(top) ? top : 0;
  } catch { return 0; }
}

// Full-offer cadence, per table. Process-local on purpose: it is an egress
// optimization, not correctness state, so losing it on redeploy is harmless —
// a redeploy just buys one extra (write-free) full offer.
const _lastFullSweepAt = new Map();

// ── Idle backoff (Hitya, 2026-08-26: "the dkp numbers don't change outside of
// raids unless we have to override something. why are we auditing so
// frequently") ──────────────────────────────────────────────────────────────
// Measured that day: the audits walk cost 17 calls / 6.2 MB EVERY 30 MINUTES,
// identically — 297 MB/day, essentially all of it spent discovering that
// nothing had happened. The endpoint has no "since" filter and (per the
// ordering probe below) does not appear to page newest-first, so there is no
// cheap way to ASK whether anything changed. The answer is therefore to ask
// less often when the answer keeps being no.
//
// Doubling backoff per consecutive empty pass, from the natural 30-min cadence
// to a cap. Any new row resets it instantly, and a raid window pins it back to
// every pass — which is exactly the shape of the real world: DKP moves during
// raids and during the occasional manual override, and is static in between.
// An override made at 3pm on a Tuesday is picked up within the cap rather than
// within 30 minutes, which is the deliberate trade.
const _idleStreak = new Map();
const _nextDueAt  = new Map();

// ── Oldest-first fast path ──────────────────────────────────────────────────
// PROVED on 2026-08-26, not assumed. The ordering probe logged:
//
//   audits: page1 ids 1669729..1968002 vs watermark 4627656 — NOT newest-first
//
// Page 1 holds the OLDEST audits by 2.7 million ids, so a forward walk from
// page 1 can never reach a new row — it just re-reads 17 pages and offers zero
// (`audits_pages: 17, audits_offered: 0`, every single pass, 6.2 MB a time).
//
// New rows land at the END. So: go straight to the LAST page. If nothing there
// is above the watermark, we are done in ONE call instead of seventeen. Only
// when the last page DOES hold something new do we fall back to the full walk,
// which at ~37 audits/day is once or twice a day rather than 48 times.
//
// `TotalPages` is learned from any response and cached per table; a page count
// only changes when a page fills (~2,800 rows, i.e. every couple of months), so
// the hint is stable and a stale one self-corrects on the next response.
const _lastPageHint = new Map();

// OpenDKP wraps list payloads inside { TotalPages, CurrentPage, <KEY> } where
// <KEY> varies per endpoint — BidResults (auctions), Audits, Adjustments,
// Items, Results — and in some cases the response IS a bare array. Extracted
// into one place so the fast path below and the full walk can never disagree
// about what counts as "the rows"; duplicating this list is how one of them
// silently starts seeing nothing.
// Map a raw payload list into mirror rows. Shared by the walk and the fast
// path so the two can never disagree about row shape.
function _mapListRows(list, pkCol, idKeys, tsKeys) {
  return (list || []).map(row => {
    const id = _firstNumber(row, ...idKeys);
    if (id == null) return null;
    const tsRaw = _firstString(row, ...tsKeys);
    return {
      [pkCol]:    id,
      ts:         tsRaw ? new Date(tsRaw).toISOString() : null,
      raw:        row,
      fetched_at: new Date().toISOString(),
    };
  }).filter(Boolean);
}

function _rowsFromListPayload(arr, label) {
  const capLabel = label ? label.charAt(0).toUpperCase() + label.slice(1) : null;
  return Array.isArray(arr?.BidResults)  ? arr.BidResults
       : Array.isArray(arr?.Audits)      ? arr.Audits
       : Array.isArray(arr?.Adjustments) ? arr.Adjustments
       : (capLabel && Array.isArray(arr?.[capLabel])) ? arr[capLabel]
       : Array.isArray(arr?.Results)     ? arr.Results
       : Array.isArray(arr?.Items)       ? arr.Items
       : Array.isArray(arr)              ? arr
       : Array.isArray(arr?.data)        ? arr.data
       : null;
}

// Raid nights: Sun/Wed/Thu 8pm-midnight ET, with an hour either side so a late
// start or a long night is never the thing that delays a sync.
function _inRaidWindow(now = new Date()) {
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();                       // 0 Sun, 3 Wed, 4 Thu
  if (![0, 3, 4].includes(day)) return false;
  const h = et.getHours();
  return h >= 19 || h < 1;
}

function _backoffCapMs() { return _envNum('OPENDKP_LIST_IDLE_MAX_HOURS', 6) * 3600 * 1000; }

// Returns true when the walk should be skipped entirely — no HTTP at all.
function _skipForIdleBackoff(table) {
  if (_envNum('OPENDKP_LIST_IDLE_BACKOFF', 1) < 1) return false;
  if (_inRaidWindow()) return false;
  const due = _nextDueAt.get(table);
  return Number.isFinite(due) && Date.now() < due;
}

function _noteIdleResult(table, freshCount) {
  if (freshCount > 0) { _idleStreak.set(table, 0); _nextDueAt.delete(table); return; }
  const streak = (_idleStreak.get(table) || 0) + 1;
  _idleStreak.set(table, streak);
  // 30min base, doubling: 30m, 1h, 2h, 4h, capped.
  const wait = Math.min(30 * 60 * 1000 * Math.pow(2, streak - 1), _backoffCapMs());
  _nextDueAt.set(table, Date.now() + wait);
}
// ── Full sweep cadence: anchored to the raid calendar, not a rolling clock ──
// Hitya, 2026-08-27, twice. First: "we don't need a full download that often,
// just before a raid. three times a week." Then, an hour later:
// "let's make the full audit once per week then until we have the new version
// that has the since tag."
//
// The full sweep is the healing pass — it re-offers EVERY row, so a gap below
// the watermark (a partial run, an upstream out-of-order insert) closes. It is
// also the single most expensive thing we ask OpenDKP for: 17 pages / 6.2 MB on
// audits. A 24h rolling timer fired it at whatever time of day the process
// happened to boot, which on 2026-08-26 meant mid-raid.
//
// It now runs ONCE A WEEK, at 6pm ET on Sunday — two hours ahead of the first
// pull of the raid week, clear of the 19:30 deploy freeze. That is deliberately
// slacker than the healing pass wants: a gap can now wait a full 7 days. It is
// **temporary, and tied to the API request** — if OpenDKP gains a `since` /
// `afterId` parameter, the full pull stops costing anything and this goes back
// to being frequent (or unnecessary). Until then we are buying his bandwidth
// with our staleness, which is the right way round.
//
// ⚠ The days are a LIST because the cadence is a policy, not a constant:
// `OPENDKP_LIST_FULL_SWEEP_DAYS=0,3,4` restores the three raid nights without a
// deploy, which is the first thing to do if a gap ever shows up.
const _SWEEP_ANCHOR_DAYS_DEFAULT = [0];      // Sunday — one full pull a week

function _sweepAnchorDays() {
  return _parseSweepDays(process.env.OPENDKP_LIST_FULL_SWEEP_DAYS);
}
// Pure, so a malformed env value is testable. Anything unparseable falls back
// to the default rather than to an empty list — an empty list would mean the
// healing pass never runs again, and would look exactly like it working.
function _parseSweepDays(raw) {
  // ⚠ Empty segments must be dropped BEFORE Number(): `Number('')` is 0, not
  // NaN, so an unset env used to arrive at the filter as a valid "Sunday" and
  // the fallback below was unreachable. It happened to agree with the default,
  // which is exactly why it would have survived unnoticed until the default
  // changed.
  const days = String(raw ?? '').split(',')
    .map(x => String(x).trim())
    .filter(x => x !== '')
    .map(Number)
    .filter(n => Number.isInteger(n) && n >= 0 && n <= 6);
  return days.length ? [...new Set(days)] : _SWEEP_ANCHOR_DAYS_DEFAULT;
}

function _sweepAnchorHourEt() {
  const h = _envNum('OPENDKP_LIST_FULL_SWEEP_HOUR_ET', 18);
  return (Number.isFinite(h) && h >= 0 && h <= 23) ? Math.floor(h) : 18;
}
// Safety net ONLY — it must sit ABOVE the widest gap the anchors can produce,
// or it becomes the schedule. At one anchor a week that gap is 168h, so 240h
// (10 days). ⚠ This moves whenever the anchor days do: left at the 96h that
// suited three-a-week, it would have fired every fourth day and quietly
// reinstated the cadence we just removed.
function _sweepMaxAgeMs() {
  return _envNum('OPENDKP_LIST_FULL_SWEEP_MAX_HOURS', 240) * 3600 * 1000;
}

// Epoch ms of the most recent pre-raid anchor at or before `nowMs`. Pure, so
// the tests can drive it across a whole week without waiting for one.
// ET comes from toLocaleString, the same trick _inRaidWindow uses: the returned
// Date carries ET wall-clock in its LOCAL fields, and its distance from the real
// instant is the offset that converts a wall time back to an epoch. A DST
// changeover can leave that offset an hour out for a day; an hour of slop on a
// 6pm anchor changes nothing.
function _lastSweepAnchor(nowMs = Date.now(), hourEt = _sweepAnchorHourEt(), days = _sweepAnchorDays()) {
  const et = new Date(new Date(nowMs).toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const offsetMs = et.getTime() - nowMs;
  for (let back = 0; back < 8; back++) {
    const d = new Date(et.getTime());
    d.setDate(d.getDate() - back);
    if (!days.includes(d.getDay())) continue;
    d.setHours(hourEt, 0, 0, 0);
    const epoch = d.getTime() - offsetMs;
    if (epoch <= nowMs) return epoch;
  }
  return nowMs;                              // unreachable: 8 days covers every case
}

// Pure decision, split out so it can be tested without a clock or a Map.
// `adopt` is the cold-process case: do NOT sweep just because we lost the
// timestamp on a redeploy — main takes 12–42 pushes a day, and a per-boot full
// sweep is precisely the thing that kept the audits bill up. Adopt the current
// anchor instead; the next real anchor still fires, at most a week out.
function _sweepDecision(lastMs, nowMs, anchorMs, maxAgeMs) {
  if (lastMs == null)                  return { due: false, adopt: anchorMs };
  if ((nowMs - lastMs) >= maxAgeMs)    return { due: true,  adopt: null };
  return { due: lastMs < anchorMs, adopt: null };
}

function _dueForFullSweep(table, nowMs = Date.now()) {
  const d = _sweepDecision(
    _lastFullSweepAt.has(table) ? _lastFullSweepAt.get(table) : null,
    nowMs, _lastSweepAnchor(nowMs), _sweepMaxAgeMs(),
  );
  if (d.adopt != null) _lastFullSweepAt.set(table, d.adopt);
  return d.due;
}
function _markFullSweep(table) {
  _lastFullSweepAt.set(table, Date.now());
}

// Walk a paginated list endpoint and mirror raw rows into the given table.
// Used for both /audits and /adjustments since we don't yet know the exact
// field shape — we store the full payload as JSONB and surface an ID +
// timestamp for indexing. Both endpoints are append-only, which is what lets
// the write path be insert-only; see the DO NOTHING note below.
async function _syncListEndpoint({
  label, fetchPage, table, idKeys, tsKeys, shapeFlag,
}) {
  if (!supabase.isEnabled()) return { error: 'supabase disabled', upserted: 0, pages: 0 };

  const pkCol = _pkColFor(idKeys);

  // Cheapest possible pass: no HTTP at all while the answer keeps being "no".
  if (_skipForIdleBackoff(table)) {
    return { upserted: 0, pages: 0, offered: 0, full_sweep: false, skipped: 'idle-backoff' };
  }

  // Highest id we already hold. Everything at or below it is already mirrored
  // and — because these endpoints are append-only — can never have changed, so
  // it does not need to be sent again. One row read, not a 47k-row scan.
  const priorMax = await _maxMirroredId(table, pkCol);

  // Periodic full offer so a gap below priorMax (a partial run, an upstream
  // out-of-order insert) still heals. Costs nothing to be wrong about: the
  // write path is DO NOTHING, so re-offering a known row is an index probe.
  // Read the marker BEFORE _dueForFullSweep, which mutates it on the cold path.
  const _priorMarker = _lastFullSweepAt.has(table) ? _lastFullSweepAt.get(table) : null;
  const fullSweep = _dueForFullSweep(table);
  if (fullSweep) {
    // ⚠ UNEXPLAINED SWEEP, 2026-08-27 04:02 UTC (00:02 ET). A warm process —
    // no restart in the logs — swept both audits and adjustments one pass after
    // ET midnight. Replaying the shipped decision offline against that exact
    // timestamp returns false, under this version's anchors AND the previous
    // one's. So the model and production disagree and we do not yet know how.
    // This line is the instrument: it prints every input the decision took, so
    // the next occurrence is diagnosable from one log line instead of another
    // evening of inference. Do not remove it until a sweep has been seen to
    // fire on the right day for the right reason.
    console.log(`[opendkp-sync] ${label}: FULL SWEEP —`
      + ` marker=${_priorMarker == null ? 'none (cold)' : new Date(_priorMarker).toISOString()}`
      + ` anchor=${new Date(_lastSweepAnchor()).toISOString()}`
      + ` days=[${_sweepAnchorDays()}] hourEt=${_sweepAnchorHourEt()}`
      + ` maxAgeH=${_sweepMaxAgeMs() / 3600000} now=${new Date().toISOString()}`);
  }

  let pagesWalked   = 0;
  let totalUpserted = 0;
  let totalOffered  = 0;
  let newestFirstProven = false;   // set from page 1; gates the early break
  let jumpedToLast      = false;   // set when page 1 proves oldest-first
  let lastPageDone      = 0;       // the page the jump already processed

  // Oldest-first fast path: check the LAST page and stop if it holds nothing
  // new. Skipped on a full sweep (which must genuinely walk everything) and on
  // a cold process (no hint yet — the first walk after a deploy learns it).
  const hintPage = Number(_lastPageHint.get(table));
  if (!fullSweep && Number.isFinite(hintPage) && hintPage > 1) {
    try {
      let arr = await fetchPage(hintPage);
      let seen = 1;
      // The count can have grown since we cached it; go to the real last page.
      const total = Number(arr?.TotalPages);
      if (Number.isFinite(total) && total > hintPage) {
        _lastPageHint.set(table, total);
        arr = await fetchPage(total);
        seen = 2;
      } else if (Number.isFinite(total)) {
        _lastPageHint.set(table, total);
      }
      const list = _rowsFromListPayload(arr, label);
      // Unknown shape → no rows → would read as "nothing new", which is WRONG.
      // Fall through to the walk, which reports the shape properly.
      if (!list) throw new Error('unknown shape on fast path');
      const rows = _mapListRows(list, pkCol, idKeys, tsKeys);
      const fresh = rows.filter(r => Number(r[pkCol]) > priorMax);

      // ⚠ THE CASE THAT COST US A RAID NIGHT (2026-08-26). v1 fell through to
      // the full 17-page walk whenever the last page held anything new — and
      // during a raid EVERY pass holds something new, because loot awards and
      // ticks generate audits. So the "fast" path was fast only while idle and
      // reverted to 6.2 MB a pass exactly when raiding. Measured: 1 call /
      // 438 bytes at 22:43 and 23:13, then 18 calls / 6.2 MB every pass from
      // 23:43 once the raid started.
      //
      // Oldest-first means new rows APPEND to the end, so the last page already
      // contains them — there is nothing to go back for unless the page has
      // JUST rolled over, which shows up as every row on it being fresh.
      if (fresh.length === 0 || fresh.length < rows.length) {
        if (fresh.length > 0) await supabase.insertIgnoreDuplicates(table, fresh);
        _noteIdleResult(table, fresh.length);
        return {
          upserted: fresh.length, pages: seen, offered: fresh.length,
          full_sweep: false, fast_path: 'last-page',
        };
      }
      // Every row on the last page is new → the boundary is on an earlier page
      // (a page rollover, roughly every couple of months at ~37 audits/day).
      // Fall through to the full walk, which knows how to page back.
    } catch { /* fast path is an optimization; any failure just walks normally */ }
  }

  for (let page = 1; page <= AUDIT_PAGE_LIMIT; page++) {
    // The rollback below resumes the walk at page 2, but the jump has already
    // fetched and written the last page — don't pay for it a second time (and
    // don't double-count its rows in `upserted`).
    if (lastPageDone && page >= lastPageDone) break;

    let arr;
    try { arr = await fetchPage(page); }
    catch (err) { return { error: err?.message || String(err), upserted: totalUpserted, pages: pagesWalked }; }

    // OpenDKP wraps list payloads inside { TotalPages, CurrentPage, <KEY> }
    // where <KEY> varies per endpoint: BidResults (auctions), Audits, Adjustments,
    // Items, Results — and in some cases the response IS a bare array. We accept
    // all of those, plus a capitalized form derived from the endpoint label
    // ("audits" → "Audits") as the primary fallback.
    const list = _rowsFromListPayload(arr, label);
    // Capture the page count HERE, before any of the breaks below — putting it
    // at the end of the loop meant the early break skipped it and the fast path
    // never got a hint to work from.
    if (Number.isFinite(Number(arr?.TotalPages))) _lastPageHint.set(table, Number(arr.TotalPages));

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
        [pkCol]:    id,
        ts:         tsRaw ? new Date(tsRaw).toISOString() : null,
        raw:        row,
        fetched_at: new Date().toISOString(),
      };
    }).filter(Boolean);

    // Rows above the watermark are the only ones that can be new. On a full
    // sweep we still offer the rest (DO NOTHING absorbs them) but they are
    // never counted as written — `upserted` stays an honest "new rows" number.
    const freshRows = rows.filter(r => Number(r[pkCol]) > priorMax);
    const toSend    = fullSweep ? rows : freshRows;

    // Early break (2026-08-25, the Moncs incident): these endpoints have no
    // "since" filter, so this walk made OpenDKP re-serialise its ENTIRE audit
    // table (~15 pages, 48k rows) every 30 minutes for three months. The pages
    // are newest-first, so once a page yields nothing above our watermark,
    // every later page is older still — stop asking for them. The ordering is
    // PROVEN per run, not assumed: page 1's max id must be >= our watermark
    // (oldest-first paging would put the SMALLEST ids on page 1 and fail this
    // test, and the walk then continues exactly as before). The 24h fullSweep
    // still walks everything, so a gap below the watermark still heals.
    if (page === 1 && rows.length > 0) {
      const pageMax = Math.max(...rows.map(r => Number(r[pkCol])));
      newestFirstProven = Number.isFinite(priorMax) && pageMax >= priorMax;
      // ⚠ ORDERING PROBE. The early break assumed newest-first (inferred from
      // the auctions endpoint's "page 1 = most recent" note). The 2026-08-26
      // measurement says otherwise for audits: a full 17-page walk every pass,
      // which is what this guard does when it CANNOT prove the ordering. Log it
      // once per pass so the next session can read the truth off Railway
      // instead of inferring it from a sibling endpoint again.
      if (!newestFirstProven) {
        const pageMin = Math.min(...rows.map(r => Number(r[pkCol])));
        console.log(`[opendkp-sync] ${label}: page1 ids ${pageMin}..${pageMax} vs watermark ${priorMax}`
          + ` — NOT newest-first, walking all pages (this is the expensive path)`);
      }
    }

    if (toSend.length > 0) {
      totalOffered += toSend.length;
      // ON CONFLICT DO NOTHING, not merge-duplicates. These endpoints are
      // append-only audit logs — a row that exists upstream never changes —
      // but `fetched_at` above is regenerated every run, so a merge-duplicates
      // upsert rewrote EVERY row on EVERY one of the 48 daily runs. That cost
      // 141M updates against 47k inserts on opendkp_audits (~2,986 rewrites
      // per row) and 3,170 autovacuum cycles, versus 36 on chat_messages —
      // the OpenDKP mirror was monopolizing the shared autovacuum workers and
      // the WAL that the durable ingest streams depend on. DO NOTHING leaves
      // existing tuples untouched: no rewrite, no dead tuple, no vacuum debt.
      // No result check: with `return=minimal` a success body is empty, which
      // _request parses to null — the same value it returns on error. Nothing
      // to branch on. supabase._request already logs failures, and this module
      // is fail-open by contract (see the file header).
      await supabase.insertIgnoreDuplicates(table, toSend);
    }
    totalUpserted += freshRows.length;

    // ── Cold-start jump (2026-08-27) ────────────────────────────────
    // The fast path above needs a cached page count and a fresh process has
    // none — so every redeploy walked all 17 pages to re-learn what page 1 had
    // just told it: the ids run OLDEST-first, so nothing between here and the
    // end can sit above our watermark. Measured the night this shipped — three
    // deploys inside ten minutes, 17 calls / 6.2 MB apiece — that per-boot walk,
    // not the periodic sweep, was most of what remained of the audits bill.
    // Page 1 has just proven the ordering, so jump to the last page: two calls.
    const totalPages = Number(arr?.TotalPages);
    if (!fullSweep && !jumpedToLast && page === 1 && !newestFirstProven
        && Number.isFinite(totalPages) && totalPages > 2) {
      jumpedToLast = true;
      page = totalPages - 1;          // the loop's page++ lands us on the last one
      continue;
    }

    // The last page came back ENTIRELY new, so the boundary sits on an earlier
    // page (a rollover — every couple of months at ~37 audits/day). Hand the
    // saved calls back and walk the middle: a silent gap is the worse outcome.
    if (jumpedToLast && rows.length > 0 && freshRows.length === rows.length) {
      jumpedToLast = false;
      lastPageDone = page;
      page = 1;                       // … and page++ resumes the walk at page 2
      continue;
    }

    // Nothing on this page was new and newer-first paging is proven for this
    // run → every remaining page is older than what we hold. Done.
    if (!fullSweep && newestFirstProven && freshRows.length === 0) break;

    if (arr?.TotalPages && arr?.CurrentPage && arr.CurrentPage >= arr.TotalPages) break;
  }

  if (fullSweep) _markFullSweep(table);
  _noteIdleResult(table, totalUpserted);

  return {
    upserted:   totalUpserted,
    pages:      pagesWalked,
    offered:    totalOffered,
    full_sweep: fullSweep,
  };
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

// ── Mirror reconciliation (#110) ──────────────────────────────────────────────
// OpenDKP is the source of truth; opendkp_loot is a PURE mirror sourced from
// each raid's Items[]. syncRaidDetail only UPSERTS, and _raidNeedsDetail stops
// re-fetching a raid once its ticks are populated — so a loot row DELETED or
// EDITED in OpenDKP after that point lingers forever as a ghost (the 2026-07-19
// "Backpack" incident: 3 test awards deleted upstream but still showing on
// wolfpack.quest's parses/loot surfaces).
//
// The audit trail can't fix this precisely. opendkp_audits.raw carries only
// { AuditId, CognitoUser, ClientId, Timestamp, Action } — Action is a bare label
// ("Raid Updated", "Raid Deleted", …) with NO entity ids and NO per-item "Loot
// Deleted" event (verified against 46k live rows: a loot removal shows up only
// as a raid-level "Raid Updated"). So we CANNOT map an audit entry to the loot
// row(s) it changed.
//
// Path shipped = BOTH, each in the role its data can actually fill: the audit
// feed is the TRIGGER (a new "Raid Updated"/"Raid Deleted" since our watermark
// means some raid's loot may have changed) + the WATERMARK; the precise removal
// is the guild-lead-blessed SCOPED RECONCILE — re-pull ONLY recent raids' loot
// and diff against the mirror, deleting rows present locally but absent
// upstream. Never a full won-items re-pull.
//
// Safety: a reconcile only ever deletes for a raid whose upstream detail fetched
// cleanly (valid RaidId), and the whole pass ABORTS its deletes if the removal
// set is implausibly large (guards an upstream glitch that returns empty Items[]
// for many raids at once). It fails SAFE — keeping data over guessing.

const RECONCILE_KV_KEY = 'opendkp_reconcile';

function _envNum(name, dflt) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

// Map an OpenDKP audit Action string → the mirror it can invalidate. Loot lives
// in opendkp_loot, sourced from a raid's Items[]; the only Actions that can
// remove/alter mirrored loot are a raid edit ("Raid Updated") or a full "Raid
// Deleted". Everything else (auction lifecycle, bids, character/association,
// dkp-admin, adjustments) either has its own sync path or can't orphan loot.
// The returned category is a coarse SIGNAL only — the audit carries no ids, so
// it can't point at a specific row. Pure + exported for tests.
function classifyAuditAction(action) {
  const a = String(action == null ? '' : action).trim();
  if (a === 'Raid Updated' || a === 'Raid Deleted') return 'loot';
  if (a === 'Adjustment Deleted' || a === 'Adjustment Updated') return 'adjustment';
  return 'ignore';
}

// Dedup key matching the opendkp_loot_dedup_plain unique index
// (raid_id, game_item_id, character_name, dkp) NULLS NOT DISTINCT — a NULL
// game_item_id collapses to a stable empty token, exactly like the index does.
function _lootKey(r) {
  const gid = (r.game_item_id === null || r.game_item_id === undefined) ? '' : r.game_item_id;
  return `${r.raid_id}|${gid}|${r.character_name}|${r.dkp}`;
}

// Ghost set = local rows whose key is absent from the upstream set. An EDIT
// (winner/dkp/item changed) changes the key, so it surfaces here as (stale row
// removed) + (fresh row upserted from upstream) — the net effect is the edit
// propagating. Pure + exported for tests.
function lootDiffRemovals(localRows, upstreamRows) {
  const up = new Set((Array.isArray(upstreamRows) ? upstreamRows : []).map(_lootKey));
  return (Array.isArray(localRows) ? localRows : []).filter(r => !up.has(_lootKey(r)));
}

// Map a getRaid() detail payload to its loot rows, reusing the same _lootRow
// mapping the sync upsert uses. Returns null when the payload isn't a valid
// raid object (malformed/partial fetch) — the caller MUST skip reconciling that
// raid so a bad fetch can never be misread as "all loot deleted".
function _extractLootRows(full) {
  if (!full || !full.RaidId) return null;
  let itemsArray = [];
  for (const key of ['Items', 'items', 'Loot', 'loot', 'Awards', 'awards', 'RaidItems']) {
    if (Array.isArray(full[key])) { itemsArray = full[key]; break; }
  }
  return itemsArray.map(i => _lootRow(full.RaidId, i)).filter(Boolean);
}

async function _readReconcileWm(db) {
  try {
    const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
    const rows = await db.select('bot_kv',
      `guild_id=eq.${encodeURIComponent(guildId)}&key=eq.${RECONCILE_KV_KEY}&select=value&limit=1`);
    const v = Array.isArray(rows) && rows[0] && rows[0].value;
    if (v && typeof v === 'object') return v;
  } catch { /* fall through to empty watermark */ }
  return {};
}
async function _writeReconcileWm(db, value) {
  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
  await db.upsert('bot_kv',
    [{ guild_id: guildId, key: RECONCILE_KV_KEY, value, updated_at: new Date().toISOString() }],
    'guild_id,key');
}

// Scoped mirror reconcile. See the block header. Idempotent (re-running with no
// upstream change removes nothing and leaves the watermark put), watermarked
// (last-seen audit_id in bot_kv), logged (one line per applied removal). Deps
// (db, fetchRaid, log, now) are injectable for tests; defaults are the real
// Supabase + OpenDKP clients.
async function reconcileRecentLoot(opts = {}) {
  const db        = opts.db || supabase;
  const fetchRaid = opts.fetchRaid || getRaid;
  const log       = opts.log || ((m) => console.log(m));
  const now       = opts.now || Date.now();
  const full      = !!opts.full;
  const dryRun    = !!opts.dryRun;

  if (process.env.OPENDKP_RECONCILE_DISABLE === '1') return { skipped: 'disabled' };
  if (!db.isEnabled || !db.isEnabled()) return { skipped: 'supabase disabled' };

  const windowDays      = opts.windowDays      != null ? opts.windowDays      : _envNum('OPENDKP_RECONCILE_WINDOW_DAYS', 14);
  const floorHours      = opts.floorHours      != null ? opts.floorHours      : _envNum('OPENDKP_RECONCILE_FLOOR_HOURS', 6);
  const maxRemovalPct   = opts.maxRemovalPct   != null ? opts.maxRemovalPct   : (Number(process.env.OPENDKP_RECONCILE_MAX_REMOVAL_PCT) || 0.25);
  const maxRemovalFloor = opts.maxRemovalFloor != null ? opts.maxRemovalFloor : _envNum('OPENDKP_RECONCILE_MAX_REMOVAL_FLOOR', 20);

  // 1. Watermark + audit trigger. Read new audits since our last-seen id; a
  //    loot-signal audit means a raid's loot MAY have changed.
  const wm = await _readReconcileWm(db);
  const lastAuditId     = Number(wm.lastAuditId) || 0;
  const lastReconcileAt = Number(wm.lastReconcileAt) || 0;

  let newAudits = [];
  try {
    newAudits = await db.select('opendkp_audits',
      `audit_id=gt.${lastAuditId}&select=audit_id,raw&order=audit_id.desc&limit=200`) || [];
  } catch { newAudits = []; }
  const lootSignals   = newAudits.filter(a => classifyAuditAction(a && a.raw && a.raw.Action) === 'loot');
  const newMaxAuditId = newAudits.reduce((m, a) => Math.max(m, Number(a.audit_id) || 0), lastAuditId);

  const floorElapsed = (now - lastReconcileAt) >= floorHours * 3600 * 1000;
  const warranted    = full || lootSignals.length > 0 || floorElapsed;

  if (!warranted) {
    // Nothing loot-relevant since last pass and the periodic floor hasn't
    // elapsed — advance the watermark past the ignorable audits and stop.
    if (!dryRun && newMaxAuditId > lastAuditId) {
      await _writeReconcileWm(db, { lastAuditId: newMaxAuditId, lastReconcileAt, lastRemoved: wm.lastRemoved || 0 });
    }
    return { skipped: 'not warranted', last_audit_id: newMaxAuditId, audit_signals: 0 };
  }

  if (lootSignals.length > 0) {
    const s = lootSignals[0].raw || {};
    log(`[opendkp-reconcile] pass warranted by ${lootSignals.length} loot-signal audit(s) since #${lastAuditId} (latest: "${s.Action}" by ${s.CognitoUser} @ ${s.Timestamp})`);
  } else {
    log(`[opendkp-reconcile] periodic pass (floor ${floorHours}h elapsed, no new loot-signal audits)`);
  }

  // 2. Scope: recent raids by date (or every raid on a full reconcile).
  const sinceIso = new Date(now - windowDays * 86400000).toISOString();
  const scopeQuery = full
    ? 'select=raid_id,name,ts&order=ts.desc'
    : `ts=gte.${encodeURIComponent(sinceIso)}&select=raid_id,name,ts&order=ts.desc`;
  let raids = [];
  try { raids = await db.select('opendkp_raids', scopeQuery) || []; } catch { raids = []; }

  let raidsScanned = 0, raidsSkipped = 0, upserted = 0, scannedLoot = 0;
  const removals = [];   // { id, raid_id, raid_name, item_name, character_name, dkp }

  for (const raid of raids) {
    const raidId = raid.raid_id;
    let detail;
    try { detail = await fetchRaid(raidId); }
    catch (err) { raidsSkipped++; console.warn(`[opendkp-reconcile] raid ${raidId}: fetch failed (${err && err.message}) — skipped`); continue; }

    const upstream = _extractLootRows(detail);
    if (upstream === null) { raidsSkipped++; console.warn(`[opendkp-reconcile] raid ${raidId}: invalid detail payload — skipped (no delete)`); continue; }
    raidsScanned++;

    // Propagate edits/additions first — upsert is always safe (it only writes
    // upstream-confirmed rows). Deletes are computed against the mirror after.
    // #138 — dedup by the loot conflict key before upserting (same NULLS NOT
    // DISTINCT arbiter as syncRaidDetail) so a duplicate award pair can't 21000
    // the batch. The diff below still runs against the full `upstream` set (it
    // builds a Set, so dupes are harmless there).
    if (upstream.length > 0 && !dryRun) {
      const { rows: dedupUp, dropped } = dedupByConflictKey(
        upstream,
        ['raid_id', 'game_item_id', 'character_name', 'dkp'],
        { nullsNotDistinct: true, preferNewer: (a, b) => String(a.fetched_at || '') > String(b.fetched_at || '') },
      );
      if (dropped > 0) log(`[opendkp-reconcile] raid ${raidId} loot: collapsed ${dropped} duplicate-key row(s) before upsert (#138)`);
      await db.upsert('opendkp_loot', dedupUp, 'raid_id,game_item_id,character_name,dkp', { minimal: true });
      upserted += dedupUp.length;
    }

    let local = [];
    try {
      local = await db.select('opendkp_loot',
        `raid_id=eq.${raidId}&select=id,raid_id,game_item_id,item_id,item_name,character_name,dkp`) || [];
    } catch { local = []; }
    scannedLoot += local.length;

    for (const r of lootDiffRemovals(local, upstream)) {
      removals.push({ id: r.id, raid_id: raidId, raid_name: raid.name, item_name: r.item_name, character_name: r.character_name, dkp: r.dkp });
    }
  }

  // 3. Safety fuse: an implausibly large removal set means an upstream anomaly
  //    (e.g. empty Items[] returned for many raids), not a real mass cleanup.
  //    Abort the deletes and keep the data — reconcile fails SAFE.
  const cap = Math.max(maxRemovalFloor, Math.ceil(maxRemovalPct * scannedLoot));
  const aborted = removals.length > cap;
  if (aborted) {
    console.warn(`[opendkp-reconcile] ABORT deletes — removal set ${removals.length} exceeds safety cap ${cap} (${scannedLoot} loot scanned). Likely an upstream fetch anomaly; keeping mirror intact. Run /syncopendkp full to force after verifying.`);
  }

  let removed = 0;
  if (!aborted) {
    for (const r of removals) {
      log(`[opendkp-reconcile] ${dryRun ? 'WOULD remove' : 'removed'} ghost loot: raid ${r.raid_id} "${r.raid_name}" — "${r.item_name}" → ${r.character_name} (${r.dkp} DKP), absent upstream`);
    }
    if (!dryRun && removals.length > 0) {
      const ids = removals.map(r => r.id).filter(v => v != null);
      // Delete in bounded batches so the PostgREST in.() URL stays sane.
      for (let i = 0; i < ids.length; i += 100) {
        const slice = ids.slice(i, i + 100);
        await db.del('opendkp_loot', `id=in.(${slice.join(',')})`);
      }
      removed = ids.length;
    }
  }

  // 4. Advance the watermark (skip on dry run — a dry run changes nothing).
  if (!dryRun) {
    await _writeReconcileWm(db, {
      lastAuditId:     newMaxAuditId,
      lastReconcileAt: now,
      lastRemoved:     aborted ? (wm.lastRemoved || 0) : removed,
    });
  }

  return {
    raids_scanned: raidsScanned,
    raids_skipped: raidsSkipped,
    loot_upserted: upserted,
    loot_removed:  removed,
    would_remove:  dryRun ? removals.length : undefined,
    aborted,
    audit_signals: lootSignals.length,
    last_audit_id: newMaxAuditId,
    dry_run:       dryRun,
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

// ── OpenDKP loot → loot_observations fold (#37) ──────────────────────────────
// `opendkp_loot` is a pure mirror of what OpenDKP awarded and syncs itself.
// `loot_observations` is what the Mob Info Loot tab reads for its "N× won"
// counts — and until now the ONLY thing that ever wrote the OpenDKP half of it
// was an officer typing `/backfillopendkploot`. Somebody last ran that on
// 2026-06-04, so by 2026-08-14 the Loot tab was missing **758 awards across 28
// raids**: Kazmodon won Silver Band of Secrets at raid 98561 for 150 DKP and the
// item still read as never dropped (Hitya spotted it, "are we missing rows of
// loot drops?").
//
// The failure mode is the point: a derived table fed only by a human command
// degrades SILENTLY and PARTIALLY — older items keep their counts, so the
// surface looks healthy right up until someone checks one specific item. Same
// family as the unmonitored Raid-Helper sync. Anything whose only writer is a
// person running a command needs an automatic feeder or a staleness alarm.
//
// Runs at the end of every runSync, folding raids present in opendkp_loot but
// absent from loot_observations. Fail-open and idempotent: a raid is folded once
// and never revisited, so a bad pass costs one cycle, not the table.

// Cap per pass so a cold start (all 8k awards) spreads over a few cycles
// instead of one enormous insert. Newest raids fold first — recent loot is what
// people look up.
const LOOT_FOLD_RAIDS_PER_RUN = 40;

// OpenDKP carries TWO ids per award and they are not the same thing:
// `game_item_id` is the EQ catalog id, `item_id` is OpenDKP's own row id. On the
// 283 rows where they disagree, `item_id` matched the item's real catalog name
// **0 times** and `game_item_id` matched 13 (measured 2026-08-14). The existing
// /backfillopendkploot command prefers ItemId, which is why this does not.
// Name agreement decides when we can check it; otherwise game id wins.
function resolveCatalogItemId(row, nameById, idByName) {
  const nm = String(row.item_name || '').toLowerCase().trim();
  const cands = [row.game_item_id, row.item_id].filter(v => Number.isFinite(v) && v > 0);
  for (const c of cands) {
    const known = nameById.get(c);
    if (known && known === nm) return c;          // id and name agree — certain
  }
  const byName = idByName.get(nm);
  if (Number.isFinite(byName)) return byName;      // name is unambiguous in the catalog
  for (const c of cands) if (nameById.has(c)) return c;   // resolves, name unverifiable
  return cands.length ? cands[0] : null;           // nothing resolves; keep the id for the record
}

// The paged reader lives in utils/supabase.js (the bot's ONE paginator —
// test/db-read-discipline fails the build on a second definition). It moved
// there 2026-08-16 after this file's local copy turned out to be the THIRD
// independently-written drain for the same silent 1000-row cap.
const { selectAllPaged } = supabase;

async function foldLootObservations(opts = {}) {
  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
  const limit = Number.isFinite(opts.maxRaids) ? opts.maxRaids : LOOT_FOLD_RAIDS_PER_RUN;

  // Which raids are already folded? Compare raid-id SETS rather than keeping a
  // watermark — raid ids happen to be monotonic today, but a set difference
  // stays correct if that ever stops being true, and both sides are small.
  //
  // Both selects MUST be paged. A truncated `already` is the dangerous one: it
  // makes folded raids look unfolded and the fold duplicates them.
  const [mirror, already] = await Promise.all([
    selectAllPaged('opendkp_loot', 'select=raid_id,item_id,game_item_id,item_name,character_name,dkp', 'id'),
    selectAllPaged('loot_observations',
      `guild_id=eq.${encodeURIComponent(guildId)}&source=in.(opendkp,opendkp_ambiguous,opendkp_unknown)&select=raid_id`, 'id'),
  ]);
  if (!Array.isArray(mirror) || !Array.isArray(already)) return { skipped: 'select failed' };

  const foldedRaids = new Set(already.map(r => r.raid_id).filter(v => v != null));
  const pending = new Map();                       // raid_id → rows
  for (const r of mirror) {
    if (r.raid_id == null || foldedRaids.has(r.raid_id)) continue;
    if (!pending.has(r.raid_id)) pending.set(r.raid_id, []);
    pending.get(r.raid_id).push(r);
  }
  if (pending.size === 0) return { raids_folded: 0, rows_written: 0, raids_pending: 0 };

  const raidIds = [...pending.keys()].sort((a, b) => b - a).slice(0, limit);   // newest first
  const raidsPending = pending.size - raidIds.length;
  const awards = raidIds.flatMap(id => pending.get(id));

  // Raid timestamps — posted_at must be WHEN the loot was awarded, not now, or
  // every backfilled row lands in a single bogus instant.
  const tsByRaid = new Map();
  for (let i = 0; i < raidIds.length; i += 200) {
    const chunk = raidIds.slice(i, i + 200);
    const rows = await supabase.select('opendkp_raids', `raid_id=in.(${chunk.join(',')})&select=raid_id,ts&limit=1000`);
    if (Array.isArray(rows)) for (const r of rows) if (r.ts) tsByRaid.set(r.raid_id, r.ts);
  }

  // Catalog lookup for id/name reconciliation.
  const nameById = new Map(), idByName = new Map();
  const wantIds = [...new Set(awards.flatMap(a => [a.game_item_id, a.item_id]).filter(v => Number.isFinite(v) && v > 0))];
  for (let i = 0; i < wantIds.length; i += 200) {
    const rows = await supabase.select('eqemu_items', `id=in.(${wantIds.slice(i, i + 200).join(',')})&select=id,name&limit=2000`);
    if (Array.isArray(rows)) for (const r of rows) nameById.set(r.id, String(r.name || '').toLowerCase().trim());
  }
  const wantNames = [...new Set(awards.map(a => String(a.item_name || '').trim()).filter(Boolean))];
  for (let i = 0; i < wantNames.length; i += 100) {
    const list = wantNames.slice(i, i + 100).map(n => '"' + n.replace(/"/g, '""') + '"').join(',');
    const rows = await supabase.select('eqemu_items', `name=in.(${encodeURIComponent(list)})&select=id,name&limit=2000`);
    if (!Array.isArray(rows)) continue;
    const seen = new Map();
    for (const r of rows) {
      const k = String(r.name || '').toLowerCase().trim();
      seen.set(k, seen.has(k) ? null : r.id);      // null = the name is ambiguous
    }
    for (const [k, v] of seen) if (v != null) idByName.set(k, v);
  }

  // NPC attribution, same rules as /backfillopendkploot: exactly one NPC drops
  // it → confident; several → ambiguous; none → unknown. Ambiguous and unknown
  // rows are still WRITTEN (with marker sources) so what we skipped is visible
  // rather than silently lost — the Loot tab counts source='opendkp' only.
  const catalogIdByAward = new Map();
  for (const a of awards) catalogIdByAward.set(a, resolveCatalogItemId(a, nameById, idByName));
  const dropIds = [...new Set([...catalogIdByAward.values()].filter(v => Number.isFinite(v) && v > 0))];
  const dropOwnerByItem = new Map();
  for (let i = 0; i < dropIds.length; i += 100) {
    const rows = await supabase.select('eqemu_npc_drops',
      `item_id=in.(${dropIds.slice(i, i + 100).join(',')})&select=item_id,npc_id,npc_name&limit=20000`);
    if (!Array.isArray(rows)) continue;
    const byItem = new Map();
    for (const row of rows) {
      if (!byItem.has(row.item_id)) byItem.set(row.item_id, new Map());
      byItem.get(row.item_id).set(row.npc_id, row.npc_name);
    }
    for (const [id, npcs] of byItem) {
      dropOwnerByItem.set(id, npcs.size === 1
        ? { npc_id: [...npcs.keys()][0], npc_name: [...npcs.values()][0] }
        : null);
    }
  }

  let confident = 0, ambiguous = 0, unknown = 0;
  const rows = awards.map(a => {
    const itemId = catalogIdByAward.get(a);
    const owner = itemId != null ? dropOwnerByItem.get(itemId) : undefined;
    const base = {
      guild_id:             guildId,
      item_id:              itemId,
      item_name:            a.item_name || null,
      posted_at:            tsByRaid.get(a.raid_id) || new Date().toISOString(),
      posted_by_discord_id: 'opendkp:raid' + a.raid_id,
      raid_id:              a.raid_id,
      winner_character:     a.character_name || null,
      dkp_amount:           Number.isFinite(a.dkp) ? a.dkp : null,
    };
    if (owner) {
      confident++;
      return { ...base, npc_name_lower: String(owner.npc_name).toLowerCase().replace(/_/g, ' ').trim(),
               npc_id: owner.npc_id, source: 'opendkp' };
    }
    if (itemId != null && dropOwnerByItem.has(itemId)) {
      ambiguous++;
      return { ...base, npc_name_lower: '(ambiguous)', npc_id: null, source: 'opendkp_ambiguous' };
    }
    unknown++;
    return { ...base, npc_name_lower: '(unknown)', npc_id: null, source: 'opendkp_unknown' };
  });

  // Collapse exact duplicates inside this batch (the same item awarded twice to
  // the same person for the same DKP in one raid is one award as far as a
  // per-item win count is concerned).
  const { rows: deduped } = dedupByConflictKey(
    rows, ['source', 'raid_id', 'item_id', 'winner_character', 'dkp_amount'], { nullsNotDistinct: true },
  );

  if (opts.dryRun) {
    return { dry_run: true, raids_folded: raidIds.length, rows_ready: deduped.length,
             confident, ambiguous, unknown, raids_pending: raidsPending };
  }

  let written = 0;
  for (let i = 0; i < deduped.length; i += 500) {
    const slice = deduped.slice(i, i + 500);
    // ignore-duplicates: loot_observations_award_uniq (2026-08-16) absorbs any
    // row whose award identity already exists, so a re-run — the exact failure
    // that inserted 116 duplicates on 2026-08-14 — is now a no-op at the
    // schema, not a bug the code has to avoid. representation:true means the
    // response contains only rows ACTUALLY inserted, so `written` stays honest.
    const w = await supabase.insertIgnoreDuplicates('loot_observations', slice, { representation: true });
    if (Array.isArray(w)) written += w.length;
    else console.warn(`[opendkp-loot-fold] insert of ${slice.length} row(s) failed`);
  }
  console.log(`[opendkp-loot-fold] folded ${raidIds.length} raid(s), ${written} row(s) `
    + `(${confident} attributed, ${ambiguous} ambiguous, ${unknown} unknown), ${raidsPending} raid(s) still pending`);
  return { raids_folded: raidIds.length, rows_written: written, confident, ambiguous, unknown,
           raids_pending: raidsPending };
}

module.exports = {
  runSync, syncRaidsList, syncRaidDetail, syncCharacters, syncAuctions, syncAudits, syncAdjustments,
  reconcileRecentLoot, classifyAuditAction, lootDiffRemovals, dedupByConflictKey,
  foldLootObservations, resolveCatalogItemId, selectAllPaged,
};
