// utils/raidReplayWindow.js — the recorded raid window, for the agent's Rehearse tab.
//
// GET /api/agent/replay-window?from=<iso>&to=<iso>[&index=1] (route in index.js, bearer-gated by
// mimicLink.requireAgentAuth) serves up to 15 minutes of the recording the website's replay reads:
//
//   { ok, from, to, rows:[{ minute_at, zones, data }], kills:[...], targets?:[...], callouts:[...] }
//
// `rows` are the raw compact raid_track_minutes rows (format: the migration header and utils/raidTrack.js), the
// same ones web/app/api/raid/session/replay serves, so the tab ports one small decoder. `index=1` is the night
// strip instead: { ok, from, to, minutes:[<minute start ms>], kills } for a window of up to 24 hours.
//
// PRIVACY is the website's rule (web/lib/raidSession.ts, whose anonLabels / scrubMinuteData are ported below and
// held to the original by test/replay-window.test.js): a character with characters.exclude_from_stats OR
// exclude_inventory set never leaves by name; they are renamed to their class and a number ("Cleric 2"), the same
// label the website gives them. Unlike the website there is NO winner exemption here: nobody is shown by name
// because of an item they won. Three more rules for what is built here:
//   - Fail closed. If the opt-out list cannot be read the request is a 503, never an unscrubbed slice. If
//     DEMO_OBFUSCATE_SALT is unset the labels use the website's fallback salt and a warning is logged once; every
//     opted-out character is still renamed.
//   - Callouts are COUNTS ONLY: { atMs, trigger, seenBy }. The voter's id is read to count distinct people and is
//     never returned; a callout seen by fewer than MIN_SEEN_BY people is dropped, which also keeps one player's
//     personal trigger names off the wire.
//   - Targets carry a mob name and a health percent, never the character who had it targeted, and only for names
//     that are in the window's own mob lists (so a player targeted by name cannot appear).
//
// Cache (bot memory): a slice that ended more than 2 minutes ago is kept 10 minutes, one that touches the last 2
// minutes 15 seconds; LRU of 16. An entry is also keyed on the opt-out labels, so an opt-out takes effect within
// the minute the labels are held, not the ten.
//
// Pure functions where possible; `supabase` is injected (the utils/kiteLoops.js shape) so tests can stub it.

'use strict';

const zlib = require('zlib');

const MINUTE_MS = 60_000;
const REPLAY_WINDOW_MS = 15 * MINUTE_MS;       // web/lib/raidReplay.ts REPLAY_WINDOW_MS: the most a slice hands back
const MAX_INDEX_MS = 24 * 60 * MINUTE_MS;      // web/lib/raidShare.ts MAX_WINDOW_MS: the most a night strip covers
const CALLOUT_GROUP_MS = 3000;
const MIN_SEEN_BY = 2;
const TARGET_BUCKET_MS = 3000;
const MAX_TARGETS = 1500;
const MAX_KILLS = 400;

const OPT_TTL_MS = 60_000;
const FINISHED_TTL_MS = 10 * MINUTE_MS;
const LIVE_TTL_MS = 15_000;
const LIVE_EDGE_MS = 2 * MINUTE_MS;
const CACHE_MAX = 16;

const _enc = encodeURIComponent;
const _guildId = () => require('./supabase').guildId();

// ── The window (port of web/lib/raidShare.ts makeWindow) ─────────────────────

/**
 * The window of two instants: `from` rounded DOWN and `to` rounded UP to the minute. A slice is cut to 15
 * minutes from `from`; an index covers up to 24 hours. Null when empty, reversed, over the longest allowed (index)
 * or not a number.
 */
function makeWindow(fromMs, toMs, index = false) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  const f = Math.floor(fromMs / MINUTE_MS) * MINUTE_MS;
  let t = Math.ceil(toMs / MINUTE_MS) * MINUTE_MS;
  if (t <= f) return null;
  if (index) return t - f > MAX_INDEX_MS ? null : { fromMs: f, toMs: t };
  t = Math.min(t, f + REPLAY_WINDOW_MS);
  return { fromMs: f, toMs: t };
}

// ── Opt-outs (port of web/lib/raidSession.ts) ─────────────────────────────────

