// test/overlay-age-liveness.test.js — overlays must not render a value they
// cannot date, or one whose subject is dead.
//
// The class of bug (Hitya, 2026-08-09 Emperor Ssraeshza):
//   • Target Info showed the main tank at "7k / 7k · 100%" while he was at
//     roughly half health. The percentage came from the live Zeal gauge; the
//     exact pair came from a cross-client snapshot the bot will serve up to 90s
//     old — and will happily backfill from a groupmate's raid_roster row. Two
//     sources, two ages, rendered side by side as if they agreed.
//   • After he died he stayed listed as the tank AND was published as an
//     off-heal candidate at 32%, because recent tank hits keep a name inside the
//     window and his last-known HP still read as "hurt".
//
// The fix is two primitives: age a cross-client value against the BOT's stamp
// (one clock for everyone, so only our own offset needs correcting), and keep a
// death registry any surface can consult. The house rule is the one already in
// this file for implausible HP pools — when a number cannot be stood behind,
// return NOTHING and let the card fall back to the live percentage.
//
// Run: npx vitest run test/overlay-age-liveness.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const agent = require('../packages/wolfpack-logsync/index.js');

const {
  _noteDeath, _clearDeath, _isDead, _deadNamesSnapshot,
  _ageOfServerStamp, _resolveHpValuesForName,
} = agent;

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
// A plausible raid HP pool — must clear the MIN_PLAUSIBLE_HP_POOL floor of 500.
const POOL = { self_hp_cur: 3990, self_hp_max: 7075 };
const FULL = { self_hp_cur: 7075, self_hp_max: 7075 };

describe('_ageOfServerStamp', () => {
  it('ages a recent stamp to roughly zero', () => {
    expect(_ageOfServerStamp(iso(0))).toBeLessThan(2000);
  });

  it('measures a genuinely old stamp', () => {
    const age = _ageOfServerStamp(iso(90_000));
    expect(age).toBeGreaterThan(85_000);
    expect(age).toBeLessThan(95_000);
  });

  it('fails CLOSED on anything unusable', () => {
    // Infinity, not 0 — every caller tests `age > limit`, so an unparseable
    // stamp must read as infinitely old rather than as fresh.
    expect(_ageOfServerStamp(null)).toBe(Infinity);
    expect(_ageOfServerStamp('')).toBe(Infinity);
    expect(_ageOfServerStamp('not a date')).toBe(Infinity);
  });
});

describe('the death registry', () => {
  beforeEach(() => { _clearDeath('hawkner'); _clearDeath('currygoat'); });

  it('records and reports a death', () => {
    expect(_isDead('hawkner')).toBe(false);
    _noteDeath('Hawkner', Date.now());
    expect(_isDead('hawkner')).toBe(true);
  });

  it('is case-insensitive on the way in and out', () => {
    _noteDeath('HAWKNER', Date.now());
    expect(_isDead('hawkner')).toBe(true);
  });

  it('clears on rez', () => {
    _noteDeath('Hawkner', Date.now());
    _clearDeath('Hawkner');
    expect(_isDead('hawkner')).toBe(false);
  });

  it('forgets an old death rather than tombstoning someone all night', () => {
    // We do not observe every rez. An entry that never expired would mark a
    // raider dead for the rest of the raid — worse than briefly missing a corpse.
    _noteDeath('Hawkner', Date.now() - 16 * 60_000);
    expect(_isDead('hawkner')).toBe(false);
  });

  it('snapshots the currently dead with how long ago', () => {
    _noteDeath('Currygoat', Date.now() - 5000);
    const snap = _deadNamesSnapshot();
    const row = snap.find(r => r.name === 'currygoat');
    expect(row).toBeTruthy();
    expect(row.since_ms).toBeGreaterThanOrEqual(4000);
  });
});

describe('_resolveHpValuesForName — exact HP must be datable', () => {
  it('drops a cross-client pair that is older than the percentage beside it', () => {
    // The reported bug: the bot serves exact numbers up to 90s old, and can
    // backfill them from raid_roster. On a tank taking 900-damage swings a
    // 90s-old pair is fiction.
    agent._mtLiveStateByName.set('hawkner', {
      at: Date.now(),
      state: { ...FULL, updated_at: iso(90_000) },
    });
    expect(_resolveHpValuesForName('hawkner', null, {})).toBeNull();
  });

  it('keeps a fresh cross-client pair and labels where it came from', () => {
    agent._mtLiveStateByName.set('hawkner', {
      at: Date.now(),
      state: { ...POOL, updated_at: iso(3000) },
    });
    const v = _resolveHpValuesForName('hawkner', null, {});
    expect(v).toBeTruthy();
    expect(v.cur).toBe(3990);
    expect(v.max).toBe(7075);
    expect(v.source).toBe('relay');
    expect(v.age_ms).toBeLessThan(20_000);
  });

  it('drops a pair with no usable stamp at all', () => {
    // An older bot that does not send updated_at must not be treated as live.
    agent._mtLiveStateByName.set('hawkner', { at: Date.now(), state: { ...FULL } });
    expect(_resolveHpValuesForName('hawkner', null, {})).toBeNull();
  });

  it('the viewer\'s own numbers are always exact and never age-gated', () => {
    // Self comes straight off the local Zeal labels — same clock, sub-second.
    const v = _resolveHpValuesForName('hitya', 'Hitya', { ...POOL });
    expect(v).toBeTruthy();
    expect(v.source).toBe('self');
    expect(v.cur).toBe(3990);
  });

  it('still rejects an implausible pool regardless of freshness', () => {
    // The existing guard must survive the change: 130/180 was a Zeal WEIGHT
    // pair that once rendered as a raider's HP.
    agent._mtLiveStateByName.set('stupidrichard', {
      at: Date.now(),
      state: { self_hp_cur: 130, self_hp_max: 180, updated_at: iso(1000) },
    });
    expect(_resolveHpValuesForName('stupidrichard', null, {})).toBeNull();
  });
});
