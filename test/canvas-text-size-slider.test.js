// test/canvas-text-size-slider.test.js — a range slider in a Canvas piece's text-size section (the guild lead,
// 2026-10-21: "The font size can have a slider").
//
// A−/A+ stay, with the % readout. The slider uses the SAME range as the buttons (scaleRange) and the same 10% step,
// previews live on `input` (render, no write) and saves once on `change` (release, or an arrow key).
// The real listeners and scaleRange run sliced out of canvas.html against fakes. NOT shown: a real pointer drag.
//
// Run: npx vitest run test/canvas-text-size-slider.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const canvas = readSource(path.join(ROOT, 'apps', 'mimic', 'canvas.html'));
const js = stripJs(canvas);

const rangeSrc = sliceBlock(canvas, '  function scaleRange(p) {', '\n  }\n');
const inputSrc = sliceBlock(canvas, "  menuEl.addEventListener('input'", '\n  });\n');
const changeSrc = sliceBlock(canvas, "  menuEl.addEventListener('change'", '\n  });\n');

function harness(panel) {
  const log = { saves: 0, renders: 0, opens: 0, pct: '' };
  const listeners = {};
  const menuEl = { addEventListener: (n, f) => { listeners[n] = f; } };
  const num = (v, lo, hi, d) => { v = Number(v); if (!isFinite(v)) return d; return Math.min(hi, Math.max(lo, v)); };
  const doc = { getElementById: (id) => (id === 'mScPct' ? { set textContent(v) { log.pct = v; } } : null) };
  // eslint-disable-next-line no-new-func
  new Function('menuEl', 'panelById', '_menuFor', 'num', 'render', 'save', 'openMenu', '_menuAnchor', '_els', 'document',
    rangeSrc + inputSrc + changeSrc)(
    menuEl, () => panel, panel.id, num, () => { log.renders++; }, () => { log.saves++; }, () => { log.opens++; }, null, {}, doc);
  return { log, listeners };
}

describe('range: one answer for the buttons and the slider', () => {
  // eslint-disable-next-line no-new-func
  const scaleRange = new Function(rangeSrc + '\nreturn scaleRange;')();
  it('matches the limits A−/A+ always used', () => {
    expect(scaleRange({ kind: 'part' })).toEqual([0.5, 3]);
    expect(scaleRange({ kind: 'overlay' })).toEqual([0.5, 2.5]);
    expect(scaleRange({ kind: 'sect' })).toEqual([0.5, 2.5]);
    expect(scaleRange({ kind: 'timers' })).toEqual([0.6, 2.5]);
  });
  it('the buttons read it too', () => {
    expect(js).toMatch(/var scr = scaleRange\(p\);\s*p\.scale = Math\.round\(num\(\(p\.scale \|\| 1\) \+ 0\.1/);
  });
});

describe('the section renders A−, the readout, A+ and a labelled slider', () => {
  it('slider is keyboard-native, labelled, on the hover handshake, step 10', () => {
    const at = js.indexOf('data-sc="-1"');
    const sec = js.slice(at - 300, at + 900);
    expect(sec).toContain('data-sc="1">A+');
    expect(sec).toContain('id="mScPct"');
    expect(sec).toMatch(/type="range" id="mScale" data-wp-interact aria-label="Text size"/);
    expect(sec).toMatch(/step="10"/);
    expect(sec).toMatch(/min="' \+ scaleRange\(p\)\[0\] \* 100/);
    expect(sec).toMatch(/max="' \+ scaleRange\(p\)\[1\] \* 100/);
  });
});

describe('dragging: live preview, one save on release', () => {
  it('input updates the scale and readout and renders, but never saves', () => {
    const p = { id: 'a', kind: 'timers', scale: 1 };
    const { log, listeners } = harness(p);
    for (const v of ['110', '130', '150', '170']) listeners.input({ target: { id: 'mScale', value: v } });
    expect(p.scale).toBe(1.7);
    expect(log.pct).toBe('170%');
    expect(log.renders).toBe(4);
    expect(log.saves).toBe(0);
  });
  it('change saves once and does not rebuild the menu (keeps arrow-key focus)', () => {
    const p = { id: 'a', kind: 'timers', scale: 1.7 };
    const { log, listeners } = harness(p);
    listeners.change({ target: { id: 'mScale', hasAttribute: () => false } });
    expect(log.saves).toBe(1);
    expect(log.opens).toBe(0);
  });
  it('clamps to the kind\'s range and ignores other inputs', () => {
    const p = { id: 'a', kind: 'timers', scale: 1 };
    const { log, listeners } = harness(p);
    listeners.input({ target: { id: 'mScale', value: '10' } });
    expect(p.scale).toBe(0.6);
    listeners.input({ target: { id: 'mName', value: '999' } });
    expect(p.scale).toBe(0.6);
    expect(log.renders).toBe(1);
  });
  it('syncs with the buttons: the slider value is built from the same scale they change', () => {
    expect(js).toMatch(/value="' \+ Math\.round\(\(p\.scale \|\| 1\) \* 100\)/);
  });
});
