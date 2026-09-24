// DPS HUD → History: the fights to pick from, in a list on the right (the guild
// lead, 2026-09-24: "History should give us a list of the fights to choose
// from on the right side"). It replaced the ◀ 1/6 ▶ pager in the title row.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT, sliceBlock, stripJs, stripCss, evalBlock } from './_source-slice.js';

const html = readSource(path.join(ROOT, 'apps', 'mimic', 'overlay.html'));
const js = stripJs(html);
const css = stripCss(html.slice(html.indexOf('<style>'), html.indexOf('</style>')));

const escLine = html.slice(html.indexOf('  function esc(s)'), html.indexOf('\n', html.indexOf('  function esc(s)')));
const itemFn = sliceBlock(html, '  function histItemHtml(h, i, on, nowMs) {', '\n  }\n');
const { histItemHtml } = evalBlock(escLine + '\n' + itemFn, ['histItemHtml']);

describe('History fight list', () => {
  const now = 1_790_000_000_000;
  const fight = (extra) => Object.assign({ boss: 'Lord Vyemm', durationSec: 212, endedMs: now - 6 * 60000, settled: true }, extra);

  it('a row names the mob, how long it took, and how long ago it ended', () => {
    const h = histItemHtml(fight(), 2, false, now);
    expect(h).toContain('data-i="2"');
    expect(h).toContain('>Lord Vyemm<');
    expect(h).toContain('3:32 · 6m ago');
    expect(h).not.toContain('hitem on');
  });

  it('the fight on screen is marked, and one still settling says so', () => {
    const h = histItemHtml(fight({ settled: false, endedMs: now - 20_000 }), 0, true, now);
    expect(h).toContain('class="hitem on"');
    expect(h).toContain('Lord Vyemm …');
    expect(h).toContain('3:32 · now');
    expect(h).toContain('still settling');
  });

  it('a mob name cannot break out of the row', () => {
    expect(histItemHtml(fight({ boss: '<img src=x>' }), 0, false, now)).not.toContain('<img');
  });

  it('picking a row shows that fight; the list is clickable on a locked overlay', () => {
    expect(js).toMatch(/histListEl\.addEventListener\('click', function\(e\)\{[\s\S]*?HIST_IDX = parseInt\(b\.getAttribute\('data-i'\), 10\) \|\| 0;/);
    expect(js).toContain('[tabDpsBtn, tabTankBtn, tabHistBtn, histListEl].forEach');
    expect(html).toContain('<ul id="histList" class="histlist"></ul>');
    expect(html).not.toMatch(/id="hist(Prev|Next|Which|Nav)"/);             // the pager is gone
  });

  it('the list shows only on History, and the scoreboard picks its columns by its OWN width', () => {
    expect(js).toContain("document.body.classList.toggle('hist', mode === 'history')");
    expect(css).toContain('body.hist .histwrap{display:grid;grid-template-columns:minmax(0,1fr) 112px');
    expect(css).toContain('.board{container:board / inline-size}');
    expect(css).toContain('@container board (min-width: 370px){');
    expect(css).not.toContain('@media (min-width: 400px)');
  });
});
