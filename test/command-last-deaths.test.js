// test/command-last-deaths.test.js — the Command Center's "Last deaths" card (the guild lead, 2026-10-21, with a
// screenshot of a narrow overlay): "This section of the command center doesn't say who, it can't be minimized or
// ignored." Three things, each pinned here:
//   1. WHO — the row's name cell was `flex:1; min-width:0` beside a detail span that would not shrink, so at a narrow
//      width the name got zero width and the row began "died 14:46:50 ...". The name is now a cell that never
//      shrinks, the detail is what ellipsizes; and a recap with no usable name (the agent writes "You" when it does
//      not know the character) reads as the active character.
//   2. MINIMIZE — the header goes through the same secToggle / collapse store as every other section.
//   3. IGNORE — a per-row ✕ and "clear all", local to the overlay, keyed by who + when, behind the hover handshake.
// Runs the overlay's REAL functions (sliced out of apps/mimic/command.html). Names are invented.
//
// Run: npx vitest run test/command-last-deaths.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const cmd = readSource(path.join(ROOT, 'apps', 'mimic', 'command.html'));
const COLLAPSE = sliceBlock(cmd, '  var _collapsedSections = {};', "+ (col ? '▸' : '▾') + ' ' + esc(label) + cnt + '</span>';\n  }");
const DEATHS = sliceBlock(cmd, '  var DEATH_SAME_MS = 5000', "    return html + '</div>';\n  }");

function load(store = {}) {
  const storage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  const pre = "var esc = function(s){ return String(s == null ? '' : s).replace(/[&<>\"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'})[c]; }); };";
  // eslint-disable-next-line no-new-func
  const api = new Function('localStorage', pre + COLLAPSE + DEATHS
    + '\nreturn { deathWho, deathDetail, deathRecapsHtml, dismissDeath, dismissAllDeaths, isDeathDismissed, _toggleCollapsed, _isCollapsed };')(storage);
  return { ...api, store };
}

const recap = (over = {}) => ({
  id: 1, name: 'Aldenmar', ts: '2026-10-21T18:46:50.000Z', killer: 'a braan frienai', dmg6: 4600, lastChOffMs: null, beatMs: null, ...over,
});
const rows = (html) => (html.match(/<div class="row death-row">/g) || []).length;

describe('who died', () => {
  it('names the character on every row', () => {
    const { deathRecapsHtml } = load();
    const html = deathRecapsHtml([recap({ name: 'Aldenmar' }), recap({ id: 2, name: 'Brackwyn', ts: '2026-10-21T18:40:07.000Z' })], 'Corvale');
    expect(html).toMatch(/<span class="nm" title="Aldenmar">Aldenmar<\/span>/);
    expect(html).toMatch(/<span class="nm" title="Brackwyn">Brackwyn<\/span>/);
  });

  it('reads an unnamed or "You" recap as the active character, else "You"', () => {
    const { deathWho } = load();
    expect(deathWho({ name: '' }, 'Corvale')).toBe('Corvale');
    expect(deathWho({ name: null }, 'Corvale')).toBe('Corvale');
    expect(deathWho({ name: 'You' }, 'Corvale')).toBe('Corvale');
    expect(deathWho({ name: 'you' }, '')).toBe('You');
    expect(deathWho({}, undefined)).toBe('You');
    expect(deathWho({ name: 'Brackwyn' }, 'Corvale')).toBe('Brackwyn');
  });

  it('puts the name in a cell that cannot be squeezed to nothing, and lets the detail give way', () => {
    const css = cmd.split('<style>')[1].split('</style>')[0].replace(/\/\*[\s\S]*?\*\//g, '');
    const nm = /\.list \.row\.death-row \.nm\s*\{([^}]*)\}/.exec(css);
    const det = /\.death-row \.death-det\s*\{([^}]*)\}/.exec(css);
    expect(nm && det).toBeTruthy();
    expect(nm[1]).toMatch(/flex:\s*0 0 auto/);
    expect(det[1]).toMatch(/min-width:\s*0/);
    expect(det[1]).toMatch(/text-overflow:\s*ellipsis/);
  });
});

describe('the detail line', () => {
  it('keeps the wording the card always had', () => {
    const { deathDetail } = load();
    const d = deathDetail(recap({ lastChOffMs: 2300, dmg6: 9100, beatMs: 3000 }));
    expect(d).toMatch(/^died \d\d:\d\d:\d\d · 2\.3 s after the last CH · beat 3 s · took 9\.1k in 6 s · by a braan frienai$/);
    expect(deathDetail(recap({ dmg6: 900, killer: null }))).toMatch(/ · no CH in 20 s · took 900 in 6 s$/);
  });
});

