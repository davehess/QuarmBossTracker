// test/replay-live.test.js — /spectator/replay follows a raid that is still being recorded.
//
// The guild lead, 2026-10-17: "spectator should continuously pull fresh raid days so it can be used live data".
// The pure rules live in web/lib/raidReplay.ts (mergeNights, newNightToFollow, growSession, windowNeedsRefetch,
// liveAvailable, livePlayhead, liveLagging); the board's wiring is checked as source text with comments stripped
// (CLAUDE.md: a comment can answer for the code). Corpora sit on both sides of every threshold so a rule that was
// never applied cannot pass. Names, where any, are invented.
//
// Run: npx vitest run test/replay-live.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  MINUTE_MS, REPLAY_WINDOW_MS, SESSION_GAP_MS, TAIL_REFRESH_MS, STALE_RETRY_MS, LIVE_WITHIN_MS, LIVE_LAG_MS, LIVE_MAX_LAG_MS,
  summarizeNights, mergeNights, newestSession, newNightToFollow, growSession, windowTarget, windowNeedsRefetch,
  liveAvailable, livePlayhead, liveLagging,
} from '../web/lib/raidReplay.ts';
import { ROOT, stripJs } from './_source-slice.js';

const Z = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
const KEY = '10/16/2026';
const rows = (key, start, n, zones = ['nexus']) =>
  Array.from({ length: n }, (_, i) => ({ night_key: key, minute_at: new Date(start + i * MINUTE_MS).toISOString(), zones, raiders: 20 }));
const t0 = Z(2026, 10, 17, 0, 0);   // 8 pm ET on the 16th, inside the guild raid window

// ── the night list merge ─────────────────────────────────────────────────────

describe('mergeNights', () => {
  it('a night that grew keeps its key and its session start, and takes the later last minute', () => {
    const prev = summarizeNights(rows(KEY, t0, 10));
    const fresh = summarizeNights(rows(KEY, t0, 13));
    const out = mergeNights(prev, fresh);
    expect(out).toHaveLength(1);
    expect(out).not.toBe(prev);
    // these two are what the board's reset effect keys on: they must not move when a night merely grows
    expect(out[0].night_key).toBe(prev[0].night_key);
    expect(out[0].sessions[0].from).toBe(prev[0].sessions[0].from);
    expect(out[0].first).toBe(prev[0].first);
    // ... and what the slider and the stale-tail rule read must move
    expect(Date.parse(out[0].last)).toBe(t0 + 12 * MINUTE_MS);
    expect(out[0].sessions[0].to).toBe(t0 + 13 * MINUTE_MS);
    expect(out[0].minutes).toBe(13);
  });

  it('returns the very same list when the poll learned nothing, so nothing re-renders or resets', () => {
    const prev = summarizeNights(rows(KEY, t0, 10));
    const same = summarizeNights(rows(KEY, t0, 10));
    expect(mergeNights(prev, same)).toBe(prev);
    expect(mergeNights(prev, [])).toBe(prev);
  });

  it('adds a brand-new night at the top and keeps the older ones', () => {
    const old = summarizeNights(rows('10/14/2026', t0 - 2 * 86_400_000, 30));
    const prev = mergeNights(null, [...summarizeNights(rows(KEY, t0, 10)), ...old]);
    const fresh = summarizeNights(rows('10/17/2026', t0 + 24 * 3_600_000, 3));
    const out = mergeNights(prev, fresh);
    expect(out.map(n => n.night_key)).toEqual(['10/17/2026', KEY, '10/14/2026']);
    expect(out[1]).toBe(prev[0]);   // the untouched nights are the same objects
  });

  it('keeps a night the fresh list does not carry (the poll asks for the last two days only)', () => {
    const prev = [...summarizeNights(rows(KEY, t0, 10)), ...summarizeNights(rows('10/01/2026', t0 - 15 * 86_400_000, 30))];
    const out = mergeNights(prev, summarizeNights(rows(KEY, t0, 11)));
    expect(out.map(n => n.night_key).sort()).toEqual(['10/01/2026', KEY]);
  });

  it('ignores a summary that starts later than the known one: a night the poll cut short at its edge', () => {
    const prev = summarizeNights(rows(KEY, t0, 60));
    const cut = summarizeNights(rows(KEY, t0 + 40 * MINUTE_MS, 20));   // only the tail of the night came back
    expect(mergeNights(prev, cut)).toBe(prev);
  });

  it('with no list yet, the fresh one is the list', () => {
    const fresh = summarizeNights(rows(KEY, t0, 5));
    expect(mergeNights(null, fresh)).toBe(fresh);
  });
});

