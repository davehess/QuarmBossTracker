// test/raid-share.test.js — public share links for one recorded raid session (the guild lead, 2026-10-15).
//
// What is held here, and why each is its own describe:
//   1. TOKEN      a link is 32 random bytes, only its SHA-256 is stored, junk never becomes a query.
//   2. LOOKUP     unknown, expired, revoked and malformed tokens are all null (the page answers one 404).
//   3. WINDOW     the window belongs to the share row; the only operation that narrows it can never widen it.
//   4. LOADER     driven against a recording fake database: EVERY read of a table with a time column carries
//                 the window's exact bounds, and the tables without one are read only for ids a bounded read gave.
//   5. OPT-OUTS   a character with exclude_from_stats or exclude_inventory appears nowhere (pure filters, and
//                 the replay rows are scrubbed).
//   6. SOURCE     the public page and its routes never read a time from the URL, and the table is service-role only.
//
// Source assertions run on comment-stripped text (stripJs/stripSql): this repo's comments explain exactly the
// behaviour under test, so a match on raw text would pass on the comment alone.
//
// Run: npx vitest run test/raid-share.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, stripSql } from './_source-slice.js';
import {
  newToken, hashToken, tokenLooksValid, shareStatus, makeWindow, boundWindow, inWindow, replaySlice,
  windowOfShare, expiryDays, windowIso, MAX_WINDOW_MS,
} from '../web/lib/raidShare.ts';
import { resolveShare, clearShareMemo } from '../web/lib/raidShareLookup.ts';
import {
  nameKey, optedOutSet, isOptedOut, dropOptedOut, scrubMinuteData, attendanceFromMinutes, buildKills, buildLoot,
  buildRolls, buildTicks,
} from '../web/lib/raidSession.ts';
import { loadSessionReview } from '../web/lib/raidSessionLoad.ts';
import { loadFightParse, fightInWindow, buildFightParse } from '../web/lib/raidSessionParse.ts';
import { decodeMinute, MINUTE_MS, REPLAY_WINDOW_MS } from '../web/lib/raidReplay.ts';

const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const ISO = '2026-10-14T13:08:00.000Z';
const T0 = Date.parse(ISO);
const win = makeWindow(T0, T0 + 218 * MINUTE_MS);

// ── a recording fake of the slice of PostgREST the code uses ─────────────────────────────────────────────────
// Every chained call is logged on the query; awaiting it hands back that table's canned rows. Pages are honoured
// by length only (the canned sets are short, so the first page is the last).
function fakeDb(tables = {}) {
  const queries = [];
  const api = {
    queries,
    from(table) {
      const q = { table, ops: [] };
      queries.push(q);
      const rec = (op) => (...args) => { q.ops.push([op, ...args]); return b; };
      const b = {
        select: rec('select'), eq: rec('eq'), is: rec('is'), not: rec('not'), or: rec('or'), in: rec('in'),
        gte: rec('gte'), lt: rec('lt'), lte: rec('lte'), gt: rec('gt'), order: rec('order'), range: rec('range'), limit: rec('limit'),
        update: rec('update'), insert: rec('insert'),
        maybeSingle() {
          q.ops.push(['maybeSingle']);
          const rows = tables[table] ?? [];
          return Promise.resolve({ data: rows[0] ?? null, error: null });
        },
        then(res, rej) {
          const rows = tables[table] ?? [];
          return Promise.resolve({ data: rows, error: null }).then(res, rej);
        },
      };
      return b;
    },
  };
  return api;
}
const hasOp = (q, name, ...args) => q.ops.some(o => o[0] === name && args.every((a, i) => o[i + 1] === a));

