// utils/myParses.js — GET /api/agent/my-parses: the signed-in raider's own parses over a window.
//
// WHY IT EXISTS
// A member asked (2026-10-06) whether Mimic has a page that graphs their parses over a variable time window
// (a day, a week, ...). The guild lead picked a My parses tab in Mimic AND wolfpack.quest/me/parses reading
// ONE Postgres function, so the tab and the page always show the same numbers:
// supabase/migrations/20261006200000_my_parse_series.sql, my_parse_series(). This file is the bot's side of
// the Mimic half: it turns the query string into the function's arguments and keeps the answer for a few
// minutes. The route itself (auth, status codes, gzip) is _handleAgentMyParses in index.js.
//
// WHO IS ASKED ABOUT
// The caller's own Discord id, taken from the Mimic session by the route and passed in here. Nothing in the
// query string names a person: a `discord_id` or `user` parameter is not read at all, and the function is
// granted to service_role only, so there is no way to ask for somebody else's parses.
//
// ONE jsonb VALUE, NOT ROWS
// The function returns a single object, so PostgREST's 1,000-row cap cannot cut it and supabase.rpc() hands it
// back as-is (null on a timeout, an open breaker or a 4xx/5xx: a failed read is not an empty answer, so the
// route says 502 and caches nothing).

// Quarm era boundaries (UTC), newest first. Keep in step with EXPANSION_STARTS in web/lib/timeWindow.ts: the
// website's /me/parses and this route must agree on where "this expansion" begins.
const EXPANSION_STARTS = [
  { name: 'PoP',     startMs: Date.UTC(2026, 9, 1) },
  { name: 'Luclin',  startMs: Date.UTC(2025, 9, 1) },
  { name: 'Velious', startMs: Date.UTC(2025, 3, 1) },
  { name: 'Kunark',  startMs: Date.UTC(2024, 6, 1) },
  { name: 'Classic', startMs: 0 },
];

const DAY_MS = 86400_000;
const DAY_WINDOWS = {
  '1d':  { label: '1 day',   days: 1 },
  '7d':  { label: '1 week',  days: 7 },
  '30d': { label: '30 days', days: 30 },
  '90d': { label: '90 days', days: 90 },
};
const DEFAULT_WINDOW = '7d';
const DEFAULT_SCOPE = 'bosses';

const CHAR_MAX_LEN = 64;
// EverQuest names are letters; the apostrophe, backtick and hyphen are what a possessive or a hyphenated
// display name can carry. Anything else is not a character name, so it is ignored rather than passed on.
const CHAR_RX = /^[A-Za-z '`-]+$/;

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 500;

function currentExpansion(nowMs) {
  for (const e of EXPANSION_STARTS) if (nowMs >= e.startMs) return e;
  return EXPANSION_STARTS[EXPANSION_STARTS.length - 1];
}

// raw w -> { key, label, since }. since is an ISO lower bound, or null for lifetime. Unknown -> 7d.
function resolveWindow(raw, nowMs = Date.now()) {
  const key = typeof raw === 'string' && (raw === 'exp' || raw === 'life' || Object.prototype.hasOwnProperty.call(DAY_WINDOWS, raw))
    ? raw : DEFAULT_WINDOW;
  if (key === 'life') return { key, label: 'Lifetime', since: null };
  if (key === 'exp') {
    const e = currentExpansion(nowMs);
    return { key, label: `${e.name} era`, since: new Date(e.startMs).toISOString() };
  }
  const d = DAY_WINDOWS[key];
  return { key, label: d.label, since: new Date(nowMs - d.days * DAY_MS).toISOString() };
}

// Anything but 'all' is the curated bosses.
function cleanScope(raw) {
  return raw === 'all' ? 'all' : DEFAULT_SCOPE;
}

// A character name, or null when there is none worth passing on (absent, blank, too long, or not name-shaped).
function cleanChar(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > CHAR_MAX_LEN || !CHAR_RX.test(s)) return null;
  return s;
}

// The request URL (path and query) -> { w, scope, char }. A URL that will not parse reads as no parameters.
function parseQuery(url, nowMs = Date.now()) {
  let sp;
  try { sp = new URL(url, 'http://x').searchParams; } catch { sp = new URLSearchParams(); }
  return {
    w: resolveWindow(sp.get('w'), nowMs),
    scope: cleanScope(sp.get('scope')),
    char: cleanChar(sp.get('char')),
  };
}

// One slot per person x window x scope x character. The name is case-folded because the function matches it
// case-insensitively, so "Aldenmar" and "aldenmar" are one answer.
function cacheKey(discordId, q) {
  return `${discordId}|${q.w.key}|${q.scope}|${q.char ? q.char.toLowerCase() : ''}`;
}

// A small TTL map, bounded: past `max` entries the OLDEST goes (insertion order; a re-set moves a key to the
// back). `now` is injectable for tests. Holds finished response bodies, never a failed read.
function createCache({ ttlMs = CACHE_TTL_MS, max = CACHE_MAX, now = () => Date.now() } = {}) {
  const m = new Map();
  return {
    get(key) {
      const hit = m.get(key);
      if (!hit) return undefined;
      if (now() - hit.at >= ttlMs) { m.delete(key); return undefined; }
      return hit.value;
    },
    set(key, value) {
      m.delete(key);
      m.set(key, { at: now(), value });
      while (m.size > max) m.delete(m.keys().next().value);
    },
    get size() { return m.size; },
  };
}

// The body Mimic gets: the function's object plus the window it was asked for and the scope. null when the read
// failed (supabase.rpc resolves null on any failure) or came back as something other than the one object.
async function fetchSeries(supabase, discordId, q) {
  const params = {
    p_discord_id: discordId,
    p_since: q.w.since,
    p_bosses_only: q.scope !== 'all',
  };
  if (q.char) params.p_character = q.char;
  const out = await supabase.rpc('my_parse_series', params);
  if (!out || typeof out !== 'object' || Array.isArray(out)) return null;
  return { ...out, window: { key: q.w.key, label: q.w.label, since: q.w.since }, scope: q.scope };
}

module.exports = {
  EXPANSION_STARTS, DAY_WINDOWS, DEFAULT_WINDOW, DEFAULT_SCOPE, CHAR_MAX_LEN, CACHE_TTL_MS, CACHE_MAX,
  currentExpansion, resolveWindow, cleanScope, cleanChar, parseQuery, cacheKey, createCache, fetchSeries,
};
