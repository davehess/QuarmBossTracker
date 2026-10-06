// utils/screenLive.js — GET /api/screen/live: the raid screen's 3-second feed, served by the bot.
//
// WHY IT EXISTS
// wolfpack.quest/screen is open on ~60 screens for a whole raid. Polled through Vercel, that is most of a
// month's function allowance in one night (Hobby plan) plus a GoTrue round trip per poll. The bot is flat-rate
// and already holds every raider's latest position in memory (utils/raidTrack.js, fed by the roster ingest), so
// the browser asks the bot instead. Vercel's only part is minting the ticket (web/lib/screenTicket.ts).
// RAID_TRACK_ENABLED=0 only stops the recorder's timers: the ingest still feeds that memory, so this feed does
// not depend on the flag (test/screen-live.test.js pins it).
//
// AUTH
// Bearer = a screen ticket (utils/screenTicket.js, HMAC with SCREEN_TOKEN_SECRET). 401 without a good one; 503
// while the secret is unset (the page then falls back to polling Vercel). Nothing here is per-user: a ticket
// opens this one read-only feed.
//
// CORS
// A browser on wolfpack.quest calls the bot's origin, so the bot answers CORS: only the origins in
// SCREEN_ALLOWED_ORIGINS (default wolfpack.quest + b.wolfpack.quest) are echoed back, never "*", no cookies, and
// a request that names any other Origin is refused outright. The 401 and 503 carry the headers too, or the page
// could not tell "ticket expired" from "network down". A request with no Origin (curl, a server) still needs a ticket.
//
// THE PAYLOAD — inputs, not pictures
// The page already has the shaping rules (web/lib/spectator.ts buildPositions, web/lib/raidScreen.ts
// buildScreenState), so the bot ships what they TAKE and the page runs them: one copy of each rule.
//   at         the bot's clock, ISO. The page builds positions with THIS as "now" (its own clock may drift).
//   positions  { rows, live, zones } | null   null when raiders are placed but their zones could not be read
//                rows   RosterPosRow[] from raidTrack.liveRows: the raiders placed in the last 30 s. The uploader's
//                       Discord id is replaced by an opaque per-response label there and never reaches this file.
//                live   [[lowercase name, zone id], ...] from character_live_state, updated in the last 10 min
//                zones  [[zone id, short name, long name], ...] from eqemu_zone, for the zones in `live`
//   state      { row, slideCount, slide } | null   raid_screen_state's row, the deck size, and the slide that is up
//              (only in Slides mode); null when it could not be read
//   auctions   [{ item, endsAt }] | null           the OPEN loot auctions the bot already holds for Mimic, or null
//              when it holds none fresh enough to trust. Item and end time only: no bidder, no bid (bids are sealed).
//
// READS ARE MEMOIZED, NOT PER VIEWER
// Sixty viewers must cost the database what one does. The live zones (+ zone names) are read at most once per
// LIVE_TTL_MS and the screen state at most once per STATE_TTL_MS, whoever asks and however many do at once: a
// request inside the window shares the settled value, or the read still in flight. A failed read is not retried
// until its window passes and the last good value is served meanwhile. Zone names are kept for a day per id.

'use strict';

const screenTicket = require('./screenTicket');
const { bearerOf } = require('./serviceKey');

const DEFAULT_ORIGINS = 'https://wolfpack.quest,https://b.wolfpack.quest';
const ROWS_MAX_AGE_MS = 30_000;          // web/lib/spectator.ts POSITION_FRESH_S
const LIVE_ZONE_MS = 10 * 60 * 1000;     // web/lib/spectator.ts ZONE_LIVE_MS (and raidTrack's)
const LIVE_TTL_MS = 10_000;              // live zones: one read per window, total
const STATE_TTL_MS = 2_000;              // screen state: one read per window, total
const ZONE_TTL_MS = 24 * 60 * 60 * 1000;
const ZONES_PER_READ = 100;
const DECK_READ_LIMIT = 60;              // web/lib/raidScreenServer.ts: SLIDES_MAX (40) + 20
const SLIDE_COLS = 'id,position,title,body,image_url,updated_at';
const AUCTION_MAX_AGE_MS = 60_000;       // an open-auction list older than this is "unknown", not "none"
const AUCTIONS_MAX = 20;
const PREFLIGHT_MAX_AGE_S = 600;

let _deps = {};
const _sb = () => _deps.supabase || require('./supabase');
const _rt = () => _deps.raidTrack || require('./raidTrack');
const _clock = () => (typeof _deps.now === 'function' ? _deps.now() : Date.now());
const _guildId = () => process.env.SUPABASE_GUILD_ID || 'wolfpack';
const _enc = encodeURIComponent;

// ── CORS ─────────────────────────────────────────────────────────────────────

/** The origins allowed to read the feed: SCREEN_ALLOWED_ORIGINS (comma list), else the site and its beta. Never "*". */
function allowedOrigins() {
  const raw = process.env.SCREEN_ALLOWED_ORIGINS;
  const list = (raw && raw.trim() ? raw : DEFAULT_ORIGINS)
    .split(',').map(s => s.trim().replace(/\/+$/, '')).filter(s => s && s !== '*');
  return list;
}

