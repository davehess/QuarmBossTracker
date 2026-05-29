// utils/raidhelperApi.js — Raid-Helper API client + Supabase mirror.
//
// Distinct from utils/raidhelper.js, which parses the Discord embed posted
// by the RH bot. This module hits the real raid-helper.dev REST API to
// pull structured event + signup data for the /admin/signups view and
// future sign-up-vs-reality reconciliation.
//
// Sync flow:
//   1) listServerEvents()  GET /api/v3/servers/{serverId}/events  with Authorization
//   2) getEvent(eventId)   GET /api/v2/events/{eventId}  (no auth needed)
//   3) upsert mirror rows into rh_events + rh_signups via utils/supabase
//
// RH has shipped multiple API versions and reorganized field names; we
// read defensively (several possible keys per field) and store the full
// raw payload so future fields don't require code changes.
//
// Required env vars:
//   RH_API_KEY     — generated via /apikey refresh && /apikey show in Discord
//   RH_SERVER_ID   — Discord server id (defaults to DISCORD_GUILD_ID)
// Optional:
//   RH_BASE_URL    — override (default: https://raid-helper.dev)

const RH_DEFAULT_BASE = 'https://raid-helper.dev';

function _baseUrl() {
  return (process.env.RH_BASE_URL || RH_DEFAULT_BASE).replace(/\/+$/, '');
}
function _apiKey() {
  return process.env.RH_API_KEY || null;
}
function _serverId() {
  return process.env.RH_SERVER_ID || process.env.DISCORD_GUILD_ID || null;
}
function isEnabled() {
  return !!(_apiKey() && _serverId());
}

async function _request(path, { authorize = true } = {}) {
  if (authorize && !_apiKey()) return null;
  const url = `${_baseUrl()}${path}`;
  const headers = { 'Accept': 'application/json', 'User-Agent': 'quarm-raid-timer-bot' };
  if (authorize) headers['Authorization'] = _apiKey();
  try {
    const res = await fetch(url, { headers });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    if (!res.ok) {
      console.warn(`[raidhelper-api] GET ${path} → ${res.status}:`, typeof parsed === 'string' ? parsed.slice(0, 200) : parsed);
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn('[raidhelper-api] request failed:', err?.message);
    return null;
  }
}

async function listServerEvents({ pageLimit = 4 } = {}) {
  const serverId = _serverId();
  if (!serverId) return [];
  const out = [];
  for (let page = 1; page <= pageLimit; page++) {
    const path = `/api/v3/servers/${encodeURIComponent(serverId)}/events?page=${page}`;
    const data = await _request(path);
    if (!data) break;
    const events = Array.isArray(data) ? data
                  : Array.isArray(data.postedEvents) ? data.postedEvents
                  : Array.isArray(data.events) ? data.events
                  : [];
    if (events.length === 0) break;
    out.push(...events);
    const pages = Number(data.pages || 0);
    if (pages && page >= pages) break;
  }
  return out;
}

async function getEvent(eventId) {
  if (!eventId) return null;
  return await _request(`/api/v2/events/${encodeURIComponent(eventId)}`, { authorize: false });
}

function _toIso(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    const ms = v < 1e12 ? v * 1000 : v;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === 'string') {
    if (/^\d+$/.test(v)) return _toIso(parseInt(v, 10));
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function _projectEvent(ev) {
  if (!ev || typeof ev !== 'object') return null;
  const id = String(ev.id || ev.eventId || ev.event_id || ev.messageId || '');
  if (!id) return null;
  return {
    id,
    guild_id:          process.env.SUPABASE_GUILD_ID || 'wolfpack',
    server_id:         ev.serverId || ev.guildId || _serverId() || null,
    channel_id:        ev.channelId || ev.channel_id || null,
    title:             ev.title || ev.name || null,
    description:       typeof ev.description === 'string' ? ev.description.slice(0, 4000) : null,
    start_time:        _toIso(ev.startTime || ev.startTimeUnix || ev.start_time || ev.startsAt),
    end_time:          _toIso(ev.endTime   || ev.endTimeUnix   || ev.end_time   || ev.endsAt),
    leader_discord_id: ev.leaderId || ev.creatorId || ev.organizerId || null,
    template:          ev.templateId || ev.template || null,
    raw:               ev,
    synced_at:         new Date().toISOString(),
  };
}

function _projectSignup(eventId, s, index) {
  if (!s || typeof s !== 'object') return null;
  const signupId = String(s.id || s.entryId || s.signupId || s.userId || index);
  return {
    event_id:    eventId,
    signup_id:   signupId,
    discord_id:  s.userId || s.user_id || s.discordId || s.id || null,
    user_name:   s.name || s.userName || s.displayName || null,
    status:      s.status || (typeof s.className === 'string' ? s.className.toLowerCase() : null),
    role:        s.role || s.position || s.specName || null,
    class_name:  s.className || s.class || null,
    spec_name:   s.specName  || s.spec  || null,
    signed_at:   _toIso(s.entryTime || s.signedAt || s.entry_time || s.timestamp),
    signup_index: index,
    raw:         s,
    synced_at:   new Date().toISOString(),
  };
}

// Sync recent events + signups. Idempotent. Returns counts.
async function syncRecent({ pageLimit = 4 } = {}) {
  if (!isEnabled()) return { events: 0, signups: 0, skipped: 'RH_API_KEY/RH_SERVER_ID unset' };
  const supabase = require('./supabase');
  if (!supabase.isEnabled()) return { events: 0, signups: 0, skipped: 'supabase disabled' };

  const list = await listServerEvents({ pageLimit });
  if (list.length === 0) return { events: 0, signups: 0 };

  let evCount = 0, sgCount = 0;
  for (const stub of list) {
    const id = String(stub.id || stub.eventId || stub.event_id || '');
    if (!id) continue;
    const detail = await getEvent(id);
    const merged = { ...stub, ...(detail || {}) };
    const eventRow = _projectEvent(merged);
    if (!eventRow) continue;
    const r = await supabase.upsert('rh_events', [eventRow], 'id');
    if (r) evCount++;

    const sUps = Array.isArray(merged.signUps) ? merged.signUps
               : Array.isArray(merged.signups)  ? merged.signups
               : Array.isArray(merged.entries)  ? merged.entries
               : [];
    if (sUps.length === 0) continue;
    const rows = sUps.map((s, i) => _projectSignup(id, s, i)).filter(Boolean);
    if (rows.length > 0) {
      await supabase.upsert('rh_signups', rows, 'event_id,signup_id');
      sgCount += rows.length;
    }
  }
  return { events: evCount, signups: sgCount };
}

module.exports = {
  isEnabled,
  listServerEvents,
  getEvent,
  syncRecent,
};
