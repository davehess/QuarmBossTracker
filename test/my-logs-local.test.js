// test/my-logs-local.test.js — the "My logs" half of the 📈 My parses tab: a slim fight log this PC keeps for
// the player's own characters, and the answer that reads it (the guild lead, 2026-10-06: "I'd like the user to
// be able to toggle between their data from logs and the guild's data").
//
// Four pieces, each run for real:
//   1. recording — one row per OWN character when a fight ends, from the hook that feeds the DPS meter's History
//      ring (the builder's character, its owned pets credited to it, no row for anybody else's damage);
//   2. the file — 365 days / 20,000 rows, written 10 s after a change, read back clean, seeded from the ring on
//      a first run only;
//   3. the answer — the guild answer's shape from those rows: window, scope, character, zone and search
//      filters, the zone and mob pickers, the raid nights, "usual", the 400-fight cut;
//   4. the pieces both sources agree on (the raid-night date) and the signed-out guarantee (no network).
//
// Names in the fixtures are invented. Run: npx vitest run test/my-logs-local.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js');
const AGENT_SRC = readSource(AGENT_INDEX);
const DASH = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));

const DAY = 86400_000;
const S = Date.UTC(2026, 9, 5, 1, 17, 0);            // Oct 4, 9:17 pm Eastern
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);          // Oct 7, 8 am Eastern
const iso = (ms) => new Date(ms).toISOString();

// A fight as the builder hands it to _recordFightHistory: its last snapshot with flushedAt stamped.
const ET = (over) => ({
  bossName: 'Aten Ha Ra', targetName: 'Aten Ha Ra', startedAt: iso(S), flushedAt: S + 120_000,
  perPlayer: {
    Brackwyn: { dmg: 60_000 }, Corvale: { dmg: 90_000 },
    Warder: { dmg: 12_000, pet_owner: 'Brackwyn' }, Imp: { dmg: 5_000, pet_owner: 'Corvale' },
  },
  ...over,
});
// A row as the log stores it.
const R = (t, over) => ({ t: iso(t), end: iso(t + 100_000), mob: 'Aten Ha Ra', zone: 'Plane of Fire', char: 'Brackwyn', dmg: 100_000, dur: 100, dps: 1000, boss: true, ...over });

let tmp;
beforeEach(() => {
  agent._myFightsPersistForTest();                   // disarm, clear
  agent._resetFightHistoryForTest();
  agent._setWatchedLogsForTest([]);
  agent._mobInfoByNameForTest().clear();
  for (const n of ['Brackwyn', 'Corvale', 'brackwyn']) agent._setZealStateForTest(n, null);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'myfights-'));
});
afterEach(() => {
  agent._myFightsPersistForTest();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fs.rmSync(tmp, { recursive: true, force: true });
});
const rows = () => agent._myFightsForTest();

