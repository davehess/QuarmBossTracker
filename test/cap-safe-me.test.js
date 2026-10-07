// test/cap-safe-me.test.js — /me, /me/tells and the character pages read
// COMPLETE data (the PostgREST 1,000-row cap).
//
// The 2026-10-04 audit measured ten reads on these pages as broken on live
// data. Every one was the same bug: ask for 5,000 / 10,000 rows, get 1,000, no
// error. These tests run the REAL loaders (web/lib/capSafeReads.ts) against a
// fake Supabase client whose server enforces that cap (test/_fake-supabase-me.js),
// so a read that regresses to "ask for a big number and trust it" comes back
// short here exactly as it does in production.
//
// Each describe block also runs the OLD shape of the read through the same
// fake to prove the fake bites — a cap-enforcing fake that the old code passes
// would be worthless.
//
// Page wiring (which loader each page calls, the tells owner scoping) and the
// migration are text assertions on COMMENT-STRIPPED source — the file's own
// header comments quote the old queries, and a comment must not satisfy them.
//
// Run: npx vitest run test/cap-safe-me.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, stripSql } from './_source-slice.js';
import { fakeDb, PGRST_CAP } from './_fake-supabase-me.js';
import * as R from '../web/lib/capSafeReads.ts';
import { GUILD_TAG } from '../web/lib/guild.ts';

const rowsOf = (n, make) => Array.from({ length: n }, (_, i) => make(i));
// Letters-only names (the page strips everything else): aaa, aab, …
const nm = (i) => 'Npc' + [Math.floor(i / 676), Math.floor(i / 26) % 26, i % 26].map(d => String.fromCharCode(97 + d)).join('');
const uniq = (arr) => new Set(arr).size;

describe('the fake bites like PostgREST', () => {
  const t = rowsOf(3000, i => ({ id: i }));
  it('.limit(5000) and a one-call .range(0, 4999) both return 1,000 rows', async () => {
    const db = fakeDb({ tables: { t } });
    expect((await db.from('t').select('id').limit(5000)).data).toHaveLength(PGRST_CAP);
    expect((await db.from('t').select('id').range(0, 4999)).data).toHaveLength(PGRST_CAP);
  });
  it('a set-returning rpc is capped; one jsonb value is not', async () => {
    const db = fakeDb({ rpcs: { set: { setof: () => t }, one: { json: () => t } } });
    expect((await db.rpc('set')).data).toHaveLength(PGRST_CAP);
    expect((await db.rpc('one')).data).toHaveLength(3000);
  });
  it('rows an ORDER BY cannot tell apart come back in a different order per request', async () => {
    const tied = rowsOf(50, i => ({ id: i, k: 1 }));
    const db = fakeDb({ tables: { tied } });
    const a = (await db.from('tied').select('id').order('k')).data.map(r => r.id);
    const b = (await db.from('tied').select('id').order('k')).data.map(r => r.id);
    expect(a).not.toEqual(b);
    const c = (await db.from('tied').select('id').order('k').order('id')).data.map(r => r.id);
    const d = (await db.from('tied').select('id').order('k').order('id')).data.map(r => r.id);
    expect(c).toEqual(d);
  });
});

// ── 1. /me live state ──────────────────────────────────────────────────────
describe('item 1 — live state is asked for by NAME, not by guild', () => {
  // 1,508 characters ever reported; the member's three active ones sit past
  // row 1,000 in heap order, one stored in a different case.
  const live = rowsOf(1508, i => ({
    guild_id: GUILD_TAG, character: nm(i), zone_name: 'z', buff_count: 0, buffs: [], self_hp_pct: 100,
    updated_at: '2026-10-01T00:00:00Z',
  }));
  live[1300] = { ...live[1300], character: 'ALDENMAR', updated_at: '2026-10-04T06:00:00Z' };
  live[1400] = { ...live[1400], character: 'Brackwyn',  updated_at: '2026-10-04T06:01:00Z' };
  live[1500] = { ...live[1500], character: 'Corvale',   updated_at: '2026-10-04T06:02:00Z' };
  const family = ['Aldenmar', 'Brackwyn', 'Corvale', 'Mulealt'];

  it('the OLD read (every guild row) misses the active characters', async () => {
    const db = fakeDb({ tables: { character_live_state: live } });
    const { data } = await db.from('character_live_state').select('character').eq('guild_id', GUILD_TAG);
    expect(data).toHaveLength(PGRST_CAP);
    expect(data.some(r => ['aldenmar', 'brackwyn', 'corvale'].includes(r.character.toLowerCase()))).toBe(false);
  });
  it('the new read returns the family\'s rows — case-insensitively', async () => {
    const db = fakeDb({ tables: { character_live_state: live } });
    const rows = await R.fetchLiveStateRows(db, family);
    expect(rows.map(r => r.character.toLowerCase()).sort()).toEqual(['aldenmar', 'brackwyn', 'corvale']);
  });
  it('sends no request at all when no name survives the letters-only strip', async () => {
    const db = fakeDb({ tables: { character_live_state: live } });
    expect(await R.fetchLiveStateRows(db, ['', '123'])).toEqual([]);
    expect(await R.fetchLiveStateRows(db, [])).toEqual([]);
    expect(db.calls).toHaveLength(0);
  });
  it('ilikeAnyFilter keeps letters only and drops empties', () => {
    expect(R.ilikeAnyFilter('character', ['Aldenmar', 'Bra,ck.wyn', '', '42'])).toBe('character.ilike.Aldenmar,character.ilike.Brackwyn');
    expect(R.ilikeAnyFilter('character', ['', '9'])).toBe('');
  });
});

