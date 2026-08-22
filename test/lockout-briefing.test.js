// test/lockout-briefing.test.js — the pre-raid lockout briefing.
// Real-imports the pure builder (utils/lockoutBriefing.js).
//
// Hitya 2026-08-21: "put it into a post in officer chat about characters
// currently locked out for the upcoming night's raid by zone from the raid
// planner's event" — and, correcting my model the same day: "characters are
// locked from engaging that specific mob and get teleported out of the zone on
// engage … can't fight at all, can't loot."

import { describe, it, expect } from 'vitest';
import { buildLockoutBriefing } from '../utils/lockoutBriefing.js';

const BOSSES = [
  { id: 'lord_inquisitor_seru', name: 'Lord Inquisitor Seru', zone: 'Sanctus Seru', emoji: '⚔' },
  { id: 'praesertum_bikun',     name: 'Praesertum Bikun',     zone: 'Sanctus Seru', emoji: '' },
  { id: 'aten_ha_ra',           name: 'Aten Ha Ra',           zone: 'Vex Thal',     emoji: '👑' },
  { id: 'lord_nagafen',         name: 'Lord Nagafen',         zone: "Nagafen's Lair", emoji: '🐉' },
];
const kindOf = n => (n === 'Hitya' ? 'main' : n === 'Nobody' ? 'unknown' : 'alt');
const lk = (character, boss_key, extra = {}) =>
  ({ character, boss_key, expires_at: '2026-08-23T02:00:00Z', ours: false, ...extra });

