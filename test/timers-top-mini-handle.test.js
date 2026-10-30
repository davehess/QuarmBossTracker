// test/timers-top-mini-handle.test.js — two things a member ran into on the alerts window (2026-10-30).
//
// 1. "I have to know how to get them to start at the top of the window instead of bottom." The switch existed
//    (the alerts window's right-click ⇅ Timers start at; a Canvas Timers box's Stack row) but the dashboard's Overlays
//    tab had no twin, which the tray↔dashboard parity rule asks for. It does now, driving the same setter.
// 2. "I clicked mini and it went away." A folded alerts window (or Map) is NOTHING BUT its name chip over a see-through
//    window, and the chip was small, grey and dimmed with the overlay's opacity. A folded chip is now solid, full
//    strength and says "click to restore"; the right-click row and the dashboard's switch say the same.
//
// The chip's look runs in a real browser (the preload's own CSS next to the whole-overlay fade rule that used to win);
// the dashboard click runs as written over a fake window.mimic; the wiring is checked on comment-stripped source.
//
// Run: npx vitest run test/timers-top-mini-handle.test.js

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, evalBlock, stripJs, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const mimic = (f) => readSource(path.join(ROOT, 'apps', 'mimic', f));
const preloadRaw = mimic('preload.js');
const dashRaw = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
const preload = stripJs(preloadRaw);
const dash = stripJs(dashRaw);

