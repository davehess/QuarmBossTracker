// test/window-kills.test.js — a session or a shared raid shows only its OWN kills, and an officer can move a share's
// start and end (the guild lead, 2026-10-23: the second of two back-to-back raids numbered the whole night's kills on its
// replay map, and a share's window had to be cut by hand in SQL).
//
//   1. KILLS    bossesInWindow keeps the bosses that died inside the window on screen; the chips and the numbers on the
//               path (rankKills / killMarks) are made from that list, so they count 1..N of THIS window.
//   2. SLACK    a session may trail two minutes past its last row, but never into the session after it.
//   3. OPENING  a window that starts before its first recorded minute opens on that minute.
//   4. PLAN     planShareWindow: the start moves, the end follows the table's rules, an open share stays open.
//   5. STALE    what can keep an old window: the lookup memo (60 s, cleared by invalidateShare), nothing else once the
//               timeline memo and the cached replay slice are keyed on the window.
//   6. SOURCE   the board draws only the window's bosses, the members' board asks a window-bounded route, the PATCH
//               route writes both columns behind the same gate and drops both caches.
//
// Source assertions run on comment-stripped text (stripJs): the comments here explain the behaviour under test.
//
// Run: npx vitest run test/window-kills.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { MINUTE_MS, openingPlayhead, summarizeNights, trailSlackMs } from '../web/lib/raidReplay.ts';
import { bossesInWindow } from '../web/lib/replayBosses.ts';
import { rankKills, killMarks } from '../web/lib/replayPath.ts';
import {
  planShareWindow, isOpenShare, openWindow, makeWindow, newToken, MAX_WINDOW_MS, OPEN_SPAN_MS, MAX_END_AHEAD_MS,
} from '../web/lib/raidShare.ts';
import { resolveShare, invalidateShare, clearShareMemo } from '../web/lib/raidShareLookup.ts';

const read = (...p) => stripJs(fs.readFileSync(path.join(ROOT, ...p), 'utf8'));
const iso = (ms) => new Date(ms).toISOString();
const HOUR = 60 * MINUTE_MS;

// A night: the first raid 22:00–23:55 UTC (Oct 22), then a second one 23:56 UTC – 02:05 UTC (the report's two raids).
const SPLIT = Date.parse('2026-10-23T03:56:00.000Z');
const END = Date.parse('2026-10-23T06:05:00.000Z');
const boss = (name, at) => ({ npc_id: at / MINUTE_MS % 1000, name, from: at - 5 * MINUTE_MS, to: at, points: [{ zone: 'z', x: 0, y: 0, z: 0 }] });
const NIGHT = [
  boss('Early One', SPLIT - 6 * HOUR),
  boss('Early Two', SPLIT - 3 * HOUR),
  boss('Early Three', SPLIT - 10 * MINUTE_MS),
  boss('Mine A', SPLIT + 30 * MINUTE_MS),
  boss('Mine B', SPLIT + 90 * MINUTE_MS),
];

