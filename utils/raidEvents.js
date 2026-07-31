// utils/raidEvents.js — "is there a scheduled event running right now, and is
// it a raid or a social/off-night event?"
//
// WHY (Hitya 2026-07-31): v1 of the raid-night thread keyed everything off the
// hardcoded Sun/Wed/Thu 20:30 window, so a Friday-morning backfill minted a
// public "Kill Log — Friday" thread and an off-schedule raid got nothing. The
// guild already publishes its schedule twice — as Discord **scheduled events**
// and in the **Raid-Helper** app — so the posting window should come from
// those, not from a weekday table.
//
// POSTING WINDOW: [start − RAID_EVENT_PRE_MIN, end + RAID_EVENT_POST_MIN],
// default 30 min before the planned start and 15 min after the scheduled end
// (Hitya's numbers). Everything the bot posts for a timestamp inside that
// window lands in that event's thread.
//
// SOURCES, in priority order:
//   1. **Discord scheduled events** (primary). `guild.scheduledEvents.fetch()`
//      is a REST call, so it needs NO new gateway intent and no new credential
//      — the bot already has the perms Hitya has. Cached (default 5 min) and
//      single-flight so a busy raid can't turn one card per pull into one API
//      call per pull.
//   2. **Raid-Helper** (enrichment). We do NOT build a second client: the repo
//      already syncs RH into the `rh_events` Supabase mirror every 30 min
//      (utils/raidhelperApi.js, index.js ~865). We just read that mirror. It
//      only fills gaps — an event RH knows about that Discord doesn't, or an
//      end time Discord left null. Requires the EXISTING `RH_API_KEY` env for
//      the sync to produce rows; with it unset the mirror is empty and this
//      source is silently inert.
//      ⚠ NEEDS LIVE VERIFICATION: as of 2026-07-31 `rh_events` has 0 rows
//      (the key has never been set), so this path is untested against real RH
//      payloads. Everything about it is fail-open.
//
// FAIL-OPEN EVERYWHERE. Any error → we behave as if no event were scheduled,
// which falls back to the pre-existing destinations. Nothing here is allowed
// to throw into a caller.
//
// Env:
//   RAID_EVENT_PRE_MIN        minutes before start the window opens (default 30)
//   RAID_EVENT_POST_MIN       minutes after end the window closes  (default 15)
//   RAID_EVENT_DEFAULT_HOURS  assumed length when an event has no end (default 4)
//   RAID_EVENT_CACHE_MS       scheduled-event refresh interval (default 300000)
//   RAID_EVENT_RAID_DAYS      nights that are raid nights
//                             (default 'sunday,wednesday,thursday')
//   RAID_EVENT_RAID_FROM_HOUR earliest local hour on a raid day that still
//                             counts as the raid night (default 17)
//   RAID_EVENT_RAID_PATTERN   title regex ⇒ force RAID    (default '' = off)
//   RAID_EVENT_SOCIAL_PATTERN title regex ⇒ force NON-raid (default '' = off)
//   RAID_EVENT_SOURCES        'discord' | 'rh' | 'both' (default 'both')

'use strict';

const { getDefaultTz, partsInTzAt } = require('./timezone');

const MIN = 60 * 1000;

// Same three days as commands/raidnight.js / utils/timezone.js — but here they
// are the PRIMARY classifier, not a fallback (Hitya 2026-07-31: the raids
// themselves are Discord events — "Seru / Misc" on a Sunday, "Vex Thal" on a
// Wednesday — so "has a Discord event" says nothing about which flow it wants;
// the NIGHT does).
const DEFAULT_RAID_DAYS = 'sunday,wednesday,thursday';
// 17:00 ET — deliberately EARLIER than the 20:30 raid-start used elsewhere:
// an event's *scheduled* start is the announced pull time, officers schedule
// ahead of it, and the -30m pre-window opens earlier still. A genuine daytime
// social on a raid day (before 5pm) still classifies as an event.
const DEFAULT_RAID_FROM_HOUR = 17;

function raidDays() {
  const raw = String(process.env.RAID_EVENT_RAID_DAYS || DEFAULT_RAID_DAYS).toLowerCase();
  return new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
}
function raidFromMin() {
  const h = parseInt(process.env.RAID_EVENT_RAID_FROM_HOUR, 10);
  return (Number.isInteger(h) && h >= 0 && h <= 23 ? h : DEFAULT_RAID_FROM_HOUR) * 60;
}

