// test/raid-code.test.js — "Join a raid with a code" (the guild lead, 2026-10-21: a guest's data stays on their PC; the
// code is a label that tags local records and HOLDS the record uploads; merging is a file swap).
//
// Everything here is run for real against the agent: the state and its six-hour pass, the hold in enqueueUpload per
// kind, the tagging of fights / minutes / loot, the .rmpack export and import (a round trip between two PCs, the merge
// and its dedupe, a hostile pack), and the GUEST / away marking the local site reads. The dashboard card, the tray
// item and the two local-site pages are pinned as text (comments stripped). Names are invented.
// Run: npx vitest run test/raid-code.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { readSource, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const agent = require('../packages/wolfpack-logsync/index.js');

const HOUR = 3600_000;
const MIN = 60_000;
const T0 = Math.floor((Date.now() - 3 * 3600_000) / 60_000) * 60_000;   // three hours ago, on a minute boundary (the ring forgets after a week)
const iso = (ms) => new Date(ms).toISOString();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CODE = 'BC-7KQ2';
const MEMBER = { token: 'member-token', botUrl: 'https://bot.example/api/agent/encounter', dryRun: false };
const GUEST = { token: null, botUrl: 'https://bot.example/api/agent/encounter', dryRun: false };

let dir, codeFile, storeA, storeB;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-raidcode-'));
  codeFile = path.join(dir, 'raidcode.json');
  storeA = agent._localStoreOpen(path.join(dir, 'a'));
  storeB = agent._localStoreOpen(path.join(dir, 'b'));
  agent._raidCodeSetFileForTest(codeFile);
  agent._localTrackSetStoreForTest(storeA);
  agent._setUploadOptsForTest(GUEST);
  agent._resetFightHistoryForTest();
  agent._setMyFightsForTest([]);
  agent._uploadQueueForTest().length = 0;
});
afterEach(() => {
  agent._raidCodeSetFileForTest(null);
  agent._localTrackSetStoreForTest(null);
  agent._setUploadOptsForTest(null);
  agent._resetFightHistoryForTest();
  agent._setMyFightsForTest([]);
  agent._uploadQueueForTest().length = 0;
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- fixtures ----
/** A fight as the builder hands it to _recordFightHistory. */
function et(over = {}) {
  return {
    bossName: 'Corvale_the_Pale', targetName: 'Corvale_the_Pale', startedAt: iso(T0 + 5 * MIN), flushedAt: T0 + 8 * MIN,
    perPlayer: {
      Aldenmar: { dmg: 50_000, took: 1000 }, Brackwyn: { dmg: 80_000, took: 60_000, tookMax: 3000 }, Corvale: { dmg: 30_000 },
      Imp: { dmg: 6000, pet_owner: 'Aldenmar' },
    },
    deaths: [{ name: 'Rethlan', ts: iso(T0 + 7 * MIN) }],
    ...over,
  };
}
/** One recorded minute: frames of rows, closed into the store through the recorder's own path. */
function recordMinute(store, minuteStart, rows) {
  agent._localTrackSetStoreForTest(store);
  agent._localTrackPush({ t: minuteStart + 3000, rows: rows.map(r => ({ cls: 'Warrior', group: 1, level: 60, hp: 100, z: 0, h: 128, src: 'pofire', ...r })), mobs: [] });
  return agent._localTrackClose();
}
const mockRes = () => {
  const r = { status: 0, headers: {}, body: Buffer.alloc(0) };
  r.writeHead = (s, h) => { r.status = s; r.headers = h || {}; };
  r.end = (b) => { r.body = b ? Buffer.from(b) : Buffer.alloc(0); };
  r.json = () => JSON.parse(r.body.toString('utf8'));
  return r;
};
const mockReq = (method, url, body) => Object.assign(Readable.from(body ? [body] : []), { method, url, headers: {} });
const lines = (buf) => zlib.gunzipSync(buf).toString('utf8').trim().split('\n').map(l => JSON.parse(l));
const parsesOf = async (store) => (await agent._localParsesAnswer('/api/local/parses?scope=all', { store, opts: GUEST, waitMs: 0 })).body;

// ---- 1. the code and its pass ----
describe('the code and its six-hour pass', () => {
  it('reads "bc 7kq2" and "BC-7KQ2" as one code, and refuses what is not one', () => {
    for (const ok of ['BC-7KQ2', 'bc-7kq2', ' bc 7kq2 ', 'WOLF-AB12CD']) expect(agent._raidCodeNormalize(ok)).toMatch(/^[A-Z]{2,4}-[A-Z0-9]{4,6}$/);
    expect(agent._raidCodeNormalize('bc 7kq2')).toBe(CODE);
    for (const bad of ['', 'B-7KQ2', 'BC7KQ2', 'BC-7K', 'BC-7KQ2XYZ', 'BC-7K!2', '12-ABCD', 'ABCDE-1234', null, undefined]) expect(agent._raidCodeNormalize(bad)).toBeNull();
  });

  it('a bad code changes nothing; a good one is active, and lasts six hours', () => {
    expect(agent._raidCodeSet('nope', T0).ok).toBe(false);
    expect(agent._raidCodeActive(T0)).toBeNull();
    const out = agent._raidCodeSet('bc-7kq2', T0);
    expect(out.ok).toBe(true);
    expect(out.raid).toMatchObject({ code: CODE, since: T0, expires: T0 + 6 * HOUR, ttl_ms: 6 * HOUR, role: 'guest', held_total: 0 });
    expect(agent._raidCodeActive(T0 + 6 * HOUR - 1)).toMatchObject({ code: CODE });
  });

  it('clears itself at six hours, wherever it is read, and the file goes with it', () => {
    agent._raidCodeSet(CODE, T0);
    expect(fs.existsSync(codeFile)).toBe(true);
    expect(agent._raidCodeActive(T0 + 6 * HOUR)).toBeNull();
    expect(fs.existsSync(codeFile)).toBe(false);
    expect(agent._raidCodeStatus(T0)).toBeNull();      // it is gone for good, not just late
  });

  it('survives a restart (read from its file), and a pass already past six hours does not come back', () => {
    const now = Date.now();
    agent._raidCodeSet(CODE, now);
    agent._raidCodeSetFileForTest(codeFile);           // forget memory, as a restart does
    expect(agent._raidCodeActive()).toMatchObject({ code: CODE, since: now });
    agent._raidCodeClear();
    expect(agent._raidCodeActive()).toBeNull();
    fs.writeFileSync(codeFile, JSON.stringify({ v: 1, code: CODE, since: now - 7 * HOUR, expires: now - HOUR }));
    agent._raidCodeSetFileForTest(codeFile);
    expect(agent._raidCodeActive()).toBeNull();
    fs.writeFileSync(codeFile, JSON.stringify({ v: 1, code: CODE, since: now, expires: now + 99 * HOUR }));   // a hand-edited pass cannot run longer
    agent._raidCodeSetFileForTest(codeFile);
    expect(agent._raidCodeActive()).toBeNull();
  });

  it('a signed-in Wolf Pack member is "away", an install with no token is "guest"', () => {
    agent._raidCodeSet(CODE);
    agent._setUploadOptsForTest(MEMBER);
    expect(agent._raidTag()).toEqual({ code: CODE, role: 'away' });
    agent._setUploadOptsForTest(GUEST);
    expect(agent._raidTag()).toEqual({ code: CODE, role: 'guest' });
    agent._raidCodeClear();
    expect(agent._raidTag()).toBeNull();
  });
});

// ---- 2. the hold ----
describe('the hold: the record / DKP uploads stay on this PC while a code is on; the live overlay streams go through', () => {
  const HELD = [...agent.RAID_HOLD_KINDS];
  // The live streams behind Target info, the Command Center, the buff queue and the callouts (the guild lead, 2026-10-21).
  const LIVE = ['casting', 'buff_cast', 'raid_roster', 'threat_snapshot', 'trigger_relay', 'slow_mode'];
  const OWN = ['corpse', 'xp_events', 'faction', 'tells', 'inventory', 'spellbook', 'quarmy', 'trigger', 'trigger_feedback', 'rez_dismiss', 'crash_report', 'pop_flag', 'quake', 'historical_chat', 'optin_summary'];
  const queued = () => agent._uploadQueueForTest().length;
  const send = (kind, extra) => agent.enqueueUpload ? agent.enqueueUpload(kind, { agent_version: 'test', ...extra }) : null;

  it('holds exactly the record / DKP kinds, and none of the live overlay streams or the player\'s own', () => {
    expect(HELD.sort()).toEqual(['ari_lead', 'bosskill', 'chat', 'encounter', 'fun_event', 'hatekill', 'lockout', 'looted', 'pvp', 'pvp_assists', 'rolls']);
    for (const k of [...OWN, ...LIVE]) expect(HELD).not.toContain(k);
  });

  it('the live kinds are real enqueue kinds with an endpoint (so the pass-through is a real stream, not a typo)', () => {
    const src = stripJs(readSource(AGENT_INDEX));
    for (const k of LIVE) {
      expect(src, k).toMatch(new RegExp(`enqueueUpload\\('${k}'`));
      expect(src, k).toMatch(new RegExp(`case '${k}':`));
    }
  });

  it('every held kind is a real enqueue kind with an endpoint (the list was grepped, not guessed)', () => {
    const src = stripJs(readSource(AGENT_INDEX));
    for (const k of HELD) {
      expect(src, k).toMatch(new RegExp(`enqueueUpload\\('${k}'`));
      expect(src, k).toMatch(new RegExp(`case '${k}':`));
    }
  });

  it('with a member token and NO code, every kind queues exactly as before', () => {
    agent._setUploadOptsForTest(MEMBER);
    for (const k of [...HELD, ...LIVE, ...OWN]) { const before = queued(); expect(send(k), k).toBeTruthy(); expect(queued(), k).toBe(before + 1); }
  });

  it('with a code on, every held kind queues NOTHING and is counted; the live overlay streams and the player\'s own kinds still queue', () => {
    agent._setUploadOptsForTest(MEMBER);
    agent._raidCodeSet(CODE);
    for (const k of HELD) { expect(send(k), k).toBeNull(); }
    expect(queued()).toBe(0);
    expect(agent._raidCodeStatus().held_total).toBe(HELD.length);
    expect(Object.keys(agent._raidCodeStatus().held).sort()).toEqual(HELD.slice().sort());
    for (const k of [...LIVE, ...OWN]) { const before = queued(); expect(send(k), k).toBeTruthy(); expect(queued(), k).toBe(before + 1); }
    expect(agent._raidCodeStatus().held_total).toBe(HELD.length);   // the live kinds were not counted as held
  });

  it('an opt-in backfill\'s encounters are the member\'s own history, not this raid: they still go', () => {
    agent._setUploadOptsForTest(MEMBER);
    agent._raidCodeSet(CODE);
    expect(send('encounter', { backfill: true })).toBeTruthy();
    expect(send('encounter')).toBeNull();
  });

  it('resumes the moment the code is cleared', () => {
    agent._setUploadOptsForTest(MEMBER);
    agent._raidCodeSet(CODE);
    expect(send('looted', { items: [] })).toBeNull();
    agent._raidCodeClear();
    expect(send('looted', { items: [] })).toBeTruthy();
    expect(queued()).toBe(1);
  });

  it('resumes when the six hours run out, with nobody pressing anything', () => {
    agent._setUploadOptsForTest(MEMBER);
    agent._raidCodeSet(CODE, Date.now() - 7 * HOUR);   // a pass that began seven hours ago
    expect(send('chat', { messages: [] })).toBeTruthy();
    expect(send('bosskill', { kills: [] })).toBeTruthy();
    expect(queued()).toBe(2);
    expect(fs.existsSync(codeFile)).toBe(false);
  });

  it('a local-only install queues nothing with or without a code (the code only tags its records)', () => {
    expect(send('encounter')).toBeNull();
    agent._raidCodeSet(CODE);
    expect(send('encounter')).toBeNull();
    expect(queued()).toBe(0);
  });

  it('is wired into enqueueUpload after the local-only line and before anything is queued', () => {
    const src = stripJs(readSource(AGENT_INDEX));
    const at = src.indexOf('function enqueueUpload(kind, payload) {');
    const body = src.slice(at, src.indexOf('\n}\n', at));
    const local = body.indexOf('if (_localOnly()) return null;');
    const hold = body.indexOf('if (_raidCodeHolds(kind, payload)) return null;');
    const push = body.indexOf('_uploadQueue.push(entry)');
    expect(local).toBeGreaterThan(0);
    expect(hold).toBeGreaterThan(local);
    expect(push).toBeGreaterThan(hold);
  });
});

// ---- 3. tagging ----
describe('records made under a code carry it', () => {
  it('a fight-log row has code and role only under a code; without one it is byte-for-byte what it was', () => {
    const plain = agent._myFightsNote(et(), 'Aldenmar');
    expect(Object.keys(plain)).toEqual(['t', 'end', 'mob', 'zone', 'char', 'dmg', 'dur', 'dps', 'boss']);
    agent._setMyFightsForTest([]);
    agent._raidCodeSet(CODE);
    expect(agent._myFightsNote(et(), 'Aldenmar')).toMatchObject({ code: CODE, role: 'guest' });
    agent._setMyFightsForTest([]);
    agent._setUploadOptsForTest(MEMBER);
    expect(agent._myFightsNote(et(), 'Aldenmar')).toMatchObject({ code: CODE, role: 'away' });
  });

  it('a recorded fight lands in the ring and the store tagged, with the whole local view kept', () => {
    agent._raidCodeSet(CODE);
    agent._recordFightHistory(et(), 'Aldenmar');
    expect(agent._fightHistoryForTest()[0]).toMatchObject({ boss: 'Corvale_the_Pale', raidCode: CODE, raidRole: 'guest' });
    const recs = storeA.scan('fight');
    expect(recs).toHaveLength(1);
    expect(recs[0].rec).toMatchObject({ mob: 'Corvale_the_Pale', raidCode: CODE, raidRole: 'guest' });
    expect(recs[0].rec.local.map(r => r.character).sort()).toEqual(['Aldenmar', 'Brackwyn', 'Corvale', 'Imp']);
    expect(recs[0].rec.deaths).toEqual([{ name: 'Rethlan', at: 120 }]);
  });

  it('a fight made with no code leaves the store alone', () => {
    agent._recordFightHistory(et(), 'Aldenmar');
    expect(storeA.scan('fight')).toHaveLength(0);
    expect(agent._fightHistoryForTest()[0].raidCode).toBeUndefined();
  });

  it('a recorded minute is tagged, its presence row too, and the nights list names the code', () => {
    recordMinute(storeA, T0, [{ name: 'Aldenmar', x: 10, y: 20 }]);
    expect(storeA.scan('track_minute')[0].rec.raid_code).toBeUndefined();
    agent._raidCodeSet(CODE);
    const row = recordMinute(storeA, T0 + MIN, [{ name: 'Aldenmar', x: 11, y: 21 }]);
    expect(row).toMatchObject({ raid_code: CODE, raid_role: 'guest' });
    const pres = storeA.scan('track_presence').map(e => e.rec);
    expect(pres.map(p => p.raid_code)).toEqual([undefined, CODE]);
    const nights = agent._localTrackNights(storeA, { now: T0 + HOUR });
    expect(nights.nights[0].codes).toEqual([CODE]);
    expect(nights.rows.filter(r => r.raid_code === CODE)).toHaveLength(1);
  });

  it('a loot line is kept under the code (this minute only), and nothing is kept with no code', () => {
    const e = { item: 'Pale Crown', looter: 'Aldenmar', zone: 'fear', atMs: Date.now() };
    expect(agent._raidCodeNoteLoot(e, 'Aldenmar', storeA)).toBe(false);
    agent._raidCodeSet(CODE);
    expect(agent._raidCodeNoteLoot(e, 'Aldenmar', storeA)).toBe(true);
    expect(agent._raidCodeNoteLoot({ ...e, atMs: Date.now() - 3 * HOUR }, 'Aldenmar', storeA)).toBe(false);   // an old line from a replay
    expect(storeA.scan('loot').map(x => x.rec)).toEqual([expect.objectContaining({ item: 'Pale Crown', raidCode: CODE, raidRole: 'guest' })]);
  });

  it('My parses answers code, role and imported for a code fight, and nothing extra for others', async () => {
    agent._recordFightHistory(et({ bossName: 'a fire giant', targetName: 'a fire giant', startedAt: iso(T0 - 2 * HOUR), flushedAt: T0 - 2 * HOUR + MIN }), 'Aldenmar');
    agent._raidCodeSet(CODE);
    agent._recordFightHistory(et(), 'Aldenmar');
    const out = await parsesOf(storeA);
    const byName = Object.fromEntries(out.fights.map(f => [f.name, f]));
    expect(byName['Corvale the Pale']).toMatchObject({ code: CODE, role: 'guest' });
    expect(byName['a fire giant'].code).toBeUndefined();
    expect(byName['a fire giant'].role).toBeUndefined();
    const detail = await agent._localParsesAnswer(`/api/local/parses/${byName['Corvale the Pale'].id}`, { store: storeA, opts: GUEST, waitMs: 0 });
    expect(detail.body.fight).toMatchObject({ code: CODE, role: 'guest', imported: false });
  });

  it('a member in someone else\'s raid is marked away, not GUEST', async () => {
    agent._setUploadOptsForTest(MEMBER);
    agent._raidCodeSet(CODE);
    agent._myFightsNote(et(), 'Aldenmar');
    agent._fightHistoryForTest().unshift({ boss: 'Corvale_the_Pale', startedMs: T0 + 5 * MIN, endedMs: T0 + 8 * MIN, durationSec: 180, local: [{ character: 'Aldenmar', dmg: 50_000 }], raidCode: CODE, raidRole: 'away' });
    const out = await agent._localParsesAnswer('/api/local/parses?scope=all', { store: storeA, opts: MEMBER, waitMs: 0 });
    expect(out.body.fights[0]).toMatchObject({ code: CODE, role: 'away' });
  });
});

// ---- 4. person_key ----
describe('person_key', () => {
  it('is random, made once, and kept: the same on every call and after a reopen', () => {
    const k = agent._raidPersonKey(storeA);
    expect(k).toMatch(/^pk_[0-9a-f]{32}$/);
    expect(agent._raidPersonKey(storeA)).toBe(k);
    expect(agent._raidPersonKey(agent._localStoreOpen(path.join(dir, 'a')))).toBe(k);
    expect(agent._raidPersonKey(storeB)).not.toBe(k);
  });

  it('holds no name and no Discord id: the file and the pack header carry only the key', () => {
    agent._raidCodeSet(CODE);
    agent._recordFightHistory(et(), 'Aldenmar');
    agent._raidPersonKey(storeA);
    const file = JSON.parse(fs.readFileSync(path.join(dir, 'a', 'person.json'), 'utf8'));
    expect(Object.keys(file).sort()).toEqual(['created', 'person_key', 'v']);
    const header = lines(agent._rmpackBuild(CODE, storeA).buffer)[0];
    expect(Object.keys(header).sort()).toEqual(['code', 'created', 'format', 'game', 'person_key', 'server', 'v']);
    expect(header).toMatchObject({ format: 'rmpack', v: 1, game: 'eq', server: 'quarm', code: CODE });
    const text = JSON.stringify(header) + JSON.stringify(file);
    for (const pii of ['Aldenmar', 'Brackwyn', 'discord', 'token', 'member']) expect(text.toLowerCase()).not.toContain(pii.toLowerCase());
    expect(text).not.toMatch(/\d{17,20}/);              // no Discord snowflake
  });
});

// ---- 5. export / import ----
/** PC A's night: a code fight with deaths, a loot line and two recorded minutes. */
function nightOnA() {
  agent._setUploadOptsForTest(GUEST);
  agent._raidCodeSet(CODE);
  agent._recordFightHistory(et(), 'Aldenmar');
  agent._raidCodeNoteLoot({ item: 'Pale Crown', looter: 'Aldenmar', zone: 'fear', atMs: Date.now() }, 'Aldenmar', storeA);
  recordMinute(storeA, T0 + 5 * MIN, [{ name: 'Aldenmar', x: 10, y: 20 }, { name: 'Brackwyn', x: 12, y: 22 }]);
  recordMinute(storeA, T0 + 6 * MIN, [{ name: 'Aldenmar', x: 13, y: 23 }]);
}
function resetPcGlobals() {
  agent._resetFightHistoryForTest();
  agent._setMyFightsForTest([]);
  agent._raidCodeClear();
}

describe('.rmpack export', () => {
  it('writes the header, then fight / player / death / loot / track_minute records, each with observed_by and a stable id', () => {
    nightOnA();
    const pk = agent._raidPersonKey(storeA);
    const a = agent._rmpackBuild(CODE, storeA);
    expect(a.filename).toBe('raid-BC-7KQ2.rmpack');
    expect(a.counts).toMatchObject({ fights: 1, players: 3, deaths: 1, loot: 1, track_minutes: 2 });
    const recs = lines(a.buffer).slice(1);
    expect(new Set(recs.map(r => r.t))).toEqual(new Set(['fight', 'player', 'death', 'loot', 'track_minute']));
    for (const r of recs) { expect(typeof r.id, r.t).toBe('string'); expect(r.observed_by, r.t).toEqual([pk]); }
    expect(recs.find(r => r.t === 'player' && r.name === 'Aldenmar')).toMatchObject({ dmg: 56_000, pet_dmg: 6000 });
    expect(recs.find(r => r.t === 'death')).toMatchObject({ name: 'Rethlan', at_sec: 120 });
    const b = agent._rmpackBuild(CODE, storeA);
    expect(lines(b.buffer).slice(1).map(r => r.id)).toEqual(recs.map(r => r.id));    // stable across exports
  });

  it('carries only what was made under THAT code', () => {
    agent._recordFightHistory(et({ bossName: 'a fire giant', targetName: 'a fire giant', startedAt: iso(T0 - 3 * HOUR), flushedAt: T0 - 3 * HOUR + MIN }), 'Aldenmar');
    recordMinute(storeA, T0 - 3 * HOUR, [{ name: 'Aldenmar', x: 1, y: 2 }]);
    nightOnA();
    const a = agent._rmpackBuild(CODE, storeA);
    expect(a.counts).toMatchObject({ fights: 1, track_minutes: 2 });
    expect(agent._rmpackBuild('XY-ABCD', storeA).counts).toMatchObject({ fights: 0, track_minutes: 0, loot: 0 });
    expect(() => agent._rmpackBuild('nope', storeA)).toThrow(/looks like BC-7KQ2/);
  });

  it('GET /api/local/raid-code/export?code= answers a download', async () => {
    nightOnA();
    const res = mockRes();
    expect(await agent._raidCodeRoute(mockReq('GET', `/api/local/raid-code/export?code=${CODE}`), res)).toBe(true);
    expect(res.status).toBe(200);
    expect(res.headers['Content-Disposition']).toBe('attachment; filename="raid-BC-7KQ2.rmpack"');
    expect(lines(res.body)[0].format).toBe('rmpack');
    const bad = mockRes();
    await agent._raidCodeRoute(mockReq('GET', '/api/local/raid-code/export?code=zzz'), bad);
    expect(bad.status).toBe(400);
    const noCode = mockRes();
    agent._raidCodeClear();
    await agent._raidCodeRoute(mockReq('GET', '/api/local/raid-code/export'), noCode);   // no code typed and none active
    expect(noCode.status).toBe(400);
  });
});

describe('.rmpack import: another person\'s pack merges into this PC', () => {
  it('round trip: PC B sees A\'s fight, players, deaths, loot and minutes under the code, marked GUEST, observed by A', async () => {
    nightOnA();
    const pkA = agent._raidPersonKey(storeA);
    const pack = agent._rmpackBuild(CODE, storeA).buffer;
    resetPcGlobals();
    agent._localTrackSetStoreForTest(storeB);
    const out = agent._rmpackImport(pack, storeB);
    expect(out).toMatchObject({ ok: true, code: CODE, from_self: false, fights: { added: 1, merged: 0 }, players: 3, loot: { added: 1 }, minutes: { added: 2, merged: 0 }, skipped: 0 });

    const list = await parsesOf(storeB);
    expect(list.fights).toHaveLength(1);
    expect(list.fights[0]).toMatchObject({ name: 'Corvale the Pale', code: CODE, role: 'guest', imported: true, detail: true, players_n: 3 });
    const d = await agent._localParsesAnswer(`/api/local/parses/${list.fights[0].id}`, { store: storeB, opts: GUEST, waitMs: 0 });
    expect(d.body.fight.players.map(p => [p.name, p.dmg])).toEqual([['Brackwyn', 80_000], ['Aldenmar', 56_000], ['Corvale', 30_000]]);
    expect(d.body.fight.deaths).toEqual([{ name: 'Rethlan', at_sec: 120 }]);
    expect(storeB.scan('fight')[0].rec.observedBy).toEqual([pkA]);
    expect(storeB.scan('loot')[0].rec).toMatchObject({ item: 'Pale Crown', raidCode: CODE, raidRole: 'guest', imported: true });
    expect(agent._localTrackNights(storeB, { now: T0 + HOUR }).nights[0].codes).toEqual([CODE]);
    const win = agent._localTrackWindow(storeB, { from: iso(T0 + 5 * MIN), to: iso(T0 + 8 * MIN) });
    expect(win.body.rows.map(r => r.minute_at)).toEqual([iso(T0 + 5 * MIN), iso(T0 + 6 * MIN)]);
  });

  it('importing the same pack again changes nothing (fights are deduped, minutes are not doubled)', async () => {
    nightOnA();
    const pack = agent._rmpackBuild(CODE, storeA).buffer;
    resetPcGlobals();
    agent._rmpackImport(pack, storeB);
    const before = JSON.stringify([storeB.scan('fight').map(e => e.rec), storeB.scan('track_minute').map(e => e.rec)]);
    const again = agent._rmpackImport(pack, storeB);
    expect(again).toMatchObject({ fights: { added: 0, merged: 1 }, players: 0, loot: { added: 0, merged: 1 }, minutes: { added: 0, merged: 2 } });
    expect(JSON.stringify([storeB.scan('fight').map(e => e.rec), storeB.scan('track_minute').map(e => e.rec)])).toBe(before);
    expect((await parsesOf(storeB)).fights).toHaveLength(1);
  });

  it('a fight both PCs recorded, a few minutes apart, is ONE fight: players unioned, the larger damage wins, both observers kept', async () => {
    nightOnA();
    const pkA = agent._raidPersonKey(storeA);
    const pack = agent._rmpackBuild(CODE, storeA).buffer;
    resetPcGlobals();
    // PC B: in the same raid, saw the pull 4 minutes later by its own clock, and saw less of Brackwyn, more of Corvale.
    agent._localTrackSetStoreForTest(storeB);
    agent._raidCodeSet(CODE);
    agent._recordFightHistory(et({ startedAt: iso(T0 + 9 * MIN), flushedAt: T0 + 12 * MIN, deaths: [],
      perPlayer: { Corvale: { dmg: 35_000 }, Brackwyn: { dmg: 70_000 }, Zarrin: { dmg: 9000 } } }), 'Zarrin');
    const out = agent._rmpackImport(pack, storeB);
    expect(out.fights).toEqual({ added: 0, merged: 1 });
    expect(out.players).toBe(1);                           // only Aldenmar was new to B
    const list = await parsesOf(storeB);
    expect(list.fights).toHaveLength(1);
    const d = await agent._localParsesAnswer(`/api/local/parses/${list.fights[0].id}`, { store: storeB, opts: GUEST, waitMs: 0 });
    expect(d.body.fight.players.map(p => [p.name, p.dmg])).toEqual([['Brackwyn', 80_000], ['Aldenmar', 56_000], ['Corvale', 35_000], ['Zarrin', 9000]]);
    expect(d.body.fight.deaths).toEqual([{ name: 'Rethlan', at_sec: 120 }]);
    const pkB = agent._raidPersonKey(storeB);
    expect(new Set(storeB.scan('fight').flatMap(e => e.rec.observedBy))).toEqual(new Set(['@self', pkA]));
    // Exported again from B, the merged fight names both observers.
    const re = lines(agent._rmpackBuild(CODE, storeB).buffer).filter(r => r.t === 'fight');
    expect(re).toHaveLength(1);
    expect(new Set(re[0].observed_by)).toEqual(new Set([pkB, pkA]));
  });

  it('two fights of one mob more than 30 minutes apart stay two fights', async () => {
    nightOnA();
    const pack = agent._rmpackBuild(CODE, storeA).buffer;
    resetPcGlobals();
    agent._localTrackSetStoreForTest(storeB);
    agent._raidCodeSet(CODE);
    agent._recordFightHistory(et({ startedAt: iso(T0 + 50 * MIN), flushedAt: T0 + 53 * MIN, deaths: [] }), 'Zarrin');
    expect(agent._rmpackImport(pack, storeB).fights).toEqual({ added: 1, merged: 0 });
    expect((await parsesOf(storeB)).fights).toHaveLength(2);
  });

  it('a fight of B\'s own made with no code takes the code when the pack matches it (B was there)', async () => {
    nightOnA();
    const pack = agent._rmpackBuild(CODE, storeA).buffer;
    resetPcGlobals();
    agent._localTrackSetStoreForTest(storeB);
    agent._recordFightHistory(et({ startedAt: iso(T0 + 5 * MIN), flushedAt: T0 + 8 * MIN }), 'Zarrin');   // no code on
    expect((await parsesOf(storeB)).fights[0].code).toBeUndefined();
    agent._rmpackImport(pack, storeB);
    const list = await parsesOf(storeB);
    expect(list.fights).toHaveLength(1);
    expect(list.fights[0]).toMatchObject({ code: CODE, role: 'guest' });
  });

  it('minute rows are unioned by (minute, name): a name both saw keeps this PC\'s frames, a name only the pack saw is added', () => {
    nightOnA();                                              // A: Aldenmar (10,20) and Brackwyn (12,22) in minute T0+5
    const pack = agent._rmpackBuild(CODE, storeA).buffer;
    resetPcGlobals();
    recordMinute(storeB, T0 + 5 * MIN, [{ name: 'Brackwyn', x: 99, y: 98 }, { name: 'Corvale', x: 50, y: 51 }]);
    const out = agent._rmpackImport(pack, storeB);
    expect(out.minutes).toEqual({ added: 1, merged: 1 });   // T0+6 is new to B, T0+5 merges
    const row = storeB.get('track_minute', iso(T0 + 5 * MIN), { ts: T0 + 5 * MIN });
    const data = JSON.parse(row.data);
    expect(data.who.map(w => w[0]).sort()).toEqual(['Aldenmar', 'Brackwyn', 'Corvale']);
    const at = (name) => { const i = data.who.findIndex(w => w[0] === name); const fr = data.f[0]; for (let j = 1; j < fr.length; j += 7) if (fr[j] === i) return [fr[j + 1], fr[j + 2]]; return null; };
    expect((data.f[0].length - 1) / 7).toBe(3);             // one placement per name in the shared second: nobody twice
    expect(at('Brackwyn')).toEqual([99, 98]);                // this PC's, not the pack's (12, 22)
    expect(at('Aldenmar')).toEqual([10, 20]);
    expect(at('Corvale')).toEqual([50, 51]);
    expect(row).toMatchObject({ raiders: 3, raid_code: CODE });
    expect(new Set(row.observed_by)).toEqual(new Set(['@self', agent._raidPersonKey(storeA)]));
    const pres = storeB.get('track_presence', iso(T0 + 5 * MIN), { ts: T0 + 5 * MIN });
    expect(pres).toMatchObject({ raiders: 3, raid_code: CODE });
  });

  it('POST /api/local/raid-code/import merges the body; the answer says what happened', async () => {
    nightOnA();
    const pack = agent._rmpackBuild(CODE, storeA).buffer;
    resetPcGlobals();
    agent._localTrackSetStoreForTest(storeB);
    const res = mockRes();
    expect(await agent._raidCodeRoute(mockReq('POST', '/api/local/raid-code/import', pack), res)).toBe(true);
    expect(res.status).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, code: CODE, fights: { added: 1 } });
    const wrong = mockRes();
    await agent._raidCodeRoute(mockReq('GET', '/api/local/raid-code/import'), wrong);
    expect(wrong.status).toBe(405);
  });

  it('refuses what is not a pack, and skips a hostile minute row instead of trusting it', () => {
    const gz = (objs) => zlib.gzipSync(Buffer.from(objs.map(o => JSON.stringify(o)).join('\n') + '\n'));
    const header = { format: 'rmpack', v: 1, person_key: 'pk_' + 'a'.repeat(32), game: 'eq', server: 'quarm', code: CODE, created: iso(T0) };
    expect(() => agent._rmpackImport(Buffer.from('not gzip at all'), storeB)).toThrow(/not a raid pack/);
    expect(() => agent._rmpackImport(Buffer.alloc(0), storeB)).toThrow(/empty/);
    expect(() => agent._rmpackImport(gz([{ format: 'zip', v: 1 }]), storeB)).toThrow(/not a raid pack/);
    expect(() => agent._rmpackImport(gz([{ ...header, v: 2 }]), storeB)).toThrow(/newer version/);
    expect(() => agent._rmpackImport(gz([{ ...header, person_key: 'Aldenmar' }]), storeB)).toThrow(/bad header/);
    expect(() => agent._rmpackImport(gz([{ ...header, code: 'nope' }]), storeB)).toThrow(/bad header/);
    const good = { v: 1, step_s: 3, who: [['Aldenmar', 'Warrior', 1, 60]], zones: ['pofire'], f: [[3, 0, 10, 20, 0, 128, 100, 0]] };
    const hostile = [
      { ...good, f: [[3, 7, 10, 20, 0, 128, 100, 0]] },                     // a who index past the end
      { ...good, f: [[3, 0, 10, 20, 0, 128, 100, 5]] },                     // a zone index past the end
      { ...good, who: [['<script>', null, 1, 60]] },                        // not a name
      { ...good, f: [[3, 0, 10, 20, 0, 128, 100]] },                        // a short frame
      { ...good, f: [[99, 0, 10, 20, 0, 128, 100, 0]] },                    // a second past the minute
      { ...good, f: [[3, 0, 'x', 20, 0, 128, 100, 0]] },                    // not a number
    ];
    const recs = hostile.map((d, i) => ({ t: 'track_minute', id: 'm' + i, observed_by: [header.person_key], row: { minute_at: iso(T0 + i * MIN), data: JSON.stringify(d) } }));
    recs.push({ t: 'track_minute', id: 'ok', observed_by: [header.person_key], row: { minute_at: iso(T0 + 20 * MIN), data: JSON.stringify(good) } });
    recs.push({ t: 'track_minute', id: 'odd', observed_by: [header.person_key], row: { minute_at: iso(T0 + 30 * MIN + 5), data: JSON.stringify(good) } });   // not on a minute
    const out = agent._rmpackImport(gz([header, ...recs]), storeB);
    expect(out.minutes).toEqual({ added: 1, merged: 0 });
    expect(out.skipped).toBe(hostile.length + 1);
    expect(storeB.scan('track_minute')).toHaveLength(1);
  });

  it('a pack that unzips past the cap is refused, not inflated', () => {
    const big = zlib.gzipSync(Buffer.alloc(70 * 1024 * 1024, 0x20));
    expect(big.length).toBeLessThan(5 * 1024 * 1024);
    expect(() => agent._rmpackImport(big, storeB)).toThrow(/not a raid pack/);
  });

  it('a pack from this same PC is recognised', () => {
    nightOnA();
    const pack = agent._rmpackBuild(CODE, storeA).buffer;
    expect(agent._rmpackImport(pack, storeA).from_self).toBe(true);
  });
});