describe('bossesInWindow', () => {
  it('keeps only the kills that died inside the window, the Kills tab\'s rule (ended_at in [from, to))', () => {
    expect(bossesInWindow(NIGHT, SPLIT, END).map(b => b.name)).toEqual(['Mine A', 'Mine B']);
  });
  it('the start is inclusive and the end is exclusive', () => {
    const edge = [boss('At start', SPLIT), boss('At end', END), boss('Just before', SPLIT - 1)];
    expect(bossesInWindow(edge, SPLIT, END).map(b => b.name)).toEqual(['At start']);
  });
  it('numbers the chips from 1 in THIS window, not along the whole night', () => {
    const chips = rankKills(bossesInWindow(NIGHT, SPLIT, END));
    expect(chips.map(k => [k.n, k.name])).toEqual([[1, 'Mine A'], [2, 'Mine B']]);
    // the same list unbounded is the report: the first raid's kills come first and the second raid starts at 4
    expect(rankKills(NIGHT).map(k => k.n + ' ' + k.name)).toContain('4 Mine A');
  });
  it('the numbers on the path come from the bounded list too', () => {
    const series = [];
    for (let t = SPLIT; t < END; t += 3000) series.push({ t, x: (t - SPLIT) / 1000, y: 0, z: 0, n: 20 });
    const kills = (list) => list.map(b => ({ name: b.name, to: b.to, zones: ['z'] }));
    const bounded = killMarks(kills(bossesInWindow(NIGHT, SPLIT, END)), series, 'z', END);
    expect(bounded.map(m => [m.n, m.name])).toEqual([[1, 'Mine A'], [2, 'Mine B']]);
    // the unbounded list would have numbered them 4 and 5 (the first raid's three kills take 1..3)
    expect(killMarks(kills(NIGHT), series, 'z', END).map(m => m.n)).toEqual([4, 5]);
  });
  it('a window with none of the night\'s kills in it has no chips at all', () => {
    expect(bossesInWindow(NIGHT, SPLIT - 2 * HOUR, SPLIT - HOUR)).toEqual([]);
    expect(bossesInWindow([], SPLIT, END)).toEqual([]);
  });
});

describe('the two minutes a session\'s last row can trail', () => {
  it('are allowed when nothing follows', () => {
    expect(trailSlackMs(END, null)).toBe(2 * MINUTE_MS);
    const trailing = [boss('Trailing', END + MINUTE_MS), boss('Late', END + 3 * MINUTE_MS)];
    expect(bossesInWindow(trailing, SPLIT, END, trailSlackMs(END, null)).map(b => b.name)).toEqual(['Trailing']);
  });
  it('stop where the next session begins (a raid change cuts one session off where the next starts)', () => {
    expect(trailSlackMs(SPLIT, SPLIT)).toBe(0);
    expect(trailSlackMs(SPLIT, SPLIT + MINUTE_MS)).toBe(MINUTE_MS);
    expect(trailSlackMs(SPLIT, SPLIT + HOUR)).toBe(2 * MINUTE_MS);
    const firstRaid = [boss('Last of the first', SPLIT - MINUTE_MS), boss('First of the second', SPLIT + MINUTE_MS)];
    expect(bossesInWindow(firstRaid, SPLIT - 2 * HOUR, SPLIT, trailSlackMs(SPLIT, SPLIT)).map(b => b.name)).toEqual(['Last of the first']);
    expect(bossesInWindow(firstRaid, SPLIT, END, trailSlackMs(END, null)).map(b => b.name)).toEqual(['First of the second']);
  });
  it('are what the session list gives: a cut session\'s next start is the cut', () => {
    // a continuous recording 40 minutes long cut at minute 20: the first session ends where the second begins
    const rows = Array.from({ length: 40 }, (_, i) => ({ night_key: '10/22/2026', minute_at: iso(SPLIT + i * MINUTE_MS), zones: ['z'], raiders: 20 }));
    const [night] = summarizeNights(rows, [SPLIT + 20 * MINUTE_MS]);
    expect(night.sessions.length).toBe(2);
    const [a, b] = night.sessions;
    expect(trailSlackMs(a.to, b.from)).toBe(0);
  });
});

describe('where a window opens', () => {
  const spans = [{ from: SPLIT + 3 * MINUTE_MS, to: SPLIT + 60 * MINUTE_MS }];
  it('on its first recorded minute when the recording begins after the window does', () => {
    expect(openingPlayhead(spans, SPLIT)).toBe(SPLIT + 3 * MINUTE_MS);
  });
  it('on the window start when that minute is recorded, or when nothing is', () => {
    expect(openingPlayhead(spans, SPLIT + 10 * MINUTE_MS)).toBe(SPLIT + 10 * MINUTE_MS);
    expect(openingPlayhead([], SPLIT)).toBe(SPLIT);
    expect(openingPlayhead(spans, SPLIT + 2 * HOUR)).toBe(SPLIT + 2 * HOUR);
  });
});

