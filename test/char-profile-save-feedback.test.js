// test/char-profile-save-feedback.test.js — the dashboard's "💾 Save current layout" says whether it worked.
//
// The guild lead, 2026-09-29, with the per-character layouts card: "this button has no feedback". A first
// save pushes fresh status and the card is rebuilt, so the result lives in a variable the render reads
// (a label set on the button alone would be wiped). Runs the real helpers out of dashboard.html with a
// controllable clock.
//
// Run: npx vitest run test/char-profile-save-feedback.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs } from './_source-slice.js';

const html = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));

function load() {
  let now = 1_000_000;
  const block = sliceBlock(html, 'var _WP_CP_FLASH_MS = 2500;', '\n}');
  // eslint-disable-next-line no-new-func
  const api = new Function('Date', block + '\nreturn { look: _wpCpSaveLook, set: function(f){ _wpCpFlash = f; } };')(
    { now: () => now });
  return { api, tick: (ms) => { now += ms; }, now: () => now };
}

describe('the Save layout button', () => {
  it('reads as a plain save until pressed', () => {
    const { api } = load();
    expect(api.look('Aldenmar')).toEqual({ text: '💾 Save current layout for Aldenmar', color: '#7ee787' });
  });

  it('a save that worked says so, for that character, then goes back', () => {
    const { api, tick, now } = load();
    api.set({ ok: true, at: now() });
    expect(api.look('Aldenmar')).toEqual({ text: '✓ Saved for Aldenmar', color: '#56d364' });
    tick(2600);
    expect(api.look('Aldenmar').text).toBe('💾 Save current layout for Aldenmar');
  });

  it('a save that did not work says why, in red', () => {
    const { api, now } = load();
    api.set({ ok: false, at: now() });
    expect(api.look(null)).toEqual({ text: '✗ Not saved — no character yet', color: '#f85149' });
  });

  // Option C (2026-09-29): the button is the "Save current layout" tile in Your layouts, painted
  // from Mimic status, so its click rides the delegated handler. The tile itself is run for real in
  // test/overlays-tab-option-c.test.js.
  it('the tile render and the click both go through it', () => {
    const code = stripJs(html);
    const tiles = stripJs(sliceBlock(html, 'function _wpOvLaysHtml(st, cfg, flagOf) {', '\n}\n'));
    expect(tiles).toMatch(/var look = _wpCpSaveLook\(act \|\| null\);[\s\S]{0,200}?id="wpCharProfSave"[\s\S]{0,200}?look\.color[\s\S]{0,120}?look\.text/);
    expect(code).toMatch(/closest\('\.wp-charprof-save'\)[\s\S]{0,700}?Promise\.resolve\(window\.mimic\.charProfileSave\(\)\)\.then\(done/);
  });
});
