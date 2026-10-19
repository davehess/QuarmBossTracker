// The spawn map (Mimic 2.9, first build: the 2D tracker overlay) - the guild lead, 2026-10-12:
// "2d overlay on beta with spawn timer tracking". DECISIONS 218 / 220 / 221.
//
// Agent half: the "Spawn map core" block of packages/wolfpack-logsync/index.js, source-sliced and run as shipped
// (the coordinate swap, which spawn point a death is credited to, the respawn window and its colour, the three
// mark kinds, persistence, the /api/map-state `have=` cache, local mode). Overlay half: apps/mimic/map.html's pure
// helpers, run as shipped, checked against the agent's own copy of the timer rule, plus a smoke run of its script
// against a stub page. Mutation-checked: the 60/2x attribution rules and the window maths each fail a test when
// broken (see the notes by those tests).
//
// Run: npx vitest run test/spawn-map.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { EventEmitter } from 'node:events';
import { readSource, sliceBlock, stripJs, stripCss, AGENT_INDEX, ROOT } from './_source-slice.js';

const AGENT = readSource(AGENT_INDEX);
const CORE = sliceBlock(AGENT, '// ── Spawn map core (Mimic 2.9', '// ── end Spawn map core ──');
const MAP_HTML = readSource(path.join(ROOT, 'apps', 'mimic', 'map.html'));
const MAIN = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));

const EXPORTS = ['_mapServerXY', '_mapZoneShort', '_mapNormName', '_mapAttribute', '_mapMakeTimer', '_mapTimerState',
  '_mapApplyMark', '_mapNoteDeath', '_mapNoteState', '_mapNoteLogDeath', '_mapStatePayload', '_mapSaveNow', '_mapDoc',
  '_mapZoneDoc', '_mapPrune', '_mapEnsureZone', '_mapPaths', '_zealState', '_setRaid', '_setOpts', 'MAP_ZONE_SHORT',
  '_mapTryPin', '_mapPinGet', '_mapSync', '_mapSyncStop', '_mapSyncFlush', '_mapSyncPull', '_mapApplyRemote', '_mapLocalEvent',
  '_mapSegDist', '_mapRouteDist', '_mapCopy', '_mapCopyNoteWho', '_mapCurrentCopy', '_mapCopyInfo', 'whoData',
  '_mapNoteCon', '_mapConsFor', '_mapMe', '_mapQuarmyIds', '_mapNoteLeg', '_mapNotePath', '_mapFocusTarget', '_extTargetCache', '_mapCcStates', '_buffLandingsByTarget', '_spellByNameLower',
  'MAP_TRACKED_PATHS', 'MAP_CORPSE_RE', '_mapDist2', '_mapMergePath', '_mapShownPath', '_mapApplyShared', '_mobInfoByName', '_mobInfoFetches'];
// The agent's real /consider tiers, for _mapNoteCon (they live outside the map core).
const CON_DEFS = AGENT.slice(AGENT.indexOf('const CON_STANDINGS = ['), AGENT.indexOf('\n', AGENT.indexOf('const _CON_RX = ')));
// The agent's real lull line and mez test, for _mapCcStates (also outside the map core).
const LULL_DEFS = sliceBlock(AGENT, '// ── Pacify / lull line (SPA 30', 'return PACIFY_AE.has(String(name).toLowerCase().replace(/`/g, "\'").trim());\n}');
// The agent's real "the NPC the most raiders are on" answer, which the Map's focus highlight reuses.
const MAIN_TARGET_DEF = sliceBlock(AGENT, 'function _resolveMainTarget(activeCharacter) {', 'raider_count: best.raider_count || 0 } : null;\n}');
const MEZ_DEF = sliceBlock(AGENT, 'function _isMezSpell(name) {', "includes('mez'));\n}");

// Stand the block up over a temp dir and fake network modules.
function loadCore({ dir, opts, net }) {
  const prelude = `
    const STATS_FILE = path.join(__tmp, 'logsync.stats.json');
    let _uploadOpts = __opts;
    const _setOpts = (o) => { _uploadOpts = o; };
    function _localOnly() { return !!(_uploadOpts && !_uploadOpts.token); }
    function _controlStandDown() { return { down: false }; }
    const AGENT_VERSION = 'test';
    const _zealState = {};
    let _lastRaidPipe = null;
    const _setRaid = (v) => { _lastRaidPipe = v; };
    function _zoneName(id) { return id === 164 ? 'The Deep' : null; }
    function _eqSetupDirs() { return []; }   // no EQ folder: the local map files are covered by test/map-local-files.test.js
    const whoData = new Map();               // the agent's /who registry (lower-cased name -> { guild, ... })
    function _classOf(c) { const w = whoData.get(String(c || '').toLowerCase()); return w && w.class ? w.class : null; }
    const _buffLandingsByTarget = new Map(); // what Target Info keeps: lower-cased mob -> Map(key -> landing)
    const _spellByNameLower = new Map();     // the spell catalog, for the mez test
    ${LULL_DEFS}
    ${MEZ_DEF}
    ${CON_DEFS}
    const _mobInfoByName = new Map();        // Target Info's mob-info cache: key -> { at, mob } (the Area Rampage ring reads it)
    const MOB_INFO_TTL_MS = 6 * 60 * 60 * 1000;
    const _mobInfoFetches = [];
    function _mobInfoCacheKey(name, zoneId) { return String(name).toLowerCase() + '|' + (zoneId != null ? zoneId : '*'); }
    function fetchMobInfo(name, ch, zoneId) { _mobInfoFetches.push([name, ch, zoneId]); }
    const _extTargetCache = new Map();       // the Extended Target aggregate: lower-cased character -> { at, payload }
    function fetchExtendedTarget() {}
    ${MAIN_TARGET_DEF}
  `;
  // eslint-disable-next-line no-new-func
  const f = new Function('fs', 'path', 'http', 'https', 'zlib', '__dirname', '__tmp', '__opts',
    prelude + '\n' + CORE + `\nreturn { ${EXPORTS.join(', ')} };`);
  const c = f(fs, path, net.http, net.https, zlib, dir, dir, opts);
  c._mapPaths.cache = path.join(dir, 'zone-spawns-cache');
  c._mapPaths.timers = path.join(dir, 'map_timers.json');
  c._mapPaths.brewall = null;   // no Brewall download in these tests (test/map-local-files.test.js covers it)
  cores.push(c);
  return c;
}

