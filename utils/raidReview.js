// utils/raidReview.js — [#80] the Raid Night Review.
//
// The morning-after writeup of a raid night, generated instead of hand-built,
// posted into THAT NIGHT'S Discord thread and linked to the /raid/review page
// that already exists on the website.
//
// Design + the content decisions (what's in, what's deliberately cut, and why):
// docs/DESIGN-80-raid-night-review.md. Two rules from that doc are load-bearing
// and easy to break by accident:
//
//  1. THE THREAD IS RESOLVED BY THE NIGHT'S FIRST-ENCOUNTER TIMESTAMP, never by
//     Date.now(). utils/raidNight.js keys a thread off the scheduled-event
//     window that was open when the fight happened; by the time the review runs
//     (≈00:45) that window has closed, so "now" can plan a DIFFERENT key and
//     mint a second thread. The first encounter's start is by construction
//     inside the window that opened the thread, so planFor returns the same key
//     and _resolve hits its cache / by-name adoption path.
//
//  2. NOTHING HERE MAY BREAK THE MIDNIGHT CHAIN. scheduleRaidNightReview() and
//     catchUpRaidNightReview() are synchronous, swallow everything, and never
//     await the network — they hand the actual work to a timer. A failed review
//     must never stop archives, parse consolidation, or the nightly resets.
//
// Layers (kept separate so the whole review is unit-testable with no Discord
// and no network — see test/raid-review-post.test.js):
//     pure   nightWindowFor / mostRecentReviewableNight / summarizeNight /
//            renderReviewEmbeds
//     fetch  collectNightData        (bounded, best-effort Supabase selects)
//     post   postRaidNightReview / scheduleRaidNightReview / catchUpRaidNightReview
//     live   noteEncounterUpload / touchLiveRaidReview   (the ingest-side hooks)
//
// ── LIVE (docs/DESIGN-live-raid-review.md) ──────────────────────────────────
// The same card is written DURING the raid and grows into the morning-after
// review. Three rules keep that safe:
//
//  3. THE LIVE CARD IS THE SAME MESSAGE. It uses the same `rreview_<nightKey>`
//     slot, so the 00:45 post EDITS the live card into the final one. There is
//     never a second message, and never a notification (Discord edits are
//     silent).
//  4. THE INGEST PATH CONTRIBUTES A SIGNAL, NEVER DATA. `touchLiveRaidReview`
//     only marks the night dirty; every number still comes from the same
//     bounded reads + summarizeNight. Re-deriving kills/deaths from the raw
//     upload would invent a SECOND count that disagrees with the parse card
//     and the web page — the exact failure the death-dedup rules exist to
//     prevent. The one exception is the trash tally, which has no durable
//     source at all (see below).
//  5. IT CANNOT REACH THE UPLOAD. Both ingest hooks are synchronous,
//     try/caught, and never awaited; the refresh itself runs on a timer.
//
// TRASH: `encounters` is boss-only by construction — supabase.recordParse
// no-ops unless the mob has a `bosses_local` row (verified 2026-08-02: all
// 1521 encounter rows have one, and bosses_local holds only the 128 tracked
// bosses). So trash kills exist ONLY in the upload stream. We tally them here,
// dedup'd across uploaders, and persist to `bot_kv` (durable across restarts,
// and readable by the web review) on the same throttled cadence as the card.
//
// Env:
//   RAID_REVIEW=0             disable the automatic post (the /raidreview
//                             command still works) — the kill switch
//   RAID_REVIEW_DELAY_MIN     minutes after midnight to post; default 45, which
//                             clears the 00:30 raid tail
//   RAID_REVIEW_CATCHUP_HOURS how stale a night the boot catch-up still posts
//                             (default 36)
//   RAID_REVIEW_MIN_KILLS     below this many confirmed kills, no review (1)
//   RAID_REVIEW_LIVE=0        disable the LIVE card only (the 00:45 review and
//                             /raidreview keep working) — the mid-raid kill switch
//   RAID_REVIEW_LIVE_DEBOUNCE_SEC  quiet period after the last upload before a
//                             refresh runs; default 60 (one kill arrives from
//                             ~20 agents over ~30s — they collapse into one edit)
//   RAID_REVIEW_LIVE_MIN_SEC  floor between two live edits; default 300

const { EmbedBuilder } = require('discord.js');
const { getDefaultTz, partsInTzAt, localToUTC } = require('./timezone');
const raidNight = require('./raidNight');
const { dedupParseDeaths } = require('./parseDeaths');

// Same thresholds web/lib/anomalies.ts uses to auto-hide a foreign raid from
// /parses. Duplicated (not imported — that's a .ts ESM module) so the review and
// the site agree on which encounters are ours; keep the two in sync.
const AUTO_FOREIGN_MAX_MEMBER_FRAC = 0.34;
const AUTO_FOREIGN_MIN_PLAYERS     = 10;

// Cross-encounter death collapse. find_or_create_encounter's ±30min window means
// adds and boss pulls OVERLAP, so one death lands in two encounters'
// contributions. Guild lead's rule: "assume people can't die twice in the same
// minute." Mirrors dedupNightDeaths in web/lib/raidReview.ts.
const NIGHT_DEATH_DEDUP_MS = 60_000;

function _int(name, dflt, min = 0) {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n >= min ? n : dflt;
}
function reviewEnabled()   { return String(process.env.RAID_REVIEW ?? '1') !== '0'; }
function reviewDelayMin()  { return _int('RAID_REVIEW_DELAY_MIN', 45); }
function catchupHours()    { return _int('RAID_REVIEW_CATCHUP_HOURS', 36); }
function minKills()        { return _int('RAID_REVIEW_MIN_KILLS', 1, 0); }
// Live card: enabled independently of the automatic 00:45 post, so the mid-raid
// half can be switched off without losing the morning-after writeup.
function liveEnabled()     { return reviewEnabled() && String(process.env.RAID_REVIEW_LIVE ?? '1') !== '0'; }
function liveDebounceMs()  { return _int('RAID_REVIEW_LIVE_DEBOUNCE_SEC', 60, 5) * 1000; }
function liveMinIntervalMs(){ return _int('RAID_REVIEW_LIVE_MIN_SEC', 300, 30) * 1000; }

// A fight counts as "in progress" while it is unconfirmed AND started inside
// this window. Longer than the agent's 120s idle flush plus a slow Emperor
// (17.8 min on 2026-07-30), short enough that an abandoned pull stops claiming
// the raid is mid-fight.
const LIVE_ENGAGED_WINDOW_MS = 25 * 60_000;

// ── Pure: the night window ───────────────────────────────────────────────────

/** ms since epoch for `hour:00` local on the calendar day containing `ms`.
 *  Uses timezone.localToUTC (the same DST-corrected conversion /announce and
 *  the raid-window math use) rather than arithmetic on the wall clock. */
function _localHourMs(ms, hour) {
  const tz = getDefaultTz();
  const p  = partsInTzAt(ms, tz);
  return localToUTC(p.year, p.month, p.day, hour, 0, tz).getTime();
}

/**
 * The [from, to) window of the raid night that `ts` belongs to, plus the keys
 * every surface needs. A night runs rollover→rollover (06:00 → 06:00 by
 * default), which is exactly the set of fights that landed in its thread.
 */
function nightWindowFor(ts) {
  const at     = Number.isFinite(ts) ? ts : Date.now();
  const anchor = raidNight.nightAnchorMs(at);         // pulled back over rollover
  const roll   = raidNight.rolloverHour();
  const fromMs = _localHourMs(anchor, roll);
  return {
    fromMs,
    toMs:     fromMs + 24 * 3_600_000,
    nightKey: raidNight.nightKey(at),                 // MM/DD/YYYY (thread key)
    label:    raidNight.nightLabel(at),               // "Thursday, July 30, 2026"
    dateKey:  isoDateKey(anchor),                     // YYYY-MM-DD (web + OpenDKP)
  };
}

