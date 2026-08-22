import { describe, it, expect } from 'vitest';
import {
  normalizeCharacterName,
  participantsFromUpload,
  memberFraction,
  classifyOurs,
  buildKillLockouts,
  dropRowsShadowedBySll,
} from '../utils/killLockouts.js';

const VENTANI = { id: 'ventani_warder', name: 'Ventani the Warder', timerHours: 162 };
const KILLED  = Date.parse('2026-08-21T14:54:58Z');
const NOW     = Date.parse('2026-08-22T02:00:00Z');

describe('normalizeCharacterName', () => {
  it('canonicalizes case', () => {
    expect(normalizeCharacterName('TAEYA')).toBe('Taeya');
    expect(normalizeCharacterName('  taeya ')).toBe('Taeya');
  });
  it('rejects pets and NPC noise', () => {
    expect(normalizeCharacterName('Gyzak`s pet')).toBeNull();
    expect(normalizeCharacterName('a decaying skeleton')).toBeNull();
    expect(normalizeCharacterName('Ventani the Warder')).toBeNull();
  });
  it('rejects parser placeholders', () => {
    expect(normalizeCharacterName('You')).toBeNull();
    expect(normalizeCharacterName('unknown pet')).toBeNull();
    expect(normalizeCharacterName('Total')).toBeNull();
  });
  it('rejects out-of-range lengths and non-strings', () => {
    expect(normalizeCharacterName('Ab')).toBeNull();
    expect(normalizeCharacterName('Abcdefghijklmnop')).toBeNull();
    expect(normalizeCharacterName(null)).toBeNull();
    expect(normalizeCharacterName(42)).toBeNull();
  });
});

describe('participantsFromUpload', () => {
  it('unions uploader, damage, healers and tanks, deduped case-insensitively', () => {
    const got = participantsFromUpload({
      contributor: 'Taeya',
      players:   [{ name: 'Badcop' }, { name: 'Sevilla' }, { name: 'badcop' }],
      healers:   [{ name: 'Taeya' }, { name: 'Vyre' }],
      defenders: [{ name: 'Moash' }],
    });
    expect(got).toEqual(['Badcop', 'Moash', 'Sevilla', 'Taeya', 'Vyre']);
  });

  it('includes the uploader even when they dealt no damage', () => {
    // The whole point: Taeya is a cleric, so she has no encounter_players row.
    const got = participantsFromUpload({ contributor: 'Taeya', players: [{ name: 'Badcop' }] });
    expect(got).toContain('Taeya');
  });

  it('accepts bare strings as well as rows', () => {
    expect(participantsFromUpload({ players: ['Hitya', 'Syko'] })).toEqual(['Hitya', 'Syko']);
  });

  it('drops pets from the damage list', () => {
    const got = participantsFromUpload({ players: [{ name: 'Hitya' }, { name: 'Gyzak`s pet' }] });
    expect(got).toEqual(['Hitya']);
  });

  it('is empty for an empty upload', () => {
    expect(participantsFromUpload({})).toEqual([]);
    expect(participantsFromUpload()).toEqual([]);
  });
});

describe('memberFraction', () => {
  const roster = new Set(['hitya', 'taeya', 'uilz']);
  it('is the share of named players on the roster', () => {
    expect(memberFraction(['Hitya', 'Taeya', 'Badcop', 'Sevilla'], roster)).toBe(0.5);
  });
  it('is case-insensitive and accepts an array roster', () => {
    expect(memberFraction(['HITYA'], ['Hitya'])).toBe(1);
  });
  it('is null when there is nothing to measure', () => {
    expect(memberFraction([], roster)).toBeNull();
    expect(memberFraction(['Hitya'], new Set())).toBeNull();
  });
});

describe('classifyOurs', () => {
  it('is true when the encounter is bound to a raid night', () => {
    expect(classifyOurs({ inRaidNight: true, inRaidWindow: false })).toBe(true);
  });

  it('is true for an off-calendar guild event — most of the raid is ours', () => {
    // Hitya 2026-08-22: "Friday was a guild rolling event, so internal, but
    // still a lockout." Measured, our raids run 0.75-0.89 roster share.
    expect(classifyOurs({
      inRaidNight: false, inRaidWindow: false, memberFrac: 0.78, playerCount: 9,
    })).toBe(true);
  });

  it('is false for somebody else\'s raid our people joined', () => {
    // The Breakfast Club morning raids measured 0.14-0.22.
    expect(classifyOurs({
      inRaidNight: false, inRaidWindow: false, memberFrac: 0.22, playerCount: 9,
    })).toBe(false);
  });

  it('will not accuse on a thin player count', () => {
    expect(classifyOurs({
      inRaidNight: false, inRaidWindow: false, memberFrac: 0, playerCount: 2,
    })).toBeNull();
  });

  it('is null — never false — when unbound, unmeasurable, but inside a raid window', () => {
    expect(classifyOurs({ inRaidNight: false, inRaidWindow: true })).toBeNull();
  });

  it('is false only when unbound, unmeasurable and outside every raid window', () => {
    expect(classifyOurs({ inRaidNight: false, inRaidWindow: false })).toBe(false);
  });
});

