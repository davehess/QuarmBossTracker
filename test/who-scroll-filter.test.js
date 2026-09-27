// The /who overlay: fixed height that scrolls, and tracking-window filters.
//
// The guild lead, 2026-09-26: "add scrolling and filtering to the who overlay. treat it like the in
// game tracking with filters for guilds or classes". A member, the same night: "make the who filter
// window be a certain modifiable size, and u can just scroll down it, instead of it getting bigger or
// smaller with number of people in zone".
//
// Runs the overlay's REAL filter / sort / chip code sliced out of apps/mimic/who.html. Names are
// invented.
//
// Run: npx vitest run test/who-scroll-filter.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs, stripCss } from './_source-slice.js';

const html = readSource(path.join(ROOT, 'apps', 'mimic', 'who.html'));
const block = sliceBlock(html, '  var _filt = { classes: [], guilds: [] };', '    return h;\n  }');

function load(saved) {
  const store = saved ? { 'wp:who:filters': JSON.stringify(saved) } : {};
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return new Function('localStorage', 'esc', block +
    '\nreturn { _filt, get sortBy(){ return _sortBy; }, whoFilterRows, whoSortRows, whoFacet, whoPanelHtml, whoClassOf, whoGuildOf, _saveFilters, store: null };')(localStorage, esc);
}

const p = (name, klass, level, guild, known) => ({ name, class: klass, level, guild, known: known || null });
const ROWS = [
  p('Rethlan', 'Bard', 60, 'Wolf Pack'),
  p('Aldenmar', 'Cleric', 58, 'Dungeons and Dragons'),
  p('Corvale', null, null, null, { class: 'Bard', level: 55, guild: 'Freedom' }),   // /anon, known from history
  p('Nyssara', 'Wizard', 60, null),
  p('Brackwyn', null, null, null),                                                  // /anon, nothing known
];
const names = (rows) => rows.map((r) => r.name);

describe('filters, like the tracking window', () => {
  it('everyone when nothing is chosen', () => {
    const h = load();
    expect(names(h.whoFilterRows(ROWS, { classes: [], guilds: [] }))).toEqual(names(ROWS));
  });
  it('by class, counting a class we know from history', () => {
    const h = load();
    expect(names(h.whoFilterRows(ROWS, { classes: ['Bard'], guilds: [] }))).toEqual(['Rethlan', 'Corvale']);
  });
  it('by guild, and "no guild" is its own choice', () => {
    const h = load();
    expect(names(h.whoFilterRows(ROWS, { classes: [], guilds: ['Freedom', ''] }))).toEqual(['Corvale', 'Nyssara', 'Brackwyn']);
  });
  it('class AND guild together', () => {
    const h = load();
    expect(names(h.whoFilterRows(ROWS, { classes: ['Bard'], guilds: ['Wolf Pack'] }))).toEqual(['Rethlan']);
  });
  it('"unknown" catches the ones with no class anywhere', () => {
    const h = load();
    expect(names(h.whoFilterRows(ROWS, { classes: ['?'], guilds: [] }))).toEqual(['Brackwyn']);
  });
});

describe('sort', () => {
  it('"seen" keeps the /who order', () => {
    expect(load().whoSortRows(ROWS, 'seen')).toBe(ROWS);
  });
  it('by name, by class (unknown last), by guild (none last)', () => {
    const h = load();
    expect(names(h.whoSortRows(ROWS, 'name'))).toEqual(['Aldenmar', 'Brackwyn', 'Corvale', 'Nyssara', 'Rethlan']);
    expect(names(h.whoSortRows(ROWS, 'class'))).toEqual(['Corvale', 'Rethlan', 'Aldenmar', 'Nyssara', 'Brackwyn']);
    expect(names(h.whoSortRows(ROWS, 'guild'))).toEqual(['Aldenmar', 'Corvale', 'Rethlan', 'Brackwyn', 'Nyssara']);
  });
  it('by level, highest first, names breaking ties', () => {
    expect(names(load().whoSortRows(ROWS, 'level'))).toEqual(['Nyssara', 'Rethlan', 'Aldenmar', 'Corvale', 'Brackwyn']);
  });
});

describe('the chip panel', () => {
  it('counts what is there, most common first; a chosen value stays even at 0', () => {
    const h = load();
    expect(h.whoFacet(ROWS, h.whoClassOf, ['Monk'])).toEqual([['Bard', 2], ['?', 1], ['Cleric', 1], ['Wizard', 1], ['Monk', 0]]);
  });
  it('lights the chosen chips, "all" when none, and labels the no-guild chip', () => {
    const h = load({ classes: [], guilds: [''] });
    const g = h.whoPanelHtml('guild', ROWS);
    expect(g).toMatch(/class="fchip" data-fclear="guild">all/);
    expect(g).toMatch(/class="fchip on" data-fk="guild" data-fv="">\(no guild\)<span class="c">2/);
    expect(g).toContain('&lt;Dungeons and Dragons&gt;');
    const c = load().whoPanelHtml('class', ROWS);
    expect(c).toMatch(/class="fchip on" data-fclear="class">all/);
  });
  it('remembers the filters and sort, and ignores a sort it does not know', () => {
    expect(load({ classes: ['Bard'], guilds: [], sortBy: 'level' }).sortBy).toBe('level');
    expect(load({ sortBy: 'nonsense' }).sortBy).toBe('seen');
    expect(load({ classes: ['Bard'] })._filt.classes).toEqual(['Bard']);
  });
});

describe('fixed height and scrolling', () => {
  const js = stripJs(html);
  it('holds the height you set instead of fitting the list, and fits again on request', () => {
    expect(js).toContain('if (_fixedH != null) { try { window.mimic.overlayAutoHeight(_fixedH); } catch (e) {} return; }');
    expect(js).toContain("localStorage.setItem('wp:who:height', String(_fixedH))");
    expect(js).toContain("localStorage.setItem('wp:who:height', 'fit')");
  });
  it('the list scrolls in fixed mode', () => {
    expect(stripCss(html)).toMatch(/body\.fixed #body\{[^}]*overflow-y:auto/);
  });
  // A locked overlay is click-through. In fixed mode the whole list must be interactive under the
  // pointer or the wheel cannot scroll it; in fit mode only its controls are, as before.
  it('the list takes the wheel only in fixed mode', () => {
    expect(js).toContain("(document.body.classList.contains('fixed') ? el.closest('#body') : el.closest('.copybtn, .clspick, .gone-toggle'))");
  });
  // The old per-control handlers switched interactivity off when the pointer left a button onto
  // the list, which would cut the wheel out mid-scroll. They must not come back.
  it('there is one hover owner, not one per control', () => {
    expect(js).not.toMatch(/bodyEl\.addEventListener\('mouseout'/);
    expect(js).not.toMatch(/zekBtn\.addEventListener\('mouseleave'/);
  });
});
