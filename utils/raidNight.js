// utils/raidNight.js — "which raid night does this timestamp belong to?" plus
// the lazy per-night Discord thread that autoparses and loot posts land in.
//
// WHY A NIGHT KEY AND NOT A DATE
// The raid schedule is Sun/Wed/Thu 20:00 → 00:00 ET and raids routinely spill
// past midnight (the deploy freeze runs to 00:30 ET, and `_raidHoldNow` in
// index.js already treats Mon/Thu/Fri ≤ 00:30 as "the previous raid night").
// A plain calendar date therefore splits one raid across two buckets: a kill at
// 23:50 Thursday and the next pull at 00:20 Friday would land in two different
// threads. The night key shifts the instant back by ROLLOVER hours before
// formatting, so everything from a night's first pull through the small hours
// carries the date the night STARTED on.
//
// FORMAT REUSE — the label and key use the exact same `toLocaleDateString`
// option objects as `commands/raidnight.js` (`todayLabel` / `todayDateKey`),
// which now delegate here. There is one implementation of each format, so an
// auto-created night thread and an officer-run `/raidnight` thread agree on the
// name byte-for-byte and adopt each other instead of racing to create twins.
//
// Env:
//   RAID_NIGHT_THREADS=0        disable the whole feature (posting falls back
//                               to the pre-existing destinations)
//   RAID_NIGHT_THREAD_PARENT_ID parent channel for auto-created night threads
//                               (default: RAID_CHAT_CHANNEL_ID → TIMER_CHANNEL_ID)
//   RAID_NIGHT_ROLLOVER_HOUR    hour (0–12, local) a new night begins; default 6
//   RAID_NIGHT_THREAD_ID        hard pin every night to one thread (escape hatch)

const { getDefaultTz, partsInTzAt } = require('./timezone');

// Same three days as commands/raidnight.js RAID_DAYS and utils/timezone.js
// RAID_DAYS (which stores them as JS day numbers).
const RAID_DAY_NAMES = new Set(['sunday', 'wednesday', 'thursday']);

// 20:30 ET — identical to commands/raidnight.js isRaidNight() and
// utils/timezone.js RAID_WINDOW_START.
const RAID_START_MIN = 20 * 60 + 30;

const DEFAULT_ROLLOVER_HOUR = 6;

// ── Pure night-key helpers ───────────────────────────────────────────────────

function rolloverHour() {
  const n = parseInt(process.env.RAID_NIGHT_ROLLOVER_HOUR, 10);
  return Number.isInteger(n) && n >= 0 && n <= 12 ? n : DEFAULT_ROLLOVER_HOUR;
}

/** The instant used for naming/keying: `ts` pulled back over the rollover so a
 *  raid that runs past midnight keeps the date it started on. */
function nightAnchorMs(ts) {
  const at = Number.isFinite(ts) ? ts : Date.now();
  return at - rolloverHour() * 60 * 60 * 1000;
}

/** MM/DD/YYYY in the default tz — the format commands/raidnight.js stores as
 *  `raidSession.date`. Do NOT change without changing that too. */
function dateKeyForMs(ms) {
  return new Date(ms).toLocaleDateString('en-US', {
    timeZone: getDefaultTz(), year: 'numeric', month: '2-digit', day: '2-digit',
  });
}

