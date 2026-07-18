// Load-shed exception list — SOURCE-SLICE fidelity tier (#74 Part 1).
//
// `_isShedded` + its `_SHED_KINDS` / `_SHED_NEVER` sets live inside the bot
// monolith (index.js) and aren't exported. We read the real source and eval JUST
// that block — coupled to the shipped code: change the exception set and this
// test exercises the new behavior; rename/delete it and the slice throws loudly.
//
// The load-bearing guarantee under test: the raid's durable streams
// (encounter / chat / bosskill / lockout / historical_chat) can NEVER be shed,
// even with `flag_shed_<kind>` set — nobody can fat-finger the parse pipe off.

import { describe, it, expect, beforeEach } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock } from './_source-slice.js';

const src   = readSource(BOT_INDEX);
const block = sliceBlock(src, 'const _SHED_KINDS = new Set([', '// ── Per-uploader admission-control budgets');

// Stub _overlayTuningMap so the sliced gate resolves the shed flags from a value
// the test controls, then eval and pull out the bindings.
const harness = `
  let __tune = {};
  function __setTune(t) { __tune = t || {}; }
  async function _overlayTuningMap() { return __tune; }
` + block + `
  return { _isShedded, _SHED_KINDS, _SHED_NEVER, __setTune };
`;
// eslint-disable-next-line no-new-func
const { _isShedded, _SHED_KINDS, _SHED_NEVER, __setTune } = new Function(harness)();

function mockRes() {
  return {
    statusCode: null, headers: null, body: null,
    writeHead(code, h) { this.statusCode = code; this.headers = h || {}; return this; },
    end(b) { this.body = b; return this; },
  };
}

const DURABLE_NEVER = ['encounter', 'chat', 'bosskill', 'lockout', 'historical_chat'];

beforeEach(() => __setTune({}));

describe('_isShedded exception list (real index.js)', () => {
  it('the SHED_NEVER set is exactly the five durable streams', () => {
    expect([..._SHED_NEVER].sort()).toEqual([...DURABLE_NEVER].sort());
  });

  it('SHED_NEVER and SHED_KINDS are disjoint (a durable kind is never sheddable)', () => {
    for (const k of _SHED_NEVER) expect(_SHED_KINDS.has(k)).toBe(false);
  });

  it.each(DURABLE_NEVER)('durable kind %s can NEVER be shed, even with flag_shed_<kind>=1', async (kind) => {
    __setTune({ [`flag_shed_${kind}`]: 1 });
    const res = mockRes();
    expect(await _isShedded(kind, res)).toBe(false);   // guard refuses regardless of the flag
    expect(res.statusCode).toBe(null);                 // nothing written → handler runs, data ingested
  });

  it('a sheddable kind IS shed (200-ack-and-drop) when its flag is set', async () => {
    __setTune({ flag_shed_buff_casts: 1 });
    const res = mockRes();
    expect(await _isShedded('buff_casts', res)).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).shed).toBe('buff_casts');
  });

  it('a sheddable kind is NOT shed when its flag is absent/0 (fail-open)', async () => {
    __setTune({});
    const res = mockRes();
    expect(await _isShedded('tells', res)).toBe(false);
    expect(res.statusCode).toBe(null);
  });

  it('every newly-covered kind is in the sheddable allowlist', () => {
    for (const kind of ['buff_casts', 'pvp', 'pvp_assists', 'fun_event', 'trigger_relay', 'ui_layout', 'tells']) {
      expect(_SHED_KINDS.has(kind)).toBe(true);
    }
  });

  it('an unrecognized kind is never shed even if a stray flag is set', async () => {
    __setTune({ flag_shed_place_bid: 1 });
    const res = mockRes();
    expect(await _isShedded('place_bid', res)).toBe(false);
    expect(res.statusCode).toBe(null);
  });
});
