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
const MAIN = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));

const EXPORTS = ['_mapServerXY', '_mapZoneShort', '_mapNormName', '_mapAttribute', '_mapMakeTimer', '_mapTimerState',
  '_mapApplyMark', '_mapNoteDeath', '_mapNoteState', '_mapNoteLogDeath', '_mapStatePayload', '_mapSaveNow', '_mapDoc',
  '_mapZoneDoc', '_mapPrune', '_mapEnsureZone', '_mapPaths', '_zealState', '_setRaid', '_setOpts', 'MAP_ZONE_SHORT'];

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
        end() {
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
  for (const k of cores.splice(0)) { try { k._mapSaveNow(); } catch { /* nothing to flush */ } }   // also clears the debounce timer
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
    expect(net.calls).toHaveLength(0);
    seedCache(dir, ZONE_BODY, Date.now() - 25 * 3600000);
    net = fakeNet(() => ({ status: 304 }));
    c = loadCore({ dir, opts: live(), net });
    c._zealState.Aldenmar = { zone: 164, updatedAt: Date.now(), loc: { x: 1, y: 1, z: 0 } };
    expect(c._mapStatePayload('', Date.now()).points).toHaveLength(6);   // served from disk while it revalidates
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0].headers['If-None-Match']).toBe('"v1"');
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
  const H = new Function(helpers + '\nreturn { toScreen, headingVec, timerState, fmtDur, timerText, badgeGlyph, badgeWords, pointBadges, pointKind, bestName, nearestBand, fitView, FLASH_MS, lerpHeading, blendPos, trackAt, trackStep, trackMoving, SNAP_DIST };')();

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
  it('picks the floor nearest your z, and fits the zone with the north-up flip', () => {
    expect(H.nearestBand([0, 20, 40], 22)).toBe(1);
    expect(H.nearestBand([], 5)).toBe(-1);
    const v = H.fitView({ minX: -100, maxX: 300, minY: 0, maxY: 100 }, 400, 200);
    expect(v.cx).toBeCloseTo(-100);   // screen x = -x: the zone's middle x = 100 -> -100
    expect(v.cy).toBeCloseTo(-50);
    expect(v.scale).toBeCloseTo(0.92);
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
    it('a track glides over the time the last step took, and settles on the sample', () => {
      let tr = H.trackStep(undefined, A, 1000);
      expect(H.trackMoving(tr, 1000)).toBe(false);          // the first sight of a name has nowhere to glide from
      tr = H.trackStep(tr, B, 1300);                        // 300ms since the last sample -> a 300ms glide
      expect(tr.dur).toBe(300);
      expect(H.trackAt(tr, 1300).x).toBeCloseTo(0);
      expect(H.trackAt(tr, 1450).x).toBeCloseTo(50);
      expect(H.trackAt(tr, 1600)).toEqual(B);
      expect(H.trackAt(tr, 9000)).toEqual(B);               // never overshoots
      expect(H.trackMoving(tr, 1450)).toBe(true);
      expect(H.trackMoving(tr, 1600)).toBe(false);          // an idle map stops asking for frames
    });
    it('the same sample again does not restart the glide; a new one starts from where the dot is drawn', () => {
      const tr = H.trackStep(H.trackStep(undefined, A, 1000), B, 1300);
      expect(H.trackStep(tr, B, 1450)).toBe(tr);
      const C = { x: 100, y: 140, z: 10, heading: 100 };
      const next = H.trackStep(tr, C, 1450);                // mid-glide: from = the drawn spot, not the old sample
      expect(next.from.x).toBeCloseTo(50);
      expect(next.to).toEqual(C);
    });
    it('a big jump on a track snaps (no glide), and a long silence does not stretch the next glide', () => {
      let tr = H.trackStep(undefined, A, 0);
      const far = { x: 3000, y: 3000, z: 0, heading: 0 };
      tr = H.trackStep(tr, far, 300);
      expect(H.trackMoving(tr, 300)).toBe(false);
      expect(H.trackAt(tr, 300)).toEqual(far);
      const back = H.trackStep(tr, { x: 3010, y: 3000, z: 0, heading: 0 }, 60000);   // a minute later
      expect(back.dur).toBeLessThanOrEqual(500);
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

  it('runs: with window.mimic ABSENT it still draws spots, hover-capable buttons and the timer list', async () => {
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
      points: POINTS, map: ZONE_BODY.map, self: { x: 90, y: 190, z: 0, heading: 64, name: 'Aldenmar' },
      group: [{ name: 'Brackwyn', x: 100, y: 180, z: 0 }], raid: [], target: { name: 'a decaying skeleton', x: 110, y: 210, z: 0, dist: 28 },
      timers: [{ point_id: 1, name: 'a decaying skeleton', died_at: T0, earliest: T0 + 540000, latest: T0 + 660000, source: 'seen', state: 'wait' }],
      unassigned: [{ id: 'u1', name: 'a decaying skeleton', died_at: T0, candidates: [2, 6] }],
    };
    const fetched = [];
    const win = { addEventListener() {}, devicePixelRatio: 1, mimic: undefined };
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'location', 'fetch', 'localStorage', 'ResizeObserver', 'setInterval', 'clearInterval',
      script)(win, doc, { search: '' }, (u) => { fetched.push(u); return Promise.resolve({ json: () => Promise.resolve(payload) }); },
      { getItem() { return null; }, setItem() {} }, undefined, () => 1, () => {});
    await tick();
    expect(fetched[0]).toBe('http://127.0.0.1:7779/api/map-state');
    const hits = all.hits.children;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every(h => h.tag === 'button' && h.attrs['data-wp-interact'] === '')).toBe(true);
    expect(all.lists.children.some(r => /trow/.test(r.className))).toBe(true);
    expect(all.zone.textContent).toBe('The Deep');
    // a second poll asks with the version it holds
    expect(all.msg.style.display).toBe('none');
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
    expect(dash).toMatch(/\['map',\s+'Spawn map \[beta\]'/);
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
    expect(MAIN).toMatch(/label: 'Spawn map \(zone map, spawn timers\) \[beta\]', type: 'checkbox', checked: !!s\.showMap/);
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
