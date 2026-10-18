// utils/mapCorpses.js — shape checks and list upkeep for POST /api/agent/map-corpse (corpses on the Mimic Spawn map).
// Pure functions; the route lives in index.js and the list is stored per zone in bot_kv (key `map_corpses:<zone>`),
// so there is no migration. Modelled on utils/mapWatch.js.
//
// The guild lead, 2026-10-17: put the corpses on the map, and link the raider who is dragging one. When a Mimic sees
// its player start or stop dragging, the corpse ends up near that player; a one-off summon has the player targeting the
// corpse, so where it landed is known too. Mimic reports events; this keeps one record per corpse.
//
// Event kinds (positions are in the SERVER frame):
//   died        a new corpse at x,y,z
//   seen        someone targeted "<Name>'s corpse" and Zeal gave its location: exact, overrides the position
//   drag_start  the reporting character began dragging it (position = theirs)
//   drag_move   still dragging (position = theirs; the agent rate-limits these)
//   drag_stop   dragging ended (final position = theirs): the dragger is cleared
//   summoned    the corpse was moved to the summoner's location: the dragger is cleared
//   gone        looted, rezzed or decayed: removed
//
// A corpse lives 24 h from its last update and is then gone on its own. A zone holds at most 60, newest kept.
// One record per (corpse, inst): the same name on two copies of a zone (inst = the zone server's host:port) is two corpses.
// A single bad event is dropped, never a 400 for the batch (as map-sync); only a bad body, zone, character or too many events fails.

'use strict';

const { ZONE_RE, INST_RE } = require('./mapSync');

const KINDS = new Set(['died', 'seen', 'drag_start', 'drag_move', 'drag_stop', 'summoned', 'gone']);
const MAX_EVENTS = 20;
const MAX_FUTURE_MS = 10 * 60 * 1000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CORPSE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CORPSES = 60;
const COORD_MAX = 100000;
const NAME_MAX = 64;
const NAME_RE = /^[A-Za-z]{2,32}$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const cleanText = (v) => {
  if (typeof v !== 'string') return null;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, NAME_MAX);
  return t || null;
};
// Letters only, 2..32, stored as Capitalised so "aldenmar" and "Aldenmar" are one corpse.
const cleanName = (v) => (typeof v === 'string' && NAME_RE.test(v) ? v[0].toUpperCase() + v.slice(1).toLowerCase() : null);
const coord = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < COORD_MAX;

// Returns { zone, inst, character, events, dropped } or { error }. `now` is ms epoch (injected for tests).
// Each event: { kind, corpse, x, y, z, at, dragger }. dragger is the event's own (valid) name, else the reporting
// character for drag_start / drag_move, else null.
function validateCorpseEvents(body, now = Date.now()) {
  if (!isPlainObject(body)) return { error: 'body must be an object' };
  if (typeof body.zone !== 'string' || !ZONE_RE.test(body.zone)) return { error: 'invalid zone' };
  const character = cleanText(body.character);
  if (!character) return { error: 'character required' };
  if (!Array.isArray(body.events)) return { error: 'events must be an array' };
  if (body.events.length > MAX_EVENTS) return { error: `too many events (max ${MAX_EVENTS})` };
  const inst = typeof body.inst === 'string' && INST_RE.test(body.inst) ? body.inst : null;

  const events = [];
  for (const e of body.events) {
    if (!isPlainObject(e)) continue;
    if (typeof e.kind !== 'string' || !KINDS.has(e.kind)) continue;
    const corpse = cleanName(e.corpse);
    if (!corpse) continue;
    if (typeof e.at !== 'number' || !Number.isFinite(e.at)) continue;
    const at = Math.floor(e.at);
    if (at > now + MAX_FUTURE_MS || at < now - MAX_AGE_MS) continue;
    // `gone` carries no position; every other kind needs one.
    const hasPos = coord(e.x) && coord(e.y) && coord(e.z);
    if (e.kind !== 'gone' && !hasPos) continue;
    const dragging = e.kind === 'drag_start' || e.kind === 'drag_move';
    events.push({
      kind: e.kind, corpse, at,
      x: hasPos ? e.x : null, y: hasPos ? e.y : null, z: hasPos ? e.z : null,
      dragger: dragging ? (cleanName(e.dragger) || cleanName(character)) : null,
    });
  }
  return { zone: body.zone, inst, character, events, dropped: body.events.length - events.length };
}

// Records updated within the last 24 h. Tolerates a missing or garbled stored list.
function liveCorpses(list, now = Date.now()) {
  if (!Array.isArray(list)) return [];
  return list.filter(c => isPlainObject(c) && typeof c.corpse === 'string' && Number.isFinite(c.updated_at)
    && now - c.updated_at < CORPSE_TTL_MS && coord(c.x) && coord(c.y) && coord(c.z));
}

const keyOf = (corpse, inst) => corpse.toLowerCase() + '|' + (inst || '');

// The new list after a batch of validated events from one character on one zone copy. Events are applied oldest first.
//  - died: creates or replaces (died_at = at, dragger null), unless the record already has a newer update
//    (a late duplicate report of the same death must not undo a drag that came after it).
//  - seen / summoned / drag_*: move it, only if at >= its updated_at; drag_start / drag_move set the dragger,
//    drag_stop / summoned clear it, seen leaves it. A corpse not yet known is created with died_at null.
//  - gone: removes it (ignored when it predates the record's death: it is about an earlier corpse).
// Expired records are dropped and the newest 60 kept.
function applyCorpseEvents(list, v, now = Date.now()) {
  const map = new Map();
  for (const c of liveCorpses(list, now)) map.set(keyOf(c.corpse, c.inst || null), c);
  const inst = v.inst || null;
  const events = v.events.slice().sort((a, b) => a.at - b.at);
  for (const e of events) {
    const k = keyOf(e.corpse, inst);
    const cur = map.get(k);
    if (e.kind === 'gone') {
      if (cur && !(Number.isFinite(cur.died_at) && e.at < cur.died_at)) map.delete(k);
      continue;
    }
    if (e.kind === 'died') {
      if (cur && e.at < cur.updated_at) continue;
      map.set(k, { corpse: e.corpse, inst, x: e.x, y: e.y, z: e.z, died_at: e.at, updated_at: e.at, dragger: null, by: v.character });
      continue;
    }
    if (cur && e.at < cur.updated_at) continue;
    const dragger = e.kind === 'drag_start' || e.kind === 'drag_move' ? e.dragger
      : e.kind === 'seen' ? (cur ? cur.dragger || null : null) : null;
    map.set(k, {
      corpse: e.corpse, inst, x: e.x, y: e.y, z: e.z,
      died_at: cur && Number.isFinite(cur.died_at) ? cur.died_at : null,
      updated_at: e.at, dragger, by: v.character,
    });
  }
  return liveCorpses([...map.values()], now).sort((a, b) => a.updated_at - b.updated_at).slice(-MAX_CORPSES);
}

module.exports = { validateCorpseEvents, applyCorpseEvents, liveCorpses, KINDS, MAX_EVENTS, CORPSE_TTL_MS, MAX_CORPSES };
