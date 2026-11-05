// utils/trackBackfill.js — fills raid_track_minutes from the minutes every Mimic recorded locally.
//
// WHY IT EXISTS
// utils/raidTrack.js records where the raid stood, one row per UTC minute, but only while Supabase takes the
// write: a database outage leaves a hole in the replay. Every Mimic (agent 4.0.65+) keeps its OWN copy of the same
// minutes in the same row shape, so the bot can ask for them back. An officer sets three numbers in the tuning map
// (/admin/overlays): track_backfill_id, track_backfill_from_s, track_backfill_to_s (epoch seconds). Each agent that
// has not answered that id posts its minutes in [from, to) to POST /api/agent/track-backfill, and handle() below
// merges every contribution into the table. Several raiders each saw part of the raid (different zones, different
// PCs), so a minute that already exists is MERGED, never replaced.
//
// MERGE PRECEDENCE
// The row already in the table wins where both have the same raider at the same frame second (the live hub saw it
// first-hand, and an earlier contribution is not overwritten by a later one). Anything the stored row lacks is added.
//
// TRUST
// An agent upload is untrusted: cleanMinute() bounds every index, count and string (a port of the agent's
// _rmCleanMinute), and handle() accepts only a request that matches the CURRENT tuning values, so nobody can write
// arbitrary minutes. A raider with characters.exclude_from_stats is dropped, as raidTrack.js does.
//
// ROW (same columns as buildMinuteRow; primary key guild_id, minute_at)
//   guild_id, minute_at, night_key (server-computed), raiders, frames, zones[], data (compact JSON text)

'use strict';

