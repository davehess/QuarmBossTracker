// Officer flag-override endpoint whitelist (#118) — SOURCE-SLICE fidelity tier.
//
// The `_FLAG_OVERRIDE_KEYS` whitelist and `_handleAgentFlagOverride` handler live
// inside the bot monolith (index.js) and aren't exported. We read the real source
// and eval JUST those blocks (plus the real `_SHED_KINDS` the whitelist is built
// from) with thin stubs for the auth gate + Supabase, so the test is coupled to
// the shipped code: change the whitelist and this test exercises the new set.
//
// The load-bearing guarantees under test:
//   • ONLY whitelisted control-plane flags are writable — the free-form numeric
//     knobs (ext_*/offheal_*/ch_*) stay web-only and are rejected 400.
//   • non-officers can never flip a flag (403).
//   • boolean flags are written LITERALLY (explicit 0 for dedup_chat-off).
//   • min_agent_ver_num is a floored int; <=0 clears the key.
//   • read-modify-write preserves every unrelated tuning key.

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock } from './_source-slice.js';

const src       = readSource(BOT_INDEX);
const shedBlock = sliceBlock(src, 'const _SHED_KINDS = new Set([', ']);');
const flagBlock = sliceBlock(src, 'const _FLAG_OVERRIDE_KEYS = new Set([', '// POST /api/agent/rolls');

// Build a fresh sliced handler + its whitelist, wired to a controllable state
// object (the mock identity, the pre-existing tuning row, and a capture slot for
// whatever the handler upserts).
function build(overrides = {}) {
  const state = {
    identity: { is_officer: true, display_name: 'Uilnayar', discord_id: '111' },
    enabled: true,
    tuning: {},          // what supabase.select returns as the current row
    wrote: null,         // captured upsert payload
    ...overrides,
  };
  const harness = `
    const mimicLink = { requireAgentAuth: async () => __state.identity };
    const _overlayTuningCache = { at: 999 };
    const __supabase = {
      isEnabled: () => __state.enabled,
      select: async () => [{ tuning: __state.tuning }],
      upsert: async (table, rows) => { __state.wrote = rows[0]; return rows; },
    };
    const require = (m) => {
      if (m === './utils/supabase') return __supabase;
      throw new Error('unexpected require: ' + m);
    };
  ` + shedBlock + '\n' + flagBlock + `
    return { _FLAG_OVERRIDE_KEYS, _SHED_KINDS, _handleAgentFlagOverride };
  `;
  // eslint-disable-next-line no-new-func
  const api = new Function('__state', harness)(state);
  return { state, ...api };
}

function mockReq(bodyObj) {
  const buf = Buffer.from(JSON.stringify(bodyObj));
  return { async *[Symbol.asyncIterator]() { yield buf; } };
}
function mockRes() {
  return {
    statusCode: null, headers: null, body: null,
    writeHead(code, h) { this.statusCode = code; this.headers = h || {}; return this; },
    end(b) { this.body = b == null ? '' : b; return this; },
  };
}
async function call(api, bodyObj) {
  const res = mockRes();
  await api._handleAgentFlagOverride(mockReq(bodyObj), res);
  return res;
}

const SHED_KEYS = [
  'flag_shed_live_state', 'flag_shed_raid_roster', 'flag_shed_casting',
  'flag_shed_threat_snapshot', 'flag_shed_buff_casts', 'flag_shed_pvp',
  'flag_shed_pvp_assists', 'flag_shed_fun_event', 'flag_shed_trigger_relay',
  'flag_shed_ui_layout', 'flag_shed_tells',
];

