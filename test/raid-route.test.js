// test/raid-route.test.js — GET /api/agent/raid-route (the saved raid route Mimic's Map draws; the guild lead, 2026-10-21).
//
// utils/raidRoute.js runs for real against an in-memory stand-in for the supabase client, and the route handler is
// sliced out of the real index.js and run. The stored value is shaped exactly like web/app/raid/routes/actions.ts writes it.
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, stripJs, BOT_INDEX } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const rr = require_('../utils/raidRoute.js');

const NOW = Date.parse('2026-10-21T20:00:00Z');

// What actions.ts saves: whole route in the server frame, legs index into points, stops carry the website's extras.
function stored(over = {}) {
  return {
    v: 1, zone: 'potranquility', name: 'Plane of Tranquility', saved_at: '2026-10-21T18:00:00.000Z',
    nights: ['2026-10-14', '2026-10-18'], keys: ['11', '12'],
    points: [[0, 0], [10, 0], [20, 5], [30, 5], [40, 40], [50, 45]],
    stops: [
      { n: 1, npc_id: 100001, name: 'Aldenmar the Grim', x: 20, y: 5, at: 'spawn', median_clock_s: 120 },
      { n: 2, npc_id: 100002, name: 'Brackwyn', x: 50, y: 45, at: 'raid', median_clock_s: 600 },
    ],
    legs: [
      { from: 1, to: 2, median_s: 90, best_s: 80, nights: 2, start_index: 0, end_index: 2 },
      { from: 2, to: 3, median_s: 70, best_s: 60, nights: 2, start_index: 3, end_index: 5 },
    ],
    clears: [{ x: 5, y: 5, leg: 0, name: 'a trash mob', nights: 2, of: 2 }],
    ...over,
  };
}

function fakeSupabase(kv = {}) {
  const log = { selects: [] };
  return {
    log, kv,
    isEnabled: () => true,
    guildId: () => 'wolfpack',
    async select(table, qs) {
      log.selects.push({ table, qs });
      const p = new URLSearchParams(qs);
      const key = p.get('key').replace(/^eq\./, '');
      const guild = p.get('guild_id').replace(/^eq\./, '');
      if (guild !== 'wolfpack' || !(key in kv)) return [];
      return [{ value: kv[key] }];
    },
  };
}

beforeEach(() => rr._resetForTests());

describe('slim: the stored value to what the Map draws', () => {
  it('keeps points, leg ranges, stops, name and date; drops the website-only analysis', () => {
    const r = rr.slim(stored(), 'potranquility');
    expect(Object.keys(r).sort()).toEqual(['legs', 'name', 'points', 'saved_at', 'stops', 'v', 'zone']);
    expect(r.points).toHaveLength(6);
    expect(r.legs).toEqual([[0, 2], [3, 5]]);
    expect(r.stops).toEqual([
      { n: 1, name: 'Aldenmar the Grim', x: 20, y: 5, at: 'spawn' },
      { n: 2, name: 'Brackwyn', x: 50, y: 45, at: 'raid' },
    ]);
    expect(r.saved_at).toBe('2026-10-21T18:00:00.000Z');
    expect(r.name).toBe('Plane of Tranquility');
    const wire = JSON.stringify(r);
    expect(wire).not.toMatch(/npc_id|median|nights|keys|clears|trash/);
  });

  it('rounds coordinates to a tenth', () => {
    const r = rr.slim(stored({ points: [[1.23456, -2.98765], [3.14159, 2.71828]], legs: [] }), 'z');
    expect(r.points).toEqual([[1.2, -3], [3.1, 2.7]]);
  });

  it('a value with no usable legs is one leg end to end', () => {
    expect(rr.slim(stored({ legs: undefined }), 'z').legs).toEqual([[0, 5]]);
    expect(rr.slim(stored({ legs: [{ start_index: 4, end_index: 4 }, { start_index: -1, end_index: 2 }] }), 'z').legs).toEqual([[0, 5]]);
  });

  it('returns null when there is nothing to draw', () => {
    expect(rr.slim(null, 'z')).toBeNull();
    expect(rr.slim('x', 'z')).toBeNull();
    expect(rr.slim({}, 'z')).toBeNull();
    expect(rr.slim({ points: [] }, 'z')).toBeNull();
    expect(rr.slim({ points: [[1, 2]] }, 'z')).toBeNull();
    expect(rr.slim({ points: [[NaN, 1], [2, 'x']] }, 'z')).toBeNull();
  });

  it('drops garbled points and stops instead of failing the whole route', () => {
    const r = rr.slim(stored({
      points: [[0, 0], [1e9, 0], [10, 10], [20, 20]],
      legs: [],
      stops: [{ n: 1, name: 'ok', x: 1, y: 1, at: 'raid' }, { n: 0, name: 'bad n', x: 1, y: 1 }, { n: 2, name: '', x: 1, y: 1 }, { n: 3, name: 'far', x: 1e9, y: 1 }, null, 'x'],
    }), 'z');
    expect(r.points).toEqual([[0, 0], [10, 10], [20, 20]]);
    expect(r.stops.map(s => s.name)).toEqual(['ok']);
  });

  it('cleans stop names (control characters, length) and defaults a missing `at` to raid', () => {
    const r = rr.slim(stored({ stops: [{ n: 1, name: `A\u0000\nB${'x'.repeat(200)}`, x: 1, y: 1 }] }), 'z');
    expect(r.stops[0].name.length).toBe(64);
    expect(r.stops[0].name).not.toMatch(/[\u0000-\u001f]/);
    expect(r.stops[0].at).toBe('raid');
  });

  it('caps stops at 60 and thins a very long route evenly per leg, keeping each leg\'s last point', () => {
    const many = Array.from({ length: 70 }, (_, i) => ({ n: i + 1, name: 'm' + i, x: i, y: i, at: 'raid' }));
    expect(rr.slim(stored({ stops: many }), 'z').stops).toHaveLength(60);
    const n = 20001;
    const pts = Array.from({ length: n }, (_, i) => [i, i % 7]);
    const r = rr.slim({ points: pts, legs: [{ start_index: 0, end_index: 9999 }, { start_index: 10000, end_index: n - 1 }] }, 'z');
    expect(r.points.length).toBeLessThanOrEqual(rr.MAX_POINTS + 2);
    expect(r.legs).toHaveLength(2);
    expect(r.points[r.legs[0][1]]).toEqual([9999, 9999 % 7]);
    expect(r.points[r.points.length - 1]).toEqual([n - 1, (n - 1) % 7]);
    expect(r.legs[1][0]).toBe(r.legs[0][1] + 1);
  });

  it('an unparseable saved_at is null, not a crash', () => {
    expect(rr.slim(stored({ saved_at: 'last tuesday' }), 'z').saved_at).toBeNull();
    expect(rr.slim(stored({ saved_at: 42 }), 'z').saved_at).toBeNull();
  });
});