// http / https that record every request and answer from `responder(opts) -> { status, body?, etag? }`.
function fakeNet(responder) {
  const calls = [];
  const mod = {
    request(o, cb) {
      calls.push(o);
      const req = {
        on() { return req; }, destroy() {},
        end(body) {
          o.__body = body ? Buffer.from(body).toString('utf8') : null;   // what a POST sent
          setImmediate(() => {
            const r = responder ? responder(o) : { status: 500 };
            const res = new EventEmitter();
            res.statusCode = r.status; res.headers = r.etag ? { etag: r.etag } : {};
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
// One zone-in as EverQuest writes it to dbg.txt (shape from members' real files, docs/DESIGN-mimic-2.9-spawn-map.md).
const dbgZoneIn = (ts, port, zone) => [
  `[${ts}]00521:Zone addr [pq.projectquarm.pq3.projectquarm.com:${port}] received...`,
  `[${ts}]00522:Zone info received.`,
  `[${ts}]00523:         StartWorldDisplay: ${zone}`,
].join('\r\n') + '\r\n';

// A small zone in the SERVER frame. skel: three skeleton points, two of them 150 apart (p1, p6) so the
// "clearly closer" rule has something to bite on. Zone id 164 = thedeep.
const NPC = (name, extra) => Object.assign({ name, level: 50, chance: 100, named: false, raid_target: false, badges: [], aggro: 60, fac: 1, assist: null, pf: 0 }, extra || {});
const POINTS = [
  { id: 1, x: 100, y: 200, z: 0, respawn_s: 600, variance_s: 60, npcs: [NPC('a_decaying_skeleton')] },
  { id: 2, x: 400, y: 200, z: 0, respawn_s: 600, variance_s: 60, npcs: [NPC('a_decaying_skeleton')] },
  { id: 3, x: 1000, y: 1000, z: 0, respawn_s: 1200, variance_s: 0, npcs: [NPC('a_decaying_skeleton', { chance: 60 }), NPC('Lord_Nagafen', { chance: 5, named: true, badges: ['eye'] })] },
  { id: 4, x: 5000, y: 0, z: 0, respawn_s: 1700000, variance_s: 0, npcs: [NPC('a_bat')] },
  { id: 5, x: -3000, y: -3000, z: 20, respawn_s: 3600, variance_s: 360, npcs: [NPC('Aldenmar_the_Pale', { raid_target: true, named: true })] },
  { id: 6, x: 150, y: 200, z: 0, respawn_s: 600, variance_s: 60, npcs: [NPC('a_decaying_skeleton')] },
];
const ZONE_BODY = {
  zone: 'thedeep', long_name: 'The Deep', generated_at: '2026-10-12T00:00:00Z', points: POINTS,
  map: { bands: [0, 20], segs: [[0, 0, 100, 0, 0], [0, 0, 0, 100, 1]], bounds: { minX: -3000, maxX: 5000, minY: -3000, maxY: 1000 } },
};
const T0 = Date.UTC(2026, 9, 12, 20, 0, 0);

let dir;
const cores = [];
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spawnmap-')); });
afterEach(() => {
  for (const k of cores.splice(0)) { try { k._mapSaveNow(); k._mapSyncStop(); } catch { /* nothing to flush */ } }   // also clears the debounce timers
  fs.rmSync(dir, { recursive: true, force: true });
});

function seedCache(d, body = ZONE_BODY, fetchedAt = T0) {
  fs.mkdirSync(path.join(d, 'zone-spawns-cache'), { recursive: true });
  fs.writeFileSync(path.join(d, 'zone-spawns-cache', 'thedeep.json'), JSON.stringify({ etag: '"v1"', fetched_at: fetchedAt, body }));
}
// A loaded core with the zone on disk, local mode (no token => no network at all).
function localCore() {
  seedCache(dir);
  const net = fakeNet();
  const c = loadCore({ dir, opts: { botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: '' }, net });
  c._mapEnsureZone('thedeep', 164, T0);
  // Aldenmar is playing in The Deep (a state that never goes stale, so any `now` a test picks is "live").
  c._zealState.Aldenmar = { zone: 164, updatedAt: 1e18, loc: { x: 0, y: 0, z: 0 } };
  return { c, net };
}

describe('the coordinate swap', () => {
  it('Zeal pipe {x,y} -> server frame: server x = pipe y, server y = pipe x', () => {
    const { c } = localCore();
    expect(c._mapServerXY({ x: 10, y: 20, z: 5 })).toEqual({ x: 20, y: 10, z: 5 });
    expect(c._mapServerXY({ x: -3, y: 7 })).toEqual({ x: 7, y: -3, z: 0 });
    expect(c._mapServerXY(null)).toBeNull();
    expect(c._mapServerXY({ x: 'a', y: 1 })).toBeNull();
  });
  it('agrees with the website: web/lib/spectator.ts serverXY is the same swap', () => {
    const { c } = localCore();
    const ts = readSource(path.join(ROOT, 'web', 'lib', 'spectator.ts'));
    expect(ts).toMatch(/export function serverXY\(locX: number, locY: number\)[\s\S]{0,60}?return \{ x: locY, y: locX \};/);
    expect(c._mapServerXY({ x: 1, y: 2 })).toMatchObject({ x: 2, y: 1 });
  });
  it('/api/map-state reports you, your group, the raid and your target in the server frame', () => {
    const { c } = localCore();
    c._zealState.Aldenmar = {
      zone: 164, updatedAt: T0, loc: { x: 10, y: 20, z: 5 }, heading: 128,
      group_members: [{ name: 'Brackwyn', loc: { x: 1, y: 2, z: 3 }, heading: 0, class: 'Cleric' }, { name: 'Aldenmar', loc: { x: 10, y: 20, z: 5 } }, { name: 'Nolocman', loc: null }],
      target_name: 'a decaying skeleton', target_id: 77, target_hp_pct: 80, target_loc: { x: 7, y: 9, z: 0 },
    };
    c._setRaid({ at: T0, members: [{ name: 'Corvale', class: 'Wizard', loc_x: 30, loc_y: 40, loc_z: 1, heading: 12 }, { name: 'Brackwyn', loc_x: 1, loc_y: 2, loc_z: 3 }] });
    const p = c._mapStatePayload('', T0 + 1000);
    expect(p.zone).toBe('thedeep');
    expect(p.self).toMatchObject({ x: 20, y: 10, z: 5, heading: 128, name: 'Aldenmar' });
    expect(p.group).toEqual([expect.objectContaining({ name: 'Brackwyn', x: 2, y: 1 })]);   // not you, not the one with no position
    expect(p.raid).toEqual([expect.objectContaining({ name: 'Corvale', x: 40, y: 30 })]);   // Brackwyn is already in the group
    expect(p.target).toMatchObject({ name: 'a decaying skeleton', id: 77, x: 9, y: 7 });
    expect(p.target.dist).toBe(Math.round(Math.hypot(9 - 20, 7 - 10)));
  });
  it('knows every zone id the eqemu_zone table has, and nothing it does not', () => {
    const { c } = localCore();
    expect(c._mapZoneShort(164)).toBe('thedeep');
    expect(c._mapZoneShort(158)).toBe('vexthal');
    expect(c._mapZoneShort(7)).toBeNull();
    expect(c._mapZoneShort(null)).toBeNull();
  });
});

describe('attribution: which spawn point did a death come from', () => {
  let c;
  beforeEach(() => { ({ c } = localCore()); });
  const at = (x, y) => ({ x, y });
  it('assigns to the nearest point that can produce the name when it is within 60 and clearly closest', () => {
    // p1 (100,200) is 5.4 away; the next skeleton point, p6 (150,200), is 45.5 away (>= 2x).
    const a = c._mapAttribute(POINTS, 'a decaying skeleton', at(105, 202));
    expect(a).toMatchObject({ kind: 'assigned', point_id: 1 });
  });
  it('matches the name however it is spelled: catalog, log, capitalised, corpse', () => {
    for (const n of ['a_decaying_skeleton', 'A Decaying Skeleton', "a decaying skeleton's corpse", 'a decaying skeleton00']) {
      expect(c._mapAttribute(POINTS, n, at(105, 202)).kind, n).toBe('assigned');
    }
  });
  it('is unassigned when the nearest is more than 60 away, with up to four candidates nearest first', () => {
    const a = c._mapAttribute(POINTS, 'a decaying skeleton', at(250, 200));
    expect(a.kind).toBe('unassigned');
    expect(a.candidates).toEqual([6, 1, 2, 3]);
  });
  it('the 60-unit line: exactly 60 away still counts, 60.5 does not (even with no other point near)', () => {
    const pts = [{ id: 'a', x: 0, y: 0, npcs: [NPC('a_bat')] }, { id: 'b', x: 1000, y: 0, npcs: [NPC('a_bat')] }];
    expect(c._mapAttribute(pts, 'a bat', at(60, 0))).toMatchObject({ kind: 'assigned', point_id: 'a' });
    expect(c._mapAttribute(pts, 'a bat', at(60.5, 0)).kind).toBe('unassigned');
  });
  it('is unassigned when a second point is not clearly farther (less than twice as far)', () => {
    // from (125,200): p1 and p6 are both 25 away - a tie can never be "clearly closer"
    expect(c._mapAttribute(POINTS, 'a decaying skeleton', at(125, 200)).kind).toBe('unassigned');
    // from (120,200): p1 is 20 away, p6 30 away (1.5x) - close, but not clear
    expect(c._mapAttribute(POINTS, 'a decaying skeleton', at(120, 200))).toMatchObject({ kind: 'unassigned', candidates: [1, 6, 2, 3] });
    // from (110,200): p1 is 10 away, p6 40 away (4x) - clear
    expect(c._mapAttribute(POINTS, 'a decaying skeleton', at(110, 200))).toMatchObject({ kind: 'assigned', point_id: 1 });
  });
  it('the twice-as-far line sits exactly at 2x: best 30 / next 59 is unclear, best 30 / next 61 is clear', () => {
    const pts = [
      { id: 'a', x: 0, y: 0, npcs: [NPC('a_bat')] },
      { id: 'b', x: 89, y: 0, npcs: [NPC('a_bat')] },   // from (30,0): a=30, b=59
    ];
    expect(c._mapAttribute(pts, 'a bat', at(30, 0)).kind).toBe('unassigned');
    pts[1].x = 91;                                       // b=61
    expect(c._mapAttribute(pts, 'a bat', at(30, 0))).toMatchObject({ kind: 'assigned', point_id: 'a' });
  });
  it('ignores a name no point can produce', () => {
    expect(c._mapAttribute(POINTS, 'Aldenmar', at(0, 0)).kind).toBe('none');
    expect(c._mapAttribute(POINTS, '', at(0, 0)).kind).toBe('none');
  });
  it('with no position at all: a name with one point is assigned, with several it is listed with no rings', () => {
    expect(c._mapAttribute(POINTS, 'Aldenmar the Pale', null)).toMatchObject({ kind: 'assigned', point_id: 5 });
    expect(c._mapAttribute(POINTS, 'a decaying skeleton', null)).toEqual({ kind: 'unassigned', candidates: [] });
  });
  it('a single candidate far away is still a "?" (the 60 cap), not a guess', () => {
    expect(c._mapAttribute(POINTS, 'Aldenmar the Pale', at(0, 0))).toMatchObject({ kind: 'unassigned', candidates: [5] });
  });
});

describe('the respawn window and its colour', () => {
  let c;
  beforeEach(() => { ({ c } = localCore()); });
  it('is respawn minus/plus variance after the death, as a range', () => {
    const t = c._mapMakeTimer(POINTS[0], T0, 'seen', 'a decaying skeleton');
    expect(t).toMatchObject({ point_id: 1, died_at: T0, source: 'seen', earliest: T0 + 540000, latest: T0 + 660000 });
  });
  it('never opens before the death, and has no window for the 1,700,000 s instance rows', () => {
    const t = c._mapMakeTimer({ id: 9, respawn_s: 30, variance_s: 300, npcs: [] }, T0, 'seen', 'x');
    expect(t.earliest).toBe(T0);
    expect(c._mapMakeTimer(POINTS[3], T0, 'seen', 'a bat')).toBeNull();
    expect(c._mapMakeTimer({ id: 9, respawn_s: 0, npcs: [] }, T0, 'seen', 'x')).toBeNull();
  });
  it('is red before the window, flashes when it opens, yellow inside, green after', () => {
    const t = c._mapMakeTimer(POINTS[0], T0, 'seen', 'x');   // 540 s .. 660 s
    expect(c._mapTimerState(t, T0 + 1000)).toBe('wait');
    expect(c._mapTimerState(t, T0 + 539999)).toBe('wait');
    expect(c._mapTimerState(t, T0 + 540000)).toBe('flash');
    expect(c._mapTimerState(t, T0 + 554999)).toBe('flash');
    expect(c._mapTimerState(t, T0 + 555000)).toBe('window');
    expect(c._mapTimerState(t, T0 + 659999)).toBe('window');
    expect(c._mapTimerState(t, T0 + 660000)).toBe('up');
    expect(c._mapTimerState(t, T0 + 9e6)).toBe('up');
  });
  it('a point with no variance flashes for 15 s at its time, then is up', () => {
    const t = c._mapMakeTimer(POINTS[2], T0, 'seen', 'x');   // 1200 s exactly
    expect(c._mapTimerState(t, T0 + 1199999)).toBe('wait');
    expect(c._mapTimerState(t, T0 + 1200000)).toBe('flash');
    expect(c._mapTimerState(t, T0 + 1215000)).toBe('up');
  });
  it('a timer is kept until ten minutes past the end of its window, then dropped', () => {
    const { c: k } = localCore();
    k._mapNoteDeath('thedeep', { name: 'a decaying skeleton', spawn_id: 5, loc: { x: 100, y: 200 }, at: T0, src: 'zeal' }, T0);
    const zd = k._mapZoneDoc('thedeep');
    expect(Object.keys(zd.timers)).toEqual(['1']);
    k._mapPrune(zd, POINTS, T0 + 660000 + 600000);
    expect(Object.keys(zd.timers)).toEqual(['1']);
    k._mapPrune(zd, POINTS, T0 + 660000 + 600001);
    expect(Object.keys(zd.timers)).toEqual([]);
  });
  it('a timer follows its point\'s respawn when the zone data changes (2026-10-13)', () => {
    // the guild lead, Bastion of Thunder named, killed while the cached zone data still said 6 h: "Still has the
    // wrong timers". The window is re-worked from the death time and the point's current respawn.
    const { c: k } = localCore();
    k._mapNoteDeath('thedeep', { name: 'a decaying skeleton', spawn_id: 5, loc: { x: 100, y: 200 }, at: T0, src: 'zeal' }, T0);
    const zd = k._mapZoneDoc('thedeep');
    const long = POINTS.map(p => p.id === 1 ? Object.assign({}, p, { respawn_s: 21600, variance_s: 0 }) : p);
    k._mapPrune(zd, long, T0 + 1000);
    expect(zd.timers['1'].earliest).toBe(T0 + 21600000);                  // 6 h while the data says 6 h
    const short = POINTS.map(p => p.id === 1 ? Object.assign({}, p, { respawn_s: 10800, variance_s: 0 }) : p);
    k._mapPrune(zd, short, T0 + 2000);
    expect(zd.timers['1'].earliest).toBe(T0 + 10800000);                  // 3 h once it says 3 h
    expect(zd.timers['1'].latest).toBe(T0 + 10800000);
    expect(zd.timers['1'].died_at).toBe(T0);                              // the death time is never moved
    k._mapPrune(zd, [], T0 + 3000);                                       // no zone data: left as it was
    expect(zd.timers['1'].earliest).toBe(T0 + 10800000);
  });
});

describe('deaths, "?" candidates and marks', () => {
  let c;
  beforeEach(() => { ({ c } = localCore()); });
  const die = (name, loc, extra) => c._mapNoteDeath('thedeep', Object.assign({ name, spawn_id: null, loc, at: T0, src: 'zeal' }, extra || {}), T0);

  it('an assigned death starts a window timer on that point, marked "seen"', () => {
    const r = die('a decaying skeleton', { x: 105, y: 202 });
    expect(r.kind).toBe('assigned');
    const p = c._mapStatePayload('', T0 + 1000);
    expect(p.timers).toHaveLength(1);
    expect(p.timers[0]).toMatchObject({ point_id: 1, source: 'seen', name: 'a decaying skeleton', state: 'wait', earliest: T0 + 540000, latest: T0 + 660000 });
    expect(p.unassigned).toEqual([]);
  });
  it('an ambiguous death starts NO timer: it is stored unassigned with its candidates', () => {
    const r = die('a decaying skeleton', { x: 250, y: 200 });
    expect(r.kind).toBe('unassigned');
    const p = c._mapStatePayload('', T0 + 1000);
    expect(p.timers).toEqual([]);
    expect(p.unassigned).toEqual([expect.objectContaining({ name: 'a decaying skeleton', died_at: T0, candidates: [6, 1, 2, 3] })]);
  });
  it('a death of something that is not on the map is ignored', () => {
    expect(die('Brackwyn', { x: 0, y: 0 }).kind).toBe('none');
    expect(c._mapStatePayload('', T0).unassigned).toEqual([]);
  });
  it('Killed - this one settles a "?" onto the point, from the death time, and clears the other candidates', () => {
    die('a decaying skeleton', { x: 250, y: 200 });
    const r = c._mapApplyMark('thedeep', { point_id: 2, kind: 'killed' }, T0 + 120000);
    expect(r).toMatchObject({ ok: true, settled: true });
    const p = c._mapStatePayload('', T0 + 121000);
    expect(p.unassigned).toEqual([]);                                       // no "?" left on 6, 1, 3
    expect(p.timers).toEqual([expect.objectContaining({ point_id: 2, source: 'marked', died_at: T0, earliest: T0 + 540000 })]);
  });
  it('Killed on a point that is no candidate of any "?" starts a window from now', () => {
    const r = c._mapApplyMark('thedeep', { point_id: 5, kind: 'killed' }, T0 + 5000);
    expect(r).toMatchObject({ ok: true, settled: false });
    expect(r.timer).toMatchObject({ died_at: T0 + 5000, source: 'marked', name: 'Aldenmar the Pale', earliest: T0 + 5000 + 3240000, latest: T0 + 5000 + 3960000 });
  });
  it('Empty since now starts a window from now, marked', () => {
    const r = c._mapApplyMark('thedeep', { point_id: 1, kind: 'empty' }, T0 + 7000);
    expect(r.timer).toMatchObject({ point_id: 1, source: 'marked', died_at: T0 + 7000, earliest: T0 + 7000 + 540000 });
  });
  it('Up clears the timer, and takes the point off any "?" (dropping one left with no candidate)', () => {
    c._mapApplyMark('thedeep', { point_id: 1, kind: 'empty' }, T0);
    expect(c._mapStatePayload('', T0).timers).toHaveLength(1);
    expect(c._mapApplyMark('thedeep', { point_id: 1, kind: 'up' }, T0 + 1)).toMatchObject({ ok: true, cleared: true });
    expect(c._mapStatePayload('', T0 + 1).timers).toEqual([]);
    die('Aldenmar the Pale', { x: 0, y: 0 });                                // "?" with the single candidate 5
    expect(c._mapStatePayload('', T0).unassigned).toHaveLength(1);
    c._mapApplyMark('thedeep', { point_id: 5, kind: 'up' }, T0 + 2);
    expect(c._mapStatePayload('', T0 + 2).unassigned).toEqual([]);
  });
  it('a later observed death overrides a mark', () => {
    c._mapApplyMark('thedeep', { point_id: 1, kind: 'empty' }, T0);
    die('a decaying skeleton', { x: 100, y: 200 }, { at: T0 + 60000, spawn_id: 9 });
    const t = c._mapStatePayload('', T0 + 61000).timers[0];
    expect(t).toMatchObject({ point_id: 1, source: 'seen', died_at: T0 + 60000 });
  });
  it('refuses a bad kind, an unknown point, a point with no respawn time, and a zone with no data', () => {
    expect(c._mapApplyMark('thedeep', { point_id: 1, kind: 'dead' }, T0).ok).toBe(false);
    expect(c._mapApplyMark('thedeep', { point_id: 999, kind: 'empty' }, T0).ok).toBe(false);
    expect(c._mapApplyMark('thedeep', { point_id: 4, kind: 'empty' }, T0).ok).toBe(false);
    expect(c._mapApplyMark('nowhere', { point_id: 1, kind: 'empty' }, T0).ok).toBe(false);
  });
  it('the same death seen by the target window and by the log line is one death', () => {
    expect(die('a decaying skeleton', { x: 100, y: 200 }, { spawn_id: 9, src: 'zeal' }).kind).toBe('assigned');
    expect(die('a decaying skeleton', { x: 100, y: 200 }, { spawn_id: null, src: 'log', at: T0 + 1500 }).kind).toBe('dup');
    expect(c._mapStatePayload('', T0 + 2000).timers).toHaveLength(1);
  });
  it('end to end off the pipe: first sighting (pipe frame) -> target becomes a corpse -> timer', () => {
    const pipe = (extra) => Object.assign({ zone: 164, updatedAt: T0, loc: { x: 0, y: 0, z: 0 }, target_type: 1 }, extra);
    // server (105,202) is pipe x=202, y=105
    const a = pipe({ target_name: 'a decaying skeleton', target_id: 9, target_hp_pct: 100, target_loc: { x: 202, y: 105, z: 0 } });
    c._mapNoteState('Aldenmar', null, a, T0);
    // it walks to us before it dies - the FIRST position is the one that counts
    const b = pipe({ target_name: 'a decaying skeleton', target_id: 9, target_hp_pct: 30, target_loc: { x: 5, y: 5, z: 0 } });
    c._mapNoteState('Aldenmar', a, b, T0 + 5000);
    const dead = pipe({ target_name: "a decaying skeleton's corpse", target_id: 9, target_hp_pct: 0, target_type: 2, target_loc: { x: 5, y: 5, z: 0 } });
    c._mapNoteState('Aldenmar', b, dead, T0 + 9000);
    const p = c._mapStatePayload('', T0 + 10000);
    expect(p.timers).toEqual([expect.objectContaining({ point_id: 1, source: 'seen', died_at: T0 + 9000 })]);
  });
  it('a player target going down is not a spawn', () => {
    const pl = { zone: 164, updatedAt: T0, loc: { x: 0, y: 0, z: 0 }, target_type: 0 };
    const a = Object.assign({}, pl, { target_name: 'Brackwyn', target_id: 4, target_hp_pct: 10, target_loc: { x: 1, y: 1, z: 0 } });
    const b = Object.assign({}, pl, { target_name: 'Brackwyn', target_id: 4, target_hp_pct: 0, target_loc: { x: 1, y: 1, z: 0 } });
    c._mapNoteState('Aldenmar', a, b, T0);
    expect(c._mapStatePayload('', T0).timers).toEqual([]);
  });
  it('a slain line replayed from an old log (a --since backfill) starts nothing', () => {
    c._zealState.Aldenmar = { zone: 164, updatedAt: T0, loc: { x: 200, y: 100, z: 0 } };
    c._mapNoteLogDeath('a decaying skeleton', 'Aldenmar', T0 - 5 * 60000, T0);
    expect(c._mapStatePayload('', T0).timers).toEqual([]);
    c._mapNoteLogDeath('a decaying skeleton', 'Aldenmar', T0 - 2000, T0);   // a live one does (you stand at server (100,200) = p1)
    expect(c._mapStatePayload('', T0).timers).toHaveLength(1);
  });
});

describe('persistence', () => {
  it('round-trips through map_timers.json (atomic write, no .tmp left) and a fresh load', () => {
    const { c } = localCore();
    c._mapNoteDeath('thedeep', { name: 'a decaying skeleton', spawn_id: 1, loc: { x: 105, y: 202 }, at: T0, src: 'zeal' }, T0);
    c._mapNoteDeath('thedeep', { name: 'a decaying skeleton', spawn_id: 2, loc: { x: 250, y: 200 }, at: T0 + 1000, src: 'zeal' }, T0 + 1000);
    c._mapApplyMark('thedeep', { point_id: 5, kind: 'empty' }, T0 + 2000);
    expect(c._mapSaveNow()).toBe(true);
    expect(fs.existsSync(path.join(dir, 'map_timers.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'map_timers.json.tmp'))).toBe(false);
    const before = c._mapStatePayload('', T0 + 3000);
    // a "restart": a brand new copy of the code reading the same files
    const net = fakeNet();
    const c2 = loadCore({ dir, opts: { botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: '' }, net });
    c2._zealState.Aldenmar = c._zealState.Aldenmar = { zone: 164, updatedAt: T0 + 2500, loc: { x: 1, y: 1, z: 0 } };
    const after = c2._mapStatePayload('', T0 + 3000);
    expect(after.timers).toEqual(before.timers);
    expect(after.unassigned).toEqual(before.unassigned);
    expect(after.timers.map(t => t.point_id).sort()).toEqual([1, 5]);
    expect(after.unassigned).toHaveLength(1);
  });
  it('a torn or missing file starts empty rather than throwing', () => {
    fs.writeFileSync(path.join(dir, 'map_timers.json'), '{"zones": [oops');
    const { c } = localCore();
    expect(c._mapDoc()).toEqual({ version: 1, zones: {} });
  });
});

describe('/api/map-state: the version cache', () => {
  it('sends the points and the map once; the same version back gets them as null; timers always ride along', () => {
    const { c } = localCore();
    c._zealState.Aldenmar = { zone: 164, updatedAt: T0, loc: { x: 1, y: 2, z: 0 }, heading: 0 };
    const first = c._mapStatePayload('', T0 + 1);
    expect(first.version).toBe('thedeep@2026-10-12T00:00:00Z');
    expect(first.points).toHaveLength(6);
    expect(first.map.bands).toEqual([0, 20]);
    c._mapApplyMark('thedeep', { point_id: 1, kind: 'empty' }, T0 + 2);
    const again = c._mapStatePayload(first.version, T0 + 3);
    expect(again.points).toBeNull();
    expect(again.map).toBeNull();
    expect(again.version).toBe(first.version);
    expect(again.timers).toHaveLength(1);
    expect(again.self).toMatchObject({ x: 2, y: 1 });
    const stale = c._mapStatePayload('thedeep@2026-10-01T00:00:00Z', T0 + 4);   // a different version: send it all again
    expect(stale.points).toHaveLength(6);
  });
  it('says why it has nothing: no Zeal, an unknown zone', () => {
    const { c } = localCore();
    delete c._zealState.Aldenmar;
    expect(c._mapStatePayload('', T0).status).toBe('no-pipe');
    c._zealState.Aldenmar = { zone: 7, updatedAt: T0 };
    expect(c._mapStatePayload('', T0).status).toBe('no-zone');
  });
});

describe('zone data: disk first, the bot second, local mode never', () => {
  const live = (extra) => Object.assign({ botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: 'tok' }, extra || {});

  it('LOCAL MODE (no token) makes no request at all, even with nothing cached', () => {
    const net = fakeNet();
    const c = loadCore({ dir, opts: live({ token: '' }), net });
    c._zealState.Aldenmar = { zone: 164, updatedAt: T0 + 1e9, loc: { x: 1, y: 1, z: 0 } };
    const p = c._mapStatePayload('', T0 + 1e9);
    expect(p.status).toBe('no-cache');
    expect(p.local_only).toBe(true);
    expect(net.calls).toHaveLength(0);
  });
  it('local mode serves a cached zone from disk, however stale, still with no request', () => {
    seedCache(dir, ZONE_BODY, T0 - 90 * 86400000);
    const net = fakeNet();
    const c = loadCore({ dir, opts: live({ token: '' }), net });
    c._zealState.Aldenmar = { zone: 164, updatedAt: T0, loc: { x: 1, y: 1, z: 0 } };
    expect(c._mapStatePayload('', T0).points).toHaveLength(6);
    expect(net.calls).toHaveLength(0);
  });
  it('with the bot linked and nothing cached: one GET to zone-spawns, bearer auth, then it is saved to disk', async () => {
    const net = fakeNet(() => ({ status: 200, etag: '"abc"', body: ZONE_BODY }));
    const c = loadCore({ dir, opts: live(), net });
    c._zealState.Aldenmar = { zone: 164, updatedAt: Date.now(), loc: { x: 1, y: 1, z: 0 } };
    expect(c._mapStatePayload('', Date.now()).status).toBe('loading');
    c._mapStatePayload('', Date.now());   // a second poll while the first is in flight asks nothing more
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0].path).toBe('/api/agent/zone-spawns?zone=thedeep&zone_id=164');
    expect(net.calls[0].headers.Authorization).toBe('Bearer tok');
    expect(net.calls[0].headers['If-None-Match']).toBeUndefined();
    await tick();
    expect(c._mapStatePayload('', Date.now()).points).toHaveLength(6);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'zone-spawns-cache', 'thedeep.json'), 'utf8'));
    expect(saved.etag).toBe('"abc"');
    expect(saved.body.zone).toBe('thedeep');
  });
  it('a zone cached before the aggro radius existed is re-checked early, at most every 10 minutes, never in a loop (2026-10-13)', async () => {
    const old = JSON.parse(JSON.stringify(ZONE_BODY));
    for (const p of old.points) for (const n of p.npcs) { delete n.aggro; delete n.fac; delete n.pf; }
    seedCache(dir, old, Date.now() - 1000);                                    // fresh by age, but no aggro / faction
    const net = fakeNet(() => ({ status: 304 }));                              // an older bot: nothing new
    const c = loadCore({ dir, opts: live(), net });
    c._zealState.Aldenmar = { zone: 164, updatedAt: 1e18, loc: { x: 1, y: 1, z: 0 } };   // never stale
    c._mapStatePayload('', Date.now());
    expect(net.calls.filter(k => /zone-spawns/.test(k.path))).toHaveLength(1);
    await tick();
    c._mapStatePayload('', Date.now()); c._mapStatePayload('', Date.now());
    expect(net.calls.filter(k => /zone-spawns/.test(k.path))).toHaveLength(1);   // not again within 10 minutes
    // A check that landed on the old bot mid-deploy (the guild lead's "no ring drawn") is retried, not given up on.
    c._mapStatePayload('', Date.now() + 11 * 60 * 1000);
    expect(net.calls.filter(k => /zone-spawns/.test(k.path))).toHaveLength(2);
  });
  it('a fresh cached zone costs no request; a day-old one is re-checked with its ETag and a 304 keeps it', async () => {
    seedCache(dir, ZONE_BODY, Date.now() - 1000);
    let net = fakeNet(() => ({ status: 500 }));
    let c = loadCore({ dir, opts: live(), net });
    c._zealState.Aldenmar = { zone: 164, updatedAt: Date.now(), loc: { x: 1, y: 1, z: 0 } };
    expect(c._mapStatePayload('', Date.now()).points).toHaveLength(6);
    expect(net.calls.filter(k => /zone-spawns/.test(k.path))).toHaveLength(0);   // (the guild-sync pull is a different route)
    seedCache(dir, ZONE_BODY, Date.now() - 25 * 3600000);
    net = fakeNet(() => ({ status: 304 }));
    c = loadCore({ dir, opts: live(), net });
    c._zealState.Aldenmar = { zone: 164, updatedAt: Date.now(), loc: { x: 1, y: 1, z: 0 } };
    expect(c._mapStatePayload('', Date.now()).points).toHaveLength(6);   // served from disk while it revalidates
    const zcalls = net.calls.filter(k => /zone-spawns/.test(k.path));
    expect(zcalls).toHaveLength(1);
    expect(zcalls[0].headers['If-None-Match']).toBe('"v1"');
    await tick();
    expect(c._mapStatePayload('', Date.now()).points).toHaveLength(6);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'zone-spawns-cache', 'thedeep.json'), 'utf8')).fetched_at).toBeGreaterThan(Date.now() - 5000);
  });
  it('a 404 means no points for the zone, and is not asked again for hours', async () => {
    const net = fakeNet(() => ({ status: 404 }));
    const c = loadCore({ dir, opts: live(), net });
    c._zealState.Aldenmar = { zone: 164, updatedAt: Date.now(), loc: { x: 1, y: 1, z: 0 } };
    c._mapStatePayload('', Date.now());
    await tick();
    expect(c._mapStatePayload('', Date.now()).status).toBe('no-points');
    c._mapStatePayload('', Date.now() + 60000);
    expect(net.calls).toHaveLength(1);
  });
});

describe('the overlay (apps/mimic/map.html)', () => {
  const helpers = sliceBlock(MAP_HTML, '// ── pure helpers', '// ── end pure helpers ──');
  // eslint-disable-next-line no-new-func
  const H = new Function(helpers + '\nreturn { toScreen, headingVec, timerState, fmtDur, timerText, badgeGlyph, badgeWords, pointBadges, pointKind, bestName, fitView, FLASH_MS, lerpHeading, blendPos, trackAt, trackStep, trackMoving, SNAP_DIST, seenText, LEVEL_STEPS, levelLabel, inLevelRange, FIT_MODES, FIT_LABEL, nextFitMode, resolveFit, membersBounds, SMOOTH_MS, DIRECT_STALE_MS, useDirect, directMap, posAgeText, targetKey, upOn, upNpc, upLabel, mapCfgDefaults, mergeMapCfg, applyScheme, MAP_SCHEMES, CFG_SHOW, CFG_GLYPHS, CFG_COLS, hexA, totMember, aggroRadius, routeTarget, aggroKind, assistRadius, targetNpc, locText, screenToServer, speedOf, runPct, trailStep, wanderLeg, noteWanderLeg, levelCon, brewallLayer, namedNpc, trailStretch, trailSpeed, targetSpawnGroup, LEG_REACH, legArrow, LEG_ARROW_AT, classifyTrail, homeOf, homeDist, noteKills, trailShown, KILLS_FADE, TRAIL_COL, nearPack, followOffNow, labelMode, routeTwins, headingRay, toolDock, toolBox, nextFollow, spawnDistance, GATE_RANGE, inkStyle, INK_DEFAULT, aeRampageRing };')();

  it('draws north up: screen = (-x, -y), the same as the website', () => {
    expect(H.toScreen(10, 20)).toEqual({ sx: -10, sy: -20 });
    const ts = readSource(path.join(ROOT, 'web', 'lib', 'spectator.ts'));
    expect(ts).toMatch(/export function toScreen\(x: number, y: number\)[\s\S]{0,60}?return \{ sx: -x, sy: -y \};/);
  });
  it('heading 0 faces up the screen; 128 (counter-clockwise) faces left', () => {
    const n = H.headingVec(0), w = H.headingVec(128);
    expect(n.dx).toBeCloseTo(0); expect(n.dy).toBeCloseTo(-1);
    expect(w.dx).toBeCloseTo(-1); expect(w.dy).toBeCloseTo(0);
  });
  it('colours a timer exactly as the agent does (one rule, two copies)', () => {
    const { c } = localCore();
    const t = c._mapMakeTimer(POINTS[0], T0, 'seen', 'x');
    const fm = /const MAP_FLASH_MS\s*=\s*(\d+)\s*\*\s*(\d+)/.exec(CORE);
    expect(H.FLASH_MS).toBe(Number(fm[1]) * Number(fm[2]));
    for (let ms = -5000; ms < 800000; ms += 997) expect(H.timerState(t, T0 + ms), String(ms)).toBe(c._mapTimerState(t, T0 + ms));
    for (const ms of [539999, 540000, 554999, 555000, 659999, 660000]) expect(H.timerState(t, T0 + ms)).toBe(c._mapTimerState(t, T0 + ms));
  });
  it('words the list: "up in 3m-5m", "up now-2m", "UP"', () => {
    const t = { earliest: T0 + 180000, latest: T0 + 300000 };
    expect(H.timerText(t, T0)).toBe('up in 3m–5m');
    expect(H.timerText(t, T0 + 240000)).toBe('up now–1m');
    expect(H.timerText(t, T0 + 300000)).toBe('UP');
    expect(H.fmtDur(45000)).toBe('45s');
    expect(H.fmtDur(200000)).toBe('3m20s');
    expect(H.fmtDur(3900000)).toBe('1h05m');
  });
  it('badges: the bot\'s own strings get glyphs; the long tail goes to the hover card, not the dot', () => {
    // utils/zoneSpawns.js badgesFor(): 'eye' | 'eye_undead' | 'hood' + slugged mobSpecials labels
    expect(H.badgeGlyph('eye')).toBe('👁');
    expect(H.badgeGlyph('hood')).toBe('🥷');
    expect(H.badgeGlyph('eye_undead')).not.toBe(H.badgeGlyph('eye'));
    expect(H.badgeGlyph('summon')).toBe('↯');
    expect(H.badgeGlyph('immune_pacify')).toBe('☮');
    expect(H.badgeGlyph('triple_attack')).toBe('');
    expect(H.badgeWords(['summon', 'triple_attack', 'dual_wield'])).toBe('triple attack, dual wield');
    expect(H.pointBadges(POINTS[2])).toBe('👁');
  });
  it('named and raid targets are told apart; the best name is the boss, not the commonest mob', () => {
    expect(H.pointKind(POINTS[0])).toEqual({ named: false, raid: false });
    expect(H.pointKind(POINTS[2])).toEqual({ named: true, raid: false });
    expect(H.pointKind(POINTS[4])).toEqual({ named: true, raid: true });
    expect(H.bestName(POINTS[2])).toBe('Lord Nagafen');
  });
  it('a known mob on a point: its own name, spawn id and symbols, not every mob that can spawn there', () => {
    const P = { target: { name: 'a decaying skeleton', id: 152, point_id: 3 } };
    const up = H.upOn(3, P, {});
    expect(up).toEqual({ name: 'a decaying skeleton', spawn_id: 152 });
    expect(H.upLabel(up)).toBe('a decaying skeleton #152');
    const un = H.upNpc(POINTS[2], up);
    expect(un.name).toBe('a_decaying_skeleton');
    expect(H.pointBadges({ npcs: [un] })).toBe('');               // the skeleton has no eye; the point as a whole does
    expect(H.pointBadges(POINTS[2])).toBe('👁');
    expect(H.upNpc(POINTS[2], { name: 'Lord Nagafen' }).named).toBe(true);
    // the pinned target wins over a guild sighting; a sighting alone still names the point; nothing known = null
    expect(H.upOn(3, P, { 3: { name: 'Lord Nagafen', spawn_id: 9 } }).spawn_id).toBe(152);
    expect(H.upOn(2, null, { 2: { name: 'a decaying skeleton', spawn_id: 812 } })).toEqual({ name: 'a decaying skeleton', spawn_id: 812 });
    expect(H.upOn(1, P, {})).toBeNull();
    expect(H.upNpc(POINTS[2], { name: 'a bat' })).toBeNull();
  });

  describe('⚙ Map settings', () => {
    // Line strength (the guild lead, 2026-10-13: lines and spawns hard to see over the game with no background).
    it('Line strength: 1 is exactly the old look, the default is Strong, and saves are clamped', () => {
      expect(H.inkStyle(1)).toEqual({ line: 1, dot: 1, casing: 0, ringFill: 0.07, ringLine: 0.6, ringW: 1, faint: 0.25 });
      const s = H.inkStyle(H.INK_DEFAULT);
      expect(H.INK_DEFAULT).toBe(1.75);
      expect(s.line).toBe(1.75);
      expect(s.casing).toBeGreaterThan(0);                    // walls and routes get a dark edge
      expect(s.dot).toBeGreaterThan(1);
      expect(s.ringLine).toBeGreaterThan(0.6);
      expect(H.inkStyle(9)).toEqual(H.inkStyle(3));           // out of range clamps
      expect(H.inkStyle(3).ringLine).toBe(1);
      expect(H.mapCfgDefaults().ink).toBe(1.75);
      expect(H.mergeMapCfg({ ink: 2.6 }).ink).toBe(2.5);      // quarter steps
      expect(H.mergeMapCfg({ ink: 7 }).ink).toBe(1.75);       // a bad save falls back to the default
      expect(H.mergeMapCfg({ ink: 1 }).ink).toBe(1);          // Normal is kept
    });
    it('defaults: everything shown except the aggro rings, no icon off, and the Default scheme is exactly the colours the map drew before', () => {
      const d = H.mapCfgDefaults();
      expect(Object.entries(d.show).filter(([k]) => k !== 'aggro' && k !== 'conNames').every(([, v]) => v)).toBe(true);
      expect(d.show.aggro).toBe(false);                                         // off until the ◯ button turns them on
      expect(d.show.conNames).toBe(false);                                      // names keep their colours until asked
      expect(Object.keys(d.show).length).toBe(H.CFG_SHOW.length);
      expect(d.glyphsOff).toEqual({});
      expect(d).toMatchObject({ scheme: 'default', wallMode: 'layers', wallV: 2, bgA: null, text: 1 });   // Brewall layers by default
      expect(d.col).toMatchObject({ route: '#39c5cf', routeTarget: '#7ee787', dot: '#c9d1d9', named: '#f2cc60', raidTarget: '#ff7b72',
        up: '#56d364', ringWait: '#f85149', ringWindow: '#f0b429', ringUp: '#56d364', candidate: '#d2a8ff', glyph: '#e6edf3',
        pather: '#9ecbff', bossLabel: '#f2cc60', raidLabel: '#ffa198', upLabel: '#7ee787', room: '#c9d9ee', you: '#58a6ff',
        target: '#f0883e', pinLine: '#7ee787', group: '#56d364', raid: '#a371f7', bg: '#131a26' });
      expect(H.hexA(d.col.oursWall, 0.95)).toBe('rgba(214,230,255,0.95)');   // the old wall colour, byte for byte
      // every scheme sets every colour row the panel shows, plus the background
      for (const s of Object.values(H.MAP_SCHEMES)) for (const [k] of H.CFG_COLS.concat([['bg']])) expect(s[k]).toMatch(/^#[0-9a-f]{6}$/);
    });
    it('the target\'s route: pinned = its point\'s; walking = the nearest route its name walks; none otherwise (2026-10-13)', () => {
      // the guild lead: "this mob is going across the map and not on a path line. Ideally it would highlight the path line"
      const grids = { 1: { type: 8, pts: [[0, 0, 0, 0], [100, 0, 0, 0]] }, 2: { type: 8, pts: [[1000, 1000, 0, 0], [1100, 1000, 0, 0]] }, 3: { type: 3, pts: [[0, 50, 0, 0], [50, 50, 0, 0]] } };
      const golem = { name: 'A_Crystalline_Golem' };
      const points = [{ id: 1, grid: 1, npcs: [golem] }, { id: 2, grid: 2, npcs: [golem] }, { id: 3, grid: 3, npcs: [{ name: 'a_spider' }] }, { id: 4, grid: null, npcs: [golem] }];
      const byId = Object.fromEntries(points.map(p => [String(p.id), p]));
      expect(H.routeTarget({ name: 'A Crystalline Golem', x: 1050, y: 1020 }, points, grids, byId)).toBe('2');   // nearest of its two
      expect(H.routeTarget({ name: 'A Crystalline Golem', x: 40, y: 10 }, points, grids, byId)).toBe('1');
      expect(H.routeTarget({ name: 'a spider', x: 1050, y: 1020, point_id: 3 }, points, grids, byId)).toBe('3');  // pinned wins
      expect(H.routeTarget({ name: 'a golem', point_id: 4 }, points, grids, byId)).toBeNull();                    // pinned to a static point
      expect(H.routeTarget({ name: 'a gnoll', x: 0, y: 0 }, points, grids, byId)).toBeNull();                     // walks no route
      expect(H.routeTarget({ name: 'A Crystalline Golem', x: 0, y: 0 }, points, null, byId)).toBeNull();
      expect(H.routeTarget(null, points, grids, byId)).toBeNull();
      const js = stripJs(MAP_HTML);
      expect(js).toMatch(/if \(SH\.routes\) drawRoutes\(sz, range, srange, routeTarget\(S\.p && S\.p\.target, S\.points, S\.grids, S\.byId\), !SH\.dots\);/);
      // random wanderers draw their waypoints only, never a line through the list in order
      expect(js).toMatch(/var RANDOM_WANDER = \{ 1: 1, 2: 1, 5: 1, 7: 1, 8: 1 \};/);
      const draw = js.slice(js.indexOf('function drawRoutes('), js.indexOf('function halo('));
      expect(draw.indexOf('if (RANDOM_WANDER[Number(g.type)])')).toBeGreaterThan(-1);
      expect(draw.indexOf('if (RANDOM_WANDER[Number(g.type)])')).toBeLessThan(draw.indexOf('routePath(g, g.pts)'));
    });
    it('aggro ring colour: green no faction, yellow conned not-KOS, red KOS or not conned; dashed social ring; target rings (2026-10-13)', () => {
      // the guild lead: "Green if it's not aggro to anyone, yellow if it could be KOS to some but is not to the player.
      // Then a dashed line for social aggro distance" — and "This pather does not have his aggro radius drawn"
      const frog = { name: 'a_small_tree_frog', fac: 1429, aggro: 100, assist: null };
      const rat = { name: 'a_rat', fac: 0, aggro: 30, assist: 50 };
      const golem = { name: 'A_Crystalline_Golem', fac: 1430, aggro: 100, assist: 75 };
      const old = { name: 'a_bat', aggro: 40 };                                  // a zone cached before the faction field
      expect(H.aggroKind(null, rat, {})).toBe('none');                          // no faction: aggros nobody
      expect(H.aggroKind(null, frog, {})).toBe('kos');                          // has one, not conned yet: cautious
      expect(H.aggroKind(null, frog, { 'a small tree frog': 2 })).toBe('safe'); // "glowers at you dubiously"
      expect(H.aggroKind(null, golem, { 'a crystalline golem': 0 })).toBe('kos');   // scowls
      expect(H.aggroKind(null, golem, { 'a crystalline golem': 1 })).toBe('kos');   // threatening
      expect(H.aggroKind(null, rat, { 'a rat': 0 })).toBe('kos');               // a con overrules the no-faction guess
      expect(H.aggroKind(null, old, {})).toBe('kos');
      expect(H.aggroKind({ npcs: [rat, frog] }, null, { 'a small tree frog': 2 })).toBe('safe');   // the point's worst
      expect(H.aggroKind({ npcs: [rat] }, null, null)).toBe('none');
      expect(H.aggroKind({ npcs: [] }, null, null)).toBe('kos');
      expect(H.assistRadius(null, golem)).toBe(75);
      expect(H.assistRadius(null, rat)).toBe(0);                                // nobody to help without a faction
      expect(H.assistRadius({ npcs: [frog, golem] }, null)).toBe(75);
      const pts = [{ id: 1, npcs: [frog] }, { id: 2, npcs: [golem] }];
      const byId = { 1: pts[0], 2: pts[1] };
      expect(H.targetNpc({ name: 'A Crystalline Golem' }, pts, byId)).toBe(golem);   // walked off its point: by name
      expect(H.targetNpc({ name: 'a gnoll' }, pts, byId)).toBeNull();
      const js = stripJs(MAP_HTML);
      expect(js).toMatch(/if \(as > 0 && as !== ar && as \* sc >= 4\) \{/);
      expect(js).toMatch(/ctx\.setLineDash\(\[5, 4\]\); ctx\.arc\(x, y, as \* sc/);
      expect(js).toMatch(/if \(tnpc\) aggroRing\(tq\[0\], tq\[1\], aggroRadius\(null, tnpc\), assistRadius\(null, tnpc\), aggroKind\(null, tnpc, P\.cons, S\.facs, P\.me\), ccFor\(P\.cc, P\.target\.name, P\.target\.id, true\), now\);/);
      expect(js).toMatch(/aggroKind\(ap, aun, S\.p && S\.p\.cons, S\.facs, S\.p && S\.p\.me\), acc, now\)/);
      // an unpinned target's label carries its spawn id
      expect(js).toMatch(/\+ \(P\.target\.id != null \? ' #' \+ P\.target\.id : ''\) : '';/);
    });
    it('ring colour from the faction maths: Tranquility green, Valor green unless a non-player illusion, cons and unknowns (2026-10-13)', () => {
      // the guild lead: "the mobs in Plane of Tranquility should be green because they are indifferent to everyone ...
      // if someone has a non-player illusion on it should switch them to red immediately"
      const valorMods = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 128, 130].map(r => ['r' + r, 1000]));
      const facs = {
        900: { base: 0, min_cap: 0, max_cap: 0, see_illusion: true, mods: {}, kos: 'never' },                 // Tranquility
        901: { base: -1000, min_cap: -2000, max_cap: 2000, see_illusion: false, mods: valorMods, kos: 'never' },  // Valor
        902: { base: 0, see_illusion: false, mods: { r6: -1000 }, kos: 'some' },                               // hates Dark Elves
        903: { base: -1500, see_illusion: false, mods: {}, kos: 'always' },
      };
      const n = (pf, name) => ({ name: name || 'a_mob', fac: 7, pf });
      const me = { race: 1, cls: 1, deity: 396, illusion: null };
      expect(H.aggroKind(null, n(900), {}, facs, me)).toBe('none');
      expect(H.aggroKind(null, n(900), {}, facs, Object.assign({}, me, { illusion: 60 }))).toBe('none');   // sees through
      expect(H.aggroKind(null, n(901), {}, facs, me)).toBe('none');
      expect(H.aggroKind(null, n(901), {}, facs, Object.assign({}, me, { illusion: 60 }))).toBe('kos');    // Skeleton
      expect(H.aggroKind(null, n(901), {}, facs, Object.assign({}, me, { illusion: -1 }))).toBe('kos');    // unnamed shape
      expect(H.aggroKind(null, n(901), {}, facs, Object.assign({}, me, { illusion: 6 }))).toBe('none');    // Dark Elf: a player race
      expect(H.aggroKind(null, n(901, 'a_valorous_guard'), { 'a valorous guard': 4 }, facs, Object.assign({}, me, { illusion: 60 }))).toBe('kos');   // a con before the illusion loses
      expect(H.aggroKind(null, n(902), {}, facs, me)).toBe('safe');                                        // a Human: yellow
      expect(H.aggroKind(null, n(902), {}, facs, Object.assign({}, me, { race: 6 }))).toBe('kos');
      expect(H.aggroKind(null, n(902), {}, facs, Object.assign({}, me, { race: null }))).toBe('kos');      // race unknown: could be
      expect(H.aggroKind(null, n(902, 'an_elf_hater'), { 'an elf hater': 3 }, facs, Object.assign({}, me, { race: null }))).toBe('safe');   // your con settles it
      expect(H.aggroKind(null, n(903), {}, facs, me)).toBe('kos');
      expect(H.aggroKind(null, n(900, 'a_monk'), { 'a monk': 0 }, facs, me)).toBe('kos');                 // you made it hate you
    });
    it('the agent says who you are: class and deity from Zeal, race from /who or Quarmy, the illusion from your buffs', () => {
      const { c } = localCore();
      const st = { charInfo: [{ id: 3, value: 'Shadow Knight' }, { id: 4, value: 'Innoruuk' }], buffs: [{ name: 'Illusion: Skeleton' }] };
      c.whoData.set('aldenmar', { race: 'Dark Elf' });
      expect(c._mapMe('Aldenmar', st)).toEqual({ level: null, race: 6, cls: 5, deity: 206, illusion: 60 });   // level: _levelOf (outside this slice)
      expect(c._mapMe('Aldenmar', { charInfo: [], buffs: [{ name: 'Illusion: Fire Elemental Lord' }] }).illusion).toBe(-1);
      expect(c._mapMe('Aldenmar', { buffs: [{ name: 'Greater Wolf Form' }] }).illusion).toBe(42);
      expect(c._mapMe('Aldenmar', { buffs: [{ name: 'Spirit of Wolf' }] }).illusion).toBeNull();
      c._mapQuarmyIds.set('brackwyn', { race_id: 128, class_id: 10, deity_id: 203 });
      expect(c._mapMe('Brackwyn', {})).toEqual({ level: null, race: 128, cls: 10, deity: 203, illusion: null });
      expect(stripJs(AGENT)).toMatch(/out\.factions = rec\.body\.factions \|\| null;/);
      expect(stripJs(AGENT)).toMatch(/out\.me = _mapMe\(character, st\);/);
    });
    it('the agent keeps your latest faction con per mob, every tier, for six hours, per character', () => {
      const { c } = localCore();
      const T = 1e12;
      c._mapNoteCon('[Tue Oct 13 00:59:17 2026] a small tree frog glowers at you dubiously -- You could probably win this fight.', 'Aldenmar', T);
      c._mapNoteCon('[Tue Oct 13 00:58:55 2026] An Undead Vassal scowls at you, ready to attack -- it appears to be quite formidable.', 'Aldenmar', T);
      c._mapNoteCon("[Tue Oct 13 00:58:56 2026] Brackwyn tells the group, 'a rat scowls at you, ready to attack'", 'Aldenmar', T);
      expect(c._mapConsFor('Aldenmar', T + 1000)).toEqual({ 'a small tree frog': 2, 'an undead vassal': 0 });
      expect(c._mapConsFor('Brackwyn', T + 1000)).toEqual({});
      expect(c._mapConsFor('Aldenmar', T + 7 * 3_600_000)).toEqual({});
      const AG = stripJs(AGENT);
      expect(AG).toMatch(/try \{ _mapNoteCon\(line, b\.character\); \} catch \(e\) \{ void e; \}/);
      expect(AG).toMatch(/out\.cons = _mapConsFor\(character, now\);/);
    });
    it('aggro rings: the up mob\'s own radius, else the widest that can spawn there; sentinels and gaps ignored (2026-10-13)', () => {
      // the guild lead: "add aggro rings onto the map, make a circle icon on the main screen"
      const p = { npcs: [{ name: 'a_skeleton', aggro: 40 }, { name: 'Lord_Rax', aggro: 90 }, { name: 'a_bat', aggro: 10000 }, { name: 'x', aggro: null }] };
      expect(H.aggroRadius(p, null)).toBe(90);                                  // cautious: the widest real one
      expect(H.aggroRadius(p, p.npcs[0])).toBe(40);                             // the mob that is up there now
      expect(H.aggroRadius(p, p.npcs[2])).toBe(90);                             // its 10000 is a sentinel: fall back
      expect(H.aggroRadius({ npcs: [{ aggro: null }] }, null)).toBe(0);         // an old zone cache: no radius, no ring
      const js = stripJs(MAP_HTML);
      expect(js).toMatch(/if \(at && timerState\(at, now\) === 'wait'\) continue;/);   // nothing up there: no ring
      expect(js).toMatch(/if \(rr \* sc >= 4\) \{/);                               // no ring that would be a speck (rr = ar unless a harmony shrank it)
      expect(MAP_HTML).toMatch(/<button class="tb" id="aggroBtn" type="button"[^>]*>◯<\/button>/);
    });
    it('a saved object is merged key by key; bad values and unknown keys are dropped', () => {
      const c = H.mergeMapCfg({ show: { walls: false, routes: 'no', bogus: false }, glyphsOff: { '👁': true, 'x': true },
        col: { route: '#ABCDEF', dot: 'red', evil: '#000000' }, scheme: 'cb', wallMode: 'one', bgA: 0.3, text: 1.44 });
      expect(c.show.walls).toBe(false);
      expect(c.show.routes).toBe(true);
      expect(c.show.bogus).toBeUndefined();
      expect(c.glyphsOff).toEqual({ '👁': true });
      expect(c.col.route).toBe('#abcdef');
      expect(c.col.dot).toBe('#c9d1d9');
      expect(c.col.evil).toBeUndefined();
      expect(c).toMatchObject({ scheme: 'cb', wallMode: 'one', bgA: 0.3, text: 1.4 });
      expect(H.mergeMapCfg({ bgA: 7, text: 9, scheme: 'nope', wallMode: 'x' })).toMatchObject({ bgA: null, text: 1, scheme: 'default', wallMode: 'layers' });
      expect(H.mergeMapCfg({ wallMode: 'map' }).wallMode).toBe('layers');              // an old save's 'map' was only the old default
      expect(H.mergeMapCfg({ wallMode: 'map', wallV: 2 }).wallMode).toBe('map');      // chosen after the change: kept
      expect(H.mergeMapCfg(null)).toEqual(H.mapCfgDefaults());
    });
    it('a scheme replaces every colour; the colour-blind one never pairs red with green for a meaning', () => {
      const c = H.applyScheme(H.mapCfgDefaults(), 'cb');
      expect(c.scheme).toBe('cb');
      expect(c.col).toEqual(H.MAP_SCHEMES.cb);
      expect(c.col.up).not.toBe(c.col.ringWait);
      expect(c.col.ringUp).toBe('#56b4e9');                                   // up is sky blue, not green
      expect(H.applyScheme(H.mapCfgDefaults(), 'nope').scheme).toBe('default');
    });
    it('the target\'s target (assist bar ToT) is placed when it is you, your group or your raid; anyone else gets a name only', () => {
      // the guild lead, 2026-10-13: "pvp targeting should work as well, where it shows who were targeting and who they're targeting"
      const P = { self: { name: 'Aldenmar', x: 0, y: 0 }, group: [{ name: 'Brackwyn', x: 1, y: 1 }], raid: [{ name: 'Corvale', x: 2, y: 2 }] };
      expect(H.totMember(P, 'aldenmar')).toMatchObject({ key: 'self', who: 'you' });
      expect(H.totMember(P, 'Brackwyn')).toMatchObject({ key: 'g:Brackwyn', who: 'group' });
      expect(H.totMember(P, 'Corvale')).toMatchObject({ key: 'r:Corvale', who: 'raid' });
      expect(H.totMember(P, 'Rethlan')).toBeNull();
      expect(H.totMember(null, 'Brackwyn')).toBeNull();
      expect(H.mapCfgDefaults().show).toMatchObject({ targetName: true, tot: true });
      expect(H.MAP_SCHEMES.default.tot).toBe('#f778ba');
    });
    it('switching an icon off removes just that icon from a spawn point', () => {
      const p = { npcs: [{ name: 'x', badges: ['eye', 'summon', 'rampage'] }] };
      expect(H.pointBadges(p)).toBe('👁↯⚔');
      expect(H.pointBadges(p, { '↯': true })).toBe('👁⚔');
      expect(H.pointBadges(p, { '👁': true, '↯': true, '⚔': true })).toBe('');
    });
  });
  it('fits the zone with the north-up flip', () => {
    const v = H.fitView({ minX: -100, maxX: 300, minY: 0, maxY: 100 }, 400, 200);
    expect(v.cx).toBeCloseTo(-100);   // screen x = -x: the zone's middle x = 100 -> -100
    expect(v.cy).toBeCloseTo(-50);
    expect(v.scale).toBeCloseTo(0.92);
  });

  // Ask 1: one Fit button cycles zone -> group -> raid; a mode with nobody falls back and says so.
  describe('the Fit button cycle', () => {
    it('advances zone -> group -> raid -> zone, and the labels name the mode', () => {
      expect(H.FIT_MODES).toEqual(['zone', 'group', 'raid']);
      expect(H.nextFitMode('zone')).toBe('group');
      expect(H.nextFitMode('group')).toBe('raid');
      expect(H.nextFitMode('raid')).toBe('zone');
      expect(H.nextFitMode('nonsense')).toBe('zone');
      expect(H.FIT_LABEL).toEqual({ zone: 'Fit zone', group: 'Fit group', raid: 'Fit raid' });
    });
    it('falls back: raid with no raid -> group, group with no group -> zone, each saying so', () => {
      expect(H.resolveFit('zone', 0, 0)).toEqual({ use: 'zone', note: '' });
      expect(H.resolveFit('group', 2, 0)).toEqual({ use: 'group', note: '' });
      expect(H.resolveFit('group', 0, 5)).toMatchObject({ use: 'zone', note: expect.stringMatching(/no group/) });
      expect(H.resolveFit('raid', 2, 6)).toEqual({ use: 'raid', note: '' });
      expect(H.resolveFit('raid', 2, 0)).toMatchObject({ use: 'group', note: expect.stringMatching(/no raid/) });
      expect(H.resolveFit('raid', 0, 0)).toMatchObject({ use: 'zone', note: expect.stringMatching(/no raid/) });
    });
    it('fits you + the members with padding, and never zooms a tight cluster to a pinpoint', () => {
      const b = H.membersBounds({ x: 0, y: 0 }, [{ x: 1000, y: 500 }, { x: -200, y: 100 }]);
      expect(b.minX).toBeLessThan(-200); expect(b.maxX).toBeGreaterThan(1000);
      expect(b.minY).toBeLessThan(0); expect(b.maxY).toBeGreaterThan(500);
      const tight = H.membersBounds({ x: 10, y: 10 }, [{ x: 10, y: 10 }]);
      expect(tight.maxX - tight.minX).toBeGreaterThanOrEqual(200);
      expect(H.membersBounds(null, [])).toBeNull();
      expect(H.membersBounds(null, [{ x: null, y: 3 }])).toBeNull();   // a member with no position is not a point
    });
  });

  // Ask 2: levels +-N of YOUR z replace the floor list; walls (band z) and spawn dots (spawn2 z) share the rule.
  describe('the level range', () => {
    it('a thing within +-N of your z is in range (the edge counts), beyond it is not', () => {
      expect(H.inLevelRange(100, 100, 50)).toBe(true);
      expect(H.inLevelRange(150, 100, 50)).toBe(true);
      expect(H.inLevelRange(50, 100, 50)).toBe(true);
      expect(H.inLevelRange(150.5, 100, 50)).toBe(false);
      expect(H.inLevelRange(-300, 100, 50)).toBe(false);
    });
    it('All (0), an unknown z of yours or of the thing = in range', () => {
      expect(H.inLevelRange(9999, 0, 0)).toBe(true);
      expect(H.inLevelRange(9999, null, 50)).toBe(true);
      expect(H.inLevelRange(9999, undefined, 50)).toBe(true);
      expect(H.inLevelRange(null, 100, 50)).toBe(true);
    });
    it('steps run 25..400 then All, and say so in the label', () => {
      expect(H.LEVEL_STEPS.slice(0, -1)).toEqual([...H.LEVEL_STEPS.slice(0, -1)].sort((a, b) => a - b));
      expect(H.LEVEL_STEPS[0]).toBe(25);
      expect(H.LEVEL_STEPS[H.LEVEL_STEPS.length - 2]).toBe(400);
      expect(H.LEVEL_STEPS[H.LEVEL_STEPS.length - 1]).toBe(0);
      expect(H.levelLabel(0)).toBe('Levels ±25');
      expect(H.levelLabel(H.LEVEL_STEPS.length - 1)).toBe('Levels: all');
    });
    it('classifies the test zone: walls by band z, spawns by their own z, from the floor you stand on', () => {
      const bands = ZONE_BODY.map.bands;   // [0, 20]
      expect(bands.map(z => H.inLevelRange(z, 0, 10))).toEqual([true, false]);
      expect(bands.map(z => H.inLevelRange(z, 20, 10))).toEqual([false, true]);
      expect(POINTS.map(p => H.inLevelRange(p.z, 0, 10))).toEqual([true, true, true, true, false, true]);
    });
  });

  // Ask 3 / 4: pather routes ride the zone payload (version-gated like the map) and pin a walker tab-targeted mid-route.
describe('pather routes', () => {
  const ROUTE = { type: 3, type2: 0, pts: [[0, 0, 0, 0], [100, 0, 0, 5], [100, 100, 0, 0]] };
  it('point-to-segment distance: along it, past either end, and a zero-length segment', () => {
    const { c } = localCore();
    expect(c._mapSegDist(50, 30, 0, 0, 100, 0)).toBeCloseTo(30);
    expect(c._mapSegDist(-30, 40, 0, 0, 100, 0)).toBeCloseTo(50);      // past the start: distance to the start
    expect(c._mapSegDist(130, 40, 0, 0, 100, 0)).toBeCloseTo(50);      // past the end
    expect(c._mapSegDist(3, 4, 0, 0, 0, 0)).toBeCloseTo(5);
  });
  it('route distance is the nearest segment; one waypoint or none is no route; a circular route closes', () => {
    const { c } = localCore();
    expect(c._mapRouteDist({ x: 50, y: 5 }, ROUTE)).toBeCloseTo(5);
    expect(c._mapRouteDist({ x: 95, y: 50 }, ROUTE)).toBeCloseTo(5);
    expect(c._mapRouteDist({ x: 50, y: 5 }, { type: 3, pts: [[0, 0, 0, 0]] })).toBe(Infinity);
    expect(c._mapRouteDist({ x: 50, y: 5 }, null)).toBe(Infinity);
    const loop = { type: 0, pts: [[0, 0, 0, 0], [100, 0, 0, 0], [100, 100, 0, 0]] };
    // (45,55) sits 7.07 off the closing diagonal (0,0)-(100,100); the open route has no such segment
    expect(c._mapRouteDist({ x: 45, y: 55 }, loop)).toBeCloseTo(Math.hypot(5, 5), 5);
    expect(c._mapRouteDist({ x: 45, y: 55 }, { type: 3, pts: loop.pts })).toBeGreaterThan(40);
  });
  const walker = (id, x, y, grid) => ({ id, x, y, z: 0, grid, respawn_s: 600, variance_s: 0, npcs: [NPC('a_patrolling_orc')] });
  it('a walker 40 units off its spawn point but 5 off its route is assigned (without the route it is not)', () => {
    const { c } = localCore();
    const pts = [walker(10, 0, 0, 7), walker(11, 2000, 2000, null)];
    const here = { x: 70, y: 5 };   // 70 from the spawn point (0,0); 5 from the route along y = 0
    expect(c._mapAttribute(pts, 'a patrolling orc', here).kind).toBe('unassigned');
    expect(c._mapAttribute(pts, 'a patrolling orc', here, { 7: ROUTE })).toMatchObject({ kind: 'assigned', point_id: 10 });
    expect(c._mapAttribute(pts, 'a patrolling orc', here, { 7: ROUTE }).dist).toBeCloseTo(5);
  });
  it('roamers: a random wanderer is anywhere among its waypoints, and route twins pin to the nearest spot (2026-10-13)', () => {
    // the guild lead: "roamers are not capturing their spawn ids on the map" (Plane of Valor's golems: five spawn
    // points, one shared type-8 grid)
    const { c } = localCore();
    const wander = { type: 8, pts: [[0, 0, 0, 0], [400, 0, 0, 0], [400, 300, 0, 0], [0, 300, 0, 0]] };
    expect(c._mapRouteDist({ x: 200, y: 150 }, wander)).toBe(0);                  // mid-field, far from every edge
    expect(c._mapRouteDist({ x: 200, y: 150 }, { type: 3, pts: wander.pts })).toBe(150);   // a patrol is on its line
    expect(c._mapRouteDist({ x: 430, y: 340 }, wander)).toBeCloseTo(50);
    const pts = [walker(10, 0, 0, 1), walker(11, 400, 0, 1), walker(12, 400, 300, 1), walker(13, 2000, 2000, null)];
    const a = c._mapAttribute(pts, 'a patrolling orc', { x: 350, y: 60 }, { 1: wander });
    expect(a).toMatchObject({ kind: 'assigned', point_id: 11 });                   // the twins' nearest spawn spot
    // twins only when the respawn matches too: a different timer is a different answer, so it stays "?"
    pts[1].respawn_s = 1200;
    const b = c._mapAttribute(pts, 'a patrolling orc', { x: 350, y: 60 }, { 1: wander });
    expect(b.kind).toBe('unassigned');
    expect(b.candidates).toEqual(expect.arrayContaining([11, 12]));                // 10 still folds into its twin 12
  });
  it('two roamers on one route land on two points: a twin already pinned to another mob goes last (2026-10-13)', () => {
    // the guild lead: "This is attributing both of these pathers to the same spawn point"
    const { c } = localCore();
    const wander = { type: 8, pts: [[0, 0, 0, 0], [400, 0, 0, 0], [400, 300, 0, 0], [0, 300, 0, 0]] };
    const pts = [walker(10, 0, 0, 1), walker(11, 400, 0, 1), walker(12, 400, 300, 1)];
    expect(c._mapAttribute(pts, 'a patrolling orc', { x: 350, y: 60 }, { 1: wander }, new Set(['11']))).toMatchObject({ kind: 'assigned', point_id: 12 });
    expect(c._mapAttribute(pts, 'a patrolling orc', { x: 350, y: 60 }, { 1: wander }, new Set(['11', '12']))).toMatchObject({ kind: 'assigned', point_id: 10 });
    expect(c._mapAttribute(pts, 'a patrolling orc', { x: 350, y: 60 }, { 1: wander }, new Set(['10', '11', '12']))).toMatchObject({ kind: 'assigned', point_id: 11 });   // all taken: nearest still
    expect(stripJs(AGENT)).toMatch(/for \(const \[sid, pin\] of P\.m\) if \(sid !== spawnId\) taken\.add\(String\(pin\.point_id\)\);/);
  });
  it('a walker equidistant from two routes stays "?"', () => {
    const { c } = localCore();
    const pts = [walker(10, 0, 0, 7), walker(11, 0, 40, 8)];
    const grids = { 7: { type: 3, pts: [[0, 0, 0, 0], [100, 0, 0, 0]] }, 8: { type: 3, pts: [[0, 40, 0, 0], [100, 40, 0, 0]] } };
    const a = c._mapAttribute(pts, 'a patrolling orc', { x: 50, y: 20 }, grids);   // 20 from each route, within the 60 cap
    expect(a.kind).toBe('unassigned');
    expect(a.candidates.sort()).toEqual([10, 11]);
    // ...and the routes are what settle it once one is clearly nearer: 10 vs 30 is 3x (it is 51 vs 58 by spawn point alone)
    expect(c._mapAttribute(pts, 'a patrolling orc', { x: 50, y: 10 }, grids)).toMatchObject({ kind: 'assigned', point_id: 10 });
    expect(c._mapAttribute(pts, 'a patrolling orc', { x: 50, y: 10 }).kind).toBe('unassigned');
  });
  it('a point whose grid is absent from the payload is judged on its spawn point alone', () => {
    const { c } = localCore();
    expect(c._mapAttribute([walker(10, 0, 0, 7)], 'a patrolling orc', { x: 70, y: 5 }, {}).kind).toBe('unassigned');
    expect(c._mapAttribute([walker(10, 0, 0, 7)], 'a patrolling orc', { x: 5, y: 5 }, null)).toMatchObject({ kind: 'assigned', point_id: 10 });
  });
  it('the pin uses the route too: tab-targeting a walker mid-route pins it to its point', () => {
    const body = Object.assign({}, ZONE_BODY, { points: [walker(10, 0, 0, 7), walker(11, 2000, 2000, null)], grids: { 7: ROUTE } });
    seedCache(dir, body, Date.now());
    const net = fakeNet();
    const c = loadCore({ dir, opts: { botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: '' }, net });
    c._mapEnsureZone('thedeep', 164, Date.now());
    const pin = c._mapTryPin('thedeep', 'Aldenmar', 31, 'a patrolling orc', { x: 70, y: 5, z: 0 }, Date.now());
    expect(pin).toMatchObject({ point_id: 10 });
  });
  it('the zone payload carries the routes with the points and map, and only when the version changes', () => {
    const body = Object.assign({}, ZONE_BODY, { grids: { 7: ROUTE } });
    seedCache(dir, body, T0);
    const net = fakeNet();
    const c = loadCore({ dir, opts: { botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: '' }, net });
    c._mapEnsureZone('thedeep', 164, T0);
    c._zealState.Aldenmar = { zone: 164, updatedAt: T0, loc: { x: 1, y: 2, z: 0 } };
    const first = c._mapStatePayload('', T0 + 1);
    expect(first.grids).toEqual({ 7: ROUTE });
    expect(c._mapStatePayload(first.version, T0 + 2).grids).toBeNull();
    expect(c._mapStatePayload('thedeep@older', T0 + 3).grids).toEqual({ 7: ROUTE });
  });
  it('walked wander legs are kept per route with a count, undirected, and ride every payload; spawn group names ride with the points (2026-10-13)', () => {
    // the guild lead: "If we find the line segment between two of these points we should keep it, and build the full
    // path ... keep these patterns and see if they persist as a common one, then match them up to specific spawn points
    // and spawn groups"
    const body = Object.assign({}, ZONE_BODY, { grids: { 7: ROUTE }, spawngroups: { 41: 'thedeep orc roamers' } });
    seedCache(dir, body, T0);
    const net = fakeNet();
    const c = loadCore({ dir, opts: { botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: '' }, net });
    c._mapEnsureZone('thedeep', 164, T0);
    c._zealState.Aldenmar = { zone: 164, updatedAt: T0, loc: { x: 1, y: 2, z: 0 } };
    expect(c._mapNoteLeg('thedeep', 7, 0, 1, T0)).toEqual({ ok: true, n: 1 });
    expect(c._mapNoteLeg('thedeep', 7, 1, 0, T0 + 1)).toEqual({ ok: true, n: 2 });    // the same leg walked back
    expect(c._mapNoteLeg('thedeep', 7, 1, 2, T0 + 2)).toEqual({ ok: true, n: 1 });
    expect(c._mapNoteLeg('thedeep', 7, 0, 3, T0)).toMatchObject({ ok: false });        // no waypoint 3
    expect(c._mapNoteLeg('thedeep', 7, 1, 1, T0)).toMatchObject({ ok: false });
    expect(c._mapNoteLeg('thedeep', 9, 0, 1, T0)).toMatchObject({ ok: false });        // no such route
    const p = c._mapStatePayload('', T0 + 3);
    expect(p.legs).toEqual({ 7: [[0, 1, 2, 1, 1], [1, 2, 1, 1, 0]] });                  // 0-1 walked each way once
    expect(p.spawngroups).toEqual({ 41: 'thedeep orc roamers' });
    expect(c._mapStatePayload(p.version, T0 + 4).legs).toEqual({ 7: [[0, 1, 2, 1, 1], [1, 2, 1, 1, 0]] });   // legs every poll
    expect(c._mapSaveNow()).toBe(true);
    const c2 = loadCore({ dir, opts: { botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: '' }, net });
    expect(c2._mapZoneDoc('thedeep').legs[7]['0-1'].n).toBe(2);                         // kept across a restart
  });
  it('a tracked NPC (Thelin) has his walk recorded off any target window and sent with the map state (2026-10-14)', () => {
    // the guild lead: "for Thelin, if anyone is targetting him we should track that path and put his path on the map"
    const net = fakeNet();
    const c = loadCore({ dir, opts: { botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: '' }, net });
    c._zealState.Aldenmar = { zone: 204, updatedAt: 1e18, loc: { x: 0, y: 0, z: 0 } };
    // Pipe {x, y} is the server's {y, x} (the coordinate swap): pipe x 10 / y 100 is server x 100 / y 10.
    const look = (name, px, py, at, extra) => c._mapNoteState('Aldenmar', null,
      Object.assign({ zone: 204, target_name: name, target_id: 486, target_type: 1, target_hp_pct: 100, target_loc: { x: px, y: py, z: 5 } }, extra || {}), at);
    look('Thelin Poxbourne', 10, 100, T0);
    look('Thelin Poxbourne', 12, 104, T0 + 1000);       // 4.5 units on: not a new point
    look('Thelin Poxbourne', 10, 240, T0 + 2000);       // 140 on
    look('Thelin Poxbourne', 10, 380, T0 + 40_000);     // nobody had him for 38 s: the line to here is not drawn (and one point alone has not moved 100: not drawn)
    look('Thelin Poxbourne', 10, 1380, T0 + 41_000);    // 1000 on in a second: another body of that name
    look('Thelin Poxbourne', 10, 1520, T0 + 42_000);
    const p = c._mapStatePayload('', T0 + 43_000);
    expect(p.paths['thelin poxbourne'].name).toBe('Thelin Poxbourne');
    expect(p.paths['thelin poxbourne'].pts).toEqual([
      [100, 10, 5, T0, 0], [240, 10, 5, T0 + 2000, 0], [1380, 10, 5, T0 + 41_000, 1], [1520, 10, 5, T0 + 42_000, 0]]);
    expect(p.paths['thelin poxbourne'].live).toBe(true);
    expect(c._mapStatePayload('', T0 + 42_000 + 20_000).paths['thelin poxbourne'].live).toBe(false);   // not watched now
    expect(c._mapSaveNow()).toBe(true);
    const c2 = loadCore({ dir, opts: { botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: '' }, net });
    expect(c2._mapZoneDoc('ponightmare').paths['thelin poxbourne'].pts).toHaveLength(5);              // kept across a restart
  });
  it('only the named list, in its own zone, as a live NPC, is recorded; last run\'s walk is dropped (2026-10-14)', () => {
    const net = fakeNet();
    const c = loadCore({ dir, opts: { botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: '' }, net });
    const state = (zone, name, extra) => Object.assign({ zone, target_name: name, target_id: 9, target_type: 1, target_hp_pct: 100, target_loc: { x: 1, y: 2, z: 0 } }, extra || {});
    c._mapNoteState('Aldenmar', null, state(204, 'a hedge spider'), T0);                                  // not on the list
    c._mapNoteState('Aldenmar', null, state(164, 'Thelin Poxbourne'), T0);                                // right name, wrong zone
    c._mapNoteState('Aldenmar', null, state(204, 'Thelin Poxbourne', { target_type: 0 }), T0);            // a player of that name
    c._mapNoteState('Aldenmar', null, state(204, "Thelin Poxbourne's corpse"), T0);                       // dead
    c._mapNoteState('Aldenmar', null, state(204, 'Thelin Poxbourne', { target_loc: null }), T0);          // no position
    expect(c._mapZoneDoc('ponightmare').paths).toEqual({});
    expect(c._mapZoneDoc('thedeep').paths).toEqual({});
    c._mapNoteState('Aldenmar', null, state(204, '#Thelin_Poxbourne'), T0);                               // spelt the catalog's way
    expect(Object.keys(c._mapZoneDoc('ponightmare').paths)).toEqual(['thelin poxbourne']);
    const WEEK = 7 * 24 * 3_600_000;
    c._mapNoteState('Aldenmar', null, state(204, 'Thelin Poxbourne', { target_loc: { x: 500, y: 600, z: 0 } }), T0 + WEEK);
    expect(c._mapZoneDoc('ponightmare').paths['thelin poxbourne'].pts).toEqual([[600, 500, 0, T0 + WEEK, 0]]);   // the old walk is gone
  });
  it('the raid\'s focus mob rides the payload: the main assist\'s target, else the NPC the most raiders are on, placed only where known (2026-10-14)', () => {
    // the guild lead: "highlight the MA's target or which target has the most people targetting them"
    const seedSeen = (c, name, id) => { const zd = c._mapZoneDoc('thedeep'); zd.seen['1'] = { point_id: 1, spawn_id: id, name, at: T0 }; };
    const rows = (extra) => ({ at: T0, payload: { targets: [
      { kind: 'npc', name: 'a cliff golem', raider_count: 3, spawn_id: 811 },
      { kind: 'npc', name: 'Aldenmar the Pale', raider_count: 9 },
      { kind: 'player', name: 'Brackwyn', raider_count: 12 },
      { kind: 'npc', name: 'a stale thing', raider_count: 20, stale: true }].concat(extra || []) } });
    const { c } = localCore();
    c._zealState.Aldenmar = { zone: 164, updatedAt: 1e18, loc: { x: 0, y: 0, z: 0 } };
    expect(c._mapStatePayload('', T0 + 1).focus).toBeNull();                                    // Extended Target has nothing yet
    c._extTargetCache.set('aldenmar', rows());
    // no MA declared: the most targeted live NPC (never a player, never a stale row); unplaced, we do not know where it is
    expect(c._mapStatePayload('', T0 + 2).focus).toEqual({ name: 'Aldenmar the Pale', id: null, why: 'most', n: 9 });
    // a stale "last seen" row carrying the MA mark is not a live focus
    c._extTargetCache.set('aldenmar', rows([{ kind: 'npc', name: 'an old thing', raider_count: 1, ma_target: true, stale: true },
      { kind: 'player', name: 'Corvale', raider_count: 1, ma_target: true }]));
    expect(c._mapStatePayload('', T0 + 2).focus).toMatchObject({ name: 'Aldenmar the Pale', why: 'most' });
    // the MA's target is the one the bot marked, whatever the headcount
    c._extTargetCache.set('aldenmar', rows([{ kind: 'npc', name: 'a cliff golem', raider_count: 1, spawn_id: 812, ma_target: true }]));
    expect(c._mapStatePayload('', T0 + 3).focus).toEqual({ name: 'a cliff golem', id: 812, why: 'ma', n: 1 });
    // one raider on a mob is not a focus
    c._extTargetCache.set('aldenmar', { at: T0, payload: { targets: [{ kind: 'npc', name: 'a cliff golem', raider_count: 1 }] } });
    expect(c._mapStatePayload('', T0 + 4).focus).toBeNull();
    // placed: your own target is that mob (name and spawn id agree)
    c._extTargetCache.set('aldenmar', rows());
    c._zealState.Aldenmar = Object.assign(c._zealState.Aldenmar, { target_name: 'Aldenmar the Pale', target_id: 77, target_type: 1, target_loc: { x: 10, y: 100, z: 5 } });
    expect(c._mapStatePayload('', T0 + 5).focus).toEqual({ name: 'Aldenmar the Pale', id: null, why: 'most', n: 9, x: 100, y: 10, z: 5, at: 'target' });
    // ...a different mob is your target: not placed there
    c._zealState.Aldenmar.target_name = 'a bat';
    expect(c._mapStatePayload('', T0 + 6).focus.x).toBeUndefined();
    // a pinned mob of that name seen alive on a spawn point: placed on that point
    seedSeen(c, 'Aldenmar_the_Pale', 5);
    expect(c._mapStatePayload('', T0 + 7).focus).toMatchObject({ point_id: 1, at: 'point' });
    // ...but not a pinned mob of another name, or another spawn id
    seedSeen(c, 'a_bat', 5);
    expect(c._mapStatePayload('', T0 + 8).focus.point_id).toBeUndefined();
  });
  it('the overlay marks the focus mob with one ring and a tag saying why, behind a ⚙ switch (2026-10-14)', () => {
    const js = stripJs(MAP_HTML);
    expect(js).toMatch(/if \(SH\.focus && P\.focus\) \{/);
    expect(js).toMatch(/fo\.why === 'ma' \? 'MA' : fo\.n \+ ' targeting'/);
    expect(js).toMatch(/\['focus', 'Raid focus target \(MA \/ most targeted\)'\]/);
  });
  it('the overlay draws every recorded path with the trail painter, whoever has the target (2026-10-14)', () => {
    const js = stripJs(MAP_HTML);
    expect(js).toMatch(/if \(SH\.trail && P\.paths\) for \(var pk in P\.paths\)/);
    expect(js).toMatch(/drawTrail\(tkp\._tr, null, null, null, tkp\.live \? 1 : 0\.6\);/);
    expect(js).toMatch(/brk: s\[4\] === 1/);   // a gap in watching is never bridged
  });
  it('a zone with no routes sends grids: null', () => {
    const { c } = localCore();
    c._zealState.Aldenmar = { zone: 164, updatedAt: T0, loc: { x: 1, y: 2, z: 0 } };
    expect(c._mapStatePayload('', T0 + 1).grids).toBeNull();
  });
  it('the overlay draws the routes dashed in their own colour, ticks the pauses, fades by level, lights the hovered one, badges walkers', () => {
    const js = stripJs(MAP_HTML);
    expect(js).toMatch(/function drawRoutes\(sz, range, srange, targetGrid, onlyTarget\)/);
    expect(js).toMatch(/var list = routeList\(S\.points, sz, range, srange, targetGrid\);/);   // every point, not the visible ones
    expect(js).toMatch(/ctx\.setLineDash\(tgt \? \[7, 3\] : \[4, 4\]\);/);
    expect(js).toMatch(/ctx\.strokeStyle = tgt \? S\.cfg\.col\.routeTarget : hot \? ROUTE_HOT : S\.cfg\.col\.route;/);
    expect(js).toMatch(/if \(SH\.routes\) drawRoutes\(/);
    expect(js).toMatch(/if \(!\(Number\(g\.pts\[j\]\[3\]\) > 0\)\) continue;/);
    expect(js).toMatch(/ctx\.globalAlpha = hot \|\| tgt \? 1 : Math\.min\(1, \(targetGrid \? \(it\.near \? 0\.3 : 0\.12\) : it\.near \? 0\.75 : 0\.25\) \* \(0\.6 \+ 0\.4 \* RK\)\);/);
    expect(js).toMatch(/S\.hoverGrid = g; renderMap\(true\)/);
    expect(js).toMatch(/if \(p\.grid != null && SH\.pather\) halo\('↻'/);
    expect(js).toMatch(/S\.grids = p\.grids \|\| null;/);
  });
});

  it('the floor list and its code are gone', () => {
    const js = stripJs(MAP_HTML);
    expect(MAP_HTML).not.toMatch(/id="floor"/);
    expect(js).not.toMatch(/buildFloorPicker|activeBand|nearestBand|S\.floor|floorSel/);
  });

  // Real-time positions (the guild lead, 2026-10-12: "local locations should update in real time").
  describe('smooth movement', () => {
    const A = { x: 0, y: 0, z: 0, heading: 0 }, B = { x: 100, y: 40, z: 10, heading: 100 };
    it('blends: the midpoint is halfway, t past 1 clamps to the end, t below 0 or NaN stays at the start', () => {
      const m = H.blendPos(A, B, 0.5);
      expect(m.x).toBeCloseTo(50); expect(m.y).toBeCloseTo(20); expect(m.z).toBeCloseTo(5); expect(m.heading).toBeCloseTo(50);
      expect(H.blendPos(A, B, 1.7)).toEqual(B);
      expect(H.blendPos(A, B, -3)).toEqual(A);
      expect(H.blendPos(A, B, NaN)).toEqual(A);
    });
    it('snaps rather than slides when the step is bigger than SNAP_DIST (a zone line, a gate)', () => {
      expect(H.SNAP_DIST).toBeGreaterThanOrEqual(150);
      expect(H.SNAP_DIST).toBeLessThanOrEqual(250);
      const far = { x: 5000, y: 0, z: 0, heading: 0 };
      expect(H.blendPos(A, far, 0.5)).toEqual(far);
      const edge = { x: H.SNAP_DIST - 1, y: 0, z: 0, heading: 0 };
      expect(H.blendPos(A, edge, 0.5).x).toBeCloseTo((H.SNAP_DIST - 1) / 2);
    });
    it('heading turns the short way round the 0-512 wheel', () => {
      expect(H.lerpHeading(500, 12, 0.5)).toBeCloseTo(0);   // 500 -> 12 is 24 across the seam, not 488 back
      expect(H.lerpHeading(12, 500, 0.5)).toBeCloseTo(0);
      expect(H.lerpHeading(0, 100, 0.25)).toBeCloseTo(25);
      expect(H.lerpHeading(null, 40, 0.5)).toBe(40);
    });
    // The smoothing window replaces "glide over the last interval" (always one interval behind): the dot reaches the
    // newest sample `smoothMs` after it arrives, however long the gap before it was.
    it('smoothing Light (80 ms): the dot sits on the newest sample 80 ms after it arrives, and never overshoots', () => {
      expect(H.SMOOTH_MS).toEqual({ off: 0, light: 80, smooth: 250 });
      let tr = H.trackStep(undefined, A, 1000, H.SMOOTH_MS.light);
      expect(H.trackMoving(tr, 1000)).toBe(false);          // the first sight of a name has nowhere to glide from
      tr = H.trackStep(tr, B, 1300, H.SMOOTH_MS.light);     // however long the silence, the glide is the window
      expect(tr.dur).toBe(80);
      expect(H.trackAt(tr, 1300).x).toBeCloseTo(0);
      expect(H.trackAt(tr, 1340).x).toBeCloseTo(50);
      expect(H.trackAt(tr, 1380)).toEqual(B);               // lag <= 80 ms
      expect(H.trackAt(tr, 9000)).toEqual(B);
      expect(H.trackMoving(tr, 1340)).toBe(true);
      expect(H.trackMoving(tr, 1380)).toBe(false);          // an idle map stops asking for frames
    });
    it('smoothing Off draws the newest sample exactly, the moment it arrives', () => {
      const tr = H.trackStep(H.trackStep(undefined, A, 1000, 0), B, 1100, 0);
      expect(H.trackAt(tr, 1100)).toEqual(B);
      expect(H.trackMoving(tr, 1100)).toBe(false);
      expect(H.trackAt(tr, 1101)).toEqual(B);
    });
    it('smoothing Smooth (250 ms) is slower than Light at the same instant', () => {
      const light = H.trackStep(H.trackStep(undefined, A, 0, 80), B, 100, 80);
      const smooth = H.trackStep(H.trackStep(undefined, A, 0, 250), B, 100, 250);
      expect(H.trackAt(smooth, 140).x).toBeLessThan(H.trackAt(light, 140).x);
      expect(H.trackAt(smooth, 350)).toEqual(B);
    });
    it('the same sample again does not restart the glide; a new one starts from where the dot is drawn', () => {
      const tr = H.trackStep(H.trackStep(undefined, A, 1000, 80), B, 1300, 80);
      expect(H.trackStep(tr, B, 1340, 80)).toBe(tr);
      const C = { x: 100, y: 140, z: 10, heading: 100 };
      const next = H.trackStep(tr, C, 1340, 80);            // mid-glide: from = the drawn spot, not the old sample
      expect(next.from.x).toBeCloseTo(50);
      expect(next.to).toEqual(C);
    });
    it('a big jump on a track snaps (no glide)', () => {
      let tr = H.trackStep(undefined, A, 0, 80);
      const far = { x: 3000, y: 3000, z: 0, heading: 0 };
      tr = H.trackStep(tr, far, 300, 80);
      expect(H.trackMoving(tr, 300)).toBe(false);
      expect(H.trackAt(tr, 300)).toEqual(far);
    });
    it('polls at 300ms or faster, skips while hidden, keeps the in-flight guard and the have= cache', () => {
      const js = stripJs(MAP_HTML);
      const ms = /var POLL_MS = (\d+);/.exec(js);
      expect(ms && Number(ms[1])).toBeLessThanOrEqual(300);
      expect(js).toMatch(/setInterval\(poll, POLL_MS\)/);
      expect(js).toMatch(/function poll\(\) \{\s*if \(inflight \|\| document\.hidden\) return;/);
      expect(js).toMatch(/'\?have=' \+ encodeURIComponent\(S\.ver\)/);
    });
    it('animates on requestAnimationFrame only while something moves, drops vanished names, and throttles the hit buttons', () => {
      const js = stripJs(MAP_HTML);
      expect(js).toMatch(/function kickAnim\(\)[\s\S]{0,200}?if \(anyMoving\(Date\.now\(\)\)\) raf = requestAnimationFrame\(frame\);/);
      expect(js).toMatch(/for \(var k in S\.trk\) if \(!keep\[k\]\) delete S\.trk\[k\];/);
      expect(js).toMatch(/if \(!animating \|\| rt - lastHits >= HITS_MS\) \{ lastHits = rt; layoutHits\(SH\.dots \? vis : \[\]\); layoutCorpseHits\(corpseVis\); \}/);
      expect(Number(/\bHITS_MS = (\d+)/.exec(js)[1])).toBeGreaterThanOrEqual(200);
      // Follow me rides the drawn spot of you, and the flashing ring still has its own timer
      expect(js).toMatch(/if \(S\.follow && S\.p && !S\.drag\) followTo\(followSubject\(rt\)\);/);
      expect(js).toMatch(/return P\.self \? drawn\('self', P\.self, rt\) : null;/);
      expect(js).toMatch(/flashTimer = setInterval\(/);
    });
  });

  // Boots the overlay's script against a stub page. Returns its state object S and the stub elements by id.
  // `mimic` is window.mimic (undefined = a plain browser), `store` a localStorage in a plain object.
  async function bootOverlay({ mimic, store = {}, payload: given, winSize } = {}) {
    const script = MAP_HTML.slice(MAP_HTML.indexOf('<script>') + 8, MAP_HTML.lastIndexOf('</script>'));
    const all = {};
    const mkEl = (tag) => {
      const e = { tag, children: [], style: {}, dataset: {}, attrs: {}, listeners: {}, hidden: false, textContent: '', innerHTML: '',
        clientWidth: 600, clientHeight: 400, offsetWidth: 50, offsetHeight: 20,
        classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); } },
        appendChild(ch) { this.children.push(ch); return ch; }, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
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
    const payload = {
      zone: 'thedeep', long_name: 'The Deep', version: 'thedeep@v', status: 'ok', now: T0, local_only: false,
      points: POINTS.map(p => (p.id === 1 ? Object.assign({}, p, { grid: 7 }) : p)), map: ZONE_BODY.map,
      grids: { 7: { type: 3, type2: 0, pts: [[0, 0, 0, 0], [100, 0, 0, 5], [100, 100, 0, 0]] } },
      zone_id: 164, self: { x: 90, y: 190, z: 0, heading: 64, name: 'Aldenmar' },
      group: [{ name: 'Brackwyn', x: 100, y: 180, z: 0 }], raid: [], target: { name: 'a decaying skeleton', x: 110, y: 210, z: 0, dist: 28, point_id: 1 },
      seen: [{ point_id: 2, spawn_id: 812, name: 'a decaying skeleton', at: T0 - 120000, by: 'Corvale' }],
      timers: [{ point_id: 1, name: 'a decaying skeleton', died_at: T0, earliest: T0 + 540000, latest: T0 + 660000, source: 'seen', state: 'wait' }],
      unassigned: [{ id: 'u1', name: 'a decaying skeleton', died_at: T0, candidates: [2, 6] }],
    };
    const fetched = [];
    const win = Object.assign({ addEventListener() {}, devicePixelRatio: 1, mimic }, winSize || {});
    const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
    // eslint-disable-next-line no-new-func
    const S = new Function('window', 'document', 'location', 'fetch', 'localStorage', 'ResizeObserver', 'setInterval', 'clearInterval',
      script + '\nreturn S;')(win, doc, { search: '' }, (u) => { fetched.push(u); return Promise.resolve({ json: () => Promise.resolve(given || payload) }); },
      ls, undefined, () => 1, () => {});
    await tick();
    return { S, all, fetched, store, payload, doc };
  }

  it('runs: with window.mimic ABSENT it still draws spots, hover-capable buttons and the timer list', async () => {
    const { all, fetched } = await bootOverlay();
    expect(fetched[0]).toBe('http://127.0.0.1:7779/api/map-state');
    const hits = all.hits.children;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every(h => h.tag === 'button' && h.attrs['data-wp-interact'] === '')).toBe(true);
    expect(all.lists.children.some(r => /trow/.test(r.className))).toBe(true);
    expect(all.zone.textContent).toBe('The Deep');
    // a second poll asks with the version it holds
    expect(all.msg.style.display).toBe('none');
    // a pinned target says so, and a seen-alive point gets its own row (with who saw it, when a guildmate did)
    expect(all.tgt.textContent).toMatch(/→ pinned$/);
    const seenRow = all.lists.children.find(r => /trow seen/.test(r.className));
    expect(seenRow).toBeTruthy();
    expect(seenRow.children.map(k => k.textContent).join('|')).toMatch(/spawn #812 · by Corvale/);
  });

  it('the Fit button cycles Fit zone -> Fit group -> Fit raid, turns Follow off, keeps the choice, and says when it fell back', async () => {
    const { S, all, store } = await bootOverlay();
    const click = () => all.fitBtn.listeners.click.forEach(f => f.call(all.fitBtn));
    expect(all.fitBtn.textContent).toBe('Fit zone');
    expect(S.follow).toBe(true);
    click();
    expect(all.fitBtn.textContent).toBe('Fit group'); expect(S.follow).toBe(false); expect(store['wp-map-fit']).toBe('group');
    expect(all.fitBtn.title).not.toMatch(/no group/);          // the payload has a group member
    const groupView = Object.assign({}, S.view);
    click();                                                    // raid: the payload has none, so it falls back to the group
    expect(all.fitBtn.textContent).toBe('Fit raid'); expect(store['wp-map-fit']).toBe('raid');
    expect(all.fitBtn.title).toMatch(/no raid, fitting your group/);
    expect(S.view.scale).toBeCloseTo(groupView.scale);
    click();
    expect(all.fitBtn.textContent).toBe('Fit zone');
    expect(S.view.scale).toBeLessThan(groupView.scale);         // the whole zone is wider than you + one groupmate
  });
  it('the top-right Timers button slides the timers list in and out; the choice is remembered', async () => {
    // the guild lead, 2026-10-12: "slide the spawn timers in and out. So that it could take up less space"
    const base = await bootOverlay();
    expect(base.S.sideOpen).toBe(true);                              // default: the list is out
    expect(base.all.wrap.classList.contains('noside')).toBe(false);
    expect(base.all.sideBtn.textContent).toBe('Timers ▸');
    base.all.sideBtn.listeners.click.forEach(f => f());
    expect(base.all.wrap.classList.contains('noside')).toBe(true);
    expect(base.all.sideBtn.textContent).toBe('◂ Timers');
    expect(base.store['wp-map-side']).toBe('0');
    const again = await bootOverlay({ store: base.store });
    expect(again.all.wrap.classList.contains('noside')).toBe(true);
  });
  it('⚙ opens the Map settings; a switch, an icon and a colour are saved and survive a restart; Reset puts it all back', async () => {
    // the guild lead, 2026-10-12: "a config section for the map that pops up similar to the hud's"
    const base = await bootOverlay();
    base.all.cfg.hidden = true;                                                // the markup's `hidden` attribute
    base.all.cfgBtn.listeners.click.forEach(f => f());
    expect(base.all.cfg.hidden).toBe(false);
    expect(base.all.cfgBtn.classList.contains('on')).toBe(true);
    const showRows = base.all.cfgShow.children, glyphRows = base.all.cfgGlyphs.children, colRows = base.all.cfgCols.children;
    expect(showRows).toHaveLength(30);                                         // 25 + Kite coach + Guild kite loops (2026-10-15) + AE rampage ring + Rampage ring + Guild corpses
    expect(glyphRows).toHaveLength(9);
    expect(colRows).toHaveLength(30);                                          // ...and the Corpses colour
    const walls = showRows[0].children[0];                                     // Walls
    walls.checked = false; walls.listeners.change.forEach(f => f());
    const eye = glyphRows[0].children[0];                                      // 👁
    eye.checked = false; eye.listeners.change.forEach(f => f());
    const routeCol = colRows[2].children[1];                                   // Walker routes
    routeCol.value = '#ff00ff'; routeCol.listeners.input.forEach(f => f());
    const saved = JSON.parse(base.store['wp-map-cfg']);
    expect(saved.show.walls).toBe(false);
    expect(saved.glyphsOff).toEqual({ '👁': true });
    expect(saved.col.route).toBe('#ff00ff');
    expect(saved.scheme).toBe('custom');                                       // editing a colour leaves the preset
    const again = await bootOverlay({ store: base.store });
    expect(again.S.cfg.show.walls).toBe(false);
    expect(again.S.cfg.col.route).toBe('#ff00ff');
    again.all.cfgReset.listeners.click.forEach(f => f());
    expect(JSON.parse(again.store['wp-map-cfg']).show.walls).toBe(true);
    expect(again.S.cfg.col.route).toBe('#39c5cf');
    again.all.cfgClose.listeners.click.forEach(f => f());
    expect(again.all.cfg.hidden).toBe(true);
  });
  it('◯ on the toolbar turns the aggro rings on and off, saved, the same switch as ⚙ → Aggro rings', async () => {
    const base = await bootOverlay();
    expect(base.S.cfg.show.aggro).toBe(false);
    expect(base.all.aggroBtn.classList.contains('on')).toBe(false);
    base.all.aggroBtn.listeners.click.forEach(f => f());
    expect(base.S.cfg.show.aggro).toBe(true);
    expect(base.all.aggroBtn.classList.contains('on')).toBe(true);
    expect(JSON.parse(base.store['wp-map-cfg']).show.aggro).toBe(true);
    const again = await bootOverlay({ store: base.store });
    expect(again.all.aggroBtn.classList.contains('on')).toBe(true);           // remembered
    again.all.aggroBtn.listeners.click.forEach(f => f());
    expect(again.S.cfg.show.aggro).toBe(false);
  });
  it('• on the toolbar hides and shows the spawn points, saved, the same switch as ⚙ → Spawn points (2026-10-13)', async () => {
    // the guild lead: "Showing/hiding spawnpoints should be a quick-button on the top nav of our map next to the circles"
    const base = await bootOverlay();
    expect(base.all.dotsBtn.classList.contains('on')).toBe(true);
    base.all.dotsBtn.listeners.click.forEach(f => f());
    expect(base.S.cfg.show.dots).toBe(false);
    expect(base.all.dotsBtn.classList.contains('on')).toBe(false);
    expect(JSON.parse(base.store['wp-map-cfg']).show.dots).toBe(false);
    const again = await bootOverlay({ store: base.store });
    expect(again.all.dotsBtn.classList.contains('on')).toBe(false);
    again.all.dotsBtn.listeners.click.forEach(f => f());
    expect(again.S.cfg.show.dots).toBe(true);
    const tools = sliceBlock(MAP_HTML, '<div id="tools">', '</div>');
    expect(tools.indexOf('id="dotsBtn"')).toBeLessThan(tools.indexOf('id="aggroBtn"'));   // next to ◯
  });
  it('Raiders on the toolbar hides and shows the raid and group name labels in one click, saved; dots and mob names stay (2026-10-14)', async () => {
    // the guild lead: "map should have a quick hide raiders labels too"
    const base = await bootOverlay();
    expect(base.all.namesBtn.classList.contains('on')).toBe(true);
    base.all.namesBtn.listeners.click.forEach(f => f());
    expect(base.S.cfg.show.raidNames).toBe(false);
    expect(base.S.cfg.show.groupNames).toBe(false);
    expect(base.S.cfg.show.raid).toBe(true);          // the dots stay
    expect(base.S.cfg.show.group).toBe(true);
    expect(base.S.cfg.show.bosses).toBe(true);        // mob labels untouched
    expect(base.S.cfg.show.upLabel).toBe(true);
    expect(base.all.namesBtn.classList.contains('on')).toBe(false);
    expect(JSON.parse(base.store['wp-map-cfg']).show.raidNames).toBe(false);
    const again = await bootOverlay({ store: base.store });
    expect(again.all.namesBtn.classList.contains('on')).toBe(false);           // remembered
    again.all.namesBtn.listeners.click.forEach(f => f());
    expect(again.S.cfg.show.raidNames).toBe(true);
    expect(again.S.cfg.show.groupNames).toBe(true);
    // a real <button> inside the toolbar: the preload arms the hover handshake on its own
    expect(sliceBlock(MAP_HTML, '<div id="tools">', '</div>')).toMatch(/<button class="tb on" id="namesBtn" type="button"/);
    // and the draw still hangs the names on those two switches
    expect(stripJs(MAP_HTML)).toMatch(/dotsOf\(P\.raid, CO\.raid, 3 \* I\.dot, 'r:', SH\.raidNames\)/);
  });
  it('the readout: /loc order, the cursor back to the server frame, speed over a full second (2026-10-13)', () => {
    // the guild lead: "the run speed and the current player location coordinates in the top left ... as well as the
    // mouseover coordinates where the player's cursor is"
    expect(H.locText(65.4, 28.2)).toBe('28, 65');                                // Y first, like /loc
    const view = { cx: 10, cy: -20, scale: 2 }, w = 400, h = 300;
    for (const [x, y] of [[0, 0], [123, -45], [-300, 77]]) {                    // round trip through wpt's maths
      const s = H.toScreen(x, y), px = (s.sx - view.cx) * view.scale + w / 2, py = (s.sy - view.cy) * view.scale + h / 2;
      const back = H.screenToServer(px, py, view, w, h);
      expect(back.x).toBeCloseTo(x); expect(back.y).toBeCloseTo(y);
    }
    expect(H.speedOf([{ t: 0, x: 0, y: 0 }, { t: 500, x: 30, y: 40 }])).toBeNull();   // under a second: not yet
    expect(H.speedOf([{ t: 0, x: 0, y: 0 }, { t: 1000, x: 30, y: 40 }])).toBeCloseTo(50);
    expect(MAP_HTML).toMatch(/<div id="locBar"><\/div>/);
    // 2026-10-14, "Our speed calculation looks wrong": Zeal's map read 277% while ours read 84 u/s. Same speed, other
    // units; the readout now speaks Zeal's % of normal run.
    expect(Math.round(H.runPct(84))).toBe(277);
    expect(H.runPct(null)).toBeNull();
    expect(MAP_HTML).toContain("Math.round(runPct(sp)) + '%'");
  });
  it('Opacity heads the settings; the walked-path trail; the Pan / zoom button zooms on the wheel and pans on a drag (2026-10-13)', async () => {
    // the guild lead: "Own strength should say opacity in the options and should be right at the top"; "Can we show the
    // path that we observed a mob walking towards?"; "if you mouse over pan /zoom you should be able to zoom in and
    // out, and if you click and drag on that button we should pan"
    const cfg = sliceBlock(MAP_HTML, '<div id="cfg"', '<div id="side">');
    expect(cfg.indexOf('<span class="bl">Opacity</span>')).toBeGreaterThan(-1);
    expect(cfg.indexOf('<span class="bl">Opacity</span>')).toBeLessThan(cfg.indexOf('Heights'));
    expect(MAP_HTML).not.toMatch(/class="bl">Own strength/);
    let tr = H.trailStep(null, 't:5', 0, 0, 0);
    tr = H.trailStep(tr, 't:5', 2, 0, 100);                   // under a step: not a new crumb
    tr = H.trailStep(tr, 't:5', 10, 0, 200);
    expect(tr.pts.map(p => p.x)).toEqual([0, 10]);
    expect(H.trailStep(null, 't:6', 50, 50, 300).pts).toHaveLength(1);   // a new mob starts its own trail
    expect(H.trailStep(tr, 't:5', 30, 0, 200 + 3600000).pts.map(p => p.x)).toEqual([0, 10, 30]);   // kept while in the zone
    const base = await bootOverlay();
    const scale0 = base.S.view.scale;
    base.all.panBtn.listeners.wheel.forEach(f => f({ deltaY: -200, preventDefault() {} }));
    expect(base.S.view.scale).toBeGreaterThan(scale0);
    expect(base.S.panMode).toBeFalsy();                      // zooming does not switch Pan on
    base.all.panBtn.listeners.mousedown.forEach(f => f({ button: 0, clientX: 100, clientY: 100 }));
    expect(base.S.drag && base.S.drag.btn).toBe(true);
    const js = stripJs(MAP_HTML);
    expect(js).toMatch(/if \(S\.panDragged\) \{ S\.panDragged = false; return; \}/);   // a drag is not a click
    expect(js).toMatch(/if \(d\.btn && !\(e\.buttons & 1\)\)/);                          // a lost mouseup ends it
    expect(js).toMatch(/if \(SH\.trail && C\.tail > 0\) drawTrail\(tTrail, tq, tGrid, CO\.routeTarget, /);   // ⚙ → Tail (2026-10-15): Off draws none
  });
  it('a roamer\'s leg is confirmed when it reaches the far waypoint; a tab-away gap breaks the trail; its pace; its spawn group (2026-10-13)', () => {
    // the guild lead: "Tabbing between two pathing mobs, i expected to see the whole extrapolated dashed line and the
    // pace of the mob going towards that point ... If we find the line segment between two of these points we should
    // keep it ... It should highlight the whole path of that mob, and the other ones should fade"
    const g = [[0, 0], [100, 0], [100, 100]];
    let tr = null;
    for (let x = 10; x <= 80; x += 10) tr = H.trailStep(tr, 't:9', x, 0, x * 100);   // 10 units / s along 0 → 1
    expect(H.noteWanderLeg(tr, g)).toBeNull();                                       // 20 short of waypoint 1
    expect(H.trailSpeed(tr, 8000, 3000)).toBeCloseTo(10, 5);
    expect(H.trailSpeed(tr, 8000 + 5000, 3000)).toBe(0);                             // no new crumb for 5 s: stopped
    tr = H.trailStep(tr, 't:9', 90, 0, 9000);
    expect(H.noteWanderLeg(tr, g)).toEqual({ prev: 0, next: 1, done: true });        // within LEG_REACH of waypoint 1
    expect(H.noteWanderLeg(tr, g)).toBeNull();                                       // reported once
    // Tabbed away for a minute: the next crumb starts a new stretch; no heading or pace is read across the gap.
    tr = H.trailStep(tr, 't:9', 100, 60, 70000);
    expect(tr.pts[tr.pts.length - 1].brk).toBe(true);
    expect(H.trailStretch(tr)).toHaveLength(1);
    expect(H.trailSpeed(tr, 70000, 3000)).toBeNull();
    expect(H.noteWanderLeg(tr, g)).toBeNull();
    const pts = [
      { id: 1, x: 0, y: 0, grid: 5, sg: 41, npcs: [{ name: 'A Crystalline Golem' }] },
      { id: 2, x: 50, y: 0, grid: 5, sg: 41, npcs: [{ name: 'A Crystalline Golem' }] },
      { id: 3, x: 900, y: 0, grid: 6, sg: 42, npcs: [{ name: 'A Crystalline Golem' }] },
      { id: 4, x: 0, y: 50, grid: 5, sg: 43, npcs: [{ name: 'a gnoll' }] }];
    const byId = Object.fromEntries(pts.map(p => [String(p.id), p]));
    const sgs = { 41: 'povalor golem roamers', 42: 'povalor A Crystalline Golem18' };
    expect(H.targetSpawnGroup({ name: 'A Crystalline Golem' }, pts, byId, sgs, 5)).toEqual({ name: 'povalor golem roamers', points: 2 });
    expect(H.targetSpawnGroup({ name: 'A Crystalline Golem', point_id: 3 }, pts, byId, sgs, null)).toEqual({ name: 'povalor A Crystalline Golem18', points: 1 });
    expect(H.targetSpawnGroup({ name: 'A Crystalline Golem' }, pts, byId, null, 5)).toBeNull();   // an older bot: no names
    // "show that with an arrow 60% between the previous point and the next on that line segment"
    const ar = H.legArrow([0, 0], [100, 0], H.LEG_ARROW_AT, 7);
    expect(ar[0]).toEqual([60, 0]);                                                   // tip 60% along, toward b
    expect(ar[1][0]).toBeLessThan(60); expect(ar[2][0]).toBeLessThan(60);             // barbs behind the tip
    expect(H.legArrow([100, 0], [0, 0], H.LEG_ARROW_AT, 7)[0]).toEqual([40, 0]);      // walked back: its own arrow
    expect(H.legArrow([0, 0], [5, 0], 0.6, 7)).toBeNull();                            // too short to carry one
    const js = stripJs(MAP_HTML);
    expect(js).toMatch(/if \(Number\(lg\[3\]\) > 0\) fillArrow\(legArrow\(lqa, lqb, LEG_ARROW_AT/);
    expect(js).toMatch(/if \(Number\(lg\[4\]\) > 0\) fillArrow\(legArrow\(lqb, lqa, LEG_ARROW_AT/);
    expect(js).toMatch(/if \(walked\) postLeg\(tGid, walked\);/);
    expect(js).toMatch(/ctx\.globalAlpha = hot \|\| tgt \? 1 : Math\.min\(1, \(targetGrid \? \(it\.near \? 0\.3 : 0\.12\) : it\.near \? 0\.75 : 0\.25\) \* \(0\.6 \+ 0\.4 \* RK\)\);/);
    expect(js).toMatch(/var learned = S\.p && S\.p\.legs \? S\.p\.legs\[it\.gid\] : null/);
    expect(js).toMatch(/if \(tr\.pts\[i\]\.brk\) continue;/);
  });
  it('a chasing mob teaches no leg: not while it has a target, not on a curving chase (2026-10-13)', () => {
    // the guild lead, a swarm kited by a bard drawn across a dozen paths: "we need to ignore when a mob is aggroed
    // and has a circular path chasing a bard"
    const g = [[0, 0], [100, 0], [100, 100]];
    const walk = (aggroAt) => {
      let tr = null;
      for (let x = 10; x <= 90; x += 10) tr = H.trailStep(tr, 't:9', x, 0, x * 100, x === aggroAt);
      return H.noteWanderLeg(tr, g);
    };
    expect(walk(null)).toEqual({ prev: 0, next: 1, done: true });   // a straight, unpulled walk is still learned
    expect(walk(60)).toBeNull();                                    // it had a target partway along: not learned
    expect(walk(10)).toBeNull();                                    // ... from the first step
    // A chase: it heads at waypoint 1, loops round the bard, and comes back across it. No target-of-target here
    // (an older Zeal), so the curve alone has to reject it.
    let tr = null, t = 0;
    for (let x = 10; x <= 50; x += 10) tr = H.trailStep(tr, 't:9', x, 0, (t += 1000));
    for (const [x, y] of [[70, 25], [55, 50], [35, 35], [45, 10], [60, 3], [75, 1], [90, 0]]) tr = H.trailStep(tr, 't:9', x, y, (t += 1000));
    expect(H.noteWanderLeg(tr, g)).toBeNull();
    expect(tr.legs[tr.legs.length - 1].done).toBe(true);           // and it is not tried again
  });
  it('the trail says what the mob was doing: yellow pathing, red off its home with a glow where it left, reddish-orange walking back (2026-10-13)', () => {
    // the guild lead: "The point that the mob leaves its spawn or its path it should be glowing RED, then when it appears
    // to be walking back towards its home base it should be redish-orange. Pathing can be yellow."
    const grid = { type: 3, pts: [[0, 0], [200, 0]] };
    const home = H.homeOf(grid, 7, null);
    expect(home).toMatchObject({ key: 'g7', rnd: false });
    const tr = { pts: [[50, 0], [100, 5], [110, 60], [120, 120], [115, 80], [105, 20], [150, 2]].map(([x, y], i) => ({ x, y, t: i })), legs: [] };
    H.classifyTrail(tr, home);
    expect(tr.pts.map(c => c.st)).toEqual(['path', 'path', 'away', 'away', 'back', 'path', 'path']);
    expect(tr.pts.map(c => !!c.leave)).toEqual([false, false, true, false, false, false, false]);   // where it stepped off
    expect(H.TRAIL_COL).toMatchObject({ path: '#ffd23f', away: '#ff3b30', back: '#ff7a33' });
    // A random wanderer may walk between ANY two waypoints: a spot on the 0→2 diagonal is on its path.
    const rnd = H.homeOf({ type: 8, pts: [[0, 0], [100, 0], [100, 100]] }, 9, null);
    expect(H.homeDist({ x: 50, y: 50 }, rnd)).toBeCloseTo(0, 5);
    expect(H.homeDist({ x: 50, y: 50 }, H.homeOf({ type: 3, pts: [[0, 0], [100, 0], [100, 100]] }, 9, null))).toBe(50);   // in order: not
    // No route: its spawn point is home.
    const ph = H.homeOf(null, null, { id: 4, x: 0, y: 0 });
    const st = { pts: [{ x: 0, y: 10, t: 0 }, { x: 0, y: 80, t: 1 }], legs: [] };
    H.classifyTrail(st, ph);
    expect(st.pts.map(c => c.st)).toEqual(['path', 'away']);
    H.classifyTrail(st, null);                                                        // home lost: everything reads as pathing
    expect(st.pts.map(c => c.st)).toEqual(['path', 'path']);
  });
  it('a killed mob\'s path fades, drops out after a few more kills, and comes back faded for the next mob from its spawn point (2026-10-13)', () => {
    // the guild lead: "mob's pathing should be faded when it's killed, and it should disappear after a few kills. It
    // can come back as a faded path for that same spawn point the next time the mob is targetted from that same spawn point"
    const st = { kills: 0, killSeen: {}, killPrimed: false, pointTrails: {} };
    const trA = { pid: '11', pts: [{ x: 0, y: 0, t: 1000 }, { x: 10, y: 0, t: 2000 }], legs: [] };
    const trails = { 't:5': trA };
    H.noteKills({ timers: [{ point_id: 99, died_at: 500 }] }, trails, st);            // already there when the zone loaded
    expect(st.kills).toBe(0);
    H.noteKills({ timers: [{ point_id: 99, died_at: 500 }, { point_id: 11, died_at: 3000 }] }, trails, st);
    expect(st.kills).toBe(1);
    expect(trA.dead).toBe(1);
    expect(st.pointTrails['11']).toBe(trA);                                           // kept for its spawn point
    expect(H.trailShown(trA, st.kills)).toBe(true);
    H.noteKills({ timers: [{ point_id: 11, died_at: 3000 }] }, trails, st);           // the same death again: not a new kill
    expect(st.kills).toBe(1);
    for (let k = 0; k < H.KILLS_FADE; k++) H.noteKills({ timers: [{ point_id: 50 + k, died_at: 4000 + k }] }, trails, st);
    expect(H.trailShown(trA, st.kills)).toBe(false);                                  // gone after a few more kills
    expect(st.pointTrails['11']).toBe(trA);                                           // ...but still there for that point
    const js = stripJs(MAP_HTML);
    expect(js).toMatch(/if \(SH\.trail && arch && arch !== tTrail\) drawTrail\(arch, null, null, null, 0\.3\);/);
    expect(js).toMatch(/drawTrail\(tTrail, tq, tGrid, CO\.routeTarget, tTrail && tTrail\.dead != null \? 0\.35 : 1, C\.tail\);/);
  });
  it('Fit leaves stragglers out; Follow keeps your spot on screen; spawns hidden hide the routes; labels all / targets / off (2026-10-13)', () => {
    // the guild lead: "In plane of valor fit raid or fit group just zooms out to the whole zone"; "Follow me doesn't
    // need to center the map on the player ... right clicking the follow me can lock it"; "Hiding spawns should also
    // hide the pathing markers"
    const me = { x: 0, y: 0 };
    const pack = [{ x: 30, y: 0 }, { x: 0, y: 40 }, { x: -20, y: 10 }, { x: 5000, y: 5000 }];
    expect(H.nearPack(me, pack)).toHaveLength(3);                                     // the one at the zone-in is left out
    expect(H.membersBounds(me, pack).maxX).toBeLessThan(1000);
    expect(H.nearPack(me, [{ x: 300, y: 0 }, { x: 0, y: 350 }])).toHaveLength(2);    // within FIT_NEAR: kept
    const view = { cx: 0, cy: 0, scale: 1 }, s = H.toScreen(10, 20);
    view.cx = s.sx - 50; view.cy = s.sy + 30;                                         // you sit 50 px right, 30 px up
    expect(H.followOffNow({ x: 10, y: 20 }, view, 400, 300)).toEqual({ x: 50, y: -30 });
    expect(H.followOffNow({ x: 10, y: 20 }, { cx: s.sx - 1000, cy: s.sy, scale: 1 }, 400, 300)).toEqual({ x: 0, y: 0 });   // off screen: the middle
    expect(H.labelMode('1')).toBe('all'); expect(H.labelMode('0')).toBe('off'); expect(H.labelMode('targets')).toBe('targets');
    const js = stripJs(MAP_HTML);
    expect(js).toMatch(/drawRoutes\(sz, range, srange, routeTarget\(S\.p && S\.p\.target, S\.points, S\.grids, S\.byId\), !SH\.dots\);/);
    expect(js).toMatch(/if \(onlyTarget\) list = list\.filter\(function \(it\) \{ return it\.gid === targetGrid; \}\);/);
    expect(js).toMatch(/addEventListener\('contextmenu', function \(e\) \{\s*e\.preventDefault\(\);\s*S\.followLock = !S\.followLock;/);
    expect(js).toMatch(/if \(!group\.length && P\.my_grp != null\) group = raid\.filter/);
  });
  it('a dashed heading line ahead of the mob; a shared-route pin is drawn to every point on the route; the button bar locks to an edge, upright on the sides (2026-10-13)', () => {
    // the guild lead: "Why don't we see the purple line i drew ... as a dashed line of where the mob should be moving
    // towards if it continues the current path?"; "Why is this non-pathing mob being targetted to a different spawn?";
    // "The buttons for the map should be draggable separate from the whole window and lock onto a part of the window,
    // also have a vertical mode"
    let tr = null;
    for (let i = 0; i < 5; i++) tr = H.trailStep(tr, 't:1', i * 6, i * 8, i * 500);    // heading (0.6, 0.8)
    const hr = H.headingRay(tr, 10);
    expect(hr.ux).toBeCloseTo(0.6, 5); expect(hr.uy).toBeCloseTo(0.8, 5);
    expect(H.headingRay(H.trailStep(null, 't:2', 0, 0, 0), 10)).toBeNull();            // standing still: none
    const golem = n => ({ name: n });
    const pts = [{ id: 1, grid: 1, npcs: [golem('A Crystalline Golem')] }, { id: 2, grid: 1, npcs: [golem('A Crystalline Golem')] },
      { id: 3, grid: 1, npcs: [golem('a gnoll')] }, { id: 4, grid: null, npcs: [golem('A Crystalline Golem')] }];
    expect(H.routeTwins(pts[0], pts).map(p => p.id)).toEqual([1, 2]);                // its route's golems, not the gnoll
    expect(H.routeTwins(pts[3], pts).map(p => p.id)).toEqual([4]);                   // a point with no route: itself
    expect(H.toolDock(10, 200, 800, 600)).toBe('left');
    expect(H.toolDock(400, 590, 800, 600)).toBe('bottom');
    expect(H.toolDock(790, 300, 800, 600)).toBe('right');
    expect(H.toolDock(400, 5, 800, 600)).toBe('top');
    expect(H.toolBox('top', 0, 300, 24, 800, 600, 6)).toEqual({ left: 30, top: 6 });   // where it always sat
    expect(H.toolBox('left', 0, 40, 200, 800, 600, 6)).toEqual({ left: 6, top: 30 });  // clear of the ✥
    expect(H.toolBox('right', 1, 40, 200, 800, 600, 6)).toEqual({ left: 754, top: 394 });
    expect(H.toolBox('bottom', 0.5, 300, 24, 800, 600, 6)).toEqual({ left: 250, top: 570 });
    // "if we're using something like Solidarity of Vision could we have a 'Follow Target' mode"; "give me the distance
    // from a mob's spawn point if it's known"
    expect(H.nextFollow(false, 'me', true)).toEqual({ follow: true, who: 'me' });
    expect(H.nextFollow(true, 'me', true)).toEqual({ follow: true, who: 'target' });
    expect(H.nextFollow(true, 'me', false)).toEqual({ follow: false, who: 'me' });      // no target on the map: straight to off
    expect(H.nextFollow(true, 'target', true)).toEqual({ follow: false, who: 'me' });
    const pin = { id: 9, x: 100, y: 100 };
    expect(H.spawnDistance({ x: 130, y: 140 }, pin, [pin])).toBe(50);
    expect(H.spawnDistance({ x: 130, y: 140 }, pin, [pin, { id: 10 }])).toBeNull();     // a shared route: which point is a guess
    expect(H.spawnDistance({ x: 130, y: 140 }, null, null)).toBeNull();
    expect(H.spawnDistance({ x: 100, y: 100, z: 260 }, { id: 9, x: 100, y: 100, z: 60 }, null)).toBe(200);   // 3D, like the gate rule
    expect(H.GATE_RANGE).toBe(200);
    const js = stripJs(MAP_HTML);
    expect(js).toMatch(/if \(S\.follow && S\.p && !S\.drag\) followTo\(followSubject\(rt\)\);/);
    expect(js).toMatch(/if \(!\(e\.buttons & 1\)\) \{ endToolDrag\(\); return; \}/);
    expect(js).toMatch(/var twins = routeTwins\(pinPt, S\.points\);/);
    expect(MAP_HTML).toMatch(/<button class="tb grip" id="toolsGrip" type="button"/);
  });
  it('the walked path keeps the waypoint legs it was seen on, fades from spawn colour to target colour; con colours; Brewall layers; your target\'s point at any height (2026-10-13)', () => {
    // the guild lead: "extrapolate the previous point and the next point from the 'random path' ... a gradient along
    // all of the lines to the origin ... set the names of these mobs to conn color ... Default colors should probably
    // be the same as the Brewall ones ... Going above a spawn point should still show you the spawn point of the
    // creature that's targetted"
    const g = [[0, 0], [100, 0], [100, 100], [0, 100], [-100, 0]];
    expect(H.wanderLeg(g, { x: 50, y: 0 }, { x: 1, y: 0 })).toEqual({ prev: 0, next: 1 });   // walking 0 → 1
    expect(H.wanderLeg(g, { x: 50, y: 0 }, { x: -1, y: 0 })).toEqual({ prev: 1, next: 0 });
    expect(H.wanderLeg(g, { x: 50, y: 0 }, { x: 0, y: 1 })).toBeNull();                    // nothing straight ahead
    const tr = { pts: [{ x: 10, y: 0 }, { x: 30, y: 0 }, { x: 50, y: 0 }], legs: [] };
    expect(H.noteWanderLeg(tr, g)).toBeNull(); expect(H.noteWanderLeg(tr, g)).toBeNull();   // not there yet
    expect(tr.legs).toEqual([{ prev: 0, next: 1 }]);                                       // the same leg is kept once
    expect(H.levelCon(60, 60)).toBe('white');
    expect(H.levelCon(60, 62)).toBe('yellow');
    expect(H.levelCon(60, 63)).toBe('red');
    expect(H.levelCon(60, 39)).toBe('green');                                              // 60's green cut is -21
    expect(H.levelCon(60, 40)).toBe('lightblue');
    expect(H.levelCon(60, 50)).toBe('blue');
    expect(H.levelCon(null, 50)).toBeNull();
    const bands = [100, 0, -100, 200];
    expect(H.brewallLayer(bands, 1, 5)).toBeNull();                                        // your floor: the wall colour
    expect(H.brewallLayer(bands, 0, 5)).toBe('#ffa866');                                   // one up: Layer 2
    expect(H.brewallLayer(bands, 3, 5)).toBe('#cc6600');                                   // two up: Layer 3
    expect(H.brewallLayer(bands, 2, 5)).toBe('#ff66ff');                                   // one down: Layer 8
    expect(H.brewallLayer([0], 0, 5)).toBeNull();
    expect(H.namedNpc({ npcs: [{ name: 'a_rat', chance: 90 }, { name: 'Boss', named: true, chance: 10 }] }).name).toBe('Boss');
    const js = stripJs(MAP_HTML);
    expect(js).toMatch(/if \(!inLevelRange\(p0\.z, sz, srange\) && String\(p0\.id\) !== tgtPid\) continue;/);
    expect(js).toMatch(/col: conCol\(un\) \|\| CO\.upLabel/);
    expect(js).toMatch(/var layerCol = C\.wallMode === 'layers' \? brewallLayer\(S\.prep\.bands, b, sz\) : null;/);
  });
  it('the Levels and Spawn height sliders live in the settings panel; Labels stays a toolbar button', () => {
    const tools = sliceBlock(MAP_HTML, '<div id="tools">', '</div>');
    expect(tools).toMatch(/id="labelsBtn"/);
    expect(tools).toMatch(/id="cfgBtn"/);
    expect(tools).not.toMatch(/id="levels"|id="spawnLevels"/);
    const panel = sliceBlock(MAP_HTML, '<div id="cfg" hidden data-wp-interact>', '<div class="foot">');
    expect(panel).toMatch(/id="levels"/);
    expect(panel).toMatch(/id="spawnLevels"/);
  });
  it('Timers "Widen window" (default) grows/shrinks the window by the list; "Share space" leaves the window alone', async () => {
    // the guild lead, 2026-10-12: "an option for the timers to slide out and take additional space rather than shrinking the map"
    const calls = [];
    const mimic = { overlaySetBounds: (b) => { calls.push(b); return Promise.resolve(true); } };
    const g = await bootOverlay({ mimic, winSize: { outerWidth: 760, outerHeight: 480 } });
    expect(g.S.sideMode).toBe('grow');
    g.all.sideBtn.listeners.click.forEach(f => f());                  // tuck the list in: the window narrows by 216
    expect(calls.pop()).toEqual({ width: 544, height: 480 });
    const g2 = await bootOverlay({ mimic, store: g.store, winSize: { outerWidth: 544, outerHeight: 480 } });
    g2.all.sideBtn.listeners.click.forEach(f => f());                 // slide it out: the window widens back
    expect(calls.pop()).toEqual({ width: 760, height: 480 });
    const s = await bootOverlay({ mimic, store: { 'wp-map-side-mode': 'share' }, winSize: { outerWidth: 760, outerHeight: 480 } });
    expect(s.all.sideModeSel.value).toBe('share');
    s.all.sideBtn.listeners.click.forEach(f => f());
    expect(calls.length).toBe(0);                                     // share: no window resize
    s.all.sideModeSel.value = 'grow'; s.all.sideModeSel.listeners.change.forEach(f => f());
    expect(s.store['wp-map-side-mode']).toBe('grow');
  });
  it('⚙ opens the settings in the Timers slot beside the map, not over it (the guild lead, 2026-10-13)', async () => {
    // "the customization should open up to a new section to the side where the timers would be so you can update the
    // map at the same time"
    const calls = [];
    const mimic = { overlaySetBounds: (b) => { calls.push(b); return Promise.resolve(true); } };
    // the list is out: the settings take its slot, the window stays the same size
    const a = await bootOverlay({ mimic, winSize: { outerWidth: 760, outerHeight: 480 } });
    a.all.cfgBtn.listeners.click.forEach(f => f());
    expect(a.all.wrap.classList.contains('cfgopen')).toBe(true);
    expect(a.all.cfg.hidden).toBe(false);
    expect(calls.length).toBe(0);
    a.all.sideBtn.listeners.click.forEach(f => f());                  // Timers while the settings are open: the list comes back
    expect(a.all.wrap.classList.contains('cfgopen')).toBe(false);
    expect(a.all.cfg.hidden).toBe(true);
    expect(a.S.sideOpen).toBe(true);
    expect(calls.length).toBe(0);
    // the list is slid in ('grow'): opening the settings widens the window by the slot, closing gives it back
    const b = await bootOverlay({ mimic, store: { 'wp-map-side': '0' }, winSize: { outerWidth: 544, outerHeight: 480 } });
    b.all.cfgBtn.listeners.click.forEach(f => f());
    expect(calls.pop()).toEqual({ width: 760, height: 480 });
    b.all.cfgClose.listeners.click.forEach(f => f());
    expect(calls.pop()).toEqual({ width: 328, height: 480 });          // 544 - 216 (the mock window does not resize)
    // markup: the panel is a column of #wrap after the map pane, not inside it; the side list hides while it is open
    const css = stripCss(MAP_HTML);
    expect(css).toMatch(/#cfg\{flex:0 0 210px;/);
    expect(css).toMatch(/#wrap\.cfgopen #side\{display:none\}/);
    expect(MAP_HTML.indexOf('<div id="cfg" hidden data-wp-interact>')).toBeGreaterThan(MAP_HTML.indexOf('<div id="menu"></div>'));
    expect(MAP_HTML.indexOf('<div id="cfg" hidden data-wp-interact>')).toBeLessThan(MAP_HTML.indexOf('<div id="side">'));
  });
  it('Spawn height: spawn points further above or below you than the slider are hidden (default: all)', async () => {
    const shown = (all) => all.hits.children.filter(h => !h.hidden).length;
    const base = await bootOverlay();
    expect(base.S.spawnLevels).toBe(7);                              // default: all spawns
    expect(base.all.spawnVal.textContent).toBe('Spawn height: all');
    const all = shown(base.all);
    // Lift one point 500 above you and narrow the range to +-25: it disappears, the rest stay.
    // (point 2: point 1 is the payload target's own spawn point, which shows at any height)
    const high = Object.assign({}, base.payload, { points: base.payload.points.map((p, i) => (i === 1 ? Object.assign({}, p, { z: 500 }) : p)) });
    const narrow = await bootOverlay({ store: { 'wp-map-spawn-levels': '0' }, payload: high });
    expect(narrow.all.spawnVal.textContent).toBe('Spawn height ±25');
    expect(shown(narrow.all)).toBe(all - 1);
    const tgtHigh = Object.assign({}, base.payload, { points: base.payload.points.map((p, i) => (i === 0 ? Object.assign({}, p, { z: 500 }) : p)) });
    expect(shown((await bootOverlay({ store: { 'wp-map-spawn-levels': '0' }, payload: tgtHigh })).all)).toBe(all);   // your target's point stays
    narrow.all.spawnLevels.value = '7'; narrow.all.spawnLevels.listeners.input.forEach(f => f());
    expect(narrow.store['wp-map-spawn-levels']).toBe('7');
    expect(shown(narrow.all)).toBe(all);
  });
  it('remembers the fit mode, the level range, the position source and the smoothing across a reload; junk is ignored', async () => {
    const first = await bootOverlay();
    first.all.levels.value = '4'; first.all.levels.listeners.input.forEach(f => f());
    first.all.srcSel.value = 'agent'; first.all.srcSel.listeners.change.forEach(f => f());
    first.all.smoothSel.value = 'smooth'; first.all.smoothSel.listeners.change.forEach(f => f());
    first.all.fitBtn.listeners.click.forEach(f => f());
    expect(first.store).toMatchObject({ 'wp-map-levels': '4', 'wp-map-src': 'agent', 'wp-map-smooth': 'smooth', 'wp-map-fit': 'group' });
    const again = await bootOverlay({ store: first.store });
    expect(again.S).toMatchObject({ levels: 4, src: 'agent', smooth: 'smooth', fit: 'group' });
    expect(again.all.levelsVal.textContent).toBe('Levels ±200');
    expect(again.all.fitBtn.textContent).toBe('Fit group');
    const junk = await bootOverlay({ store: { 'wp-map-levels': '99', 'wp-map-fit': 'sideways', 'wp-map-src': 'x', 'wp-map-smooth': 'toString' } });
    expect(junk.S).toMatchObject({ levels: 2, fit: 'zone', src: 'direct', smooth: 'light' });   // defaults: Direct + Light, +-100
  });

  // Ask 5-7: positions pushed straight from Mimic, used while fresh, the poll's when they stop.
  describe('the direct position path', () => {
    let nowSpy, clock;
    beforeEach(() => { clock = Date.now(); nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock); });
    afterEach(() => nowSpy.mockRestore());
    const push = (S, all, win, over) => win.pushPos(Object.assign({ character: 'Aldenmar', zone_id: 164, at: clock - 30,
      self: { x: 500, y: 600, z: 0, heading: 10 }, group: [{ name: 'Brackwyn', x: 510, y: 610, z: 0, heading: 0 }], raid: [], target: null }, over || {}));
    async function boot(extra) {
      const win = { pushPos: null };
      const mimic = { onMapPos: (cb) => { win.pushPos = cb; } };
      const r = await bootOverlay(Object.assign({ mimic }, extra || {}));
      return Object.assign(r, { win });
    }
    it('uses a fresh push over the poll (self and group, by name), and reads "pos <age> ms · direct"', async () => {
      const { S, all, win } = await boot();
      expect(S.trk.self.to).toMatchObject({ x: 90, y: 190 });         // the poll's, until something is pushed
      clock += 300; push(S, all, win);                                  // the sample was taken 30 ms before the overlay drew it
      expect(S.trk.self.to).toMatchObject({ x: 500, y: 600 });
      expect(S.trk['g:Brackwyn'].to).toMatchObject({ x: 510, y: 610 });
      expect(S.sampleSrc).toBe('direct');
      expect(all.posage.textContent).toBe('pos 30 ms · direct');
    });
    it('with the source set to Agent a push is kept but not used', async () => {
      const { S, all, win } = await boot({ store: { 'wp-map-src': 'agent' } });
      clock += 300; push(S, all, win);
      expect(S.trk.self.to).toMatchObject({ x: 90, y: 190 });
      expect(S.sampleSrc).toBe('agent');
    });
    it('ignores a push about another character or another zone', async () => {
      const { S, all, win } = await boot();
      clock += 100; push(S, all, win, { character: 'Someoneelse' });
      expect(S.trk.self.to).toMatchObject({ x: 90, y: 190 });
      push(S, all, win, { zone_id: 7 });
      expect(S.trk.self.to).toMatchObject({ x: 90, y: 190 });
    });
    it('falls back to the poll after 1 s without a push, and for ever with the source set to Agent', async () => {
      const { S, all, win } = await boot();
      clock += 100; push(S, all, win);
      expect(H.DIRECT_STALE_MS).toBe(1000);
      expect(H.useDirect(S.src, S.direct, clock + 999, S.p)).toBe(true);     // still fresh: the poll's positions are not used
      expect(H.useDirect(S.src, S.direct, clock + 1001, S.p)).toBe(false);   // silent for over a second: back to the poll
      expect(H.useDirect('agent', S.direct, clock, S.p)).toBe(false);
      expect(H.useDirect('direct', null, clock, S.p)).toBe(false);
    });
    it('without window.mimic the overlay never has a push and just uses the poll (readout says agent)', async () => {
      const { S } = await bootOverlay();
      expect(S.direct).toBeNull();
      expect(S.trk.self.to).toMatchObject({ x: 90, y: 190 });
      expect(S.sampleSrc).toBe('agent');
    });
  });
});

// Pinning and the guild sync (the guild lead, 2026-10-12: "need the tab targetting to set the specific mob in a synced
// way on the map once it's certain"). Mutation-checked one by one: see the notes on each describe.
describe('pinning a live target to its spawn point, and the guild sync', () => {
  const LIVE = { botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: 'tok' };
  const sloc = (x, y) => ({ x: y, y: x, z: 0 });   // a server-frame spot -> the Zeal pipe frame (x and y swapped)
  const tgt = (id, hp, x, y, extra) => Object.assign({ zone: 164, updatedAt: T0, loc: { x: 0, y: 0, z: 0 }, target_type: 1,
    target_name: 'a decaying skeleton', target_id: id, target_hp_pct: hp, target_loc: sloc(x, y) }, extra || {});
  // A core linked to the bot (token set), the zone already on disk and fresh, Aldenmar playing in The Deep.
  function liveCore(responder) {
    seedCache(dir, ZONE_BODY, Date.now());
    const net = fakeNet(responder || (() => ({ status: 200, body: { ok: true, stored: 1 } })));
    const c = loadCore({ dir, opts: LIVE, net });
    c._mapEnsureZone('thedeep', 164, Date.now());
    // grouped with the two guildmates whose events the tests send (only your raid / group's events apply)
    c._zealState.Aldenmar = { zone: 164, updatedAt: 1e18, loc: { x: 0, y: 0, z: 0 }, group_members: [{ name: 'Brackwyn' }, { name: 'Corvale' }] };
    return { c, net };
  }
  const queued = (c) => c._mapSync.q.map(k => k.ev);
  const watch = (c, s) => { c._zealState.Aldenmar = Object.assign({}, s, { updatedAt: 1e18 }); };

  it('a player target: its type and its own target (the assist bar ToT) reach the Map; a player is never pinned to a spawn point', () => {
    const { c } = liveCore(); const N = Date.now();
    const s = tgt(44, 80, 105, 202, { target_type: 0, target_name: 'Rethlan', target_of_target: { id: 7, name: 'Aldenmar' } });
    c._mapNoteState('Aldenmar', null, s, N);
    watch(c, s);
    const t = c._mapStatePayload('', N + 1).target;
    expect(t).toMatchObject({ name: 'Rethlan', type: 0, tot: { id: 7, name: 'Aldenmar' }, point_id: null });
    watch(c, Object.assign({}, s, { target_of_target: { id: 44, name: 'Rethlan' } }));   // on itself: nothing to draw
    expect(c._mapStatePayload('', N + 2).target.tot).toBeNull();
    watch(c, Object.assign({}, s, { target_of_target: { id: 0, name: '' } }));
    expect(c._mapStatePayload('', N + 3).target.tot).toBeNull();
  });

  describe('the pin: only an unpulled mob on its spot (the guild lead, 2026-10-13)', () => {
    it('a pulled mob (it has a target of its own) is never pinned, even standing on a point', () => {
      const { c } = liveCore(); const N = Date.now();
      const s = tgt(9, 100, 105, 202, { target_of_target: { id: 3, name: 'Aldenmar' } });
      c._mapNoteState('Aldenmar', null, s, N);
      watch(c, s);
      expect(c._mapStatePayload('', N + 1).target.point_id).toBeNull();
      expect(c._mapStatePayload('', N + 1).seen).toEqual([]);
    });
    it('off its spot (15 units) it is pinned only after holding still for 1.5 s; a moving one never is', () => {
      const { c } = liveCore(); const N = Date.now();
      const off = tgt(10, 100, 85, 200);
      c._mapNoteState('Aldenmar', null, off, N);
      watch(c, off);
      expect(c._mapStatePayload('', N + 1).target.point_id).toBeNull();          // just seen
      c._mapNoteState('Aldenmar', off, off, N + 1700);
      expect(c._mapStatePayload('', N + 1701).target.point_id).toBe(1);          // held still: tied to point 1
      for (let i = 0; i < 6; i++) {                                               // another one walking 6 units every 0.5 s
        const w = tgt(12, 100, 85, 196 + i * 6);
        c._mapNoteState('Aldenmar', null, w, N + 2000 + i * 500);
        watch(c, w);
        expect(c._mapStatePayload('', N + 2001 + i * 500).target.point_id).toBeNull();
      }
    });
  });

  describe('the pin: only when certain', () => {
    it('a live NPC at exactly one point is pinned, recorded as seen alive, and the payload says so', () => {
      const { c } = liveCore(); const N = Date.now();
      const s = tgt(9, 100, 105, 202);
      c._mapNoteState('Aldenmar', null, s, N);
      expect(c._mapPinGet('thedeep', 9)).toMatchObject({ point_id: 1 });
      watch(c, s);
      const p = c._mapStatePayload('', N + 1000);
      expect(p.seen).toEqual([{ point_id: 1, spawn_id: 9, name: 'a decaying skeleton', at: N, by: null, hp_pct: 100 }]);   // hp_pct: your own target, pinned to that point (FB-87)
      expect(p.target.point_id).toBe(1);
    });
    it('an ambiguous spot pins nothing: no pin, no seen, no target.point_id, nothing queued', () => {
      const { c } = liveCore(); const N = Date.now();
      const s = tgt(9, 100, 125, 200);   // 25 from p1 and 25 from p6: a tie
      c._mapNoteState('Aldenmar', null, s, N);
      expect(c._mapPinGet('thedeep', 9)).toBeNull();
      watch(c, s);
      const p = c._mapStatePayload('', N + 1000);
      expect(p.seen).toEqual([]);
      expect(p.target.point_id).toBeNull();
      expect(queued(c)).toEqual([]);
    });
    it('not a corpse (backtick, apostrophe or curly), not a mob at 0%, not a player, not a name no point makes', () => {
      const { c } = liveCore(); const N = Date.now();
      let id = 20;
      for (const name of ["a decaying skeleton's corpse", 'a decaying skeleton`s corpse', 'a decaying skeleton’s corpse']) {
        c._mapNoteState('Aldenmar', null, tgt(++id, 100, 105, 202, { target_name: name }), N);
      }
      c._mapNoteState('Aldenmar', null, tgt(++id, 0, 105, 202), N);
      c._mapNoteState('Aldenmar', null, tgt(++id, null, 105, 202), N);
      c._mapNoteState('Aldenmar', null, tgt(++id, 100, 105, 202, { target_type: 0 }), N);
      c._mapNoteState('Aldenmar', null, tgt(++id, 100, 105, 202, { target_name: 'Brackwyn' }), N);
      c._mapNoteState('Aldenmar', null, tgt(0, 100, 105, 202), N);
      for (let i = 20; i <= id; i++) expect(c._mapPinGet('thedeep', i), String(i)).toBeNull();
      expect(queued(c)).toEqual([]);
    });
    it('once pinned it stays pinned: a pulled mob that wanders to another point is not re-pinned', () => {
      const { c } = liveCore(); const N = Date.now();
      c._mapNoteState('Aldenmar', null, tgt(9, 100, 105, 202), N);
      c._mapNoteState('Aldenmar', null, tgt(9, 60, 5, 5), N + 5000);
      c._mapNoteState('Aldenmar', null, tgt(9, 50, 400, 200), N + 6000);   // exactly on p2
      expect(c._mapPinGet('thedeep', 9)).toMatchObject({ point_id: 1 });
      expect(queued(c).filter(e => e.kind === 'seen')).toHaveLength(1);    // and told the guild once
    });
    it('while NOT pinned it keeps looking: first seen pulled away (a tie), later at a point -> pinned then', () => {
      const { c } = liveCore(); const N = Date.now();
      c._mapNoteState('Aldenmar', null, tgt(9, 100, 125, 200), N);
      expect(c._mapPinGet('thedeep', 9)).toBeNull();
      c._mapNoteState('Aldenmar', null, tgt(9, 100, 105, 202), N + 3000);
      expect(c._mapPinGet('thedeep', 9)).toMatchObject({ point_id: 1 });
    });
    it('a zone change clears the pins, and the pin table is bounded', () => {
      const { c } = liveCore(); const N = Date.now();
      c._mapNoteState('Aldenmar', null, tgt(9, 100, 105, 202), N);
      expect(c._mapPinGet('thedeep', 9)).not.toBeNull();
      c._mapTryPin('otherzone', 'Aldenmar', 77, 'a decaying skeleton', { x: 105, y: 202 }, N);   // (no data for it: nothing pinned, but the table moves zones)
      expect(c._mapPinGet('thedeep', 9)).toBeNull();
      for (let i = 1; i <= 600; i++) c._mapTryPin('thedeep', 'Aldenmar', 1000 + i, 'a decaying skeleton', { x: 105, y: 202 }, N + i);
      expect(c._mapPinGet('thedeep', 1001)).toBeNull();     // the oldest went
      expect(c._mapPinGet('thedeep', 1600)).not.toBeNull();
    });
  });

  describe('a death after a pull lands on the pinned point', () => {
    // First tabbed in a tie between two points (where "where it was first seen" cannot say), then it walks over its
    // own point and is pinned there, then it is pulled to the fighting spot and dies.
    const pinThenPull = (c, N, farX, farY) => {
      c._mapNoteState('Aldenmar', null, tgt(9, 100, 125, 200), N);
      c._mapNoteState('Aldenmar', null, tgt(9, 90, 105, 202), N + 3000);
      expect(c._mapPinGet('thedeep', 9)).toMatchObject({ point_id: 1 });
      const pulled = tgt(9, 40, farX, farY);
      c._mapNoteState('Aldenmar', null, pulled, N + 5000);
      return pulled;
    };
    it('target window (corpse): the timer starts on the pinned point, nothing is left as "?"', () => {
      const { c } = liveCore(); const N = Date.now();
      const pulled = pinThenPull(c, N, 250, 200);   // dies where a tie of points makes it ambiguous
      const dead = tgt(9, 0, 250, 200, { target_name: "a decaying skeleton's corpse", target_type: 2 });
      c._mapNoteState('Aldenmar', pulled, dead, N + 9000);
      watch(c, dead);
      const p = c._mapStatePayload('', N + 10000);
      expect(p.timers).toEqual([expect.objectContaining({ point_id: 1, source: 'seen', died_at: N + 9000 })]);
      expect(p.timers[0].by).toBeUndefined();   // a local timer carries no "by"
      expect(p.unassigned).toEqual([]);
      expect(p.seen).toEqual([]);               // dead now, no longer seen alive
    });
    it('the baseline: the same pull with no pin is a "?" with up to four candidates', () => {
      const { c } = liveCore(); const N = Date.now();
      const first = tgt(9, 100, 125, 200);       // first tabbed in the tie, pulled away without ever standing at a point
      c._mapNoteState('Aldenmar', null, first, N);
      const dead = tgt(9, 0, 250, 200, { target_name: "a decaying skeleton's corpse", target_type: 2 });
      c._mapNoteState('Aldenmar', first, dead, N + 9000);
      watch(c, dead);
      const p = c._mapStatePayload('', N + 10000);
      expect(p.timers).toEqual([]);
      expect(p.unassigned).toHaveLength(1);
      expect(queued(c).filter(e => e.kind === 'died')).toEqual([]);   // a "?" is never sent
    });
    it('the log line ("has been slain") reaches the same point through the target window\'s spawn id', () => {
      const { c } = liveCore(); const N = Date.now();
      pinThenPull(c, N, 250, 200);
      c._zealState.Aldenmar = tgt(9, 5, 250, 200, { updatedAt: N + 8000 });
      c._mapNoteLogDeath('a decaying skeleton', 'Aldenmar', N + 8500, N + 9000);
      watch(c, c._zealState.Aldenmar);
      const p = c._mapStatePayload('', N + 10000);
      expect(p.timers).toEqual([expect.objectContaining({ point_id: 1, source: 'seen' })]);
      expect(p.unassigned).toEqual([]);
    });
    it('the pin only counts for the same name (spawn ids are reused), and a death spends it', () => {
      const { c } = liveCore(); const N = Date.now();
      c._mapNoteState('Aldenmar', null, tgt(9, 100, 105, 202), N);
      // a different mob under the same id
      expect(c._mapNoteDeath('thedeep', { name: 'Aldenmar the Pale', spawn_id: 9, loc: { x: 0, y: 0 }, at: N, src: 'zeal' }, N).kind).toBe('unassigned');
      // that death spent the pin: the skeleton with id 9 is an ordinary death now
      expect(c._mapPinGet('thedeep', 9)).toBeNull();
      expect(c._mapNoteDeath('thedeep', { name: 'a decaying skeleton', spawn_id: 9, loc: { x: 250, y: 200 }, at: N + 300000, src: 'zeal' }, N + 300000).kind).toBe('unassigned');
    });
    it('a mob seen alive replaces a running timer on its point, and a death removes the "seen"', () => {
      const { c } = liveCore(); const N = Date.now();
      c._mapApplyMark('thedeep', { point_id: 1, kind: 'empty' }, N - 1000);
      expect(c._mapStatePayload('', N).timers).toHaveLength(1);
      c._mapNoteState('Aldenmar', null, tgt(9, 100, 105, 202), N);
      let p = c._mapStatePayload('', N + 1);
      expect(p.timers).toEqual([]);
      expect(p.seen).toHaveLength(1);
      c._mapNoteDeath('thedeep', { name: 'a decaying skeleton', spawn_id: 9, loc: { x: 5, y: 5 }, at: N + 20000, src: 'zeal' }, N + 20000);
      p = c._mapStatePayload('', N + 21000);
      expect(p.seen).toEqual([]);
      expect(p.timers).toEqual([expect.objectContaining({ point_id: 1, died_at: N + 20000 })]);
    });
    it('"seen alive" is shown for 30 minutes and no longer', () => {
      const { c } = liveCore(); const N = Date.now();
      c._mapNoteState('Aldenmar', null, tgt(9, 100, 105, 202), N);
      expect(c._mapStatePayload('', N + 29 * 60000).seen).toHaveLength(1);
      expect(c._mapStatePayload('', N + 31 * 60000).seen).toEqual([]);
    });
  });

  describe('what is queued for the guild: only the certain events', () => {
    it('a pinned sighting is "seen", an assigned death is "died", a "?" is never queued', () => {
      const { c } = liveCore(); const N = Date.now();
      c._mapNoteState('Aldenmar', null, tgt(9, 100, 105, 202), N);
      expect(queued(c)).toEqual([{ point_id: 1, kind: 'seen', spawn_id: 9, name: 'a decaying skeleton', at: N }]);
      c._mapNoteDeath('thedeep', { name: 'a decaying skeleton', spawn_id: 9, loc: { x: 250, y: 200 }, at: N + 4000, src: 'zeal' }, N + 4000);   // pinned: certain
      expect(queued(c).pop()).toEqual({ point_id: 1, kind: 'died', spawn_id: 9, name: 'a decaying skeleton', at: N + 4000 });
      const before = queued(c).length;
      c._mapNoteDeath('thedeep', { name: 'a decaying skeleton', spawn_id: 11, loc: { x: 250, y: 200 }, at: N + 90000, src: 'zeal' }, N + 90000);   // a tie: "?"
      expect(queued(c)).toHaveLength(before);
      expect(c._mapSync.q.every(k => k.zone === 'thedeep' && k.character === 'Aldenmar')).toBe(true);
    });
    it('marks queue the right kinds: Killed -> died, Empty -> empty, Up -> up, Clear -> clear', () => {
      const { c } = liveCore(); const N = Date.now();
      c._mapApplyMark('thedeep', { point_id: 1, kind: 'killed' }, N, 'Aldenmar');
      c._mapApplyMark('thedeep', { point_id: 2, kind: 'empty' }, N + 1, 'Aldenmar');
      c._mapApplyMark('thedeep', { point_id: 2, kind: 'up' }, N + 2, 'Aldenmar');
      c._mapApplyMark('thedeep', { point_id: 1, kind: 'clear' }, N + 3, 'Aldenmar');
      expect(queued(c).map(e => [e.point_id, e.kind, e.at])).toEqual([[1, 'died', N], [2, 'empty', N + 1], [2, 'up', N + 2], [1, 'clear', N + 3]]);
      expect(c._mapStatePayload('', N + 4).timers).toEqual([]);   // clear dropped the timer Killed started
    });
    it('a death on a point with no respawn time (the instance sentinel) has no timer, so nothing is sent', () => {
      const { c } = liveCore(); const N = Date.now();
      expect(c._mapNoteDeath('thedeep', { name: 'a bat', spawn_id: 3, loc: { x: 5000, y: 0 }, at: N, src: 'zeal' }, N).kind).toBe('assigned');
      expect(queued(c)).toEqual([]);
    });
    it('Killed on a "?" settles it and sends the death time and spawn id of that death', () => {
      const { c } = liveCore(); const N = Date.now();
      c._mapNoteDeath('thedeep', { name: 'a decaying skeleton', spawn_id: 7, loc: { x: 250, y: 200 }, at: N - 5000, src: 'zeal' }, N - 5000);
      expect(queued(c)).toEqual([]);
      c._mapApplyMark('thedeep', { point_id: 2, kind: 'killed' }, N, 'Aldenmar');
      expect(queued(c)).toEqual([{ point_id: 2, kind: 'died', spawn_id: 7, name: 'a decaying skeleton', at: N - 5000 }]);
    });
    it('is batched, not per event: nothing is sent at once, a timer is armed, and a POST carries at most 50', () => {
      const { c, net } = liveCore(); const N = Date.now();
      const zd = c._mapZoneDoc('thedeep');
      for (let i = 0; i < 120; i++) c._mapLocalEvent('thedeep', zd, 'Aldenmar', { point_id: 1, kind: 'seen', spawn_id: 100 + i, name: 'a decaying skeleton', at: N + i }, N);
      expect(net.calls).toHaveLength(0);
      expect(c._mapSync.flushTimer).toBeTruthy();
      expect(c._mapSyncFlush(N + 3000)).toBe(true);
      expect(c._mapSyncFlush(N + 6000)).toBe(true);
      expect(c._mapSyncFlush(N + 9000)).toBe(true);
      expect(c._mapSyncFlush(N + 12000)).toBe(false);
      const bodies = net.calls.map(k => JSON.parse(k.__body));
      expect(bodies.map(b => b.events.length)).toEqual([50, 50, 20]);
      expect(net.calls[0]).toMatchObject({ method: 'POST', path: '/api/agent/map-sync' });
      expect(net.calls[0].headers.Authorization).toBe('Bearer tok');
      expect(bodies[0]).toMatchObject({ zone: 'thedeep', character: 'Aldenmar' });
      expect(bodies[0].events[0]).toEqual({ point_id: 1, kind: 'seen', spawn_id: 100, name: 'a decaying skeleton', at: N });
    });
    it('LOCAL MODE (no token) queues nothing, sends nothing, pulls nothing', () => {
      const { c, net } = localCore(); const N = Date.now();
      c._mapNoteState('Aldenmar', null, tgt(9, 100, 105, 202), N);
      c._mapApplyMark('thedeep', { point_id: 2, kind: 'empty' }, N, 'Aldenmar');
      c._mapNoteDeath('thedeep', { name: 'a decaying skeleton', spawn_id: 9, loc: { x: 100, y: 200 }, at: N + 1, src: 'zeal' }, N + 1);
      expect(c._mapSync.q).toEqual([]);
      expect(c._mapSync.flushTimer).toBeNull();
      expect(c._mapSyncFlush(N)).toBe(false);
      expect(c._mapSyncPull('thedeep', N)).toBe(false);
      c._mapStatePayload('', N);
      expect(net.calls).toHaveLength(0);
    });
    it('local mode still pins and shows "seen alive" - the sync is an add-on, not a requirement', () => {
      const { c } = localCore(); const N = Date.now();
      const s = tgt(9, 100, 105, 202);
      c._mapNoteState('Aldenmar', null, s, N);
      watch(c, s);
      const p = c._mapStatePayload('', N + 1);
      expect(p.seen).toHaveLength(1);
      expect(p.target.point_id).toBe(1);
    });
  });

  describe('pulling the guild\'s events: only while the overlay polls', () => {
    it('is started by a /api/map-state request and nothing else, every 10 s, with since = the newest event seen', async () => {
      const N = Date.now();
      const evs = [{ id: 1, point_id: 2, kind: 'died', spawn_id: 5, name: 'a decaying skeleton', at: N - 5000, by: 'Brackwyn' }];
      const { c, net } = liveCore((o) => /map-sync/.test(o.path) ? { status: 200, body: { zone: 'thedeep', now: N, events: evs } } : { status: 500 });
      await tick();
      expect(net.calls).toHaveLength(0);                         // nobody is polling: nothing is asked
      c._mapStatePayload('', N);
      expect(net.calls).toHaveLength(1);
      expect(net.calls[0]).toMatchObject({ method: 'GET', path: '/api/agent/map-sync?zone=thedeep&since=0' });
      expect(net.calls[0].headers.Authorization).toBe('Bearer tok');
      c._mapStatePayload('', N + 200);
      c._mapStatePayload('', N + 9000);
      expect(net.calls).toHaveLength(1);                         // one in flight, then the 10 s gate
      await tick();
      expect(c._mapStatePayload('', N + 9500).timers).toEqual([expect.objectContaining({ point_id: 2, by: 'Brackwyn', source: 'seen', died_at: N - 5000 })]);
      expect(net.calls).toHaveLength(1);
      c._mapStatePayload('', N + 10000);
      expect(net.calls).toHaveLength(2);
      expect(net.calls[1].path).toBe('/api/agent/map-sync?zone=thedeep&since=' + (N - 5000));
    });
    it('a 404 (the bot does not have the route yet) backs off 10 minutes, with no error shown, for pulls and pushes', async () => {
      const { c, net } = liveCore(() => ({ status: 404 })); const N = Date.now();
      c._mapStatePayload('', N);
      await tick();
      const p = c._mapStatePayload('', N + 11000);
      expect(p.status).toBe('ok');
      expect(net.calls).toHaveLength(1);
      c._mapStatePayload('', N + 599000);
      expect(net.calls).toHaveLength(1);
      c._mapStatePayload('', N + 600001);
      expect(net.calls).toHaveLength(2);
      // a push: the first POST learns it, the next events are dropped quietly for the same ten minutes
      const { c: k, net: n2 } = liveCore(() => ({ status: 404 }));
      const zd = k._mapZoneDoc('thedeep');
      k._mapLocalEvent('thedeep', zd, 'Aldenmar', { point_id: 1, kind: 'empty', at: N }, N);
      expect(k._mapSyncFlush(N)).toBe(true);
      await tick();
      k._mapLocalEvent('thedeep', zd, 'Aldenmar', { point_id: 1, kind: 'empty', at: N + 1 }, N + 1);
      expect(k._mapSyncFlush(N + 1000)).toBe(false);
      expect(n2.calls).toHaveLength(1);
      expect(k._mapSync.q).toEqual([]);
    });
    it('an error or a bad answer is ignored (the next poll asks again after the gate)', async () => {
      const { c, net } = liveCore(() => ({ status: 200, body: 'not json {' })); const N = Date.now();
      c._mapStatePayload('', N);
      await tick();
      expect(c._mapStatePayload('', N + 10000).status).toBe('ok');
      expect(net.calls).toHaveLength(2);
    });
  });

  describe('merging the guild\'s events into the timers', () => {
    let c;
    beforeEach(() => {
      ({ c } = localCore());
      c._zealState.Aldenmar.group_members = [{ name: 'Brackwyn' }, { name: 'Corvale' }];   // events come from the group
    });
    const NOWR = T0 + 60000;
    const ev = (o) => Object.assign({ point_id: 1, kind: 'died', spawn_id: 5, name: 'a decaying skeleton', at: T0 + 1000, by: 'Brackwyn' }, o);
    const state = () => c._mapStatePayload('', NOWR);

    it('a remote death starts a timer tagged with who saw it; the same event again changes nothing', () => {
      expect(c._mapApplyRemote('thedeep', [ev()], NOWR)).toBe(1);
      expect(state().timers).toEqual([expect.objectContaining({ point_id: 1, by: 'Brackwyn', source: 'seen', died_at: T0 + 1000, earliest: T0 + 1000 + 540000 })]);
      expect(c._mapApplyRemote('thedeep', [ev()], NOWR)).toBe(0);
      expect(c._mapApplyRemote('thedeep', [ev({ by: 'Corvale' })], NOWR)).toBe(0);   // a repeat is the same event whoever relays it
      expect(state().timers[0].by).toBe('Brackwyn');
    });
    it('a remote death overrides an older local state', () => {
      c._mapApplyMark('thedeep', { point_id: 1, kind: 'empty' }, T0);
      expect(c._mapApplyRemote('thedeep', [ev({ at: T0 + 20000 })], NOWR)).toBe(1);
      expect(state().timers[0]).toMatchObject({ source: 'seen', died_at: T0 + 20000, by: 'Brackwyn' });
    });
    it('a newer local event wins over an older remote one (a mark, and an Up)', () => {
      c._mapApplyMark('thedeep', { point_id: 2, kind: 'empty' }, T0 + 10000);
      expect(c._mapApplyRemote('thedeep', [ev({ point_id: 2, at: T0 + 5000 })], NOWR)).toBe(0);
      expect(state().timers[0]).toMatchObject({ point_id: 2, source: 'marked' });
      c._mapApplyMark('thedeep', { point_id: 2, kind: 'up' }, T0 + 30000);
      expect(c._mapApplyRemote('thedeep', [ev({ point_id: 2, at: T0 + 20000, spawn_id: 6 })], NOWR)).toBe(0);
      expect(state().timers).toEqual([]);
    });
    it('a newer local DEATH wins over an older remote one', () => {
      c._mapNoteDeath('thedeep', { name: 'a decaying skeleton', spawn_id: 3, loc: { x: 100, y: 200 }, at: T0 + 40000, src: 'zeal' }, T0 + 40000);
      expect(c._mapApplyRemote('thedeep', [ev({ at: T0 + 30000 })], NOWR)).toBe(0);
      expect(state().timers[0]).toMatchObject({ died_at: T0 + 40000 });
      expect(state().timers[0].by).toBeUndefined();
    });
    it('seen / empty / up / clear from the guild, each only when newer', () => {
      c._mapApplyRemote('thedeep', [ev({ point_id: 3, kind: 'seen', at: T0 + 1000, by: 'Corvale' })], NOWR);
      expect(state().seen).toEqual([{ point_id: 3, spawn_id: 5, name: 'a decaying skeleton', at: T0 + 1000, by: 'Corvale', hp_pct: null }]);
      c._mapApplyRemote('thedeep', [ev({ point_id: 3, kind: 'died', at: T0 + 2000 })], NOWR);
      expect(state().seen).toEqual([]);
      expect(state().timers).toEqual([expect.objectContaining({ point_id: 3, by: 'Brackwyn' })]);
      c._mapApplyRemote('thedeep', [ev({ point_id: 3, kind: 'seen', at: T0 + 3000, by: 'Corvale' })], NOWR);
      expect(state().timers).toEqual([]);                       // seen alive after the death: the timer was wrong
      expect(state().seen).toHaveLength(1);
      c._mapApplyRemote('thedeep', [ev({ point_id: 3, kind: 'clear', at: T0 + 2500 })], NOWR);   // older than the sighting: ignored
      expect(state().seen).toHaveLength(1);
      c._mapApplyRemote('thedeep', [ev({ point_id: 3, kind: 'clear', at: T0 + 4000 })], NOWR);
      expect(state().seen).toEqual([]);
      c._mapApplyRemote('thedeep', [ev({ point_id: 5, kind: 'empty', at: T0 + 5000, name: null })], NOWR);
      expect(state().timers[0]).toMatchObject({ point_id: 5, source: 'marked', by: 'Brackwyn', name: 'Aldenmar the Pale' });
      c._mapApplyRemote('thedeep', [ev({ point_id: 5, kind: 'up', at: T0 + 6000 })], NOWR);
      expect(state().timers).toEqual([]);
    });
    it('oldest first: a batch with a late older death cannot beat the newer one, and `since` follows the newest', () => {
      expect(c._mapApplyRemote('thedeep', [ev({ at: T0 + 9000, spawn_id: 2 }), ev({ at: T0 + 3000 })], NOWR)).toBe(2);
      expect(state().timers[0].died_at).toBe(T0 + 9000);
      expect(c._mapSync.since.thedeep).toBe(T0 + 9000);
    });
    it('our own events echoed back by the bot are skipped', () => {
      const { c: k } = liveCore(); const N = Date.now();
      k._mapNoteState('Aldenmar', null, tgt(9, 100, 105, 202), N);
      const mine = queued(k)[0];
      expect(k._mapApplyRemote('thedeep', [Object.assign({ id: 1, by: 'Aldenmar' }, mine)], N + 1000)).toBe(0);
    });
    it('only your raid (or your group outside a raid) is heard: Zeal has no instance id, a raid is one copy of the zone', () => {
      // the guild lead, 2026-10-13: option C - raid/group scoping now, the zone server port later
      expect(c._mapApplyRemote('thedeep', [ev({ by: 'Rethlan' })], NOWR)).toBe(0);             // a guildmate outside the group
      expect(c._mapApplyRemote('thedeep', [ev({ by: null, at: T0 + 2000 })], NOWR)).toBe(0);   // nobody named: not trusted
      expect(state().timers).toEqual([]);
      c._setRaid({ at: NOWR, members: [{ name: 'Aldenmar' }, { name: 'Rethlan' }] });             // in a raid, the raid replaces the group
      expect(c._mapApplyRemote('thedeep', [ev({ by: 'rethlan', at: T0 + 3000 })], NOWR)).toBe(1);   // case does not matter
      expect(c._mapApplyRemote('thedeep', [ev({ point_id: 2, by: 'Brackwyn', at: T0 + 4000 })], NOWR)).toBe(0);
      c._setRaid(null);
      c._zealState.Aldenmar.group_members = [];                                                     // solo: only your own
      expect(c._mapApplyRemote('thedeep', [ev({ point_id: 3, by: 'Brackwyn', at: T0 + 5000 })], NOWR)).toBe(0);
    });
    it('a future-dated event, an unknown point and an unknown kind change nothing', () => {
      expect(c._mapApplyRemote('thedeep', [ev({ at: NOWR + 120000 }), ev({ point_id: 999 }), ev({ kind: 'explode' }), ev({ at: 'soon' }), null], NOWR)).toBe(0);
      expect(state().timers).toEqual([]);
    });
    it('with the zone copy known (dbg.txt): same copy from anyone, a different copy never, unknown falls back to the party', () => {
      fs.writeFileSync(path.join(dir, 'dbg.txt'), dbgZoneIn('Mon Oct 12 16:00:00 2026', 7312, 'thedeep'));
      c._mapCopy.dirs = () => [dir];
      const H = 'pq.projectquarm.pq3.projectquarm.com';
      expect(c._mapApplyRemote('thedeep', [ev({ point_id: 1, by: 'Zarrin', inst: H + ':7312' })], NOWR)).toBe(1);    // not in the party, same copy
      expect(c._mapApplyRemote('thedeep', [ev({ point_id: 2, by: 'Brackwyn', inst: H + ':11243' })], NOWR)).toBe(0); // the party, another copy
      expect(c._mapApplyRemote('thedeep', [ev({ point_id: 3, by: 'Brackwyn' })], NOWR)).toBe(1);                       // an old agent: no copy sent
      expect(c._mapApplyRemote('thedeep', [ev({ point_id: 6, by: 'Zarrin' })], NOWR)).toBe(0);
    });
  });

  describe('zone copies: the zone server port (dbg.txt) and the /who check', () => {
    const H = 'pq.projectquarm.pq3.projectquarm.com';
    const file = () => path.join(dir, 'dbg.txt');
    let c;
    beforeEach(() => { ({ c } = localCore()); c._mapCopy.dirs = () => [dir]; });
    const at = (s) => Date.parse('Mon Oct 12 ' + s + ' 2026');
    const who = (names, startedAt) => c._mapCopyNoteWho({ names: new Set(names), startedAt, complete: true }, startedAt + 500);

    it('reads only the zone lines: host, port, zone and time; skips the _chr/_lit loads and every other line', () => {
      fs.writeFileSync(file(), [
        '[Mon Oct 12 16:00:00 2026]00001:Path C:\\EverQuest\\ and a GPU line that must never be read',
        dbgZoneIn('Mon Oct 12 16:00:01 2026', 11243, 'thedeep').trimEnd(),
        '[Mon Oct 12 16:00:03 2026]00004:         StartWorldDisplay: thedeep_chr2',
      ].join('\r\n') + '\r\n');
      expect(c._mapCurrentCopy('thedeep', at('16:00:05'))).toEqual({ zone: 'thedeep', host: H, port: 11243, token: H + ':11243', at: at('16:00:01') });
      expect(c._mapCurrentCopy('potranquility', at('16:00:05'))).toBeNull();   // another zone: no copy claimed
    });
    it('follows the file: a new zone-in moves the copy (ports are reused, so the time is part of the copy), char select clears it', () => {
      fs.writeFileSync(file(), dbgZoneIn('Mon Oct 12 16:00:00 2026', 11243, 'thedeep'));
      expect(c._mapCurrentCopy('thedeep', at('16:00:05')).port).toBe(11243);
      fs.appendFileSync(file(), dbgZoneIn('Mon Oct 12 16:12:00 2026', 7312, 'thedeep'));
      expect(c._mapCurrentCopy('thedeep', at('16:12:05')).port).toBe(7312);
      fs.appendFileSync(file(), '[Mon Oct 12 16:20:00 2026]00090:Starting char select.\r\n');
      expect(c._mapCurrentCopy('thedeep', at('16:20:05'))).toBeNull();
    });
    it('a client that starts a new dbg.txt (smaller file) is read from the top', () => {
      fs.writeFileSync(file(), dbgZoneIn('Mon Oct 12 16:00:00 2026', 11243, 'thedeep') + 'x'.repeat(4000) + '\r\n');
      expect(c._mapCurrentCopy('thedeep', at('16:00:05')).port).toBe(11243);
      fs.writeFileSync(file(), dbgZoneIn('Mon Oct 12 17:00:00 2026', 7293, 'thedeep'));
      expect(c._mapCurrentCopy('thedeep', at('17:00:05')).port).toBe(7293);
    });
    it('/who: anyone outside our guild and the raid/group makes the copy open (live or PvP), and it stays open', () => {
      fs.writeFileSync(file(), dbgZoneIn('Mon Oct 12 16:00:00 2026', 7312, 'thedeep'));
      c._zealState.Aldenmar.group_members = [{ name: 'Nyssara' }];
      c.whoData.set('aldenmar', { guild: 'Wolf Pack' });
      c.whoData.set('brackwyn', { guild: 'Wolf Pack' });
      c.whoData.set('nyssara', { guild: 'Breakfast Club' });     // grouped: not an outsider
      c.whoData.set('zarrin', { guild: 'Some Other Guild' });
      const N = at('16:05:00');
      expect(c._mapCopyInfo('thedeep', N)).toMatchObject({ port: 7312, kind: null });
      who(['aldenmar', 'brackwyn', 'nyssara'], N);
      expect(c._mapCopyInfo('thedeep', N + 1000)).toMatchObject({ kind: 'closed', outsiders: 0 });
      who(['aldenmar', 'brackwyn', 'zarrin'], N + 2000);
      expect(c._mapCopyInfo('thedeep', N + 3000)).toMatchObject({ kind: 'open', outsiders: 1 });
      who(['aldenmar', 'brackwyn'], N + 4000);                    // a later quiet /who does not close it again
      expect(c._mapCopyInfo('thedeep', N + 5000).kind).toBe('open');
      expect(c._mapStatePayload('', N + 6000).copy).toMatchObject({ port: 7312, kind: 'open' });
    });
    it('/who says nothing when it predates the zone-in, or when our own guild is not known yet', () => {
      fs.writeFileSync(file(), dbgZoneIn('Mon Oct 12 16:00:00 2026', 7312, 'thedeep'));
      c.whoData.set('zarrin', { guild: 'Some Other Guild' });
      who(['aldenmar', 'zarrin'], at('16:05:00'));                // our guild unknown
      expect(c._mapCopyInfo('thedeep', at('16:05:01')).kind).toBeNull();
      c.whoData.set('aldenmar', { guild: 'Wolf Pack' });
      who(['aldenmar', 'zarrin'], at('15:50:00'));                // before this zone-in
      expect(c._mapCopyInfo('thedeep', at('16:05:02')).kind).toBeNull();
    });
    it('a synced event carries the copy it happened in', () => {
      fs.writeFileSync(file(), dbgZoneIn('Mon Oct 12 16:00:00 2026', 7312, 'thedeep'));
      const zd = c._mapZoneDoc('thedeep');
      c._setOpts({ botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: 'tok' });
      c._mapLocalEvent('thedeep', zd, 'Aldenmar', { point_id: 1, kind: 'died', spawn_id: 5, name: 'a decaying skeleton', at: at('16:05:00') }, at('16:05:00'));
      expect(c._mapSync.q.map(k => k.ev.inst)).toEqual([H + ':7312']);
      c._mapSyncStop();
    });
    it('the overlay shows the port and the /who verdict beside the zone name', () => {
      const js = stripJs(MAP_HTML);
      expect(js).toMatch(/function copyLabel\(c\)/);
      expect(js).toMatch(/cp = copyLabel\(P && P\.copy\)/);
      expect(js).toMatch(/c\.kind === 'open' \? 'live \/ PvP'/);
      // and the agent's /who footer feeds the check
      expect(stripJs(AGENT)).toMatch(/if \(zone\) \{ try \{ _mapCopyNoteWho\(_whoRun, Date\.now\(\)\); \} catch/);
    });
  });

  describe('the overlay: contrast, "up · seen" and the pinned line', () => {
    const js = stripJs(MAP_HTML);
    const helpers = sliceBlock(MAP_HTML, '// ── pure helpers', '// ── end pure helpers ──');
    it('hover words: seen alive <ago> · spawn #<id>, and by <name> when a guildmate saw it', () => {
      expect(new Function(helpers + '\nreturn seenText;')()({ at: T0 - 120000, spawn_id: 812, by: 'Corvale' }, T0)).toBe('seen alive 2m ago · spawn #812 · by Corvale');
      expect(new Function(helpers + '\nreturn seenText;')()({ at: T0 - 120000, spawn_id: null, by: null }, T0)).toBe('seen alive 2m ago');
    });
    it('a dark slate background instead of black (the panes keep the opacity slider unless ⚙ sets its own strength)', () => {
      expect(MAP_HTML).toMatch(/#mapPane\{[^}]*background:rgb\(var\(--map-bg, 19 26 38\) \/ var\(--map-bg-a, var\(--bg-alpha\)\)\)/);
      // the list keeps the same colour and slider but never goes below 0.94 (the guild lead, 2026-10-16: nameplates showed through it)
      expect(stripCss(MAP_HTML)).toMatch(/#side\{[^}]*background:rgb\(var\(--map-bg, 19 26 38\) \/ max\(0\.94, var\(--map-bg-a, var\(--bg-alpha\)\)\)\)/);
      expect(MAP_HTML).not.toMatch(/rgb\(0 0 0 \/ var\(--bg-alpha\)\)/);
      expect(js).toMatch(/if \(S\.cfg\.bgA == null\) root\.removeProperty\('--map-bg-a'\);/);   // off = follow Mimic's slider
    });
    it('brighter, thicker walls in the level range; the rest at 0.35; out-of-range dots at 0.4; bigger lighter dots with an outline', () => {
      expect(js).toMatch(/var oursStyle = hexA\(layerCol \|\| \(oneWall \? CO\.wall : CO\.oursWall\), bright \? 0\.95 : Math\.max\(0\.35, I\.faint\)\);/);
      expect(js).toMatch(/strokeWall\(oursStyle, \(bright \? 1\.6 : 1\) \* I\.line, bright \? I\.casing : I\.casing \/ 2\);/);
      expect(js).toMatch(/var bright = S\.prep\.bands\.length <= 1 \|\| inLevelRange\(S\.prep\.bands\[b\], sz, range\);/);
      expect(js).toMatch(/ctx\.globalAlpha = inLevelRange\(p\.z, sz, range\) \? 1 : 0\.4;/);
      expect(js).toMatch(/var r = \(kind\.raid \? 6\.5 : kind\.named \? 5\.5 : 4\.2\) \* I\.dot;/);
      expect(js).toMatch(/: CO\.dot; ctx\.fill\(\);/);
      expect(js).toMatch(/strokeStyle = '#0d1117'; ctx\.stroke\(\);   \/\/ a dark outline on every dot/);
    });
    it('keeps the red / yellow / green rings, and draws seen points with a solid ring and fill in the "up" colour', () => {
      expect(js).toMatch(/var RING = \{ wait: '#f85149', window: '#f0b429', up: '#56d364' \};/);
      expect(js).toMatch(/if \(sn\) \{[^}]*ctx\.arc\(px, py, r \+ 3\.5[^}]*strokeStyle = CO\.up; ctx\.stroke\(\);\s*\} else if \(t && SH\.timers\) \{/);
      expect(js).toMatch(/ctx\.fillStyle = sn \? CO\.up/);
      expect(js).toMatch(/card\.appendChild\(el\('div', 't', 'up · ' \+ seenText\(sn, nowMs\(\)\)\)\)/);
    });
    it('draws a thin line from a pinned target to its spawn point, and says "→ pinned" in the header', () => {
      expect(js).toMatch(/var pinPt = P\.target\.point_id != null \? S\.byId\[String\(P\.target\.point_id\)\] : null;\s*if \(pinPt && SH\.pinLine\) \{\s*var twins = routeTwins\(pinPt, S\.points\);/);
      expect(js).toMatch(/var pq = wpt\(tp\.x, tp\.y\);\s*ctx\.beginPath\(\); ctx\.moveTo\(tq\[0\], tq\[1\]\); ctx\.lineTo\(pq\[0\], pq\[1\]\); ctx\.stroke\(\);/);
      expect(js).toMatch(/\(P\.target\.point_id != null \? ' → pinned' : ''\)/);
    });
    it('the menu gets a Clear timer button only where there is a timer or a sighting', () => {
      expect(js).toMatch(/if \(S\.timerBy\[pid\] \|\| S\.seenBy\[pid\]\) mk\('Clear timer', 'clear'\);/);
    });
  });
});

// Mezzes and lulls on the aggro rings (the guild lead, 2026-10-13: "add zzz's if it's mezzed" · "if it's truly pacified
// make the circle light pink and have it fill in the outside like a clock wipe more red until the pacify wears off. bard
// pacify is much shorter" · "druid harmony is still red on the inside at the lowered range").
describe('aggro rings: mez, pacify and harmony', () => {
  // eslint-disable-next-line no-new-func
  const H = new Function(sliceBlock(MAP_HTML, '// ── pure helpers', '// ── end pure helpers ──')
    + '\nreturn { ccFor, ringState, calmRadius, HARMONY_FACTOR, CALM_PINK, CALM_RED, inkStyle, hexA };')();
  const LAND = (o) => Object.assign({ dur_ticks: 60, landed_at: T0, target_id: 77, target_name: 'a gnoll', unconfirmed: false }, o);
  function put(c, mob, landing) {
    const k = mob.toLowerCase();
    if (!c._buffLandingsByTarget.has(k)) c._buffLandingsByTarget.set(k, new Map());
    c._buffLandingsByTarget.get(k).set(landing.name.toLowerCase() + '|' + (landing.target_id || ''), landing);
  }

  describe('the agent: /api/map-state cc', () => {
    it('a pacify: its own landing, ends at the landing\'s length (60 ticks = 6 min), not a bard, no radius factor', () => {
      const { c } = localCore();
      c.whoData.set('aldenmar', { class: 'Cleric' });
      put(c, 'a gnoll', LAND({ name: 'Pacify', landed_at: T0 - 60000, cast_by: 'Aldenmar' }));
      const cc = c._mapStatePayload('', T0, '').cc;
      expect(cc).toEqual([{ name: 'a gnoll', spawn_id: 77, mez: null,
        calm: { kind: 'pacify', spell: 'Pacify', startedAt: T0 - 60000, until: T0 - 60000 + 360000, byBard: false, radiusFactor: null, unconfirmed: false } }]);
    });
    it('a bard lull is its own, much shorter length (2 ticks = 12 s), told by the song and by the caster\'s class', () => {
      const { c } = localCore();
      put(c, 'a gnoll', LAND({ name: 'Silent Song of Quellious', dur_ticks: 2, landed_at: T0 - 3000 }));
      let row = c._mapCcStates(T0)[0];
      expect(row.calm).toMatchObject({ kind: 'pacify', byBard: true, startedAt: T0 - 3000, until: T0 - 3000 + 12000 });
      c._buffLandingsByTarget.clear();
      c.whoData.set('brackwyn', { class: 'Bard' });
      put(c, 'a gnoll', LAND({ name: 'Calm', dur_ticks: 7, cast_by: 'Brackwyn' }));
      row = c._mapCcStates(T0)[0];
      expect(row.calm).toMatchObject({ byBard: true, until: T0 + 42000 });   // the caster's class wins over the spell
    });
    it('Harmony and Wake of Tranquility are harmony (they only shrink the radius); a pacify on the same mob beats them', () => {
      const { c } = localCore();
      put(c, 'a gnoll', LAND({ name: 'Harmony', dur_ticks: 100 }));
      expect(c._mapCcStates(T0)[0].calm.kind).toBe('harmony');
      c._buffLandingsByTarget.clear();
      put(c, 'a gnoll', LAND({ name: 'Wake of Tranquility', dur_ticks: 100 }));
      expect(c._mapCcStates(T0)[0].calm.kind).toBe('harmony');
      put(c, 'a gnoll', LAND({ name: 'Harmony of Nature', dur_ticks: 50 }));   // targettype 5: a true pacify
      put(c, 'a gnoll', LAND({ name: 'Calm', dur_ticks: 5 }));
      const calm = c._mapCcStates(T0)[0].calm;
      expect(calm.kind).toBe('pacify');
      expect(calm.spell).toBe('Harmony of Nature');                          // the later end within the kind
    });
    it('a mez, by the catalog\'s mez kind; spent, worn-off and unrelated landings send nothing; two spawns stay two rows', () => {
      const { c } = localCore();
      c._spellByNameLower.set('enthrall', { name: 'Enthrall', cc: ['mez'] });
      put(c, 'a gnoll', LAND({ name: 'Enthrall', dur_ticks: 4, landed_at: T0 - 6000 }));
      put(c, 'a gnoll', LAND({ name: 'Enthrall', dur_ticks: 4, landed_at: T0 - 6000, target_id: 78 }));
      put(c, 'a gnoll', LAND({ name: 'Slow', dur_ticks: 50 }));
      put(c, 'a bat', LAND({ name: 'Enthrall', dur_ticks: 4, landed_at: T0 - 99000, target_name: 'a bat', target_id: 5 }));   // ran out
      put(c, 'a rat', LAND({ name: 'Pacify', worn_off_at: T0 - 1, target_name: 'a rat', target_id: 6 }));                       // worn off
      const rows = c._mapCcStates(T0);
      expect(rows.map(r => r.spawn_id).sort()).toEqual([77, 78]);
      expect(rows[0].mez).toEqual({ spell: 'Enthrall', startedAt: T0 - 6000, until: T0 - 6000 + 24000 });
      expect(rows[0].calm).toBeNull();
    });
  });

  describe('the overlay: who a landing belongs to, and what state it is in', () => {
    const calm = (kind, from, to, extra) => Object.assign({ kind, startedAt: from, until: to, byBard: false, radiusFactor: null }, extra);
    it('same name; with both ids known they must agree; without an id only your own target takes it', () => {
      const list = [{ name: 'a gnoll', spawn_id: 77, mez: { until: T0 + 5000 }, calm: null }, { name: 'a gnoll', spawn_id: null, mez: null, calm: calm('pacify', T0, T0 + 9000) }];
      expect(H.ccFor(list, 'a_gnoll', 77, false).mez).toEqual({ until: T0 + 5000 });
      expect(H.ccFor(list, 'a gnoll', 77, false).calm).toBeNull();                 // the id-less pacify is not proven for 77
      expect(H.ccFor(list, 'a gnoll', 78, false)).toBeNull();                      // another spawn of the name
      expect(H.ccFor(list, 'a gnoll', null, false)).toBeNull();                    // no id, not your target
      expect(H.ccFor(list, 'a gnoll', 78, true).calm.kind).toBe('pacify');         // your target takes the id-less one
      expect(H.ccFor(list, 'a bat', 77, true)).toBeNull();
      expect(H.ccFor(null, 'a gnoll', 77, true)).toBeNull();
    });
    it('a pacify beats a harmony on one mob; the later end wins within a kind', () => {
      const list = [{ name: 'a gnoll', spawn_id: 7, calm: calm('harmony', T0, T0 + 90000) }, { name: 'a gnoll', spawn_id: 7, calm: calm('pacify', T0, T0 + 12000) }];
      expect(H.ccFor(list, 'a gnoll', 7, false).calm.kind).toBe('pacify');
    });
    it('the clock wipe fraction is (now - startedAt) / (until - startedAt); a bard lull uses its own short span', () => {
      const long = { calm: calm('pacify', T0, T0 + 400000) }, bard = { calm: calm('pacify', T0, T0 + 12000, { byBard: true }) };
      expect(H.ringState(long, T0).calm.frac).toBe(0);
      expect(H.ringState(long, T0 + 100000).calm.frac).toBe(0.25);
      expect(H.ringState(bard, T0 + 6000).calm.frac).toBe(0.5);
      expect(H.ringState(bard, T0 + 6000).calm.byBard).toBe(true);
    });
    it('after `until` the ring is normal again (null), for a mez and a calm alike', () => {
      const cc = { mez: { until: T0 + 5000 }, calm: calm('pacify', T0, T0 + 9000) };
      expect(H.ringState(cc, T0 + 4999)).toMatchObject({ mez: true, calm: { kind: 'pacify' } });
      expect(H.ringState(cc, T0 + 5000).mez).toBe(false);
      expect(H.ringState(cc, T0 + 8999).calm).not.toBeNull();
      expect(H.ringState(cc, T0 + 9000)).toBeNull();
      expect(H.ringState(null, T0)).toBeNull();
    });
    it('harmony shrinks the radius (a guess of half unless the agent sends the real factor); pacify keeps it whole', () => {
      expect(H.HARMONY_FACTOR).toBe(0.5);
      const h = H.ringState({ calm: calm('harmony', T0, T0 + 9000) }, T0).calm;
      expect(H.calmRadius(200, h)).toBe(100);
      expect(H.calmRadius(200, H.ringState({ calm: calm('harmony', T0, T0 + 9000, { radiusFactor: 0.6 }) }, T0).calm)).toBeCloseTo(120);
      expect(H.calmRadius(200, H.ringState({ calm: calm('pacify', T0, T0 + 9000) }, T0).calm)).toBe(200);
      expect(H.calmRadius(200, null)).toBe(200);
    });
  });

  describe('the overlay: what aggroRing draws', () => {
    const src = sliceBlock(MAP_HTML, 'var AGGRO_COL = {', '    ctx.globalAlpha = ga;\n  }');
    const RED = '#e5534b';
    // A recording canvas: each arc / fill / stroke in order, with the style current when it ran; halo() records its text.
    function draw(cc, now, opts) {
      const o = Object.assign({ ar: 200, as: 0, kind: 'kos' }, opts), ops = [], halos = [];
      const ctx = { globalAlpha: 1, lineWidth: 1, fillStyle: '', strokeStyle: '',
        beginPath() {}, closePath() {}, setLineDash(d) { ops.push({ op: 'dash', d }); },
        arc(x, y, r, a0, a1, ccw) { ops.push({ op: 'arc', r, a0, a1, ccw: !!ccw }); },
        fill() { ops.push({ op: 'fill', style: ctx.fillStyle }); }, stroke() { ops.push({ op: 'stroke', style: ctx.strokeStyle }); } };
      const S = { cfg: { col: { aggro: RED, aggroSafe: '#e3b341', aggroNone: '#56d364' }, ink: 1 }, view: { scale: 1 } };
      const f = new Function('ctx', 'S', 'inkStyle', 'hexA', 'halo', 'ringState', 'calmRadius', 'CALM_PINK', 'CALM_RED',
        src + '\nreturn aggroRing;');
      f(ctx, S, H.inkStyle, H.hexA, (t) => halos.push(t), H.ringState, H.calmRadius, H.CALM_PINK, H.CALM_RED)(0, 0, o.ar, o.as, o.kind, cc, now);
      return { ops, halos };
    }
    const pink = (s) => s.startsWith(H.hexA(H.CALM_PINK, 0).slice(0, -2));   // 'rgba(r,g,b,' of the colour, any alpha
    const red = (s) => s.startsWith(H.hexA(H.CALM_RED, 0).slice(0, -2));
    const alpha = (s) => Number(s.slice(s.lastIndexOf(',') + 1, -1));
    const calm = (kind, from, to, extra) => ({ calm: Object.assign({ kind, startedAt: from, until: to, byBard: false, radiusFactor: null }, extra) });

    it('no crowd control: the ring as it always was - one disc in the danger colour, nothing else', () => {
      const d = draw(null, T0);
      expect(d.ops.filter(o => o.op === 'arc')).toEqual([{ op: 'arc', r: 200, a0: 0, a1: 6.2832, ccw: false }]);
      expect(d.ops.find(o => o.op === 'fill').style).toBe(H.hexA(RED, 0.07));
      expect(d.halos).toEqual([]);
    });
    it('pacify: a light pink disc at the full radius, and a band whose red sweep starts at 12 o\'clock and runs clockwise', () => {
      const d = draw(calm('pacify', T0, T0 + 400000), T0 + 100000);
      const arcs = d.ops.filter(o => o.op === 'arc');
      expect(arcs[0].r).toBe(200);                                   // the whole circle, not shrunk
      const fills = d.ops.filter(o => o.op === 'fill');
      expect(pink(fills[0].style)).toBe(true);                       // the disc
      expect(fills.some(f => H.hexA(RED, 0.07) === f.style)).toBe(false);   // not the danger colour any more
      const sweep = arcs.find(a => a.a0 === -Math.PI / 2 && a.ccw === false && a.a1 < 0.1 && a.a1 > -0.1);
      expect(sweep.r).toBe(200);                                     // a quarter turn: 12 o'clock to 3 o'clock
      expect(sweep.a1).toBeCloseTo(-Math.PI / 2 + 6.2832 * 0.25, 3);
      const redFill = fills.find(f => red(f.style));
      expect(alpha(redFill.style)).toBeCloseTo(0.65, 2);
      const later = draw(calm('pacify', T0, T0 + 400000), T0 + 300000).ops.filter(o => o.op === 'fill').find(f => red(f.style));
      expect(alpha(later.style)).toBeGreaterThan(alpha(redFill.style));   // redder as it runs out
      expect(d.halos).toEqual([]);                                   // not mezzed: no zzz
    });
    it('a bard lull wipes over its own short span', () => {
      const bard = calm('pacify', T0, T0 + 12000, { byBard: true });
      const arcs = draw(bard, T0 + 6000).ops.filter(o => o.op === 'arc');
      expect(arcs.some(a => a.a0 === -Math.PI / 2 && Math.abs(a.a1 - (-Math.PI / 2 + 6.2832 * 0.5)) < 1e-6)).toBe(true);   // half way round at 6 s of 12
    });
    it('harmony: still the danger colour inside, at the smaller radius, the old edge a faint dashed line, same band', () => {
      const d = draw(calm('harmony', T0, T0 + 400000), T0 + 100000);
      const arcs = d.ops.filter(o => o.op === 'arc');
      expect(arcs.some(a => a.r === 100)).toBe(true);
      const disc = d.ops.filter(o => o.op === 'fill')[0];
      expect(disc.style).toBe(H.hexA(RED, 0.07));                    // red inside, as before
      expect(d.ops.some(o => o.op === 'fill' && pink(o.style) && o.style === disc.style)).toBe(false);
      const firstDash = d.ops.findIndex(o => o.op === 'dash' && o.d.length);
      expect(arcs.find(a => a.r === 200)).toBeTruthy();              // the full-size edge is still marked...
      expect(firstDash).toBeGreaterThanOrEqual(0);                   // ...dashed
      const band = arcs.find(a => a.a0 === -Math.PI / 2 && a.r === 100 && Math.abs(a.a1 - (-Math.PI / 2 + 6.2832 * 0.25)) < 1e-6);
      expect(band).toBeTruthy();                                     // the wipe rides the reduced edge
      expect(d.ops.some(o => o.op === 'fill' && red(o.style))).toBe(true);
    });
    it('mez: zzz beside the ring, and the ring itself is unchanged', () => {
      const d = draw({ mez: { until: T0 + 9000 } }, T0);
      expect(d.halos).toEqual(['z', 'z', 'z']);
      expect(d.ops).toEqual(draw(null, T0).ops);
    });
    it('after `until` the ring is the normal ring again: no pink, no band, no zzz', () => {
      const cc = Object.assign({ mez: { until: T0 + 5000 } }, calm('pacify', T0, T0 + 9000));
      expect(draw(cc, T0 + 1000).halos.length).toBe(3);
      const gone = draw(cc, T0 + 9000);
      expect(gone.halos).toEqual([]);
      expect(gone.ops).toEqual(draw(null, T0).ops);
    });
  });
});

describe('the Mimic side: every item of the overlay parity checklist', () => {
  const fnBody = (name) => sliceBlock(MAIN, 'function ' + name + '(', '\n}\n');
  it('1. hide: map.html has the x button and main.js flips cfg.showMap in hide-overlay', () => {
    expect(MAP_HTML).toMatch(/id="hide-btn"/);
    expect(MAP_HTML).toMatch(/hideThisOverlay\(\)/);
    expect(MAIN).toMatch(/else if \(win === mapWindow\) \{\s*cfg\.showMap = false; saveConfig\(cfg\);/);
  });
  it('2. move: the move button drags with the manual-drag IPC and carries the right-click menu', () => {
    expect(MAP_HTML).toMatch(/id="move-btn"/);
    expect(MAP_HTML).toMatch(/overlayDragStart\(\)/);
    expect(MAP_HTML).toMatch(/attachOverlayMenu\(moveBtn\)/);
    expect(MAP_HTML).not.toMatch(/app-region/);
  });
  it('3. hover handshake: every clickable control is a real button or carries data-wp-interact', () => {
    expect(MAP_HTML).toMatch(/b\.setAttribute\('data-wp-interact', ''\)/);                  // the spawn-dot buttons
    expect((MAP_HTML.match(/setAttribute\('data-wp-interact', ''\)/g) || []).length).toBeGreaterThanOrEqual(5);   // dots, menu items, list rows
    expect(MAP_HTML).toMatch(/id="lists" data-wp-interact/);
    expect(MAP_HTML).toMatch(/stage\.setAttribute\('data-wp-interact', ''\)/);              // pan/zoom, when switched on or unlocked
    expect(MAP_HTML).toMatch(/overlayHoverInteractive\(true\)/);
  });
  it('4. dashboard row + status flag + toggle-overlay case', () => {
    const dash = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
    expect(dash).toMatch(/\['map',\s+'Map \[beta\]'/);
    expect(dash).toMatch(/map: !!st\.showMap/);
    expect(dash).toMatch(/map: 'showMap'/);
    expect(MAIN).toMatch(/case 'map':\s*cfg\.showMap = !cfg\.showMap; saveConfig\(cfg\);/);
    expect(MAIN).toMatch(/showMap: !!cfg\.showMap,/);
  });
  it('5. apply*Visibility: unlocked override, hide-all, the EQ gate; quiet mode only mutes, so it is not a condition', () => {
    const b = fnBody('applyMapVisibility');
    expect(b).toMatch(/_live\(mapWindow\)/);
    expect(b).toMatch(/setupMode \|\| cfg\.overlaysLocked === false/);
    expect(b).toMatch(/cfg\.showMap && !cfg\.hideOverlays && _eqGateOk\(cfg\)/);
    expect(MAIN).toMatch(/applyMeVisibility\(\);\s*applyMapVisibility\(\);\s*applyCanvasVisibility\(\);/);
  });
  it('6. showMap is in _HIDEALL_FLAGS and the map is an _overlayEntries() entry', () => {
    const flags = sliceBlock(MAIN, 'const _HIDEALL_FLAGS = [', '\n];');
    expect(flags).toMatch(/'showMap'/);
    expect(fnBody('_overlayEntries')).toMatch(/out\.push\(\['map', mapWindow\]\)/);
  });
  it('the tray item exists with the dashboard row (tray <-> dashboard parity), default off, and has a hotkey slot', () => {
    expect(MAIN).toMatch(/label: 'Map \(zone map, spawn timers\) \[beta\]', type: 'checkbox', checked: !!s\.showMap/);
    expect(sliceBlock(MAIN, 'const _OVERLAY_HOTKEY_KEYS = [', '];')).toMatch(/'map'/);
    expect(MAIN).not.toMatch(/showMap: true/);   // opt-in
  });
  it('the 760x480 default size and the window is not dockable', () => {
    expect(fnBody('createMapOverlay')).toMatch(/width: 760, height: 480/);
    expect(sliceBlock(MAIN, 'const _DOCK_CATALOG = [', '\n];')).not.toMatch(/key: 'map'/);
  });
  it('raid positions (pipe type 5) are forwarded on the 300ms beat, not only the 2s batch', () => {
    const js = stripJs(MAIN);
    expect(js).toMatch(/setInterval\(_flushZealToAgent, 2000\);/);   // every other type keeps its cadence
    const m = /setInterval\(\(\) => \{ if \(_zealPending\.sampledTypes\.has\('5'\)\) _flushZealToAgent\(\); \}, (\d+)\);/.exec(js);
    expect(m && Number(m[1])).toBeLessThanOrEqual(300);
    // the flag it reads is real: every flush clears sampledTypes, and onEvent sets it per type
    expect(sliceBlock(js, 'function _flushZealToAgent() {', '\n}\n')).toMatch(/_zealPending\.sampledTypes\.clear\(\)/);
    expect(js).toMatch(/_zealPending\.sampledTypes\.add\(type\)/);
  });
  it('reads target_loc off the Zeal pipe and passes it on', () => {
    expect(MAIN).toMatch(/s\.target_loc\s*=\s*_pipeLoc\(inner\.target_loc\);/);
  });
});

// The Map's direct position path (the guild lead, 2026-10-12: "still somewhat laggy ... pull directly from EQ"):
// main.js pushes positions straight to the window. The block is sliced and run as shipped.
describe('the Map direct position path (apps/mimic/main.js -> preload -> map.html)', () => {
  const block = sliceBlock(MAIN, '// ── Map direct positions ──', 'const _mapDirect = _makeMapDirect({');
  const parts = sliceBlock(MAIN, 'function _pipeLoc(', '\n}\n') + sliceBlock(MAIN, 'function _zealParseData(', '\n}\n');
  // eslint-disable-next-line no-new-func
  const D = new Function(parts + block.replace(/const _mapDirect = _makeMapDirect\(\{$/, '') + '\nreturn { _mapDirectXY, _mapDirectPos, _makeMapDirect, MAP_DIRECT_MIN_MS, MAP_DIRECT_HEARTBEAT_MS };')();

  // A fake clock and timer queue, and a live snapshot the test edits between events.
  function rig(active = true) {
    const r = { t: 1000, timers: [], sent: [], snap: null, active };
    r.setT = (fn, ms) => { const h = { fn, at: r.t + ms }; r.timers.push(h); return h; };
    r.clearT = (h) => { r.timers = r.timers.filter(x => x !== h); };
    r.advance = (ms) => { const to = r.t + ms; for (;;) { const nx = r.timers.filter(x => x.at <= to).sort((a, b) => a.at - b.at)[0]; if (!nx) break; r.timers = r.timers.filter(x => x !== nx); r.t = nx.at; nx.fn(); } r.t = to; };
    r.d = D._makeMapDirect({ now: () => r.t, setT: r.setT, clearT: r.clearT, snapshot: () => r.snap, active: () => r.active, send: (p) => r.sent.push(p) });
    r.snap = { zone: 164, loc: { x: 10, y: 20, z: 5 }, heading: 128, group_members: [{ name: 'Brackwyn', loc: { x: 1, y: 2, z: 3 }, heading: 0 }], target_name: null };
    return r;
  }
  const player = { type: 3, character: 'Aldenmar' };

  it('the frame swap agrees with the agent: server x = pipe y', () => {
    const { c } = localCore();
    for (const loc of [{ x: 10, y: 20, z: 5 }, { x: -3, y: 7 }, { x: 0, y: 0, z: 0 }, { x: 1.5, y: -2.25, z: -9 }, null, { x: 'a', y: 1 }, { x: 1, y: NaN }, 'str']) {
      expect(D._mapDirectXY(loc), JSON.stringify(loc)).toEqual(c._mapServerXY(loc));
    }
  });
  it('sends at most one update per 50 ms and the LATEST state wins', () => {
    expect(D.MAP_DIRECT_MIN_MS).toBe(50);
    const r = rig();
    r.d.note(player);                                       // t=1000: goes out at once
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toMatchObject({ character: 'Aldenmar', zone_id: 164, self: { x: 20, y: 10, z: 5, heading: 128 } });
    for (const x of [11, 12, 13]) { r.advance(10); r.snap = Object.assign({}, r.snap, { loc: { x, y: 20, z: 5 } }); r.d.note(player); }
    expect(r.sent).toHaveLength(1);                         // 30 ms in: held back
    r.advance(19); expect(r.sent).toHaveLength(1);          // 49 ms
    r.advance(1); expect(r.sent).toHaveLength(2);           // 50 ms: one trailing send...
    expect(r.sent[1].self.y).toBe(13);                      // ...carrying the newest position, not the first held one
    r.advance(500);
    expect(r.sent.filter(p => p.at < 1050)).toHaveLength(1);
    for (let i = 1; i < r.sent.length; i++) expect(r.sent[i].at - r.sent[i - 1].at).toBeGreaterThanOrEqual(50);
  });
  it('an unchanged state is not re-sent every beat, only as a 500 ms heartbeat', () => {
    expect(D.MAP_DIRECT_HEARTBEAT_MS).toBe(500);
    const r = rig();
    r.d.note(player);
    for (let i = 0; i < 8; i++) { r.advance(60); r.d.note(player); }   // 480 ms of the same position
    expect(r.sent).toHaveLength(1);
    r.advance(60); r.d.note(player);
    expect(r.sent).toHaveLength(2);
  });
  it('sends you, your group, the raid (pipe type 5) and the target, all in the server frame', () => {
    const r = rig();
    r.snap.target_name = 'a decaying skeleton'; r.snap.target_id = 77; r.snap.target_loc = { x: 7, y: 9, z: 0 };
    r.d.note(player);
    r.advance(60);
    r.d.note({ type: 5, character: 'Aldenmar', data: JSON.stringify([{ name: 'Corvale', loc: { x: 30, y: 40, z: 1 }, heading: 12 }, { name: 'Nolocman' }]) });
    const p = r.sent[r.sent.length - 1];
    expect(p.group).toEqual([{ name: 'Brackwyn', x: 2, y: 1, z: 3, heading: 0 }]);
    expect(p.raid).toEqual([{ name: 'Corvale', x: 40, y: 30, z: 1, heading: 12 }]);
    expect(p.target).toMatchObject({ id: 77, name: 'a decaying skeleton', x: 9, y: 7 });
  });
  it('sends nothing while the Map is not up, and nothing before a player frame names the character', () => {
    const r = rig(false);
    r.d.note(player); r.advance(200);
    expect(r.sent).toHaveLength(0);
    const r2 = rig();
    r2.d.note({ type: 6, character: 'Aldenmar', data: '[]' });
    expect(r2.sent).toHaveLength(0);
  });
  it('is wired: after each absorbed pipe event, to the Map window only, exposed on window.mimic', () => {
    const js = stripJs(MAIN);
    expect(js).toMatch(/_zealAbsorb\(obj, pid\); \} catch \(e\) \{ void e; \}\s*try \{ _mapDirect\.note\(obj\); \}/);
    expect(js).toMatch(/active: \(\) => _live\(mapWindow\) && mapWindow\.isVisible\(\)/);
    expect(js).toMatch(/mapWindow\.webContents\.send\('map-pos', p\)/);
    expect(stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js')))).toMatch(/onMapPos:\s+\(cb\)\s+=> ipcRenderer\.on\('map-pos', \(_e, p\) => cb\(p\)\)/);
    expect(stripJs(MAP_HTML)).toMatch(/window\.mimic && window\.mimic\.onMapPos && window\.mimic\.onMapPos\(onDirect\);/);
  });
});

// ── The raid's shared targets and escort trails (DECISIONS 299, agent 3.7.166) ────────────────────────────────────
// The guild lead picked both: B (the focus ring placed from other raiders' targets) and A (an escort trail every Mimic
// sees). Source: the bot's map-sync pull (test/raid-targets.test.js is the bot half). The upload half rides live-state.
// Mutation-checked (2026-10-14): the tsince query dropped, the merge dedupe dropped, the 100-unit shown gate dropped, the
// age gate dropped, the id match dropped, the "raid" placement dropped, the local-mode gate dropped, the mover send and
// the target fields dropped from the live-state record - each turns at least one test red.
describe('shared escort trails and the raid focus (the bot\'s map-sync answer)', () => {
  const LIVE2 = { botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: 'tok' };
  const seedZone = (short) => {
    fs.mkdirSync(path.join(dir, 'zone-spawns-cache'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'zone-spawns-cache', short + '.json'), JSON.stringify({ etag: '"v1"', fetched_at: Date.now(), body: { ...ZONE_BODY, zone: short } }));
  };
  const core = (responder) => {
    seedZone('ponightmare');
    const net = fakeNet(responder || (() => ({ status: 200, body: { ok: true } })));
    const c = loadCore({ dir, opts: LIVE2, net });
    c._mapEnsureZone('ponightmare', 204, Date.now());
    c._zealState.Aldenmar = { zone: 204, updatedAt: 1e18, loc: { x: 0, y: 0, z: 0 } };
    return { c, net };
  };
  const pts = (xs, t0) => xs.map((x, i) => [x, 0, 0, t0 + i * 3000, 0]);

  it('the escort list is the researched one, and a name on it is matched in its own zone', () => {
    const { c } = core();
    expect(Object.keys(c.MAP_TRACKED_PATHS).sort()).toEqual(['cazicthule', 'eastkarana', 'eastwastes', 'fungusgrove', 'grimling', 'iceclad',
      'netherbian', 'poinnovation', 'ponightmare', 'sharvahl', 'steamfont', 'tenebrous']);
    expect(c.MAP_TRACKED_PATHS.ponightmare).toEqual(['thelin poxbourne', 'aid eino']);
    expect(c.MAP_TRACKED_PATHS.grimling).toHaveLength(7);
  });

  it('the first pull asks for everything; later pulls ask only for points newer than the newest held (tsince)', async () => {
    const N = Date.now();
    const answer = { zone: 'ponightmare', now: N, events: [], targets: [],
      trails: { 'thelin poxbourne': { name: 'Thelin Poxbourne', at: N, live: true, pts: pts([0, 40, 80, 120], N - 12000) } } };
    const { c, net } = core((o) => /map-sync/.test(o.path) ? { status: 200, body: answer } : { status: 500 });
    c._mapStatePayload('', N);
    expect(net.calls[0].path).toBe('/api/agent/map-sync?zone=ponightmare&since=0');
    await tick();
    c._mapStatePayload('', N + 10000);
    expect(net.calls[1].path).toBe('/api/agent/map-sync?zone=ponightmare&since=0&tsince=' + (N - 12000 + 9000));
  });

  it('a shared trail is drawn though this machine never targeted him, solid while the bot says it is live', () => {
    const { c } = core(); const N = Date.now();
    c._mapApplyShared('ponightmare', { now: N, trails: { 'thelin poxbourne': { name: 'Thelin Poxbourne', at: N - 2000, live: true, pts: pts([0, 40, 80, 120], N - 12000) } } }, N);
    const p = c._mapStatePayload('', N + 1000);
    expect(p.paths['thelin poxbourne']).toMatchObject({ name: 'Thelin Poxbourne', live: true });
    expect(p.paths['thelin poxbourne'].pts.map(q => q[0])).toEqual([0, 40, 80, 120]);
    expect(c._mapStatePayload('', N + 30000).paths['thelin poxbourne'].live).toBe(false);   // the pull is old: not "being watched now"
  });

  it('joins the shared trail with this machine\'s own looks: the longer, newer union, one point per look', () => {
    const { c } = core(); const N = Date.now();
    // the bot holds 0..120; this machine alone has looked at 160..240 since (pipe y is server x)
    c._mapApplyShared('ponightmare', { now: N, trails: { 'thelin poxbourne': { name: 'Thelin Poxbourne', at: N - 6000, live: true, pts: pts([0, 40, 80, 120], N - 15000) } } }, N);
    const look = (y, at) => c._mapNoteState('Aldenmar', null, { zone: 204, target_name: 'Thelin Poxbourne', target_id: 9, target_type: 1, target_hp_pct: 100, target_loc: { x: 0, y, z: 0 } }, at);
    look(120, N - 6001);            // the same look the bot already has (about a second apart on the two clocks)
    look(160, N - 3000); look(200, N); look(240, N + 3000);
    const got = c._mapStatePayload('', N + 3500).paths['thelin poxbourne'].pts;
    expect(got.map(q => q[0])).toEqual([0, 40, 80, 120, 160, 200, 240]);
    expect(got.every(q => q[4] === 0)).toBe(true);
  });

  it('merge: a break stays only where nobody else watched through it; a jump is always a break', () => {
    const { c } = core();
    const a = [[0, 0, 0, 1000, 0], [40, 0, 0, 4000, 0], [80, 0, 0, 90000, 1]];
    expect(c._mapMergePath(a, []).map(q => q[4])).toEqual([0, 0, 1]);                              // over 20 s since: a real gap
    expect(c._mapMergePath(a, [[60, 0, 0, 80000, 0]]).map(q => q[4])).toEqual([0, 0, 0, 0]);       // another source watched 10 s before: no gap
    expect(c._mapMergePath([[0, 0, 0, 1000, 0], [500, 0, 0, 2000, 0]], []).map(q => q[4])).toEqual([0, 1]);   // too far to be a walk
    expect(c._mapMergePath([[0, 0, 0, 1000, 0], [40, 0, 0, 4000, 1]], []).map(q => q[4])).toEqual([0, 0]);    // 3 s later: not a gap
    expect(c._mapMergePath([[0, 0, 0, 1000, 0]], [[5, 0, 0, 2000, 0]]).length).toBe(1);                       // the same look from two sources
  });

  it('an idle town copy that never moved 100 units is not drawn; a stretch that did is, with a break before it', () => {
    const { c } = core(); const N = Date.now();
    c._mapApplyShared('ponightmare', { now: N, trails: { 'thelin poxbourne': { name: 'Thelin Poxbourne', at: N, live: true, pts: pts([0, 30, 60, 90], N - 12000) } } }, N);
    expect(c._mapStatePayload('', N).paths).toEqual({});
    expect(c._mapShownPath([[0, 0, 0, 1, 0], [30, 0, 0, 2, 0], [2000, 0, 0, 3, 1], [2120, 0, 0, 4, 0]])).toEqual([[2000, 0, 0, 3, 1], [2120, 0, 0, 4, 0]]);
    expect(c._mapShownPath([[0, 0, 0, 1, 0], [100, 0, 0, 2, 0], [300, 0, 0, 3, 1], [450, 0, 0, 4, 0]]).map(q => q[4])).toEqual([0, 0, 1, 0]);
    expect(c._mapShownPath([[0, 0, 0, 1, 0], [99, 0, 0, 2, 0]])).toEqual([]);
  });

  it('keeps only names on its own list, only valid points, and never the same point twice', () => {
    const { c } = core(); const N = Date.now();
    const answer = { now: N, trails: {
      'a hedge spider': { name: 'a hedge spider', at: N, live: true, pts: pts([0, 40, 80, 120], N) },
      'thelin poxbourne': { name: 'Thelin Poxbourne', at: N, live: true, pts: [...pts([0, 40, 80, 120], N - 12000), [1, 'x', 0, 5, 0], 'junk', [1, 2]] } } };
    c._mapApplyShared('ponightmare', answer, N); c._mapApplyShared('ponightmare', answer, N + 10000);
    const p = c._mapStatePayload('', N + 10500);
    expect(Object.keys(p.paths)).toEqual(['thelin poxbourne']);
    expect(p.paths['thelin poxbourne'].pts).toHaveLength(4);
  });

  describe('the focus ring placed from the raid\'s shared targets', () => {
    const rows = [{ kind: 'npc', name: 'a cliff golem', raider_count: 3, spawn_id: 811 }, { kind: 'npc', name: 'Aldenmar the Pale', raider_count: 9 }];
    const shared = (N) => ({ now: N, targets: [
      { name: 'Aldenmar the Pale', id: 77, type: 1, x: 100, y: 10, z: 5, n: 2, at: N - 4000 },
      { name: 'Aldenmar the Pale', id: 78, type: 1, x: 900, y: 90, z: 5, n: 6, at: N - 1000 },
      { name: 'a cliff golem', id: 811, type: 1, x: 5, y: 6, z: 0, n: 3, at: N - 1000 }] });
    const setup = (N) => {
      const { c, net } = core();
      c._extTargetCache.set('aldenmar', { at: N, payload: { targets: rows } });
      return { c, net };
    };

    it('places the most-targeted row of that name when your own target is something else (at: raid)', () => {
      const N = Date.now(); const { c } = setup(N);
      c._mapApplyShared('ponightmare', shared(N), N);
      expect(c._mapStatePayload('', N + 500).focus).toMatchObject({ name: 'Aldenmar the Pale', why: 'most', x: 900, y: 90, z: 5, at: 'raid' });
    });
    it('matches the spawn id when the focus names one (the MA row)', () => {
      const N = Date.now(); const { c } = setup(N);
      c._extTargetCache.set('aldenmar', { at: N, payload: { targets: [{ kind: 'npc', name: 'Aldenmar the Pale', raider_count: 1, spawn_id: 77, ma_target: true }] } });
      c._mapApplyShared('ponightmare', shared(N), N);
      expect(c._mapStatePayload('', N + 500).focus).toMatchObject({ id: 77, why: 'ma', x: 100, y: 10, at: 'raid' });
      c._extTargetCache.set('aldenmar', { at: N, payload: { targets: [{ kind: 'npc', name: 'Aldenmar the Pale', raider_count: 1, spawn_id: 999, ma_target: true }] } });
      expect(c._mapStatePayload('', N + 500).focus.x).toBeUndefined();   // another mob of that name: not placed
    });
    it('your own target wins over the raid\'s sample', () => {
      const N = Date.now(); const { c } = setup(N);
      c._zealState.Aldenmar = Object.assign(c._zealState.Aldenmar, { target_name: 'Aldenmar the Pale', target_id: 78, target_type: 1, target_loc: { x: 20, y: 700, z: 5 } });
      c._mapApplyShared('ponightmare', shared(N), N);
      expect(c._mapStatePayload('', N + 500).focus).toMatchObject({ x: 700, y: 20, at: 'target' });
    });
    it('a sample older than two minutes (bot clock plus time since the pull) is not a position', () => {
      const N = Date.now(); const { c } = setup(N);
      c._mapApplyShared('ponightmare', { now: N, targets: [{ name: 'Aldenmar the Pale', id: 77, x: 1, y: 2, z: 0, n: 2, at: N - 119000 }] }, N);
      expect(c._mapStatePayload('', N + 500).focus.x).toBe(1);
      expect(c._mapStatePayload('', N + 2000).focus.x).toBeUndefined();
    });
    it('another zone\'s targets never place it', () => {
      const N = Date.now(); const { c } = setup(N);
      c._mapApplyShared('cazicthule', shared(N), N);
      expect(c._mapStatePayload('', N + 500).focus.x).toBeUndefined();
    });
    it('a bad row is dropped, and an answer without targets changes nothing', () => {
      const N = Date.now(); const { c } = setup(N);
      c._mapApplyShared('ponightmare', { now: N, targets: [{ name: 'Aldenmar the Pale', id: 0, x: 1, y: 2, at: N }, { name: 5, id: 3, x: 1, y: 2, at: N }, null,
        { name: 'Aldenmar the Pale', id: 5, x: 'a', y: 2, at: N }] }, N);
      expect(c._mapStatePayload('', N + 500).focus.x).toBeUndefined();
      c._mapApplyShared('ponightmare', shared(N), N);
      c._mapApplyShared('ponightmare', { now: N + 1, events: [] }, N + 1);
      expect(c._mapStatePayload('', N + 500).focus.x).toBe(900);
    });
  });

  it('LOCAL MODE: no request for targets or trails, and the trail still works from this machine', () => {
    seedZone('ponightmare');
    const net = fakeNet();
    const c = loadCore({ dir, opts: { botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: '' }, net });
    c._mapEnsureZone('ponightmare', 204, T0);
    c._zealState.Aldenmar = { zone: 204, updatedAt: 1e18, loc: { x: 0, y: 0, z: 0 } };
    c._mapNoteState('Aldenmar', null, { zone: 204, target_name: 'Thelin Poxbourne', target_id: 9, target_type: 1, target_hp_pct: 100, target_loc: { x: 0, y: 0, z: 0 } }, T0);
    c._mapNoteState('Aldenmar', null, { zone: 204, target_name: 'Thelin Poxbourne', target_id: 9, target_type: 1, target_hp_pct: 100, target_loc: { x: 0, y: 150, z: 0 } }, T0 + 3000);
    expect(c._mapSyncPull('ponightmare', T0 + 4000)).toBe(false);
    const p = c._mapStatePayload('', T0 + 5000);
    expect(p.local_only).toBe(true);
    expect(p.paths['thelin poxbourne'].pts).toHaveLength(2);
    expect(net.calls).toHaveLength(0);
  });
});

describe('live-state carries the target\'s position (agent 3.7.166)', () => {
  // The helpers sit just outside the map core, so they are sliced as shipped and handed the core's own map helpers.
  const BLOCK = sliceBlock(AGENT, 'const LIVE_TPOS_MOVE_UNITS = 30', 'return gap >= LIVE_TPOS_MIN_MS && moved >= LIVE_TPOS_MOVE_UNITS;\n}');
  const load = () => {
    seedCache(dir);
    const c = loadCore({ dir, opts: { botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: 'tok' }, net: fakeNet() });
    // eslint-disable-next-line no-new-func
    const f = new Function('MAP_CORPSE_RE', '_mapZoneShort', '_mapServerXY', 'MAP_TRACKED_PATHS', '_mapNormName', '_mapDist2', BLOCK + '\nreturn { _liveTargetPosOf, _liveTargetPosDue };');
    return f(c.MAP_CORPSE_RE, c._mapZoneShort, c._mapServerXY, c.MAP_TRACKED_PATHS, c._mapNormName, c._mapDist2);
  };
  const st = (over = {}) => ({ zone: 164, target_name: 'a cliff golem', target_id: 811, target_type: 1, target_loc: { x: 10, y: 100, z: 5 }, ...over });

  it('places a live NPC target in the Map\'s server frame, with its zone', () => {
    expect(load()._liveTargetPosOf(st())).toEqual({ id: 811, x: 100, y: 10, z: 5, zone: 'thedeep', escort: false });
  });
  it('treats target id 0 (and none), a player, a corpse, no position and an unknown zone as nothing to place', () => {
    const { _liveTargetPosOf: f } = load();
    for (const over of [{ target_id: 0 }, { target_id: undefined }, { target_type: 0 }, { target_type: 2 }, { target_name: "a cliff golem's corpse" },
      { target_loc: null }, { zone: 7 }, { target_name: '' }]) expect(f(st(over)), JSON.stringify(over)).toBeNull();
  });
  it('flags an escort by zone + name (spelt either way), not by id', () => {
    const { _liveTargetPosOf: f } = load();
    expect(f(st({ zone: 204, target_name: '#Thelin_Poxbourne', target_id: 1 })).escort).toBe(true);
    expect(f(st({ zone: 204, target_name: 'Thelin Poxbourne', target_id: 99999 })).escort).toBe(true);
    expect(f(st({ zone: 164, target_name: 'Thelin Poxbourne' })).escort).toBe(false);
  });
  it('a mob earns an extra send after 30 units AND 10 s on the same target, never on a swap (that trips the signature)', () => {
    const { _liveTargetPosDue: due } = load();
    const prev = { id: 811, x: 0, y: 0, at: 1000 }, cur = (x, id = 811) => ({ id, x, y: 0, z: 0, escort: false });
    expect(due(prev, cur(30), 11000)).toBe(true);
    expect(due(prev, cur(29), 11000)).toBe(false);
    expect(due(prev, cur(30), 10999)).toBe(false);
    expect(due(prev, cur(500, 812), 60000)).toBe(false);
    expect(due(undefined, cur(500), 60000)).toBe(false);
    expect(due(prev, null, 60000)).toBe(false);
    expect(due(prev, cur(0), 60000)).toBe(false);          // standing: the heartbeat covers it
  });
  it('an escort earns one after 12 units AND 5 s, or 15 s standing', () => {
    const { _liveTargetPosDue: due } = load();
    const prev = { id: 9, x: 0, y: 0, at: 1000 }, cur = (x) => ({ id: 9, x, y: 0, z: 0, escort: true });
    expect(due(prev, cur(12), 6000)).toBe(true);
    expect(due(prev, cur(11), 6000)).toBe(false);
    expect(due(prev, cur(12), 5999)).toBe(false);
    expect(due(prev, cur(0), 15999)).toBe(false);
    expect(due(prev, cur(0), 16000)).toBe(true);
  });
  it('flushLiveStateToBot puts the fields on the record (absent when nothing to place), sends a mover, and keeps them out of the signature', () => {
    const fn = stripJs(sliceBlock(AGENT, 'function flushLiveStateToBot(opts) {', '_postLiveState(url, opts.token, { agent_version: AGENT_VERSION, uploaded_by: uploader || null, states });\n}'));
    expect(fn).toMatch(/const tpos = _liveTargetPosOf\(st\);/);
    expect(fn).toMatch(/\.\.\.\(tpos \? \{ target_map: \{ x: Math\.round\(tpos\.x\), y: Math\.round\(tpos\.y\), z: Math\.round\(tpos\.z\) \}, target_type: 1, target_zone: tpos\.zone \} : \{\}\),/);
    expect(fn).toMatch(/const targetMoved  = _liveTargetPosDue\(_liveTargetPosSent\.get\(ch\), tpos, now\);/);
    expect(fn).toMatch(/if \(!sigChanged && !heartbeatDue && !targetMoved\) continue;/);
    expect(fn).toMatch(/if \(tpos\) _liveTargetPosSent\.set\(ch, \{ id: tpos\.id, x: tpos\.x, y: tpos\.y, at: now \}\); else _liveTargetPosSent\.delete\(ch\);/);
    const sigAt = fn.indexOf('const sig = JSON.stringify([');
    const sig = fn.slice(sigAt, fn.indexOf(']);', sigAt));
    expect(sig).not.toMatch(/tpos|target_map|loc_x/);
  });
  it('is wired into the map pull: tsince on the query and the answer applied', () => {
    const js = stripJs(CORE);
    expect(js).toMatch(/\(tsince > 0 \? '&tsince=' \+ tsince : ''\)/);
    expect(js).toMatch(/if \(j\) _mapApplyShared\(zone, j, Date\.now\(\)\);/);
  });
  it('the overlay draws a raid-placed focus ring at the shared position', () => {
    expect(stripJs(MAP_HTML)).toMatch(/else if \(fo\.at === 'raid' && fo\.x != null\) fp = \{ x: fo\.x, y: fo\.y \};/);
  });
});

describe('the target\'s Area Rampage ring (agent 3.7.183)', () => {
  const AE = { radius_still: 16.55, radius_moving: 14.55, chance: 5, targets: null, damage_pct: 100 };
  const RECUSO = { name: 'A Recuso Degenerate', level: 62, specials: ['Area Rampage'], ae_rampage: AE };
  const stand = (c, extra) => {
    c._zealState.Aldenmar = Object.assign({ zone: 164, updatedAt: 1e18, loc: { x: 0, y: 0, z: 0 },
      target_name: 'A Recuso Degenerate', target_id: 5, target_type: 1, target_hp_pct: 100, target_loc: { x: 7, y: 9, z: 0 } }, extra || {});
  };

  it('the target carries the cached mob info\'s ae_rampage, untouched', () => {
    const { c } = localCore();
    stand(c);
    c._mobInfoByName.set('a recuso degenerate|164', { at: Date.now(), mob: RECUSO });
    expect(c._mapStatePayload('', T0 + 1000).target.ae_rampage).toEqual(AE);
    expect(c._mobInfoFetches).toEqual([]);   // fresh in the cache: no lookup
  });
  it('a mob without Area Rampage, or an older bot\'s row that predates the field, has none', () => {
    const { c } = localCore();
    stand(c);
    c._mobInfoByName.set('a recuso degenerate|164', { at: Date.now(), mob: { name: 'A Recuso Degenerate', specials: [] } });
    expect(c._mapStatePayload('', T0 + 1000).target).not.toHaveProperty('ae_rampage');
    c._mobInfoByName.set('a recuso degenerate|164', { at: Date.now(), mob: { name: 'x', ae_rampage: { radius_still: 0 } } });
    expect(c._mapStatePayload('', T0 + 1000).target).not.toHaveProperty('ae_rampage');
  });
  it('nothing cached yet asks for the mob info and sends no ring meanwhile', () => {
    const { c } = localCore();
    stand(c);
    const p = c._mapStatePayload('', T0 + 1000);
    expect(p.target).not.toHaveProperty('ae_rampage');
    expect(c._mobInfoFetches).toEqual([['A Recuso Degenerate', 'Aldenmar', 164]]);
  });
  it('a player or a corpse never carries it', () => {
    const { c } = localCore();
    c._mobInfoByName.set('a recuso degenerate|164', { at: Date.now(), mob: RECUSO });
    stand(c, { target_type: 0 });
    expect(c._mapStatePayload('', T0 + 1000).target).not.toHaveProperty('ae_rampage');
    stand(c, { target_type: 2 });
    expect(c._mapStatePayload('', T0 + 1000).target).not.toHaveProperty('ae_rampage');
  });

  describe('the overlay (apps/mimic/map.html)', () => {
    // eslint-disable-next-line no-new-func
    const H = new Function(sliceBlock(MAP_HTML, '// ── pure helpers', '// ── end pure helpers ──')
      + '\nreturn { aeRampageRing, CFG_SHOW, mapCfgDefaults, MAP_SCHEMES, inkStyle, hexA };')();
    const t = (extra) => Object.assign({ name: 'A Recuso Degenerate', type: 1, hp_pct: 80, x: 10, y: 20, ae_rampage: AE }, extra || {});
    it('rings the target at radius_still, in game units (the aggro rings\' scale), labelled and explained', () => {
      const r = H.aeRampageRing(t());
      expect(r.r).toBe(16.55);
      expect(H.aeRampageRing(t({ ae_rampage: Object.assign({}, AE, { radius_still: 14.4 }) })).label).toBe('AE rampage · 14.4');
      expect(H.aeRampageRing(t({ ae_rampage: Object.assign({}, AE, { radius_still: 40 }) })).label).toBe('AE rampage · 40');
      expect(r.tip).toBe('Hits everyone on its hate list inside this ring except the tank · 5% per round');
      expect(H.aeRampageRing(t({ ae_rampage: Object.assign({}, AE, { targets: 3 }) })).tip).toMatch(/ · up to 3 people$/);
    });
    it('no ring without ae_rampage, for a player or corpse, or for a radius that is nothing or the whole zone', () => {
      expect(H.aeRampageRing(t({ ae_rampage: undefined }))).toBeNull();
      expect(H.aeRampageRing(null)).toBeNull();
      expect(H.aeRampageRing(t({ type: 0 }))).toBeNull();
      expect(H.aeRampageRing(t({ name: "A Recuso Degenerate's corpse", type: null }))).toBeNull();
      expect(H.aeRampageRing(t({ hp_pct: 0 }))).toBeNull();
      expect(H.aeRampageRing(t({ ae_rampage: { radius_still: 0 } }))).toBeNull();
      expect(H.aeRampageRing(t({ ae_rampage: { radius_still: 5000 } }))).toBeNull();
    });
    it('an older Zeal that sends no type still rings a live mob', () => {
      expect(H.aeRampageRing(t({ type: null }))).not.toBeNull();
    });

    // The real aeRampageDraw over a recording canvas.
    const src = sliceBlock(MAP_HTML, 'function aeRampageDraw(x, y, ring) {', '\n  }');
    function draw(ring, scale) {
      const ops = [], halos = [];
      const ctx = { lineWidth: 1, strokeStyle: '',
        beginPath() {}, setLineDash(d) { ops.push({ op: 'dash', d }); },
        arc(x, y, r) { ops.push({ op: 'arc', x, y, r }); }, stroke() { ops.push({ op: 'stroke', style: ctx.strokeStyle }); } };
      const S = { cfg: { col: { aeRamp: '#ff5c5c' }, ink: 1 }, view: { scale } };
      new Function('ctx', 'S', 'inkStyle', 'hexA', 'halo', 'labelFont', src + '\nreturn aeRampageDraw;')(
        ctx, S, H.inkStyle, H.hexA, (text, x, y) => halos.push({ text, x, y }), () => '9px mono')(100, 200, ring);
      return { ops, halos };
    }
    it('draws a red dashed ring of radius x scale on the target, with its label above it', () => {
      const d = draw(H.aeRampageRing(t()), 4);
      expect(d.ops.find(o => o.op === 'arc')).toEqual({ op: 'arc', x: 100, y: 200, r: 16.55 * 4 });
      expect(d.ops.find(o => o.op === 'dash').d.length).toBeGreaterThan(0);
      expect(d.ops.find(o => o.op === 'stroke').style).toMatch(/^rgba\(255,92,92,/);
      expect(d.halos).toEqual([{ text: 'AE rampage · 16.6', x: 100, y: 200 - 16.55 * 4 - 7 }]);
    });
    it('is a speck when zoomed far out: not drawn', () => {
      expect(draw(H.aeRampageRing(t()), 0.1)).toEqual({ ops: [], halos: [] });
    });
    it('is wired to the target only, behind its own switch (default on), and cleared each frame', () => {
      const js = stripJs(MAP_HTML);
      expect(js).toMatch(/var aer = SH\.aeRampage \? aeRampageRing\(P\.target\) : null;/);
      expect(js).toMatch(/if \(aer\) \{ aeRampageDraw\(tq\[0\], tq\[1\], aer\); S\.aeRing = \{ x: td\.x, y: td\.y, r: aer\.r, tip: aer\.tip \}; \}/);
      expect(js).toMatch(/S\.aeRing = null; S\.rampRing = null;\n\s+if \(P\.target && P\.target\.x != null\) \{/);
      expect(js).toMatch(/if \(cv\.title !== tip\) cv\.title = tip;/);
      expect(H.CFG_SHOW.some(([k, label]) => k === 'aeRampage' && /AE rampage/.test(label))).toBe(true);
      expect(H.mapCfgDefaults().show.aeRampage).toBe(true);
      for (const s of Object.values(H.MAP_SCHEMES)) expect(s.aeRamp).toMatch(/^#[0-9a-f]{6}$/);
    });
  });
});

describe('the target\'s regular Rampage ring (agent 3.7.184)', () => {
  const AE = { radius_still: 16.55, radius_moving: 14.55, chance: 5, targets: null, damage_pct: 100 };
  const RP = { range: 75, chance: 20, damage_pct: 100 };
  const MOB = { name: 'A Recuso Degenerate', level: 62, specials: ['Rampage'], rampage: RP };
  const stand = (c, extra) => {
    c._zealState.Aldenmar = Object.assign({ zone: 164, updatedAt: 1e18, loc: { x: 0, y: 0, z: 0 },
      target_name: 'A Recuso Degenerate', target_id: 5, target_type: 1, target_hp_pct: 100, target_loc: { x: 7, y: 9, z: 0 } }, extra || {});
  };

  it('the target carries the cached mob info\'s rampage, untouched, next to ae_rampage when both exist', () => {
    const { c } = localCore();
    stand(c);
    c._mobInfoByName.set('a recuso degenerate|164', { at: Date.now(), mob: Object.assign({}, MOB, { ae_rampage: AE }) });
    const t = c._mapStatePayload('', T0 + 1000).target;
    expect(t.rampage).toEqual(RP);
    expect(t.ae_rampage).toEqual(AE);
  });
  it('a mob with only regular Rampage carries no ae_rampage, and one with only Area Rampage carries no rampage', () => {
    const { c } = localCore();
    stand(c);
    c._mobInfoByName.set('a recuso degenerate|164', { at: Date.now(), mob: MOB });
    expect(c._mapStatePayload('', T0 + 1000).target).not.toHaveProperty('ae_rampage');
    c._mobInfoByName.set('a recuso degenerate|164', { at: Date.now(), mob: { name: 'x', ae_rampage: AE } });
    expect(c._mapStatePayload('', T0 + 1000).target).not.toHaveProperty('rampage');
  });
  it('an older bot\'s row, or a zero range, has none', () => {
    const { c } = localCore();
    stand(c);
    c._mobInfoByName.set('a recuso degenerate|164', { at: Date.now(), mob: { name: 'x', specials: [] } });
    expect(c._mapStatePayload('', T0 + 1000).target).not.toHaveProperty('rampage');
    c._mobInfoByName.set('a recuso degenerate|164', { at: Date.now(), mob: { name: 'x', rampage: { range: 0 } } });
    expect(c._mapStatePayload('', T0 + 1000).target).not.toHaveProperty('rampage');
  });
  it('a player or a corpse never carries it', () => {
    const { c } = localCore();
    c._mobInfoByName.set('a recuso degenerate|164', { at: Date.now(), mob: MOB });
    stand(c, { target_type: 0 });
    expect(c._mapStatePayload('', T0 + 1000).target).not.toHaveProperty('rampage');
    stand(c, { target_type: 2 });
    expect(c._mapStatePayload('', T0 + 1000).target).not.toHaveProperty('rampage');
  });

  describe('the overlay (apps/mimic/map.html)', () => {
    // eslint-disable-next-line no-new-func
    const H = new Function(sliceBlock(MAP_HTML, '// ── pure helpers', '// ── end pure helpers ──')
      + '\nreturn { rampageRing, aeRampageRing, CFG_SHOW, CFG_COLS, mapCfgDefaults, MAP_SCHEMES, inkStyle, hexA };')();
    const t = (extra) => Object.assign({ name: 'A Recuso Degenerate', type: 1, hp_pct: 80, x: 10, y: 20, rampage: RP }, extra || {});
    it('rings the target at range, in game units, labelled and explained', () => {
      const r = H.rampageRing(t());
      expect(r.r).toBe(75);
      expect(r.label).toBe('Rampage · 75');
      expect(H.rampageRing(t({ rampage: { range: 40.04, chance: 10 } })).label).toBe('Rampage · 40');
      expect(r.tip).toBe('Hits ONE person: the first on its rampage list who isn\'t the tank, inside this ring · 20% per round');
      expect(H.rampageRing(t({ rampage: { range: 30, chance: 8 } })).tip).toMatch(/ · 8% per round$/);
    });
    it('no ring without rampage, for a player or corpse, or for a range that is nothing or the whole zone', () => {
      expect(H.rampageRing(t({ rampage: undefined }))).toBeNull();
      expect(H.rampageRing(null)).toBeNull();
      expect(H.rampageRing(t({ type: 0 }))).toBeNull();
      expect(H.rampageRing(t({ name: "A Recuso Degenerate's corpse", type: null }))).toBeNull();
      expect(H.rampageRing(t({ hp_pct: 0 }))).toBeNull();
      expect(H.rampageRing(t({ rampage: { range: 0 } }))).toBeNull();
      expect(H.rampageRing(t({ rampage: { range: 5000 } }))).toBeNull();
    });
    it('the AE ring and the rampage ring are independent: either, both or neither', () => {
      const both = t({ ae_rampage: AE });
      expect(H.aeRampageRing(both)).not.toBeNull();
      expect(H.rampageRing(both)).not.toBeNull();
      expect(H.aeRampageRing(t())).toBeNull();
      expect(H.rampageRing(t({ rampage: undefined, ae_rampage: AE }))).toBeNull();
    });

    // The real rampageDraw over a recording canvas.
    const src = sliceBlock(MAP_HTML, 'function rampageDraw(x, y, ring) {', '\n  }');
    function draw(ring, scale) {
      const ops = [], halos = [];
      const ctx = { lineWidth: 1, strokeStyle: '',
        beginPath() {}, setLineDash(d) { ops.push({ op: 'dash', d }); },
        arc(x, y, r) { ops.push({ op: 'arc', x, y, r }); }, stroke() { ops.push({ op: 'stroke', style: ctx.strokeStyle }); } };
      const S = { cfg: { col: { ramp: '#ff79c6' }, ink: 1 }, view: { scale } };
      new Function('ctx', 'S', 'inkStyle', 'hexA', 'halo', 'labelFont', src + '\nreturn rampageDraw;')(
        ctx, S, H.inkStyle, H.hexA, (text, x, y) => halos.push({ text, x, y }), () => '9px mono')(100, 200, ring);
      return { ops, halos };
    }
    it('draws a dotted ring of range x scale in its own colour, with its label under it', () => {
      const d = draw(H.rampageRing(t()), 2);
      expect(d.ops.find(o => o.op === 'arc')).toEqual({ op: 'arc', x: 100, y: 200, r: 150 });
      expect(d.ops.find(o => o.op === 'dash').d).toEqual([2, 5]);
      expect(d.ops.find(o => o.op === 'stroke').style).toMatch(/^rgba\(255,121,198,/);
      expect(d.halos).toEqual([{ text: 'Rampage · 75', x: 100, y: 200 + 150 + 12 }]);
    });
    it('is a speck when zoomed far out: not drawn', () => {
      expect(draw(H.rampageRing(t()), 0.01)).toEqual({ ops: [], halos: [] });
    });
    it('is wired to the target only, behind its own switch (default on), cleared each frame, with a hover tip', () => {
      const js = stripJs(MAP_HTML);
      expect(js).toMatch(/var rr = SH\.rampage \? rampageRing\(P\.target\) : null;/);
      expect(js).toMatch(/if \(rr\) \{ rampageDraw\(tq\[0\], tq\[1\], rr\); S\.rampRing = \{ x: td\.x, y: td\.y, r: rr\.r, tip: rr\.tip \}; \}/);
      expect(js).toMatch(/\[S\.aeRing, S\.rampRing\]\.forEach/);
      expect(H.CFG_SHOW.some(([k, label]) => k === 'rampage' && /Rampage ring/.test(label))).toBe(true);
      expect(H.CFG_COLS.some(([k]) => k === 'ramp')).toBe(true);
      expect(H.mapCfgDefaults().show.rampage).toBe(true);
      for (const s of Object.values(H.MAP_SCHEMES)) expect(s.ramp).toMatch(/^#[0-9a-f]{6}$/);
      // not the AE ring's colour in any scheme, so the two never read as one
      for (const s of Object.values(H.MAP_SCHEMES)) expect(s.ramp).not.toBe(s.aeRamp);
    });
  });
});