// ── 1. TOKEN ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('the token', () => {
  it('is 32 random bytes in base64url (43 characters), different every time', () => {
    const a = newToken(), b = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(tokenLooksValid(a)).toBe(true);
  });
  it('is stored as its SHA-256 (hex), never as itself', () => {
    const t = newToken();
    const h = hashToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(t);
    expect(hashToken(t)).toBe(h);
    expect(hashToken(t + 'x')).not.toBe(h);
    // a known vector, so a swapped algorithm cannot pass
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('a malformed value is refused before it can become a query', () => {
    for (const bad of ['', 'short', 'x'.repeat(42), 'x'.repeat(44), 'a/b'.padEnd(43, 'a'), null, undefined, 42, ' '.repeat(43)]) {
      expect(tokenLooksValid(bad)).toBe(false);
    }
  });
  it('an expiry is one of the offered choices, else 30 days', () => {
    expect([7, 30, 90].map(expiryDays)).toEqual([7, 30, 90]);
    for (const v of [0, 1, 365, -5, 'x', null, undefined, 30.5]) expect(expiryDays(v)).toBe(30);
  });
});

// ── 2. LOOKUP ────────────────────────────────────────────────────────────────────────────────────────────────
describe('looking a token up (unknown, expired and revoked are all 404)', () => {
  const NOW = Date.parse('2026-10-20T00:00:00Z');
  const token = newToken();
  const row = (over = {}) => ({
    id: 'id1', guild_id: 'wolfpack', from_at: ISO, to_at: new Date(T0 + 3600_000).toISOString(), title: 't',
    created_at: '2026-10-15T00:00:00Z', expires_at: '2026-11-01T00:00:00Z', revoked_at: null, view_count: 0, ...over,
  });

  // resolveShare is remembered per process (test/raid-share-abuse.test.js); these cases reuse one token across
  // different rows, so each starts with nothing remembered.
  beforeEach(() => clearShareMemo());

  it('a live share resolves to its row and ITS window', async () => {
    const db = fakeDb({ raid_shares: [row()] });
    const r = await resolveShare(db, token, NOW);
    expect(r.row.id).toBe('id1');
    expect(r.win).toEqual({ fromMs: T0, toMs: T0 + 3600_000 });
  });
  it('looks up by the HASH, and the raw token is never in a query', async () => {
    const db = fakeDb({ raid_shares: [row()] });
    await resolveShare(db, token, NOW);
    const q = db.queries[0];
    expect(q.table).toBe('raid_shares');
    expect(hasOp(q, 'eq', 'token_hash', hashToken(token))).toBe(true);
    expect(JSON.stringify(q.ops)).not.toContain(token);
  });
  it('unknown token -> null', async () => {
    expect(await resolveShare(fakeDb({ raid_shares: [] }), token, NOW)).toBeNull();
  });
  it('expired -> null', async () => {
    expect(await resolveShare(fakeDb({ raid_shares: [row({ expires_at: '2026-10-19T00:00:00Z' })] }), token, NOW)).toBeNull();
  });
  it('revoked -> null, even with time left', async () => {
    expect(await resolveShare(fakeDb({ raid_shares: [row({ revoked_at: '2026-10-16T00:00:00Z' })] }), token, NOW)).toBeNull();
  });
  it('an unreadable expiry counts as over, never as forever', () => {
    expect(shareStatus({ expires_at: 'garbage', revoked_at: null }, NOW)).toBe('expired');
    expect(shareStatus({ expires_at: '2026-11-01T00:00:00Z', revoked_at: null }, NOW)).toBe('ok');
    expect(shareStatus({ expires_at: '2026-11-01T00:00:00Z', revoked_at: 'x' }, NOW)).toBe('revoked');
  });
  it('a stored window that is unusable resolves to null (nothing is shown rather than everything)', async () => {
    expect(await resolveShare(fakeDb({ raid_shares: [row({ to_at: row().from_at })] }), token, NOW)).toBeNull();
    expect(windowOfShare({ from_at: 'x', to_at: 'y' })).toBeNull();
  });
  it('a malformed token does not touch the database at all', async () => {
    const db = fakeDb({ raid_shares: [row()] });
    expect(await resolveShare(db, 'nope', NOW)).toBeNull();
    expect(await resolveShare(db, undefined, NOW)).toBeNull();
    expect(db.queries.length).toBe(0);
  });
});

