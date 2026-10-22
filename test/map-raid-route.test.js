// The saved raid route on the Mimic Map (the guild lead, 2026-10-21: "make the route that gets displayed on the maps overlay").
//
// An officer saves a zone's averaged raid route on the website; the bot serves it as GET /api/agent/raid-route (test/raid-route.test.js
// in the bot). Agent half: the "Saved raid route" part of the Spawn map core in packages/wolfpack-logsync/index.js, source-sliced and
// run as shipped over a temp dir and fake network modules (the way test/map-corpses-agent.test.js does). Overlay half: apps/mimic/map.html
// run against a stub page whose canvas records what is drawn and where.
//
// Mutation-checked (each makes a test below fail): ask the bot without the zone; drop the 5 minute refresh gate; send `route` on
// every poll; fetch in local-only mode; take a `shed` answer as "no route"; let a bad point through _mapRouteClean; draw the route
// after the live markers; draw it with the toggle off; negate the route's x/y again; keep the old zone's route across a zone change.
//
// Run: npx vitest run test/map-raid-route.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { EventEmitter } from 'node:events';
import { readSource, sliceBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const AGENT = readSource(AGENT_INDEX);
const CORE = sliceBlock(AGENT, '// ── Spawn map core (Mimic 2.9', '// ── end Spawn map core ──');
const MAP_HTML = readSource(path.join(ROOT, 'apps', 'mimic', 'map.html'));

const tick = () => new Promise(r => setImmediate(() => setImmediate(r)));

// ═══ the agent ═══════════════════════════════════════════════════════════════════════════════════════════════════
const EXPORTS = ['_mapStatePayload', '_mapSaveNow', '_mapSyncStop', '_mapEnsureZone', '_mapPaths', '_zealState', '_mapRouteClean', '_mapRouteFor', '_mapRoutes'];
const LULL_DEFS = sliceBlock(AGENT, '// ── Pacify / lull line (SPA 30', 'return PACIFY_AE.has(String(name).toLowerCase().replace(/`/g, "\'").trim());\n}');
const MEZ_DEF = sliceBlock(AGENT, 'function _isMezSpell(name) {', "includes('mez'));\n}");
const CON_DEFS = AGENT.slice(AGENT.indexOf('const CON_STANDINGS = ['), AGENT.indexOf('\n', AGENT.indexOf('const _CON_RX = ')));
const MAIN_TARGET_DEF = sliceBlock(AGENT, 'function _resolveMainTarget(activeCharacter) {', 'raider_count: best.raider_count || 0 } : null;\n}');

function loadCore({ dir, opts, net }) {
  const prelude = `
    const STATS_FILE = path.join(__tmp, 'logsync.stats.json');
    let _uploadOpts = __opts;
    function _localOnly() { return !!(_uploadOpts && !_uploadOpts.token); }
    function _controlStandDown() { return { down: false }; }
    const AGENT_VERSION = 'test';
    const _zealState = {};
    let _lastRaidPipe = null;
    function _zoneName(id) { return id === 164 ? 'The Deep' : null; }
    function _eqSetupDirs() { return []; }
    const whoData = new Map();
    function _classOf(c) { const w = whoData.get(String(c || '').toLowerCase()); return w && w.class ? w.class : null; }
    const _buffLandingsByTarget = new Map();
    const _spellByNameLower = new Map();
    function shouldUploadForCharacter() { return true; }
    ${LULL_DEFS}
    ${MEZ_DEF}
    ${CON_DEFS}
    const _mobInfoByName = new Map();
    const MOB_INFO_TTL_MS = 6 * 60 * 60 * 1000;
    function _mobInfoCacheKey(name, zoneId) { return String(name).toLowerCase() + '|' + (zoneId != null ? zoneId : '*'); }
    function fetchMobInfo() {}
    const _extTargetCache = new Map();
    function fetchExtendedTarget() {}
    ${MAIN_TARGET_DEF}
  `;
  // eslint-disable-next-line no-new-func
  const f = new Function('fs', 'path', 'http', 'https', 'zlib', '__dirname', '__tmp', '__opts',
    prelude + '\n' + CORE + `\nreturn { ${EXPORTS.join(', ')} };`);
  const c = f(fs, path, net.http, net.https, zlib, dir, dir, opts);
  c._mapPaths.cache = path.join(dir, 'zone-spawns-cache');
  c._mapPaths.timers = path.join(dir, 'map_timers.json');
  c._mapPaths.brewall = null;
  cores.push(c);
  return c;
}
function fakeNet(responder) {
  const calls = [];
  const mod = {
    request(o, cb) {
      calls.push(o);
      const req = {
        on() { return req; }, destroy() {},
        end() {
          setImmediate(() => {
            const r = responder ? responder(o) : { status: 200, body: { ok: true } };
            const res = new EventEmitter();
            res.statusCode = r.status; res.headers = {};
            cb(res);
            if (r.body != null) res.emit('data', Buffer.from(typeof r.body === 'string' ? r.body : JSON.stringify(r.body)));
            res.emit('end');
          });
        },
      };
      return req;
    },
  };
  return { http: mod, https: mod, calls };
}
const routeCalls = (net) => net.calls.filter(o => /\/raid-route/.test(o.path));

const NPC = (name) => ({ name, level: 50, chance: 100, named: false, raid_target: false, badges: [], aggro: 60, fac: 1, assist: null, pf: 0 });
const ZONE_BODY = {
  zone: 'thedeep', long_name: 'The Deep', generated_at: '2026-10-21T00:00:00Z',
  points: [{ id: 7, x: 300, y: -450, z: 0, respawn_s: 1200, variance_s: 120, npcs: [NPC('a_blood_raven')] }],
  map: { bands: [0], segs: [[0, 0, 100, 0, 0]], bounds: { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 } },
};
const LIVE = { botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: 'tok' };
const SAVED = '2026-10-21T18:00:00.000Z';
// What the bot's utils/raidRoute.js serves.
const ROUTE = {
  v: 1, zone: 'thedeep', name: 'The Deep', saved_at: SAVED,
  points: [[0, 0], [10, 0], [20, 5], [30, 5], [40, 40], [50, 45]],
  legs: [[0, 2], [3, 5]],
  stops: [{ n: 1, name: 'Aldenmar the Grim', x: 20, y: 5, at: 'spawn' }, { n: 2, name: 'Brackwyn', x: 50, y: 45, at: 'raid' }],
};
const answer = (route) => ({ status: 200, body: { ok: true, zone: 'thedeep', route } });

let dir;
const cores = [];
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maproute-')); });
afterEach(() => {
  for (const k of cores.splice(0)) { try { k._mapSaveNow(); k._mapSyncStop(); } catch { /* nothing to flush */ } }
  fs.rmSync(dir, { recursive: true, force: true });
});
function liveCore(responder, opts) {
  fs.mkdirSync(path.join(dir, 'zone-spawns-cache'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'zone-spawns-cache', 'thedeep.json'), JSON.stringify({ etag: '"v1"', fetched_at: Date.now(), body: ZONE_BODY }));
  const net = fakeNet(responder);
  const c = loadCore({ dir, opts: opts || LIVE, net });
  c._mapEnsureZone('thedeep', 164, Date.now());
  c._zealState.Aldenmar = { zone: 164, updatedAt: 1e18, loc: { x: 100, y: -50, z: 7 }, group_members: [] };
  return { c, net };
}

describe('the agent asks the bot for the zone\'s saved route', () => {
  it('asks once on the first poll in a zone, with the zone and the bearer token, and the route rides the next poll', async () => {
    const { c, net } = liveCore(() => answer(ROUTE));
    const N = Date.now();
    const first = c._mapStatePayload('', N);
    expect(first.route_ver).toBeNull();            // nothing yet: the answer is on its way
    expect(first.route).toBeUndefined();
    await tick();
    const calls = routeCalls(net);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].path).toBe('/api/agent/raid-route?zone=thedeep');
    expect(calls[0].headers.Authorization).toBe('Bearer tok');
    const second = c._mapStatePayload('', N + 250);
    expect(second.route_ver).toBe('thedeep@' + SAVED);
    expect(second.route.points).toHaveLength(6);
    expect(second.route.legs).toEqual([[0, 2], [3, 5]]);
    expect(second.route.stops.map(s => [s.n, s.name])).toEqual([[1, 'Aldenmar the Grim'], [2, 'Brackwyn']]);
    expect(routeCalls(net)).toHaveLength(1);       // not again
  });

  it('sends the route body only when the overlay does not hold that version (the Map polls four times a second)', async () => {
    const { c } = liveCore(() => answer(ROUTE));
    const N = Date.now();
    c._mapStatePayload('', N); await tick();
    const ver = 'thedeep@' + SAVED;
    expect(c._mapStatePayload('', N + 250, '', '').route).toBeTruthy();
    const held = c._mapStatePayload('', N + 500, '', ver);
    expect(held.route_ver).toBe(ver);
    expect(held.route).toBeUndefined();
    expect(c._mapStatePayload('', N + 750, '', 'thedeep@2026-01-01T00:00:00.000Z').route).toBeTruthy();   // a different version it holds
  });

  it('asks again after 5 minutes and not before; a new save is picked up with its new version', async () => {
    let served = ROUTE;
    const { c, net } = liveCore(() => answer(served));
    const N = Date.now();
    c._mapStatePayload('', N); await tick();
    c._mapStatePayload('', N + 4 * 60_000);
    await tick();
    expect(routeCalls(net)).toHaveLength(1);
    served = Object.assign({}, ROUTE, { saved_at: '2026-10-21T19:30:00.000Z', stops: [] });
    c._mapStatePayload('', N + 5 * 60_000 + 1000); await tick();
    expect(routeCalls(net)).toHaveLength(2);
    const p = c._mapStatePayload('', N + 5 * 60_000 + 1500, '', 'thedeep@' + SAVED);
    expect(p.route_ver).toBe('thedeep@2026-10-21T19:30:00.000Z');
    expect(p.route.stops).toEqual([]);
  });

  it('a zone with no saved route (route null) has no route_ver and no route: the overlay draws nothing', async () => {
    const { c, net } = liveCore(() => answer(null));
    const N = Date.now();
    c._mapStatePayload('', N); await tick();
    const p = c._mapStatePayload('', N + 250);
    expect(routeCalls(net)).toHaveLength(1);
    expect(p.route_ver).toBeNull();
    expect(p.route).toBeUndefined();
  });

  it('local-only (no token) never asks, and the payload is the same as before this feature', async () => {
    const { c, net } = liveCore(() => answer(ROUTE), { botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: '' });
    const N = Date.now();
    c._mapStatePayload('', N); await tick();
    const p = c._mapStatePayload('', N + 250);
    expect(net.calls).toEqual([]);
    expect(p.route_ver).toBeNull();
    expect(p.route).toBeUndefined();
  });

  it('an older bot (404), a failing bot (500), a dead network and a shed answer are quiet and retried in 5 minutes; a held route survives them', async () => {
    let mode = 'ok';
    const { c, net } = liveCore(() => (mode === 'ok' ? answer(ROUTE) : mode === 'shed' ? { status: 200, body: { ok: true, shed: true, route: null } } : { status: Number(mode), body: { error: 'x' } }));
    const N = Date.now();
    c._mapStatePayload('', N); await tick();
    const ver = c._mapStatePayload('', N + 250).route_ver;
    expect(ver).toBe('thedeep@' + SAVED);
    for (const m of ['404', '500', 'shed']) {
      mode = m;
      const before = routeCalls(net).length;
      const t = N + 6 * 60_000 * (['404', '500', 'shed'].indexOf(m) + 1) * 2;
      c._mapStatePayload('', t); await tick();
      expect(routeCalls(net).length).toBe(before + 1);                 // it did ask
      c._mapStatePayload('', t + 60_000); await tick();
      expect(routeCalls(net).length).toBe(before + 1);                 // and backs off, whatever the answer
      expect(c._mapStatePayload('', t + 61_000).route_ver).toBe(ver);  // the route it held is still served
    }
  });

  it('a first answer that is a 404 leaves no route and no error', async () => {
    const { c, net } = liveCore(() => ({ status: 404, body: { error: 'nope' } }));
    const N = Date.now();
    c._mapStatePayload('', N); await tick();
    const p = c._mapStatePayload('', N + 250);
    expect(routeCalls(net)).toHaveLength(1);
    expect(p.route_ver).toBeNull();
    expect(p.status).toBe('ok');
  });
});

