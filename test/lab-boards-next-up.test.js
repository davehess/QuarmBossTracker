// test/lab-boards-next-up.test.js — the spawn-boards draft: pure view helpers, fixture spread, staging.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import {
  toNextUpBosses, sortNextUp, splitNextUp, summarize, matchesQuery, fmtWindow, groupExpansions, SOON_MS,
} from '../web/lib/boardsNextUpView.ts';
import { LAB_ROWS, LAB_NOW, LAB_EXPANSIONS } from '../web/lib/lab/fixtures/boards-next-up.ts';
import { draft } from '../web/lib/lab/drafts/boards-next-up.ts';

const NOW = 1_000_000_000_000;
const iso = (min) => new Date(NOW + min * 60000).toISOString();
const row = (id, min, extra = {}) => ({ boss_id: id, name: id, zone: 'Z', expansion: 'Classic', timer_hours: 72, pqdi_url: null, next_spawn: min === null ? null : iso(min), ...extra });

describe('toNextUpBosses', () => {
  it('handles empty, null and undefined input', () => {
    expect(toNextUpBosses([])).toEqual([]);
    expect(toNextUpBosses(null)).toEqual([]);
    expect(toNextUpBosses(undefined)).toEqual([]);
  });
  it('treats a missing or unparsable time as up now, and fills missing names', () => {
    const [a, b] = toNextUpBosses([row('a', null, { name: null, zone: null, expansion: null, timer_hours: null }), row('b', 0, { next_spawn: 'junk' })]);
    expect(a).toMatchObject({ name: 'a', zone: 'Unknown zone', expansion: 'Unknown', opensAtMs: null, timerHours: null });
    expect(b.opensAtMs).toBeNull();
  });
  it('skips a row with no id', () => {
    expect(toNextUpBosses([row('', 5)])).toEqual([]);
  });
});

describe('sorting and counts', () => {
  const bosses = toNextUpBosses([row('far', 3000), row('soon', 12), row('upB', -5), row('upA', null), row('mid', 400)]);
  it('puts running timers first, soonest first, then available bosses by name', () => {
    expect(sortNextUp(bosses, NOW).map((b) => b.id)).toEqual(['soon', 'mid', 'far', 'upA', 'upB']);
  });
  it('with 250 available and 9 timers the first row is the soonest timer', () => {
    const rows = [];
    for (let i = 0; i < 250; i++) rows.push(row('a' + String(i).padStart(3, '0'), i % 2 ? null : -i));
    for (let i = 0; i < 9; i++) rows.push(row('t' + i, 600 - i * 50));
    const all = toNextUpBosses(rows);
    const { timers, available } = splitNextUp(all, NOW);
    expect(timers).toHaveLength(9);
    expect(available).toHaveLength(250);
    expect(sortNextUp(all, NOW)[0].id).toBe('t8');
    expect(sortNextUp(all, NOW)[9].id).toBe('a000');
  });
  it('sorts names with a pinned locale, not the machine default', () => {
    const src = stripJs(fs.readFileSync(path.join(ROOT, 'web/lib/boardsNextUpView.ts'), 'utf8')) +
      stripJs(fs.readFileSync(path.join(ROOT, 'web/components/lab/boards-next-up/BossTable.tsx'), 'utf8'));
    const calls = src.match(/localeCompare\([^)]*\)/g);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.every((c) => /, 'en'\)$/.test(c))).toBe(true);
  });
  it('does not mutate its input', () => {
    const before = bosses.map((b) => b.id).join();
    sortNextUp(bosses, NOW);
    expect(bosses.map((b) => b.id).join()).toBe(before);
  });
  it('counts up, soon (under 30 minutes) and total', () => {
    expect(summarize(bosses, NOW)).toEqual({ total: 5, up: 2, soon: 1 });
    expect(summarize(toNextUpBosses([row('x', SOON_MS / 60000)]), NOW).soon).toBe(0);
    expect(summarize([], NOW)).toEqual({ total: 0, up: 0, soon: 0 });
  });
});

describe('filter, window, grouping', () => {
  it('matches boss or zone, ignoring case, empty matches all', () => {
    const [b] = toNextUpBosses([row('Lord Vox', 5, { zone: 'Permafrost Keep' })]);
    expect([matchesQuery(b, 'vox'), matchesQuery(b, 'PERMA'), matchesQuery(b, ''), matchesQuery(b, 'nagafen')]).toEqual([true, true, true, false]);
  });
  it('formats the window', () => {
    expect([fmtWindow(72), fmtWindow(168), fmtWindow(18), fmtWindow(null), fmtWindow(0)]).toEqual(['3d', '7d', '18h', 'n/a', 'n/a']);
  });
  it('groups by expansion then zone in the given order', () => {
    const g = groupExpansions([row('a', 1, { expansion: 'Kunark', zone: 'S' }), row('b', 1), row('c', 1, { expansion: 'Kunark', zone: 'S' })], ['Classic', 'Kunark', 'Luclin']);
    expect(g.map((x) => x.expansion)).toEqual(['Classic', 'Kunark']);
    expect(g[1].zones[0].bosses.length).toBe(2);
  });
});

describe('the fixture has the spread the draft needs', () => {
  const bosses = toNextUpBosses(LAB_ROWS);
  const s = summarize(bosses, LAB_NOW);
  it('40 bosses over 5 expansions, 28 available, 12 on timers (2 soon), a long name among the timers', () => {
    expect(bosses.length).toBe(40);
    expect(new Set(bosses.map((b) => b.expansion)).size).toBe(5);
    expect(LAB_EXPANSIONS.length).toBe(5);
    expect(s.up).toBe(28);
    expect(s.soon).toBe(2);
    const { timers } = splitNextUp(bosses, LAB_NOW);
    expect(timers).toHaveLength(12);
    expect(timers.some((b) => b.name.length > 40)).toBe(true);
    expect(timers.some((b) => b.opensAtMs - LAB_NOW > 24 * 3600000)).toBe(true);
    expect(timers.some((b) => { const h = (b.opensAtMs - LAB_NOW) / 3600000; return h > 1 && h < 24; })).toBe(true);
    expect(new Set(bosses.map((b) => b.id)).size).toBe(bosses.length);
  });
});

describe('the draft and its staging', () => {
  const read = (p) => stripJs(fs.readFileSync(path.join(ROOT, p), 'utf8'));
  it('is described for the Decision Desk and staged behind ?v=a', () => {
    expect(draft.rec).toBe('a');
    expect(draft.staged).toBe('/boards?v=a');
  });
  it('the real page only branches on ?v=a, and keeps the variant through sign-in', () => {
    const src = read('web/app/boards/page.tsx');
    expect(src).toMatch(/\.v === 'a'/);
    expect(src).toMatch(/\/boards\?v=a/);
    expect(src).toMatch(/redirect\('\/auth\/signin\?next=\/boards'\)|'\/auth\/signin\?next=\/boards'/);
  });
  it('reuses the ticker countdown instead of a second formatter', () => {
    expect(read('web/app/boards/ticker.tsx')).toMatch(/export function fmtRemaining/);
    expect(read('web/components/lab/boards-next-up/shared.tsx')).toMatch(/import \{ fmtRemaining \} from '@\/app\/boards\/ticker'/);
  });
  it('the pin store is read and written inside try/catch', () => {
    const src = read('web/components/lab/boards-next-up/WatchList.tsx');
    expect(src.match(/localStorage/g).length).toBe(3);
    expect(src.match(/try \{/g).length).toBeGreaterThanOrEqual(2);
  });
});
