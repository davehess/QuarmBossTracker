// utils/clockOffset.js — spending the measured clock skew.
//
// The bot records every agent's clock offset on the 20s heartbeat (see
// _noteClockPulse in index.js and migration 20260804_agent_clock_offsets).
// Measuring it fixes nothing on its own; this is the half that applies it.
//
// The failure it exists to stop: an install whose clock reads 63s behind stamps
// its deaths 63s behind. Death dedup collapses sightings within 30s of each
// other, so that observer's copy of a SHARED death falls outside the window and
// escapes as a second death — the parse shows two deaths where one happened
// (Fargan's install, Uilnayar 2026-08-06). Widening the dedup window cannot
// substitute for this: 63s is wider than a real rez-and-die-again, so a window
// big enough to swallow the skew would also swallow genuine second deaths.
//
// The I/O and caching live in index.js; everything decidable without a network
// call lives here, where it can be tested.

// ── Gates ────────────────────────────────────────────────────────────────────
// MIN_ABS — under 5s, do nothing. Dedup already collapses everything within
//   30s, so a small correction buys no accuracy and only adds a way to be
//   wrong. We touch clocks that are actually broken.
//
// MAX_SPREAD — 30s, deliberately loose, and this is the counter-intuitive one.
//   spread_ms is max-minus-min across every sample the process ever took, so it
//   is dominated by the worst round-trip in hours of heartbeats, NOT by clock
//   wander. Measured across the fleet 2026-08-06: median 7.2s, max 10.9s, and
//   15 of 28 installs above 5s. A "tight" 5s gate would have rejected Fargan's
//   10.3s machine — the exact one this exists to fix — while looking perfectly
//   reasonable in review. The gate is here to catch a genuinely unstable clock
//   (spread wider than the dedup window it would corrupt), not a noisy network.
//
// MIN_SAMPLES — one heartbeat is a latency measurement wearing an offset's
//   clothes. Ten EWMA'd samples is ~3 minutes of agreement.
//
// MAX_AGE — a stale row is a claim about a machine we have not heard from. Fix
//   your clock and pulse re-converges in ~2 minutes; go offline for a day and
//   we stop asserting anything about you.
const CLOCK_APPLY_MIN_ABS_MS    = 5_000;
const CLOCK_APPLY_MAX_SPREAD_MS = 30_000;
const CLOCK_APPLY_MIN_SAMPLES   = 10;
const CLOCK_APPLY_MAX_AGE_MS    = 6 * 60 * 60 * 1000;

/**
 * The offset we are willing to act on, or 0 for "assert nothing".
 *
 * Fail-closed on the CORRECTION, which is fail-open on behaviour: a missing,
 * malformed, stale or under-sampled row yields 0, and 0 means the timestamps
 * pass through exactly as they do today. This can degrade to a no-op; it must
 * never degrade to a wrong timestamp.
 *
 * Caller must pass a 'pulse' row. The 'consensus' rows in the same table are a
 * dead end — that estimator was backfilled once on 2026-08-04 and has zero
 * write sites, so every consensus row is frozen at that date and drifts further
 * from reality daily. Fargan's machine reads 42s by consensus and 63.5s by
 * pulse; pulse is the one still being measured.
 */
function trustedOffsetMs(row, nowMs = Date.now()) {
  if (!row || typeof row !== 'object') return 0;
  const off     = Number(row.offset_ms);
  const samples = Number(row.samples);
  const spread  = Number(row.spread_ms);
  const seenAt  = typeof row.last_sample_at === 'number'
    ? row.last_sample_at : Date.parse(row.last_sample_at);
  if (!Number.isFinite(off)     || Math.abs(off) < CLOCK_APPLY_MIN_ABS_MS)      return 0;
  if (!Number.isFinite(samples) || samples < CLOCK_APPLY_MIN_SAMPLES)           return 0;
  if (!Number.isFinite(spread)  || spread > CLOCK_APPLY_MAX_SPREAD_MS)          return 0;
  if (!Number.isFinite(seenAt)  || (nowMs - seenAt) > CLOCK_APPLY_MAX_AGE_MS)   return 0;
  return Math.round(off);
}

/**
 * Rewrite each death's `ts` to server time, preserving the original as `tsRaw`.
 *
 * SIGN: offset_ms is server-minus-client, so a machine reading EARLY (behind)
 * stores a POSITIVE offset and its stamps are corrected by ADDING it. Fargan's
 * install reads 63.5s behind; his 21:10:00 death really happened at 21:11:03.
 *
 * Correcting `ts` in place — rather than adding a `tsCorrected` field that
 * every consumer has to learn about — is what keeps this small: dedup, phantom
 * suppression, the Discord card, the web parse page and the fight timelines all
 * read `ts` and all become correct at once. `tsRaw` keeps the forensic original
 * in contributions.raw_parse, so the correction stays auditable and reversible.
 */
function applyClockOffsetToDeaths(deaths, offsetMs) {
  if (!Array.isArray(deaths) || !deaths.length) return Array.isArray(deaths) ? deaths : [];
  if (!Number.isFinite(offsetMs) || offsetMs === 0) return deaths;
  return deaths.map(d => {
    if (!d || typeof d !== 'object' || d.ts == null) return d;
    const raw = typeof d.ts === 'number' ? d.ts : Date.parse(d.ts);
    if (!Number.isFinite(raw)) return d;                  // unparseable → leave alone
    return { ...d,
      ts: new Date(raw + offsetMs).toISOString(),
      tsRaw: d.ts,
      clockOffsetMs: offsetMs,
      clockOffsetMethod: 'pulse' };
  });
}

module.exports = {
  trustedOffsetMs,
  applyClockOffsetToDeaths,
  CLOCK_APPLY_MIN_ABS_MS,
  CLOCK_APPLY_MAX_SPREAD_MS,
  CLOCK_APPLY_MIN_SAMPLES,
  CLOCK_APPLY_MAX_AGE_MS,
};
