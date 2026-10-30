// test/guest-link.test.js — an officer-approved, time-limited GUEST Mimic link that can upload parses only
// (the guild lead, 2026-10-30: "where can i give someone a temp key to contribute to shared parses as a raider from
// another guild").
//
// utils/mimicLink.js runs for real with utils/supabase.js's functions swapped on the shared CJS module object (the
// pattern of test/mimic-session-member-retry.test.js), so the allowlist and the expiry are exercised as shipped.
// web/lib/guestLink.ts is pure and imported directly. The source assertions run on comment-stripped text.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { BOT_INDEX, ROOT, readSource, sliceBlock, stripJs, stripSql } from './_source-slice.js';
import { guestExpiry, cleanGuestLabel } from '../web/lib/guestLink.ts';

const nodeRequire = createRequire(BOT_INDEX);
const supabase = nodeRequire('./utils/supabase');
const mimicLink = nodeRequire('./utils/mimicLink');
const crypto = nodeRequire('node:crypto');
const freshToken = () => 'wpms_' + crypto.randomBytes(32).toString('hex');

// ── expiry choice ────────────────────────────────────────────────────────────
describe('guestExpiry', () => {
  // 2026-10-30 is EDT (UTC-4): 6 AM ET is 10:00Z.
  it('"tonight" is the next 6 AM Eastern, after midnight', () => {
    expect(guestExpiry('tonight', new Date('2026-10-30T23:30:00Z'))).toBe('2026-10-31T10:00:00.000Z');   // 7:30 PM ET Friday
    expect(guestExpiry('tonight', new Date('2026-10-31T03:30:00Z'))).toBe('2026-10-31T10:00:00.000Z');   // 11:30 PM ET, still Friday's raid
  });
  it('"tonight" rolls to the same morning when asked in the small hours, and to tomorrow after 6 AM', () => {
    expect(guestExpiry('tonight', new Date('2026-10-31T05:00:00Z'))).toBe('2026-10-31T10:00:00.000Z');   // 1 AM ET
    expect(guestExpiry('tonight', new Date('2026-10-31T10:00:00Z'))).toBe('2026-11-01T11:00:00.000Z');   // exactly 6 AM ET: tomorrow (and DST ended)
    expect(guestExpiry('tonight', new Date('2026-10-31T15:00:00Z'))).toBe('2026-11-01T11:00:00.000Z');
  });
  it('"tonight" follows daylight saving: 6 AM is 11:00Z in winter, 10:00Z in summer', () => {
    expect(guestExpiry('tonight', new Date('2026-12-10T01:00:00Z'))).toBe('2026-12-10T11:00:00.000Z');
    expect(guestExpiry('tonight', new Date('2026-07-10T01:00:00Z'))).toBe('2026-07-10T10:00:00.000Z');
    // The night DST starts (2027-03-14, 2 AM ET): 6 AM that morning is already EDT.
    expect(guestExpiry('tonight', new Date('2027-03-14T03:00:00Z'))).toBe('2027-03-14T10:00:00.000Z');
  });
  it('"7d" is seven days from now, and anything else is refused', () => {
    expect(guestExpiry('7d', new Date('2026-10-30T12:00:00Z'))).toBe('2026-11-06T12:00:00.000Z');
    expect(guestExpiry('forever', new Date())).toBeNull();
    expect(guestExpiry('', new Date())).toBeNull();
  });
});

describe('cleanGuestLabel', () => {
  it('trims, collapses whitespace, strips control characters, clips to 64', () => {
    expect(cleanGuestLabel('  Aldenmar   of  Some Guild ')).toBe('Aldenmar of Some Guild');
    expect(cleanGuestLabel('a\u0000b\nc')).toBe('a b c');
    expect(cleanGuestLabel('x'.repeat(200))).toHaveLength(64);
    expect(cleanGuestLabel('   ')).toBeNull();
    expect(cleanGuestLabel(null)).toBeNull();
  });
});

