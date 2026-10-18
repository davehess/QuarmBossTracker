// POST /api/agent/map-corpse — corpses on the Mimic Spawn map (the guild lead, 2026-10-17).
//
// Two halves. utils/mapCorpses.js is pure and runs for real. The route lives in the bot monolith, so it is checked as
// TEXT with comments stripped (stripJs): the route is registered behind the map_sync budget gate and the map-sync GET
// reply carries `corpses`. No migration: corpses are bot_kv rows, so the test also pins the key shape.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, stripJs, BOT_INDEX } from './_source-slice.js';

const nodeRequire = createRequire(BOT_INDEX);
const { validateCorpseEvents, applyCorpseEvents, liveCorpses, CORPSE_TTL_MS, MAX_CORPSES, MAX_EVENTS } = nodeRequire('./utils/mapCorpses');

const NOW = Date.UTC(2026, 9, 17, 20, 0, 0);
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const H = 'pq.projectquarm.pq3.projectquarm.com';
const ev = (over = {}) => ({ kind: 'died', corpse: 'Brackwyn', x: 10, y: -20, z: 3.5, at: NOW, ...over });
const body = (events = [ev()], over = {}) => ({ zone: 'soldungb', character: 'Aldenmar', events, ...over });
const val = (events, over) => validateCorpseEvents(body(events, over), NOW);
// Validate then apply in one go, as the route does.
const run = (list, events, over) => applyCorpseEvents(list, val(events, over), NOW + 1);

describe('validateCorpseEvents', () => {
  it('accepts a good body and normalises it', () => {
    expect(val()).toEqual({
      zone: 'soldungb', inst: null, character: 'Aldenmar', dropped: 0,
      events: [{ kind: 'died', corpse: 'Brackwyn', at: NOW, x: 10, y: -20, z: 3.5, dragger: null }],
    });
  });

  it('capitalises the corpse name so case does not split a corpse', () => {
    expect(val([ev({ corpse: 'bRACKWYN' })]).events[0].corpse).toBe('Brackwyn');
  });

  it('keeps a well-formed zone copy and nulls a malformed one without an error', () => {
    expect(val(undefined, { inst: H + ':7312' }).inst).toBe(H + ':7312');
    for (const inst of [H, 'a b:1', 7312]) {
      const r = val(undefined, { inst });
      expect(r.error).toBeUndefined();
      expect(r.inst).toBeNull();
    }
  });

  it('rejects a bad body, zone, character or events list', () => {
    expect(validateCorpseEvents(null, NOW).error).toBeTruthy();
    expect(validateCorpseEvents([], NOW).error).toBeTruthy();
    for (const zone of [undefined, 'A', 'Has Space', '../x', 'x'.repeat(33), 5]) expect(val(undefined, { zone }).error).toBe('invalid zone');
    for (const character of [undefined, '', '  ', 5]) expect(val(undefined, { character }).error).toBe('character required');
    for (const events of [undefined, null, {}, 'x']) expect(val(undefined, { events }).error).toBe('events must be an array');
  });

  it('rejects more than 20 events but accepts exactly 20', () => {
    expect(MAX_EVENTS).toBe(20);
    expect(val(Array.from({ length: 21 }, () => ev())).error).toMatch(/too many events/);
    expect(val(Array.from({ length: 20 }, () => ev())).error).toBeUndefined();
  });

  it('drops a bad corpse name without failing the batch', () => {
    const names = [undefined, '', 'A', 'x'.repeat(33), 'Has Space', "Bra'ckwyn", 'Bra2kwyn', 'Brack_wyn', 7];
    const r = val([...names.map(corpse => ev({ corpse })), ev({ corpse: 'Zarrin' })]);
    expect(r.error).toBeUndefined();
    expect(r.events.map(e => e.corpse)).toEqual(['Zarrin']);
    expect(r.dropped).toBe(names.length);
  });

  it('drops an unknown kind, bad coordinates and a bad clock', () => {
    const bad = [
      ev({ kind: 'looted' }), ev({ kind: undefined }), ev({ kind: 5 }),
      ev({ x: undefined }), ev({ y: '5' }), ev({ z: null }), ev({ x: NaN }), ev({ y: Infinity }),
      ev({ x: 100000 }), ev({ z: -100000 }),
      ev({ at: undefined }), ev({ at: '1' }), ev({ at: NOW + 10 * MIN + 1 }), ev({ at: NOW - 24 * HOUR - 1 }),
      null, 'x', [],
    ];
    const r = val([...bad, ev({ x: 99999.5, z: -99999 }), ev({ at: NOW + 10 * MIN }), ev({ at: NOW - 24 * HOUR })]);
    expect(r.events).toHaveLength(3);
    expect(r.dropped).toBe(bad.length);
  });

  it('a gone event needs no position; every other kind does', () => {
    const r = val([{ kind: 'gone', corpse: 'Brackwyn', at: NOW }, ev({ kind: 'seen', x: undefined })]);
    expect(r.events).toEqual([{ kind: 'gone', corpse: 'Brackwyn', at: NOW, x: null, y: null, z: null, dragger: null }]);
  });

  it('only drag_start and drag_move carry a dragger: the event\'s own valid name, else the reporter', () => {
    const r = val([
      ev({ kind: 'drag_start' }),
      ev({ kind: 'drag_move', dragger: 'Corvale' }),
      ev({ kind: 'drag_move', dragger: 'Bad Name' }),
      ev({ kind: 'drag_stop', dragger: 'Corvale' }),
      ev({ kind: 'summoned', dragger: 'Corvale' }),
      ev({ kind: 'seen', dragger: 'Corvale' }),
    ]);
    expect(r.events.map(e => e.dragger)).toEqual(['Aldenmar', 'Corvale', 'Aldenmar', null, null, null]);
  });
});