// ── 3. WINDOW ────────────────────────────────────────────────────────────────────────────────────────────────
describe('the window', () => {
  it('rounds out to whole minutes and refuses empty, reversed, NaN and over-a-day windows', () => {
    expect(makeWindow(T0 + 20_000, T0 + 60_000 + 1)).toEqual({ fromMs: T0, toMs: T0 + 2 * MINUTE_MS });
    expect(makeWindow(T0, T0)).toBeNull();
    expect(makeWindow(T0 + 1, T0)).toBeNull();
    expect(makeWindow(NaN, T0)).toBeNull();
    expect(makeWindow(T0, T0 + MAX_WINDOW_MS)).not.toBeNull();
    expect(makeWindow(T0, T0 + MAX_WINDOW_MS + MINUTE_MS)).toBeNull();
  });
  it('boundWindow only ever narrows: a request past either edge is cut back, never honoured', () => {
    const w = makeWindow(T0, T0 + 60 * MINUTE_MS);
    expect(boundWindow(w, T0 - 5 * MINUTE_MS, T0 + 10 * MINUTE_MS)).toEqual({ fromMs: T0, toMs: T0 + 10 * MINUTE_MS });
    expect(boundWindow(w, T0 + 50 * MINUTE_MS, T0 + 999 * MINUTE_MS)).toEqual({ fromMs: T0 + 50 * MINUTE_MS, toMs: w.toMs });
    expect(boundWindow(w, 0, Number.MAX_SAFE_INTEGER)).toEqual(w);
    expect(boundWindow(w, T0 - 10 * MINUTE_MS, T0)).toBeNull();            // touches the edge, shares nothing
    expect(boundWindow(w, w.toMs, w.toMs + MINUTE_MS)).toBeNull();
    expect(boundWindow(w, NaN, T0)).toBeNull();
    // for any request, the result lies inside the window
    for (const [a, b] of [[-1e12, 1e12], [T0 + 1, T0 + 2], [T0 + 59 * MINUTE_MS, T0 + 61 * MINUTE_MS]]) {
      const r = boundWindow(w, a, b);
      if (r) { expect(r.fromMs).toBeGreaterThanOrEqual(w.fromMs); expect(r.toMs).toBeLessThanOrEqual(w.toMs); }
    }
  });
  it('inWindow is [from, to)', () => {
    const w = makeWindow(T0, T0 + MINUTE_MS);
    expect(inWindow(w, T0)).toBe(true);
    expect(inWindow(w, T0 + MINUTE_MS - 1)).toBe(true);
    expect(inWindow(w, T0 + MINUTE_MS)).toBe(false);
    expect(inWindow(w, T0 - 1)).toBe(false);
    expect(inWindow(w, NaN)).toBe(false);
  });
  it('the replay slice is cut from the row window by INDEX and cannot leave it', () => {
    const w = makeWindow(T0, T0 + 40 * MINUTE_MS);
    expect(replaySlice(w, '0')).toEqual({ fromMs: T0, toMs: T0 + REPLAY_WINDOW_MS });
    expect(replaySlice(w, '1')).toEqual({ fromMs: T0 + REPLAY_WINDOW_MS, toMs: T0 + 2 * REPLAY_WINDOW_MS });
    expect(replaySlice(w, '2')).toEqual({ fromMs: T0 + 2 * REPLAY_WINDOW_MS, toMs: w.toMs });   // cut at the window's end
    expect(replaySlice(w, '3')).toBeNull();
    for (const bad of ['-1', '1.5', 'abc', '', '99999', null, undefined, '1e3']) expect(replaySlice(w, bad)).toBeNull();
  });
  it('windowIso gives the exact ISO bounds the reads carry', () => {
    expect(windowIso(win)).toEqual({ from: new Date(win.fromMs).toISOString(), to: new Date(win.toMs).toISOString() });
  });
});

