// utils/raidTrack.js — records where the raid stood, one row per UTC minute, so a raid can be replayed on
// wolfpack.quest/spectator.
//
// WHY IT EXISTS
// raid_roster keeps only the LATEST row per (guild, uploader, raider), so the moment a raider moves the
// last position is gone. Every Mimic uploader POSTs /api/agent/raid-roster every ~4 s with ~50 members
// (~25 uploaders at once), and each member row carries loc_x/loc_y/loc_z/heading. Storing those row by
// row would be ~1,100 writes inside 30 s; instead the ingest hands its rows to noteRows() (memory only,
// no I/O), a timer cuts one frame every STEP_S seconds, and a finished minute becomes ONE row in
// raid_track_minutes (migration 20261005020000).
//
// WHAT COUNTS AS A POSITION
// A raider in a DIFFERENT zone from the uploader arrives as exactly (0, 0, 0) — about 72% of rows on a
// live night — and is dropped. Several uploaders see the same raider from slightly different moments, so
// the first uploader to report a raider keeps them for STICKY_MS: alternating between two views would
// make a standing raider shimmer by a few units from frame to frame.
//
// THE FRAME
// x = loc_x and y = loc_y exactly as the roster received them. The zone map is in the server frame, which
// is these two swapped; web/lib/spectator.ts serverXY does that when it plots. Nothing is swapped here.
//
// ZONES
// raid_roster has no zone column. An uploader only reports real positions for raiders in ITS zone, so
// every raider sampled from one uploader shares a zone, and the zone is worked out per uploader at flush
// time from character_live_state (most raiders do not run Mimic, so most have no live row of their own):
// the majority live zone of the raiders that uploader sampled, else the majority across the minute, else
// none. Same rule as web/lib/spectator.ts resolveZoneIds.
//
// PRIVACY
// A character with characters.exclude_from_stats = true is never written. The set is read every 30 min
// and a minute is NOT written until it has been read at least once (fail closed: a privacy flag that
// could not be read must not default to "record everyone").
//
// LOOKS
// After a minute row lands, _writeMinute hands that minute's raiders to utils/raidAppearance.js, which
// keeps a per-night snapshot of how they look (race, worn items → models; migration 20261006020000).
//
// ROW SHAPE (data is compact JSON text; see the migration header)
//   { v:1, step_s, who:[[name,cls,group,level],...], zones:['short',...],
//     f:[[dt, i,x,y,z,h,hp,zi, i,x,y,z,h,hp,zi, ...], ...] }
//
// Env:
//   RAID_TRACK_ENABLED=0         turn the recorder off (start() does nothing)
//   RAID_TRACK_STEP_S            seconds between frames, 1-30 (default 3)
//   RAID_TRACK_MIN_PLACED        a frame with fewer placed raiders is not recorded (default 6)
//   RAID_TRACK_RETENTION_DAYS    nightly sweep in index.js: unset/0 keeps every raid (the default);
//                                a number deletes only minutes the Tower archive already holds

'use strict';

const STEP_S_DEFAULT = 3;
const MIN_PLACED_DEFAULT = 6;
const STICKY_MS = 6000;               // a raider keeps the uploader that reported them for this long
const FRESH_MS = 6000;                // a sample older than this is not in a frame
const PRUNE_MS = 120_000;             // a sample older than this is forgotten
const MAX_TRACKED = 2000;             // hard cap on remembered raiders (ingest input is a request body)
const MAX_PENDING_MINUTES = 3;        // unflushed finished minutes held while Supabase is down
const MAX_ATTEMPTS = 3;               // a minute that fails this many writes is dropped
const RETRY_BACKOFF_MS = 30_000;
const SAFETY_MS = 60_000;             // closes a minute nothing else closed (the raid ended)
const EXCLUDE_TTL_MS = 30 * 60 * 1000;
const ZONE_TTL_MS = 24 * 60 * 60 * 1000;
const LIVE_ZONE_MS = 10 * 60 * 1000;  // how fresh a character_live_state zone must be (the web uses the same)
const NAME_CHUNK = 200;

let _deps = {};
const _sb = () => _deps.supabase || require('./supabase');
const _clock = () => (typeof _deps.now === 'function' ? _deps.now() : Date.now());
const _guildId = () => process.env.SUPABASE_GUILD_ID || 'wolfpack';