describe('_FLAG_OVERRIDE_KEYS whitelist (real index.js)', () => {
  it('contains the intended control-plane flags', () => {
    const { _FLAG_OVERRIDE_KEYS } = build();
    for (const k of [
      'flag_disable_reporter_election', 'dedup_chat', 'dedup_buffs', 'dedup_roster',
      'flag_raid_hold', 'flag_agent_kill', 'flag_disable_budgets', 'min_agent_ver_num',
    ]) expect(_FLAG_OVERRIDE_KEYS.has(k)).toBe(true);
  });

  it('enumerates every flag_shed_<kind> from the live _SHED_KINDS set', () => {
    const { _FLAG_OVERRIDE_KEYS, _SHED_KINDS } = build();
    for (const kind of _SHED_KINDS) expect(_FLAG_OVERRIDE_KEYS.has(`flag_shed_${kind}`)).toBe(true);
    for (const k of SHED_KEYS) expect(_FLAG_OVERRIDE_KEYS.has(k)).toBe(true);
  });

  it('does NOT include the free-form numeric knobs (web-only)', () => {
    const { _FLAG_OVERRIDE_KEYS } = build();
    for (const k of ['ext_hurt_pct', 'ext_hurt_min_sec', 'offheal_hurt_pct', 'ch_go_display_sec', 'reporter_pin_chat'])
      expect(_FLAG_OVERRIDE_KEYS.has(k)).toBe(false);
  });
});

describe('_handleAgentFlagOverride — officer gate', () => {
  it('non-officer is rejected 403 and nothing is written', async () => {
    const api = build({ identity: { is_officer: false, discord_id: '222' } });
    const res = await call(api, { key: 'flag_shed_pvp', value: 1 });
    expect(res.statusCode).toBe(403);
    expect(api.state.wrote).toBe(null);
  });

  it('unauthenticated (null identity) returns without writing', async () => {
    const api = build({ identity: null });
    const res = await call(api, { key: 'flag_shed_pvp', value: 1 });
    expect(res.statusCode).toBe(null);       // requireAgentAuth already answered
    expect(api.state.wrote).toBe(null);
  });
});

describe('_handleAgentFlagOverride — whitelist enforcement', () => {
  it('an allowed shed flag flips to 1 and 200-oks', async () => {
    const api = build();
    const res = await call(api, { key: 'flag_shed_pvp', value: 1 });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, key: 'flag_shed_pvp', value: 1 });
    expect(api.state.wrote.tuning.flag_shed_pvp).toBe(1);
  });

  it('an unknown / free-form key is rejected 400 and never written', async () => {
    const api = build();
    const res = await call(api, { key: 'ext_hurt_pct', value: 42 });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/whitelist/);
    expect(api.state.wrote).toBe(null);
  });

  it('a non-finite value is rejected 400', async () => {
    const api = build();
    const res = await call(api, { key: 'flag_agent_kill', value: 'yes' });
    expect(res.statusCode).toBe(400);
    expect(api.state.wrote).toBe(null);
  });
});

describe('_handleAgentFlagOverride — value semantics', () => {
  it('dedup_chat=0 persists an EXPLICIT 0 (not an omitted key) — default is ON', async () => {
    const api = build();
    const res = await call(api, { key: 'dedup_chat', value: 0 });
    expect(res.statusCode).toBe(200);
    expect(Object.prototype.hasOwnProperty.call(api.state.wrote.tuning, 'dedup_chat')).toBe(true);
    expect(api.state.wrote.tuning.dedup_chat).toBe(0);
  });

  it('min_agent_ver_num floors a positive value', async () => {
    const api = build();
    const res = await call(api, { key: 'min_agent_ver_num', value: 30395.7 });
    expect(res.statusCode).toBe(200);
    expect(api.state.wrote.tuning.min_agent_ver_num).toBe(30395);
    expect(JSON.parse(res.body).value).toBe(30395);
  });

  it('min_agent_ver_num <= 0 clears the key (unset = no floor)', async () => {
    const api = build({ tuning: { min_agent_ver_num: 30300 } });
    const res = await call(api, { key: 'min_agent_ver_num', value: 0 });
    expect(res.statusCode).toBe(200);
    expect(Object.prototype.hasOwnProperty.call(api.state.wrote.tuning, 'min_agent_ver_num')).toBe(false);
    expect(JSON.parse(res.body).value).toBe(null);
  });

  it('read-modify-write preserves unrelated tuning keys', async () => {
    const api = build({ tuning: { ext_hurt_pct: 85, reporter_pin_chat: 'Hitya' } });
    await call(api, { key: 'flag_agent_kill', value: 1 });
    expect(api.state.wrote.tuning.ext_hurt_pct).toBe(85);
    expect(api.state.wrote.tuning.reporter_pin_chat).toBe('Hitya');
    expect(api.state.wrote.tuning.flag_agent_kill).toBe(1);
  });
});