// ── 2. /me floor + coverage (cached 30 min) ────────────────────────────────
describe('item 2 — the cached floor / coverage map is COMPLETE', () => {
  const floor = rowsOf(1570, i => ({ character_name: nm(i), member_since: '2025-01-01T00:00:00Z', floor_source: 'tick' }));
  const cov = rowsOf(3237, i => ({ character_name: nm(i), encounters_total: 5, encounters_with_detail: 3, encounters_resubmittable: 2 }));

  it('the OLD read (.limit(5000) on the views) lost a third and two thirds', async () => {
    const db = fakeDb({ tables: { character_data_floor: floor, character_rollup_coverage: cov } });
    expect((await db.from('character_data_floor').select('*').limit(5000)).data).toHaveLength(1000);
    expect((await db.from('character_rollup_coverage').select('*').limit(5000)).data).toHaveLength(1000);
  });
  it('one jsonb value per view returns every row, keyed by lower-cased name', async () => {
    const db = fakeDb({ rpcs: { me_floor_json: { json: () => floor }, me_coverage_json: { json: () => cov } } });
    const { floors, coverage } = await R.fetchFloorAndCoverage(db);
    expect(floors).toHaveLength(1570);
    expect(coverage).toHaveLength(3237);
    expect(new Map(floors).get(nm(1569).toLowerCase())).toEqual({ member_since: '2025-01-01T00:00:00Z', floor_source: 'tick' });
    expect(new Map(coverage).get(nm(3236).toLowerCase())).toEqual({ encounters_total: 5, encounters_with_detail: 3, encounters_resubmittable: 2 });
    expect(db.calls.map(c => c.name).sort()).toEqual(['me_coverage_json', 'me_floor_json']);   // two calls, no paging
  });
  it('THROWS on an rpc error, so the 30-minute cache is never handed an empty map', async () => {
    const db = fakeDb({ rpcs: { me_floor_json: { json: () => floor }, me_coverage_json: { error: 'boom' } } });
    await expect(R.fetchFloorAndCoverage(db)).rejects.toThrow(/boom/);
    await expect(R.fetchFloorAndCoverage(fakeDb())).rejects.toThrow(/does not exist/);
  });
  it('skips rows without a name', () => {
    const { floors, coverage } = R.floorCoverageEntries([{ character_name: null }, { character_name: 'Aldenmar', member_since: 'x', floor_source: 'tick' }], [{ character_name: '' }]);
    expect(floors).toEqual([['aldenmar', { member_since: 'x', floor_source: 'tick' }]]);
    expect(coverage).toEqual([]);
  });
});

// ── 3. /me per-character stats ─────────────────────────────────────────────
describe('item 3 — per-character stats are summed in SQL, for the family at once', () => {
  // What me_char_stats returns for the heaviest raider: counts far past the cap.
  const heavy = {
    name: 'Aldenmar', encounter_count: 3807, total_damage: 24660990, top_damage: 116547, top_encounter_id: 'e-top',
    recent: [{ id: 'e1', started_at: '2026-10-04T06:22:36+00:00', npc_id: 209082, damage: 10116, dps: 108 }],
    upload_count: 4036, last_upload: '2026-10-04T06:29:44+00:00', latest_agent_version: '3.7.75',
    rollup_hits: 415569, rollup_damage: 22807298, self_attack_count: 74,
    top_skills: [{ skill: 'punch', hits: 315981, dmg: 15033787 }, { skill: 'crush', hits: 30695, dmg: 3622038 }],
  };
  const mule = { name: 'Mulealt', encounter_count: 0, total_damage: 0, top_damage: 0, top_encounter_id: null, recent: [], upload_count: 0, last_upload: null, latest_agent_version: null, rollup_hits: 0, rollup_damage: 0, self_attack_count: 0, top_skills: [] };

  it('the OLD reads (limit 5000 / 500 / 5000) could not carry these counts', async () => {
    const ep = rowsOf(3807, i => ({ encounter_id: 'e' + i, character_name: 'Aldenmar', total_damage: 1000 + i }));
    const contrib = rowsOf(4036, i => ({ id: i, contributor_character: 'Aldenmar', created_at: new Date(1e12 - i * 1e5).toISOString() }));
    const db = fakeDb({ tables: { encounter_players: ep, contributions: contrib } });
    expect((await db.from('encounter_players').select('*').eq('character_name', 'Aldenmar').limit(5000)).data).toHaveLength(1000);   // not 3,807
    expect((await db.from('contributions').select('*').eq('contributor_character', 'Aldenmar').limit(500)).data).toHaveLength(500);   // not 4,036
  });
  it('one call for every name; counts pass through un-capped', async () => {
    const db = fakeDb({ rpcs: { me_char_stats: { json: ({ p_names }) => [heavy, mule].filter(a => p_names.includes(a.name)) } } });
    const m = await R.fetchCharAggs(db, ['Aldenmar', 'Mulealt']);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].args).toEqual({ p_names: ['Aldenmar', 'Mulealt'] });
    const a = m.get('aldenmar');
    expect(a.encounter_count).toBe(3807);
    expect(a.upload_count).toBe(4036);
    expect(a.total_damage).toBe(24660990);
    expect(a.top_damage).toBe(116547);
    expect(a.rollup_hits).toBe(415569);
    expect(a.top_skills[0]).toEqual({ skill: 'punch', hits: 315981, dmg: 15033787 });
    expect(a.recent[0]).toEqual({ id: 'e1', started_at: '2026-10-04T06:22:36+00:00', npc_id: 209082, damage: 10116, dps: 108 });
    expect(m.get('mulealt').encounter_count).toBe(0);
  });
  it('coerces numeric strings (bigint / numeric come back as strings from some drivers)', () => {
    const m = R.charAggsFromRpc([{ name: 'Aldenmar', encounter_count: '3807', total_damage: '24660990', top_skills: [{ skill: 'hit', hits: '5', dmg: '9' }] }]);
    const a = m.get('aldenmar');
    expect(a.encounter_count).toBe(3807);
    expect(a.total_damage).toBe(24660990);
    expect(a.top_skills).toEqual([{ skill: 'hit', hits: 5, dmg: 9 }]);
    expect(a.upload_count).toBe(0);                                      // a missing field is 0, not NaN
    expect(a.recent).toEqual([]);
  });
  it('sends nothing for an empty family, and degrades to an empty map on an rpc error', async () => {
    const db = fakeDb({ rpcs: { me_char_stats: { error: 'boom' } } });
    expect((await R.fetchCharAggs(db, [])).size).toBe(0);
    expect(db.calls).toHaveLength(0);
    expect((await R.fetchCharAggs(db, ['Aldenmar'])).size).toBe(0);
    expect(R.EMPTY_AGG.top_skills).toEqual([]);
  });
});

