// /start rate limiter — REAL-IMPORT fidelity tier.
//
// Under test: `_startRateLimited(req)` in utils/mimicLink.js — the real shipped
// per-IP sliding-window limiter on the UNAUTHENTICATED POST /api/mimic-link/start
// (each call does a Supabase INSERT, so an open loop is a write-amplification
// vector). Policy: 10 attempts / 10 min / IP; the 11th is limited; a different
// IP is independent; once the window slides past, the IP is allowed again.
// (It's exported solely for this suite — see module.exports.) IP is derived from
// x-forwarded-for (first hop) else socket.remoteAddress; time comes from
// Date.now(), so we drive the window with vitest fake timers.
//
// Ported from the session's scratchpad rl_test.js (13 cases).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import mimicLink from '../utils/mimicLink.js';

const { _startRateLimited } = mimicLink;

// Real function reads req.headers['x-forwarded-for'] first, then socket.
const req = (ip) => ({ headers: { 'x-forwarded-for': ip }, socket: { remoteAddress: ip } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-18T00:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

describe('_startRateLimited (real utils/mimicLink.js)', () => {
  it('allows the first 10 requests from an IP, then limits the 11th', () => {
    const ip = 'rl-a-1'; // unique IP → isolated from the module-level window map
    for (let i = 0; i < 10; i++) {
      expect(_startRateLimited(req(ip))).toBe(false); // request i allowed
    }
    expect(_startRateLimited(req(ip))).toBe(true);     // 11th limited
  });

  it('tracks a different IP independently', () => {
    const a = 'rl-a-2';
    for (let i = 0; i < 10; i++) _startRateLimited(req(a)); // exhaust A
    expect(_startRateLimited(req(a))).toBe(true);           // A limited
    expect(_startRateLimited(req('rl-b-2'))).toBe(false);   // fresh B unaffected
  });

  it('allows the IP again once the 10-minute window slides past', () => {
    const ip = 'rl-a-3';
    for (let i = 0; i < 10; i++) _startRateLimited(req(ip));
    expect(_startRateLimited(req(ip))).toBe(true);   // limited now
    vi.setSystemTime(new Date('2026-07-18T00:11:40Z')); // +11m40s > 10m window
    expect(_startRateLimited(req(ip))).toBe(false);  // old hits expired → allowed
  });
});