function stepS() {
  const n = parseInt(process.env.RAID_TRACK_STEP_S, 10);
  return Number.isFinite(n) ? Math.min(30, Math.max(1, n)) : STEP_S_DEFAULT;
}
function minPlaced() {
  const n = parseInt(process.env.RAID_TRACK_MIN_PLACED, 10);
  return Number.isFinite(n) ? Math.max(1, n) : MIN_PLACED_DEFAULT;
}

// ── State ────────────────────────────────────────────────────────────────────
// lowercase name → { name, cls, group, level, hp, x, y, z, h, atMs, src }. Entries are replaced, never
// mutated, so a frame can hold them by reference.
const latest = new Map();
let cur = null;                       // { minute, frames:[] } — the minute being filled
const pending = [];                   // finished minutes waiting for a write: { minuteStartMs, frames, attempts }
let _flushing = null;
let _retryAt = 0;
let _excl = { at: 0, set: null };     // set: Set<lowercase name> once read at least once
let _zoneCache = { at: 0, map: new Map() };   // zone_id → short_name | null
const _timers = { frame: null, safety: null };

// ── Intake (the ingest hot path: O(rows), no I/O, never throws) ─────────────

/**
 * Remember the positions in one roster upload. `rows` are the objects _handleAgentRaidRoster builds
 * (name, class, group_num, level, hp_pct, loc_x, loc_y, loc_z, heading). Returns how many were kept.
 */
function noteRows(rows, src, nowMs = _clock()) {
  let kept = 0;
  try {
    if (!Array.isArray(rows)) return 0;
    const s = src == null ? '' : String(src);
    for (const r of rows) {
      if (!r || !Number.isFinite(r.loc_x) || !Number.isFinite(r.loc_y)) continue;
      const z = Number.isFinite(r.loc_z) ? r.loc_z : 0;
      if (r.loc_x === 0 && r.loc_y === 0 && z === 0) continue;   // not in the uploader's zone
      if (typeof r.name !== 'string' || !r.name) continue;
      const k = r.name.toLowerCase();
      const have = latest.get(k);
      if (have) {
        if (have.src !== s && nowMs - have.atMs <= STICKY_MS) {   // keep the first uploader's view…
          // …but take HP from whoever has it: an uploader's gauges only cover its OWN group, so the
          // uploader holding a raider's position often has no HP for them.
          if (Number.isFinite(r.hp_pct) && r.hp_pct !== have.hp) latest.set(k, { ...have, hp: r.hp_pct });
          continue;
        }
      } else if (latest.size >= MAX_TRACKED) {
        continue;
      }
      latest.set(k, {
        name: r.name,
        cls: r.class || null,
        group: Number.isFinite(r.group_num) ? r.group_num : null,
        level: Number.isFinite(r.level) ? r.level : null,
        hp: Number.isFinite(r.hp_pct) ? r.hp_pct : null,
        x: r.loc_x, y: r.loc_y, z,
        h: Number.isFinite(r.heading) ? r.heading : null,
        atMs: nowMs,
        src: s,
      });
      kept++;
    }
  } catch { /* the ingest must never fail because the recorder did */ }
  return kept;
}

// ── Frames ───────────────────────────────────────────────────────────────────

function _closeCurrent() {
  if (!cur) return;
  if (cur.frames.length) {
    pending.push({ minuteStartMs: cur.minute * 60_000, frames: cur.frames, attempts: 0 });
    while (pending.length > MAX_PENDING_MINUTES) {
      pending.shift();
      console.warn('[raid-track] dropped the oldest unflushed minute (Supabase is not taking writes)');
    }
  }
  cur = null;
}

/**
 * Cut a frame from the raiders seen in the last FRESH_MS. Returns the frame, or null when fewer than
 * MIN_PLACED raiders were placed (a frame of a few stragglers is not worth a row). A frame that lands in
 * a new UTC minute closes the minute before it, which flush() then writes.
 */
function takeFrame(nowMs = _clock()) {
  const rows = [];
  for (const [k, e] of latest) {
    const age = nowMs - e.atMs;
    if (age > PRUNE_MS) { latest.delete(k); continue; }
    if (age <= FRESH_MS) rows.push(e);
  }
  if (rows.length < minPlaced()) return null;
  const frame = { t: nowMs, rows };
  const minute = Math.floor(nowMs / 60_000);
  if (cur && cur.minute !== minute) _closeCurrent();
  if (!cur) cur = { minute, frames: [] };
  cur.frames.push(frame);
  return frame;
}

