// test/mobinfo-social-chip.test.js — FB-118: Target Info's Stats tab says who can come to a mob's aid ("Social ×N").
//
// A raider, 2026-11-04: "Social aggro will call another mob ... Quazlith came from flame mephit". The bot already
// sends faction_assisted_by (capped) + faction_assisted_by_more, shown only on the F/Q/V Faction tab; the chip puts
// the count beside the other pre-pull chips, with the names in its tooltip.
//
// Mutation-checked (by hand, 2026-11-04): drop `+ faction_assisted_by_more` from n and "counts past the cap" fails;
// remove `chips += socialChip(mob);` and "the Stats chip row adds it" fails.
//
// Run: npx vitest run test/mobinfo-social-chip.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const html = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'), 'utf8');
const esc = sliceBlock(html, '  function esc(s){', '\n');
const block = sliceBlock(html, '  function socialChip(mob){', "Social \\u00d7'+n+'</span>';\n  }\n");
const { socialChip } = evalBlock(esc + block, ['socialChip']);

describe('socialChip', () => {
  it('counts the kinds that assist, names them in the tooltip', () => {
    const h = socialChip({ faction_assisted_by: [{ name: 'Quazlith', npc_id: 212053 }, { name: 'a magmin', npc_id: 212020 }] });
    expect(h).toContain('>Social \u00d72<');
    expect(h).toContain('Quazlith, a magmin');
  });
  it('counts past the cap and says how many more', () => {
    const h = socialChip({ faction_assisted_by: [{ name: 'Quazlith' }], faction_assisted_by_more: 47 });
    expect(h).toContain('>Social \u00d748<');
    expect(h).toContain('and 47 more');
  });
  it('escapes names', () => {
    expect(socialChip({ faction_assisted_by: [{ name: '<b>x</b>"' }] })).not.toContain('<b>x');
  });
  it('draws nothing for a mob nobody assists, an older bot, or no mob', () => {
    for (const m of [{ faction_assisted_by: [] }, {}, { faction_assisted_by: null, faction_assisted_by_more: 0 }, null]) {
      expect(socialChip(m)).toBe('');
    }
  });
  it('the Stats chip row adds it', () => {
    expect(stripJs(html)).toMatch(/chips \+= slowMitChip\(mob\);\s*chips \+= socialChip\(mob\);/);
  });
});
