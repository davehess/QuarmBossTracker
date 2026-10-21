// FB-92 (a member, Mimic 3.0.0-beta.20): "Despite hovering over the canvas timers, I cannot click the X to remove this
// or any timers. Also timers should have color coding, Red for mobs, Orange for affects on friendlies, green for buffs,
// blue for other. Purple for Avatar and Ferocity lines".
//
// Two halves.
//   1. The ✕ in a Canvas timers panel. The Canvas window is click-through always, so a control inside a panel's iframe
//      is clickable only while the window is armed through the hover handshake. The page inside the iframe arms it
//      itself, which depends on the window forwarding mouse moves into the sub-frame; that was fixed from inside the
//      page twice (§171, §317) and still failed. canvas.html now also arms it from the parent. The block between the
//      FB-92 markers is run for real over a fake iframe / document.
//   2. The bar colour of a spell row, decided in the agent so the standalone window, the Canvas and the pieces agree.
//      Driven through the SHIPPED agent (_builtinTimerRows), not text.
//
// What this cannot show: that Windows/Electron delivers the forwarded moves to the canvas document at all. That needs
// the real window.
//
// Run: npx vitest run test/canvas-timer-hover-and-colours.test.js

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readSource, sliceBlock, ROOT } from './_source-slice.js';

const canvasSrc = readSource(path.join(ROOT, 'apps', 'mimic', 'canvas.html'));

// ── 1. the parent-side arm ──────────────────────────────────────────────────────────────────────────────────────
const BLOCK = sliceBlock(canvasSrc, '// ── A panel\'s page takes the mouse through THIS page too (FB-92)', '// ── end FB-92');

// An element that is (or is not) inside a control.
const ctl = () => ({ closest: () => ({}) });
const plain = () => ({ closest: () => null });
// An iframe whose page answers elementFromPoint with `under`, at a box on the canvas.
function frame(under, rect, offsetW) {
  const fr = {
    tagName: 'IFRAME', offsetWidth: offsetW || rect.width, offsetHeight: rect.height * ((offsetW || rect.width) / rect.width),
    getBoundingClientRect: () => rect, asked: [],
    contentDocument: { listeners: {}, readyState: 'complete',
      addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
      elementFromPoint(x, y) { fr.asked.push([x, y]); return fr.under; } },
  };
  fr.under = under;
  return fr;
}
function run(frames) {
  const calls = [], docL = {}, panelL = {};
  const body = `
    var M = { overlayHoverInteractive: function (w) { calls.push(w); } };
    var _edit = false;
    var document = { addEventListener: function (t, f) { (docL[t] = docL[t] || []).push(f); } };
    var panelsEl = { contains: function () { return true; },
      addEventListener: function (t, f) { (panelL[t] = panelL[t] || []).push(f); },
      querySelectorAll: function () { return frames; } };
    function setEdit(v) { _edit = v; }
    ${BLOCK}
    return { panelWantsMouse: panelWantsMouse, panelHover: panelHover, panelFrameWants: panelFrameWants, setEdit: setEdit };`;
  // eslint-disable-next-line no-new-func
  const api = new Function('calls', 'docL', 'panelL', 'frames', body)(calls, docL, panelL, frames || []);
  const move = (ev) => (docL.mousemove || []).forEach(f => f(ev));
  return { api, calls, docL, panelL, move };
}