/** Close the minute being filled when its minute is over (the raid ended and no frame will do it). */
function closeFinished(nowMs = _clock()) {
  if (!cur || cur.minute >= Math.floor(nowMs / 60_000)) return false;
  _closeCurrent();
  return true;
}

/**
 * Is a raid on the ground right now? { placed, lastRowAt }: how many raiders the roster uploads placed in
 * the last FRESH_MS (the very sample takeFrame() would put in a frame, so "live" here and "worth
 * recording" there are the same call), and when the newest remembered sample landed (ms, or null when
 * nothing is remembered; a quiet raid keeps it for up to PRUNE_MS, or longer while the frame timer is not
 * running). Read-only — it touches no state — and O(tracked raiders), so GET /api/agent/raid-live can call
 * it on every poll.
 */
function liveSnapshot(nowMs = _clock()) {
  let placed = 0;
  let lastRowAt = null;
  for (const e of latest.values()) {
    if (nowMs - e.atMs <= FRESH_MS) placed++;
    if (lastRowAt === null || e.atMs > lastRowAt) lastRowAt = e.atMs;
  }
  return { placed, lastRowAt };
}

// ── Zones and exclusions (flush time only) ───────────────────────────────────

const _enc = encodeURIComponent;

// Names of characters that opted out. null until the first successful read.
async function _excludedSet(sb) {
  const now = _clock();
  if (_excl.set && now - _excl.at < EXCLUDE_TTL_MS) return _excl.set;
  let rows = null;
  try {
    rows = await sb.selectAllPaged('characters',
      `select=name&guild_id=eq.${_enc(_guildId())}&exclude_from_stats=eq.true`, 'name');
  } catch { rows = null; }
  if (!Array.isArray(rows)) {
    console.warn('[raid-track] could not read the excluded characters' + (_excl.set ? ' — keeping the last set' : ' — not writing until it can be read'));
    return _excl.set;
  }
  _excl = { at: now, set: new Set(rows.map(r => String(r?.name || '').toLowerCase()).filter(Boolean)) };
  return _excl.set;
}

// lowercase name → zone_id, for raiders with a live row updated in the last LIVE_ZONE_MS.
async function _liveZoneIds(sb, names) {
  const out = new Map();
  const since = new Date(_clock() - LIVE_ZONE_MS).toISOString();
  for (let i = 0; i < names.length; i += NAME_CHUNK) {
    const inList = '(' + names.slice(i, i + NAME_CHUNK).map(n => `"${n.replace(/["\\]/g, '')}"`).join(',') + ')';
    let rows = null;
    try {
      rows = await sb.select('character_live_state',
        `guild_id=eq.${_enc(_guildId())}&character=in.${_enc(inList)}&updated_at=gte.${_enc(since)}` +
        `&select=character,zone_id&limit=${NAME_CHUNK}`);
    } catch { rows = null; }
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      const id = Number(r?.zone_id);
      if (r?.character && id > 0) out.set(String(r.character).trim().toLowerCase(), id);
    }
  }
  return out;
}

// zone_id → short_name for the ids asked about, cached for a day. An id with no eqemu_zone row is cached
// as null so it is not asked about every minute.
async function _zoneShorts(sb, ids) {
  const now = _clock();
  if (now - _zoneCache.at > ZONE_TTL_MS) _zoneCache = { at: now, map: new Map() };
  const missing = ids.filter(id => Number.isInteger(id) && !_zoneCache.map.has(id)).slice(0, 100);
  if (missing.length) {
    let rows = null;
    try {
      rows = await sb.select('eqemu_zone', `zone_id=in.(${missing.join(',')})&select=zone_id,short_name&limit=100`);
    } catch { rows = null; }
    if (Array.isArray(rows)) {
      for (const r of rows) if (r && r.short_name) _zoneCache.map.set(Number(r.zone_id), String(r.short_name));
      for (const id of missing) if (!_zoneCache.map.has(id)) _zoneCache.map.set(id, null);
    }
  }
  return _zoneCache.map;
}

function _topZone(votes) {
  let best = null, n = 0;
  for (const [id, c] of votes) if (c > n || (c === n && best !== null && id < best)) { best = id; n = c; }
  return best;
}

/**
 * The zone each uploader's raiders stand in, as { src → short name | null }.
 * `liveByName` is lowercase name → { id, short } for raiders whose live zone is known AND named.
 * Per uploader: the zone most of the raiders it sampled are live in; else the zone most of the raiders
 * in the minute are live in; else null. Ties go to the lower zone id (as web/lib/spectator.ts).
 */
