// utils/raidSessionWindow.js — which recorded stretch IS the guild raid on a given night.
//
// Pure. Mirrors the rules the website's session review uses (web/lib/raidReplay.ts: SESSION_GAP_MS,
// splitSessions, raidWindows, defaultSessionIndex) so the link the raid review posts opens the SAME session
// the page would pick by default: minutes of raid_track_minutes more than 20 minutes apart are different
// sessions, and the guild's is the one overlapping 19:30-00:30 US Eastern with the most minutes.
// A night_key is a whole calendar day, so it also holds daytime groups that are not the guild; this is what
// keeps those out of the link.

const { localToUTC } = require('./timezone');

const MINUTE_MS = 60_000;
const SESSION_GAP_MS = 20 * MINUTE_MS;
const RAID_TZ = 'America/New_York';      // the raid window is Eastern wall-clock, whatever DEFAULT_TIMEZONE says
const RAID_LEN_MS = 5 * 60 * MINUTE_MS;  // 19:30 -> 00:30

function _ymd(dateKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
}

/** The guild raid window of Eastern calendar day `dateKey` (YYYY-MM-DD): 19:30 -> 00:30 next day. Null on a bad key. */
function raidWindowFor(dateKey) {
  const k = _ymd(dateKey);
  if (!k) return null;
  const fromMs = localToUTC(k.y, k.mo, k.d, 19, 30, RAID_TZ).getTime();
  return { fromMs, toMs: fromMs + RAID_LEN_MS };
}

/** The read bound for a night's minute rows: 12:00 ET that day -> 06:00 ET the next. Null on a bad key. */
function fetchBoundsFor(dateKey) {
  const k = _ymd(dateKey);
  if (!k) return null;
  return {
    fromMs: localToUTC(k.y, k.mo, k.d, 12, 0, RAID_TZ).getTime(),
    toMs:   localToUTC(k.y, k.mo, k.d + 1, 6, 0, RAID_TZ).getTime(),
  };
}

/** Minute timestamps (ms or ISO strings, any order) -> sorted, de-duplicated minute starts in ms. */
function _normalize(minutes) {
  const out = new Set();
  for (const m of Array.isArray(minutes) ? minutes : []) {
    const t = typeof m === 'number' ? m : Date.parse(m);
    if (Number.isFinite(t)) out.add(Math.floor(t / MINUTE_MS) * MINUTE_MS);
  }
  return [...out].sort((a, b) => a - b);
}

/** Sorted minute starts -> sessions {from, to, minutes}; a new one wherever the silence is longer than 20 minutes. */
function splitSessions(sortedMs, gap = SESSION_GAP_MS) {
  const out = [];
  for (const t of sortedMs) {
    const cur = out[out.length - 1];
    if (cur && t - cur.to <= gap) { cur.to = t + MINUTE_MS; cur.minutes++; }
    else out.push({ from: t, to: t + MINUTE_MS, minutes: 1 });
  }
  return out;
}

/**
 * The guild raid session of night `dateKey`: of the sessions that overlap its 19:30-00:30 ET window, the one with
 * the most minutes (a tie goes to the later). {from, to} as ISO strings (to exclusive, end of the last minute),
 * or null when the minutes hold no session in the window.
 */
function raidSessionWindow(minutes, dateKey) {
  const win = raidWindowFor(dateKey);
  if (!win) return null;
  let best = null;
  for (const s of splitSessions(_normalize(minutes))) {
    if (!(s.from < win.toMs && s.to > win.fromMs)) continue;
    if (!best || s.minutes > best.minutes || (s.minutes === best.minutes && s.from > best.from)) best = s;
  }
  return best ? { from: new Date(best.from).toISOString(), to: new Date(best.to).toISOString() } : null;
}

module.exports = { raidSessionWindow, raidWindowFor, fetchBoundsFor, splitSessions, SESSION_GAP_MS };
