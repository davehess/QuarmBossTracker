// test/full-reads.test.js — the pages the 2026-10-04 audit found reading a silently truncated set.
//
// PostgREST returns at most 1,000 rows per response and says nothing. `.limit(20000)` and a one-call
// `.range(0, 99999)` do not raise it; a set-returning RPC and a VIEW are capped the same way. Twelve pages
// were reading a short set (recent nights with no attendance, a raid review with no slows, guide kill
// counts a third of the truth). The fixes live in web/lib/fullReads.ts, one loader per read.
//
// HOW THESE TESTS ARE HONEST: every loader runs against test/_fake-supabase-js.js, a fake that ENFORCES the
// 1,000-row cap and RE-SHUFFLES the matching rows on every request before applying the query's ORDER BY.
// A loader that pages over a missing or non-unique `.order()` therefore repeats and skips rows exactly as
// production does, and one that does not page at all returns 1,000 — so each assertion below fails on the
// old behaviour, not just on a typo. (The mutation list is in the commit message.)
//
// Run: npx vitest run test/full-reads.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fakeSupabase, PGRST_MAX_ROWS } from './_fake-supabase-js.js';
import { ROOT, stripJs, stripSql } from './_source-slice.js';
import {
  loadTicksForRaids, loadLootRecent, loadLootSpend, loadOffcardRollup, loadReviewEncounters,
  nightStreamWindow, loadNightSlows, loadNightFires, loadEventsForEncounters, loadActiveBuffCasts,
  loadGuideKillRollup, loadDropperCounts, loadAwardsForItems, loadEncounterEvents,
  loadAgentVersionsAround, loadItemDrops, loadSpawn2, loadPvpBossKills,
} from '../web/lib/fullReads.ts';

const iso = (ms) => new Date(ms).toISOString();
const T0 = Date.UTC(2026, 8, 27, 20, 0, 0);
const keyed = (rows, k) => rows.map(r => r[k]);
const noDupes = (rows, k) => new Set(keyed(rows, k)).size === rows.length;

// ── the fake itself ──────────────────────────────────────────────────────────

describe('the fake enforces what PostgREST enforces', () => {
  const sb = fakeSupabase({ tables: { t: Array.from({ length: 2500 }, (_, i) => ({ id: i })) } });

  it('caps every response at 1,000 rows however much is asked for', async () => {
    expect((await sb.from('t').select('*').limit(20000)).data).toHaveLength(PGRST_MAX_ROWS);
    expect((await sb.from('t').select('*').range(0, 99999)).data).toHaveLength(PGRST_MAX_ROWS);
    expect((await sb.from('t').select('*')).data).toHaveLength(PGRST_MAX_ROWS);
  });

  it('re-orders unpinned rows between requests, so an unordered paged read is wrong', async () => {
    const a = (await sb.from('t').select('*').range(0, 999)).data.map(r => r.id);
    const b = (await sb.from('t').select('*').range(1000, 1999)).data.map(r => r.id);
    expect(new Set([...a, ...b]).size, 'two unordered pages must overlap or skip').toBeLessThan(2000);
  });

  it('a TIE in the order key is as unstable as no order key', async () => {
    // groups of 3: the page boundary (1000 = 333 * 3 + 1) cuts a group in half
    const tied = fakeSupabase({ tables: { t: Array.from({ length: 2400 }, (_, i) => ({ id: i, k: Math.floor(i / 3) })) } });
    const a = (await tied.from('t').select('*').order('k').range(0, 999)).data.map(r => r.id);
    const b = (await tied.from('t').select('*').order('k').range(1000, 1999)).data.map(r => r.id);
    expect(new Set([...a, ...b]).size).toBeLessThan(2000);
  });
});

// ── 1. /parses attendance: opendkp_ticks ─────────────────────────────────────