function resolveSrcZones(frames, liveByName) {
  const bySrc = new Map();            // src → Map(zone id → raiders)
  const seen = new Map();             // src → Set(lowercase name)
  const overall = new Map();
  const overallSeen = new Set();
  const short = new Map();            // zone id → short
  for (const fr of frames) {
    for (const r of fr.rows) {
      if (!bySrc.has(r.src)) { bySrc.set(r.src, new Map()); seen.set(r.src, new Set()); }
      const k = r.name.toLowerCase();
      const live = liveByName.get(k);
      if (!live) continue;
      short.set(live.id, live.short);
      if (!seen.get(r.src).has(k)) {
        seen.get(r.src).add(k);
        bySrc.get(r.src).set(live.id, (bySrc.get(r.src).get(live.id) || 0) + 1);
      }
      if (!overallSeen.has(k)) { overallSeen.add(k); overall.set(live.id, (overall.get(live.id) || 0) + 1); }
    }
  }
  const fallback = _topZone(overall);
  const out = new Map();
  for (const [src, votes] of bySrc) {
    const id = _topZone(votes) ?? fallback;
    out.set(src, id == null ? null : short.get(id) || null);
  }
  return out;
}

// ── The row ──────────────────────────────────────────────────────────────────

const _rnd = (n) => Math.round(n);

/**
 * One raid_track_minutes row from a minute's frames, or null when nothing is left to write.
 * opts: { guildId, excluded: Set<lowercase name>, srcZone: Map<src, short|null> }.
 * A raider in opts.excluded is dropped here too, so the row can never carry one.
 */
function buildMinuteRow(minuteStartMs, frames, opts = {}) {
  const excluded = opts.excluded instanceof Set ? opts.excluded : null;
  const srcZone = opts.srcZone instanceof Map ? opts.srcZone : new Map();
  const who = [];
  const whoIdx = new Map();
  const zones = [];
  const zoneIdx = new Map();
  const f = [];
  for (const fr of frames) {
    const arr = [Math.min(59, Math.max(0, Math.floor((fr.t - minuteStartMs) / 1000)))];
    let placed = 0;
    for (const r of fr.rows) {
      const k = r.name.toLowerCase();
      if (excluded && excluded.has(k)) continue;
      let i = whoIdx.get(k);
      if (i === undefined) {
        i = who.length;
        whoIdx.set(k, i);
        who.push([r.name, r.cls, r.group, r.level]);
      } else {   // last seen in the minute wins, but a missing value never erases a known one
        const w = who[i];
        who[i] = [r.name, r.cls ?? w[1], r.group ?? w[2], r.level ?? w[3]];
      }
      const zs = srcZone.get(r.src) || null;
      let zi = -1;
      if (zs) {
        zi = zoneIdx.get(zs);
        if (zi === undefined) { zi = zones.length; zoneIdx.set(zs, zi); zones.push(zs); }
      }
      arr.push(i, _rnd(r.x), _rnd(r.y), _rnd(r.z), r.h == null ? -1 : _rnd(r.h), r.hp == null ? -1 : _rnd(r.hp), zi);
      placed++;
    }
    if (placed) f.push(arr);
  }
  if (!f.length) return null;
  return {
    guild_id: opts.guildId || _guildId(),
    minute_at: new Date(minuteStartMs).toISOString(),
    night_key: require('./raidNight').nightKey(minuteStartMs),
    raiders: who.length,
    frames: f.length,
    zones: zones.slice(),
    data: JSON.stringify({ v: 1, step_s: stepS(), who, zones, f }),
  };
}

// ── Flushing ─────────────────────────────────────────────────────────────────