describe('FB-92: a panel\'s ✕ takes the mouse through the canvas page', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T20:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('the canvas page\'s own mousemove over a panel iframe arms the window when the point under it is a control', () => {
    const fr = frame(ctl(), { left: 100, top: 50, width: 200, height: 100 });
    const { calls, move } = run([]);
    move({ target: fr, clientX: 250, clientY: 80 });
    expect(calls).toEqual([true]);
    expect(fr.asked).toEqual([[150, 30]]);            // asked in the PAGE's own pixels, not the canvas's
  });
  it('and lets go when the point under it is not a control, or the pointer is back on empty canvas', () => {
    const fr = frame(ctl(), { left: 0, top: 0, width: 200, height: 100 });
    const { calls, move } = run([]);
    move({ target: fr, clientX: 10, clientY: 10 });
    fr.under = plain();
    move({ target: fr, clientX: 20, clientY: 10 });
    expect(calls).toEqual([true, false]);
    fr.under = ctl();
    move({ target: fr, clientX: 30, clientY: 10 });
    move({ target: plain(), clientX: 400, clientY: 400 });
    expect(calls).toEqual([true, false, true, false]);
  });
  it('a scaled panel page is asked in its own pixels (the canvas draws it at half size)', () => {
    const fr = frame(ctl(), { left: 100, top: 100, width: 100, height: 50 }, 200);   // drawn at 0.5x
    const { move } = run([]);
    move({ target: fr, clientX: 150, clientY: 125 });
    expect(fr.asked).toEqual([[100, 50]]);
  });
  it('leaves a canvas control alone: the pointer moving from a ✕ onto the ✥ does not disarm the ✥', () => {
    const fr = frame(ctl(), { left: 0, top: 0, width: 200, height: 100 });
    const { calls, move } = run([]);
    move({ target: fr, clientX: 10, clientY: 10 });
    move({ target: ctl(), clientX: 300, clientY: 10 });
    expect(calls).toEqual([true]);
  });
  it('does nothing while arranging (the frames take no pointer then and the shield owns the mouse)', () => {
    const fr = frame(ctl(), { left: 0, top: 0, width: 200, height: 100 });
    const { api, calls, move } = run([]);
    api.setEdit(true);
    move({ target: fr, clientX: 10, clientY: 10 });
    expect(calls).toEqual([]);
  });
  it('re-asserts every 150 ms over a control, so a ✕ whose press just disarmed the window arms again', () => {
    const fr = frame(ctl(), { left: 0, top: 0, width: 200, height: 100 });
    const { calls, move } = run([]);
    move({ target: fr, clientX: 10, clientY: 10 });
    move({ target: fr, clientX: 11, clientY: 10 });
    expect(calls).toEqual([true]);                      // inside the window: one call, not one per pixel
    vi.setSystemTime(Date.now() + 200);
    move({ target: fr, clientX: 12, clientY: 10 });
    expect(calls).toEqual([true, true]);
  });
  it('the page itself, once loaded, arms and disarms from its own moves (the canvas no longer sees them when armed)', () => {
    const fr = frame(ctl(), { left: 0, top: 0, width: 200, height: 100 });
    const { calls, panelL } = run([]);
    (panelL.load || []).forEach(f => f({ target: fr }));
    const L = fr.contentDocument.listeners;
    L.mousemove.forEach(f => f({ target: ctl() }));
    L.mousemove.forEach(f => f({ target: plain() }));
    expect(calls).toEqual([true, false]);
    L.mousemove.forEach(f => f({ target: ctl() }));
    L.mouseout.forEach(f => f({ relatedTarget: null }));
    expect(calls).toEqual([true, false, true, false]);
  });
  it('a page that is already loaded when the block runs is watched too', () => {
    const fr = frame(ctl(), { left: 0, top: 0, width: 200, height: 100 });
    run([fr]);
    expect(Object.keys(fr.contentDocument.listeners).sort()).toEqual(['mouseout', 'mousemove'].sort());
  });
  it('still click-through everywhere else: nothing here ever calls setIgnoreMouseEvents or touches the window', () => {
    const code = BLOCK.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    expect(code).not.toMatch(/setIgnoreMouseEvents|ipcRenderer/);
    expect(code).toMatch(/overlayHoverInteractive/);
  });
});

// ── 2. the bar colours ──────────────────────────────────────────────────────────────────────────────────────────
const RED = '#da3633', ORANGE = '#db6d28', GREEN = '#2ea043', PURPLE = '#a371f7', BLUE = '#1f6feb';
let agent;
beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });

const ME = 'Fenrisk';
const NOW = Date.now();
function land(key, targetName, spell) {
  let mp = agent._buffLandingsByTarget.get(key);
  if (!mp) { mp = new Map(); agent._buffLandingsByTarget.set(key, mp); }
  mp.set(spell.toLowerCase(), { name: spell, dur_ticks: 20, landed_at: NOW - 1000, cast_by: ME, target_name: targetName, target_id: null });
}
const colourOf = (spell) => (agent._builtinTimerRows(NOW).find(r => r.effect === spell) || {}).bar_color;