describe('_mapRouteClean: nothing in the bot\'s answer is trusted to be the shape it should be', () => {
  function clean(r) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'maproute-clean-'));
    const core = loadCore({ dir: d, opts: LIVE, net: fakeNet() });
    try { return core._mapRouteClean(r); } finally { fs.rmSync(d, { recursive: true, force: true }); }
  }
  it('keeps a good route and drops fields the Map does not use', () => {
    const r = clean(Object.assign({ nights: ['x'], clears: [{}] }, ROUTE));
    expect(Object.keys(r).sort()).toEqual(['legs', 'name', 'points', 'saved_at', 'stops']);
    expect(r.stops[0]).toEqual({ n: 1, name: 'Aldenmar the Grim', x: 20, y: 5, at: 'spawn' });
  });
  it.each([
    ['null', null],
    ['not an object', 'route'],
    ['no points', { legs: [[0, 1]] }],
    ['a point that is not a pair of numbers', Object.assign({}, ROUTE, { points: [[0, 0], ['x', 1], [2, 2], [3, 3], [4, 4], [5, 5]] })],
    ['a NaN coordinate', Object.assign({}, ROUTE, { points: [[0, 0], [NaN, 1], [2, 2], [3, 3], [4, 4], [5, 5]] })],
    ['no usable leg', Object.assign({}, ROUTE, { legs: [[2, 2], [4, 99], [-1, 3], 'x'] })],
    ['more points than a route can have', Object.assign({}, ROUTE, { points: Array.from({ length: 4001 }, (_, i) => [i, i]), legs: [[0, 4000]] })],
  ])('rejects %s', (_label, r) => { expect(clean(r)).toBeNull(); });
  it('drops a bad leg or stop and keeps the rest; an unparseable save date becomes null', () => {
    const r = clean(Object.assign({}, ROUTE, {
      legs: [[0, 2], [4, 99], [3, 5]], saved_at: 'last tuesday',
      stops: [{ n: 1, name: 'ok', x: 1, y: 2 }, { n: 0, name: 'zero', x: 1, y: 2 }, { n: 2, name: '', x: 1, y: 2 }, { n: 3, name: 'far', x: Infinity, y: 2 }, null],
    }));
    expect(r.legs).toEqual([[0, 2], [3, 5]]);
    expect(r.stops.map(s => s.name)).toEqual(['ok']);
    expect(r.saved_at).toBeNull();
  });
});

