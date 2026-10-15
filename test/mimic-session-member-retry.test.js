// test/mimic-session-member-retry.test.js — a failed member read must not cache "no roles" for 5 minutes.
//
// Raid night 2026-10-14: the store stalled for a moment, the session lookup's wolfpack_members read came back
// failed, and the bot cached the officer as a non-officer for 5 minutes — the Mimic Admin tab vanished and a DKP
// tick from the dashboard came back "officers only". utils/mimicLink.js runs for real here, with utils/supabase.js's
// functions swapped on the shared CJS module object (the same pattern as test/member-lockout.test.js).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { BOT_INDEX } from './_source-slice.js';

const nodeRequire = createRequire(BOT_INDEX);
const supabase = nodeRequire('./utils/supabase');
const mimicLink = nodeRequire('./utils/mimicLink');

const saved = {};
let memberRead;   // what the next wolfpack_members read returns: an array, or null (= the request failed)
let memberReads;
beforeEach(() => {
  for (const k of ['isEnabled', 'select', 'update']) saved[k] = supabase[k];
  supabase.isEnabled = () => true;
  supabase.update = async () => [];
  memberReads = 0;
  supabase.select = async (table) => {
    if (table === 'mimic_sessions') return [{ user_id: null, discord_id: '111111111111111111', revoked_at: null }];
    if (table === 'wolfpack_members') { memberReads++; return memberRead; }
    return [];
  };
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 9, 15, 3, 0, 0));
});
afterEach(() => {
  for (const k of Object.keys(saved)) supabase[k] = saved[k];
  vi.useRealTimers();
});

const req = (token) => ({ headers: { 'x-wolfpack-mimic-session': token } });
const OFFICER = [{ nickname: 'Aldenmar', global_name: null, role_names: ['Officer'] }];

describe('session identity when the member read fails', () => {
  it('keeps the last good officer identity through a failed read', async () => {
    const token = 'wpms_keep_' + Math.random();
    memberRead = OFFICER;
    expect((await mimicLink.resolveMimicSession(req(token))).is_officer).toBe(true);
    vi.advanceTimersByTime(6 * 60 * 1000);   // past the 5-minute cache: the next call reads again
    memberRead = null;                       // …and that read fails
    expect((await mimicLink.resolveMimicSession(req(token))).is_officer).toBe(true);
  });

  it('retries within 15 seconds instead of holding a failed read for 5 minutes', async () => {
    const token = 'wpms_retry_' + Math.random();
    memberRead = null;
    expect((await mimicLink.resolveMimicSession(req(token))).is_officer).toBe(false);
    memberRead = OFFICER;
    vi.advanceTimersByTime(5 * 1000);
    await mimicLink.resolveMimicSession(req(token));
    expect(memberReads).toBe(1);             // still inside the 15 s retry wait
    vi.advanceTimersByTime(11 * 1000);
    expect((await mimicLink.resolveMimicSession(req(token))).is_officer).toBe(true);
    expect(memberReads).toBe(2);
  });

  it('a successful read that finds no member still caches for the full 5 minutes', async () => {
    const token = 'wpms_none_' + Math.random();
    memberRead = [];
    expect((await mimicLink.resolveMimicSession(req(token))).is_officer).toBe(false);
    vi.advanceTimersByTime(60 * 1000);
    await mimicLink.resolveMimicSession(req(token));
    expect(memberReads).toBe(1);
  });
});
