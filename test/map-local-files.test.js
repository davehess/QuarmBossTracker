// The Map overlay reads the PLAYER'S OWN map files (what Zeal draws) for walls and room names, and falls back to
// our wall slices. The guild lead, 2026-10-12: "A for outdoor walls sounds fine", "please display names of the rooms
// and named bosses in the map".
//
// Agent half: the "Local map files" block of packages/wolfpack-logsync/index.js, source-sliced and run as shipped
// (the parser, the map-file -> server frame transform, map_files then maps then null, the version-gated
// /api/map-state payload, and the guarantee that none of it can leave the machine). Overlay half: apps/mimic/map.html's
// pure helpers, plus its script booted against a stub page with a recording canvas (walls, labels, boss names, the
// Labels toggle, Walls Auto / Ours only).
//
// Every map line and name here is invented: the real map files are third-party art that we never copy into this
// public repo (see test/zone-map-brewall.test.js).
//
// Mutation-checked 2026-10-12, each turning at least one test red: the x or y negation dropped from
// _mapFileToServer; x/y swapped; the lines cap removed; the maps/ fallback removed; the mtime/size signature
// ignored; the have_local gate removed; local_map added to a sync POST; the overlay drawing ours while local lines
// exist; the Ours-only switch ignored; the label overlap check removed; the boss-name zoom gate put back; the
// Labels toggle ignored.
//
// Run: npx vitest run test/map-local-files.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { EventEmitter } from 'node:events';
import { readSource, sliceBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';
import { parseBrewallMaps } from '../web/lib/zoneMap/brewall.ts';

const AGENT = readSource(AGENT_INDEX);
const CORE = sliceBlock(AGENT, '// ── Spawn map core (Mimic 2.9', '// ── end Spawn map core ──');
const LOCAL = sliceBlock(AGENT, '// ── Local map files', '// ── end Local map files ──');
const MAP_HTML = readSource(path.join(ROOT, 'apps', 'mimic', 'map.html'));

const EXPORTS = ['_mapFileToServer', '_mapParseLocalFiles', '_mapLocalFor', '_mapStatePayload', '_zealState', '_mapEnsureZone',
  '_mapPaths', '_mapApplyMark', '_mapSyncFlush', '_mapSyncStop', '_mapSaveNow', '_mapZoneDoc', '_mapLocalEvent',
  'MAP_LOCAL_MAX_LINES', 'MAP_LOCAL_MAX_LABELS', 'MAP_LOCAL_MAX_BYTES', 'MAP_LOCAL_RECHECK_MS'];

const T0 = Date.UTC(2026, 9, 12, 20, 0, 0);
let dir, eqDir;
const eqDirs = [];
const cores = [];

function loadCore({ opts, net }) {
  const prelude = `
    const STATS_FILE = path.join(__tmp, 'logsync.stats.json');
    let _uploadOpts = __opts;
    function _localOnly() { return !!(_uploadOpts && !_uploadOpts.token); }
    function _controlStandDown() { return { down: false }; }
    const AGENT_VERSION = 'test';
    const _zealState = {};
    let _lastRaidPipe = null;
    function _zoneName(id) { return id === 164 ? 'The Deep' : null; }
    function _eqSetupDirs() { return __eq; }
  `;
  // eslint-disable-next-line no-new-func
  const f = new Function('fs', 'path', 'http', 'https', 'zlib', '__dirname', '__tmp', '__opts', '__eq',
    prelude + '\n' + CORE + `\nreturn { ${EXPORTS.join(', ')} };`);
  const c = f(fs, path, net.http, net.https, zlib, dir, dir, opts, eqDirs);
  c._mapPaths.cache = path.join(dir, 'zone-spawns-cache');
  c._mapPaths.timers = path.join(dir, 'map_timers.json');
  c._mapPaths.brewall = null;   // no Brewall download unless a test asks for one
  cores.push(c);
  return c;
}
function fakeNet() {
  const calls = [];
  const mod = {
    request(o, cb) {
      calls.push(o);
      const req = {
        on() { return req; }, destroy() {},
        end(body) {
          o.__body = body ? Buffer.from(body).toString('utf8') : null;
          setImmediate(() => {
            const res = new EventEmitter(); res.statusCode = 200; res.headers = {};
            cb(res); res.emit('data', Buffer.from('{"ok":true,"events":[]}')); res.emit('end');
          });
        },
      };
      return req;
    },
  };
  return { http: mod, https: mod, calls };
}
const tick = () => new Promise(r => setImmediate(() => setImmediate(r)));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maplocal-'));
  eqDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maplocal-eq-'));
  eqDirs.length = 0; eqDirs.push(eqDir);
});
afterEach(() => {
  for (const k of cores.splice(0)) { try { k._mapSaveNow(); k._mapSyncStop(); } catch { /* nothing to flush */ } }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(eqDir, { recursive: true, force: true });
});

function put(sub, name, text) {
  const d = path.join(eqDir, sub);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, name), text);
  return path.join(d, name);
}
// An invented two-room zone: three walls, and two room names.
const WALLS = ['L 10, 20, 0, 110, 20, 0, 0, 0, 0', 'L 110, 20, 0, 110, 120, 0, 255, 0, 0', 'L -50, -60, 300, -50, -160, 300, 0, 0, 0'].join('\n');
const ROOMS = ['P 10, 20, 0, 0, 0, 0, 3, Echo_Hall', 'P -50, -60, 300, 0, 0, 0, 3, Upper_Gallery'].join('\n');