describe('getRoute', () => {
  it('reads the zone\'s own bot_kv key for this guild only and serves the slim route', async () => {
    const sb = fakeSupabase({ 'raid_route:potranquility': stored(), 'raid_route:other': stored({ name: 'Other' }) });
    const r = await rr.getRoute(sb, 'potranquility', NOW);
    expect(r.status).toBe(200);
    expect(r.route.name).toBe('Plane of Tranquility');
    expect(sb.log.selects).toHaveLength(1);
    expect(sb.log.selects[0].table).toBe('bot_kv');
    expect(sb.log.selects[0].qs).toMatch(/guild_id=eq\.wolfpack/);
    expect(sb.log.selects[0].qs).toMatch(/key=eq\.raid_route%3Apotranquility/);
    expect(sb.log.selects[0].qs).toMatch(/select=value/);
  });

  it('no saved route is 200 with route null', async () => {
    const r = await rr.getRoute(fakeSupabase(), 'potranquility', NOW);
    expect(r).toEqual({ status: 200, route: null });
  });

  it('caches for five minutes (a saved route and a missing one alike), then reads again', async () => {
    const sb = fakeSupabase({ 'raid_route:potranquility': stored() });
    await rr.getRoute(sb, 'potranquility', NOW);
    await rr.getRoute(sb, 'potranquility', NOW + 4 * 60_000);
    await rr.getRoute(sb, 'nothere', NOW);
    await rr.getRoute(sb, 'nothere', NOW + 60_000);
    expect(sb.log.selects).toHaveLength(2);
    await rr.getRoute(sb, 'potranquility', NOW + 5 * 60_000 + 1);
    expect(sb.log.selects).toHaveLength(3);
  });

  it('an officer\'s new save is served after the cache window', async () => {
    const sb = fakeSupabase({ 'raid_route:potranquility': stored() });
    expect((await rr.getRoute(sb, 'potranquility', NOW)).route.stops).toHaveLength(2);
    sb.kv['raid_route:potranquility'] = stored({ stops: [] });
    expect((await rr.getRoute(sb, 'potranquility', NOW + 6 * 60_000)).route.stops).toHaveLength(0);
  });

  it.each(['', undefined, null, 'PoTranquility', '../x', 'a', 'x'.repeat(33), 'a b'])('rejects the zone %j', async (z) => {
    const sb = fakeSupabase();
    expect((await rr.getRoute(sb, z, NOW)).status).toBe(400);
    expect(sb.log.selects).toHaveLength(0);
  });

  it('a failed read is a 503 and is not cached', async () => {
    const sb = fakeSupabase();
    sb.select = async () => null;
    expect((await rr.getRoute(sb, 'potranquility', NOW)).status).toBe(503);
    sb.select = async () => { throw new Error('boom'); };
    expect((await rr.getRoute(sb, 'potranquility', NOW)).status).toBe(503);
    sb.select = async () => [{ value: stored() }];
    expect((await rr.getRoute(sb, 'potranquility', NOW)).route).not.toBeNull();
  });
});

