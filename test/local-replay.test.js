// test/local-replay.test.js — "My replay" on the local site (web/local, bundled into Mimic).
//
// The page is the website's own ReplayBoard in BOUNDED mode with its `urls` pointed at the agent. The agent half is two
// new read-only routes beside the recorder's (GET /api/local/track/bosses, /api/local/track/map); the page half is a
// client component, so its contract is pinned as text (comments stripped) plus the real decoders reading the agent's
// answers. Names are invented. Run: npx vitest run test/local-replay.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';
import { parseBosses } from '../web/lib/replayBosses.ts';
import { parseZoneMap } from '../web/lib/spectator.ts';
import { buildTimeline } from '../web/lib/raidTimeline.ts';

const require = createRequire(import.meta.url);
const agent = require('../packages/wolfpack-logsync/index.js');

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 5, 1, 0, 0);   // 21:00 ET on Oct 4: the night of 10/04/2026
const NIGHT = '10/04/2026';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let dir, store;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-replay-'));
  store = agent._localStoreOpen(dir);
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

// A recorded minute in which Aldenmar targets `mob` at server (x, y). `mobs` rides the frame like the recorder's.
function putMinute(ms, mob, x, y) {
  const mobs = mob ? [{ name: mob, id: 2231, zone: 'gfaydark', x, y, z: 4, n: 1 }] : [];
  const row = agent._localTrackMinuteRow(ms, [{ t: ms + 3000, rows: [{ name: 'Aldenmar', cls: 'Warrior', group: null, level: 60, hp: 90, x: 5, y: 6, z: 3, h: 128, src: 'gfaydark' }], mobs }],
    { srcZone: new Map([['gfaydark', 'gfaydark']]), stepS: 3 });
  store.put('track_minute', row.minute_at, row, { ts: ms });
}

