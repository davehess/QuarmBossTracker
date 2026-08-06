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
// ── v2 (Hitya 2026-07-31) ───────────────────────────────────────────────────
// Three things changed after the first night in the field:
//
// 1. WRONG CHANNEL. v1's parent chain was
//    RAID_NIGHT_THREAD_PARENT_ID → RAID_CHAT_CHANNEL_ID → TIMER_CHANNEL_ID,
//    and BOTH of the first two are unset on Railway (`.env.example` ships
//    RAID_CHAT_CHANNEL_ID empty, and index.js's Harmonic-Howl announcer already
//    carries the comment "the id was never captured as an env"). So every
//    thread fell through to TIMER_CHANNEL_ID = #raid-mobs. Railway's own logs
//    are the proof: `[raid-night] opened thread … in 1496263398495621302`.
//    Fix: a known-id default for #raid-chat, a permission precheck, and a log
//    line that says WHY a candidate was skipped.
//
// 2. EVENT-DRIVEN WINDOWS, not weekdays. The posting window now comes from the
//    guild's Discord scheduled events (utils/raidEvents.js): 30 min before the
//    planned start through 15 min after the scheduled end.
//
// 3. TWO FLOWS. A raid night threads in #raid-chat and keeps the DKP loot
//    posts. A non-raid guild event threads in #event-chat and gets the
//    roll-loot content instead (no DKP) — see utils/rollLoot.js.
//
// Env:
//   RAID_NIGHT_THREADS=0        disable the whole feature (posting falls back
//                               to the pre-existing destinations)
//   RAID_NIGHT_THREAD_PARENT_ID parent channel for raid-night threads
//                               (default: RAID_CHAT_CHANNEL_ID → #raid-chat)
//   EVENT_CHAT_CHANNEL_ID       parent channel for non-raid event threads
//                               (default: #event-chat)
//   RAID_NIGHT_ROLLOVER_HOUR    hour (0–12, local) a new night begins; default 6
//   RAID_NIGHT_THREAD_ID        hard pin every night to one thread (escape hatch)
//   RAID_NIGHT_FALLBACK         what to do OUTSIDE any scheduled event window:
//                                 'schedule' (default) — v1 behaviour, but only
//                                   during the Sun/Wed/Thu 20:30+ raid window
//                                 'always' — v1 behaviour at any hour
//                                 'off'    — no thread; classic destinations
//   RAID_NIGHT_THREAD_MIN_SECONDS / _MIN_PLAYERS / _BOSS_ONLY — volume knobs,
//                               see parseCardPassesFilter()

const { getDefaultTz, partsInTzAt } = require('./timezone');

// Known channel ids for the Wolf Pack guild. Env always wins; these exist so a
// thread lands in the RIGHT place on a box where the env was never set — which
// is exactly what went wrong on night one. Same pattern index.js already uses
// for LOOT_CHANNEL_ID / MIMIC_RELEASE_CHANNEL_ID.
const DEFAULT_RAID_CHAT_ID  = '1193692008812920863';   // #raid-chat
const DEFAULT_EVENT_CHAT_ID = '1194336972785848380';   // #event-chat

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

/** 'schedule' | 'always' | 'off' — behaviour outside any scheduled window. */
function fallbackMode() {
  const v = String(process.env.RAID_NIGHT_FALLBACK || 'schedule').toLowerCase();
  return (v === 'always' || v === 'off') ? v : 'schedule';
}

/** Thread name for a non-raid guild event. */
function eventThreadName(ev) {
  const title = String(ev?.title || 'Guild event').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `🎲 ${title} — ${labelForMs(nightAnchorMs(ev?.startMs))}`;
}