/** YYYY-MM-DD in the default tz — the key /raid/review and opendkp_raids use. */
function isoDateKey(ms) {
  const p = partsInTzAt(ms, getDefaultTz());
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * The most recent night that is OVER and therefore reviewable at `nowMs`.
 *
 * A night's review is due at (the midnight that ends it) + delay. If `now` is
 * still before that, the current night key isn't reviewable yet and we step
 * back one day. Returns null when even that night is older than the catch-up
 * horizon — a bot that was down for a week must not post an ancient review.
 */
function mostRecentReviewableNight(nowMs = Date.now(), { horizonHours = catchupHours() } = {}) {
  const w      = nightWindowFor(nowMs);
  // The night ends at its own rollover; its review is due `delay` past the
  // MIDNIGHT inside that window (rollover 6 ⇒ midnight is 18h into the window).
  const dueMs  = w.fromMs + (24 - raidNight.rolloverHour()) * 3_600_000 + reviewDelayMin() * 60_000;
  const target = nowMs >= dueMs ? w : nightWindowFor(w.fromMs - 3_600_000);
  const endedMs = target.fromMs + (24 - raidNight.rolloverHour()) * 3_600_000;   // its midnight
  if (horizonHours > 0 && (nowMs - endedMs) > horizonHours * 3_600_000) return null;
  return target;
}

// ── Pure: formatting helpers ─────────────────────────────────────────────────

function cleanBossName(raw) {
  if (!raw) return 'Unknown';
  return String(raw).replace(/^#/, '').replace(/_/g, ' ').trim() || 'Unknown';
}
function fmtDmg(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(0)}k`;
  return String(v);
}
function fmtDur(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}
/** A long span in plain words — "44m", "1h 12m". fmtDur's mm:ss reads as a
 *  fight length; anything measured in tens of minutes needs this instead. */
function fmtSpan(sec) {
  const m = Math.max(0, Math.round((Number(sec) || 0) / 60));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
function fmtClock(ms) {
  const p = partsInTzAt(ms, getDefaultTz());
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h12}:${String(p.minute).padStart(2, '0')}${p.hour < 12 ? 'a' : 'p'}`;
}
/** Discord field values cap at 1024 — trim on a line boundary, never mid-word. */
function clampLines(lines, max = 1024, moreLabel = 'more') {
  const out = [];
  let len = 0, dropped = 0;
  for (const l of lines) {
    if (len + l.length + 1 > max - 24) { dropped++; continue; }
    out.push(l); len += l.length + 1;
  }
  if (dropped) out.push(`_…and ${dropped} ${moreLabel}_`);
  return out.join('\n');
}

/** Discord relative timestamp — renders as "3 minutes ago" and keeps ticking on
 *  every client with NO further edits. That is what lets the live card show
 *  "last kill 6m ago" at a 5-minute refresh cadence without lying. */
function relTime(ms) { return `<t:${Math.floor(ms / 1000)}:R>`; }

// ── Pure: the Discord fight timeline (#98's shape, in a code span) ───────────
// FightTimeline.tsx can't be rendered in Discord, so the strip is its honest
// one-line analogue: the SAME substrate (deaths over the fight's duration),
// binned into fixed cells with the bar height as the death count. The web
// review renders the real component; this is the pointer to it.
const TIMELINE_CELLS = 12;
const _STRIP = ['▁', '▂', '▅', '█'];      // 0 · 1 · 2–3 · 4+
// Slack either side of a fight for "did this death happen in this fight" —
// covers pull-time deaths and clock skew between uploaders without admitting
// the ±30min encounter-dedup spill.
const TIMELINE_GRACE_MS = 30_000;

function deathStrip(deathTimesMs, startMs, durationMs, cells = TIMELINE_CELLS) {
  const span = Math.max(1, durationMs);
  const bins = new Array(cells).fill(0);
  for (const t of (deathTimesMs || [])) {
    const frac = (t - startMs) / span;
    if (!Number.isFinite(frac)) continue;
    const i = Math.min(cells - 1, Math.max(0, Math.floor(frac * cells)));
    bins[i] += 1;
  }
  return bins.map(n => _STRIP[n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : 3]).join('');
}

// ── Trash tally (in memory + bot_kv) ─────────────────────────────────────────
// See the header: `encounters` never holds a trash mob, so the ONLY source is
// the upload stream. Keyed per night; each entry is one deduped kill.
//
// Dedup: ~20 agents upload the same trash kill within a few seconds of each
// other with slightly different start times, so the key is
// `<lowercased name>|<30s bucket>` and the neighbouring buckets are probed too
// (a kill at a bucket boundary must not count twice). Damage is MAX-kept per
// kill, mirroring merge_encounter_players — a thin observer never lowers a
// total a better-placed one already reported.
const TRASH_BUCKET_MS = 30_000;
const TRASH_MAX_ENTRIES = 5000;        // hard cap: a runaway agent can't grow this forever
const TRASH_PERSIST_ENTRIES = 2000;    // cap on what we round-trip through bot_kv

const _trash = new Map();   // nightKey → { entries: Map<key,{name,damage,sec,atMs}>, loaded, dirty }

function _trashBucket(nightKey) {
  let t = _trash.get(nightKey);
  if (!t) { t = { entries: new Map(), loaded: false, dirty: false }; _trash.set(nightKey, t); }
  return t;
}
function _trashKey(name, atMs, bucketOffset = 0) {
  return `${String(name).toLowerCase()}|${Math.round(atMs / TRASH_BUCKET_MS) + bucketOffset}`;
}

/**
 * Record ONE observed non-boss kill. Synchronous, never throws — it is called
 * from the agent-upload handler after the 200 has gone back.
 * Returns 'added' | 'merged' | 'skipped'.
 */
function noteTrashKill({ atMs, name, damage = 0, durationSec = 0 } = {}) {
  try {
    const at = Number(atMs);
    const nm = String(name || '').trim();
    if (!nm || !Number.isFinite(at)) return 'skipped';
    // Must have happened DURING the raid. nightKey() alone buckets by night, so
    // anything a raider killed earlier that same day — a lunchtime XP group, a
    // solo camp — landed in the night's tally and got reported as raid trash.
    // That is how "Trash cleared" showed 967 mobs and 9h22m of combat for a
    // 1h48m raid, topped by named mobs the raid never touched (2026-08-02).
    // Same predicate the kills path already uses (see the pace calc above), so
    // bosses and trash now agree on what "during the raid" means.
    if (!raidNight.isRaidNightAt(at)) return 'skipped';
    const key = raidNight.nightKey(at);
    const t = _trashBucket(key);
    for (const off of [0, -1, 1]) {
      const k = _trashKey(nm, at, off);
      const hit = t.entries.get(k);
      if (hit) {
        if (damage > hit.damage) { hit.damage = damage; t.dirty = true; }
        if (durationSec > hit.sec) { hit.sec = durationSec; t.dirty = true; }
        return 'merged';
      }
    }
    if (t.entries.size >= TRASH_MAX_ENTRIES) return 'skipped';
    t.entries.set(_trashKey(nm, at), { name: nm, damage: Number(damage) || 0, sec: Number(durationSec) || 0, atMs: at });
    t.dirty = true;
    return 'added';
  } catch { return 'skipped'; }
}

// How long after the night's LAST CONFIRMED KILL trash still counts as raid
// trash.
//
// Deliberately TIGHTER than web/lib/raidReview.ts activitySpan()'s 30-minute
// pad. That pad exists to keep a fight's own slows/fires from being clipped at
// the edges, so erring wide is free. This one decides membership — what the
// raid cleared vs. what a group went off and did afterwards — so erring wide
// costs us the exact bug being fixed. Uilnayar set 15 (2026-08-06): "15 minutes
// gives us plenty of time", the line being the last DKP tick, after which
// "anything beyond that is trash that shouldn't be included."
const TRASH_TAIL_GRACE_MIN = Number(process.env.RAID_REVIEW_TRASH_TAIL_GRACE_MIN) || 15;

/**
 * The night's real fight span, for bounding the trash tally.
 * [first pull − grace, last CONFIRMED kill + grace].
 *
 * Returns {} when nothing has been killed yet, which matters mid-raid: bounding
 * to a last kill that does not exist would zero out legitimate trash cleared on
 * the way to the first pull. Unbounded is the safe default everywhere here.
 */
const _trashBounds = new Map();          // nightKey → { sinceMs, untilMs }
function _rememberTrashBounds(nightKey, bounds) {
  if (bounds && Number.isFinite(bounds.untilMs)) _trashBounds.set(nightKey, bounds);
  return bounds;
}

function _resetTrashForTest(nightKey) { _trash.delete(nightKey); _trashBounds.delete(nightKey); }

function trashBoundsFor(encounters, graceMin = TRASH_TAIL_GRACE_MIN) {
  const rows = Array.isArray(encounters) ? encounters : [];
  const pad = Math.max(0, graceMin) * 60_000;
  const starts = rows.map(e => Date.parse(e?.started_at)).filter(Number.isFinite);
  const ends   = rows.filter(e => e?.ended_at).map(e => Date.parse(e.ended_at)).filter(Number.isFinite);
  if (!ends.length) return {};                       // no confirmed kill yet → do not bound
  return { sinceMs: (starts.length ? Math.min(...starts) : Math.min(...ends)) - pad,
           untilMs: Math.max(...ends) + pad };
}

/**
 * Aggregate the tally for a night. Pure over the in-memory map.
 *
 * `bounds` ({ sinceMs, untilMs }, both optional) trims entries outside the
 * night's real fight span. WITHOUT it the tally has no upper edge and keeps
 * accruing for as long as anyone stays logged in — isRaidNightAt() (the gate
 * every trash kill passes) is deliberately open-ended so raids can spill past
 * midnight, which is right for thread routing and wrong for "what did the raid
 * clear". On 2026-08-05 that put ALL 89 trash mobs after the raid: last boss
 * died 23:32 ET, trash ran 23:53 → 00:42 (Uilnayar reported it as "trash from
 * earlier in the day" — the data says the opposite, it is trash from after).
 *
 * Omitting `bounds` preserves the old behaviour exactly, which is what the
 * 2026-08-02 leading-edge test relies on.
 */
function trashSummary(nightKey, bounds) {
  const t = _trash.get(nightKey);
  if (!t || t.entries.size === 0) return null;
  const sinceMs = Number.isFinite(bounds?.sinceMs) ? bounds.sinceMs : -Infinity;
  const untilMs = Number.isFinite(bounds?.untilMs) ? bounds.untilMs : Infinity;
  const byName = new Map();
  let kills = 0, damage = 0, seconds = 0, firstMs = Infinity, lastMs = -Infinity;
  for (const e of t.entries.values()) {
    if (e.atMs < sinceMs || e.atMs > untilMs) continue;
    kills += 1; damage += e.damage; seconds += e.sec;
    firstMs = Math.min(firstMs, e.atMs); lastMs = Math.max(lastMs, e.atMs);
    const k = e.name.toLowerCase();
    const cur = byName.get(k) || { name: e.name, kills: 0, damage: 0 };
    cur.kills += 1; cur.damage += e.damage;
    byName.set(k, cur);
  }
  if (kills === 0) return null;          // everything fell outside the span
  return {
    kills, damage, seconds,
    firstMs: Number.isFinite(firstMs) ? firstMs : null,
    lastMs:  Number.isFinite(lastMs)  ? lastMs  : null,
    mobs: [...byName.values()].sort((a, b) => b.kills - a.kills || b.damage - a.damage),
    // Observed, not authoritative: uploads that never reached us aren't here,
    // and a bot restart before the first persist loses that slice.
    observed: true,
  };
}

function _kvKey(win) { return `raid_trash_${win.dateKey}`; }
function _kvReviewKey(nightKey) { return `raid_review_msg_${nightKey}`; }
function _kvSlotsKey(nightKey) { return `raid_review_slots_${nightKey}`; }

// ── Reserved slots at the TOP of the night thread (R3) ───────────────────────
//
// Uilnayar 2026-08-06: "the /raidreview posted to the third line of the page —
// when the raid night thread opens up it should reserve the first two lines of
// it for the raid review(s) to land if they're long."
//
// Discord orders a thread by post time and there is no way to move a message,
// so the ONLY way to be first is to already be there. The thread posts
// placeholders the moment it is created, before any parse card can land, and
// the review later EDITS one of them — which is why it appears at the top
// without ever being re-posted.
//
// Two, not one, because a long review can spill past the embed budget: optional
// fields (timelines, trash, campfire) are silently dropped at EMBED_BUDGET, and
// a second message is where the overflow will go (STATUS R5b). The second slot
// is deliberately kept all night and DELETED by the final review if nothing
// claimed it — a permanent "reserved" stub in the thread would be litter.
//
// No claimed-flag bookkeeping: the review's own stored id (bot_kv, above) wins
// as soon as an edit succeeds, so "unclaimed" is simply "not the stored id".
// That makes a failed edit self-healing — the next refresh returns the same
// slot and tries again — instead of burning a slot on a transient error.
// Slots 1-2 are the review (2 because a long one can spill past EMBED_BUDGET).
// Slots 3-6 are the night's four attendance ticks, in order, so the top of the
// thread reads: review, review overflow, 8:30, 9:30, 10:30, 11:30
// (Uilnayar 2026-08-06: "put them as reserved posts 3-6").
const RESERVED_REVIEW_SLOTS = 2;
const RESERVED_TICK_SLOTS   = 4;
const RESERVED_SLOTS = Math.max(0, Math.min(10,
  Number(process.env.RAID_REVIEW_RESERVED_SLOTS) || (RESERVED_REVIEW_SLOTS + RESERVED_TICK_SLOTS)));

// EVERY placeholder carries this exact title, and that is load-bearing in two
// places: it is how releaseUnclaimedSlots tells a still-empty slot from one that
// has been filled in (so it can never delete a real tick card), and it is
// deliberately NOT the review's own embed title, so postOrEditCard's
// find-my-card-by-title backstop cannot adopt a placeholder by mistake.
const RESERVED_TITLE = '📓 Reserved — Wolf Pack raid night';
const RESERVED_BODY  = '_Holding this spot so tonight\'s review and attendance ticks land at the top of the thread._';

/** 1-based thread slot index for a tick slot (1-4) → 3, 4, 5, 6. */
function tickSlotIndex(tickSlot) { return RESERVED_REVIEW_SLOTS + Number(tickSlot); }

async function _getSlotIds(nightKey) {
  try {
    const supabase = _supa();
    if (!supabase.isEnabled()) return [];
    const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
    const rows = await supabase.select('bot_kv',
      `guild_id=eq.${encodeURIComponent(guildId)}&key=eq.${encodeURIComponent(_kvSlotsKey(nightKey))}&select=value&limit=1`);
    const ids = Array.isArray(rows) && rows[0]?.value?.message_ids;
    return Array.isArray(ids) ? ids.filter(Boolean).map(String) : [];
  } catch (err) {
    console.warn('[raid-review] slot lookup failed:', err?.message);
    return [];
  }
}

async function _saveSlotIds(nightKey, ids, threadId) {
  try {
    const supabase = _supa();
    if (!supabase.isEnabled()) return;
    await supabase.upsert('bot_kv', [{
      guild_id: process.env.SUPABASE_GUILD_ID || 'wolfpack',
      key: _kvSlotsKey(nightKey),
      value: { message_ids: ids, thread_id: threadId || null, night: nightKey,
               updated_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }], 'guild_id,key');
  } catch (err) { console.warn('[raid-review] slot save failed:', err?.message); }
}

/**
 * Post the placeholders. Called ONCE, by raidNight, at thread creation — the
 * only moment "first in the thread" is still available.
 *
 * Idempotent on the kv record, so a double call cannot double-post. Never
 * throws: failing to reserve a slot must not fail thread creation, and the
 * review still posts normally (just lower down) if this is skipped.
 */
// Is this an actual thread, or the main channel wearing a thread's job?
// `/raidnight here:true` makes the CURRENT CHANNEL the night's target, so
// getRaidNightTarget can hand back #raid-chat itself (Hitya, 2026-08-06). Six
// placeholder cards are fine at the top of a quiet per-night thread and are
// pure spam in the middle of the guild's busiest channel.
function _isRealThread(ch) {
  try {
    if (!ch) return false;
    if (typeof ch.isThread === 'function') return !!ch.isThread();
    return !!ch.parentId;                       // fallback for fakes/older shapes
  } catch { return false; }
}

async function reserveReviewSlots(thread, nightKey, want = RESERVED_SLOTS) {
  try {
    if (!thread || !nightKey || want < 1) return [];
    // Reserve ONLY in a real thread. Callers fall back to posting normally, so
    // the review and the tick cards still land — they just don't get a slot,
    // and #raid-chat doesn't get six stubs.
    if (!_isRealThread(thread)) {
      console.log(`[raid-review] ${thread.id} is not a thread — not reserving slots`);
      return [];
    }
    const existing = await _getSlotIds(nightKey);
    // TOP UP rather than all-or-nothing. A thread opened before the tick slots
    // existed (or by an older build) already holds 2; it should gain the other
    // 4 rather than going without them for the night. Re-running with the same
    // count stays a no-op, so this is still safe to call repeatedly.
    if (existing.length >= want) return existing;
    const ids = [...existing];
    for (let i = existing.length; i < want; i++) {
      const msg = await thread.send({ embeds: [new EmbedBuilder()
        .setTitle(RESERVED_TITLE)
        .setDescription(RESERVED_BODY)
        .setColor(0x2b2d31)] });
      ids.push(msg.id);
    }
    await _saveSlotIds(nightKey, ids, thread.id);
    console.log(`[raid-review] reserved ${ids.length} slot(s) at the top of thread ${thread.id} for ${nightKey}`);
    return ids;
  } catch (err) {
    console.warn('[raid-review] could not reserve slots:', err?.message);
    return [];
  }
}

/**
 * Delete any reserved placeholder the review did not end up using. Called after
 * the FINAL review posts, when the review's real size is known.
 */
async function releaseUnclaimedSlots(thread, nightKey, usedId) {
  try {
    if (!thread || !nightKey) return 0;
    const ids = await _getSlotIds(nightKey);
    if (!ids.length) return 0;
    let freed = 0;
    for (const id of ids) {
      if (String(id) === String(usedId)) continue;         // this one became the review
      try {
        const msg = await thread.messages.fetch(id);
        // Delete ONLY a slot that is still an empty placeholder. Checking the
        // title rather than trusting a list of "used" ids is what keeps this
        // from deleting the night's attendance ticks, which live in slots 3-6
        // and are just as claimed as the review is.
        if (msg.embeds?.[0]?.title !== RESERVED_TITLE) continue;
        await msg.delete();
        freed++;
      } catch { /* already gone, or not ours to delete — either is fine */ }
    }
    if (freed) console.log(`[raid-review] released ${freed} unused reserved slot(s) for ${nightKey}`);
    return freed;
  } catch (err) {
    console.warn('[raid-review] slot release failed:', err?.message);
    return 0;
  }
}

/**
 * Fill a reserved slot with real content, by 1-based slot index.
 *
 * Returns true when the slot existed and the edit landed. False means the caller
 * should fall back to posting normally — a thread from before this shipped has
 * no slot 4 to write into, and a tick card at the bottom of the thread beats no
 * tick card at all.
 */
async function claimSlot(thread, nightKey, index, payload) {
  try {
    if (!thread || !nightKey || !(index >= 1)) return false;
    const ids = await _getSlotIds(nightKey);
    const id = ids[index - 1];
    if (!id) return false;
    const msg = await thread.messages.fetch(id).catch(() => null);
    if (!msg) return false;
    await msg.edit(payload);
    return true;
  } catch (err) {
    console.warn(`[raid-review] could not claim slot ${index}:`, err?.message);
    return false;
  }
}

// ── The review's message id, somewhere that survives a redeploy ──────────────
//
// THE BUG THIS FIXES (2026-08-04): the id lived only in data/state.json, and on
// Railway that file does NOT persist — there is no volume mounted on the
// service, so every deploy boots with `[state] state.json not found — creating
// fresh state`. Boot then runs catchUpRaidNightReview(), finds no id, and posts
// the night's review AGAIN. Eleven redeploys in one night produced eleven
// copies of the same Sunday review in the raid thread ("why is the bot just
// spamming the raid review").
//
// Every OTHER anchor survived this because it has an env-var fallback
// (SUMMARY_MESSAGE_ID, THREAD_LINKS_MESSAGE_ID, …) — the documented
// `process.env` → `state.channelSlots` → null priority. A review id is
// PER-NIGHT, so it structurally cannot use that escape hatch: you cannot
// pre-declare an env var for a night that has not happened yet. That is
// precisely why this one anchor was the one that broke.
//
// bot_kv is the answer the trash tally in this same file already reached for
// ("merged back from bot_kv — the morning-after review runs in a process that
// may have restarted"). Same table, same guild scoping, one row per night.
// state.json is still written as a fast local mirror, so nothing regresses if
// Supabase is disabled; kv simply wins when both exist.
async function _getReviewMessageId(nightKey) {
  // Local mirror first — free, and correct within one process lifetime.
  try {
    const local = _state().getRaidReviewMessageId(nightKey);
    if (local) return local;
  } catch { /* fall through to kv */ }
  try {
    const supabase = _supa();
    if (!supabase.isEnabled()) return null;
    const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
    const rows = await supabase.select('bot_kv',
      `guild_id=eq.${encodeURIComponent(guildId)}&key=eq.${encodeURIComponent(_kvReviewKey(nightKey))}&select=value&limit=1`);
    const id = Array.isArray(rows) && rows[0]?.value?.message_id;
    if (!id) {
      // Nothing posted yet — take the slot the thread reserved at the top (R3)
      // so the review EDITS into first position instead of landing wherever the
      // night's parse cards left off. Deliberately NOT mirrored to state.json:
      // this is a "where to write", not "where we wrote". _setReviewMessageId
      // records the real answer once the edit succeeds, and until then a failed
      // edit retries against the same slot on the next refresh.
      const slots = await _getSlotIds(nightKey);
      return slots[0] || null;
    }
    // Warm the local mirror so the rest of this process skips the round trip.
    try { _state().setRaidReviewMessageId(nightKey, id); } catch { /* mirror is optional */ }
    return id;
  } catch (err) {
    // Fail OPEN (return null → post): a kv outage that made us silently skip
    // the review would be worse than a duplicate, and duplicates are visible.
    console.warn('[raid-review] kv id lookup failed:', err?.message);
    return null;
  }
}

async function _setReviewMessageId(nightKey, messageId, threadId) {
  try { _state().setRaidReviewMessageId(nightKey, messageId); } catch { /* mirror is optional */ }
  try {
    const supabase = _supa();
    if (!supabase.isEnabled()) return;
    await supabase.upsert('bot_kv', [{
      guild_id: process.env.SUPABASE_GUILD_ID || 'wolfpack',
      key: _kvReviewKey(nightKey),
      value: { message_id: messageId, thread_id: threadId || null, night: nightKey,
               updated_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }], 'guild_id,key');
  } catch (err) { console.warn('[raid-review] kv id save failed:', err?.message); }
}

/** Merge the persisted tally for a night back into memory (after a restart). */
async function loadTrash(win, bounds) {
  const t = _trashBucket(win.nightKey);
  if (t.loaded) return trashSummary(win.nightKey, bounds);
  t.loaded = true;                                   // one attempt per process/night
  try {
    const supabase = require('./supabase');
    if (!supabase.isEnabled()) return trashSummary(win.nightKey, bounds);
    const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
    const rows = await supabase.select('bot_kv',
      `guild_id=eq.${encodeURIComponent(guildId)}&key=eq.${encodeURIComponent(_kvKey(win))}&select=value&limit=1`);
    const val = Array.isArray(rows) && rows[0]?.value;
    for (const e of (val?.entries || [])) {
      if (!Array.isArray(e) || e.length < 4) continue;
      const [name, damage, sec, atMs] = e;
      const k = _trashKey(name, atMs);
      const hit = t.entries.get(k);
      if (hit) { hit.damage = Math.max(hit.damage, damage || 0); hit.sec = Math.max(hit.sec, sec || 0); }
      else if (t.entries.size < TRASH_MAX_ENTRIES) t.entries.set(k, { name, damage: damage || 0, sec: sec || 0, atMs });
    }
  } catch (err) { console.warn('[raid-review] trash load failed:', err?.message); }
  return trashSummary(win.nightKey, bounds);
}

/** Persist the tally. Called on the throttled refresh cadence, never per upload. */
async function saveTrash(win, bounds) {
  const t = _trash.get(win.nightKey);
  // Fall back to whatever span the last review build computed. Unbounded on the
  // very first refresh of a night (nothing has been killed yet, so there is no
  // span to trim to); self-heals on the next pass.
  if (!bounds) bounds = _trashBounds.get(win.nightKey);
  if (!t || !t.dirty || t.entries.size === 0) return false;
  try {
    const supabase = require('./supabase');
    if (!supabase.isEnabled()) return false;
    const sum = trashSummary(win.nightKey, bounds);
    const entries = [...t.entries.values()]
      .sort((a, b) => b.atMs - a.atMs).slice(0, TRASH_PERSIST_ENTRIES)
      .map(e => [e.name, e.damage, e.sec, e.atMs]);
    await supabase.upsert('bot_kv', [{
      guild_id: process.env.SUPABASE_GUILD_ID || 'wolfpack',
      key: _kvKey(win),
      value: {
        night: win.dateKey, updated_at: new Date().toISOString(),
        kills: sum.kills, damage: sum.damage, seconds: sum.seconds,
        mobs: sum.mobs.slice(0, 40), entries,
      },
      updated_at: new Date().toISOString(),
    }], 'guild_id,key');
    t.dirty = false;
    return true;
  } catch (err) { console.warn('[raid-review] trash save failed:', err?.message); return false; }
}

// ── Pure: composition ────────────────────────────────────────────────────────

function _isPlayerName(n) { return !!n && /^[A-Za-z]{2,}$/.test(n); }

/**
 * Is this encounter a foreign raid (a guildie pugging someone else's raid)?
 * Same rule /parses auto-hides on, so the review and the site agree.
 */
function _isForeign(enc, roster) {
  if (enc.classification === 'foreign') return true;
  if (enc.classification != null) return false;
  const real = (enc.encounter_players || []).filter(p => _isPlayerName(p.character_name));
  if (real.length < AUTO_FOREIGN_MIN_PLAYERS) return false;
  const members = real.filter(p => roster.has(String(p.character_name).toLowerCase())).length;
  return (members / real.length) < AUTO_FOREIGN_MAX_MEMBER_FRAC;
}

function _ms(v) { const n = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(n) ? n : 0; }

// Minimum comparable nights before we make a pace claim at all. Below this the
// "usual" number is one or two nights' noise, and the live card says nothing —
// the same discipline as the ≥4-sample floor on the slow/fast medians.
const PACE_MIN_NIGHTS = 3;
// A GUILD RAID, not "a night somebody killed things". Without this floor the
// baseline fills up with weeknight six-man clears — 30 "nights" with a median
// of 2 kills, which turns a perfectly ordinary Thursday into "7 ahead of our
// usual pace" (caught on the 2026-07-30 render, 2026-08-02).
const PACE_MIN_KILLS_PER_NIGHT = 5;

/**
 * "Are we ahead of our usual pace?" — measured against OUR OWN trailing raid
 * nights, never an invented target. For each prior night we count the kills
 * that had landed by the same elapsed time from that night's first pull, and
 * take the median. Pure; returns null unless the baseline is real.
 *
 * rows: [{ started_at, duration_sec }] — prior confirmed kills.
 */
function _computePace(rows, startMs, nowMs, killsSoFar) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const elapsedMs = nowMs - startMs;
  if (!(elapsedMs > 0)) return null;
  const byNight = new Map();
  for (const r of rows) {
    const t = _ms(r?.started_at);
    if (!t) continue;
    const k = raidNight.nightKey(t);
    const arr = byNight.get(k) || [];
    arr.push(t);
    byNight.set(k, arr);
  }
  const counts = [];
  for (const times of byNight.values()) {
    if (times.length < PACE_MIN_KILLS_PER_NIGHT) continue;
    const first = Math.min(...times);
    // …and it has to have been a scheduled raid night, by the same predicate
    // that decides whether a timestamp gets a raid thread at all.
    if (!raidNight.isRaidNightAt(first)) continue;
    counts.push(times.filter(t => (t - first) <= elapsedMs).length);
  }
  if (counts.length < PACE_MIN_NIGHTS) return null;
  counts.sort((a, b) => a - b);
  const usual = counts[Math.floor(counts.length / 2)];
  return { kills: killsSoFar, usual, nights: counts.length, elapsedMin: Math.round(elapsedMs / 60_000) };
}

/**
 * Everything the review says, derived from plain rows. No I/O, no Discord.
 *
 * data = { window, encounters, deathContribs, characters, loot, ticks,
 *          funEvents, history, uploaders, trash?, paceHistory?,
 *          intentionalRules? }
 * Returns null when the night has nothing worth posting.
 *
 * `opts.requireKills = false` is the LIVE path: a raid that has pulled but not
 * yet killed anything still gets a card ("Fighting X"). The default (true) is
 * the shipped behaviour — no confirmed kill, no review.
 * `opts.nowMs` (live only) builds the `live` block; absent → no live block, so
 * the final review is byte-identical to before.
 */
function summarizeNight(data, opts = {}) {
  const win     = data?.window || nightWindowFor(Date.now());
  const chars   = Array.isArray(data?.characters) ? data.characters : [];
  const roster  = new Set(chars.map(c => String(c.name || '').toLowerCase()).filter(Boolean));
  const excluded = new Set(chars.filter(c => c.exclude_from_stats)
    .map(c => String(c.name || '').toLowerCase()).filter(Boolean));
  const classBy = new Map(chars.map(c => [String(c.name || '').toLowerCase(), c.class || null]));
  const zoneBy  = new Map((data?.zones || []).map(z => [z.short_name, z.long_name]));

  const all = (Array.isArray(data?.encounters) ? data.encounters : [])
    .filter(e => e && !_isForeign(e, roster));

  const killAt = e => _ms(e.started_at) + (e.duration_sec || 0) * 1000;
  const nameOf = e => cleanBossName(e.eqemu_npc_types?.name || e.npc_name);
  const zoneOf = e => {
    const short = e.zone_short || e.eqemu_npc_types?.zone_short || null;
    return short ? (zoneBy.get(short) || short) : null;
  };

  // A "kill" is a CONFIRMED kill: find_or_create_encounter only sets ended_at
  // when a death line was seen. Everything else was engaged but not confirmed
  // down — a wipe, a reset, or an upload that stopped early.
  const kills   = all.filter(e => e.ended_at != null).sort((a, b) => killAt(a) - killAt(b));
  const engaged = all.filter(e => e.ended_at == null);

  const requireKills = opts.requireKills !== false;
  if (kills.length === 0 && (requireKills || all.length === 0)) return null;

  // ── Deaths: the SAME algorithm as the parse card and the web page (#134),
  // per-encounter, then the 60s cross-encounter collapse. Never a 4th count.
  const contribsByEnc = new Map();
  for (const c of (data?.deathContribs || [])) {
    if (!c?.encounter_id) continue;
    const arr = contribsByEnc.get(c.encounter_id) || [];
    arr.push(Array.isArray(c.deaths) ? c.deaths : []);
    contribsByEnc.set(c.encounter_id, arr);
  }
  const rawDeaths = [];
  for (const e of all) {
    for (const d of dedupParseDeaths(contribsByEnc.get(e.id) || [])) {
      if (excluded.has(String(d.name).toLowerCase())) continue;
      const t = _ms(d.ts);
      if (!t) continue;
      const klass = d.class || classBy.get(String(d.name).toLowerCase()) || null;
      for (let i = 0; i < Math.max(1, d.count); i++) {
        rawDeaths.push({ name: d.name, ts: t, class: klass, boss: nameOf(e), encId: e.id,
                         npcId: Number.isFinite(e.npc_id) ? e.npc_id : null });
      }
    }
  }
  rawDeaths.sort((a, b) => a.ts - b.ts);
  const deaths = [];
  const lastByName = new Map();
  for (const d of rawDeaths) {
    const k = d.name.toLowerCase();
    const prev = lastByName.get(k);
    if (prev != null && Math.abs(d.ts - prev) <= NIGHT_DEATH_DEDUP_MS) continue;
    lastByName.set(k, d.ts);
    deaths.push(d);
  }
  // Class-less rows are pets / untracked entities (web/lib/raidReview.ts
  // partitionDeaths). They're noise on a raider-facing list.
  const playerDeaths = deaths.filter(d => d.class);

  // ── Intentional deaths (Uilnayar 2026-08-06) ───────────────────────────────
  // Some deaths are the strat. Fawx and Dant make a corpse on purpose on Kaas
  // Thox Xi Ans Dyek every week, and the review kept listing that fight under
  // "What to work on" as if the raid had gone wrong.
  //
  // A STANDING rule, keyed (character, boss) — not a per-death toggle, because
  // it is the same two rogues on the same boss every single week and officers
  // would be re-marking it forever. See docs/DESIGN-intentional-deaths.md.
  //
  // MARKED, NOT REMOVED. The death stays in the headline count, in the deaths
  // list, and on the fight timelines — it happened. It only stops counting as
  // something to fix. Hiding it would make the review lie about the night.
  //
  // Boss identity is npc_id, never the display string: cleanBossName() strips
  // '#'/'_' purely for rendering, and two differently-templated NPCs can render
  // the same clean name.
  const intentionalRules = new Set(
    (Array.isArray(data?.intentionalRules) ? data.intentionalRules : [])
      .filter(r => r && r.active !== false && Number.isFinite(Number(r.npc_id)))
      .map(r => `${String(r.character_name).toLowerCase()}|${Number(r.npc_id)}`));
  for (const d of playerDeaths) {
    if (d.npcId != null && intentionalRules.has(`${d.name.toLowerCase()}|${d.npcId}`)) d.intentional = true;
  }
  const intentionalDeaths = playerDeaths.filter(d => d.intentional).length;

  // ── Roll-up numbers + standouts.
  // Only ROSTER names are counted or named. encounter_players carries pets and
  // the odd pug alongside raiders (77 "players" on a 44-raider night before
  // this filter), and the review must not hand a pet the top-damage crown.
  // Falls back to "any single-word name" when the roster fetch failed, so a
  // Supabase blip degrades to the old, looser count rather than an empty card.
  const isRaider = n => (roster.size ? roster.has(String(n).toLowerCase()) : _isPlayerName(n));
  let totalDamage = 0, totalDuration = 0;
  const byChar = new Map();          // name → { name, damage, fights }
  let bestFight = null;              // { name, dps, boss }
  for (const e of kills) {
    totalDamage   += e.total_damage || 0;
    totalDuration += e.duration_sec || 0;
    for (const p of (e.encounter_players || [])) {
      const n = p.character_name;
      if (!_isPlayerName(n) || !isRaider(n) || excluded.has(n.toLowerCase())) continue;
      const cur = byChar.get(n) || { name: n, damage: 0, fights: 0 };
      cur.damage += p.total_damage || 0;
      cur.fights += 1;
      byChar.set(n, cur);
      if ((p.dps || 0) > (bestFight?.dps || 0)) bestFight = { name: n, dps: p.dps || 0, boss: nameOf(e) };
    }
  }
  const topDamage = [...byChar.values()].sort((a, b) => b.damage - a.damage)[0] || null;
  const hardest   = [...kills].sort((a, b) => (b.duration_sec || 0) - (a.duration_sec || 0))[0] || null;

  // ── "Slower than our own history" — median duration for the same npc over
  // the trailing window, from OUR kills. Never an invented target time.
  const histBy = new Map();
  for (const h of (data?.history || [])) {
    if (!h?.npc_id || !(h.duration_sec > 0)) continue;
    const arr = histBy.get(h.npc_id) || [];
    arr.push(h.duration_sec);
    histBy.set(h.npc_id, arr);
  }
  const slowFights = [], fastFights = [];
  for (const e of kills) {
    const arr = histBy.get(e.npc_id);
    if (!arr || arr.length < 4) continue;                      // need a real baseline
    const s = [...arr].sort((a, b) => a - b);
    const med = s[Math.floor(s.length / 2)];
    const d = e.duration_sec || 0;
    if (!(med > 0) || !(d > 0)) continue;
    // Both a RELATIVE and an ABSOLUTE floor in each direction: 25% off the
    // median is only worth saying when it's also a minute of real time, so a
    // 40s trash mob at 30s median never shows up as a problem OR a triumph.
    if (d > med * 1.25 && (d - med) >= 60) {
      slowFights.push({ boss: nameOf(e), duration_sec: d, median_sec: med, pct: Math.round((d / med - 1) * 100) });
    } else if (d < med * 0.75 && (med - d) >= 60) {
      fastFights.push({ boss: nameOf(e), duration_sec: d, median_sec: med, pct: Math.round((1 - d / med) * 100) });
    }
  }
  slowFights.sort((a, b) => b.pct - a.pct);
  fastFights.sort((a, b) => b.pct - a.pct);

  // ── Deaths by fight (top 3). Intentional deaths are the ONE place they are
  // excluded — this list is "what went wrong", and a deliberate corpse did not.
  // A fight whose only deaths were intentional drops out entirely.
  const deathsByBoss = new Map();
  for (const d of playerDeaths) {
    if (d.intentional) continue;
    deathsByBoss.set(d.boss, (deathsByBoss.get(d.boss) || 0) + 1);
  }
  const worstFights = [...deathsByBoss.entries()]
    .map(([boss, n]) => ({ boss, deaths: n }))
    .sort((a, b) => b.deaths - a.deaths)
    .slice(0, 3);

  // ── Loot (OpenDKP awards for the night).
  const loot = (Array.isArray(data?.loot) ? data.loot : [])
    .filter(l => l && l.item_name)
    .map(l => ({ item: l.item_name, winner: l.character_name || '—', dkp: Number(l.dkp) || 0 }))
    .sort((a, b) => b.dkp - a.dkp);
  const dkpSpent = loot.reduce((s, l) => s + l.dkp, 0);

  // ── Attendance from the OpenDKP ticks (authoritative — raid_roster is swept
  // hourly, so it is NOT available the morning after).
  const ticks = (Array.isArray(data?.ticks) ? data.ticks : [])
    .map(t => ({
      id: t.tick_id, value: Number(t.value) || 0,
      attendees: Array.isArray(t.attendees) ? t.attendees : [],
      description: t.description || '',
    }))
    .sort((a, b) => a.id - b.id);
  const everAttended = new Set();
  for (const t of ticks) for (const a of t.attendees) everAttended.add(String(a));
  const firstTick = ticks[0] || null;
  const lastTick  = ticks[ticks.length - 1] || null;
  const leftEarly = (firstTick && lastTick && firstTick !== lastTick)
    ? firstTick.attendees.filter(a => !lastTick.attendees.includes(a))
    : [];
  const dkpAwarded = ticks.reduce((s, t) => s + t.value, 0);

  // ── One fun line, capped. Drops out on a quiet night.
  const funBy = new Map();
  for (const f of (data?.funEvents || [])) {
    if (!f?.event_type) continue;
    funBy.set(f.event_type, (funBy.get(f.event_type) || 0) + 1);
  }
  const fun = [...funBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)
    .map(([type, n]) => ({ type, n }));

  // Span rows: the kills, or — on a live card before the first kill — whatever
  // has been pulled. Identical to the shipped behaviour whenever kills exist.
  const spanRows = kills.length ? kills : all;
  const zones = [...new Set(spanRows.map(zoneOf).filter(Boolean))];
  const startMs = Math.min(...spanRows.map(e => _ms(e.started_at)));
  const endMs   = Math.max(...spanRows.map(killAt));

  // ── 🕒 Per-fight timelines — the Discord analogue of FightTimeline.tsx (#98).
  // Death positions inside each fight, from the deaths we ALREADY computed. No
  // extra query, and by construction the same death set the rest of the review
  // (and the web page) counts.
  const deathsByEnc = new Map();
  for (const d of playerDeaths) {
    const arr = deathsByEnc.get(d.encId) || [];
    arr.push(d.ts);
    deathsByEnc.set(d.encId, arr);
  }
  const timelines = kills
    .map(e => {
      const durMs = Math.max(1000, (e.duration_sec || 0) * 1000);
      const st = _ms(e.started_at);
      // Only deaths that happened INSIDE this fight go on this fight's axis.
      // find_or_create_encounter's ±30min window means an add pulled 15 minutes
      // earlier is the same encounter row, so a fight can carry deaths from
      // before it started — plotting those clamps them all onto t=0 and reads
      // as "the raid wiped on the pull" (2026-07-30 Xerkizh). The night's death
      // COUNT is unaffected; this only decides what the axis can honestly draw.
      const ts = (deathsByEnc.get(e.id) || []).filter(t => t >= st - TIMELINE_GRACE_MS && t <= st + durMs + TIMELINE_GRACE_MS);
      if (ts.length === 0) return null;
      return {
        id: e.id, boss: nameOf(e), atMs: killAt(e), duration_sec: e.duration_sec || 0,
        deaths: ts.length,
        // The biggest simultaneous cluster — the "N died together" wipe signal
        // FightTimeline surfaces in its header. 8% of the fight ≈ its cell width.
        worstCluster: (() => {
          const s = [...ts].sort((a, b) => a - b);
          let best = 0, i = 0;
          for (let j = 0; j < s.length; j++) {
            while (s[j] - s[i] > Math.max(6000, durMs * 0.08)) i++;
            best = Math.max(best, j - i + 1);
          }
          return best;
        })(),
        strip: deathStrip(ts, _ms(e.started_at), durMs),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.deaths - a.deaths || a.atMs - b.atMs);

  // ── 🐜 Trash. Supplied by the caller (in-memory tally / bot_kv) because no
  // durable table holds it — see the module header.
  const trash = (data?.trash && data.trash.kills > 0) ? {
    kills:   data.trash.kills,
    damage:  data.trash.damage || 0,
    seconds: data.trash.seconds || 0,
    mobs:    Array.isArray(data.trash.mobs) ? data.trash.mobs : [],
    observed: data.trash.observed !== false,
  } : null;

  // ── 🔴 Live-only block. Absent unless nowMs was passed, so the final review
  // renders exactly as it did before.
  let live = null;
  if (Number.isFinite(opts.nowMs)) {
    const nowMs = opts.nowMs;
    const inProgress = engaged
      .filter(e => (nowMs - _ms(e.started_at)) <= LIVE_ENGAGED_WINDOW_MS && _ms(e.started_at) <= nowMs)
      .sort((a, b) => _ms(b.started_at) - _ms(a.started_at))
      .slice(0, 3)
      .map(e => ({ boss: nameOf(e), sinceMs: _ms(e.started_at) }));
    live = {
      nowMs,
      inProgress,
      lastKillMs: kills.length ? endMs : null,
      pace: _computePace(data?.paceHistory, startMs, nowMs, kills.length),
    };
  }

  return {
    window: win,
    startMs, endMs,
    zones,
    timelines, trash, live,
    kills: kills.map(e => ({
      id: e.id, boss: nameOf(e), zone: zoneOf(e),
      atMs: killAt(e), duration_sec: e.duration_sec || 0, damage: e.total_damage || 0,
      // A confirmed kill with almost nobody on the parse is a real kill with a
      // thin UPLOAD (one agent caught a stray hit) — "Ashenbone Broodmaster ·
      // 2s · 93" on 2026-07-30. We keep the kill (a death line confirmed it)
      // and flag the data instead of silently dropping a boss or silently
      // publishing a nonsense duration.
      thin: (e.encounter_players || []).filter(p => _isPlayerName(p.character_name)).length < 3,
    })),
    engaged: engaged.map(e => ({ boss: nameOf(e), atMs: _ms(e.started_at) })),
    raiders: byChar.size,
    totalDamage, totalDuration,
    topDamage, bestFight,
    hardest: hardest ? { boss: nameOf(hardest), duration_sec: hardest.duration_sec || 0, damage: hardest.total_damage || 0 } : null,
    deaths: playerDeaths,
    intentionalDeaths,
    worstFights, slowFights,
    fastFights,
    loot, dkpSpent,
    attendance: {
      total: everAttended.size,
      ticks: ticks.map(t => ({ n: t.attendees.length, value: t.value })),
      dkpAwarded, leftEarly,
    },
    fun,
    uploaders: Number(data?.uploaders) || 0,
    deathsAvailable: (data?.deathContribs || []).length > 0,
  };
}

const FUN_LABELS = {
  drunkard:              'drunken stumbles',
  dragon_punch:          'dragon punches',
  mana_twitch_received:  'mana twitches',
  malthur_food_received: 'servings of Malthur\'s finest',
  malthur_water_received:'rounds of water',
  summon_food:           'summoned meals',
  mind_wrack_recourse:   'mind wracks',
};

/** The Discord embeds. Pure — takes a summary, returns EmbedBuilder[]. */
function renderReviewEmbeds(sum, { webBase } = {}) {
  if (!sum) return [];
  const base = webBase || process.env.WEB_BASE_URL || 'https://wolfpack.quest';
  const url  = `${base}/raid/review/${sum.window.dateKey}`;
  const live = sum.live || null;

  const spanEnd    = live ? Math.max(sum.endMs, live.nowMs) : sum.endMs;
  const elapsedMin = Math.max(1, Math.round((spanEnd - sum.startMs) / 60_000));
  const elapsed    = `${Math.floor(elapsedMin / 60)}h ${elapsedMin % 60}m`;

  const head = [];
  if (live) {
    // Relative timestamps keep ticking client-side, so "updated 4 minutes ago"
    // stays true between the 5-minute edits.
    head.push(`🔴 **LIVE** · updated ${relTime(live.nowMs)}`);
  }
  head.push(
    `**${sum.zones.length ? sum.zones.join(' · ') : 'Norrath'}** — ${fmtClock(sum.startMs)} → ${live ? 'now' : fmtClock(sum.endMs)} (${elapsed})`,
    `**${sum.kills.length}** down · **${fmtDmg(sum.totalDamage)}** damage · **${sum.raiders}** on the parse` +
      // The intentional ones are still IN the count — they happened. The note
      // just says how many of them the raid meant to take, so nobody reads the
      // headline as five things going wrong when two were the strat.
      (sum.deathsAvailable
        ? ` · **${sum.deaths.length}** deaths` +
          (sum.intentionalDeaths > 0 ? ` (${sum.intentionalDeaths} on purpose)` : '')
        : ''),
  );
  if (live) {
    for (const p of live.inProgress) head.push(`⚔️ Fighting **${p.boss}** — pulled ${relTime(p.sinceMs)}`);
    if (!live.inProgress.length && live.lastKillMs) head.push(`🕐 Last kill ${relTime(live.lastKillMs)}`);
    if (live.pace) {
      const d = live.pace.kills - live.pace.usual;
      const verdict = d > 0 ? `**${d} ahead of** our usual ${live.pace.usual}`
                    : d < 0 ? `${-d} behind our usual ${live.pace.usual}`
                            : `right on our usual ${live.pace.usual}`;
      head.push(`📈 ${live.pace.kills} down ${elapsed} in — ${verdict} (last ${live.pace.nights} raids)`);
    }
  }

  const embed = new EmbedBuilder()
    .setColor(live ? 0x2ecc71 : 0xe67e22)
    .setTitle(live ? `🔴 Raid Night — ${sum.window.label}` : `📓 Raid Night Review — ${sum.window.label}`)
    .setURL(url)
    .setDescription(head.join('\n'));

  // Optional sections are added through this so the embed can never blow
  // Discord's 6000-char whole-embed ceiling: the ones that carry the night
  // (kills, standouts, loot, attendance, fixes) are added directly; the
  // additive ones declare a priority and are skipped when the budget is spent.
  let used = JSON.stringify(embed.toJSON()).length;
  const EMBED_BUDGET = 5800;
  const addField = (name, value, { optional = false } = {}) => {
    if (!value) return;
    const cost = name.length + value.length + 32;
    if (optional && used + cost > EMBED_BUDGET) return;
    embed.addFields({ name, value, inline: false });
    used += cost;
  };

  // 🏆 Kills — in kill order, zone-headed when the night moved zones.
  if (sum.kills.length) {
    const lines = [];
    let lastZone = null, anyThin = false;
    const multiZone = sum.zones.length > 1;
    for (const k of sum.kills) {
      if (multiZone && k.zone && k.zone !== lastZone) { lines.push(`*— ${k.zone} —*`); lastZone = k.zone; }
      if (k.thin) anyThin = true;
      lines.push(`\`${fmtClock(k.atMs).padStart(6)}\` **${k.boss}** · ${fmtDur(k.duration_sec)} · ${fmtDmg(k.damage)}${k.thin ? ' \\*' : ''}`);
    }
    if (anyThin) lines.push('_\\* only a partial parse reached us for this one_');
    addField(`🏆 Kills (${sum.kills.length})`, clampLines(lines, 1024, 'more kills'));
  }

  // ⭐ Standouts — three named lines. The reason people read a review.
  {
    const lines = [];
    if (sum.topDamage) lines.push(`🥇 **${sum.topDamage.name}** — ${fmtDmg(sum.topDamage.damage)} across ${sum.topDamage.fights} fights`);
    if (sum.bestFight && sum.bestFight.dps > 0) lines.push(`⚡ Best single fight — **${sum.bestFight.name}**, ${sum.bestFight.dps.toLocaleString('en-US')} dps on ${sum.bestFight.boss}`);
    if (sum.hardest && sum.hardest.duration_sec > 0) lines.push(`💪 Hardest pull — **${sum.hardest.boss}**, ${fmtDur(sum.hardest.duration_sec)} and ${fmtDmg(sum.hardest.damage)}`);
    const pb = sum.fastFights?.[0];
    if (pb) lines.push(`⏱️ **${pb.boss}** went down in ${fmtDur(pb.duration_sec)} — ${pb.pct}% faster than our own median (${fmtDur(pb.median_sec)})`);
    if (lines.length) addField('⭐ Standouts', clampLines(lines));
  }

  // 🕒 Fight timelines — where the deaths fell inside each fight. Discord can't
  // draw FightTimeline.tsx, so each row is a 12-cell death sparkline that LINKS
  // to the real component on /parses/<id>. Deaths-only, deliberately: that is
  // the substrate the web timeline itself started from, and it costs no extra
  // query (raid events + callout ticks are on the web page).
  if (sum.timelines?.length) {
    const lines = sum.timelines.slice(0, 6).map(t =>
      `\`${t.strip}\` [${t.boss}](${base}/parses/${t.id}) · ${fmtDur(t.duration_sec)} · 💀${t.deaths}` +
      (t.worstCluster >= 3 ? ` · **${t.worstCluster} together**` : ''));
    // Say WHY this is not one row per kill. The section is deaths-only by
    // design (above), so a clean kill has nothing to draw — but the embed used
    // to render "Fight timelines (4)" directly under "12 down" with nothing
    // connecting the two, and a raider has no way to tell a suppressed clean
    // kill from a fight we failed to record (Uilnayar 2026-08-06: "we only saw
    // 4 of the fight timelines posted"). The 2026-08-05 night was 4 of 12 —
    // and the 8 omissions were genuinely death-free, which is good news the
    // embed was not taking credit for.
    const clean = Math.max(0, sum.kills.length - sum.timelines.length);
    lines.push('_start → end of each fight · bar height = deaths in that slice_'
      + (clean ? `\n_${clean} clean kill${clean === 1 ? '' : 's'} not shown — nobody died_` : ''));
    addField(`🕒 Fight timelines (${sum.timelines.length} of ${sum.kills.length})`,
      clampLines(lines, 1024, 'more fights'), { optional: true });
  }

  // 🐜 Trash — what the raid cleared getting to the bosses (Hitya, 2026-08-02).
  // Observed from the agents' uploads, not from `encounters` (which is
  // boss-only) — so it is labelled as observed, never presented as a census.
  if (sum.trash) {
    const lines = [
      `**${sum.trash.kills}** mobs cleared · **${fmtDmg(sum.trash.damage)}** damage · ${fmtSpan(sum.trash.seconds)} in combat`,
    ];
    for (const m of sum.trash.mobs.slice(0, 5)) {
      lines.push(`\`×${String(m.kills).padStart(3)}\` ${m.name} · ${fmtDmg(m.damage)}`);
    }
    if (sum.trash.mobs.length > 5) lines.push(`_…and ${sum.trash.mobs.length - 5} other mob types_`);
    if (sum.trash.observed) lines.push('_counted from what the raid\'s agents saw die_');
    addField('🐜 Trash cleared', clampLines(lines, 1024, 'more mobs'), { optional: true });
  }

  // 💰 Loot — top 8 by price, plus the total.
  if (sum.loot.length) {
    const lines = sum.loot.slice(0, 8).map(l => `**${l.item}** → ${l.winner} · ${l.dkp} DKP`);
    if (sum.loot.length > 8) lines.push(`_…and ${sum.loot.length - 8} more_`);
    addField(`💰 Loot (${sum.loot.length} · ${sum.dkpSpent} DKP spent)`, clampLines(lines, 1024, 'more items'));
  }

  // 🫂 Attendance — from the DKP ticks, which is the record that pays people.
  if (sum.attendance.total > 0) {
    const lines = [`${sum.attendance.ticks.map(t => t.n).join(' → ')} on ${sum.attendance.ticks.length} ticks · **${sum.attendance.dkpAwarded} DKP** awarded`];
    if (sum.attendance.leftEarly.length) {
      const names = sum.attendance.leftEarly.slice(0, 8).join(', ');
      lines.push(`On the first tick but not the last: ${names}${sum.attendance.leftEarly.length > 8 ? ` +${sum.attendance.leftEarly.length - 8}` : ''}`);
    }
    addField(`🫂 Attendance (${sum.attendance.total})`, clampLines(lines));
  }

  // 🩹 What to work on — grounded: our deaths, our own history, our resets.
  {
    const lines = [];
    for (const w of sum.worstFights) lines.push(`💀 **${w.boss}** — ${w.deaths} death${w.deaths === 1 ? '' : 's'}`);
    for (const s of sum.slowFights.slice(0, 2)) {
      lines.push(`🐢 **${s.boss}** took ${fmtDur(s.duration_sec)} — ${s.pct}% over our own median (${fmtDur(s.median_sec)})`);
    }
    if (sum.engaged.length) {
      const names = [...new Set(sum.engaged.map(e => e.boss))].slice(0, 4).join(', ');
      lines.push(`↩️ Engaged but never confirmed down: ${names}`);
    }
    if (lines.length) addField('🩹 What to work on', clampLines(lines, 1024, 'more notes'));
  }

  // 🎪 One fun line. Drops out entirely on a quiet night.
  if (sum.fun.length) {
    const parts = sum.fun.map(f => `${f.n} ${FUN_LABELS[f.type] || String(f.type).replace(/_/g, ' ')}`);
    addField('🎪 Around the campfire', parts.join(' · '), { optional: true });
  }

  const foot = [`${sum.uploaders || 0} agent upload${sum.uploaders === 1 ? '' : 's'} built this`];
  if (!sum.deathsAvailable) foot.push('death detail expires after 7 days');
  foot.push(live ? 'updates as the raid goes · final writeup after midnight' : '/raidreview to refresh');
  embed.setFooter({ text: foot.join(' · ') });

  return [embed];
}

// ── Fetch: the night's rows ──────────────────────────────────────────────────

// ── Live read cache ─────────────────────────────────────────────────────────
// The live card re-collects every ~5 min for four-plus hours, during the
// busiest Supabase hour of the week. Only TWO of the reads actually move
// minute to minute (the night's encounters, and the deaths on them); the rest
// are a roster, a zone lookup, a 90-day duration history and the OpenDKP rows,
// which either never change or change slowly. Cache those per night, per slice.
//
// Cached ONLY when `live` is set, so the 00:45 review and /raidreview issue the
// exact same queries they always did.
const _COLD_TTL_MS = 6 * 3_600_000;    // roster / zones / 90-day history / pace baseline
const _WARM_TTL_MS = 10 * 60_000;      // OpenDKP loot + ticks, fun events
let _readCache = null;                 // { nightKey, slices: Map<name,{at,val}> }

function _cacheFor(win) {
  if (!_readCache || _readCache.nightKey !== win.nightKey) _readCache = { nightKey: win.nightKey, slices: new Map() };
  return _readCache;
}
function _cached(win, live, name, ttlMs, fn) {
  if (!live) return fn();
  const c = _cacheFor(win);
  const hit = c.slices.get(name);
  if (hit && (Date.now() - hit.at) < ttlMs) return Promise.resolve(hit.val);
  return Promise.resolve(fn()).then(val => { c.slices.set(name, { at: Date.now(), val }); return val; });
}
/** Test seam — drops the live read cache and the trash tally. */
function _clearLiveCaches() { _readCache = null; _trash.clear(); }

/**
 * Every read the review needs, bounded to one night. Best-effort throughout:
 * utils/supabase already returns null on failure/timeout/breaker-open, so a
 * review missing loot still ships the kills.
 *
 * `opts.live` turns on the slice cache above and adds the pace baseline.
 */
async function collectNightData(win, opts = {}) {
  const supabase = require('./supabase');
  if (!supabase.isEnabled()) return null;
  const live = !!opts.live;

  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
  const fromIso = new Date(win.fromMs).toISOString();
  const toIso   = new Date(win.toMs).toISOString();

  const encounters = await supabase.select('encounters',
    'select=id,started_at,ended_at,duration_sec,total_damage,total_dps,zone_short,npc_id,classification,' +
    'eqemu_npc_types(name,zone_short),encounter_players(character_name,total_damage,dps,rank)' +
    `&guild_id=eq.${encodeURIComponent(guildId)}` +
    `&started_at=gte.${encodeURIComponent(fromIso)}&started_at=lt.${encodeURIComponent(toIso)}` +
    '&order=started_at.asc&limit=400') || [];

  const ids = encounters.map(e => e.id).filter(Boolean);
  const npcIds = [...new Set(encounters.map(e => e.npc_id).filter(n => Number.isFinite(n)))];
  const shorts = [...new Set(encounters.map(e => e.zone_short || e.eqemu_npc_types?.zone_short).filter(Boolean))];

  // Deaths live in contributions.raw_parse — nulled by the midnight compaction
  // after 7 days, so an old night renders without the deaths section.
  // PostgREST `in.(a,b)`. Values are UUIDs and zone short-names, so a strict
  // whitelist keeps them quote-free (a quoted list would need its separating
  // commas percent-encoded) and makes injection structurally impossible.
  const inList = arr => `(${arr.map(v => String(v).replace(/[^A-Za-z0-9_-]/g, '')).join(',')})`;
  const [deathContribs, characters, zones, loot, raids, funEvents, history, paceHistory, trash,
         intentionalRules] = await Promise.all([
    ids.length ? supabase.select('contributions',
      `select=encounter_id,contributor_character,deaths:raw_parse->deaths&encounter_id=in.${inList(ids)}&limit=4000`) : [],
    _cached(win, live, 'characters', _COLD_TTL_MS, () => supabase.select('characters',
      `select=name,class,exclude_from_stats&guild_id=eq.${encodeURIComponent(guildId)}&limit=3000`)),
    _cached(win, live, `zones:${shorts.join(',')}`, _COLD_TTL_MS, () => (shorts.length ? supabase.select('eqemu_zone',
      `select=short_name,long_name&short_name=in.${inList(shorts)}`) : [])),
    _cached(win, live, 'loot', _WARM_TTL_MS, () => supabase.select('opendkp_loot_recent',
      `select=item_name,character_name,dkp&raid_date=eq.${win.dateKey}&order=dkp.desc&limit=200`)),
    _cached(win, live, 'raids', _WARM_TTL_MS, () => supabase.select('opendkp_raids',
      // opendkp_raids.ts is midday UTC on the raid's own date, and the
      // opendkp_loot_recent view keys `raid_date` off that same ts::date — so
      // both join on the night's ET dateKey without a timezone dance.
      `select=raid_id,name&ts=gte.${win.dateKey}T00%3A00%3A00Z&ts=lt.${win.dateKey}T23%3A59%3A59Z&limit=10`)),
    _cached(win, live, 'fun', _WARM_TTL_MS, () => supabase.select('fun_events',
      `select=event_type&guild_id=eq.${encodeURIComponent(guildId)}` +
      `&event_ts=gte.${encodeURIComponent(fromIso)}&event_ts=lt.${encodeURIComponent(toIso)}&limit=3000`)),
    _cached(win, live, `history:${npcIds.join(',')}`, _COLD_TTL_MS, () => (npcIds.length ? supabase.select('encounters',
      `select=npc_id,duration_sec&guild_id=eq.${encodeURIComponent(guildId)}` +
      `&npc_id=in.(${npcIds.join(',')})&ended_at=not.is.null` +
      `&started_at=gte.${encodeURIComponent(new Date(win.fromMs - 90 * 86_400_000).toISOString())}` +
      `&started_at=lt.${encodeURIComponent(fromIso)}&limit=3000`) : [])),
    // Pace baseline — LIVE ONLY, and cold-cached, so the final review's query
    // set is unchanged and the live card pays for it once a night.
    live ? _cached(win, live, 'pace', _COLD_TTL_MS, () => supabase.select('encounters',
      `select=started_at&guild_id=eq.${encodeURIComponent(guildId)}&ended_at=not.is.null` +
      `&started_at=gte.${encodeURIComponent(new Date(win.fromMs - 45 * 86_400_000).toISOString())}` +
      `&started_at=lt.${encodeURIComponent(fromIso)}&order=started_at.asc&limit=1500`)) : null,
    // Trash: in-memory when the raid is live, otherwise merged back from bot_kv
    // (the morning-after review runs in a process that may have restarted).
    // Stash the span so saveTrash (which persists the value the WEB page reads
    // straight out of bot_kv) trims to the same edges the embed does, without
    // paying for its own encounters query.
    loadTrash(win, _rememberTrashBounds(win.nightKey, trashBoundsFor(encounters))).catch(() => null),
    // Standing intentional-death rules. Warm-cached rather than cold: an
    // officer marking a rule mid-raid should see the live card stop blaming
    // that fight on the next refresh, not next session.
    _cached(win, live, 'intentional', _WARM_TTL_MS, () => supabase.select('intentional_death_rules',
      `select=character_name,npc_id,active,note&guild_id=eq.${encodeURIComponent(guildId)}` +
      '&active=is.true&limit=500')),
  ]);

  const raidIds = (raids || []).map(r => r.raid_id).filter(n => Number.isFinite(n));
  const ticks = raidIds.length
    ? (await _cached(win, live, `ticks:${raidIds.join(',')}`, _WARM_TTL_MS, () => supabase.select('opendkp_ticks',
        `select=tick_id,description,value,attendees,raid_id&raid_id=in.(${raidIds.join(',')})&order=tick_id.asc&limit=50`))) || []
    : [];

  const uploaders = new Set((deathContribs || []).map(c => c.contributor_character).filter(Boolean)).size;

  return {
    window: win,
    encounters,
    deathContribs: (deathContribs || []).filter(c => Array.isArray(c.deaths)),
    characters: characters || [],
    zones: zones || [],
    loot: loot || [],
    ticks,
    funEvents: funEvents || [],
    history: history || [],
    paceHistory: paceHistory || [],
    trash: trash || null,
    intentionalRules: intentionalRules || [],
    uploaders,
  };
}

// ── Post ─────────────────────────────────────────────────────────────────────

// Test seams for the two impure edges. vitest's ESM import and this file's
// require() resolve to DIFFERENT module instances (the same reason
// raidNight._setEventsModule exists), so a spy can't reach them from a test —
// they have to be injectable.
let _collector = null;
let _stateMod  = null;
let _nightMod  = null;
let _supaMod   = null;
function _setDeps({ collect, state, raidNight: rn, supabase: sb } = {}) {
  _collector = collect || null;
  _stateMod  = state   || null;
  _nightMod  = rn      || null;
  _supaMod   = sb      || null;
}
function _collect(win, opts) { return (_collector || collectNightData)(win, opts); }
function _state()      { return _stateMod || require('./state'); }
function _night()      { return _nightMod || raidNight; }
// Injectable so the durable-id path can be tested without a network — the
// restart case is exactly the one that shipped broken, so it has to be
// reachable from a spec.
function _supa()       { return _supaMod || require('./supabase'); }

// Nights whose FINAL review has already been written. The live refresher
// refuses to touch those, so a timer that survived past 00:45 can never
// overwrite the finished writeup with a "🔴 LIVE" one.
const _finalDone = new Set();

/**
 * Build and post (or edit) the review for the night containing `atMs`.
 * NEVER throws — returns { ok, reason, messageId?, summary? }.
 *
 * `dryRun` builds everything and returns the embeds without touching Discord;
 * that's what /raidreview preview and the test suite use.
 *
 * `live` is the mid-raid card: same message, same thread, same composition —
 * it just also renders the in-progress block and tolerates a night that has
 * pulled but not yet killed anything.
 */
async function postRaidNightReview(client, { atMs = Date.now(), dryRun = false, force = false, live = false, nowMs = null } = {}) {
  try {
    const win = nightWindowFor(atMs);
    if (live && !liveEnabled()) return { ok: false, reason: 'live-disabled', window: win };
    if (live && _finalDone.has(win.nightKey)) return { ok: false, reason: 'final-posted', window: win };

    const data = await _collect(win, live ? { live: true } : undefined);
    if (!data) return { ok: false, reason: 'supabase-disabled', window: win };

    const summary = summarizeNight(data, live
      ? { requireKills: false, nowMs: Number.isFinite(nowMs) ? nowMs : Date.now() }
      : {});
    if (!summary) return { ok: false, reason: 'no-kills', window: win };
    if (!live && summary.kills.length < minKills()) return { ok: false, reason: 'below-min-kills', window: win, summary };

    const embeds = renderReviewEmbeds(summary);
    if (dryRun) return { ok: true, reason: 'dry-run', window: win, summary, embeds };

    // The thread the night's parse cards used. Anchor on the FIRST ENCOUNTER,
    // never on now — see the header note.
    //
    // planFor FIRST, so an off-night guild event bails BEFORE getRaidNightTarget
    // would open a 🎲 event thread as a side effect. A roll-loot night already
    // has its own live card (utils/rollLoot.js); it gets no review.
    const plan = await _night().planFor(client, summary.startMs).catch(() => null);
    if (plan?.kind === 'event' && !force) return { ok: false, reason: 'event-night', window: win, summary, embeds };

    const target = await _night().getRaidNightTarget(client, summary.startMs);
    if (!target.thread) return { ok: false, reason: 'no-thread', window: win, summary, embeds };
    if (target.kind === 'event' && !force) return { ok: false, reason: 'event-night', window: win, summary, embeds };

    // Durable across redeploys (bot_kv), not just this container's state.json —
    // and posted through the shared anchor so a failure to READ or EDIT the
    // existing card can never become a second card. The old code here caught
    // the fetch with `.catch(() => null)`, which made any transient failure
    // indistinguishable from "the message is gone" and fell through to send().
    // Same defect that was spamming the onboarding thread (2026-08-04); see
    // utils/threadAnchor.js for why an archived thread is the usual trigger.
    const { postOrEditCard } = require('./threadAnchor');
    const res = await postOrEditCard(target.thread, {
      botId:   client.user.id,
      title:   embeds[0]?.data?.title || embeds[0]?.title,
      payload: { embeds },
      getId:   () => _getReviewMessageId(win.nightKey),
      setId:   (id) => _setReviewMessageId(win.nightKey, id, target.thread.id),
      log:     (m) => console.log('[raid-review]', m),
    });
    if (res.action === 'skipped') {
      console.warn(`[raid-review] ${win.label} not posted (${res.reason}) — deliberately NOT sending a duplicate`);
      return { ok: false, reason: res.reason, window: win, summary, embeds };
    }
    if (res.duplicates?.length) {
      console.warn(`[raid-review] ${res.duplicates.length} older copy/copies of this night's review are still in the thread `
        + `(ids: ${res.duplicates.map(m => m.id).join(', ')})`);
    }
    if (!live) {
      _finalDone.add(win.nightKey);
      // The review's final size is now known, so any reserved slot it did not
      // grow into is just a stub in the thread. Best-effort — a placeholder we
      // fail to delete is cosmetic, and must not fail the review.
      await releaseUnclaimedSlots(target.thread, win.nightKey, res.messageId)
        .catch(() => {});
    }
    console.log(`[raid-review] ${res.action} ${live ? 'LIVE ' : ''}${win.label} → thread ${target.thread.id} (${summary.kills.length} kills)`);
    return { ok: true, reason: res.action, window: win, summary, messageId: res.messageId, threadId: target.thread.id };
  } catch (err) {
    console.warn('[raid-review] post failed:', err?.message);
    return { ok: false, reason: 'error', error: err?.message };
  }
}

// One pending timer at a time — a redeploy plus a catch-up must not stack two.
let _timer = null;

/**
 * The midnight-chain link. SYNCHRONOUS, never throws, never awaits the network:
 * it only arms a timer. The chain's existing steps and their order are
 * untouched, and a broken review cannot stop archives or resets.
 *
 * Posting is deferred RAID_REVIEW_DELAY_MIN (45) past midnight because raids
 * run to 00:30 — a review built at 00:00 would miss the last half hour.
 */
function scheduleRaidNightReview(client, { nowMs = Date.now() } = {}) {
  try {
    if (!reviewEnabled()) return { scheduled: false, reason: 'disabled' };
    if (!client) return { scheduled: false, reason: 'no-client' };
    const delayMs = reviewDelayMin() * 60_000;
    const win = nightWindowFor(nowMs);
    if (_timer) { clearTimeout(_timer); _timer = null; }
    _timer = setTimeout(() => {
      _timer = null;
      postRaidNightReview(client, { atMs: win.fromMs + 3_600_000 })
        .catch(err => console.warn('[raid-review] deferred post failed:', err?.message));
    }, delayMs);
    if (typeof _timer.unref === 'function') _timer.unref();
    console.log(`[raid-review] ${win.label} review scheduled in ${reviewDelayMin()} min`);
    return { scheduled: true, delayMs, window: win };
  } catch (err) {
    console.warn('[raid-review] schedule failed:', err?.message);
    return { scheduled: false, reason: 'error' };
  }
}

/**
 * Boot link. A setTimeout dies with the process and 00:45 ET is exactly when a
 * deploy is most likely (the raid freeze lifts at 00:30). This posts the most
 * recent COMPLETED night's review if one isn't already stored. Idempotent —
 * the stored message id means a duplicate run edits instead of reposting.
 *
 * Synchronous + never throws, like scheduleRaidNightReview.
 */
function catchUpRaidNightReview(client, { nowMs = Date.now(), delayMs = 60_000 } = {}) {
  try {
    if (!reviewEnabled() || !client) return { scheduled: false, reason: 'disabled' };
    const win = mostRecentReviewableNight(nowMs);
    if (!win) return { scheduled: false, reason: 'no-recent-night' };
    // Local-mirror check only — this function is deliberately SYNCHRONOUS and
    // never awaits the network, so it cannot consult bot_kv. On a fresh
    // container the mirror is always empty, so we schedule; postRaidNightReview
    // then does the durable kv lookup and EDITS the existing message instead of
    // posting a second one. Before the kv id existed this same path is what
    // produced eleven duplicate reviews in one night.
    let already = null;
    try { already = _state().getRaidReviewMessageId(win.nightKey); } catch { /* fall through */ }
    if (already) return { scheduled: false, reason: 'already-posted', window: win };
    const t = setTimeout(() => {
      postRaidNightReview(client, { atMs: win.fromMs + 3_600_000 })
        .catch(err => console.warn('[raid-review] catch-up post failed:', err?.message));
    }, delayMs);
    if (typeof t.unref === 'function') t.unref();
    return { scheduled: true, window: win };
  } catch (err) {
    console.warn('[raid-review] catch-up failed:', err?.message);
    return { scheduled: false, reason: 'error' };
  }
}

// ── Live: the ingest-side hooks ──────────────────────────────────────────────
// Called from _handleAgentUpload AFTER the 200 has gone back to the agent.
// Both are synchronous and swallow everything: the live review must never be
// able to slow, fail, or alter a parse upload.

const _liveNights = new Map();   // nightKey → { dirty, lastRunMs, running, timer, atMs }

function _liveNight(key, atMs) {
  let s = _liveNights.get(key);
  if (!s) { s = { dirty: false, lastRunMs: 0, running: false, timer: null, atMs }; _liveNights.set(key, s); }
  if (Number.isFinite(atMs)) s.atMs = Math.min(s.atMs, atMs);   // anchor stays the night's FIRST pull
  return s;
}

/**
 * The refresh itself. Async, fully try/caught, and single-flight per night.
 * Persists the trash tally on the same cadence — one bot_kv write per edit,
 * never one per upload.
 */
async function _runLiveRefresh(client, key) {
  const s = _liveNights.get(key);
  if (!s || s.running) return;
  s.running = true;
  s.dirty = false;
  s.lastRunMs = Date.now();
  try {
    const win = nightWindowFor(s.atMs);
    // Review FIRST: collectNightData is what learns the night's fight span, and
    // saveTrash needs it to persist the same trimmed totals the embed shows.
    const res = await postRaidNightReview(client, { atMs: s.atMs, live: true });
    await saveTrash(win).catch(() => false);
    if (!res.ok && res.reason !== 'no-thread' && res.reason !== 'event-night') {
      console.log(`[raid-review] live refresh: ${res.reason}`);
    }
  } catch (err) {
    console.warn('[raid-review] live refresh failed:', err?.message);
  } finally {
    s.running = false;
    if (s.dirty) _armLive(client, key);      // uploads landed while we were building
  }
}

function _armLive(client, key) {
  const s = _liveNights.get(key);
  if (!s || s.timer) return;
  const sinceLast = Date.now() - s.lastRunMs;
  const wait = Math.max(liveDebounceMs(), liveMinIntervalMs() - sinceLast);
  s.timer = setTimeout(() => { s.timer = null; _runLiveRefresh(client, key); }, wait);
  if (typeof s.timer.unref === 'function') s.timer.unref();
}

/**
 * "An encounter just landed for this night." SYNCHRONOUS, never throws, never
 * awaits — it marks the night dirty and (re)arms the debounced refresh. It
 * passes NO combat data: every number on the card still comes from Supabase
 * via summarizeNight, so the live card can never disagree with the parse card.
 */
function touchLiveRaidReview(client, { atMs = Date.now() } = {}) {
  try {
    if (!liveEnabled() || !client) return { armed: false, reason: 'disabled' };
    const at = Number.isFinite(atMs) ? atMs : Date.now();
    // Daytime grinding is not a raid. The same gate the night thread uses, so a
    // card only ever exists for a night that HAS a thread to live in.
    if (!_night().isRaidNightAt(at)) return { armed: false, reason: 'not-raid-night' };
    const win = nightWindowFor(at);
    if (_finalDone.has(win.nightKey)) return { armed: false, reason: 'final-posted' };
    // Past the moment the final review is due → let the final own the card.
    const dueMs = win.fromMs + (24 - _night().rolloverHour()) * 3_600_000 + reviewDelayMin() * 60_000;
    if (Date.now() >= dueMs) return { armed: false, reason: 'past-final' };
    const s = _liveNight(win.nightKey, at);
    s.dirty = true;
    _armLive(client, win.nightKey);
    return { armed: true, nightKey: win.nightKey };
  } catch (err) {
    console.warn('[raid-review] live touch failed:', err?.message);
    return { armed: false, reason: 'error' };
  }
}

/**
 * The whole ingest-side hook in one call: tally a trash kill (when it wasn't a
 * tracked boss) and mark the night dirty. SYNCHRONOUS, never throws.
 *
 * `isBoss` comes from the SAME bosses.json match the parse-card volume filter
 * uses (`findBossFromName`), so "trash" here means exactly what it means in
 * the night thread. `confirmed` is the agent's observed death line — an
 * idle-flush pull that never died is not a kill.
 */
function noteEncounterUpload({ atMs, bossName, isBoss = false, confirmed = false,
                               damage = 0, durationSec = 0, players = 0, client = null } = {}) {
  const out = { trash: 'skipped', live: null };
  try {
    if (!isBoss && confirmed && players > 0 && bossName) {
      out.trash = noteTrashKill({ atMs, name: bossName, damage, durationSec });
    }
    if (client) out.live = touchLiveRaidReview(client, { atMs });
  } catch (err) {
    console.warn('[raid-review] note upload failed:', err?.message);
  }
  return out;
}

/** Test seam — drops the pending timer(s). */
function _clearTimer() {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  for (const s of _liveNights.values()) if (s.timer) { clearTimeout(s.timer); s.timer = null; }
  _liveNights.clear();
  _finalDone.clear();
}

module.exports = {
  // pure
  nightWindowFor, isoDateKey, mostRecentReviewableNight,
  summarizeNight, renderReviewEmbeds,
  cleanBossName, fmtDmg, fmtDur, fmtSpan, fmtClock, clampLines, deathStrip, relTime,
  NIGHT_DEATH_DEDUP_MS, AUTO_FOREIGN_MAX_MEMBER_FRAC, AUTO_FOREIGN_MIN_PLAYERS,
  TIMELINE_CELLS,
  // fetch
  collectNightData,
  // trash tally
  noteTrashKill, trashSummary, trashBoundsFor, loadTrash, saveTrash, _resetTrashForTest,
  // post
  postRaidNightReview, scheduleRaidNightReview, catchUpRaidNightReview,
  reviewEnabled, reviewDelayMin, minKills,
  // reserved top-of-thread slots (R3)
  reserveReviewSlots, releaseUnclaimedSlots, claimSlot, tickSlotIndex,
  RESERVED_SLOTS, RESERVED_TITLE, RESERVED_REVIEW_SLOTS, RESERVED_TICK_SLOTS,
  // live
  noteEncounterUpload, touchLiveRaidReview, liveEnabled,
  liveDebounceMs, liveMinIntervalMs,
  _clearTimer, _setDeps, _clearLiveCaches,
};