// ── 4. The Scrap ───────────────────────────────────────────────────────────
describe('item 4 — The Scrap ranks over every contender', () => {
  const board = rowsOf(1106, i => ({ character_name: nm(i), total_damage: 2_000_000 - i * 1000, best_dps: 100, encounters: 5 }));
  // The server side of scrap_leaderboard_view, so the loader is exercised end to end.
  const view = ({ p_names }) => {
    const ranked = board.map((r, i) => ({ ...r, rank: i + 1 }));
    const mine = new Set(p_names.map(n => n.toLowerCase()));
    const me = ranked.find(r => mine.has(r.character_name.toLowerCase())) ?? null;
    return { contenders: ranked.length, top: ranked[0], me, rival: me && me.rank > 1 ? ranked[me.rank - 2] : null };
  };

  it('the OLD read (the set-returning rpc) stopped at 1,000 contenders and gave rank 1,100 no card', async () => {
    const db = fakeDb({ rpcs: { scrap_damage_leaderboard: { setof: () => board } } });
    const rows = (await db.rpc('scrap_damage_leaderboard', {})).data;
    expect(rows).toHaveLength(1000);
    expect(rows.some(r => r.character_name === nm(1099))).toBe(false);
  });
  it('a viewer ranked 1,100 gets their card, their rival, and the true contender count', async () => {
    const db = fakeDb({ rpcs: { scrap_leaderboard_view: { json: view } } });
    const v = await R.fetchScrapView(db, [nm(1099)], '2026-09-04T00:00:00.000Z');
    expect(v.contenders).toBe(1106);
    expect(v.me.rank).toBe(1100);
    expect(v.rival.rank).toBe(1099);
    expect(v.top.rank).toBe(1);
    expect(db.calls[0].args).toEqual({ p_since: '2026-09-04T00:00:00.000Z', p_names: [nm(1099)] });
  });
  it('rank 1 has no rival; a viewer off the board has no card; an empty board is null', () => {
    const first = R.scrapViewFromRpc(view({ p_names: [nm(0)] }));
    expect(first.me.rank).toBe(1);
    expect(first.rival).toBeNull();
    expect(R.scrapViewFromRpc(view({ p_names: ['Nobody'] })).me).toBeNull();
    expect(R.scrapViewFromRpc(null)).toBeNull();
    expect(R.scrapViewFromRpc({ contenders: 0, top: null })).toBeNull();
  });
});

