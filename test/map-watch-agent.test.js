// "Watch a spot" (the guild lead, 2026-10-16: "when we snipe a single mob we should be able to mark it and create a timer
// for everyone with the named PH spot and map loc ... right now the spawn list is a little hard to read").
//
// Agent half: the "Watched spots" part of the Spawn map core in packages/wolfpack-logsync/index.js, source-sliced and run
// as shipped over a temp dir and fake network modules (the way test/spawn-map.test.js does): which remote events a watch
// lets in, the copy-of-the-zone (inst) rule, the bot's `watches`, the older-bot 404, the Timers-window row and its label.
// Overlay half: apps/mimic/map.html's pure helpers and renderSide, run against a stub page. Text assertions strip comments
// first (CLAUDE.md, "comments satisfy text assertions").
//
// Mutation-checked (each makes a test below fail): drop the `watched[...]` clause in _mapApplyRemote; drop the inst check
// in _mapWatchFor; swap point.y / point.x in the label; stop merging in mergeTimers; drop the Watched section.
//
// Run: npx vitest run test/map-watch-agent.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { EventEmitter } from 'node:events';
import { readSource, sliceBlock, stripJs, stripCss, AGENT_INDEX, ROOT } from './_source-slice.js';

const AGENT = readSource(AGENT_INDEX);
const CORE = sliceBlock(AGENT, '// ── Spawn map core (Mimic 2.9', '// ── end Spawn map core ──');
const MAP_HTML = readSource(path.join(ROOT, 'apps', 'mimic', 'map.html'));