// ── Memo ─────────────────────────────────────────────────────────────────────

const _memo = new Map();   // key → { at, pending, last, promise }

/**
 * `load()` at most once per `ttlMs` for everyone. Concurrent callers share one promise; a load still in flight
 * is shared past its window. `load` resolves a value, or null/throws on failure — then the last good value (if
 * any) is served and the next try waits for the window like any other.
 */
function cached(key, ttlMs, load) {
  const now = _clock();
  const m = _memo.get(key);
  if (m && (m.pending || now - m.at < ttlMs)) return m.promise;
  const entry = { at: now, pending: true, last: m ? m.last : null, promise: null };
  entry.promise = (async () => {
    let v = null;
    try { v = await load(); } catch { v = null; }
    if (v != null) entry.last = v;
    entry.pending = false;
    return v != null ? v : entry.last;
  })();
  _memo.set(key, entry);
  return entry.promise;
}

// ── Live zones ───────────────────────────────────────────────────────────────

let _zoneCache = new Map();   // zone id → { short, long } | null (no eqemu_zone row), with the day it was read
let _zoneCacheAt = 0;

// character_live_state rows updated in the last 10 min as lowercase name → zone id, and the zone names for
// those ids. ONE read of the live table whatever the roster looks like (it holds only characters whose Mimic
// reported lately, tens of rows, explicitly bounded under the 1,000-row cap), so the memo is exact: a raider
// who joins mid-window is already in it. Names for ids not seen in the last day cost one more read.
async function loadLive() {
  const sb = _sb();
  const now = _clock();
  const since = new Date(now - LIVE_ZONE_MS).toISOString();
  const rows = await sb.select('character_live_state',
    `guild_id=eq.${_enc(_guildId())}&updated_at=gte.${_enc(since)}&select=character,zone_id&limit=1000`);
  if (!Array.isArray(rows)) return null;
  const live = new Map();
  for (const r of rows) {
    const id = Number(r?.zone_id);
    if (r?.character && id > 0) live.set(String(r.character).trim().toLowerCase(), id);
  }
  if (now - _zoneCacheAt > ZONE_TTL_MS) { _zoneCache = new Map(); _zoneCacheAt = now; }
  const missing = [...new Set(live.values())].filter(id => !_zoneCache.has(id)).slice(0, ZONES_PER_READ);
  if (missing.length) {
    const zs = await sb.select('eqemu_zone',
      `zone_id=in.(${missing.join(',')})&select=zone_id,short_name,long_name&limit=${ZONES_PER_READ}`);
    // A failed name read is a failed load: every raider would otherwise be "unplaced" until the next window.
    if (!Array.isArray(zs)) return null;
    for (const z of zs) {
      if (z && z.short_name) _zoneCache.set(Number(z.zone_id), { short: String(z.short_name), long: z.long_name ? String(z.long_name) : null });
    }
    for (const id of missing) if (!_zoneCache.has(id)) _zoneCache.set(id, null);
  }
  return { live, zones: _zoneCache };
}

// ── Screen state ─────────────────────────────────────────────────────────────

const STATE_KEYS = ['mode', 'slide_index', 'updated_by', 'updated_at'];
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o?.[k] ?? null]));

/** web/lib/raidScreen.ts clampSlideIndex: a whole number from 0 to count - 1 (0 when the deck is empty), else 0. */
function clampSlideIndex(index, count) {
  const n = typeof index === 'number' && Number.isFinite(index) ? Math.trunc(index) : 0;
  const last = Math.max(0, Math.trunc(count) - 1);
  return Math.min(Math.max(n, 0), last);
}

// The state row, the deck's size, and (Slides mode only) the slide at the index: the raw rows, which the page
// turns into a ScreenState with buildScreenState. null when any read failed.
async function loadState() {
  const sb = _sb();
  const g = _enc(_guildId());
  const [st, ids] = await Promise.all([
    sb.select('raid_screen_state', `guild_id=eq.${g}&select=mode,slide_index,updated_by,updated_at&limit=1`),
    sb.select('raid_screen_slides', `guild_id=eq.${g}&select=id&order=position.asc,id.asc&limit=${DECK_READ_LIMIT}`),
  ]);
  if (!Array.isArray(st) || !Array.isArray(ids)) return null;
  // Named columns only, whatever the read returned: the driver's id and the guild tag never go out.
  const row = st[0] ? pick(st[0], STATE_KEYS) : null;
  let slide = null;
  if (row && row.mode === 'slides' && ids.length) {
    const id = ids[clampSlideIndex(row.slide_index, ids.length)]?.id;
    if (id) {
      const s = await sb.select('raid_screen_slides', `id=eq.${_enc(id)}&select=${SLIDE_COLS}&limit=1`);
      if (!Array.isArray(s)) return null;
      slide = s[0] ? pick(s[0], SLIDE_COLS.split(',')) : null;
    }
  }
  return { row, slideCount: ids.length, slide };
}