describe('loadTicksForRaids', () => {
  // 1,578 ticks like production, the newest raids carrying the highest ids. The old read took the first
  // 1,000 rows of the table, which held none of the last 30 days.
  const ticks = Array.from({ length: 2350 }, (_, i) => ({ tick_id: i + 1, raid_id: 1000 + Math.floor(i / 4), attendees: ['Aldenmar'] }));
  const newestRaid = 1000 + Math.floor(2349 / 4);

  it('returns every tick of the requested raids, once each, including the newest', async () => {
    const sb = fakeSupabase({ tables: { opendkp_ticks: ticks } });
    const raidIds = [...new Set(ticks.map(t => t.raid_id))];
    const rows = await loadTicksForRaids(sb, raidIds);
    expect(rows).toHaveLength(2350);
    expect(noDupes(rows, 'tick_id')).toBe(true);
    expect(rows.some(r => r.raid_id === newestRaid), 'the newest raid must be present').toBe(true);
  });

  it('is the old read that loses them: one unpaged request keeps 1,000 and none of the newest raids', async () => {
    const sb = fakeSupabase({ tables: { opendkp_ticks: ticks } });
    const { data } = await sb.from('opendkp_ticks').select('raid_id, attendees').order('tick_id').range(0, 99999);
    expect(data).toHaveLength(1000);
    expect(data.some(r => r.raid_id === newestRaid)).toBe(false);
  });

  it('asks only for the given raids', async () => {
    const sb = fakeSupabase({ tables: { opendkp_ticks: ticks } });
    const rows = await loadTicksForRaids(sb, [1000, 1001]);
    expect(rows).toHaveLength(8);
    expect(rows.every(r => r.raid_id === 1000 || r.raid_id === 1001)).toBe(true);
  });

  it('makes no request for no raids', async () => {
    const sb = fakeSupabase({ tables: { opendkp_ticks: ticks } });
    expect(await loadTicksForRaids(sb, [])).toEqual([]);
    expect(sb.requests).toHaveLength(0);
  });
});

// ── 2. opendkp_loot_recent (a VIEW) ──────────────────────────────────────────

describe('loadLootRecent', () => {
  // Groups of FOUR rows sharing (raid_date, auction_id) — the view repeats an auction whose winner id
  // matches more than one `characters` row — offset by one single row so that every page boundary cuts a
  // group in half.
  const rows = [{ raid_date: '2024-01-01', auction_id: 1, character_name: 'Solo', dkp: 1 }];
  for (let g = 0; g < 1300; g++) {
    for (const who of ['Aldenmar', 'Brackwyn', 'Corvale', 'Nyssara']) {
      rows.push({ raid_date: `2024-${String(1 + Math.floor(g / 110)).padStart(2, '0')}-${String(1 + (g % 27)).padStart(2, '0')}`, auction_id: 100 + g, character_name: who, dkp: g % 50 });
    }
  }
  const sb = () => fakeSupabase({ tables: { opendkp_loot_recent: rows } });

  it('returns every row exactly once even when many rows tie on (raid_date, auction_id)', async () => {
    const out = await loadLootRecent(sb(), 'raid_date, dkp', null);
    expect(out).toHaveLength(rows.length);
    expect(rows.length).toBe(5201);
  });

  it('returns each (auction, character) once: no repeats, no skips', async () => {
    const s = sb();
    const out = await loadLootRecent(s, 'raid_date, auction_id, character_name, dkp', null);
    const key = (r) => `${r.auction_id}|${r.character_name}`;
    expect(new Set(out.map(key)).size).toBe(rows.length);
    expect(new Set(rows.map(key)).size).toBe(rows.length);
  });

  it('pages: more than one request, each asking for the next 1,000', async () => {
    const s = sb();
    await loadLootRecent(s, 'raid_date, dkp', null);
    expect(s.requests.length).toBeGreaterThan(4);
    expect(s.requests[0].range).toEqual([0, 999]);
    expect(s.requests[1].range).toEqual([1000, 1999]);
    for (const r of s.requests) expect(r.orders).toEqual(['raid_date', 'auction_id', 'character_name']);
  });

  it('applies the window as a raid_date lower bound', async () => {
    const out = await loadLootRecent(sb(), 'raid_date, dkp', '2024-06-01');
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(rows.length);
    expect(out.every(r => r.raid_date >= '2024-06-01')).toBe(true);
  });
});

describe('loadLootSpend', () => {
  it('asks SQL for the sum and returns numbers', async () => {
    const sb = fakeSupabase({ rpcs: { leaderboard_loot_spend: () => [{ character_name: 'Aldenmar', total_dkp: '5320', items: 111 }] } });
    const out = await loadLootSpend(sb, '2026-09-01', 20);
    expect(out).toEqual([{ character_name: 'Aldenmar', total_dkp: 5320, items: 111 }]);
    expect(sb.requests[0].args).toEqual({ p_since: '2026-09-01', p_limit: 20 });
  });

  it('lifetime is a null window, not an empty string', async () => {
    const sb = fakeSupabase({ rpcs: { leaderboard_loot_spend: () => [] } });
    await loadLootSpend(sb, null);
    expect(sb.requests[0].args).toEqual({ p_since: null, p_limit: 20 });
  });
});

// ── 3. /parses off-card rollup (a set-returning RPC) ─────────────────────────

