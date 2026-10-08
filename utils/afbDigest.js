// utils/afbDigest.js — the weekly "anonymous feedback" count line, and when it is due.
//
// The guild lead, 2026-10-08: anonymous feedback (public.anon_feedback, handle AFB-<n>) is never acted on
// automatically, "but it should be consistently reviewed", so the bot posts ONE line a week into the
// #feedback thread with counts only: how many came in this week and how many still wait for a read. Never
// any report text. Pure; test/afb-digest.test.js. The bot's job (index.js _afbWeeklyDigest) does the I/O.

const ADMIN_URL = 'https://wolfpack.quest/admin/feedback/anonymous';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DUE_DAY_UTC = 1;     // Monday
const DUE_HOUR_UTC = 13;   // first look at or after 13:00 UTC

// ISO-8601 week of a date, in UTC: "2026-W41". The week belongs to the year of its Thursday.
function weekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));   // The Thursday of this week.
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Due on a Monday from 13:00 UTC, once per ISO week. `latchedWeek` is the week already handled ('' / null
// when none), read from bot_kv by the caller; a redeploy cannot post twice because the latch outlives it.
function isDue(now, latchedWeek) {
  if (now.getUTCDay() !== DUE_DAY_UTC || now.getUTCHours() < DUE_HOUR_UTC) return false;
  return latchedWeek !== weekKey(now);
}

// Counts from the table's rows: `fresh` = filed in the last 7 days, `waiting` = status 'new' (not yet read).
// The timestamp column is read as created_at, falling back to submitted_at (the feedback table's name for
// it), so a rename between the two does not zero the count.
function countRows(rows, now) {
  let fresh = 0;
  let waiting = 0;
  const since = now.getTime() - WEEK_MS;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r) continue;
    if (r.status === 'new') waiting++;
    const t = Date.parse(r.created_at || r.submitted_at || '');
    if (Number.isFinite(t) && t >= since) fresh++;
  }
  return { fresh, waiting };
}

// The one line, or null when there is nothing to say (both counts zero).
function digestLine({ fresh, waiting } = {}) {
  if (!(fresh > 0) && !(waiting > 0)) return null;
  return `🕵️ Anonymous feedback (AFB): ${fresh || 0} new this week, ${waiting || 0} waiting for review → ${ADMIN_URL}`;
}

module.exports = { weekKey, isDue, countRows, digestLine, ADMIN_URL };
