// test/pre-raid-checklist.test.js — the officer-chat pre-raid checklist.
// Real-imports the pure builder (utils/preRaidChecklist.js).
//
// Hitya 2026-08-21: "let's build an admin-facing officer-chat pre-raid
// checklist, active mimics, class shortages below our average, lockouts,
// other pertinent details."

import { describe, it, expect } from 'vitest';
import { buildPreRaidChecklist } from '../utils/preRaidChecklist.js';

const BOSSES = [
  { id: 'aten_ha_ra', name: 'Aten Ha Ra', zone: 'Vex Thal', emoji: '👑' },
];
const base = {
  signups: { going: 30, tentative: 2, absent: 1, bench: 0 },
  typicalHeadcount: 30,
  tonightByClass: new Map([['Cleric', 5], ['Warrior', 4], ['Wizard', 6]]),
  avgByClass:     new Map([['Cleric', 5], ['Warrior', 4], ['Wizard', 6]]),
  signedUpPlayers: [{ discordId: '1', name: 'Hitya', mimicActive: true }],
  targets: [{ bossId: 'aten_ha_ra', name: 'Aten Ha Ra', zone: 'Vex Thal', upNow: true }],
  lockoutInput: { targetBossIds: ['aten_ha_ra'], bosses: BOSSES, lockouts: [] },
  nowMs: 1_000_000_000_000,
};

describe('buildPreRaidChecklist', () => {
  it('a clean night reports ok with no flags', () => {
    const out = buildPreRaidChecklist(base);
    expect(out.ok).toBe(true);
    expect(out.flags).toEqual([]);
  });

  it('flags a class only when BOTH the ratio and an absolute head are missing', () => {
    const out = buildPreRaidChecklist({
      ...base,
      // Clerics 2 of 5 — a crisis. Wizards 5 of 6 — a Tuesday, not news.
      tonightByClass: new Map([['Cleric', 2], ['Warrior', 4], ['Wizard', 5]]),
    });
    expect(out.shortages.map(s => s.cls)).toEqual(['Cleric']);
    expect(out.shortages[0]).toMatchObject({ have: 2, avg: 5, gap: 3 });
  });

  it('sorts shortages by the biggest ABSOLUTE gap — heads missing, not ratio', () => {
    const out = buildPreRaidChecklist({
      ...base,
      tonightByClass: new Map([['Cleric', 3], ['Warrior', 0], ['Wizard', 6]]),
      avgByClass:     new Map([['Cleric', 6], ['Warrior', 4], ['Wizard', 6]]),
    });
    // Warrior 0 of 4 (4 heads missing) outranks Cleric 3 of 6 (3 missing),
    // even though the cleric RATIO is worse — you can raid a cleric light,
    // you cannot raid with no warriors.
    expect(out.shortages.map(s => s.cls)).toEqual(['Warrior', 'Cleric']);
  });

  it('counts Mimic coverage in PLAYERS and names who is missing', () => {
    const out = buildPreRaidChecklist({
      ...base,
      signedUpPlayers: [
        { discordId: '1', name: 'Hitya', mimicActive: true },
        { discordId: '2', name: 'Zzz',   mimicActive: false },
        { discordId: '3', name: 'Aaa',   mimicActive: false },
      ],
    });
    expect(out.mimic).toMatchObject({ players: 3, active: 1 });
    expect(out.mimic.missing).toEqual(['Aaa', 'Zzz']);       // sorted
    expect(out.flags).toContain('2 without Mimic');
  });

  it('calls out targets that are NOT up, soonest first, with minutes', () => {
    const out = buildPreRaidChecklist({
      ...base,
      targets: [
        { bossId: 'a', name: 'Late Boss',  upNow: false, spawnsAtMs: base.nowMs + 120 * 60000 },
        { bossId: 'b', name: 'Soon Boss',  upNow: false, spawnsAtMs: base.nowMs + 30 * 60000 },
        { bossId: 'c', name: 'Ready Boss', upNow: true },
      ],
    });
    expect(out.targetStatus.up).toEqual(['Ready Boss']);
    expect(out.targetStatus.down.map(d => d.name)).toEqual(['Soon Boss', 'Late Boss']);
    expect(out.targetStatus.down[0].minsAway).toBe(30);
    expect(out.flags).toContain('2 targets not up');
  });

  it('a thin roster is flagged against our own norm, not a magic number', () => {
    const out = buildPreRaidChecklist({ ...base, signups: { ...base.signups, going: 18 } });
    expect(out.flags.some(f => f.startsWith('thin roster'))).toBe(true);
    // 26 of 30 is not thin — the guild has quiet nights.
    const ok = buildPreRaidChecklist({ ...base, signups: { ...base.signups, going: 26 } });
    expect(ok.flags.some(f => f.startsWith('thin roster'))).toBe(false);
  });

  it('folds the lockout briefing in, grouped by zone', () => {
    const out = buildPreRaidChecklist({
      ...base,
      lockoutInput: {
        targetBossIds: ['aten_ha_ra'], bosses: BOSSES,
        lockouts: [{ character: 'Melting', boss_key: 'aten_ha_ra', expires_at: 'x', ours: false }],
        kindOf: () => 'alt',
      },
    });
    expect(out.lockouts.total).toBe(1);
    expect(out.lockouts.zones[0].zone).toBe('Vex Thal');
    expect(out.flags).toContain('1 locked out');
  });

  it('no signups is its own flag, not just a thin roster', () => {
    const out = buildPreRaidChecklist({ ...base, signups: { going: 0, tentative: 0, absent: 0, bench: 0 } });
    expect(out.flags).toContain('no signups yet');
    expect(out.flags.some(f => f.startsWith('thin roster'))).toBe(false);
  });

  it('survives empty input', () => {
    const out = buildPreRaidChecklist();
    expect(out.ok).toBe(false);              // no signups is not "fine"
    expect(out.lockouts.total).toBe(0);
  });
});
