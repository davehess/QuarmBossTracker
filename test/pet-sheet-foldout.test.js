// test/pet-sheet-foldout.test.js — the #petstats sheet folds out of a Pet or Charm row.
//
// The guild lead, 2026-10-19, picked B for DECISIONS §63 ("a fold-out sheet"): click a pet row on the Pet
// overlay or the Charm overlay and the whole sheet the agent already parses opens under it (resists, observed
// haste, HP/AC/ATK/damage/delay/DPS, the 21 equipment slots); click again to fold it back. The clickable row
// needs data-wp-interact (a locked overlay is click-through), and the open state has to survive the
// repaints (both overlays rewrite their list with innerHTML on every poll).
//
// The renderer is apps/mimic/petsheet.js, run for real. The two pages' click handlers are sliced out of the
// HTML and run against a fake event, so a comment cannot satisfy any of it.
//
// Names are invented. Run: npx vitest run test/pet-sheet-foldout.test.js

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, sliceBlock, evalBlock, stripJs, stripCss } from './_source-slice.js';

const require = createRequire(import.meta.url);
const P = require(path.join(ROOT, 'apps', 'mimic', 'petsheet.js'));
const petsHtml = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'pets.html'), 'utf8');
const charmHtml = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'charm.html'), 'utf8');

const SLOT_NAMES = ['Ear 1', 'Head', 'Face', 'Ear 2', 'Neck', 'Shoulders', 'Arms', 'Back', 'Wrist 1', 'Wrist 2', 'Range',
  'Hands', 'Primary', 'Secondary', 'Finger 1', 'Finger 2', 'Chest', 'Legs', 'Feet', 'Waist', 'Ammo'];
const sheet = (over) => ({
  pet: 'Xibobab', read_at: Date.now() - 4 * 60_000, hp: 4000, hp_max: 4100, ac: 180, atk: 956,
  dmg_min: 19, dmg_max: 78, dmg_avg: 48.5, delay_ms: 2800, base_delay_ms: 3500, haste_pct: 25, dps: 17.3,
  resists: { magic: 35, fire: 35, cold: 35, poison: 15, disease: 15 },
  equipment: Object.fromEntries(SLOT_NAMES.map(n => [n, null])),
  complete: true, ...over,
});
const K = P.key('Aldenmar', 'Xibobab');
beforeEach(() => { P.reset(); });

describe('the sheet', () => {
  it('is nothing while folded, and nothing without a sheet', () => {
    expect(P.sheetHtml(sheet(), K)).toBe('');
    P.toggle(K);
    expect(P.sheetHtml(null, K)).toBe('');
    expect(P.sheetHtml(undefined, K)).toBe('');
  });

  it('shows HP, AC, ATK, damage, delay with the haste, DPS and every resist, signed', () => {
    P.toggle(K);
    const h = P.sheetHtml(sheet({ resists: { magic: -20, fire: 35, cold: 35, poison: 15, disease: 15 } }), K);
    expect(h).toContain('HP <b>4000 / 4100</b>');
    expect(h).toContain('AC <b>180</b>');
    expect(h).toContain('ATK <b>956</b>');
    expect(h).toContain('dmg <b>19–78</b> (avg 48.5)');
    expect(h).toContain('delay <b>2800ms</b>');
    expect(h).toContain('<b>+25%</b> haste');
    expect(h).toContain('DPS <b>17.3</b>');
    for (const r of ['MR', 'FR', 'CR', 'PR', 'DR']) expect(h).toContain(r + ' <b>');
    expect(h).toContain('MR <b>-20</b>');
    // a negative resist is the one that is flagged (the charm-break risk)
    expect(h).toMatch(/class="neg"[^>]*>MR <b>-20<\/b>/);
    expect(h).not.toMatch(/class="neg"[^>]*>FR /);
  });

  it('lists all 21 equipment slots in the server\'s order, empty ones dimmed', () => {
    P.toggle(K);
    const eq = Object.fromEntries(SLOT_NAMES.map(n => [n, null]));
    eq.Primary = 'Blade of <Rage>'; eq.Chest = 'Ornate Plate';
    const h = P.sheetHtml(sheet({ equipment: eq }), K);
    expect(h.match(/class="ps-sn"/g)).toHaveLength(21);
    expect(P.SLOTS).toEqual(SLOT_NAMES);
    const order = [...h.matchAll(/class="ps-sn">([^<]+)</g)].map(m => m[1]);
    expect(order).toEqual(SLOT_NAMES);
    expect(h.match(/class="ps-s none"/g)).toHaveLength(19);
    expect(h).toContain('Blade of &lt;Rage&gt;');
    expect(h).not.toContain('<Rage>');
    expect(h).toContain('title="Primary: Blade of &lt;Rage&gt;"');
  });

  it('a partial read (fields still null) shows ? and says so, never null / NaN / undefined', () => {
    P.toggle(K);
    const h = P.sheetHtml({ pet: 'Xibobab', read_at: Date.now(), hp: 10, hp_max: null, ac: null, atk: null,
      dmg_min: null, dmg_max: null, dmg_avg: null, delay_ms: null, haste_pct: null, dps: null,
      resists: null, equipment: null, complete: false }, K);
    expect(h).toContain('HP <b>10 / ?</b>');
    expect(h).toContain('dmg <b>?</b>');
    expect(h).toContain('partial read');
    expect(h).toContain('equipment not read');
    expect(h).not.toMatch(/null|NaN|undefined/);
    expect(h).not.toContain('haste');
  });

  it('haste shows only when the pet is actually faster than its slowest delay', () => {
    P.toggle(K);
    expect(P.sheetHtml(sheet({ haste_pct: 0 }), K)).not.toContain('haste');
    expect(P.sheetHtml(sheet({ haste_pct: 42 }), K)).toContain('+42%');
  });
});

