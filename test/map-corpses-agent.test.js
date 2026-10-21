// Guild corpses on the Mimic Map (the guild lead, 2026-10-17: "add the corpses on to the map and give a link to someone that is
// dragging that corpse and if their machine says that they start dragging the corpse or stop dragging the corpse that's where it
// ends up landing near that player's location; there's also a one-off summoning corpse that would have the player targeting that
// corpse so we should be able to tell where that corpse landed if it changes").
//
// Agent half: the "Guild corpses" part of the Spawn map core in packages/wolfpack-logsync/index.js, source-sliced and run as
// shipped over a temp dir and fake network modules (the way test/map-watch-agent.test.js does): the player-vs-NPC corpse name
// filter, the pipe -> server frame swap, the "seen" dedupe, the drag sequence off the server's own log strings (fixtures below),
// the older-bot 404, the copy-of-the-zone (inst) rule. Overlay half: apps/mimic/map.html's pure helpers, the side list and the
// hover card with its dragger link, run against a stub page. Text assertions strip comments first (CLAUDE.md, "comments satisfy
// text assertions").
//
// The log lines are the EQMacEmu server's own strings (zone/string_ids.h: CORPSEDRAG_BEGIN 4064 "You begin to drag %1.",
// CORPSEDRAG_STOP 4066 "You stop dragging the corpse.", CORPSEDRAG_STOPALL 4065 "You stop dragging the corpses.",
// SUMMONING_CORPSE 429 "Summoning your corpse.", SUMMONING_CORPSE_OTHER 430 "Summoning %1's corpse.", REZ_REGAIN 289
// "You regain some experience from resurrection."), wrapped in the log's "[Sat Oct 17 20:01:02 2026] " prefix.
//
// Mutation-checked (each makes a test below fail): drop the type check in _mapPlayerCorpseOwner; use the pipe x/y as the server
// x/y; drop the seen dedupe; drop the 404 backoff; drop the inst check in _mapCorpseList; stop building the dragger link in
// showCorpseCard; drop the corpse section from renderSide.
//
// Run: npx vitest run test/map-corpses-agent.test.js

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

const EXPORTS = ['_mapPlayerCorpseOwner', '_mapCorpseEvent', '_mapCorpseNoteTarget', '_mapCorpseNoteDied', '_mapCorpseNoteLine',
  '_mapCorpseTickDrag', '_mapCorpseFlush', '_mapCorpseStop', '_mapCorpseApplyBot', '_mapCorpseList', '_mapCorpse',
  '_mapStatePayload', '_mapSaveNow', '_mapSyncStop', '_mapEnsureZone', '_mapPaths', '_zealState', '_mapCopy', '__excluded'];
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
    const __excluded = new Set();
    function shouldUploadForCharacter(c) { return !__excluded.has(String(c).toLowerCase()); }
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
const posts = (net) => net.calls.filter(o => o.method === 'POST' && /\/map-corpse$/.test(o.path)).map(o => ({ path: o.path, body: JSON.parse(o.__body) }));

const NPC = (name) => ({ name, level: 50, chance: 100, named: false, raid_target: false, badges: [], aggro: 60, fac: 1, assist: null, pf: 0 });
const POINTS = [{ id: 7, x: 300, y: -450, z: 0, respawn_s: 1200, variance_s: 120, npcs: [NPC('a_blood_raven')] }];
const ZONE_BODY = {
  zone: 'thedeep', long_name: 'The Deep', generated_at: '2026-10-17T00:00:00Z', points: POINTS,
  map: { bands: [0], segs: [[0, 0, 100, 0, 0]], bounds: { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 } },
};
const LIVE = { botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: 'tok' };