describe('loadOffcardRollup', () => {
  // 1,185 groups lifetime, ordered by the grouping key as the migration's ORDER BY does.
  const all = Array.from({ length: 2350 }, (_, i) => ({ day: iso(T0 + i * 86400000).slice(0, 10), zone_short: 'z' + (i % 7), is_raid: i % 2 === 0, kills: 1, total_damage: 10 }));
  const sb = () => fakeSupabase({ rpcs: { parses_offcard_rollup: () => all } });

  it('returns every group of a set bigger than the cap', async () => {
    const out = await loadOffcardRollup(sb(), null);
    expect(out).toHaveLength(2350);
    expect(out[2349]).toEqual(all[2349]);
  });

  it('lifetime sends the epoch as p_since; a window sends its own bound', async () => {
    const a = sb(); await loadOffcardRollup(a, null);
    expect(a.requests[0].args).toEqual({ p_since: '1970-01-01T00:00:00Z' });
    const b = sb(); await loadOffcardRollup(b, '2026-08-05T00:00:00.000Z');
    expect(b.requests[0].args).toEqual({ p_since: '2026-08-05T00:00:00.000Z' });
  });
});

// ── 4. /raid/review index: curated encounters ────────────────────────────────

describe('loadReviewEncounters', () => {
  // 2,100 encounters in batches that share a started_at (a raid pulls several mobs in the same second).
  const encs = Array.from({ length: 2100 }, (_, i) => ({
    id: `e${String(i).padStart(5, '0')}`, npc_id: i % 5 === 0 ? 9 : 1 + (i % 3), started_at: iso(T0 + Math.floor(i / 6) * 60000),
    total_damage: i % 17 === 0 ? 0 : 100,
  }));
  const wanted = encs.filter(e => e.npc_id !== 9 && e.total_damage > 0);
  const sb = () => fakeSupabase({ tables: { encounters: encs } });

  it('returns every curated, non-empty encounter once, newest first — past 1,000 and past the old 400', async () => {
    const out = await loadReviewEncounters(sb(), [1, 2, 3], null);
    expect(out).toHaveLength(wanted.length);
    expect(wanted.length).toBeGreaterThan(1000);
    expect(noDupes(out, 'id')).toBe(true);
    for (let i = 1; i < out.length; i++) expect(out[i - 1].started_at >= out[i].started_at).toBe(true);
  });

  it('applies the window', async () => {
    const since = iso(T0 + 200 * 60000);
    const out = await loadReviewEncounters(sb(), [1, 2, 3], since);
    expect(out.length).toBe(wanted.filter(e => e.started_at >= since).length);
    expect(out.every(e => e.started_at >= since)).toBe(true);
  });

  it('THROWS when the read fails, so the page can show its error instead of an empty list of nights', async () => {
    const bad = fakeSupabase({ tables: { encounters: encs }, errors: { encounters: 'permission denied' } });
    await expect(loadReviewEncounters(bad, [1], null)).rejects.toThrow('permission denied');
  });
});

// ── 5. /raid/review/[date]: one night's streams ──────────────────────────────

describe('nightStreamWindow', () => {
  const dayStart = '2026-09-27T04:00:00.000Z', dayEnd = '2026-09-28T04:00:00.000Z';
  const ms = (s) => Date.parse(s);

  it('is null for a night with no fights', () => {
    expect(nightStreamWindow(null, dayStart, dayEnd)).toBeNull();
  });

  it('is the fight span when it sits inside the day', () => {
    const span = { startMs: ms('2026-09-27T22:40:00Z'), endMs: ms('2026-09-28T01:10:00Z') };
    expect(nightStreamWindow(span, dayStart, dayEnd)).toEqual({ startIso: '2026-09-27T22:40:00.000Z', endIso: '2026-09-28T01:10:00.000Z' });
  });

  it('is clipped to the Eastern day the page covers, the end by one millisecond (the day end is exclusive)', () => {
    const span = { startMs: ms('2026-09-27T02:00:00Z'), endMs: ms('2026-09-28T09:00:00Z') };
    expect(nightStreamWindow(span, dayStart, dayEnd)).toEqual({ startIso: dayStart, endIso: '2026-09-28T03:59:59.999Z' });
  });

  it('is null when the span misses the day entirely', () => {
    const span = { startMs: ms('2026-09-29T00:00:00Z'), endMs: ms('2026-09-29T02:00:00Z') };
    expect(nightStreamWindow(span, dayStart, dayEnd)).toBeNull();
  });
});

