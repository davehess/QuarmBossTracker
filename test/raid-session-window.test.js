// test/raid-session-window.test.js — which recorded session the raid review links to.
// Pure helper (utils/raidSessionWindow.js) plus the URL builder in utils/raidReview.js.

import { describe, it, expect } from 'vitest';

const { raidSessionWindow, raidWindowFor, fetchBoundsFor, splitSessions } = require('../utils/raidSessionWindow.js');
const raidReview = require('../utils/raidReview.js');

const MIN = 60_000;
/** Minute starts (ms) from `start` ISO, `count` consecutive minutes. */
const run = (start, count) => Array.from({ length: count }, (_, i) => Date.parse(start) + i * MIN);

describe('splitSessions', () => {
  it('keeps a 20 minute silence in one session and splits at 21', () => {
    const a = run('2026-07-30T00:00:00Z', 5);                       // ends 00:05
    const at20 = [...a, Date.parse('2026-07-30T00:25:00Z')];       // 20 min after 00:05
    const at21 = [...a, Date.parse('2026-07-30T00:26:00Z')];       // 21 min after 00:05
    expect(splitSessions(at20)).toHaveLength(1);
    expect(splitSessions(at21)).toHaveLength(2);
  });
});

describe('raidSessionWindow', () => {
  it('picks the session overlapping 19:30-00:30 ET over a morning session (EDT)', () => {
    const morning = run('2026-07-30T14:00:00Z', 90);               // 10:00 ET
    const raid = run('2026-07-31T00:00:00Z', 200);                 // 20:00 ET
    const w = raidSessionWindow([...morning, ...raid], '2026-07-30');
    expect(w).toEqual({ from: '2026-07-31T00:00:00.000Z', to: new Date(Date.parse('2026-07-31T00:00:00Z') + 200 * MIN).toISOString() });
  });

  it('splits a night at a gap over 20 minutes and takes the bigger raid-window session', () => {
    const early = run('2026-07-31T00:00:00Z', 30);                 // 20:00 ET, 30 min
    const late = run('2026-07-31T01:00:00Z', 120);                 // 21:00 ET, 120 min (30 min gap after early)
    const w = raidSessionWindow([...early, ...late], '2026-07-30');
    expect(w.from).toBe('2026-07-31T01:00:00.000Z');
    expect(w.to).toBe('2026-07-31T03:00:00.000Z');
  });

  it('joins minutes with a gap of exactly 20 minutes into one session', () => {
    const a = run('2026-07-31T00:00:00Z', 10);
    const b = run('2026-07-31T00:30:00Z', 10);                     // 20 min after a's end (00:10)
    const w = raidSessionWindow([...a, ...b], '2026-07-30');
    expect(w).toEqual({ from: '2026-07-31T00:00:00.000Z', to: '2026-07-31T00:40:00.000Z' });
  });

  it('accepts ISO strings, unsorted and duplicated', () => {
    const iso = run('2026-07-31T00:00:00Z', 3).map(t => new Date(t).toISOString());
    const w = raidSessionWindow([iso[2], iso[0], iso[1], iso[1]], '2026-07-30');
    expect(w).toEqual({ from: '2026-07-31T00:00:00.000Z', to: '2026-07-31T00:03:00.000Z' });
  });

  it('returns null for no data, for only a morning session, and for a bad date', () => {
    expect(raidSessionWindow([], '2026-07-30')).toBeNull();
    expect(raidSessionWindow(run('2026-07-30T14:00:00Z', 60), '2026-07-30')).toBeNull();
    expect(raidSessionWindow(run('2026-07-31T00:00:00Z', 60), 'nope')).toBeNull();
  });

  it('uses Eastern wall clock across DST: 19:30 ET is 00:30Z in summer and 00:30Z+1h in winter', () => {
    expect(new Date(raidWindowFor('2026-07-30').fromMs).toISOString()).toBe('2026-07-30T23:30:00.000Z');   // EDT, UTC-4
    expect(new Date(raidWindowFor('2026-12-10').fromMs).toISOString()).toBe('2026-12-11T00:30:00.000Z');   // EST, UTC-5
    expect(raidWindowFor('2026-12-10').toMs - raidWindowFor('2026-12-10').fromMs).toBe(5 * 60 * MIN);
    // a winter session at 20:00 ET (01:00Z) is in the window; the same UTC clock in summer (21:00 ET) is too,
    // but 23:30Z in winter (18:30 ET) is before it
    expect(raidSessionWindow(run('2026-12-11T01:00:00Z', 30), '2026-12-10')).not.toBeNull();
    expect(raidSessionWindow(run('2026-12-10T22:00:00Z', 60), '2026-12-10')).toBeNull();
  });

  it('bounds the read to 12:00 ET -> 06:00 ET next day', () => {
    const b = fetchBoundsFor('2026-07-30');
    expect(new Date(b.fromMs).toISOString()).toBe('2026-07-30T16:00:00.000Z');
    expect(new Date(b.toMs).toISOString()).toBe('2026-07-31T10:00:00.000Z');
  });
});

describe('sessionReviewUrl', () => {
  const win = { dateKey: '2026-07-30' };
  const fakeSb = (rows) => ({
    isEnabled: () => true,
    selectAllPaged: async (table, q) => { fakeSb.last = { table, q }; return rows; },
  });

  it('links the recorded session and reads only the minute column, bounded', async () => {
    raidReview._setDeps({ supabase: fakeSb(run('2026-07-31T00:00:00Z', 60).map(t => ({ minute_at: new Date(t).toISOString() }))) });
    try {
      const url = await raidReview.sessionReviewUrl(win, { webBase: 'https://wolfpack.quest' });
      expect(url).toBe('https://wolfpack.quest/raid/session?from=2026-07-31T00%3A00%3A00.000Z&to=2026-07-31T01%3A00%3A00.000Z');
      expect(fakeSb.last.table).toBe('raid_track_minutes');
      expect(fakeSb.last.q).toMatch(/^select=minute_at&/);
      expect(fakeSb.last.q).toMatch(/minute_at=gte\./);
      expect(fakeSb.last.q).toMatch(/minute_at=lt\./);
    } finally { raidReview._setDeps({}); }
  });

  it('falls back to the raid window when the recording holds no session or the read fails', async () => {
    const want = 'https://wolfpack.quest/raid/session?from=2026-07-30T23%3A30%3A00.000Z&to=2026-07-31T04%3A30%3A00.000Z';
    for (const sb of [fakeSb([]), fakeSb(null), { isEnabled: () => true, selectAllPaged: async () => { throw new Error('boom'); } }]) {
      raidReview._setDeps({ supabase: sb });
      try { expect(await raidReview.sessionReviewUrl(win, { webBase: 'https://wolfpack.quest' })).toBe(want); }
      finally { raidReview._setDeps({}); }
    }
  });
});