let dir;
const cores = [];
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mapcorpse-')); });
afterEach(() => {
  for (const k of cores.splice(0)) { try { k._mapSaveNow(); k._mapSyncStop(); k._mapCorpseStop(); } catch { /* nothing to flush */ } }
  fs.rmSync(dir, { recursive: true, force: true });
});
// A core linked to the bot with the zone on disk; Aldenmar plays in The Deep (zone 164) at pipe loc x 100, y -50 (server x -50, y 100).
function liveCore(responder, opts) {
  fs.mkdirSync(path.join(dir, 'zone-spawns-cache'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'zone-spawns-cache', 'thedeep.json'), JSON.stringify({ etag: '"v1"', fetched_at: Date.now(), body: ZONE_BODY }));
  const net = fakeNet(responder);
  const c = loadCore({ dir, opts: opts || LIVE, net });
  c._mapEnsureZone('thedeep', 164, Date.now());
  c._zealState.Aldenmar = { zone: 164, updatedAt: 1e18, loc: { x: 100, y: -50, z: 7 }, group_members: [] };
  return { c, net };
}
const N = Date.now();
const LINE = (msg) => '[Sat Oct 17 20:01:02 2026] ' + msg;
const say = (c, msg, now, lineMs) => c._mapCorpseNoteLine(LINE(msg), 'Aldenmar', lineMs === undefined ? now : lineMs, now);
const moveTo = (c, x, y) => { c._zealState.Aldenmar.loc = { x, y, z: 7 }; };
const corpseOf = (c, now, name) => c._mapStatePayload('', now).corpses.find(k => k.name === name);

describe('which targets are a PLAYER corpse', () => {
  it('Zeal\'s target_type decides when it is there: 3 is a player corpse, 2 an NPC corpse, whatever the name looks like', () => {
    const { c } = liveCore();
    expect(c._mapPlayerCorpseOwner('Brackwyn\'s corpse', 3)).toBe('Brackwyn');
    expect(c._mapPlayerCorpseOwner('Brackwyn`s_corpse0', 3)).toBe('Brackwyn');            // the server spelling: underscore, number
    expect(c._mapPlayerCorpseOwner('brackwyn\'s corpse', 3)).toBe('Brackwyn');            // the type is the real test
    expect(c._mapPlayerCorpseOwner('Gorenaire\'s corpse', 2)).toBeNull();                 // a named one-word NPC, said to be an NPC corpse
    expect(c._mapPlayerCorpseOwner('Brackwyn\'s corpse', 1)).toBeNull();
    expect(c._mapPlayerCorpseOwner('Brackwyn', 3)).toBeNull();                            // not a corpse at all
  });
  it('an older Zeal sends no type: only a one-word capitalised owner passes, so "a gnoll\'s corpse" and "Lord Nagafen\'s corpse" never do', () => {
    const { c } = liveCore();
    expect(c._mapPlayerCorpseOwner('Brackwyn\'s corpse', null)).toBe('Brackwyn');
    expect(c._mapPlayerCorpseOwner('a gnoll\'s corpse', null)).toBeNull();
    expect(c._mapPlayerCorpseOwner('an orc pawn\'s corpse', undefined)).toBeNull();
    expect(c._mapPlayerCorpseOwner('Lord Nagafen\'s corpse', null)).toBeNull();
    expect(c._mapPlayerCorpseOwner('brackwyn\'s corpse', null)).toBeNull();
  });
  it('an NPC corpse in the target window is never reported or listed', () => {
    const { c, net } = liveCore();
    c._mapCorpseNoteTarget('thedeep', 'Aldenmar', { target_name: 'a gnoll\'s corpse', target_type: 2, target_loc: { x: 1, y: 2, z: 3 } }, N);
    c._mapCorpseNoteTarget('thedeep', 'Aldenmar', { target_name: 'a gnoll\'s corpse', target_type: null, target_loc: { x: 1, y: 2, z: 3 } }, N);
    expect(c._mapCorpseFlush(N)).toBe(false);
    expect(net.calls).toEqual([]);
    expect(c._mapStatePayload('', N).corpses).toEqual([]);
  });
});

