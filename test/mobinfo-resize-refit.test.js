// test/mobinfo-resize-refit.test.js — Target Info (Mob Info) re-measures its window when the WIDTH changes.
//
// A member, 2026-10-30: "mimic gets all [messed] up when u resize the window — the target info … closing it and
// reopening it fixes it". The overlay sizes its window to its content (overlayAutoHeight(#wrap.scrollHeight + 12)),
// but only when its HTML changes: _renderBody returns early on an unchanged paint, and the 500 ms poll repaints the
// same HTML for as long as the target stays the same. A new width rewraps that same HTML to a different height, so
// narrowing left the chips and lines cut off at the bottom of the window and widening left a tall empty card, until
// the target changed or the overlay was closed and reopened (the reopen runs the first fit).
//
// ⚠ Behaviour, not text. The overlay's REAL <script> boots against a minimal fake DOM whose #wrap height depends on
// the window width (the property a real rewrap has), with a fake clock for the debounce. Verified separately in
// Chromium (Playwright, real layout): a 420 → 200 px viewport changed #wrap.scrollHeight 160 → 189 and, before the
// fix, sent no overlayAutoHeight call at all.
//
// Run: npx vitest run test/mobinfo-resize-refit.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT } from './_source-slice.js';

const MOB = readSource(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'));
const flush = () => new Promise((r) => setTimeout(r, 0));

const payload = {
  mobInfo: {
    target_name: 'a gnoll warlord', target_hp_pct: 64.2, loading: false,
    mob: { id: 4051, name: 'a gnoll warlord', level: 30, class: 'Shadow Knight', hp: 9000, ac: 120,
           resists: { mr: 30, fr: 30, cr: 30, pr: 30, dr: 30 }, specials: ['Enrage'], loot: [] },
    target_buffs: [], target_casting: [], target_slow: null,
    target_mana: null, target_lastcast: null, target_player: null, target_npc_ht: null,
  },
};

// Content is 160 px tall at 400 px or wider and 190 px tall below that: a rewrap.
const heightAt = (w) => (w >= 400 ? 160 : 190);

async function boot() {
  const script = MOB.slice(MOB.indexOf('<script>') + 8, MOB.lastIndexOf('</script>'));
  const fits = [];
  const els = new Map();
  const winListeners = {};
  const intervals = [];
  const timers = [];
  const classSet = () => ({ add() {}, remove() {}, contains: () => false, toggle() {} });
  const window = {
    innerWidth: 420,
    mimic: {
      overlayAutoHeight: (h) => fits.push(h),
      overlayHoverInteractive() {}, attachOverlayMenu() {}, openExternal() {},
    },
    addEventListener: (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); },
    localStorage: { getItem: () => null, setItem() {} },
  };
  function el(id) {
    if (!els.has(id)) {
      let inner = '';
      els.set(id, {
        id, style: {}, textContent: '', className: '', classList: classSet(),
        addEventListener() {}, getAttribute() { return null; },
        get innerHTML() { return inner; },
        set innerHTML(v) { inner = String(v); },
        get scrollHeight() { return id === 'wrap' ? heightAt(window.innerWidth) : 0; },
      });
    }
    return els.get(id);
  }
  const document = {
    getElementById: el, body: { classList: classSet() },
    documentElement: { style: { setProperty() {} } }, addEventListener() {},
  };
  const fetch = async () => ({ json: async () => payload });
  const setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; };
  // A fake clock: setTimeout parks the callback, tick(ms) runs what is due.
  let now = 0;
  const setTimeoutFake = (fn, ms) => { const t = { fn, at: now + (ms || 0), dead: false }; timers.push(t); return t; };
  const clearTimeoutFake = (t) => { if (t) t.dead = true; };
  new Function('window', 'document', 'fetch', 'setInterval', 'setTimeout', 'clearTimeout', script)(
    window, document, fetch, setInterval, setTimeoutFake, clearTimeoutFake);
  await flush();
  return {
    fits,
    // The overlay's own 500 ms poll, run once — an unchanged target paints the same HTML.
    async poll() { intervals.find((i) => i.ms === 500).fn(); await flush(); },
    // The window got a new size: the page's 'resize' event fires.
    resizeTo(w) { window.innerWidth = w; for (const fn of winListeners.resize || []) fn(); },
    tick(ms) {
      now += ms;
      for (const t of timers.slice()) if (!t.dead && t.at <= now) { t.dead = true; t.fn(); }
    },
  };
}

describe('Target Info refits its window after a resize', () => {
  it('narrowing rewraps the same card: a fit at the new height follows, without any target change', async () => {
    const o = await boot();
    await o.poll();
    expect(o.fits.at(-1)).toBe(160 + 12);          // the first fit, at the width it opened at
    const before = o.fits.length;
    o.resizeTo(200);
    await o.poll();                                // the same HTML again: _renderBody paints nothing, fits nothing
    expect(o.fits.length).toBe(before);
    o.tick(600);
    expect(o.fits.at(-1)).toBe(190 + 12);          // the narrower card is taller; the window follows it
  });

  it('widening shrinks the window back to the shorter card', async () => {
    const o = await boot();
    o.resizeTo(200); o.tick(600);
    expect(o.fits.at(-1)).toBe(190 + 12);
    o.resizeTo(420); o.tick(600);
    expect(o.fits.at(-1)).toBe(160 + 12);
  });

  it('a drag is one fit, not one per step: it waits until the size is quiet', async () => {
    const o = await boot();
    await o.poll();
    const before = o.fits.length;
    for (const w of [380, 340, 300, 260, 220]) { o.resizeTo(w); o.tick(100); }
    expect(o.fits.length).toBe(before);            // still dragging
    o.tick(600);
    expect(o.fits.length).toBe(before + 1);
    expect(o.fits.at(-1)).toBe(190 + 12);
  });

  it('a height-only drag (the width did not change) re-measures nothing — the height floor owns that', async () => {
    const o = await boot();
    await o.poll();
    const before = o.fits.length;
    o.resizeTo(420);                               // a resize event at the same width
    o.tick(600);
    expect(o.fits.length).toBe(before);
  });
});
