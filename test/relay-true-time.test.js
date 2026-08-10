// test/relay-true-time.test.js — the bot resolves a relayed fire's timestamp to
// TRUE time at ingest, and dedups cross-agent fires on that resolved time.
//
// Context (2026-08-10 Ssra, Hitya: "the clock skew was VERY apparent for the TTS
// timers"): a relayed fire's `fired_at_ms` is the EQ log-line time as the SENDING
// machine's clock wrote it. Installs have been measured 14s, 42s and 56s off and
// drifting ~1.5-3 s/day. Receivers time their staleness gate, their TTS delay and
// their countdown bars off that stamp against their own Date.now(), so a single
// skewed sender broke all three for everyone.
//
// The bot is the only party that sees every clock, so it does the conversion once
// here — true = stamp + offset, from the offset that already rides every payload
// (#202) — instead of shipping the whole fleet's drift to every receiver.
//
// The second describe() is the one that matters: it drives the real cross-agent
// dedup comparison over two observers of ONE event whose clocks disagree.
//
// Run: npx vitest run test/relay-true-time.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, BOT_INDEX } from './_source-slice.js';

const block = sliceBlock(
  readSource(BOT_INDEX),
  'function _senderClockOffsetMs(payload)',
  '\n}',
);

// eslint-disable-next-line no-new-func
const { _senderClockOffsetMs } = new Function(block + '\nreturn { _senderClockOffsetMs };')();

const agentState = (offsetMs) => ({ agent_state: { clock_offset_ms: offsetMs } });

describe('_senderClockOffsetMs', () => {
  it('takes the offset a current agent sends', () => {
    // The three real measured installs.
    expect(_senderClockOffsetMs(agentState(14_000))).toBe(14_000);
    expect(_senderClockOffsetMs(agentState(42_000))).toBe(42_000);
    expect(_senderClockOffsetMs(agentState(56_000))).toBe(56_000);
  });

  it('handles a clock running AHEAD (negative offset)', () => {
    expect(_senderClockOffsetMs(agentState(-30_000))).toBe(-30_000);
  });

  it('returns 0 for an older agent that sends no offset', () => {
    // Fail-open: no correction is exactly the previous behaviour.
    expect(_senderClockOffsetMs({})).toBe(0);
    expect(_senderClockOffsetMs({ agent_state: {} })).toBe(0);
    expect(_senderClockOffsetMs(null)).toBe(0);
    expect(_senderClockOffsetMs(agentState('nonsense'))).toBe(0);
  });

  it('does NOT correct a backfill', () => {
    // The offset is current; a backfill's events are not. Applying one to the
    // other would shift historical stamps by today's drift.
    expect(_senderClockOffsetMs({ ...agentState(42_000), backfill: true })).toBe(0);
  });

  it('ignores an absurd offset rather than trusting it', () => {
    expect(_senderClockOffsetMs(agentState(600_000))).toBe(600_000);    // 10 min, at the limit
    expect(_senderClockOffsetMs(agentState(600_001))).toBe(0);          // past it — broken reading
    expect(_senderClockOffsetMs(agentState(86_400_000))).toBe(0);       // a full day out
  });
});

// Mirrors the comparison in _handleTriggerRelayPost.
const TRIGGER_RELAY_DEDUP_WINDOW_MS = 8000;
const isDuplicate = (a, b) =>
  a.key === b.key && Math.abs(a.trueMs - b.trueMs) <= TRIGGER_RELAY_DEDUP_WINDOW_MS;

// One event, two observers: each stamps it with its own clock, and each payload
// carries that machine's measured offset.
function observe({ trueEventMs, offsetMs, key }) {
  const payload = agentState(offsetMs);
  const firedAt = trueEventMs - offsetMs;                       // what their clock read
  return { key, rawMs: firedAt, trueMs: firedAt + _senderClockOffsetMs(payload) };
}

describe('cross-agent dedup over a skewed pair', () => {
  const T = Date.parse('2026-08-09T21:04:24.000Z');
  const KEY = 'Death touch — RIP:{"victim":"Hitya"}';

  it('two observers of ONE death collapse to one fire despite a 42s clock gap', () => {
    const onTime = observe({ trueEventMs: T, offsetMs: 0,      key: KEY });
    const skewed = observe({ trueEventMs: T, offsetMs: 42_000, key: KEY });

    // Before the fix the comparison used the raw stamps, 42s apart — well past
    // the 8s window — so both were stored and both fanned out to the raid.
    expect(Math.abs(onTime.rawMs - skewed.rawMs)).toBe(42_000);
    expect(isDuplicate(onTime, skewed)).toBe(true);
  });

  it('two genuinely separate deaths still both land', () => {
    // The behaviour the dedup window exists to preserve: a real second death a
    // minute later is not a duplicate.
    const first  = observe({ trueEventMs: T,          offsetMs: 0, key: KEY });
    const second = observe({ trueEventMs: T + 60_000, offsetMs: 0, key: KEY });
    expect(isDuplicate(first, second)).toBe(false);
  });

  it('different victims are never collapsed, however close in time', () => {
    const a = observe({ trueEventMs: T, offsetMs: 0,      key: 'RIP:{"victim":"Hitya"}' });
    const b = observe({ trueEventMs: T, offsetMs: 42_000, key: 'RIP:{"victim":"Sweenie"}' });
    expect(isDuplicate(a, b)).toBe(false);
  });

  it('an uncorrectable sender (no offset) behaves exactly as before', () => {
    const onTime = observe({ trueEventMs: T, offsetMs: 0, key: KEY });
    const legacy = { key: KEY, rawMs: T - 42_000, trueMs: T - 42_000 };   // no correction
    expect(isDuplicate(onTime, legacy)).toBe(false);
  });
});
