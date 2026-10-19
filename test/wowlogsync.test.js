// test/wowlogsync.test.js -- packages/wowlogsync/core.js: the Classic-era WoW combat-log reader.
//
// SOURCES. The line shape and field order come from
//   https://warcraft.wiki.gg/wiki/COMBAT_LOG_EVENT   (base fields, prefixes, _DAMAGE/_HEAL suffixes, the 17 advanced fields)
//   https://warcraft.wiki.gg/Combat_Log               (Logs\WoWCombatLog.txt after /combatlog)
// VERBATIM from the wiki: the header line `11/21 12:01:34.071  COMBAT_LOG_VERSION,19,ADVANCED_LOG_ENABLED,1,
// BUILD_VERSION,9.1.5,PROJECT_ID,1`, and the first eleven fields of its SPELL_DAMAGE / SWING_DAMAGE examples
// (`SWING_DAMAGE,Player-1096-06DF65C1,"Xiaohuli-DefiasBrotherhood",0x511,0x0,Creature-0-4253-0-160-94-00006FB363,`).
// CONSTRUCTED here, in the documented column order, because the wiki page was only retrievable as excerpts: every
// destination name / flag / amount, the advanced block's values, and the ENCOUNTER_* lines. Nothing here is a capture
// from a Classic client; the report that accompanies this change says which columns remain unconfirmed.
//
// Layers: (1) golden lines, (2) aggregation, (3) the allow-list, (4) the payload whitelist.
// Fixture names are invented; none is a member or a real player.
//
// Run: npx vitest run test/wowlogsync.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const core = require('../packages/wowlogsync/core.js');
const { parseLine, splitCsv, FightTracker, buildPayload, ALLOWED } = core;

const NOW = new Date(2026, 10, 21, 13, 0, 0).getTime();     // local 11/21/2026 13:00
const T = '11/21 12:0';                                       // stamps below are 12:0m:ss.mmm
const ADV_P = 'Player-1096-06DF65C1,0000000000000000,500,500,100,0,0,0,0,100,100,0,1.0,2.0,1429,3.14,60';
const WOLF = 'Player-1096-06DF65C1', WOLF_N = '"Aldenmar-Testrealm"';
const BOSS = 'Creature-0-4253-0-160-12118-00006FB363', BOSS_N = '"Lucifron"';
const ADD = 'Creature-0-4253-0-160-12119-00006FB364';
const HEALER = 'Player-1096-0AAA0002', HEALER_N = '"Brackwyn-Testrealm"';
const PET = 'Pet-0-4253-0-160-416-0000AAAA';
const src = (g, n) => `${g},${n},0x511,0x0`;
const dst = (g, n) => `${g},${n},0x10a48,0x0`;

const swing = (clock, s, d, amt, over = -1, adv = '') =>
  `${T}${clock}  SWING_DAMAGE,${s},${d},${adv ? adv + ',' : ''}${amt},${over},1,0,0,0,nil,nil,nil`;
const spell = (clock, ev, s, d, amt, over = -1, adv = '') =>
  `${T}${clock}  ${ev},${s},${d},12345,"Fireball",0x4,${adv ? adv + ',' : ''}${amt},${over},4,0,0,0,nil,nil,nil`;
const heal = (clock, ev, s, d, amt, overheal, adv = '') =>
  `${T}${clock}  ${ev},${s},${d},2061,"Flash Heal",0x2,${adv ? adv + ',' : ''}${amt},${overheal},0,nil`;
const died = (clock, g, n, extra = '') => `${T}${clock}  UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,${g},${n},0x511,0x0${extra}`;

function run(lines, opts = {}) {
  const fights = [];
  const t = new FightTracker({ onFight: f => fights.push(f), ...opts });
  for (const l of lines) { const ev = parseLine(l, NOW); if (ev) t.feed(ev, NOW); }
  return { fights, t };
}