const PET_RX = /^(.+?)`s (pet|warder|ward|familiar|companion)$/i;
/** The key an opt-out is matched on: lowercase, trimmed, a pet reduced to its owner. */
function nameKey(name) {
  const s = String(name ?? '').trim().toLowerCase();
  const m = s.match(PET_RX);
  return m ? m[1].trim() : s;
}

/** An opaque, salted ordering key: 53-bit cyrb53 of `salt|s`, base 36. A sort key, not a secret. */
function opaqueKey(salt, s) {
  const str = `${salt}|${s}`;
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, '0');
}

/** nameKey -> { label, cls } for every character with either opt-out flag: class, then a number counted within it. */
function anonLabels(rows, salt = '') {
  const byClass = new Map();
  const seen = new Set();
  for (const r of rows || []) {
    if (!r || !r.name || !(r.exclude_from_stats || r.exclude_inventory)) continue;
    const key = nameKey(r.name);
    if (seen.has(key)) continue;
    seen.add(key);
    const cls = typeof r.class === 'string' && r.class.trim() ? r.class.trim() : null;
    const bucket = cls ?? 'Raider';
    const item = { key, ord: opaqueKey(salt, key), cls };
    const a = byClass.get(bucket);
    if (a) a.push(item); else byClass.set(bucket, [item]);
  }
  const out = new Map();
  for (const [bucket, items] of byClass) {
    items.sort((a, b) => (a.ord < b.ord ? -1 : a.ord > b.ord ? 1 : 0));
    items.forEach((it, i) => out.set(it.key, { label: `${bucket} ${i + 1}`, cls: it.cls }));
  }
  return out;
}

/** The name to show for `name`: its label if anonymized (a pet keeps its suffix), else itself. */
function anonName(anon, name) {
  if (!anon.size) return name;
  const s = String(name ?? '').trim();
  const e = anon.get(nameKey(s));
  if (!e) return name;
  const m = s.match(PET_RX);
  return m ? `${e.label}\`s ${m[2].toLowerCase()}` : e.label;
}

/** A string that changes whenever any label does. In-process only; it holds real keys. */
const anonSig = (anon) => [...anon].map(([k, v]) => `${k}=${v.label}`).sort().join('|');

/**
 * One raid_track_minutes `data` blob with the opted-out raiders' names swapped for their labels. Positions stay.
 * Unparseable or unexpected data becomes '{}', never passed through, since it cannot be shown to be clean.
 */
function scrubMinuteData(data, anon) {
  if (!anon.size) return data;
  let d;
  try { d = JSON.parse(data); } catch { return '{}'; }
  if (!d || typeof d !== 'object' || !Array.isArray(d.who) || !Array.isArray(d.f)) return '{}';
  d.who = d.who.map((w) => {
    if (!Array.isArray(w) || typeof w[0] !== 'string') return w;
    const label = anonName(anon, w[0]);
    if (label === w[0]) return w;
    const cls = typeof w[1] === 'string' && w[1] ? w[1] : anon.get(nameKey(w[0]))?.cls ?? null;
    return [label, cls, ...w.slice(2)];
  });
  return JSON.stringify(d);
}

// ── The held opt-out labels ───────────────────────────────────────────────────

let _optCache = null;      // { at, guild, map }
let _saltWarned = false;

/** The salt behind the label order. Same secret as the website's; unset falls back to the website's fallback, once-warned. */
function anonSalt() {
  const s = process.env.DEMO_OBFUSCATE_SALT;
  if (s) return s;
  if (!_saltWarned) {
    _saltWarned = true;
    console.warn('[replay-window] DEMO_OBFUSCATE_SALT is not set on the bot — opted-out raiders are still labelled, but with the fallback salt, so their numbers may not match the website\'s');
  }
  return 'raid-anon';
}

/** The labels for every opted-out character, held 60 s. Throws when the list cannot be read (the caller answers 503). */
async function loadOptedOut(sb, now = Date.now()) {
  const guild = _guildId();
  if (_optCache && _optCache.guild === guild && now - _optCache.at < OPT_TTL_MS) return _optCache.map;
  const rows = await sb.selectAllPaged('characters',
    `select=name,class,exclude_from_stats,exclude_inventory&guild_id=eq.${_enc(guild)}` +
    `&or=${_enc('(exclude_from_stats.eq.true,exclude_inventory.eq.true)')}`, 'name');
  if (!Array.isArray(rows)) throw new Error('opt-out list unavailable');
  const map = anonLabels(rows, anonSalt());
  _optCache = { at: now, guild, map };
  return map;
}

// ── Callouts ──────────────────────────────────────────────────────────────────

/**
 * trigger_timing_feedback rows ({ trigger_name, fired_at, voter_discord_id }) -> [{ atMs, trigger, seenBy }].
 * Rows of one trigger whose fired_at is within 3 s of the group's first are one callout; seenBy is the number of
 * DISTINCT voters in it (a vote and a later dismissal by one person count once). atMs is the group's median
 * fired_at (uploaders' clocks differ). Groups seen by fewer than MIN_SEEN_BY are dropped. Nothing about a voter
 * leaves this function.
 */
