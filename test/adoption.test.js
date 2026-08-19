// test/adoption.test.js — the /admin/adoption metric transforms.
//
// Every number on that page is a claim to the guild lead about product
// health; the traps each test pins produced a plausible-looking wrong chart
// while building it: partial current weeks reading as decline, characters
// counted instead of players, and off-night solo grinding polluting the
// raid-night corroboration signal (measured live: 183 Monday "fights" at
// 1.1 uploaders).
//
// Run: npx vitest run test/adoption.test.js

import { describe, it, expect } from 'vitest';
import {
  weeklyActive, firstUploadByPlayer, activations, activationsByMonth,
  retention, raidNightKey, corroborationByNight, versionSpread,
  conversionTargets, displayName, NEW_RAIDER_WINDOW_DAYS,
} from '../web/lib/adoption.ts';

const NOW = Date.parse('2026-08-18T12:00:00Z');   // a Tuesday
const day = (iso, id, uploads = 1) => ({ discord_id: id, day: iso, uploads });

describe('weeklyActive — players per week', () => {
  it('counts distinct PLAYERS, flags the current week partial', () => {
    const rows = [
      day('2026-08-10T00:00:00Z', 'a'), day('2026-08-11T00:00:00Z', 'a'),   // same player twice
      day('2026-08-12T00:00:00Z', 'b'),
      day('2026-08-17T00:00:00Z', 'c'),                                     // current week (Mon)
    ];
    const weeks = weeklyActive(rows, 3, NOW);
    expect(weeks).toHaveLength(3);
    expect(weeks[1]).toMatchObject({ weekStart: '2026-08-10', players: 2, partial: false });
    expect(weeks[2]).toMatchObject({ weekStart: '2026-08-17', players: 1, partial: true });
  });
  it('empty weeks render as zero, not gaps', () => {
    const weeks = weeklyActive([day('2026-08-17T00:00:00Z', 'a')], 4, NOW);
    expect(weeks.map(w => w.players)).toEqual([0, 0, 0, 1]);
  });
});

describe('activations — new raider vs converted veteran', () => {
  const members = new Map([
    ['fresh', { discord_id: 'fresh', nickname: 'Fresh', global_name: null, joined_at: '2026-08-01T00:00:00Z' }],
    ['vet',   { discord_id: 'vet',   nickname: 'Vet',   global_name: null, joined_at: '2025-01-01T00:00:00Z' }],
  ]);
  it('splits on joined_at within the onboarding window', () => {
    const acts = activations([
      day('2026-08-10T00:00:00Z', 'fresh'),   // joined 9 days before first upload
      day('2026-08-10T00:00:00Z', 'vet'),     // joined 19 months before
      day('2026-08-10T00:00:00Z', 'ghost'),   // not in wolfpack_members
    ], members);
    const byId = Object.fromEntries(acts.map(a => [a.discordId, a.kind]));
    expect(byId).toEqual({ fresh: 'new_raider', vet: 'converted', ghost: 'unknown' });
    expect(NEW_RAIDER_WINDOW_DAYS).toBe(60);
  });
  it('first upload wins over later ones; months bucket', () => {
    const acts = activations([
      day('2026-07-20T00:00:00Z', 'vet'), day('2026-08-10T00:00:00Z', 'vet'),
    ], members);
    expect(acts).toHaveLength(1);
    expect(activationsByMonth(acts)).toEqual([
      { month: '2026-07', total: 1, new_raider: 0, converted: 1, unknown: 0 },
    ]);
  });
});

describe('retention', () => {
  it('young players cannot churn; stale mature players do', () => {
    const rows = [
      day('2026-05-01T00:00:00Z', 'oldfaithful'), day('2026-08-15T00:00:00Z', 'oldfaithful'),
      day('2026-05-01T00:00:00Z', 'ghost'),                             // mature, silent
      day('2026-08-10T00:00:00Z', 'newbie'),                            // too young to count
    ];
    const r = retention(rows, NOW);
    expect(r).toMatchObject({ eligible: 2, retained: 1, pct: 50 });
    expect(r.churned).toEqual(['ghost']);
  });
});

describe('raid-night corroboration — the off-night filter', () => {
  it('keys ET raid nights and keeps after-midnight spill with its night', () => {
    // 2026-08-16 was a Sunday. 21:48 ET = 01:48Z Monday — still Sunday's raid.
    expect(raidNightKey('2026-08-17T01:48:36+00:00')).toBe('2026-08-16');
    // Monday evening ET is not a raid night at all.
    expect(raidNightKey('2026-08-17T23:00:00-04:00')).toBe(null);
  });
  it('aggregates per night; classified fights excluded; solo nights never leak in', () => {
    const enc = (at, uploaders, classification = null) =>
      ({ encounter_id: 'x', started_at: at, classification, uploaders });
    const nights = corroborationByNight([
      enc('2026-08-17T01:48:00Z', 11), enc('2026-08-17T02:11:00Z', 13), enc('2026-08-17T01:52:00Z', 2),
      enc('2026-08-17T01:56:00Z', 9, 'wipe'),               // classified — out
      enc('2026-08-17T20:00:00Z', 1), enc('2026-08-17T21:00:00Z', 1),   // Monday — out
    ]);
    expect(nights).toEqual([
      { night: '2026-08-16', fights: 3, avgUploaders: 8.7, pct3plus: 67 },
    ]);
  });
});

describe('versionSpread — players at their latest version', () => {
  it('one vote per player, from their most recent upload', () => {
    const spread = versionSpread([
      { uploaded_by_discord_id: 'a', agent_version: '3.5.72', last_uploaded_at: '2026-08-01T00:00:00Z' },
      { uploaded_by_discord_id: 'a', agent_version: '3.5.80', last_uploaded_at: '2026-08-16T00:00:00Z' },
      { uploaded_by_discord_id: 'b', agent_version: '3.5.80', last_uploaded_at: '2026-08-16T00:00:00Z' },
      { uploaded_by_discord_id: null, agent_version: '9.9.9', last_uploaded_at: '2026-08-16T00:00:00Z' },
    ]);
    expect(spread).toEqual([{ version: '3.5.80', players: 2 }]);
  });
});

describe('conversionTargets — raided, never uploaded', () => {
  it('folds alts to the family root, subtracts uploaders, surfaces unlinked', () => {
    const chars = [
      { name: 'Mainguy',  main_name: null,      discord_id: 'd1' },
      { name: 'Altguy',   main_name: 'Mainguy', discord_id: null },
      { name: 'Uploader', main_name: null,      discord_id: 'd2' },
      { name: 'Nolink',   main_name: null,      discord_id: null },
    ];
    const { targets, unlinked } = conversionTargets(
      ['Altguy', 'Uploader', 'Nolink', 'Stranger'],
      chars,
      new Set(['d2']),
    );
    expect(targets).toEqual(['d1']);              // Altguy folded to Mainguy → d1, never uploaded
    expect(unlinked).toEqual(['Nolink', 'Stranger']);
  });
});

describe('displayName', () => {
  it('nickname → global name → id tail', () => {
    expect(displayName({ discord_id: 'x', nickname: 'Hitya', global_name: 'h', joined_at: null }, 'x')).toBe('Hitya');
    expect(displayName(undefined, '123456789')).toBe('…6789');
  });
});