describe('the HTTP handler in index.js', () => {
  const src = readSource(BOT_INDEX);
  const block = sliceBlock(src, 'async function _handleAgentRaidRouteGet(', '// GET /api/agent/replay-window');
  function build(sb, identity = { discord_id: 'x' }) {
    const mimicLink = { requireAgentAuth: async () => identity };
    const _ptsJson = (res, code, obj) => { res.code = code; res.json = obj; };
    const req_ = (p) => (p === './utils/raidRoute' ? rr : p === './utils/supabase' ? sb : null);
    return new Function('mimicLink', '_ptsJson', 'require', 'URL', block + '\nreturn _handleAgentRaidRouteGet;')(mimicLink, _ptsJson, req_, URL);
  }

  it('200 { ok, zone, route } for a saved zone, route null for an unsaved one', async () => {
    const h = build(fakeSupabase({ 'raid_route:potranquility': stored() }));
    const a = {}; await h({ url: '/api/agent/raid-route?zone=potranquility' }, a);
    expect(a.code).toBe(200);
    expect(a.json).toMatchObject({ ok: true, zone: 'potranquility' });
    expect(a.json.route.stops).toHaveLength(2);
    const b = {}; await h({ url: '/api/agent/raid-route?zone=nowhere' }, b);
    expect(b.code).toBe(200);
    expect(b.json.route).toBeNull();
  });

  it('400 for a missing or bad zone, 503 when the database is off or the read failed', async () => {
    const h = build(fakeSupabase());
    const m = {}; await h({ url: '/api/agent/raid-route' }, m);
    expect(m.code).toBe(400);
    const bad = {}; await h({ url: '/api/agent/raid-route?zone=NO!' }, bad);
    expect(bad.code).toBe(400);
    const off = fakeSupabase(); off.isEnabled = () => false;
    const o = {}; await build(off)({ url: '/api/agent/raid-route?zone=potranquility' }, o);
    expect(o.code).toBe(503);
    const failing = fakeSupabase(); failing.select = async () => null;
    const f = {}; await build(failing)({ url: '/api/agent/raid-route?zone=potranquility' }, f);
    expect(f.code).toBe(503);
  });

  it('an unauthenticated caller gets nothing and no read happens', async () => {
    const sb = fakeSupabase({ 'raid_route:potranquility': stored() });
    const h = build(sb, null);
    const res = {}; await h({ url: '/api/agent/raid-route?zone=potranquility' }, res);
    expect(res.code).toBeUndefined();
    expect(sb.log.selects).toHaveLength(0);
  });
});

describe('shed + budget registration (real index.js)', () => {
  const src = readSource(BOT_INDEX);
  const gate = sliceBlock(src, 'const _SHED_KINDS = new Set([', '// ── Per-uploader admission-control budgets');
  const budgets = sliceBlock(src, 'const _BUDGET_DEFAULTS = {', '\n};');
  const { _isShedded, _SHED_KINDS, _SHED_NEVER, setTune } = new Function(`
    let __t = {};
    function setTune(t) { __t = t; }
    async function _overlayTuningMap() { return __t; }
    ${gate}
    return { _isShedded, _SHED_KINDS, _SHED_NEVER, setTune };`)();
  const BUDGETS = new Function(budgets + '\nreturn _BUDGET_DEFAULTS;')();

  it('raid_route is sheddable, never durable, and its flag acks a null route', async () => {
    expect(_SHED_KINDS.has('raid_route')).toBe(true);
    expect(_SHED_NEVER.has('raid_route')).toBe(false);
    setTune({ flag_shed_raid_route: 1 });
    const res = { writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
    expect(await _isShedded('raid_route', res, { ok: true, shed: true, route: null })).toBe(true);
    expect(res.code).toBe(200);
    expect(JSON.parse(res.body).route).toBeNull();
    setTune({});
    expect(await _isShedded('raid_route', { writeHead() {}, end() {} })).toBe(false);
  });

  it('is budgeted as an ephemeral GET (over budget is a 429 the agent backs off on)', () => {
    expect(BUDGETS.raid_route).toEqual({ perMin: 30, durable: false, get: true });
  });

  it('the route is wired: shed, then budget, then the handler', () => {
    const code = stripJs(src);
    expect(code).toMatch(/req\.method === 'GET' && req\.url\.split\('\?'\)\[0\] === '\/api\/agent\/raid-route'\) \{\n\s+if \(await _isShedded\('raid_route', res, [^\n]*\) return;\n\s+if \(await _overBudget\('raid_route', req, res\)\) return;\n\s+try \{ return await _handleAgentRaidRouteGet\(req, res\); \}/);
  });
});
