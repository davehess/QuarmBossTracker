// test/guild-rls-status.test.js — fail-open must not be silent: the bot's guild-RLS status (flag on while not actually
// scoped), its throttled bot_kv write, GET /health, and the /admin/overlays decision helper (web/lib/guildRlsStatus.ts).
//
// Run: npx vitest run test/guild-rls-status.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { readSource, ROOT, stripJs } from './_source-slice.js';
import { guildRlsView } from '../web/lib/guildRlsStatus.ts';

const require = createRequire(import.meta.url);
const guildScoped = require('../utils/guildScoped.js');
const supabase = require('../utils/supabase.js');

const JWK = JSON.stringify({ ...crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' }), kid: 'k1' });
const ENV_KEYS = ['GUILD_RLS', 'SUPABASE_JWT_SIGNING_JWK', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_GUILD_ID'];
let saved; let writes;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.SUPABASE_URL = 'https://example.supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-for-tests';
  process.env.SUPABASE_GUILD_ID = 'wolfpack';
  guildScoped._resetWarned(); guildScoped._resetStatus(); supabase._resetBreaker(); supabase._resetScopedStats();
  writes = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    if (String(url).includes('/bot_kv')) writes.push(JSON.parse(init.body)[0]);
    return { ok: true, status: 200, text: async () => '[]', headers: { get: () => null } };
  }));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('bot-side status', () => {
  it('flag on with no key: key_ok false, written to bot_kv guild_rls_status with no secret in it', async () => {
    process.env.GUILD_RLS = '1';
    expect(guildScoped.forIdentity({ guild_id: 'acme' }, {})).toBeNull();
    await Promise.resolve();
    expect(guildScoped.status()).toMatchObject({ flag_on: true, key_ok: false, rejected_count: 0 });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ guild_id: 'wolfpack', key: 'guild_rls_status', value: { flag_on: true, key_ok: false } });
    expect(JSON.stringify(writes[0])).not.toMatch(/"d"|BEGIN|Bearer/);
  });

  it('flag on with a key: key_ok true; flag off: flag_on false', () => {
    process.env.GUILD_RLS = '1';
    process.env.SUPABASE_JWT_SIGNING_JWK = JWK;
    expect(guildScoped.forIdentity({ guild_id: 'acme' }, {})).toMatchObject({ scoped: true });
    expect(guildScoped.status()).toMatchObject({ flag_on: true, key_ok: true });
    delete process.env.GUILD_RLS;
    guildScoped.forIdentity({ guild_id: 'acme' }, {});
    expect(guildScoped.status().flag_on).toBe(false);
  });

  it('a 401 on a scoped call counts a rejection and stamps its time', async () => {
    process.env.GUILD_RLS = '1';
    process.env.SUPABASE_JWT_SIGNING_JWK = JWK;
    const client = guildScoped.forIdentity({ guild_id: 'acme' }, {});
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      const rejected = String(init.headers.Authorization).includes('.');   // our JWT has dots, the service key does not
      return { ok: !rejected, status: rejected ? 401 : 200, text: async () => '[]', headers: { get: () => null } };
    }));
    await guildScoped.run(client, () => supabase.select('encounters', 'select=id&limit=1'));
    const st = guildScoped.status();
    expect(st.rejected_count).toBe(1);
    expect(Date.parse(st.last_rejected_at)).toBeGreaterThan(Date.now() - 5000);
  });

  it('persists at most once per 5 minutes and only on change', () => {
    process.env.GUILD_RLS = '1';
    expect(guildScoped.persistStatus({ nowMs: Date.now() - 3600e3 })).toBe(false);   // flag not yet seen on: nothing to say
    guildScoped.forIdentity({ guild_id: 'acme' }, {});                      // flag on, no key: the first write happens here
    expect(writes).toHaveLength(1);
    const n = vi.mocked(fetch).mock.calls.length;
    expect(guildScoped.persistStatus({ nowMs: Date.now() + 1000 })).toBe(false);        // unchanged
    process.env.SUPABASE_JWT_SIGNING_JWK = JWK;
    guildScoped.forIdentity({ guild_id: 'acme' }, {});                      // changed (key_ok) but inside the window
    expect(vi.mocked(fetch).mock.calls.length).toBe(n);
    expect(guildScoped.persistStatus({ nowMs: Date.now() + 6 * 60 * 1000 })).toBe(true);   // window passed
  });

  it('GET /health carries guild_rls (text over comment-stripped source)', () => {
    const idx = stripJs(readSource(path.join(ROOT, 'index.js')));
    expect(idx).toMatch(/guildRls = guildScoped\.status\(\)/);
    expect(idx).toMatch(/supabase_row_cap: rowCap, guild_rls: guildRls/);
  });
});

describe('guildRlsView (the /admin/overlays decision)', () => {
  const now = Date.parse('2026-10-31T12:00:00Z');
  const hoursAgo = (h) => new Date(now - h * 3600e3).toISOString();

  it('shows nothing when the flag is off or there is no status', () => {
    expect(guildRlsView(null, now).kind).toBe('none');
    expect(guildRlsView({ flag_on: false, key_ok: false, rejected_count: 9, last_rejected_at: hoursAgo(1) }, now).kind).toBe('none');
  });

  it('warns when the flag is on and the key is not ok', () => {
    const v = guildRlsView({ flag_on: true, key_ok: false }, now);
    expect(v.kind).toBe('warn');
    expect(v.message).toMatch(/OFF in practice/);
  });

  it('warns on a rejection in the last 24 hours, with the count', () => {
    const v = guildRlsView({ flag_on: true, key_ok: true, rejected_count: 7, last_rejected_at: hoursAgo(3) }, now);
    expect(v.kind).toBe('warn');
    expect(v.message).toMatch(/7 times/);
  });

  it('is green when healthy, and an old rejection (over 24h) does not warn', () => {
    const old = guildRlsView({ flag_on: true, key_ok: true, rejected_count: 7, last_rejected_at: hoursAgo(30), last_ok_at: hoursAgo(0.01) }, now);
    expect(old.kind).toBe('ok');
    expect(old.message).toMatch(/Guild separation active — last scoped write/);
  });
});

describe('the page wires the helper', () => {
  it('reads bot_kv guild_rls_status server-side and renders the view', () => {
    const page = stripJs(readSource(path.join(ROOT, 'web', 'app', 'admin', 'overlays', 'page.tsx')));
    expect(page).toMatch(/from\('bot_kv'\)/);
    expect(page).toMatch(/eq\('key', 'guild_rls_status'\)/);
    expect(page).toMatch(/rlsView\.kind === 'warn'/);
  });
});
