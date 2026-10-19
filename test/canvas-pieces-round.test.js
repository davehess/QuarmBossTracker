// test/canvas-pieces-round.test.js — the Pieces round on the Mimic 3.0 alpha Canvas (2026-10-18).
//
// Seven asks from the guild lead, all in apps/mimic/canvas.html:
//   A  "backing changes spacing instead of just background"      → a plate adds no padding or border
//   B  "select the whole group and say slim bar or upright bar"  → bulkSet over a set of pieces
//   C  save a changed grouping as a new version, or rename it    → uniqueGroupName, duplicate, rename, update
//   D  pieces in the palette drawn with the client's real data    → paintChooserPreviews (the same render call)
//   E  a line between a row and where its piece is                → placedFor finds the pieces of a row
//   F  clicking a placed group shows where it is                  → clickLocates / locate / whereText
//   G  deleting a saved group can take its pieces, with Undo      → deleteSavedGroup + undoRemove
// Everything below runs the REAL functions sliced out of canvas.html against fakes (no Electron, no DOM), so a
// comment cannot satisfy any of it. The one CSS assertion reads the rule's declarations, comments stripped.
//
// Run: npx vitest run test/canvas-pieces-round.test.js
import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, ROOT, sliceBlock, stripCss } from './_source-slice.js';

const require = createRequire(import.meta.url);
const canvasRaw = readSource(path.join(ROOT, 'apps', 'mimic', 'canvas.html'));
globalThis.window = globalThis;
require(path.join(ROOT, 'apps', 'mimic', 'parts.js'));
const WpParts = globalThis.WpParts;
const slice = (start, end = '\n  }\n') => sliceBlock(canvasRaw, start, end);
const num = (v, lo, hi, d) => { v = Number(v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };

// ── A ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('A: backing is only a plate', () => {
  const css = stripCss(canvasRaw);
  const body = (sel) => { const m = css.match(new RegExp(sel.replace(/[.>]/g, '\\$&') + '\\{([^}]*)\\}')); return m ? m[1] : null; };
  it('the plate adds no padding, border or margin of its own: the box and content area are the same with or without it', () => {
    const plain = body('.panel.part > .pbody'), back = body('.panel.part.back > .pbody');
    expect(plain).toMatch(/padding:1px 3px/);
    expect(back).toMatch(/background:rgba\(13,17,23,var\(--bg-alpha,0\.72\)\)/);
    expect(back).not.toMatch(/padding|margin|(?:^|;)\s*border\s*:|border-width/);
    // the outline is drawn, not laid out
    expect(back).toMatch(/box-shadow:inset 0 0 0 1px/);
  });
  it('a Ring arc keeps its plate clear of any outline, and its padding at 0 either way', () => {
    expect(body('.panel.part.seg > .pbody')).toMatch(/padding:0/);
    expect(body('.panel.part.seg.back > .pbody')).toMatch(/box-shadow:none/);
  });
});