describe('loadNightSlows / loadNightFires', () => {
  const win = { startIso: '2026-09-27T22:40:00.000Z', endIso: '2026-09-28T04:04:00.000Z' };
  // 174 slows is a real night; 2,350 proves the paging for a bigger one.
  const slowRows = Array.from({ length: 2350 }, (_, i) => ({ target: 'a gloomingdeep', spell_name: 'Drowsy', cast_at: iso(T0 + i * 1000), observer: 'o' + (i % 4) }));
  const fireRows = Array.from({ length: 1700 }, (_, i) => ({ at: iso(T0 + i * 1000), subtype: 'Death Touch', actor: null, label: null }));

  it('slows: every row of the span, in order, and the page\'s own list is what is sent', async () => {
    const sb = fakeSupabase({ rpcs: { raid_night_slows: () => slowRows } });
    const spells = ['drowsy', "tagar's insects"];
    const out = await loadNightSlows(sb, win, spells);
    expect(out).toHaveLength(2350);
    expect(out[2349]).toEqual(slowRows[2349]);
    expect(sb.requests[0].args).toEqual({ p_guild_id: 'wolfpack', p_start: win.startIso, p_end: win.endIso, p_spells: spells });
    expect(sb.requests).toHaveLength(3);                       // 1,000 + 1,000 + 350
  });

  it('fires: every row of the span and the noise list is what is sent', async () => {
    const sb = fakeSupabase({ rpcs: { raid_night_fires: () => fireRows } });
    const noise = ['too far', 'invis'];
    const out = await loadNightFires(sb, win, noise);
    expect(out).toHaveLength(1700);
    expect(sb.requests[0].args).toEqual({ p_guild_id: 'wolfpack', p_start: win.startIso, p_end: win.endIso, p_noise: noise });
  });

  it('is the old read that returns the first 1,000: one unpaged request over the same RPC', async () => {
    const sb = fakeSupabase({ rpcs: { raid_night_slows: () => slowRows } });
    const { data } = await sb.rpc('raid_night_slows', {});
    expect(data).toHaveLength(1000);
    expect(data).not.toHaveLength(slowRows.length);
  });
});

describe('loadEventsForEncounters / loadEncounterEvents', () => {
  // 2,356 events on one night; every observer uploads the same instant, so `at` ties in big runs (37 here,
  // so that both page boundaries, at 1,000 and 2,000, fall in the middle of a run).
  const events = Array.from({ length: 2356 }, (_, i) => ({
    id: `ev${String(i).padStart(5, '0')}`, encounter_id: 'enc' + (i % 5), at: iso(T0 + Math.floor(i / 37) * 1000),
    kind: 'fire', subtype: null, actor: null, label: null,
  }));
  const sb = () => fakeSupabase({ tables: { encounter_events: events } });

  it('returns all of a night\'s events once each, oldest first, past the 6,000 limit\'s real ceiling of 1,000', async () => {
    const out = await loadEventsForEncounters(sb(), ['enc0', 'enc1', 'enc2', 'enc3', 'enc4']);
    expect(out).toHaveLength(2356);
    for (let i = 1; i < out.length; i++) expect(out[i - 1].at <= out[i].at).toBe(true);
  });

  it('every event comes back exactly once (ties on `at` do not repeat or skip rows)', async () => {
    // The fake returns whole fixture rows, so the primary key is visible here even though the real select omits it.
    const out = await loadEventsForEncounters(sb(), ['enc0', 'enc1', 'enc2', 'enc3', 'enc4']);
    expect(noDupes(out, 'id')).toBe(true);
    expect(new Set(keyed(out, 'id'))).toEqual(new Set(keyed(events, 'id')));
  });

  it('one encounter: all 1,941 events, not the first 1,000', async () => {
    const big = Array.from({ length: 1941 }, (_, i) => ({ id: 'x' + i, encounter_id: 'big', at: iso(T0 + Math.floor(i / 2) * 1000), kind: 'raid_event', subtype: null, actor: null, label: null }));
    const s = fakeSupabase({ tables: { encounter_events: [...big, ...events] } });
    const out = await loadEncounterEvents(s, 'big');
    expect(out).toHaveLength(1941);
    expect(out.every(r => r.at !== undefined)).toBe(true);
  });

  it('makes no request for no encounters', async () => {
    const s = sb();
    expect(await loadEventsForEncounters(s, [])).toEqual([]);
    expect(s.requests).toHaveLength(0);
  });
});

// ── 6. /raid: active casts ───────────────────────────────────────────────────

describe('loadActiveBuffCasts', () => {
  it('returns every pair when a big raid has more than 1,000 active', async () => {
    const pairs = Array.from({ length: 1450 }, (_, i) => ({ target: 't' + (i % 70), spell_name: 's' + i, dur_ticks: 100, cast_at: iso(T0) }));
    const sb = fakeSupabase({ rpcs: { raid_active_buff_casts: () => pairs } });
    const out = await loadActiveBuffCasts(sb, '2026-09-27T17:00:00.000Z');
    expect(out).toHaveLength(1450);
    expect(sb.requests[0].args).toEqual({ p_guild_id: 'wolfpack', p_since: '2026-09-27T17:00:00.000Z' });
  });
});

