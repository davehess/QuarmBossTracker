// test/supabase-paged.test.js — PostgREST silently truncates at max-rows.
//
// Found 2026-08-12: `.limit(4000)` does not raise PostgREST's ceiling, it only
// lowers it. Every query matching more than ~1000 rows was returning the first
// 1000 with no error and no flag, and the code downstream computed a confident
// wrong answer — /rolls lost the oldest loot (so older nights showed no looter),
// and /fun counted 1,000 of 4,004 dragon punches while displaying an exact total
// next to a leaderboard tallied from the truncated slice.
//
// Run: npx vitest run test/supabase-paged.test.js

import { describe, it, expect } from 'vitest';
import { fetchAllPages } from '../web/lib/supabase-paged.ts';

/** A fake PostgREST that owns `total` rows and never returns more than `cap`. */
function fakeTable(total, cap = 1000) {
  const calls = [];
  const build = (from, to) => {
    calls.push([from, to]);
    const width = Math.min(to - from + 1, cap);
    const data = [];
    for (let i = from; i < Math.min(from + width, total); i++) data.push({ i });
    return Promise.resolve({ data, error: null });
  };
  return { build, calls };
}

describe('fetchAllPages', () => {
  it('gets all 5,622 rows where a bare limit(4000) would have yielded 1000', async () => {
    const t = fakeTable(5622);
    const rows = await fetchAllPages(t.build);
    expect(rows).toHaveLength(5622);
    expect(rows[0].i).toBe(0);
    expect(rows[rows.length - 1].i).toBe(5621);
  });

  it('stops on the short page rather than probing forever', async () => {
    const t = fakeTable(1500);
    await fetchAllPages(t.build);
    expect(t.calls).toEqual([[0, 999], [1000, 1999]]);   // two calls, then done
  });

  it('an exact multiple of the page size costs one extra empty call, then stops', async () => {
    const t = fakeTable(2000);
    const rows = await fetchAllPages(t.build);
    expect(rows).toHaveLength(2000);
    expect(t.calls).toHaveLength(3);      // 0-999, 1000-1999, then the empty probe
  });

  it('an empty table is one call and no rows', async () => {
    const t = fakeTable(0);
    expect(await fetchAllPages(t.build)).toEqual([]);
    expect(t.calls).toHaveLength(1);
  });

  it('stops at the first error instead of looping', async () => {
    let n = 0;
    const rows = await fetchAllPages(() => {
      n++;
      return Promise.resolve(n === 1
        ? { data: Array.from({ length: 1000 }, (_, i) => ({ i })), error: null }
        : { data: null, error: new Error('boom') });
    });
    expect(rows).toHaveLength(1000);      // keeps what it got
    expect(n).toBe(2);
  });

  it('honours the hard cap so a misbehaving source cannot spin', async () => {
    const t = fakeTable(1_000_000);
    const rows = await fetchAllPages(t.build, 1000, 3000);
    expect(rows).toHaveLength(3000);
  });

  it('respects a custom page size', async () => {
    const t = fakeTable(250, 100);
    const rows = await fetchAllPages(t.build, 100);
    expect(rows).toHaveLength(250);
  });
});
