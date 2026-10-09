// test/pop-spells-filter.test.js — the class filter and column sort on /pop's "PoP spells still need" table.
//
// The guild lead, 2026-10-09: "add sorting and filtering to the pop spells section by class". Both ride in the URL
// (?pclass / ?psort / ?pdir) and are applied on the server by pure helpers in web/lib/popSpellsView.ts, so the
// behaviour is tested by running them. Names are invented.
//
// Run: npx vitest run test/pop-spells-filter.test.js
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  parsePopSpellView, filterNeeds, sortNeeds, classCounts, classKey, viewParams, ariaSortFor, nextSort,
  toggleClass, emptyFilteredText, sortLabel, SORT_KEYS,
} from '../web/lib/popSpellsView.ts';
import { readSource, stripJs, ROOT } from './_source-slice.js';

const mk = (name, cls, level, e = 0, s = 0, g = 0, o = 0) => ({
  name, cls, level,
  tiers: { ethereal: Array(e).fill(0), spectral: Array(s).fill(0), glyphed: Array(g).fill(0) },
  other: Array(o).fill(0), total: e + s + g + o,
});
const ROWS = [
  mk('Aldenmar', 'Enchanter', 65, 1, 2, 0),
  mk('Brackwyn', 'Wizard', 65, 0, 0, 3),
  mk('Corvale', 'Enchanter', 62, 2, 2, 2, 1),
  mk('Rethlan', 'Shadow Knight', 60, 1, 0, 0),
  mk('Nyssara', 'Cleric', 65, 0, 1, 0),
  mk('Zarrin', null, 58, 0, 0, 1),
  mk('Ysolde', 'Wizard', null, 2, 0, 0),
];
const names = (rows) => rows.map(r => r.name);
const PRESENT = classCounts(ROWS).map(c => c.key);

describe('classKey / classCounts', () => {
  it('uses the repo class abbreviations, lowercased', () => {
    expect(classKey('Enchanter')).toBe('enc');
    expect(classKey('Shadow Knight')).toBe('shd');
    expect(classKey('shadowknight')).toBe('shd');
    expect(classKey(null)).toBe('unk');
    expect(classKey('Not A Class')).toBe('unk');
  });
  it('counts each class present, A-Z, unknown last', () => {
    expect(classCounts(ROWS)).toEqual([
      { key: 'clr', label: 'Cleric', count: 1 },
      { key: 'enc', label: 'Enchanter', count: 2 },
      { key: 'shd', label: 'Shadow Knight', count: 1 },
      { key: 'wiz', label: 'Wizard', count: 2 },
      { key: 'unk', label: 'Unknown class', count: 1 },
    ]);
  });
  it('is empty for no rows', () => expect(classCounts([])).toEqual([]));
});

describe('parsePopSpellView', () => {
  it('defaults to every class, highest level first', () => {
    const v = parsePopSpellView({}, PRESENT);
    expect(v).toEqual({ classes: [], sort: 'level', dir: 'desc', filtered: false, sorted: false });
    expect(viewParams(v)).toEqual({ pclass: null, psort: null, pdir: null });
  });
  it('reads the classes present, in chip order, ignoring case, spaces and repeats', () => {
    const v = parsePopSpellView({ pclass: 'WIZ, enc,wiz' }, PRESENT);
    expect(v.classes).toEqual(['enc', 'wiz']);
    expect(v.filtered).toBe(true);
    expect(viewParams(v).pclass).toBe('enc,wiz');
  });
  it('ignores classes that are not in the rows, and never reflects raw input', () => {
    const v = parsePopSpellView({ pclass: 'bst,<script>alert(1)</script>,enc' }, PRESENT);
    expect(v.classes).toEqual(['enc']);
    expect(JSON.stringify(viewParams(v))).not.toMatch(/script|bst/);
    expect(parsePopSpellView({ pclass: 'bst' }, PRESENT).filtered).toBe(false);
    expect(parsePopSpellView({ pclass: 'x'.repeat(5000) }, PRESENT).classes).toEqual([]);
  });
  it('falls back to the default for an unknown sort column or direction', () => {
    expect(parsePopSpellView({ psort: 'drop table' }, PRESENT)).toMatchObject({ sort: 'level', dir: 'desc', sorted: false });
    expect(parsePopSpellView({ psort: 'name', pdir: 'sideways' }, PRESENT)).toMatchObject({ sort: 'name', dir: 'asc', sorted: true });
    expect(parsePopSpellView({ psort: 'total', pdir: 'sideways' }, PRESENT)).toMatchObject({ sort: 'total', dir: 'desc' });
  });
  it('accepts every whitelisted column and both directions', () => {
    for (const k of SORT_KEYS) {
      expect(parsePopSpellView({ psort: k, pdir: 'asc' }, PRESENT)).toMatchObject({ sort: k, dir: 'asc' });
      expect(parsePopSpellView({ psort: k, pdir: 'desc' }, PRESENT)).toMatchObject({ sort: k, dir: 'desc' });
    }
  });
  it('treats an explicit level-descending as the default, and level-ascending as a sort', () => {
    expect(parsePopSpellView({ psort: 'level', pdir: 'desc' }, PRESENT).sorted).toBe(false);
    const v = parsePopSpellView({ psort: 'level', pdir: 'asc' }, PRESENT);
    expect(v.sorted).toBe(true);
    expect(viewParams(v)).toMatchObject({ psort: 'level', pdir: 'asc' });
  });
  it('takes the first value of a repeated param', () => {
    expect(parsePopSpellView({ psort: ['name', 'total'] }, PRESENT).sort).toBe('name');
  });
});

