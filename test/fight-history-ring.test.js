// test/fight-history-ring.test.js — the last few mobs, captured at the kill.
//
// The guild lead, 2026-08-14: "instead of displaying the combined damage during the
// fight, perhaps we just have the overlay give the last few mobs in a history
// tab that can be opened up once it's properly deduped — the overcount from
// time skew and whatnot is too much to account for in a live stat review and
// it is legitimately doubling damage."
//
// The bot's corroboration estimator is not broken, it is UNSETTLED mid-fight:
// under three independent readings it falls back to max, which is the doubling.
// This ring is where a fight waits until the stragglers' uploads have landed.
//
// These tests cover the capture side only — the two delayed /live-damage passes
// need a bot and are exercised in the browser harness instead.
//
// Run: npx vitest run test/fight-history-ring.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { _recordFightHistory, _fightHistoryForTest, _resetFightHistoryForTest }
  from '../packages/wolfpack-logsync/index.js';

const iso = msAgo => new Date(Date.now() - msAgo).toISOString();

function fight(boss, opts = {}) {
  return {
    bossName: boss,
    targetName: boss,
    startedAt: opts.startedAt || iso(60_000),
    flushedAt: opts.flushedAt || Date.now(),
    // `dmg` is the RAW damage the live meter shows; swing/proc/spell are THREAT and are NOT the same
    // number (2026-10-04) — a fixture without `dmg` would be a row of a fight that dealt none.
    perPlayer: opts.perPlayer || {
      Hitya:   { swing: 5000, proc: 1000, spell: 0, dmg: 6000 },
      Wabumkin:{ swing: 0, proc: 0, spell: 40000, dmg: 40000 },
    },
  };
}

describe('capturing a fight', () => {
  beforeEach(() => _resetFightHistoryForTest());

  it('records the boss, its duration and this machine\'s own view', () => {
    _recordFightHistory(fight('Aten Ha Ra'));
    const h = _fightHistoryForTest();
    expect(h).toHaveLength(1);
    expect(h[0].boss).toBe('Aten Ha Ra');
    expect(h[0].durationSec).toBeGreaterThan(50);
    expect(h[0].durationSec).toBeLessThan(70);
    expect(h[0].local.map(p => p.character)).toEqual(['Wabumkin', 'Hitya']);
    expect(h[0].local.find(p => p.character === 'Hitya').dmg).toBe(6000);
  });

  it('starts UNSETTLED with no guild rows', () => {
    // The whole point of the tab: a fight is not shown as the guild's answer
    // until the guild has actually answered.
    _recordFightHistory(fight('Aten Ha Ra'));
    const h = _fightHistoryForTest()[0];
    expect(h.settled).toBe(false);
    expect(h.players).toEqual([]);
  });

  it('keeps healing out of the damage rows', () => {
    _recordFightHistory(fight('Aten Ha Ra', {
      perPlayer: { Mcdorf: { swing: 0, proc: 0, spell: 0, heal: 250000 } },
    }));
    expect(_fightHistoryForTest()[0].local, 'a cleric who only healed is not a damage row').toEqual([]);
  });

  it('newest first', () => {
    _recordFightHistory(fight('First'));
    _recordFightHistory(fight('Second'));
    expect(_fightHistoryForTest().map(h => h.boss)).toEqual(['Second', 'First']);
  });

  // 30 since 2026-10-02 (the guild lead: "History should be much longer"), 100 since 2026-10-04
  // ("damage/tanking meter could have more history in it").
  it('keeps the last hundred', () => {
    for (let i = 1; i <= 105; i++) _recordFightHistory(fight('Mob ' + i));
    const h = _fightHistoryForTest();
    expect(h.length).toBe(100);
    expect(h[0].boss).toBe('Mob 105');
    expect(h.map(x => x.boss)).not.toContain('Mob 5');
    expect(h.map(x => x.boss)).toContain('Mob 6');
  });

  it('says a fight that never left this machine is local', () => {
    // No token in a test run: it can only ever be local.
    _recordFightHistory(fight('Aten Ha Ra'));
    expect(_fightHistoryForTest()[0].upload).toBe('local');
  });
});

describe('one kill is one entry', () => {
  beforeEach(() => _resetFightHistoryForTest());

  it('a multi-log install does not record the same fight twice', () => {
    // flush() runs per builder AND propagates to peer builders on the same
    // fight, so a two-log machine calls this two or three times for one kill.
    const started = iso(60_000);
    _recordFightHistory(fight('Aten Ha Ra', { startedAt: started }));
    _recordFightHistory(fight('Aten Ha Ra', { startedAt: started }));
    _recordFightHistory(fight('Aten Ha Ra', { startedAt: new Date(Date.parse(started) + 4000).toISOString() }));
    expect(_fightHistoryForTest()).toHaveLength(1);
  });

  // The guild lead, 2026-10-02: "This fight was backtoback with the same name." A short pull begun
  // 30 s after the last one is a new fight, not a repeat flush of the old one.
  it('a back-to-back pull of the same name 30 s later is its own entry', () => {
    _recordFightHistory(fight('A brann geistlig', { startedAt: iso(60_000) }));
    _recordFightHistory(fight('A brann geistlig', { startedAt: iso(30_000) }));
    expect(_fightHistoryForTest()).toHaveLength(2);
  });

  it('but a SECOND pull of the same mob is its own entry', () => {
    // Same name, hours apart — dedup must key on the fight, not the mob.
    _recordFightHistory(fight('Aten Ha Ra', { startedAt: iso(4 * 3600_000) }));
    _recordFightHistory(fight('Aten Ha Ra', { startedAt: iso(60_000) }));
    expect(_fightHistoryForTest()).toHaveLength(2);
  });
});