// ── B ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('B: one choice for a whole group', () => {
  const src = slice('  function bulkPatch(kind, v) {', '  var BULK_THICK');
  const env = () => new Function('WpParts', 'window', 'num', 'function partDef(p) { return WpParts.byId[p.part]; }\n' + src + '\nreturn { bulkPatch, bulkModes, bulkSet };')(
    WpParts, { innerWidth: 1000, innerHeight: 800 }, num);
  const mk = (id, part, mode, y, w = 220, h = 34) => ({ id, kind: 'part', part, mode, x: 0.1, y: y / 800, w, h, grp: 'g1' });
  const stack = () => [mk('a', 'me.hp', 'bar', 100), mk('b', 'me.mana', 'bar', 140), mk('c', 'me.end', 'bar', 180)];

  it('Upright bar stands the whole group up in a row, 6px apart, from the top-left', () => {
    const { bulkSet, bulkPatch } = env(), ps = stack();
    expect(bulkSet(ps, bulkPatch('mode', 'vbar'))).toEqual({ changed: 3, skipped: 0 });
    expect(ps.map(p => [p.mode, p.w, p.h])).toEqual(Array(3).fill(['vbar', 40, 120]));
    expect(ps.map(p => Math.round(p.x * 1000))).toEqual([100, 146, 192]);
    expect(ps.map(p => Math.round(p.y * 800))).toEqual([100, 100, 100]);
  });
  it('Slim bar brings them back to a column of slim bars at a bar\'s width, 4px apart', () => {
    const { bulkSet, bulkPatch } = env(), ps = stack();
    bulkSet(ps, bulkPatch('mode', 'vbar'));
    bulkSet(ps, bulkPatch('mode', 'thin'));
    expect(ps.map(p => [p.mode, p.w, p.h])).toEqual(Array(3).fill(['thin', 220, 18]));
    expect(ps.map(p => Math.round(p.y * 800))).toEqual([100, 122, 144]);
  });
  it('a piece that cannot be drawn that way keeps its look, is counted, and nothing is shuffled', () => {
    const { bulkSet, bulkPatch } = env(), ps = stack(), list = mk('d', 'charm.buffs', 'rows', 300, 260, 90);
    const before = ps.map(p => [p.x, p.y]);
    const res = bulkSet(ps.concat([list]), bulkPatch('mode', 'vbar'));
    expect(res.skipped).toBe(1);
    expect(list).toMatchObject({ mode: 'rows', w: 260, h: 90 });
    expect(ps.map(p => p.mode)).toEqual(['vbar', 'vbar', 'vbar']);
    expect(ps.map(p => [p.x, p.y])).toEqual(before);        // no reflow when not every piece changed shape
  });
  it('thickness, backing and the modes on offer', () => {
    const { bulkSet, bulkPatch, bulkModes } = env(), ps = stack();
    bulkSet(ps, bulkPatch('thick', 'thick')); expect(ps.map(p => p.thick)).toEqual(['thick', 'thick', 'thick']);
    bulkSet(ps, bulkPatch('thick', 'normal')); expect(ps.map(p => p.thick)).toEqual(['', '', '']);
    bulkSet(ps, bulkPatch('back', '1')); expect(ps.map(p => p.back)).toEqual([true, true, true]);
    bulkSet(ps, bulkPatch('back', '0')); expect(ps.map(p => p.back)).toEqual([false, false, false]);
    const ids = bulkModes(ps).map(m => m[0]);
    expect(ids).toEqual(expect.arrayContaining(['bar', 'thin', 'vbar']));
    expect(ids).not.toContain('seg');                       // a Ring arc needs the ring around it
    expect(bulkSet(ps, {})).toEqual({ changed: 3, skipped: 0 });
  });
});

// ── C ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('C: a grouping saved under a new name', () => {
  const src = slice('  function uniqueGroupName(base, exceptId) {');
  const mk = (names) => new Function('_groups', 'newId', src + '\nreturn uniqueGroupName;')(names.map((n, i) => ({ id: 's' + i, name: n })), () => 'abc123');
  it('a name is never shared, case-folded (the tray, the dashboard and /pipe find a group by it)', () => {
    expect(mk(['Command Center'])('Command Center')).toBe('Command Center copy');
    expect(mk(['Command Center'])('command center')).toBe('command center copy');
    expect(mk(['Command Center', 'Command Center copy'])('Command Center copy')).toBe('Command Center copy 2');
    expect(mk(['A', 'A copy', 'A copy 2'])('A')).toBe('A copy 3');
    expect(mk([])('Mine')).toBe('Mine');
  });
  it('it fits the 24 characters a saved group may have, and renaming a group to its own name is not a clash', () => {
    const long = 'Twenty four chars exactly';       // 25: cut to 24 first
    const names = mk([long.slice(0, 24)])(long);
    expect(names.length).toBeLessThanOrEqual(24);
    expect(names).not.toBe(long.slice(0, 24));
    expect(mk(['Mine'])('Mine', 's0')).toBe('Mine');
  });
});

