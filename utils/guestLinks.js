// utils/guestLinks.js — the officer's view of guest Mimic links, and the +1h / +3h extend button
// (the guild lead, 2026-10-30: "add guests to the command center for officers/admins with an extend button for +1/+3").
//
// Two OFFICER-ONLY routes, both behind requireAgentAuth (a guest identity is already refused by its allowlist) and
// then identity.is_officer, the same gate the DKP tick and the loot post use:
//
//   GET  /api/agent/guest-links          guests approved in the last 24 h or still running, with fight counts.
//   POST /api/agent/guest-links/extend   { id, hours: 1 | 3 } -> the new expiry.
//
// The Command Center in Mimic calls them through the local agent. The website's /admin/links does the same extend as a
// server action (web/lib/guestLink.ts extendedGuestExpiry keeps the same math); both write an audit_log row.

const supabase = require('./supabase');
const mimicLink = require('./mimicLink');

const EXTEND_HOURS = [1, 3];
const HOUR_MS = 3600 * 1000;
// A list shows a guest for a day after the key lapses, so an officer who sees "expired 5m ago" can still act on it.
const LIST_WINDOW_MS = 24 * HOUR_MS;
// A key that lapses mid-raid can be brought back: an extend on a session that expired within the last 12 hours counts
// from NOW, not from the old expiry. Older than that, the officer approves a fresh code instead (a stale key is more
// likely a forgotten one than a raid that ran long). A REVOKED session is never revived.
const REVIVE_WINDOW_MS = 12 * HOUR_MS;
const LIST_CACHE_MS = 15 * 1000;
const FIGHT_ROWS_MAX = 1000;   // PostgREST's own row cap; a guest past it reads as "1000+" only in the sense of a floor
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// max(now, current expiry) + hours. null for an hours value outside {1, 3}: the buttons are the only callers.
function extendedExpiry(currentIso, hours, nowMs = Date.now()) {
  if (!EXTEND_HOURS.includes(hours)) return null;
  const cur = Date.parse(currentIso);
  const base = Number.isFinite(cur) && cur > nowMs ? cur : nowMs;
  return new Date(base + hours * HOUR_MS).toISOString();
}

// Whether a (non-revoked) session's expiry is recent enough to be brought back.
function canRevive(expiresIso, nowMs = Date.now()) {
  const exp = Date.parse(expiresIso);
  return Number.isFinite(exp) && exp > nowMs - REVIVE_WINDOW_MS;
}

function _json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify(body));
}

// The shared officer gate. Returns the identity, or null after answering.
async function _officer(req, res) {
  const identity = await mimicLink.requireAgentAuth(req, res);
  if (!identity) return null;
  if (!identity.is_officer) { _json(res, 403, { error: 'officers only' }); return null; }
  return identity;
}

let _listCache = null;   // { at, body } — the same answer for every officer
function _forgetListCache() { _listCache = null; }

async function _buildList(nowMs) {
  const rows = await supabase.select(
    'mimic_sessions',
    `guild_id=eq.${encodeURIComponent(supabase.guildId())}&scope=eq.guest`
    + `&expires_at=gte.${encodeURIComponent(new Date(nowMs - LIST_WINDOW_MS).toISOString())}`
    + '&select=id,guest_label,created_at,expires_at,last_used_at,revoked_at,linked_by_discord_id'
    + '&order=created_at.desc&limit=50',
  ).catch(() => null);
  if (!Array.isArray(rows)) return null;   // the store is down, or the guest columns are not migrated yet
  if (rows.length === 0) return { ok: true, guests: [], server_now: nowMs };

  const guestIds = rows.map(r => `guest:${r.id}`);
  const approvers = [...new Set(rows.map(r => r.linked_by_discord_id).filter(Boolean))];
  const [members, fights] = await Promise.all([
    approvers.length
      ? supabase.select('wolfpack_members', `discord_id=in.(${approvers.map(encodeURIComponent).join(',')})&select=discord_id,nickname,global_name`).catch(() => null)
      : Promise.resolve([]),
    supabase.select(
      'contributions',
      `uploaded_by_discord_id=in.(${guestIds.map(encodeURIComponent).join(',')})&select=uploaded_by_discord_id,created_at`
      + `&order=created_at.desc&limit=${FIGHT_ROWS_MAX}`,
    ).catch(() => null),
  ]);
  const nameOf = new Map((Array.isArray(members) ? members : []).map(m => [m.discord_id, m.nickname || m.global_name || null]));
  const count = new Map(); const lastAt = new Map();
  for (const f of (Array.isArray(fights) ? fights : [])) {
    const k = f.uploaded_by_discord_id;
    count.set(k, (count.get(k) || 0) + 1);
    if (!lastAt.has(k)) lastAt.set(k, f.created_at);   // newest first
  }
  return {
    ok: true,
    server_now: nowMs,
    guests: rows.map(r => ({
      id: r.id,
      label: r.guest_label || 'Guest',
      approved_by: nameOf.get(r.linked_by_discord_id) || null,
      created_at: r.created_at,
      expires_at: r.expires_at,
      last_used_at: r.last_used_at || null,
      revoked: !!r.revoked_at,
      fights: count.get(`guest:${r.id}`) || 0,
      last_fight_at: lastAt.get(`guest:${r.id}`) || null,
    })),
  };
}

