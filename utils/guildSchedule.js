// utils/guildSchedule.js — the raid schedule (days, start, end, time zone, night cutoff) from the guild's saved settings.
//
// Source: table guild_settings (supabase/migrations/20261112130000_guild_settings.sql), column `settings.schedule`; the shape
// is web/lib/guildSettings.ts. The bot cannot import TypeScript, so the few rules it needs are restated here and
// test/bot-guild-schedule.test.js pins the defaults to that file's seed.
//
// Contract:
//   getSchedule()   synchronous. The last good value, or the built-in constants (utils/timezone.js RAID_DAYS /
//                   RAID_WINDOW_START / RAID_WINDOW_END) when there is no row, the read failed, Supabase is off, or a
//                   field is invalid. If the cache is stale it starts a background refresh and still answers at once.
//   refreshSchedule() async. Reads the row now. Never throws.
//
// A failed read keeps the last good value and logs ONE stdout line per 10 minutes (console.log, not stderr: an expected
// condition, CLAUDE.md "every bot error line is a bug"). A missing row is not a failure and logs nothing.

const TTL_MS = 10 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const LOG_EVERY_MS = 10 * 60 * 1000;

const HM_RX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMin = (hm) => { const m = HM_RX.exec(hm); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

function _validTz(tz) {
  if (typeof tz !== 'string' || !tz.trim() || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** The constants the bot used before this module existed. */
function constantSchedule() {
  const tzu = require('./timezone');
  return {
    source: 'constants',
    tz: 'America/New_York',
    days: new Set(tzu.RAID_DAYS),
    startMin: tzu.RAID_WINDOW_START,
    endMin: tzu.RAID_WINDOW_END,
    planEndMin: 24 * 60 + 30,       // 00:30, the planning cut-off (CLAUDE.md, raid schedule)
    cutoffHour: 6,                  // utils/raidNight.js DEFAULT_ROLLOVER_HOUR
  };
}

/**
 * Turn a stored `settings` object into a schedule, or null when ANY schedule field is present but invalid, or the days
 * list is empty (a guild with no days picked has no schedule to follow). Fields that are absent take the constants.
 */
function parseSchedule(settings) {
  const s = settings && typeof settings === 'object' ? settings.schedule : null;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const base = constantSchedule();
  const out = { ...base, source: 'row' };
  if (s.tz !== undefined) { if (!_validTz(s.tz)) return null; out.tz = s.tz; }
  if (s.days !== undefined) {
    if (!Array.isArray(s.days) || !s.days.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) return null;
    out.days = new Set(s.days);
  }
  if (s.start !== undefined) { const m = toMin(s.start); if (m === null) return null; out.startMin = m; }
  if (s.end !== undefined) { const m = toMin(s.end); if (m === null) return null; out.endMin = m; }
  if (s.planEnd !== undefined) {
    const m = toMin(s.planEnd); if (m === null) return null;
    out.planEndMin = m <= out.startMin ? m + 24 * 60 : m;
  }
  if (s.nightCutoffHour !== undefined) {
    if (!Number.isInteger(s.nightCutoffHour) || s.nightCutoffHour < 0 || s.nightCutoffHour > 12) return null;
    out.cutoffHour = s.nightCutoffHour;
  }
  if (out.days.size === 0 || out.startMin === out.endMin) return null;
  return out;
}

let _current = null;          // last good parsed row (null → constants)
let _nextAt = 0;              // when the cache is stale
let _inflight = null;
let _lastLogAt = 0;
let _loader = null;           // test seam: async () => rows | null

function _logOnce(msg) {
  const now = Date.now();
  if (now - _lastLogAt < LOG_EVERY_MS) return;
  _lastLogAt = now;
  console.log(`[guild-schedule] ${msg}`);
}

async function _readRows() {
  if (_loader) return _loader();
  const supabase = require('./supabase');
  if (!supabase.isEnabled()) return undefined;             // off: constants, no read, no log
  return supabase.select('guild_settings',
    `guild_id=eq.${encodeURIComponent(supabase.guildId())}&select=settings&limit=1`);
}

async function refreshSchedule() {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const rows = await _readRows();
      if (rows === undefined) { _current = null; _nextAt = Date.now() + TTL_MS; return getSchedule(); }
      if (!Array.isArray(rows)) {                          // null = the read failed: keep the last good value
        _nextAt = Date.now() + RETRY_MS;
        _logOnce('read failed, keeping the last good schedule');
        return getSchedule();
      }
      if (!rows[0]) { _current = null; _nextAt = Date.now() + TTL_MS; return getSchedule(); }
      const parsed = parseSchedule(rows[0].settings);
      if (!parsed) _logOnce('saved schedule is invalid, using the built-in one');
      _current = parsed;
      _nextAt = Date.now() + TTL_MS;
    } catch (e) {
      _nextAt = Date.now() + RETRY_MS;
      _logOnce(`read threw (${e && e.message}), keeping the last good schedule`);
    } finally { _inflight = null; }
    return getSchedule();
  })();
  return _inflight;
}

function getSchedule() {
  if (Date.now() >= _nextAt && !_inflight) {
    _nextAt = Date.now() + RETRY_MS;                       // one kick per minute at most, even if it never resolves
    refreshSchedule().catch(() => {});
  }
  return _current || constantSchedule();
}

function _reset() { _current = null; _nextAt = 0; _inflight = null; _lastLogAt = 0; _loader = null; }
// Test seam: a loader replaces the Supabase read and the cache is cleared. Pass null to restore.
function _setLoader(fn) { _reset(); _loader = fn; if (!fn) _nextAt = 0; }

module.exports = { getSchedule, refreshSchedule, parseSchedule, constantSchedule, TTL_MS, _setLoader, _reset };