describe('the agent\'s wiring', () => {
  const code = stripJs(AGENT);
  it('/api/map-state reads have_route and hands it to the payload', () => {
    expect(code).toMatch(/haveRoute = q\.get\('have_route'\) \|\| ''/);
    expect(code).toMatch(/_mapStatePayload\(have, Date\.now\(\), haveLocal, haveRoute\)/);
  });
  it('the read goes through the guarded map-sync request, so local-only, a paused agent and no token never reach the network', () => {
    const block = stripJs(sliceBlock(AGENT, 'function _mapRouteFor(zone, now) {', "}, '/raid-route');"));
    expect(block).toMatch(/_mapFetchAllowed\(\)/);
    expect(block).toMatch(/_mapSyncRequest\('GET', '\?zone=' \+ encodeURIComponent\(zone\)/);
  });
});

// ═══ the overlay ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('the overlay: prepRoute and routeNote', () => {
  const helpers = sliceBlock(MAP_HTML, '// ── pure helpers', '// ── end pure helpers ──');
  // eslint-disable-next-line no-new-func
  const H = new Function(helpers + '\nreturn { prepRoute, routeNote };')();
  it('keeps legs that index into the points, the numbered stops and the save time', () => {
    const r = H.prepRoute(ROUTE);
    expect(r.legs).toEqual([[0, 2], [3, 5]]);
    expect(r.stops.map(s => s.n)).toEqual([1, 2]);
    expect(r.saved).toBe(SAVED);
  });
  it('is null when there is nothing to draw', () => {
    expect(H.prepRoute(null)).toBeNull();
    expect(H.prepRoute({ points: [[0, 0], [1, 1]] })).toBeNull();
    expect(H.prepRoute({ points: [[0, 0], [1, 1]], legs: [[1, 1], [0, 9]] })).toBeNull();
  });
  it('the legend is "Raid route (saved <date>)", and just "Raid route" when the date is unreadable', () => {
    const d = new Date(SAVED).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    expect(H.routeNote(H.prepRoute(ROUTE))).toBe('Raid route (saved ' + d + ')');
    expect(H.routeNote(H.prepRoute(Object.assign({}, ROUTE, { saved_at: null })))).toBe('Raid route');
    expect(H.routeNote(null)).toBe('');
  });
});