function _int(name, dflt) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}
function preMs()      { return _int('RAID_EVENT_PRE_MIN', 30) * MIN; }
function postMs()     { return _int('RAID_EVENT_POST_MIN', 15) * MIN; }
function defaultLenMs() {
  const h = Number(process.env.RAID_EVENT_DEFAULT_HOURS);
  return (Number.isFinite(h) && h > 0 ? h : 4) * 60 * MIN;
}
function cacheMs()    { return _int('RAID_EVENT_CACHE_MS', 5 * 60 * 1000); }

function _rx(name, dflt) {
  const raw = process.env[name];
  const src = raw == null || raw === '' ? dflt : raw;
  if (!src) return null;
  try { return new RegExp(src, 'i'); } catch { return dflt ? new RegExp(dflt, 'i') : null; }
}

// ── Pure window math ─────────────────────────────────────────────────────────

/**
 * Normalize any source's event into the shape the rest of the bot uses.
 * `startMs` is required; a missing/invalid end is filled with the default
 * length so an event without an end time still produces a bounded window
 * (Discord only requires an end time for EXTERNAL events).
 */
function normalizeEvent(raw) {
  if (!raw) return null;
  const startMs = Number(raw.startMs);
  if (!Number.isFinite(startMs)) return null;
  let endMs = Number(raw.endMs);
  if (!Number.isFinite(endMs) || endMs <= startMs) endMs = startMs + defaultLenMs();
  return {
    id:      String(raw.id || `${raw.source || 'evt'}:${startMs}`),
    source:  raw.source || 'discord',
    title:   String(raw.title || 'Scheduled event').slice(0, 90),
    startMs,
    endMs,
    assumedEnd: !Number.isFinite(Number(raw.endMs)) || Number(raw.endMs) <= startMs,
  };
}

/** [start − pre, end + post] for an event. */
function windowFor(ev) {
  return { fromMs: ev.startMs - preMs(), untilMs: ev.endMs + postMs() };
}

/** True when `ts` falls inside the event's posting window. */
function windowContains(ev, ts) {
  const w = windowFor(ev);
  return ts >= w.fromMs && ts <= w.untilMs;
}

/**
 * Of the events whose window contains `ts`, the one whose *scheduled start* is
 * nearest `ts` (Hitya: overlapping events → nearest). Ties break on the shorter
 * event, then on id, so the choice is deterministic across bot restarts —
 * otherwise two uploads seconds apart could pick different threads.
 */
function pickEventAt(events, ts) {
  const live = (Array.isArray(events) ? events : []).filter(e => e && windowContains(e, ts));
  if (live.length === 0) return null;
  live.sort((a, b) => {
    const da = Math.abs(ts - a.startMs), db = Math.abs(ts - b.startMs);
    if (da !== db) return da - db;
    const la = a.endMs - a.startMs, lb = b.endMs - b.startMs;
    if (la !== lb) return la - lb;
    return String(a.id).localeCompare(String(b.id));
  });
  return live[0];
}

/**
 * 'raid' | 'event'.
 *
 * ⚑ FOR HITYA — the rule, in this order (all of it configurable):
 *   1. title matches RAID_EVENT_SOCIAL_PATTERN → 'event'  (default: off)
 *   2. title matches RAID_EVENT_RAID_PATTERN   → 'raid'   (default: off)
 *   3. THE DAY DECIDES (the primary rule): an event whose NIGHT lands on
 *      Sun/Wed/Thu at/after 17:00 ET is the raid → #raid-chat + the DKP loot
 *      flow. Mon/Tue/Fri/Sat (and raid-day daytime) is a guild event →
 *      #event-chat + the roll-loot flow.
 *
 * Grounded in the guild's actual calendar: the raids THEMSELVES are Discord
 * events ("Seru / Misc" Sunday, "Vex Thal" Wednesday), so the title tells us
 * nothing — the two title patterns exist only as manual overrides if a raid
 * ever gets scheduled off-night (or a social lands on a raid night).
 *
 * The night is resolved with the same rollover as the thread key, so an event
 * that starts 23:45 Sunday is still Sunday's raid.
 */