// ── Auctions ─────────────────────────────────────────────────────────────────

// ctx.auctions() is index.js's read-only peek at the auctions cache Mimic's panel keeps warm:
// { at, items: [{ item, endsAt }] } or null. Only item + end time go out, whatever else the getter returns.
function auctionsFor(ctx, nowMs) {
  let snap = null;
  try { snap = ctx && typeof ctx.auctions === 'function' ? ctx.auctions() : null; } catch { snap = null; }
  if (!snap || !Array.isArray(snap.items) || !Number.isFinite(snap.at) || nowMs - snap.at > AUCTION_MAX_AGE_MS) return null;
  const out = [];
  for (const a of snap.items) {
    const item = typeof a?.item === 'string' ? a.item.trim().slice(0, 100) : '';
    if (!item) continue;
    const end = a.endsAt ? Date.parse(a.endsAt) : NaN;
    if (Number.isFinite(end) && end < nowMs - 60_000) continue;   // closed a minute ago and still in the cache
    out.push({ item, endsAt: Number.isFinite(end) ? new Date(end).toISOString() : null });
  }
  out.sort((a, b) => (a.endsAt ? Date.parse(a.endsAt) : Infinity) - (b.endsAt ? Date.parse(b.endsAt) : Infinity));
  return out.slice(0, AUCTIONS_MAX);
}

// ── The payload ──────────────────────────────────────────────────────────────

async function buildPayload(ctx = {}) {
  const nowMs = _clock();
  const rows = _rt().liveRows(nowMs, ROWS_MAX_AGE_MS);
  // Nothing placed = nothing to look the zones of up.
  const [mem, state] = await Promise.all([rows.length ? cached('live', LIVE_TTL_MS, loadLive) : null, cached('state', STATE_TTL_MS, loadState)]);

  const names = new Set(rows.map(r => r.name.toLowerCase()));
  const live = [];
  const zoneIds = new Set();
  if (mem) {
    for (const [name, id] of mem.live) if (names.has(name)) { live.push([name, id]); zoneIds.add(id); }
  }
  const zones = [];
  if (mem) {
    for (const id of zoneIds) {
      const z = mem.zones.get(id);
      if (z) zones.push([id, z.short, z.long]);
    }
  }
  return {
    at: new Date(nowMs).toISOString(),
    // null = raiders are placed but their zones could not be read and none are held: the page shows "could not
    // load" for the map (as the Vercel route's 502 does) rather than a map that says nobody is anywhere.
    positions: rows.length && !mem ? null : { rows, live, zones },
    state: state || null,
    auctions: auctionsFor(ctx, nowMs),
  };
}

// ── The handler ──────────────────────────────────────────────────────────────

/**
 * GET /api/screen/live and its OPTIONS preflight. `ctx.auctions` is optional (see auctionsFor).
 * Answers every path itself; the caller (index.js) only routes here and catches a throw.
 */
async function handle(req, res, ctx = {}) {
  const origin = typeof req.headers?.origin === 'string' ? req.headers.origin : '';
  const originOk = !!origin && allowedOrigins().includes(origin);
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin' };
  if (originOk) headers['Access-Control-Allow-Origin'] = origin;
  const send = (status, body) => {
    res.writeHead(status, headers);
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };

  if (origin && !originOk) return send(403, { error: 'origin not allowed' });

  if (req.method === 'OPTIONS') {
    headers['Access-Control-Allow-Methods'] = 'GET';
    headers['Access-Control-Allow-Headers'] = 'Authorization';
    headers['Access-Control-Max-Age'] = String(PREFLIGHT_MAX_AGE_S);
    return send(204);
  }
  if (req.method !== 'GET') return send(405, { error: 'method not allowed' });

  if (!process.env.SCREEN_TOKEN_SECRET) return send(503, { error: 'screen feed not configured' });
  const check = screenTicket.verify(bearerOf(req), { nowMs: _clock() });
  if (!check.ok) return send(401, { error: 'unauthorized' });

  let enabled = false;
  try { enabled = !!_sb().isEnabled(); } catch { enabled = false; }
  if (!enabled) return send(503, { error: 'screen feed unavailable' });

  return send(200, await buildPayload(ctx));
}

// Test-only: drop the memo, the zone names and any injected deps.
function _reset() { _memo.clear(); _zoneCache = new Map(); _zoneCacheAt = 0; _deps = {}; }
// Test-only: inject { supabase, raidTrack, now }.
function _setDeps(d = {}) { _deps = { ..._deps, ...d }; }

module.exports = {
  handle, buildPayload, allowedOrigins, clampSlideIndex,
  DEFAULT_ORIGINS, ROWS_MAX_AGE_MS, LIVE_ZONE_MS, LIVE_TTL_MS, STATE_TTL_MS, ZONE_TTL_MS, DECK_READ_LIMIT,
  AUCTION_MAX_AGE_MS, AUCTIONS_MAX, PREFLIGHT_MAX_AGE_S,
  _reset, _setDeps,
};
