// test/canvas-part-title.test.js — FB-105 (Mimic 3.0.6-beta.4): "These alerts and timers overlays in canvas display their
// window title background and you can't turn it off."
//
// The Alerts & timers page carries a name chip (<div class="wp-name-chip" data-wp-name>) with a dark plate of its own. On
// the Timers canvas the page is a frame (triggers.html?part=timers | callouts) whose only plate is the panel's own
// Background switch, so the chip must not draw there, whatever the preload did. The page hides it itself under body.part.
//
// What this cannot show: a real Electron frame. test/ has no browser; the rule is checked on the page's own stylesheet.
//
// Run: npx vitest run test/canvas-part-title.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, stripCss, ROOT } from './_source-slice.js';

const html = readSource(path.join(ROOT, 'apps', 'mimic', 'triggers.html'));
const css = stripCss(html.slice(html.indexOf('<style>'), html.indexOf('</style>')));

// The declarations of every rule whose selector list names `sel` exactly, in source order.
function rulesFor(sel) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    if (m[1].split(',').map((s) => s.trim()).includes(sel)) out.push(m[2].trim());
  }
  return out;
}

describe('FB-105: the name chip does not draw in a canvas panel frame', () => {
  it('the page has the chip (so the rule is guarding something real)', () => {
    expect(html).toMatch(/<div class="wp-name-chip"[^>]*\sdata-wp-name\b/);
  });
  it('under body.part the chip is display:none !important, from the page itself', () => {
    const r = rulesFor('body.part .wp-name-chip');
    expect(r.length).toBeGreaterThan(0);
    expect(r.join(';')).toMatch(/display\s*:\s*none\s*!important/);
  });
  it('the part class is the one the page sets from ?part=, and the rule is scoped to it (the full window keeps its chip)', () => {
    expect(html).toContain("document.body.classList.add('part')");
    expect(rulesFor('.wp-name-chip')).toEqual([]);
  });
});