// ── 4. LOADER ────────────────────────────────────────────────────────────────────────────────────────────────
describe('the session loader bounds every read to the window', () => {
  const W = makeWindow(T0 + 7 * MINUTE_MS, T0 + 99 * MINUTE_MS);   // not used by any other test: the loader memoizes per window
  const { from, to } = windowIso(W);
  const minuteData = JSON.stringify({ v: 1, step_s: 3, who: [['Aldenmar', 'Cleric', 1, 60], ['Hushed', 'Wizard', 1, 60]], zones: ['x'], f: [[0, 0, 1, 2, 3, 4, 90, 0, 1, 5, 6, 7, 8, 80, 0]] });
  const db = fakeDb({
    characters: [{ name: 'Hushed', exclude_from_stats: true, exclude_inventory: false }],
    raid_track_minutes: [{ minute_at: new Date(W.fromMs).toISOString(), night_key: '10/14/2026', zones: ['x'], raiders: 2, data: minuteData }],
    encounters: [{ id: 'e1', npc_id: 5, started_at: from, ended_at: from, duration_sec: 30, total_damage: 100, zone_short: 'x', eqemu_npc_types: { name: 'A_Mob' } }],
    opendkp_raids: [{ raid_id: 7 }],
    bosses_local: [{ npc_id: 5 }],
    encounter_players: [{ encounter_id: 'e1', character_name: 'Aldenmar', total_damage: 90, dps: 3 }, { encounter_id: 'e1', character_name: 'Hushed', total_damage: 99, dps: 4 }],
  });
  let out;
  it('runs', async () => { out = await loadSessionReview(db, W); expect(out.bundle.fromMs).toBe(W.fromMs); });

  // table -> the column the window is on
  const TIMED = {
    raid_track_minutes: 'minute_at', encounters: 'ended_at', looted_items: 'looted_at', loot_observations: 'posted_at',
    roll_sets: 'started_at', roll_set_overrides: 'started_at', raid_attendance_ticks: 'scheduled_for', opendkp_raids: 'ts',
  };
  for (const [table, col] of Object.entries(TIMED)) {
    it(`${table} is read with ${col} >= from and < to, exactly the window`, () => {
      const qs = db.queries.filter(q => q.table === table);
      expect(qs.length).toBeGreaterThan(0);
      for (const q of qs) {
        expect(hasOp(q, 'gte', col, from), `${table} lacks the lower bound`).toBe(true);
        expect(hasOp(q, 'lt', col, to), `${table} lacks the upper bound`).toBe(true);
      }
    });
  }
  it('the tables with no time column are read only for ids a windowed read returned', () => {
    for (const t of ['encounter_players', 'opendkp_ticks', 'opendkp_loot_recent', 'bosses_local']) {
      const qs = db.queries.filter(q => q.table === t);
      expect(qs.length, `${t} should have been read for the canned ids`).toBeGreaterThan(0);
      for (const q of qs) expect(q.ops.some(o => o[0] === 'in'), `${t} read without an id list`).toBe(true);
    }
    const ep = db.queries.find(q => q.table === 'encounter_players');
    expect(ep.ops.find(o => o[0] === 'in')[2]).toEqual(['e1']);
    expect(db.queries.find(q => q.table === 'opendkp_ticks').ops.find(o => o[0] === 'in')[2]).toEqual([7]);
  });
  it('nothing outside those tables is read', () => {
    const allowed = new Set([...Object.keys(TIMED), 'characters', 'encounter_players', 'opendkp_ticks', 'opendkp_loot_recent', 'bosses_local']);
    for (const q of db.queries) expect(allowed.has(q.table), `unexpected read of ${q.table}`).toBe(true);
  });
  it('the opted-out raider is in neither the attendance nor the parses', () => {
    expect(out.bundle.attendance.map(a => a.name)).toEqual(['Aldenmar']);
    expect(out.bundle.kills[0].top.map(p => p.name)).toEqual(['Aldenmar']);
    expect(out.bundle.kills[0].boss).toBe(true);
    expect(JSON.stringify(out)).not.toContain('Hushed');
  });
});

