// test/screen-recap.test.js — the "Last kill" recap on /screen's Overview.
//
// The bot's /api/screen/live carries `recap: { boss, npcId, killedAt, lines, fun, stars } | null` for about
// half an hour after a raid-boss kill. The page must (1) keep a good one, (2) drop junk without throwing, (3) cap
// what it draws so one long line cannot fill a stream, (4) treat an older bot's missing key as "no recap", and
// (5) draw all three lists on the Overview. The normaliser is run for real; the render is checked on the
// comment-stripped source.
//
// Run: npx vitest run test/screen-recap.test.js

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { parseRecap, parseLive, RECAP_MAX_ITEMS, RECAP_MAX_LINE } from '../web/lib/screenLive.ts';

// screenLive.ts imports through the web alias; the same two mocks screen-live.test.js uses.
vi.mock('@/lib/raidScreen', async () => await import('../web/lib/raidScreen.ts'));
vi.mock('@/lib/spectator', async () => await import('../web/lib/spectator.ts'));

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const KILLED = '2026-10-13T01:30:00.000Z';
const good = () => ({ boss: 'Aldenmar the Test', npcId: 123456, killedAt: KILLED, lines: ['3:12 faster than last time'], fun: ['a wipe-free pull'], stars: ['top healer'] });

describe('parseRecap', () => {
  it('keeps a valid recap as it came', () => {
    expect(parseRecap(good())).toEqual(good());
  });

  it('absent or not an object is null (an older bot sends nothing)', () => {
    for (const bad of [undefined, null, 'recap', 7, [], [good()]]) expect(parseRecap(bad)).toBeNull();
  });

  it('needs a boss name and a real kill time', () => {
    expect(parseRecap({ ...good(), boss: '' })).toBeNull();
    expect(parseRecap({ ...good(), boss: '   ' })).toBeNull();
    expect(parseRecap({ ...good(), boss: 5 })).toBeNull();
    expect(parseRecap({ ...good(), killedAt: 'last night' })).toBeNull();
    expect(parseRecap({ ...good(), killedAt: undefined })).toBeNull();
  });

  it('drops non-strings and blanks from each list, and tolerates a list that is missing or not a list', () => {
    const r = parseRecap({ ...good(), lines: ['ok', 3, null, '  ', { a: 1 }, ['x'], ' trimmed '], fun: 'nope', stars: undefined });
    expect(r.lines).toEqual(['ok', 'trimmed']);
    expect(r.fun).toEqual([]);
    expect(r.stars).toEqual([]);
  });

  it('caps each list and each line', () => {
    const many = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const r = parseRecap({ ...good(), lines: many, fun: many, stars: [...many, 'x'.repeat(500)] });
    expect(r.lines).toHaveLength(RECAP_MAX_ITEMS);
    expect(r.lines).toEqual(many.slice(0, RECAP_MAX_ITEMS));
    expect(r.fun).toHaveLength(RECAP_MAX_ITEMS);
    const long = parseRecap({ ...good(), lines: ['x'.repeat(500)] });
    expect(long.lines[0]).toHaveLength(RECAP_MAX_LINE);
  });

  it('a bad npcId does not sink the recap', () => {
    expect(parseRecap({ ...good(), npcId: 'x' }).npcId).toBe(0);
  });
});

describe('parseLive carries the recap', () => {
  const base = () => ({ at: KILLED, positions: { rows: [], live: [], zones: [] }, state: null, auctions: null });
  it('an older bot (no recap key) gives null, and the rest still parses', () => {
    const p = parseLive(base());
    expect(p.recap).toBeNull();
    expect(p.positions).not.toBeNull();
  });
  it('a recap rides through, and junk in it does not fail the whole read', () => {
    expect(parseLive({ ...base(), recap: good() }).recap).toEqual(good());
    expect(parseLive({ ...base(), recap: { boss: 1 } })).not.toBeNull();
    expect(parseLive({ ...base(), recap: { boss: 1 } }).recap).toBeNull();
  });
});

describe('the Overview draws the recap', () => {
  const panels = stripJs(read('web/app/screen/ScreenPanels.tsx'));
  const board = stripJs(read('web/app/screen/ScreenBoard.tsx'));

  it('renders lines, stars and fun, in that order, each only when it has entries', () => {
    expect(panels).toMatch(/recap\.lines\.length > 0 &&/);
    expect(panels).toMatch(/recap\.stars\.length > 0 &&/);
    expect(panels).toMatch(/recap\.fun\.length > 0 &&/);
    expect(panels).toMatch(/recap\.lines\.map[\s\S]*recap\.stars\.map[\s\S]*recap\.fun\.map/);
  });
  it('heads the card with the boss and how long ago, on the page clock', () => {
    expect(panels).toMatch(/\{recap\.boss\}/);
    expect(panels).toMatch(/agoText\(recap\.killedAt, now\)/);
  });
  it('is the first thing in the Overview, and only there', () => {
    expect(panels).toMatch(/<div className="space-y-4">\s*\{recap && <RecapCard recap=\{recap\} now=\{now\} \/>\}/);
    expect(panels.match(/<RecapCard /g)).toHaveLength(1);
  });
  it('the board hands the live recap to the Overview', () => {
    expect(board).toMatch(/<OverviewView [^>]*recap=\{recap\}/);
  });
});
