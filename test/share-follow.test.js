// test/share-follow.test.js — a shared raid that FOLLOWS the raid redraws itself every minute, and holds still for a
// viewer who is scrubbing (the guild lead, 2026-10-23; web/lib/shareFollow.ts, app/raid/session/useFollowRefresh.ts).
//
//   1. HOLD     the decision: a touch in the last 30 s holds; a playhead parked inside the recording holds; a playhead
//               left where the page opened it, or at the live end, does not.
//   2. DUE      a refresh is due after a full minute, never while the tab is in the background.
//   3. FOLLOWING  only an open share that has not hit its 24 h cap follows; closing it ends the loop.
//   4. SOURCE   the share page tells the review whether it follows, the hook is driven by that flag and clears its
//               timer, the board takes a grown window in place, and the members' page never self-refreshes.
//
// Run: npx vitest run test/share-follow.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { FOLLOW_EVERY_MS, LIVE_EDGE_MS, QUIET_MS, followDue, followHeld } from '../web/lib/shareFollow.ts';
import { MAX_WINDOW_MS, openWindow, shareIsFollowing } from '../web/lib/raidShare.ts';

const MIN = 60_000;
const T0 = Date.parse('2026-10-22T23:30:00Z');
const END = T0 + 120 * MIN;
const base = { nowMs: END + 10 * MIN, lastTouchMs: null, playheadMs: null, openedMs: null, endMs: END };

describe('followHeld', () => {
  it('a viewer who has not touched anything is not held', () => {
    expect(followHeld(base)).toBe(false);
    expect(followHeld({ ...base, lastTouchMs: 0 })).toBe(false);
  });
  it('a touch in the last thirty seconds holds; thirty seconds later it does not', () => {
    expect(followHeld({ ...base, lastTouchMs: base.nowMs - (QUIET_MS - 1) })).toBe(true);
    expect(followHeld({ ...base, lastTouchMs: base.nowMs - QUIET_MS })).toBe(false);
    expect(followHeld({ ...base, lastTouchMs: base.nowMs - 5 * MIN })).toBe(false);
  });
  it('a playhead moved off where the page opened it and parked short of the live end holds', () => {
    expect(followHeld({ ...base, openedMs: T0, playheadMs: T0 + 40 * MIN })).toBe(true);
    expect(followHeld({ ...base, openedMs: T0, playheadMs: END - LIVE_EDGE_MS - 1 })).toBe(true);
  });
  it('a playhead left where it opened does not hold: the viewer has only been reading', () => {
    expect(followHeld({ ...base, openedMs: T0, playheadMs: T0 })).toBe(false);
    expect(followHeld({ ...base, openedMs: T0, playheadMs: T0 + 500 })).toBe(false);
  });
  it('a playhead brought back to the live end does not hold', () => {
    expect(followHeld({ ...base, openedMs: T0, playheadMs: END - LIVE_EDGE_MS })).toBe(false);
    expect(followHeld({ ...base, openedMs: T0, playheadMs: END })).toBe(false);
  });
  it('before the board has reported, only a touch can hold', () => {
    expect(followHeld({ ...base, playheadMs: T0 + 40 * MIN, openedMs: null })).toBe(false);
    expect(followHeld({ ...base, playheadMs: null, openedMs: T0 })).toBe(false);
  });
  it('the live end moves with the window: a playhead that was at the end is parked once the window has grown', () => {
    const grown = { ...base, openedMs: T0, playheadMs: END, endMs: END + 20 * MIN };
    expect(followHeld(grown)).toBe(true);
  });
});

describe('followDue', () => {
  it('is due after a full minute and not before', () => {
    expect(followDue(1_000 + FOLLOW_EVERY_MS - 1, 1_000, false)).toBe(false);
    expect(followDue(1_000 + FOLLOW_EVERY_MS, 1_000, false)).toBe(true);
  });
  it('asks for nothing while the tab is in the background', () => {
    expect(followDue(1_000 + 10 * FOLLOW_EVERY_MS, 1_000, true)).toBe(false);
  });
  it('is sixty seconds', () => {
    expect(FOLLOW_EVERY_MS).toBe(60_000);
  });
});

