// utils/mapWatch.js — shape checks and list upkeep for POST /api/agent/map-watch (the Mimic Spawn map's ★ watches).
// Pure functions; the route lives in index.js and the list is stored per zone in bot_kv (key `map_watch:<zone>`),
// so there is no migration and no new map_spawn_events kind (its `kind` column has a CHECK constraint).
//
// The guild lead, 2026-10-16 ("A — Watch a spot"): a raider marks a spawn point that can spawn a named (a placeholder
// point whose spawn group includes the named) as WATCHED. Watches are guild-shared: everyone with the Map open in that
// zone sees the ★ and gets a timer when the placeholder there is killed.
//
// A watch lives 12 hours (a raid night plus slack) and is then gone on its own. A zone holds at most 40, newest kept.
// One watch per (point_id, inst): the same point on two copies of a zone (inst = the zone server's host:port) is two watches.

'use strict';

const { ZONE_RE, INST_RE } = require('./mapSync');

const WATCH_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_WATCHES = 40;
const INT4_MAX = 2147483647;
const NAME_MAX = 64;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const cleanText = (v) => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, NAME_MAX);
  return t || null;
};

// Returns { zone, point_id, named, on, inst, character } or { error }. A malformed `inst` is null, never an error
// (same as map-sync). `named` is required when turning a watch on and ignored (null) when turning one off.
function validateWatch(body, now = Date.now()) {
  void now;
  if (!isPlainObject(body)) return { error: 'body must be an object' };
  if (typeof body.zone !== 'string' || !ZONE_RE.test(body.zone)) return { error: 'invalid zone' };
  if (!Number.isInteger(body.point_id) || body.point_id < 0 || body.point_id > INT4_MAX) return { error: 'invalid point_id' };
  if (typeof body.on !== 'boolean') return { error: 'on must be a boolean' };
  const character = cleanText(body.character);
  if (!character) return { error: 'character required' };
  const named = body.on ? cleanText(body.named) : null;
  if (body.on && !named) return { error: 'named required' };
  const inst = typeof body.inst === 'string' && INST_RE.test(body.inst) ? body.inst : null;
  return { zone: body.zone, point_id: body.point_id, named, on: body.on, inst, character };
}

// Entries younger than 12 h. Tolerates a missing or garbled stored list.
function liveWatches(list, now = Date.now()) {
  if (!Array.isArray(list)) return [];
  return list.filter(w => isPlainObject(w) && Number.isFinite(w.at) && now - w.at < WATCH_TTL_MS);
}

// The new list after one toggle: expired entries dropped, the (point_id, inst) entry replaced or removed, newest 40 kept.
function applyWatch(list, w, now = Date.now()) {
  const same = (e) => e.point_id === w.point_id && (e.inst || null) === (w.inst || null);
  const kept = liveWatches(list, now).filter(e => !same(e));
  if (w.on) kept.push({ point_id: w.point_id, named: w.named, inst: w.inst || null, by: w.character, at: now });
  kept.sort((a, b) => a.at - b.at);
  return kept.slice(-MAX_WATCHES);
}

module.exports = { validateWatch, applyWatch, liveWatches, WATCH_TTL_MS, MAX_WATCHES };