describe('GET /api/local/track/bosses — the kills this PC knows, in the web route\'s shape', () => {
  const fight = (name, startMin, endMin) => ({ name, from: T0 + startMin * MIN, to: T0 + endMin * MIN });

  it('answers { night, bosses:[{ npc_id, name, from, to, points }] } with times in epoch ms, oldest first', () => {
    const out = agent._localTrackBosses(store, { night: NIGHT, fights: [fight('Lord_Brackwyn', 20, 22), fight('Corvale the Pale', 5, 7)] });
    expect(out.status).toBe(200);
    expect(Object.keys(out.body).sort()).toEqual(['bosses', 'night']);
    expect(out.body.night).toBe(NIGHT);
    expect(out.body.bosses.map(b => b.name)).toEqual(['Corvale the Pale', 'Lord Brackwyn']);   // underscores read as spaces
    expect(Object.keys(out.body.bosses[0]).sort()).toEqual(['from', 'name', 'npc_id', 'points', 'to']);
    expect(out.body.bosses[0]).toMatchObject({ from: T0 + 5 * MIN, to: T0 + 7 * MIN, npc_id: 0, points: [] });   // no catalog row, no recorded target
  });

  it('a kill the recorder saw targeted carries that place as its one point (server frame, the target\'s own zone)', () => {
    putMinute(T0 + 5 * MIN, 'Corvale the Pale', 10.4, 20.6);   // server x 10, y 21
    const out = agent._localTrackBosses(store, { night: NIGHT, fights: [fight('Corvale the Pale', 5, 7)] });
    expect(out.body.bosses[0].points).toEqual([{ zone: 'gfaydark', x: 10, y: 21, z: 4 }]);
  });

  it('a target of another name is not the boss\'s place; a name with a leading # or underscores still matches', () => {
    putMinute(T0 + 5 * MIN, 'a fire giant', 99, 99);
    expect(agent._localTrackBosses(store, { night: NIGHT, fights: [fight('Corvale the Pale', 5, 7)] }).body.bosses[0].points).toEqual([]);
    putMinute(T0 + 6 * MIN, '#Corvale_the_Pale', 30, 40);
    expect(agent._localTrackBosses(store, { night: NIGHT, fights: [fight('Corvale the Pale', 5, 7)] }).body.bosses[0].points).toHaveLength(1);
  });

  it('only the asked night: a fight on another night is left out', () => {
    const other = { name: 'Zarrin', from: T0 + 3 * 86400_000, to: T0 + 3 * 86400_000 + MIN };
    expect(agent._localTrackBosses(store, { night: NIGHT, fights: [other, fight('Zarrin', 5, 6)] }).body.bosses).toHaveLength(1);
    expect(agent._localTrackBosses(store, { night: '10/07/2026', fights: [other] }).body.bosses).toHaveLength(1);
  });

  it('one kill seen by two characters and both records is one boss', () => {
    const out = agent._localTrackBosses(store, { night: NIGHT, fights: [fight('Zarrin', 5, 7), fight('Zarrin', 5.2, 7.1), fight('zarrin', 6, 8)] });
    expect(out.body.bosses).toHaveLength(1);
    expect(out.body.bosses[0]).toMatchObject({ from: T0 + 5 * MIN, to: T0 + 8 * MIN });
    expect(agent._localTrackBosses(store, { night: NIGHT, fights: [fight('Zarrin', 5, 6), fight('Zarrin', 40, 41)] }).body.bosses).toHaveLength(2);   // a respawn is another kill
  });

  it('a bad or missing night is a 400', () => {
    for (const night of [undefined, '', 'junk', '2026-10-04']) expect(agent._localTrackBosses(store, { night, fights: [] }).status).toBe(400);
  });

  it('by default it reads this PC\'s own boss rows (logsync.myfights.json) and the History ring, and skips non-boss fights', () => {
    const iso = (ms) => new Date(ms).toISOString();
    agent._setMyFightsForTest([
      { t: iso(T0 + 5 * MIN), end: iso(T0 + 7 * MIN), mob: 'Zarrin', zone: 'Greater Faydark', char: 'Aldenmar', dmg: 5000, dur: 120, dps: 41.7, boss: true },
      { t: iso(T0 + 9 * MIN), end: iso(T0 + 10 * MIN), mob: 'a fire giant', zone: 'Greater Faydark', char: 'Aldenmar', dmg: 900, dur: 60, dps: 15, boss: false },
    ]);
    agent._resetFightHistoryForTest();
    agent._recordFightHistory({ boss: 'Corvale the Pale', startedMs: T0 + 20 * MIN, endedMs: T0 + 23 * MIN, durationSec: 180, local: [{ character: 'Aldenmar', dmg: 100 }] });
    try {
      const out = agent._localTrackBosses(store, { night: NIGHT });
      expect(out.body.bosses.map(b => b.name)).toEqual(expect.arrayContaining(['Zarrin']));
      expect(out.body.bosses.map(b => b.name)).not.toContain('a fire giant');
    } finally { agent._setMyFightsForTest([]); agent._resetFightHistoryForTest(); }
  });

  it('ReplayBoard\'s own parser keeps a kill with no recorded place, and the raid timeline strip takes it', () => {
    putMinute(T0 + 5 * MIN, 'Zarrin', 1, 2);
    const out = agent._localTrackBosses(store, { night: NIGHT, fights: [fight('Zarrin', 5, 7), fight('Corvale the Pale', 20, 22)] });
    const parsed = parseBosses(JSON.parse(JSON.stringify(out.body)));
    expect(parsed.map(b => [b.name, b.points.length])).toEqual([['Zarrin', 1], ['Corvale the Pale', 0]]);
    const kills = parsed.map(b => ({ npcId: b.npc_id, name: b.name, atMs: b.to }));   // what ReplayBoard hands <RaidTimeline kills>
    expect(buildTimeline(kills, T0 + 30 * MIN).deaths.map(d => d.name)).toEqual(['Zarrin', 'Corvale the Pale']);
  });
});