const NAME_RX = /^[\p{L}][\p{L}`' _-]{0,39}$/u;
const ZONE_RX = /^[A-Za-z0-9_]{1,32}$/;
const RAID_RX = /^[0-9a-f]{8}$/;
const MAX_ROWS_PER_REQUEST = 30;
const MAX_WHO = 400, MAX_FRAMES = 60, MAX_ZONES = 16, MAX_MOBS = 64, MAX_RAIDS = 8;

const num = (v) => (v != null && v !== '' && typeof v !== 'object' && Number.isFinite(Number(v)) ? Number(v) : null);
const idx = (v, lo, hi) => { const n = num(v); return n != null && Number.isInteger(n) && n >= lo && n < hi ? n : null; };

/**
 * The parsed `data` of one minute (the shape web/lib/raidReplay.ts decodes), checked and rebuilt, or null.
 * Keeps the optional raids list and who[i][4] (index into raids, -1 none) that the hub writes.
 */
function cleanMinute(d) {
  if (!d || typeof d !== 'object' || d.v !== 1 || !Array.isArray(d.who) || !Array.isArray(d.f) || !Array.isArray(d.zones)) return null;
  if (d.who.length > MAX_WHO || d.f.length > MAX_FRAMES || d.zones.length > MAX_ZONES) return null;
  let raids = [];
  if (d.raids != null) {
    if (!Array.isArray(d.raids) || d.raids.length > MAX_RAIDS || d.raids.some(r => typeof r !== 'string' || !RAID_RX.test(r))) return null;
    raids = d.raids.slice();
  }
  const who = [];
  for (const w of d.who) {
    if (!Array.isArray(w) || typeof w[0] !== 'string' || !NAME_RX.test(w[0])) return null;
    const e = [w[0], typeof w[1] === 'string' ? w[1].slice(0, 24) : null, num(w[2]), num(w[3])];
    if (raids.length) e.push(idx(w[4], 0, raids.length) ?? -1);
    who.push(e);
  }
  const zones = [];
  for (const z of d.zones) { if (typeof z !== 'string' || !ZONE_RX.test(z)) return null; zones.push(z); }
  const f = [];
  for (const fr of d.f) {
    if (!Array.isArray(fr) || fr.length < 1 || (fr.length - 1) % 7 !== 0 || fr.length > 1 + 7 * MAX_WHO) return null;
    const dt = idx(fr[0], 0, 60);
    if (dt == null) return null;
    const out = [dt];
    for (let j = 1; j < fr.length; j += 7) {
      const i = idx(fr[j], 0, who.length), zi = idx(fr[j + 6], -1, zones.length);
      const nums = [fr[j + 1], fr[j + 2], fr[j + 3], fr[j + 4], fr[j + 5]].map(num);
      if (i == null || zi == null || nums.some(n => n == null)) return null;
      out.push(i, ...nums, zi);
    }
    f.push(out);
  }
  const res = { v: 1, step_s: Math.min(30, Math.max(1, num(d.step_s) || 3)), who, zones, f };
  if (raids.length) res.raids = raids;
  if (Array.isArray(d.mobs) && Array.isArray(d.mf)) {
    if (d.mobs.length > MAX_MOBS || d.mf.length > 3600) return null;
    const mobs = [];
    for (const m of d.mobs) {
      if (!Array.isArray(m) || typeof m[0] !== 'string' || m[0].length > 80) return null;
      mobs.push([m[0], num(m[1])]);
    }
    const mf = [];
    for (const r of d.mf) {
      if (!Array.isArray(r) || r.length !== 7) return null;
      const dt = idx(r[0], 0, 60), mi = idx(r[1], 0, mobs.length), zi = idx(r[6], -1, zones.length);
      const nums = [r[2], r[3], r[4], r[5]].map(num);
      if (dt == null || mi == null || zi == null || nums.some(n => n == null)) return null;
      mf.push([dt, mi, ...nums, zi]);
    }
    if (mf.length) { res.mobs = mobs; res.mf = mf; }
  }
  return res;
}

/**
 * Union of two clean minutes of the same UTC minute. `live` wins where both hold the same raider at the same
 * frame second; a raider (or a second) only `extra` has is added. Targets are unioned by (second, mob).
 */
function mergeMinute(live, extra) {
  const raids = (live.raids || []).slice();
  const raidAt = (r) => { if (r == null) return -1; let i = raids.indexOf(r); if (i < 0) { if (raids.length >= MAX_RAIDS) return -1; i = raids.length; raids.push(r); } return i; };
  const who = live.who.map(w => w.slice());
  const whoAt = new Map(who.map((w, i) => [w[0].toLowerCase(), i]));
  const zones = live.zones.slice();
  const zoneAt = (z) => { if (z == null) return -1; let i = zones.indexOf(z); if (i < 0) { if (zones.length >= MAX_ZONES) return -1; i = zones.length; zones.push(z); } return i; };
  const frames = new Map(live.f.map(fr => [fr[0], fr.slice()]));
  const have = new Set();
  for (const fr of live.f) for (let j = 1; j < fr.length; j += 7) have.add(live.who[fr[j]][0].toLowerCase() + '|' + fr[0]);
  for (const fr of extra.f) {
    for (let j = 1; j < fr.length; j += 7) {
      const w = extra.who[fr[j]];
      const k = w[0].toLowerCase();
      if (have.has(k + '|' + fr[0])) continue;
      let i = whoAt.get(k);
      if (i === undefined) {
        if (who.length >= MAX_WHO) continue;
        i = who.length;
        who.push(w.slice(0, 4));
        whoAt.set(k, i);
        const er = extra.raids && w[4] >= 0 ? extra.raids[w[4]] : null;
        who[i][4] = raidAt(er);
      }
      have.add(k + '|' + fr[0]);
      if (!frames.has(fr[0])) frames.set(fr[0], [fr[0]]);
      frames.get(fr[0]).push(i, fr[j + 1], fr[j + 2], fr[j + 3], fr[j + 4], fr[j + 5], zoneAt(fr[j + 6] < 0 ? null : extra.zones[fr[j + 6]]));
    }
  }
  const f = [...frames.values()].sort((a, b) => a[0] - b[0]);
  const mobs = (live.mobs || []).map(m => m.slice());
  const mf = (live.mf || []).map(r => r.slice());
  if (extra.mobs && extra.mf) {
    const mobAt = new Map(mobs.map((m, i) => [m[0].toLowerCase() + '\u0000' + (m[1] ?? ''), i]));
    const seen = new Set(mf.map(r => r[0] + '|' + r[1]));
    for (const r of extra.mf) {
      const m = extra.mobs[r[1]];
      const mk = m[0].toLowerCase() + '\u0000' + (m[1] ?? '');
      let mi = mobAt.get(mk);
      if (mi === undefined) { if (mobs.length >= MAX_MOBS) continue; mi = mobs.length; mobs.push(m.slice()); mobAt.set(mk, mi); }
      if (seen.has(r[0] + '|' + mi)) continue;
      seen.add(r[0] + '|' + mi);
      mf.push([r[0], mi, r[2], r[3], r[4], r[5], zoneAt(r[6] < 0 ? null : extra.zones[r[6]])]);
    }
  }
  const out = { v: 1, step_s: live.step_s, who, zones, f };
  if (raids.length) { out.raids = raids; for (const w of out.who) if (w[4] == null) w[4] = -1; }
  else for (const w of out.who) w.length = 4;
  if (mf.length) { out.mobs = mobs; out.mf = mf; }
  return out;
}

/**
 * A clean minute without the raiders in `excluded` (a Set of lowercase names). Frames are re-indexed onto the
 * surviving raiders; a frame left empty is dropped. Returns null when no frame survives.
 */
function dropExcluded(d, excluded) {
  if (!(excluded instanceof Set) || !excluded.size) return d;
  const remap = new Map();
  const who = [];
  d.who.forEach((w, i) => { if (!excluded.has(w[0].toLowerCase())) { remap.set(i, who.length); who.push(w); } });
  if (!who.length) return null;
  const f = [];
  for (const fr of d.f) {
    const out = [fr[0]];
    for (let j = 1; j < fr.length; j += 7) {
      const ni = remap.get(fr[j]);
      if (ni !== undefined) out.push(ni, ...fr.slice(j + 1, j + 7));
    }
    if (out.length > 1) f.push(out);
  }
  if (!f.length) return null;
  return { ...d, who, f };
}

/** The raid_track_minutes row for a clean minute. night_key comes from the server, never from the upload. */
function buildRow(guildId, minuteMs, d) {
  return {
    guild_id: guildId,
    minute_at: new Date(minuteMs).toISOString(),
    night_key: require('./raidNight').nightKey(minuteMs),
    raiders: d.who.length,
    frames: d.f.length,
    zones: d.zones.slice(),
    data: JSON.stringify(d),
  };
}

/** The whole-minute epoch ms of an ISO string, or null when it is not a UTC minute boundary. */
function minuteMsOf(iso) {
  const ms = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) && ms % 60_000 === 0 ? ms : null;
}

/** The request the tuning map currently asks for: { id, fromMs, toMs } or null. */
function activeRequest(tune) {
  const t = tune && typeof tune === 'object' ? tune : {};
  const id = Number(t.track_backfill_id);
  const fromMs = Number(t.track_backfill_from_s) * 1000, toMs = Number(t.track_backfill_to_s) * 1000;
  if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return null;
  return { id, fromMs, toMs };
}

/**
 * Merge one agent upload into raid_track_minutes.
 * deps: { supabase, tune, excluded: Set|null (null = unreadable), guildId }
 * Returns { status, body }. A failed Supabase call is a 503 so the agent's durable queue retries; rows are
 * idempotent (a retried batch merges into itself with no change).
 */
async function handle(payload, deps) {
  const req = activeRequest(deps.tune);
  if (!req) return { status: 409, body: { ok: false, error: 'no active request' } };
  if (!payload || typeof payload !== 'object' || Number(payload.request_id) !== req.id) return { status: 409, body: { ok: false, error: 'request id does not match' } };
  const rows = Array.isArray(payload.rows) ? payload.rows : null;
  if (!rows || rows.length > MAX_ROWS_PER_REQUEST) return { status: 400, body: { ok: false, error: 'bad rows' } };
  if (!deps.excluded) return { status: 503, body: { ok: false, error: 'exclusions unreadable' } };
  let rejected = 0;
  const clean = new Map();                       // minute ms → clean data
  for (const r of rows) {
    const ms = minuteMsOf(r && r.minute_at);
    if (ms == null || ms < req.fromMs || ms >= req.toMs || typeof r.data !== 'string' || r.data.length > 200_000) { rejected++; continue; }
    let d = null;
    try { d = cleanMinute(JSON.parse(r.data)); } catch { d = null; }
    d = d && dropExcluded(d, deps.excluded);
    if (!d) { rejected++; continue; }
    clean.set(ms, clean.has(ms) ? mergeMinute(clean.get(ms), d) : d);
  }
  if (!clean.size) return { status: 200, body: { ok: true, accepted: 0, merged: 0, inserted: 0, rejected } };
  const sb = deps.supabase;
  const inList = [...clean.keys()].map(ms => new Date(ms).toISOString()).join(',');
  const existing = await sb.select('raid_track_minutes',
    `guild_id=eq.${encodeURIComponent(deps.guildId)}&minute_at=in.(${encodeURIComponent(inList)})&select=minute_at,data&limit=${MAX_ROWS_PER_REQUEST}`);
  if (!Array.isArray(existing)) return { status: 503, body: { ok: false, error: 'read failed' } };
  const have = new Map();
  for (const e of existing) { const ms = Date.parse(e && e.minute_at); if (Number.isFinite(ms)) have.set(ms, e.data); }
  const out = [];
  let merged = 0, inserted = 0;
  for (const [ms, d] of clean) {
    if (!have.has(ms)) { out.push(buildRow(deps.guildId, ms, d)); inserted++; continue; }
    let live = null;
    try { live = cleanMinute(JSON.parse(have.get(ms))); } catch { live = null; }
    if (!live) { rejected++; continue; }         // never overwrite a row this code cannot read
    const next = mergeMinute(live, d);
    if (JSON.stringify(next) === JSON.stringify(live)) { merged++; continue; }   // nothing new: no write
    out.push(buildRow(deps.guildId, ms, next));
    merged++;
  }
  if (out.length) {
    const res = await sb.upsert('raid_track_minutes', out, 'guild_id,minute_at&select=guild_id,minute_at');
    if (!Array.isArray(res)) return { status: 503, body: { ok: false, error: 'write failed' } };
  }
  return { status: 200, body: { ok: true, accepted: merged + inserted, merged, inserted, rejected } };
}

module.exports = { cleanMinute, mergeMinute, dropExcluded, buildRow, minuteMsOf, activeRequest, handle, MAX_ROWS_PER_REQUEST };