// ── 7. /guide ────────────────────────────────────────────────────────────────

describe('loadGuideKillRollup', () => {
  it('maps the rollup to plain numbers (bigint and double columns arrive as strings or floats)', async () => {
    const sb = fakeSupabase({ rpcs: { guide_kill_rollup: () => [{ npc_id: 32020, kills: '41', median_duration_sec: 187.5 }, { npc_id: 5, kills: 3, median_duration_sec: null }] } });
    expect(await loadGuideKillRollup(sb)).toEqual([
      { npc_id: 32020, kills: 41, median_duration_sec: 187.5 },
      { npc_id: 5, kills: 3, median_duration_sec: null },
    ]);
  });
});

describe('loadDropperCounts', () => {
  it('turns the SQL counts into the Map the loot attribution reads', async () => {
    const sb = fakeSupabase({ rpcs: { item_dropper_counts: ({ p_item_ids }) => p_item_ids.map(id => ({ item_id: id, droppers: id === 7 ? 1 : 12 })) } });
    const m = await loadDropperCounts(sb, [7, 8, 9]);
    expect([...m]).toEqual([[7, 1], [8, 12], [9, 12]]);
    expect(sb.requests[0].args).toEqual({ p_item_ids: [7, 8, 9] });
  });

  it('is exact where counting rows is not: 24,108 loot-table rows are 47 answers', async () => {
    // The old read took (item, npc) rows and counted in JS — and got 1,000 of 24,108, so most items
    // looked single-source. The RPC returns one row per item.
    const sb = fakeSupabase({ rpcs: { item_dropper_counts: ({ p_item_ids }) => p_item_ids.map(id => ({ item_id: id, droppers: 500 })) } });
    const ids = Array.from({ length: 47 }, (_, i) => i + 1);
    const m = await loadDropperCounts(sb, ids);
    expect(m.size).toBe(47);
    expect([...m.values()].every(v => v === 500)).toBe(true);
  });

  it('makes no request for no items', async () => {
    const sb = fakeSupabase({ rpcs: { item_dropper_counts: () => [] } });
    expect((await loadDropperCounts(sb, [])).size).toBe(0);
    expect(sb.requests).toHaveLength(0);
  });
});

describe('loadAwardsForItems', () => {
  const awards = Array.from({ length: 1800 }, (_, i) => ({ id: i + 1, item_name: i % 3 === 0 ? 'Sword' : 'Shield', character_name: 'c', dkp: 5 }));
  it('returns every award of the named items past 1,000, once each', async () => {
    const sb = fakeSupabase({ tables: { opendkp_loot: awards } });
    const out = await loadAwardsForItems(sb, ['Sword', 'Shield']);
    expect(out).toHaveLength(1800);
    expect(noDupes(out, 'id')).toBe(true);
    const only = await loadAwardsForItems(sb, ['Sword']);
    expect(only).toHaveLength(600);
    expect(only.every(a => a.item_name === 'Sword')).toBe(true);
  });
});

// ── 8. /parses/[id]: agent versions ──────────────────────────────────────────

describe('loadAgentVersionsAround', () => {
  it('returns the distinct versions the RPC found, so the newest can win', async () => {
    const sb = fakeSupabase({ rpcs: { contribution_agent_versions: () => [{ agent_version: '3.7.74' }, { agent_version: '3.7.78' }, { agent_version: null }] } });
    expect(await loadAgentVersionsAround(sb, '2026-09-20T00:00:00.000Z', '2026-10-04T00:00:00.000Z')).toEqual(['3.7.74', '3.7.78']);
    expect(sb.requests[0].args).toEqual({ p_lo: '2026-09-20T00:00:00.000Z', p_hi: '2026-10-04T00:00:00.000Z' });
  });
});

// ── 9. /db ───────────────────────────────────────────────────────────────────