// ── the allowlist, through the real requireAgentAuth ─────────────────────────
const saved = {};
let sessionRow;
beforeEach(() => {
  for (const k of ['isEnabled', 'select', 'update']) saved[k] = supabase[k];
  supabase.isEnabled = () => true;
  supabase.update = async () => [];
  supabase.select = async (table) => (table === 'mimic_sessions' ? [sessionRow] : []);
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 9, 31, 1, 0, 0));
  sessionRow = {
    user_id: null, discord_id: 'guest:7b2f0c1e-0000-4000-8000-000000000001', revoked_at: null,
    scope: 'guest', guest_label: 'Brackwyn of Another Guild', expires_at: new Date(Date.UTC(2026, 9, 31, 10, 0, 0)).toISOString(),
  };
});
afterEach(() => {
  for (const k of Object.keys(saved)) supabase[k] = saved[k];
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function call(method, url, token = freshToken()) {
  const req = { method, url, headers: { authorization: `Bearer ${token}` }, socket: { remoteAddress: '203.0.113.9' } };
  const res = { status: null, body: null, writeHead(s) { this.status = s; }, end(b) { this.body = b; } };
  return mimicLink.requireAgentAuth(req, res).then((identity) => ({ identity, res }));
}

describe('guest scope allowlist', () => {
  it('lets the parse upload and the poll through, with the guest identity attached', async () => {
    const enc = await call('POST', '/api/agent/encounter');
    expect(enc.res.status).toBeNull();
    expect(enc.identity).toMatchObject({ scope: 'guest', guest_label: 'Brackwyn of Another Guild', is_officer: false });
    expect(enc.identity.discord_id).toMatch(/^guest:/);
    expect((await call('GET', '/api/agent/poll?streams=tuning,triggers')).identity).toBeTruthy();
  });

  it('answers 403 guest_scope on every other route, before any handler could run', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    for (const [m, u] of [
      ['POST', '/api/agent/chat'], ['POST', '/api/agent/live-state'], ['POST', '/api/agent/buff_casts'],
      ['GET', '/api/agent/guild-triggers'], ['GET', '/api/agent/recent-fires'], ['GET', '/api/agent/reporter-poll'],
      ['POST', '/api/agent/tells'], ['GET', '/api/agent/encounter'], ['POST', '/api/agent/poll'],
      ['POST', '/api/agent/encounter/extra'], ['POST', '/api/agent/encounter2'], ['GET', '/api/me'],
    ]) {
      const r = await call(m, u);
      expect(r.identity, `${m} ${u}`).toBeNull();
      expect(r.res.status, `${m} ${u}`).toBe(403);
      expect(JSON.parse(r.res.body)).toEqual({ error: 'guest_scope' });
    }
    expect(log).toHaveBeenCalled();
  });

  it('logs a refusal once per guest and route, with console.log and never console.warn', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const token = freshToken();
    for (let i = 0; i < 5; i++) await call('POST', '/api/agent/live-state-once-only', token);
    expect(log.mock.calls.filter(c => String(c[0]).includes('live-state-once-only'))).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });

  it('never restricts a member session', async () => {
    sessionRow = { user_id: null, discord_id: '111111111111111111', revoked_at: null };
    supabase.select = async (table) => (table === 'mimic_sessions' ? [sessionRow] : [{ nickname: 'Aldenmar', role_names: [] }]);
    expect((await call('POST', '/api/agent/chat')).identity).toBeTruthy();
  });
});

describe('guest session expiry', () => {
  it('an expired guest session answers 401 like a revoked one', async () => {
    sessionRow.expires_at = new Date(Date.UTC(2026, 9, 31, 0, 59, 0)).toISOString();   // a minute ago
    const r = await call('POST', '/api/agent/encounter');
    expect(r.identity).toBeNull();
    expect(r.res.status).toBe(401);
  });

  it('a guest with no expiry at all is refused, never treated as a member', async () => {
    sessionRow.expires_at = null;
    expect((await call('POST', '/api/agent/encounter')).res.status).toBe(401);
  });

  it('is not served from cache past its expiry', async () => {
    const token = freshToken();
    sessionRow.expires_at = new Date(Date.UTC(2026, 9, 31, 1, 0, 40)).toISOString();   // 40 s from now
    expect((await call('POST', '/api/agent/encounter', token)).identity).toBeTruthy();
    supabase.select = async () => { throw new Error('should not read: still inside the cache window'); };
    vi.advanceTimersByTime(30 * 1000);   // cached, not yet expired
    expect((await call('POST', '/api/agent/encounter', token)).identity).toBeTruthy();
    vi.advanceTimersByTime(15 * 1000);   // 45 s: expired, but the cache window (60 s) has not
    const r = await call('POST', '/api/agent/encounter', token);
    expect(r.identity).toBeNull();
    expect(r.res.status).toBe(401);
  });

  it('a revoked guest is cut off within a minute, not five', async () => {
    const token = freshToken();
    expect((await call('POST', '/api/agent/encounter', token)).identity).toBeTruthy();
    sessionRow.revoked_at = new Date().toISOString();
    vi.advanceTimersByTime(61 * 1000);
    expect((await call('POST', '/api/agent/encounter', token)).res.status).toBe(401);
  });
});