async function _writeMinute(m) {
  const sb = _sb();
  const excluded = await _excludedSet(sb);
  if (!excluded) return false;
  const names = [...new Set(m.frames.flatMap(fr => fr.rows.map(r => r.name)))]
    .filter(n => !excluded.has(n.toLowerCase()));
  if (!names.length) return true;
  const liveIds = await _liveZoneIds(sb, names);
  const shorts = await _zoneShorts(sb, [...new Set(liveIds.values())]);
  const liveByName = new Map();
  for (const [k, id] of liveIds) if (shorts.get(id)) liveByName.set(k, { id, short: shorts.get(id) });
  const row = buildMinuteRow(m.minuteStartMs, m.frames, {
    excluded, srcZone: resolveSrcZones(m.frames, liveByName),
  });
  if (!row) return true;
  // `select=` after the conflict target keeps the echo to two columns: the plain helper either echoes the
  // whole row back (egress) or, with minimal, returns null for success and failure alike.
  const res = await sb.upsert('raid_track_minutes', [row], 'guild_id,minute_at&select=guild_id,minute_at');
  if (!Array.isArray(res)) return false;
  // How the raiders look, once per night and hourly after (utils/raidAppearance.js). Not awaited, never throws.
  try { require('./raidAppearance').noteMinute({ supabase: sb, guildId: row.guild_id, nightKey: row.night_key, nowMs: m.minuteStartMs, names }); } catch { /* the recorder must not fail on it */ }
  return true;
}

/**
 * Write the finished minutes. One flush at a time; a failed write waits RETRY_BACKOFF_MS and a minute is
 * dropped after MAX_ATTEMPTS. Never rejects. Resolves when the queue is empty or backing off.
 */
function flush() {
  if (_flushing) return _flushing;
  if (!pending.length) return Promise.resolve();
  const run = (async () => {
    while (pending.length) {
      if (_clock() < _retryAt) break;
      let sb = null;
      try { sb = _sb(); } catch { sb = null; }
      if (!sb || !sb.isEnabled()) { pending.length = 0; break; }
      const m = pending[0];
      let ok = false;
      try { ok = await _writeMinute(m); } catch (err) { console.warn('[raid-track] flush failed:', err?.message); }
      if (ok) { pending.shift(); continue; }
      m.attempts++;
      console.warn(`[raid-track] minute ${new Date(m.minuteStartMs).toISOString()} not written (attempt ${m.attempts}/${MAX_ATTEMPTS})`);
      if (m.attempts >= MAX_ATTEMPTS) pending.shift();
      _retryAt = _clock() + RETRY_BACKOFF_MS;
      break;
    }
  })();
  // Cleared from outside the async body: a pass that finishes without ever awaiting (backing off) would
  // otherwise run its own cleanup BEFORE this assignment and leave the latch set for good.
  _flushing = run;
  const clear = () => { if (_flushing === run) _flushing = null; };
  run.then(clear, clear);
  return run;
}

// ── Runtime ──────────────────────────────────────────────────────────────────

function start() {
  if (_timers.frame) return false;
  if (process.env.RAID_TRACK_ENABLED === '0') return false;
  let sb = null;
  try { sb = _sb(); } catch { sb = null; }
  if (!sb || !sb.isEnabled()) return false;
  _timers.frame = setInterval(() => {
    try { takeFrame(); flush().catch(() => {}); } catch (err) { console.warn('[raid-track] frame failed:', err?.message); }
  }, stepS() * 1000);
  _timers.safety = setInterval(() => {
    try { closeFinished(); flush().catch(() => {}); } catch (err) { console.warn('[raid-track] safety pass failed:', err?.message); }
  }, SAFETY_MS);
  _timers.frame.unref?.();
  _timers.safety.unref?.();
  return true;
}

function stop() {
  for (const k of Object.keys(_timers)) {
    if (_timers[k]) clearInterval(_timers[k]);
    _timers[k] = null;
  }
}

// Test-only: drop every bit of state, timers and injected deps.
function _reset() {
  stop();
  latest.clear();
  cur = null;
  pending.length = 0;
  _flushing = null;
  _retryAt = 0;
  _excl = { at: 0, set: null };
  _zoneCache = { at: 0, map: new Map() };
  _deps = {};
}

// Test-only: inject { supabase, now }.
function _setDeps(d = {}) { _deps = { ..._deps, ...d }; }

// Test-only: how much is held in memory.
function _state() {
  return { tracked: latest.size, pending: pending.length, curFrames: cur ? cur.frames.length : 0 };
}

module.exports = {
  noteRows, takeFrame, closeFinished, liveSnapshot, buildMinuteRow, resolveSrcZones, flush, start, stop,
  stepS, minPlaced,
  STEP_S_DEFAULT, MIN_PLACED_DEFAULT, STICKY_MS, FRESH_MS, PRUNE_MS, MAX_TRACKED, MAX_PENDING_MINUTES,
  MAX_ATTEMPTS, RETRY_BACKOFF_MS, SAFETY_MS, EXCLUDE_TTL_MS, ZONE_TTL_MS, LIVE_ZONE_MS,
  _reset, _setDeps, _state,
};
