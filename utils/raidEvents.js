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

const fs   = require('node:fs');
const path = require('node:path');
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
    // Zone routing (Hitya 2026-09-07). The calendar entry's free text, and the
    // zone ids annotateZones() derives from it — carried on the event so the
    // sticky map, the plan's `why` and the tests all see the same answer.
    description: raw.description == null ? '' : String(raw.description).slice(0, 1000),
    location:    raw.location    == null ? '' : String(raw.location).slice(0, 200),
    zoneIds:     Array.isArray(raw.zoneIds)
      ? [...new Set(raw.zoneIds.map(Number).filter(n => Number.isFinite(n) && n > 0))].sort((a, b) => a - b)
      : [],
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
 *
 * ⚠ THE ZONE COMES FIRST when the caller knows it (Hitya 2026-09-07: "there
 * are two events going on tonight and mobs are being posted to each one,
 * instead of specific ones posted per zone"). Nearest-start is the right rule
 * for one event at a time and exactly the wrong one for two at once: a Seru
 * mini and a Ring War overlapped, so once the clock passed the midpoint
 * between their start times every Seru kill went to the Ring War thread. So:
 *   1. live events that NAME the kill's zone (annotateZones)  → only those
 *   2. none do, but some name no zone at all                  → only those
 *      (an event that names a DIFFERENT zone is not this kill's event; one
 *      that names nothing could be)
 *   3. otherwise, and whenever the zone is unknown             → today's rule
 * Never fewer candidates than one: the zone only narrows, it cannot empty.
 */
function pickEventAt(events, ts, zoneId) {
  let live = (Array.isArray(events) ? events : []).filter(e => e && windowContains(e, ts));
  if (live.length === 0) return null;
  const zid = Number(zoneId);
  if (live.length > 1 && Number.isFinite(zid) && zid > 0) {
    const named = (e) => Array.isArray(e.zoneIds) && e.zoneIds.length > 0;
    const here  = live.filter(e => named(e) && e.zoneIds.includes(zid));
    if (here.length) live = here;
    else {
      const unnamed = live.filter(e => !named(e));
      if (unnamed.length) live = unnamed;
    }
  }
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
      // Free text the zone is read from (see zoneIdsForEvent). `location` is
      // only set on EXTERNAL events — /announce writes the zone there; an
      // officer's hand-made voice-channel event carries it in the title.
      description: e?.description,
      location:    e?.entityMetadata?.location,
    });
    if (ev) out.push(ev);
  }
  return out;
}

// ── Zone vocabulary ──────────────────────────────────────────────────────────
// Which zone(s) a calendar entry is about, read from its own text. Whole-phrase
// matches only — never single tokens ("plane" is in 25 zone names, "temple" in
// six) — against a vocabulary built from three places:
//   • eqemu_zone            long name (with and without a leading "The"), short
//                           name; "(Instanced)" / "(Alt)" rows fold into their
//                           base name so "Plane of Sky" is {71, 1071}
//   • data/zones.json       the guild's own names + `shortName` ("seru" for
//                           Sanctus Seru) + an optional `aliases` list — THIS is
//                           where guild vocabulary goes ("ring war" → Great
//                           Divide). Data, hot-read, no code change to extend.
//   • data/bosses.json      boss names + nicknames → the boss's zone
// A kill's zone id is `floor(npc_id / 1000)` (the catalog's own scheme, see
// utils/mobSpecials.zoneIdOf) or the uploader's live-state zone_id, so both
// sides of the comparison are eqemu zone ids.

const _SHORT_STOP = new Set(['load', 'load2', 'clz', 'tutorial']);   // not places

