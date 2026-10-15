// test/mobinfo-snare-chip.test.js — Target Info says "snare / run speed immune", not "Unsnareable".
//
// The guild lead, 2026-10-15: "This mob is immune to runspeed changes but it doesn't say it anywhere until you cast
// on him." The flag was there as the catalog label "Unsnareable"; the chip now shows the game's own words and the
// game's message as its tooltip. The label stays the data contract — only what the chip shows changes.
//
// Run: npx vitest run test/mobinfo-snare-chip.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const html = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'), 'utf8');
const esc = sliceBlock(html, '  function esc(s){', '\n');
const block = sliceBlock(html, '  var WARN_SPECS = {', "+esc(s ? s[0] : label)+'</span>';\n  }\n");
const { specChip } = evalBlock(esc + block, ['specChip']);

describe('Target Info special-ability chips', () => {
  it('shows Unsnareable in the game\'s words, with the game\'s message as the tooltip', () => {
    const h = specChip('Unsnareable');
    expect(h).toContain('>Snare / run speed immune<');
    expect(h).toContain('title="Your target is immune to changes in its run speed');
    expect(h).toContain('class="chip imm"');
  });
  it('leaves every other label as it was', () => {
    expect(specChip('Unslowable')).toBe('<span class="chip imm">Unslowable</span>');
    expect(specChip('Enrage')).toBe('<span class="chip warn">Enrage</span>');
  });
  it('both chip rows (Stats tab and the summary) go through specChip', () => {
    const s = stripJs(html);
    expect(s).toMatch(/specChips \+= specChip\(slab\);/);
    expect(s).toMatch(/chips \+= specChip\(lab\);/);
    expect(s).not.toMatch(/'<span class="'\+specClass\((slab|lab)\)\+'">'/);
  });
});
