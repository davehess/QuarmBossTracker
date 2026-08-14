// utils/raidhelperApi.js — Raid-Helper API client + Supabase mirror.
//
// Distinct from utils/raidhelper.js, which parses the Discord embed posted
// by the RH bot. This module hits the real raid-helper.dev REST API to
// pull structured event + signup data for the /admin/signups view and
// future sign-up-vs-reality reconciliation.
//
// Sync flow:
//   1) listServerEvents()  GET /api/v4/servers/{serverId}/events  with Authorization
//                          (falls back to the retired v3 path if v4 404s)
//   2) getEvent(eventId)   GET /api/v2/events/{eventId}  (no auth needed)
//   3) upsert mirror rows into rh_events + rh_signups via utils/supabase
//
// RH has shipped multiple API versions and reorganized field names; we
// read defensively (several possible keys per field) and store the full
// raw payload so future fields don't require code changes. The service also
// moved domains (.dev → .xyz): the old raid-helper.dev host still answers but
// its Javalin router no longer has the server-events route (observed 404
// "Endpoint not found", 2026-07-31), so the default base is raid-helper.xyz.
//
// Required env vars:
//   RH_API_KEY     — generated via /apikey refresh && /apikey show in Discord
//   RH_SERVER_ID   — Discord server id (defaults to DISCORD_GUILD_ID)
// Optional:
//   RH_BASE_URL    — override (default: https://raid-helper.xyz)

const RH_DEFAULT_BASE = 'https://raid-helper.xyz';

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

