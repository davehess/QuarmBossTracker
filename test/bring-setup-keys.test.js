// The bring-in card's key decisions (apps/mimic/bring-setup.js) and the main-process rules around them, for
// per-character-keys backups brought onto a PC that shares one key set. Invented names throughout.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, stripJs, sliceBlock, ROOT } from './_source-slice.js';

const src = readSource(path.join(ROOT, 'apps/mimic/bring-setup.js'));
const w = { mimic: {} };
new Function('window', src)(w);
const decide = w.wpBringSetup._keysDecision;
const per = { backupPerChar: true, hasOwn: true };
const shared = { backupPerChar: false, hasOwn: false };

describe('keysDecision', () => {
  const two = [{ character: 'Aldenmar', info: per }, { character: 'Brackwyn', info: per }];
  it('shared-keys PC, two per-character backups: own keys is the default, no character runs the shared keybinds part', () => {
    const d = decide(two, { pcShared: true, split: null });
    expect(d).toMatchObject({ need: true, useSplit: true, own: ['Aldenmar', 'Brackwyn'] });
    expect(d.keybinds).toEqual({ Aldenmar: false, Brackwyn: false });
  });
  it('unticked: only the picked character runs keybinds, the others none', () => {
    const d = decide(two, { pcShared: true, split: false, keyChar: 'Brackwyn' });
    expect(d).toMatchObject({ useSplit: false, keyChar: 'Brackwyn' });
    expect(d.keybinds).toEqual({ Aldenmar: false, Brackwyn: true });
    expect(decide(two, { pcShared: true, split: false, keyChar: 'Nobody' }).keyChar).toBe('Aldenmar');   // an unknown pick falls to the first
  });
  it('a PC that already keeps keys per character, or shared backups, need no decision', () => {
    expect(decide(two, { pcShared: false, split: null })).toMatchObject({ need: false, useSplit: false });
    expect(decide(two, { pcShared: false, split: null }).keybinds).toEqual({ Aldenmar: true, Brackwyn: true });
    const s = decide([{ character: 'Aldenmar', info: shared }], { pcShared: true, split: null });
    expect(s).toMatchObject({ need: false });
    expect(s.keybinds).toEqual({ Aldenmar: true });
  });
  it('a per-character backup with no keys of its own is named, and brings no keys', () => {
    const d = decide([{ character: 'Aldenmar', info: per }, { character: 'Corvale', info: { backupPerChar: true, hasOwn: false } }], { pcShared: true, split: false });
    expect(d.noKeys).toEqual(['Corvale']);
    expect(d.own).toEqual(['Aldenmar']);
    expect(d.keybinds.Corvale).toBe(false);
  });
  it('M1: picker mode: only the picked character gets keybinds, even a shared-keys backup; the picker lists it; skipped says who', () => {
    const mixed = [{ character: 'Aldenmar', info: per }, { character: 'Corvale', info: shared }, { character: 'Brackwyn', info: per }];
    const d = decide(mixed, { pcShared: true, split: false, keyChar: 'Aldenmar' });
    expect(d.choices).toEqual(['Aldenmar', 'Corvale', 'Brackwyn']);
    expect(d.keybinds).toEqual({ Aldenmar: true, Corvale: false, Brackwyn: false });
    expect(d.skipped).toEqual(['Corvale', 'Brackwyn']);
    expect(decide(mixed, { pcShared: true, split: false, keyChar: 'Corvale' }).keybinds).toEqual({ Aldenmar: false, Corvale: true, Brackwyn: false });
  });
  it('M2: without a zeal.ini the split is not offered: the picker is the mode', () => {
    const d = decide(two, { pcShared: true, split: null, pcZeal: false });
    expect(d).toMatchObject({ need: true, canSplit: false, useSplit: false, keyChar: 'Aldenmar' });
    expect(d.keybinds).toEqual({ Aldenmar: true, Brackwyn: false });
  });
  it('unknown plans (null info) change nothing', () => {
    expect(decide([{ character: 'Aldenmar', info: null }], { pcShared: true }).need).toBe(false);
  });
});