// ── 1. ⇅ Timers start at, on the Overlays tab ───────────────────────────────────────────────────────────────────
describe('⇅ Timers start at: the dashboard twin of the alerts window\'s right-click row', () => {
  it('the preload bridge calls the one setter the right-click row calls', () => {
    expect(preload).toContain("timersTopDown:     ()       => ipcRenderer.invoke('wp-timers-order-toggle')");
    expect(preload).toMatch(/mkItem\('⇅ Timers start at: '[^]*?'wp-timers-order-toggle'/);
  });
  it('the Overlays tab has the button, shown only when Mimic reports the switch and has the bridge', () => {
    expect(dash).toContain('data-act="timersOrder" id="wpOvTimersOrderBtn"');
    expect(dash).toContain("typeof st.triggerTimersTopDown === 'boolean' && window.mimic && window.mimic.timersTopDown");
  });

  // The click branch, run as written.
  function click({ showCanvas }) {
    const block = sliceBlock(dashRaw, "      if (a === 'timersOrder' && window.mimic.timersTopDown) {", "\n      }\n      if (a === 'canvasSplit'");
    const body = block.slice(0, block.lastIndexOf("\n      if (a === 'canvasSplit'"));
    const calls = [];
    const win = { mimic: {
      getStatus: () => Promise.resolve({ showCanvas }),
      timersTopDown: () => { calls.push('flip'); return Promise.resolve(true); },
      canvasEdit: (on) => { calls.push('canvas:' + on); return Promise.resolve(); },
    } };
    // eslint-disable-next-line no-new-func
    new Function('window', 'a', 'setTimeout', 'wpRefreshOverlayToggles', body)(win, 'timersOrder', (f) => { calls.push('refresh-scheduled'); }, () => {});
    return new Promise((r) => setImmediate(() => setImmediate(() => r(calls))));
  }
  it('flips the alerts window\'s switch', async () => {
    expect(await click({ showCanvas: false })).toEqual(['flip', 'refresh-scheduled']);
  });
  it('with the Canvas on (the alerts window is stepped aside) it opens the Canvas to arrange instead of flipping a hidden window', async () => {
    expect(await click({ showCanvas: true })).toEqual(['canvas:true', 'refresh-scheduled']);
  });
  it('the label names the current edge and, with the Canvas on, where the setting really lives', () => {
    expect(dash).toContain("'⇅ Timers start at: set per Timers box — open the Canvas'");
    expect(dash).toContain("'TOP (reads down) — switch to bottom' : 'bottom (rises) — switch to top'");
  });
  it('the Canvas side already has it: a Timers box\'s menu offers grows up / grows down, and the flag reaches the panel body', () => {
    const canvas = stripJs(mimic('canvas.html'));
    expect(canvas).toContain('data-anchor="top"');
    expect(canvas).toContain("doc.body.classList.toggle('timers-topdown', p.anchor === 'top');");
    expect(stripJs(mimic('triggers.html'))).toContain('body.part.timers-topdown #timers{top:4px;bottom:auto;');
  });
});

// ── 2. Mini leaves a handle you can see and read ────────────────────────────────────────────────────────────────
describe('▭ Mini: the folded window\'s handle', () => {
  it('the right-click row and the dashboard\'s switch say "click to restore" while mini', () => {
    expect(preload).toMatch(/mkItem\(st\.mini \? '▭ Mini — click to restore \(this overlay\)' : '▭ Mini mode: off \(this overlay\)'/);
    expect(dash).toContain("mOn ? '▭ MINI — click to restore' : '▭ full'");
  });

  // The real _WP_NAME_CSS beside the real whole-overlay fade rule, in Chromium.
  let browser = null, page = null;
  const CSS = (() => {
    const upTo = (src, a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)) + 1);   // through the ';' before b
    const names = evalBlock('const WP_IS_DOCKED = false;\n' + upTo(preloadRaw, 'const _WP_NAME_CSS =', ';\nlet _wpMiniCapable'), ['_WP_NAME_CSS'])._WP_NAME_CSS;
    const fade = evalBlock(upTo(preloadRaw, 'const _WP_OPACITY_CSS =', ";\nipcRenderer.on('content-alpha'"), ['_WP_OPACITY_CSS'])._WP_OPACITY_CSS;
    return names + fade;
  })();
  beforeAll(async () => {
    const { chromium } = require('playwright');
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 420, height: 60 } });
  });
  afterAll(async () => { if (browser) await browser.close(); });

  async function chipLook(cls, alpha) {
    await page.setContent('<style>body{margin:0;background:transparent;font-family:sans-serif}</style><style>' + CSS + '</style>'
      + '<body class="' + cls + '" style="--wp-content-alpha:' + alpha + '">'
      + '<button id="move-btn">m</button><div class="wp-name-chip" data-wp-name>🔔 Alerts &amp; timers</div></body>');
    return page.evaluate(() => {
      const c = document.querySelector('.wp-name-chip'), cs = getComputedStyle(c), r = c.getBoundingClientRect();
      return {
        opacity: +cs.opacity, bg: cs.backgroundColor, border: cs.borderTopColor, fontSize: parseFloat(cs.fontSize),
        before: getComputedStyle(c, '::before').content, after: getComputedStyle(c, '::after').content,
        top: r.top, bottom: r.bottom, w: r.width, h: r.height,
      };
    });
  }
  it('folded: full strength at any overlay opacity, bigger, solid, gold-edged, says what a press does, and fits the 32px window', async () => {
    const folded = await chipLook('wp-mini wp-fold', 0.2);
    expect(folded.opacity).toBe(1);
    expect(folded.fontSize).toBeGreaterThanOrEqual(12);
    expect(folded.bg).toBe('rgba(13, 17, 23, 0.97)');
    expect(folded.border).toBe('rgb(210, 153, 34)');
    expect(folded.before).toContain('▭');
    expect(folded.after).toMatch(/click to restore/);
    expect(folded.top).toBe(6);
    expect(folded.bottom).toBeLessThanOrEqual(32);   // the fold's window is 32px tall at the least (_wpFoldSync)
    expect(folded.w).toBeGreaterThan(140);
  });
  it('not folded: the chip keeps its quiet look and gets no instruction', async () => {
    const quiet = await chipLook('', 1);
    expect(quiet.fontSize).toBe(10);
    expect(quiet.after).toBe('none');
    expect(quiet.before).toBe('none');
  });
  it('the name comes first: a narrow window ellipsizes the instruction, never the name', async () => {
    await page.setViewportSize({ width: 200, height: 60 });
    const look = await chipLook('wp-mini wp-fold', 1);
    expect(look.w).toBeLessThanOrEqual(200 - 28 - 36 + 1);   // max-width: calc(100% - 64px) from left 28
    await page.setViewportSize({ width: 420, height: 60 });
  });
  it('a designed mini\'s stand-in chip is left alone', () => {
    expect(preload).toContain('body.wp-fold .wp-name-chip:not(.wp-name-proxy)');
    expect(preload).toContain('.wp-name-proxy{opacity:0 !important;pointer-events:none}');
  });
});