// ── 1. recording ────────────────────────────────────────────────────────────
describe('recording a fight', () => {
  it('writes one row for the builder\'s own character: its damage plus its owned pets, in the stored shape', () => {
    const row = agent._myFightsNote(ET(), 'Brackwyn');
    expect(row).toEqual({ t: iso(S), end: iso(S + 120_000), mob: 'Aten Ha Ra', zone: null, char: 'Brackwyn', dmg: 72_000, dur: 120, dps: 600, boss: false });
    expect(Object.keys(row)).toEqual(['t', 'end', 'mob', 'zone', 'char', 'dmg', 'dur', 'dps', 'boss']);
    expect(rows()).toEqual([row]);
  });

  it('credits nobody else: another raider\'s row, their pet, an unowned pet and a charmed mob add nothing', () => {
    const row = agent._myFightsNote(ET({ perPlayer: {
      Brackwyn: { dmg: 1000 }, Corvale: { dmg: 90_000 }, Imp: { dmg: 9000, pet_owner: 'Corvale' },
      'a gnoll warlord': { dmg: 5000, pet_charm: true }, Strayfang: { dmg: 7000, pet_summoned: true },
    } }), 'Brackwyn');
    expect(row.dmg).toBe(1000);
  });

  it('a charmer with no row of their own is still credited with the pet (the normal case for one)', () => {
    const row = agent._myFightsNote(ET({ perPlayer: { 'a Shissar acolyte': { dmg: 4000, pet_owner: 'Brackwyn' } } }), 'Brackwyn');
    expect(row.dmg).toBe(4000);
  });

  it('matches the character and the pet owner without caring about case', () => {
    const row = agent._myFightsNote(ET({ perPlayer: { BRACKWYN: { dmg: 10 }, Warder: { dmg: 20, pet_owner: 'brackwyn' } } }), 'Brackwyn');
    expect(row.dmg).toBe(30);
  });

  it('writes nothing for a fight with no damage of its own, no start, no mob, or no character', () => {
    expect(agent._myFightsNote(ET({ perPlayer: { Corvale: { dmg: 90_000 } } }), 'Brackwyn')).toBeNull();
    expect(agent._myFightsNote(ET({ perPlayer: { Brackwyn: { heal: 5000, dmg: 0 } } }), 'Brackwyn')).toBeNull();
    expect(agent._myFightsNote(ET({ startedAt: null }), 'Brackwyn')).toBeNull();
    expect(agent._myFightsNote(ET({ startedAt: 'yesterday' }), 'Brackwyn')).toBeNull();
    expect(agent._myFightsNote(ET({ bossName: null, targetName: null }), 'Brackwyn')).toBeNull();
    expect(agent._myFightsNote(ET(), '')).toBeNull();
    expect(agent._myFightsNote(null, 'Brackwyn')).toBeNull();
    expect(rows()).toEqual([]);
  });

  it('names the mob as the ring does (the boss, else the most-damaged target) and the fight\'s own seconds as its length', () => {
    expect(agent._myFightsNote(ET({ bossName: null, targetName: 'a Shissar acolyte' }), 'Brackwyn').mob).toBe('a Shissar acolyte');
    const r = agent._myFightsNote(ET({ startedAt: iso(S + 500_000), flushedAt: S + 500_000 + 90_400, perPlayer: { Brackwyn: { dmg: 12_345 } } }), 'Brackwyn');
    expect(r.dur).toBe(90);
    expect(r.dps).toBe(137.2);                                         // 12,345 / 90, one decimal
    expect(agent._myFightsNote(ET({ startedAt: iso(S + 900_000), flushedAt: S + 900_000, perPlayer: { Brackwyn: { dmg: 50 } } }), 'Brackwyn').dur, 'never under a second').toBe(1);
  });

  it('is one row per (character, mob, start within 8 s): a repeated flush is one row, two characters on one PC are two', () => {
    expect(agent._myFightsNote(ET(), 'Brackwyn')).not.toBeNull();
    expect(agent._myFightsNote(ET({ startedAt: iso(S + 7_000) }), 'Brackwyn'), 'the same fight, flushed again').toBeNull();
    expect(agent._myFightsNote(ET(), 'Corvale'), 'the other character on this PC').not.toBeNull();
    expect(agent._myFightsNote(ET({ startedAt: iso(S + 9_000), flushedAt: S + 130_000 }), 'Brackwyn'), 'a real second kill pulled right behind').not.toBeNull();
    expect(agent._myFightsNote(ET({ bossName: 'Lord Nagafen', targetName: 'Lord Nagafen' }), 'Brackwyn'), 'another mob at the same moment').not.toBeNull();
    expect(rows().map(r => r.char + ':' + r.mob)).toEqual(['Brackwyn:Aten Ha Ra', 'Corvale:Aten Ha Ra', 'Brackwyn:Aten Ha Ra', 'Brackwyn:Lord Nagafen']);
  });

  it('comes from the History ring\'s own hook, before its one-entry-per-fight guard, so the ring has one entry and the log has both characters', () => {
    agent._recordFightHistory(ET(), 'Brackwyn');
    agent._recordFightHistory(ET(), 'Corvale');
    expect(agent._fightHistoryForTest(), 'the ring still keeps one entry for the fight').toHaveLength(1);
    expect(rows().map(r => [r.char, r.dmg])).toEqual([['Brackwyn', 72_000], ['Corvale', 95_000]]);
    agent._recordFightHistory(ET({ bossName: null, targetName: null }), 'Brackwyn');
    expect(rows(), 'a fight with no mob is in neither').toHaveLength(2);
  });

  it('can never break History: the call is wrapped, and sits ahead of the ring\'s own work', () => {
    const body = stripJs(sliceBlock(AGENT_SRC, 'function _recordFightHistory(et, character) {', '\n}\n'));
    expect(body).toMatch(/try \{ _myFightsNote\(et, character\); \} catch \{ void 0; \}/);
    expect(body.indexOf('_myFightsNote(et, character)')).toBeLessThan(body.indexOf('const dupe ='));
    expect(body.indexOf('_myFightsNote(et, character)')).toBeGreaterThan(body.indexOf('if (!boss) return;'));
  });

});

