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
import { readSource, sliceBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const AGENT = readSource(AGENT_INDEX);
const CORE = sliceBlock(AGENT, '// ── Spawn map core (Mimic 2.9', '// ── end Spawn map core ──');
const MAP_HTML = readSource(path.join(ROOT, 'apps', 'mimic', 'map.html'));
const MAIN = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));

const EXPORTS = ['_mapServerXY', '_mapZoneShort', '_mapNormName', '_mapAttribute', '_mapMakeTimer', '_mapTimerState',
  '_mapApplyMark', '_mapNoteDeath', '_mapNoteState', '_mapNoteLogDeath', '_mapStatePayload', '_mapSaveNow', '_mapDoc',
  '_mapZoneDoc', '_mapPrune', '_mapEnsureZone', '_mapPaths', '_zealState', '_setRaid', '_setOpts', 'MAP_ZONE_SHORT',
  '_mapTryPin', '_mapPinGet', '_mapSync', '_mapSyncStop', '_mapSyncFlush', '_mapSyncPull', '_mapApplyRemote', '_mapLocalEvent',
  '_mapSegDist', '_mapRouteDist'];

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
  `;
  // eslint-disable-next-line no-new-func
  const f = new Function('fs', 'path', 'http', 'https', 'zlib', '__dirname', '__tmp', '__opts',
    prelude + '\n' + CORE + `\nreturn { ${EXPORTS.join(', ')} };`);
  const c = f(fs, path, net.http, net.https, zlib, dir, dir, opts);
  c._mapPaths.cache = path.join(dir, 'zone-spawns-cache');
  c._mapPaths.timers = path.join(dir, 'map_timers.json');
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

// A small zone in the SERVER frame. skel: three skeleton points, two of them 150 apart (p1, p6) so the
// "clearly closer" rule has something to bite on. Zone id 164 = thedeep.
const NPC = (name, extra) => Object.assign({ name, level: 50, chance: 100, named: false, raid_target: false, badges: [] }, extra || {});
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
  const H = new Function(helpers + '\nreturn { toScreen, headingVec, timerState, fmtDur, timerText, badgeGlyph, badgeWords, pointBadges, pointKind, bestName, fitView, FLASH_MS, lerpHeading, blendPos, trackAt, trackStep, trackMoving, SNAP_DIST, seenText, LEVEL_STEPS, levelLabel, inLevelRange, FIT_MODES, FIT_LABEL, nextFitMode, resolveFit, membersBounds, SMOOTH_MS, DIRECT_STALE_MS, useDirect, directMap, posAgeText, targetKey };')();

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
  it('a zone with no routes sends grids: null', () => {
    const { c } = localCore();
    c._zealState.Aldenmar = { zone: 164, updatedAt: T0, loc: { x: 1, y: 2, z: 0 } };
    expect(c._mapStatePayload('', T0 + 1).grids).toBeNull();
  });
  it('the overlay draws the routes of visible points dashed, ticks the pauses, fades by level, lights the hovered one, badges walkers', () => {
    const js = stripJs(MAP_HTML);
    expect(js).toMatch(/function drawRoutes\(vis, sz, range\)/);
    expect(js).toMatch(/drawRoutes\(vis, sz, range\);/);
    expect(js).toMatch(/ctx\.setLineDash\(\[4, 4\]\); ctx\.lineWidth = hot \? 1\.8 : 1;/);
    expect(js).toMatch(/if \(!\(Number\(g\.pts\[j\]\[3\]\) > 0\)\) continue;/);
    expect(js).toMatch(/ctx\.globalAlpha = hot \? 1 : it\.near \? 0\.7 : 0\.25;/);
    expect(js).toMatch(/S\.hoverGrid = g; renderMap\(true\)/);
    expect(js).toMatch(/if \(p\.grid != null\) halo\('↻'/);
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
      expect(js).toMatch(/if \(!animating \|\| rt - lastHits >= HITS_MS\) \{ lastHits = rt; layoutHits\(vis\); \}/);
      expect(Number(/\bHITS_MS = (\d+)/.exec(js)[1])).toBeGreaterThanOrEqual(200);
      // Follow me rides the drawn spot of you, and the flashing ring still has its own timer
      expect(js).toMatch(/if \(S\.follow && S\.p && S\.p\.self && !S\.drag\) \{ var fs = drawn\('self'/);
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
  it('Spawn height: spawn points further above or below you than the slider are hidden (default: all)', async () => {
    const shown = (all) => all.hits.children.filter(h => !h.hidden).length;
    const base = await bootOverlay();
    expect(base.S.spawnLevels).toBe(7);                              // default: all spawns
    expect(base.all.spawnVal.textContent).toBe('Spawn height: all');
    const all = shown(base.all);
    // Lift one point 500 above you and narrow the range to +-25: it disappears, the rest stay.
    const high = Object.assign({}, base.payload, { points: base.payload.points.map((p, i) => (i === 0 ? Object.assign({}, p, { z: 500 }) : p)) });
    const narrow = await bootOverlay({ store: { 'wp-map-spawn-levels': '0' }, payload: high });
    expect(narrow.all.spawnVal.textContent).toBe('Spawn height ±25');
    expect(shown(narrow.all)).toBe(all - 1);
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
    c._zealState.Aldenmar = { zone: 164, updatedAt: 1e18, loc: { x: 0, y: 0, z: 0 } };
    return { c, net };
  }
  const queued = (c) => c._mapSync.q.map(k => k.ev);
  const watch = (c, s) => { c._zealState.Aldenmar = Object.assign({}, s, { updatedAt: 1e18 }); };

  describe('the pin: only when certain', () => {
    it('a live NPC at exactly one point is pinned, recorded as seen alive, and the payload says so', () => {
      const { c } = liveCore(); const N = Date.now();
      const s = tgt(9, 100, 105, 202);
      c._mapNoteState('Aldenmar', null, s, N);
      expect(c._mapPinGet('thedeep', 9)).toMatchObject({ point_id: 1 });
      watch(c, s);
      const p = c._mapStatePayload('', N + 1000);
      expect(p.seen).toEqual([{ point_id: 1, spawn_id: 9, name: 'a decaying skeleton', at: N, by: null }]);
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
    beforeEach(() => { ({ c } = localCore()); });
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
      expect(state().seen).toEqual([{ point_id: 3, spawn_id: 5, name: 'a decaying skeleton', at: T0 + 1000, by: 'Corvale' }]);
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
    it('a future-dated event, an unknown point and an unknown kind change nothing', () => {
      expect(c._mapApplyRemote('thedeep', [ev({ at: NOWR + 120000 }), ev({ point_id: 999 }), ev({ kind: 'explode' }), ev({ at: 'soon' }), null], NOWR)).toBe(0);
      expect(state().timers).toEqual([]);
    });
  });

  describe('the overlay: contrast, "up · seen" and the pinned line', () => {
    const js = stripJs(MAP_HTML);
    const helpers = sliceBlock(MAP_HTML, '// ── pure helpers', '// ── end pure helpers ──');
    it('hover words: seen alive <ago> · spawn #<id>, and by <name> when a guildmate saw it', () => {
      expect(new Function(helpers + '\nreturn seenText;')()({ at: T0 - 120000, spawn_id: 812, by: 'Corvale' }, T0)).toBe('seen alive 2m ago · spawn #812 · by Corvale');
      expect(new Function(helpers + '\nreturn seenText;')()({ at: T0 - 120000, spawn_id: null, by: null }, T0)).toBe('seen alive 2m ago');
    });
    it('a dark slate background instead of black (the panes keep the opacity slider)', () => {
      expect(MAP_HTML).toMatch(/#mapPane\{[^}]*background:rgb\(19 26 38 \/ var\(--bg-alpha\)\)/);
      expect(MAP_HTML).toMatch(/#side\{[^}]*background:rgb\(19 26 38 \/ var\(--bg-alpha\)\)/);
      expect(MAP_HTML).not.toMatch(/rgb\(0 0 0 \/ var\(--bg-alpha\)\)/);
    });
    it('brighter, thicker walls in the level range; the rest at 0.35; out-of-range dots at 0.4; bigger lighter dots with an outline', () => {
      expect(js).toMatch(/ctx\.strokeStyle = bright \? 'rgba\(214,230,255,0\.95\)' : 'rgba\(170,195,235,0\.35\)';/);
      expect(js).toMatch(/ctx\.lineWidth = bright \? 1\.6 : 1;/);
      expect(js).toMatch(/var bright = S\.prep\.bands\.length <= 1 \|\| inLevelRange\(S\.prep\.bands\[b\], sz, range\);/);
      expect(js).toMatch(/ctx\.globalAlpha = inLevelRange\(p\.z, sz, range\) \? 1 : 0\.4;/);
      expect(js).toMatch(/var r = kind\.raid \? 6\.5 : kind\.named \? 5\.5 : 4\.2;/);
      expect(js).toMatch(/: '#c9d1d9'; ctx\.fill\(\);/);
      expect(js).toMatch(/strokeStyle = '#0d1117'; ctx\.stroke\(\);   \/\/ a dark outline on every dot/);
    });
    it('keeps the red / yellow / green rings, and draws seen points with a solid green ring and fill', () => {
      expect(js).toMatch(/var RING = \{ wait: '#f85149', window: '#f0b429', up: '#56d364' \};/);
      expect(js).toMatch(/if \(sn\) \{[^}]*ctx\.arc\(px, py, r \+ 3\.5[^}]*strokeStyle = '#56d364'; ctx\.stroke\(\);\s*\} else if \(t\) \{/);
      expect(js).toMatch(/ctx\.fillStyle = sn \? '#56d364'/);
      expect(js).toMatch(/card\.appendChild\(el\('div', 't', 'up · ' \+ seenText\(sn, nowMs\(\)\)\)\)/);
    });
    it('draws a thin line from a pinned target to its spawn point, and says "→ pinned" in the header', () => {
      expect(js).toMatch(/var pinPt = P\.target\.point_id != null \? S\.byId\[String\(P\.target\.point_id\)\] : null;\s*if \(pinPt\) \{\s*var pq = wpt\(pinPt\.x, pinPt\.y\);\s*ctx\.beginPath\(\); ctx\.moveTo\(tq\[0\], tq\[1\]\); ctx\.lineTo\(pq\[0\], pq\[1\]\);\s*ctx\.lineWidth = 1;/);
      expect(js).toMatch(/\(P\.target\.point_id != null \? ' → pinned' : ''\)/);
    });
    it('the menu gets a Clear timer button only where there is a timer or a sighting', () => {
      expect(js).toMatch(/if \(S\.timerBy\[pid\] \|\| S\.seenBy\[pid\]\) mk\('Clear timer', 'clear'\);/);
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
