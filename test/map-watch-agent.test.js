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
  '_zealState', '_mapSync', '_mapSyncStop', '_mapCopy', '_mapWatchFor', '_mapWatchApplyBot', '_mapWatchSet', '_mapWatchTimerRows',
  '_mapKillNow', '_mapNoteLogDeath', '_mapNoteState', '_mapHpMem', '_mapKilledQ', '_mapNoteTagDead', '_extTargetCache'];
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
  const calls = [];
  // eslint-disable-next-line no-new-func
  const S = new Function('window', 'document', 'location', 'fetch', 'localStorage', 'ResizeObserver', 'setInterval', 'clearInterval',
    script + '\nreturn S;')(win, doc, { search: '' }, (u, o) => { calls.push([u, o]); return Promise.resolve({ json: () => Promise.resolve(payload) }); }, ls, undefined, () => 1, () => {});
  await tick();
  return { S, all, calls };
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
const SEEN_HP = new Function('const MAP_SEEN_KEEP_MS = 30 * 60 * 1000;\nconst MAP_PIN_MAX = 500;\n' + sliceBlock(AGENT, 'function _mapNormName(n) {', '\n}\n') + sliceBlock(AGENT, 'function _mapSeenHp(', '\n}\n')
  + sliceBlock(AGENT, 'const _mapHpMem = ', '\n}\n') + '\nreturn { f: _mapSeenHp, note: _mapHpNote, mem: _mapHpMem };')();
const seenRow = (point_id, spawn_id, name) => ({ point_id, spawn_id, name, at: 1, by: null });
const hpOf = (seen, rows, own) => { SEEN_HP.f(seen, rows, own); return seen.map(s => s.hp_pct); };

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
  // The guild lead, 2026-10-21 ("seeing some mobs repeated"): one Extended Target row with no spawn id was copied onto every
  // pinned seen row of the name. Mutation-checked: drop the `seenCount ... === 1` clause and these go red.
  it('a name-only row is not copied onto a pack: with two or more seen rows of the name, none of them takes its health or its raider count', () => {
    const rows = [npcRow('A Guardian of Marr', null, 45, 1)];
    const seen = [seenRow(1, 14, 'A Guardian of Marr'), seenRow(2, 219, 'A Guardian of Marr'), seenRow(3, 220, 'A Guardian of Marr')];
    SEEN_HP.f(seen, rows, null, null, 5);
    expect(seen.map(s => [s.hp_pct, s.n])).toEqual([[null, undefined], [null, undefined], [null, undefined]]);
  });
  it('...but each pinned spawn still gets its OWN health by spawn id (Extended Target row, your target, or the memory)', () => {
    const rows = [npcRow('A Guardian of Marr', 219, 30, 2), npcRow('A Guardian of Marr', null, 45, 1)];
    const seen = [seenRow(1, 14, 'A Guardian of Marr'), seenRow(2, 219, 'A Guardian of Marr'), seenRow(3, 220, 'A Guardian of Marr')];
    const mem = new Map([[220, { hp_pct: 12, at: 4_000_000 }]]);
    SEEN_HP.f(seen, rows, { id: 14, type: 1, hp_pct: 77 }, mem, 4_001_000);
    expect(seen.map(s => [s.hp_pct, s.hp_live])).toEqual([[77, true], [30, true], [12, false]]);
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
  it('a targeted mob that is not hurt stays a seen row and carries how many are on it (n); nobody on it carries nothing', () => {
    const rows = [npcRow('a golem', 11, 100, 3), npcRow('a golem', 12, 100, 0)];
    const seen = [seenRow(1, 11, 'a golem'), seenRow(2, 12, 'a golem'), seenRow(3, 13, 'a golem')];
    SEEN_HP.f(seen, rows, null, null, 5);
    expect(seen.map(s => [s.hp_pct, s.n])).toEqual([[100, 3], [100, undefined], [null, undefined]]);
  });
  it('the payload wires it up after out.seen is built', () => {
    const js = stripJs(AGENT);
    expect(js).toMatch(/_mapSeenHp\(out\.seen, ecRows, out\.target, hpMem, now\)/);
    expect(js).toMatch(/_mapHpNote\(hpMem, out\.target, ecRows, now\)/);
    expect(js.indexOf('_mapSeenHp(out.seen')).toBeGreaterThan(js.indexOf('out.seen = Object.values(zd.seen)'));
    expect(js.indexOf('_mapHpNote(hpMem')).toBeLessThan(js.indexOf('_mapSeenHp(out.seen'));
  });
});