describe('newNightToFollow', () => {
  const prev = summarizeNights(rows(KEY, t0, 10));
  const next = mergeNights(prev, summarizeNights(rows('10/17/2026', t0 + 24 * 3_600_000, 2)));
  it('moves a Live viewer on the previous newest night to the new one', () => {
    expect(newNightToFollow(prev, next, KEY, true)?.night_key).toBe('10/17/2026');
  });
  it('does not move a viewer who is not Live', () => {
    expect(newNightToFollow(prev, next, KEY, false)).toBeNull();
  });
  it('does not move a viewer who is on an older night', () => {
    expect(newNightToFollow(prev, next, '10/14/2026', true)).toBeNull();
    expect(newNightToFollow(prev, next, null, true)).toBeNull();
  });
  it('does not move anyone when the newest night was already known', () => {
    expect(newNightToFollow(next, next, '10/17/2026', true)).toBeNull();
    expect(newNightToFollow(prev, mergeNights(prev, summarizeNights(rows(KEY, t0, 12))), KEY, true)).toBeNull();
  });
  it('newestSession is the last session of the newest night', () => {
    const two = summarizeNights([...rows(KEY, t0, 5), ...rows(KEY, t0 + 60 * MINUTE_MS, 5)]);
    expect(newestSession(two)?.from).toBe(t0 + 60 * MINUTE_MS);
    expect(newestSession([])).toBeNull();
  });
});

// ── the live tail: a session grown by a minute the list has not caught up with ──

describe('growSession', () => {
  const s = summarizeNights(rows(KEY, t0, 10))[0].sessions[0];
  const end = s.to;
  it('moves `to` out and stretches the last span', () => {
    const g = growSession(s, end);
    expect(g.to).toBe(end + MINUTE_MS);
    expect(g.from).toBe(s.from);
    expect(g.minutes).toBe(s.minutes + 1);
    expect(g.spans).toHaveLength(1);
    expect(g.spans[0].to).toBe(end + MINUTE_MS);
    expect(s.spans[0].to).toBe(end);   // the input is not touched
  });
  it('leaves the session alone for a minute it already holds, or null', () => {
    expect(growSession(s, null)).toBe(s);
    expect(growSession(s, end - MINUTE_MS)).toBe(s);
  });
  it('a minute exactly SESSION_GAP_MS past the end still belongs to it; one more minute is another session', () => {
    expect(growSession(s, end + SESSION_GAP_MS).to).toBe(end + SESSION_GAP_MS + MINUTE_MS);
    expect(growSession(s, end + SESSION_GAP_MS + MINUTE_MS)).toBe(s);
  });
  it('a minute past a break opens a new span instead of stretching the last', () => {
    const g = growSession(s, end + 5 * MINUTE_MS);
    expect(g.spans).toHaveLength(2);
    expect(g.spans[1]).toEqual({ from: end + 5 * MINUTE_MS, to: end + 6 * MINUTE_MS });
  });
});

// ── the stale tail ───────────────────────────────────────────────────────────