describe('loadItemDrops', () => {
  // 1,847 droppers of one item (the real maximum), a few with no chance recorded.
  const drops = Array.from({ length: 1847 }, (_, i) => ({ item_id: 5, npc_id: 1000 + i, npc_name: 'n' + i, effective_chance: i % 100 === 0 ? null : (i % 40) + (i % 7) / 10 }));
  const sb = () => fakeSupabase({ tables: { eqemu_npc_drops: [...drops, { item_id: 6, npc_id: 1, npc_name: 'other', effective_chance: 99 }] } });

  it('keeps the BEST 500 of 1,847, best first, no-chance rows last — not an arbitrary 500', async () => {
    const out = await loadItemDrops(sb(), 5);
    expect(out).toHaveLength(500);
    const chances = out.map(r => r.effective_chance);
    for (let i = 1; i < chances.length; i++) expect(chances[i - 1] ?? -1).toBeGreaterThanOrEqual(chances[i] ?? -1);
    const bestPossible = Math.max(...drops.map(d => d.effective_chance ?? -1));
    expect(chances[0]).toBe(bestPossible);
    const sorted = drops.map(d => d.effective_chance).filter(c => c != null).sort((a, b) => b - a);
    expect(chances[499]).toBe(sorted[499]);
  });

  it('asks for that item only', async () => {
    const out = await loadItemDrops(sb(), 6);
    expect(out).toHaveLength(1);
  });
});

describe('loadSpawn2', () => {
  const pts = Array.from({ length: 1150 }, (_, i) => ({ id: i + 1, spawngroup_id: i < 1100 ? 10 : 11, zone_short: 'z', x: i, y: i, z: 0, respawntime: 60 }));
  it('returns every spawn point of the groups, past 300 and past 1,000', async () => {
    const sb = fakeSupabase({ tables: { eqemu_spawn2: pts } });
    const out = await loadSpawn2(sb, [10]);
    expect(out).toHaveLength(1100);
    expect(new Set(out.map(r => r.x)).size).toBe(1100);
  });
  it('makes no request for no groups', async () => {
    const sb = fakeSupabase({ tables: { eqemu_spawn2: pts } });
    expect(await loadSpawn2(sb, [])).toEqual([]);
    expect(sb.requests).toHaveLength(0);
  });
});

// ── 10. /pvp ─────────────────────────────────────────────────────────────────

describe('loadPvpBossKills', () => {
  // killed_at ties are real (one broadcast mirrored per observer); id breaks them. Runs of 37, so the page
  // boundary at 1,000 falls in the middle of one.
  const kills = Array.from({ length: 1300 }, (_, i) => ({ id: i + 1, guild_id: 'wolfpack', boss_id: 'b' + (i % 60), killed_at: iso(T0 + Math.floor(i / 37) * 3600000) }));
  it('returns every kill since the window start, newest first, once each', async () => {
    const sb = fakeSupabase({ tables: { pvp_boss_kills: [...kills, { id: 9999, guild_id: 'other', boss_id: 'x', killed_at: iso(T0) }] } });
    const out = await loadPvpBossKills(sb, iso(T0));
    expect(out).toHaveLength(1300);
    expect(noDupes(out, 'id')).toBe(true);
    for (let i = 1; i < out.length; i++) expect(out[i - 1].killed_at >= out[i].killed_at).toBe(true);
    // the first row seen per boss is its latest kill — the page keeps exactly that row
    const first = new Map(); for (const r of out) if (!first.has(r.boss_id)) first.set(r.boss_id, r.killed_at);
    for (const [boss, at] of first) {
      expect(at).toBe(kills.filter(k => k.boss_id === boss).map(k => k.killed_at).sort().at(-1));
    }
  });
});

// ── The migration ────────────────────────────────────────────────────────────