describe('C: duplicate, rename and update leave the original alone', () => {
  const env = (groups) => new Function('M', 'note', 'renderChooser', 'newId',
    'var _groups = ' + JSON.stringify(groups) + ', _sel = {}, _layout = { panels: [], named: {} }, _renId = "s1", saved = [];\n'
    + 'function save() {} function render() {}\n'
    + slice('  function savedById(id) {', 'return null; }') + '\n'
    + 'var window = { innerWidth: 1000, innerHeight: 1000 };\n'
    + slice('  function groupPartsOf(ps) {') + '\n' + slice('  function putGroups() {', 'catch (e) {} }') + '\n' + slice('  function uniqueGroupName(base, exceptId) {') + '\n'
    + slice('  function updateSavedGroup(id) {') + '\n' + slice('  function duplicateGroup(id) {') + '\n' + slice('  function renameGroup(id, raw) {')
    + '\nreturn { updateSavedGroup, duplicateGroup, renameGroup, get groups() { return _groups; }, get renId() { return _renId; }, layout: _layout, sel(ids) { _sel = {}; ids.forEach(function (i) { _sel[i] = true; }); } };')(
    { canvasGroupsSave(g) { env.saved.push(JSON.parse(JSON.stringify(g))); } }, (m) => env.notes.push(m), () => {}, () => 'snew');
  env.saved = []; env.notes = [];
  const G = () => [{ id: 's1', name: 'Command Center', parts: [{ part: 'tank.mt', mode: 'bar', dx: 0, dy: 0, w: 200, h: 30 }] }, { id: 's2', name: 'Tank', parts: [] }];
  it('⧉ makes a copy beside it under a free name, with its own id (so no hotkey rides along)', () => {
    env.saved = [];
    const r = env(G());
    r.duplicateGroup('s1');
    expect(r.groups.map(g => g.name)).toEqual(['Command Center', 'Command Center copy', 'Tank']);
    expect(r.groups[1].id).not.toBe('s1');
    expect(r.groups[1].parts).toEqual(r.groups[0].parts);
    expect(r.groups[1].parts).not.toBe(r.groups[0].parts);        // a copy, not the same array
    expect(env.saved).toHaveLength(1);
  });
  it('✎ renames in place: the id stays (its hotkey and pieces stay with it); a taken name gets a suffix; a blank one changes nothing', () => {
    const r = env(G());
    r.renameGroup('s1', 'Raid HUD');
    expect(r.groups[0]).toMatchObject({ id: 's1', name: 'Raid HUD' });
    expect(r.renId).toBeNull();
    r.renameGroup('s2', 'raid hud');
    expect(r.groups[1].name).toBe('raid hud copy');
    r.renameGroup('s1', '   ');
    expect(r.groups[0].name).toBe('Raid HUD');
  });
  it('💾 Update replaces the pieces of THAT group from the selection and nothing else', () => {
    const r = env(G());
    r.layout.panels.push({ id: 'p1', kind: 'part', part: 'me.hp', mode: 'thin', x: 0.1, y: 0.1, w: 220, h: 18, scale: 1 },
      { id: 'p2', kind: 'part', part: 'me.mana', mode: 'thin', x: 0.1, y: 0.2, w: 220, h: 18, scale: 1 });
    r.sel(['p1', 'p2']);
    r.updateSavedGroup('s1');
    expect(r.groups[0].name).toBe('Command Center');
    expect(r.groups[0].parts.map(q => [q.part, q.mode, q.dx, q.dy])).toEqual([['me.hp', 'thin', 0, 0], ['me.mana', 'thin', 0, 100]]);
    expect(r.groups[1].parts).toEqual([]);
  });
});