describe('golden lines', () => {
  it('the COMBAT_LOG_VERSION header is not an uploadable event', () => {
    expect(parseLine('11/21 12:01:34.071  COMBAT_LOG_VERSION,19,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,9.1.5,PROJECT_ID,1', NOW)).toBeNull();
  });

  it('parses the wiki example prefix (SWING_DAMAGE, quoted Name-Realm) without advanced logging', () => {
    const line = '11/21 12:02:05.100  SWING_DAMAGE,Player-1096-06DF65C1,"Xiaohuli-DefiasBrotherhood",0x511,0x0,'
      + 'Creature-0-4253-0-160-94-00006FB363,"Target Dummy",0x10a48,0x0,1000,-1,1,0,0,0,nil,nil,nil';
    const ev = parseLine(line, NOW);
    expect(ev).toMatchObject({ type: 'damage', srcGuid: 'Player-1096-06DF65C1', srcName: 'Xiaohuli-DefiasBrotherhood',
      dstGuid: 'Creature-0-4253-0-160-94-00006FB363', dstName: 'Target Dummy', amount: 1000, overkill: 0, infoGuid: null });
    expect(new Date(ev.tsMs).getHours()).toBe(12);
    expect(new Date(ev.tsMs).getMilliseconds()).toBe(100);
  });

  it('finds the amount after the 3-field SPELL prefix, with and without the 17-field advanced block', () => {
    const plain = parseLine(spell('2:05.000', 'SPELL_DAMAGE', src(WOLF, WOLF_N), dst(BOSS, BOSS_N), 2500, 300), NOW);
    const adv = parseLine(spell('2:05.000', 'SPELL_DAMAGE', src(WOLF, WOLF_N), dst(BOSS, BOSS_N), 2500, 300, ADV_P), NOW);
    expect(plain).toMatchObject({ type: 'damage', amount: 2500, overkill: 300 });
    expect(adv).toMatchObject({ type: 'damage', amount: 2500, overkill: 300, infoGuid: WOLF, ownerGuid: null });
  });

  it('reads ownerGUID out of the advanced block (the only documented pet link)', () => {
    const adv = `${PET},${WOLF},100,100,0,0,0,0,0,0,0,0,1.0,2.0,1429,3.14,60`;
    const ev = parseLine(swing('2:06.000', src(PET, '"Imp"'), dst(BOSS, BOSS_N), 400, -1, adv), NOW);
    expect(ev).toMatchObject({ amount: 400, infoGuid: PET, ownerGuid: WOLF });
  });

  it('heal suffix: amount then overhealing; periodic variants too', () => {
    const h = parseLine(heal('2:07.000', 'SPELL_HEAL', src(HEALER, HEALER_N), dst(WOLF, WOLF_N), 900, 400), NOW);
    const p = parseLine(heal('2:07.500', 'SPELL_PERIODIC_HEAL', src(HEALER, HEALER_N), dst(WOLF, WOLF_N), 100, 0, ADV_P), NOW);
    expect(h).toMatchObject({ type: 'heal', amount: 900, overheal: 400 });
    expect(p).toMatchObject({ type: 'heal', amount: 100, overheal: 0 });
  });

  it('keeps a comma inside a quoted name in one field', () => {
    expect(splitCsv('a,"Lord Kazzak, Doomguard",b')).toEqual(['a', 'Lord Kazzak, Doomguard', 'b']);
  });

  it('ENCOUNTER_START / END', () => {
    expect(parseLine(`${T}2:00.000  ENCOUNTER_START,663,"Lucifron",9,40,409`, NOW)).toMatchObject({ type: 'encStart', id: 663, name: 'Lucifron' });
    expect(parseLine(`${T}9:00.000  ENCOUNTER_END,663,"Lucifron",9,40,1`, NOW)).toMatchObject({ type: 'encEnd', id: 663, success: true });
    expect(parseLine(`${T}9:00.000  ENCOUNTER_END,663,"Lucifron",9,40,0`, NOW)).toMatchObject({ success: false });
  });

  it('a timestamp with a year and a zone suffix still parses; a yearless December stamp read in January is last year', () => {
    expect(parseLine('11/21/2026 12:02:05.100-5  UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,'
      + 'Creature-0-1-0-1-5-00000001,"X",0x1,0x0', NOW)).toMatchObject({ type: 'died' });
    const jan = new Date(2027, 0, 2, 9, 0, 0).getTime();
    const ev = parseLine('12/31 23:59:59.000  UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,Creature-0-1-0-1-5-00000001,"X",0x1,0x0', jan);
    expect(new Date(ev.tsMs).getFullYear()).toBe(2026);
  });

  it('a malformed amount drops the line instead of inventing a number', () => {
    expect(parseLine(swing('2:05.000', src(WOLF, WOLF_N), dst(BOSS, BOSS_N), 'lots'), NOW)).toBeNull();
  });
});

