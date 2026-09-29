// test/canvas-pieces.test.js — every data element as a piece on the Timers canvas (Mimic 3.0 alpha).
//
// The guild lead, 2026-09-29: "break them up and put them into categorization like we did with the HUD.
// My Info, Group info, Raid info, target info, pet info, charm info, etc. Make it a persistent chooser that i
// can pull up and move things around, then select the mode for the data. break out every data element. …
// it should feel like i'm putting down individual legos instead of prebuilt pieces, then be able to save
// groups. Start with the groups of our overlays today and let me pull pieces out as well."
//
// Run: npx vitest run test/canvas-pieces.test.js

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const canvas  = readSource(path.join(ROOT, 'apps', 'mimic', 'canvas.html'));
const main    = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const preload = readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js'));

let W;
beforeAll(() => {
  globalThis.window = globalThis;
  require(path.join(ROOT, 'apps', 'mimic', 'parts.js'));
  W = globalThis.WpParts;
});

describe('the parts library (parts.js), run for real', () => {
  it('pieces in every category the guild lead named, and today\'s overlays as groups', () => {
    const cats = new Set(W.PARTS.map(p => p.cat));
    for (const c of ['me', 'group', 'raid', 'target', 'pet', 'charm']) expect(cats.has(c)).toBe(true);
    expect(W.PARTS.length).toBeGreaterThanOrEqual(100);
    const presets = W.PRESETS.map(g => g.name);
    for (const n of ['Tank', 'Target Info', 'Charm', 'DPS HUD', 'Command Center', 'Buff queue', '/who', 'CH chain']) expect(presets).toContain(n);
  });
  it('every group names real pieces, in modes those pieces have', () => {
    for (const g of W.PRESETS) for (const a of g.parts) {
      const d = W.byId[a[0]];
      expect(d, g.id + ' → ' + a[0]).toBeTruthy();
      expect(W.MODES[d.kind].map(m => m[0]), g.id + ' → ' + a[0]).toContain(a[1]);
    }
  });
  it('every piece reads a known source, draws its sample in every mode, and survives missing data', () => {
    const now = Date.now();
    for (const d of W.PARTS) {
      expect(W.SOURCES[d.src], d.id).toBeTruthy();
      const s = typeof d.sample === 'function' ? d.sample(now) : d.sample;
      expect(s, d.id + ' sample').toBeTruthy();
      for (const [mode] of W.MODES[d.kind]) expect(W.render(d, mode, s, now), d.id + ' ' + mode).toMatch(/class="pt /);
      for (const data of [{}, { character: null }, { character: 'X', target: {} }, { activeCharacter: 'x', charmPets: [], petHealth: [] }]) {
        expect(() => d.get(data, now), d.id).not.toThrow();
      }
    }
  });
});

describe('pieces read the agent\'s real fields', () => {
  const at = Date.now();
  const me = { character: 'Aldenmar', level: 60, class: 'Enchanter', hp: { pct: 84, cur: 3512, max: 4180 }, mana: { pct: 62 },
    tick: { ms_left: 3800, period_ms: 6000 }, cooldowns: [{ key: 'fd', label: 'Feign Death', ms_left: 7000, total_ms: 10000, seen: true }],
    target: { name: 'a burning guardian', hp_pct: 37, slow: { pct: 75, remaining_secs: 130 } }, group: [{ name: 'Brackwyn', hp_pct: 71 }] };
  it('my info, target, group, timers', () => {
    expect(W.byId['me.hp'].get(me, at)).toMatchObject({ pct: 84, text: '3,512 / 4,180' });
    expect(W.byId['me.mana'].get({ ...me, no_mana: true }, at)).toBeNull();
    expect(W.byId['target.hp'].get(me, at)).toMatchObject({ pct: 37, label: 'a burning guardian' });
    expect(W.byId['target.slow'].get(me, at)).toMatchObject({ text: 'slowed 75%', sub: '2:10' });
    expect(W.byId['group.m1'].get(me, at)).toMatchObject({ pct: 71, label: 'Brackwyn' });
    expect(W.byId['group.m2'].get(me, at)).toBeFalsy();
    expect(W.byId['tick.server'].get(me, at)).toEqual({ endAt: at + 3800, period: 6000, label: 'Tick' });
    expect(W.byId['me.cd_fd'].get(me, at)).toMatchObject({ endAt: at + 7000, total: 10000, doneText: 'ready' });
  });
  it('the fight meter ranks by damage and marks the character in front', () => {
    const st = { activeCharacter: 'Aldenmar', currentEncounterThreat: { startedAt: new Date(at - 40000).toISOString(), flushedAt: null,
      perPlayer: { Rethlan: { dmg: 14000 }, Aldenmar: { dmg: 9800 }, Gobaner: { dmg: 500, pet_owner: 'Aldenmar' } } } };
    const r = W.byId['fight.dps'].get(st, at);
    expect(r.items.map(i => [i.name, !!i.hi])).toEqual([['1. Rethlan', false], ['2. Aldenmar', true]]);
    expect(W.byId['fight.mine'].get(st, at)).toMatchObject({ text: '#2' });
  });
  it('charm and pet pieces follow the character EQ has in front', () => {
    const st = { activeCharacter: 'Aldenmar', charmPets: [
      { pet: 'a goblin', owner: 'Brackwyn', is_active: true, started_at: at - 1000, duration_sec: 60, pet_hp_pct: 10 },
      { pet: 'a goblin mystic', owner: 'Aldenmar', is_active: true, started_at: at - 48000, duration_sec: 90, pet_hp_pct: 93 }],
      petHealth: [{ owner: 'aldenmar', pet: 'Gobaner', target: 'a bat', target_at: at }] };
    expect(W.byId['charm.pet'].get(st, at)).toMatchObject({ pct: 93, label: 'a goblin mystic' });
    expect(W.byId['charm.breaks'].get(st, at)).toMatchObject({ endAt: at - 48000 + 90000, total: 90000 });
    expect(W.byId['pet.target'].get(st, at)).toMatchObject({ text: '→ a bat' });
  });
  it('main tank, healing, raid', () => {
    const tank = { mt: { name: 'Brackwyn', hp_pct: 64, hp_cur: 5120, hp_max: 8000, buffs: [] }, deathtouch: { target: 'Brackwyn', seconds: 21 },
      ch_chain: { target: 'Brackwyn', due_in_ms: 3200, beat_ms: 6000, urgency: 'green' } };
    expect(W.byId['tank.mt'].get(tank, at)).toMatchObject({ pct: 64, label: 'MT Brackwyn', text: '5,120 / 8,000' });
    expect(W.byId['tank.dt'].get(tank, at)).toMatchObject({ endAt: at + 21000 });
    expect(W.byId['heal.chdue'].get(tank, at)).toMatchObject({ endAt: at + 3200, total: 6000, label: 'CH due on Brackwyn' });
    expect(W.byId['heal.mana'].get({ healer_mana: [{ name: 'Corvale', pct: 15 }] }, at).items[0]).toMatchObject({ pct: 15, color: W.C.red });
  });
});

describe('modes', () => {
  const now = 1_000_000;
  it('a repeating countdown wraps (server tick); an expired one says its done text', () => {
    expect(W.resolve('countdown', { endAt: now - 1000, period: 6000 }, now)).toMatchObject({ text: '5' });
    expect(W.resolve('countdown', { endAt: now - 5, total: 60000, doneText: 'ready' }, now)).toMatchObject({ text: 'ready', color: W.C.green });
    expect(W.resolve('countdown', { endAt: now + 30000, total: 60000 }, now)).toMatchObject({ pct: 50, text: '0:30' });
  });
  it('a health gauge as a big number or a ring shows its percent, the long text underneath', () => {
    const d = W.byId['me.hp'], v = { pct: 84, text: '3,512 / 4,180' };
    expect(W.render(d, 'big', v, now)).toMatch(/pt-bv[^>]*>84%<\/div>[\s\S]*3,512 \/ 4,180/);
    expect(W.render(d, 'ring', v, now)).toMatch(/class="pt-rv">84%</);
    expect(W.render(d, 'bar', v, now)).toMatch(/3,512 \/ 4,180/);
  });
});

describe('the canvas places pieces', () => {
  it('keeps piece panels and the chooser through sanitize', () => {
    const r = evalBlock('var window = {};\n' + sliceBlock(canvas, '  var GROUPS = [', '  // ── Panels ──'), ['sanitize']);
    const s = r.sanitize({ panels: [
      { id: 'a', kind: 'part', part: 'me.hp', mode: 'ring', x: 0.1, y: 0.2, w: 96, h: 96, grp: 'g1' },
      { id: 'b', kind: 'part', part: '../x', mode: 'bar', x: 0, y: 0, w: 10, h: 10 },
      { id: 'c', kind: 'part', part: 'me.hp', mode: 'BAD MODE', x: 0, y: 0, w: 1, h: 1, scale: 9 },
    ], chooser: { open: false, x: 0.5, y: 0.5, tab: 'target' } });
    const parts = s.panels.filter(p => p.kind === 'part');
    expect(parts.map(p => [p.id, p.part, p.mode, p.grp])).toEqual([['a', 'me.hp', 'ring', 'g1'], ['c', 'me.hp', '', null]]);
    expect(parts[1]).toMatchObject({ w: 40, h: 16, scale: 3 });
    expect(s.chooser).toEqual({ open: false, x: 0.5, y: 0.5, tab: 'target' });
  });
  it('a group goes down as separate pieces sharing one group id, laid out as the overlay was', () => {
    const block = 'var window = { innerWidth: 1000, innerHeight: 1000 }; var MAX_PANELS = 150; var _layout = { panels: [] };\n'
      + 'function num(v, lo, hi, d) { v = Number(v); return (isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d); }\n'
      + sliceBlock(canvas, '  function newId(prefix)', '  function dropThing(what, X, Y) {').replace(/  function dropThing\(what, X, Y\) \{$/, '');
    const r = new Function('WpParts', block + '\nreturn { addPart, placeGroup, presetPiece, _layout };')(W);
    const tank = W.PRESETS.find(g => g.id === 'tank');
    r.placeGroup(tank.parts.map(r.presetPiece), 100, 200);
    const ps = r._layout.panels;
    expect(ps.length).toBe(tank.parts.length);
    expect(ps[0].grp).toMatch(/^g/);
    expect(new Set(ps.map(p => p.grp)).size).toBe(1);
    expect(ps[0]).toMatchObject({ kind: 'part', part: 'tank.mt', mode: 'bar', x: 0.1, y: 0.2 });
    expect(ps[1].y).toBeCloseTo(0.2 + tank.parts[1][3] / 1000, 5);
    // One piece alone takes its mode's default size; an unknown mode falls back to the piece's first.
    const one = r.addPart('target.hp', 'nope', 500, 500, null);
    expect(one).toMatchObject({ mode: 'bar', w: 220, h: 34, grp: null });
  });
  it('polls a source only while a placed piece, or the chooser\'s open tab, needs it', () => {
    const fn = sliceBlock(canvas, '  function neededSources() {', '\n  }\n');
    const run = (layout, edit, tab) => new Function('WpParts', '_layout', '_edit', 'partDef', 'chooserState', 'chooserShown',
      fn + '\nreturn neededSources();')(W, layout, edit, (p) => W.byId[p.part], () => ({ open: true, tab }), () => edit);
    expect(run({ panels: [{ kind: 'part', part: 'me.hp' }, { kind: 'part', part: 'tank.mt', off: true }] }, false, 'groups')).toEqual({ me: true });
    expect(Object.keys(run({ panels: [] }, true, 'charm'))).toEqual(['state']);
    expect(run({ panels: [] }, false, 'charm')).toEqual({});
  });
  // The guild lead, 2026-09-29 (round two): "I should also be able to drag the whole group … at the same
  // time instead of grabbing the top one and having it get disconnected" and "select multiple pieces, lock
  // them together (and not necessarily touching) and move them at the same time".
  it('a drag moves the selection it is in, else its whole group, else just itself', () => {
    const fn = sliceBlock(canvas, '  function togetherWith(id) {', '\n  }\n');
    const run = (panels, sel, id) => new Function('_sel', '_layout', 'panelById',
      fn + '\nreturn togetherWith(' + JSON.stringify(id) + ');')(sel, { panels }, (k) => panels.find(p => p.id === k) || null);
    const P = [{ id: 'a', grp: 'g1' }, { id: 'b', grp: 'g1' }, { id: 'c', grp: 'g1' }, { id: 'd' }, { id: 'e' }];
    expect(run(P, {}, 'b')).toEqual(['a', 'b', 'c']);
    expect(run(P, {}, 'd')).toEqual(['d']);
    expect(run(P, { d: true, e: true }, 'e')).toEqual(['d', 'e']);
    expect(run(P, { d: true, e: true }, 'a')).toEqual(['a', 'b', 'c']);   // not in the selection: its group
    expect(run(P, { d: true }, 'd')).toEqual(['d']);                        // a selection of one is just itself
    const c = stripJs(canvas);
    expect(c).toMatch(/if \(!ev\.altKey\) ids = togetherWith\(id\);/);
    expect(c).toMatch(/if \(d\.moved && d\.alt && p && p\.grp\) \{ p\.grp = null;/);
  });
  // The guild lead, 2026-09-29: "when a group is selected by grabbing the top bar you should be able to
  // resize the entire group".
  it('sizing a group stretches every piece from the group\'s top-left corner', () => {
    const { groupBox, scaleGroup } = evalBlock(
      sliceBlock(canvas, '  function groupBox(ms) {', '\n  }\n') + '\n'
      + sliceBlock(canvas, '  function scaleGroup(ms, box, w, h, keep, minW, minH) {', '\n  }\n'),
      ['groupBox', 'scaleGroup']);
    const ms = [
      { id: 'a', x0: 100, y0: 100, w0: 200, h0: 20, sc0: 1 },
      { id: 'b', x0: 100, y0: 124, w0: 200, h0: 40, sc0: 1 },
      { id: 'c', x0: 100, y0: 168, w0: 300, h0: 32, sc0: 1.2 },
    ];
    const box = groupBox(ms);
    expect(box).toEqual({ x: 100, y: 100, w: 300, h: 100 });
    // Twice as tall: every piece doubles in height and moves down in proportion; text doubles.
    const tall = scaleGroup(ms, box, 300, 200, false);
    expect(tall.map(n => [n.x, n.y, n.w, n.h, n.scale])).toEqual([
      [100, 100, 200, 40, 2], [100, 148, 200, 80, 2], [100, 236, 300, 64, 2.4]]);
    // Wider only: boxes widen, text stays.
    const wide = scaleGroup(ms, box, 450, 100, false);
    expect(wide.map(n => [n.w, n.h, n.scale])).toEqual([[300, 20, 1], [300, 40, 1], [450, 32, 1.2]]);
    // Shift keeps the shape: the larger factor both ways.
    const keep = scaleGroup(ms, box, 450, 100, true);
    expect(keep.map(n => [n.w, n.h])).toEqual([[300, 30], [300, 60], [450, 48]]);
    const c = stripJs(canvas);
    expect(c).toMatch(/if \(mode === 'size'\) _drag\.box = groupBox\(_drag\.members\);/);
    expect(c).toMatch(/if \(q && m\.w != null\) \{ q\.w = m\.w; q\.h = m\.h; if \(q\.kind === 'part'\) q\.scale = m\.scale; \}/);
    // A click on a grouped piece selects its whole group; the box's ◢ sizes the selection.
    expect(c).toMatch(/\(d\.alt \? \[p\.id\] : togetherWith\(p\.id\)\)\.forEach/);
    expect(c).toMatch(/if \(ids\.length > 1\) startDrag\(ev, ids\[0\], 'size'\);/);
  });
  it('✕ on a piece deletes it, and Undo puts it back where it was', () => {
    const block = sliceBlock(canvas, '  function removable(q) {', "  document.getElementById('undoBtn')");
    const env = new Function('_layout', '_sel', 'toastEl', 'toastMsg', 'partDef', 'save', 'render',
      'var _undo = null, _undoT = null;\n' + block.replace(/  document\.getElementById\('undoBtn'\)$/, '') + '\nreturn { removePanels, undoRemove };');
    const layout = { panels: [{ id: 'callouts', kind: 'callouts' }, { id: 'all', kind: 'timers', all: true }, { id: 'p1', kind: 'part', part: 'me.hp' }, { id: 'p2', kind: 'part', part: 'me.mana' }] };
    const toast = { classList: { add() {}, remove() {} } }, msg = {};
    const r = env(layout, { p1: true }, toast, msg, () => ({ label: 'My health' }), () => {}, () => {});
    r.removePanels(['p1', 'callouts', 'all']);
    expect(layout.panels.map(p => p.id)).toEqual(['callouts', 'all', 'p2']);   // the two fixed panels stay
    expect(msg.textContent).toBe('Deleted My health');
    r.undoRemove();
    expect(layout.panels.map(p => p.id)).toEqual(['callouts', 'all', 'p1', 'p2']);
    const c = stripJs(canvas);
    expect(c).toMatch(/if \(q\.kind === 'part'\) \{ removePanels\(\[q\.id\]\); return; \}\s*q\.off = !q\.off;/);
  });
  it('the selection bar locks pieces together, unlocks them, saves them as a group, deletes them', () => {
    const c = stripJs(canvas);
    expect(c).toMatch(/if \(a === 'lock'\) \{ var g = newId\('g'\); ids\.forEach\(function \(id\) \{ panelById\(id\)\.grp = g; \}\);/);
    expect(c).toMatch(/else if \(a === 'unlock'\) \{ ids\.forEach\(function \(id\) \{ panelById\(id\)\.grp = null; \}\);/);
    expect(c).toMatch(/else if \(a === 'save'\) \{ var inp = document\.getElementById\('selName'\); saveSelectionAsGroup\(/);
    expect(c).toMatch(/if \(d\.add\) \{ if \(_sel\[p\.id\]\) delete _sel\[p\.id\]; else _sel\[p\.id\] = true; \}\s*else \{ _sel = \{\}; \(d\.alt \? \[p\.id\] : togetherWith\(p\.id\)\)/);
  });
  // "I have no way of bringing up the overlay editing other than the taskbar now" and "I need a faster way
  // to get to the editing mode for individual components".
  it('editing is one click away: ✥ opens the settings, which can start arranging; every overlay\'s menu too; /pipe mimic edit', () => {
    const c = stripJs(canvas);
    expect(c).toMatch(/if \(d\.fromMv && !_edit\) \{ render\(\); if \(_els\[p\.id\]\) openMenu\(p\.id, _els\[p\.id\]\.mv\); return; \}/);
    expect(c).toMatch(/data-arrange="1"[^']*✏ Arrange the canvas/);
    expect(c).toMatch(/if \(t\.getAttribute\('data-arrange'\) === '1'\) \{ try \{ if \(M\.canvasEdit\) M\.canvasEdit\(true\); \}/);
    expect(c).toMatch(/root\.addEventListener\('dblclick', function \(ev\) \{ if \(_edit && !ev\.target\.closest\('\.ctl'\)\) openMenu\(p\.id, root\); \}\);/);
    expect(stripJs(preload)).toMatch(/mkItem\('🧩 Arrange the canvas \(pieces\)', '#1f3d57', \(\) => ipcRenderer\.invoke\('canvas-edit', true\)\)/);
    const sets = require(path.join(ROOT, 'apps', 'mimic', 'overlaySets.js'));
    expect(sets.parsePipeCommand('mimic edit')).toEqual({ verb: 'edit', on: null });
    expect(sets.parsePipeCommand('mimic arrange done')).toEqual({ verb: 'edit', on: false });
    expect(sliceBlock(stripJs(main), "  if (cmd.verb === 'edit') {", '\n  }\n')).toMatch(/_setCanvasArrange\(on\);/);
  });
});

describe('main and preload', () => {
  const m = stripJs(main);
  it('saved groups: one list, only the canvas writes it, bounded', () => {
    const save = sliceBlock(m, "ipcMain.handle('canvas-groups-save', (e, groups) => {", '\n});');
    expect(save).toMatch(/BrowserWindow\.fromWebContents\(e\.sender\) !== canvasWindow\) return false;/);
    expect(save).toMatch(/groups\.length > 60\) return false;/);
    expect(save).toMatch(/json\.length > 128_000\) return false;/);
    expect(save).toMatch(/cfg\.canvasGroups = JSON\.parse\(json\);/);
    expect(stripJs(preload)).toMatch(/canvasGroupsSave:\s+\(groups\) => ipcRenderer\.invoke\('canvas-groups-save', groups\),/);
  });
  it('the canvas loads the library before its own script', () => {
    expect(canvas.indexOf('<script src="parts.js"></script>')).toBeGreaterThan(0);
    expect(canvas.indexOf('<script src="parts.js"></script>')).toBeLessThan(canvas.indexOf('var M = window.mimic || {};'));
  });
});
