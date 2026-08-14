// test/fight-history-ring.test.js — the last few mobs, captured at the kill.
//
// Hitya, 2026-08-14: "instead of displaying the combined damage during the
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
    perPlayer: opts.perPlayer || {
      Hitya:   { swing: 5000, proc: 1000, spell: 0 },
      Wabumkin:{ swing: 0, proc: 0, spell: 40000 },
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

  it('keeps only the last few', () => {
    for (let i = 1; i <= 9; i++) _recordFightHistory(fight('Mob ' + i));
    const h = _fightHistoryForTest();
    expect(h.length).toBeLessThanOrEqual(6);
    expect(h[0].boss).toBe('Mob 9');
    expect(h.map(x => x.boss)).not.toContain('Mob 1');
  });
});

describe('one kill is one entry', () => {
  beforeEach(() => _resetFightHistoryForTest());

  it('a multi-box install does not record the same fight twice', () => {
    // flush() runs per builder AND propagates to peer builders on the same
    // fight, so a two-box machine calls this two or three times for one kill.
    const started = iso(60_000);
    _recordFightHistory(fight('Aten Ha Ra', { startedAt: started }));
    _recordFightHistory(fight('Aten Ha Ra', { startedAt: started }));
    _recordFightHistory(fight('Aten Ha Ra', { startedAt: new Date(Date.parse(started) + 4000).toISOString() }));
    expect(_fightHistoryForTest()).toHaveLength(1);
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
                          perPlayer: { Hitya: { swing: 100 } } });
    expect(_fightHistoryForTest()[0].boss).toBe('a shissar disciple');
  });
});
