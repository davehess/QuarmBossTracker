// test/mobinfo-slow-mitigation-chip.test.js — Target Info tags a partially slowable mob "Slow −N%".
//
// The guild lead, 2026-11-04: Obsidian Tree Spider Queen "is only partially slowable". The bot sends
// slow_mitigation (percent of a slow the server removes); the chip shows only 0 < N < 100.
//
// Run: npx vitest run test/mobinfo-slow-mitigation-chip.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const html = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'), 'utf8');
const esc = sliceBlock(html, '  function esc(s){', '\n');
const block = sliceBlock(html, '  function slowMitChip(mob){', "Slow \\u2212'+n+'%</span>';\n  }\n");
const { slowMitChip } = evalBlock(esc + block, ['slowMitChip']);

describe('slowMitChip', () => {
  it('reads Slow −80% with a tooltip saying what it means', () => {
    const h = slowMitChip({ slow_mitigation: 80 });
    expect(h).toContain('>Slow \u221280%<');
    expect(h).toContain('only 20% of its strength');
  });
  it('draws nothing at 0, 100, missing, junk or no mob', () => {
    for (const m of [{ slow_mitigation: 0 }, { slow_mitigation: 100 }, {}, { slow_mitigation: 'x' }, { slow_mitigation: null }, null]) {
      expect(slowMitChip(m)).toBe('');
    }
  });
  it('is byte-stable for the same mob', () => {
    expect(slowMitChip({ slow_mitigation: 95 })).toBe(slowMitChip({ slow_mitigation: 95 }));
  });
  it('both chip rows add it and Unslowable still renders on its own', () => {
    const s = stripJs(html);
    expect(s).toMatch(/specChips \+= slowMitChip\(mob\);/);
    expect(s).toMatch(/chips \+= slowMitChip\(mob\);/);
    expect(s).toContain("'Unmezzable', 'Uncharmable', 'Unslowable'");
  });
});