// ── Volume knob (Hitya 2026-07-31) ───────────────────────────────────────────
// Night one flooded the thread with 1-player/1-second trash cards ("an eternal
// golem, 16 dmg"). A card reaches the night/event thread when it is a KNOWN
// BOSS, or when it clears both floors. The canonical '📊 Parse Log' record and
// Supabase are NOT filtered — this only decides what raiders read.
//
// ⚑ DEFAULT CHOSEN, FLAG FOR HITYA: 15s + 3 players. That kills the golem
// spam while keeping every real pull (a 3-player 15s fight is already a
// deliberate engagement). RAID_NIGHT_THREAD_BOSS_ONLY=1 for the strictest
// setting; MIN_SECONDS=0 + MIN_PLAYERS=0 restores v1 "post everything".
function _minInt(name, dflt) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}
function parseCardPassesFilter({ durationSec = 0, playerCount = 0, isBoss = false } = {}) {
  if (String(process.env.RAID_NIGHT_THREAD_BOSS_ONLY || '0') === '1') return !!isBoss;
  if (isBoss) return true;
  return durationSec >= _minInt('RAID_NIGHT_THREAD_MIN_SECONDS', 15)
      && playerCount  >= _minInt('RAID_NIGHT_THREAD_MIN_PLAYERS', 3);
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

// Can the bot actually open + post in a thread here? A candidate that fetches
// fine but lacks Create Public Threads is exactly how night one silently
// slid down to #raid-mobs, so we check and SAY SO instead of falling through
// quietly. Fail-open: if the permission model can't be evaluated (no
// permissionsFor, no client user, discord.js not loadable) we accept.
function _canOpenThreadIn(ch, client) {
  let flags;
  try { ({ PermissionFlagsBits: flags } = require('discord.js')); } catch { return { ok: true }; }
  const me = client?.user;
  if (!me || typeof ch?.permissionsFor !== 'function') return { ok: true };
  let perms;
  try { perms = ch.permissionsFor(me); } catch { return { ok: true }; }
  if (!perms) return { ok: true };
  const need = [
    ['View Channel',         flags.ViewChannel],
    ['Send Messages',        flags.SendMessages],
    ['Create Public Threads', flags.CreatePublicThreads],
    ['Send Messages in Threads', flags.SendMessagesInThreads],
  ];
  const missing = need.filter(([, bit]) => bit != null && !perms.has(bit)).map(([n]) => n);
  return missing.length ? { ok: false, missing } : { ok: true };
}

/**
 * Parent channel for a thread of `kind`, walking the anchor chain and logging
 * every rejection with its reason. Chain (env always wins):
 *   raid  → RAID_NIGHT_THREAD_PARENT_ID → RAID_CHAT_CHANNEL_ID → #raid-chat
 *           → TIMER_CHANNEL_ID (last-ditch)
 *   event → EVENT_CHAT_CHANNEL_ID → #event-chat → the raid chain
 */
async function _resolveParent(client, kind = 'raid') {
  const raidChain = [
    ['RAID_NIGHT_THREAD_PARENT_ID', process.env.RAID_NIGHT_THREAD_PARENT_ID],
    ['RAID_CHAT_CHANNEL_ID',        process.env.RAID_CHAT_CHANNEL_ID],
    ['#raid-chat (known id)',       DEFAULT_RAID_CHAT_ID],
    ['TIMER_CHANNEL_ID',            process.env.TIMER_CHANNEL_ID],
  ];
  const eventChain = [
    ['EVENT_CHAT_CHANNEL_ID',  process.env.EVENT_CHAT_CHANNEL_ID],
    ['#event-chat (known id)', DEFAULT_EVENT_CHAT_ID],
    ...raidChain,
  ];
  const chain = (kind === 'event' ? eventChain : raidChain).filter(([, id]) => !!id);
  for (const [label, id] of chain) {
    const ch = await client.channels.fetch(id).catch(err => {
      console.warn(`[raid-night] parent ${label} (${id}) unreachable: ${err?.message}`);
      return null;
    });
    if (!ch) continue;
    if (!ch.threads || typeof ch.threads.create !== 'function') {
      console.warn(`[raid-night] parent ${label} (${id}) can't host threads — skipping`);
      continue;
    }
    const perm = _canOpenThreadIn(ch, client);
    if (!perm.ok) {
      console.warn(`[raid-night] parent ${label} (${id}) missing ${perm.missing.join(', ')} — skipping`);
      continue;
    }
    return ch;
  }
  return null;
}

async function _resolve(client, plan) {
  const { key, name, kind } = plan;

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
  //    including after midnight.) Raid flow only: a social event must never
  //    swallow the raid session's thread.
  if (kind === 'raid') {
    try {
      const session = require('./state').getRaidSession();
      if (session?.threadId && session.date === plan.nightKey) {
        const ch = await _fetchPostable(client, session.threadId);
        if (ch) { _remember(key, ch.id); return ch; }
      }
    } catch { /* fall through */ }
  }

  const parent = await _resolveParent(client, kind);
  if (!parent) { console.warn(`[raid-night] no usable parent channel for a ${kind} thread`); return null; }

  // 3. Discord is the real source of truth — after a volume wipe the thread is
  //    still there under the same name. Same lookup /raidnight uses.
  try {
    const active   = await parent.threads.fetchActive();
    const existing = active.threads.find(t => t.name === name);
    if (existing) { _remember(key, existing.id); return existing; }
  } catch { /* fall through to create */ }

  // 4. Create it.
  const thread = await parent.threads.create({
    name, autoArchiveDuration: 1440,
    reason: kind === 'event' ? 'Guild event thread (auto)' : 'Raid night thread (auto)',
  });
  _remember(key, thread.id);
  console.log(`[raid-night] opened ${kind} thread "${name}" (${thread.id}) in ${parent.id} · ${plan.why}`);

  // Hold the top of the thread for the night's review (R3, Uilnayar
  // 2026-08-06 — "/raidreview posted to the third line"). Discord orders by
  // post time and cannot move a message, so first-in-thread is a one-shot
  // opportunity that exists ONLY here, before the first parse card lands.
  // Raid nights only; a social event thread gets no review. Lazily required
  // because raidReview already requires this module.
  if (kind === 'raid') {
    try {
      await require('./raidReview').reserveReviewSlots(thread, plan.nightKey);
    } catch (err) {
      // A thread without reserved slots still works — the review just posts
      // wherever it lands. Never fail thread creation over cosmetics.
      console.warn('[raid-night] could not reserve review slots:', err?.message);
    }
  }
  return thread;
}

/**
 * Decide WHICH thread a timestamp wants, without touching Discord's thread API.
 * Returns `{ key, name, kind, nightKey, why, event }` or null when nothing
 * should be posted to a night/event thread at all.
 */
// Resolved once and injectable, so a test can seed events without reaching
// through require() (vitest's ESM import and this require() are different
// module instances otherwise).
let _eventsMod = null;
function _events() { return _eventsMod || (_eventsMod = require('./raidEvents')); }
function _setEventsModule(m) { _eventsMod = m; }

async function planFor(client, ts) {
  const at = Number.isFinite(ts) ? ts : Date.now();
  let ev = null;
  try { ev = await _events().activeEventAt(client, at); } catch { ev = null; }

  if (ev) {
    if (ev.kind === 'event') {
      return {
        kind:  'event',
        key:   `evt_${String(ev.id).replace(/\W+/g, '_')}`,
        name:  eventThreadName(ev),
        nightKey: nightKey(ev.startMs),
        why:   `event window ${new Date(ev.window.fromMs).toISOString()} → ${new Date(ev.window.untilMs).toISOString()}`,
        event: ev,
      };
    }
    // Raid event → the per-night key, so this thread and an officer's
    // /raidnight thread for the same night are the SAME thread.
    return {
      kind:  'raid',
      key:   nightKey(ev.startMs),
      name:  '🗡️ Raid Night — ' + nightLabel(ev.startMs),
      nightKey: nightKey(ev.startMs),
      why:   `raid event "${ev.title}" window ${new Date(ev.window.fromMs).toISOString()} → ${new Date(ev.window.untilMs).toISOString()}`,
      event: ev,
    };
  }

  // No scheduled event covers this timestamp.
  const mode = fallbackMode();
  if (mode === 'off') return null;
  if (mode === 'schedule' && !isRaidNightAt(at)) return null;
  return {
    kind: 'raid',
    key:  nightKey(at),
    name: nightThreadName(at),
    nightKey: nightKey(at),
    why:  `no scheduled event — fallback:${mode}`,
    event: null,
  };
}

/**
 * Where should a post for `ts` go? `{ thread, kind, event }` — `thread` is null
 * (and kind null) when the feature is off, nothing is scheduled, or Discord
 * refused. ALWAYS best-effort: every caller must have a fallback destination.
 */
async function getRaidNightTarget(client, ts) {
  const none = { thread: null, kind: null, event: null };
  if (!raidNightThreadsEnabled() || !client) return none;

  const plan = await planFor(client, ts).catch(() => null);
  if (!plan) return none;
  const { key } = plan;

  const hot = _mem.get(key);
  if (hot) {
    const ch = await _fetchPostable(client, hot);
    if (ch) return { thread: ch, kind: plan.kind, event: plan.event };
    _mem.delete(key);           // stale (deleted thread) — re-resolve below
  }

  const failed = _failedAt.get(key);
  if (failed && (Date.now() - failed) < FAIL_BACKOFF_MS) return none;

  let p = _inflight.get(key);
  if (!p) {
    p = _resolve(client, plan)
      .catch(err => { console.warn('[raid-night] thread resolve failed:', err?.message); return null; })
      .then(ch => { if (!ch) _failedAt.set(key, Date.now()); return ch; })
      .finally(() => { _inflight.delete(key); });
    _inflight.set(key, p);
  }
  const thread = await p;
  return thread ? { thread, kind: plan.kind, event: plan.event } : none;
}

/**
 * Back-compat wrapper — the thread only. Callers that must know whether this is
 * the raid flow or the off-night event flow use getRaidNightTarget().
 */
async function getRaidNightThread(client, ts) {
  return (await getRaidNightTarget(client, ts)).thread;
}

/** Test seam — drops the in-process caches. */
function _resetCache() { _mem.clear(); _inflight.clear(); _failedAt.clear(); }

module.exports = {
  RAID_DAY_NAMES, RAID_START_MIN, DEFAULT_RAID_CHAT_ID, DEFAULT_EVENT_CHAT_ID,
  rolloverHour, nightAnchorMs, dateKeyForMs, labelForMs,
  nightKey, nightLabel, isRaidNightAt, nightThreadName, eventThreadName,
  fallbackMode, parseCardPassesFilter, planFor,
  raidNightThreadsEnabled, getRaidNightThread, getRaidNightTarget,
  _resetCache, _setEventsModule,
};
