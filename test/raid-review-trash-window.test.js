// noteTrashKill must only count mobs killed DURING the raid.
//
// Field bug (2026-08-02 review, reported by Uilnayar): the "Trash cleared"
// section read "967 mobs cleared · 17.49M damage · 9h 22m in combat" for a raid
// that ran 8:54p → 10:42p — 1h48m. Its top entries (A Poxed Soriz ×85, a
// grimling priest ×81, …) were mobs the raid never engaged; raiders had killed
// them in daytime XP groups on the same calendar day.
//
// Cause: noteTrashKill bucketed by raidNight.nightKey(at) — which answers
// "which night does this timestamp belong to", NOT "did this happen during the
// raid". Any kill uploaded that day landed in the night's tally. The KILLS path
// already gated on raidNight.isRaidNightAt() (see the pace calc in
// utils/raidReview.js); trash did not, so bosses and trash disagreed about what
// "during the raid" meant.
//
// Run: npx vitest run test/raid-review-trash-window.test.js

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);

let review, raidNight;
beforeAll(() => {
  // isRaidNightAt() reads this at call time; pin it so the test does not depend
  // on the machine's clock zone.
  process.env.DEFAULT_TIMEZONE = 'America/New_York';
  review    = require_('../utils/raidReview.js');
  raidNight = require_('../utils/raidNight.js');
});

// August 2026, US Eastern = EDT (UTC-4). Raid nights are Sun/Wed/Thu from 20:30.
const SUN_9PM    = Date.parse('2026-08-03T01:00:00Z');  // Sun Aug 2, 21:00 EDT — in raid
const SUN_2PM    = Date.parse('2026-08-02T18:00:00Z');  // Sun Aug 2, 14:00 EDT — daytime XP
const SUN_8PM    = Date.parse('2026-08-03T00:00:00Z');  // Sun Aug 2, 20:00 EDT — pre-raid
const MON_1220AM = Date.parse('2026-08-03T04:20:00Z');  // Mon Aug 3, 00:20 EDT — spillover
const TUE_9PM    = Date.parse('2026-08-05T01:00:00Z');  // Tue Aug 4, 21:00 EDT — not a raid day

describe('the dates this test is built on', () => {
  it('Aug 2 2026 really is a Sunday in Eastern', () => {
    const dow = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', weekday: 'long',
    }).format(new Date(SUN_9PM));
    expect(dow).toBe('Sunday');
  });

  it('the daytime kill buckets to the SAME night as the raid kill', () => {
    // This is precisely why nightKey alone could not filter it out.
    expect(raidNight.nightKey(SUN_2PM)).toBe(raidNight.nightKey(SUN_9PM));
  });
});

describe('noteTrashKill — raid-window gate', () => {
  it('counts a kill during the raid', () => {
    expect(review.noteTrashKill({ atMs: SUN_9PM, name: 'a Shissar Disciple', damage: 5000, durationSec: 8 }))
      .toBe('added');
  });

  it('THE BUG: rejects a same-night DAYTIME kill', () => {
    expect(review.noteTrashKill({ atMs: SUN_2PM, name: 'A Poxed Soriz', damage: 12000, durationSec: 20 }))
      .toBe('skipped');
  });

  it('rejects a pre-raid kill on a raid day (before the 20:30 start)', () => {
    expect(review.noteTrashKill({ atMs: SUN_8PM, name: 'a grimling priest', damage: 9000, durationSec: 12 }))
      .toBe('skipped');
  });

  it('still counts the post-midnight spillover of a raid night', () => {
    expect(review.noteTrashKill({ atMs: MON_1220AM, name: 'a Soriz Drudge', damage: 4000, durationSec: 6 }))
      .toBe('added');
  });

  it('rejects a kill on a non-raid day entirely', () => {
    expect(review.noteTrashKill({ atMs: TUE_9PM, name: 'A Soriz Corpse', damage: 7000, durationSec: 9 }))
      .toBe('skipped');
  });

  it('the night tally contains ONLY the in-raid kills', () => {
    const summary = review.trashSummary(raidNight.nightKey(SUN_9PM));
    expect(summary, 'the in-raid kills should have produced a tally').toBeTruthy();
    const names = (summary.mobs || []).map(t => t.name);
    // Both in-raid kills belong to this night: the 21:00 one and the 00:20
    // spillover, which nightAnchorMs correctly folds back into Sunday.
    expect(names).toContain('a Shissar Disciple');
    expect(names).toContain('a Soriz Drudge');
    // The three rejected mobs are exactly the ones that polluted the real report.
    expect(names).not.toContain('A Poxed Soriz');
    expect(names).not.toContain('a grimling priest');
    expect(names).not.toContain('A Soriz Corpse');
    // Damage/duration must not carry the daytime kills either — that is what
    // inflated "17.49M damage · 9h22m in combat" on a 1h48m raid. 5000+4000
    // and 8s+6s are the two legitimate in-raid kills, and nothing else.
    expect(summary.kills).toBe(2);
    expect(summary.damage).toBe(9000);
    expect(summary.seconds).toBe(14);
  });

  it('still rejects malformed input', () => {
    expect(review.noteTrashKill({ atMs: SUN_9PM, name: '' })).toBe('skipped');
    expect(review.noteTrashKill({ atMs: NaN, name: 'a thing' })).toBe('skipped');
  });
});