describe('GET /api/local/track/map — the Brewall files this PC already reads, in the web map route\'s shape', () => {
  const WALLS = 'L 10, 20, 0, 110, 20, 0, 178, 102, 255\nL 110, 20, 0, 110, 120, 5, 150, 150, 150';
  const LABELS = 'P 10, 20, 0, 0, 0, 0, 3, Stairs_Up';
  let was;
  beforeEach(() => {
    was = agent._mapPaths.brewall;
    agent._mapPaths.brewall = dir;                                    // a folder with the zone's file on disk: nothing is fetched
    fs.writeFileSync(path.join(dir, 'gfaydark.txt'), WALLS);
    fs.writeFileSync(path.join(dir, 'gfaydark_1.txt'), LABELS);
  });
  afterEach(() => { agent._mapPaths.brewall = was; });

  it('answers { zone, frame:"server", eqemu:null, brewall:{ lines, labels } } that parseZoneMap reads', async () => {
    const out = await agent._localTrackMap('gfaydark');
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ zone: 'gfaydark', frame: 'server', eqemu: null });
    expect(out.body.brewall.lines[0]).toEqual([-10, -20, 0, -110, -20, 0, 178, 102, 255]);   // server frame (file x/y negated), colour as r,g,b
    expect(out.body.brewall.labels).toEqual([[-10, -20, 0, 'Stairs Up']]);
    const zm = parseZoneMap(JSON.parse(JSON.stringify(out.body)));
    expect(zm.brewall.lines).toHaveLength(2);
    expect(zm.eqemu).toBeNull();
    expect(zm.brewall.bounds).toMatchObject({ minX: -110, maxX: -10 });
  });

  it('a zone with no file is a 404, a bad zone name a 400', async () => {
    agent._mapPaths.brewall = null;                                   // and no download: the test never touches the network
    expect((await agent._localTrackMap('nowhere')).status).toBe(404);
    for (const z of ['', '../x', 'a b', 'x'.repeat(40), null]) expect((await agent._localTrackMap(z)).status).toBe(400);
  });

  it('the router answers both routes, GET only, JSON and uncached', async () => {
    const res = () => { const r = { status: 0, headers: null, body: '', done: null }; r.done = new Promise(ok => { r.end = (b) => { r.body = b; ok(); }; }); r.writeHead = (s, h) => { r.status = s; r.headers = h; }; return r; };
    const call = async (url, method = 'GET') => { const r = res(); const handled = agent._localTrackRoute({ method, url }, r); if (handled) await r.done; return { handled, status: r.status, headers: r.headers, json: r.body ? JSON.parse(r.body) : null }; };
    const map = await call('/api/local/track/map?zone=gfaydark');
    expect(map).toMatchObject({ handled: true, status: 200 });
    expect(map.headers['Cache-Control']).toBe('no-store');
    expect(map.json.brewall.lines).toHaveLength(2);
    const bosses = await call(`/api/local/track/bosses?night=${encodeURIComponent(NIGHT)}`);
    expect(bosses).toMatchObject({ handled: true });
    expect(bosses.headers['Cache-Control']).toBe('no-store');
    expect((await call('/api/local/track/bosses?night=junk')).status).toBe(400);
    expect((await call('/api/local/track/bosses', 'POST')).handled).toBe(false);
    expect((await call('/api/local/track/map', 'POST')).handled).toBe(false);
    expect((await call('/api/local/track/meshes')).handled).toBe(false);
  });
});