describe('POST/GET /api/raid-code', () => {
  it('joins with a code, reports it, and clears it', async () => {
    const join = mockRes();
    await agent._raidCodeRoute(mockReq('POST', '/api/raid-code', Buffer.from(JSON.stringify({ code: 'bc 7kq2' }))), join);
    expect(join.status).toBe(200);
    expect(join.json().raid).toMatchObject({ code: CODE, role: 'guest' });
    const get = mockRes();
    await agent._raidCodeRoute(mockReq('GET', '/api/raid-code'), get);
    expect(get.json()).toMatchObject({ ok: true, raid: { code: CODE } });
    const bad = mockRes();
    await agent._raidCodeRoute(mockReq('POST', '/api/raid-code', Buffer.from(JSON.stringify({ code: 'nope' }))), bad);
    expect(bad.status).toBe(400);
    expect(agent._raidCodeActive()).toMatchObject({ code: CODE });          // a bad code did not end the good one
    const clear = mockRes();
    await agent._raidCodeRoute(mockReq('POST', '/api/raid-code', Buffer.from(JSON.stringify({ clear: true }))), clear);
    expect(clear.json()).toEqual({ ok: true, raid: null });
    expect(agent._raidCodeActive()).toBeNull();
  });

  it('is the dashboard\'s state too: /api/state carries raidCode', () => {
    const src = stripJs(readSource(AGENT_INDEX));
    expect(src).toMatch(/raidCode:\s+_raidCodeStatus\(\),/);
    expect(src).toMatch(/if \(await _raidCodeRoute\(req, res\)\) return;/);
  });
});