function groupCallouts(rows) {
  const byTrigger = new Map();
  for (const r of rows || []) {
    const t = String(r?.trigger_name || '').trim();
    const ms = Date.parse(r?.fired_at);
    if (!t || !Number.isFinite(ms)) continue;
    let a = byTrigger.get(t);
    if (!a) byTrigger.set(t, a = []);
    a.push({ ms, who: r.voter_discord_id ? String(r.voter_discord_id) : null });
  }
  const out = [];
  for (const [trigger, list] of byTrigger) {
    list.sort((a, b) => a.ms - b.ms);
    let group = [];
    const flush = () => {
      if (!group.length) return;
      const voters = new Set();
      group.forEach((g, i) => voters.add(g.who ?? `row${i}`));
      if (voters.size >= MIN_SEEN_BY) out.push({ atMs: group[Math.floor((group.length - 1) / 2)].ms, trigger, seenBy: voters.size });
      group = [];
    };
    for (const x of list) {
      if (group.length && x.ms - group[0].ms > CALLOUT_GROUP_MS) flush();
      group.push(x);
    }
    flush();
  }
  return out.sort((a, b) => a.atMs - b.atMs || (a.trigger < b.trigger ? -1 : 1));
}

// ── Kills and targets ─────────────────────────────────────────────────────────