describe('where and what it was', () => {
  it('names the zone Zeal last put that character in, by its long name', () => {
    agent._setZealStateForTest('Brackwyn', { zone: 217, updatedAt: Date.now() });
    expect(agent._myFightZone('Brackwyn')).toEqual({ id: 217, name: 'Plane of Fire' });
    expect(agent._myFightZone('brackwyn'), 'any case').toEqual({ id: 217, name: 'Plane of Fire' });
    expect(agent._myFightsNote(ET(), 'Brackwyn').zone).toBe('Plane of Fire');
    agent._setZealStateForTest('Brackwyn', { zone: 999, updatedAt: Date.now() });
    expect(agent._myFightZone('Brackwyn').name, 'an id the table does not know').toBe('Zone 999');
  });

  it('has no zone when Zeal is not connected for that character, or its last word is old', () => {
    expect(agent._myFightZone('Brackwyn')).toEqual({ id: null, name: null });
    agent._setZealStateForTest('Corvale', { zone: 217, updatedAt: Date.now() });
    expect(agent._myFightZone('Brackwyn'), 'another character\'s zone is not this one\'s').toEqual({ id: null, name: null });
    agent._setZealStateForTest('Brackwyn', { zone: 217, updatedAt: Date.now() - 11 * 60_000 });
    expect(agent._myFightZone('Brackwyn')).toEqual({ id: null, name: null });
    agent._setZealStateForTest('Brackwyn', { zone: 0, updatedAt: Date.now() });
    expect(agent._myFightZone('Brackwyn')).toEqual({ id: null, name: null });
    expect(agent._myFightsNote(ET(), 'Brackwyn').zone).toBeNull();
  });

  it('is a boss only when a catalog row this machine already holds says raid_target; false otherwise', () => {
    const cache = agent._mobInfoByNameForTest();
    expect(agent._myFightsNote(ET(), 'Brackwyn').boss, 'nothing held').toBe(false);
    cache.set('aten_ha_ra|217|aten_Ha_Ra', { at: Date.now(), mob: { name: 'Aten Ha Ra', raid_target: true } });
    agent._setZealStateForTest('Brackwyn', { zone: 217, updatedAt: Date.now() });
    expect(agent._myFightsNote(ET({ startedAt: iso(S + 30_000) }), 'Brackwyn').boss, 'the row for that zone').toBe(true);
    expect(agent._myFightsNote(ET({ bossName: 'a gnoll', targetName: 'a gnoll', startedAt: iso(S + 60_000) }), 'Brackwyn').boss, 'another mob').toBe(false);
    cache.clear();
    cache.set('aten_ha_ra|61|aten_Ha_Ra', { at: Date.now(), mob: { name: 'Aten Ha Ra', raid_target: true } });
    agent._setZealStateForTest('Brackwyn', null);
    expect(agent._myFightsNote(ET({ startedAt: iso(S + 600_000) }), 'Brackwyn').boss, 'a row held under another zone\'s bucket, none known for this fight').toBe(true);
    cache.set('aten_ha_ra|61|aten_Ha_Ra', { at: Date.now(), mob: { name: 'Aten Ha Ra', raid_target: false } });
    expect(agent._myFightsNote(ET({ startedAt: iso(S + 1_200_000) }), 'Brackwyn').boss, 'a held row that is not a raid target').toBe(false);
    cache.set('aten_ha_ra|61|aten_Ha_Ra', { at: Date.now(), mob: null });
    expect(agent._myFightsNote(ET({ startedAt: iso(S + 1_800_000) }), 'Brackwyn').boss, 'a lookup that found nothing').toBe(false);
  });

  it('prefers the zone pack, then the Mob Info answer for the zone, then any held row, and never throws', () => {
    const src = sliceBlock(AGENT_SRC, 'function _myFightIsBoss(mob, zoneId) {', '\n}\n');
    const make = (o) => new Function('_mobPackLookup', '_mobInfoByName', '_mobInfoCacheKey', '_npcMobInfoFor', src + '\nreturn _myFightIsBoss;')(
      o.pack || (() => null), o.cache || new Map(), (n, z) => n + '|' + z, o.any || (() => null));
    expect(make({ pack: () => ({ raid_target: true }) })('x', 61)).toBe(true);
    expect(make({ pack: () => ({ raid_target: false }), any: () => ({ raid_target: true }) })('x', 61), 'a pack row decides').toBe(false);
    expect(make({ cache: new Map([['x|61', { mob: { raid_target: true } }]]) })('x', 61)).toBe(true);
    expect(make({ any: () => ({ raid_target: true }) })('x', 61)).toBe(true);
    expect(make({ pack: () => { throw new Error('pack unreadable'); } })('x', 61)).toBe(false);
    const asked = [];
    make({ pack: (n, z) => { asked.push([n, z]); return null; } })('x', null);
    expect(asked, 'no zone, no pack lookup').toEqual([]);
    expect(make({})('x', 61)).toBe(false);
  });
});

describe('the cap and the age', () => {
  const light = (i, end) => ({ t: iso(end - 100_000), end: iso(end), mob: 'm' + i, zone: null, char: 'Brackwyn', dmg: 10, dur: 1, dps: 10, boss: false });

  it('keeps 20,000 rows and 365 days', () => {
    expect(agent.MYFIGHTS_MAX).toBe(20_000);
    expect(agent.MYFIGHTS_KEEP_MS).toBe(365 * DAY);
    expect(agent.MYFIGHTS_CAP, 'and an answer carries the newest 400, like the guild\'s').toBe(400);
  });

  it('drops the oldest past 20,000, keeping the newest', () => {
    const now = NOW;
    agent._setMyFightsForTest(Array.from({ length: 20_003 }, (_, i) => light(i, now - DAY + i * 1000)));
    agent._trimMyFights(now);
    expect(rows()).toHaveLength(20_000);
    expect(rows()[0].mob).toBe('m3');
    expect(rows()[19_999].mob).toBe('m20002');
  });

  it('a new fight at the cap pushes the oldest out', () => {
    agent._setMyFightsForTest(Array.from({ length: 20_000 }, (_, i) => light(i, Date.now() - DAY + i * 1000)));
    agent._myFightsNote(ET(), 'Brackwyn');
    expect(rows()).toHaveLength(20_000);
    expect(rows()[0].mob).toBe('m1');
    expect(rows()[19_999].mob).toBe('Aten Ha Ra');
  });

  it('drops rows older than 365 days by when they ended, and keeps the one that is exactly 365 days old', () => {
    const now = NOW;
    agent._setMyFightsForTest([light(1, now - 365 * DAY - 1), light(2, now - 365 * DAY), light(3, now - 400 * DAY), light(4, now)]);
    agent._trimMyFights(now);
    expect(rows().map(r => r.mob)).toEqual(['m2', 'm4']);
  });
});

