// POST/GET /api/agent/map-sync — the Mimic Spawn map's synced spawn-point events.
// The guild lead, 2026-10-12: "need the tab targetting to set the specific mob in a synced way on the
// map once it's certain".
//
// Two halves. The validator (utils/mapSync.js) is pure and runs for real. The routes live in the bot
// monolith, so they are checked as TEXT with comments stripped (stripJs): the GET read names its columns
// and a limit, the budget entry exists, and both verbs are routed behind the budget gate.
//
// Mutation-checked (2026-10-12): zone regex loosened, MAX_EVENTS dropped, the future / age bounds removed,
// the kind whitelist emptied, `select=*` swapped in for the column list, `limit=` removed, the budget row
// and the route removed — each turns at least one test red.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, stripJs, stripSql, BOT_INDEX, ROOT } from './_source-slice.js';
import path from 'node:path';

const nodeRequire = createRequire(BOT_INDEX);
const { validateEvents, MAX_EVENTS } = nodeRequire('./utils/mapSync');

const NOW = Date.UTC(2026, 9, 12, 20, 0, 0);
const ev = (over = {}) => ({ point_id: 17, kind: 'died', spawn_id: 4321, name: 'a gnoll pup', at: NOW - 1000, ...over });
const body = (events, over = {}) => ({ zone: 'lavastorm', character: 'Aldenmar', events, ...over });

describe('validateEvents', () => {
  it('accepts a good batch and normalises it', () => {
    const r = validateEvents(body([ev(), ev({ kind: 'seen', spawn_id: null, name: null })]), NOW);
    expect(r.error).toBeUndefined();
    expect(r.zone).toBe('lavastorm');
    expect(r.character).toBe('Aldenmar');
    expect(r.events).toEqual([
      { point_id: 17, kind: 'died', spawn_id: 4321, name: 'a gnoll pup', at: NOW - 1000, inst: null },
      { point_id: 17, kind: 'seen', spawn_id: null, name: null, at: NOW - 1000, inst: null },
    ]);
  });

  it('keeps a well-formed zone copy (host:port) and nulls a malformed one without dropping the event', () => {
    const H = 'pq.projectquarm.pq3.projectquarm.com';
    const r = validateEvents(body([ev({ inst: H + ':7312' }), ev({ inst: H }), ev({ inst: 'a b:1' }), ev({ inst: 7312 }),
      ev({ inst: 'x'.repeat(101) + ':1' })]), NOW);
    expect(r.events.map(e => e.inst)).toEqual([H + ':7312', null, null, null, null]);
  });

  it('accepts all five kinds', () => {
    const r = validateEvents(body(['seen', 'died', 'empty', 'up', 'clear'].map(kind => ev({ kind }))), NOW);
    expect(r.events.map(e => e.kind)).toEqual(['seen', 'died', 'empty', 'up', 'clear']);
  });

  it.each(['', 'Lava', 'lava storm', 'a', 'x'.repeat(33), 'lava-storm', 42, null])('rejects zone %j', (zone) => {
    expect(validateEvents(body([ev()], { zone }), NOW).error).toBeTruthy();
  });

  it('rejects a body that is not an object, or has no events array, or no character', () => {
    expect(validateEvents(null, NOW).error).toBeTruthy();
    expect(validateEvents([], NOW).error).toBeTruthy();
    expect(validateEvents(body('nope'), NOW).error).toBeTruthy();
    expect(validateEvents(body([ev()], { character: '  ' }), NOW).error).toBeTruthy();
  });

  it('drops an unknown kind and keeps the rest of the batch', () => {
    const r = validateEvents(body([ev({ kind: 'exploded' }), ev({ point_id: 18 })]), NOW);
    expect(r.error).toBeUndefined();
    expect(r.events.map(e => e.point_id)).toEqual([18]);
    expect(r.dropped).toBe(1);
  });

  it('drops a non-integer or out-of-range point_id', () => {
    const r = validateEvents(body([ev({ point_id: 1.5 }), ev({ point_id: '7' }), ev({ point_id: null }),
      ev({ point_id: -1 }), ev({ point_id: 2 ** 31 }), ev({ point_id: 9 })]), NOW);
    expect(r.events.map(e => e.point_id)).toEqual([9]);
  });

  it('drops an event more than 10 minutes in the future, keeps one just inside', () => {
    const r = validateEvents(body([ev({ at: NOW + 10 * 60 * 1000 + 1, point_id: 1 }), ev({ at: NOW + 10 * 60 * 1000, point_id: 2 })]), NOW);
    expect(r.events.map(e => e.point_id)).toEqual([2]);
  });

  it('drops an event older than 24 h, keeps one just inside', () => {
    const day = 24 * 60 * 60 * 1000;
    const r = validateEvents(body([ev({ at: NOW - day - 1, point_id: 1 }), ev({ at: NOW - day, point_id: 2 })]), NOW);
    expect(r.events.map(e => e.point_id)).toEqual([2]);
  });

  it('drops an event whose at is not a number', () => {
    const r = validateEvents(body([ev({ at: '1760299200000' }), ev({ at: NaN }), ev({ at: null }), ev({ point_id: 3 })]), NOW);
    expect(r.events.map(e => e.point_id)).toEqual([3]);
  });

  it('rejects more than 50 events (a 400, not a silent cap) and allows exactly 50', () => {
    expect(MAX_EVENTS).toBe(50);
    expect(validateEvents(body(Array.from({ length: 51 }, () => ev())), NOW).error).toMatch(/too many/);
    expect(validateEvents(body(Array.from({ length: 50 }, () => ev())), NOW).events).toHaveLength(50);
  });

  it('treats spawn id 0 and non-integers as no target, and trims the name', () => {
    const r = validateEvents(body([ev({ spawn_id: 0, name: '  a gnoll pup  ' }), ev({ spawn_id: 'x', name: 5 })]), NOW);
    expect(r.events.map(e => e.spawn_id)).toEqual([null, null]);
    expect(r.events.map(e => e.name)).toEqual(['a gnoll pup', null]);
  });
});

