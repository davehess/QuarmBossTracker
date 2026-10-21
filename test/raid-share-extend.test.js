// test/raid-share-extend.test.js — an officer moves a share's END after the fact, or makes it follow the raid
// (the guild lead, 2026-10-21: "one that lets me set an end-time after the raid finishes").
//
//   1. PLAN     planShareChange: the 24 h cap, after-from, not-far-future, open / close.
//   2. OPEN     an open share is a marker in to_at (no column); its window ends at the clock, capped at from + 24 h.
//   3. LOOKUP   resolveShare returns the NEW window after a change, and an open one moves with `now` even from the memo.
//   4. SOURCE   the PATCH route is officer + same-origin gated and drops both caches; the cached reads key on the end.
//
// Run: npx vitest run test/raid-share-extend.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import {
  planShareChange, isOpenShare, openWindow, windowOfShare, makeWindow, newToken, MAX_WINDOW_MS, OPEN_SPAN_MS, MAX_END_AHEAD_MS,
} from '../web/lib/raidShare.ts';
import { resolveShare, clearShareMemo } from '../web/lib/raidShareLookup.ts';
import { MINUTE_MS } from '../web/lib/raidReplay.ts';

const read = (...p) => stripJs(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));
const FROM = Date.parse('2026-10-20T23:00:00.000Z');
const HOUR = 60 * MINUTE_MS;
const NOW = FROM + 3 * HOUR;
const iso = (ms) => new Date(ms).toISOString();
const row = (toMs) => ({ from_at: iso(FROM), to_at: iso(toMs) });
const fixed = row(FROM + 2 * HOUR);

describe('planShareChange', () => {
  it('sets a later end, rounded up to the minute', () => {
    expect(planShareChange(fixed, { to: iso(NOW + 20_000) }, NOW)).toEqual({ to_at: iso(NOW + MINUTE_MS) });
  });
  it('refuses an end at or before the start', () => {
    expect(planShareChange(fixed, { to: iso(FROM) }, NOW)).toHaveProperty('error');
    expect(planShareChange(fixed, { to: iso(FROM - HOUR) }, NOW)).toHaveProperty('error');
  });
  it('refuses a window over 24 h and allows exactly 24 h', () => {
    const now = FROM + 30 * HOUR;
    expect(planShareChange(fixed, { to: iso(FROM + MAX_WINDOW_MS + MINUTE_MS) }, now)).toHaveProperty('error');
    expect(planShareChange(fixed, { to: iso(FROM + MAX_WINDOW_MS) }, now)).toEqual({ to_at: iso(FROM + MAX_WINDOW_MS) });
  });
  it('refuses an end more than 12 h ahead of now, allows 12 h', () => {
    const early = FROM + HOUR;   // a window end inside the 24 h cap but past now + 12 h
    expect(planShareChange(fixed, { to: iso(early + MAX_END_AHEAD_MS + MINUTE_MS) }, early)).toHaveProperty('error');
    expect(planShareChange(fixed, { to: iso(early + MAX_END_AHEAD_MS) }, early)).toEqual({ to_at: iso(early + MAX_END_AHEAD_MS) });
  });
  it('refuses junk', () => {
    for (const to of ['nope', 42, {}, [], true]) expect(planShareChange(fixed, { to }, NOW)).toHaveProperty('error');
    expect(planShareChange(fixed, {}, NOW)).toHaveProperty('error');
    expect(planShareChange(fixed, { open: 'yes' }, NOW)).toHaveProperty('error');
    expect(planShareChange(fixed, { open: true, to: iso(NOW) }, NOW)).toHaveProperty('error');
  });
  it('open:true stores the marker; open:false closes at now (capped at from + 24 h)', () => {
    const open = planShareChange(fixed, { open: true }, NOW);
    expect(open).toEqual({ to_at: iso(FROM + OPEN_SPAN_MS) });
    expect(isOpenShare({ from_at: iso(FROM), to_at: open.to_at })).toBe(true);
    const closed = planShareChange({ from_at: iso(FROM), to_at: open.to_at }, { open: false }, NOW);
    expect(closed).toEqual({ to_at: iso(NOW) });
    expect(isOpenShare({ from_at: iso(FROM), to_at: closed.to_at })).toBe(false);
    const late = FROM + 40 * HOUR;
    expect(planShareChange(row(FROM + OPEN_SPAN_MS), { open: false }, late)).toEqual({ to_at: iso(FROM + MAX_WINDOW_MS) });
  });
});