describe('seen: a Mimic targets a player corpse', () => {
  it('posts to /map-corpse in the SERVER frame (pipe y becomes x, pipe x becomes y), with zone, character and the owner\'s name', async () => {
    const { c, net } = liveCore();
    c._mapCorpseNoteTarget('thedeep', 'Aldenmar', { target_name: 'Brackwyn\'s corpse', target_type: 3, target_loc: { x: 100, y: -50, z: 7 } }, N);
    expect(c._mapCorpseFlush(N)).toBe(true);
    await tick();
    const [p] = posts(net);
    expect(p.path).toBe('/api/agent/map-corpse');
    expect(p.body).toMatchObject({ zone: 'thedeep', inst: null, character: 'Aldenmar' });
    expect(p.body.events).toEqual([{ kind: 'seen', corpse: 'Brackwyn', x: -50, y: 100, z: 7, at: N }]);
    expect(net.calls[0].headers.Authorization).toBe('Bearer tok');
    expect(corpseOf(c, N, 'Brackwyn')).toMatchObject({ x: -50, y: 100, z: 7, dragger: null, died_age: null });   // drawn at once, too
  });
  it('reports again only when it moved more than 5 units or 60 s passed', async () => {
    const { c, net } = liveCore();
    const look = (x, y, at) => c._mapCorpseNoteTarget('thedeep', 'Aldenmar', { target_name: 'Brackwyn\'s corpse', target_type: 3, target_loc: { x, y, z: 0 } }, at);
    look(100, -50, N);
    look(100, -50, N + 5000);                 // same place, 5 s later: nothing
    look(103, -50, N + 10000);                // 3 units: nothing
    look(100, -50, N + 59000);                // still inside 60 s: nothing
    c._mapCorpseFlush(N + 60000); await tick();
    expect(posts(net)[0].body.events.map(e => e.kind)).toEqual(['seen']);
    look(110, -50, N + 61000);                // 10 units: reported
    look(110, -50, N + 125000);               // 60 s since the last report: reported
    c._mapCorpseFlush(N + 126000); await tick();
    expect(posts(net)[1].body.events.map(e => [e.x, e.y])).toEqual([[-50, 110], [-50, 110]]);
  });
});

describe('died, summoned and gone', () => {
  it('died: the confirmed death\'s own spot (_corpsePending\'s pipe loc) in the server frame, in the zone it happened in', async () => {
    const { c, net } = liveCore();
    c._mapCorpseNoteDied({ zone_id: 164, loc: { x: 100, y: -50, z: 7 }, died_at: new Date(N - 20000).toISOString() }, 'Aldenmar', N);
    c._mapCorpseFlush(N); await tick();
    expect(posts(net)[0].body.events).toEqual([{ kind: 'died', corpse: 'Aldenmar', x: -50, y: 100, z: 7, at: N - 20000 }]);
    expect(corpseOf(c, N, 'Aldenmar')).toMatchObject({ x: -50, y: 100, died_age: 20000 });
    c._mapCorpseNoteDied({ zone_id: 164, loc: null, died_at: new Date(N).toISOString() }, 'Aldenmar', N);   // no fresh Zeal loc at death: nothing to place
    expect(c._mapCorpse.q).toHaveLength(0);
  });
  it('"Summoning <Name>\'s corpse." puts the corpse where the caster stands; "Summoning your corpse." is the caster\'s own', async () => {
    const { c, net } = liveCore();
    say(c, 'Summoning Brackwyn\'s corpse.', N);
    say(c, 'Summoning your corpse.', N + 1000);
    c._mapCorpseFlush(N + 2000); await tick();
    expect(posts(net)[0].body.events.map(e => [e.kind, e.corpse, e.x, e.y])).toEqual([['summoned', 'Brackwyn', -50, 100], ['summoned', 'Aldenmar', -50, 100]]);
    expect(corpseOf(c, N + 2000, 'Brackwyn')).toMatchObject({ x: -50, y: 100, dragger: null });
  });
  it('"You regain some experience from resurrection." takes your own corpse off the Map, and a pull that raced it cannot bring it back', async () => {
    const { c, net } = liveCore();
    c._mapCorpseNoteDied({ zone_id: 164, loc: { x: 100, y: -50, z: 7 }, died_at: new Date(N - 60000).toISOString() }, 'Aldenmar', N - 30000);
    expect(corpseOf(c, N, 'Aldenmar')).toBeTruthy();
    say(c, 'You regain some experience from resurrection.', N);
    c._mapCorpseFlush(N); await tick();
    expect(posts(net)[0].body.events.map(e => e.kind)).toEqual(['died', 'gone']);
    expect(corpseOf(c, N, 'Aldenmar')).toBeUndefined();
    c._mapCorpseApplyBot('thedeep', { now: N, corpses: [{ corpse: 'Aldenmar', x: -50, y: 100, z: 7, died_at: N - 60000, updated_at: N - 60000 }] }, N + 1000);
    expect(corpseOf(c, N + 1000, 'Aldenmar')).toBeUndefined();
    c._mapCorpseNoteDied({ zone_id: 164, loc: { x: 5, y: 6, z: 0 }, died_at: new Date(N + 3600000).toISOString() }, 'Aldenmar', N + 3600000);
    expect(corpseOf(c, N + 3600000, 'Aldenmar')).toMatchObject({ x: 6, y: 5 });   // dying again puts it back
  });
  it('an old line (a backfill replays months of them) is ignored', () => {
    const { c } = liveCore();
    say(c, 'You begin to drag Brackwyn\'s corpse.', N, N - 10 * 60 * 1000);
    say(c, 'Summoning your corpse.', N, N - 10 * 60 * 1000);
    expect(c._mapCorpse.drags.size).toBe(0);
    expect(c._mapCorpse.q).toHaveLength(0);
  });
});

