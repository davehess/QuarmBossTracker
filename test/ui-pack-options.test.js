// test/ui-pack-options.test.js — the UI pack's layout options as checkboxes (the guild lead,
// 2026-09-28: "Default should be no options, but you should be able to choose or remove multiple
// options. Resolve which ones have overlap and make it checkboxes"). The reported bug: the old
// dropdown could only ever add a layout and never showed what was on, and an update put the
// pack's all-bags bank back over the "Bank - Default layout" a member had applied.
//
// Runs the real apps/mimic/uiPacks.js against a small pack on disk laid out like Nillipuss 3.1:
// option folders, variant sub-folders, a screenshot and a readme, an option file identical to
// the default.
//
// Run: npx vitest run test/ui-pack-options.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ui = require('../apps/mimic/uiPacks.js');
const pack = ui.getPack('nillipuss1080');
const P = pack.packDir;

// Zip entries the way GitHub's source zipball wraps them: <repo>-<tag>/<packDir>/…
function release(tag, overrides = {}) {
  const files = {
    'EQUI_BankWnd.xml': 'BIG BANK',
    'EQUI_HotButtonWnd.xml': 'HOTBAR DEFAULT',
    'EQUI_Inventory.xml': 'INV DEFAULT',
    'EQUI_PlayerWindow.xml': 'PLAYER DEFAULT',
    'EQUI_BuffWindow.xml': 'BUFF',
    'EQUI_ShortDurationBuffWindow.xml': 'SONG',
    'window_pieces02.tga': 'BLUE',
    'dzbars.png': 'BARS',
    'Options/Bank - Default layout/EQUI_BankWnd.xml': 'SMALL BANK',
    'Options/Bank - Default layout/Screenshot.png': 'a picture',
    'Options/Hotbar + Bag 1 slots/EQUI_HotButtonWnd.xml': 'HOTBAR BAG1',
    'Options/Hotbar + Bag 1 slots/Screenshot.png': 'a picture',
    'Options/QQ Layout/EQUI_BankWnd.xml': 'QQ BANK',
    'Options/QQ Layout/EQUI_Inventory.xml': 'QQ INV',
    'Options/QQ Layout/EQUI_HotButtonWnd.xml': 'HOTBAR DEFAULT',       // byte-for-byte the default
    'Options/Remove Mana Bar (Melee)/EQUI_PlayerWindow.xml': 'NO MANA BAR',
    'Options/Remove Mana Timer (Original)/EQUI_PlayerWindow.xml': 'NO MANA TIMER',
    'Options/Horizontal Buff Bar/EQUI_BuffWindow.xml': 'HBUFF',
    'Options/Horizontal Buff Bar/EQUI_ShortDurationBuffWindow.xml': 'HSONG',
    'Options/Horizontal Buff Bar/Minimal/EQUI_BuffWindow.xml': 'HBUFF MIN',
    'Options/Theme - Colors/Readme.txt': 'pick one colour',
    'Options/Theme - Colors/Blue (default)/window_pieces02.tga': 'BLUE',
    'Options/Theme - Colors/Purple/window_pieces02.tga': 'PURPLE',
    'Options/Theme - Colors/Teal/window_pieces02.tga': 'TEAL',
    'Options/Extra Window/EQUI_Extra.xml': 'EXTRA',                  // a file only an option has
    ...overrides,
  };
  return Object.entries(files).map(([rel, body]) => ({ name: `NillipussUI_1080p-${tag}/${P}/${rel}`, data: Buffer.from(body) }));
}

let eq;
const root = () => path.join(eq, 'uifiles', P);
const main = (n) => { try { return fs.readFileSync(path.join(root(), n), 'utf8'); } catch { return null; } };
const state = () => ui.optionsState(eq, pack);
const on = () => state().choices.filter(c => c.applied).map(c => c.id);
const choice = (id) => state().choices.find(c => c.id === id);

beforeEach(() => {
  eq = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-uipack-'));
  ui._installEntries(eq, pack, release('3.1'), { tag: '3.1' });
});