// ── 2. the file ─────────────────────────────────────────────────────────────
describe('the file', () => {
  const file = () => path.join(tmp, 'logsync.myfights.json');

  it('is written 10 s after a change (once, however many fights), by .tmp and rename, and reads back as it was', () => {
    expect(agent.MYFIGHTS_SAVE_MS).toBe(10_000);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    agent._myFightsPersistForTest(file());
    agent._myFightsNote(ET(), 'Brackwyn');
    vi.advanceTimersByTime(4_000);
    agent._myFightsNote(ET({ startedAt: iso(S + 60_000), flushedAt: S + 90_000 }), 'Corvale');
    vi.advanceTimersByTime(5_999);
    expect(fs.existsSync(file()), 'not before 10 s').toBe(false);
    vi.advanceTimersByTime(1);
    expect(fs.existsSync(file())).toBe(true);
    expect(fs.existsSync(file() + '.tmp'), 'renamed into place').toBe(false);
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
    expect(saved).toMatchObject({ v: 1 });
    expect(saved.rows.map(r => r.char)).toEqual(['Brackwyn', 'Corvale']);
    const before = rows().slice();
    agent._setMyFightsForTest([]);
    expect(agent._loadMyFights(file(), Date.now())).toBe(true);
    expect(rows()).toEqual(before);
  });

  it('is not written at all until main() arms it: a bare require() never touches the disk', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    agent._myFightsNote(ET(), 'Brackwyn');
    vi.advanceTimersByTime(60_000);
    expect(fs.readdirSync(tmp)).toEqual([]);
    expect(rows()).toHaveLength(1);
  });

  it('reads "no file" for a missing, unreadable or rowless file, and a file for an empty one', () => {
    expect(agent._loadMyFights(file())).toBe(false);
    fs.writeFileSync(file(), 'not json');
    expect(agent._loadMyFights(file())).toBe(false);
    fs.writeFileSync(file(), JSON.stringify({ v: 1, fights: [] }));
    expect(agent._loadMyFights(file())).toBe(false);
    fs.writeFileSync(file(), JSON.stringify({ v: 1, rows: [] }));
    expect(agent._loadMyFights(file())).toBe(true);
    expect(rows()).toEqual([]);
  });

  it('keeps only rows that are fights, with only the known keys, and prunes by age on the way in', () => {
    const now = Date.now();
    const good = R(now - 3 * DAY);
    const junk = [
      null, 5, 'x', {}, { ...good, t: 'nope' }, { ...good, end: null }, { ...good, mob: '' }, { ...good, char: '  ' },
      { ...good, dmg: 0 }, { ...good, dmg: -5 }, { ...good, dur: 0 }, { ...good, dmg: 'lots' },
      R(now - 400 * DAY),
    ];
    const extra = { ...good, evil: '<script>', zone: 'z'.repeat(200), mob: 'm'.repeat(300), boss: 'yes' };
    fs.writeFileSync(file(), JSON.stringify({ v: 1, rows: [...junk, good, extra] }));
    expect(agent._loadMyFights(file(), now)).toBe(true);
    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toEqual(good);
    expect(Object.keys(rows()[1])).toEqual(['t', 'end', 'mob', 'zone', 'char', 'dmg', 'dur', 'dps', 'boss']);
    expect(rows()[1].zone).toHaveLength(64);
    expect(rows()[1].mob).toHaveLength(120);
    expect(rows()[1].boss, 'only a real true is a boss').toBe(false);
  });

  describe('the first run', () => {
    const ring = (over) => ({ boss: 'Aten Ha Ra', startedMs: S, endedMs: S + 120_000, durationSec: 120, settled: true,
      local: [{ character: 'Brackwyn', dmg: 50_000 }, { character: 'Warder', dmg: 10_000, pet_owner: 'Brackwyn' }, { character: 'Corvale', dmg: 70_000 }, { character: 'Stranger', dmg: 90_000 }], ...over });
    const watch = (...names) => agent._setWatchedLogsForTest(names.map(n => ({ character: n, logPath: n + '.txt', lastSeen: null })));

    it('seeds one row per watched character in each ring fight, oldest first, and saves at once', () => {
      watch('Brackwyn', 'Corvale');
      const h = agent._fightHistoryForTest();
      h.push(ring({ boss: 'Lady Vox', startedMs: S + 3_600_000, endedMs: S + 3_700_000, durationSec: 100 }));    // the ring is newest first
      h.push(ring());
      agent._myFightsPersistForTest(file());
      agent._startMyFightsPersistence();
      expect(rows().map(r => [r.mob, r.char, r.dmg, r.dur, r.dps])).toEqual([
        ['Aten Ha Ra', 'Brackwyn', 60_000, 120, 500], ['Aten Ha Ra', 'Corvale', 70_000, 120, 583.3],
        ['Lady Vox', 'Brackwyn', 60_000, 100, 600], ['Lady Vox', 'Corvale', 70_000, 100, 700],
      ]);
      expect(rows().every(r => r.zone === null && r.boss === false)).toBe(true);
      expect(rows()[0]).toMatchObject({ t: iso(S), end: iso(S + 120_000) });
      expect(JSON.parse(fs.readFileSync(file(), 'utf8')).rows, 'on disk before the next start').toHaveLength(4);
    });

    it('does not seed again once there is a file: the next start reads it, whatever the ring has since', () => {
      watch('Brackwyn');
      agent._fightHistoryForTest().push(ring());
      agent._myFightsPersistForTest(file());
      agent._startMyFightsPersistence();
      expect(rows()).toHaveLength(1);
      agent._fightHistoryForTest().push(ring({ boss: 'Lady Vox', startedMs: S + 3_600_000, endedMs: S + 3_700_000, durationSec: 100 }));
      agent._setMyFightsForTest([]);
      agent._startMyFightsPersistence();
      expect(rows().map(r => r.mob)).toEqual(['Aten Ha Ra']);
    });

    it('an empty ring or no watched log seeds nothing but still leaves a file, so it is the last first run', () => {
      agent._myFightsPersistForTest(file());
      agent._startMyFightsPersistence();
      expect(rows()).toEqual([]);
      expect(JSON.parse(fs.readFileSync(file(), 'utf8')).rows).toEqual([]);
      fs.rmSync(file());
      agent._fightHistoryForTest().push(ring());
      agent._startMyFightsPersistence();
      expect(rows(), 'a ring but nobody\'s log on this PC').toEqual([]);
    });

    it('skips a ring fight with no length, and a start the ring never had is worked out from its end', () => {
      watch('Brackwyn');
      const h = agent._fightHistoryForTest();
      h.push(ring({ durationSec: 0 }));
      h.push(ring({ boss: 'Lord Nagafen', startedMs: 0, endedMs: S + 400_000, durationSec: 100 }));
      agent._myFightsPersistForTest(file());
      agent._startMyFightsPersistence();
      expect(rows().map(r => [r.mob, r.t])).toEqual([['Lord Nagafen', iso(S + 300_000)]]);
    });
  });
});