describe('planShareWindow', () => {
  const FROM = Date.parse('2026-10-22T23:00:00.000Z');
  const NOW = FROM + 8 * HOUR;
  const fixed = { from_at: iso(FROM), to_at: iso(FROM + 7 * HOUR) };
  const open = { from_at: iso(FROM), to_at: iso(FROM + OPEN_SPAN_MS) };
  const NEW = FROM + 4 * HOUR + 56 * MINUTE_MS;   // the split

  it('moves the start and keeps a fixed share\'s end', () => {
    expect(planShareWindow(fixed, { from: iso(NEW) }, NOW)).toEqual({ from_at: iso(NEW), to_at: fixed.to_at });
  });
  it('rounds the start down to the minute', () => {
    expect(planShareWindow(fixed, { from: iso(NEW + 41_000) }, NOW)).toEqual({ from_at: iso(NEW), to_at: fixed.to_at });
  });
  it('moves the start and the end together', () => {
    const to = FROM + 9 * HOUR;
    expect(planShareWindow(fixed, { from: iso(NEW), to: iso(to) }, NOW)).toEqual({ from_at: iso(NEW), to_at: iso(to) });
  });
  it('an open share keeps its shape: the end is the marker from the NEW start', () => {
    const r = planShareWindow(open, { from: iso(NEW) }, NOW);
    expect(r).toEqual({ from_at: iso(NEW), to_at: iso(NEW + OPEN_SPAN_MS) });
    expect(isOpenShare(r)).toBe(true);
    expect(r.to_at).toBe(iso(openWindow(NEW).toMs));
  });
  it('an open share given an end becomes fixed, and open:true on a fixed one makes it follow from the new start', () => {
    const closed = planShareWindow(open, { from: iso(NEW), to: iso(FROM + 9 * HOUR) }, NOW);
    expect(isOpenShare(closed)).toBe(false);
    const followed = planShareWindow(fixed, { from: iso(NEW), open: true }, NOW);
    expect(followed).toEqual({ from_at: iso(NEW), to_at: iso(NEW + OPEN_SPAN_MS) });
  });
  it('is validated by the table\'s own check: the end after the start, the whole window within 24 h', () => {
    expect(planShareWindow(fixed, { from: iso(FROM + 7 * HOUR) }, NOW)).toHaveProperty('error');          // start at the end
    expect(planShareWindow(fixed, { from: iso(FROM + 8 * HOUR) }, NOW)).toHaveProperty('error');          // start past the end
    expect(planShareWindow(fixed, { from: iso(FROM - 18 * HOUR) }, NOW)).toHaveProperty('error');         // 25 h long
    expect(planShareWindow(fixed, { from: iso(FROM - 17 * HOUR) }, NOW)).toEqual({ from_at: iso(FROM - 17 * HOUR), to_at: fixed.to_at });   // exactly 24 h
    expect(planShareWindow(fixed, { from: iso(FROM), to: iso(FROM + MAX_WINDOW_MS + MINUTE_MS) }, FROM + 30 * HOUR)).toHaveProperty('error');
    // every window it accepts is one the table accepts: to > from and to - from <= 24 h
    for (const f of [-17, -10, 0, 3, 6]) {
      const r = planShareWindow(fixed, { from: iso(FROM + f * HOUR) }, NOW);
      if ('error' in r) continue;
      expect(Date.parse(r.to_at)).toBeGreaterThan(Date.parse(r.from_at));
      expect(Date.parse(r.to_at) - Date.parse(r.from_at)).toBeLessThanOrEqual(MAX_WINDOW_MS);
    }
  });
  it('refuses a start more than 12 h ahead of now, and junk', () => {
    expect(planShareWindow(fixed, { from: iso(NOW + MAX_END_AHEAD_MS + MINUTE_MS) }, NOW)).toHaveProperty('error');
    for (const from of ['nope', 42, {}, [], true]) expect(planShareWindow(fixed, { from }, NOW)).toHaveProperty('error');
    expect(planShareWindow(fixed, {}, NOW)).toHaveProperty('error');
    expect(planShareWindow(fixed, { from: null, to: null }, NOW)).toHaveProperty('error');
    expect(planShareWindow({ from_at: 'x', to_at: 'y' }, { from: iso(NEW) }, NOW)).toHaveProperty('error');
  });
  it('without a start it is the old end change, and leaves the start alone', () => {
    const to = FROM + 9 * HOUR;
    expect(planShareWindow(fixed, { to: iso(to) }, NOW)).toEqual({ from_at: fixed.from_at, to_at: iso(to) });
    expect(planShareWindow(fixed, { open: true }, NOW)).toEqual({ from_at: fixed.from_at, to_at: open.to_at });
    expect(makeWindow(FROM, to).toMs).toBe(to);
  });
});