async function _request(path, { authorize = true, headers: extraHeaders } = {}) {
  if (authorize && !_apiKey()) return null;
  const url = `${_baseUrl()}${path}`;
  const headers = { 'Accept': 'application/json', 'User-Agent': 'quarm-raid-timer-bot', ...(extraHeaders || {}) };
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

// Current docs say v4; v3 kept as a fallback in case the deployment we hit
// is older. Pagination is sent both ways (query param + Page header) because
// the docs have flipped between them across versions. IncludeSignUps asks v4
// to inline signups so a dead v2 detail route doesn't cost us the signup data.
const RH_LIST_VERSIONS = ['v4', 'v3'];

async function listServerEvents({ pageLimit = 4 } = {}) {
  const serverId = _serverId();
  if (!serverId) return [];
  const out = [];
  let version = null;   // locked to whichever version answers page 1
  for (let page = 1; page <= pageLimit; page++) {
    let data = null;
    for (const v of version ? [version] : RH_LIST_VERSIONS) {
      const path = `/api/${v}/servers/${encodeURIComponent(serverId)}/events?page=${page}`;
      data = await _request(path, { headers: { 'Page': String(page), 'IncludeSignUps': 'true' } });
      if (data) { version = v; break; }
    }
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

  // The v2 per-event detail route died in the .dev→.xyz move; the v4 listing's
  // IncludeSignUps carries everything we need, so after 3 consecutive detail
  // failures stop asking — otherwise every 30-min sync burns one request + one
  // 404 warn line PER EVENT (284 events = ~13.6k log lines/day of pure noise).
  let evCount = 0, sgCount = 0, detailFails = 0;
  for (const stub of list) {
    const id = String(stub.id || stub.eventId || stub.event_id || '');
    if (!id) continue;
    const detail = detailFails >= 3 ? null : await getEvent(id);
    if (detailFails < 3) detailFails = detail ? 0 : detailFails + 1;
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

// ── Staleness check (#34) ────────────────────────────────────────────────────
// This mirror is the ONLY durable copy of who said they were coming. The
// upstream Raid-Helper board is cleared on raid day, so a sync that quietly
// stops working does not degrade — it deletes the record, permanently, and
// nothing anywhere says so. Nobody would notice until an officer went looking
// for last week's availability and found nothing.
//
// Two distinct failures, because they need different answers:
//   • MIRROR STALE — no successful sync in a long while. The API key expired,
//     RH moved hosts again (it has, .dev → .xyz), the route changed. Broad.
//   • BLIND SPOT — a raid is coming up and we hold no signups for it. The sync
//     may be "working" (events arriving) while the part that matters is empty,
//     which is the failure that actually costs us availability data.
//
// Pure and side-effect-free: takes the facts, returns a verdict. The caller
// decides whether to shout, so this can be tested without a Discord client.
const RH_STALE_HOURS = 6;            // ~12 missed syncs at the 30-min cadence
// 24h = "this time yesterday", i.e. the evening before a raid. Deliberately not
// wider: raids are Sun/Wed/Thu at 8pm ET, and a window that reaches back into
// Friday would alarm on a perfectly normal not-yet-signed-up weekend. An alarm
// that fires on an ordinary day is one people learn to ignore, which is worse
// than no alarm — and this one posts to an officer channel every 30 minutes.
const RH_BLIND_SPOT_HOURS = 24;

function assessFreshness({ nowMs, lastSyncMs, upcoming = [] } = {}) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (!Number.isFinite(lastSyncMs) || lastSyncMs <= 0) {
    return { level: 'stale', reason: 'never', ageHours: null, event: null };
  }
  const ageHours = (now - lastSyncMs) / 3_600_000;
  if (ageHours >= RH_STALE_HOURS) {
    return { level: 'stale', reason: 'age', ageHours, event: null };
  }
  // Soonest upcoming raid inside the window that has nothing signed up for it.
  const soon = upcoming
    .filter(e => e && Number.isFinite(e.startMs) && e.startMs > now
                 && (e.startMs - now) <= RH_BLIND_SPOT_HOURS * 3_600_000)
    .sort((a, b) => a.startMs - b.startMs);
  const blind = soon.find(e => !(e.signupCount > 0));
  if (blind) return { level: 'blind', reason: 'no-signups', ageHours, event: blind };
  return { level: 'ok', reason: null, ageHours, event: null };
}

// Gather the facts assessFreshness needs. Separate from the verdict so the
// rules stay testable without a database.
async function freshnessSnapshot() {
  const supabase = require('./supabase');
  if (!supabase.isEnabled()) return null;
  const guildId = process.env.SUPABASE_GUILD_ID || 'wolfpack';
  const nowIso = new Date().toISOString();
  const horizonIso = new Date(Date.now() + RH_BLIND_SPOT_HOURS * 3_600_000).toISOString();
  const [latest, events] = await Promise.all([
    supabase.select('rh_signups', 'select=synced_at&order=synced_at.desc&limit=1'),
    supabase.select('rh_events',
      `guild_id=eq.${encodeURIComponent(guildId)}&start_time=gte.${encodeURIComponent(nowIso)}`
      + `&start_time=lte.${encodeURIComponent(horizonIso)}&select=id,title,start_time&order=start_time.asc&limit=20`),
  ]);
  const lastSyncMs = Array.isArray(latest) && latest[0]?.synced_at
    ? Date.parse(latest[0].synced_at) : 0;
  const upcoming = [];
  for (const e of (Array.isArray(events) ? events : [])) {
    // Count per event rather than trusting a join — an event row can exist with
    // zero signups mirrored, and that gap IS the thing we are looking for.
    let signupCount = 0;
    try {
      const rows = await supabase.select('rh_signups',
        `event_id=eq.${encodeURIComponent(e.id)}&select=signup_id&limit=1000`);
      signupCount = Array.isArray(rows) ? rows.length : 0;
    } catch { signupCount = 0; }
    upcoming.push({ id: e.id, title: e.title || 'raid', startMs: Date.parse(e.start_time), signupCount });
  }
  return { nowMs: Date.now(), lastSyncMs, upcoming };
}

module.exports = {
  isEnabled,
  listServerEvents,
  getEvent,
  syncRecent,
  assessFreshness,
  freshnessSnapshot,
  RH_STALE_HOURS,
  RH_BLIND_SPOT_HOURS,
};