// ── 3. the answer ───────────────────────────────────────────────────────────
describe('the answer', () => {
  // Raid nights (Eastern, to 6 am): a Sep 19, b Sep 26, c Oct 1, d+e+f+h Oct 4 (f is 1:30 am, h is Corvale's), g Oct 5.
  const DATA = () => [
    R(Date.UTC(2026, 8, 20, 1, 0), { dps: 800 }),                                                                   // a  Brackwyn · Aten · boss
    R(Date.UTC(2026, 8, 27, 1, 0), { dps: 900 }),                                                                   // b
    R(Date.UTC(2026, 9, 2, 1, 10), { mob: 'Lord Nagafen', zone: 'Plane of Water', dps: 700 }),                      // c
    R(Date.UTC(2026, 9, 5, 1, 17), { dps: 1000 }),                                                                  // d
    R(Date.UTC(2026, 9, 5, 1, 40), { mob: 'a Shissar acolyte', boss: false, dps: 480 }),                            // e
    R(Date.UTC(2026, 9, 5, 5, 30), { mob: 'a Shissar acolyte', boss: false, zone: null, dps: 500 }),                // f
    R(Date.UTC(2026, 9, 5, 10, 30), { mob: 'Lady Vox', zone: 'Plane of Water', dps: 600 }),                         // g
    R(Date.UTC(2026, 9, 5, 2, 0), { char: 'Corvale', dps: 300 }),                                                   // h
  ];
  const ask = (p, now = NOW) => agent.myLogsAnswer({ w: '7d', scope: 'bosses', char: '', zone: '', q: '', ...p }, now);
  beforeEach(() => agent._setMyFightsForTest(DATA()));
  const names = (a) => a.fights.map(f => f.name + '/' + f.char + '/' + f.dps);

  it('has the guild answer\'s shape, local, with the date its oldest fight starts', () => {
    const a = ask();
    expect(a.source).toBe('local');
    expect(a.since).toBe('2026-09-20T01:00:00.000Z');
    for (const k of ['window', 'scope', 'characters', 'total', 'truncated', 'fights', 'nights', 'zones', 'mobs']) expect(a, k).toHaveProperty(k);
    expect(a.window).toEqual({ key: '7d', label: '1 week', since: iso(NOW - 7 * DAY) });
    expect(a.scope).toBe('bosses');
    expect(Object.keys(a.fights[0]).sort()).toEqual(['boss', 'char', 'dmg', 'dps', 'dur', 'name', 't', 'usual', 'zone', 'zone_id']);
    expect(a.fights[0], 'no card to open and no rank among the guild').not.toHaveProperty('eid');
    expect(a.fights[0]).not.toHaveProperty('rank');
    expect(Array.isArray(a.fights) && a.fights.every(f => typeof f.name === 'string')).toBe(true);
  });

  it('lists the window\'s fights oldest to newest, each with its zone (the name is its id here), and Bosses means boss fights', () => {
    const a = ask();
    expect(names(a)).toEqual(['Lord Nagafen/Brackwyn/700', 'Aten Ha Ra/Brackwyn/1000', 'Aten Ha Ra/Corvale/300', 'Lady Vox/Brackwyn/600']);
    expect(a.fights[0]).toMatchObject({ t: iso(Date.UTC(2026, 9, 2, 1, 10)), zone: 'Plane of Water', zone_id: 'Plane of Water', boss: true, dmg: 100_000, dur: 100 });
    expect(a.total).toBe(4);
    expect(a.truncated).toBe(false);
    expect(names(ask({ scope: 'all' }))).toHaveLength(6);
    expect(ask({ scope: 'all' }).scope).toBe('all');
    const none = ask({ scope: 'all' }).fights.find(f => f.name === 'a Shissar acolyte' && f.dps === 500);
    expect(none).toMatchObject({ zone: null, zone_id: null, boss: false });
  });

  it('windows: a day, a week, 30 days, 90 days, this expansion and lifetime, named as the guild names them', () => {
    const w = (key, scope = 'all') => ask({ w: key, scope });
    expect(w('1d').fights).toEqual([]);
    expect(w('1d').window.label).toBe('1 day');
    expect(w('7d').total).toBe(6);
    expect(w('30d').total).toBe(8);
    expect(w('30d').window.label).toBe('30 days');
    expect(w('90d').window.label).toBe('90 days');
    expect(w('exp').window).toEqual({ key: 'exp', label: 'PoP era', since: '2026-10-01T00:00:00.000Z' });
    expect(w('exp').total, 'since 1 Oct').toBe(6);
    expect(w('life').window).toEqual({ key: 'life', label: 'Lifetime', since: null });
    expect(w('life').total).toBe(8);
    expect(ask({ w: 'forever' }).window.key, 'an unknown window is the week').toBe('7d');
    expect(agent.myLogsAnswer({ w: 'exp' }, Date.UTC(2025, 11, 1)).window.label).toBe('Luclin era');
  });

  it('nights group by Eastern raid night, with the fights, bosses, average and best of the window, oldest first', () => {
    expect(ask().nights).toEqual([
      { night: '2026-10-01', fights: 1, bosses: 1, avg_dps: 700, best_dps: 700 },
      { night: '2026-10-04', fights: 2, bosses: 2, avg_dps: 650, best_dps: 1000 },
      { night: '2026-10-05', fights: 1, bosses: 1, avg_dps: 600, best_dps: 600 },
    ]);
    expect(ask({ scope: 'all' }).nights, 'the 1:30 am kill is still the Oct 4 night').toEqual([
      { night: '2026-10-01', fights: 1, bosses: 1, avg_dps: 700, best_dps: 700 },
      { night: '2026-10-04', fights: 4, bosses: 2, avg_dps: 570, best_dps: 1000 },
      { night: '2026-10-05', fights: 1, bosses: 1, avg_dps: 600, best_dps: 600 },
    ]);
  });

  it('rounds a night\'s average and best to whole DPS', () => {
    agent._setMyFightsForTest([R(S, { dps: 100.4 }), R(S + 1000, { dps: 200.3, mob: 'b' }), R(S + 2000, { dps: 300.6, mob: 'c' })]);
    expect(ask({ w: 'life' }).nights).toEqual([{ night: '2026-10-04', fights: 3, bosses: 3, avg_dps: 200, best_dps: 301 }]);
  });

  it('usual is the median of that character\'s fights on that mob over the WHOLE log (not the window), from three on', () => {
    const d = ask().fights.find(f => f.name === 'Aten Ha Ra' && f.char === 'Brackwyn');
    expect(d.usual, 'a 800, b 900 and d 1000: two of them are outside the week').toBe(900);
    expect(ask().fights.find(f => f.char === 'Corvale').usual, 'one fight is not a usual').toBeNull();
    expect(ask({ scope: 'all' }).fights.filter(f => f.name === 'a Shissar acolyte').map(f => f.usual), 'two is not enough').toEqual([null, null]);
    agent._setMyFightsForTest([R(S, { dps: 100 }), R(S + 1e6, { dps: 200 }), R(S + 2e6, { dps: 400 }), R(S + 3e6, { dps: 300 })]);
    expect(ask({ w: 'life' }).fights.map(f => f.usual), 'an even count takes the middle two').toEqual([250, 250, 250, 250]);
  });

  it('usual is per character: another character\'s fights on the mob are not in it', () => {
    agent._setMyFightsForTest([R(S, { dps: 100 }), R(S + 1e6, { dps: 100 }), R(S + 2e6, { dps: 100 }), R(S + 3e6, { dps: 9000, char: 'Corvale' })]);
    const f = ask({ w: 'life' }).fights;
    expect(f.filter(x => x.char === 'Brackwyn').map(x => x.usual)).toEqual([100, 100, 100]);
    expect(f.find(x => x.char === 'Corvale').usual).toBeNull();
  });

  it('the Zone filter keeps one zone (its name is its id, any case), and it is applied to the fights AND the nights', () => {
    const a = ask({ scope: 'all', zone: 'plane of fire' });
    expect(names(a)).toEqual(['Aten Ha Ra/Brackwyn/1000', 'a Shissar acolyte/Brackwyn/480', 'Aten Ha Ra/Corvale/300']);
    expect(a.total).toBe(3);
    expect(a.nights).toEqual([{ night: '2026-10-04', fights: 3, bosses: 2, avg_dps: 593, best_dps: 1000 }]);
    expect(ask({ zone: 'Nowhere' }).fights).toEqual([]);
  });

  it('the search filter keeps mobs whose name contains the text, in any case, and narrows the nights too', () => {
    const a = ask({ scope: 'all', q: 'SHISSAR' });
    expect(names(a)).toEqual(['a Shissar acolyte/Brackwyn/480', 'a Shissar acolyte/Brackwyn/500']);
    expect(a.nights).toEqual([{ night: '2026-10-04', fights: 2, bosses: 0, avg_dps: 490, best_dps: 500 }]);
    expect(names(ask({ scope: 'all', q: 'nagafen' }))).toEqual(['Lord Nagafen/Brackwyn/700']);
    expect(names(ask({ scope: 'all', q: 'shissar', zone: 'Plane of Fire' }))).toEqual(['a Shissar acolyte/Brackwyn/480']);
    expect(ask({ q: 'zzz' }).total).toBe(0);
  });

  it('the character filter keeps one character, in any case', () => {
    expect(names(ask({ char: 'corvale' }))).toEqual(['Aten Ha Ra/Corvale/300']);
    expect(names(ask({ char: 'Nobody' }))).toEqual([]);
  });

  it('the pickers list what is in the window, scope and character, BEFORE the zone and search narrow it', () => {
    const wide = ask();
    expect(wide.zones).toEqual([{ id: 'Plane of Fire', name: 'Plane of Fire', fights: 2 }, { id: 'Plane of Water', name: 'Plane of Water', fights: 2 }]);
    expect(wide.mobs).toEqual([{ name: 'Aten Ha Ra', fights: 2 }, { name: 'Lady Vox', fights: 1 }, { name: 'Lord Nagafen', fights: 1 }]);
    const narrowed = ask({ scope: 'all', zone: 'Plane of Fire', q: 'aten' });
    expect(narrowed.zones, 'a zone filter does not empty its own picker').toEqual([{ id: 'Plane of Fire', name: 'Plane of Fire', fights: 3 }, { id: 'Plane of Water', name: 'Plane of Water', fights: 2 }]);
    expect(narrowed.mobs.map(m => m.name)).toEqual(['Aten Ha Ra', 'a Shissar acolyte', 'Lady Vox', 'Lord Nagafen']);
    expect(ask({ char: 'Corvale' }).zones, 'a character narrows them').toEqual([{ id: 'Plane of Fire', name: 'Plane of Fire', fights: 1 }]);
    expect(ask({ scope: 'all' }).zones.map(z => z.fights), 'a fight with no zone is in no zone').toEqual([3, 2]);
    expect(ask({ w: 'life', scope: 'all' }).mobs.find(m => m.name === 'Aten Ha Ra').fights).toBe(4);
  });

  it('offers at most 200 mobs, the ones fought most', () => {
    agent._setMyFightsForTest(Array.from({ length: 250 }, (_, i) => R(S + i * 1000, { mob: 'Mob ' + String(i).padStart(3, '0') })).concat([R(S + 9e6), R(S + 9.1e6)]));
    const m = ask({ w: 'life' }).mobs;
    expect(m).toHaveLength(200);
    expect(m[0]).toEqual({ name: 'Aten Ha Ra', fights: 2 });
    expect(m[1].name).toBe('Mob 000');
  });

  it('characters come from the log, never hidden, with fights in the window and in the last 30 days, whatever the scope, zone and search', () => {
    const c = ask({ scope: 'bosses', zone: 'Plane of Water', q: 'vox' }).characters;
    expect(c).toEqual([
      { name: 'Brackwyn', active: false, hidden: false, fights: 5, recent: 7 },
      { name: 'Corvale', active: false, hidden: false, fights: 1, recent: 1 },
    ]);
    expect(ask({ w: 'life' }).characters.map(x => x.fights)).toEqual([7, 1]);
    expect(ask({ char: 'Corvale' }).characters.map(x => x.name), 'a character filter does not shrink the chip list').toEqual(['Brackwyn', 'Corvale']);
  });

  it('marks a character with a live log on this PC as active, and lists those first', () => {
    agent._setWatchedLogsForTest([{ character: 'Corvale', logPath: 'x', lastSeen: Date.now() }]);
    expect(ask().characters.map(c => [c.name, c.active])).toEqual([['Corvale', true], ['Brackwyn', false]]);
  });

  it('carries the newest 400 fights, oldest to newest, says it was cut, and still counts every fight in total and the nights', () => {
    const t0 = Date.UTC(2026, 9, 6, 0, 0);
    agent._setMyFightsForTest(Array.from({ length: 450 }, (_, i) => R(t0 + i * 60_000, { dps: 1000 + i, mob: 'Mob ' + i })));
    const a = ask();
    expect(a.fights).toHaveLength(400);
    expect(a.total).toBe(450);
    expect(a.truncated).toBe(true);
    expect(a.fights[0].dps).toBe(1050);
    expect(a.fights[399].dps).toBe(1449);
    expect(a.nights.reduce((s, n) => s + n.fights, 0)).toBe(450);
    expect(ask({ q: 'Mob 44' }).truncated, 'a filtered set under the cut is not cut').toBe(false);
  });

  it('an empty log is a well-formed answer with nothing in it, not an error', () => {
    agent._setMyFightsForTest([]);
    const a = ask();
    expect(a).toMatchObject({ source: 'local', since: null, total: 0, truncated: false, fights: [], nights: [], zones: [], mobs: [], characters: [] });
    expect(a.window.label).toBe('1 week');
    expect(agent.myLogsAnswer(undefined, NOW).fights).toEqual([]);
  });

  it('asks nobody: no network call is made, signed in or not', () => {
    const f = vi.fn(async () => { throw new Error('the network was used'); });
    vi.stubGlobal('fetch', f);
    agent._setUploadOptsForTest({ botUrl: 'https://bot.example/api/agent/encounter', token: 't0k', dryRun: false });
    try { ask({ scope: 'all', zone: 'Plane of Fire', q: 'aten' }); ask({ w: 'life' }); } finally { agent._setUploadOptsForTest(null); }
    expect(f).not.toHaveBeenCalled();
    const body = stripJs(sliceBlock(AGENT_SRC, 'function myLogsAnswer(p, now = Date.now()) {', '\n}\n'));
    expect(body).not.toMatch(/\bfetch\b|https?\.request|_uploadOpts|_mimicSessionToken/);
  });

  it('does not change the rows it reads', () => {
    const before = JSON.stringify(rows());
    ask({ scope: 'all', w: 'life' });
    expect(JSON.stringify(rows())).toBe(before);
  });
});