describe('refuses to record nonsense', () => {
  beforeEach(() => _resetFightHistoryForTest());

  it('ignores a null encounter', () => {
    _recordFightHistory(null);
    expect(_fightHistoryForTest()).toEqual([]);
  });

  it('ignores a fight with no name — an unnamed row is unreadable', () => {
    _recordFightHistory({ bossName: null, targetName: null, startedAt: iso(1000), perPlayer: {} });
    expect(_fightHistoryForTest()).toEqual([]);
  });

  it('falls back to the most-damaged defender when there is no catalog boss', () => {
    // Trash pulls still deserve a row; targetName is what names them.
    _recordFightHistory({ bossName: null, targetName: 'a shissar disciple',
                          startedAt: iso(30_000), flushedAt: Date.now(),
                          perPlayer: { Hitya: { swing: 100, dmg: 100 } } });
    expect(_fightHistoryForTest()[0].boss).toBe('a shissar disciple');
  });
});

// The guild lead, 2026-10-04: "damage/tanking meter could have more history in it. Make sure the history
// correctly attributes pet data to owners and DS hits from tanks." The first thing wrong with it: a row
// was swing+proc+spell, which is THREAT — a taunt adds the gap to the top of the table, a resisted
// spell adds 320, and a successful hate proc adds its own — so a tank who dealt 100 read 1,961.
describe('a row is the damage dealt, not the threat built', () => {
  beforeEach(() => _resetFightHistoryForTest());

  const tank = { swing: 100, proc: 901, spell: 960, dmg: 100 };      // t1: 100 dealt, 1,961 of threat

  it('uses the raw damage, whatever the threat says', () => {
    _recordFightHistory(fight('Aten Ha Ra', { perPlayer: { Brackwyn: tank, Aldenmar: { swing: 1000, dmg: 1000 } } }));
    const local = _fightHistoryForTest()[0].local;
    expect(local.find(p => p.character === 'Brackwyn').dmg).toBe(100);
    expect(local.map(p => p.character)).toEqual(['Aldenmar', 'Brackwyn']);     // ranked on damage: the tank is NOT first
  });

  it('a raider whose threat was zeroed (zoned mid-fight) is still on the board', () => {
    // _threatLine zeroes swing/proc/spell on "LOADING, PLEASE WAIT..." but never the raw damage.
    _recordFightHistory(fight('Aten Ha Ra', { perPlayer: { Brackwyn: { swing: 0, proc: 0, spell: 0, dmg: 5000 } } }));
    expect(_fightHistoryForTest()[0].local).toEqual([{ character: 'Brackwyn', dmg: 5000, pet_owner: null }]);
  });

  it('a row with no raw damage is not a damage row, however much threat it carries', () => {
    _recordFightHistory(fight('Aten Ha Ra', { perPlayer: { Rethlan: { swing: 0, proc: 4000, spell: 900, dmg: 0 } } }));
    expect(_fightHistoryForTest()[0].local).toEqual([]);
  });
});

describe('what a row keeps from the live one', () => {
  beforeEach(() => _resetFightHistoryForTest());

  it('keeps the pet labels the live meter shows, so History can fold and label them', () => {
    _recordFightHistory(fight('Aten Ha Ra', { perPlayer: {
      Nyssara:               { dmg: 300 },
      Kebantik:              { dmg: 100, pet_owner: 'Nyssara', pet_spawn_id: 1234 },
      'a fungoid sporeling': { dmg: 90, pet_charm: true },
      Gobeker:               { dmg: 80, pet_summoned: true },
    } }));
    const by = Object.fromEntries(_fightHistoryForTest()[0].local.map(p => [p.character, p]));
    expect(by.Kebantik).toMatchObject({ pet_owner: 'Nyssara', pet_spawn_id: 1234 });
    expect(by['a fungoid sporeling'].pet_charm).toBe(true);
    expect(by.Gobeker.pet_summoned).toBe(true);
    expect(by.Nyssara).toEqual({ character: 'Nyssara', dmg: 300, pet_owner: null });    // a raider carries no pet fields
  });

  it('stores the damage taken for a Tank History to come (kept, not shown)', () => {
    _recordFightHistory(fight('Aten Ha Ra', { perPlayer: { Corvale: { dmg: 500, took: 210, tookMax: 130 }, Aldenmar: { dmg: 400 } } }));
    const by = Object.fromEntries(_fightHistoryForTest()[0].local.map(p => [p.character, p]));
    expect(by.Corvale).toMatchObject({ took: 210, tookMax: 130 });
    expect(by.Aldenmar.took).toBeUndefined();
  });
});