describe('minimizing', () => {
  it('goes through the shared section toggle: caret, count when collapsed, rows hidden, no clear-all', () => {
    const { deathRecapsHtml, _toggleCollapsed } = load();
    const list = [recap(), recap({ id: 2, name: 'Brackwyn', ts: '2026-10-21T18:40:07.000Z' })];
    const open = deathRecapsHtml(list, 'x');
    expect(open).toContain('class="sec-toggle" data-wp-interact data-collapse-key="deathrecaps"');
    expect(open).toContain('▾ 💀 Last deaths');
    expect(rows(open)).toBe(2);
    expect(open).toContain('deathClearAll');
    _toggleCollapsed('deathrecaps');
    const shut = deathRecapsHtml(list, 'x');
    expect(shut).toContain('▸ 💀 Last deaths (2)');
    expect(rows(shut)).toBe(0);
    expect(shut).not.toContain('deathClearAll');
  });

  it('remembers it the way the other sections do (wp_cmd_collapsed)', () => {
    const a = load();
    a._toggleCollapsed('deathrecaps');
    expect(JSON.parse(a.store.wp_cmd_collapsed)).toEqual({ deathrecaps: true });
    expect(load(a.store)._isCollapsed('deathrecaps')).toBe(true);
  });
});

describe('ignoring', () => {
  const list = [recap(), recap({ id: 2, name: 'Brackwyn', ts: '2026-10-21T18:40:07.000Z' }), recap({ id: 3, name: 'Aldenmar', ts: '2026-10-21T18:29:53.000Z' })];

  it('every row carries a ✕ behind the hover handshake, with its who and when', () => {
    const { deathRecapsHtml } = load();
    const html = deathRecapsHtml(list, 'x');
    expect((html.match(/class="deathDismiss" data-wp-interact data-death-who="[^"]+" data-death-ts="[^"]+"/g) || [])).toHaveLength(3);
    expect(html).toContain('class="deathClearAll" data-wp-interact');
  });

  it('dismissing one removes it, and it stays gone on the next poll', () => {
    const w = load();
    w.dismissDeath(list[1], 'x');
    for (let poll = 0; poll < 3; poll++) {
      const html = w.deathRecapsHtml(list.map(r => ({ ...r })), 'x');
      expect(rows(html)).toBe(2);
      expect(html).not.toContain('Brackwyn');
    }
  });

  it('keys by who AND when: the same player dying again is a new row', () => {
    const w = load();
    w.dismissDeath(list[0], 'x');
    const html = w.deathRecapsHtml(list, 'x');
    expect(rows(html)).toBe(2);
    expect(html).toContain('data-death-ts="2026-10-21T18:29:53.000Z"');   // Aldenmar's earlier death is still there
    expect(w.isDeathDismissed(list[2], 'x')).toBe(false);
  });

  it('a fuller duplicate recap a few seconds off the same death stays dismissed', () => {
    const w = load();
    w.dismissDeath(list[0], 'x');
    expect(w.isDeathDismissed(recap({ ts: '2026-10-21T18:46:52.500Z' }), 'x')).toBe(true);
    expect(w.isDeathDismissed(recap({ ts: '2026-10-21T18:47:30.000Z' }), 'x')).toBe(false);
  });

  it('clear all dismisses every row and the card vanishes', () => {
    const w = load();
    w.dismissAllDeaths(list, 'x');
    expect(w.deathRecapsHtml(list, 'x')).toBe('');
  });

  it('the dismissal is local: it is kept in localStorage and nothing is fetched', () => {
    const w = load();
    w.dismissDeath(list[0], 'x');
    expect(JSON.parse(w.store.wp_cmd_dead_dismissed)).toEqual([{ n: 'aldenmar', t: Date.parse(list[0].ts) }]);
    expect(load(w.store).isDeathDismissed(list[0], 'x')).toBe(true);
    expect(stripJs(DEATHS)).not.toMatch(/fetch\(/);
  });

  it('an unnamed own-death is dismissed under the character it reads as', () => {
    const w = load();
    const mine = recap({ name: 'You', ts: '2026-10-21T18:50:00.000Z' });
    expect(w.deathRecapsHtml([mine], 'Corvale')).toContain('>Corvale</span>');
    w.dismissDeath(mine, 'Corvale');
    expect(w.deathRecapsHtml([mine], 'Corvale')).toBe('');
  });
});

describe('the wiring in the page', () => {
  const src = stripJs(cmd);
  it('arms the hover handshake on the new controls (both enter and leave) and handles their clicks', () => {
    expect((src.match(/t\.closest\('\.deathDismiss'\) \|\| t\.closest\('\.deathClearAll'\)/g) || [])).toHaveLength(2);
    expect(src).toMatch(/closest\('\.deathDismiss'\)[\s\S]{0,200}dismissDeath\(/);
    expect(src).toMatch(/closest\('\.deathClearAll'\)[\s\S]{0,200}dismissAllDeaths\(/);
  });
  it('renders the card from the payload with the active character as the fallback name', () => {
    expect(src).toContain('deathRecapsHtml(s.death_recaps, s.character)');
  });
});