describe('the request', () => {
  it('reads the guild\'s whitelist for everything but the zone, which here is a name', () => {
    expect(agent._myLogsParams('/api/my-parses?source=local&w=30d&scope=all&char=Brackwyn&zone=Plane%20of%20Fire&q=aten'))
      .toEqual({ w: '30d', scope: 'all', char: 'Brackwyn', zone: 'Plane of Fire', q: 'aten', fresh: false });
    expect(agent._myLogsParams('/x?w=bogus&char=a%20b&q=%3Cb%3E&zone=%20Plane%20of%20Fire%20').zone).toBe('Plane of Fire');
    expect(agent._myLogsParams('/x?w=bogus&char=a%20b&q=%3Cb%3E')).toMatchObject({ w: '7d', char: '', q: '', zone: '' });
    expect(agent._myLogsParams('/x?zone=' + 'z'.repeat(100)).zone).toHaveLength(64);
    expect(agent._myLogsParams(undefined)).toMatchObject({ w: '7d', zone: '' });
  });

  it('is local only for exactly source=local', () => {
    expect(agent._myParsesIsLocal('/api/my-parses?source=local')).toBe(true);
    expect(agent._myParsesIsLocal('/api/my-parses?w=7d&source=local&q=a')).toBe(true);
    for (const u of ['/api/my-parses', '/api/my-parses?source=guild', '/api/my-parses?source=LOCAL', '/api/my-parses?source=local2', '/api/my-parses?sources=local', undefined, 'http://[']) {
      expect(agent._myParsesIsLocal(u), String(u)).toBe(false);
    }
  });
});