describe('what can keep a share\'s old window', () => {
  const token = newToken();
  const row = (from) => ({
    id: 'id-w', guild_id: 'wolfpack', from_at: iso(from), to_at: iso(from + 3 * HOUR), title: 't',
    created_at: '2026-10-15T00:00:00Z', expires_at: '2026-12-01T00:00:00Z', revoked_at: null, view_count: 0,
  });
  const db = (r) => ({ from: () => { const b = { select: () => b, eq: () => b, maybeSingle: () => Promise.resolve({ data: r, error: null }) }; return b; } });
  const T0 = Date.parse('2026-10-23T07:00:00Z');
  const OLD = Date.parse('2026-10-23T01:00:00Z');
  beforeEach(() => clearShareMemo());

  it('a hand edit of the row is seen after the 60 s lookup memo, and at once after invalidateShare', async () => {
    expect((await resolveShare(db(row(OLD)), token, T0)).win.fromMs).toBe(OLD);
    // edited in SQL: this process still holds the old row for up to 60 s
    expect((await resolveShare(db(row(SPLIT)), token, T0 + 59_000)).win.fromMs).toBe(OLD);
    expect((await resolveShare(db(row(SPLIT)), token, T0 + 61_000)).win.fromMs).toBe(SPLIT);
    // an officer's change calls invalidateShare: the next request reads the row
    clearShareMemo();
    await resolveShare(db(row(OLD)), token, T0);
    invalidateShare('id-w');
    expect((await resolveShare(db(row(SPLIT)), token, T0 + 1000)).win.fromMs).toBe(SPLIT);
  });
});