// ───────────── tabbing through a pack: the per-spawn health memory ─────────────
// (the guild lead, 2026-10-20: "tab target through them quickly and get all of their healths out to verify, and it doesn't
// seem to be updating them in the up - seen section"). Mutation-checked: match the own target by point_id only; key the memory
// by name; drop the memory fallback; drop the 0-health forget; drop the age cutoff; mark remembered rows live; drop the
// _mapNoteDeath forget; drop the zone reset in the payload.
describe('agent: tabbing across same-name spawns keeps each one\'s own health', () => {
  const T = 1_000_000;
  const golems = () => [seenRow(1, 101, 'a crystalline golem'), seenRow(2, 102, 'a crystalline golem'), seenRow(3, 103, 'a crystalline golem')];
  const poll = (mem, seen, own, now, rows) => { SEEN_HP.note(mem, own, rows || [], now); SEEN_HP.f(seen, rows || [], own, mem, now); return seen; };
  const tgt = (id, hp) => ({ id, name: 'a crystalline golem', type: 1, hp_pct: hp, point_id: null });
  it('your own target counts by spawn id (a roamer has no pin), and the row is live', () => {
    const s = poll(new Map(), golems(), tgt(102, 93), T);
    expect(s.map(x => [x.hp_pct, x.hp_live, x.hp_at])).toEqual([[null, undefined, undefined], [93, true, T], [null, undefined, undefined]]);
  });
  it('tab A, B, C: all three keep their own health once you tab off; only the current target is live', () => {
    const mem = new Map(), seen = golems();
    poll(mem, seen, tgt(101, 97), T);
    poll(mem, seen, tgt(102, 93), T + 1000);
    poll(mem, seen, tgt(103, 88), T + 2000);
    expect(seen.map(x => [x.hp_pct, x.hp_live, x.hp_at])).toEqual([[97, false, T], [93, false, T + 1000], [88, true, T + 2000]]);
  });
  it('tabbing back to one updates that one only', () => {
    const mem = new Map(), seen = golems();
    poll(mem, seen, tgt(101, 97), T); poll(mem, seen, tgt(102, 93), T + 1000); poll(mem, seen, tgt(103, 88), T + 2000);
    poll(mem, seen, tgt(101, 80), T + 3000);
    expect(seen.map(x => [x.hp_pct, x.hp_live, x.hp_at])).toEqual([[80, true, T + 3000], [93, false, T + 1000], [88, false, T + 2000]]);
  });
  it('live Extended Target rows with a spawn id feed it too, and fall back to the memory once the row goes stale', () => {
    const mem = new Map(), seen = golems();
    poll(mem, seen, null, T, [npcRow('a crystalline golem', 101, 91, 1), npcRow('a crystalline golem', 102, 95, 1)]);
    expect(seen.map(x => x.hp_pct)).toEqual([91, 95, null]);
    poll(mem, seen, null, T + 5000, [npcRow('a crystalline golem', 101, 91, 0, { stale: true })]);
    expect(seen.map(x => [x.hp_pct, x.hp_live])).toEqual([[91, false], [95, false], [null, undefined]]);
  });
  it('never keyed by name: a row with no spawn id remembers nothing, and a spawn with no id reads nothing', () => {
    const mem = new Map();
    SEEN_HP.note(mem, { id: null, name: 'a crystalline golem', type: 1, hp_pct: 50 }, [npcRow('a crystalline golem', null, 60, 1)], T);
    expect(mem.size).toBe(0);
    SEEN_HP.note(mem, tgt(101, 70), [], T);
    expect(poll(mem, [seenRow(9, null, 'a crystalline golem')], null, T + 1000).map(x => x.hp_pct)).toEqual([null]);
  });
  it('a read of 0 (a corpse) or a non-NPC target forgets / never enters', () => {
    const mem = new Map();
    SEEN_HP.note(mem, tgt(101, 70), [], T);
    SEEN_HP.note(mem, tgt(101, 0), [], T + 1000);
    expect(mem.has(101)).toBe(false);
    SEEN_HP.note(mem, { id: 5, name: 'Aldenmar', type: 0, hp_pct: 50 }, [], T);
    SEEN_HP.note(mem, { id: 6, name: "a golem's corpse", type: null, hp_pct: 50 }, [], T);
    expect(mem.size).toBe(0);
  });
  it('a remembered health older than 30 minutes is gone', () => {
    const mem = new Map(), seen = [seenRow(1, 101, 'a crystalline golem')];
    poll(mem, seen, tgt(101, 70), T);
    poll(mem, seen, null, T + 30 * 60 * 1000 - 1);
    expect(seen[0].hp_pct).toBe(70);
    poll(mem, seen, null, T + 30 * 60 * 1000 + 1);
    expect(seen[0].hp_pct).toBeNull(); expect(mem.size).toBe(0);
  });
  it('a death clears it: _mapNoteDeath forgets the spawn, only in its own zone', () => {
    const js = stripJs(AGENT);
    const fn = sliceBlock(js, 'function _mapNoteDeath(', 'const rec = _mapZones.get(zone);');
    expect(fn).toMatch(/_mapHpMem\.zone === zone\) _mapHpMem\.m\.delete\(Number\(ev\.spawn_id\)\)/);
    const ctx = { _mapPosMem: { zone: null, m: new Map() }, _mapHpMem: { zone: 'thedeep', m: new Map([[101, { hp_pct: 50, at: 1 }], [102, { hp_pct: 60, at: 1 }]]) }, _mapZones: new Map(), _mapKilledQ: new Map() };
    const run = new Function('ctx', 'const { _mapHpMem, _mapPosMem, _mapZones, _mapKilledQ } = ctx; ' + fn.replace('function _mapNoteDeath(zone, ev, now) {', 'return function (zone, ev, now) {') + ' return { kind: "x" }; }')(ctx);
    run('otherzone', { spawn_id: 102 }, 5); expect([...ctx._mapHpMem.m.keys()]).toEqual([101, 102]);
    run('thedeep', { spawn_id: 101 }, 5); expect([...ctx._mapHpMem.m.keys()]).toEqual([102]);
    run('thedeep', { name: 'x' }, 5); expect([...ctx._mapHpMem.m.keys()]).toEqual([102]);
  });
  it('the memory is cleared on a zone change (spawn ids are reused between zones)', () => {
    const f = new Function('const MAP_SEEN_KEEP_MS = 30 * 60 * 1000;\nconst MAP_PIN_MAX = 500;\n' + sliceBlock(AGENT, 'const _mapHpMem = ', '\n}\n') + sliceBlock(AGENT, 'function _mapHpMemFor(', '\n}\n') + '\nreturn { f: _mapHpMemFor, note: _mapHpNote };')();
    const a = f.f('thedeep'); f.note(a, { id: 4, name: 'a bat', type: 1, hp_pct: 50 }, [], 5);
    expect(f.f('thedeep').size).toBe(1);
    expect(f.f('veksar').size).toBe(0);
    expect(f.f('thedeep').size).toBe(0);
  });
  it('the payload uses it, and every Zeal frame feeds it (not only a Map poll)', () => {
    const js = stripJs(AGENT);
    expect(js).toMatch(/const hpMem = _mapHpMemFor\(zone\);/);
    expect(sliceBlock(js, 'function _mapNoteState(', '\n}\n')).toMatch(/_mapHpNote\(_mapHpMemFor\(zone\), \{ id: next\.target_id, name: next\.target_name, type: next\.target_type, hp_pct: next\.target_hp_pct \}, null, now\)/);
  });
});

describe('agent: hurt seen rows join Engaged (_mapPromoteHurt)', () => {
  const T1 = 5_000_000;
  const sr = (point_id, spawn_id, name, hp_pct, extra) => Object.assign({ point_id, spawn_id, name, at: 1, by: null, hp_pct, hp_at: T1, hp_live: true }, extra);
  it('a hurt seen row nobody targets becomes an engaged row (n 0) carrying its spawn id, point and health; 100% and unknown stay seen', () => {
    const seen = [sr(1, 11, 'a crystalline golem', 93), sr(2, 12, 'a crystalline golem', 100), sr(3, 167, 'a crystalline arachnae', null, { hp_at: null, hp_live: false })];
    const eng = ENGAGED.promote(seen, [], T1);
    expect(eng).toEqual([{ name: 'a crystalline golem', spawn_id: 11, hp_pct: 93, n: 0, point_id: 1, hp_at: T1, hp_live: true }]);
    expect(seen.map(s => !!s.engaged)).toEqual([true, false, false]);
  });
  it('a remembered health counts only within 3 minutes', () => {
    const old = sr(1, 11, 'a golem', 80, { hp_live: false, hp_at: T1 - 3 * 60 * 1000 - 1 }), fresh = sr(2, 12, 'a golem', 80, { hp_live: false, hp_at: T1 - 3 * 60 * 1000 });
    expect(ENGAGED.promote([old, fresh], [], T1).map(g => g.spawn_id)).toEqual([12]);
  });
  it('the merged list is lowest health first, whoever targets it', () => {
    const eng = ENGAGED.f([npcRow('a bat', 1, 90, 2)]);
    const seen = [sr(1, 11, 'a golem', 97), sr(2, 12, 'a golem', 61), sr(3, 13, 'a golem', 80)];
    expect(ENGAGED.promote(seen, eng, T1).map(g => [g.name, g.n, g.hp_pct])).toEqual([['a golem', 0, 61], ['a golem', 0, 80], ['a bat', 2, 90], ['a golem', 0, 97]]);
  });
  it('a hurt mob that is not a seen row at all (a roamer you tabbed onto) joins from the health memory, by spawn id, within 3 minutes', () => {
    const mem = new Map([[40, { hp_pct: 55, at: T1 - 5000, name: 'a wandering golem' }], [41, { hp_pct: 100, at: T1, name: 'a wandering golem' }],
      [42, { hp_pct: 30, at: T1 - 3 * 60 * 1000 - 1, name: 'a wandering golem' }], [11, { hp_pct: 20, at: T1, name: 'a golem' }]]);
    const seen = [sr(1, 11, 'a golem', 97)];    // spawn 11 is a seen row: its own health stands, the memory does not add it twice
    const out = ENGAGED.promote(seen, [], T1, mem);
    expect(out.map(g => [g.spawn_id, g.hp_pct, g.point_id, g.hp_live])).toEqual([[40, 55, null, false], [11, 97, 1, true]]);
  });
  it('no duplicates: a seen row already engaged through an Extended Target row (same spawn id) is flagged, not added', () => {
    const eng = ENGAGED.f([npcRow('a golem', 11, 93, 1)]);
    const seen = [sr(1, 11, 'a golem', 93), sr(2, 12, 'a golem', 70)];
    const out = ENGAGED.promote(seen, eng, T1);
    expect(out.map(g => g.spawn_id)).toEqual([12, 11]);
    expect(seen.map(s => !!s.engaged)).toEqual([true, true]);
  });
  it('with no spawn ids, the only mob of that name on both sides is one mob; two seen rows of the name are not guessed', () => {
    const eng = ENGAGED.f([npcRow('The Avatar', null, 50, 1)]);
    const one = [sr(1, null, 'The Avatar', 50)];
    expect(ENGAGED.promote(one, eng, T1)).toHaveLength(1); expect(one[0].engaged).toBe(true);
    const two = [sr(1, null, 'The Avatar', 50), sr(2, null, 'The Avatar', 40)];
    expect(ENGAGED.promote(two, eng, T1)).toHaveLength(3);
  });
  it('one mob, one row: the same spawn id seen on two points (a synced sighting) is added once; the second is flagged, not listed', () => {
    const seen = [sr(1, 11, 'a golem', 60), sr(2, 11, 'a golem', 60)];
    const out = ENGAGED.promote(seen, [], T1);
    expect(out.map(g => g.spawn_id)).toEqual([11]);
    expect(seen.map(s => !!s.engaged)).toEqual([true, true]);
  });
  it('the kite in Halls of Honor: eleven pinned Guardians + one name-only row at 45% list ONE engaged mob, not twelve', () => {
    const seen = Array.from({ length: 11 }, (_v, i) => seenRow(i + 1, 200 + i, 'A Guardian of Marr'));
    const ext = [npcRow('A Guardian of Marr', null, 45, 1), npcRow('Jared Skies', 211, 50, 1)];
    SEEN_HP.f(seen, ext, null, null, T1);
    const out = ENGAGED.promote(seen, ENGAGED.f(ext), T1);
    expect(out.map(g => [g.name, g.spawn_id, g.hp_pct])).toEqual([['A Guardian of Marr', null, 45], ['Jared Skies', 211, 50]]);
    expect(seen.some(s => s.engaged)).toBe(false);   // they stay under Up · seen, health unknown
  });
  it('the cap holds and only the rows that made it are flagged', () => {
    const seen = Array.from({ length: ENGAGED.max + 3 }, (_v, i) => sr(i + 1, i + 100, 'a golem', 50 + i % 40));
    const out = ENGAGED.promote(seen, [], T1);
    expect(out).toHaveLength(ENGAGED.max);
    expect(seen.filter(s => s.engaged)).toHaveLength(ENGAGED.max);
  });
});