describe('the page — ReplayBoard in bounded mode, pointed at the agent', () => {
  const page = stripJs(read('web/local/app/replay/LocalReplay.tsx'));

  it('mounts the website\'s own board, bounded and flat, with the raid timeline on top', () => {
    expect(page).toMatch(/import ReplayBoard, \{ type BoundedReplay \} from '@\/app\/spectator\/replay\/ReplayBoard'/);
    expect(page).toMatch(/<ReplayBoard key=\{.+?\} bounded=\{bounded\} timeline \/>/);
    expect(page).toMatch(/flat: true/);
  });
  it('every route the board reads is the agent\'s (same origin, /api/local/track/*), never the website\'s', () => {
    expect(page).toMatch(/const API = '\/api\/local\/track'/);
    expect(page).toMatch(/window: \(night, fromIso, toIso\) => `\$\{API\}\?from=/);
    expect(page).toMatch(/bosses: night => `\$\{API\}\/bosses\?night=/);
    expect(page).toMatch(/map: zone => `\$\{API\}\/map\?zone=/);
    expect(page).toMatch(/fetch\(`\$\{API\}\/nights`/);
    expect(page).not.toMatch(/\/api\/spectator|\/api\/raid|wolfpack\.quest|supabase/i);
  });
  it('plays one session as the whole window: sessions emptied, first/last from the session', () => {
    expect(page).toMatch(/sessions: \[\]/);
    expect(page).toMatch(/last: new Date\(s\.to - MINUTE_MS\)\.toISOString\(\)/);
  });
  it('the board has a flat switch that hides 2D/3D, and the local build swaps the 3D view for a stub (no three.js shipped)', () => {
    const board = stripJs(read('web/app/spectator/replay/ReplayBoard.tsx'));
    expect(board).toMatch(/flat\?: boolean/);
    expect(board).toMatch(/\{!bounded\?\.flat && \(\s*<div className="ml-auto flex gap-1\.5" role="group" aria-label="Dimensions">/);
    const cfg = stripJs(read('web/local/next.config.js'));
    expect(cfg).toMatch(/NormalModuleReplacementPlugin\(\s*\/\[\\\\\/\]Replay3D\$\/,\s*path\.join\(__dirname, 'stubs', 'Replay3D\.tsx'\)/);
    expect(stripJs(read('web/local/package.json'))).not.toMatch(/"three"/);
  });
  it('the page has a title and a description', () => {
    const p = read('web/local/app/replay/page.tsx');
    expect(p).toMatch(/title: 'My replay · On this PC'/);
    expect(p).toMatch(/description: '.{20,}'/);
  });
});

describe('nav, rail, tray and release checks', () => {
  it('the local nav links My replay (and still lists My parses as coming)', () => {
    const nav = stripJs(read('web/local/app/LocalNav.tsx'));
    expect(nav).toMatch(/\{ href: '\/replay\/',\s+label: 'My replay', icon: '🎬' \}/);
    expect(nav).toMatch(/\{ href: '\/parses\/',\s+label: 'My parses', icon: '📈', coming: true \}/);
  });
  it('the dashboard rail\'s "On this PC" group opens My replay in its own window, and the tray has the same item', () => {
    const dash = read('packages/wolfpack-logsync/dashboard.html');
    expect(dash).toMatch(/id="wpLocalReplay"[^>]*onclick="wpOpenLocalSite\('replay'\)"/);
    expect(dash).not.toMatch(/Coming soon: replay your own movement/);
    expect(stripJs(read('apps/mimic/main.js'))).toMatch(/label: '🎬 My replay \(on this PC\)', click: \(\) => \{ if \(!openLocalSite\('replay'\)\)/);
    // the generated literal carries it too (check:dashboard keeps them in step; this fails loudly if the sync was skipped)
    expect(readSource(AGENT_INDEX)).toContain("wpOpenLocalSite('replay')");
  });
  it('both release workflows fail when out/replay/index.html is missing', () => {
    for (const wf of ['.github/workflows/release-mimic.yml', '.github/workflows/build-mimic-linux.yml']) {
      expect(read(wf), wf).toMatch(/test -f out\/replay\/index\.html/);
    }
  });
  it('the new routes sit inside the recorder block: no network, no upload queue', () => {
    const src = stripJs(readSource(AGENT_INDEX));
    const from = src.indexOf('function _localBossFights()');
    const to = src.indexOf('function _localTrackSetStoreForTest');
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const block = src.slice(from, to);
    for (const bad of [/enqueueUpload/, /https?\.request/, /\bfetch\s*\(/, /\bhttps?\b\s*[.(]/, /_uploadOpts/, /botUrl/, /\.send\(/]) expect(block).not.toMatch(bad);
  });
});
