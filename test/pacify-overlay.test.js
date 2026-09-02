// test/pacify-overlay.test.js — a pacify gets its own line, above the mob's
// buffs and above our debuffs.
//
// Hitya, 2026-09-02, choosing this over folding it into either section: it is
// neither. The catalog calls the whole SPA-30 line beneficial (good_effect=1 —
// and it IS good, for the mob), so left alone it renders green among the mob's
// own buffs. But what the raid wants from it is "is this thing still safe to
// walk past", which is the FIRST thing you check before a pull and the last
// thing that should be buried in a list.
//
// ⚠ Behaviour, not text. These run the real render functions out of
// mobinfo.html, because this overlay's whole job is what it puts on screen and
// a comment can satisfy a toContain but not a function call.
//
// Run: npx vitest run test/pacify-overlay.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sliceBlock, evalBlock } from './_source-slice.js';

const src = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'mobinfo.html'), 'utf8');

const { renderTargetBuffs } = evalBlock(
  `
  function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }
  function fmtSecs(s){ var n = Math.max(0, Math.round(s)); return Math.floor(n/60) + ':' + String(n%60).padStart(2,'0'); }
  ` + sliceBlock(
    src,
    '  function _tbuffRow(b, isPacify){',
    '\n  // Cross-client "Casting" section',
  ),
  ['renderTargetBuffs'],
);

const pacify  = { name: 'Pacify',   remaining_secs: 300, total_secs: 360, good: 1, pacified: true };
const harmony = { name: 'Harmony',  remaining_secs: 90,  total_secs: 120, good: 1, pacified: true, owner: 'Canopy' };
const tash    = { name: 'Tashania', remaining_secs: 100, total_secs: 200, good: 0 };
const haste   = { name: 'Celerity', remaining_secs: 400, total_secs: 600, good: 1 };

describe('where a pacify lands on the overlay', () => {
  it('renders above BOTH the debuff and buff sections', () => {
    // Order is the feature. Rendering it last would leave the pull-safety
    // answer below a screenful of the mob's own buffs.
    const html = renderTargetBuffs({ target_buffs: [haste, tash, pacify] });
    const p = html.indexOf('pacified');
    const d = html.indexOf('debuffs');
    const b = html.indexOf('buffs (observed)');
    expect(p).toBeGreaterThan(-1);
    expect(d).toBeGreaterThan(p);
    expect(b).toBeGreaterThan(p);
  });

  it('does not leave the pacify in the green buff list as well', () => {
    // It is pulled OUT of the split, not copied. A duplicate row would show two
    // different countdowns for one effect.
    const html = renderTargetBuffs({ target_buffs: [pacify] });
    expect(html.split('Pacify').length - 1).toBe(2);   // the row's label + its tooltip
    expect(html).not.toContain('buffs (observed)');
    expect(html).not.toContain('debuffs (observed)');
  });

  it('is blue — off the good/bad axis entirely', () => {
    // Green would read "the mob has a buff"; red would read "we are hurting
    // it". It is neither: it is a pull condition that is true or false.
    const html = renderTargetBuffs({ target_buffs: [pacify] });
    expect(html).toContain('#79c0ff');
    expect(html).not.toContain('#56d364');   // the buff green
    expect(html).not.toContain('#f85149');   // the debuff red
  });

  it('says WORE OFF in red when it lapses, not "fell off" in purple', () => {
    // "fell off" is a rebuff cue for a buff you want back. A lapsed pacify
    // means the mob's aggro radius is BACK, which is a hazard, not a chore.
    const html = renderTargetBuffs({ target_buffs: [{ ...pacify, fell_off: true, remaining_secs: 0 }] });
    expect(html).toContain('WORE OFF');
    expect(html).toContain('#f85149');       // hazard red
    expect(html).not.toContain('#a371f7');   // the rebuff purple
    expect(html).not.toContain('fell off');
  });

  it('tells you what the timer MEANS, not just how long is left', () => {
    const live = renderTargetBuffs({ target_buffs: [pacify] });
    expect(live).toContain('safe to pull past until then');
    const gone = renderTargetBuffs({ target_buffs: [{ ...pacify, fell_off: true, remaining_secs: 0 }] });
    expect(gone).toContain('do not pull past it');
  });

  it('still names who cast it, for a pacify relayed from another client', () => {
    // Harmony has no log line at all, so a bystander only ever sees it because
    // the caster's own machine synthesized and uploaded it. Naming them is how
    // you know who to ask for a re-pacify.
    expect(renderTargetBuffs({ target_buffs: [harmony] })).toContain('Canopy');
  });

  it('sorts several pacifies soonest-to-drop first', () => {
    const html = renderTargetBuffs({ target_buffs: [pacify, harmony] });
    expect(html.indexOf('Harmony')).toBeLessThan(html.indexOf('Pacify'));
  });

  it('leaves ordinary buffs and debuffs exactly where they were', () => {
    // The regression that matters: this change must not disturb the two
    // sections that were already there.
    const html = renderTargetBuffs({ target_buffs: [haste, tash] });
    expect(html).not.toContain('pacified');
    expect(html.indexOf('debuffs')).toBeLessThan(html.indexOf('buffs (observed)'));
    expect(html).toContain('Tashania');
    expect(html).toContain('Celerity');
  });
});