describe('source', () => {
  const board = read('web/app/spectator/replay/ReplayBoard.tsx');
  const patchSrc = read('web/app/api/raid/shares/[id]/route.ts');
  const patchBody = patchSrc.slice(patchSrc.indexOf('export async function PATCH'), patchSrc.indexOf('export async function DELETE'));

  it('the board draws the window\'s bosses only: chips, path marks, spawn rings and the timeline strip', () => {
    expect(board).toMatch(/bossesInWindow\(allBosses, from, to, /);
    expect(board).toMatch(/rankKills\(sessionKills\.map/);
    expect(board).toMatch(/bossesRef\.current = bosses;/);
    expect(board).toMatch(/killsRef\.current = bosses\.map/);
    expect(board).toMatch(/<RaidTimeline kills=\{sessionKills\} nowMs=\{uiT\}/);
    // the whole-night list is never handed to the drawing as it came
    expect(board).not.toMatch(/bossesRef\.current = parseBosses/);
    expect(board).not.toMatch(/bossesRef\.current = allBosses/);
    expect(board).not.toMatch(/rankKills\(killList/);
  });
  it('a bounded board slices the window to an exact end, a session adds only the trailing slack that is its own', () => {
    expect(board).toMatch(/chosen\?\.session \? trailSlackMs\(to, nextSessionFrom\) : 0/);
  });
  it('a bounded board asks its caller\'s boss address again when the window changes, not only the night', () => {
    expect(board).toMatch(/\}, \[bossUrl\]\);/);
  });
  it('the board opens on the first recorded minute', () => {
    expect(board).toMatch(/tRef\.current = openingPlayhead\(night\.spans, Date\.parse\(night\.first\)\)/);
  });

  it('the members\' review reads its bosses from a route that takes the page\'s window, not the night', () => {
    const view = read('web/app/raid/session/SessionReview.tsx');
    expect(view).toMatch(/bosses: \(\) => `\/api\/raid\/session\/bosses\?\$\{session\}`/);
    expect(view).not.toMatch(/\/api\/spectator\/replay\/bosses/);
    const route = read('web/app/api/raid/session/bosses/route.ts');
    expect(route).toMatch(/auth\.getUser\(\)/);
    expect(route).toMatch(/makeWindow\(/);
    expect(route).toMatch(/loadSpawnBosses\(supabaseAdmin\(\), from, to\)\)\.filter\(b => inWindow\(win, b\.to\)\)/);
  });
  it('the share\'s browser-cached reads carry the window as a cache-buster, which the routes never read', () => {
    const view = read('web/app/raid/session/SessionReview.tsx');
    expect(view).toMatch(/const v = `v=\$\{baseMs\}\.\$\{toMs\}`/);
    for (const r of ['replay', 'bosses']) {
      expect(read('web', 'app', 'api', 'share', 'raid', '[token]', r, 'route.ts')).not.toMatch(/searchParams\.get\('v'\)/);
    }
  });
  it('the timeline memo and the cached replay slice are keyed on the window, so a move is never answered from the old one', () => {
    const timeline = read('web/app/api/share/raid/[token]/timeline/route.ts');
    expect(timeline).toMatch(/`\$\{share\.row\.id\}\|\$\{share\.row\.from_at\}\|\$\{share\.row\.to_at\}`/);
    expect(timeline).not.toMatch(/memo\.get\(share\.row\.id\)/);
    expect(read('web/app/api/share/raid/[token]/replay/route.ts')).toMatch(/String\(slice\.toMs\), String\(win\.fromMs\), String\(win\.toMs\)/);
    expect(read('web/app/api/share/raid/[token]/bosses/route.ts')).toMatch(/String\(win\.fromMs\), String\(win\.toMs\)/);
  });

  it('PATCH takes a start: the same gate, validated by planShareWindow before the write, both columns, both caches', () => {
    expect(patchBody.indexOf('gate(req')).toBeGreaterThan(-1);
    expect(patchBody.indexOf('planShareWindow(')).toBeGreaterThan(-1);
    expect(patchBody.indexOf('planShareWindow(')).toBeLessThan(patchBody.indexOf('.update('));
    expect(patchBody).toMatch(/\.update\(\{ from_at: plan\.from_at, to_at: plan\.to_at \}\)/);
    expect(patchBody).toMatch(/\.eq\('guild_id', GUILD_TAG\)/);
    expect(patchBody).toMatch(/\.is\('revoked_at', null\)/);
    expect(patchBody).toMatch(/invalidateShare\(params\.id\)/);
    expect(patchBody).toMatch(/revalidateTag\(shareTag\(params\.id\)\)/);
    expect(patchBody).not.toMatch(/token_hash/);
  });
  it('the officer\'s list offers a start change and "start at the split" when the page has a suggestion', () => {
    const ctl = read('web/app/raid/session/ShareControls.tsx');
    expect(ctl).toMatch(/onChange\(\{ from: new Date\(startVal\)\.toISOString\(\) \}\)/);
    expect(ctl).toMatch(/Start this share at the split/);
    expect(ctl).toMatch(/\{splitInside && \(/);
    const page = read('web/app/raid/session/page.tsx');
    expect(page).toMatch(/splitAtMs=\{review\.change\?\.atMs \?\? null\}/);
  });
});