describe('windowNeedsRefetch', () => {
  const from = t0;
  const now = t0 + 3_600_000;
  const longAgo = now - 60_000;
  it('windowTarget is a full window, or the night end when that comes first', () => {
    expect(windowTarget(from, from + 5 * MINUTE_MS)).toBe(from + 5 * MINUTE_MS);
    expect(windowTarget(from, from + 40 * MINUTE_MS)).toBe(from + REPLAY_WINDOW_MS);
  });
  it('a window loaded short is stale once the night grows past it', () => {
    const loadedTo = from + 5 * MINUTE_MS;
    expect(windowNeedsRefetch(loadedTo, longAgo, from, from + 6 * MINUTE_MS, now, false)).toBe(true);
    expect(windowNeedsRefetch(loadedTo, longAgo, from, from + 5 * MINUTE_MS, now, false)).toBe(false);
  });
  it('a full window is never stale, even as the night keeps growing', () => {
    expect(windowNeedsRefetch(from + REPLAY_WINDOW_MS, longAgo, from, from + 90 * MINUTE_MS, now, false)).toBe(false);
    expect(windowNeedsRefetch(from + REPLAY_WINDOW_MS, longAgo, from, from + 90 * MINUTE_MS, now, true)).toBe(false);
  });
  it('a stale refetch is not repeated faster than STALE_RETRY_MS', () => {
    const loadedTo = from + 5 * MINUTE_MS;
    const end = from + 6 * MINUTE_MS;
    expect(windowNeedsRefetch(loadedTo, now - STALE_RETRY_MS + 1, from, end, now, false)).toBe(false);
    expect(windowNeedsRefetch(loadedTo, now - STALE_RETRY_MS, from, end, now, false)).toBe(true);
  });
  it('while Live the tail window is asked again every TAIL_REFRESH_MS even if the night did not grow', () => {
    const end = from + 5 * MINUTE_MS;
    expect(windowNeedsRefetch(end, now - TAIL_REFRESH_MS + 1, from, end, now, true)).toBe(false);
    expect(windowNeedsRefetch(end, now - TAIL_REFRESH_MS, from, end, now, true)).toBe(true);
    // not Live: a current tail window is left alone
    expect(windowNeedsRefetch(end, longAgo, from, end, now, false)).toBe(false);
  });
  it('Live waits TAIL_REFRESH_MS before a stale refetch too: the API serves the tail for 15 s', () => {
    expect(windowNeedsRefetch(from + MINUTE_MS, now - 5_000, from, from + 2 * MINUTE_MS, now, true)).toBe(false);
  });
});

// ── Live ─────────────────────────────────────────────────────────────────────

describe('Live availability and playhead', () => {
  const end = t0 + 90 * MINUTE_MS;
  it('is on offer while the session ended within 10 minutes, and not after', () => {
    expect(liveAvailable(end, end)).toBe(true);
    expect(liveAvailable(end, end + LIVE_WITHIN_MS)).toBe(true);
    expect(liveAvailable(end, end + LIVE_WITHIN_MS + 1)).toBe(false);
    expect(liveAvailable(end, end + 3 * 3_600_000)).toBe(false);
  });
  it('a session whose end is ahead of this clock (skew) still counts as in progress', () => {
    expect(liveAvailable(end + 2 * MINUTE_MS, end)).toBe(true);
  });
  it('the playhead sits LIVE_LAG_MS before the end, never before the start', () => {
    expect(livePlayhead(t0, end)).toBe(end - LIVE_LAG_MS);
    expect(livePlayhead(end - 10_000, end)).toBe(end - 10_000);
    expect(livePlayhead(end - LIVE_LAG_MS, end)).toBe(end - LIVE_LAG_MS);
  });
  it('a playhead further than LIVE_MAX_LAG_MS behind the end has lagged; at the limit it has not', () => {
    expect(liveLagging(end - LIVE_MAX_LAG_MS, end)).toBe(false);
    expect(liveLagging(end - LIVE_MAX_LAG_MS - 1, end)).toBe(true);
    expect(liveLagging(end - 1, end)).toBe(false);
  });
});

// ── the board's wiring (comments stripped before matching) ───────────────────