describe('aggregation', () => {
  const night = [
    `${T}2:00.000  ENCOUNTER_START,663,"Lucifron",9,40,409`,
    swing('2:05.000', src(WOLF, WOLF_N), dst(BOSS, BOSS_N), 1000, 200),               // 800 effective (overkill removed)
    spell('2:06.000', 'SPELL_DAMAGE', src(WOLF, WOLF_N), dst(BOSS, BOSS_N), 2000),    // adds
    spell('2:06.500', 'SPELL_PERIODIC_DAMAGE', src(WOLF, WOLF_N), dst(ADD, '"Flamewaker"'), 500),
    swing('2:07.000', src(PET, '"Imp"'), dst(BOSS, BOSS_N), 400, -1,
      `${PET},${WOLF},100,100,0,0,0,0,0,0,0,0,1.0,2.0,1429,3.14,60`),                // linked pet -> owner
    swing('2:07.500', src(PET, '"Imp"'), dst(BOSS, BOSS_N), 100),                       // same pet, no block: link remembered
    swing('2:08.000', src('Pet-0-4253-0-160-417-0000BBBB', '"Stray"'), dst(BOSS, BOSS_N), 700),   // never linked
    swing('2:08.500', src(WOLF, WOLF_N), dst(HEALER, HEALER_N), 9999),                 // friendly fire: not boss damage
    heal('2:09.000', 'SPELL_HEAL', src(HEALER, HEALER_N), dst(WOLF, WOLF_N), 900, 400),
    heal('2:09.500', 'SPELL_PERIODIC_HEAL', src(HEALER, HEALER_N), dst(WOLF, WOLF_N), 100, 0),
    died('2:10.000', HEALER, HEALER_N),
    died('2:10.500', WOLF, WOLF_N, ',0,1'),                                             // feign death: not a death
    died('2:11.000', BOSS, BOSS_N),
    `${T}2:12.000  ENCOUNTER_END,663,"Lucifron",9,40,1`,
  ];

  it('segments by ENCOUNTER_START/END, folds pets, removes overkill and overheal, records deaths', () => {
    const { fights } = run(night);
    expect(fights).toHaveLength(1);
    const f = fights[0];
    expect(f).toMatchObject({ kind: 'encounter', key: 'wow:encounter:663', name: 'Lucifron', confirmed: true, activeSec: 12 });
    const wolf = f.players.find(p => p.name === 'Aldenmar');
    expect(wolf).toMatchObject({ directDamage: 800 + 2000 + 500, petDamage: 400 + 100, damage: 3800, healed: 0 });
    const healer = f.players.find(p => p.name === 'Brackwyn');
    expect(healer).toMatchObject({ damage: 0, healed: 500 + 100, overheal: 400 });
    expect(f.players.map(p => p.name).sort()).toEqual(['Aldenmar', 'Brackwyn']);   // the stray pet is nobody's row
    expect(f.unlinkedPetDamage).toBe(700);
    expect(f.deaths.map(d => d.name)).toEqual(['Brackwyn']);
  });

  it('a wipe is dropped by default and kept, unconfirmed, with includeWipes', () => {
    const wipe = night.map(l => l.replace('ENCOUNTER_END,663,"Lucifron",9,40,1', 'ENCOUNTER_END,663,"Lucifron",9,40,0'));
    expect(run(wipe).fights).toHaveLength(0);
    const kept = run(wipe, { includeWipes: true }).fights;
    expect(kept).toHaveLength(1);
    expect(kept[0].confirmed).toBe(false);
  });

  it('with no ENCOUNTER events, a killed target after a combat gap makes a wow:npc fight', () => {
    const lines = [
      swing('3:00.000', src(WOLF, WOLF_N), dst(BOSS, BOSS_N), 3000),
      swing('3:15.000', src(HEALER, HEALER_N), dst(BOSS, BOSS_N), 3000),
      swing('3:30.000', src(WOLF, WOLF_N), dst(BOSS, BOSS_N), 3000),
      died('3:31.000', BOSS, BOSS_N),
      swing('5:00.000', src(WOLF, WOLF_N), dst(ADD, '"Flamewaker"'), 10),               // 89 s later: a new, tiny fight
    ];
    const { fights, t } = run(lines);
    t.flush();
    const all = [...fights];
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: 'gap', key: 'wow:npc:12118', name: 'Lucifron', confirmed: true, activeSec: 31 });
  });

  it('the fallback needs a kill, 30 s and two players; --no-fallback turns it off', () => {
    const base = [swing('3:00.000', src(WOLF, WOLF_N), dst(BOSS, BOSS_N), 3000), swing('3:15.000', src(HEALER, HEALER_N), dst(BOSS, BOSS_N), 3000),
      swing('3:30.000', src(WOLF, WOLF_N), dst(BOSS, BOSS_N), 3000)];
    const noKill = run(base); noKill.t.flush();
    expect(noKill.fights).toHaveLength(0);
    const quick = run([swing('3:00.000', src(WOLF, WOLF_N), dst(BOSS, BOSS_N), 3000), swing('3:05.000', src(HEALER, HEALER_N), dst(BOSS, BOSS_N), 3000), died('3:06.000', BOSS, BOSS_N)]);
    quick.t.flush();
    expect(quick.fights).toHaveLength(0);
    const solo = run([swing('3:00.000', src(WOLF, WOLF_N), dst(BOSS, BOSS_N), 3000), swing('3:15.000', src(WOLF, WOLF_N), dst(BOSS, BOSS_N), 3000), swing('3:30.000', src(WOLF, WOLF_N), dst(BOSS, BOSS_N), 3000), died('3:31.000', BOSS, BOSS_N)]);
    solo.t.flush();
    expect(solo.fights).toHaveLength(0);
    const off = run([...base, died('3:31.000', BOSS, BOSS_N)], { fallback: false }); off.t.flush();
    expect(off.fights).toHaveLength(0);
    const on = run([...base, died('3:31.000', BOSS, BOSS_N)]); on.t.flush();
    expect(on.fights).toHaveLength(1);
  });

  it('a quiet log closes a gap fight on the wall clock', () => {
    const { fights, t } = run([
      swing('3:00.000', src(WOLF, WOLF_N), dst(BOSS, BOSS_N), 3000),
      swing('3:15.000', src(HEALER, HEALER_N), dst(BOSS, BOSS_N), 3000),
      swing('3:30.000', src(WOLF, WOLF_N), dst(BOSS, BOSS_N), 3000),
      died('3:31.000', BOSS, BOSS_N),
    ]);
    expect(fights).toHaveLength(0);
    t.idle(NOW + 60000);
    expect(fights).toHaveLength(1);
  });
});