// ── 5. /me/tells ───────────────────────────────────────────────────────────
describe('item 5 — tell totals count EVERY tell, and only the owner\'s', () => {
  const summary = {
    conversations: 384, total: 9156, incoming: 4377, outgoing: 4779,
    top: [{ other: 'Brackwyn', total: 38, incoming: 18, outgoing: 20, last_ts: '2026-10-04T06:51:24+00:00', last_text: 'hello', last_direction: 'incoming', last_char: 'Aldenmar' }],
  };
  it('the OLD read (newest .limit(2000)) could only ever count 1,000', async () => {
    const tells = rowsOf(9156, i => ({ id: i, owner_discord_id: 'owner-a', ts: new Date(1e12 - i * 1e3).toISOString() }));
    const db = fakeDb({ tables: { tells } });
    expect((await db.from('tells').select('id').eq('owner_discord_id', 'owner-a').order('ts', { ascending: false }).limit(2000)).data).toHaveLength(1000);
  });
  it('totals above the cap survive; rows are mapped to the page\'s conversation shape', async () => {
    const db = fakeDb({ rpcs: { me_tell_summary: { json: () => summary } } });
    const s = await R.fetchTellSummary(db, 'owner-a');
    expect(s).toMatchObject({ conversations: 384, total: 9156, incoming: 4377, outgoing: 4779 });
    expect(s.top[0]).toEqual({ other: 'Brackwyn', total: 38, incoming: 18, outgoing: 20, lastTs: '2026-10-04T06:51:24+00:00', lastText: 'hello', lastDirection: 'incoming', lastChar: 'Aldenmar' });
  });
  it('passes the owner id it was GIVEN and nothing else — and an empty id never reaches the database', async () => {
    const db = fakeDb({ rpcs: { me_tell_summary: { json: () => summary } } });
    await R.fetchTellSummary(db, 'owner-a');
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].args).toEqual({ p_owner_discord_id: 'owner-a', p_limit: 50 });
    for (const blank of ['', undefined, null]) await R.fetchTellSummary(db, blank);
    expect(db.calls).toHaveLength(1);
  });
  it('an rpc error or an empty payload is an empty summary, not a crash', async () => {
    expect(await R.fetchTellSummary(fakeDb({ rpcs: { me_tell_summary: { error: 'x' } } }), 'owner-a')).toEqual(R.EMPTY_TELL_SUMMARY);
    expect(R.tellSummaryFromRpc(null)).toEqual(R.EMPTY_TELL_SUMMARY);
    expect(R.tellSummaryFromRpc({ top: [{ other: 'B', last_direction: 'weird' }] }).top[0].lastDirection).toBe('incoming');
  });
});

// ── 6. /character/<name> parses ────────────────────────────────────────────
describe('item 6 — the character page\'s parse numbers come from SQL', () => {
  const j = {
    parses: 3807, total_damage: 24660990, first_started: '2025-01-15T15:50:20+00:00',
    best: { encounter_id: 'e-top', total_damage: 116547, dps: 68, duration_sec: 1708, rank: 3, started_at: '2026-10-01T01:29:30+00:00', npc_id: 154360, zone_short: null, npc_name: 'A_Possessed_Warmaster' },
    recent: [
      { encounter_id: 'e1', total_damage: 10116, dps: 108, duration_sec: 143, rank: 2, started_at: '2026-10-04T06:22:36+00:00', npc_id: 209082, zone_short: null, npc_name: null },
    ],
  };
  it('the OLD read (.limit(10000), top damage first) kept 1,000 of 3,807 parses', async () => {
    const parses = rowsOf(3807, i => ({ encounter_id: 'e' + i, character_name: 'Aldenmar', total_damage: i }));
    const db = fakeDb({ tables: { encounter_players: parses } });
    expect((await db.from('encounter_players').select('*').eq('character_name', 'Aldenmar').order('total_damage', { ascending: false }).limit(10000)).data).toHaveLength(1000);
  });
  it('count and totals pass through un-capped; rows take the shape the page renders', async () => {
    const db = fakeDb({ rpcs: { character_parse_summary: { json: () => j } } });
    const s = await R.fetchParseSummary(db, 'Aldenmar');
    expect(db.calls[0].args).toEqual({ p_name: 'Aldenmar' });
    expect(s.count).toBe(3807);
    expect(s.totalDamage).toBe(24660990);
    expect(s.firstStarted).toBe('2025-01-15T15:50:20+00:00');
    expect(s.best.total_damage).toBe(116547);
    expect(s.best.encounters.eqemu_npc_types).toEqual({ name: 'A_Possessed_Warmaster' });
    expect(s.best.encounters.started_at).toBe('2026-10-01T01:29:30+00:00');
    expect(s.recent[0]).toMatchObject({ encounter_id: 'e1', character_name: 'Aldenmar', dps: 108, rank: 2, duration_sec: 143 });
    expect(s.recent[0].encounters.eqemu_npc_types).toBeNull();           // a catalog miss renders "Unknown boss"
  });
  it('a character with no parses (or an rpc error) summarises to zeros', async () => {
    const s = await R.fetchParseSummary(fakeDb({ rpcs: { character_parse_summary: { error: 'x' } } }), 'Aldenmar');
    expect(s).toEqual({ count: 0, totalDamage: 0, firstStarted: null, best: null, recent: [] });
  });
});