describe('applyCorpseEvents', () => {
  it('died creates a record shaped { corpse, inst, x, y, z, died_at, updated_at, dragger, by }', () => {
    expect(run([], [ev()])).toEqual([
      { corpse: 'Brackwyn', inst: null, x: 10, y: -20, z: 3.5, died_at: NOW, updated_at: NOW, dragger: null, by: 'Aldenmar' },
    ]);
  });

  it('a second died for the same corpse replaces it and clears the dragger', () => {
    let l = run([], [ev(), ev({ kind: 'drag_start', at: NOW + 1000 })]);
    expect(l[0].dragger).toBe('Aldenmar');
    l = run(l, [ev({ at: NOW + 5000, x: 1, y: 2, z: 3 })], { character: 'Corvale' });
    expect(l).toEqual([{ corpse: 'Brackwyn', inst: null, x: 1, y: 2, z: 3, died_at: NOW + 5000, updated_at: NOW + 5000, dragger: null, by: 'Corvale' }]);
  });

  it('a late duplicate died report does not undo a drag that came after the death', () => {
    let l = run([], [ev({ kind: 'drag_move', at: NOW + 9000, x: 50, y: 60, z: 7 })]);
    l = run(l, [ev({ at: NOW })], { character: 'Corvale' });
    expect(l[0]).toMatchObject({ x: 50, y: 60, z: 7, dragger: 'Aldenmar' });
  });

  it('seen moves the corpse to the exact spot and leaves the dragger alone', () => {
    let l = run([], [ev(), ev({ kind: 'drag_start', at: NOW + 1000 })]);
    l = run(l, [ev({ kind: 'seen', at: NOW + 2000, x: 77, y: 88, z: 9 })], { character: 'Corvale' });
    expect(l).toEqual([{ corpse: 'Brackwyn', inst: null, x: 77, y: 88, z: 9, died_at: NOW, updated_at: NOW + 2000, dragger: 'Aldenmar', by: 'Corvale' }]);
  });

  it('drag_start and drag_move set the dragger and follow them', () => {
    let l = run([], [ev(), ev({ kind: 'drag_start', at: NOW + 1000, x: 11 }), ev({ kind: 'drag_move', at: NOW + 2000, x: 12 })]);
    expect(l[0]).toMatchObject({ x: 12, dragger: 'Aldenmar', updated_at: NOW + 2000, died_at: NOW });
    l = run(l, [ev({ kind: 'drag_move', at: NOW + 3000, x: 13, dragger: 'Corvale' })], { character: 'Corvale' });
    expect(l[0]).toMatchObject({ x: 13, dragger: 'Corvale', by: 'Corvale' });
  });

  it('drag_stop and summoned move the corpse and clear the dragger', () => {
    for (const kind of ['drag_stop', 'summoned']) {
      let l = run([], [ev(), ev({ kind: 'drag_start', at: NOW + 1000 })]);
      expect(l[0].dragger).toBe('Aldenmar');
      l = run(l, [ev({ kind, at: NOW + 2000, x: 300, y: 400, z: 5 })]);
      expect(l[0]).toMatchObject({ x: 300, y: 400, z: 5, dragger: null, updated_at: NOW + 2000, died_at: NOW });
    }
  });

  it('moves apply only if at >= updated_at, whatever order they arrive in', () => {
    let l = run([], [ev({ kind: 'seen', at: NOW + 5000, x: 5 })]);
    l = run(l, [ev({ kind: 'seen', at: NOW + 1000, x: 1 })]);                 // older: ignored
    expect(l[0].x).toBe(5);
    l = run(l, [ev({ kind: 'seen', at: NOW + 5000, x: 6 })]);                 // equal: applied
    expect(l[0].x).toBe(6);
    l = run(l, [ev({ kind: 'drag_stop', at: NOW + 4000, x: 4 }), ev({ kind: 'drag_start', at: NOW + 7000, x: 7 })]);
    expect(l[0]).toMatchObject({ x: 7, dragger: 'Aldenmar' });                // one batch is applied oldest first
  });

  it('a batch listed out of order lands as if in order', () => {
    const l = run([], [ev({ kind: 'drag_stop', at: NOW + 3000, x: 3 }), ev({ kind: 'drag_start', at: NOW + 1000, x: 1 }), ev({ at: NOW })]);
    expect(l[0]).toMatchObject({ x: 3, dragger: null, died_at: NOW, updated_at: NOW + 3000 });
  });

  it('seen / summoned / drag_* for an unknown corpse create it with died_at null', () => {
    for (const kind of ['seen', 'summoned', 'drag_start', 'drag_move', 'drag_stop']) {
      const l = run([], [ev({ kind })]);
      expect(l).toHaveLength(1);
      expect(l[0].died_at).toBeNull();
      expect(l[0].dragger).toBe(kind === 'drag_start' || kind === 'drag_move' ? 'Aldenmar' : null);
    }
  });

  it('gone removes the corpse and leaves the others; for an unknown corpse it is a no-op', () => {
    let l = run([], [ev(), ev({ corpse: 'Zarrin' })]);
    l = run(l, [{ kind: 'gone', corpse: 'Brackwyn', at: NOW + 1000 }]);
    expect(l.map(c => c.corpse)).toEqual(['Zarrin']);
    expect(run(l, [{ kind: 'gone', corpse: 'Nobody', at: NOW + 1000 }])).toEqual(l);
  });

  it('a gone that predates the corpse\'s death is about an earlier corpse and is ignored', () => {
    let l = run([], [ev({ at: NOW })]);
    l = run(l, [{ kind: 'gone', corpse: 'Brackwyn', at: NOW - 1000 }]);
    expect(l).toHaveLength(1);
  });

  it('keeps one corpse per (name, inst): the same name on two zone copies is two corpses', () => {
    let l = run([], [ev()], { inst: H + ':7001' });
    l = run(l, [ev({ x: 99 })], { inst: H + ':7002' });
    l = run(l, [ev({ x: 98 })]);                                              // no inst: a third
    expect(l.map(c => [c.inst, c.x])).toEqual([[H + ':7001', 10], [H + ':7002', 99], [null, 98]]);
    l = run(l, [{ kind: 'gone', corpse: 'Brackwyn', at: NOW + 1000 }], { inst: H + ':7001' });
    expect(l.map(c => c.inst)).toEqual([H + ':7002', null]);
  });

  it('drops a corpse 24 h after its last update, on write and on read', () => {
    const old = { corpse: 'Oldcorpse', inst: null, x: 1, y: 2, z: 3, died_at: NOW - 30 * HOUR, updated_at: NOW - CORPSE_TTL_MS - 1, dragger: null, by: 'Zarrin' };
    const fresh = { ...old, corpse: 'Freshcorpse', updated_at: NOW - CORPSE_TTL_MS + 1000 };
    expect(CORPSE_TTL_MS).toBe(24 * HOUR);
    expect(liveCorpses([old, fresh], NOW).map(c => c.corpse)).toEqual(['Freshcorpse']);
    expect(run([old, fresh], [ev()]).map(c => c.corpse)).toEqual(['Freshcorpse', 'Brackwyn']);
  });

  it('a move refreshes the 24 h clock', () => {
    const nearly = { corpse: 'Brackwyn', inst: null, x: 1, y: 2, z: 3, died_at: NOW - 23 * HOUR, updated_at: NOW - 23 * HOUR, dragger: null, by: 'Zarrin' };
    const l = applyCorpseEvents([nearly], val([ev({ kind: 'seen', at: NOW })]), NOW + 1);
    expect(l).toHaveLength(1);
    expect(l[0].died_at).toBe(NOW - 23 * HOUR);
    expect(liveCorpses(l, NOW + 23 * HOUR)).toHaveLength(1);
    expect(liveCorpses([nearly], NOW + 23 * HOUR)).toHaveLength(0);
  });

  it('caps a zone at 60, keeping the newest', () => {
    const name = (i) => 'Corpse' + String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26));
    let l = [];
    for (let i = 0; i < MAX_CORPSES + 5; i++) l = run(l, [ev({ corpse: name(i), at: NOW + i })]);
    expect(MAX_CORPSES).toBe(60);
    expect(l).toHaveLength(60);
    expect(l[0].corpse).toBe('Corpse' + 'a' + 'f');   // index 5
    expect(l[59].corpse).toBe(name(64));
  });

  it('tolerates a missing or garbled stored list', () => {
    expect(liveCorpses(undefined, NOW)).toEqual([]);
    expect(liveCorpses({ corpses: [] }, NOW)).toEqual([]);
    expect(liveCorpses([null, 'x', { corpse: 'Brackwyn' }, { corpse: 'Brackwyn', updated_at: 'soon' },
      { corpse: 'Brackwyn', updated_at: NOW, x: 'a', y: 1, z: 1 }], NOW)).toEqual([]);
    expect(applyCorpseEvents(null, val(), NOW)).toHaveLength(1);
  });
});