// ── 4b. FULL PARSE OF ONE FIGHT ──────────────────────────────────────────────────────────────────────────────
// loadFightParse is what both parse routes call. The fake database ignores filters, so the window guard is
// proved by the row it is handed (started/ended outside the window -> null) and the opt-out by the players it
// is handed (the hidden one never reaches the result, or the shares and totals).
describe('the full parse of one fight', () => {
  const W = makeWindow(T0, T0 + 120 * MINUTE_MS);
  const ID = '0b9a6d3e-1c2f-4a5b-8c7d-123456789abc';
  const at = (min) => new Date(T0 + min * MINUTE_MS).toISOString();
  const players = [
    { encounter_id: ID, character_name: 'Aldenmar', total_damage: 300, dps: 10, duration_sec: 30 },
    { encounter_id: ID, character_name: 'Hushed', total_damage: 9000, dps: 300, duration_sec: 30 },
    { encounter_id: ID, character_name: 'Brackwyn', total_damage: 100, dps: null, duration_sec: null },
    { encounter_id: ID, character_name: 'Idle', total_damage: 0, dps: 0, duration_sec: 30 },
  ];
  const dbFor = (enc) => fakeDb({
    encounters: enc ? [{ id: ID, ...enc }] : [],
    encounter_players: players,
    characters: [{ name: 'Hushed', class: 'Wizard', exclude_from_stats: true }, { name: 'Aldenmar', class: 'Cleric' }],
  });
  const inside = { started_at: at(10), ended_at: at(11), duration_sec: 40 };
  const opts = { guild: 'parse-test-guild', win: W };

  it('a fight inside the window is returned, biggest first, with shares of what is shown', async () => {
    const p = await loadFightParse(dbFor(inside), ID, opts);
    expect(p.players.map(x => x.name)).toEqual(['Aldenmar', 'Brackwyn']);
    expect(p.players[0]).toMatchObject({ cls: 'Cleric', damage: 300, dps: 10, durationSec: 30 });
    expect(p.players[1]).toMatchObject({ cls: null, dps: null, durationSec: 40 });   // no per-player time: the fight's
    expect(p.totalDamage).toBe(400);
    expect(p.players.map(x => x.pct)).toEqual([75, 25]);
  });
  it('a fight outside the window is rejected, before or after it', async () => {
    expect(await loadFightParse(dbFor({ started_at: at(-60), ended_at: at(-55), duration_sec: 9 }), ID, opts)).toBeNull();
    expect(await loadFightParse(dbFor({ started_at: at(130), ended_at: at(131), duration_sec: 9 }), ID, opts)).toBeNull();
  });
  it('the window is [from, to) on the fight END, the same rule the review lists fights by', () => {
    expect(fightInWindow({ started_at: at(-1), ended_at: at(0) }, W)).toBe(true);     // began a minute early, ended inside
    expect(fightInWindow({ started_at: at(119), ended_at: at(120) }, W)).toBe(false); // began inside, ended at `to`: not listed
    expect(fightInWindow({ started_at: at(119), ended_at: at(121) }, W)).toBe(false); // ended after: not listed, not served
    expect(fightInWindow({ started_at: at(-5), ended_at: at(-1) }, W)).toBe(false);
    expect(fightInWindow({ started_at: at(120), ended_at: null }, W)).toBe(false);
    expect(fightInWindow({ started_at: 'junk', ended_at: null }, W)).toBe(false);
  });
  it('a members call has no window; an unknown id, a junk id and a missing fight are all null', async () => {
    expect((await loadFightParse(dbFor({ started_at: at(-600), ended_at: at(-599), duration_sec: 9 }), ID, { guild: 'parse-test-guild' })).players.length).toBe(2);
    expect(await loadFightParse(dbFor(null), ID, opts)).toBeNull();
    const db = dbFor(inside);
    for (const bad of [null, undefined, '', 'e1', `${ID}' or 1=1`, 42]) expect(await loadFightParse(db, bad, opts)).toBeNull();
    expect(db.queries.length).toBe(0);   // a junk id never becomes a query
  });
  it('is read for this guild, unclassified, and by the fight id', async () => {
    const db = dbFor(inside);
    await loadFightParse(db, ID, opts);
    const enc = db.queries.find(q => q.table === 'encounters');
    expect(hasOp(enc, 'eq', 'guild_id', 'parse-test-guild')).toBe(true);
    expect(hasOp(enc, 'is', 'classification', null)).toBe(true);
    expect(hasOp(enc, 'eq', 'id', ID)).toBe(true);
    expect(hasOp(db.queries.find(q => q.table === 'encounter_players'), 'eq', 'encounter_id', ID)).toBe(true);
  });
  it('an opted-out character is in no row, no share and no total, nor anywhere in the JSON', async () => {
    const p = await loadFightParse(dbFor(inside), ID, opts);
    expect(JSON.stringify(p)).not.toContain('Hushed');
    expect(p.totalDamage).toBe(400);   // 9,000 would be there if they were counted
  });
  it('buildFightParse drops opted-out pets with their owner, and zero-damage rows', () => {
    const enc = { id: 'x', started_at: at(0), ended_at: at(1), duration_sec: 5 };
    const rows = [
      { character_name: 'Hushed`s pet', total_damage: 50, dps: 1, duration_sec: 5 },
      { character_name: 'Visible', total_damage: 50, dps: 1, duration_sec: 5 },
      { character_name: 'Idle', total_damage: 0, dps: 0, duration_sec: 5 },
    ];
    const p = buildFightParse(enc, rows, new Map(), new Set(['hushed']));
    expect(p.players.map(x => x.name)).toEqual(['Visible']);
    expect(p.players[0].pct).toBe(100);
  });
});