const displayName = (name) => String(name || '').replace(/_/g, ' ').replace(/#/g, '').trim();

/** Encounters that ENDED in [fromMs, toMs), classification null, curated bosses only. */
async function loadKills(sb, win) {
  const lo = new Date(win.fromMs).toISOString(), hi = new Date(win.toMs).toISOString();
  const enc = await sb.select('encounters',
    `guild_id=eq.${_enc(_guildId())}&classification=is.null&ended_at=gte.${_enc(lo)}&ended_at=lt.${_enc(hi)}` +
    `&select=id,npc_id,started_at,ended_at,duration_sec,zone_short,eqemu_npc_types(name)&order=ended_at.asc&limit=${MAX_KILLS}`);
  if (!Array.isArray(enc)) throw new Error('encounters unavailable');
  const npcIds = [...new Set(enc.map(e => e.npc_id).filter(n => Number.isInteger(n)))];
  const curated = new Set();
  for (let i = 0; i < npcIds.length; i += 100) {
    const ids = npcIds.slice(i, i + 100);
    const rows = await sb.select('bosses_local', `auto_registered=eq.false&npc_id=in.(${ids.join(',')})&select=npc_id&limit=100`);
    if (!Array.isArray(rows)) throw new Error('bosses unavailable');
    for (const b of rows) curated.add(b.npc_id);
  }
  const kills = [];
  for (const e of enc) {
    if (!curated.has(e.npc_id)) continue;
    const endMs = Date.parse(e.ended_at), startMs = Date.parse(e.started_at);
    if (!Number.isFinite(endMs)) continue;
    kills.push({
      id: e.id,
      npcId: e.npc_id,
      name: displayName(e.eqemu_npc_types?.name),
      zone: e.zone_short || null,
      startMs: Number.isFinite(startMs) ? startMs : null,
      endMs,
      durationSec: Number.isFinite(Number(e.duration_sec)) ? Number(e.duration_sec) : null,
    });
  }
  return kills;
}

/** Every mob name in the minute rows' `mobs` lists, lowercased. */
function mobNamesOf(rows) {
  const names = new Set();
  for (const r of rows) {
    let d; try { d = JSON.parse(r.data); } catch { continue; }
    if (!d || !Array.isArray(d.mobs)) continue;
    for (const m of d.mobs) if (Array.isArray(m) && typeof m[0] === 'string') names.add(m[0].trim().toLowerCase());
  }
  return names;
}

/** target_observations in the window as [{ atMs, name, hp }]: one per mob per 3 s, only mobs the rows name, no character. */
async function loadTargets(sb, win, rows) {
  const names = mobNamesOf(rows);
  if (!names.size) return [];
  const lo = new Date(win.fromMs).toISOString(), hi = new Date(win.toMs).toISOString();
  const obs = await sb.selectAllPaged('target_observations',
    `guild_id=eq.${_enc(_guildId())}&at=gte.${_enc(lo)}&at=lt.${_enc(hi)}&target_name=not.is.null&target_hp_pct=not.is.null` +
    '&select=target_name,target_hp_pct,at', 'id');
  if (!Array.isArray(obs)) return [];   // health is a nicety; the slice is complete without it
  const last = new Map();
  for (const o of obs) {
    const name = String(o.target_name || '').trim();
    const ms = Date.parse(o.at), hp = Number(o.target_hp_pct);
    if (!name || !names.has(name.toLowerCase()) || !Number.isFinite(ms) || !Number.isFinite(hp)) continue;
    const k = `${name.toLowerCase()}|${Math.floor(ms / TARGET_BUCKET_MS)}`;
    const prev = last.get(k);
    if (!prev || ms >= prev.atMs) last.set(k, { atMs: ms, name, hp: Math.round(hp * 10) / 10 });
  }
  return [...last.values()].sort((a, b) => a.atMs - b.atMs).slice(0, MAX_TARGETS);
}

// ── Building and serving ──────────────────────────────────────────────────────

async function buildSlice(sb, win, anon) {
  const lo = new Date(win.fromMs).toISOString(), hi = new Date(win.toMs).toISOString();
  const [raw, kills, feedback] = await Promise.all([
    sb.select('raid_track_minutes',
      `guild_id=eq.${_enc(_guildId())}&minute_at=gte.${_enc(lo)}&minute_at=lt.${_enc(hi)}` +
      '&select=minute_at,zones,data&order=minute_at.asc&limit=15'),
    loadKills(sb, win),
    sb.selectAllPaged('trigger_timing_feedback',
      `guild_id=eq.${_enc(_guildId())}&fired_at=gte.${_enc(lo)}&fired_at=lt.${_enc(hi)}` +
      '&select=trigger_name,fired_at,voter_discord_id', 'id'),
  ]);
  if (!Array.isArray(raw)) throw new Error('replay unavailable');
  const rows = raw.map(r => ({ minute_at: r.minute_at, zones: r.zones, data: scrubMinuteData(r.data, anon) }));
  const targets = await loadTargets(sb, win, raw);
  const body = { ok: true, from: win.fromMs, to: win.toMs, rows, kills, callouts: Array.isArray(feedback) ? groupCallouts(feedback) : [] };
  if (targets.length) body.targets = targets;
  return body;
}

async function buildIndex(sb, win) {
  const lo = new Date(win.fromMs).toISOString(), hi = new Date(win.toMs).toISOString();
  const [mins, kills] = await Promise.all([
    sb.selectAllPaged('raid_track_minutes',
      `guild_id=eq.${_enc(_guildId())}&minute_at=gte.${_enc(lo)}&minute_at=lt.${_enc(hi)}&select=minute_at`, 'minute_at'),
    loadKills(sb, win),
  ]);
  if (!Array.isArray(mins)) throw new Error('replay unavailable');
  const minutes = mins.map(m => Date.parse(m.minute_at)).filter(Number.isFinite);
  return { ok: true, from: win.fromMs, to: win.toMs, minutes, kills };
}

const _cache = new Map();       // key -> { at, ttl, sig, body, gz }; Map order is the LRU order
const _pending = new Map();     // key -> promise, so a burst of the same request builds it once

/** Forgets every held slice and label (tests). */
function _reset() { _cache.clear(); _pending.clear(); _optCache = null; _saltWarned = false; }

/**
 * Answers one request. `from`/`to` are the raw query values. Returns { status, error } or { status: 200, entry },
 * where entry.body is the JSON text and gzipOf(entry) its gzip.
 */
async function serve(sb, from, to, index, now = Date.now()) {
  const win = makeWindow(Date.parse(from ?? ''), Date.parse(to ?? ''), !!index);
  if (!win) return { status: 400, error: 'bad request' };
  let anon;
  try { anon = await loadOptedOut(sb, now); }
  catch { return { status: 503, error: 'try again shortly' }; }   // fail closed: no opt-out list, no names
  const sig = anonSig(anon);
  const key = `${index ? 'i' : 's'}|${win.fromMs}|${win.toMs}`;
  const hit = _cache.get(key);
  if (hit && hit.sig === sig && now - hit.at < hit.ttl) {
    _cache.delete(key); _cache.set(key, hit);
    return { status: 200, entry: hit };
  }
  let p = _pending.get(key);
  if (!p) {
    p = (index ? buildIndex(sb, win) : buildSlice(sb, win, anon)).finally(() => _pending.delete(key));
    _pending.set(key, p);
  }
  let built;
  try { built = await p; }
  catch (err) { console.warn('[replay-window] build failed:', err?.message); return { status: 503, error: 'try again shortly' }; }
  const entry = {
    at: now, sig,
    ttl: win.toMs > now - LIVE_EDGE_MS ? LIVE_TTL_MS : FINISHED_TTL_MS,
    body: JSON.stringify(built), gz: null,
  };
  _cache.delete(key); _cache.set(key, entry);
  while (_cache.size > CACHE_MAX) _cache.delete(_cache.keys().next().value);
  return { status: 200, entry };
}

/** The gzip of an entry's body, built once. */
function gzipOf(entry) {
  if (!entry.gz) entry.gz = zlib.gzipSync(entry.body);
  return entry.gz;
}

module.exports = {
  MINUTE_MS, REPLAY_WINDOW_MS, MIN_SEEN_BY,
  makeWindow, nameKey, opaqueKey, anonLabels, anonName, anonSig, scrubMinuteData,
  groupCallouts, loadOptedOut, loadKills, loadTargets, serve, gzipOf, _reset,
};