describe('the map-sync routes (source text, comments stripped)', () => {
  const SRC = stripJs(readSource(BOT_INDEX));
  const getHandler = SRC.slice(SRC.indexOf('async function _handleAgentMapSyncGet'), SRC.indexOf('async function _handleAgentMapSyncGet') + 2500);

  it('the GET read lists explicit columns and carries a limit', () => {
    expect(SRC).toContain('async function _handleAgentMapSyncGet');
    const m = /supabase\.select\('map_spawn_events'[\s\S]*?\)\.catch/.exec(getHandler);
    expect(m).not.toBeNull();
    expect(m[0]).toContain('&select=id,point_id,kind,spawn_id,npc_name,at,by_character,inst&');
    expect(m[0]).not.toMatch(/select=\*/);
    expect(m[0]).toMatch(/&limit=\$\{_MAP_SYNC_LIMIT\}/);
    expect(SRC).toMatch(/const _MAP_SYNC_LIMIT = 500;/);
  });

  it('both verbs are routed on /api/agent/map-sync behind the map_sync budget gate', () => {
    expect(SRC).toMatch(/req\.url\.split\('\?'\)\[0\] === '\/api\/agent\/map-sync'/);
    expect(SRC).toMatch(/_overBudget\('map_sync', req, res\)/);
    expect(SRC).toMatch(/\? _handleAgentMapSyncPost : _handleAgentMapSyncGet/);
  });

  it('map_sync has an ephemeral budget row', () => {
    expect(SRC).toMatch(/map_sync:\s+\{ perMin: 60,\s+durable: false, get: true \}/);
  });

  it('a push clears that zone from the 3 s cache and prunes its rows past 24 h', () => {
    const post = SRC.slice(SRC.indexOf('async function _handleAgentMapSyncPost'), SRC.indexOf('async function _handleAgentMapSyncGet'));
    expect(post).toContain('_mapSyncCache.delete(v.zone)');
    expect(post).toMatch(/supabase\.del\('map_spawn_events'/);
    expect(post).toMatch(/at=lt\./);
  });
});

describe('the migration', () => {
  const sql = stripSql(readSource(path.join(ROOT, 'supabase', 'migrations', '20261012180000_map_spawn_events.sql')));
  it('is idempotent, locked to the service role, and indexed on (zone, at)', () => {
    expect(sql).toMatch(/create table if not exists public\.map_spawn_events/);
    expect(sql).toMatch(/create index if not exists \w+\s+on public\.map_spawn_events \(zone, at\)/);
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/revoke all on public\.map_spawn_events from anon, authenticated/);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toMatch(/'seen', 'died', 'empty', 'up', 'clear'/);
  });
  it('the zone-copy column is added idempotently, and the push stores it', () => {
    const add = stripSql(readSource(path.join(ROOT, 'supabase', 'migrations', '20261013013000_map_spawn_events_inst.sql')));
    expect(add).toMatch(/alter table public\.map_spawn_events add column if not exists inst text;/);
    expect(stripJs(readSource(BOT_INDEX))).toMatch(/by_discord_id: String\(identity\.discord_id\), inst: e\.inst,/);
  });
});
