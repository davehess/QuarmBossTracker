// Mimic auth sentinel — REAL-IMPORT fidelity tier.
//
// Under test: `requireAgentAuth` + `resolveMimicSession` (and, through them, the
// LOOKUP_ERROR sentinel in `_resolveSessionToken`) in utils/mimicLink.js — the
// real shipped module, imported directly. We drive it end-to-end through the
// REAL utils/supabase.js by (a) setting env so supabase.isEnabled() is true and
// (b) stubbing global fetch at the network boundary. supabase.select resolves
// `null` on request failure and an array (possibly []) on success, so:
//   fetch !ok  → select null → LOOKUP_ERROR → 503 (RETRYABLE — a 401 here would
//                make the agent's durable queue drop the payload as permanent,
//                turning a transient Supabase blip into fleet-wide data loss).
//   ok + []    → token not found            → 401
//   ok + [row] → valid                      → 200 identity
//   revoked    → 401
// The UI resolver fails closed to null on a blip (never leaks the truthy
// sentinel).
//
// Ported from the session's scratchpad auth_test.js (7 cases).

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

// isEnabled()/_request read env at CALL time, so setting these before the
// handlers run is enough even though the import below is hoisted.
process.env.SUPABASE_URL = 'https://test.invalid.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

import * as mimicLink from '../utils/mimicLink.js';

// sessionOutcome() shapes the fetch Response for the GET on /mimic_sessions;
// every other request (wolfpack_members lookup, last_used_at PATCH) is a benign
// empty-ok so the resolver proceeds without extra data.
let sessionOutcome;
const realFetch = global.fetch;

beforeEach(() => {
  sessionOutcome = () => ({ ok: true, status: 200, text: async () => '[]' });
  global.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    if (method === 'GET' && u.includes('/mimic_sessions')) return sessionOutcome();
    return { ok: true, status: 200, text: async () => '[]' };
  });
});
afterAll(() => { global.fetch = realFetch; });

function mockRes() {
  return {
    statusCode: null,
    _ended: false,
    writeHead(code) { this.statusCode = code; return this; },
    end(body) { this._ended = true; this.body = body; return this; },
  };
}
// Real session tokens are prefixed wpms_; requireAgentAuth rejects anything else
// before touching Supabase. Distinct token per case avoids the 5-min identity
// cache carrying a prior result over.
let seq = 0;
const bearerReq = () => ({ headers: { authorization: 'Bearer wpms_' + String(seq++).padStart(4, '0') + 'x'.repeat(60) } });
const uiReq     = () => ({ headers: { 'x-wolfpack-mimic-session': 'wpms_' + String(seq++).padStart(4, '0') + 'y'.repeat(60) } });

const OK   = (rows) => () => ({ ok: true,  status: 200, text: async () => JSON.stringify(rows) });
const DOWN = ()     => () => ({ ok: false, status: 500, text: async () => '{}' }); // → select null

describe('requireAgentAuth status mapping (real utils/mimicLink.js)', () => {
  it('Supabase blip (select null) → 503 retryable, NOT 401 (the audit P0)', async () => {
    sessionOutcome = DOWN();
    const res = mockRes();
    const id = await mimicLink.requireAgentAuth(bearerReq(), res);
    expect(id).toBe(null);
    expect(res.statusCode).toBe(503);
  });

  it('token not found (select []) → 401', async () => {
    sessionOutcome = OK([]);
    const res = mockRes();
    const id = await mimicLink.requireAgentAuth(bearerReq(), res);
    expect(id).toBe(null);
    expect(res.statusCode).toBe(401);
  });

  it('valid token → identity, no error status written', async () => {
    sessionOutcome = OK([{ user_id: 'u1', discord_id: 'd1', revoked_at: null }]);
    const res = mockRes();
    const id = await mimicLink.requireAgentAuth(bearerReq(), res);
    expect(id && id.discord_id).toBe('d1');
    expect(res.statusCode).toBe(null); // handler never wrote an error head
  });

  it('revoked token → 401', async () => {
    sessionOutcome = OK([{ user_id: 'u1', discord_id: 'd1', revoked_at: '2026-01-01T00:00:00Z' }]);
    const res = mockRes();
    const id = await mimicLink.requireAgentAuth(bearerReq(), res);
    expect(id).toBe(null);
    expect(res.statusCode).toBe(401);
  });
});

describe('resolveMimicSession (UI flow) — sentinel never leaks', () => {
  it('blip fails closed to null (no truthy LOOKUP_ERROR leak)', async () => {
    sessionOutcome = DOWN();
    const r = await mimicLink.resolveMimicSession(uiReq());
    expect(r).toBe(null);
  });

  it('not-found → null', async () => {
    sessionOutcome = OK([]);
    const r = await mimicLink.resolveMimicSession(uiReq());
    expect(r).toBe(null);
  });

  it('found → identity', async () => {
    sessionOutcome = OK([{ user_id: 'u1', discord_id: 'd1', revoked_at: null }]);
    const r = await mimicLink.resolveMimicSession(uiReq());
    expect(r && r.discord_id).toBe('d1');
  });
});