describe('the allow-list is the privacy boundary', () => {
  it('is exactly the damage / heal / death / encounter events', () => {
    expect([...ALLOWED].sort()).toEqual([
      'ENCOUNTER_END', 'ENCOUNTER_START', 'RANGE_DAMAGE', 'SPELL_DAMAGE', 'SPELL_HEAL', 'SPELL_PERIODIC_DAMAGE',
      'SPELL_PERIODIC_HEAL', 'SWING_DAMAGE', 'UNIT_DIED',
    ]);
  });

  // SPELL_ENERGIZE / SPELL_DRAIN / SPELL_ABSORBED have a numeric field exactly where a damage amount sits, so
  // without the allow-list they would parse as damage and show up in a payload. That is what this guards.
  const LEAKS = [
    `${T}4:00.000  SPELL_ENERGIZE,${src(WOLF, WOLF_N)},${dst(WOLF, WOLF_N)},1,"Evocation",0x40,99999,0,0`,
    `${T}4:00.100  SPELL_DRAIN,${src(WOLF, WOLF_N)},${dst(BOSS, BOSS_N)},1,"Drain Soul",0x20,88888,0,0`,
    `${T}4:00.200  SPELL_AURA_APPLIED,${src(WOLF, WOLF_N)},${dst(WOLF, WOLF_N)},1,"Power Word: Fortitude",0x2,BUFF,77777`,
    `${T}4:00.300  SPELL_CAST_SUCCESS,${src(WOLF, WOLF_N)},${dst(BOSS, BOSS_N)},1,"Fireball",0x4,66666`,
    `${T}4:00.400  SWING_DAMAGE_LANDED,${src(WOLF, WOLF_N)},${dst(BOSS, BOSS_N)},55555,-1,1,0,0,0,nil,nil,nil`,
    `${T}4:00.500  CHAT_MSG_GUILD,${src(WOLF, WOLF_N)},"meet at the bank",44444`,
  ];

  it('drops every other event before it is split into fields', () => {
    for (const l of LEAKS) expect(parseLine(l, NOW)).toBeNull();
  });

  it('a payload built from a log full of them carries none of their numbers, spell names or guids', () => {
    const { fights } = run([`${T}2:00.000  ENCOUNTER_START,663,"Lucifron",9,40,409`, ...LEAKS,
      swing('2:05.000', src(WOLF, WOLF_N), dst(BOSS, BOSS_N), 1000),
      `${T}2:12.000  ENCOUNTER_END,663,"Lucifron",9,40,1`]);
    expect(fights).toHaveLength(1);
    const json = JSON.stringify(buildPayload(fights[0], { character: 'Aldenmar', version: '0.1.0' }));
    for (const s of ['99999', '88888', '77777', '66666', '55555', '44444', 'Evocation', 'Fortitude', 'bank', 'Fireball']) {
      expect(json).not.toContain(s);
    }
    expect(fights[0].players[0].damage).toBe(1000);
  });
});