describe('an open share', () => {
  const open = row(FROM + OPEN_SPAN_MS);
  it('is only ever the marker: no window made by makeWindow looks open', () => {
    expect(isOpenShare(open)).toBe(true);
    expect(isOpenShare(fixed)).toBe(false);
    expect(isOpenShare(row(FROM + MAX_WINDOW_MS))).toBe(false);
    const w = makeWindow(FROM, FROM + OPEN_SPAN_MS);   // rounds to a whole day, so it can never be mistaken for the marker
    expect(w.toMs - w.fromMs).toBe(MAX_WINDOW_MS);
    expect(openWindow(FROM + 5_000)).toEqual({ fromMs: FROM, toMs: FROM + OPEN_SPAN_MS });
  });
  it('ends at the clock, up to a day after the start', () => {
    expect(windowOfShare(open, NOW)).toEqual({ fromMs: FROM, toMs: NOW });
    expect(windowOfShare(open, NOW + 20_000)).toEqual({ fromMs: FROM, toMs: NOW + MINUTE_MS });
    expect(windowOfShare(open, FROM + 50 * HOUR)).toEqual({ fromMs: FROM, toMs: FROM + MAX_WINDOW_MS });
  });
  it('is never empty, even before its start', () => {
    expect(windowOfShare(open, FROM - HOUR)).toEqual({ fromMs: FROM, toMs: FROM + MINUTE_MS });
  });
  it('a fixed share ignores the clock', () => {
    expect(windowOfShare(fixed, NOW + 10 * HOUR)).toEqual({ fromMs: FROM, toMs: FROM + 2 * HOUR });
  });
});

describe('the lookup serves the current window', () => {
  const token = newToken();
  const full = (r) => ({
    id: 'id1', guild_id: 'wolfpack', title: 't', created_at: '2026-10-15T00:00:00Z', expires_at: '2026-12-01T00:00:00Z',
    revoked_at: null, view_count: 0, ...r,
  });
  const db = (r) => ({
    from: () => { const b = { select: () => b, eq: () => b, maybeSingle: () => Promise.resolve({ data: r, error: null }) }; return b; },
  });
  beforeEach(() => clearShareMemo());

  it('after the end is moved (memo cleared) it returns the new window', async () => {
    const a = await resolveShare(db(full(row(FROM + 2 * HOUR))), token, NOW);
    expect(a.win.toMs).toBe(FROM + 2 * HOUR);
    clearShareMemo();   // what invalidateShare does for this share
    const b = await resolveShare(db(full(row(FROM + 5 * HOUR))), token, NOW);
    expect(b.win.toMs).toBe(FROM + 5 * HOUR);
  });
  it('an open share moves with the clock even when the row is memoised', async () => {
    const d = db(full(row(FROM + OPEN_SPAN_MS)));
    expect((await resolveShare(d, token, NOW)).win.toMs).toBe(NOW);
    expect((await resolveShare(d, token, NOW + 10 * MINUTE_MS)).win.toMs).toBe(NOW + 10 * MINUTE_MS);
  });
});

describe('the routes', () => {
  const patch = read('web', 'app', 'api', 'raid', 'shares', '[id]', 'route.ts');
  const patchBody = patch.slice(patch.indexOf('export async function PATCH'), patch.indexOf('export async function DELETE'));

  it('PATCH is gated like DELETE: same origin, signed in, officer, a uuid', () => {
    const gate = patch.slice(patch.indexOf('async function gate'), patch.indexOf('export async function PATCH'));
    expect(gate).toMatch(/cross-site request/);
    expect(gate).toMatch(/auth\.getUser\(\)/);
    expect(gate).toMatch(/isOfficer\(user\.id\)/);
    expect(gate).toMatch(/UUID\.test\(id\)/);
    expect(patchBody.indexOf('gate(req')).toBeGreaterThan(-1);
    expect(patch.slice(patch.indexOf('export async function DELETE'))).toMatch(/gate\(req/);
  });
  it('PATCH scopes to the guild, skips revoked rows, validates with planShareChange and drops both caches', () => {
    expect(patchBody).toMatch(/\.eq\('guild_id', GUILD_TAG\)/);
    expect(patchBody).toMatch(/\.is\('revoked_at', null\)/);
    expect(patchBody.indexOf('planShareChange(')).toBeLessThan(patchBody.indexOf('.update('));
    expect(patchBody).toMatch(/invalidateShare\(params\.id\)/);
    expect(patchBody).toMatch(/revalidateTag\(shareTag\(params\.id\)\)/);
    expect(patchBody).not.toMatch(/token_hash/);   // the address does not change
  });
  it('the cached public reads carry the window end in their key', () => {
    expect(read('web', 'app', 'api', 'share', 'raid', '[token]', 'bosses', 'route.ts')).toMatch(/'bosses', String\(win\.fromMs\), String\(win\.toMs\)/);
    expect(read('web', 'app', 'api', 'share', 'raid', '[token]', 'replay', 'route.ts')).toMatch(/String\(slice\.toMs\), String\(win\.toMs\)/);
  });
  it('creating can ask for an open share without a new column', () => {
    const post = read('web', 'app', 'api', 'raid', 'shares', 'route.ts');
    expect(post).toMatch(/body\.open === true/);
    expect(post).toMatch(/openWindow\(/);
    const sql = fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter(f => /raid_shares/.test(f));
    expect(sql).toEqual(['20261015130000_raid_shares.sql']);
  });
});
