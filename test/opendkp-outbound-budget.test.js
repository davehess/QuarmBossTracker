// test/opendkp-outbound-budget.test.js — the outbound governor.
//
// 2026-08-25: one uncached dashboard poll put 1,678 calls on OpenDKP's API
// Gateway in an afternoon and got our IP blocked. Caching fixed that caller;
// this governor is the guarantee no FUTURE caller repeats it, and the ready
// position for whatever rate limiting OpenDKP adds: a sliding per-minute
// budget (OPENDKP_MAX_CALLS_PER_MIN) plus a global cooldown honoring a 429's
// Retry-After. Same placement as the halt — the two HTTP primitives — so no
// endpoint wrapper can bypass it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readSource, sliceBlock, ROOT } from './_source-slice.js';
import path from 'node:path';

const SRC = readSource(path.join(ROOT, 'utils', 'opendkp.js'));

const block = sliceBlock(
  SRC,
  'const _callTimes = [];',
  "console.warn(`[opendkp] HTTP 429 from OpenDKP — backing off all calls for ${waitMs / 1000}s`);\n}",
);

const ORIGINAL = process.env.OPENDKP_MAX_CALLS_PER_MIN;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.OPENDKP_MAX_CALLS_PER_MIN;
  else process.env.OPENDKP_MAX_CALLS_PER_MIN = ORIGINAL;
});

function build(startMs = 1_000_000) {
  const state = { t: startMs };
  // Shadow Date so the sliding window is driven by the test clock.
  const harness = 'const Date = { now: () => __clock.t };\n'
    + 'const console = { warn() {} };\n'
    + block
    + '\nreturn { _admitCall, _noteRateLimited };';
  // eslint-disable-next-line no-new-func
  const fns = new Function('__clock', harness)(state);
  return { ...fns, advance: ms => { state.t += ms; } };
}

describe('the per-minute budget', () => {
  it('admits up to the budget, then rejects locally', () => {
    process.env.OPENDKP_MAX_CALLS_PER_MIN = '3';
    const g = build();
    expect(g._admitCall('t')).toBeNull();
    expect(g._admitCall('t')).toBeNull();
    expect(g._admitCall('t')).toBeNull();
    const denied = g._admitCall('t');
    expect(denied).toBeInstanceOf(Error);
    expect(denied.message).toMatch(/budget exceeded/i);
  });

  it('the window slides — a minute later the budget is back', () => {
    process.env.OPENDKP_MAX_CALLS_PER_MIN = '2';
    const g = build();
    g._admitCall('t'); g._admitCall('t');
    expect(g._admitCall('t')).toBeInstanceOf(Error);
    g.advance(61_000);
    expect(g._admitCall('t')).toBeNull();
  });

  it('0 disables the budget entirely', () => {
    process.env.OPENDKP_MAX_CALLS_PER_MIN = '0';
    const g = build();
    for (let i = 0; i < 500; i++) expect(g._admitCall('t')).toBeNull();
  });

  it('defaults to 60/min when unset', () => {
    delete process.env.OPENDKP_MAX_CALLS_PER_MIN;
    const g = build();
    for (let i = 0; i < 60; i++) expect(g._admitCall('t')).toBeNull();
    expect(g._admitCall('t')).toBeInstanceOf(Error);
  });
});

describe('the 429 cooldown', () => {
  it('a 429 with Retry-After pauses every call for that long', () => {
    delete process.env.OPENDKP_MAX_CALLS_PER_MIN;
    const g = build();
    g._noteRateLimited({ statusCode: 429, headers: { 'retry-after': '45' } });
    const denied = g._admitCall('t');
    expect(denied).toBeInstanceOf(Error);
    expect(denied.message).toMatch(/cooling down/i);
    g.advance(44_000);
    expect(g._admitCall('t')).toBeInstanceOf(Error);
    g.advance(2_000);
    expect(g._admitCall('t')).toBeNull();
  });

  it('a 429 without Retry-After backs off 30s', () => {
    const g = build();
    g._noteRateLimited({ statusCode: 429, headers: {} });
    expect(g._admitCall('t')).toBeInstanceOf(Error);
    g.advance(31_000);
    expect(g._admitCall('t')).toBeNull();
  });

  it('caps a hostile Retry-After at 5 minutes', () => {
    const g = build();
    g._noteRateLimited({ statusCode: 429, headers: { 'retry-after': '86400' } });
    g.advance(301_000);
    expect(g._admitCall('t')).toBeNull();
  });

  it('non-429 statuses never trigger a cooldown', () => {
    const g = build();
    g._noteRateLimited({ statusCode: 500, headers: {} });
    g._noteRateLimited({ statusCode: 403, headers: {} });
    expect(g._admitCall('t')).toBeNull();
  });
});

describe('where the governor lives (so it cannot be bypassed)', () => {
  it('both primitives admit through it, and the halt check comes first', () => {
    for (const fn of ['function _post(', 'function _get(']) {
      const body = SRC.slice(SRC.indexOf(fn), SRC.indexOf(fn) + 400);
      expect(body).toMatch(/opendkpHalted\(\)/);
      expect(body).toMatch(/_admitCall\(/);
      expect(body.indexOf('opendkpHalted()')).toBeLessThan(body.indexOf('_admitCall('));
    }
  });

  it('both primitives report 429s into the cooldown', () => {
    const gets = SRC.split(/function _(?:get|post)\(/).slice(1, 3);
    for (const body of gets) expect(body).toContain('_noteRateLimited(res)');
  });
});