function _normText(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function _stripThe(n) { return n.replace(/^the /, ''); }

/**
 * alias (normalized phrase) → sorted zone ids. Pure; every input optional.
 * `eqemuRows` = [[zone_id, short_name, long_name], …].
 */
function buildZoneAliasIndex(eqemuRows = [], zonesJson = [], bossesJson = []) {
  const index  = new Map();
  const byLong = new Map();   // normalized long name, "the" stripped → ids
  const byShort = new Map();  // short_name → ids
  const add = (alias, ids) => {
    const n = _normText(alias);
    if (n.length < 3 || !ids?.length) return;
    const cur = index.get(n) || [];
    for (const id of ids) if (!cur.includes(id)) cur.push(id);
    index.set(n, cur.sort((a, b) => a - b));
  };
  const remember = (map, key, id) => {
    if (!key) return;
    const cur = map.get(key) || [];
    if (!cur.includes(id)) cur.push(id);
    map.set(key, cur.sort((a, b) => a - b));
  };
  for (const row of (Array.isArray(eqemuRows) ? eqemuRows : [])) {
    const id = Number(row?.[0]);
    if (!Number.isFinite(id) || id <= 0) continue;
    const short = _normText(row?.[1]);
    const long  = _stripThe(_normText(String(row?.[2] || '').replace(/\s*\((instanced|alt|alternate)\)\s*$/i, '')));
    if (long) remember(byLong, long, id);
    if (short && !_SHORT_STOP.has(short)) remember(byShort, short, id);
  }
  for (const [long, ids] of byLong) { add(long, ids); add('the ' + long, ids); }
  for (const [short, ids] of byShort) add(short, ids);
  for (const z of (Array.isArray(zonesJson) ? zonesJson : [])) {
    const ids = byLong.get(_stripThe(_normText(z?.name))) || byShort.get(_normText(z?.shortName));
    if (!ids) continue;
    add(z.name, ids); add(z.shortName, ids);
    for (const a of (Array.isArray(z?.aliases) ? z.aliases : [])) add(a, ids);
  }
  for (const b of (Array.isArray(bossesJson) ? bossesJson : [])) {
    const ids = byLong.get(_stripThe(_normText(b?.zone)));
    if (!ids) continue;
    add(b.name, ids);
    for (const nick of (Array.isArray(b?.nicknames) ? b.nicknames : [])) add(nick, ids);
  }
  return index;
}

/** Zone ids whose alias appears as a whole phrase in `text`. */
function zoneIdsInText(text, index) {
  if (!index || typeof index.entries !== 'function') return [];
  const t = ' ' + _normText(text) + ' ';
  if (t.trim() === '') return [];
  const out = new Set();
  for (const [alias, ids] of index) {
    if (t.includes(' ' + alias + ' ')) for (const id of ids) out.add(id);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * The event's zone(s): TITLE first, and only if the title names nothing the
 * description, then the location. Tiered, not unioned, on purpose — the Ring
 * War entry that started this read "Directly after Seru Mini heading to Great
 * Divide", so its description names BOTH zones and a union would have routed
 * every Seru kill to it all over again. A title is what the officer called
 * the event; a description is where they explain it.
 */
function zoneIdsForEvent(ev, index) {
  for (const field of [ev?.title, ev?.description, ev?.location]) {
    const ids = zoneIdsInText(field, index);
    if (ids.length) return ids;
  }
  return [];
}

/** Stamp `zoneIds` onto each event from its text. No index → leave as-is. */
function annotateZones(events, index) {
  const list = Array.isArray(events) ? events : [];
  if (!index) return list;
  for (const ev of list) if (ev) ev.zoneIds = zoneIdsForEvent(ev, index);
  return list;
}

const ZONE_INDEX_TTL_MS = 6 * 60 * MIN;
let _zoneIdx = null, _zoneIdxAt = 0, _zoneIdxInflight = null;

function _readData(name) {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', name), 'utf8')); }
  catch { return []; }
}

/**
 * The live vocabulary, built once per 6h from eqemu_zone + the two data files.
 * Fail-open: no Supabase → an index with no zone ids → every event un-zoned →
 * exactly today's nearest-start behaviour. An empty result is not cached, so
 * a transient failure retries on the next event refresh.
 */
async function zoneAliasIndex(nowMs = Date.now()) {
  if (_zoneIdx && nowMs - _zoneIdxAt < ZONE_INDEX_TTL_MS) return _zoneIdx;
  if (_zoneIdxInflight) return _zoneIdxInflight;
  _zoneIdxInflight = (async () => {
    let rows = [];
    try {
      const supabase = require('./supabase');
      if (supabase?.isEnabled?.()) {
        // ~200 rows — well under PostgREST's silent 1000-row cap.
        rows = await supabase.select('eqemu_zone', 'select=zone_id,short_name,long_name&order=zone_id.asc&limit=1000') || [];
      }
    } catch (err) { console.warn('[raid-events] eqemu_zone read failed:', err?.message); }
    const idx = buildZoneAliasIndex(
      rows.map(r => [r?.zone_id, r?.short_name, r?.long_name]), _readData('zones.json'), _readData('bosses.json'));
    if (idx.size) { _zoneIdx = idx; _zoneIdxAt = nowMs; }
    return _zoneIdx || idx;
  })().finally(() => { _zoneIdxInflight = null; });
  return _zoneIdxInflight;
}

/** Sync lookup against the loaded vocabulary (empty until the first refresh). */
function zoneIdsForText(text) { return _zoneIdx ? zoneIdsInText(text, _zoneIdx) : []; }
/** Test seam — install (or clear, with null) the vocabulary without Supabase. */
function _setZoneIndex(idx) { _zoneIdx = idx || null; _zoneIdxAt = idx ? Date.now() : 0; }

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
  let index = null;
  try { index = await zoneAliasIndex(nowMs); } catch { index = null; }
  annotateZones(merged, index);
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
 * `{ ...event, kind: 'raid'|'event', window }` — or null. `zoneId` (the kill's
 * eqemu zone id, optional) breaks a tie between overlapping events.
 */
async function activeEventAt(client, ts = Date.now(), zoneId = null) {
  const events = await knownEvents(client, Date.now());
  const ev = pickEventAt(events, ts, zoneId);
  if (!ev) return null;
  return { ...ev, kind: classifyEvent(ev, getDefaultTz()), window: windowFor(ev) };
}

/** Test seam. */
function _resetCache() { _sticky.clear(); _lastFetchAt = 0; _inflight = null; _zoneIdx = null; _zoneIdxAt = 0; _zoneIdxInflight = null; }
/** Test seam — inject events without touching Discord. */
function _seed(events, nowMs = Date.now()) { _rememberAll(events.map(normalizeEvent).filter(Boolean), nowMs); _lastFetchAt = nowMs; }

module.exports = {
  DEFAULT_RAID_DAYS, DEFAULT_RAID_FROM_HOUR, raidDays, raidFromMin,
  preMs, postMs, defaultLenMs, cacheMs,
  normalizeEvent, windowFor, windowContains, pickEventAt, classifyEvent,
  fetchDiscordEvents, fetchRaidHelperEvents, mergeEventSources,
  knownEvents, activeEventAt,
  buildZoneAliasIndex, zoneIdsInText, zoneIdsForEvent, annotateZones,
  zoneAliasIndex, zoneIdsForText,
  _resetCache, _seed, _setZoneIndex,
};
