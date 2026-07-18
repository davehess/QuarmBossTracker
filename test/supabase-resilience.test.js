// Supabase resilience — REAL-IMPORT fidelity tier (#73).
//
// Under test: the request timeout + circuit breaker added to the REAL
// utils/supabase.js `_request`. We drive it end-to-end by (a) setting env so
// isEnabled() is true and (b) stubbing global fetch at the network boundary —
// the same seam test/mimic-auth.test.js uses. The load-bearing invariant is
// that the null/[] contract is UNCHANGED: a timeout, a network error, a 5xx,
// and a breaker-open all resolve to `null` (exactly like the pre-#73
// network-failure path callers already handle), while a 2xx still resolves to
// the parsed array ([] stays [], [row] stays [row]).
//
// The knobs (timeout ms, breaker threshold/cooldown) are read at CALL time, so
// setting env in a test takes effect on the next request. `_resetBreaker` (a
// test-only export, like `_startRateLimited` in mimicLink) clears the module's
// breaker state between cases.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// isEnabled()/_request read env at call time, so setting these is enough even
// though the import below is hoisted above this assignment.
process.env.SUPABASE_URL = 'https://test.invalid.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

import supabase from '../utils/supabase.js';

const realFetch = global.fetch;
// Build a fetch Response stub. body may be a string or a JSON-able value.
const RES = (status, body) => ({
  ok:     status >= 200 && status < 300,
  status,
  text:   async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

beforeEach(() => {
  supabase._resetBreaker();
  delete process.env.SUPABASE_BREAKER_THRESHOLD;
  delete process.env.SUPABASE_BREAKER_COOLDOWN_MS;
  delete process.env.SUPABASE_REQUEST_TIMEOUT_MS;
});
afterEach(() => { vi.useRealTimers(); global.fetch = realFetch; });

describe('utils/supabase.js — null/[] contract preserved', () => {
  it('2xx returns the parsed array; [] stays [], [row] stays [row]', async () => {
    global.fetch = vi.fn(async () => RES(200, []));
    expect(await supabase.select('t')).toEqual([]);
    global.fetch = vi.fn(async () => RES(200, [{ id: 1 }]));
    expect(await supabase.select('t')).toEqual([{ id: 1 }]);
  });

  it('a 4xx returns null (unchanged) and does NOT trip the breaker (origin reachable)', async () => {
    process.env.SUPABASE_BREAKER_THRESHOLD = '3';
    global.fetch = vi.fn(async () => RES(400, { message: 'bad query' }));
    for (let i = 0; i < 10; i++) expect(await supabase.select('t')).toBe(null);
    expect(supabase.breakerState().open).toBe(false);
  });

  it('a 5xx returns null (unchanged)', async () => {
    global.fetch = vi.fn(async () => RES(503, {}));
    expect(await supabase.select('t')).toBe(null);
  });
});

describe('utils/supabase.js — request timeout', () => {
  it('a hung request aborts to null after the configured timeout', async () => {
    vi.useFakeTimers();
    process.env.SUPABASE_REQUEST_TIMEOUT_MS = '2000';
    // Never resolves on its own — only the AbortController fires it.
    global.fetch = vi.fn((url, opts) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const e = new Error('The operation was aborted'); e.name = 'AbortError'; reject(e);
      });
    }));
    const p = supabase.select('t');
    await vi.advanceTimersByTimeAsync(2000);
    expect(await p).toBe(null);
  });
});

describe('utils/supabase.js — circuit breaker', () => {
  it('opens after N consecutive failures, then fails fast without issuing a fetch', async () => {
    process.env.SUPABASE_BREAKER_THRESHOLD = '3';
    const fetchMock = vi.fn(async () => RES(500, {}));
    global.fetch = fetchMock;
    for (let i = 0; i < 3; i++) expect(await supabase.select('t')).toBe(null);
    expect(supabase.breakerState().open).toBe(true);
    const callsWhenOpen = fetchMock.mock.calls.length;   // 3
    // Next request must fail fast — null, and NO new fetch.
    expect(await supabase.select('t')).toBe(null);
    expect(fetchMock.mock.calls.length).toBe(callsWhenOpen);
  });

  it('half-open probe closes the breaker on success', async () => {
    vi.useFakeTimers();
    process.env.SUPABASE_BREAKER_THRESHOLD  = '2';
    process.env.SUPABASE_BREAKER_COOLDOWN_MS = '30000';
    const downMock = vi.fn(async () => RES(500, {}));
    global.fetch = downMock;
    for (let i = 0; i < 2; i++) await supabase.select('t');
    expect(supabase.breakerState().open).toBe(true);

    // Still inside the cooldown → fail fast, no fetch.
    const before = downMock.mock.calls.length;
    await supabase.select('t');
    expect(downMock.mock.calls.length).toBe(before);

    // Cooldown elapses; origin is healthy again → the single probe closes it.
    vi.advanceTimersByTime(31000);
    global.fetch = vi.fn(async () => RES(200, [{ ok: 1 }]));
    expect(await supabase.select('t')).toEqual([{ ok: 1 }]);
    expect(supabase.breakerState().open).toBe(false);
  });

  it('a success resets the consecutive-failure count (failures must be consecutive)', async () => {
    process.env.SUPABASE_BREAKER_THRESHOLD = '3';
    global.fetch = vi.fn(async () => RES(500, {}));
    await supabase.select('t');
    await supabase.select('t');                 // 2 fails, not yet open
    global.fetch = vi.fn(async () => RES(200, [])); // success resets
    expect(await supabase.select('t')).toEqual([]);
    global.fetch = vi.fn(async () => RES(500, {}));
    await supabase.select('t');
    await supabase.select('t');                 // only 2 again → still closed
    expect(supabase.breakerState().open).toBe(false);
  });
});