// ── 5. OPT-OUTS ──────────────────────────────────────────────────────────────────────────────────────────────
describe('opted-out characters', () => {
  const set = optedOutSet([
    { name: 'Hushed', exclude_from_stats: true },
    { name: 'Quietone', exclude_inventory: true },
    { name: 'Visible', exclude_from_stats: false, exclude_inventory: false },
    { name: 'Nulled', exclude_from_stats: null },
  ]);
  it('either flag opts a character out; neither does not', () => {
    expect([...set].sort()).toEqual(['hushed', 'quietone']);
  });
  it('is case-insensitive, and a pet counts as its owner', () => {
    expect(isOptedOut(set, 'HUSHED')).toBe(true);
    expect(isOptedOut(set, ' quietone ')).toBe(true);
    expect(isOptedOut(set, 'Hushed`s pet')).toBe(true);
    expect(nameKey('Hushed`s warder')).toBe('hushed');
    expect(isOptedOut(set, 'Visible')).toBe(false);
    expect(isOptedOut(set, null)).toBe(false);
  });
  it('dropOptedOut removes exactly those rows', () => {
    const rows = [{ n: 'Hushed' }, { n: 'Aldenmar' }, { n: 'quietone' }, { n: null }];
    expect(dropOptedOut(rows, r => r.n, set).map(r => r.n)).toEqual(['Aldenmar', null]);
    expect(dropOptedOut(rows, r => r.n, new Set()).length).toBe(4);
  });

  it('scrubMinuteData removes the name and the samples; the others still decode', () => {
    const data = JSON.stringify({ v: 1, step_s: 3, who: [['Aldenmar', 'Cleric', 1, 60], ['Hushed', 'Wizard', 1, 60], ['Brackwyn', 'Monk', 2, 60]], zones: ['x'],
      f: [[0, 0, 1, 2, 3, 4, 90, 0, 1, 5, 6, 7, 8, 80, 0, 2, 9, 9, 9, 9, 70, 0], [3, 1, 5, 6, 7, 8, 80, 0]] });
    const scrubbed = scrubMinuteData(data, set);
    expect(scrubbed).not.toMatch(/Hushed/);
    const frames = decodeMinute({ minute_at: ISO, data: scrubbed });
    expect(frames.length).toBe(1);                                  // the second frame held only the opted-out raider
    expect(frames[0].raiders.map(r => r.name)).toEqual(['Aldenmar', 'Brackwyn']);
    expect(scrubMinuteData(data, new Set())).toBe(data);            // nothing to hide: untouched
    expect(scrubMinuteData('not json', set)).toBe('{}');            // cannot be shown clean: not passed through
  });
  it('attendance never lists an opted-out character', () => {
    const data = JSON.stringify({ v: 1, who: [['Aldenmar', 'Cleric', 1, 60], ['Hushed', 'Wizard', 1, 60], ['Quietone', 'Monk', 1, 60]], f: [] });
    const rows = [{ minute_at: ISO, data }, { minute_at: new Date(T0 + MINUTE_MS).toISOString(), data }];
    const a = attendanceFromMinutes(rows, set);
    expect(a.map(x => x.name)).toEqual(['Aldenmar']);
    expect(a[0].minutes).toBe(2);
  });
  it('parses drop them from the top list', () => {
    const encs = [{ id: 'e', npc_id: 1, started_at: ISO, ended_at: ISO, duration_sec: 10, total_damage: 5, zone_short: 'x', eqemu_npc_types: { name: 'M' } }];
    const players = [
      { encounter_id: 'e', character_name: 'Hushed', total_damage: 500, dps: 1 },
      { encounter_id: 'e', character_name: 'Aldenmar', total_damage: 400, dps: 1 },
    ];
    expect(buildKills(encs, players, new Set(), set)[0].top.map(p => p.name)).toEqual(['Aldenmar']);
  });
  it('loot keeps the item but not the name', () => {
    const loot = buildLoot(
      [{ looter_character: 'Hushed', item_name: 'Rusty Helm', zone: 'x', looted_at: ISO }, { looter_character: 'Aldenmar', item_name: 'Cloak', zone: 'x', looted_at: ISO }],
      [{ item_name: 'Ring', winner_character: 'Quietone', dkp_amount: 5, posted_at: ISO }],
      [{ item_name: 'Belt', character_name: 'hushed', dkp: 3 }],
      set,
    );
    expect(JSON.stringify(loot)).not.toMatch(/Hushed|Quietone|hushed/);
    expect(loot.find(l => l.item === 'Rusty Helm')).toMatchObject({ who: null, whoHidden: true });
    expect(loot.find(l => l.item === 'Cloak')).toMatchObject({ who: 'Aldenmar', whoHidden: false });
  });
  it('a roll won by an opted-out character does not promote the runner-up', () => {
    const rows = [{ roll_from: 0, roll_to: 1000, item: 'Shiny Sword', qty: 1, zone: 'x', started_at: ISO, last_at: ISO,
      rolls: [{ name: 'Hushed', value: 900, at: ISO }, { name: 'Aldenmar', value: 500, at: ISO }] }];
    const [r] = buildRolls(rows, [], [{ looter_character: 'Hushed', item_name: 'Shiny Sword', zone: 'x', looted_at: ISO }], set);
    expect(r.winners).toEqual([]);
    expect(r.winnerHidden).toBe(true);
    expect(r.lines.map(l => l.name)).toEqual(['Aldenmar']);
    expect(r.rollers).toBe(1);
    expect(r.lootedBy).toEqual([]);
    expect(JSON.stringify(r)).not.toMatch(/Hushed/);
  });
  it('an officer-hidden roll set is not shared', () => {
    const rows = [{ roll_from: 0, roll_to: 100, item: 'Misfire', qty: 1, zone: 'x', started_at: ISO, last_at: ISO, rolls: [{ name: 'Aldenmar', value: 5, at: ISO }] }];
    const hide = [{ roll_from: 0, roll_to: 100, started_at: ISO, hidden: true }];
    expect(buildRolls(rows, hide, [], set)).toEqual([]);
  });
  it('tick lists drop them too', () => {
    const t = buildTicks([{ description: 'Tick 1', scheduled_for: ISO, names: ['Aldenmar', 'Hushed'] }], [{ description: 'T', attendees: ['Quietone', 'Brackwyn'] }], set);
    expect(t.map(x => x.names)).toEqual([['Aldenmar'], ['Brackwyn']]);
  });
});