function seedZone(points = []) {
  fs.mkdirSync(path.join(dir, 'zone-spawns-cache'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'zone-spawns-cache', 'thedeep.json'), JSON.stringify({
    etag: '"v1"', fetched_at: Date.now(), body: { zone: 'thedeep', long_name: 'The Deep', generated_at: '2026-10-12T00:00:00Z', points, map: null },
  }));
}
function playingCore(opts = { botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: '' }, points = []) {
  seedZone(points);
  const net = fakeNet();
  const c = loadCore({ opts, net });
  c._zealState.Aldenmar = { zone: 164, updatedAt: 1e18, loc: { x: 0, y: 0, z: 0 } };
  return { c, net };
}

describe('the parser (Zeal\'s L and P lines)', () => {
  const { c } = (() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maplocal-')); const k = loadCore({ opts: { botUrl: '', token: '' }, net: fakeNet() }); fs.rmSync(dir, { recursive: true, force: true }); return { c: k }; })();

  it('reads L lines (with their colour) and P lines (underscores are spaces, a comma stays in the label)', () => {
    const r = c._mapParseLocalFiles([[
      'L 10.0, 20.0, 5.4, -30.0, 40.0, 6.0, 255, 0, 128',
      'P 100.4, -200.6, 7.0, 255, 0, 0, 3, to_The_Test_Zone',
      'P 0, 0, 0, 10, 20, 30, 2, Zone_Line,_North',
    ].join('\r\n')]);
    expect(r.lines).toEqual([[-10, -20, 5, 30, -40, 6, '#ff0080']]);
    expect(r.labels).toEqual([[-100, 201, 7, 'to The Test Zone', '#ff0000'], [0, 0, 0, 'Zone Line, North', '#0a141e']]);
  });
  it('ignores junk: short rows, non-numbers, blank labels, other letters, comments, a byte-order mark', () => {
    const r = c._mapParseLocalFiles(['﻿' + WALLS + '\nL 1, 2, 3\nL a, b, c, d, e, f, 0, 0, 0\nL 1, 2, 3, 4, 5, 6, , 0, 0\nP 1, 2, 3, 0, 0, 0, 3\nP 1, 2, 3, 0, 0, 0, 3, __\nP x, 2, 3, 0, 0, 0, 3, Name\nZ 1, 2\n; L 1, 2, 3, 4, 5, 6, 0, 0, 0\n\n   \n']);
    expect(r.lines).toHaveLength(3);
    expect(r.labels).toEqual([]);
  });
  it('clamps colours to 0-255 and treats a missing file list as nothing', () => {
    expect(c._mapParseLocalFiles(['L 1, 2, 3, 4, 5, 6, 300, -5, 12.6']).lines[0][6]).toBe('#ff000d');
    expect(c._mapParseLocalFiles([])).toEqual({ lines: [], labels: [] });
  });
  it('caps the lines and the labels', () => {
    const many = Array.from({ length: c.MAP_LOCAL_MAX_LINES + 50 }, (_, i) => `L ${i}, 0, 0, ${i + 1}, 0, 0, 0, 0, 0`).join('\n');
    expect(c._mapParseLocalFiles([many]).lines).toHaveLength(c.MAP_LOCAL_MAX_LINES);
    const names = Array.from({ length: c.MAP_LOCAL_MAX_LABELS + 20 }, (_, i) => `P ${i}, 0, 0, 0, 0, 0, 1, Room_${i}`).join('\n');
    expect(c._mapParseLocalFiles([names]).labels).toHaveLength(c.MAP_LOCAL_MAX_LABELS);
  });
});

describe('the frame: a map file stores the NEGATED world x and y; server = (-x, -y, z)', () => {
  // Derived from web/lib/zoneMap/brewall.ts (parseBrewallMaps), which checked it on 2026-10-05 against the EQEmu wall
  // lines of three zones. A spawn2 point at server (250, -80, 4) is the file spot (-250, 80, 4).
  const { c } = (() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maplocal-')); const k = loadCore({ opts: { botUrl: '', token: '' }, net: fakeNet() }); fs.rmSync(dir, { recursive: true, force: true }); return { c: k }; })();
  const SPAWN2 = { x: 250, y: -80, z: 4 };

  it('maps the known point both ways round: a wrong sign or an x/y swap fails here', () => {
    expect(c._mapFileToServer(-250, 80, 4)).toEqual(SPAWN2);
    expect(c._mapFileToServer(80, -250, 4)).not.toEqual(SPAWN2);    // not swapped
    expect(c._mapFileToServer(250, -80, 4)).not.toEqual(SPAWN2);    // not left as is
    const r = c._mapParseLocalFiles(['L -250, 80, 4, -240, 90, 4, 0, 0, 0\nP -250, 80, 4, 0, 0, 0, 3, Spawn_Spot']);
    expect(r.lines[0].slice(0, 3)).toEqual([SPAWN2.x, SPAWN2.y, SPAWN2.z]);
    expect(r.labels[0].slice(0, 3)).toEqual([SPAWN2.x, SPAWN2.y, SPAWN2.z]);
  });
  it('matches a real pair: a label in a real map pack vs the same mob\'s eqemu_spawn2 point (checked 2026-10-12)', () => {
    // Plane of Tranquility: the pack has the mob's label at (1406, 489, -910) and eqemu_spawn2 has its point at
    // (-1405, -488, -906.2) - both axes negated, no swap. (The label's z is where the sign stands, not the mob's feet.)
    const r = c._mapParseLocalFiles(['P 1406.0000, 489.0000, -909.9990, 0, 0, 240, 2, Some_Named_(M)']);
    const [x, y, z] = r.labels[0];
    expect(Math.abs(x - -1405)).toBeLessThanOrEqual(2);
    expect(Math.abs(y - -488)).toBeLessThanOrEqual(2);
    expect(Math.abs(z - -906.2)).toBeLessThanOrEqual(4);
    expect(r.labels[0][3]).toBe('Some Named (M)');
  });
  it('reads the shapes the real packs use: 4 decimals, 1-2 spaces after commas, odd label characters, empty extras', () => {
    const r = c._mapParseLocalFiles([
      'L 10.0000,  20.0000, -5.0000,  30.0000,  40.0000, -5.0000,  0,  0,  0\r\nP 1.0000, 2.0000, 3.0000,  0, 0, 240,  2,  to_Zone/Gate(w/stone)\nP 1, 2, 3, 0, 0, 0, 2, Laurion\'s_Song',
      '',      // a 0-byte extra file
      '\n\n',
    ]);
    expect(r.lines).toEqual([[-10, -20, -5, -30, -40, -5, '#000000']]);
    expect(r.labels.map(l => l[3])).toEqual(['to Zone/Gate(w/stone)', "Laurion's Song"]);
    expect(r.labels[0][4]).toBe('#0000f0');
  });
  it('never yields -0, and rounds to whole units', () => {
    const p = c._mapFileToServer(0, 0.4, 0.2);
    expect(Object.is(p.x, 0)).toBe(true); expect(Object.is(p.y, 0)).toBe(true); expect(p.z).toBe(0);
    expect(c._mapFileToServer(-10.5, 3.6, 7.5)).toEqual({ x: 11, y: -4, z: 8 });
  });
  it('agrees with the website: the same text comes out in the same place as parseBrewallMaps', () => {
    const text = WALLS + '\n' + ROOMS + '\nL 0.5, -0.5, 1.5, 1000.7, -2000.2, -3.4, 12, 34, 56';
    const web = parseBrewallMaps([text]);
    const mine = c._mapParseLocalFiles([text]);
    expect(mine.lines.map(l => l.slice(0, 6))).toEqual(web.lines.map(l => l.slice(0, 6)));
    expect(mine.labels.map(l => l.slice(0, 4))).toEqual(web.labels);
  });
  it('the block names where the rule came from', () => {
    expect(LOCAL).toMatch(/web\/lib\/zoneMap\/brewall\.ts/);
  });
});

describe('Brewall maps from Zeal\'s repo: fetched once per zone, read first', () => {
  const EXP2 = EXPORTS.concat(['_mapBrewallEnsure', '_mapBrewallNet', 'MAP_BREWALL_BASE']);
  function brewallCore(answer) {
    seedZone([]);
    const prelude = `
      const STATS_FILE = path.join(__tmp, 'logsync.stats.json');
      let _uploadOpts = __opts;
      function _localOnly() { return !!(_uploadOpts && !_uploadOpts.token); }
      function _controlStandDown() { return { down: false }; }
      const AGENT_VERSION = 'test';
      const _zealState = {};
      let _lastRaidPipe = null;
      function _zoneName(id) { return id === 164 ? 'The Deep' : null; }
      function _eqSetupDirs() { return __eq; }
    `;
    const net = fakeNet();
    // eslint-disable-next-line no-new-func
    const f = new Function('fs', 'path', 'http', 'https', 'zlib', '__dirname', '__tmp', '__opts', '__eq',
      prelude + '\n' + CORE + `\nreturn { ${EXP2.join(', ')} };`);
    const c = f(fs, path, net.http, net.https, zlib, dir, dir, { botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: '' }, eqDirs);
    c._mapPaths.cache = path.join(dir, 'zone-spawns-cache');
    c._mapPaths.timers = path.join(dir, 'map_timers.json');
    c._mapPaths.brewall = path.join(dir, 'brewall-maps');
    cores.push(c);
    const asked = [];
    c._mapBrewallNet.get = (url) => { asked.push(url); return Promise.resolve(answer(url)); };
    return { c, asked, net };
  }
  const BW_WALLS = 'L 10, 20, 0, 110, 20, 0, 178, 102, 255\nL 110, 20, 0, 110, 120, 0, 150, 150, 150';
  const BW_LABELS = 'P 10, 20, 0, 0, 0, 0, 3, Stairs_Up';

  it('the first map-state for a zone fetches <zone>.txt and <zone>_1.txt from Zeal\'s repo; the next poll draws them, ahead of map_files', async () => {
    const { c, asked, net } = brewallCore(u => (u.endsWith('thedeep.txt') ? { status: 200, text: BW_WALLS } : { status: 200, text: BW_LABELS }));
    put('map_files', 'thedeep.txt', WALLS);
    c._zealState.Aldenmar = { zone: 164, updatedAt: 1e18, loc: { x: 0, y: 0, z: 0 } };
    expect(c._mapStatePayload('', T0, '').local_map.source).toBe('map_files');   // nothing downloaded yet
    await tick();
    expect(asked).toEqual([c.MAP_BREWALL_BASE + 'thedeep.txt', c.MAP_BREWALL_BASE + 'thedeep_1.txt']);
    expect(c.MAP_BREWALL_BASE).toMatch(/^https:\/\/raw\.githubusercontent\.com\/CoastalRedwood\/Zeal\/main\/Zeal\/zone_map_src\/map_files\/$/);
    const p = c._mapStatePayload('', T0 + 6000, '');
    expect(p.local_map.source).toBe('brewall');
    expect(p.local_map.lines.map(l => l[6])).toEqual(['#b266ff', '#969696']);
    expect(p.local_map.labels.map(l => l[3])).toEqual(['Stairs Up']);
    c._mapStatePayload('', T0 + 12000, '');
    expect(asked).toHaveLength(2);                                            // on disk now: never fetched again
    expect(net.calls).toHaveLength(0);                                        // and nothing went to our server
  });
  it('a 404 (Zeal has no map for the zone) is remembered for a week; a network failure retries after 10 minutes, keeping nothing half-done', async () => {
    let mode = 404;
    const { c, asked } = brewallCore(() => (mode === 404 ? { status: 404 } : { status: 0 }));
    c._mapBrewallEnsure('thedeep', T0);
    await tick();
    expect(fs.existsSync(path.join(dir, 'brewall-maps', 'thedeep.none'))).toBe(true);
    c._mapBrewallEnsure('thedeep', T0 + 60000);
    expect(asked).toHaveLength(2);
    mode = 0;
    c._mapBrewallEnsure('otherzone', T0);
    await tick();
    expect(asked).toHaveLength(4);
    expect(fs.existsSync(path.join(dir, 'brewall-maps', 'otherzone.txt'))).toBe(false);
    c._mapBrewallEnsure('otherzone', Date.now() + 60000);
    expect(asked).toHaveLength(4);                                            // inside the retry wait
    c._mapBrewallEnsure('otherzone', Date.now() + 11 * 60000);
    await tick();
    expect(asked).toHaveLength(6);
  });
  it('refuses a zone name that is not a plain short name, and does nothing when switched off', () => {
    const { c, asked } = brewallCore(() => ({ status: 200, text: BW_WALLS }));
    c._mapBrewallEnsure('../etc', T0);
    c._mapBrewallEnsure('thedeep/x', T0);
    c._mapPaths.brewall = null;
    c._mapBrewallEnsure('thedeep', T0);
    expect(asked).toHaveLength(0);
  });
  it('the download block only GETs from that address and sends nothing about the player', () => {
    const block = stripJs(sliceBlock(AGENT, '// ── Brewall maps', '// ── end Brewall maps ──'));
    expect(block).not.toMatch(/_uploadOpts|token|Authorization|_zealState|character|botUrl|method:\s*'POST'|\.write\(/);
    expect(block.match(/https\.\w+\(/g)).toEqual(['https.get(']);
  });
});

describe('finding the files: map_files, then maps, then nothing', () => {
  it('reads <EQ>/map_files/<zone>.txt plus its _1.._10 extras (lines from one, labels from another)', () => {
    const { c } = playingCore();
    put('map_files', 'thedeep.txt', WALLS);
    put('map_files', 'thedeep_1.txt', ROOMS);
    put('map_files', 'thedeep_11.txt', 'P 1, 1, 1, 0, 0, 0, 3, Too_Far');   // Zeal stops at _10
    put('map_files', 'othermap.txt', 'L 1, 1, 1, 2, 2, 2, 0, 0, 0');
    const m = c._mapLocalFor('thedeep', T0);
    expect(m.source).toBe('map_files');
    expect(m.lines).toHaveLength(3);
    expect(m.labels.map(l => l[3])).toEqual(['Echo Hall', 'Upper Gallery']);
  });
  it('falls back to <EQ>/maps/ (the classic client, extras _1.._3) when map_files has nothing', () => {
    const { c } = playingCore();
    put('maps', 'thedeep.txt', WALLS);
    put('maps', 'thedeep_2.txt', ROOMS);
    const m = c._mapLocalFor('thedeep', T0);
    expect(m.source).toBe('maps');
    expect(m.lines).toHaveLength(3);
    expect(m.labels).toHaveLength(2);
  });
  it('map_files wins over maps; labels alone do not beat a source that has walls', () => {
    const { c } = playingCore();
    put('map_files', 'thedeep.txt', WALLS);
    put('maps', 'thedeep.txt', 'L 1, 1, 1, 2, 2, 2, 0, 0, 0');
    expect(c._mapLocalFor('thedeep', T0).source).toBe('map_files');
    fs.rmSync(path.join(eqDir, 'map_files'), { recursive: true });
    put('map_files', 'thedeep_1.txt', ROOMS);   // labels only
    c._mapLocalFor('thedeep', T0 + 6000);
    expect(c._mapLocalFor('thedeep', T0 + 12000).source).toBe('maps');
  });
  it('is null with no files, no EQ folder, an unreadable zone name or a file with nothing in it', () => {
    const { c } = playingCore();
    expect(c._mapLocalFor('thedeep', T0)).toBeNull();
    put('map_files', 'thedeep.txt', 'just some words\n');
    expect(c._mapLocalFor('thedeep', T0 + 6000)).toBeNull();
    eqDirs.length = 0;
    expect(c._mapLocalFor('lavastorm', T0)).toBeNull();
    expect(c._mapLocalFor('../etc', T0)).toBeNull();
    expect(c._mapLocalFor(null, T0)).toBeNull();
  });
  it('uses every EQ folder the agent knows (Mimic may know several)', () => {
    const { c } = playingCore();
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'maplocal-eq2-'));
    try {
      fs.mkdirSync(path.join(other, 'map_files'));
      fs.writeFileSync(path.join(other, 'map_files', 'thedeep.txt'), WALLS);
      eqDirs.push(other);
      expect(c._mapLocalFor('thedeep', T0).lines).toHaveLength(3);
    } finally { fs.rmSync(other, { recursive: true, force: true }); }
  });
  it('skips a file bigger than the size cap, and never writes into the EQ folder', () => {
    const { c } = playingCore();
    const big = put('map_files', 'thedeep.txt', 'L 1, 1, 1, 2, 2, 2, 0, 0, 0\n' + ' '.repeat(c.MAP_LOCAL_MAX_BYTES));
    put('map_files', 'thedeep_1.txt', ROOMS);
    const before = fs.readdirSync(path.join(eqDir, 'map_files')).map(n => [n, fs.statSync(path.join(eqDir, 'map_files', n)).mtimeMs]);
    const m = c._mapLocalFor('thedeep', T0);
    expect(fs.statSync(big).size).toBeGreaterThan(c.MAP_LOCAL_MAX_BYTES);
    expect(m.lines).toEqual([]);                  // the oversized file was skipped...
    expect(m.labels).toHaveLength(2);             // ...the small one was not
    expect(fs.readdirSync(eqDir).sort()).toEqual(['map_files']);
    expect(fs.readdirSync(path.join(eqDir, 'map_files')).map(n => [n, fs.statSync(path.join(eqDir, 'map_files', n)).mtimeMs])).toEqual(before);
  });
  it('caches per zone, re-reads when a file changes, and re-checks at most every few seconds', () => {
    const { c } = playingCore();
    const f = put('map_files', 'thedeep.txt', WALLS);
    const first = c._mapLocalFor('thedeep', T0);
    expect(c._mapLocalFor('thedeep', T0 + 1000)).toBe(first);                 // same object: nothing re-read
    fs.writeFileSync(f, WALLS + '\nL 1, 1, 1, 9, 9, 9, 0, 0, 0');
    fs.utimesSync(f, new Date(T0 + 60000), new Date(T0 + 60000));
    expect(c._mapLocalFor('thedeep', T0 + 2000)).toBe(first);                 // inside the re-check window: still the old one
    const next = c._mapLocalFor('thedeep', T0 + c.MAP_LOCAL_RECHECK_MS + 3000);
    expect(next).not.toBe(first);
    expect(next.lines).toHaveLength(4);
    expect(next.version).not.toBe(first.version);
    expect(c._mapLocalFor('thedeep', T0 + 20000)).toBe(next);                 // unchanged files: the same parse is kept
  });
});

describe('/api/map-state carries local_map only when its version changed', () => {
  it('sends it once; the same local version back gets null; any other version gets it again; independent of `have`', () => {
    const { c } = playingCore();
    put('map_files', 'thedeep.txt', WALLS); put('map_files', 'thedeep_1.txt', ROOMS);
    const first = c._mapStatePayload('', T0, '');
    expect(first.zone).toBe('thedeep');
    expect(first.local_version).toMatch(/^thedeep@map_files:/);
    expect(first.local_map.source).toBe('map_files');
    expect(first.local_map.lines).toHaveLength(3);
    expect(first.local_map.labels).toEqual([[-10, -20, 0, 'Echo Hall', '#000000'], [50, 60, 300, 'Upper Gallery', '#000000']]);
    expect(first.local_map.lines[1]).toEqual([-110, -20, 0, -110, -120, 0, '#ff0000']);
    const again = c._mapStatePayload('', T0 + 1, first.local_version);
    expect(again.local_map).toBeNull();
    expect(again.local_version).toBe(first.local_version);
    expect(c._mapStatePayload('thedeep@2026-10-12T00:00:00Z', T0 + 2, first.local_version).local_map).toBeNull();   // the spawn data's version does not matter
    expect(c._mapStatePayload('thedeep@2026-10-12T00:00:00Z', T0 + 3, 'thedeep@maps:1:1').local_map).not.toBeNull();
    expect(c._mapStatePayload('thedeep@2026-10-12T00:00:00Z', T0 + 4).local_map).not.toBeNull();                   // never held: sent
  });
  it('local_version null and local_map null when the player has no files; it never breaks the payload', () => {
    const { c } = playingCore();
    const p = c._mapStatePayload('', T0, '');
    expect(p.local_map).toBeNull();
    expect(p.local_version).toBeNull();
    expect(p.status).toBe('ok');
  });
  it('works in a zone we hold no spawn points for, and in local mode', () => {
    const { c } = playingCore();   // local mode: no token
    fs.rmSync(path.join(dir, 'zone-spawns-cache'), { recursive: true });
    put('map_files', 'thedeep.txt', WALLS);
    const p = c._mapStatePayload('', T0, '');
    expect(p.status).toBe('no-cache');
    expect(p.local_map.lines).toHaveLength(3);
  });
});

describe('NEVER leaves the machine (the art has no licence for us to redistribute)', () => {
  const js = stripJs(AGENT);
  const localJs = stripJs(LOCAL);

  it('the block that reads the files touches no network, upload, sync, queue or disk write', () => {
    expect(localJs).not.toMatch(/\b(https?|fetch|request|XMLHttpRequest|WebSocket|dgram|net|child_process|spawn|exec)\b/);
    expect(localJs).not.toMatch(/\b_uploadOpts|_tsCall|_mapSync\w*|_mapFetchAllowed|_mapFetchZone|Authorization|botUrl|token\b/);
    expect(localJs).not.toMatch(/\b(writeFile\w*|appendFile\w*|createWriteStream|rename\w*|copyFile\w*|mkdir\w*|unlink\w*)\b/);
    expect(localJs).toMatch(/_eqSetupDirs\(\)/);   // the EQ folder the agent already knows, not a new setting
  });
  it('nothing outside that block and the map-state payload ever mentions the local map', () => {
    const payloadFn = sliceBlock(js, 'function _mapStatePayload(', '\n  return out;\n}\n');
    let rest = js.replace(localJs, '').replace(payloadFn, '');
    expect(rest.length).toBeLessThan(js.length - 500);                 // both really were cut out
    expect(rest).not.toMatch(/local_map|local_version|_mapLocalFor|_mapLocal\b|_mapParseLocalFiles|_mapFileToServer|MAP_LOCAL_/);
    // the /api/map-state handler only reads the version the overlay already holds
    const handler = sliceBlock(js, 'function _handleMapState(', '\n}\n');
    expect(handler).not.toMatch(/local_map|_mapLocalFor/);
    expect(handler).toMatch(/_localOriginOk\(req\)/);                  // and it answers the local overlay only
  });
  it('nothing in the sync or trigger-sync code paths can carry it', () => {
    const syncBlock = stripJs(sliceBlock(AGENT, 'const _mapSync = {', '// Fold the guild'));
    expect(syncBlock.length).toBeGreaterThan(2000);
    expect(syncBlock).not.toMatch(/local_map|_mapLocalFor|labels|lines/);
    const ts = sliceBlock(js, 'async function _tsCall(', '\nasync function _triggerSyncPush');
    expect(ts).not.toMatch(/_map/);
  });
  it('a live, synced session with the files loaded sends no map-file content in any request', async () => {
    const LIVE = { botUrl: 'http://127.0.0.1:9/api/agent/encounter', token: 'tok' };
    const points = [{ id: 1, x: 100, y: 200, z: 0, respawn_s: 600, variance_s: 60, npcs: [{ name: 'a_gnoll', level: 5, chance: 100, named: false, raid_target: false, badges: [] }] }];
    const { c, net } = playingCore(LIVE, points);
    put('map_files', 'thedeep.txt', WALLS); put('map_files', 'thedeep_1.txt', ROOMS);
    c._mapEnsureZone('thedeep', 164, Date.now());
    const N = Date.now();
    const p = c._mapStatePayload('', N, '');                          // loads the files, starts the guild pull
    expect(p.local_map.lines).toHaveLength(3);
    c._mapApplyMark('thedeep', { point_id: 1, kind: 'killed' }, N, 'Aldenmar');
    expect(c._mapSyncFlush(N + 3000)).toBe(true);                     // a real POST goes out
    await tick();
    expect(net.calls.length).toBeGreaterThan(0);
    const wire = JSON.stringify(net.calls.map(k => [k.method, k.path, k.__body]));
    expect(wire).not.toMatch(/Echo|Gallery|local_map|map_files|\[-?110,-?20/);
    expect(wire).toMatch(/died/);                                     // the mark itself did go
  });
});

// ── the overlay ──────────────────────────────────────────────────────────────────────────────────────────
describe('the overlay: pure helpers', () => {
  const helpers = sliceBlock(MAP_HTML, '// ── pure helpers', '// ── end pure helpers ──');
  // eslint-disable-next-line no-new-func
  const H = new Function(helpers + '\nreturn { wallColor, useLocalWalls, wallsNote, prepLocal, pickLabels };')();

  it('lifts colours only as far as they need to read, keeping Brewall\'s floor colours apart', () => {
    expect(H.wallColor('#000000')).toEqual([140, 140, 140]);                 // black walls: mid grey
    expect(H.wallColor('#969696')).toEqual([208, 208, 208]);                 // grey stairs: lighter than the walls
    expect(H.wallColor('junk')).toEqual([140, 140, 140]);
    expect(H.wallColor('#00cc00')).toEqual([0, 255, 0]);                     // green floor stays green
    expect(H.wallColor('#b266ff')).toEqual([178, 102, 255]);                 // purple floor already reads: unchanged
    const red = H.wallColor('#7f0000');
    expect(red[0]).toBe(255); expect(red[1]).toBe(red[2]); expect(red[1]).toBeLessThan(140);   // dark red -> red, not pink-grey
  });
  it('Walls: Auto uses the local lines when there are any; Ours only never does', () => {
    const local = H.prepLocal({ source: 'maps', lines: [[0, 0, 0, 10, 10, 0, '#000000']], labels: [] });
    expect(H.useLocalWalls('auto', local)).toBe(true);
    expect(H.useLocalWalls('ours', local)).toBe(false);
    expect(H.useLocalWalls('auto', null)).toBe(false);
    expect(H.useLocalWalls('auto', H.prepLocal({ source: 'maps', lines: [], labels: [[1, 2, 3, 'Hall', '#000000']] }))).toBe(false);   // labels alone are not walls
    expect(H.wallsNote(true)).toBe('walls: your map files');
    expect(H.wallsNote({ source: 'map_files' })).toBe('walls: your map files');
    expect(H.wallsNote({ source: 'brewall' })).toBe("walls: Brewall (Zeal's maps)");
    expect(H.wallsNote(false)).toBe('walls: Wolf Pack');
  });
  it('prepLocal groups lines by colour into the screen frame, with the middle z of each and the server-frame bounds', () => {
    const lm = H.prepLocal({ source: 'map_files', lines: [[10, 20, 0, 30, 40, 10, '#000000'], [1, 2, 50, 3, 4, 70, '#ff0000'], [-5, -6, 0, 0, 0, 0, '#000000'], ['x']], labels: [[1, 2, 3, 'Hall', '#000000'], [NaN, 2, 3, 'Bad', '#000000'], [1, 2, 3, '', '#000000']] });
    expect(lm.count).toBe(3);
    expect(lm.groups).toHaveLength(2);
    expect(Array.from(lm.groups[0].xy).map(v => v + 0)).toEqual([-10, -20, -30, -40, 5, 6, 0, 0]);   // negated: screen = -server
    expect(Array.from(lm.groups[0].z)).toEqual([5, 0]);
    expect(Array.from(lm.groups[1].z)).toEqual([60]);
    expect(lm.bounds).toEqual({ minX: -5, maxX: 30, minY: -6, maxY: 40 });
    expect(lm.labels.map(l => l[3])).toEqual(['Hall']);
    expect(H.prepLocal(null)).toBeNull();
  });
  it('pickLabels places the lowest priority first and skips any box that overlaps one already placed', () => {
    const a = { x: 10, y: 10, w: 40, h: 14, pri: 2, id: 'a' };
    const b = { x: 30, y: 12, w: 40, h: 14, pri: 1, id: 'b' };      // overlaps a, wins by priority
    const c = { x: 200, y: 10, w: 40, h: 14, pri: 3, id: 'c' };     // clear
    const d = { x: 10, y: 60, w: 40, h: 14, pri: 4, id: 'd' };      // clear (below)
    expect(H.pickLabels([a, b, c, d]).map(i => i.id)).toEqual(['b', 'c', 'd']);
    expect(H.pickLabels([])).toEqual([]);
  });
});

describe('the overlay (apps/mimic/map.html) drawing', () => {
  const NPC = (name, extra) => Object.assign({ name, level: 50, chance: 100, named: false, raid_target: false, badges: [] }, extra || {});
  const POINTS = [
    { id: 1, x: 100, y: 200, z: 0, respawn_s: 600, variance_s: 60, npcs: [NPC('a_decaying_skeleton')] },
    { id: 3, x: 1000, y: 1000, z: 0, respawn_s: 1200, variance_s: 0, npcs: [NPC('Lord_Nagafen', { named: true })] },
    { id: 5, x: -3000, y: -3000, z: 0, respawn_s: 3600, variance_s: 360, npcs: [NPC('Brackwyn_the_Pale', { raid_target: true, named: true })] },
  ];
  const BRIGHT = 'rgba(140,140,140,0.85)', FADED = 'rgba(140,140,140,0.25)', OURS_BRIGHT = 'rgba(214,230,255,0.95)';
  const LOCAL_MAP = {
    source: 'map_files',
    lines: [[0, 0, 0, 400, 0, 0, '#000000'], [0, 0, 500, 400, 0, 500, '#000000']],   // one at your height, one 500 above
    labels: [[100, 100, 0, 'Echo Hall', '#000000'], [102, 100, 0, 'Echo Hall Annex', '#000000'], [400, 100, 0, 'Far Room', '#000000']],
  };
  const PAYLOAD = {
    zone: 'thedeep', long_name: 'The Deep', version: 'thedeep@v', status: 'ok', now: T0, local_only: false, zone_id: 164,
    points: POINTS, map: { bands: [0], segs: [[0, 0, 300, 0, 0]], bounds: { minX: -3000, maxX: 1000, minY: -3000, maxY: 1000 } }, grids: null,
    self: { x: 100, y: 100, z: 0, heading: 0, name: 'Aldenmar' }, group: [], raid: [], target: null, timers: [], seen: [], unassigned: [],
    local_map: LOCAL_MAP, local_version: 'thedeep@map_files:1:1',
  };

  // The overlay's script against a stub page whose canvas records the text it draws and the strokes it sets.
  async function boot({ store = {}, payload = PAYLOAD, payloads } = {}) {
    const script = MAP_HTML.slice(MAP_HTML.indexOf('<script>') + 8, MAP_HTML.lastIndexOf('</script>'));
    const all = {};
    const rec = { text: [], strokes: [], alphaAtText: [] };
    const ctx = new Proxy({}, {
      get(t, k) {
        if (k === 'measureText') return (s) => ({ width: String(s).length * 6 });
        if (k === 'strokeText') return (s) => { rec.text.push(String(s)); };
        if (k === 'stroke') return () => { rec.strokes.push(t.strokeStyle); };
        return typeof t[k] === 'undefined' ? () => {} : t[k];
      },
      set(t, k, v) { t[k] = v; return true; },
    });
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
    const redraw = () => { rec.text.length = 0; rec.strokes.length = 0; out.renderMap(); return rec; };
    return Object.assign(out, { all, rec, fetched, store, redraw });
  }
  const click = (el) => el.listeners.click.forEach(f => f.call(el));
  const change = (el) => el.listeners.change.forEach(f => f.call(el));
  const wide = (extra) => Object.assign({ 'wp-map-scale': '0.5' }, extra);   // 0.5 px per unit: the labels sit apart

  it('draws your own map files INSTEAD of ours when they are present, and ours when they are not', async () => {
    const a = await boot({ store: wide() });
    const withLocal = a.redraw();
    expect(withLocal.strokes).toContain(BRIGHT);
    expect(withLocal.strokes).not.toContain(OURS_BRIGHT);
    const b = await boot({ store: wide(), payload: Object.assign({}, PAYLOAD, { local_map: null, local_version: null }) });
    const without = b.redraw();
    expect(without.strokes).toContain(OURS_BRIGHT);
    expect(without.strokes).not.toContain(BRIGHT);
  });
  it('the Levels range applies to local lines by their middle z: your floor bright, the one 500 above faded', async () => {
    const a = await boot({ store: wide() });                       // default +-100, you are at z 0
    const r = a.redraw();
    expect(r.strokes).toContain(BRIGHT);
    expect(r.strokes).toContain(FADED);
    const all = await boot({ store: wide({ 'wp-map-levels': '7' }) });   // Levels: all
    const r2 = all.redraw();
    expect(r2.strokes).toContain(BRIGHT);
    expect(r2.strokes).not.toContain(FADED);
  });
  it('Walls: Ours only draws our slices even with local lines, and the choice is remembered', async () => {
    const a = await boot({ store: wide() });
    a.all.wallsSel.value = 'ours'; change(a.all.wallsSel);
    expect(a.store['wp-map-walls']).toBe('ours');
    const r = a.redraw();
    expect(r.strokes).toContain(OURS_BRIGHT);
    expect(r.strokes).not.toContain(BRIGHT);
    const again = await boot({ store: a.store });
    expect(again.S.walls).toBe('ours');
    expect(again.all.wallsSel.value).toBe('ours');
    const junk = await boot({ store: { 'wp-map-walls': 'sideways' } });
    expect(junk.S.walls).toBe('auto');
  });
  it('says where the walls come from, and follows the choice', async () => {
    const a = await boot({ store: wide() });
    expect(a.all.wallsrc.textContent).toBe('walls: your map files');
    a.all.wallsSel.value = 'ours'; change(a.all.wallsSel);
    expect(a.all.wallsrc.textContent).toBe('walls: Wolf Pack');
    expect(a.all.labelsBtn.title).toMatch(/walls: Wolf Pack/);
    const b = await boot({ store: wide(), payload: Object.assign({}, PAYLOAD, { local_map: null, local_version: null }) });
    expect(b.all.wallsrc.textContent).toBe('walls: Wolf Pack');
  });
  it('draws room names from the map files, skipping one that would sit on another (closest to you first)', async () => {
    const a = await boot({ store: wide() });
    const r = a.redraw();
    expect(r.text).toContain('Echo Hall');
    expect(r.text).toContain('Far Room');
    expect(r.text).not.toContain('Echo Hall Annex');   // 2 units away: its box overlaps Echo Hall's
  });
  it('boss names win over room names, and are drawn at low zoom (they used to need a zoom threshold)', async () => {
    const boss = { zone: 'thedeep', local_version: 'v', local_map: { source: 'maps', lines: [[0, 0, 0, 5, 5, 0, '#000000']],
      labels: [[1000, 1000, 0, 'Dragon Nest Room', '#000000'], [-3000, -3000, 0, 'Pale Crypt', '#000000']] } };
    const lowZoom = await boot({ store: { 'wp-map-scale': '0.03' }, payload: Object.assign({}, PAYLOAD, boss) });
    const r = lowZoom.redraw();
    expect(r.text).toContain('Lord Nagafen');            // named
    expect(r.text).toContain('Brackwyn the Pale');       // raid target
    expect(r.text).not.toContain('Dragon Nest Room');    // a room name on top of the boss's own label: the boss wins
    expect(r.text).not.toContain('Pale Crypt');
    const near = await boot({ store: wide(), payload: PAYLOAD });
    expect(near.redraw().text).not.toContain('a decaying skeleton');   // an ordinary mob never gets a name
  });
  it('a boss hidden by Spawn height has no name', async () => {
    const a = await boot({ store: { 'wp-map-scale': '0.03', 'wp-map-spawn-levels': '0' }, payload: Object.assign({}, PAYLOAD, { points: POINTS.map(p => (p.id === 3 ? Object.assign({}, p, { z: 900 }) : p)) }) });
    const r = a.redraw();
    expect(r.text).not.toContain('Lord Nagafen');
    expect(r.text).toContain('Brackwyn the Pale');
  });
  it('the Labels button cycles all / targets / off, shows its state, and is remembered (2026-10-13)', async () => {
    // the guild lead: "Labels on/off should be labels all/targets/off and show the mob circles but not the labels if
    // turned off"
    const a = await boot({ store: wide() });
    expect(a.all.labelsBtn.textContent).toBe('Labels: all');
    expect(a.redraw().text).toContain('Echo Hall');
    click(a.all.labelsBtn);
    expect(a.all.labelsBtn.textContent).toBe('Labels: targets');
    expect(a.store['wp-map-labels']).toBe('targets');
    const t = a.redraw();
    expect(t.text).not.toContain('Echo Hall');                // no room names
    expect(t.text).not.toContain('Lord Nagafen');             // no boss names: only your target's
    click(a.all.labelsBtn);
    expect(a.all.labelsBtn.textContent).toBe('Labels: off');
    expect(a.store['wp-map-labels']).toBe('off');
    const r = a.redraw();
    expect(r.text).not.toContain('Echo Hall');
    expect(r.text).not.toContain('Lord Nagafen');
    const again = await boot({ store: a.store });
    expect(again.S.labels).toBe('off');
    expect(again.all.labelsBtn.textContent).toBe('Labels: off');
    expect(again.redraw().text).not.toContain('Echo Hall');
    click(again.all.labelsBtn);
    expect(again.store['wp-map-labels']).toBe('all');
    expect(again.redraw().text).toContain('Echo Hall');
    const old = await boot({ store: Object.assign(wide(), { 'wp-map-labels': '0' }) });   // saved before the three-way
    expect(old.S.labels).toBe('off');
  });
  it('asks the agent for the local map only when it holds none: have_local rides the poll once it has one', async () => {
    const a = await boot({ store: wide() });
    expect(a.fetched[0]).toBe('http://127.0.0.1:7779/api/map-state');
    a.poll(); await tick();
    expect(a.fetched[1]).toBe('http://127.0.0.1:7779/api/map-state?have=thedeep%40v&have_local=thedeep%40map_files%3A1%3A1');
    // the agent then answers "unchanged" (local_map null, same version): the overlay keeps what it drew
    const unchanged = Object.assign({}, PAYLOAD, { points: null, map: null, local_map: null });
    const b = await boot({ store: wide(), payloads: [PAYLOAD, unchanged] });
    b.poll(); await tick();
    expect(b.S.local).toBeTruthy();
    expect(b.redraw().text).toContain('Echo Hall');
  });
  it('drops the local map when the agent says there is none (local_version null), and on a zone change', async () => {
    const none = Object.assign({}, PAYLOAD, { local_map: null, local_version: null });
    const a = await boot({ store: wide(), payloads: [PAYLOAD, none] });
    expect(a.S.local).toBeTruthy();
    a.poll(); await tick();
    expect(a.S.local).toBeNull();
    expect(a.S.localVer).toBeNull();
    const elsewhere = Object.assign({}, PAYLOAD, { zone: 'lavastorm', version: 'lavastorm@v', local_map: null, local_version: 'lavastorm@maps:2:2', points: [], map: null });
    const b = await boot({ store: wide(), payloads: [PAYLOAD, elsewhere] });
    b.poll(); await tick();
    expect(b.S.local).toBeNull();                     // the old zone's walls never show in the new zone
  });
  it('keeps the local lines\' bounds, which Fit zone uses while it draws them', async () => {
    const a = await boot({ store: wide() });
    expect(a.S.local.bounds).toEqual({ minX: 0, maxX: 400, minY: 0, maxY: 0 });
  });
});