const EXPORTS = ['_mapApplyRemote', '_mapApplyMark', '_mapStatePayload', '_mapSaveNow', '_mapZoneDoc', '_mapEnsureZone', '_mapPaths',
  '_zealState', '_mapSync', '_mapSyncStop', '_mapCopy', '_mapWatchFor', '_mapWatchApplyBot', '_mapWatchSet', '_mapWatchTimerRows'];
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
        end(body) {
          o.__body = body ? Buffer.from(body).toString('utf8') : null;
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
const tick = () => new Promise(r => setImmediate(() => setImmediate(r)));

const NPC = (name, extra) => Object.assign({ name, level: 50, chance: 100, named: false, raid_target: false, badges: [], aggro: 60, fac: 1, assist: null, pf: 0 }, extra || {});
// Server frame. Point 7 is asymmetric on purpose (x 300, y -450) so a swapped /loc shows. 8 and 9 are plain placeholders.
const POINTS = [
  { id: 7, x: 300, y: -450, z: 0, respawn_s: 1200, variance_s: 120, npcs: [NPC('a_blood_raven', { chance: 60 }), NPC('The_Avatar_of_Anguish', { chance: 5, named: true })] },
  { id: 8, x: 900, y: 100, z: 0, respawn_s: 600, variance_s: 60, npcs: [NPC('a_blood_raven')] },
  { id: 9, x: -900, y: 100, z: 0, respawn_s: 600, variance_s: 60, npcs: [NPC('a_blood_raven')] },
];
const ZONE_BODY = {
  zone: 'thedeep', long_name: 'The Deep', generated_at: '2026-10-16T00:00:00Z', points: POINTS,
  map: { bands: [0], segs: [[0, 0, 100, 0, 0]], bounds: { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 } },
};
const LIVE = { botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: 'tok' };
const H = 'pq.projectquarm.pq3.projectquarm.com';

let dir;
const cores = [];
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapwatch-')); });
afterEach(() => {
  for (const k of cores.splice(0)) { try { k._mapSaveNow(); k._mapSyncStop(); } catch { /* nothing to flush */ } }
  fs.rmSync(dir, { recursive: true, force: true });
});
// A core linked to the bot with the zone on disk; Aldenmar plays in The Deep, grouped with Brackwyn and Corvale only.
function liveCore(responder) {
  fs.mkdirSync(path.join(dir, 'zone-spawns-cache'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'zone-spawns-cache', 'thedeep.json'), JSON.stringify({ etag: '"v1"', fetched_at: Date.now(), body: ZONE_BODY }));
  const net = fakeNet(responder);
  const c = loadCore({ dir, opts: LIVE, net });
  c._mapEnsureZone('thedeep', 164, Date.now());
  c._zealState.Aldenmar = { zone: 164, updatedAt: 1e18, loc: { x: 0, y: 0, z: 0 }, group_members: [{ name: 'Brackwyn' }, { name: 'Corvale' }] };
  return { c, net };
}
const N = Date.now();
const ev = (o) => Object.assign({ point_id: 7, kind: 'died', spawn_id: 5, name: 'a blood raven', at: N - 60000, by: 'Zarrin' }, o);   // Zarrin: not in our group
const watch7 = (c, extra) => c._mapWatchSet('thedeep', Object.assign({ point_id: 7, named: 'The Avatar of Anguish', on: true }, extra || {}), N, 'Aldenmar');

describe('a watched spot hears deaths from anyone in the same copy of the zone', () => {
  it('a death at a WATCHED spot from someone outside our raid / group starts the timer; the same sender at an unwatched spot is still ignored', () => {
    const { c } = liveCore();
    expect(c._mapApplyRemote('thedeep', [ev({ point_id: 8 })], N)).toBe(0);    // nobody watches 8: the party filter, as before
    expect(watch7(c)).toMatchObject({ ok: true, watched: true });
    expect(c._mapApplyRemote('thedeep', [ev({ point_id: 8, at: N - 50000 })], N)).toBe(0);    // 8 is still unwatched
    expect(c._mapApplyRemote('thedeep', [ev()], N)).toBe(1);
    expect(c._mapStatePayload('', N).timers).toEqual([expect.objectContaining({ point_id: 7, by: 'Zarrin', source: 'seen' })]);
  });
  it('an "empty" mark counts too; a "seen" from a stranger does not (only died / empty are opened up)', () => {
    const { c } = liveCore();
    watch7(c);
    expect(c._mapApplyRemote('thedeep', [ev({ kind: 'seen', at: N - 70000 })], N)).toBe(0);
    expect(c._mapApplyRemote('thedeep', [ev({ kind: 'empty', name: null, at: N - 60000 })], N)).toBe(1);
  });
  it('turning the watch off closes the door again', () => {
    const { c } = liveCore();
    watch7(c);
    c._mapWatchSet('thedeep', { point_id: 7, named: 'The Avatar of Anguish', on: false }, N, 'Aldenmar');
    expect(c._mapApplyRemote('thedeep', [ev()], N)).toBe(0);
  });
  describe('the copy of the zone (inst) still decides', () => {
    // One zone-in as EverQuest writes it to dbg.txt: the copy you are in is H:7312.
    beforeEach(() => {
      const ts = 'Mon Oct 12 16:00:00 2026';
      fs.writeFileSync(path.join(dir, 'dbg.txt'), [`[${ts}]00521:Zone addr [${H}:7312] received...`, `[${ts}]00522:Zone info received.`,
        `[${ts}]00523:         StartWorldDisplay: thedeep`].join('\r\n') + '\r\n');
    });
    const seed = (c) => { c._mapCopy.dirs = () => [dir]; };
    it('a watch for ANOTHER copy is ignored; the same copy and an unknown copy (null) are taken', () => {
      const { c } = liveCore(); seed(c);
      c._mapWatchApplyBot('thedeep', { watches: [{ point_id: 7, named: 'The Avatar of Anguish', inst: H + ':11243', by: 'Corvale', at: N }] }, N);
      expect(c._mapWatchFor('thedeep', N)).toEqual({});
      expect(c._mapApplyRemote('thedeep', [ev()], N)).toBe(0);
      c._mapWatchApplyBot('thedeep', { watches: [{ point_id: 7, named: 'The Avatar of Anguish', inst: H + ':7312', by: 'Corvale', at: N }] }, N);
      expect(Object.keys(c._mapWatchFor('thedeep', N))).toEqual(['7']);
      c._mapWatchApplyBot('thedeep', { watches: [{ point_id: 7, named: 'The Avatar of Anguish', inst: null, by: 'Corvale', at: N }] }, N);
      expect(Object.keys(c._mapWatchFor('thedeep', N))).toEqual(['7']);
    });
    it('an event from another copy is rejected even at a watched spot; one with no copy or the same copy is accepted', () => {
      const { c } = liveCore(); seed(c);
      watch7(c);   // stamped with our own copy
      expect(c._mapApplyRemote('thedeep', [ev({ inst: H + ':11243' })], N)).toBe(0);
      expect(c._mapApplyRemote('thedeep', [ev({ inst: H + ':7312', at: N - 50000 })], N)).toBe(1);
      expect(c._mapApplyRemote('thedeep', [ev({ kind: 'empty', at: N - 40000, spawn_id: 6 })], N)).toBe(1);   // an old agent: no copy sent
    });
  });
});

describe('the watch itself: local toggle, the bot, an older bot', () => {
  it('forwards to POST /api/agent/map-watch with zone, point, named, on, inst and character', async () => {
    const { c, net } = liveCore();
    watch7(c);
    await tick();
    expect(net.calls[0]).toMatchObject({ method: 'POST', path: '/api/agent/map-watch' });
    expect(JSON.parse(net.calls[0].__body)).toEqual({ zone: 'thedeep', point_id: 7, named: 'The Avatar of Anguish', on: true, inst: null, character: 'Aldenmar' });
    expect(net.calls[0].headers.Authorization).toBe('Bearer tok');
  });
  it('an older bot (404) keeps the watch here, asks nothing more for 10 minutes, and says nothing', async () => {
    const { c, net } = liveCore(() => ({ status: 404 }));
    watch7(c); await tick();
    expect(net.calls).toHaveLength(1);
    c._mapWatchSet('thedeep', { point_id: 9, named: 'Someone', on: true }, N + 1000, 'Aldenmar'); await tick();
    expect(net.calls).toHaveLength(1);                                  // backed off
    expect(Object.keys(c._mapWatchFor('thedeep', N + 2000)).sort()).toEqual(['7', '9']);
    c._mapWatchApplyBot('thedeep', { events: [] }, N + 20000);          // a pull from a bot with no `watches` field
    expect(Object.keys(c._mapWatchFor('thedeep', N + 20001)).sort()).toEqual(['7', '9']);
    expect(c._mapStatePayload('', N + 3000).watched).toEqual({ 7: { named: 'The Avatar of Anguish', by: 'Aldenmar' }, 9: { named: 'Someone', by: 'Aldenmar' } });
  });
  it('the bot\'s `watches` add the guild\'s; one it stops listing goes after a while; one never sent (still unsynced) stays', () => {
    const { c } = liveCore(() => ({ status: 500 }));
    c._mapWatchApplyBot('thedeep', { watches: [{ point_id: 8, named: 'The_Avatar_of_Anguish', inst: null, by: 'Corvale', at: N }] }, N);
    expect(c._mapStatePayload('', N).watched).toEqual({ 8: { named: 'The Avatar of Anguish', by: 'Corvale' } });
    watch7(c);                                                                       // our own, the POST fails: unsynced
    c._mapWatchApplyBot('thedeep', { watches: [] }, N + 60000);
    expect(Object.keys(c._mapWatchFor('thedeep', N + 60000))).toEqual(['7']);        // 8 left the bot's list; 7 never reached it
  });
  it('a pull that raced our "stop watching" does not bring the watch back', () => {
    const { c } = liveCore();
    watch7(c);
    c._mapWatchSet('thedeep', { point_id: 7, named: 'The Avatar of Anguish', on: false }, N + 1000, 'Aldenmar');
    c._mapWatchApplyBot('thedeep', { watches: [{ point_id: 7, named: 'The Avatar of Anguish', inst: null, by: 'Aldenmar', at: N }] }, N + 2000);
    expect(c._mapWatchFor('thedeep', N + 2000)).toEqual({});
  });
  it('rejects an unknown spot and a watch with nothing to watch for', () => {
    const { c } = liveCore();
    expect(c._mapWatchSet('thedeep', { point_id: 999, named: 'x', on: true }, N, 'Aldenmar')).toMatchObject({ ok: false });
    expect(c._mapWatchSet('thedeep', { point_id: 8, named: '', on: true }, N, 'Aldenmar')).toMatchObject({ ok: true, named: 'a blood raven' });   // falls back to the spot's best name
  });
  it('POST /api/map-watch is a local route behind the same origin guard as /api/map-mark', () => {
    const js = stripJs(AGENT);
    expect(js).toMatch(/req\.url === '\/api\/map-watch' && req\.method === 'POST'\) return _handleMapWatch\(req, res\)/);
    const handler = sliceBlock(js, 'async function _handleMapWatch(req, res) {', '\n}\n');
    expect(handler).toMatch(/if \(!_localOriginOk\(req\)\) return send\(403/);
    expect(handler).toMatch(/_mapWatchSet\(zone, /);
  });
});

describe('the Timers-window row for a watched spot', () => {
  const DIED = N - 60000;
  function watchedWithDeath() {
    const { c } = liveCore();
    watch7(c);
    c._mapApplyRemote('thedeep', [ev({ at: DIED })], N);
    return c;
  }
  // respawn 1200 s ± 120 s: the window opens 1080 s after the death and closes 1320 s after it.
  it('counts to the EARLIEST time with the named, "PH", the spot and the /loc as EverQuest prints it (Y first, then X)', () => {
    const c = watchedWithDeath();
    const rows = c._mapWatchTimerRows(N);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'named|thedeep|7|' + DIED, kind: 'named', group: 'trigger', scope: 'personal', target: null, dismissible: true, test: false,
      name: '★ The Avatar of Anguish PH · spot #7 · /loc -450, 300',
      effect: '★ The Avatar of Anguish PH · spot #7 · /loc -450, 300',
      remaining_ms: DIED + 1080000 - N, duration_sec: 1080,
    });
  });
  it('once the window is open it says "up now" and counts to the latest time; after that the tail runs 10 minutes, then the row is gone', () => {
    const c = watchedWithDeath();
    const open = c._mapWatchTimerRows(DIED + 1081000)[0];
    expect(open.name).toBe('★ The Avatar of Anguish PH · up now · spot #7 · /loc -450, 300');
    expect(open.remaining_ms).toBe(1320000 - 1081000);
    const tail = c._mapWatchTimerRows(DIED + 1320000 + 5 * 60000)[0];
    expect(tail.name).toContain(' · up now · ');
    expect(tail.remaining_ms).toBe(5 * 60000);
    expect(c._mapWatchTimerRows(DIED + 1320000 + 10 * 60000 + 1)).toEqual([]);
  });
  it('is gone the moment the watch ends, and a watched spot with no timer has no row', () => {
    const c = watchedWithDeath();
    c._mapWatchSet('thedeep', { point_id: 7, named: 'The Avatar of Anguish', on: false }, N, 'Aldenmar');
    expect(c._mapWatchTimerRows(N)).toEqual([]);
    const { c: k } = liveCore();
    watch7(k);
    expect(k._mapWatchTimerRows(N)).toEqual([]);
  });
  it('an unwatched timer never appears here, and the agent\'s snapshot carries these rows', () => {
    const { c } = liveCore();
    c._mapApplyMark('thedeep', { point_id: 8, kind: 'killed' }, N);
    expect(c._mapWatchTimerRows(N)).toEqual([]);
    const js = stripJs(AGENT);
    expect(js).toMatch(/for \(const r of _mapWatchTimerRows\(now\)\) out\.push\(r\)/);
  });
});

