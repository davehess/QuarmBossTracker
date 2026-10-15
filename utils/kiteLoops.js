// utils/kiteLoops.js — the guild's library of clean kite loops (the guild lead, 2026-10-15: "common non-drifting
// circles and speeds are worth us hanging onto").
//
// Mimic fits a circle to the player's own position and uploads ONLY that circle: POST /api/agent/kite-loop. This
// module validates it, merges it with the loop already at that spot, keeps the table bounded and serves the best
// few back (GET /api/agent/kite-loops). The routes live in index.js; the table is
// supabase/migrations/20261015120000_kite_loops.sql.
//
// PRIVACY: no path and no person. The uploader's identity reaches this module only as a string key for the
// in-memory rate limit below; it is never written to the database, never logged and never part of a row.
//
// Pure functions where possible; `supabase` is injected (the utils/zoneSpawns.js shape) so tests can hand in a stub.

'use strict';

const ZONE_RE = /^[a-z0-9_]{1,32}$/;
const DIRS = new Set(['cw', 'ccw']);
const TABLE = 'kite_loops';

// Bounds a clean loop must sit inside (units are EverQuest world units; times are seconds).
const R_MIN = 20, R_MAX = 500;
const LAP_MIN_S = 3, LAP_MAX_S = 300;
const LAPS_MIN = 3, LAPS_MAX = 1000;
const SPEED_MIN = 10, SPEED_MAX = 400;       // % of normal run
const COORD_MAX = 100000;
const DRIFT_FRAC_MAX = 0.15;                 // drift_u and wobble_u may each be at most this fraction of r
const AT_FUTURE_MS = 10 * 60 * 1000;
const AT_PAST_MS = 30 * 24 * 60 * 60 * 1000; // the agent's durable queue can hold a loop for a while

// Merge: two loops are the SAME SPOT when they turn the same way, their centres (x/y) are within
// MERGE_CENTRE_FRAC of the radius and their radii are within MERGE_RADIUS_FRAC of the larger one.
const MERGE_CENTRE_FRAC = 0.35;
const MERGE_RADIUS_FRAC = 0.25;

const ZONE_CAP = 60;                         // rows kept per guild+zone
const SERVE_MAX = 12;                        // loops served per zone
const CACHE_MS = 60 * 1000;
const CACHE_MAX_ZONES = 200;
const RATE_PER_HOUR = 30;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_KEYS_MAX = 5000;

const round2 = (n) => Math.round(n * 100) / 100;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// quality in 0..1, higher is better. Cleaner = less centre drift per lap and less radius wobble, both measured
// against the loop's own size (so a big loop is not punished for the same absolute error), and more consecutive
// clean laps is more evidence:
//   tol         = DRIFT_FRAC_MAX * r                       (the most the validator lets either error be)
//   driftScore  = 1 - min(1, drift_u  / tol)
//   wobbleScore = 1 - min(1, wobble_u / tol)
//   lapsScore   = min(laps, 12) / 12
//   quality     = 0.45 * driftScore + 0.35 * wobbleScore + 0.20 * lapsScore       (rounded to 4 places)
// Drift weighs most because a drifting loop is the one that walks you out of the pull spot.
function quality(l) {
  const tol = DRIFT_FRAC_MAX * l.r;
  const driftScore = 1 - Math.min(1, l.drift_u / tol);
  const wobbleScore = 1 - Math.min(1, l.wobble_u / tol);
  const lapsScore = Math.min(l.laps, 12) / 12;
  return Math.round((0.45 * driftScore + 0.35 * wobbleScore + 0.20 * lapsScore) * 10000) / 10000;
}