// ── the bot wiring (comment-stripped source) ─────────────────────────────────
describe('bot wiring', () => {
  const idx = readSource(BOT_INDEX);
  const upload = stripJs(sliceBlock(idx, 'async function _handleAgentUpload(req, res) {', '\n}\n'));

  it('the upload handler treats a guest as a replay for live side effects and skips member-keyed writes', () => {
    expect(upload).toMatch(/const isGuest\s*=\s*identity\.scope === 'guest'/);
    expect(upload).toMatch(/const isBackfill = payload\?\.backfill === true \|\| isGuest/);
    expect(upload).toMatch(/uploadedWhoData\.length > 0 && !isGuest/);
    expect(upload).toMatch(/if \(!isGuest\) \{ try \{ recordAgentUpload/);
    expect(upload).toMatch(/if \(!isGuest\) _noteRaiderDeaths/);
    expect(upload).toMatch(/if \(!isGuest\) _trackUpload\(/);
    // the parse itself is still persisted for a guest: recordParse is not behind isGuest/isBackfill
    expect(upload).toMatch(/supabase\.recordParse\(/);
  });

  it('the poll serves a guest no stream', () => {
    const poll = stripJs(sliceBlock(idx, 'async function _handleAgentPoll(req, res) {', '\n}\n'));
    expect(poll).toMatch(/if \(identity\.scope === 'guest'\) want\.clear\(\)/);
  });
});

// ── mimicLink source: session minting ────────────────────────────────────────
describe('session minting', () => {
  const src = stripJs(readSource(path.join(ROOT, 'utils', 'mimicLink.js')));
  it('a guest code mints scope guest with the expiry, label and a guest: discord id', () => {
    expect(src).toMatch(/const isGuest = row\.authorized_via === 'guest'/);
    expect(src).toMatch(/scope:\s+'guest'/);
    expect(src).toMatch(/expires_at:\s+row\.guest_expires_at/);
    expect(src).toMatch(/discord_id:\s+isGuest \? `guest:\$\{guestSessionId\}`/);
  });
});

// ── migration ────────────────────────────────────────────────────────────────
describe('migration', () => {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const file = fs.readdirSync(dir).find(f => /_mimic_guest_sessions\.sql$/.test(f));
  it('exists and is idempotent: IF NOT EXISTS on every column and index, nothing destructive', () => {
    expect(file).toBeTruthy();
    const sql = stripSql(fs.readFileSync(path.join(dir, file), 'utf8'));
    const adds = sql.match(/ADD COLUMN\b[^,;]*/gi) || [];
    expect(adds.length).toBe(5);
    for (const a of adds) expect(a).toMatch(/ADD COLUMN IF NOT EXISTS/i);
    for (const col of ['guest_label', 'guest_expires_at', 'expires_at', 'scope']) expect(sql).toMatch(new RegExp(`IF NOT EXISTS\\s+${col}\\b`, 'i'));
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS mimic_sessions_guest_expires_idx[\s\S]*WHERE scope = 'guest'/i);
    expect((sql.match(/CREATE INDEX\b/gi) || []).length).toBe((sql.match(/CREATE INDEX IF NOT EXISTS/gi) || []).length);
    expect(sql).not.toMatch(/\b(DROP|DELETE|TRUNCATE)\b/i);
    expect(sql).not.toMatch(/NOT NULL/i);
  });
});

// ── the officer action ───────────────────────────────────────────────────────
describe('officer action', () => {
  const actions = stripJs(readSource(path.join(ROOT, 'web', 'app', 'admin', 'links', 'guest-link-actions.ts')));
  it('stamps the code as a guest approval with no member identity, and audits it', () => {
    expect(actions).toMatch(/authorized_via:\s+'guest'/);
    expect(actions).toMatch(/authorized_discord_id:\s+null/);
    expect(actions).toMatch(/authorized_user_id:\s+null/);
    expect(actions).toMatch(/authorized_by_discord_id:\s+actor!\.discordId/);
    expect(actions).toMatch(/guest_label:\s+label/);
    expect(actions).toMatch(/guest_expires_at:\s+expiresAt/);
    expect(actions).toMatch(/\.is\('authorized_at', null\)/);
    expect(actions).toMatch(/action:\s+'guest_link_approved'/);
  });
  it('keeps the member-link validation ladder and the officer gate on both actions', () => {
    for (const code of ['unknown_code', 'expired', 'already']) expect(actions).toContain(code);
    expect((actions.match(/await requireOfficer\(\)/g) || []).length).toBe(2);
  });
  it('revoke can only ever touch a guest session', () => {
    expect(actions).toMatch(/\.eq\('scope', 'guest'\)/);
    expect(actions).toMatch(/revoked_at: new Date\(\)\.toISOString\(\)/);
    expect(actions).toMatch(/action:\s+'guest_link_revoked'/);
  });
});