// ───────────────────────────── the Map overlay ─────────────────────────────
const helpers = sliceBlock(MAP_HTML, '// ── pure helpers', '// ── end pure helpers ──');
// eslint-disable-next-line no-new-func
const H_ = new Function(helpers + '\nreturn { mergeTimers, watchedRows, placeholderName, watchNpc, prettyNpc, timerText };')();
const T0 = Date.UTC(2026, 9, 16, 20, 0, 0);
const T = (id, name, e, l, extra) => Object.assign({ point_id: id, name, died_at: T0 - 1000, earliest: T0 + e, latest: T0 + l, source: 'seen' }, extra || {});

describe('map.html helpers: merging Respawns rows and the Watched section', () => {
  it('same name AND same state fold into one group, spoken for by the soonest; a different state stays apart', () => {
    const g = H_.mergeTimers([T(8, 'a blood raven', 300000, 400000), T(9, 'a blood raven', 100000, 200000), T(5, 'a blood raven', -20000, 90000, { source: 'marked' }), T(1, 'a bat', 50000, 90000)], T0);
    expect(g.map(x => [x.name, x.n, x.soonest.point_id, x.state])).toEqual([
      ['a blood raven', 1, 5, 'window'],
      ['a bat', 1, 1, 'wait'],
      ['a blood raven', 2, 9, 'wait'],
    ]);
  });
  it('a lone timer is a group of one (no "×1")', () => {
    expect(H_.mergeTimers([T(1, 'a bat', 50000, 90000)], T0)).toEqual([expect.objectContaining({ n: 1 })]);
  });
  it('watchNpc: only a named / raid-target mob makes a spot watchable', () => {
    expect(H_.watchNpc(POINTS[0]).name).toBe('The_Avatar_of_Anguish');
    expect(H_.watchNpc(POINTS[1])).toBeNull();
  });
  it('the placeholder is what died there, else the commonest ordinary mob (never the named itself)', () => {
    expect(H_.placeholderName(POINTS[0], 'The Avatar of Anguish', null)).toBe('a blood raven');
    expect(H_.placeholderName(POINTS[0], 'The Avatar of Anguish', { name: 'a blood raven' })).toBe('a blood raven');
    expect(H_.placeholderName(POINTS[0], 'The Avatar of Anguish', { name: 'The Avatar of Anguish' })).toBe('a blood raven');
  });
  it('watched rows: soonest timer first, spots with no timer last, unknown spots dropped', () => {
    const byId = { 7: POINTS[0], 8: POINTS[1], 9: POINTS[2] };
    const rows = H_.watchedRows({ 9: { named: 'B' }, 7: { named: 'A', by: 'Corvale' }, 8: { named: 'C' }, 99: { named: 'ghost' } }, byId,
      { 7: T(7, 'a blood raven', 500000, 600000), 8: T(8, 'a blood raven', 100000, 200000) }, { 9: { at: T0 } });
    expect(rows.map(r => [r.pid, r.named, r.by, r.up])).toEqual([['8', 'C', null, false], ['7', 'A', 'Corvale', false], ['9', 'B', null, true]]);
  });
});

