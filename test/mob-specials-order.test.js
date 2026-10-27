// test/mob-specials-order.test.js — Summon leads the special-ability chips (FB-104).
//
// FB-104 (Mimic 3.0.5-beta.9, Target Info Stats tab, mob "A Valorous Spirit"): "Summon shows up at the end of this
// list instead of at the beginning. It should stand out more." The catalog lists codes numerically and the bot
// UNIONS the same-name sibling rows after the primary's, so a Summon that only a sibling carries (the Spirit's own
// row has Enrage, Triple Attack, Does Not Equip, Magical, Unfearable, Immune Fleeing, Immune Non-Magical) landed last.
// The overlay and the NPC page now draw chips in one fixed order, Summon first, and Summon is the one solid-red chip.
//
// Real code on both surfaces: the overlay's specSort/specChip are evaluated out of mobinfo.html, the page's
// sortMobSpecialChips is imported. The two order tables are copies and must not drift.
//
// Run: npx vitest run test/mob-specials-order.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, sliceBlock, evalBlock, stripJs } from './_source-slice.js';
import * as web from '../web/lib/npcDecode.ts';

const bot = createRequire(import.meta.url)('../utils/mobSpecials.js');
const html = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'), 'utf8');
const esc = sliceBlock(html, '  function esc(s){', '\n');
const chipBlock = sliceBlock(html, '  var WARN_SPECS = {', "+esc(s ? s[0] : label)+'</span>';\n  }\n");
const orderBlock = sliceBlock(html, '  var SPEC_ORDER = [', '.map(function(o){ return o.l; });\n  }');   // through specSort's closing brace
const { specChip, specSort, SPEC_ORDER } = evalBlock(esc + chipBlock + orderBlock, ['specChip', 'specSort', 'SPEC_ORDER']);

// What the bot would send for the Spirit: its own row, then the sibling's extras appended after (pickAndMergeMobRows).
const SPIRIT = ['Enrage', 'Triple Attack', 'Does Not Equip', 'Magical', 'Unfearable', 'Immune Fleeing', 'Immune Non-Magical', 'Summon'];

describe('the Target Info overlay', () => {
  it('puts Summon first, whatever the catalog order', () => {
    expect(specSort(SPIRIT)[0]).toBe('Summon');
    expect(specSort(SPIRIT)).toEqual([
      'Summon', 'Enrage', 'Immune Non-Magical', 'Unfearable', 'Immune Fleeing', 'Magical', 'Triple Attack', 'Does Not Equip',
    ]);
  });

  it('ranks what the mob does to you above what it is immune to, and immunities above notes', () => {
    const got = specSort(['Does Not Equip', 'Unmezzable', 'Immune Melee', 'Flurry', 'Silences', 'Reverse Slow — slowing hastes it', 'Summon']);
    expect(got).toEqual(['Summon', 'Reverse Slow — slowing hastes it', 'Flurry', 'Silences', 'Immune Melee', 'Unmezzable', 'Does Not Equip']);
  });

  it('keeps a label it has no rank for after the ranked ones, in the order it came', () => {
    expect(specSort(['Quad Attack', 'Zzz New Thing', 'Magical', 'Summon'])).toEqual(['Summon', 'Magical', 'Quad Attack', 'Zzz New Thing']);
  });

  it('does not touch the list it was given', () => {
    const src = ['Magical', 'Summon'];
    specSort(src);
    expect(src).toEqual(['Magical', 'Summon']);
  });

  it('draws Summon as the one solid-red chip, with the warning mark and a tooltip', () => {
    const h = specChip('Summon');
    expect(h).toContain('class="chip warn summon"');
    expect(h).toContain('>⚠ Summon<');
    expect(h).toContain('title="This mob can summon players to itself"');
    expect(specChip('Enrage')).toBe('<span class="chip warn">Enrage</span>');
    expect(stripJs(html)).toMatch(/\.spec \.chip\.warn\.summon\{background:#f85149;/);
  });

  it('both chip rows sort before they draw', () => {
    const s = stripJs(html);
    expect(s).toMatch(/specSort\(mob\.specials\)[\s\S]{0,200}specChips \+= specChip\(slab\)/);
    expect(s).toMatch(/specSort\(mob\.specials\)[\s\S]{0,200}chips \+= specChip\(lab\)/);
  });
});

describe('the NPC page on wolfpack.quest', () => {
  const chips = (labels) => labels.map((label) => ({ label, danger: false }));

  it('uses the same order table as the overlay', () => {
    expect(web.MOB_SPECIAL_ORDER).toEqual(SPEC_ORDER);
  });

  it('sorts the same way as the overlay for any mix', () => {
    expect(web.sortMobSpecialChips(chips(SPIRIT)).map((c) => c.label)).toEqual(specSort(SPIRIT));
  });

  it('decodes a real Summon row to Summon first', () => {
    // 211005 A Valorous Spirit's own row plus a sibling with code 1 (Summon) merged after it.
    const labels = web.decodeMobSpecialChips('2,1^6,1^8,1^10,1^17,1^21,1^23,1^42,1^1,1', null);
    expect(web.sortMobSpecialChips(labels)[0]).toEqual({ label: 'Summon', danger: true });
  });
});

describe('the table covers what the catalog and the bot can send', () => {
  const ranked = (l) => SPEC_ORDER.indexOf(l);
  const warnings = Object.values(bot.MOB_SPECIAL_CODES).filter((d) => d.show && d.danger).map((d) => d.label);

  it('ranks every danger label, and every one ahead of every non-danger label', () => {
    const lastDanger = Math.max(...warnings.map(ranked));
    expect(warnings.every((l) => ranked(l) >= 0)).toBe(true);
    const calm = Object.values(bot.MOB_SPECIAL_CODES).filter((d) => d.show && !d.danger && ranked(d.label) >= 0);
    // The one non-danger label the overlay paints red is Bane (WARN_SPECS); everything else calm ranks after the dangers.
    expect(calm.filter((d) => d.label !== 'Bane').every((d) => ranked(d.label) > lastDanger)).toBe(true);
  });

  it('ranks the two labels the bot adds off the spell list, with the dangers', () => {
    expect(ranked('Silences (AoE)')).toBeGreaterThan(ranked('Flurry'));
    expect(ranked('Silences')).toBeLessThan(ranked('Immune Melee'));
  });

  it('lists a label once, and only labels the bot can send', () => {
    expect(new Set(SPEC_ORDER).size).toBe(SPEC_ORDER.length);
    const known = new Set([...Object.values(bot.MOB_SPECIAL_CODES).map((d) => d.label), 'Silences', 'Silences (AoE)']);
    for (const l of SPEC_ORDER) expect(known.has(l)).toBe(true);
  });

  it('Summon is first, and the Spirit\'s own catalog row has none (a sibling row supplies it)', () => {
    expect(SPEC_ORDER[0]).toBe('Summon');
    expect(bot.decodeSpecialLabels('2,1^6,1^8,1^10,1^17,1^21,1^23,1^42,1', null)).not.toContain('Summon');
  });
});