/** "Thursday, July 31, 2026" — the format /raidnight puts in thread names. */
function labelForMs(ms) {
  return new Date(ms).toLocaleDateString('en-US', {
    timeZone: getDefaultTz(), weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

/** Stable id for the raid night a timestamp belongs to (MM/DD/YYYY). */
function nightKey(ts)   { return dateKeyForMs(nightAnchorMs(ts)); }

/** Human label for that same night. */
function nightLabel(ts) { return labelForMs(nightAnchorMs(ts)); }

/**
 * Is `ts` inside an official raid night? Evaluated against the night it
 * belongs to, so 00:20 Friday is still Thursday's raid night.
 */
function isRaidNightAt(ts) {
  const tz     = getDefaultTz();
  const at     = Number.isFinite(ts) ? ts : Date.now();
  const anchor = partsInTzAt(nightAnchorMs(at), tz);
  if (!RAID_DAY_NAMES.has(anchor.dayOfWeek)) return false;
  const p = partsInTzAt(at, tz);
  // Same calendar day as the anchor → must be at/after the 20:30 start.
  // Different day → we're in the post-midnight spillover of that night.
  if (p.dayOfWeek === anchor.dayOfWeek) return (p.hour * 60 + p.minute) >= RAID_START_MIN;
  return true;
}

/** Thread name — identical construction to commands/raidnight.js execute(). */
function nightThreadName(ts) {
  return (isRaidNightAt(ts) ? '🗡️ Raid Night — ' : '⚔️ Kill Log — ') + nightLabel(ts);
}

function raidNightThreadsEnabled() {
  return String(process.env.RAID_NIGHT_THREADS ?? '1') !== '0';
}

// ── Lazy per-night Discord thread ────────────────────────────────────────────
// Created on the FIRST parse/loot post of the night, then cached — never one
// API call per post. Concurrent agent uploads share a single in-flight resolve
// so two parsers finishing the same pull can't create twin threads.

const _mem       = new Map();   // nightKey → thread id
const _inflight  = new Map();   // nightKey → Promise<Thread|null>
const _failedAt  = new Map();   // nightKey → ms of last failed resolve
const FAIL_BACKOFF_MS = 60_000;

function _remember(key, id) {
  _mem.set(key, id);
  _failedAt.delete(key);
  try { require('./state').setRaidNightThreadId(key, id); } catch { /* volume issue — memory cache still holds */ }
}

async function _fetchPostable(client, id) {
  if (!id) return null;
  const ch = await client.channels.fetch(id).catch(() => null);
  return (ch && typeof ch.send === 'function') ? ch : null;
}

async function _resolveParent(client) {
  const ids = [
    process.env.RAID_NIGHT_THREAD_PARENT_ID,
    process.env.RAID_CHAT_CHANNEL_ID,
    process.env.TIMER_CHANNEL_ID,
  ].filter(Boolean);
  for (const id of ids) {
    const ch = await client.channels.fetch(id).catch(() => null);
    if (ch && ch.threads && typeof ch.threads.create === 'function') return ch;
  }
  return null;
}

async function _resolve(client, key, ts) {
  // 1. Anchor: env pin → memory → channelSlots. Survives restarts.
  let cached = _mem.get(key);
  if (!cached) {
    try { cached = require('./state').getRaidNightThreadId(key); } catch { cached = null; }
  }
  const fromCache = await _fetchPostable(client, cached);
  if (fromCache) { _mem.set(key, fromCache.id); return fromCache; }

  // 2. An officer-opened /raidnight session for this same night IS the night
  //    thread — adopt it rather than creating a second one. (raidSession.date
  //    is todayDateKey(), which matches nightKey for the night it was opened,
  //    including after midnight.)
  try {
    const session = require('./state').getRaidSession();
    if (session?.threadId && session.date === key) {
      const ch = await _fetchPostable(client, session.threadId);
      if (ch) { _remember(key, ch.id); return ch; }
    }
  } catch { /* fall through */ }

  const parent = await _resolveParent(client);
  if (!parent) return null;
  const name = nightThreadName(ts);

  // 3. Discord is the real source of truth — after a volume wipe the thread is
  //    still there under the same name. Same lookup /raidnight uses.
  try {
    const active   = await parent.threads.fetchActive();
    const existing = active.threads.find(t => t.name === name);
    if (existing) { _remember(key, existing.id); return existing; }
  } catch { /* fall through to create */ }

  // 4. Create it.
  const thread = await parent.threads.create({
    name, autoArchiveDuration: 1440, reason: 'Raid night thread (auto)',
  });
  _remember(key, thread.id);
  console.log(`[raid-night] opened thread "${name}" (${thread.id}) in ${parent.id}`);
  return thread;
}

/**
 * Thread for the raid night containing `ts` (default: now), or null when the
 * feature is off / no parent channel is configured / Discord refused.
 * ALWAYS best-effort — every caller must have a fallback destination.
 */
async function getRaidNightThread(client, ts) {
  if (!raidNightThreadsEnabled() || !client) return null;
  const key = nightKey(ts);

  const hot = _mem.get(key);
  if (hot) {
    const ch = await _fetchPostable(client, hot);
    if (ch) return ch;
    _mem.delete(key);           // stale (deleted thread) — re-resolve below
  }

  const failed = _failedAt.get(key);
  if (failed && (Date.now() - failed) < FAIL_BACKOFF_MS) return null;

  if (_inflight.has(key)) return _inflight.get(key);
  const p = _resolve(client, key, ts)
    .catch(err => { console.warn('[raid-night] thread resolve failed:', err?.message); return null; })
    .then(ch => { if (!ch) _failedAt.set(key, Date.now()); return ch; })
    .finally(() => { _inflight.delete(key); });
  _inflight.set(key, p);
  return p;
}

/** Test seam — drops the in-process caches. */
function _resetCache() { _mem.clear(); _inflight.clear(); _failedAt.clear(); }

module.exports = {
  RAID_DAY_NAMES, RAID_START_MIN,
  rolloverHour, nightAnchorMs, dateKeyForMs, labelForMs,
  nightKey, nightLabel, isRaidNightAt, nightThreadName,
  raidNightThreadsEnabled, getRaidNightThread, _resetCache,
};