async function boot(payloadExtra) {
  const script = MAP_HTML.slice(MAP_HTML.indexOf('<script>') + 8, MAP_HTML.lastIndexOf('</script>'));
  const all = {};
  const mkEl = (tag) => {
    const e = { tag, children: [], style: {}, dataset: {}, attrs: {}, listeners: {}, hidden: false, textContent: '', innerHTML: '', title: '',
      clientWidth: 600, clientHeight: 400, offsetWidth: 50, offsetHeight: 20,
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); } },
      appendChild(ch) { this.children.push(ch); return ch; },
      insertBefore(ch, ref) { const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(ch); else this.children.splice(i, 0, ch); return ch; },
      addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, getAttribute(k) { return this.attrs[k] ?? null; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 400 }; }, closest() { return null; },
      getContext() { return new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 5 }) : () => {}), set: () => true }); },
    };
    Object.defineProperty(e, 'className', { get() { return this._cn || ''; }, set(v) { this._cn = v; } });
    return e;
  };
  const doc = {
    getElementById(id) { return all[id] || (all[id] = mkEl('#' + id)); },
    createElement: mkEl, addEventListener() {}, hidden: false,
    body: mkEl('body'), documentElement: { style: { setProperty() {} } },
  };
  const payload = Object.assign({
    zone: 'thedeep', long_name: 'The Deep', version: 'thedeep@v', status: 'ok', now: T0, local_only: false,
    points: POINTS, map: ZONE_BODY.map, self: { x: 90, y: 190, z: 0, heading: 64, name: 'Aldenmar' }, group: [], raid: [], target: null, seen: [], unassigned: [],
    timers: [], watched: {},
  }, payloadExtra);
  const win = { addEventListener() {}, devicePixelRatio: 1, outerWidth: 1000, outerHeight: 500, mimic: undefined };
  const ls = { getItem: () => null, setItem() {} };
  // eslint-disable-next-line no-new-func
  const S = new Function('window', 'document', 'location', 'fetch', 'localStorage', 'ResizeObserver', 'setInterval', 'clearInterval',
    script + '\nreturn S;')(win, doc, { search: '' }, () => Promise.resolve({ json: () => Promise.resolve(payload) }), ls, undefined, () => 1, () => {});
  await tick();
  return { S, all };
}
const lines = (all) => all.lists.children.map(c => ({ cls: c.className, kids: c.children.map(k => k.textContent) , text: c.textContent }));