// Returns { loop } (clean numbers, whitelisted fields only) or { error }. `now` is ms epoch (injected for tests).
function validateLoop(body, now = Date.now()) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { error: 'body must be an object' };
  if (typeof body.zone !== 'string' || !ZONE_RE.test(body.zone)) return { error: 'invalid zone' };
  for (const k of ['cx', 'cy', 'cz']) {
    if (!isNum(body[k]) || Math.abs(body[k]) > COORD_MAX) return { error: `invalid ${k}` };
  }
  if (!isNum(body.r) || body.r < R_MIN || body.r > R_MAX) return { error: `r must be ${R_MIN}-${R_MAX}` };
  if (!isNum(body.lap_s) || body.lap_s < LAP_MIN_S || body.lap_s > LAP_MAX_S) return { error: `lap_s must be ${LAP_MIN_S}-${LAP_MAX_S}` };
  if (!isNum(body.speed_pct) || body.speed_pct < SPEED_MIN || body.speed_pct > SPEED_MAX) return { error: `speed_pct must be ${SPEED_MIN}-${SPEED_MAX}` };
  if (!Number.isInteger(body.laps) || body.laps < LAPS_MIN || body.laps > LAPS_MAX) return { error: `laps must be an integer ${LAPS_MIN}-${LAPS_MAX}` };
  if (typeof body.dir !== 'string' || !DIRS.has(body.dir)) return { error: 'dir must be cw or ccw' };
  const tol = DRIFT_FRAC_MAX * body.r;
  if (!isNum(body.drift_u) || body.drift_u < 0 || body.drift_u > tol) return { error: 'drift_u too large (loop is not clean)' };
  if (!isNum(body.wobble_u) || body.wobble_u < 0 || body.wobble_u > tol) return { error: 'wobble_u too large (loop is not clean)' };
  const at = typeof body.at === 'string' ? Date.parse(body.at) : NaN;
  if (!Number.isFinite(at) || at > now + AT_FUTURE_MS || at < now - AT_PAST_MS) return { error: 'invalid at' };
  const ver = typeof body.agent_version === 'string' && /^[0-9A-Za-z.+-]{1,24}$/.test(body.agent_version) ? body.agent_version : null;

  const loop = {
    zone: body.zone,
    cx: round2(body.cx), cy: round2(body.cy), cz: round2(body.cz),
    r: round2(body.r), lap_s: round2(body.lap_s), speed_pct: round2(body.speed_pct),
    dir: body.dir,
    drift_u: round2(body.drift_u), wobble_u: round2(body.wobble_u),
    laps: body.laps,
    agent_version: ver,
  };
  loop.quality = quality(loop);
  return { loop };
}

// The existing row at the same spot as `loop`, or null. With several candidates the nearest centre wins.
// The centre test is x/y only (a loop is a flat circle; z drifts with slopes), so loops stacked on different
// floors of one zone would merge. Accepted: it is rare, and the cleaner geometry wins either way.
function findSameSpot(rows, loop) {
  let best = null, bestD = Infinity;
  for (const row of rows) {
    if (row.dir !== loop.dir) continue;
    if (Math.abs(row.r - loop.r) > MERGE_RADIUS_FRAC * Math.max(row.r, loop.r)) continue;
    const d = Math.hypot(row.cx - loop.cx, row.cy - loop.cy);
    if (d > MERGE_CENTRE_FRAC * loop.r) continue;
    if (d < bestD) { best = row; bestD = d; }
  }
  return best;
}

// Which rows to drop to get back to the cap: lowest keep-score first, where
//   keep = quality / (1 + ageDays / 14)        (a clean loop outlives a sloppy one; a stale one fades)
// `protectId` (the row just written) is never a candidate.
function pickEvictions(rows, protectId, cap, nowMs) {
  const over = rows.length - cap;
  if (over <= 0) return [];
  const keep = (r) => {
    const ageDays = Math.max(0, (nowMs - Date.parse(r.last_at)) / 86400000);
    return (Number(r.quality) || 0) / (1 + (Number.isFinite(ageDays) ? ageDays : 0) / 14);
  };
  return rows.filter(r => r.id !== protectId)
    .sort((a, b) => keep(a) - keep(b))
    .slice(0, over)
    .map(r => r.id);
}

// ── Per-zone serialisation. Two uploads for one spot arriving together must not both insert. One bot replica,
// so an in-process chain is enough.
const _locks = new Map();
function _withLock(key, fn) {
  const prev = _locks.get(key) || Promise.resolve();
  const run = prev.then(fn);
  const tail = run.catch(() => {});
  _locks.set(key, tail);
  tail.then(() => { if (_locks.get(key) === tail) _locks.delete(key); });
  return run;
}

// ── Cache for the served list.
const _cache = new Map();   // `${guildId}|${zone}` -> { at, loops }

