// utils/localSync.js — the hub half of "every player keeps a copy of the guild's parses".
//
// GET /api/agent/local-sync?since=<iso|cursor>&limit=200 (route in index.js, member-token gated by
// mimicLink.requireAgentAuth) pages WHOLE changed encounters, oldest change first:
//
//   { ok, cursor, more, encounters:[{ id, npc_id, name, zone, started_at, ended_at, duration_sec, total_damage,
//                                     total_dps, classification, incomplete, updated_at,
//                                     players:[{ name, class, damage, dps, duration, pets, rank, anon? }],
//                                     loot:[{ id, looter, item, at, pet?, anon? }] }],
//     tombstones:[{ id, deleted_at, merged_into }] }
//
// The change cursor is encounters.updated_at (supabase/migrations/20261021120000_encounters_change_cursor.sql: a
// BEFORE UPDATE trigger, plus statement triggers that bump the parent when encounter_players or looted_items
// change) and the encounter_tombstones table. Both are keyset-paged on (timestamp, id). The cursor is opaque
// ("c1." + base64url JSON) and carries the timestamps VERBATIM as PostgREST printed them: a JS Date would cut
// them to milliseconds and re-send or skip rows. `since` may also be a plain ISO instant (start from there).
// `more` is true when either list came back full; call again with `cursor` until it is false.
//
// LATE COMMITS: the stamp is clock_timestamp() at the write, the row becomes visible at commit, so a row can
// surface a few milliseconds behind a cursor that already passed its stamp. Nothing newer than LAG_MS ago is
// served, which is far longer than any write here takes to commit.
//
// LOOT is not per-encounter in the database (loot_drops is empty; looted_items has a time and a looter). A loot
// row is attached to every fight whose window [started_at, coalesce(ended_at, started_at) + 20 min] contains it,
// the same window the looted_items trigger bumps, so two fights minutes apart can both carry one drop. `loot.id`
// is looted_items.id: the receiver dedups on it.
//
// PRIVACY (docs/PRIVACY.md; the website's rule, shared with utils/raidReplayWindow.js whose anonLabels / anonName
// are used here unchanged): a character with exclude_from_stats OR exclude_inventory set goes out as "<Class> <n>"
// in players and loot, the same label the share page gives them. NEVER sent: Discord ids, uploader ids, the
// contribution a player row came from, raid_night_id, classification notes, who classified or flagged a fight,
// the Discord message link, inventory, tells, chat, positions or buffs of anyone.
// FAIL CLOSED: if the opt-out list cannot be read the request is a 503. The class lookup for everyone else is a
// nicety; if it fails the class is null.
//
// Pure-ish: `supabase` is injected (the utils/raidReplayWindow.js shape) so tests can stub it.

'use strict';

const rw = require('./raidReplayWindow');

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 200;
const LAG_MS = 5_000;
const LOOT_TAIL_MS = 20 * 60_000;          // keep in step with encounters_bump_from_loot() in the migration
const LOOT_SLACK_MS = 1_000;               // query-side slack; the precise test is made in JS
const LOOT_RANGES_PER_QUERY = 25;
const IN_CHUNK = 100;
const CLASS_TTL_MS = 5 * 60_000;

const ZERO_ID = '00000000-0000-0000-0000-000000000000';
const EPOCH = '1970-01-01T00:00:00+00:00';
const TS_RX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const _enc = encodeURIComponent;
const _guildId = () => require('./supabase').guildId();

// ── The cursor ────────────────────────────────────────────────────────────────

const freshCursor = () => ({ u: EPOCH, i: ZERO_ID, d: EPOCH, j: ZERO_ID });

function encodeCursor(c) {
  return 'c1.' + Buffer.from(JSON.stringify({ u: c.u, i: c.i, d: c.d, j: c.j }), 'utf8').toString('base64url');
}

/** `since` -> a cursor, or null when it is neither a cursor nor an ISO instant. Empty/missing starts from the beginning. */
function parseSince(since) {
  const s = String(since ?? '').trim();
  if (!s) return freshCursor();
  if (s.startsWith('c1.')) {
    let o;
    try { o = JSON.parse(Buffer.from(s.slice(3), 'base64url').toString('utf8')); } catch { return null; }
    if (!o || typeof o !== 'object') return null;
    if (![o.u, o.d].every(t => typeof t === 'string' && TS_RX.test(t))) return null;
    if (![o.i, o.j].every(t => typeof t === 'string' && UUID_RX.test(t))) return null;
    return { u: o.u, i: o.i.toLowerCase(), d: o.d, j: o.j.toLowerCase() };
  }
  const ms = Date.parse(s);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const t = new Date(ms).toISOString();
  return { u: t, i: ZERO_ID, d: t, j: ZERO_ID };
}