describe('a fresh install', () => {
  it('has nothing ticked, and never counts a screenshot or readme as a layout file', () => {
    const s = state();
    expect(s.ready).toBe(true);
    expect(on()).toEqual([]);
    expect(main('EQUI_BankWnd.xml')).toBe('BIG BANK');
    const allFiles = s.choices.flatMap(c => c.files);
    expect(allFiles).not.toContain('Screenshot.png');
    expect(allFiles).not.toContain('Readme.txt');
  });

  it('lists every option and every variant as its own box', () => {
    expect(state().choices.map(c => c.id)).toEqual([
      'Bank - Default layout', 'Extra Window', 'Horizontal Buff Bar', 'Horizontal Buff Bar/Minimal',
      'Hotbar + Bag 1 slots', 'QQ Layout', 'Remove Mana Bar (Melee)', 'Remove Mana Timer (Original)',
      'Theme - Colors/Blue (default)', 'Theme - Colors/Purple', 'Theme - Colors/Teal',
    ]);
  });
});

describe('which options clash', () => {
  const clashes = (id) => choice(id).conflicts.map(c => c.id).sort();
  it('two options that change the same window clash; the rest stack', () => {
    expect(clashes('Bank - Default layout')).toEqual(['QQ Layout']);
    expect(clashes('Remove Mana Bar (Melee)')).toEqual(['Remove Mana Timer (Original)']);
    expect(clashes('Horizontal Buff Bar')).toEqual(['Horizontal Buff Bar/Minimal']);
    expect(clashes('Hotbar + Bag 1 slots')).toEqual([]);
  });
  it('a file identical to the default changes nothing, so it clashes with nothing', () => {
    expect(choice('QQ Layout').files.sort()).toEqual(['EQUI_BankWnd.xml', 'EQUI_Inventory.xml']);
    expect(clashes('QQ Layout')).toEqual(['Bank - Default layout']);
    expect(choice('Theme - Colors/Blue (default)').noop).toBe(true);
  });
  it('two versions of one option are alternatives even when their files differ', () => {
    expect(clashes('Theme - Colors/Purple')).toContain('Theme - Colors/Teal');
    expect(() => ui.setOptions(eq, pack, ['Theme - Colors/Purple', 'Theme - Colors/Teal'])).toThrow(/two versions of Theme - Colors/);
  });
});

describe('ticking and unticking', () => {
  it('the reported case: Hotbar was on, Bank - Default layout replaces it, and the hotbar goes back', () => {
    ui.setOptions(eq, pack, ['Hotbar + Bag 1 slots']);
    expect(main('EQUI_HotButtonWnd.xml')).toBe('HOTBAR BAG1');
    const r = ui.setOptions(eq, pack, ['Bank - Default layout']);
    expect(main('EQUI_BankWnd.xml')).toBe('SMALL BANK');
    expect(main('EQUI_HotButtonWnd.xml')).toBe('HOTBAR DEFAULT');
    expect(r.applied).toEqual(['Bank - Default layout']);
  });

  it('several options stack, and the boxes are read back off the files', () => {
    const want = ['Bank - Default layout', 'Hotbar + Bag 1 slots', 'Remove Mana Bar (Melee)', 'Theme - Colors/Purple'];
    expect(ui.setOptions(eq, pack, want).applied).toEqual(want);
    expect(on()).toEqual(want);
    expect(main('window_pieces02.tga')).toBe('PURPLE');
  });

  it('untick all puts every file back to the pack as it ships', () => {
    ui.setOptions(eq, pack, ['QQ Layout', 'Remove Mana Timer (Original)', 'Theme - Colors/Teal']);
    ui.setOptions(eq, pack, []);
    expect(on()).toEqual([]);
    expect([main('EQUI_BankWnd.xml'), main('EQUI_Inventory.xml'), main('EQUI_PlayerWindow.xml'), main('window_pieces02.tga')])
      .toEqual(['BIG BANK', 'INV DEFAULT', 'PLAYER DEFAULT', 'BLUE']);
  });

  it('a clashing set is refused before anything is written', () => {
    expect(() => ui.setOptions(eq, pack, ['Bank - Default layout', 'QQ Layout'])).toThrow(/both change EQUI_BankWnd\.xml/);
    expect(main('EQUI_BankWnd.xml')).toBe('BIG BANK');
    expect(main('EQUI_Inventory.xml')).toBe('INV DEFAULT');
  });

  it('a variant is its option with the variant\'s files on top', () => {
    ui.setOptions(eq, pack, ['Horizontal Buff Bar/Minimal']);
    expect(main('EQUI_BuffWindow.xml')).toBe('HBUFF MIN');
    expect(main('EQUI_ShortDurationBuffWindow.xml')).toBe('HSONG');
    expect(on()).toEqual(['Horizontal Buff Bar/Minimal']);
  });

  it('a file only an option has is removed again when it is unticked', () => {
    ui.setOptions(eq, pack, ['Extra Window']);
    expect(main('EQUI_Extra.xml')).toBe('EXTRA');
    ui.setOptions(eq, pack, []);
    expect(main('EQUI_Extra.xml')).toBe(null);
  });

  it('a member\'s own edit is backed up before an option replaces it', () => {
    fs.writeFileSync(path.join(root(), 'EQUI_BankWnd.xml'), 'MY OWN BANK');
    const r = ui.setOptions(eq, pack, ['Bank - Default layout']);
    expect(r.backedUp).toHaveLength(1);
    expect(fs.readFileSync(path.join(eq, r.backedUp[0]), 'utf8')).toBe('MY OWN BANK');
    // Switching between known files leaves no backups behind.
    expect(ui.setOptions(eq, pack, ['QQ Layout']).backedUp).toEqual([]);
  });
});

