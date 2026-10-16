// POST /api/agent/map-watch — the Mimic Spawn map's guild-shared ★ watches (the guild lead, 2026-10-16, "A — Watch a spot").
//
// Two halves. utils/mapWatch.js is pure and runs for real. The route lives in the bot monolith, so it is checked as
// TEXT with comments stripped (stripJs): the route is registered behind the budget gate and the map-sync GET reply
// carries `watches`. No migration: watches are bot_kv rows, so the test also pins the key shape.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, stripJs, BOT_INDEX } from './_source-slice.js';

const nodeRequire = createRequire(BOT_INDEX);
const { validateWatch, applyWatch, liveWatches, WATCH_TTL_MS, MAX_WATCHES } = nodeRequire('./utils/mapWatch');

const NOW = Date.UTC(2026, 9, 16, 20, 0, 0);
const HOUR = 60 * 60 * 1000;
const H = 'pq.projectquarm.pq3.projectquarm.com';
const body = (over = {}) => ({ zone: 'soldungb', point_id: 42, named: 'The Avatar of Anguish', on: true, character: 'Aldenmar', ...over });
const w = (over = {}) => validateWatch(body(over), NOW);

describe('validateWatch', () => {
  it('accepts a good body and normalises it', () => {
    expect(w()).toEqual({ zone: 'soldungb', point_id: 42, named: 'The Avatar of Anguish', on: true, inst: null, character: 'Aldenmar' });
  });

  it('keeps a well-formed zone copy and nulls a malformed one without an error', () => {
    expect(w({ inst: H + ':7312' }).inst).toBe(H + ':7312');
    for (const inst of [H, 'a b:1', 7312, 'x'.repeat(101) + ':1']) {
      const r = w({ inst });
      expect(r.error).toBeUndefined();
      expect(r.inst).toBeNull();
    }
  });

  it('cleans and caps the named text', () => {
    expect(w({ named: '  A construct\u0000 of anguish ' }).named).toBe('A construct  of anguish');
    expect(w({ named: 'x'.repeat(200) }).named).toHaveLength(64);
  });

  it('requires a named when turning a watch on, but not when turning one off', () => {
    for (const named of [undefined, null, '', '   ', 7]) expect(w({ named }).error).toBe('named required');
    const off = w({ on: false, named: undefined });
    expect(off.error).toBeUndefined();
    expect(off.named).toBeNull();
    expect(off.on).toBe(false);
  });

  it('rejects a bad body, zone, point_id, on flag or character', () => {
    expect(validateWatch(null, NOW).error).toBeTruthy();
    expect(validateWatch([], NOW).error).toBeTruthy();
    for (const zone of [undefined, 'A', 'Has Space', '../x', 'x'.repeat(33), 5]) expect(w({ zone }).error).toBe('invalid zone');
    for (const point_id of [undefined, -1, 1.5, '42', 2147483648, null]) expect(w({ point_id }).error).toBe('invalid point_id');
    expect(w({ point_id: 0 }).error).toBeUndefined();
    expect(w({ point_id: 2147483647 }).error).toBeUndefined();
    for (const on of [undefined, 'true', 1, null]) expect(w({ on }).error).toBe('on must be a boolean');
    for (const character of [undefined, '', '  ', 5]) expect(w({ character }).error).toBe('character required');
  });
});