describe('FB-92: spell rows are coloured by what they are', () => {
  beforeEach(() => {
    agent._setWatchedLogsForTest([{ character: ME, logPath: 'eqlog_Fenrisk_pq.proj.txt' }]);
    agent._setSpellCatalogForTest([
      { name: "Turgur's Insects", good: 0 }, { name: 'Malosini', good: 0 }, { name: 'Clarity', good: 1 },
      { name: 'Ancient: Feral Avatar', good: 1 }, { name: 'Avatar', good: 1 }, { name: 'Ferocity', good: 1 },
      { name: 'Ferocity of Irionu', good: 1 }, { name: 'Mesmerize', good: 0, cc: ['mez'] },
      { name: 'Allure', good: 0 }, { name: 'Wake of Tranquility', good: 1 }, { name: 'Mystery Spell' },
    ]);
    agent._buffLandingsByTarget.clear();
    agent._builtinTimerHidden.clear();
    agent.whoData.clear();
    agent.whoData.set('torvahk', { name: 'Torvahk', class: 'Warrior', level: 60 });
    const tpl = agent.SUGGESTED_TRIGGERS.find(t => t.id === 'timer_my_spells');
    agent._setPersonalTriggersForTest([agent._compilePersonalTrigger(agent._templateToPersonalRow(tpl))]);
  });

  it('red: a detrimental spell on a mob', () => {
    land('a scrounging rat', 'A scrounging rat', "Turgur's Insects");
    expect(colourOf("Turgur's Insects")).toBe(RED);
  });
  it('red: a spell the catalog has not classified, on a mob', () => {
    land('a scrounging rat', 'A scrounging rat', 'Mystery Spell');
    expect(colourOf('Mystery Spell')).toBe(RED);
  });
  it('red: a mez, a lull and a charm, whoever the name belongs to now (a charmed mob is our pet by the time it shows)', () => {
    land('torvahk', 'Torvahk', 'Mesmerize');
    land('torvahk', 'Torvahk', 'Wake of Tranquility');
    land('torvahk', 'Torvahk', 'Allure');
    expect(colourOf('Mesmerize')).toBe(RED);
    expect(colourOf('Wake of Tranquility')).toBe(RED);
    expect(colourOf('Allure')).toBe(RED);
  });
  it('orange: a detrimental spell on a player', () => {
    land('torvahk', 'Torvahk', 'Malosini');
    expect(colourOf('Malosini')).toBe(ORANGE);
  });
  it('orange: a detrimental spell on one of our pets', () => {
    agent._charmTickTracker.set('jareker', { is_active: true, owner: ME, pet: 'Jareker' });
    try {
      land('jareker', 'Jareker', 'Malosini');
      expect(colourOf('Malosini')).toBe(ORANGE);
    } finally { agent._charmTickTracker.delete('jareker'); }
  });
  it('green: a beneficial spell on a friendly', () => {
    land('torvahk', 'Torvahk', 'Clarity');
    expect(colourOf('Clarity')).toBe(GREEN);
  });
  it('purple: Avatar and Ferocity lines, and it beats green', () => {
    land('torvahk', 'Torvahk', 'Ancient: Feral Avatar');
    land('torvahk', 'Torvahk', 'Avatar');
    land('torvahk', 'Torvahk', 'Ferocity');
    land('torvahk', 'Torvahk', 'Ferocity of Irionu');
    for (const s of ['Ancient: Feral Avatar', 'Avatar', 'Ferocity', 'Ferocity of Irionu']) expect(colourOf(s)).toBe(PURPLE);
  });
  it('blue: a spell the catalog has not classified, on a friendly', () => {
    land('torvahk', 'Torvahk', 'Mystery Spell');
    expect(colourOf('Mystery Spell')).toBe(BLUE);
  });
  it('every colour is a hex the overlay\'s row accepts, and they are five different colours', () => {
    const all = [RED, ORANGE, GREEN, PURPLE, BLUE];
    all.forEach(c => expect(c).toMatch(/^#[0-9a-f]{3,8}$/i));
    expect(new Set(all).size).toBe(5);
  });
});