// GET /api/agent/guest-links
async function handleList(req, res) {
  const identity = await _officer(req, res);
  if (!identity) return;
  const now = Date.now();
  if (!_listCache || now - _listCache.at >= LIST_CACHE_MS) {
    const body = await _buildList(now);
    if (!body) return _json(res, 503, { error: 'guest list unavailable' });
    _listCache = { at: now, body };
  }
  return _json(res, 200, _listCache.body);
}

async function _readBody(req, maxBytes = 4096) {
  let total = 0; const chunks = [];
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) return undefined;
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
}

// POST /api/agent/guest-links/extend  { id, hours }
async function handleExtend(req, res) {
  const identity = await _officer(req, res);
  if (!identity) return;
  const payload = await _readBody(req);
  if (payload === undefined) return _json(res, 413, { error: 'body too large' });
  if (!payload || typeof payload !== 'object') return _json(res, 400, { error: 'invalid JSON' });
  const id = String(payload.id || '');
  if (!SESSION_ID_RE.test(id)) return _json(res, 400, { error: 'id must be a guest session id' });
  if (!EXTEND_HOURS.includes(payload.hours)) return _json(res, 400, { error: 'hours must be 1 or 3' });

  const rows = await supabase.select(
    'mimic_sessions',
    `id=eq.${encodeURIComponent(id)}&guild_id=eq.${encodeURIComponent(supabase.guildId())}&scope=eq.guest&select=*&limit=1`,
  ).catch(() => null);
  if (!Array.isArray(rows)) return _json(res, 503, { error: 'store unavailable, retry' });
  const row = rows[0];
  if (!row) return _json(res, 404, { error: 'no such guest link' });
  if (row.revoked_at) return _json(res, 409, { error: 'revoked' });
  const now = Date.now();
  if (!canRevive(row.expires_at, now)) return _json(res, 409, { error: 'expired too long ago, approve a new code' });

  const expiresAt = extendedExpiry(row.expires_at, payload.hours, now);
  // revoked_at IS NULL in the filter: an officer's Revoke landing between the read and this write wins.
  const updated = await supabase.update(
    'mimic_sessions',
    `id=eq.${encodeURIComponent(id)}&scope=eq.guest&revoked_at=is.null`,
    { expires_at: expiresAt },
  ).catch(() => null);
  if (!Array.isArray(updated)) return _json(res, 503, { error: 'store unavailable, retry' });
  if (updated.length === 0) return _json(res, 409, { error: 'revoked' });

  mimicLink.forgetGuestSession(id, row.session_token);   // the new expiry applies on the guest's very next request
  _forgetListCache();
  await supabase.insert('audit_log', [{
    guild_id: supabase.guildId(),
    action: 'guest_link_extended',
    actor_discord_id: identity.discord_id,
    actor_name: identity.display_name || null,
    payload: {
      session_id: id, guest_label: row.guest_label || null, hours: payload.hours,
      from: row.expires_at, to: expiresAt, revived: Date.parse(row.expires_at) <= now, via: 'command_center',
    },
  }]).catch(() => null);

  return _json(res, 200, {
    ok: true,
    guest: {
      id, label: row.guest_label || 'Guest', created_at: row.created_at, expires_at: expiresAt,
      last_used_at: row.last_used_at || null, revoked: false,
    },
  });
}

module.exports = {
  handleList, handleExtend,
  extendedExpiry, canRevive, EXTEND_HOURS, REVIVE_WINDOW_MS, LIST_WINDOW_MS,
  _forgetListCache,
};
