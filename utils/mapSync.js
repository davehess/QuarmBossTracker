// utils/mapSync.js — shape checks for POST /api/agent/map-sync (the Mimic Spawn map's synced events).
// Pure functions; the routes live in index.js and the table is supabase/migrations/20261012180000_map_spawn_events.sql.
//
// The guild lead, 2026-10-12: the map's spawn-point attributions, once CERTAIN, are shared so every
// member with the map open in the same zone sees the same respawn timers.
//
// What is a 400 and what is dropped: only a malformed BODY or ZONE fails the request. A single bad event
// (non-integer point_id, unknown kind, a clock far from ours) is dropped silently, so one confused client
// event never costs the rest of the batch. More than MAX_EVENTS events is a 400, not a silent cap: the
// client contract is "at most 50 per POST", so a larger batch is a client bug worth seeing.
//
// ponytail: guild-wide per zone, no instance id. Two guild raids in different instances of the same zone
// would see each other's events. Accepted ceiling until the client can name an instance.

'use strict';

const ZONE_RE = /^[a-z0-9_]{2,32}$/;
const KINDS = new Set(['seen', 'died', 'empty', 'up', 'clear']);
const MAX_EVENTS = 50;
const MAX_FUTURE_MS = 10 * 60 * 1000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const INT4_MAX = 2147483647;           // the table's integer columns
const NAME_MAX = 64;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const cleanText = (v) => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, NAME_MAX);
  return t || null;
};

// Returns { zone, character, events, dropped } or { error }. `now` is ms epoch (injected for tests).
function validateEvents(body, now = Date.now()) {
  if (!isPlainObject(body)) return { error: 'body must be an object' };
  if (typeof body.zone !== 'string' || !ZONE_RE.test(body.zone)) return { error: 'invalid zone' };
  const character = cleanText(body.character);
  if (!character) return { error: 'character required' };
  if (!Array.isArray(body.events)) return { error: 'events must be an array' };
  if (body.events.length > MAX_EVENTS) return { error: `too many events (max ${MAX_EVENTS})` };

  const events = [];
  for (const e of body.events) {
    if (!isPlainObject(e)) continue;
    if (!Number.isInteger(e.point_id) || e.point_id < 0 || e.point_id > INT4_MAX) continue;
    if (typeof e.kind !== 'string' || !KINDS.has(e.kind)) continue;
    if (typeof e.at !== 'number' || !Number.isFinite(e.at)) continue;
    const at = Math.floor(e.at);
    if (at > now + MAX_FUTURE_MS || at < now - MAX_AGE_MS) continue;
    // A spawn id of 0 means "no target" on the Zeal pipe, not spawn zero (CLAUDE.md, bot 3.1.123).
    const spawnId = Number.isInteger(e.spawn_id) && e.spawn_id > 0 && e.spawn_id <= INT4_MAX ? e.spawn_id : null;
    events.push({ point_id: e.point_id, kind: e.kind, spawn_id: spawnId, name: cleanText(e.name), at });
  }
  return { zone: body.zone, character, events, dropped: body.events.length - events.length };
}

module.exports = { validateEvents, ZONE_RE, KINDS, MAX_EVENTS, MAX_FUTURE_MS, MAX_AGE_MS };