// ── 7. /character/<name>/factions ──────────────────────────────────────────
describe('item 7 — faction reads are drained past the cap', () => {
  it('faction_cons: all 3,234 rows, no repeats at a page edge, newest first (ties across the boundary)', async () => {
    const base = Date.parse('2026-10-01T00:00:00Z');
    // 7-row blocks share a timestamp, so rows 996-1002 straddle the first page edge.
    const cons = [
      ...rowsOf(3234, i => ({ id: i + 1, guild_id: 'wolfpack', character: 'Aldenmar', mob: 'mob' + i, standing: 'amiably', rank: 5, event_ts: new Date(base - Math.floor(i / 7) * 1000).toISOString() })),
      ...rowsOf(400, i => ({ id: 5000 + i, guild_id: 'wolfpack', character: 'Brackwyn', mob: 'mob' + i, standing: 'ally', rank: 8, event_ts: new Date(base).toISOString() })),
    ];
    const db = fakeDb({ tables: { faction_cons: cons } });
    const got = await R.fetchFactionCons(db, 'aldenmar');
    expect(got).toHaveLength(3234);
    expect(uniq(got.map(r => r.mob))).toBe(3234);                        // none repeated or skipped
    expect(got.every((r, i) => i === 0 || got[i - 1].event_ts >= r.event_ts)).toBe(true);
    expect(Object.keys(got[0]).sort()).toEqual(['event_ts', 'mob', 'rank', 'standing']);
    // the OLD read
    expect((await fakeDb({ tables: { faction_cons: cons } }).from('faction_cons').select('*').ilike('character', 'aldenmar').order('event_ts', { ascending: false }).limit(500)).data).toHaveLength(500);
  });

  it('eqemu_npc_types: 80-name chunks, and a chunk that returns 1,200 rows is drained', async () => {
    const names = rowsOf(240, i => `mob_${i}`);
    // each name exists in 15 zones → an 80-name chunk is 1,200 rows, over the cap
    const npcs = names.flatMap((n, i) => rowsOf(15, z => ({ id: (z + 1) * 1000 + i, name: n, npc_faction_id: 100 + i })));
    const db = fakeDb({ tables: { eqemu_npc_types: npcs } });
    const got = await R.fetchNpcTypesByName(db, names);
    expect(got).toHaveLength(240 * 15);
    expect(uniq(got.map(r => r.id))).toBe(240 * 15);
    for (const c of db.calls.filter(c => c.name === 'eqemu_npc_types')) {
      const inFilter = c.filters.find(f => f[0] === 'in');
      expect(inFilter[2].length).toBeLessThanOrEqual(80);
    }
    // the OLD one-call-per-chunk read lost rows
    const old = await fakeDb({ tables: { eqemu_npc_types: npcs } }).from('eqemu_npc_types').select('*').in('name', names.slice(0, 80));
    expect(old.data).toHaveLength(1000);
  });
  it('eqemu_npc_types: runs chunks a few at a time (3,234 cons is ~40 of them), never all at once', async () => {
    const slowDb = (probe) => ({
      from: () => ({ select() { return this; }, in() { return this; }, order() { return this; },
        range() { return this; },
        then(res) { probe.inFlight++; probe.peak = Math.max(probe.peak, probe.inFlight); return new Promise(r => setTimeout(r, 5)).then(() => { probe.inFlight--; return { data: [], error: null }; }).then(res); } }),
    });
    const names = rowsOf(2400, i => `mob_${i}`);                        // 30 chunks of 80
    const dflt = { inFlight: 0, peak: 0 };
    await R.fetchNpcTypesByName(slowDb(dflt), names);
    expect(dflt.peak).toBe(8);                                           // the default: eight at a time
    const four = { inFlight: 0, peak: 0 };
    await R.fetchNpcTypesByName(slowDb(four), names, 80, 4);
    expect(four.peak).toBe(4);
  });

  it('eqemu_faction_list_full: all 2,123 factions, so no baseline is seeded at 0', async () => {
    const list = rowsOf(2123, i => ({ id: i + 1, name: 'Faction ' + i, base: i % 7 }));
    const db = fakeDb({ tables: { eqemu_faction_list_full: list } });
    const got = await R.fetchFactionListFull(db);
    expect(got).toHaveLength(2123);
    expect(got.find(f => f.id === 2123)).toEqual({ id: 2123, name: 'Faction 2122', base: 2122 % 7 });
    expect((await fakeDb({ tables: { eqemu_faction_list_full: list } }).from('eqemu_faction_list_full').select('*').limit(5000)).data).toHaveLength(1000);   // OLD
  });
  it('eqemu_faction_list_mod: only the character\'s codes, paged', async () => {
    const mods = [
      ...rowsOf(1300, i => ({ id: i + 1, faction_id: i, mod: 5, mod_name: 'r1' })),     // wider than the cap (hypothetical growth)
      ...rowsOf(500, i => ({ id: 2000 + i, faction_id: i, mod: 1, mod_name: 'r2' })),
    ];
    const db = fakeDb({ tables: { eqemu_faction_list_mod: mods } });
    expect(await R.fetchFactionMods(db, ['r1'])).toHaveLength(1300);
    expect(await R.fetchFactionMods(db, ['r1', 'r2'])).toHaveLength(1800);
    const before = db.calls.length;
    expect(await R.fetchFactionMods(db, [])).toEqual([]);
    expect(db.calls).toHaveLength(before);                               // no codes → no request
  });
});