describe('open state: a store keyed by pet, not markup', () => {
  it('toggle opens, toggle again folds; the key ignores case', () => {
    expect(P.isOpen(K)).toBe(false);
    expect(P.toggle(K)).toBe(true);
    expect(P.isOpen(P.key('ALDENMAR', 'xibobab'))).toBe(true);
    expect(P.toggle(K)).toBe(false);
    expect(P.isOpen(K)).toBe(false);
  });
  it('survives repaints: a fresh sheet object next poll is still open', () => {
    P.toggle(K);
    for (let i = 0; i < 5; i++) expect(P.sheetHtml(sheet({ hp: 4000 - i }), K)).toContain('class="ps"');
  });
  it('is per pet: opening one leaves the owner\'s other pet (or another owner\'s) folded', () => {
    P.toggle(K);
    expect(P.sheetHtml(sheet(), P.key('Aldenmar', 'Jareker'))).toBe('');
    expect(P.sheetHtml(sheet(), P.key('Brackwyn', 'Xibobab'))).toBe('');
  });
});

describe('the clickable row', () => {
  it('carries data-wp-interact, so a locked (click-through) overlay still gets the click', () => {
    const a = P.rowAttrs(sheet(), K);
    expect(a).toContain(' data-wp-interact');
    expect(a).toContain('data-sheet="' + K + '"');
    expect(a).toContain('role="button"');
  });
  it('flips aria-expanded and the tooltip with the state', () => {
    expect(P.rowAttrs(sheet(), K)).toContain('aria-expanded="false"');
    expect(P.chevron(sheet(), K)).toContain('▸');
    P.toggle(K);
    expect(P.rowAttrs(sheet(), K)).toContain('aria-expanded="true"');
    expect(P.chevron(sheet(), K)).toContain('▾');
  });
  it('a pet with no sheet has no clickable row and no chevron: it looks as it did', () => {
    expect(P.rowAttrs(null, K)).toBe('');
    expect(P.chevron(null, K)).toBe('');
  });
  it('the row is the only thing that toggles (the sheet body has no data-sheet)', () => {
    P.toggle(K);
    expect(P.sheetHtml(sheet(), K)).not.toContain('data-sheet="');
  });
  it('the chevron and pointer are drawn by CSS the module owns', () => {
    const css = stripCss(P.CSS);
    expect(css).toMatch(/\[data-sheet\]\{cursor:pointer\}/);
  });
});

// ── the two pages: the real click handler, against a fake event ───────────────────────────────────────
function handlerOf(html, marker) {
  const block = sliceBlock(html, marker, '\n  });');
  const state = { handler: null, tick: vi.fn(), fetch: vi.fn(() => Promise.resolve()) };
  const listEl = { addEventListener: (ev, fn) => { if (ev === 'click') state.handler = fn; } };
  evalBlock(`return (function(listEl, WpPetSheet, tick, fetch, PORT){ ${block} })`, [])(listEl, P, state.tick, state.fetch, 7779);
  return state;
}
// A fake click: `inRow` = inside an element carrying data-sheet; `button` = the click landed on a <button>
// (`dismiss` says which kind); the row's key is K.
function click({ inRow = false, button = null }) {
  const rowEl = { getAttribute: (n) => (n === 'data-sheet' ? K : null) };
  const btnEl = button ? { getAttribute: () => 'Aldenmar', disabled: false, style: {} } : null;
  return {
    stopPropagation: vi.fn(),
    target: { closest: (sel) => {
      if (sel === '[data-sheet]') return inRow ? rowEl : null;
      if (sel === 'button') return btnEl;
      if (sel === 'button.dismiss') return button === 'dismiss' ? btnEl : null;
      return null;
    } },
  };
}