function classifyEvent(ev, tz) {
  const title  = String(ev?.title || '');
  const social = _rx('RAID_EVENT_SOCIAL_PATTERN', '');
  if (social && social.test(title)) return 'event';
  const raid = _rx('RAID_EVENT_RAID_PATTERN', '');
  if (raid && raid.test(title)) return 'raid';
  const zone = tz || getDefaultTz();
  // The night an event START belongs to (rollover-shifted, so a 00:30 start is
  // still the previous evening's night).
  let anchorMs = ev.startMs;
  try { anchorMs = require('./raidNight').nightAnchorMs(ev.startMs); } catch { /* pure fallback below */ }
  const night = partsInTzAt(anchorMs, zone);
  if (!raidDays().has(night.dayOfWeek)) return 'event';
  const p = partsInTzAt(ev.startMs, zone);
  // Same calendar day as the night anchor → must be at/after the raid-day floor.
  // Different day → we're already in the night's post-midnight spillover.
  if (p.day === night.day && p.month === night.month) {
    return (p.hour * 60 + p.minute) >= raidFromMin() ? 'raid' : 'event';
  }
  return 'raid';
}

// ── Sources ──────────────────────────────────────────────────────────────────

function _sources() {
  const v = String(process.env.RAID_EVENT_SOURCES || 'both').toLowerCase();
  return { discord: v === 'both' || v === 'discord', rh: v === 'both' || v === 'rh' };
}

/**
 * Discord scheduled events for the configured guild.
 * `scheduledEvents.fetch()` hits REST (`GET /guilds/:id/scheduled-events`), so
 * the GuildScheduledEvents *intent* is not required — index.js doesn't request
 * it. Discord's list endpoint only returns SCHEDULED + ACTIVE events, which is
 * why the caller keeps a sticky map (a raid that just got marked Completed
 * would otherwise vanish inside its own +15m tail).
 */
async function fetchDiscordEvents(client) {
  if (!client) return [];
  const guildId = process.env.DISCORD_GUILD_ID;
  let guild = null;
  try {
    guild = (guildId && (client.guilds?.cache?.get(guildId) || await client.guilds.fetch(guildId)))
            || client.guilds?.cache?.first() || null;
  } catch { guild = client.guilds?.cache?.first() || null; }
  if (!guild?.scheduledEvents?.fetch) return [];
  let coll;
  try { coll = await guild.scheduledEvents.fetch(); } catch (err) {
    console.warn('[raid-events] scheduledEvents.fetch failed:', err?.message);
    return [];
  }
  const list = typeof coll?.values === 'function' ? [...coll.values()] : (Array.isArray(coll) ? coll : []);
  const out = [];
  for (const e of list) {
    // 4 = CANCELED (discord.js exposes the numeric enum). Everything else is
    // either upcoming, running, or recently finished — all legitimate windows.
    if (Number(e?.status) === 4) continue;
    const ev = normalizeEvent({
      id:     `discord:${e?.id}`,
      source: 'discord',
      title:  e?.name,
      startMs: Number(e?.scheduledStartTimestamp),
      endMs:   Number(e?.scheduledEndTimestamp),
    });
    if (ev) out.push(ev);
  }
  return out;
}

/**
 * Raid-Helper events, read from the `rh_events` mirror the bot ALREADY syncs
 * (utils/raidhelperApi.js). No second API client, no new credential.
 * Enrichment only — see the header note about it being unverified in prod.
 */
async function fetchRaidHelperEvents(nowMs) {
  let supabase;
  try { supabase = require('./supabase'); } catch { return []; }
  if (!supabase?.isEnabled?.()) return [];
  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
  const lo = new Date(nowMs - 48 * 60 * MIN).toISOString();
  const hi = new Date(nowMs + 48 * 60 * MIN).toISOString();
  let rows;
  try {
    rows = await supabase.select('rh_events',
      `guild_id=eq.${encodeURIComponent(guildId)}`
      + `&start_time=gte.${encodeURIComponent(lo)}&start_time=lte.${encodeURIComponent(hi)}`
      + `&select=id,title,start_time,end_time&limit=50`);
  } catch (err) {
    console.warn('[raid-events] rh_events read failed:', err?.message);
    return [];
  }
  const out = [];
  for (const r of (Array.isArray(rows) ? rows : [])) {
    const ev = normalizeEvent({
      id:     `rh:${r?.id}`,
      source: 'raid-helper',
      title:  r?.title,
      startMs: r?.start_time ? Date.parse(r.start_time) : NaN,
      endMs:   r?.end_time   ? Date.parse(r.end_time)   : NaN,
    });
    if (ev) out.push(ev);
  }
  return out;
}

