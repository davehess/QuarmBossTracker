// Upload tokens hashed at rest + 90-day idle expiry (readiness audit #15). Real utils/mimicLink.js, stubbed store.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';

process.env.SUPABASE_URL = 'https://test.invalid.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

import * as mimicLink from '../utils/mimicLink.js';
const supabase = require('../utils/supabase');

const DAY = 86_400_000;
const tok = () => 'wpms_' + crypto.randomBytes(32).toString('hex');
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const req = t => ({ headers: { authorization: `Bearer ${t}` }, method: 'POST', url: '/api/agent/encounter', socket: { remoteAddress: '9.9.9.9' } });
const res = () => ({ code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b; } });

let selects, updates, byHash, byPlain;
beforeEach(() => {
  delete process.env.SESSION_PLAINTEXT_FALLBACK; delete process.env.SESSION_IDLE_DAYS;
  selects = []; updates = []; byHash = new Map(); byPlain = new Map();
  vi.spyOn(supabase, 'isEnabled').mockReturnValue(true);
  vi.spyOn(supabase, 'select').mockImplementation(async (table, q) => {
    selects.push(q);
    if (table === 'mimic_sessions') {
      const m = /^(token_hash|session_token)=eq\.([^&]+)/.exec(q);
      const row = (m[1] === 'token_hash' ? byHash : byPlain).get(decodeURIComponent(m[2]));
      return row ? [row] : [];
    }
    return [{ nickname: 'N', global_name: null, role_names: [], is_member: true }];
  });
  vi.spyOn(supabase, 'update').mockImplementation(async (t, q, b) => { updates.push([q, b]); return []; });
  for (const k of [...mimicLink._sessionCache.keys()]) mimicLink._sessionCache.delete(k);
  for (const k of [...mimicLink._sessionMissCache.keys()]) mimicLink._sessionMissCache.delete(k);
});

const row = (over = {}) => ({ discord_id: '1', user_id: null, revoked_at: null, scope: null, guild_id: null,
  created_at: new Date(Date.now() - 200 * DAY).toISOString(), last_used_at: new Date().toISOString(), ...over });

describe('hashToken / isIdleExpired (pure)', () => {
  it('is sha256 hex of the whole token', () => {
    const t = tok();
    expect(mimicLink.hashToken(t)).toBe(sha(t));
    expect(mimicLink.hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('expires a member session past 90 days idle and no sooner', () => {
    const now = Date.now();
    expect(mimicLink.isIdleExpired({ last_used_at: new Date(now - 91 * DAY).toISOString() }, now)).toBe(true);
    expect(mimicLink.isIdleExpired({ last_used_at: new Date(now - 89 * DAY).toISOString() }, now)).toBe(false);
    expect(mimicLink.isIdleExpired({ last_used_at: new Date(now - 8 * DAY).toISOString() }, now)).toBe(false);   // a weekly raider
  });
  it('never expires a guest (own expires_at), a row with no stamp, or when switched off', () => {
    const now = Date.now(), old = new Date(now - 400 * DAY).toISOString();
    expect(mimicLink.isIdleExpired({ scope: 'guest', last_used_at: old }, now)).toBe(false);
    // Members only (DECISIONS §573): a player who only syncs flags or characters is left alone; both member shapes expire.
    expect(mimicLink.isIdleExpired({ scope: 'player', last_used_at: old }, now)).toBe(false);
    expect(mimicLink.isIdleExpired({ scope: 'member', last_used_at: old }, now)).toBe(true);
    expect(mimicLink.isIdleExpired({ scope: null, last_used_at: old }, now)).toBe(true);
    expect(mimicLink.isIdleExpired({}, now)).toBe(false);
    expect(mimicLink.isIdleExpired({ last_used_at: old }, now, 0)).toBe(false);
  });
});

describe('lookup order', () => {
  it('a hashed row resolves on ONE read, by hash, never sending the plaintext to the store', async () => {
    const t = tok(); byHash.set(sha(t), row());
    const r = res();
    expect(await mimicLink.requireAgentAuth(req(t), r)).toBeTruthy();
    expect(selects.filter(q => q.startsWith('token_hash=eq.' + sha(t))).length).toBe(1);
    expect(selects.some(q => q.startsWith('session_token='))).toBe(false);
    expect(updates.every(([q]) => !q.includes(t))).toBe(true);   // the last_used_at touch is by hash
  });
  it('a plaintext-only row still works in phase 1 and gets its hash backfilled (without touching last_used_at)', async () => {
    const t = tok(); byPlain.set(t, row());
    expect(await mimicLink.requireAgentAuth(req(t), res())).toBeTruthy();
    const bf = updates.find(([q]) => q.startsWith('session_token=eq.' + t));
    expect(bf[1]).toEqual({ token_hash: sha(t) });
  });
  it('SESSION_PLAINTEXT_FALLBACK=off makes a plaintext-only row a 401 (the phase-2 rehearsal)', async () => {
    process.env.SESSION_PLAINTEXT_FALLBACK = 'off';
    const t = tok(); byPlain.set(t, row());
    const r = res();
    expect(await mimicLink.requireAgentAuth(req(t), r)).toBeNull();
    expect(r.code).toBe(401);
  });
  it('an unknown token fails closed with 401 and the hint names the 90-day expiry', async () => {
    const r = res();
    expect(await mimicLink.requireAgentAuth(req(tok()), r)).toBeNull();
    expect(r.code).toBe(401);
    expect(r.body).toMatch(/90 days/);
  });
});

describe('90-day idle expiry at lookup', () => {
  it('refuses a member session idle 91 days (401), even though it is not revoked', async () => {
    const t = tok(); byHash.set(sha(t), row({ last_used_at: new Date(Date.now() - 91 * DAY).toISOString() }));
    const r = res();
    expect(await mimicLink.requireAgentAuth(req(t), r)).toBeNull();
    expect(r.code).toBe(401);
    expect(updates.length).toBe(0);   // an expired session is not revived by being refused
  });
  it('lets a session idle 30 days through', async () => {
    const t = tok(); byHash.set(sha(t), row({ last_used_at: new Date(Date.now() - 30 * DAY).toISOString() }));
    expect(await mimicLink.requireAgentAuth(req(t), res())).toBeTruthy();
  });
  it('the touch is debounced: many resolves inside the hour write last_used_at once', async () => {
    const t = tok(); byHash.set(sha(t), row());
    for (let i = 0; i < 5; i++) {
      mimicLink._sessionCache.delete(t);   // force a store read each time
      await mimicLink.requireAgentAuth(req(t), res());
    }
    expect(updates.filter(([, b]) => b.last_used_at).length).toBe(1);
  });
});
