// test/opendkp-raid-pick.test.js — which raid a loot post charges against.
//
// Reported mid-raid, 2026-08-27 21:01 ET, while officers were posting loot:
// "the raid bot didn't select the raid properly when i'm posting loot tonight".
// Tonight's raid was #101157; the bot linked to #101101, the previous night's.
//
// getMostRecentRaid sorted by `Timestamp` alone. Two things wrong with that,
// both measured against our 413-raid mirror rather than reasoned about:
//
//   1. Timestamp is a DATE AN OFFICER TYPES and it drifts — the raid named
//      "8-23-26 Vex Thal" carries a timestamp of 8-22. A raid created tonight
//      carrying yesterday's date sorts BELOW yesterday's raid and loses.
//   2. TEN raids share a timestamp with another raid, across 9 dates (a main
//      and an alt raid on one night, a re-created raid). The comparator returns
//      0 there and the winner falls to OpenDKP's array order — which for the
//      sibling /auctions endpoint a production probe PROVED is oldest-first.
//      So on those nights it was a coin flip.
//
// RaidId is server-assigned and monotonic. Id order and timestamp order
// disagree on 10 of 413 rows, and the id is the one that is right.
//
// Run: npx vitest run test/opendkp-raid-pick.test.js

import { describe, it, expect } from 'vitest';
import { readSource, ROOT } from './_source-slice.js';
import path from 'node:path';
import { _pickCurrentRaid, _raidLooksStale, _listRows } from '../utils/opendkp.js';

const NOW = Date.parse('2026-08-28T02:00:00Z');   // 10pm ET Thursday, mid-raid
const raid = (id, name, ts) => ({ RaidId: id, Name: name, Timestamp: ts });

const YESTERDAY = raid(101101, '8-26-26 Vulak and VT Trash', '2026-08-26T12:00:00Z');
const TONIGHT   = raid(101157, '8-27-26 Thursday',           '2026-08-26T12:00:00Z');

describe('picking the raid to charge loot against', () => {
  it('picks tonight even when it carries YESTERDAY’s date — the live failure', () => {
    // The exact reported shape: real ids, and a tie on Timestamp.
    expect(_pickCurrentRaid([YESTERDAY, TONIGHT], NOW).RaidId).toBe(101157);
  });

  it('is not decided by the order OpenDKP happens to return', () => {
    // The old comparator returned 0 for these, so the answer depended on array
    // order. Both orderings must now give the same raid.
    expect(_pickCurrentRaid([YESTERDAY, TONIGHT], NOW).RaidId).toBe(101157);
    expect(_pickCurrentRaid([TONIGHT, YESTERDAY], NOW).RaidId).toBe(101157);
  });

  it('ignores a raid staged for a future date', () => {
    // An officer setting up next week must not silently collect tonight's loot
    // by virtue of having the highest id.
    const staged = raid(101999, 'next Wednesday', '2026-09-02T12:00:00Z');
    expect(_pickCurrentRaid([YESTERDAY, TONIGHT, staged], NOW).RaidId).toBe(101157);
  });

  it('still accepts a raid dated slightly ahead — timezone slop, not staging', () => {
    // Raid timestamps are date-only at noon UTC; a raid entered for "tomorrow"
    // by an officer in another timezone is tonight's raid, not a staged one.
    const tomorrow = raid(101160, '8-28-26', '2026-08-28T12:00:00Z');
    expect(_pickCurrentRaid([YESTERDAY, TONIGHT, tomorrow], NOW).RaidId).toBe(101160);
  });

  it('keeps rows with no usable timestamp rather than discarding them', () => {
    const undated = raid(101200, 'no date', null);
    expect(_pickCurrentRaid([YESTERDAY, undated], NOW).RaidId).toBe(101200);
  });

  it('returns null on nothing usable instead of guessing', () => {
    expect(_pickCurrentRaid([], NOW)).toBe(null);
    expect(_pickCurrentRaid(null, NOW)).toBe(null);
    expect(_pickCurrentRaid([{ Name: 'no id' }], NOW)).toBe(null);
  });
});

describe('staleness warning', () => {
  it('flags a raid old enough to be the wrong night', () => {
    expect(_raidLooksStale(YESTERDAY, NOW)).toBe(true);
  });

  it('does NOT flag tonight’s raid', () => {
    // ⚠ The threshold has to clear the date-only timestamp: a raid created for
    // today reads as ~14h old by 10pm ET, and warning on every normal post
    // would train officers to ignore the warning.
    expect(_raidLooksStale(raid(101157, 'tonight', '2026-08-27T12:00:00Z'), NOW)).toBe(false);
  });

  it('does not flag a raid with no timestamp to judge', () => {
    expect(_raidLooksStale(raid(1, 'x', null), NOW)).toBe(false);
  });
});

// ── The shape unwrap belongs in getRaids, not in one caller ─────────────────
// 2026-08-28: syncRaidsList was taught to unwrap and started working again,
// while getMostRecentRaid — which still demanded a bare array — kept returning
// null. A null raid means linkRaidId = 0, i.e. loot posted against NO raid,
// which is what the reported symptom actually was. Fixing one call site and
// leaving the other is how a bug survives its own fix.
describe('list payload unwrapping', () => {
  const rows = [{ RaidId: 101157 }];

  it('returns rows for a bare array and for every wrapper this API uses', () => {
    for (const payload of [rows, { Results: rows }, { Raids: rows }, { Items: rows }, { data: rows }]) {
      expect(_listRows(payload)).toEqual(rows);
    }
  });

  it('passes an unrecognised payload THROUGH rather than faking an empty list', () => {
    // Returning [] here would turn "we cannot read the response" into "there
    // are no raids", which reads as success and silently unlinks every auction.
    const weird = { Nope: 1 };
    expect(_listRows(weird)).toBe(weird);
    expect(Array.isArray(_listRows(weird))).toBe(false);
  });

  it('getRaids applies it, so every caller is covered at once', () => {
    const src = readSource(path.join(ROOT, 'utils', 'opendkp.js'));
    expect(src).toContain('return _listRows(await _get({ ..._clientUrl(\'/raids\' + q), headers }));');
  });
});
