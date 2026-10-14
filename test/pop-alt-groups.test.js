// test/pop-alt-groups.test.js — /pop's Matrix with alts grouped under their main (the guild lead, 2026-10-14: "group the
// flagging for alts by main with collapse turned on, we can expand all from a button. Then if we want to sort by
// latest changes, highlight the things that have changed in the last day, and last 3 days").
//
// web/lib/popAltGroups.ts is pure, so the change rules, the 24 h / 3 day buckets, the grouping and the sort run for
// real. The page and the component are read as comment-stripped source for their wiring (the param names, no new
// read of pop_flags, a native <details> with no client JS).
//
// Run: npx vitest run test/pop-alt-groups.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import {
  DAY_MS, changesByCharacter, levelOf, recentSteps, groupFamilies, familySummary, familyLevel, parseAltsView,
} from '../web/lib/popAltGroups.ts';

const read = (p) => stripJs(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const T0 = Date.parse('2026-10-14T20:00:00Z');
const H = 3_600_000;
const iso = (agoMs) => new Date(T0 - agoMs).toISOString();
const row = (character, flag_key, agoMs, source = 'event') => ({ character, flag_key, source, earned_at: iso(agoMs) });
const atOf = (map, name, key) => map.get(name.toLowerCase())?.find(e => e.key === key)?.at;

describe('what counts as a change', () => {
  it('an event and a checklist row count, at their own time', () => {
    const m = changesByCharacter([row('Aldenmar', 'grummus_dead', 2 * H, 'event'), row('Aldenmar', 'cl_grummus', 5 * H, 'checklist')]);
    expect(atOf(m, 'Aldenmar', 'grummus_dead')).toBe(T0 - 2 * H);
    expect(atOf(m, 'Aldenmar', 'cl_grummus')).toBe(T0 - 5 * H);
  });
  it('a witnessed hail is never a change, and neither is an unnamed grant', () => {
    const m = changesByCharacter([row('Aldenmar', 'hail', H, 'hail_witnessed'), row('Aldenmar', 'hail', H, 'event'),
      row('Aldenmar', 'unmapped', H, 'event'), row('Aldenmar', 'fuirstel_2', H, 'hail_witnessed')]);
    expect(m.get('aldenmar')).toBeUndefined();
  });
  it('an unknown source is not a change', () => {
    expect(changesByCharacter([row('Aldenmar', 'grummus_dead', H, 'manual')]).size).toBe(0);
  });
  it('a recital counts for a flag no earlier row held', () => {
    const m = changesByCharacter([row('Aldenmar', 'fuirstel_2', 3 * H, 'recital')]);
    expect(atOf(m, 'Aldenmar', 'fuirstel_2')).toBe(T0 - 3 * H);
  });
  it('a recital restating a flag an earlier event already recorded is NOT a change', () => {
    const m = changesByCharacter([
      row('Aldenmar', 'fuirstel_2', 20 * DAY_MS / 1, 'event'),    // 20 days ago
      row('Aldenmar', 'fuirstel_2', H, 'recital'),                 // seen an hour ago
    ]);
    expect(atOf(m, 'Aldenmar', 'fuirstel_2')).toBe(T0 - 20 * DAY_MS);
  });
  it('a recital over an earlier checklist row for the same flag is not a change either', () => {
    const m = changesByCharacter([row('Aldenmar', 'grummus_dead', 10 * DAY_MS, 'checklist'), row('Aldenmar', 'grummus_dead', H, 'recital')]);
    expect(atOf(m, 'Aldenmar', 'grummus_dead')).toBe(T0 - 10 * DAY_MS);
  });
  it('a second recital restating the first recital adds nothing', () => {
    const m = changesByCharacter([row('Aldenmar', 'fuirstel_2', 9 * DAY_MS, 'recital'), row('Aldenmar', 'fuirstel_2', H, 'recital')]);
    expect(atOf(m, 'Aldenmar', 'fuirstel_2')).toBe(T0 - 9 * DAY_MS);
  });
  it('the same flag on another character is its own row, so a recital there still counts', () => {
    const m = changesByCharacter([row('Aldenmar', 'fuirstel_2', 30 * DAY_MS, 'event'), row('Brackwyn', 'fuirstel_2', H, 'recital')]);
    expect(atOf(m, 'Brackwyn', 'fuirstel_2')).toBe(T0 - H);
  });
  it('an event and a recital at the same instant are one change at that instant, in either input order', () => {
    for (const rows of [
      [row('Aldenmar', 'fuirstel_2', H, 'recital'), row('Aldenmar', 'fuirstel_2', H, 'event')],
      [row('Aldenmar', 'fuirstel_2', H, 'event'), row('Aldenmar', 'fuirstel_2', H, 'recital')],
    ]) expect(atOf(changesByCharacter(rows), 'Aldenmar', 'fuirstel_2')).toBe(T0 - H);
  });
  it('a character earning the same flag again keeps the newest, and entries are newest first', () => {
    const m = changesByCharacter([
      row('Aldenmar', 'grummus_dead', 4 * DAY_MS), row('Aldenmar', 'grummus_dead', H), row('Aldenmar', 'fuirstel_2', 2 * H),
    ]);
    expect(m.get('aldenmar').map(e => e.key)).toEqual(['grummus_dead', 'fuirstel_2']);
    expect(atOf(m, 'Aldenmar', 'grummus_dead')).toBe(T0 - H);
  });
  it('character names match without regard to case, and a row with a bad time is skipped', () => {
    const m = changesByCharacter([row('ALDENMAR', 'grummus_dead', H), { ...row('aldenmar', 'fuirstel_2', H), earned_at: 'nonsense' }]);
    expect(m.get('aldenmar').map(e => e.key)).toEqual(['grummus_dead']);
  });
});

describe('the 24 hour and 3 day buckets', () => {
  it('splits at 24 hours and at 3 days', () => {
    expect(levelOf(T0, T0 - 5 * 60_000)).toBe('day');
    expect(levelOf(T0, T0 - DAY_MS)).toBe('day');
    expect(levelOf(T0, T0 - DAY_MS - 1000)).toBe('recent');
    expect(levelOf(T0, T0 - 3 * DAY_MS)).toBe('recent');
    expect(levelOf(T0, T0 - 3 * DAY_MS - 1000)).toBeNull();
    expect(levelOf(T0, T0 - 30 * DAY_MS)).toBeNull();
  });
  it('no time is no highlight, and a clock a little ahead is still today', () => {
    expect(levelOf(T0, null)).toBeNull();
    expect(levelOf(T0, undefined)).toBeNull();
    expect(levelOf(T0, NaN)).toBeNull();
    expect(levelOf(T0, T0 + 60_000)).toBe('day');
  });
  it('recentSteps lists only the last 3 days, newest first, leaving out a step another one proves', () => {
    const m = changesByCharacter([
      row('Aldenmar', 'fuirstel_1', 2 * H), row('Aldenmar', 'fuirstel_2', 2 * H), row('Aldenmar', 'grummus_dead', 30 * H),
      row('Aldenmar', 'zeks_1', 10 * DAY_MS),
    ]);
    const s = recentSteps(m.get('aldenmar'), T0);
    expect(s.map(x => x.key)).toEqual(['fuirstel_2', 'grummus_dead']);
    expect(s.map(x => x.level)).toEqual(['day', 'recent']);
    expect(recentSteps(undefined, T0)).toEqual([]);
  });
});

// A family fixture: Aldenmar is a main with two alts, Corvale is a main with one, Zarrin stands alone, and
// Nyssara is an alt whose main is not on the list.
const CHARS = ['Aldenmar', 'Brackwyn', 'Rethlan', 'Corvale', 'Nyssara', 'Zarrin', 'Tolvane'].map(name => ({ name }));
const MAIN_OF = { brackwyn: 'aldenmar', rethlan: 'aldenmar', nyssara: 'tolvane', tolvane: 'tolvane' };
const rootOf = (k) => MAIN_OF[k] ?? null;
const family = (chars, latest = {}, sort = 'default', root = rootOf) =>
  groupFamilies(chars, { rootOf: root, latestOf: k => latest[k] ?? null, sort });
const shape = (fams) => fams.map(f => [f.head.name, ...f.alts.map(a => a.name)]);

describe('grouping alts under their main', () => {
  it('nests each alt under its main and keeps everyone else standing alone, in input order', () => {
    // Tolvane is listed here, so Nyssara goes under it; a family sits where its head sits in the input.
    expect(shape(family(CHARS))).toEqual([['Aldenmar', 'Brackwyn', 'Rethlan'], ['Corvale'], ['Zarrin'], ['Tolvane', 'Nyssara']]);
  });
  it('a family sits where its head is, even when an alt comes first in the input', () => {
    const alts = [{ name: 'Brackwyn' }, { name: 'Zarrin' }, { name: 'Aldenmar' }];
    expect(shape(family(alts))).toEqual([['Zarrin'], ['Aldenmar', 'Brackwyn']]);
  });
  it('an alt whose main is not on the list stands alone (an orphan), and nothing is dropped', () => {
    const list = CHARS.filter(c => c.name !== 'Tolvane');
    const fams = family(list);
    expect(shape(fams)).toEqual([['Aldenmar', 'Brackwyn', 'Rethlan'], ['Corvale'], ['Nyssara'], ['Zarrin']]);
    expect(fams.flatMap(f => [f.head, ...f.alts]).length).toBe(list.length);
  });
  it('an alt with no main on record stands alone', () => {
    expect(shape(family([{ name: 'Zarrin' }, { name: 'Corvale' }], {}, 'default', () => null))).toEqual([['Zarrin'], ['Corvale']]);
  });
  it('a hidden alt left out of the list is not nested, and does not raise its family', () => {
    const latest = { aldenmar: T0 - 9 * DAY_MS, brackwyn: T0 - H };
    const shown = CHARS.filter(c => c.name !== 'Brackwyn');           // its owner hid it
    const f = family(shown, latest).find(x => x.head.name === 'Aldenmar');
    expect(f.alts.map(a => a.name)).toEqual(['Rethlan']);
    expect(f.latestAt).toBe(T0 - 9 * DAY_MS);
  });
  it('a main that is itself hidden leaves its alts standing alone rather than losing them', () => {
    const shown = CHARS.filter(c => c.name !== 'Aldenmar');
    expect(shape(family(shown)).filter(g => g[0] === 'Brackwyn' || g[0] === 'Rethlan')).toEqual([['Brackwyn'], ['Rethlan']]);
  });
  it('a main_name loop or a chain longer than a family stops instead of hanging', () => {
    const loop = { a: 'b', b: 'a' };
    expect(shape(family([{ name: 'A' }, { name: 'B' }], {}, 'default', k => loop[k] ?? null))).toEqual([['A'], ['B']]);
    const chain = { c1: 'c2', c2: 'c3', c3: 'c4', c4: 'c5', c5: 'c6', c6: 'c7', c7: 'c8' };
    const fams = family(Array.from({ length: 8 }, (_, i) => ({ name: `C${i + 1}` })), {}, 'default', k => chain[k] ?? null);
    // Too far from C8 to settle, C1 and C2 stand alone; the rest sit under C8. Every character appears once.
    expect(shape(fams)).toEqual([['C1'], ['C2'], ['C8', 'C3', 'C4', 'C5', 'C6', 'C7']]);
  });
  it('a character is the head of its own family when its main_name is itself', () => {
    expect(shape(family([{ name: 'Tolvane' }], {}, 'default', rootOf))).toEqual([['Tolvane']]);
  });
});

describe('the latest-change sort', () => {
  it('a main whose alt just flagged rises above one whose own flag is older', () => {
    const latest = { aldenmar: T0 - 8 * DAY_MS, brackwyn: T0 - H, corvale: T0 - 2 * DAY_MS, zarrin: T0 - 5 * DAY_MS };
    const fams = family(CHARS.filter(c => !['Nyssara', 'Tolvane'].includes(c.name)), latest, 'latest');
    expect(fams.map(f => f.head.name)).toEqual(['Aldenmar', 'Corvale', 'Zarrin']);
    expect(fams[0].latestAt).toBe(T0 - H);
    expect(fams[0].latestBy).toBe('Brackwyn');
    expect(fams[0].headAt).toBe(T0 - 8 * DAY_MS);
  });
  it('alts inside a family are ordered by their own newest change, none last', () => {
    const fams = family(CHARS, { rethlan: T0 - 3 * H, brackwyn: T0 - 2 * DAY_MS }, 'latest');
    expect(fams[0].alts.map(a => a.name)).toEqual(['Rethlan', 'Brackwyn']);
    const none = family(CHARS, { brackwyn: T0 - H }, 'latest');
    expect(none[0].alts.map(a => a.name)).toEqual(['Brackwyn', 'Rethlan']);
  });
  it('families with no change at all go last, in their input order', () => {
    const fams = family(CHARS.filter(c => !['Nyssara', 'Tolvane'].includes(c.name)), { zarrin: T0 - H }, 'latest');
    expect(fams.map(f => f.head.name)).toEqual(['Zarrin', 'Aldenmar', 'Corvale']);
  });
  it('ties keep the input order', () => {
    const t = T0 - H;
    const fams = family(CHARS.filter(c => ['Corvale', 'Zarrin'].includes(c.name)), { corvale: t, zarrin: t }, 'latest');
    expect(fams.map(f => f.head.name)).toEqual(['Corvale', 'Zarrin']);
  });
  it('the default sort leaves the order alone whatever the changes are', () => {
    const fams = family(CHARS.filter(c => !['Nyssara', 'Tolvane'].includes(c.name)), { zarrin: T0 - H }, 'default');
    expect(fams.map(f => f.head.name)).toEqual(['Aldenmar', 'Corvale', 'Zarrin']);
  });
});

describe('the one-line summary and the collapsed dot', () => {
  it('says how many alts and when the family last changed, and names an alt that carried it', () => {
    const f = family(CHARS, { aldenmar: T0 - 5 * DAY_MS, brackwyn: T0 - 2 * DAY_MS })[0];
    expect(familySummary(f, T0)).toBe('2 alts · newest flag 2d ago on Brackwyn');
  });
  it('does not name the main when the main carried it, and says "1 alt" for one', () => {
    const f = family(CHARS, { corvale: T0 - 3 * H }).find(x => x.head.name === 'Corvale');
    const g = { ...f, alts: [{ name: 'Brackwyn' }] };
    expect(familySummary(g, T0)).toBe('1 alt · newest flag 3h ago');
  });
  it('says so when nothing was ever recorded', () => {
    expect(familySummary(family(CHARS)[0], T0)).toBe('2 alts · no flag changes recorded');
  });
  it('the dot is the family level: an alt changing today lights the collapsed main', () => {
    const fams = family(CHARS, { aldenmar: T0 - 20 * DAY_MS, rethlan: T0 - 2 * H });
    expect(familyLevel(fams[0], T0)).toBe('day');
    expect(levelOf(T0, fams[0].headAt)).toBeNull();
    expect(familyLevel(family(CHARS, { brackwyn: T0 - 2 * DAY_MS })[0], T0)).toBe('recent');
    expect(familyLevel(family(CHARS, { brackwyn: T0 - 6 * DAY_MS })[0], T0)).toBeNull();
  });
});

describe('the param wiring', () => {
  it('only ?alts=group turns the grouping on; sort and open mean nothing without it', () => {
    expect(parseAltsView({})).toEqual({ group: false, sort: 'flags', open: false });
    expect(parseAltsView({ sort: 'latest', open: '1' })).toEqual({ group: false, sort: 'flags', open: false });
    expect(parseAltsView({ alts: 'yes' }).group).toBe(false);
    expect(parseAltsView({ alts: 'group' })).toEqual({ group: true, sort: 'flags', open: false });
    expect(parseAltsView({ alts: 'group', sort: 'latest', open: '1' })).toEqual({ group: true, sort: 'latest', open: true });
    expect(parseAltsView({ alts: 'group', sort: 'name', open: 'true' })).toEqual({ group: true, sort: 'flags', open: false });
  });
  const page = read('web/app/pop/page.tsx');
  it('the page reads alts, sort and open and none of them collides with an existing param', () => {
    expect(page).toMatch(/alts\?: string; sort\?: string; open\?: string/);
    expect(page).toMatch(/alts: altsParam, sort: sortParam, open: openParam/);
    // Whether the Matrix is grouped is decided once, by resolvePopView (web/lib/popScope.ts), not by the raw param.
    expect(page).toMatch(/parseAltsView\(\{ alts: choice\.groupAlts \? 'group' : undefined, sort: sortParam, open: openParam \}\)/);
    // psort is the spell table's own sort; the new sort must not be read from it, nor the other way round.
    expect(page).not.toMatch(/[^p]sort: psortParam/);
    expect(page).not.toMatch(/parseAltsView\(\{[^}]*psortParam/);
    expect(page).toMatch(/psort: psortParam/);
  });
  it('every page link carries the three params, and the Chart link drops them', () => {
    // alts rides along as the URL had it ('group' or 'flat'), never as the grouping All characters implies.
    expect(page).toMatch(/alts: altsParam === 'group' \|\| altsParam === 'flat' \? altsParam : null/);
    expect(page).toMatch(/sort: altsView\.sort === 'latest' \? 'latest' : null/);
    expect(page).toMatch(/open: altsView\.open \? '1' : null/);
    expect(page).toMatch(/params\.set\('alts', next\.alts\)/);
    expect(page).toMatch(/params\.set\('sort', next\.sort\)/);
    expect(page).toMatch(/params\.set\('open', next\.open\)/);
    expect(page).toMatch(/hrefFor\(\{ view: 'chart', zone: null, alts: null, sort: null, open: null \}\)/);
  });
  it('?alts=group opens the Matrix when no view is named, and only the Matrix', () => {
    // resolvePopView turns ?alts=group (no view) into the Matrix; the page only reads its answer.
    expect(page).toMatch(/const matrixView = !selected && choice\.view === 'matrix' && scope !== 'mine'/);
    expect(page).toMatch(/\) : matrixView && altsView\.group \? \(/);
    expect(page).toMatch(/\) : matrixView \? \(/);
  });
  it('the Expand all / Collapse all control is a link, and the sort links set the sort', () => {
    expect(page).toMatch(/hrefFor\(\{ view: 'matrix', open: altsView\.open \? null : '1' \}\)/);
    expect(page).toMatch(/hrefFor\(\{ view: 'matrix', sort: 'latest' \}\)/);
    expect(page).toMatch(/hrefFor\(\{ view: 'matrix', sort: null \}\)/);
  });
  it('hidden characters are left out of the grouped list unless ?all=1', () => {
    expect(page).toMatch(/chars\.filter\(c => showAll \|\| !flaggedHidden\.has\(c\.name\.toLowerCase\(\)\)\)/);
  });
});

describe('cost', () => {
  const page = read('web/app/pop/page.tsx');
  it('adds no read of pop_flags: the rows come from the one paged read the page already makes, now with source', () => {
    expect((page.match(/\.from\('pop_flags'\)/g) || []).length).toBe(2);
    expect(page).toMatch(/\.select\('character, flag_key, earned_at, boss, zone, source'\)/);
    expect(page).toMatch(/selectAll<FlagRow>/);
    expect(page).toMatch(/changesByCharacter\(flagRows\)/);
  });
  it('reads the main of each character from the roster select it already makes', () => {
    expect(page).toMatch(/\.select\('name, rank, active, main_name'\)/);
    expect(read('web/lib/popAltGroups.ts')).not.toMatch(/\.from\(/);
  });
  it('is server-rendered: a native <details>, closed unless ?open=1, and no client component', () => {
    const c = read('web/app/pop/AltGroupMatrix.tsx');
    expect(c).not.toMatch(/['"]use client['"]/);
    expect(c).toMatch(/<details key=\{f\.head\.name\} open=\{openAll\}/);
    expect(c).not.toMatch(/useState|useEffect/);
  });
});