describe.each([
  ['pets.html', petsHtml, "listEl.addEventListener('click', function(e){"],
  ['charm.html', charmHtml, "listEl.addEventListener('click', function(e){"],
])('%s: clicking the name row', (_name, html, marker) => {
  it('folds the sheet out, then away, repainting at once', () => {
    const t = handlerOf(html, marker);
    t.handler(click({ inRow: true }));
    expect(P.isOpen(K)).toBe(true);
    expect(t.tick).toHaveBeenCalledTimes(1);
    t.handler(click({ inRow: true }));
    expect(P.isOpen(K)).toBe(false);
    expect(t.tick).toHaveBeenCalledTimes(2);
    expect(t.fetch).not.toHaveBeenCalled();
  });
  it('a button inside the row (the broken card\'s "remove") is not a fold click', () => {
    const t = handlerOf(html, marker);
    t.handler(click({ inRow: true, button: 'dismiss' }));
    expect(P.isOpen(K)).toBe(false);
    expect(t.fetch).toHaveBeenCalledTimes(1);   // it dismissed, as before
  });
  it('the ✕ outside the row still dismisses', () => {
    const t = handlerOf(html, marker);
    t.handler(click({ inRow: false, button: 'dismiss' }));
    expect(t.fetch).toHaveBeenCalledTimes(1);
    expect(P.isOpen(K)).toBe(false);
  });
  it('a click elsewhere does nothing', () => {
    const t = handlerOf(html, marker);
    t.handler(click({}));
    expect(t.fetch).not.toHaveBeenCalled();
    expect(t.tick).not.toHaveBeenCalled();
  });
});

describe('both pages draw it', () => {
  for (const [name, html] of [['pets.html', petsHtml], ['charm.html', charmHtml]]) {
    const code = stripJs(html);
    it(name + ' loads the shared module before its own script', () => {
      const i = code.indexOf('<script src="petsheet.js"></script>');
      expect(i).toBeGreaterThan(-1);
      expect(i).toBeLessThan(code.indexOf('<script>'));
    });
    it(name + ' puts the pet row\'s attrs and chevron on the head, and the sheet on the card', () => {
      expect(code).toMatch(/<div class="head"' \+ WpPetSheet\.rowAttrs\(/);
      expect(code).toContain('WpPetSheet.chevron(');
      expect(code).toContain('WpPetSheet.sheetHtml(');
    });
  }
  it('the files exist where the page loads them (the packager ships apps/mimic/**)', () => {
    expect(fs.existsSync(path.join(ROOT, 'apps', 'mimic', 'petsheet.js'))).toBe(true);
  });
  it('pets.html draws it for the pet\'s own sheet', () => {
    expect(stripJs(petsHtml)).toContain('WpPetSheet.rowAttrs(p.sheet, sk)');
    expect(stripJs(petsHtml)).toContain('WpPetSheet.sheetHtml(p.sheet, sk)');
  });
});

describe('charm.html finds the sheet on the owner\'s pet row, only while charmed', () => {
  const fn = evalBlock(
    sliceBlock(charmHtml, 'function charmPetSheet(s, p){', '\n  }') + '\n',
    ['charmPetSheet'],
  ).charmPetSheet;
  const S = { petHealth: [{ owner: 'aldenmar', pet: 'Xibobab', sheet: { pet: 'Xibobab', hp: 1 } }, { owner: 'brackwyn', pet: 'Xibobab', sheet: { hp: 2 } }] };
  it('matches owner and pet, case-insensitively', () => {
    expect(fn(S, { is_active: true, owner: 'Aldenmar', pet: 'xibobab' }).hp).toBe(1);
    expect(fn(S, { is_active: true, owner: 'Brackwyn', pet: 'Xibobab' }).hp).toBe(2);
  });
  it('is null when broken, when the pet differs, or when the row has no sheet', () => {
    expect(fn(S, { is_active: false, owner: 'Aldenmar', pet: 'Xibobab' })).toBeNull();
    expect(fn(S, { is_active: true, owner: 'Aldenmar', pet: 'Jareker' })).toBeNull();
    expect(fn({ petHealth: [{ owner: 'aldenmar', pet: 'Xibobab' }] }, { is_active: true, owner: 'Aldenmar', pet: 'Xibobab' })).toBeNull();
    expect(fn(null, { is_active: true, owner: 'Aldenmar', pet: 'Xibobab' })).toBeNull();
  });
});