describe('the overlay (apps/mimic/map.html) draws the saved route', () => {
  const POINTS = [{ id: 1, x: 100, y: 200, z: 0, respawn_s: 600, variance_s: 60, npcs: [{ name: 'a_decaying_skeleton', level: 50, chance: 100, named: false, raid_target: false, badges: [] }] }];
  const GOLD = 'rgba(232,185,35,0.9)';
  const PAYLOAD = {
    zone: 'thedeep', long_name: 'The Deep', version: 'thedeep@v', status: 'ok', now: Date.now(), local_only: false, zone_id: 164,
    points: POINTS, map: { bands: [0], segs: [[0, 0, 300, 0, 0]], bounds: { minX: -100, maxX: 600, minY: -100, maxY: 600 } }, grids: null,
    self: { x: 100, y: 100, z: 0, heading: 0, name: 'Aldenmar' }, group: [], raid: [], target: null, timers: [], seen: [], unassigned: [],
    route: ROUTE, route_ver: 'thedeep@' + SAVED,
  };

  async function boot({ store = {}, payload = PAYLOAD, payloads } = {}) {
    const script = MAP_HTML.slice(MAP_HTML.indexOf('<script>') + 8, MAP_HTML.lastIndexOf('</script>'));
    const all = {};
    const rec = { ops: [] };
    const ctx = new Proxy({}, {
      get(t, k) {
        if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
        if (['moveTo', 'lineTo'].includes(k)) return (x, y) => { rec.ops.push({ op: k, x, y, style: t.strokeStyle, w: t.lineWidth }); };
        if (k === 'arc') return (x, y, r) => { rec.ops.push({ op: 'arc', x, y, r }); };
        if (k === 'fill') return () => { rec.ops.push({ op: 'fill', style: t.fillStyle }); };
        if (k === 'stroke') return () => { rec.ops.push({ op: 'stroke', style: t.strokeStyle, w: t.lineWidth }); };
        if (k === 'fillText') return (s, x, y) => { rec.ops.push({ op: 'fillText', s: String(s), x, y, fill: t.fillStyle }); };
        if (k === 'strokeText') return (s) => { rec.ops.push({ op: 'strokeText', s: String(s) }); };
        return typeof t[k] === 'undefined' ? () => {} : t[k];
      },
      set(t, k, v) { t[k] = v; return true; },
    });
    const writes = { text: 0 };
    const mkEl = (tag) => {
      const e = { tag, children: [], style: {}, dataset: {}, attrs: {}, listeners: {}, hidden: false, textContent: '', innerHTML: '', value: '', title: '',
        clientWidth: 600, clientHeight: 400, offsetWidth: 50, offsetHeight: 20,
        classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); } },
        appendChild(ch) { this.children.push(ch); return ch; }, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
        setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, getAttribute(k) { return this.attrs[k] ?? null; },
        getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 400 }; }, closest() { return null; },
        getContext() { return ctx; },
      };
      Object.defineProperty(e, 'className', { get() { return this._cn || ''; }, set(v) { this._cn = v; } });
      if (tag === '#routenote') {   // counts every write to the legend's text, to prove a poll repaints nothing
        let text = '';
        Object.defineProperty(e, 'textContent', { get() { return text; }, set(v) { writes.text++; text = v; } });
      }
      return e;
    };
    const doc = { getElementById(id) { return all[id] || (all[id] = mkEl('#' + id)); }, createElement: mkEl, addEventListener() {}, hidden: false,
      body: mkEl('body'), documentElement: { style: { setProperty() {} } } };
    const fetched = [];
    let n = 0;
    const win = { addEventListener() {}, devicePixelRatio: 1, mimic: undefined };
    const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
    const pick = () => (payloads ? payloads[Math.min(n++, payloads.length - 1)] : payload);
    // eslint-disable-next-line no-new-func
    const out = new Function('window', 'document', 'location', 'fetch', 'localStorage', 'ResizeObserver', 'setInterval', 'clearInterval',
      script + '\nreturn { S: S, poll: poll, renderMap: renderMap };')(win, doc, { search: '' }, (u) => { fetched.push(u); return Promise.resolve({ json: () => Promise.resolve(pick()) }); },
      ls, undefined, () => 1, () => {});
    await tick();
    const redraw = () => { rec.ops.length = 0; out.renderMap(); return rec.ops.slice(); };
    return Object.assign(out, { all, rec, fetched, store, writes, redraw });
  }
  const click = (el) => el.listeners.click.forEach(f => f.call(el));
  // Where the overlay's own projection puts a server-frame point (north-up at (-x, -y)).
  const screenOf = (S, x, y) => [(-x - S.view.cx) * S.view.scale + S.w / 2, (-y - S.view.cy) * S.view.scale + S.h / 2];
  const goldOps = (ops) => ops.filter(o => o.style === GOLD);
  const wide = (extra) => Object.assign({ 'wp-map-scale': '0.5' }, extra);

  it('draws one gold line per leg through the overlay\'s own projection, with the legs kept apart', async () => {
    const a = await boot({ store: wide() });
    const ops = a.redraw();
    // the path that the gold stroke strokes: the moveTo/lineTo run just before it (a dark casing stroke may sit between)
    let end = ops.findIndex(o => o.op === 'stroke' && o.style === GOLD) - 1;
    while (ops[end].op === 'stroke') end--;
    let start = end;
    while (start > 0 && (ops[start - 1].op === 'moveTo' || ops[start - 1].op === 'lineTo')) start--;
    const mine = ops.slice(start, end + 1);
    expect(mine.map(o => o.op)).toEqual(['moveTo', 'lineTo', 'lineTo', 'moveTo', 'lineTo', 'lineTo']);   // two legs of three points
    ROUTE.points.forEach((p, i) => {
      const q = screenOf(a.S, p[0], p[1]);
      expect(mine[i].x).toBeCloseTo(q[0], 5);
      expect(mine[i].y).toBeCloseTo(q[1], 5);
    });
    // thin: at the default line strength a stroke of the route is under 3 px wide, gold, and there is one under it as casing
    const strokes = ops.filter(o => o.op === 'stroke' && o.style === GOLD);
    expect(strokes).toHaveLength(1);
    expect(strokes[0].w).toBeLessThan(3);
  });

  it('numbers the stops in order, each in a badge at the stop\'s own spot', async () => {
    const a = await boot({ store: wide() });
    const ops = a.redraw();
    const nums = ops.filter(o => o.op === 'fillText' && o.fill === '#e8b923');
    expect(nums.map(o => o.s)).toEqual(['1', '2']);
    ROUTE.stops.forEach((s, i) => {
      const q = screenOf(a.S, s.x, s.y);
      expect(nums[i].x).toBeCloseTo(q[0], 5);
      const badge = ops.find(o => o.op === 'arc' && Math.abs(o.x - q[0]) < 0.01 && Math.abs(o.y - q[1]) < 0.01);
      expect(badge).toBeTruthy();
    });
  });

  it('layers: the line is over the walls and under the spawn dots; the stop badges are over the dots and under the "you" arrow', async () => {
    const a = await boot({ store: wide() });
    const ops = a.redraw();
    const walls = ops.findIndex(o => o.op === 'stroke' && o.style === 'rgba(214,230,255,0.95)');
    const line = ops.findIndex(o => o.op === 'stroke' && o.style === GOLD);
    const spawnDot = ops.findIndex(o => o.op === 'fill' && o.style === '#c9d1d9');   // the default scheme's spawn point colour
    const firstNum = ops.findIndex(o => o.op === 'fillText' && o.fill === '#e8b923');
    const you = ops.findIndex(o => o.op === 'fill' && o.style === '#58a6ff');         // and the "you" arrow's
    expect(walls).toBeGreaterThanOrEqual(0);
    expect(line).toBeGreaterThan(walls);
    expect(spawnDot).toBeGreaterThan(line);
    expect(firstNum).toBeGreaterThan(spawnDot);
    expect(you).toBeGreaterThan(firstNum);
  });

  it('the legend reads "Raid route (saved <date>)", is a button, and carries the stop names in its hover text', async () => {
    const a = await boot({ store: wide() });
    const d = new Date(SAVED).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    expect(a.all.routenote.textContent).toBe('Raid route (saved ' + d + ')');
    expect(a.all.routenote.hidden).toBe(false);
    expect(a.all.routenote.title).toMatch(/1 Aldenmar the Grim · 2 Brackwyn/);
    expect(a.all.routenote.classList.contains('off')).toBe(false);
    expect(MAP_HTML).toMatch(/<button id="routenote" type="button" hidden><\/button>/);   // the preload arms every <button> for the hover handshake
  });

  it('clicking the legend hides the line, remembers it with the other layer toggles, and clicking again shows it', async () => {
    const a = await boot({ store: wide() });
    expect(goldOps(a.redraw()).length).toBeGreaterThan(0);
    click(a.all.routenote);
    expect(JSON.parse(a.store['wp-map-cfg']).show.raidRoute).toBe(false);
    expect(goldOps(a.redraw())).toEqual([]);
    expect(a.redraw().filter(o => o.op === 'fillText' && o.fill === '#e8b923')).toEqual([]);   // no stop numbers either
    expect(a.all.routenote.classList.contains('off')).toBe(true);
    expect(a.all.routenote.hidden).toBe(false);          // still there to switch back on
    const again = await boot({ store: a.store });         // a fresh start keeps it hidden
    expect(goldOps(again.redraw())).toEqual([]);
    expect(again.all.routenote.classList.contains('off')).toBe(true);
    click(again.all.routenote);
    expect(JSON.parse(again.store['wp-map-cfg']).show.raidRoute).toBe(true);
    expect(goldOps(again.redraw()).length).toBeGreaterThan(0);
  });

  it('is also a ⚙ layer switch (Saved raid route), on by default, with a colour in every scheme', () => {
    const show = sliceBlock(MAP_HTML, 'var CFG_SHOW = [', '];');
    expect(show).toMatch(/\['raidRoute', 'Saved raid route/);
    const schemes = sliceBlock(MAP_HTML, 'var MAP_SCHEMES = {', '\n  };');
    expect((schemes.match(/raidRoute: '#[0-9a-f]{6}'/gi) || []).length).toBe(3);
    expect(sliceBlock(MAP_HTML, 'var CFG_COLS = [', '];')).toMatch(/\['raidRoute', 'Saved raid route'\]/);
  });

  it('a zone without a saved route draws nothing and hides the legend', async () => {
    const none = Object.assign({}, PAYLOAD, { route: undefined, route_ver: null });
    const a = await boot({ store: wide(), payload: none });
    expect(goldOps(a.redraw())).toEqual([]);
    expect(a.all.routenote.hidden).toBe(true);
    expect(a.all.routenote.textContent).toBe('');
  });

  it('asks with the version it holds (have_route), keeps the route while the agent says "unchanged", and drops it when the agent says there is none', async () => {
    const unchanged = Object.assign({}, PAYLOAD, { route: undefined });
    const gone = Object.assign({}, PAYLOAD, { route: undefined, route_ver: null });
    const a = await boot({ store: wide(), payloads: [PAYLOAD, unchanged, gone] });
    expect(a.fetched[0]).toBe('http://127.0.0.1:7779/api/map-state');
    a.poll(); await tick();
    expect(a.fetched[1]).toBe('http://127.0.0.1:7779/api/map-state?have=thedeep%40v&have_route=thedeep%40' + encodeURIComponent(SAVED));
    expect(goldOps(a.redraw()).length).toBeGreaterThan(0);        // unchanged: still drawn
    a.poll(); await tick();
    expect(a.S.route).toBeNull();                                  // the officers cleared it
    expect(goldOps(a.redraw())).toEqual([]);
    expect(a.all.routenote.hidden).toBe(true);
  });

  it('a new zone never shows the old zone\'s route', async () => {
    const elsewhere = Object.assign({}, PAYLOAD, { zone: 'lavastorm', version: 'lavastorm@v', points: [], map: null, route: undefined, route_ver: null });
    const a = await boot({ store: wide(), payloads: [PAYLOAD, elsewhere] });
    expect(a.S.route).toBeTruthy();
    a.poll(); await tick();
    expect(a.S.route).toBeNull();
    expect(a.S.routeVer).toBeNull();
    expect(goldOps(a.redraw())).toEqual([]);
  });

  it('a poll that changes nothing repaints nothing: the legend text is written once', async () => {
    const same = Object.assign({}, PAYLOAD, { route: undefined });
    const a = await boot({ store: wide(), payloads: [PAYLOAD, same, same, same] });
    const before = a.writes.text;
    for (let i = 0; i < 3; i++) { a.poll(); await tick(); }
    expect(a.writes.text).toBe(before);
    expect(before).toBeGreaterThan(0);
  });

  it('survives a route with a bad point or a leg out of range without throwing', async () => {
    const bad = Object.assign({}, PAYLOAD, { route: { points: [[0, 0], [1, 1]], legs: [[0, 9]], stops: [{ n: 1, name: 'x', x: NaN, y: 1 }] } });
    const a = await boot({ store: wide(), payload: bad });
    expect(a.S.route).toBeNull();
    expect(() => a.redraw()).not.toThrow();
    expect(goldOps(a.redraw())).toEqual([]);
  });
});