// ── E / F ─────────────────────────────────────────────────────────────────────────────────────────────
describe('E: a row finds the pieces it is on the screen as', () => {
  const env = (panels, named, ovs = [{ key: 'charm' }, { key: 'me' }]) => new Function('WpParts', '_layout', 'ovEntry',
    slice('  function presetById(id)', 'return null; }') + '\n' + slice('  function groupPanels(savedId) {') + '\n' + slice('  function placedFor(what) {')
    + '\nreturn { placedFor };')(WpParts, { panels, named }, (k) => ovs.find(o => o.key === k) || null).placedFor;
  const part = (id, p, grp) => ({ id, kind: 'part', part: p, grp: grp || null });
  const ids = (a) => a.map(q => q.id);
  it('a part row: every copy of that piece', () => {
    const f = env([part('a', 'me.hp'), part('b', 'me.hp', 'g1'), part('c', 'me.mana')], {});
    expect(ids(f('part:me.hp'))).toEqual(['a', 'b']);
    expect(f('part:nope.x')).toEqual([]);
  });
  it('a saved group: the pieces of every live copy of it', () => {
    const f = env([part('a', 'me.hp', 'g1'), part('b', 'me.mana', 'g1'), part('c', 'me.hp', 'g2'), part('d', 'me.hp', 'g3')], { g1: 's1', g2: 's1', g3: 's2' });
    expect(ids(f('group:s1'))).toEqual(['a', 'b', 'c']);
    expect(ids(f('group:s2'))).toEqual(['d']);
  });
  it('an overlay preset: that overlay\'s panel, and for the HUD the right look (ring or box), never the other', () => {
    const f = env([{ id: 'o1', kind: 'overlay', key: 'charm', style: '' }, { id: 'o2', kind: 'overlay', key: 'me', style: 'hud' }, { id: 'o3', kind: 'overlay', key: 'me', style: 'a' }], {});
    expect(ids(f('preset:charm'))).toEqual(['o1']);
    expect(ids(f('preset:hud-ring'))).toEqual(['o2']);
    expect(ids(f('preset:hud-box'))).toEqual(['o3']);
    expect(ids(f('overlay:charm'))).toEqual(['o1']);
  });
  it('a preset placed "as pieces" is found by the preset id it was marked with; the overlay\'s panel is not that', () => {
    const f = env([part('a', 'charm.pet', 'g1'), part('b', 'charm.buffs', 'g1'), { id: 'o1', kind: 'overlay', key: 'charm', style: '' }], { g1: 'preset:charm' });
    expect(ids(f('preset:charm:pieces'))).toEqual(['a', 'b']);
    expect(ids(f('preset:charm'))).toEqual(['o1']);
    expect(f('preset:nonesuch')).toEqual([]);
  });
  it('an overlay main has not listed yet is pieces only (no panel to point at)', () => {
    const f = env([{ id: 'o1', kind: 'overlay', key: 'charm', style: '' }], {}, []);
    expect(f('preset:charm')).toEqual([]);
  });
});

describe('F: a click on a row that is already on the screen shows where', () => {
  const env = (placed) => {
    const notes = [], flashed = [];
    const els = {};
    placed.forEach(q => { els[q.id] = { root: { offsetLeft: q.x, offsetTop: q.y, offsetWidth: q.w, offsetHeight: q.h, classList: { remove() {}, add() { flashed.push(q.id); } } } }; });
    const f = new Function('_els', 'note', 'placedFor', 'groupBox', 'window',
      'var num = function (v, lo, hi, d) { v = Number(v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };\n'
      + slice('  var _screens = null, _conv', '  // ── Routing: which panel shows a countdown') + '\n'   // the screens: with one, the window
      + slice('  function whereText(b) {') + '\n' + slice('  function boxOf(ps) {') + '\n' + slice('  function locate(ps, label) {') + '\n' + slice('  function clickLocates(what, label) {')
      + '\nreturn { whereText, locate, clickLocates };')(els, (m) => notes.push(m), () => placed,
      (ms) => ({ x: Math.min(...ms.map(m => m.x0)), y: Math.min(...ms.map(m => m.y0)), w: Math.max(...ms.map(m => m.x0 + m.w0)) - Math.min(...ms.map(m => m.x0)), h: Math.max(...ms.map(m => m.y0 + m.h0)) - Math.min(...ms.map(m => m.y0)) }),
      { innerWidth: 1000, innerHeight: 900 });
    return Object.assign(f, { notes, flashed });
  };
  const P = (id, x, y, off = false) => ({ id, x, y, w: 100, h: 50, off });
  it('says where on the screen, and pulses every piece', () => {
    const e = env([P('a', 800, 20), P('b', 810, 90)]);
    expect(e.clickLocates('group:s1', 'Charm')).toBe(true);
    expect(e.flashed).toEqual(['a', 'b']);
    expect(e.notes[0]).toContain('“Charm” is already here — top right');
    expect(e.notes[0]).toContain('2 pieces');
    expect(e.notes[0]).toContain('Drag it out of the list to place another copy');
  });
  it('says so when it is hidden', () => {
    const e = env([P('a', 450, 400, true)]);
    e.clickLocates('preset:charm', 'Charm');
    expect(e.notes[0]).toContain('in the middle of the screen');
    expect(e.notes[0]).toContain('hidden');
  });
  it('a piece row never "locates": a second copy of a piece is routine; and nothing placed means place it', () => {
    const e = env([P('a', 10, 10)]);
    expect(e.clickLocates('part:me.hp', 'HP')).toBe(false);
    expect(e.clickLocates('sect:me:hp', 'HP')).toBe(false);
    expect(e.notes).toEqual([]);
    expect(env([]).clickLocates('group:s1', 'Charm')).toBe(false);
  });
});

