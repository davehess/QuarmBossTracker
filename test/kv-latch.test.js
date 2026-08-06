// One-shot latches: "already done?" must never be answered from a failed read.
//
// Uilnayar, 2026-08-06: "Why are these reposting in Raid Chat?" — the Mimic
// 2.0.0 announcement, a one-shot from 2026-07-20, posted twice in 22 minutes on
// a completely unrelated release. Both posts landed within 90 seconds of a bot
// restart, during the Supabase brownout that was running at the time.
//
// The latch row was in bot_kv the whole time. `supabase.select` returns NULL on
// a timeout (it does not throw), and the guard was
// `if (Array.isArray(rows) && rows[0]) return` — so null fell straight through
// as "no row, never announced".
//
// Run: npx vitest run test/kv-latch.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { shouldRunOnce, latchState } = require('../utils/kvLatch.js');

describe('shouldRunOnce', () => {
  it('runs when the lookup PROVES it has not run', () => {
    expect(shouldRunOnce([])).toBe(true);
    expect(latchState([])).toBe('pending');
  });

  it('does not run when a latch row exists', () => {
    expect(shouldRunOnce([{ value: { posted_at: '2026-07-20T00:00:00Z' } }])).toBe(false);
    expect(latchState([{ value: {} }])).toBe('done');
  });

  it('THE BUG: a failed lookup is not permission to run', () => {
    // Every one of these is what supabase.select hands back when the request
    // times out or the circuit breaker is open. None of them is evidence that
    // the one-shot has not already run.
    for (const failed of [null, undefined, false, 0, '', 'error', {}, { error: 'timeout' }]) {
      expect(shouldRunOnce(failed), `${JSON.stringify(failed)} must not authorise a re-post`).toBe(false);
      expect(latchState(failed)).toBe('unknown');
    }
  });

  it('distinguishes "not done" from "could not check" — the whole point', () => {
    // If these two ever collapse to the same answer, the bug is back: the
    // brownout case would once again be indistinguishable from a fresh install.
    expect(latchState([])).not.toBe(latchState(null));
    expect(shouldRunOnce([])).toBe(true);
    expect(shouldRunOnce(null)).toBe(false);
  });

  it('reproduces the incident: two restarts during a brownout post zero times', () => {
    // Before the fix this was 2. The latch row exists; the reads fail.
    const latched = [{ value: { posted_at: '2026-07-20T00:00:00Z' } }];
    const readsDuringBrownout = [null, null];
    const posts = readsDuringBrownout.filter(r => shouldRunOnce(r)).length;
    expect(posts).toBe(0);
    // And once Supabase recovers it still does not post, because it really is done.
    expect(shouldRunOnce(latched)).toBe(false);
  });
});