/** The PostgREST `or` filter for "after (ts, id)" on one keyset. */
const afterKeyset = (col, ts, id) => `or=${_enc(`(${col}.gt.${ts},and(${col}.eq.${ts},id.gt.${id}))`)}`;

// ── Who is shown by name ──────────────────────────────────────────────────────

let _classCache = null;   // { at, guild, map }

/** name (lowercase) -> class for the guild's characters, held 5 minutes. null on a failed read (classes then read as null). */
async function loadClasses(sb, now) {
  const guild = _guildId();
  if (_classCache && _classCache.guild === guild && now - _classCache.at < CLASS_TTL_MS) return _classCache.map;
  let rows = null;
  try { rows = await sb.selectAllPaged('characters', `guild_id=eq.${_enc(guild)}&select=name,class`, 'name'); } catch { rows = null; }
  if (!Array.isArray(rows)) return null;
  const map = new Map();
  for (const r of rows) {
    if (r && r.name && typeof r.class === 'string' && r.class.trim()) map.set(rw.nameKey(r.name), r.class.trim());
  }
  _classCache = { at: now, guild, map };
  return map;
}

/** { name, class, anon? } for one character as it may leave the building. */
function shown(name, anon, classes) {
  const label = rw.anonName(anon, name);
  if (label !== name) return { name: label, class: anon.get(rw.nameKey(name))?.cls ?? null, anon: true };
  return { name, class: classes ? (classes.get(rw.nameKey(name)) ?? null) : null };
}

// ── Reads ─────────────────────────────────────────────────────────────────────

const displayName = (name) => String(name || '').replace(/_/g, ' ').replace(/#/g, '').trim();
const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

async function loadPlayers(sb, ids) {
  const by = new Map(ids.map(id => [id, []]));
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const rows = await sb.selectAllPaged('encounter_players',
      `encounter_id=in.(${chunk.join(',')})&select=encounter_id,character_name,total_damage,dps,duration_sec,has_pets,rank`,
      'encounter_id,character_name');
    if (!Array.isArray(rows)) throw new Error('players unavailable');
    for (const r of rows) by.get(r.encounter_id)?.push(r);
  }
  return by;
}

/** Windows of the page's fights, merged where they touch, as [fromMs, toMs]. */
function lootRanges(encs) {
  const w = [];
  for (const e of encs) {
    const s = Date.parse(e.started_at);
    if (!Number.isFinite(s)) continue;
    const en = Date.parse(e.ended_at);
    w.push([s, (Number.isFinite(en) ? en : s) + LOOT_TAIL_MS]);
  }
  w.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const x of w) {
    const last = out[out.length - 1];
    if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]); else out.push([x[0], x[1]]);
  }
  return out;
}

async function loadLoot(sb, encs) {
  const ranges = lootRanges(encs);
  const rows = [];
  const seen = new Set();
  for (let i = 0; i < ranges.length; i += LOOT_RANGES_PER_QUERY) {
    const part = ranges.slice(i, i + LOOT_RANGES_PER_QUERY)
      .map(([a, b]) => `and(looted_at.gte.${new Date(a - LOOT_SLACK_MS).toISOString()},looted_at.lte.${new Date(b + LOOT_SLACK_MS).toISOString()})`);
    const got = await sb.selectAllPaged('looted_items',
      `guild_id=eq.${_enc(_guildId())}&or=${_enc(`(${part.join(',')})`)}&select=id,looter_character,item_name,looted_at,from_own_pet`, 'id');
    if (!Array.isArray(got)) throw new Error('loot unavailable');
    for (const r of got) if (!seen.has(r.id)) { seen.add(r.id); rows.push(r); }
  }
  return rows;
}

// ── The page ──────────────────────────────────────────────────────────────────

/**
 * Answers one request. `q` is { since, limit } as raw query values. Returns { status, error } or
 * { status: 200, body } where body is the object to send.
 */