describe('the payload is a whitelist, field by field', () => {
  const { fights } = run([
    `${T}2:00.000  ENCOUNTER_START,663,"Lucifron",9,40,409`,
    spell('2:05.000', 'SPELL_DAMAGE', src(WOLF, WOLF_N), dst(BOSS, BOSS_N), 1000, -1, ADV_P),
    heal('2:06.000', 'SPELL_HEAL', src(HEALER, HEALER_N), dst(WOLF, WOLF_N), 300, 100),
    died('2:07.000', HEALER, HEALER_N),
    `${T}2:12.000  ENCOUNTER_END,663,"Lucifron",9,40,1`,
  ]);
  const payload = buildPayload(fights[0], { character: 'Aldenmar', version: '0.1.0' });

  it('has the EverQuest envelope plus game:wow', () => {
    expect(Object.keys(payload).sort()).toEqual(['agent_version', 'backfill', 'character', 'encounter', 'game']);
    expect(payload.game).toBe('wow');
    expect(Object.keys(payload.encounter).sort()).toEqual([
      'active_duration_s', 'boss_key', 'boss_name', 'confirmed_kill', 'deaths', 'ended_at', 'events', 'players', 'started_at']);
    expect(payload.encounter.events).toEqual([]);
    expect(payload.encounter.boss_key).toBe('wow:encounter:663');
    expect(Object.keys(payload.encounter.players[0]).sort()).toEqual(['damage', 'directDamage', 'healed', 'name', 'petDamage']);
  });

  it('never carries a guid, a realm, a flag block or a spell name', () => {
    const json = JSON.stringify(payload);
    for (const s of ['Player-', 'Creature-', 'Pet-', 'Testrealm', '0x511', 'Fireball', 'Flash Heal', '1429']) expect(json).not.toContain(s);
  });

  it('index.js posts only what buildPayload returns (no raw line reaches enqueue)', () => {
    const idx = stripJs(fs.readFileSync(path.join(ROOT, 'packages', 'wowlogsync', 'index.js'), 'utf8'));
    expect(idx.match(/enqueue\(/g)).toHaveLength(2);                 // the definition and the one call
    expect(idx).toMatch(/enqueue\(payload\)/);
    expect(idx).toMatch(/const payload = buildPayload\(summary,/);
    expect(idx).not.toMatch(/enqueue\(\s*(?:line|ev|all)\b/);
  });
});