describe('dragging: the dragger\'s own machine says where the corpse is', () => {
  it('start, move (at most every 5 s, and only when the dragger moved), stop: the corpse follows the dragger and the link name shows while dragging', async () => {
    const { c, net } = liveCore();
    say(c, 'You begin to drag Brackwyn\'s corpse.', N);
    expect(corpseOf(c, N, 'Brackwyn')).toMatchObject({ x: -50, y: 100, dragger: 'Aldenmar' });
    moveTo(c, 120, -50); c._mapCorpseTickDrag('Aldenmar', N + 2000);       // 2 s later: too soon
    moveTo(c, 120, -50); c._mapCorpseTickDrag('Aldenmar', N + 5000);       // moved 20 units, 5 s since the start: a move
    c._mapCorpseTickDrag('Aldenmar', N + 11000);                           // standing still: nothing
    moveTo(c, 120, -90); c._mapCorpseTickDrag('Aldenmar', N + 12000);      // moved but only 1 s since the last: nothing
    moveTo(c, 120, -90); c._mapCorpseTickDrag('Aldenmar', N + 16000);      // a move
    expect(corpseOf(c, N + 16000, 'Brackwyn')).toMatchObject({ x: -90, y: 120, dragger: 'Aldenmar' });
    say(c, 'You stop dragging the corpse.', N + 20000);
    c._mapCorpseFlush(N + 20000); await tick();
    const ev = posts(net)[0].body.events;
    expect(ev.map(e => [e.kind, e.corpse, e.x, e.y, e.dragger])).toEqual([
      ['drag_start', 'Brackwyn', -50, 100, 'Aldenmar'],
      ['drag_move', 'Brackwyn', -50, 120, 'Aldenmar'],
      ['drag_move', 'Brackwyn', -90, 120, 'Aldenmar'],
      ['drag_stop', 'Brackwyn', -90, 120, 'Aldenmar'],
    ]);
    expect(corpseOf(c, N + 20000, 'Brackwyn')).toMatchObject({ x: -90, y: 120, dragger: null });   // left where it was last moved
    c._mapCorpseTickDrag('Aldenmar', N + 40000);
    expect(c._mapCorpse.q).toHaveLength(0);                                                          // nothing more once it stopped
  });
  it('a start with no fresh position waits for one; the first frame that has it sends drag_start', () => {
    const { c } = liveCore();
    c._zealState.Aldenmar.updatedAt = 0;
    say(c, 'You begin to drag Brackwyn\'s corpse.', N);
    expect(c._mapCorpse.q).toHaveLength(0);
    c._zealState.Aldenmar.updatedAt = 1e18;
    c._mapCorpseTickDrag('Aldenmar', N + 1000);
    expect(c._mapCorpse.q.map(q => q.ev.kind)).toEqual(['drag_start']);
  });
  it('"the corpses" ends every drag; "the corpse" ends one (the oldest, the server does not say which)', () => {
    const { c } = liveCore();
    say(c, 'You begin to drag Brackwyn\'s corpse.', N);
    say(c, 'You begin to drag Corvale\'s corpse.', N + 1000);
    say(c, 'You stop dragging the corpse.', N + 2000);
    expect([...c._mapCorpse.drags.values()].map(d => d.owner)).toEqual(['Corvale']);
    say(c, 'You begin to drag Zarrin\'s corpse.', N + 3000);
    say(c, 'You stop dragging the corpses.', N + 4000);
    expect(c._mapCorpse.drags.size).toBe(0);
    expect(c._mapCorpse.q.filter(q => q.ev.kind === 'drag_stop').map(q => q.ev.corpse)).toEqual(['Brackwyn', 'Corvale', 'Zarrin']);
  });
  it('zoning ends a drag without a word from the server: drag_stop where it was left, in the zone it was left in', () => {
    const { c } = liveCore();
    say(c, 'You begin to drag Brackwyn\'s corpse.', N);
    c._zealState.Aldenmar.zone = 202;                         // poknowledge: not a zone this test knows, but a different one
    c._mapCorpseTickDrag('Aldenmar', N + 6000);
    expect(c._mapCorpse.drags.size).toBe(0);
    const stop = c._mapCorpse.q.find(q => q.ev.kind === 'drag_stop');
    expect(stop).toMatchObject({ zone: 'thedeep', ev: { corpse: 'Brackwyn', x: -50, y: 100 } });
  });
  it('a dragger nobody has heard from for two minutes is shown as not dragging (their Mimic closed mid-drag)', () => {
    const { c } = liveCore();
    say(c, 'You begin to drag Brackwyn\'s corpse.', N);
    expect(corpseOf(c, N + 100000, 'Brackwyn').dragger).toBe('Aldenmar');
    expect(corpseOf(c, N + 130000, 'Brackwyn')).toMatchObject({ dragger: null, x: -50 });
  });
  it('a plain look at the corpse moves it but leaves who is dragging it alone', () => {
    const { c } = liveCore();
    say(c, 'You begin to drag Brackwyn\'s corpse.', N);
    c._mapCorpseNoteTarget('thedeep', 'Aldenmar', { target_name: 'Brackwyn\'s corpse', target_type: 3, target_loc: { x: 300, y: -300, z: 0 } }, N + 10000);
    expect(corpseOf(c, N + 10000, 'Brackwyn')).toMatchObject({ x: -300, y: 300, dragger: 'Aldenmar' });
  });
});