describe('applyWatch', () => {
  const on = (over = {}) => w(over);

  it('on adds an entry shaped { point_id, named, inst, by, at }', () => {
    expect(applyWatch([], on(), NOW)).toEqual([
      { point_id: 42, named: 'The Avatar of Anguish', inst: null, by: 'Aldenmar', at: NOW },
    ]);
  });

  it('on again upserts the same point instead of duplicating it', () => {
    const a = applyWatch([], on(), NOW);
    const b = applyWatch(a, on({ character: 'Brackwyn', named: 'Another Named' }), NOW + 1000);
    expect(b).toEqual([{ point_id: 42, named: 'Another Named', inst: null, by: 'Brackwyn', at: NOW + 1000 }]);
  });

  it('off removes that point and leaves the others', () => {
    let l = applyWatch([], on(), NOW);
    l = applyWatch(l, on({ point_id: 43 }), NOW + 1);
    l = applyWatch(l, on({ on: false }), NOW + 2);
    expect(l.map(e => e.point_id)).toEqual([43]);
  });

  it('off for a point that is not watched is a no-op', () => {
    const l = applyWatch([], on(), NOW);
    expect(applyWatch(l, on({ on: false, point_id: 99 }), NOW + 1)).toEqual(l);
  });

  it('keeps the same point on two zone copies as two watches, and off touches only its own copy', () => {
    let l = applyWatch([], on({ inst: H + ':7001' }), NOW);
    l = applyWatch(l, on({ inst: H + ':7002' }), NOW + 1);
    l = applyWatch(l, on(), NOW + 2);                                  // no inst: a third, separate watch
    expect(l.map(e => e.inst)).toEqual([H + ':7001', H + ':7002', null]);
    l = applyWatch(l, on({ on: false, inst: H + ':7001' }), NOW + 3);
    expect(l.map(e => e.inst)).toEqual([H + ':7002', null]);
  });

  it('drops entries older than 12 hours on the next write, and liveWatches hides them on read', () => {
    const old = { point_id: 1, named: 'Old', inst: null, by: 'Zarrin', at: NOW - WATCH_TTL_MS - 1 };
    const fresh = { point_id: 2, named: 'Fresh', inst: null, by: 'Zarrin', at: NOW - WATCH_TTL_MS + 1000 };
    expect(liveWatches([old, fresh], NOW)).toEqual([fresh]);
    expect(applyWatch([old, fresh], on({ point_id: 3 }), NOW).map(e => e.point_id)).toEqual([2, 3]);
    expect(WATCH_TTL_MS).toBe(12 * HOUR);
  });

  it('caps a zone at 40, keeping the newest', () => {
    let l = [];
    for (let i = 0; i < MAX_WATCHES + 5; i++) l = applyWatch(l, on({ point_id: i }), NOW + i);
    expect(MAX_WATCHES).toBe(40);
    expect(l).toHaveLength(40);
    expect(l[0].point_id).toBe(5);
    expect(l[39].point_id).toBe(44);
  });

  it('tolerates a missing or garbled stored list', () => {
    expect(liveWatches(undefined, NOW)).toEqual([]);
    expect(liveWatches({ watches: [] }, NOW)).toEqual([]);
    expect(liveWatches([null, 'x', { point_id: 1 }, { point_id: 2, at: 'soon' }], NOW)).toEqual([]);
    expect(applyWatch(null, on(), NOW)).toHaveLength(1);
  });
});

describe('the map-watch route (source text, comments stripped)', () => {
  const SRC = stripJs(readSource(BOT_INDEX));

  it('POST /api/agent/map-watch is routed behind the map_sync budget gate', () => {
    expect(SRC).toMatch(/req\.method === 'POST' && req\.url\.split\('\?'\)\[0\] === '\/api\/agent\/map-watch'/);
    const at = SRC.indexOf("'/api/agent/map-watch'");
    expect(SRC.slice(at, at + 200)).toMatch(/_overBudget\('map_sync', req, res\)/);
    expect(SRC.slice(at, at + 400)).toMatch(/_handleAgentMapWatch\(req, res\)/);
  });

  it('the handler stores per-zone bot_kv rows and clears the read cache', () => {
    const start = SRC.indexOf('async function _handleAgentMapWatch');
    const body = SRC.slice(start, SRC.indexOf('\n}\n', start));
    expect(body).toMatch(/supabase\.upsert\('bot_kv'/);
    expect(body).toContain("'map_watch:' + w.zone");
    expect(body).toContain('_mapWatchCache.delete(w.zone)');
    expect(body).toMatch(/validateWatch\(body, now\)/);
  });

  it('the map-sync GET reply carries watches, read fail-soft', () => {
    const start = SRC.indexOf('async function _handleAgentMapSyncGet');
    const get = SRC.slice(start, SRC.indexOf('\n}\n', start));
    expect(get).toMatch(/out\.watches = require\('\.\/utils\/mapWatch'\)\.liveWatches\(await _mapWatchList\(zone\)\.catch\(\(\) => null\), now\)/);
  });
});