describe('migration 20261004140700_cap_safe_raid.sql', () => {
  const file = path.join(ROOT, 'supabase', 'migrations', '20261004140700_cap_safe_raid.sql');
  const raw = fs.readFileSync(file, 'utf8');
  const sql = stripSql(raw);
  const NEW_FUNCTIONS = {
    leaderboard_loot_spend: ['p_since', 'p_limit'],
    raid_night_slows: ['p_guild_id', 'p_start', 'p_end', 'p_spells'],
    raid_night_fires: ['p_guild_id', 'p_start', 'p_end', 'p_noise'],
    raid_active_buff_casts: ['p_guild_id', 'p_since'],
    guide_kill_rollup: [],
    item_dropper_counts: ['p_item_ids'],
    contribution_agent_versions: ['p_lo', 'p_hi'],
  };
  const fnBody = (name) => {
    const m = sql.match(new RegExp(`create or replace function public\\.${name}\\(([\\s\\S]*?)\\$\\$([\\s\\S]*?)\\$\\$;`, 'i'));
    if (!m) throw new Error(`function ${name} not found in the migration`);
    return { args: m[1], body: m[2], whole: m[0] };
  };

  it('defines every function with CREATE OR REPLACE (idempotent)', () => {
    for (const n of [...Object.keys(NEW_FUNCTIONS), 'parses_offcard_rollup']) expect(() => fnBody(n)).not.toThrow();
    expect(sql).not.toMatch(/create function/i);
    expect(sql).not.toMatch(/drop function/i);
  });

  it('every function is SECURITY INVOKER, STABLE, with search_path pinned — and none is DEFINER or volatile', () => {
    for (const n of [...Object.keys(NEW_FUNCTIONS), 'parses_offcard_rollup']) {
      const { whole } = fnBody(n);
      expect(whole, n).toMatch(/\bstable\b/i);
      expect(whole, n).toMatch(/security invoker/i);
      expect(whole, n).toMatch(/set search_path = public/i);
      expect(whole, n).not.toMatch(/security definer|\bvolatile\b/i);
    }
  });

  it('grants the new functions to service_role alone', () => {
    for (const [n, args] of Object.entries(NEW_FUNCTIONS)) {
      const sig = new RegExp(`public\\.${n}\\([^)]*\\)`, 'i');
      for (const role of ['public', 'anon', 'authenticated']) {
        expect(sql, `${n} revoke ${role}`).toMatch(new RegExp(`revoke all on function ${sig.source} from ${role};`, 'i'));
      }
      expect(sql, `${n} grant`).toMatch(new RegExp(`grant execute on function ${sig.source} to service_role;`, 'i'));
      expect(sql, n).not.toMatch(new RegExp(`grant execute on function ${sig.source} to (anon|authenticated|public)`, 'i'));
      void args;
    }
  });

  it('every function that can return more than 1,000 rows ends in an ORDER BY over a unique key', () => {
    expect(fnBody('parses_offcard_rollup').body).toMatch(/group by 1, 2, 3\s+order by 1, 2, 3\s*$/i);
    expect(fnBody('raid_night_slows').body).toMatch(/order by b\.cast_at, b\.id\s*$/i);
    expect(fnBody('raid_night_fires').body).toMatch(/order by e\.at, e\.id\s*$/i);
    expect(fnBody('raid_active_buff_casts').body).toMatch(/order by lower\(b\.target\), lower\(b\.spell_name\), b\.cast_at desc, b\.id desc\s*$/i);
    expect(fnBody('item_dropper_counts').body).toMatch(/group by d\.item_id\s+order by d\.item_id\s*$/i);
    expect(fnBody('guide_kill_rollup').body).toMatch(/order by f\.npc_id\s*$/i);
  });

  it('the off-card rollup keeps its signature and its body (only the ORDER BY is new)', () => {
    const prev = stripSql(fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20260821013000_offcard_rollup_raid_split.sql'), 'utf8'));
    const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const body = (s) => norm(s.match(/\$\$([\s\S]*?)\$\$/)[1]);
    expect(body(fnBody('parses_offcard_rollup').whole)).toBe(body(prev.match(/create function parses_offcard_rollup[\s\S]*?\$\$;/i)[0]) + ' order by 1, 2, 3');
    expect(norm(fnBody('parses_offcard_rollup').args)).toContain('returns table(day date, zone_short text, is_raid boolean, kills bigint, total_damage bigint)');
  });

  it('SLOW_SPELLS and FIRE_NOISE stay in TypeScript: the SQL takes them as arguments', () => {
    expect(stripSql(raw)).not.toMatch(/'drowsy'|'walking sleep'|'too far'|'spell interrupted'/i);
  });

  it('indexes contributions.created_at for the agent-version window (index-only, INCLUDE agent_version)', () => {
    expect(sql).toMatch(/create index if not exists contributions_created_at_agent_idx\s+on public\.contributions \(created_at\) include \(agent_version\);/i);
  });

  it('the RPC argument names fullReads.ts sends are the ones the SQL declares', () => {
    const ts = stripJs(fs.readFileSync(path.join(ROOT, 'web', 'lib', 'fullReads.ts'), 'utf8'));
    const calls = [...ts.matchAll(/\.rpc\('(\w+)'(?:,\s*\{([^}]*)\})?/g)];
    expect(calls.length).toBeGreaterThanOrEqual(8);
    for (const [, name, argText] of calls) {
      const sent = [...(argText || '').matchAll(/\b(p_\w+)\s*:/g)].map(m => m[1]);
      if (name === 'parses_offcard_rollup') { expect(sent).toEqual(['p_since']); continue; }
      expect(Object.keys(NEW_FUNCTIONS), `${name} is not in the migration`).toContain(name);
      expect(sent, name).toEqual(NEW_FUNCTIONS[name]);
      const declared = [...fnBody(name).args.matchAll(/\b(p_\w+)\s+[a-z]/gi)].map(m => m[1]);
      expect(declared, name).toEqual(NEW_FUNCTIONS[name]);
    }
  });
});

// ── The pages use the loaders (and the cap-delusions are gone) ───────────────

describe('the pages read through the loaders', () => {
  const page = (rel) => stripJs(fs.readFileSync(path.join(ROOT, 'web', 'app', rel), 'utf8'));

  it('/parses', () => {
    const s = page('parses/page.tsx');
    expect(s).toMatch(/loadOffcardRollup\(sb, w\.sinceIso\)/);
    expect(s).toMatch(/loadLootRecent<LootDbRow>\(/);
    expect(s).toMatch(/loadTicksForRaids\(sb, /);
    expect(s).not.toMatch(/\.range\(0, 99999\)/);
    expect(s).not.toMatch(/from\('opendkp_ticks'\)|from\('opendkp_loot_recent'\)|rpc\('parses_offcard_rollup'/);
  });

  it('/leaderboards', () => {
    const s = page('leaderboards/page.tsx');
    expect(s).toMatch(/loadLootSpend\(sb, /);
    expect(s).not.toMatch(/from\('opendkp_loot_recent'\)/);
  });

  it('/raid/review', () => {
    const s = page('raid/review/page.tsx');
    expect(s).toMatch(/loadReviewEncounters<EncRow>\(sb, curated, sinceIso\)/);
    expect(s).toMatch(/loadLootRecent</);
    expect(s).not.toMatch(/ROW_LIMIT|from\('opendkp_loot_recent'\)|from\('encounters'\)/);
  });

  it('/raid/review/[date] reads the day-wide streams over the fight span, in SQL', () => {
    const s = page('raid/review/[date]/page.tsx');
    expect(s).toMatch(/loadNightSlows\(sb, streamWin, \[\.\.\.SLOW_SPELLS\]\)/);
    expect(s).toMatch(/loadNightFires\(sb, streamWin, \[\.\.\.FIRE_NOISE\]\)/);
    expect(s).toMatch(/loadEventsForEncounters<EncEventRow>\(sb, encIds\)/);
    expect(s).not.toMatch(/from\('buff_casts'\)/);
    expect(s).not.toMatch(/\.limit\((5000|3000|6000)\)/);
    const decl = s.search(/^const FIRE_NOISE\s*=/m);       // module scope: column 0
    expect(decl, 'FIRE_NOISE must be declared at module scope so load() can send it to SQL').toBeGreaterThan(-1);
    expect(decl).toBeLessThan(s.indexOf('async function load('));
  });

  it('/raid', () => {
    const s = page('raid/page.tsx');
    expect(s).toMatch(/loadActiveBuffCasts\(admin, buffCastsSince\)/);
    expect(s).not.toMatch(/from\('buff_casts'\)/);
  });

  it('/guide', () => {
    const s = page('guide/page.tsx');
    expect(s).toMatch(/loadGuideKillRollup\(sb\)/);
    expect(s).toMatch(/from\('bosses_local'\)\.select\('npc_id, internal_id, strat_notes'\)\.eq\('auto_registered', false\)/);
    expect(s).not.toMatch(/\.limit\(20000\)/);
  });

  it('/guide/[bossId]', () => {
    const s = page('guide/[bossId]/page.tsx');
    expect(s).toMatch(/loadDropperCounts\(sb, ids\)/);
    expect(s).toMatch(/loadAwardsForItems\(sb, /);
    expect(s).not.toMatch(/\.limit\((5000|3000)\)/);
  });

  it('/parses/[id]', () => {
    const s = page('parses/[id]/page.tsx');
    expect(s).toMatch(/loadEncounterEvents<TimelineEventRow>\(sb, id\)/);
    expect(s).toMatch(/loadAgentVersionsAround\(sb, lo, hi\)/);
    expect(s).not.toMatch(/\.range\(0, 9999\)/);
  });

  it('/db/item/[id]', () => {
    const s = page('db/item/[id]/page.tsx');
    expect(s).toMatch(/loadItemDrops\(sb, itemId\)/);
    expect(s).toMatch(/loadDropperCounts\(sb, \[itemId\]\)/);
    expect(s).not.toMatch(/from\('eqemu_npc_drops'\)/);
  });

  it('/db/npc/[id]', () => {
    const s = page('db/npc/[id]/page.tsx');
    expect(s).toMatch(/loadSpawn2</);
    expect(s).not.toMatch(/from\('eqemu_spawn2'\)/);
  });

  it('/pvp', () => {
    const s = page('pvp/page.tsx');
    expect(s).toMatch(/loadPvpBossKills<BossKill>\(sb, since\)/);
    expect(s).not.toMatch(/from\('pvp_boss_kills'\)/);
  });
});
