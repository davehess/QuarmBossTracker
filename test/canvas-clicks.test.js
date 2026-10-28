// test/canvas-clicks.test.js — a page hosted on the Canvas takes the mouse (the guild lead, 2026-10-21):
// "canvas needs to be able to click on these dropdowns and its not working with EQ in focus. clicking it DOES work when
// the HUD overlay is over it". The Command Center's section headers (▸ HAIL, ▸ DEFENSIVES, ▸ HEALER MANA, ▸ ROLLS with
// "clear all" and the per-row ✕, ▸ NEEDS REZ, ▸ LAST DEATHS) and its hail chips would not click while EverQuest had focus.
//
// The Canvas window is click-through always. A control inside a panel's frame is clickable only while the window is armed
// through the hover handshake (preload.js, and canvas.html's own arm from the parent page). Four things were wrong:
//   1. Most of the Command Center's clickables were bare <span>s: the section toggle, "clear all", the roll/cure/rez ✕s,
//      the roll copy and "N rolls" switches. Neither arm knows a bare span (FB-49 was this on the buff queue). Same bare
//      spans sat in the CH chain, Extended Target, the DPS meter and /who.
//   2. A <summary> (a <details> header) was on neither list.
//   3. Nothing caught the next bare span: a page that styles something cursor:pointer has said it is clickable.
//   4. The Canvas learned the cursor was over a control only from mouse moves Windows forwards into a click-through window,
//      and a panel's frame may never be handed them (three arms from inside the pages did not fix FB-92). Main now reads
//      the cursor's position and tells the Canvas, which hit-tests that point itself.
//
// What this cannot show: that Windows then delivers the click to the panel. That needs the real window (see the report).
//
// Run: npx vitest run test/canvas-clicks.test.js

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const MIMIC = path.join(ROOT, 'apps', 'mimic');
const PRELOAD = readSource(path.join(MIMIC, 'preload.js'));
const CANVAS = readSource(path.join(MIMIC, 'canvas.html'));
const MAIN = readSource(path.join(MIMIC, 'main.js'));

// ── tiny DOM fakes ──────────────────────────────────────────────────────────────────────────────────────────────
// An element with a tag, attributes, a parent and the cursor its page styles it with. matches/closest understand the
// shapes the armed lists use: `tag`, `[attr]` and `[attr="v"]`, comma separated.
function matchesSel(e, sel) {
  return sel.split(',').map(s => s.trim()).some(s => {
    if (s[0] === '[') {
      const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(s);
      return !!m && (m[2] === undefined ? m[1] in e.attrs : e.attrs[m[1]] === m[2]);
    }
    return s === e.tag;
  });
}
function el(tag, attrs, parent, cursor) {
  const e = {
    nodeType: 1, tag, tagName: tag.toUpperCase(), attrs: attrs || {}, parentElement: parent || null, cursor: cursor || 'auto',
    matches(sel) { return matchesSel(e, sel); },
    closest(sel) { for (let n = e; n; n = n.parentElement) if (matchesSel(n, sel)) return n; return null; },
  };
  e.ownerDocument = { defaultView: { getComputedStyle: (x) => ({ cursor: x.cursor }) } };
  return e;
}

// ── 1. the two armed lists agree, and a <summary> is on them ───────────────────────────────────────────────────────
const preloadSel = /const WP_INTERACT_SEL = '([^']+)'/.exec(stripJs(PRELOAD));
const canvasSel = /var PANEL_CTL = '([^']+)'/.exec(stripJs(CANVAS));

describe('the armed selector', () => {
  it('is one list in the preload and the same list on the Canvas page, and carries <summary>', () => {
    expect(preloadSel && canvasSel).toBeTruthy();
    expect(canvasSel[1]).toBe(preloadSel[1]);
    expect(preloadSel[1].split(',').map(s => s.trim())).toEqual(
      expect.arrayContaining(['button', 'a', 'input', 'select', 'textarea', 'summary', '[role="button"]', '[data-wp-interact]']));
  });
});