describe('filterNeeds', () => {
  it('no class selected keeps every row', () => expect(filterNeeds(ROWS, [])).toHaveLength(ROWS.length));
  it('keeps only the selected classes (several at once)', () => {
    expect(names(filterNeeds(ROWS, ['enc']))).toEqual(['Aldenmar', 'Corvale']);
    expect(names(filterNeeds(ROWS, ['enc', 'wiz'])).sort()).toEqual(['Aldenmar', 'Brackwyn', 'Corvale', 'Ysolde']);
    expect(names(filterNeeds(ROWS, ['unk']))).toEqual(['Zarrin']);
  });
  it('does not mutate its input', () => {
    const before = names(ROWS);
    filterNeeds(ROWS, ['enc']);
    expect(names(ROWS)).toEqual(before);
  });
});

describe('sortNeeds', () => {
  it('the default is the order the table always had: highest level first, ties by name, unknown level last', () => {
    expect(names(sortNeeds(ROWS, 'level', 'desc'))).toEqual(['Aldenmar', 'Brackwyn', 'Nyssara', 'Corvale', 'Rethlan', 'Zarrin', 'Ysolde']);
    // and it is exactly what the page's own groupNeeds ordering produced before this change
    const legacy = [...ROWS].sort((a, b) => (b.level ?? -1) - (a.level ?? -1) || a.name.localeCompare(b.name));
    expect(names(sortNeeds(ROWS, 'level', 'desc'))).toEqual(names(legacy));
  });
  it('level ascending reverses the levels but keeps an unknown level last', () => {
    expect(names(sortNeeds(ROWS, 'level', 'asc'))).toEqual(['Zarrin', 'Rethlan', 'Corvale', 'Aldenmar', 'Brackwyn', 'Nyssara', 'Ysolde']);
  });
  it('sorts by name, both ways', () => {
    expect(names(sortNeeds(ROWS, 'name', 'asc'))).toEqual(['Aldenmar', 'Brackwyn', 'Corvale', 'Nyssara', 'Rethlan', 'Ysolde', 'Zarrin']);
    expect(names(sortNeeds(ROWS, 'name', 'desc'))).toEqual(['Zarrin', 'Ysolde', 'Rethlan', 'Nyssara', 'Corvale', 'Brackwyn', 'Aldenmar']);
  });
  it('sorts by class, ties by level then name, a missing class last both ways', () => {
    expect(names(sortNeeds(ROWS, 'class', 'asc'))).toEqual(['Nyssara', 'Aldenmar', 'Corvale', 'Rethlan', 'Brackwyn', 'Ysolde', 'Zarrin']);
    expect(names(sortNeeds(ROWS, 'class', 'desc'))).toEqual(['Brackwyn', 'Ysolde', 'Rethlan', 'Aldenmar', 'Corvale', 'Nyssara', 'Zarrin']);
  });
  it('sorts by each turn-in count, the Other column and the total', () => {
    expect(names(sortNeeds(ROWS, 'ethereal', 'desc')).slice(0, 2)).toEqual(['Corvale', 'Ysolde']);
    expect(names(sortNeeds(ROWS, 'spectral', 'desc')).slice(0, 2)).toEqual(['Aldenmar', 'Corvale']);
    expect(names(sortNeeds(ROWS, 'glyphed', 'desc'))[0]).toBe('Brackwyn');
    expect(names(sortNeeds(ROWS, 'other', 'desc'))[0]).toBe('Corvale');
    expect(names(sortNeeds(ROWS, 'total', 'desc'))[0]).toBe('Corvale');
    expect(names(sortNeeds(ROWS, 'total', 'asc'))[0]).toBe('Nyssara');
  });
  it('breaks ties by level then name, so the order is the same however the input arrives', () => {
    const want = names(sortNeeds(ROWS, 'total', 'desc'));
    for (let i = 0; i < 20; i++) {
      const shuffled = [...ROWS].sort(() => Math.random() - 0.5);
      expect(names(sortNeeds(shuffled, 'total', 'desc'))).toEqual(want);
    }
    expect(want.slice(1, 3)).toEqual(['Aldenmar', 'Brackwyn']);   // 3 apiece... level 65 both, then name
  });
  it('does not mutate its input', () => {
    const before = names(ROWS);
    sortNeeds(ROWS, 'name', 'desc');
    expect(names(ROWS)).toEqual(before);
  });
});