// ---- 6. the surfaces ----
describe('surfaces', () => {
  const dash = stripJs(read('packages/wolfpack-logsync/dashboard.html'));
  const main = stripJs(read('apps/mimic/main.js'));

  it('the dashboard has the card (above Rebuild), a rail button, a render hook and the #raidcode link', () => {
    expect(dash).toMatch(/<div id="wpRaidCode" class="card wide"><\/div>[^]*?<div id="wpRebuild" class="card wide"><\/div>/);
    expect(dash).toMatch(/id="wpLocalRaid"[^>]*onclick="wpRaidCodeOpen\(\)"/);
    expect(dash).toMatch(/\['raidcode', renderRaidCodeCard\]/);
    expect(dash).toMatch(/'#raidcode'/);
    expect(dash).toMatch(/fetch\('\/api\/raid-code'/);
    expect(dash).toMatch(/fetch\('\/api\/local\/raid-code\/export\?code='/);
    expect(dash).toMatch(/fetch\('\/api\/local\/raid-code\/import'/);
    expect(dash).toMatch(/running ' \+ esc\(wpRcDur\(now - r\.since\)\)/);
  });

  it('the tray has the same item, shows a running pass, and can end it', () => {
    expect(main).toMatch(/\.\.\._raidCodeTrayItems\(\),/);
    expect(main).toMatch(/Join a raid with a code…', click: \(\) => showDashboardTab\('raidcode'\)/);
    expect(main).toMatch(/_agentCall\('POST', '\/api\/raid-code', \{ clear: true \}\)/);
    expect(main).toMatch(/_agentCall\('GET', '\/api\/raid-code'\)/);
  });

  it('My parses shows the code badge, GUEST and away raid', () => {
    const page = stripJs(read('web/local/app/parses/LocalParses.tsx'));
    expect(page).toMatch(/function CodeBadge\(/);
    expect(page).toMatch(/Raid code \{code\}/);
    expect(page).toMatch(/role === 'guest'[^]*?GUEST/);
    expect(page).toMatch(/role === 'away'[^]*?away raid/);
    expect((page.match(/<CodeBadge /g) || []).length).toBe(2);     // the list row and the fight's title
  });

  it('My replay names the code beside the night and the session', () => {
    const page = stripJs(read('web/local/app/replay/LocalReplay.tsx'));
    expect(page).toMatch(/raid_code/);
    expect(page).toMatch(/Raid code \$\{c\}|Raid code \{c\}/);
  });
});