describe('map.html renderSide: the Respawns list is readable', () => {
  it('folds duplicate rows ("a blood raven ×2") and keeps different states apart', async () => {
    const { all } = await boot({ timers: [T(8, 'a blood raven', 300000, 400000), T(9, 'a blood raven', 100000, 200000), T(7, 'a blood raven', -20000, 90000)] });
    const rows = all.lists.children.filter(c => /trow/.test(c.className));
    expect(rows.map(r => r.children[0].textContent)).toEqual(['a blood raven', 'a blood raven ×2']);
    expect(rows[1].children[1].textContent).toBe('up in 1m40s–3m20s');                    // the soonest speaks, in its own column
    expect(rows[1].children[2].textContent).toBe('next of 2 · seen');
    expect(rows[1].className).toMatch(/\bwait\b/); expect(rows[0].className).toMatch(/\bwindow\b/);
    expect(all.lists.children.find(c => /sec/.test(c.className)).textContent).toBe('Respawns (3)');   // spots, not rows
  });
  it('a click on a merged row centres on the soonest spot', async () => {
    const { S, all } = await boot({ timers: [T(8, 'a blood raven', 300000, 400000), T(9, 'a blood raven', 100000, 200000)] });
    const row = all.lists.children.find(c => /trow/.test(c.className));
    row.listeners.click.forEach(f => f());
    expect(S.view.cx).toBe(900);     // point 9 is at x -900: screen x = -x
  });
  it('lists the watched spots first: the named in bold, "PH: <placeholder> · spot #<id>", the time; and not again below', async () => {
    const { all } = await boot({
      watched: { 7: { named: 'The Avatar of Anguish', by: 'Corvale' } },
      timers: [T(7, 'a blood raven', 100000, 200000), T(8, 'a blood raven', 300000, 400000)],
    });
    const kids = all.lists.children;
    expect(kids[0].className).toBe('sec watch');
    expect(kids[0].textContent).toBe('★ Watched (1)');
    expect(kids[1].className).toMatch(/\btrow watch wait\b/);
    expect(kids[1].children.map(k => k.textContent)).toEqual(['The Avatar of Anguish', 'up in 1m40s–3m20s', 'PH: a blood raven · spot #7']);
    expect(kids[1].attrs['data-wp-interact']).toBe('');
    expect(kids[2].textContent).toBe('Respawns (1)');            // 7 is listed above, not twice
    expect(kids.filter(c => /trow/.test(c.className))).toHaveLength(2);
  });
  it('no Watched section when nothing is watched; a watched spot with no timer says "watching"', async () => {
    const none = await boot({ timers: [T(8, 'a blood raven', 300000, 400000)] });
    expect(none.all.lists.children.some(c => /watch/.test(c.className))).toBe(false);
    const w = await boot({ watched: { 9: { named: 'The Avatar of Anguish', by: null } } });
    const row = w.all.lists.children.find(c => /trow watch/.test(c.className));
    expect(row.children.map(k => k.textContent)).toEqual(['The Avatar of Anguish', 'watching', 'PH: a blood raven · spot #9']);
  });
});

