// utils/kvLatch.js — "has this one-shot already run?", answered honestly.
//
// THE BUG (Uilnayar, 2026-08-06: "Why are these reposting in Raid Chat?"). The
// Mimic 2.0.0 "Harmonic Howl" announcement is a one-shot from 2026-07-20,
// latched in bot_kv so it can only ever post once. It posted twice in 22
// minutes, weeks later, on a release it had nothing to do with.
//
// The latch itself was fine — the row was in bot_kv the whole time. The GUARD
// was wrong:
//
//     const rows = await supabase.select('bot_kv', '…key=eq.…');
//     if (Array.isArray(rows) && rows[0]) return;   // already announced
//
// `select` returns NULL on a timeout or an open circuit breaker; it does not
// throw (see the contract note in utils/supabase.js — "callers already treat
// null as lookup failed"). So during a Supabase brownout `rows` is null,
// `Array.isArray(null)` is false, the guard falls through, and the bot posts an
// announcement it had already made. Then the latching upsert fails for the same
// reason, so it stays unlatched and does it again on the next boot. Two deploys
// during the 2026-08-06 incident produced exactly two reposts.
//
// This is the same shape as three other bugs this platform has shipped: the 6h
// mob-info null cache, the raid panel blanking on a failed poll, and DI's
// `readyMs == null → up: true`. **Absence rendered as a confident answer.** A
// failed lookup is not evidence of anything, and code that treats it as
// evidence will act on a claim it cannot support.
//
// The asymmetry is what decides the direction here: NOT running a one-shot
// costs nothing (a genuine one fires on the next boot), while running it again
// is guild-visible spam that cannot be un-sent. So: act only on proof.

/**
 * True only when we can PROVE the one-shot has not run yet.
 *
 * @param rows what supabase.select() returned for the latch key:
 *   an array with a row  → it has run     → false
 *   an empty array       → it has not run → true
 *   null / undefined / anything else → the lookup FAILED, we know nothing → false
 */
function shouldRunOnce(rows) {
  if (!Array.isArray(rows)) return false;   // could not check → do not act
  return !rows[0];
}

/** Why shouldRunOnce said no — for the log line, so a skip is never silent. */
function latchState(rows) {
  if (!Array.isArray(rows)) return 'unknown';
  return rows[0] ? 'done' : 'pending';
}

module.exports = { shouldRunOnce, latchState };
