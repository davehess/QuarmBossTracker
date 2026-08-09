// Trash tally — the TRAILING edge. Sibling to raid-review-trash-window.test.js,
// which pins the 2026-08-02 LEADING-edge bug (daytime grinding swept into the
// review). This is the opposite symptom, found 2026-08-06.
//
// Hitya reported it as "we're also getting a bunch of the trash from earlier
// in the day". The persisted data says the reverse — every one of the 89 trash
// entries in bot_kv.raid_trash_2026-08-05 landed AFTER the raid's last kill:
//
//   first pull        20:37 ET
//   last boss dies    23:32 ET
//   first trash       23:53 ET   ← 21 min after the raid was over
//   last  trash       00:42 ET   ← still going 70 min after
//
// Cause: isRaidNightAt() (utils/raidNight.js), the gate every trash kill passes,
// is deliberately open-ended at the tail so a raid can spill past midnight —
// correct for routing Discord threads, wrong for "what did the raid clear". It
// has no relationship to THIS night's last kill, so the tally accrues for as
// long as anyone stays logged in.
//
// Run: npx vitest run test/raid-review-trash-tail.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const raidReview = require('../utils/raidReview.js');
const raidNight  = require('../utils/raidNight.js');

const ET = (hhmm, day = 5) => Date.parse(`2026-08-${String(day).padStart(2, '0')}T${hhmm}:00-04:00`);

// The real night, to the minute.
const FIRST_PULL = ET('20:37');
const LAST_KILL  = ET('23:32');
const ENCOUNTERS = [
  { started_at: new Date(FIRST_PULL).toISOString(), ended_at: new Date(ET('20:42')).toISOString() },
  { started_at: new Date(ET('23:27')).toISOString(), ended_at: new Date(LAST_KILL).toISOString() },
];

describe('trashBoundsFor', () => {
  it('spans first pull to last CONFIRMED kill, padded both sides', () => {
    const b = raidReview.trashBoundsFor(ENCOUNTERS, 30);
    expect(b.sinceMs).toBe(FIRST_PULL - 30 * 60_000);
    expect(b.untilMs).toBe(LAST_KILL + 30 * 60_000);
  });

  it('defaults to a 15-minute grace', () => {
    // Pins the DEFAULT, not just the plumbing — every other test here passes
    // graceMin explicitly, so widening the constant back to 30 would otherwise
    // change what ships and break nothing. 15 is Hitya's call: the line is
    // the last DKP tick, and 23:53 (21 min after the last kill) is past it.
    const b = raidReview.trashBoundsFor(ENCOUNTERS);
    expect(b.untilMs).toBe(LAST_KILL + 15 * 60_000);
    expect(b.sinceMs).toBe(FIRST_PULL - 15 * 60_000);
  });

  it('refuses to bound when nothing has been killed yet', () => {
    // Mid-raid, engaged but no kill. Bounding to a last kill that does not
    // exist would erase legitimate trash cleared on the way to the first pull.
    const engagedOnly = [{ started_at: new Date(FIRST_PULL).toISOString(), ended_at: null }];
    expect(raidReview.trashBoundsFor(engagedOnly, 30)).toEqual({});
    expect(raidReview.trashBoundsFor([], 30)).toEqual({});
    expect(raidReview.trashBoundsFor(null, 30)).toEqual({});
  });

  it('ignores unconfirmed encounters when picking the last kill', () => {
    const withOpen = [...ENCOUNTERS,
      { started_at: new Date(ET('23:50')).toISOString(), ended_at: null }];   // still engaged, never died
    expect(raidReview.trashBoundsFor(withOpen, 30).untilMs).toBe(LAST_KILL + 30 * 60_000);
  });
});

describe('trashSummary bounding', () => {
  // noteTrashKill derives the night bucket from atMs itself — use the module's
  // own key so the test cannot drift from the real bucketing.
  const KEY = raidNight.nightKey(ET('21:00'));
  beforeEach(() => {
    raidReview._resetTrashForTest(KEY);
    // Two mobs inside the raid, then the real post-raid grind.
    raidReview.noteTrashKill({ name: 'a grimling guard',   damage: 1000, durationSec: 10, atMs: ET('21:00') });
    raidReview.noteTrashKill({ name: 'a possessed corpse', damage: 2000, durationSec: 12, atMs: ET('23:30') });
    raidReview.noteTrashKill({ name: 'a grimling priest',  damage: 3000, durationSec: 14, atMs: ET('23:53') });
    raidReview.noteTrashKill({ name: 'a possessed priest', damage: 4000, durationSec: 16, atMs: ET('00:42', 6) });
  });

  it('sanity: all four landed in the same night bucket', () => {
    // If this fails the fixture is wrong, not the bounding.
    expect(raidReview.trashSummary(KEY).kills).toBe(4);
    expect(raidNight.nightKey(ET('00:42', 6))).toBe(KEY);   // post-midnight still this night
  });

  it('unbounded is unchanged — the 2026-08-02 test depends on this', () => {
    const sum = raidReview.trashSummary(KEY);
    expect(sum.kills).toBe(4);
    expect(sum.damage).toBe(10_000);
  });

  it('drops the post-raid grind but keeps trash just after the last kill', () => {
    // 23:53 is 21 min after the last kill — inside a 30-min grace, so it counts
    // (people finishing up). 00:42 is 70 min after and does not.
    const sum = raidReview.trashSummary(KEY, raidReview.trashBoundsFor(ENCOUNTERS, 30));
    expect(sum.kills).toBe(3);
    expect(sum.damage).toBe(6000);
    expect(sum.mobs.map(m => m.name)).not.toContain('a possessed priest');
  });

  it('a tighter grace drops the tail entirely', () => {
    const sum = raidReview.trashSummary(KEY, raidReview.trashBoundsFor(ENCOUNTERS, 15));
    expect(sum.kills).toBe(2);
    expect(sum.mobs.map(m => m.name).sort()).toEqual(['a grimling guard', 'a possessed corpse']);
  });

  it('returns null — not a zeroed row — when everything falls outside', () => {
    // A section that renders "0 mobs · 0 damage" is worse than no section.
    expect(raidReview.trashSummary(KEY, { sinceMs: ET('01:00', 6), untilMs: ET('02:00', 6) })).toBeNull();
  });
});