// ── 8. /character/<name>/quests ────────────────────────────────────────────
describe('item 8 — the quests page reads the whole family inventory and every turn-in', () => {
  it('family inventory: 8,302 rows, the viewed character\'s own rows included, other guilds\' rows not', async () => {
    const own = rowsOf(499, i => ({ id: i, guild_id: GUILD_TAG, character_name: 'Zarrin', slot_label: 'Bank' + i, item_id: i, item_name: 'i' + i, quantity: 1 }));
    const alts = rowsOf(7803, i => ({ id: 1000 + i, guild_id: GUILD_TAG, character_name: nm(i % 14), slot_label: 'S' + i, item_id: i, item_name: 'j' + i, quantity: 1 }));
    const strangers = rowsOf(300, i => ({ id: 90000 + i, guild_id: 'other', character_name: 'Zarrin', slot_label: 'X' + i, item_id: i, item_name: 'k', quantity: 1 }));
    // heap order puts the viewed character LAST — the old read dropped her
    const table = [...alts, ...strangers, ...own];
    const family = ['Zarrin', ...rowsOf(14, nm)];
    const db = fakeDb({ tables: { character_inventory: table } });
    const got = await R.fetchFamilyInventory(db, family);
    expect(got).toHaveLength(8302);
    expect(got.filter(r => r.character_name === 'Zarrin')).toHaveLength(499);
    expect(uniq(got.map(r => r.character_name + '|' + r.slot_label))).toBe(8302);
    expect(Object.keys(got[0]).sort()).toEqual(['character_name', 'item_id', 'item_name', 'quantity', 'slot_label']);
    // the OLD read
    const old = (await fakeDb({ tables: { character_inventory: table } }).from('character_inventory').select('*').eq('guild_id', GUILD_TAG).or(family.map(n => `character_name.ilike.${n}`).join(',')).limit(10000)).data;
    expect(old).toHaveLength(1000);
    expect(old.filter(r => r.character_name === 'Zarrin')).toHaveLength(0);
  });
  it('family inventory: an empty family sends no request', async () => {
    const db = fakeDb();
    expect(await R.fetchFamilyInventory(db, [])).toEqual([]);
    expect(db.calls).toHaveLength(0);
  });

  it('discover_quests_for_item: the completed turn-ins the LIMIT 500 used to cut are here, pieces first', async () => {
    // 700 pieces + 600 completed = 1,300 rows: past BOTH the old LIMIT 500 and the response cap
    // Coarse zone / npc / matched-item values on purpose: many turn-ins share all
    // three (one held item feeds several), so only turnin_id keeps the order total.
    const turnins = [
      ...rowsOf(700, i => ({ turnin_id: i, zone_short: 'z' + (i % 3), npc_name: 'n' + (i % 5), evidence: 'piece', matched_item_id: i % 7 })),
      ...rowsOf(600, i => ({ turnin_id: 5000 + i, zone_short: 'z' + (i % 3), npc_name: 'n' + (i % 5), evidence: 'completed', matched_item_id: i % 7 })),
    ];
    const db = fakeDb({ rpcs: { discover_quests_for_item: { setof: () => turnins } } });
    const got = await R.fetchDiscoveredQuests(db, [1, 2, 3]);
    expect(got).toHaveLength(1300);
    expect(got.filter(r => r.evidence === 'completed')).toHaveLength(600);
    expect(got.slice(0, 700).every(r => r.evidence === 'piece')).toBe(true);
    expect(uniq(got.map(r => r.turnin_id))).toBe(1300);                  // none repeated or skipped at the page edge
    expect(db.calls[0].args).toEqual({ p_item_ids: [1, 2, 3] });
    // the OLD read: one capped response
    expect((await fakeDb({ rpcs: { discover_quests_for_item: { setof: () => turnins } } }).rpc('discover_quests_for_item', {})).data).toHaveLength(1000);
  });
  it('discover_quests_for_item: a typical result is ONE request; no held items sends none', async () => {
    const db = fakeDb({ rpcs: { discover_quests_for_item: { setof: () => rowsOf(533, i => ({ turnin_id: i, zone_short: 'z', npc_name: 'n', evidence: 'piece', matched_item_id: i })) } } });
    expect(await R.fetchDiscoveredQuests(db, [])).toEqual([]);
    expect(db.calls).toHaveLength(0);
    expect(await R.fetchDiscoveredQuests(db, [1])).toHaveLength(533);
    expect(db.calls).toHaveLength(1);
  });

  it('item metadata: 1,335 ids are fetched in chunks of 300, none lost', async () => {
    const items = rowsOf(1335, i => ({ id: i + 1, name: 'item' + i, nodrop: true }));
    const db = fakeDb({ tables: { eqemu_items: items } });
    const ids = items.map(i => i.id);
    const got = await R.fetchItemsByIds(db, 'id, name, nodrop', ids);
    expect(got).toHaveLength(1335);
    expect(uniq(got.map(r => r.id))).toBe(1335);
    for (const c of db.calls) expect(c.filters.find(f => f[0] === 'in')[2].length).toBeLessThanOrEqual(300);
    // the OLD single .in() lost 335 of them
    expect((await fakeDb({ tables: { eqemu_items: items } }).from('eqemu_items').select('id').in('id', ids)).data).toHaveLength(1000);
    expect(await R.fetchItemsByIds(db, 'id', [])).toEqual([]);
  });
});

// ── 9. /character/<name>/spells ────────────────────────────────────────────
describe('item 9 — scroll sources come back as one value', () => {
  const sources = rowsOf(4632, i => ({ item_id: 27000 + (i % 209), kind: i % 3 ? 'drop' : 'merchant', npc_id: i, npc_name: 'npc' + i, zone_short: 'z', zone_long: 'Zone' }));
  it('the OLD read (the set-returning function) returned 1,000 of 4,632 rows', async () => {
    const db = fakeDb({ rpcs: { spell_scroll_sources: { setof: () => sources } } });
    expect((await db.rpc('spell_scroll_sources', {})).data).toHaveLength(1000);
  });
  it('spell_scroll_sources_json returns every row', async () => {
    const db = fakeDb({ rpcs: { spell_scroll_sources_json: { json: () => sources } } });
    const got = await R.fetchScrollSources(db, [27000, 27001]);
    expect(got).toHaveLength(4632);
    expect(db.calls[0].args).toEqual({ p_item_ids: [27000, 27001] });
  });
  it('an rpc failure or no scrolls costs only the dropdown detail', async () => {
    expect(await R.fetchScrollSources(fakeDb({ rpcs: { spell_scroll_sources_json: { error: 'x' } } }), [1])).toEqual([]);
    const db = fakeDb();
    expect(await R.fetchScrollSources(db, [])).toEqual([]);
    expect(db.calls).toHaveLength(0);
  });
});

