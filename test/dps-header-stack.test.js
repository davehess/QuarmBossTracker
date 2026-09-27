// DPS HUD header (the guild lead, 2026-09-25, from a live screenshot where the
// boss name wrapped to three lines): "the /rs is too big, should just be a copy
// icon. We should stack DPS and Tank on top of each other and make more
// horizontal room". History moved under the row count for the same reason.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, stripJs, stripCss } from './_source-slice.js';

const html = readSource(path.join(ROOT, 'apps', 'mimic', 'overlay.html'));
const js = stripJs(html);
const css = stripCss(html.slice(html.indexOf('<style>'), html.indexOf('</style>')));
// Markup with HTML comments removed, so a comment describing the layout can't
// stand in for the layout.
const markup = html.slice(html.indexOf('<div class="title">'), html.indexOf('<!-- History: the scoreboard'))
  .replace(/<!--[\s\S]*?-->/g, '');
const block = (open) => {
  const i = markup.indexOf(open);
  if (i < 0) return '';
  let depth = 0, j = i;
  const re = /<(\/?)span\b[^>]*>/g;
  re.lastIndex = i;
  for (let m; (m = re.exec(markup));) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) { j = re.lastIndex; break; }
  }
  return markup.slice(i, j);
};

describe('DPS HUD header', () => {
  it('the /rs copy is a bare copy icon, and says ✓ after a copy', () => {
    expect(markup).toMatch(/<button id="copyRs"[^>]*>📋<\/button>/);
    expect(markup).not.toContain('📋 /rs');
    expect(js).toContain("copyRsBtn.textContent = '✓';");
    expect(js).toContain("copyRsBtn.textContent = '📋';");
    expect(js).not.toContain('copied — paste in /rs');
  });

  it('DPS sits on top of Tank in one column', () => {
    const stack = block('<span class="tabstack">');
    expect(stack).toMatch(/id="tabDps"[\s\S]*id="tabTank"/);
    expect(stack).not.toContain('tabHist');
    expect(css).toMatch(/\.tabstack,\.ctlstack\{display:flex;flex-direction:column/);
  });

  it('History sits under the row count, not beside DPS/Tank', () => {
    const ctl = block('<span class="ctlstack wp-mini-hide">');
    expect(ctl).toMatch(/class="rowcfg"[\s\S]*id="rowsN"[\s\S]*id="tabHist"/);
    expect(block('<span class="tabs wp-mini-hide">')).not.toContain('tabHist');
  });

  it('both columns still hide in mini mode', () => {
    expect(markup).toContain('<span class="ctlstack wp-mini-hide">');
    expect(markup).toContain('<span class="tabs wp-mini-hide">');
  });
});