describe('filter + sort compose', () => {
  it('filters first, then orders what is left', () => {
    const v = parsePopSpellView({ pclass: 'enc,wiz', psort: 'total', pdir: 'asc' }, PRESENT);
    const shown = sortNeeds(filterNeeds(ROWS, v.classes), v.sort, v.dir);
    expect(names(shown)).toEqual(['Ysolde', 'Aldenmar', 'Brackwyn', 'Corvale']);
  });
  it('the chip counts come from the unfiltered rows, so a picked class never hides its siblings', () => {
    const v = parsePopSpellView({ pclass: 'enc' }, PRESENT);
    expect(filterNeeds(ROWS, v.classes)).toHaveLength(2);
    expect(classCounts(ROWS)).toHaveLength(5);
  });
});

describe('header + chip links', () => {
  const v = { sort: 'total', dir: 'desc' };
  it('aria-sort marks only the sorted column', () => {
    expect(ariaSortFor(v, 'total')).toBe('descending');
    expect(ariaSortFor({ sort: 'name', dir: 'asc' }, 'name')).toBe('ascending');
    expect(ariaSortFor(v, 'name')).toBe('none');
  });
  it('a header click flips the sorted column and starts any other at its natural direction', () => {
    expect(nextSort(v, 'total')).toEqual({ key: 'total', dir: 'asc' });
    expect(nextSort({ sort: 'total', dir: 'asc' }, 'total')).toEqual({ key: 'total', dir: 'desc' });
    expect(nextSort(v, 'name')).toEqual({ key: 'name', dir: 'asc' });
    expect(nextSort(v, 'class')).toEqual({ key: 'class', dir: 'asc' });
    expect(nextSort(v, 'level')).toEqual({ key: 'level', dir: 'desc' });
    expect(nextSort(v, 'glyphed')).toEqual({ key: 'glyphed', dir: 'desc' });
  });
  it('a chip click toggles its class, keeping chip order', () => {
    expect(toggleClass({ classes: [] }, 'wiz', PRESENT)).toEqual(['wiz']);
    expect(toggleClass({ classes: ['wiz'] }, 'enc', PRESENT)).toEqual(['enc', 'wiz']);
    expect(toggleClass({ classes: ['enc', 'wiz'] }, 'enc', PRESENT)).toEqual(['wiz']);
    expect(toggleClass({ classes: ['wiz'] }, 'wiz', PRESENT)).toEqual([]);
  });
  it('words the empty state with the class, and the column titles match the old headers', () => {
    expect(emptyFilteredText(['Enchanter'])).toBe('No Enchanter is missing a PoP spell');
    expect(emptyFilteredText(['Enchanter', 'Wizard'])).toBe('No Enchanter or Wizard is missing a PoP spell');
    expect(['ethereal', 'spectral', 'glyphed'].map(sortLabel)).toEqual(['Ethereal', 'Spectral', 'Rune Word']);
  });
});

describe('page wiring', () => {
  const page = stripJs(readSource(path.join(ROOT, 'web', 'app', 'pop', 'page.tsx')));
  it('feeds BOTH tables the filtered, sorted rows', () => {
    expect(page).toMatch(/shownSpellNeeds = sortNeeds\(filterNeeds\(scopedSpellNeeds, /);
    expect(page).toMatch(/shownUnknownNeeds = sortNeeds\(filterNeeds\(scopedUnknownNeeds, /);
    expect(page).toMatch(/<NeedsTable rows=\{shownSpellNeeds\} \/>/);
    expect(page).toMatch(/<NeedsTable rows=\{shownUnknownNeeds\} \/>/);
    expect(page).not.toMatch(/<NeedsTable rows=\{scoped/);
  });
  it('carries the new params on every hrefFor link, and gives headers aria-sort', () => {
    expect(page).toMatch(/\.\.\.viewParams\(spellView\)/);
    expect(page).toMatch(/params\.set\('pclass'/);
    expect(page).toMatch(/aria-sort=\{ariaSortFor\(spellView, k\)\}/);
  });
});