describe('buildKillLockouts', () => {
  const base = {
    boss: VENTANI, killedAtMs: KILLED, participants: ['Taeya', 'Badcop'],
    inRaidNight: false, inRaidWindow: false,
    guildId: 'wolfpack', encounterId: 'enc-1', observedBy: 'Taeya', observedAtMs: NOW,
  };

  it('expires at kill time plus the boss timer', () => {
    const [row] = buildKillLockouts(base);
    expect(row.expires_at).toBe(new Date(KILLED + 162 * 3600000).toISOString());
    expect(row.implied_kill_at).toBe(new Date(KILLED).toISOString());
  });

  it('marks a Friday-morning kill as not ours', () => {
    expect(buildKillLockouts(base).every(r => r.ours === false)).toBe(true);
  });

  it('marks the same off-calendar kill as OURS when the roster fills it', () => {
    const out = buildKillLockouts({ ...base, roster: new Set(['taeya', 'badcop']) });
    expect(out.every(r => r.ours === true)).toBe(true);
  });

  it('stamps source and encounter so the row is traceable to its parse', () => {
    const [row] = buildKillLockouts(base);
    expect(row.source).toBe('kill');
    expect(row.encounter_id).toBe('enc-1');
    expect(row.observed_by).toBe('Taeya');
  });

  it('emits one row per participant', () => {
    expect(buildKillLockouts(base).map(r => r.character)).toEqual(['Taeya', 'Badcop']);
  });

  it('returns nothing when the lockout already lifted', () => {
    // Backfilling a log from a month ago must not file an expired lockout.
    const old = { ...base, killedAtMs: KILLED - 200 * 3600000 };
    expect(buildKillLockouts(old)).toEqual([]);
  });

  it('refuses an implausible boss timer rather than filing a year-long lockout', () => {
    expect(buildKillLockouts({ ...base, boss: { ...VENTANI, timerHours: 9000 } })).toEqual([]);
    expect(buildKillLockouts({ ...base, boss: { ...VENTANI, timerHours: 0 } })).toEqual([]);
  });

  it('refuses incomplete input', () => {
    expect(buildKillLockouts({ ...base, boss: null })).toEqual([]);
    expect(buildKillLockouts({ ...base, participants: [] })).toEqual([]);
    expect(buildKillLockouts({ ...base, killedAtMs: NaN })).toEqual([]);
    expect(buildKillLockouts()).toEqual([]);
  });
});

describe('dropRowsShadowedBySll', () => {
  const rows = buildKillLockouts({
    boss: VENTANI, killedAtMs: KILLED, participants: ['Taeya', 'Badcop'], observedAtMs: NOW,
  });

  it('keeps everything when there is no /sll row', () => {
    expect(dropRowsShadowedBySll(rows, [], NOW)).toHaveLength(2);
  });

  it('yields to a live /sll row — the server time beats our computed one', () => {
    const existing = [{
      character: 'Taeya', boss_key: 'ventani_warder', source: 'sll',
      expires_at: new Date(NOW + 100 * 3600000).toISOString(),
    }];
    expect(dropRowsShadowedBySll(rows, existing, NOW).map(r => r.character)).toEqual(['Badcop']);
  });

  it('ignores an /sll row that has already expired', () => {
    const existing = [{
      character: 'Taeya', boss_key: 'ventani_warder', source: 'sll',
      expires_at: new Date(NOW - 1000).toISOString(),
    }];
    expect(dropRowsShadowedBySll(rows, existing, NOW)).toHaveLength(2);
  });

  it('does not yield to another kill-derived row', () => {
    const existing = [{
      character: 'Taeya', boss_key: 'ventani_warder', source: 'kill',
      expires_at: new Date(NOW + 100 * 3600000).toISOString(),
    }];
    expect(dropRowsShadowedBySll(rows, existing, NOW)).toHaveLength(2);
  });

  it('matches case-insensitively on character', () => {
    const existing = [{
      character: 'taeya', boss_key: 'ventani_warder', source: 'sll',
      expires_at: new Date(NOW + 100 * 3600000).toISOString(),
    }];
    expect(dropRowsShadowedBySll(rows, existing, NOW).map(r => r.character)).toEqual(['Badcop']);
  });
});