describe('shareIsFollowing', () => {
  const open = (fromMs) => ({ from_at: new Date(fromMs).toISOString(), to_at: new Date(openWindow(fromMs).toMs).toISOString() });
  const fixed = (fromMs, toMs) => ({ from_at: new Date(fromMs).toISOString(), to_at: new Date(toMs).toISOString() });
  it('an open share follows while its window is still moving', () => {
    expect(shareIsFollowing(open(T0), T0 + 30 * MIN)).toBe(true);
    expect(shareIsFollowing(open(T0), T0 + MAX_WINDOW_MS - 1)).toBe(true);
  });
  it('stops at the 24 hour cap', () => {
    expect(shareIsFollowing(open(T0), T0 + MAX_WINDOW_MS)).toBe(false);
    expect(shareIsFollowing(open(T0), T0 + MAX_WINDOW_MS + 5 * MIN)).toBe(false);
  });
  it('a closed share (a fixed window) never follows, whatever the clock says', () => {
    expect(shareIsFollowing(fixed(T0, T0 + 90 * MIN), T0 + 30 * MIN)).toBe(false);
    expect(shareIsFollowing(fixed(T0, T0 + 90 * MIN), T0 + 100 * MIN)).toBe(false);
  });
});

describe('where it is wired', () => {
  const src = (...p) => stripJs(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));

  it('the share page works the flag out from the row on every render and hands it to the review', () => {
    const page = src('web', 'app', 'share', 'raid', '[token]', 'page.tsx');
    expect(page).toMatch(/const follow = shareIsFollowing\(share\.row\);/);
    expect(page).toMatch(/<SessionReview [^>]*follow=\{follow\}/);
  });
  it('the review refreshes only a shared page, and only while the flag is on', () => {
    const review = src('web', 'app', 'raid', 'session', 'SessionReview.tsx');
    expect(review).toMatch(/const following = !!follow && mode\.kind === 'share';/);
    expect(review).toMatch(/useFollowRefresh\(\{ on: following,/);
  });
  it('the review notes a touch from a click, a key or the wheel anywhere on it', () => {
    const review = src('web', 'app', 'raid', 'session', 'SessionReview.tsx');
    expect(review).toMatch(/onPointerDownCapture=\{touched\} onKeyDownCapture=\{touched\} onWheelCapture=\{touched\}/);
  });
  it('the hook asks the rule before every refresh, skips a held one, and clears its timer', () => {
    const hook = src('web', 'app', 'raid', 'session', 'useFollowRefresh.ts');
    expect(hook).toMatch(/if \(!on\) return;/);
    const due = hook.indexOf('followDue(');
    const held = hook.indexOf('followHeld(');
    const refresh = hook.indexOf('router.refresh()');
    expect(due).toBeGreaterThan(-1);
    expect(held).toBeGreaterThan(due);
    expect(refresh).toBeGreaterThan(held);
    expect(hook).toMatch(/return \(\) => clearInterval\(id\);/);
  });
  it('the board takes the grown window in place, without resetting the playhead', () => {
    const board = src('web', 'app', 'spectator', 'replay', 'ReplayBoard.tsx');
    expect(board).toMatch(/setNights\(prev => \(prev && prev\.length === 1 && prev\[0\] === boundedNight \? prev : \[boundedNight\]\)\)/);
    // the reset keys on the window's start and the night, never on its end
    expect(board).toMatch(/\}, \[night\?\.night_key, night\?\.first\]\);/);
  });
  it('the members\' page never refreshes itself', () => {
    expect(src('web', 'app', 'raid', 'session', 'page.tsx')).not.toMatch(/follow/);
  });
});
