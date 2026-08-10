// test/relay-clock-skew.test.js — a relayed trigger fire must be translated
// from the ORIGINATOR's clock onto ours before anything times off it.
//
// The bug (Hitya, 2026-08-10 Ssra: "the clock skew was VERY apparent for the TTS
// timers"): _relayLocalFire stamps fired_at_ms from the originating machine's
// clock — it is the EQ log-line time on THEIR box — and three installs have been
// measured 14s, 42s and 56s off, drifting ~1.5-3 s/day. Every consumer then
// compared that stamp against its own Date.now(), so one skewed sender broke
// four things at once:
//
//   • the RELAY_STALE_MS (15s) gate dropped EVERY fire from a machine running
//     more than 15s behind, journalled as "stale-skipped — Ns old", which reads
//     like relay backlog and is not;
//   • speakAt delays by (fireMs - Date.now()), so a sender whose clock runs
//     AHEAD pushed the TTS that many seconds late — and >60s dropped it;
//   • _startTimer set ends_at_ms = origin_stamp + duration, so no two raiders'
//     countdown bars (or their N-seconds-before warning TTS) agreed;
//   • _localFireKeys mixed local and origin stamps, so echo-suppression of our
//     own fire against another observer's relay of the same event misfired.
//
// The bot resolves the stamp to true time at ingest (it is the only party that
// sees every clock) and ships it as fired_at_true_ms; we subtract our own
// offset. Sign convention matches agent_clock_offsets: POSITIVE = this clock is
// BEHIND, true = local + offset.
//
// Run: npx vitest run test/relay-clock-skew.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, AGENT_INDEX } from './_source-slice.js';

const block = sliceBlock(
  readSource(AGENT_INDEX),
  'function _relayFiredAtLocal(fire)',
  '\n}',
);

// myOffsetMs: OUR measured offset (positive = our clock is behind).
function build(myOffsetMs) {
  const harness = `
    const stats = { clockOffsetMs: ${myOffsetMs === null ? 'null' : myOffsetMs} };
  ` + block + `
    return { _relayFiredAtLocal };
  `;
  // eslint-disable-next-line no-new-func
  return new Function(harness)();
}

// Build the fire exactly as the bot now serves it: the sender's raw stamp plus
// the true-time resolution done at ingest.
function fireFrom({ trueMs, senderOffsetMs }) {
  const raw = trueMs - senderOffsetMs;           // what the sender's clock read
  return { fired_at_ms: raw, fired_at_true_ms: raw + senderOffsetMs };
}

const RELAY_STALE_MS = 15_000;   // mirrors the agent constant

describe('_relayFiredAtLocal', () => {
  it('a sender 42s BEHIND is no longer seen as 42s stale', () => {
    const now = Date.now();
    const h = build(0);
    const local = h._relayFiredAtLocal(fireFrom({ trueMs: now, senderOffsetMs: 42_000 }));
    expect(Math.abs(now - local)).toBeLessThan(50);
    // The whole point: this fire used to be dropped by the staleness gate.
    expect(Date.now() - local).toBeLessThan(RELAY_STALE_MS);
  });

  it('a sender 30s AHEAD no longer delays the TTS by 30s', () => {
    const now = Date.now();
    const h = build(0);
    const local = h._relayFiredAtLocal(fireFrom({ trueMs: now, senderOffsetMs: -30_000 }));
    // speakAt computes max(0, fireMs - Date.now()); that must now be ~0.
    expect(Math.max(0, local - now)).toBeLessThan(50);
  });

  it('our OWN offset is subtracted, so the stamp lands on our clock', () => {
    // We are 10s behind: at true time T our Date.now() reads T - 10s, so a fire
    // at T must be stamped T - 10s for our countdown and delay maths to work.
    const trueNow = Date.now();
    const h = build(10_000);
    const local = h._relayFiredAtLocal(fireFrom({ trueMs: trueNow, senderOffsetMs: 0 }));
    expect(local).toBe(trueNow - 10_000);
  });

  it('both clocks correct → identical to the raw stamp (no behaviour change)', () => {
    const now = Date.now();
    const h = build(0);
    const fire = fireFrom({ trueMs: now, senderOffsetMs: 0 });
    expect(h._relayFiredAtLocal(fire)).toBe(fire.fired_at_ms);
  });

  it('fails open when the bot sends no true stamp (older bot)', () => {
    const h = build(5_000);
    const raw = Date.now() - 1234;
    expect(h._relayFiredAtLocal({ fired_at_ms: raw })).toBe(raw);
  });

  it('fails open when our own offset is not measured yet', () => {
    // clockOffsetMs is null until the first heartbeat round-trip lands.
    const h = build(null);
    const fire = fireFrom({ trueMs: Date.now(), senderOffsetMs: 42_000 });
    expect(h._relayFiredAtLocal(fire)).toBe(fire.fired_at_ms);
  });

  it('a garbage stamp with no correction falls back to now', () => {
    const h = build(0);
    const local = h._relayFiredAtLocal({ fired_at_ms: 'nonsense' });
    expect(Math.abs(Date.now() - local)).toBeLessThan(50);
  });

  it('a genuinely backlogged fire is STILL stale after correction', () => {
    // The staleness gate must keep working — correction fixes skew, not lateness.
    const h = build(0);
    const local = h._relayFiredAtLocal(fireFrom({ trueMs: Date.now() - 90_000, senderOffsetMs: 42_000 }));
    expect(Date.now() - local).toBeGreaterThan(RELAY_STALE_MS);
  });
});