describe('map.html: the menu, the star and the stylesheet', () => {
  const js = stripJs(MAP_HTML), css = stripCss(MAP_HTML);
  it('the click menu offers Watch / Stop watching on a spot with a named, as an armed button posting to /api/map-watch', () => {
    const menu = sliceBlock(js, 'function openMenu(pid, e) {', '\n  function closeMenu()');
    expect(menu).toMatch(/var wn = watchNpc\(p\), wOn = S\.watchBy\[String\(pid\)\];/);
    expect(menu).toMatch(/wOn \? '☆ Stop watching ' \+ nmW : '★ Watch for ' \+ nmW/);
    expect(menu).toMatch(/wb\.setAttribute\('data-wp-interact', ''\)/);
    expect(menu).toMatch(/postWatch\(p\.id, nmW, !wOn\)/);
    expect(js).toMatch(/'http:\/\/127\.0\.0\.1:' \+ PORT \+ '\/api\/map-watch'/);
  });
  it('a watched dot gets a ★ and the hover card says who is watching', () => {
    expect(js).toMatch(/if \(S\.watchBy\[String\(p\.id\)\]\) halo\('★'/);
    expect(js).toMatch(/'★ watched' \+ \(wch\.by \? ' by ' \+ wch\.by : ''\)/);
  });
  it('the list has a solid background (never below 0.94), the time is its own column 2px above the name, the source line is smaller and dimmer', () => {
    expect(css).toMatch(/#side\{[^}]*background:rgb\(var\(--map-bg, 19 26 38\) \/ max\(0\.94, var\(--map-bg-a, var\(--bg-alpha\)\)\)\)/);
    const row = /\.trow\{[^}]*font-size:(\d+)px\}/.exec(css), tm = /\.trow \.tm\{([^}]*)\}/.exec(css), src = /\.trow \.src\{([^}]*)\}/.exec(css);
    expect(Number(/font-size:(\d+)px/.exec(tm[1])[1])).toBe(Number(row[1]) + 2);
    expect(tm[1]).toMatch(/grid-column:2;grid-row:1 \/ span 2/);
    expect(Number(/font-size:(\d+)px/.exec(src[1])[1])).toBeLessThan(Number(row[1]));
    expect(src[1]).toMatch(/color:#586069/);
  });
});

// ───────────── FB-87: health on the alive rows ─────────────
// (a raider: "if we already have health of each mob engaged, we could be putting this into the timers page of maps as
// well"). Agent half: _mapSeenHp joins the Extended Target rows onto `seen`; overlay half: hpTag + renderSide.
// Mutation-checked: drop the `!t.stale` filter; drop the duplicate-name null; drop the spawn-id mismatch guard; drop the
// own-target clause; drop the chip insert in renderSide's Up · seen loop or the Watched loop.
const SEEN_HP = new Function(sliceBlock(AGENT, 'function _mapNormName(n) {', '\n}\n') + sliceBlock(AGENT, 'function _mapSeenHp(', '\n}\n') + '\nreturn _mapSeenHp;')();
const seenRow = (point_id, spawn_id, name) => ({ point_id, spawn_id, name, at: 1, by: null });
const hpOf = (seen, rows, own) => { SEEN_HP(seen, rows, own); return seen.map(s => s.hp_pct); };

describe('agent: hp_pct on the seen rows (_mapSeenHp)', () => {
  it('joins by spawn id, even when two mobs share the name', () => {
    const rows = [{ name: 'a blood raven', spawn_id: 11, hp_pct: 40, kind: 'npc' }, { name: 'a blood raven', spawn_id: 12, hp_pct: 90, kind: 'npc' }];
    expect(hpOf([seenRow(1, 12, 'a blood raven'), seenRow(2, 11, 'a blood raven')], rows, null)).toEqual([90, 40]);
  });
  it('falls back to the name only when exactly one fresh row carries it', () => {
    const rows = [{ name: 'The_Avatar_of_Anguish', spawn_id: 5, hp_pct: 72.4, kind: 'npc' }];
    expect(hpOf([seenRow(1, null, 'The Avatar of Anguish')], rows, null)).toEqual([72]);
    expect(hpOf([seenRow(1, 5, 'The Avatar of Anguish')], [{ name: 'The Avatar of Anguish', hp_pct: 33, kind: 'npc' }], null)).toEqual([33]);
  });
  it('never guesses: two rows with the name, a name row naming a different spawn id, or no row at all, leave it null', () => {
    const two = [{ name: 'a bat', spawn_id: 1, hp_pct: 10, kind: 'npc' }, { name: 'a bat', spawn_id: 2, hp_pct: 20, kind: 'npc' }];
    expect(hpOf([seenRow(1, null, 'a bat')], two, null)).toEqual([null]);
    expect(hpOf([seenRow(1, 3, 'a bat')], two, null)).toEqual([null]);
    expect(hpOf([seenRow(1, 7, 'a bat')], [{ name: 'a bat', spawn_id: 8, hp_pct: 55, kind: 'npc' }], null)).toEqual([null]);
    expect(hpOf([seenRow(1, 7, 'a bat')], [], null)).toEqual([null]);
    expect(hpOf([seenRow(1, 7, 'a bat')], undefined, null)).toEqual([null]);
  });
  it('skips stale rows, and rows that are not NPCs', () => {
    expect(hpOf([seenRow(1, 5, 'a bat')], [{ name: 'a bat', spawn_id: 5, hp_pct: 50, stale: true, kind: 'npc' }], null)).toEqual([null]);
    expect(hpOf([seenRow(1, null, 'Aldenmar')], [{ name: 'Aldenmar', hp_pct: 50, kind: 'player' }], null)).toEqual([null]);
    // a stale duplicate does not turn a unique name into a duplicate
    const rows = [{ name: 'a bat', spawn_id: 5, hp_pct: 50, kind: 'npc' }, { name: 'a bat', spawn_id: 6, hp_pct: 60, stale: true, kind: 'npc' }];
    expect(hpOf([seenRow(1, null, 'a bat')], rows, null)).toEqual([50]);
  });
  it('your own target speaks for the spawn point it is pinned to', () => {
    const own = { point_id: 9, hp_pct: 64 };
    expect(hpOf([seenRow(9, 4, 'a bat'), seenRow(8, 4, 'a bat')], [{ name: 'a bat', spawn_id: 4, hp_pct: 20, kind: 'npc' }], own)).toEqual([64, 20]);
    expect(hpOf([seenRow(9, 4, 'a bat')], [], { point_id: 3, hp_pct: 64 })).toEqual([null]);
  });
  it('the payload wires it up after out.seen is built', () => {
    const js = stripJs(AGENT);
    expect(js).toMatch(/_mapSeenHp\(out\.seen, ec && ec\.payload && ec\.payload\.targets, out\.target\)/);
    expect(js.indexOf('_mapSeenHp(out.seen')).toBeGreaterThan(js.indexOf('out.seen = Object.values(zd.seen)'));
  });
});