// Store (or merge) one validated loop. Returns { status: 200, id, merged } or { status: 503 }.
function ingest(supabase, guildId, loop, nowMs = Date.now()) {
  return _withLock(`${guildId}|${loop.zone}`, async () => {
    const rows = await supabase.select(TABLE, `guild_id=eq.${encodeURIComponent(guildId)}&zone=eq.${encodeURIComponent(loop.zone)}&select=*&limit=${ZONE_CAP * 3}`);
    if (!Array.isArray(rows)) return { status: 503 };
    const nowIso = new Date(nowMs).toISOString();
    const hit = findSameSpot(rows, loop);
    let id, merged;
    if (hit) {
      // MERGE: keep the cleaner geometry whole (never an average: two real loops averaged is a circle nobody
      // ran, and the lap time and speed must stay a pair that was actually observed together). seen counts every
      // sighting; last_at is our clock, not the uploader's.
      const patch = { seen: (Number(hit.seen) || 1) + 1, last_at: nowIso };
      if (loop.quality > (Number(hit.quality) || 0)) {
        Object.assign(patch, {
          cx: loop.cx, cy: loop.cy, cz: loop.cz, r: loop.r, lap_s: loop.lap_s, speed_pct: loop.speed_pct,
          drift_u: loop.drift_u, wobble_u: loop.wobble_u, laps: loop.laps, quality: loop.quality,
          agent_version: loop.agent_version,
        });
      }
      const out = await supabase.update(TABLE, `id=eq.${hit.id}`, patch);
      if (out === null) return { status: 503 };
      id = hit.id; merged = true;
    } else {
      const out = await supabase.insert(TABLE, [{
        guild_id: guildId, zone: loop.zone,
        cx: loop.cx, cy: loop.cy, cz: loop.cz, r: loop.r, lap_s: loop.lap_s, speed_pct: loop.speed_pct,
        dir: loop.dir, drift_u: loop.drift_u, wobble_u: loop.wobble_u, laps: loop.laps,
        seen: 1, quality: loop.quality, first_at: nowIso, last_at: nowIso, agent_version: loop.agent_version,
      }]);
      id = Array.isArray(out) ? out[0]?.id : undefined;
      if (id === undefined) return { status: 503 };
      merged = false;
      const drop = pickEvictions(rows.concat([{ id, quality: loop.quality, last_at: nowIso }]), id, ZONE_CAP, nowMs);
      if (drop.length) await supabase.del(TABLE, `id=in.(${drop.join(',')})`);
    }
    _cache.delete(`${guildId}|${loop.zone}`);
    return { status: 200, id, merged };
  });
}

// The best loops for a zone, best first: ordered by quality * ln(1 + seen) (a clean loop many people have
// found beats a slightly cleaner one seen once). Cached 60 s per guild+zone: egress is what bills.
// Returns { status: 200, loops } | { status: 400 } | { status: 503 }.
async function query(supabase, guildId, zone, nowMs = Date.now()) {
  if (typeof zone !== 'string' || !ZONE_RE.test(zone)) return { status: 400 };
  const key = `${guildId}|${zone}`;
  const hit = _cache.get(key);
  if (hit && nowMs - hit.at < CACHE_MS) return { status: 200, loops: hit.loops };
  const rows = await supabase.select(TABLE, `guild_id=eq.${encodeURIComponent(guildId)}&zone=eq.${encodeURIComponent(zone)}&select=id,cx,cy,cz,r,lap_s,speed_pct,dir,drift_u,wobble_u,laps,seen,quality,last_at&limit=${ZONE_CAP * 3}`);
  if (!Array.isArray(rows)) return { status: 503 };
  const score = (r) => (Number(r.quality) || 0) * Math.log(1 + (Number(r.seen) || 1));
  const loops = rows
    .sort((a, b) => score(b) - score(a) || Date.parse(b.last_at) - Date.parse(a.last_at) || a.id - b.id)
    .slice(0, SERVE_MAX)
    .map(({ id, cx, cy, cz, r, lap_s, speed_pct, dir, drift_u, wobble_u, laps, seen, last_at }) =>
      ({ id, cx, cy, cz, r, lap_s, speed_pct, dir, drift_u, wobble_u, laps, seen, last_at }));
  if (_cache.size >= CACHE_MAX_ZONES) _cache.delete(_cache.keys().next().value);
  _cache.set(key, { at: nowMs, loops });
  return { status: 200, loops };
}

// ── Per-uploader rate limit: RATE_PER_HOUR uploads per rolling hour, in memory only. `key` is whatever string
// identifies the uploader to the caller; it lives in this map and nowhere else (never stored, never logged).
const _rate = new Map();   // key -> [timestamps within the window]
function allowUpload(key, nowMs = Date.now()) {
  if (_rate.size > RATE_KEYS_MAX) {
    for (const [k, ts] of _rate) if (!ts.length || nowMs - ts[ts.length - 1] >= RATE_WINDOW_MS) _rate.delete(k);
  }
  const ts = (_rate.get(key) || []).filter(t => nowMs - t < RATE_WINDOW_MS);
  if (ts.length >= RATE_PER_HOUR) { _rate.set(key, ts); return false; }
  ts.push(nowMs);
  _rate.set(key, ts);
  return true;
}

function _resetForTests() { _cache.clear(); _rate.clear(); _locks.clear(); }

module.exports = {
  validateLoop, quality, findSameSpot, pickEvictions, ingest, query, allowUpload, _resetForTests,
  ZONE_RE, ZONE_CAP, SERVE_MAX, RATE_PER_HOUR, CACHE_MS,
};