describe('updating the pack', () => {
  it('keeps the ticked options on, with the new release\'s defaults underneath', () => {
    ui.setOptions(eq, pack, ['Bank - Default layout', 'Theme - Colors/Purple']);
    const r = ui._installEntries(eq, pack, release('3.2', { 'EQUI_BankWnd.xml': 'BIG BANK v2' }), { tag: '3.2' });
    expect(r.reapplied).toEqual(['Bank - Default layout', 'Theme - Colors/Purple']);
    expect(main('EQUI_BankWnd.xml')).toBe('SMALL BANK');
    expect(main('window_pieces02.tga')).toBe('PURPLE');
    ui.setOptions(eq, pack, []);
    expect(main('EQUI_BankWnd.xml')).toBe('BIG BANK v2');
  });

  it('never leaves backup copies inside an option folder', () => {
    ui._installEntries(eq, pack, release('3.2'), { tag: '3.2' });
    const inOptions = [];
    const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : inOptions.push(f); } };
    walk(path.join(root(), 'Options'));
    expect(inOptions.filter(f => /bak-|tmp-/.test(f))).toEqual([]);
    expect(state().choices.flatMap(c => c.files).filter(f => /bak-|tmp-/.test(f))).toEqual([]);
  });
});

// The guild lead's machine, 2026-09-28: the old Apply copied every file of an option, its
// Screenshot.png included, into the main folder. The disk then said every option changed
// Screenshot.png, so nearly every box clashed with every other and Bank could not be ticked.
describe('a pack folder the old Apply littered', () => {
  it('a screenshot sitting in the main folder is still not a layout file', () => {
    fs.writeFileSync(path.join(root(), 'Screenshot.png'), 'a picture');
    fs.writeFileSync(path.join(root(), 'EQUI_HotButtonWnd.xml'), 'HOTBAR BAG1');   // Hotbar applied the old way
    const s = state();
    expect(s.choices.flatMap(c => c.files)).not.toContain('Screenshot.png');
    expect(choice('Bank - Default layout').conflicts.map(c => c.id)).toEqual(['QQ Layout']);
    expect(on()).toEqual(['Hotbar + Bag 1 slots']);
    expect(ui.setOptions(eq, pack, ['Bank - Default layout', 'Hotbar + Bag 1 slots']).applied)
      .toEqual(['Bank - Default layout', 'Hotbar + Bag 1 slots']);
  });
});

describe('a pack installed before Mimic kept its default files', () => {
  it('shows no box as on and refuses to change files until the defaults are fetched', () => {
    ui.setOptions(eq, pack, ['Hotbar + Bag 1 slots']);
    fs.rmSync(path.join(root(), '.mimic-defaults'), { recursive: true, force: true });
    const s = state();
    expect(s.ready).toBe(false);
    expect(s.choices.some(c => c.applied)).toBe(false);
    expect(() => ui.setOptions(eq, pack, [])).toThrow(/default files/);
    expect(main('EQUI_HotButtonWnd.xml')).toBe('HOTBAR BAG1');
  });

  it('never offers the defaults folder itself as an option', () => {
    expect(state().choices.some(c => /mimic-defaults/.test(c.id))).toBe(false);
  });
});