// ── 10. /who delete count ──────────────────────────────────────────────────
describe('item 10 — the who delete reports the real count', () => {
  const src = stripJs(fs.readFileSync(path.join(ROOT, 'web', 'app', 'who', 'actions.ts'), 'utf8'));
  const del = src.slice(src.indexOf('export async function deleteWhoCharacter'));
  it('asks PostgREST for an exact count instead of counting the (capped) returned rows', () => {
    expect(del).toMatch(/\.from\('who_observations'\)\s*\.delete\(\{ count: 'exact' \}\)/);
    expect(del).toMatch(/deleted: obsCount \?\? 0/);
    expect(del).not.toMatch(/\.select\('id'\)/);
    expect(del).not.toMatch(/obsRows/);
  });
  it('keeps the officer gate and the case-insensitive, guild-scoped match', () => {
    expect(del).toMatch(/officerIdentity\(\)/);
    // The guild kit swaps the literal for GUILD_TAG (web/lib/guild.ts, default 'wolfpack'); either spelling is
    // the guild-scoped match this test guards, so accept both and let the slices land in any order.
    expect(del).toMatch(/\.ilike\('character', name\)\s*\.eq\('guild_id', (?:'wolfpack'|GUILD_TAG)\)/);
  });
});

// ── Page wiring ────────────────────────────────────────────────────────────
const page = (...p) => stripJs(fs.readFileSync(path.join(ROOT, 'web', ...p), 'utf8'));
const overCap = (src) => [...src.matchAll(/\.limit\(\s*(\d+)\s*\)/g)].map(m => +m[1]).filter(n => n > PGRST_CAP);