describe('the bot: batches, an older bot, the guild\'s corpses', () => {
  it('at most 20 events a POST, oldest batch first', async () => {
    const { c, net } = liveCore();
    for (let i = 0; i < 45; i++) c._mapCorpseEvent('thedeep', 'Aldenmar', { kind: 'seen', corpse: 'Brackwyn', x: i, y: i, z: 0, at: N + i }, N + i);
    c._mapCorpseFlush(N + 100); await tick();
    c._mapCorpseFlush(N + 100); await tick();
    c._mapCorpseFlush(N + 100); await tick();
    expect(posts(net).map(p => p.body.events.length)).toEqual([20, 20, 5]);
  });
  it('a 404 (an older bot) backs the POSTs off for ten minutes, quietly: nothing more is sent, and the Map still shows what this machine knows', async () => {
    const { c, net } = liveCore(() => ({ status: 404, body: 'nope' }));
    say(c, 'You begin to drag Brackwyn\'s corpse.', N);
    c._mapCorpseFlush(N); await tick();
    expect(posts(net)).toHaveLength(1);
    expect(c._mapCorpse.backoffUntil).toBe(N + 10 * 60 * 1000);
    say(c, 'You stop dragging the corpse.', N + 60000);
    expect(c._mapCorpse.q).toHaveLength(0);                    // not even queued while backed off
    expect(c._mapCorpseFlush(N + 61000)).toBe(false);
    expect(corpseOf(c, N + 61000, 'Brackwyn')).toMatchObject({ dragger: null });                          // still kept here
    c._mapCorpseEvent('thedeep', 'Aldenmar', { kind: 'seen', corpse: 'Corvale', x: 1, y: 2, z: 0, at: N + 11 * 60 * 1000 }, N + 11 * 60 * 1000);
    expect(c._mapCorpse.q).toHaveLength(1);                    // ten minutes on, it asks again
  });
  it('local mode (no token), a dry run and exclude_from_stats send nothing but still draw the corpse', () => {
    const local = liveCore(null, { botUrl: LIVE.botUrl, token: '' });
    local.c._mapCorpseEvent('thedeep', 'Aldenmar', { kind: 'seen', corpse: 'Brackwyn', x: 1, y: 2, z: 0, at: N }, N);
    expect(local.c._mapCorpse.q).toHaveLength(0);
    expect(local.c._mapCorpseList('thedeep', N)).toHaveLength(1);
    const dry = liveCore(null, { ...LIVE, dryRun: true });
    dry.c._mapCorpseEvent('thedeep', 'Aldenmar', { kind: 'seen', corpse: 'Brackwyn', x: 1, y: 2, z: 0, at: N }, N);
    expect(dry.c._mapCorpse.q).toHaveLength(0);
    const ex = liveCore();
    ex.c.__excluded.add('aldenmar');
    ex.c._mapCorpseEvent('thedeep', 'Aldenmar', { kind: 'seen', corpse: 'Brackwyn', x: 1, y: 2, z: 0, at: N }, N);
    expect(ex.c._mapCorpse.q).toHaveLength(0);
  });
  it('the pull\'s `corpses` come back in the state payload with ages on this machine\'s clock; the newest word per owner wins', () => {
    const { c } = liveCore();
    c._mapCorpseApplyBot('thedeep', { now: N, corpses: [
      { corpse: 'Brackwyn', inst: null, x: -300, y: 40, z: 2, died_at: N - 720000, updated_at: N - 5000, dragger: 'Corvale', by: 'Corvale' },
      { corpse: 'Zarrin\'s corpse', x: 9, y: 8, z: 0, died_at: new Date(N - 60000).toISOString(), updated_at: new Date(N - 60000).toISOString(), dragger: null },
      { corpse: 'Bad', x: 'nope', y: 1 },
    ] }, N + 3000);
    expect(c._mapStatePayload('', N + 3000).corpses.map(k => k.name)).toEqual(['Brackwyn', 'Zarrin']);
    expect(corpseOf(c, N + 3000, 'Brackwyn')).toMatchObject({ x: -300, y: 40, z: 2, age: 5000, died_age: 720000, dragger: 'Corvale', by: 'Corvale' });
    expect(corpseOf(c, N + 13000, 'Brackwyn')).toMatchObject({ age: 15000, died_age: 730000 });          // they age on this machine's clock
    c._mapCorpseNoteTarget('thedeep', 'Aldenmar', { target_name: 'Brackwyn\'s corpse', target_type: 3, target_loc: { x: 12, y: 34, z: 0 } }, N + 4000);
    expect(corpseOf(c, N + 4000, 'Brackwyn')).toMatchObject({ x: 34, y: 12, dragger: 'Corvale', died_age: 721000, by: 'Aldenmar' });   // newer spot; dragger and death kept
  });
  it('an answer with no `corpses` (an older bot) changes nothing', () => {
    const { c } = liveCore();
    c._mapCorpseNoteTarget('thedeep', 'Aldenmar', { target_name: 'Brackwyn\'s corpse', target_type: 3, target_loc: { x: 1, y: 2, z: 0 } }, N);
    c._mapCorpseApplyBot('thedeep', { now: N, events: [] }, N);
    expect(c._mapStatePayload('', N).corpses).toHaveLength(1);
  });
  it('another copy of the zone is ignored: inst set on both sides and different; null on either side is taken', () => {
    const { c } = liveCore();
    c._mapCopy.polledAt = N + 1e9;
    c._mapCopy.files.set('dbg', { cur: { zone: 'thedeep', token: 'T1', at: N, host: 'h', port: 1 } });
    c._mapCorpseApplyBot('thedeep', { now: N, corpses: [
      { corpse: 'Brackwyn', inst: 'T2', x: 1, y: 1, z: 0, updated_at: N },
      { corpse: 'Corvale', inst: 'T1', x: 2, y: 2, z: 0, updated_at: N },
      { corpse: 'Zarrin', inst: null, x: 3, y: 3, z: 0, updated_at: N },
    ] }, N);
    expect(c._mapStatePayload('', N).corpses.map(k => k.name).sort()).toEqual(['Corvale', 'Zarrin']);
  });
  it('our own events carry the copy we are in (`inst`) in the POST body', async () => {
    const { c, net } = liveCore();
    c._mapCopy.polledAt = N + 1e9;
    c._mapCopy.files.set('dbg', { cur: { zone: 'thedeep', token: 'T1', at: N, host: 'h', port: 1 } });
    c._mapCorpseNoteTarget('thedeep', 'Aldenmar', { target_name: 'Nyssara\'s corpse', target_type: 3, target_loc: { x: 5, y: 5, z: 0 } }, N);
    c._mapCorpseFlush(N); await tick();
    expect(posts(net)[0].body.inst).toBe('T1');
  });
  it('is wired: the pull applies it, the payload carries it, the death and the log tail call it', () => {
    const js = stripJs(AGENT);
    expect(js).toMatch(/if \(j\) _mapCorpseApplyBot\(zone, j, Date\.now\(\)\);/);
    expect(js).toMatch(/try \{ out\.corpses = _mapCorpseList\(zone, now\); \}/);
    expect(js).toMatch(/_mapCorpseNoteDied\(p, p\.character, now\)/);
    expect(js).toMatch(/_mapCorpseNoteLine\(line, b\.character, ts \? ts\.getTime\(\) : null, Date\.now\(\)\)/);
    expect(js).toMatch(/_mapCorpseNoteTarget\(zone, character, next, now\)/);
    expect(js).toMatch(/\}, '\/map-corpse'\);/);
  });
});

