// Admission-control budgets — SOURCE-SLICE fidelity tier (#73).
//
// The budget gate `_overBudget` lives inside the bot monolith (index.js) and
// isn't exported (require()-ing index.js boots the Discord client). We read the
// real source and eval JUST the `_overBudget` block — coupled to the shipped
// code: edit the gate and this test exercises the new behavior; rename/delete
// it and the slice throws loudly. Same technique as test/election.test.js.
//
// The block calls `_overlayTuningMap()` (the 60s tuning cache) and reads
// `Date.now()`. We prepend a tiny stub tuning source so the slice is
// self-contained, and drive the clock with vitest fake timers for the
// Retry-After math.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock } from './_source-slice.js';

const src   = readSource(BOT_INDEX);
const block = sliceBlock(src, 'const _BUDGET_WINDOW_MS = 60_000;', '// GC stale budget buckets');

// Prepend a stub _overlayTuningMap so the sliced gate resolves tuning from a
// value the test controls, then eval and pull out the bindings we exercise.
const harness = `
  let __tune = {};
  function __setTune(t) { __tune = t || {}; }
  async function _overlayTuningMap() { return __tune; }
` + block + `
  return { _overBudget, _BUDGET_DEFAULTS, _budgetBuckets, __setTune };
`;
// eslint-disable-next-line no-new-func
const { _overBudget, _budgetBuckets, __setTune } = new Function(harness)();

const req = (token = 'wpms_default') => ({ headers: { authorization: 'Bearer ' + token } });
function mockRes() {
  return {
    statusCode: null, headers: null, body: null,
    writeHead(code, h) { this.statusCode = code; this.headers = h || {}; return this; },
    end(b) { this.body = b; return this; },
  };
}

beforeEach(() => {
  __setTune({});
  for (const k of [..._budgetBuckets.keys()]) _budgetBuckets.delete(k);
});
afterEach(() => { vi.useRealTimers(); });

describe('_overBudget (real index.js)', () => {
  it('allows a request under budget and writes no response', async () => {
    __setTune({ budget_chat_per_min: 5 });
    const res = mockRes();
    expect(await _overBudget('chat', req(), res)).toBe(false);
    expect(res.statusCode).toBe(null);
  });

  it('durable kind over budget defaults to LOG-ONLY: allows through, no 429', async () => {
    __setTune({ budget_chat_per_min: 2 });
    const r = req('wpms_logonly');
    await _overBudget('chat', r, mockRes());   // 1
    await _overBudget('chat', r, mockRes());   // 2
    const res = mockRes();
    expect(await _overBudget('chat', r, res)).toBe(false);  // 3rd over → still allowed
    expect(res.statusCode).toBe(null);
  });

  it('durable kind over budget WITH budget_enforce_<kind>=1 → 429 + Retry-After', async () => {
    __setTune({ budget_chat_per_min: 2, budget_enforce_chat: 1 });
    const r = req('wpms_enforce');
    await _overBudget('chat', r, mockRes());
    await _overBudget('chat', r, mockRes());
    const res = mockRes();
    expect(await _overBudget('chat', r, res)).toBe(true);
    expect(res.statusCode).toBe(429);
    const ra = Number(res.headers['Retry-After']);
    expect(Number.isInteger(ra)).toBe(true);
    expect(ra).toBeGreaterThanOrEqual(1);
    expect(ra).toBeLessThanOrEqual(60);
  });

  it('Retry-After counts down to the window edge', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-18T00:00:00Z'));
    __setTune({ budget_recent_fires_per_min: 1 });      // GET kind → 429s over budget
    const r = req('wpms_ra');
    await _overBudget('recent_fires', r, mockRes());     // window opens at T0
    vi.setSystemTime(new Date('2026-07-18T00:00:55Z'));  // 55s into the window
    const res = mockRes();
    expect(await _overBudget('recent_fires', r, res)).toBe(true);
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['Retry-After'])).toBe(5);  // 60 - 55
  });

  it('tuning override lowers the budget (trips sooner)', async () => {
    __setTune({ budget_recent_fires_per_min: 1 });
    const r = req('wpms_override');
    const res1 = mockRes();
    expect(await _overBudget('recent_fires', r, res1)).toBe(false);  // 1st under
    const res2 = mockRes();
    expect(await _overBudget('recent_fires', r, res2)).toBe(true);   // 2nd over
    expect(res2.statusCode).toBe(429);
  });

  it('budget_<kind>_per_min=0 means UNLIMITED (per-kind off)', async () => {
    __setTune({ budget_recent_fires_per_min: 0 });
    const r = req('wpms_unlimited');
    for (let i = 0; i < 10; i++) expect(await _overBudget('recent_fires', r, mockRes())).toBe(false);
  });

  it('flag_disable_budgets=1 is a global kill switch', async () => {
    __setTune({ budget_recent_fires_per_min: 1, flag_disable_budgets: 1 });
    const r = req('wpms_killswitch');
    await _overBudget('recent_fires', r, mockRes());
    const res = mockRes();
    expect(await _overBudget('recent_fires', r, res)).toBe(false);   // disabled → allow
    expect(res.statusCode).toBe(null);
  });

  it('ephemeral POST stream over budget → 200-ack-and-drop (never breaks a healthy client)', async () => {
    __setTune({ budget_live_state_per_min: 1 });
    const r = req('wpms_ephemeral');
    await _overBudget('live_state', r, mockRes());
    const res = mockRes();
    expect(await _overBudget('live_state', r, res)).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).budget_dropped).toBe('live_state');
  });

  it('keys uploaders independently — one over-budget client does not limit another', async () => {
    __setTune({ budget_recent_fires_per_min: 1 });
    const a = req('wpms_alpha'), b = req('wpms_bravo');
    await _overBudget('recent_fires', a, mockRes());
    expect((await (async () => { const res = mockRes(); await _overBudget('recent_fires', a, res); return res; })()).statusCode).toBe(429);
    const resB = mockRes();
    expect(await _overBudget('recent_fires', b, resB)).toBe(false);   // fresh uploader unaffected
  });
});