// ── 4. the raid night: the agent and the dashboard agree, and so does the bot's SQL ─────────────────────────
describe('the raid night', () => {
  const dashNight = new Function(sliceBlock(DASH, 'var _wpMpEtFmt = null;', 'p2(d.getUTCDate());\n}\n') + '\nreturn _wpMpNightKey;')();
  const night = agent._myNightKey;

  it('is the Eastern date with the night running to 6 am, through both daylight-saving changes', () => {
    const at = (s) => night(Date.parse(s));
    expect(at('2026-10-05T01:17:00Z')).toBe('2026-10-04');
    expect(at('2026-10-05T09:59:00Z')).toBe('2026-10-04');
    expect(at('2026-10-05T10:00:00Z')).toBe('2026-10-05');
    expect(at('2026-03-08T09:59:00Z')).toBe('2026-03-07');       // the Sunday DST began: 5:59 am EDT
    expect(at('2026-03-08T10:00:00Z')).toBe('2026-03-08');
    expect(at('2026-11-01T10:59:00Z')).toBe('2026-10-31');       // the Sunday DST ended: 5:59 am EST
    expect(at('2026-11-01T11:00:00Z')).toBe('2026-11-01');
    expect(at('2026-12-06T10:59:00Z')).toBe('2026-12-05');
    expect(at('2026-12-06T11:00:00Z')).toBe('2026-12-06');
  });

  it('does not change inside an hour (that is what lets it be remembered per hour), and matches the dashboard\'s own at every hour of the year', () => {
    const start = Date.UTC(2026, 0, 1);
    for (let h = 0; h < 24 * 365; h++) {
      const ms = start + h * 3600_000;
      const k = night(ms);
      if (h % 7 === 0) expect(night(ms + 59 * 60_000 + 59_000), 'hour ' + h).toBe(k);
      expect(dashNight(ms), 'hour ' + h).toBe(k);
      expect(dashNight(ms + 1_799_000), 'half past, hour ' + h).toBe(k);
    }
  });
});