describe('buildLockoutBriefing', () => {
  it('groups by zone and only counts bosses on tonight\'s list', () => {
    const out = buildLockoutBriefing({
      targetBossIds: ['lord_inquisitor_seru', 'aten_ha_ra'],
      bosses: BOSSES,
      lockouts: [
        lk('Melting', 'lord_inquisitor_seru'),
        lk('Rockin',  'aten_ha_ra'),
        lk('Someone', 'lord_nagafen'),   // not on tonight's list — must not appear
      ],
      kindOf,
    });
    expect(out.total).toBe(2);
    expect(out.zones.map(z => z.zone).sort()).toEqual(['Sanctus Seru', 'Vex Thal']);
    expect(JSON.stringify(out)).not.toContain('Nagafen');
  });

  it('puts MAINS first and counts them — the surprising case', () => {
    const out = buildLockoutBriefing({
      targetBossIds: ['aten_ha_ra'],
      bosses: BOSSES,
      lockouts: [lk('Zzz', 'aten_ha_ra'), lk('Hitya', 'aten_ha_ra'), lk('Aaa', 'aten_ha_ra')],
      kindOf,
    });
    expect(out.mains).toBe(1);
    expect(out.zones[0].bosses[0].chars[0].name).toBe('Hitya');
  });

  it('names the targets nobody is locked to, so the post reads as a check that RAN', () => {
    const out = buildLockoutBriefing({
      targetBossIds: ['lord_inquisitor_seru', 'aten_ha_ra'],
      bosses: BOSSES,
      lockouts: [lk('Melting', 'aten_ha_ra')],
      kindOf,
    });
    expect(out.targetsWithNone).toEqual(['Lord Inquisitor Seru']);
  });

  it('an all-clear night is empty totals with every target listed clear', () => {
    const out = buildLockoutBriefing({
      targetBossIds: ['lord_inquisitor_seru', 'aten_ha_ra'],
      bosses: BOSSES, lockouts: [], kindOf,
    });
    expect(out.total).toBe(0);
    expect(out.zones).toEqual([]);
    expect(out.targetsWithNone).toHaveLength(2);
  });

  it('zones sort by how many people are blocked, busiest first', () => {
    const out = buildLockoutBriefing({
      targetBossIds: ['lord_inquisitor_seru', 'praesertum_bikun', 'aten_ha_ra'],
      bosses: BOSSES,
      lockouts: [
        lk('A', 'aten_ha_ra'),
        lk('B', 'lord_inquisitor_seru'), lk('C', 'praesertum_bikun'), lk('D', 'praesertum_bikun'),
      ],
      kindOf,
    });
    expect(out.zones[0].zone).toBe('Sanctus Seru');   // 3 blocked vs 1
    expect(out.zones[0].count).toBe(3);
  });

  it('an unknown boss id still reports, under Unknown zone rather than vanishing', () => {
    const out = buildLockoutBriefing({
      targetBossIds: ['mystery_boss'], bosses: BOSSES,
      lockouts: [lk('Melting', 'mystery_boss')], kindOf,
    });
    expect(out.zones[0].zone).toBe('Unknown zone');
    expect(out.total).toBe(1);
  });

  it('counts characters we do not know but keeps them out of the post', () => {
    // A parse of a raid we joined carries the other guild's whole roster, and
    // since 2026-08-22 those become lockout rows too. They are real, but an
    // officer briefing that lists sixty strangers hides the two names that
    // matter.
    const out = buildLockoutBriefing({
      targetBossIds: ['lord_inquisitor_seru'],
      bosses: BOSSES,
      lockouts: [
        lk('Hitya',  'lord_inquisitor_seru'),
        lk('Nobody', 'lord_inquisitor_seru'),
        lk('Nobody', 'lord_inquisitor_seru'),
      ],
      kindOf,
    });
    expect(out.total).toBe(1);
    expect(out.outsiders).toBe(2);
    expect(JSON.stringify(out)).not.toContain('Nobody');
  });

  it('reports a target as clear when only outsiders are locked to it', () => {
    const out = buildLockoutBriefing({
      targetBossIds: ['aten_ha_ra'],
      bosses: BOSSES,
      lockouts: [lk('Nobody', 'aten_ha_ra')],
      kindOf,
    });
    expect(out.total).toBe(0);
    expect(out.targetsWithNone).toEqual(['Aten Ha Ra']);
  });

  it('names only the targets that are actually UP', () => {
    // After one of our own kills the whole raid is locked AND the boss is
    // down — the headcount is real but nobody was going to pull it. The
    // divergence (target up, our people still locked) is the officer signal.
    const out = buildLockoutBriefing({
      targetBossIds: ['lord_inquisitor_seru', 'aten_ha_ra'],
      bosses: BOSSES,
      lockouts: [
        lk('Hitya',   'aten_ha_ra'),            // up — must be named
        lk('Melting', 'lord_inquisitor_seru'),  // down — counted, not named
        lk('Rockin',  'lord_inquisitor_seru'),
      ],
      kindOf,
      isTargetUp: id => id !== 'lord_inquisitor_seru',
    });
    expect(out.total).toBe(3);
    expect(out.actionable).toBe(1);
    expect(out.onDownTargets).toBe(2);
    expect(out.zones.map(z => z.zone)).toEqual(['Vex Thal']);
    expect(JSON.stringify(out.zones)).not.toContain('Melting');
  });

  it('treats an unknown timer as up, so a missing state never hides a block', () => {
    const out = buildLockoutBriefing({
      targetBossIds: ['aten_ha_ra'],
      bosses: BOSSES,
      lockouts: [lk('Hitya', 'aten_ha_ra')],
      kindOf,
      isTargetUp: () => undefined,
    });
    expect(out.actionable).toBe(1);
    expect(out.zones).toHaveLength(1);
  });

  it('calls a down target clear, since nobody can be blocked from a corpse', () => {
    const out = buildLockoutBriefing({
      targetBossIds: ['aten_ha_ra'],
      bosses: BOSSES,
      lockouts: [lk('Hitya', 'aten_ha_ra')],
      kindOf,
      isTargetUp: () => false,
    });
    expect(out.actionable).toBe(0);
    expect(out.targetsWithNone).toEqual(['Aten Ha Ra']);
  });

  it('survives empty input without throwing', () => {
    expect(buildLockoutBriefing()).toEqual({
      zones: [], total: 0, mains: 0, outsiders: 0,
      actionable: 0, onDownTargets: 0, targetsWithNone: [],
    });
  });
});