// ── G ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('G: deleting a saved group, with its pieces if asked, and Undo', () => {
  vi.useFakeTimers();
  function world({ gkeys = { s1: 'Alt+1' } } = {}) {
    const w = { saved: [], hotkeys: [], classes: new Set() };
    const toastEl = { classList: { add: (c) => w.classes.add(c), remove: (c) => w.classes.delete(c) } };
    const M = { canvasGroupsSave: (g) => w.saved.push(g.map(x => x.id)), canvasGroupHotkey: (id, a) => { w.hotkeys.push([id, a]); return Promise.resolve({ ok: true, keys: { [id]: a }, blocked: {} }); } };
    const f = new Function('M', 'toastEl', 'toastMsg', 'repaintKeys', 'save', 'render', 'renderChooser', 'startState',
      'var _groups = startState.groups, _layout = startState.layout, _gkeys = startState.gkeys, _gblocked = {}, _sel = {}, _undo = null, _undoT = null;\n'
      + slice('  function savedById(id) {', 'return null; }') + '\n' + slice('  function groupPanels(savedId) {') + '\n'
      + slice('  function forgetSavedGroup(id) {') + '\n' + slice('  function putGroups() {', 'catch (e) {} }') + '\n'
      + slice('  function removable(q) {', '; }') + '\n' + slice('  function removePanels(ids) {') + '\n' + slice('  function undoRemove() {') + '\n'
      + slice('  function deleteSavedGroup(id, withPieces) {')
      + '\nreturn { deleteSavedGroup, undoRemove, get groups() { return _groups; }, get layout() { return _layout; }, get gkeys() { return _gkeys; }, get hasUndo() { return !!_undo; } };');
    const piece = (id, grp) => ({ id, kind: 'part', part: 'me.hp', grp });
    const startState = {
      groups: [{ id: 's0', name: 'First', parts: [] }, { id: 's1', name: 'Charm set', parts: [] }, { id: 's2', name: 'Last', parts: [] }],
      layout: { panels: [piece('a', 'g1'), piece('b', 'g1'), piece('c', 'g2'), piece('z', null), { id: 'callouts', kind: 'callouts' }], named: { g1: 's1', g2: 's2' } },
      gkeys,
    };
    const toastMsg = { textContent: '' };
    const r = f(M, toastEl, toastMsg, () => {}, () => {}, () => {}, () => {}, startState);
    return Object.assign(w, { r, toastMsg });
  }
  const ids = (r) => r.layout.panels.map(p => p.id);

  it('"delete + remove": the group, its pieces off the screen, its links forgotten, its key dropped — and ONLY its own pieces', () => {
    const w = world();
    w.r.deleteSavedGroup('s1', true);
    expect(w.r.groups.map(g => g.id)).toEqual(['s0', 's2']);
    expect(ids(w.r)).toEqual(['c', 'z', 'callouts']);            // a, b gone; the other group's piece and the lone piece stay
    expect(w.r.layout.named).toEqual({ g2: 's2' });
    expect(w.r.gkeys).toEqual({});
    expect(w.saved.pop()).toEqual(['s0', 's2']);
    expect(w.toastMsg.textContent).toBe('Deleted “Charm set” and its 2 pieces');
    expect(w.classes.has('undo')).toBe(true);
  });
  it('Undo puts back the group where it was, its pieces where they were, its link, and its hotkey', async () => {
    const w = world();
    w.r.deleteSavedGroup('s1', true);
    w.r.undoRemove();
    expect(w.r.groups.map(g => g.id)).toEqual(['s0', 's1', 's2']);
    expect(ids(w.r)).toEqual(['a', 'b', 'c', 'z', 'callouts']);
    expect(w.r.layout.named).toEqual({ g1: 's1', g2: 's2' });
    expect(w.hotkeys).toEqual([['s1', 'Alt+1']]);
    await Promise.resolve(); await Promise.resolve();
    expect(w.r.gkeys).toEqual({ s1: 'Alt+1' });
    expect(w.r.hasUndo).toBe(false);
  });
  it('"delete, keep them": the pieces stay on the screen, unlinked, and Undo still brings the group back', () => {
    const w = world();
    w.r.deleteSavedGroup('s1', false);
    expect(ids(w.r)).toEqual(['a', 'b', 'c', 'z', 'callouts']);
    expect(w.r.layout.named).toEqual({ g2: 's2' });
    expect(w.r.groups.map(g => g.id)).toEqual(['s0', 's2']);
    expect(w.r.hasUndo).toBe(true);
    w.r.undoRemove();
    expect(w.r.groups.map(g => g.id)).toEqual(['s0', 's1', 's2']);
    expect(w.r.layout.named).toEqual({ g1: 's1', g2: 's2' });
  });
  it('a group with no pieces here, and no hotkey, deletes cleanly (and an unknown id does nothing)', () => {
    const w = world({ gkeys: {} });
    w.r.deleteSavedGroup('s0', true);
    expect(w.r.groups.map(g => g.id)).toEqual(['s1', 's2']);
    expect(ids(w.r)).toHaveLength(5);
    w.r.undoRemove();
    expect(w.hotkeys).toEqual([]);
    const before = w.r.groups.length;
    w.r.deleteSavedGroup('nope', true);
    expect(w.r.groups).toHaveLength(before);
  });
});