describe('the card runs one shared step, then each character', () => {
  const tick = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 0)); };
  function page() {
    const handlers = {}, stubs = {};
    const el = {
      html: '', set innerHTML(v) { this.html = v; }, get innerHTML() { return this.html; },
      querySelector(sel) { return stubs[sel] || (stubs[sel] = { style: {}, checked: false, dataset: {}, innerHTML: '', querySelector() { return null; }, addEventListener(ev, fn) { handlers[sel + ev] = fn; } }); },
      querySelectorAll() { return []; },
    };
    return { el, handlers, stubs };
  }
  const chars = ['Aldenmar', 'Brackwyn'].map((n, i) => ({ character: n, onThisPc: false, latestFull: { id: 'b' + i, created_at: '2026-11-10T00:00:00Z', machine_name: 'OTHERPC' }, machines: [{ machine_name: 'OTHERPC', latestFull: { id: 'b' + i }, list: [{ id: 'b' + i }] }], local: [] }));
  function boot(pcPerCharKeys, opt = {}) {
    const calls = [], planCalls = [];
    w2.mimic = {
      uiAccountCharacters: async () => ({ ok: true, eqDir: 'C:/EQ', otherAccountsOnPc: false, pcPerCharKeys, thisPc: { machine: 'THISPC' }, parts: ['layout', 'zealchar'], characters: opt.chars || chars,
        ...(opt.pcHasZealIni === undefined ? {} : { pcHasZealIni: opt.pcHasZealIni }) }),
      uiRestorePlan: async (req) => { planCalls.push(req); return { ok: true, keys: (opt.keysOf && opt.keysOf(req.character)) || { backupPerChar: true, hasOwn: true, pcPerChar: false }, parts: ['layout', 'zealchar', 'zeal', 'keybinds'].map(key => ({ key, inBackup: 1 })) }; },
      uiRestoreParts: async (p) => { calls.push(p); return { ok: true, queued: false, files: [{ name: 'x.ini', parts: [] }], savedCopies: [] }; },
    };
    const win = { mimic: w2.mimic };
    new Function('window', src)(win);
    return { win, calls, planCalls };
  }
  const mk = (names, machine, perChar = true) => names.map((n, i) => ({ character: n, onThisPc: false, latestFull: { id: 'x' + n + i, created_at: '2026-11-10T00:00:00Z', machine_name: machine }, machines: [{ machine_name: machine, latestFull: { id: 'x' + n + i }, list: [{ id: 'x' + n + i }] }], local: [] }));
  const w2 = {};
  const go = async (pg) => { pg.handlers['[data-wpbs-go]click']({ target: { disabled: false } }); await tick(); };

  it('the key tick starts unticked when a backup came from another PC', async () => {
    const { win } = boot(false);
    const pg = page();
    await win.wpBringSetup.mount(pg.el, {});
    expect(pg.el.html).not.toMatch(/data-wpbs-keys checked/);
  });
  it('own keys: the first call is the shared step alone, and no character asks for keybinds', async () => {
    const { win, calls } = boot(false);
    const pg = page();
    await win.wpBringSetup.mount(pg.el, {});
    pg.stubs['[data-wpbs-keys]'].checked = true;
    await go(pg);
    expect(calls[0].parts).toEqual(['keysplit']);
    expect(calls.filter(c => c.parts.includes('keysplit'))).toHaveLength(1);
    const rest = calls.slice(1);
    expect(rest.map(c => c.character)).toEqual(['Aldenmar', 'Brackwyn']);
    expect(rest.every(c => !c.parts.includes('keybinds') && c.parts.includes('zealchar'))).toBe(true);
  });
  it('M3: each plan is requested once per card paint, however many characters, and the run reuses them', async () => {
    const names = ['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin'];
    const { win, calls, planCalls } = boot(false, { chars: mk(names, 'THISPC') });     // a same-PC backup: the key tick starts on
    const pg = page();
    await win.wpBringSetup.mount(pg.el, {});
    await tick();
    expect(planCalls).toHaveLength(6);
    let atFirstWrite = -1;
    const orig = win.mimic.uiRestoreParts;
    win.mimic.uiRestoreParts = (p) => { if (atFirstWrite < 0) atFirstWrite = planCalls.length; return orig(p); };
    await go(pg);
    expect(atFirstWrite).toBe(6);            // the run read no plan again before it wrote
    expect(calls.length).toBeGreaterThan(0);
  });
  it('M2: no zeal.ini on this PC: no "own keys" choice, the picker with a note, only the picked character gets keybinds', async () => {
    const { win, calls } = boot(false, { chars: mk(['Aldenmar', 'Brackwyn'], 'OTHERPC'), pcHasZealIni: false });
    const pg = page();
    await win.wpBringSetup.mount(pg.el, {});
    pg.stubs['[data-wpbs-keys]'].checked = true;
    await go(pg);
    expect(calls.some(c => c.parts.includes('keysplit'))).toBe(false);
    expect(calls.filter(c => c.parts.includes('keybinds')).map(c => c.character)).toEqual(['Aldenmar']);
  });
  it('M1: picker mode, a shared-keys backup does not overwrite the picked character\'s keys, and the result line says whose were not brought', async () => {
    const keysOf = (n) => n === 'Corvale' ? { backupPerChar: false, hasOwn: false, pcPerChar: false } : { backupPerChar: true, hasOwn: true, pcPerChar: false };
    const { win, calls } = boot(false, { chars: mk(['Aldenmar', 'Corvale'], 'OTHERPC'), pcHasZealIni: false, keysOf });
    const pg = page();
    await win.wpBringSetup.mount(pg.el, {});
    pg.stubs['[data-wpbs-keys]'].checked = true;
    await go(pg);
    expect(calls.filter(c => c.parts.includes('keybinds')).map(c => c.character)).toEqual(['Aldenmar']);
    expect(pg.el.html).toMatch(/key bindings not brought for Corvale/);
  });
  it('a same-PC backup starts with "own keys" unticked; another PC\'s starts ticked', async () => {
    const same = boot(false, { chars: mk(['Aldenmar', 'Brackwyn'], 'THISPC') });
    const pg = page();
    await same.win.wpBringSetup.mount(pg.el, {});
    await tick();
    expect(pg.stubs['[data-wpbs-keysub]'].innerHTML).toMatch(/Use the keys of/);
    expect(pg.stubs['[data-wpbs-keysub]'].innerHTML).not.toMatch(/data-wpbs-split checked/);
    const other = boot(false, { chars: mk(['Aldenmar', 'Brackwyn'], 'OTHERPC') });
    const pg2 = page();
    await other.win.wpBringSetup.mount(pg2.el, {});
    pg2.stubs['[data-wpbs-keys]'].checked = true;
    pg2.handlers['[data-wpbs-keys]change']({ target: pg2.stubs['[data-wpbs-keys]'] });
    await tick();
    expect(pg2.stubs['[data-wpbs-keysub]'].innerHTML).toMatch(/data-wpbs-split checked/);
  });
  it('the key tick follows the picked backup until it is touched', async () => {
    const c = mk(['Aldenmar'], 'OTHERPC')[0];
    c.machines.push({ machine_name: 'THISPC', latestFull: { id: 'mine' }, list: [{ id: 'mine' }] });
    const { win } = boot(false, { chars: [c] });
    const pg = page();
    const radios = ['xAldenmar0', 'mine'].map(v => ({ name: 'wpbs-aldenmar', value: v, addEventListener(ev, fn) { this.fn = fn; } }));
    pg.el.querySelectorAll = (sel) => sel === 'input[type=radio]' ? radios : [];
    await win.wpBringSetup.mount(pg.el, {});
    const cb = pg.stubs['[data-wpbs-keys]'];
    expect(cb.checked).toBe(false);                                   // the default backup is another PC's
    radios[1].fn();                                                    // pick the backup made on this PC
    expect(cb.checked).toBe(true);
    radios[0].fn();                                                    // and back: the tick follows
    expect(cb.checked).toBe(false);
    radios[1].fn();
    expect(cb.checked).toBe(true);
    pg.handlers['[data-wpbs-keys]change']({ target: { checked: true } });    // the member ticks it themselves: now it stays theirs
    radios[0].fn();
    expect(cb.checked).toBe(true);
  });
  it('a PC that already keeps keys per character has no shared step', async () => {
    const { win, calls } = boot(true);
    const pg = page();
    await win.wpBringSetup.mount(pg.el, {});
    pg.stubs['[data-wpbs-keys]'].checked = true;
    await go(pg);
    expect(calls.some(c => c.parts.includes('keysplit'))).toBe(false);
    expect(calls.every(c => c.parts.includes('keybinds'))).toBe(true);
  });
});

