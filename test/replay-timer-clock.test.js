// test/replay-timer-clock.test.js — replayed trigger timers must arm on the
// WALL clock, not the historical log timestamp.
//
// The bug (found via the pq-companion comparison, 2026-08-07): replay passes
// the log line's tsMs into _startTimer, which computed
// ends_at_ms = tsMs + duration. For any log older than the duration that is
// already in the past, and _activeTimersSnapshot deletes such rows on the next
// read — so a rehearsal fired its TTS while the countdown bar never painted,
// and trigger authors concluded the timer itself was broken.
//
// Run: npx vitest run test/replay-timer-clock.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, AGENT_INDEX } from './_source-slice.js';

const block = sliceBlock(
  readSource(AGENT_INDEX),
  'function _startTimer(t, tsMs, isTest, captures)',
  '\n}',
);

function build() {
  const harness = `
    const _activeTimers = new Map();
    const stats = {};
    function _activeTimersSnapshot() { return []; }
    // EQLP-parity helpers _startTimer now calls; their own behaviour is
    // covered by test/trigger-eqlp-parity.test.js, so stub them minimally.
    function _timerDurationSec(t) { return Number(t.timer_duration_sec) || 0; }
    function _timerWarnings() { return []; }
  ` + block + `
    return { _startTimer, _activeTimers };
  `;
  // eslint-disable-next-line no-new-func
  return new Function(harness)();
}

const HOUR_AGO = Date.now() - 3600_000;

describe('_startTimer clock source', () => {
  it('replay: a historical tsMs still produces a FUTURE ends_at_ms', () => {
    const h = build();
    h._startTimer(
      { id: 'tb', name: 'Tank Buster', timer_duration_sec: 30, _replay: true },
      HOUR_AGO, true, null,
    );
    const rows = [...h._activeTimers.values()];
    expect(rows).toHaveLength(1);
    // The whole bug: before the fix this was HOUR_AGO + 30s — long past — and
    // the snapshot deleted the row before the overlay ever saw it.
    expect(rows[0].ends_at_ms).toBeGreaterThan(Date.now());
    expect(rows[0].ends_at_ms).toBeLessThanOrEqual(Date.now() + 31_000);
  });

  it('live: ends_at_ms stays anchored to the log timestamp (unchanged)', () => {
    const h = build();
    const ts = Date.now() - 2000;   // a live line is ~now
    h._startTimer(
      { id: 'tb', name: 'Tank Buster', timer_duration_sec: 30 },
      ts, false, null,
    );
    const rows = [...h._activeTimers.values()];
    expect(rows[0].ends_at_ms).toBe(ts + 30_000);
  });

  it('replay rows carry test:true so the completion sweep can find them', () => {
    const h = build();
    h._startTimer(
      { id: 'tb', name: 'Tank Buster', timer_duration_sec: 30, _replay: true },
      HOUR_AGO, true, null,
    );
    expect([...h._activeTimers.values()][0].test).toBe(true);
  });
});
