// utils/raidRoute.js — GET /api/agent/raid-route?zone=<short_name> (the saved raid route Mimic's Map draws).
//
// The guild lead, 2026-10-21: "make the route that gets displayed on the maps overlay". An officer saves a zone's
// averaged raid route on the website's Raid routes page (web/app/raid/routes/actions.ts). It is stored in bot_kv under
// `raid_route:<zone_short>` (guild_id = the guild tag) as { v:1, zone, name, saved_at, points:[[x,y]], stops:[...],
// legs:[{ start_index, end_index }], ... } in the SERVER frame (x,y as the .map files and spawn2 carry them, not negated).
//
// This route hands the Map the part it draws and nothing else: the points, the leg ranges into them, the numbered
// named stops, the save date and the zone's long name. It drops the nights, visit keys, medians and clears (the
// website's analysis, not the overlay's). The value comes from a table an officer writes through a server action, but
// it is still re-checked here: a hand-edited row must not be able to hand the fleet a 5 MB body or a script-shaped name.
//
// Cached per zone for 5 minutes, "no route saved" included, so a fleet zoning into the same place is one read.
'use strict';

const ZONE_RE = /^[a-z0-9_]{2,32}$/;
const TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 100;
const MAX_POINTS = 4000;     // drawn points kept; a longer route is thinned evenly per leg
const MAX_STOPS = 60;
const MAX_NAME = 64;
const COORD_LIMIT = 100000;  // EQ coordinates stay well inside this; a bigger number is a garbled row

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const r1 = (n) => Math.round(n * 10) / 10;
const coord = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= COORD_LIMIT;
const text = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_NAME) : '');

// The stored value → the served shape, or null when there is nothing worth drawing (fewer than two points).
function slim(value, zone) {
  if (!isObj(value) || !Array.isArray(value.points)) return null;
  const pts = [];
  for (const p of value.points) {
    if (Array.isArray(p) && coord(p[0]) && coord(p[1])) pts.push([r1(p[0]), r1(p[1])]);
    else pts.push(null);   // keeps the indexes the legs refer to
  }
  // Leg ranges into the stored points; a value with no usable legs is one leg end to end.
  let ranges = [];
  if (Array.isArray(value.legs)) {
    for (const l of value.legs) {
      if (isObj(l) && Number.isInteger(l.start_index) && Number.isInteger(l.end_index)
        && l.start_index >= 0 && l.end_index > l.start_index && l.end_index < pts.length) ranges.push([l.start_index, l.end_index]);
    }
  }
  if (!ranges.length) ranges = [[0, pts.length - 1]];
  const total = ranges.reduce((s, [a, b]) => s + (b - a + 1), 0);
  const stride = Math.max(1, Math.ceil(total / MAX_POINTS));
  const points = [];
  const legs = [];
  for (const [a, b] of ranges) {
    const start = points.length;
    for (let i = a; i <= b; i += stride) if (pts[i]) points.push(pts[i]);
    if (stride > 1 && (b - a) % stride !== 0 && pts[b]) points.push(pts[b]);   // a thinned leg still ends where it ended
    if (points.length - start >= 2) legs.push([start, points.length - 1]);
    else points.length = start;
  }
  if (!legs.length) return null;
  const stops = [];
  if (Array.isArray(value.stops)) {
    for (const s of value.stops) {
      if (!isObj(s) || !coord(s.x) || !coord(s.y) || !Number.isInteger(s.n) || s.n < 1 || s.n > 999) continue;
      const name = text(s.name);
      if (!name) continue;
      stops.push({ n: s.n, name, x: r1(s.x), y: r1(s.y), at: s.at === 'spawn' ? 'spawn' : 'raid' });
      if (stops.length >= MAX_STOPS) break;
    }
  }
  const saved = typeof value.saved_at === 'string' && Number.isFinite(Date.parse(value.saved_at)) ? value.saved_at : null;
  return { v: 1, zone, name: text(value.name) || null, saved_at: saved, points, legs, stops };
}

const cache = new Map();   // zone → { at, route }
function _resetForTests() { cache.clear(); }

// { status:200, route } (route is null when none is saved), { status:400 } for a bad zone, { status:503 } when the read failed.
async function getRoute(supabase, zoneRaw, now = Date.now()) {
  const zone = typeof zoneRaw === 'string' ? zoneRaw : '';
  if (!ZONE_RE.test(zone)) return { status: 400 };
  const hit = cache.get(zone);
  if (hit && now - hit.at <= TTL_MS) return { status: 200, route: hit.route };
  let rows;
  try {
    rows = await supabase.select('bot_kv',
      `guild_id=eq.${encodeURIComponent(supabase.guildId())}&key=eq.${encodeURIComponent('raid_route:' + zone)}&select=value&limit=1`);
  } catch { return { status: 503 }; }
  if (!Array.isArray(rows)) return { status: 503 };
  const route = slim(rows[0] && rows[0].value, zone);
  if (cache.size >= CACHE_MAX) {
    for (const [z, c] of cache) if (now - c.at > TTL_MS) cache.delete(z);
    if (cache.size >= CACHE_MAX) cache.clear();
  }
  cache.set(zone, { at: now, route });
  return { status: 200, route };
}

module.exports = { getRoute, slim, ZONE_RE, TTL_MS, MAX_POINTS, MAX_STOPS, _resetForTests };