describe('the map-corpse route (source text, comments stripped)', () => {
  const SRC = stripJs(readSource(BOT_INDEX));

  it('POST /api/agent/map-corpse is routed behind the map_sync budget gate', () => {
    expect(SRC).toMatch(/req\.method === 'POST' && req\.url\.split\('\?'\)\[0\] === '\/api\/agent\/map-corpse'/);
    const at = SRC.indexOf("'/api/agent/map-corpse'");
    expect(SRC.slice(at, at + 200)).toMatch(/_overBudget\('map_sync', req, res\)/);
    expect(SRC.slice(at, at + 400)).toMatch(/_handleAgentMapCorpse\(req, res\)/);
  });

  it('the handler validates, stores a per-zone bot_kv row, refuses to overwrite after a failed read and primes the cache', () => {
    const start = SRC.indexOf('async function _handleAgentMapCorpse');
    const fn = SRC.slice(start, SRC.indexOf('\n}\n', start));
    expect(fn).toMatch(/_ptsReadBody\(req, 8 \* 1024\)/);
    expect(fn).toMatch(/validateCorpseEvents\(body, now\)/);
    expect(fn).toMatch(/applyCorpseEvents\(current, v, now\)/);
    expect(fn).toMatch(/supabase\.upsert\('bot_kv'/);
    expect(fn).toContain("'map_corpses:' + v.zone");
    expect(fn).toContain('_mapCorpseCache.delete(v.zone)');
    expect(fn).toContain('_mapCorpseCache.set(v.zone');
    expect(fn).toMatch(/if \(!Array\.isArray\(current\)\) return _ptsJson\(res, 503/);
  });

  it('the list read is a 30 s cached bot_kv read', () => {
    expect(SRC).toMatch(/const _MAP_CORPSE_CACHE_MS = 30_000;/);
    const start = SRC.indexOf('async function _mapCorpseList');
    const fn = SRC.slice(start, SRC.indexOf('\n}\n', start));
    expect(fn).toMatch(/supabase\.select\('bot_kv'/);
    expect(fn).toContain("'map_corpses:' + zone");
    expect(fn).toMatch(/now - hit\.at <= _MAP_CORPSE_CACHE_MS/);
  });

  it('the map-sync GET reply carries corpses, read fail-soft', () => {
    const start = SRC.indexOf('async function _handleAgentMapSyncGet');
    const get = SRC.slice(start, SRC.indexOf('\n}\n', start));
    expect(get).toMatch(/out\.corpses = require\('\.\/utils\/mapCorpses'\)\.liveCorpses\(await _mapCorpseList\(zone\)\.catch\(\(\) => null\), now\)/);
  });
});