// ── D ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('D: the palette draws each piece from the client\'s data, else its sample', () => {
  const html = slice('  function paintChooserPreviews() {');
  function env(live) {
    const el = { _h: '', innerHTML: '', style: {}, getAttribute: () => 'me.hp', classList: { toggle(c, on) { el.cls = on ? c : ''; } } };
    const calls = [];
    const f = new Function('WpParts', 'chList', 'viewFor', 'sampleFor', '_pvMode',
      html + '\nreturn paintChooserPreviews;')(
      Object.assign({}, WpParts, { render: (d, mode, v, now, o) => { calls.push([d.id, mode, v, o.uid]); return '<div>' + JSON.stringify(v) + '</div>'; } }),
      { querySelectorAll: () => [el] }, () => live, () => ({ pct: 12, sample: true }), {});
    return { f, el, calls };
  }
  it('with data it draws THAT, in the piece\'s first mode, through the same render call; sample is dimmed', () => {
    const a = env({ pct: 77 });
    a.f();
    expect(a.calls[0].slice(0, 3)).toEqual(['me.hp', 'bar', { pct: 77 }]);
    expect(a.el.innerHTML).toContain('77');
    expect(a.el.cls).toBe('');                                  // not "sample"
    const b = env(null);
    b.f();
    expect(b.calls[0][2]).toEqual({ pct: 12, sample: true });
    expect(b.el.cls).toBe('sample');
  });
  it('an unchanged picture is not written again', () => {
    const a = env({ pct: 5 });
    a.f();
    const first = a.el.innerHTML;
    Object.defineProperty(a.el, 'innerHTML', { get: () => first, set: () => { throw new Error('rewrote an unchanged preview'); } });
    expect(() => a.f()).not.toThrow();
  });
});