async function serve(sb, q, now = Date.now()) {
  const cur = parseSince(q && q.since);
  if (!cur) return { status: 400, error: 'bad request' };
  let limit = Number.parseInt(q && q.limit, 10);
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
  limit = Math.min(limit, MAX_LIMIT);

  const guild = _enc(_guildId());
  const cutoff = _enc(new Date(now - LAG_MS).toISOString());

  let anon;
  try { anon = await rw.loadOptedOut(sb, now); } catch { return { status: 503, error: 'try again shortly' }; }
  const classes = await loadClasses(sb, now);

  try {
    const [encRows, tombRows] = await Promise.all([
      sb.select('encounters',
        `guild_id=eq.${guild}&updated_at=lt.${cutoff}&${afterKeyset('updated_at', cur.u, cur.i)}` +
        '&select=id,npc_id,started_at,ended_at,duration_sec,zone_short,total_damage,total_dps,classification,data_incomplete,updated_at,eqemu_npc_types(name)' +
        `&order=updated_at.asc,id.asc&limit=${limit}`),
      sb.select('encounter_tombstones',
        `guild_id=eq.${guild}&deleted_at=lt.${cutoff}&${afterKeyset('deleted_at', cur.d, cur.j)}` +
        `&select=id,deleted_at,merged_into&order=deleted_at.asc,id.asc&limit=${limit}`),
    ]);
    if (!Array.isArray(encRows) || !Array.isArray(tombRows)) throw new Error('encounters unavailable');

    const [playersBy, loot] = encRows.length
      ? await Promise.all([loadPlayers(sb, encRows.map(e => e.id)), loadLoot(sb, encRows)])
      : [new Map(), []];

    const windows = encRows.map(e => {
      const s = Date.parse(e.started_at), en = Date.parse(e.ended_at);
      return { s, to: (Number.isFinite(en) ? en : s) + LOOT_TAIL_MS };
    });
    const lootBy = encRows.map(() => []);
    for (const l of loot) {
      const at = Date.parse(l.looted_at);
      if (!Number.isFinite(at)) continue;
      const who = shown(l.looter_character, anon, classes);
      const row = { id: l.id, looter: who.name, item: l.item_name, at: l.looted_at };
      if (l.from_own_pet) row.pet = true;
      if (who.anon) row.anon = true;
      windows.forEach((w, i) => { if (at >= w.s && at <= w.to) lootBy[i].push(row); });
    }

    const encounters = encRows.map((e, i) => {
      const players = (playersBy.get(e.id) || []).map(p => {
        const who = shown(p.character_name, anon, classes);
        const row = { name: who.name, class: who.class, damage: num(p.total_damage), dps: num(p.dps), duration: num(p.duration_sec), pets: !!p.has_pets, rank: num(p.rank) };
        if (who.anon) row.anon = true;
        return row;
      }).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || (b.damage ?? 0) - (a.damage ?? 0));
      return {
        id: e.id,
        npc_id: e.npc_id,
        name: displayName(e.eqemu_npc_types?.name),
        zone: e.zone_short || null,
        started_at: e.started_at,
        ended_at: e.ended_at || null,
        duration_sec: num(e.duration_sec),
        total_damage: num(e.total_damage),
        total_dps: num(e.total_dps),
        classification: e.classification || null,
        incomplete: !!e.data_incomplete,
        updated_at: e.updated_at,
        players,
        loot: lootBy[i].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id - b.id)),
      };
    });
    const tombstones = tombRows.map(t => ({ id: t.id, deleted_at: t.deleted_at, merged_into: t.merged_into || null }));

    const next = { ...cur };
    if (encRows.length) { const last = encRows[encRows.length - 1]; next.u = last.updated_at; next.i = last.id; }
    if (tombRows.length) { const last = tombRows[tombRows.length - 1]; next.d = last.deleted_at; next.j = last.id; }
    return {
      status: 200,
      body: { ok: true, cursor: encodeCursor(next), more: encRows.length >= limit || tombRows.length >= limit, encounters, tombstones },
    };
  } catch (err) {
    console.error('[local-sync] read failed:', err && err.message);
    return { status: 503, error: 'try again shortly' };
  }
}

/** Forgets the held class map (tests). The opt-out labels are rw._reset(). */
function _reset() { _classCache = null; }

module.exports = {
  DEFAULT_LIMIT, MAX_LIMIT, LAG_MS, LOOT_TAIL_MS,
  parseSince, encodeCursor, freshCursor, lootRanges, serve, _reset,
};