// ── 2. the preload's handshake, run for real ───────────────────────────────────────────────────────────────────────
const SEL_BLOCK = sliceBlock(PRELOAD, 'const WP_INTERACT_SEL =', "  return false;\n}\n");
const HOVER_FN = sliceBlock(PRELOAD, 'function _hoverOn()', "function _hoverOff() { try { ipcRenderer.invoke('overlay-hover-interactive', false); } catch (e) {} }");
const ARM_STATE = 'let _wpHoverArmed = false;';
const HANDSHAKE = sliceBlock(PRELOAD, 'let _wpLastAssert = 0;', "  if (!ev.relatedTarget) _wpGhostHide();\n}, { capture: true, passive: true });");

function preloadWorld() {
  const calls = [], L = {};
  const body = `
    ${HOVER_FN}
    ${ARM_STATE}
    const _wpOverlayDoc = () => true;
    const _wpGhostHide = () => {};
    ${SEL_BLOCK}
    ${HANDSHAKE}`;
  const document = { body: { nodeType: 1 }, addEventListener: (t, f) => { (L[t] = L[t] || []).push(f); } };
  const ipcRenderer = { invoke: (ch, v) => { calls.push([ch, v]); return Promise.resolve(); } };
  const getComputedStyle = (x) => ({ cursor: x.cursor });
  // eslint-disable-next-line no-new-func
  new Function('document', 'ipcRenderer', 'getComputedStyle', body)(document, ipcRenderer, getComputedStyle);
  const move = (target) => (L.mousemove || []).forEach(f => f({ target }));
  const out = (relatedTarget) => (L.mouseout || []).forEach(f => f({ relatedTarget }));
  return { calls, move, out, hover: () => calls.map(c => c[1]) };
}

describe('the preload arms the window over what a page marks clickable (a hosted page runs this same preload in its frame)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-21T20:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });
  const body = () => el('body');

  it('a <summary> arms on the way in and lets go on the way out, once each', () => {
    const w = preloadWorld();
    const det = el('details', {}, body());
    const sum = el('summary', {}, det);
    w.move(sum); w.move(sum);
    expect(w.hover()).toEqual([true]);
    w.move(el('div', {}, body()));
    expect(w.hover()).toEqual([true, false]);
  });
  it('a bare span carrying data-wp-interact (a chip, a ✕, "clear all") arms; its child text node target arms too', () => {
    const w = preloadWorld();
    const chip = el('span', { 'data-wp-interact': '' }, body());
    const inner = el('b', {}, chip);
    w.move(inner);
    expect(w.hover()).toEqual([true]);
  });
  it('a bare span the page styles cursor:pointer arms even with no mark (the next FB-49 caught before it ships)', () => {
    const w = preloadWorld();
    w.move(el('span', {}, body(), 'pointer'));
    expect(w.hover()).toEqual([true]);
  });
  it('empty area and plain text never arm: the clicks stay with EverQuest', () => {
    const w = preloadWorld();
    w.move(el('div', {}, body()));
    w.move(el('span', {}, body()));
    w.move(body());
    expect(w.calls).toEqual([]);
  });
  it('re-asserts every 150 ms over a control, and leaving the frame lets go once', () => {
    const w = preloadWorld();
    const sum = el('summary', {}, body());
    w.move(sum); w.move(sum);
    expect(w.hover()).toEqual([true]);
    vi.setSystemTime(Date.now() + 200);
    w.move(sum);
    expect(w.hover()).toEqual([true, true]);
    w.out(null); w.out(null);
    expect(w.hover()).toEqual([true, true, false]);
  });
});