describe('main.js wiring (stripped source)', () => {
  const main = stripJs(readSource(path.join(ROOT, 'apps/mimic/main.js')));
  it('quiet keep-in-sync never writes the keybinds part of a per-character backup onto a shared-keys PC', () => {
    const b = sliceBlock(main, "if (sc.newer === 'quiet') {", 'continue;\n      }');
    expect(b).toMatch(/keysInfo\(full\.files/);
    expect(b).toMatch(/ki\.backupPerChar && !ki\.pcPerChar/);
    expect(b).toMatch(/filter\(k => k !== 'keybinds'\)/);
  });
  it('the deferred tick applies the keysplit entry first, and holds other shared halves while it waits', () => {
    const b = sliceBlock(main, 'async function _tickUiDeferred() {', '\n}\n');
    expect(b).toMatch(/_uiDeferred\.filter\(isSplit\)\.concat\(_uiDeferred\.filter\(e => !isSplit\(e\)\)\)/);
    expect(b).toMatch(/splitWaiting && entry\.kind === 'restore' && _uiNeedsEqClosed\(entry\.parts\)/);
  });
  it('the account answer says whether this PC has a zeal.ini', () => {
    expect(main).toMatch(/pcHasZealIni: .*perCharFlag\(.*\) !== null/);
  });
  it('the shared step waits for every EverQuest to close and does not replace a character\'s queued keys', () => {
    expect(sliceBlock(main, 'function _uiNeedsEqClosed(parts) {', '\n}\n')).toMatch(/'keysplit'/);
    expect(sliceBlock(main, 'function _queueUiRestore(entry) {', '\n}\n')).toMatch(/isSplit\(e\.parts\) === isSplit\(entry\.parts\)/);
  });
});