// ───────────────────────────── the Map overlay ─────────────────────────────
const helpers = sliceBlock(MAP_HTML, '// ── pure helpers', '// ── end pure helpers ──');
// eslint-disable-next-line no-new-func
const H_ = new Function(helpers + '\nreturn { corpseWords, corpseLine, totMember };')();
const T0 = Date.UTC(2026, 9, 17, 20, 0, 0);
const CORPSE = (o) => Object.assign({ name: 'Aldenmar', x: 60, y: 200, z: 0, age: 30000, died_age: 720000, dragger: null, by: 'Aldenmar' }, o);

describe('map.html helpers: the corpse words', () => {
  it('"☠ Aldenmar\'s corpse · died 12m ago · being dragged by Brackwyn", with the poll\'s age carried forward', () => {
    const w = H_.corpseWords(CORPSE({ dragger: 'Brackwyn' }), { now: T0 }, T0);
    expect(w).toEqual({ head: '☠ Aldenmar\'s corpse', when: 'died 12m ago', ago: '12m', dragger: 'Brackwyn' });
    expect(H_.corpseLine(w)).toBe('☠ Aldenmar\'s corpse · died 12m ago · being dragged by Brackwyn');
    expect(H_.corpseWords(CORPSE(), { now: T0 }, T0 + 60000).when).toBe('died 13m ago');
  });
  it('no dragger: no "being dragged"; a corpse nobody saw die says "seen"', () => {
    expect(H_.corpseLine(H_.corpseWords(CORPSE(), { now: T0 }, T0))).toBe('☠ Aldenmar\'s corpse · died 12m ago');
    expect(H_.corpseLine(H_.corpseWords(CORPSE({ died_age: null, age: 180000 }), { now: T0 }, T0))).toBe('☠ Aldenmar\'s corpse · seen 3m ago');
  });
});