/**
 * Merge sources. Discord wins: an RH event whose start is within
 * `dedupeMs` of a Discord event is the SAME raid posted twice, and we keep the
 * Discord copy (its id is what the thread cache is keyed on) — but we DO borrow
 * RH's real end time when Discord had to assume one.
 */
function mergeEventSources(discordEvents, rhEvents, dedupeMs = 30 * MIN) {
  const out = (Array.isArray(discordEvents) ? discordEvents : []).slice();
  for (const rh of (Array.isArray(rhEvents) ? rhEvents : [])) {
    const twin = out.find(d => Math.abs(d.startMs - rh.startMs) <= dedupeMs);
    if (twin) {
      if (twin.assumedEnd && !rh.assumedEnd && rh.endMs > twin.startMs) {
        twin.endMs = rh.endMs;
        twin.assumedEnd = false;
      }
      continue;
    }
    out.push(rh);
  }
  return out;
}

// ── Cached lookup ────────────────────────────────────────────────────────────
// One refresh per RAID_EVENT_CACHE_MS, single-flight, and a sticky map so an
// event Discord stops listing (status → COMPLETED) still resolves through its
// own post-window tail. Sticky entries older than 24h are dropped.

const _sticky   = new Map();   // id → event
let   _lastFetchAt = 0;
let   _inflight  = null;

function _rememberAll(events, nowMs) {
  for (const e of events) _sticky.set(e.id, e);
  for (const [id, e] of _sticky) {
    if (nowMs - e.endMs > 24 * 60 * MIN) _sticky.delete(id);
  }
}

async function _refresh(client, nowMs) {
  const want = _sources();
  const [discordEvents, rhEventRows] = await Promise.all([
    want.discord ? fetchDiscordEvents(client).catch(() => []) : Promise.resolve([]),
    want.rh      ? fetchRaidHelperEvents(nowMs).catch(() => []) : Promise.resolve([]),
  ]);
  const merged = mergeEventSources(discordEvents, rhEventRows);
  _rememberAll(merged, nowMs);
  _lastFetchAt = nowMs;
  return merged;
}

/**
 * Every event we currently know about (fresh fetch at most once per cache
 * window, plus sticky recents). Never throws.
 */
async function knownEvents(client, nowMs = Date.now()) {
  if (_inflight) { try { await _inflight; } catch { /* fall through to sticky */ } }
  else if (nowMs - _lastFetchAt >= cacheMs()) {
    _inflight = _refresh(client, nowMs)
      .catch(err => { console.warn('[raid-events] refresh failed:', err?.message); return []; })
      .finally(() => { _inflight = null; });
    try { await _inflight; } catch { /* sticky still usable */ }
  }
  return [..._sticky.values()];
}

/**
 * The event whose posting window contains `ts`, with its classification —
 * `{ ...event, kind: 'raid'|'event', window }` — or null.
 */
async function activeEventAt(client, ts = Date.now()) {
  const events = await knownEvents(client, Date.now());
  const ev = pickEventAt(events, ts);
  if (!ev) return null;
  return { ...ev, kind: classifyEvent(ev, getDefaultTz()), window: windowFor(ev) };
}

/** Test seam. */
function _resetCache() { _sticky.clear(); _lastFetchAt = 0; _inflight = null; }
/** Test seam — inject events without touching Discord. */
function _seed(events, nowMs = Date.now()) { _rememberAll(events.map(normalizeEvent).filter(Boolean), nowMs); _lastFetchAt = nowMs; }

module.exports = {
  DEFAULT_RAID_DAYS, DEFAULT_RAID_FROM_HOUR, raidDays, raidFromMin,
  preMs, postMs, defaultLenMs, cacheMs,
  normalizeEvent, windowFor, windowContains, pickEventAt, classifyEvent,
  fetchDiscordEvents, fetchRaidHelperEvents, mergeEventSources,
  knownEvents, activeEventAt,
  _resetCache, _seed,
};