// ── 3. every clickable a hosted page draws is armed ────────────────────────────────────────────────────────────────
// The pages the Canvas hosts (main.js _DOCK_CATALOG + me.html + triggers.html). A class the page styles cursor:pointer is a
// control; every tag that carries it must be a native control or carry data-wp-interact.
const HOSTED = ['overlay', 'chchain', 'tank', 'buffqueue', 'mobinfo', 'charm', 'pets', 'who', 'melody', 'threatmeter',
  'extarget', 'zealhealth', 'popraid', 'command', 'me', 'triggers', 'chat'];
const NATIVE = /^(button|a|input|select|textarea|summary)$/;
function markup(name) {
  return stripJs(fs.readFileSync(path.join(MIMIC, name + '.html'), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
}
function pointerClasses(src) {
  const classes = new Set(), re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    if (!/cursor\s*:\s*pointer/.test(m[2])) continue;
    m[1].split(',').forEach(sel => {
      const last = sel.trim().split(/[\s>+~]+/).pop();
      [...last.matchAll(/\.([\w-]+)/g)].forEach(x => classes.add(x[1]));
    });
  }
  return classes;
}
function unarmedTags(src, cls) {
  const re = new RegExp('<(\\w+)[^<>]*?class=\\\\?["\'][^"\']*\\b' + cls + '\\b[^"\']*["\'][^<>]*>', 'g');
  const bad = [];
  let t, n = 0;
  while ((t = re.exec(src))) {
    n++;
    if (NATIVE.test(t[1].toLowerCase()) || /data-wp-interact|role=\\?["']button/.test(t[0])) continue;
    bad.push(t[0].slice(0, 100));
  }
  return { n, bad };
}

describe('every clickable a Canvas-hosted page draws is armed', () => {
  HOSTED.forEach((name) => {
    it(name + '.html: no cursor:pointer class is drawn on a bare span or div', () => {
      const src = markup(name);
      const bad = [];
      pointerClasses(src).forEach((cls) => { unarmedTags(src, cls).bad.forEach(b => bad.push('.' + cls + '  ' + b)); });
      expect(bad).toEqual([]);
    });
  });
  it('the scan is not vacuous: the Command Center has the controls the report named, and the scan sees each tag', () => {
    const src = markup('command');
    const cls = pointerClasses(src);
    ['sec-toggle', 'rollClearAll', 'rollDismiss', 'rollMore', 'rollCopy', 'cureDismiss', 'cureClearAll', 'hail-chip', 'hail-more']
      .forEach((c) => { expect(cls.has(c), c).toBe(true); expect(unarmedTags(src, c).n, c).toBeGreaterThan(0); });
    expect(markup('command')).toMatch(/rezDismiss" data-wp-interact/);
  });
  it('the Command Center section header (secToggle, every collapsible section but the hail card) is armed', () => {
    expect(markup('command')).toMatch(/<span class="sec-toggle" data-wp-interact data-collapse-key="' \+ esc\(key\)/);
  });
});

// ── 4. the Canvas page: main tells it where the cursor is, and it hit-tests that point ─────────────────────────────
const CANVAS_BLOCK = sliceBlock(CANVAS, "// ── A panel's page takes the mouse through THIS page too (FB-92)", '// ── end FB-92');

function canvasWorld() {
  const calls = [], docL = {}, panelL = {}, frames = [];
  const st = { under: null, cursorCb: null };
  const body = `
    var M = { overlayHoverInteractive: function (w) { calls.push(w); }, onCanvasCursor: function (cb) { st.cursorCb = cb; } };
    var _edit = false;
    function hoverMins() {}   // ▭ Minimize follows the same cursor reports; not under test here
    var document = { addEventListener: function (t, f) { (docL[t] = docL[t] || []).push(f); },
      elementFromPoint: function (x, y) { return st.under(x, y); } };
    var panelsEl = { contains: function () { return true; },
      addEventListener: function (t, f) { (panelL[t] = panelL[t] || []).push(f); },
      querySelectorAll: function () { return frames; } };
    function setEdit(v) { _edit = v; }
    ${CANVAS_BLOCK}
    return { setEdit: setEdit };`;
  // eslint-disable-next-line no-new-func
  const api = new Function('calls', 'docL', 'panelL', 'frames', 'st', body)(calls, docL, panelL, frames, st);
  return {
    api, calls,
    cursor: (p) => st.cursorCb(p),
    setUnder: (f) => { st.under = f; },
    down: () => (docL.mousedown || []).forEach(f => f({})),
    up: () => (docL.mouseup || []).forEach(f => f({})),
  };
}
function frameWith(under, rect) {
  const fr = el('iframe', {}, null);
  fr.offsetWidth = rect.width; fr.offsetHeight = rect.height;
  fr.getBoundingClientRect = () => rect;
  fr.contentDocument = { elementFromPoint: () => fr.under };
  fr.under = under;
  return fr;
}

describe('the Canvas hit-tests the cursor main reports (a frame may never be handed the forwarded moves)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-21T20:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('a point over a panel frame whose page has a control under it arms the window, once per enter, and lets go on leave', () => {
    const chip = el('span', { 'data-wp-interact': '' }, el('body'));
    const fr = frameWith(chip, { left: 100, top: 50, width: 200, height: 100 });
    const w = canvasWorld();
    w.setUnder(() => fr);
    w.cursor({ x: 150, y: 80 }); w.cursor({ x: 151, y: 80 }); w.cursor({ x: 152, y: 81 });
    expect(w.calls).toEqual([true]);
    fr.under = el('div', {}, el('body'));                 // the same frame, now over its plain text
    w.cursor({ x: 160, y: 90 });
    expect(w.calls).toEqual([true, false]);
  });
  it('a <summary> in a frame arms it (the ▸ header of a collapsible section)', () => {
    const fr = frameWith(el('summary', {}, el('details', {}, el('body'))), { left: 0, top: 0, width: 200, height: 100 });
    const w = canvasWorld();
    w.setUnder(() => fr);
    w.cursor({ x: 10, y: 10 });
    expect(w.calls).toEqual([true]);
  });
  it('the cursor going off the Canvas window (null) lets go', () => {
    const fr = frameWith(el('span', { 'data-wp-interact': '' }, el('body')), { left: 0, top: 0, width: 200, height: 100 });
    const w = canvasWorld();
    w.setUnder(() => fr);
    w.cursor({ x: 10, y: 10 });
    w.cursor(null);
    expect(w.calls).toEqual([true, false]);
  });
  it('empty canvas never arms and never fires a release when nothing was armed: the click goes to EQ', () => {
    const w = canvasWorld();
    w.setUnder(() => el('div', { id: 'panels' }, el('body')));
    w.cursor({ x: 500, y: 500 }); w.cursor({ x: 501, y: 500 }); w.cursor(null);
    expect(w.calls).toEqual([]);
  });
  it('a panel frame over plain text arms nothing', () => {
    const fr = frameWith(el('div', {}, el('body')), { left: 0, top: 0, width: 200, height: 100 });
    const w = canvasWorld();
    w.setUnder(() => fr);
    w.cursor({ x: 10, y: 10 });
    expect(w.calls).toEqual([]);
  });
  it('a held button (a ✥ or ◢ drag) and the arranging mode both keep the report from touching the window', () => {
    const fr = frameWith(el('span', { 'data-wp-interact': '' }, el('body')), { left: 0, top: 0, width: 200, height: 100 });
    const w = canvasWorld();
    w.setUnder(() => fr);
    w.down();
    w.cursor({ x: 10, y: 10 });
    expect(w.calls).toEqual([]);
    w.up();
    w.api.setEdit(true);
    w.cursor({ x: 10, y: 10 });
    expect(w.calls).toEqual([]);
    w.api.setEdit(false);
    w.cursor({ x: 10, y: 10 });
    expect(w.calls).toEqual([true]);
  });
  it('a cursor:pointer element in a frame arms with no mark (the page said it is clickable)', () => {
    const fr = frameWith(el('span', {}, el('body'), 'pointer'), { left: 0, top: 0, width: 200, height: 100 });
    const w = canvasWorld();
    w.setUnder(() => fr);
    w.cursor({ x: 10, y: 10 });
    expect(w.calls).toEqual([true]);
  });
});

// ── 5. main: the cursor feed ───────────────────────────────────────────────────────────────────────────────────────
const FEED = sliceBlock(MAIN, 'function _canvasCursorRel(b, p, zoom) {', "  try { canvasWindow.webContents.send('canvas-cursor', rel); } catch { /* mid-close */ }\n}");

function feedWorld() {
  const w = { sent: [], visible: true, live: true, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, cursor: { x: 2000, y: 100 }, zoom: 1, cleared: 0 };
  // eslint-disable-next-line no-new-func
  const api = new Function('w', `
    let canvasWindow = { isDestroyed: () => !w.live, isVisible: () => w.visible, getBounds: () => w.bounds,
      webContents: { getZoomFactor: () => w.zoom, send: (c, v) => w.sent.push([c, v]) } };
    const _live = (x) => !!(x && !x.isDestroyed());
    const screen = { getCursorScreenPoint: () => w.cursor };
    const clearInterval = () => { w.cleared++; };
    ${FEED}
    return { _canvasCursorRel, _canvasCursorTick, setTimer: (v) => { _canvasCursorTimer = v; }, timer: () => _canvasCursorTimer };`)(w);
  return { w, api };
}

describe('main tells the Canvas where the cursor is', () => {
  it('in the Canvas window\'s own pixels (the zoom divided back out); null when it is off the window', () => {
    const { api } = feedWorld();
    const b = { x: 100, y: 50, width: 800, height: 600 };
    expect(api._canvasCursorRel(b, { x: 300, y: 150 }, 1)).toEqual({ x: 200, y: 100 });
    expect(api._canvasCursorRel(b, { x: 300, y: 150 }, 2)).toEqual({ x: 100, y: 50 });
    expect(api._canvasCursorRel(b, { x: 99, y: 150 }, 1)).toBeNull();
    expect(api._canvasCursorRel(b, { x: 900, y: 150 }, 1)).toBeNull();      // the right edge is outside
    expect(api._canvasCursorRel(b, { x: 300, y: 650 }, 1)).toBeNull();
    expect(api._canvasCursorRel(b, { x: 300, y: 150 }, 0)).toEqual({ x: 200, y: 100 });   // junk zoom is 1
  });
  it('sends when the cursor moves, once per position, and says null when it leaves the window', () => {
    const { w, api } = feedWorld();
    api._canvasCursorTick(); api._canvasCursorTick();
    expect(w.sent).toEqual([['canvas-cursor', { x: 80, y: 100 }]]);
    w.cursor = { x: 2100, y: 100 };
    api._canvasCursorTick();
    expect(w.sent.length).toBe(2);
    w.cursor = { x: 10, y: 10 };                    // another screen entirely
    api._canvasCursorTick(); api._canvasCursorTick();
    expect(w.sent[2]).toEqual(['canvas-cursor', null]);
    expect(w.sent.length).toBe(3);
  });
  it('says nothing while the Canvas is hidden, and stops its timer when the window is gone', () => {
    const { w, api } = feedWorld();
    w.visible = false;
    api._canvasCursorTick();
    expect(w.sent).toEqual([]);
    api.setTimer(7);
    w.live = false;
    api._canvasCursorTick();
    expect(w.cleared).toBe(1);
    expect(api.timer()).toBeNull();
    expect(w.sent).toEqual([]);
  });
  it('is started with the Canvas window and runs every 50 ms', () => {
    const create = stripJs(sliceBlock(MAIN, 'function createCanvasWindow() {', "applyOverlayOpacity(canvasWindow, 'canvas');"));
    expect(create).toMatch(/_canvasCursorTimer = setInterval\(_canvasCursorTick, 50\)/);
  });
});