describe('agent: the kite totals line (_mapKite)', () => {
  const KITE = new Function(sliceBlock(AGENT, 'const MAP_KITE_UNREAD_MS', '\n}\n') + '\nreturn _mapKite;')();
  const g = (name, hp, extra) => Object.assign({ name, spawn_id: 1, hp_pct: hp, n: 0 }, extra);
  const NOW = 9_000_000;
  const max = (n) => ({ 'a golem': 10000, 'a bat': 2000 }[n] || null);
  it('counts, averages, sums the health left in catalog HP, and counts the rows not read in 30 s', () => {
    const rows = [g('a golem', 50, { hp_live: true, hp_at: NOW }), g('a golem', 70, { hp_live: false, hp_at: NOW - 30000 }), g('a bat', 100, { hp_live: false, hp_at: NOW - 30001 }), g('a golem', null)];
    expect(KITE(rows, max, NOW)).toEqual({ n: 4, avg: 73, hp_left: 5000 + 7000 + 2000, unread: 2 });
  });
  it('an Extended Target row (no hp_live) was read this poll; unknown max HP drops the total, never part of it', () => {
    const rows = [g('a golem', 40), g('mystery', 60)];
    expect(KITE(rows, max, NOW)).toEqual({ n: 2, avg: 50, hp_left: null, unread: 0 });
  });
  it('nothing for a lone mob or none', () => {
    expect(KITE([g('a golem', 40)], max, NOW)).toBeNull(); expect(KITE([], max, NOW)).toBeNull(); expect(KITE(undefined, max, NOW)).toBeNull();
  });
  it('the payload sends it from the engaged rows', () => {
    expect(stripJs(AGENT)).toMatch(/out\.kite = _mapKite\(out\.engaged,/);
  });
});

describe('map.html: the health chip on alive rows', () => {
  const FMT = sliceBlock(MAP_HTML, 'function fmtDur(ms) {', '\n  }\n');
  const tag = new Function(FMT + sliceBlock(MAP_HTML, 'function hpTag(hp, ageMs) {', '\n  }\n') + '\nreturn hpTag;')();
  const age = new Function(sliceBlock(MAP_HTML, 'function hpAge(row, now) {', '\n  }\n') + '\nreturn hpAge;')();
  it('a remembered health shows its age ("93% · 12s"); a live one (or one with no age) shows none', () => {
    expect(tag(93, 12000)).toEqual({ text: '93% · 12s', cls: 'hp hi' });
    expect(tag(93, 0).text).toBe('93% · 0s');
    expect(tag(93, null).text).toBe('93%'); expect(tag(93).text).toBe('93%');
    expect(age({ hp_live: false, hp_at: 1000 }, 13000)).toBe(12000);
    expect(age({ hp_live: true, hp_at: 1000 }, 13000)).toBeNull();
    expect(age({ hp_pct: 5 }, 13000)).toBeNull();          // an Extended Target row: read this poll
    expect(age({ hp_live: false, hp_at: null }, 13000)).toBeNull();
  });
  it('Up · seen and Engaged rows render the age only for a remembered health', async () => {
    const { all } = await boot({ seen: [{ point_id: 7, spawn_id: 4, name: 'a blood raven', at: T0 - 60000, by: null, hp_pct: 93, hp_at: T0 - 12000, hp_live: false },
      { point_id: 8, spawn_id: 5, name: 'a blood raven', at: T0 - 60000, by: null, hp_pct: 90, hp_at: T0, hp_live: true }],
    engaged: [{ name: 'a golem', spawn_id: 6, hp_pct: 70, n: 0, point_id: 9, hp_at: T0 - 5000, hp_live: false }] });
    const chip = (row) => row.children[1].children.map(k => k.textContent);
    const [s1, s2] = all.lists.children.filter(c => /trow seen/.test(c.className));
    expect(chip(s1)).toEqual(['93% · 12s']); expect(chip(s2)).toEqual(['90%']);
    expect(chip(all.lists.children.find(c => /trow engaged/.test(c.className)))).toEqual(['70% · 5s']);
  });
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
const ENGAGED = new Function(sliceBlock(AGENT, 'function _mapNormName(n) {', '\n}\n') + sliceBlock(AGENT, 'const MAP_ENGAGED_MAX', '\n}\n')
  + sliceBlock(AGENT, 'function _mapEngaged(', '\n}\n') + sliceBlock(AGENT, 'const MAP_HURT_FRESH_MS', '\n}\n')
  + '\nreturn { f: _mapEngaged, promote: _mapPromoteHurt, max: MAP_ENGAGED_MAX };')();
const npcRow = (name, spawn_id, hp_pct, raider_count, extra) => Object.assign({ name, spawn_id, hp_pct, raider_count, kind: 'npc' }, extra);

describe('agent: the engaged rows (_mapEngaged)', () => {
  it('engaged = hurt: a live NPC row at 1-99% is in, whether or not anyone targets it; a TARGETED mob at 100% or with no health is not', () => {
    const rows = [npcRow('hurt', 1, 93, 0), npcRow('targeted full', 2, 100, 3), npcRow('targeted unknown', 3, null, 2), npcRow('dead', 4, 0, 1),
      npcRow('stale', 5, 50, 0, { stale: true }), npcRow('targeted hurt', 6, 99, 2), npcRow('rounds up', 8, 99.6, 2),
      { name: 'Aldenmar', kind: 'player', hp_pct: 40, raider_count: 3 }, { name: 'Aldenmar`s warder', kind: 'pet', hp_pct: 40, raider_count: 3 }, null];
    expect(ENGAGED.f(rows).map(r => [r.name, r.n])).toEqual([['hurt', 0], ['targeted hurt', 2]]);
    expect(ENGAGED.f(undefined)).toEqual([]);
  });
  it('carries name, spawn id, rounded health and the raider count as information; a row with no id has spawn_id null', () => {
    expect(ENGAGED.f([npcRow('a bat', 11, 41.6, 3), npcRow('a rat', 0, 20, 1)]))
      .toEqual([{ name: 'a rat', spawn_id: null, hp_pct: 20, n: 1 }, { name: 'a bat', spawn_id: 11, hp_pct: 42, n: 3 }]);
  });
  it('lowest health first: a 40% mob nobody targets is above a 90% mob three raiders are on', () => {
    expect(ENGAGED.f([npcRow('targeted', 1, 90, 3), npcRow('loner', 2, 40, 0)]).map(r => r.name)).toEqual(['loner', 'targeted']);
  });
  it('ties: the older reading first (it needs a tab), then name, then spawn id; the same rows in any order give the same list', () => {
    const rows = [npcRow('b', 1, 50, 2), npcRow('a', 2, 50, 0), npcRow('a', 1, 50, 0), npcRow('c', 3, 20, 0), npcRow('z', 9, 50, 0)];
    const want = [['c', 3], ['a', 1], ['a', 2], ['b', 1], ['z', 9]];
    expect(ENGAGED.f(rows).map(r => [r.name, r.spawn_id])).toEqual(want);
    expect(ENGAGED.f(rows.slice().reverse()).map(r => [r.name, r.spawn_id])).toEqual(want);
    // the order key for a tie on health is hp_at: older first, a row with none (read this poll) last
    const order = new Function(sliceBlock(AGENT, 'const MAP_ENGAGED_MAX', '\n}\n') + '\nreturn _mapEngagedOrder;')();
    const rs = [{ name: 'a', spawn_id: 1, hp_pct: 50, hp_at: 900 }, { name: 'a', spawn_id: 2, hp_pct: 50, hp_at: 100 }, { name: 'a', spawn_id: 3, hp_pct: 50 }, { name: 'a', spawn_id: 4, hp_pct: 50, hp_at: 500 }];
    expect(rs.sort(order).map(r => r.spawn_id)).toEqual([2, 4, 1, 3]);
  });
  it('is capped, at 24 (a bard kite can be 10-20 mobs)', () => {
    const rows = Array.from({ length: ENGAGED.max + 5 }, (_v, i) => npcRow('mob' + i, i + 1, 50, 1));
    expect(ENGAGED.max).toBe(24);
    expect(ENGAGED.f(rows)).toHaveLength(ENGAGED.max);
  });
  it('the payload carries it, from the same cache the health chips use, and promotes hurt seen rows', () => {
    const js = stripJs(AGENT);
    expect(js).toMatch(/out\.engaged = _mapPromoteHurt\(out\.seen, _mapEngaged\(ec2 && ec2\.payload && ec2\.payload\.targets\), now, _mapHpMemFor\(zone\)\)/);
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

// ───────────── the sidebar's "☠ killed" button ─────────────
// (the guild lead, 2026-10-19: "Put a button on the timers sidebar to kill that mob from when the message of 'X died'"). Agent
// half: POST /api/map-kill -> _mapKillNow, which goes down the road a log death takes (_mapNoteDeath) with the death line's
// time (_mapLastDeathLine, set by _mapNoteLogDeath) or now. Overlay half: the button on the alive rows of renderSide.
// Mutation-checked: always use `now` for the time; drop the `line >= seenAt` guard; drop the forced point in _mapNoteDeath;
// drop the _mapLastDeathLine.set in _mapNoteLogDeath; drop the button from the Up · seen, Watched or Engaged loop; give a
// Respawns row a button; drop data-wp-interact; drop stopPropagation; drop the route.
describe('agent: _mapKillNow starts the timer from the last death line, else now', () => {
  const kill = (c, b) => c._mapKillNow('thedeep', b, N, 'Aldenmar');
  const timerOf = (c, pid) => c._mapStatePayload('', N).timers.find(t => t.point_id === pid);
  it('uses the time of the newest death message for that mob, even one the Map could not place', () => {
    const { c } = liveCore();
    c._mapNoteLogDeath('a blood raven', 'Aldenmar', N - 30000, N);        // three spots make ravens: unassigned, no timer
    expect(c._mapStatePayload('', N).timers).toEqual([]);
    expect(kill(c, { name: 'a blood raven', point_id: 8 })).toMatchObject({ ok: true, kind: 'assigned', from_line: true, at: N - 30000 });
    expect(timerOf(c, 8)).toMatchObject({ died_at: N - 30000, earliest: N - 30000 + 540000, latest: N - 30000 + 660000, source: 'marked' });
  });
  it('starts from now when no death message was seen', () => {
    const { c } = liveCore();
    expect(kill(c, { name: 'a blood raven', point_id: 9 })).toMatchObject({ ok: true, from_line: false, at: N });
    expect(timerOf(c, 9)).toMatchObject({ died_at: N, earliest: N + 540000 });
  });
  it('a death line from before the mob was last seen alive is an earlier spawn: skipped', () => {
    const { c } = liveCore();
    c._mapNoteLogDeath('a blood raven', 'Aldenmar', N - 50000, N);
    c._mapZoneDoc('thedeep').seen['8'] = { point_id: 8, spawn_id: 4, name: 'a blood raven', at: N - 5000 };
    expect(kill(c, { name: 'a blood raven', point_id: 8 })).toMatchObject({ ok: true, from_line: false, at: N });
    c._mapNoteLogDeath('a blood raven', 'Aldenmar', N - 3000, N);          // a death AFTER it was seen
    c._mapZoneDoc('thedeep').seen['8'] = { point_id: 8, spawn_id: 4, name: 'a blood raven', at: N - 5000 };
    expect(kill(c, { name: 'a blood raven', point_id: 8 })).toMatchObject({ ok: true, from_line: true, at: N - 3000 });
  });
  it('a death line older than half an hour is not used', () => {
    const { c } = liveCore();
    c._mapNoteLogDeath('a blood raven', 'Aldenmar', N - 30000, N);
    expect(c._mapKillNow('thedeep', { name: 'a blood raven', point_id: 9 }, N + 31 * 60000, 'Aldenmar')).toMatchObject({ ok: true, from_line: false, at: N + 31 * 60000 });
  });
  it('the seen-alive row goes away, exactly as an observed death clears it', () => {
    const { c } = liveCore();
    c._mapZoneDoc('thedeep').seen['8'] = { point_id: 8, spawn_id: 4, name: 'a blood raven', at: N - 5000 };
    expect(c._mapStatePayload('', N).seen).toHaveLength(1);
    expect(kill(c, { name: 'a blood raven', point_id: 8, spawn_id: 4 }).ok).toBe(true);
    const p = c._mapStatePayload('', N);
    expect(p.seen).toEqual([]);
    expect(p.timers.map(t => t.point_id)).toEqual([8]);
  });
  it('an Engaged row has no spot: the one seen-alive mob of that name, or the only spot that makes it, is used', () => {
    const { c } = liveCore();
    c._mapZoneDoc('thedeep').seen['9'] = { point_id: 9, spawn_id: 4, name: 'a blood raven', at: N - 5000 };
    expect(kill(c, { name: 'a blood raven', spawn_id: 4 })).toMatchObject({ ok: true, kind: 'assigned' });
    expect(timerOf(c, 9)).toBeTruthy();
    expect(kill(c, { name: 'The Avatar of Anguish' })).toMatchObject({ ok: true, kind: 'assigned' });   // only point 7 makes him
    expect(timerOf(c, 7)).toMatchObject({ name: 'The Avatar of Anguish' });
  });
  it('a second press (or a press just after the log line) is not swallowed as a duplicate death', () => {
    const { c } = liveCore();
    expect(kill(c, { name: 'The Avatar of Anguish' })).toMatchObject({ ok: true, kind: 'assigned' });
    expect(kill(c, { name: 'The Avatar of Anguish' })).toMatchObject({ ok: true, kind: 'assigned' });
  });
  it('an ambiguous name with no spot is kept under "Not pinned down", not guessed', () => {
    const { c } = liveCore();
    expect(kill(c, { name: 'a blood raven' })).toMatchObject({ ok: true, kind: 'unassigned' });
    const p = c._mapStatePayload('', N);
    expect(p.timers).toEqual([]);
    expect(p.unassigned.map(u => u.name)).toEqual(['a blood raven']);
  });
  it('refuses a name nothing here makes, a missing name, and a zone with no data', () => {
    const { c } = liveCore();
    expect(kill(c, { name: 'a griffon' })).toMatchObject({ ok: false });
    expect(kill(c, { name: '' })).toMatchObject({ ok: false, error: 'name is required' });
    expect(c._mapKillNow('nowhere', { name: 'a bat' }, N, 'Aldenmar')).toMatchObject({ ok: false, error: 'no spawn data for this zone' });
  });
  it('the route is registered, local-origin only, and the log hook records the time', () => {
    const js = stripJs(AGENT);
    expect(js).toMatch(/req\.url === '\/api\/map-kill' && req\.method === 'POST'\) return _handleMapKill\(req, res\)/);
    const handler = sliceBlock(js, 'async function _handleMapKill(req, res) {', '\n}\n');
    expect(handler).toMatch(/if \(!_localOriginOk\(req\)\) return send\(403/);
    expect(handler).toMatch(/_mapKillNow\(zone, b, now, ch\)/);
    expect(sliceBlock(js, 'function _mapNoteLogDeath(', '\n}\n')).toMatch(/_mapLastDeathLine\.set\(zone \+ '\|' \+ want,/);
  });
});

describe('map.html: the ☠ killed button on alive rows', () => {
  const kids = (row) => row.children.filter(k => k.className === 'kill');
  const SEEN = [{ point_id: 8, spawn_id: 4, name: 'a blood raven', at: T0 - 60000, by: null, hp_pct: 42 }];
  it('Up · seen, Engaged and an up Watched spot each get one, armed for the click-through window', async () => {
    const { all } = await boot({ seen: [...SEEN, { point_id: 7, spawn_id: 5, name: 'a blood raven', at: T0 - 1000, by: null }], watched: { 7: { named: 'The Avatar of Anguish', by: null } },
      engaged: [{ name: 'a bat', spawn_id: 11, hp_pct: 50, n: 2 }] });
    const rows = all.lists.children.filter(c => /^trow/.test(c.className));
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      const b = kids(r);
      expect(b).toHaveLength(1);
      expect(b[0].textContent).toBe('☠ killed');
      expect(b[0].tag).toBe('button');
      expect(b[0].attrs['data-wp-interact']).toBe('');
    }
  });
  it('a Respawns row, a watched spot with a timer and one that is only watched have none', async () => {
    const { all } = await boot({ timers: [T(8, 'a blood raven', 300000, 400000), T(7, 'a blood raven', 100000, 200000)],
      watched: { 7: { named: 'The Avatar of Anguish', by: null }, 9: { named: 'The Avatar of Anguish', by: null } } });
    const rows = all.lists.children.filter(c => /^trow/.test(c.className));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) expect(kids(r)).toEqual([]);
  });
  it('a click posts the row\'s name, spot and spawn id to /api/map-kill, and does not also centre the map', async () => {
    const { all, calls, S } = await boot({ seen: SEEN });
    const row = all.lists.children.find(c => /trow seen/.test(c.className));
    let stopped = false;
    const cx = S.view.cx;
    kids(row)[0].listeners.click.forEach(f => f({ stopPropagation() { stopped = true; } }));
    expect(stopped).toBe(true);
    expect(S.view.cx).toBe(cx);
    const post = calls.find(c => /\/api\/map-kill$/.test(c[0]));
    expect(post[1].method).toBe('POST');
    expect(JSON.parse(post[1].body)).toEqual({ zone: 'thedeep', name: 'a blood raven', point_id: 8, spawn_id: 4 });
  });
  it('an Engaged row posts no spot (the agent finds it) and its spawn id', async () => {
    const { all, calls } = await boot({ engaged: [{ name: 'a bat', spawn_id: null, hp_pct: null, n: 1 }] });
    kids(all.lists.children.find(c => /trow engaged/.test(c.className)))[0].listeners.click.forEach(f => f({ stopPropagation() {} }));
    expect(JSON.parse(calls.find(c => /\/api\/map-kill$/.test(c[0]))[1].body)).toEqual({ zone: 'thedeep', name: 'a bat', point_id: null, spawn_id: null });
  });
  it('the rows render the same each time, and the button sits in its own third grid column', async () => {
    const snap = (x) => x.all.lists.children.map(c => c.className + '|' + c.children.map(k => k.className + ':' + k.textContent).join(','));
    const a = await boot({ seen: SEEN, engaged: [{ name: 'a bat', spawn_id: 11, hp_pct: 50, n: 2 }] });
    const b = await boot({ seen: SEEN, engaged: [{ name: 'a bat', spawn_id: 11, hp_pct: 50, n: 2 }] });
    expect(snap(a)).toEqual(snap(b));
    expect(stripCss(MAP_HTML)).toMatch(/\.trow \.kill\{grid-column:3;grid-row:1 \/ span 2;/);
  });
});

// ───────────── map.html: hurt rows, the kite line, killed? ─────────────
// Mutation-checked: print "0 on it" for n 0; list an engaged-flagged seen row twice; drop the kite line; drop the ? on the button
// or the tag; drop the click on a promoted row.
describe('map.html: hurt engaged rows, the kite line and killed?', () => {
  const kids = (all, re) => all.lists.children.filter(c => re.test(c.className));
  it('an engaged row nobody targets says "hurt", a targeted one still says "N on it"', async () => {
    const { all } = await boot({ engaged: [{ name: 'a golem', spawn_id: 6, hp_pct: 93, n: 0, point_id: 9 }, { name: 'a bat', spawn_id: 7, hp_pct: 50, n: 2 }] });
    const [a, b] = kids(all, /trow engaged/);
    expect([a.children[1].textContent, a.children[1].children.map(k => k.textContent)]).toEqual(['hurt', ['93%']]);
    expect([b.children[1].textContent, b.children[1].children.map(k => k.textContent)]).toEqual(['2 on it', ['50%']]);
  });
  it('an Up · seen row says how many are on it, only when someone is', async () => {
    const { all } = await boot({ seen: [{ point_id: 7, spawn_id: 4, name: 'a blood raven', at: T0 - 60000, by: null, hp_pct: 100, n: 3 }, { point_id: 8, spawn_id: 5, name: 'a blood raven', at: T0 - 60000, by: null, hp_pct: 100 }] });
    const [a, b] = kids(all, /trow seen/);
    expect([a.children[1].textContent, b.children[1].textContent]).toEqual(['1m ago · 3 on it', '1m ago']);
  });
  it('a promoted row still has the kill button, and a click centres on its spawn point; a plain engaged row has no click', async () => {
    const { all } = await boot({ engaged: [{ name: 'a golem', spawn_id: 6, hp_pct: 93, n: 0, point_id: 9 }, { name: 'a bat', spawn_id: 7, hp_pct: 50, n: 2 }] });
    const [a, b] = kids(all, /trow engaged/);
    expect(a.children.some(k => k.className === 'kill')).toBe(true);
    expect((a.listeners.click || []).length).toBe(1);
    expect(b.listeners.click || []).toEqual([]);
  });
  it('a seen row the agent flagged as engaged is listed once, under Engaged', async () => {
    const { all } = await boot({ seen: [{ point_id: 9, spawn_id: 6, name: 'a golem', at: T0 - 1000, by: null, hp_pct: 93, engaged: true }, { point_id: 8, spawn_id: 5, name: 'a blood raven', at: T0 - 1000, by: null }],
      engaged: [{ name: 'a golem', spawn_id: 6, hp_pct: 93, n: 0, point_id: 9 }] });
    expect(kids(all, /trow seen/).map(r => r.children[0].textContent)).toEqual(['a blood raven']);
    expect(all.lists.children.some(c => c.textContent === 'Up · seen (1)')).toBe(true);
  });
  it('the kite line sits above the Engaged rows, reads as the agent sent it, and drops the HP total when unknown', async () => {
    const k = { n: 10, avg: 61, hp_left: 41200, unread: 3 };
    const eng = [{ name: 'a golem', spawn_id: 6, hp_pct: 93, n: 0, point_id: 9 }];
    const { all } = await boot({ engaged: eng, kite: k });
    expect(all.lists.children[1].className).toBe('kite');
    expect(all.lists.children[1].textContent).toBe('Kite: 10 mobs · avg 61% · ~41k HP left · 3 unread');
    const line = new Function(sliceBlock(MAP_HTML, 'function kiteLine(k) {', '\n  }\n') + '\nreturn kiteLine;')();
    expect(line({ n: 4, avg: 50, hp_left: null, unread: 0 })).toBe('Kite: 4 mobs · avg 50%');
    expect(line({ n: 2, avg: 50, hp_left: 800, unread: 1 })).toBe('Kite: 2 mobs · avg 50% · ~800 HP left · 1 unread');
    expect(line(null)).toBe(''); expect(line({ n: 1, avg: 5 })).toBe('');
    expect(line(k)).toBe(line(Object.assign({}, k)));    // same numbers, same text: no repaint for nothing
    const none = await boot({ engaged: eng });
    expect(none.all.lists.children.some(c => c.className === 'kite')).toBe(false);
  });
  it('killed? puts a ? on the kill button and a dim tag on the row, in Up · seen, Engaged and Watched', async () => {
    const { all } = await boot({ seen: [{ point_id: 8, spawn_id: 5, name: 'a blood raven', at: T0 - 1000, by: null, killed_q: true }, { point_id: 7, spawn_id: 4, name: 'a blood raven', at: T0 - 1000, by: null }],
      engaged: [{ name: 'a golem', spawn_id: 6, hp_pct: 93, n: 0, point_id: 9, killed_q: true }] });
    const btn = (r) => r.children.find(k => k.className === 'kill').textContent;
    const [q, plain] = kids(all, /trow seen/);
    expect([btn(q), q.children[2].textContent]).toEqual(['☠ killed?', 'spawn #5 · killed?']);
    expect([btn(plain), plain.children[2].textContent]).toEqual(['☠ killed', 'spawn #4']);
    const [e] = kids(all, /trow engaged/);
    expect([btn(e), e.children[2].textContent]).toEqual(['☠ killed?', 'spawn #6 · killed?']);
  });
});

// ───────────── tabbing quickly, and "killed?" (the guild lead, 2026-10-20) ─────────────
// Run through the real Spawn map core (liveCore). Mutation-checked: record health in the payload only (not _mapNoteState);
// pick the first candidate on an ambiguous death; start a timer for every candidate; let a death with a spawn id queue;
// keep a candidate after it is read alive; skip the explained-death drop in _mapNoteDeath; drop the n comparison.
describe('agent: quick tabbing and "killed?" through the real core', () => {
  const RAVENS = [[7, 21], [8, 22], [9, 23]];
  const raven = (c, ids) => {
    const zd = c._mapZoneDoc('thedeep');
    (ids || RAVENS).forEach(([p, id]) => { zd.seen[String(p)] = { point_id: p, spawn_id: id, name: 'A Blood Raven', at: N - 1000, by: null }; });
    return zd;
  };
  const frame = (c, at, id, hp, name) => c._mapNoteState('Aldenmar', null, { zone: 164, target_id: id, target_name: name || 'a blood raven', target_hp_pct: hp, target_type: 1 }, at);
  const seenOf = (c, at) => Object.fromEntries(c._mapStatePayload('', at).seen.map(s => [s.spawn_id, s]));

  it('fast tabbing: five spawns tabbed across between two Map polls all keep a health', () => {
    const { c } = liveCore();
    raven(c, [[7, 21], [8, 22], [9, 23]]);
    [[21, 90], [22, 80], [23, 70], [21, 85], [22, 75]].forEach(([id, hp], i) => frame(c, N + 100 * i, id, hp));
    const s = seenOf(c, N + 600);
    expect([21, 22, 23].map(id => [s[id].hp_pct, s[id].hp_live])).toEqual([[85, false], [75, false], [70, false]]);
    expect(s[22].hp_at).toBe(N + 400);
  });
  it('three same-name spawns, one death line: all three show killed?, no timer starts', () => {
    const { c } = liveCore(); raven(c);
    c._mapNoteLogDeath('a blood raven', 'Aldenmar', N, N + 100);
    const p = c._mapStatePayload('', N + 200);
    expect(p.timers).toEqual([]);
    expect(p.unassigned).toEqual([]);
    expect(p.seen.map(s => [s.spawn_id, !!s.killed_q])).toEqual([[21, true], [22, true], [23, true]]);
  });
  it('tab onto two alive ones: each clears its killed?; the third becomes the kill and gets the timer on its own spot', () => {
    const { c } = liveCore(); raven(c);
    c._mapNoteLogDeath('a blood raven', 'Aldenmar', N, N + 100);
    frame(c, N + 1000, 21, 90);
    let p = c._mapStatePayload('', N + 1100);
    expect(p.seen.map(s => [s.spawn_id, !!s.killed_q])).toEqual([[21, false], [22, true], [23, true]]);
    expect(p.timers).toEqual([]);
    frame(c, N + 2000, 22, 80);
    p = c._mapStatePayload('', N + 2100);
    expect(p.timers).toEqual([expect.objectContaining({ point_id: 9 })]);        // spawn 23 lived on point 9
    expect(p.seen.map(s => s.spawn_id)).toEqual([21, 22]);
    expect(p.seen.every(s => !s.killed_q)).toBe(true);
    expect(c._mapKilledQ.size).toBe(0);
  });
  // (with no position on the dead mob the old road files it under "Not pinned down"; the point is that it is ONE death, handled
  // as before, and nobody is asked "killed?")
  it('a death that names its spawn (a spawn id) works as before: one death, nobody gets a ?', () => {
    const { c } = liveCore(); raven(c);
    c._mapNoteState('Aldenmar', { zone: 164, target_id: 22, target_name: 'a blood raven', target_hp_pct: 10, target_type: 1 },
      { zone: 164, target_id: 22, target_name: "a blood raven's corpse", target_hp_pct: 0, target_type: 1 }, N + 100);
    const p = c._mapStatePayload('', N + 200);
    expect(c._mapKilledQ.size).toBe(0);
    expect(p.unassigned).toHaveLength(1);
    expect(p.seen.some(s => s.killed_q)).toBe(false);
  });
  it('a death line while that mob is your target names it too: no ?', () => {
    const { c } = liveCore(); raven(c);
    c._zealState.Aldenmar.target_name = 'a blood raven'; c._zealState.Aldenmar.target_id = 23;
    c._mapNoteLogDeath('a blood raven', 'Aldenmar', N, N + 100);
    const p = c._mapStatePayload('', N + 200);
    expect(c._mapKilledQ.size).toBe(0);
    expect(p.unassigned).toHaveLength(1);
    expect(p.seen.some(s => s.killed_q)).toBe(false);
  });
  it('exactly one candidate keeps today\'s behaviour (no ?)', () => {
    const { c } = liveCore(); raven(c, [[7, 21]]);
    c._mapNoteLogDeath('a blood raven', 'Aldenmar', N, N + 100);
    const p = c._mapStatePayload('', N + 200);
    expect(c._mapKilledQ.size).toBe(0);
    expect(p.seen.some(s => s.killed_q)).toBe(false);
  });
  it('the same line from a second log on this machine is one death, not two', () => {
    const { c } = liveCore(); raven(c);
    c._mapNoteLogDeath('a blood raven', 'Aldenmar', N, N + 100);
    c._mapNoteLogDeath('a blood raven', 'Aldenmar', N, N + 400);
    expect([...c._mapKilledQ.values()].map(g => g.n)).toEqual([1]);
  });
  it('two deaths and three candidates: reading one alive leaves two, which are the two dead ones', () => {
    const { c } = liveCore(); raven(c);
    c._mapNoteLogDeath('a blood raven', 'Aldenmar', N, N + 100);
    c._mapNoteLogDeath('a blood raven', 'Aldenmar', N + 5000, N + 5100);
    expect([...c._mapKilledQ.values()].map(g => g.n)).toEqual([2]);
    frame(c, N + 6000, 21, 90);
    const p = c._mapStatePayload('', N + 6100);
    expect(p.timers.map(t => t.point_id).sort()).toEqual([8, 9]);
  });
  // ── a corpse in your target window, or a Zeal "dead" tag, is proof that spawn id died ──
  const corpse = (c, at, id, name, prev) => c._mapNoteState('Aldenmar', prev || null, { zone: 164, target_id: id, target_name: name, target_hp_pct: 0, target_type: 2 }, at);
  it('targeting the corpse of a seen spawn takes it off Up · seen and starts the timer on its own spot, dated at its last health reading', () => {
    const { c } = liveCore(); raven(c);
    frame(c, N + 1000, 22, 80);
    corpse(c, N + 5000, 22, 'A Blood Raven`s corpse230');
    const p = c._mapStatePayload('', N + 5100);
    expect(p.timers).toEqual([expect.objectContaining({ point_id: 8, died_at: N + 1000 })]);   // why: 'read'
    expect(p.seen.map(s => s.spawn_id)).toEqual([21, 23]);
    expect(p.unassigned).toEqual([]);
  });
  it('the death time is the EARLIEST death line after its last reading; with no reading and no line, now', () => {
    const a = liveCore().c; raven(a);
    frame(a, N + 1000, 22, 80);
    a._mapNoteLogDeath('a blood raven', 'Aldenmar', N + 3000, N + 3100);   // after the reading: the earliest such line
    a._mapNoteLogDeath('a blood raven', 'Aldenmar', N + 9000, N + 9100);
    a._mapNoteLogDeath('a blood raven', 'Aldenmar', N - 5000, N + 9200);   // before the reading: not this spawn's
    corpse(a, N + 10000, 22, 'a blood raven`s corpse');
    expect(a._mapStatePayload('', N + 10100).timers).toEqual([expect.objectContaining({ point_id: 8, died_at: N + 3000 })]);
    const b = liveCore().c; raven(b);
    corpse(b, N + 5000, 23, "a blood raven's corpse");
    expect(b._mapStatePayload('', N + 5100).timers).toEqual([expect.objectContaining({ point_id: 9, died_at: N + 5000 })]);   // why: 'now'
  });
  it('it resolves a 3-way killed?: that spawn is the dead one and the other two lose their ?', () => {
    const { c } = liveCore(); raven(c);
    c._mapNoteLogDeath('a blood raven', 'Aldenmar', N, N + 100);
    expect(c._mapKilledQ.size).toBe(1);
    corpse(c, N + 3000, 21, 'A Blood Raven`s corpse');
    const p = c._mapStatePayload('', N + 3100);
    expect(c._mapKilledQ.size).toBe(0);
    expect(p.timers).toEqual([expect.objectContaining({ point_id: 7, died_at: N })]);
    expect(p.seen.map(s => [s.spawn_id, !!s.killed_q])).toEqual([[22, false], [23, false]]);
  });
  it('with two deaths queued, one corpse accounts for one of them and the other two stay in question', () => {
    const { c } = liveCore(); raven(c);
    c._mapNoteLogDeath('a blood raven', 'Aldenmar', N, N + 100);
    c._mapNoteLogDeath('a blood raven', 'Aldenmar', N + 5000, N + 5100);
    corpse(c, N + 6000, 21, 'a blood raven`s corpse');
    const p = c._mapStatePayload('', N + 6100);
    expect(p.timers.map(t => t.point_id)).toEqual([7]);
    expect(p.seen.map(s => [s.spawn_id, !!s.killed_q])).toEqual([[22, true], [23, true]]);
  });
  it('an already-killed spawn adds nothing, however many times its corpse is targeted', () => {
    const { c } = liveCore(); raven(c);
    corpse(c, N + 5000, 22, 'a blood raven`s corpse');
    const first = JSON.stringify(c._mapStatePayload('', N + 5100).timers);
    corpse(c, N + 9000, 22, 'a blood raven`s corpse');
    corpse(c, N + 9500, 22, "a blood raven's corpse");
    const p = c._mapStatePayload('', N + 9600);
    expect(JSON.stringify(p.timers)).toBe(first);
    expect(p.timers).toHaveLength(1); expect(p.unassigned).toEqual([]);
  });
  it('the backtick, the straight apostrophe and the curly one all read as a corpse; a player corpse or another mob\'s id does nothing', () => {
    const { c } = liveCore(); raven(c);
    corpse(c, N + 1000, 21, 'a blood raven`s corpse');
    corpse(c, N + 2000, 22, "a blood raven's corpse");
    corpse(c, N + 3000, 23, 'a blood raven’s corpse7');
    expect(c._mapStatePayload('', N + 3100).timers.map(t => t.point_id).sort()).toEqual([7, 8, 9]);
    const d = liveCore().c; raven(d);
    corpse(d, N + 1000, 21, 'Aldenmar`s corpse');                      // a player's corpse
    corpse(d, N + 2000, 99, 'a blood raven`s corpse');                 // an id that was never listed alive
    corpse(d, N + 3000, 22, 'a decaying skeleton`s corpse');           // right id, wrong name
    const p = d._mapStatePayload('', N + 3100);
    expect(p.timers).toEqual([]); expect(p.seen.map(s => s.spawn_id)).toEqual([21, 22, 23]);
  });
  it('a corpse in the Extended Target rows counts the same way', () => {
    const { c } = liveCore(); raven(c);
    c._extTargetCache.set('aldenmar', { at: N, payload: { targets: [{ name: 'A Blood Raven`s corpse', kind: 'npc', spawn_id: 23, raider_count: 1, hp_pct: 0 }] } });
    const p = c._mapStatePayload('', N + 100);
    expect(p.timers).toEqual([expect.objectContaining({ point_id: 9 })]);
  });
  it('a Zeal tag reading "dead" (any case, spaces trimmed) on a spawn id is the same confirmation; other text or an old tag is not', () => {
    const { c } = liveCore(); raven(c);
    const tag = (text, tsMs) => ({ spawn_id: 22, mob: 'a blood raven', text, tsMs });
    expect(c._mapNoteTagDead('Aldenmar', tag('deadly', N), N + 100)).toBeNull();
    expect(c._mapNoteTagDead('Aldenmar', tag('dead', N - 120000), N + 100)).toBeNull();
    expect(c._mapStatePayload('', N + 200).timers).toEqual([]);
    expect(c._mapNoteTagDead('Aldenmar', tag('  DeAd ', N), N + 300)).toMatchObject({ why: 'now' });
    expect(c._mapNoteTagDead('Aldenmar', tag('dead', N), N + 400)).toBeNull();      // already counted
    expect(c._mapStatePayload('', N + 500).timers).toEqual([expect.objectContaining({ point_id: 8 })]);
  });
  it('the tag channel line reaches it: "^R^dead" on spawn 22 heard in a log line', () => {
    const calls = [];
    const f = new Function('_mapNoteTagDead', 'parseEqTimestamp', sliceBlock(AGENT, 'const _ZEAL_TAG_SHAPES', 'return applied;\n}') + '\nreturn { noteTagChannelLine, _zealTags };');
    const r = f((ch, tag, now) => { calls.push([ch, tag && tag.spawn_id, tag && tag.text]); return null; }, () => new Date());
    expect(r.noteTagChannelLine("[Tue Oct 20 20:00:05 2026] Corvale tells the raid, 'ZEALTAG | ^R^dead | a blood raven | 22'", 'Aldenmar')).toBe(true);
    expect(calls).toEqual([['Aldenmar', 22, 'dead']]);
  });
  it('the ☠ button on a killed? row (a spawn id) confirms that one and drops the question for the rest', () => {
    const { c } = liveCore(); raven(c);
    c._mapNoteLogDeath('a blood raven', 'Aldenmar', N, N + 100);
    const r = c._mapKillNow('thedeep', { name: 'a blood raven', point_id: 8, spawn_id: 22 }, N + 500, 'Aldenmar');
    expect(r.ok).toBe(true);
    const p = c._mapStatePayload('', N + 600);
    expect(p.timers).toEqual([expect.objectContaining({ point_id: 8 })]);
    expect(p.seen.some(s => s.killed_q)).toBe(false);
  });
});

// ───────────── Right-click on a spawn switches it off and on ─────────────
// (the guild lead, 2026-10-23: "right clicking on a spawn should toggle the spawn off and on in the map"). A running respawn
// timer = off: the right-click clears it (/api/map-mark kind clear, back up). Anything else = on: a mob seen alive there is
// killed by name (/api/map-kill, the ☠ killed button), a spot with nobody seen is marked killed (/api/map-mark kind killed).
// The agent already had both halves; this is the overlay: the pure choice, the toast words, the dot and the list rows, and
// the stage's "centre on you" staying out of it. Text assertions strip comments first. Mutation-checked: make spawnToggle
// always kill; drop the clear branch; drop stopPropagation on the dot; send the row through postMark only.
describe('map.html: right-click a spawn to switch it off and on', () => {
  const TOG = new Function(helpers + '\nreturn { spawnToggle, spawnToggleWords };')();
  const calls_ = (calls, ep) => calls.filter(([u]) => u.endsWith(ep)).map(([, o]) => JSON.parse(o.body));
  const evt = (target) => { const e = { target: target || null, prevented: 0, stopped: 0 }; e.preventDefault = () => { e.prevented++; }; e.stopPropagation = () => { e.stopped++; }; return e; };
  const dot = (pid) => ({ getAttribute: (k) => (k === 'data-pid' ? String(pid) : null) });
  const fire = (el, type, e) => (el.listeners[type] || []).forEach(f => f(e));
  const sent = async (calls, ep) => { await tick(); return calls_(calls, ep); };

  it('a running timer is "off": the choice is clear, whatever else is known', () => {
    expect(TOG.spawnToggle(T(8, 'a blood raven', 300000, 400000), null)).toEqual({ act: 'clear' });
    expect(TOG.spawnToggle(T(8, 'a blood raven', 300000, 400000), { name: 'a blood raven', spawn_id: 4 })).toEqual({ act: 'clear' });
  });
  it('a mob seen alive is killed by name (the ☠ killed button); a spot with nobody seen is marked killed', () => {
    expect(TOG.spawnToggle(null, { name: 'a blood raven', spawn_id: 4 })).toEqual({ act: 'kill', name: 'a blood raven', spawn_id: 4 });
    expect(TOG.spawnToggle(undefined, { name: 'a blood raven' })).toEqual({ act: 'kill', name: 'a blood raven', spawn_id: null });
    expect(TOG.spawnToggle(undefined, undefined)).toEqual({ act: 'mark' });
    expect(TOG.spawnToggle(null, { at: T0 })).toEqual({ act: 'mark' });   // seen, but nothing says what: still just "killed"
  });
  it('the toast says what happened: back up, killed with the respawn window, or why nothing changed', () => {
    const t = T(8, 'a blood raven', 400000, 500000);
    expect(TOG.spawnToggleWords('Spot', 'clear', { ok: true, cleared: true }, T0)).toBe('Spot — back up');
    expect(TOG.spawnToggleWords('Spot', 'mark', { ok: true, timer: t }, T0)).toBe('Spot — killed · up in 6m40s–8m20s');
    expect(TOG.spawnToggleWords('Spot', 'kill', { ok: true, kind: 'unassigned' }, T0)).toBe('Spot — killed');
    expect(TOG.spawnToggleWords('Spot', 'mark', { ok: false, error: 'this spawn point has no respawn time' }, T0)).toBe('Spot — this spawn point has no respawn time');
    expect(TOG.spawnToggleWords('Spot', 'mark', null, T0)).toBe('Spot — the agent did not answer');
  });

  it('right-click on an UP dot posts the kill; the same dot with a timer posts the clear', async () => {
    const up = await boot({});
    const hit = up.all.hits;
    const e1 = evt(dot(8));
    fire(hit, 'contextmenu', e1);
    expect(await sent(up.calls, '/api/map-mark')).toEqual([{ zone: 'thedeep', point_id: 8, kind: 'killed' }]);
    expect(calls_(up.calls, '/api/map-kill')).toEqual([]);
    expect(e1.prevented).toBe(1);

    const timed = await boot({ timers: [T(8, 'a blood raven', 300000, 400000)] });
    fire(timed.all.hits, 'contextmenu', evt(dot(8)));
    expect(await sent(timed.calls, '/api/map-mark')).toEqual([{ zone: 'thedeep', point_id: 8, kind: 'clear' }]);
  });
  it('a dot with a mob seen alive on it is killed by name, like the ☠ killed button', async () => {
    const b = await boot({ seen: [{ point_id: 7, spawn_id: 4, name: 'a blood raven', at: T0 - 60000, by: null }] });
    fire(b.all.hits, 'contextmenu', evt(dot(7)));
    expect(await sent(b.calls, '/api/map-kill')).toEqual([{ zone: 'thedeep', name: 'a blood raven', point_id: 7, spawn_id: 4 }]);
    expect(calls_(b.calls, '/api/map-mark')).toEqual([]);
  });
  it('the dot\'s right-click stops at the dot: the stage\'s centre-on-you never hears it', async () => {
    const b = await boot({});
    const e = evt(dot(8));
    fire(b.all.hits, 'contextmenu', e);
    expect(e.stopped).toBe(1);
    // and the stage still centres on you for a right-click on the empty map
    const before = b.S.view.cx;
    b.S.view.cx = before + 500;
    const e2 = evt(null);
    fire(b.all.stage, 'contextmenu', e2);
    expect(e2.prevented).toBe(1);
    expect(b.S.view.cx).not.toBe(before + 500);
  });
  it('a click on the dot still opens the menu (left click is unchanged)', async () => {
    const js = stripJs(MAP_HTML);
    expect(js).toMatch(/hitsEl\.addEventListener\('click', function \(e\) \{ var pid = hitFor\(e\); if \(pid\) \{ card\.style\.display = 'none'; openMenu\(pid, e\); \} \}\);/);
    expect(js).toMatch(/stage\.addEventListener\('contextmenu', function \(e\) \{/);
  });

  it('list rows: Respawns clears the soonest, Up · seen kills that mob, Engaged kills by name; each row is armed for the click-through window', async () => {
    const b = await boot({
      timers: [T(8, 'a blood raven', 300000, 400000), T(9, 'a blood raven', 100000, 200000)],
      seen: [{ point_id: 7, spawn_id: 4, name: 'a blood raven', at: T0 - 60000, by: null }],
      engaged: [{ name: 'a golem', spawn_id: 6, hp_pct: 70, n: 0 }],
    });
    const rows = b.all.lists.children.filter(c => /trow/.test(c.className));
    const rowOf = (re) => rows.find(r => re.test(r.className));
    for (const r of rows) { expect(r.attrs['data-wp-interact']).toBe(''); const e = evt(); fire(r, 'contextmenu', e); expect([e.prevented, e.stopped]).toEqual([1, 1]); }
    expect(rowOf(/\bwait\b/)).toBeTruthy();
    await tick();
    expect(calls_(b.calls, '/api/map-mark')).toEqual([{ zone: 'thedeep', point_id: 9, kind: 'clear' }]);   // the soonest of the folded row
    expect(calls_(b.calls, '/api/map-kill')).toEqual([
      { zone: 'thedeep', name: 'a golem', point_id: null, spawn_id: 6 },     // Engaged first in the list
      { zone: 'thedeep', name: 'a blood raven', point_id: 7, spawn_id: 4 },
    ]);
  });
  it('the toast element exists, never takes the mouse, and the empty-list hint mentions the right-click', () => {
    const css = stripCss(MAP_HTML), js = stripJs(MAP_HTML);
    expect(MAP_HTML).toMatch(/<div id="toast"><\/div>/);
    expect(css).toMatch(/#toast\{[^}]*pointer-events:none/);
    expect(js).toMatch(/right-click a dot to switch it off and on/);
  });
});
