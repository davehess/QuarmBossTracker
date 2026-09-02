// test/mobinfo-sight-chips.test.js — "will invis hide me from this?", answered
// with one chip instead of four.
//
// Hitya, 2026-09-02: "mob info needs to also denote if a mob can see invis."
//
// ⚠ THE NAIVE VERSION IS WORSE THAN NOTHING. Measured over the 18,033-row
// catalog:
//     non-undead           see_invis 11%   see_invis_undead 96%
//     UNDEAD (bodytype 3)  see_invis 98%   see_invis_undead 15%
// Each flag is near-universal on one side and rare on the other, so chipping
// both unconditionally decorates ~every mob and tells you nothing. The chip has
// to follow the spell you would actually cast: IVU on undead, plain invis on
// the living.
//
// Behaviour, not text — this runs the real sightChips out of mobinfo.html.
//
// Run: npx vitest run test/mobinfo-sight-chips.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'), 'utf8');

const { sightChips } = evalBlock(
  `function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }\n`
  // ⚠ End anchor is the section comment that OPENS the next block, never a line
  // of sightChips' own body — a slice closed on the code under test turns every
  // mutation into "suite failed to load", which reads like a kill and proves
  // nothing. It also must stop before the DOM handles, which do not exist here.
  + sliceBlock(src, '  function sightChips(mob){', '\n  // ── DOM handles + tab state '),
  ['sightChips'],
);

// Real catalog shapes.
const livingBlind = { undead: false, see_invis: false, see_invis_undead: true  };  // the 96% living case
const livingSees  = { undead: false, see_invis: true,  see_invis_undead: true  };  // the 11% that matter
const undeadNorm  = { undead: true,  see_invis: true,  see_invis_undead: false };  // the 85% of undead IVU works on
const undeadSees  = { undead: true,  see_invis: true,  see_invis_undead: true  };  // the 15% exception

describe('which sight fact is worth saying', () => {
  it('warns on a living mob that sees invis', () => {
    expect(sightChips(livingSees)).toContain('Sees Invis');
  });

  it('says nothing about a living mob that does not', () => {
    // The 96% see_invis_undead on living mobs is a rule, not a fact about this
    // mob — chipping it would decorate almost every mob in the game.
    expect(sightChips(livingBlind)).toBe('');
  });

  it('warns on the rare undead that sees Invis vs Undead', () => {
    const html = sightChips(undeadSees);
    expect(html).toContain('Sees Invis vs Undead');
  });

  it('stays quiet on the ordinary undead that IVU still works on', () => {
    // 98% of undead see plain invis, so "Sees Invis" here is noise — and worse,
    // it would imply IVU fails too, which is the opposite of the truth for 85%
    // of them.
    expect(sightChips(undeadNorm)).toBe('');
  });

  it('never tells an undead mob it sees plain invis', () => {
    // True for 98% of them and useless; the raider is casting IVU, not invis.
    for (const m of [undeadNorm, undeadSees]) {
      expect(sightChips(m)).not.toMatch(/Sees Invis(?!\s+vs)/);
    }
  });

  it('names the right spell in the tooltip, per side', () => {
    expect(sightChips(livingSees)).toMatch(/Invisibility will NOT hide you/);
    expect(sightChips(undeadSees)).toMatch(/Invisibility versus Undead will NOT hide you/);
  });

  it('flags Improved Hide, which is rare enough to always matter', () => {
    expect(sightChips({ ...livingBlind, see_improved_hide: true })).toContain('Sees Improved Hide');
    expect(sightChips({ ...undeadNorm,  see_improved_hide: true })).toContain('Sees Improved Hide');
  });

  it('does not print both hide chips for one mob', () => {
    const html = sightChips({ ...livingBlind, see_hide: true, see_improved_hide: true });
    expect(html).toContain('Sees Improved Hide');
    expect(html.match(/Sees (Improved )?Hide/g)).toHaveLength(1);
  });

  it('renders nothing at all for a mob with no catalog row', () => {
    // The overlay already prints "no catalog stats for this target"; a silent
    // absence must not read as an all-clear.
    expect(sightChips(null)).toBe('');
    expect(sightChips(undefined)).toBe('');
  });

  it('uses the sight tone, not the combat-warning tone', () => {
    // A pull-planning fact and a "this mob rampages" fact must not look alike.
    expect(sightChips(livingSees)).toContain('chip sight');
    expect(sightChips(livingSees)).not.toContain('chip warn');
  });
});

// ⚠ The behaviour tests above prove sightChips is RIGHT, not that anything
// calls it. Deleting the call site left all ten green — the same seam that hid
// a broken `pacified` flag earlier today. Comments are stripped first, because
// this file's own comments describe the call in prose and would satisfy a
// naive toContain.
describe('and it is actually wired into the card', () => {
  const clean = stripJs(fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'), 'utf8'));

  it('calls sightChips when building the stats card', () => {
    expect(clean).toMatch(/var chips = sightChips\(mob\)/);
  });

  it('renders the chip row when sight chips exist even with no specials', () => {
    // The old code only opened .spec if mob.specials was non-empty, so a mob
    // with a sight warning and no special attacks would have shown nothing.
    expect(clean).toMatch(/if \(chips\) spec = '<div class="spec">'\+chips\+'<\/div>'/);
  });
});