// ── 6. SOURCE ────────────────────────────────────────────────────────────────────────────────────────────────
describe('the public surface never takes a time from the URL', () => {
  const dir = path.join(ROOT, 'web', 'app', 'api', 'share', 'raid', '[token]');
  const routes = fs.readdirSync(dir).map(n => [n, stripJs(read('web', 'app', 'api', 'share', 'raid', '[token]', n, 'route.ts'))]);
  const page = stripJs(read('web', 'app', 'share', 'raid', '[token]', 'page.tsx'));

  it('found the routes (a path bug would make the rest vacuous)', () => {
    expect(routes.map(r => r[0]).sort()).toEqual(['bosses', 'map', 'mesh', 'parse', 'replay']);
    expect(page.length).toBeGreaterThan(500);
  });
  it('the share page reads no search parameter at all', () => {
    expect(page).not.toMatch(/searchParams/);
    expect(page).not.toMatch(/useSearchParams|new URL\(/);
    expect(page).toMatch(/resolveShare\(/);
    expect(page).toMatch(/share\.win/);
  });
  it.each(routes)('/%s asks the token first and never reads from, to, night or a time', (_n, src) => {
    expect(src).toMatch(/resolveShare\(/);
    expect(src).not.toMatch(/get\(\s*['"](from|to|night|since|until|start|end|t)['"]\s*\)/);
    expect(src).not.toMatch(/searchParams\.get\(\s*['"]\w*(from|to|night)\w*['"]/i);
    // the only parameters any of them reads
    const names = [...src.matchAll(/\.get\(\s*['"](\w+)['"]\s*\)/g)].map(m => m[1]);
    for (const n of names) expect(['w', 'zone', 'floors', 'encounter']).toContain(n);
  });
  it('the replay route cuts its slice from the share window and reads through windowed()', () => {
    const src = routes.find(r => r[0] === 'replay')[1];
    expect(src).toMatch(/replaySlice\(share\.win/);
    expect(src).toMatch(/windowIso\(slice\)/);
    expect(src).toMatch(/from\('raid_track_minutes'\)[\s\S]*?\.gte\('minute_at', from\)\.lt\('minute_at', to\)/);
    expect(src).toMatch(/scrubMinuteData\(/);
  });
  it('the parse route hands the share row\'s window to the loader and answers a miss with the one 404', () => {
    const src = routes.find(r => r[0] === 'parse')[1];
    expect(src).toMatch(/loadFightParse\([\s\S]*?win:\s*share\.win/);
    expect(src).toMatch(/guild:\s*share\.row\.guild_id/);
    expect(src).toMatch(/if \(!parse\) return NOT_FOUND\(\)/);
  });
  it('the public map route never reads the Brewall layer (third-party art, members only)', () => {
    const src = routes.find(r => r[0] === 'map')[1];
    expect(src).not.toMatch(/fetchBrewallLayer/);
    expect(src).not.toMatch(/select\([^)]*brewall/);
    expect(src).toMatch(/brewall: null/);
  });
  it('the middleware gives /share/ no session work and a bare shell', () => {
    const mw = stripJs(read('web', 'middleware.ts'));
    expect(mw).toMatch(/startsWith\('\/share\/'\)/);
    expect(mw).toMatch(/x-wp-bare/);
    const layout = stripJs(read('web', 'app', 'layout.tsx'));
    expect(layout).toMatch(/x-wp-bare/);
  });
  it('the officer routes check the officer role', () => {
    for (const f of [['api', 'raid', 'shares', 'route.ts'], ['api', 'raid', 'shares', '[id]', 'route.ts']]) {
      const src = stripJs(read('web', 'app', ...f));
      expect(src).toMatch(/isOfficer\(/);
      expect(src).toMatch(/auth\.getUser\(\)/);
    }
  });
});

describe('the table', () => {
  const sql = stripSql(read('supabase', 'migrations', '20261015130000_raid_shares.sql'));
  it('stores the hash, never a token column', () => {
    expect(sql).toMatch(/token_hash\s+text\s+not null unique/);
    expect(sql).not.toMatch(/\btoken\s+text/i);
  });
  it('is service-role only: RLS on, no policy, no grant to anon or authenticated', () => {
    expect(sql).toMatch(/enable row level security/);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toMatch(/revoke all on public\.raid_shares from anon, authenticated/);
  });
  it('carries the columns the routes use and a window check', () => {
    for (const c of ['id', 'guild_id', 'from_at', 'to_at', 'title', 'created_by', 'created_at', 'expires_at', 'revoked_at', 'view_count']) {
      expect(sql).toMatch(new RegExp(`\\b${c}\\b`));
    }
    expect(sql).toMatch(/default \(now\(\) \+ interval '30 days'\)/);
    expect(sql).toMatch(/to_at > from_at/);
  });
});