describe('page wiring — each page calls the cap-safe loader and keeps no over-cap limit', () => {
  const me = page('app', 'me', 'page.tsx');
  it('/me', () => {
    expect(me).toMatch(/fetchLiveStateRows\(supabaseAdmin\(\), charNames\)/);
    expect(me).toMatch(/unstable_cache\(\s*async \(\) => fetchFloorAndCoverage\(supabaseAdmin\(\)\)/);
    expect(me).toMatch(/fetchCharAggs\(admin, names\)/);
    expect(me).toMatch(/fetchScrapView\(supabaseAdmin\(\), myNames, since\)/);
    expect(me).not.toMatch(/\.from\('character_data_floor'\)|\.from\('character_rollup_coverage'\)/);
    expect(me).not.toMatch(/\.from\('encounter_players'\)|\.from\('encounter_combat_rollup'\)|\.from\('contributions'\)/);
    expect(me).not.toMatch(/scrap_damage_leaderboard/);
    expect(overCap(me)).toEqual([]);
  });
  it('/me/tells', () => {
    const tells = page('app', 'me', 'tells', 'page.tsx');
    expect(tells).toMatch(/fetchTellSummary\(supabaseAdmin\(\), discordId\)/);
    expect(tells).toMatch(/\.eq\('owner_discord_id', discordId\)\s*\.order\('ts', \{ ascending: false \}\)\s*\.limit\(RECENT_TELLS\)/);
    expect(tells).toMatch(/const RECENT_TELLS = 50;/);
    expect(tells).not.toMatch(/buildConversations/);
    expect(overCap(tells)).toEqual([]);
  });
  it('/character/<name>', () => {
    const c = page('app', 'character', '[name]', 'page.tsx');
    expect(c).toMatch(/fetchParseSummary\(sb, displayName\)/);
    expect(c).not.toMatch(/\.from\('encounter_players'\)/);
    expect(overCap(c)).toEqual([]);
  });
  it('/character/<name>/factions', () => {
    const f = page('app', 'character', '[name]', 'factions', 'page.tsx');
    expect(f).toMatch(/fetchFactionCons\(sb, decoded\)/);
    expect(f).toMatch(/fetchNpcTypesByName\(sb, queryForms\)/);
    expect(f).toMatch(/fetchFactionMods\(sb, modCodes\)/);
    expect(f).toMatch(/fetchFactionListFull\(sb\)/);
    expect(f).not.toMatch(/\.from\('faction_cons'\)/);
    expect(overCap(f)).toEqual([]);
  });
  it('/character/<name>/quests', () => {
    const q = page('app', 'character', '[name]', 'quests', 'page.tsx');
    expect(q).toMatch(/fetchFamilyInventory\(sb, familyList\)/);
    expect(q).toMatch(/fetchDiscoveredQuests<Discovered>\(sb, ownInventoryIds\)/);
    expect(q).toMatch(/fetchItemsByIds<\{ id: number \} & ItemMeta>\(sb, /);
    expect(q).not.toMatch(/\.from\('character_inventory'\)/);
    expect(q).not.toMatch(/rpc\('discover_quests_for_item'/);
    expect(overCap(q)).toEqual([]);
  });
  it('/character/<name>/spells', () => {
    const s = page('app', 'character', '[name]', 'spells', 'page.tsx');
    expect(s).toMatch(/fetchScrollSources\(sb, scrollIds\)/);
    expect(s).not.toMatch(/rpc\('spell_scroll_sources'/);
  });
});

// ── The migration ──────────────────────────────────────────────────────────
describe('migration 20261004140600_cap_safe_me.sql', () => {
  const sql = stripSql(fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261004140600_cap_safe_me.sql'), 'utf8'));
  const fnBody = (name) => {
    const m = sql.match(new RegExp(`create or replace function public\\.${name}\\([^)]*\\)[\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`));
    if (!m) throw new Error('function not found: ' + name);
    return m[0];
  };
  const NEW_FNS = {
    me_char_stats: 'text[]', me_floor_json: '', me_coverage_json: '',
    scrap_leaderboard_view: 'timestamptz, text[]', me_tell_summary: 'text, integer',
    character_parse_summary: 'text', spell_scroll_sources_json: 'integer[]',
  };

  it('every new function is stable, security invoker, search_path pinned, and returns one jsonb value', () => {
    for (const name of Object.keys(NEW_FNS)) {
      const f = fnBody(name);
      expect(f, name).toMatch(/returns jsonb/);
      expect(f, name).toMatch(/\bstable\b/);
      expect(f, name).toMatch(/security invoker/);
      expect(f, name).toMatch(/set search_path = public/);
      expect(f, name).not.toMatch(/security definer/);
    }
  });
  it('is granted to service_role ONLY — nothing for anon, authenticated or public', () => {
    for (const [name, args] of Object.entries(NEW_FNS)) {
      const sig = `public\\.${name}\\(${args.replace(/[[\]]/g, '\\$&')}\\)`;
      expect(sql, name).toMatch(new RegExp(`revoke all on function ${sig}\\s+from public, anon, authenticated;`));
      expect(sql, name).toMatch(new RegExp(`grant execute on function ${sig}\\s+to service_role;`));
    }
    expect(sql).not.toMatch(/grant [^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/);
    expect((sql.match(/grant execute on function/g) || []).length).toBe(Object.keys(NEW_FNS).length);
  });
  it('me_tell_summary keeps the owner scoping INSIDE the function — every read of tells filters on the owner id', () => {
    const f = fnBody('me_tell_summary');
    expect(f).toMatch(/me_tell_summary\(p_owner_discord_id text, p_limit integer default 50\)/);
    const reads = f.match(/from tells t\b/g) || [];
    const scoped = f.match(/from tells t\s+where t\.owner_discord_id = p_owner_discord_id/g) || [];
    expect(reads.length).toBe(2);
    expect(scoped.length).toBe(reads.length);                             // no unscoped read of tells
    expect(f).not.toMatch(/p_owner_discord_id is null|or true|\bunion\b/i);
  });
  it('me_char_stats reads each table by exact character name and has no row limit of its own', () => {
    const f = fnBody('me_char_stats');
    // every `from <table> <alias>` is filtered by <alias>.<name column> = any(p_names)
    // before the next group by / order by — a shared column name elsewhere in the
    // function must not be able to satisfy it for a different read.
    for (const [table, col] of [['encounter_players', 'character_name'], ['contributions', 'contributor_character'], ['encounter_combat_rollup', 'character_name']]) {
      const reads = [...f.matchAll(new RegExp(`from ${table} (\\w+)([\\s\\S]*?)(?:group by|order by)`, 'g'))];
      expect(reads.length, table).toBeGreaterThan(0);
      for (const [, alias, rest] of reads) expect(rest, `${table} ${alias}`).toMatch(new RegExp(`${alias}\\.${col} = any\\(p_names\\)`));
    }
    expect(f).not.toMatch(/\blimit\b/);                                   // aggregates, not a window onto rows
  });
  it('discover_quests_for_item: LIMIT 500 is gone, the signature is unchanged, the order is total', () => {
    const f = fnBody('discover_quests_for_item');
    expect(f).toMatch(/discover_quests_for_item\(p_item_ids integer\[\]\)/);
    expect(f).not.toMatch(/\blimit\b/i);
    expect(f).toMatch(/order by 5 desc, 2, 3, 1, 6/);
    expect(f).toMatch(/set search_path = public/);
    expect(sql).not.toMatch(/drop function/i);                            // same signature: create-or-replace keeps its grants
  });
  it('the scroll-source and view wrappers fix their order', () => {
    expect(fnBody('spell_scroll_sources_json')).toMatch(/order by s\.item_id, s\.kind, s\.npc_id, s\.zone_short/);
    expect(fnBody('me_floor_json')).toMatch(/order by f\.character_name/);
    expect(fnBody('me_coverage_json')).toMatch(/order by c\.character_name/);
  });
  it('the Scrap view wraps the existing leaderboard instead of re-deriving the raid-fight rules', () => {
    const f = fnBody('scrap_leaderboard_view');
    expect(f).toMatch(/from scrap_damage_leaderboard\(p_since\) s/);
    expect(f).toMatch(/row_number\(\) over \(order by s\.total_damage desc, s\.character_name\)/);
    expect(sql).not.toMatch(/create or replace function public\.scrap_damage_leaderboard/);
  });
  it('is idempotent: only create-or-replace, revoke and grant', () => {
    expect(sql).not.toMatch(/\bcreate (table|index|view)\b|\balter\b|\bdrop\b|\binsert\b|\bupdate\b|\bdelete\b/i);
  });
});