async function boot(payloadExtra, savedCfg) {
  const script = MAP_HTML.slice(MAP_HTML.indexOf('<script>') + 8, MAP_HTML.lastIndexOf('</script>'));
  const all = {};
  const mkEl = (tag) => {
    const e = { tag, children: [], style: {}, dataset: {}, attrs: {}, listeners: {}, hidden: false, textContent: '', innerHTML: '', title: '',
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
  const payload = Object.assign({
    zone: 'thedeep', long_name: 'The Deep', version: 'thedeep@v', status: 'ok', now: Date.now(), local_only: false,
    points: POINTS, map: ZONE_BODY.map, self: { x: 90, y: 190, z: 0, heading: 64, name: 'Zarrin' },
    group: [{ name: 'Brackwyn', class: 'Cleric', x: 400, y: -100, z: 0, heading: 0 }], raid: [], target: null, seen: [], unassigned: [],
    timers: [], watched: {}, corpses: [],
  }, payloadExtra);
  const win = { addEventListener() {}, devicePixelRatio: 1, outerWidth: 1000, outerHeight: 500, mimic: undefined };
  const ls = { getItem: (k) => (savedCfg && k === 'wp-map-cfg' ? JSON.stringify(savedCfg) : null), setItem() {} };
  // eslint-disable-next-line no-new-func
  const S = new Function('window', 'document', 'location', 'fetch', 'localStorage', 'ResizeObserver', 'setInterval', 'clearInterval',
    script + '\nreturn S;')(win, doc, { search: '' }, () => Promise.resolve({ json: () => Promise.resolve(payload) }), ls, undefined, () => 1, () => {});
  await tick();
  return { S, all };
}
const cornerHit = (all, name) => all.hits.children.find(b => b.attrs['data-cname'] === name.toLowerCase());

describe('map.html: corpses on the Map', () => {
  it('the side list has a "☠ Corpses (N)" section, newest first; a row is an armed click that centres on the corpse', async () => {
    const { S, all } = await boot({ corpses: [CORPSE({ name: 'Aldenmar', dragger: 'Brackwyn', age: 5000 }), CORPSE({ name: 'Corvale', x: -700, y: 40, died_age: null, age: 180000 })] });
    const kids = all.lists.children;
    const at = kids.findIndex(c => /sec/.test(c.className) && c.textContent === '☠ Corpses (2)');
    expect(at).toBeGreaterThan(-1);
    const rows = [kids[at + 1], kids[at + 2]];
    expect(rows.map(r => r.children.map(k => k.textContent))).toEqual([['Aldenmar', '12m', 'being dragged by Brackwyn'], ['Corvale', '3m', 'seen']]);
    expect(rows[0].className).toMatch(/\bcorpse drag\b/); expect(rows[1].className).not.toMatch(/\bdrag\b/);
    expect(rows[0].attrs['data-wp-interact']).toBe('');
    expect(rows[0].title).toBe('☠ Aldenmar\'s corpse · died 12m ago · being dragged by Brackwyn');
    rows[1].listeners.click.forEach(f => f());
    expect(S.view.cx).toBe(700);                                     // x -700: screen x = -x
  });
  it('no corpses, no section', async () => {
    const { all } = await boot({ corpses: [] });
    expect(all.lists.children.some(c => /Corpses/.test(c.textContent))).toBe(false);
  });
  it('each drawn corpse gets an armed hover button; hovering shows the card, and the dragger is a link that centres on their dot', async () => {
    const { S, all } = await boot({ corpses: [CORPSE({ dragger: 'Brackwyn' })] });
    const btn = cornerHit(all, 'Aldenmar');
    expect(btn).toBeTruthy();
    expect(btn.attrs['data-wp-interact']).toBe('');
    expect(btn.hidden).toBe(false);
    all.hits.listeners.mouseover.forEach(f => f({ target: btn }));
    const line = all.ccard.children[0];
    expect(line.textContent).toBe('☠ Aldenmar\'s corpse · died 12m ago · being dragged by ');
    const link = line.children[0];
    expect(link.textContent).toBe('Brackwyn');
    expect(link.className).toBe('lnk');
    expect(link.attrs['data-wp-interact']).toBe('');
    expect(all.ccard.style.display).toBe('block');
    link.listeners.click.forEach(f => f());
    expect(S.view.cx).toBe(-400);                                    // Brackwyn at x 400
    expect(all.ccard.style.display).toBe('none');
  });
  it('a dragger the Map cannot place (not you, group or raid) is plain text, not a link', async () => {
    const { all } = await boot({ corpses: [CORPSE({ dragger: 'Nyssara' })] });
    all.hits.listeners.mouseover.forEach(f => f({ target: cornerHit(all, 'Aldenmar') }));
    const line = all.ccard.children[0];
    expect(line.children[0].className).toBe('');
    expect(line.children[0].textContent).toBe('Nyssara');
    expect(line.children[0].tag).toBe('span');
  });
  it('the corpses switch hides the section and the buttons (⚙ → Guild corpses)', async () => {
    const on = await boot({ corpses: [CORPSE()] });
    expect(cornerHit(on.all, 'Aldenmar').hidden).toBe(false);
    const off = await boot({ corpses: [CORPSE()] }, { show: { corpses: false } });
    expect(off.S.cfg.show.corpses).toBe(false);
    expect(cornerHit(off.all, 'Aldenmar')).toBeUndefined();                     // never drawn, so never given a button
    expect(off.all.lists.children.some(c => /Corpses/.test(c.textContent))).toBe(false);
  });
  it('source: a dragged corpse is amber and ringed, the card hides 350 ms after leaving the marker, the section skips the pop-out', () => {
    const js = stripJs(MAP_HTML);
    expect(js).toMatch(/var cCol = c\.dragger \? CORPSE_DRAG_COL : CO\.corpse;/);
    expect(js).toMatch(/if \(c\.dragger\) \{ ctx\.beginPath\(\); ctx\.setLineDash\(\[3, 3\]\)/);
    expect(js).toMatch(/b\.type = 'button'; b\.setAttribute\('data-wp-interact', ''\); b\.setAttribute\('data-cname', k\);/);
    expect(js).toMatch(/setTimeout\(function \(\) \{ ccard\.style\.display = 'none'; \}, 350\)/);
    expect(js).toMatch(/var corpseList = !PART_TIMERS && P && S\.cfg\.show\.corpses \? \(P\.corpses \|\| \[\]\) : \[\];/);
    expect(MAP_HTML).toMatch(/<div id="ccard" data-wp-interact><\/div>/);
    const css = MAP_HTML.slice(MAP_HTML.indexOf('<style>'), MAP_HTML.indexOf('</style>'));
    expect(css).toMatch(/#ccard\{pointer-events:auto\}/);
  });
});