describe('map.html: the health chip on alive rows', () => {
  const tag = new Function(sliceBlock(MAP_HTML, 'function hpTag(hp) {', '\n  }\n') + '\nreturn hpTag;')();
  it('tiers like Extended Target (60+ hi, 30+ mid, below lo) and is silent without a number', () => {
    expect(tag(100)).toEqual({ text: '100%', cls: 'hp hi' });
    expect(tag(60)).toEqual({ text: '60%', cls: 'hp hi' });
    expect(tag(59.6)).toEqual({ text: '60%', cls: 'hp hi' });
    expect(tag(30)).toEqual({ text: '30%', cls: 'hp mid' });
    expect(tag(29)).toEqual({ text: '29%', cls: 'hp lo' });
    expect(tag(0)).toEqual({ text: '0%', cls: 'hp lo' });
    expect(tag(null)).toBeNull(); expect(tag(undefined)).toBeNull(); expect(tag('x')).toBeNull();
  });
  it('Up · seen rows show it ahead of the time; a row without health is exactly as before', async () => {
    const { all } = await boot({ seen: [{ point_id: 7, spawn_id: 4, name: 'a blood raven', at: T0 - 60000, by: null, hp_pct: 42 }, { point_id: 8, spawn_id: null, name: 'a bat', at: T0 - 60000, by: null, hp_pct: null }] });
    const rows = all.lists.children.filter(c => /trow seen/.test(c.className));
    expect(rows).toHaveLength(2);
    const tm = rows[0].children[1];
    expect(tm.children.map(k => [k.className, k.textContent])).toEqual([['hp mid', '42%']]);
    expect(rows[1].children[1].children).toEqual([]);
  });
  it('a watched spot that is up shows it; a respawn row never does', async () => {
    const w = await boot({ watched: { 7: { named: 'The Avatar of Anguish', by: null } }, seen: [{ point_id: 7, spawn_id: 4, name: 'a blood raven', at: T0 - 1000, by: null, hp_pct: 88 }] });
    const row = w.all.lists.children.find(c => /trow watch/.test(c.className));
    expect(row.children[1].children.map(k => [k.className, k.textContent])).toEqual([['hp hi', '88%']]);
    const t = await boot({ timers: [Object.assign(T(8, 'a blood raven', 300000, 400000), { hp_pct: 50 })] });
    expect(t.all.lists.children.find(c => /trow wait/.test(c.className)).children[1].children).toEqual([]);
  });
  it('the chip has colours for all three tiers', () => {
    const css = stripCss(MAP_HTML);
    expect(css).toMatch(/\.trow \.tm \.hp\.hi\{color:#56d364\}/);
    expect(css).toMatch(/\.hp\.mid\{color:#f0b429\}/);
    expect(css).toMatch(/\.hp\.lo\{color:#f87171\}/);
  });
});

// ───────────── FB-89: the Engaged section ─────────────
// (a raider: "add a section in the timers tab for 'Engaged' mobs. put their HP there and how many are targetting them,
// similar to the Extended target overlay"). Agent half: _mapEngaged reads the Extended Target rows; overlay half: the top
// of renderSide, which the ?part=timers pop-out shares. Mutation-checked: drop the `!t.stale` filter; drop the
// raider_count >= 1 filter; drop the kind === 'npc' filter; flip the sort; drop the MAP_ENGAGED_MAX slice; drop the
// section in renderSide; drop the chip insert; drop the payload wiring.
const ENGAGED = new Function(sliceBlock(AGENT, 'const MAP_ENGAGED_MAX', '\n}\n') + '\nreturn { f: _mapEngaged, max: MAP_ENGAGED_MAX };')();
const npcRow = (name, spawn_id, hp_pct, raider_count, extra) => Object.assign({ name, spawn_id, hp_pct, raider_count, kind: 'npc' }, extra);

describe('agent: the engaged rows (_mapEngaged)', () => {
  it('keeps live NPC rows with a raider on them, and drops the rest', () => {
    const rows = [npcRow('a bat', 1, 50, 2), npcRow('a rat', 2, 60, 0), npcRow('a wolf', 3, 70, 1, { stale: true }),
      { name: 'Aldenmar', kind: 'player', hp_pct: 40, raider_count: 3 }, { name: 'Aldenmar`s warder', kind: 'pet', hp_pct: 40, raider_count: 3 }, null];
    expect(ENGAGED.f(rows).map(r => r.name)).toEqual(['a bat']);
    expect(ENGAGED.f(undefined)).toEqual([]);
  });
  it('carries name, spawn id, rounded health and the number of raiders; blanks stay null', () => {
    expect(ENGAGED.f([npcRow('a bat', 11, 41.6, 3), npcRow('a rat', 0, null, 1)]))
      .toEqual([{ name: 'a bat', spawn_id: 11, hp_pct: 42, n: 3 }, { name: 'a rat', spawn_id: null, hp_pct: null, n: 1 }]);
  });
  it('most targeted first, the more hurt mob ahead on a tie, then name; the same rows in any order give the same list', () => {
    const rows = [npcRow('b', 1, 90, 2), npcRow('a', 2, 90, 2), npcRow('c', 3, 20, 2), npcRow('d', 4, 100, 5), npcRow('e', 5, null, 2)];
    const want = ['d', 'c', 'a', 'b', 'e'];
    expect(ENGAGED.f(rows).map(r => r.name)).toEqual(want);
    expect(ENGAGED.f(rows.slice().reverse()).map(r => r.name)).toEqual(want);
  });
  it('is capped', () => {
    const rows = Array.from({ length: ENGAGED.max + 5 }, (_v, i) => npcRow('mob' + i, i + 1, 50, 1));
    expect(ENGAGED.f(rows)).toHaveLength(ENGAGED.max);
  });
  it('the payload carries it, from the same cache the health chips use', () => {
    const js = stripJs(AGENT);
    expect(js).toMatch(/out\.engaged = _mapEngaged\(ec2 && ec2\.payload && ec2\.payload\.targets\)/);
    expect(js).toMatch(/seen: \[\], engaged: \[\], unassigned: \[\]/);
  });
});

describe('map.html: the Engaged section', () => {
  const ROWS = [{ name: 'a blood raven', spawn_id: 11, hp_pct: 42, n: 3 }, { name: 'a bat', spawn_id: null, hp_pct: null, n: 1 }];
  it('is the first thing in the list, ahead of Watched and Respawns, one row per mob', async () => {
    const { all } = await boot({ engaged: ROWS, watched: { 7: { named: 'The Avatar of Anguish', by: null } }, timers: [T(8, 'a blood raven', 300000, 400000)] });
    const kids = all.lists.children;
    expect(kids[0].className).toBe('sec engaged');
    expect(kids[0].textContent).toBe('⚔ Engaged (2)');
    expect(kids.slice(1, 3).map(r => r.className)).toEqual(['trow engaged', 'trow engaged']);
    expect(kids.findIndex(c => /sec watch/.test(c.className))).toBeGreaterThan(2);
    expect(kids.findIndex(c => c.textContent === 'Respawns (1)')).toBeGreaterThan(2);
  });
  it('a row is name, health chip, "N on it" and the spawn id; no health means no chip', async () => {
    const { all } = await boot({ engaged: ROWS });
    const [a, b] = all.lists.children.filter(c => /trow engaged/.test(c.className));
    expect(a.children[0].textContent).toBe('a blood raven');
    expect(a.children[1].textContent).toBe('3 on it');
    expect(a.children[1].children.map(k => [k.className, k.textContent])).toEqual([['hp mid', '42%']]);
    expect(a.children[2].textContent).toBe('spawn #11');
    expect(b.children[1].textContent).toBe('1 on it');
    expect(b.children[1].children).toEqual([]);
    expect(b.children[2].textContent).toBe('engaged');
  });
  it('shows nothing when nobody is engaged or the agent sent no field, and renders the same rows each time', async () => {
    const none = await boot({ engaged: [] });
    expect(none.all.lists.children.some(c => /engaged/.test(c.className))).toBe(false);
    const old = await boot({});
    expect(old.all.lists.children.some(c => /engaged/.test(c.className))).toBe(false);
    const a = await boot({ engaged: ROWS }), b = await boot({ engaged: ROWS });
    const snap = (x) => x.all.lists.children.map(c => c.className + '|' + c.textContent + '|' + c.children.map(k => k.className + ':' + k.textContent).join(','));
    expect(snap(a)).toEqual(snap(b));
  });
  it('the section has its own colour', () => {
    const css = stripCss(MAP_HTML);
    expect(css).toMatch(/\.sec\.engaged\{color:#f0883e\}/);
    expect(css).toMatch(/\.trow\.engaged\{border-left-color:#f0883e;cursor:default\}/);
  });
});