describe('wiring', () => {
  const read = (rel) => stripJs(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const board = read('web/app/spectator/replay/ReplayBoard.tsx');
  const route = read('web/app/api/spectator/replay/route.ts');

  it('the night reset effect depends on night_key and the session start, never on the night object', () => {
    const m = board.match(/gen\.current\+\+;[\s\S]*?\}, \[([^\]]*)\]\);/);
    expect(m).not.toBeNull();
    const deps = m[1].split(',').map(s => s.trim());
    expect(deps).toContain('night?.night_key');
    expect(deps).toContain('night?.first');
    for (const bad of ['night', 'chosen', 'nights']) expect(deps).not.toContain(bad);
  });

  it('the in-place effect follows the night object, and does not reset anything', () => {
    const m = board.match(/useEffect\(\(\) => \{\s*nightRef\.current = night;\s*schedule\(\);[\s\S]*?\}, \[night, schedule\]\);/);
    expect(m).not.toBeNull();
    expect(m[0]).not.toMatch(/gen\.current|winFrames|wins\.current\.clear/);
  });

  it('the night list is asked again on an interval that skips a hidden page, and at once when it is shown again', () => {
    expect(board).toMatch(/setInterval\(\(\) => \{ if \(!document\.hidden\) pull\(\); \}, NIGHTS_POLL_MS\)/);
    expect(board).toMatch(/addEventListener\('visibilitychange', onVisible\)/);
    expect(board).toMatch(/const onVisible = \(\) => \{ if \(!document\.hidden\) \{ pull\(\);/);
    expect(board).toMatch(/removeEventListener\('visibilitychange', onVisible\)/);
  });

  it('the poll runs only outside bounded mode, and the first pull is the whole list', () => {
    const m = board.match(/useEffect\(\(\) => \{\s*if \(urlsRef\.current\) return;[^\n]*\n\s*let dead = false;[\s\S]*?NIGHTS_POLL_MS/);
    expect(m).not.toBeNull();
    expect(board).toMatch(/'\/api\/spectator\/replay\?nights=1' \+ \(first \? '' : '&recent=1'\)/);
  });

  it('Live is never offered in bounded mode, and a scrub or a pause turns it off', () => {
    expect(board).toMatch(/const liveOn = !bounded && liveAvailable\(end, nowMs\)/);
    const seek = board.match(/const seek = useCallback\([\s\S]*?\}, \[schedule, setLiveOff\]\);/);
    expect(seek?.[0]).toMatch(/setLiveOff\(\)/);
    const toggle = board.match(/const togglePlay = useCallback\([\s\S]*?\}, \[schedule, setLiveOff\]\);/);
    expect(toggle?.[0]).toMatch(/if \(!p\) setLiveOff\(\)/);
  });

  it('a Live viewer is moved to a new night only through newNightToFollow', () => {
    expect(board).toMatch(/newNightToFollow\(prev, next, viewKeyRef\.current, liveRef\.current\)/);
  });

  it('the board holds the night and session on screen, so a new night does not carry the viewer off', () => {
    expect(board).toMatch(/if \(nightKey == null\) setNightKey\(chosen\.night\.night_key\)/);
    expect(board).toMatch(/if \(sessionFrom == null && chosen\.session\) setSessionFrom\(chosen\.session\.from\)/);
  });

  it('the page opens in Live only when the URL named no session', () => {
    expect(board).toMatch(/urlSessionRef\.current == null \? newestSession\(nights\) : null/);
  });

  it('a window is asked for again when it is stale, through windowNeedsRefetch', () => {
    expect(board).toMatch(/windowNeedsRefetch\(have\.to, have\.at, from, end, now, following\)/);
  });

  it('the night-list route has the recent mode, and the 60 s cache the poll relies on', () => {
    expect(route).toMatch(/q\.get\('recent'\) === '1'/);
    expect(route).toMatch(/private, max-age=60/);
    expect(route).toMatch(/private, max-age=15/);
  });
});
