// utils/memberLockout.js — the bot's copy of who is locked out of the guild tools (the guild lead, 2026-10-13).
//
// The table is member_lockouts (supabase/migrations/20261013030000_member_lockouts.sql); officers write it from
// /admin/access on the website. The bot only READS it: every Discord interaction and every Mimic/agent API call
// asks isLocked(), which must be synchronous and cheap, so the rows live in a module-level Map that a 20 s poll
// keeps current. An unlock therefore takes effect within one refresh, and a lock the same way.
//
// Active = the row exists AND (until is null OR until is in the future). `until` is compared at read time, so an
// expired row stops counting without waiting for anyone to delete it.
//
// A failed read (supabase.select resolves null on a timeout or an open breaker) KEEPS the last known set. Treating
// null as "nobody is locked" would let a Supabase blip unlock everybody.

const REFRESH_MS = 20_000;

let _locks = new Map();   // discord_id (string) → { until: ms|null, reason: string|null }
let _timer = null;

function _toMap(rows) {
  const out = new Map();
  for (const r of rows || []) {
    if (!r || r.discord_id == null) continue;
    const t = r.until ? Date.parse(r.until) : null;
    out.set(String(r.discord_id), { until: Number.isFinite(t) ? t : null, reason: r.reason || null });
  }
  return out;
}

async function refresh() {
  try {
    const supabase = require('./supabase');
    if (!supabase.isEnabled()) return false;
    const rows = await supabase.select('member_lockouts', 'select=discord_id,until,reason&limit=1000');
    if (!Array.isArray(rows)) return false;   // timeout / breaker — keep what we had
    _locks = _toMap(rows);
    return true;
  } catch (err) {
    console.warn('[lockout] refresh failed:', err?.message);
    return false;
  }
}

function start() {
  if (_timer) return;
  refresh();
  _timer = setInterval(refresh, REFRESH_MS);
  if (_timer.unref) _timer.unref();
}

function isLocked(discordId, now = Date.now()) {
  if (discordId == null) return false;
  const l = _locks.get(String(discordId));
  if (!l) return false;
  return l.until === null || l.until > now;
}

// Test hook: replace the set with `rows` shaped like the table's rows.
function _setForTest(rows) { _locks = _toMap(rows); }

module.exports = { refresh, start, isLocked, _setForTest };
