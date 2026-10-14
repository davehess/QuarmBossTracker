// test/pop-steps.test.js — every character-flag step on the /pop cards (the guild lead, 2026-10-13: "update the
// entire page with all of the character flag steps required, not just the main ones").
//
// web/lib/popSteps.ts is the step catalog (pure, runs for real here); utils/popFlagStages.js names the stages the
// server's lines can produce. The two must agree, or a stage the bot stores would count on no card.
//
// Run: npx vitest run test/pop-steps.test.js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, stripJs } from './_source-slice.js';
import { POP_ZONES } from '../web/lib/popFlags.ts';
import { POP_STEPS, STEP_IMPLIES, stepsHeld } from '../web/lib/popSteps.ts';

const require = createRequire(import.meta.url);
const S = require('../utils/popFlagStages.js');

const range = (p, a, b) => Array.from({ length: b - a + 1 }, (_, i) => `${p}${a + i}`);

describe('stepsHeld expands a series to every step it proves', () => {
  it('a late Fuirstel stage carries the earlier ones and the keys that rode with them', () => {
    const got = stepsHeld(['fuirstel_5']);
    for (const k of [...range('fuirstel_', 1, 4), 'grummus_1', 'bertox_key_1']) expect(got.has(k)).toBe(true);
  });
  it('zeks 7 carries zeks 1 to 6', () => {
    const got = stepsHeld(['zeks_7']);
    for (const k of range('zeks_', 1, 6)) expect(got.has(k)).toBe(true);
  });
  it('the Justice catalog flag carries the three Mavuin steps', () => {
    const got = stepsHeld(['trial_justice']);
    for (const k of range('mavuin_', 1, 3)) expect(got.has(k)).toBe(true);
  });
  it('the cipher replaces both halves and everything under them', () => {
    const got = stepsHeld(['cipher_1']);
    for (const k of ['saryrn_1', 'mmarr_1', 'tylis_1', 'tylis_2', ...range('hoh_trial_', 1, 3)]) expect(got.has(k)).toBe(true);
  });
  it('the Doomfire stage carries all five wings, Miak and the Rallos Zek step', () => {
    const got = stepsHeld(['pofire_2']);
    for (const k of [...range('sol_room_', 1, 5), 'pofire_1', 'zeks_7']) expect(got.has(k)).toBe(true);
  });
  it('holding nothing proves nothing', () => {
    expect(stepsHeld([]).size).toBe(0);
  });
});

describe('the catalog covers the chart', () => {
  it('every zone card has steps, and no steps sit on a card that does not exist', () => {
    const zoneKeys = POP_ZONES.map(z => z.key);
    for (const k of zoneKeys) expect(POP_STEPS[k]?.length, k).toBeGreaterThan(0);
    for (const k of Object.keys(POP_STEPS)) expect(zoneKeys, k).toContain(k);
  });

  it('a checklist reference is a cl_ flag', () => {
    for (const steps of Object.values(POP_STEPS)) {
      for (const s of steps) if (s.checklist !== undefined) expect(s.checklist, s.key).toMatch(/^cl_/);
    }
  });

  it('a step key appears once', () => {
    const all = Object.values(POP_STEPS).flat().map(s => s.key);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('every stage the bot can store counts somewhere', () => {
  it('is a step key, or sits in STEP_IMPLIES', () => {
    const produced = new Set([
      ...S.PREV_STAGES.map(r => r[3]),
      ...S.RECITAL_STAGES.map(r => r[1]),
      ...Object.values(S.ZONE_ONLY.grant),
    ]);
    const known = new Set([
      ...Object.values(POP_STEPS).flat().map(s => s.key),
      ...Object.keys(STEP_IMPLIES),
      ...Object.values(STEP_IMPLIES).flat(),
    ]);
    // Left out on purpose: the checklist flags (a step's own `checklist` field names them, and the cards read
    // them from the character's flags), and 'seventh_1', the Tribunal's closing line, which no gate asks for.
    // 'hohtrials_111' and 'zeks_5' are summaries; STEP_IMPLIES carries them, so they pass the check above.
    const ignore = new Set(['seventh_1']);
    const missing = [...produced].filter(k => !k.startsWith('cl_') && !ignore.has(k) && !known.has(k));
    expect(missing).toEqual([]);
  });
});

describe('the cards read the catalog', () => {
  it('ZoneCard renders POP_STEPS and expands each character once with stepsHeld', () => {
    const src = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/pop/page.tsx'), 'utf8'));
    expect(src).toContain('POP_STEPS[z.key]');
    expect(src).toContain('stepsHeld(');
  });
  it('the top explanation folds behind a one-line summary (2026-10-14)', () => {
    // the guild lead: "collapse the top explanation of the page with a summary and then click here for more info"
    const src = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/pop/page.tsx'), 'utf8'));
    const top = src.slice(src.indexOf('🌀 PoP Flags'), src.indexOf('👥 <b'));
    expect(top).toMatch(/<details[^>]*>\s*<summary[^>]*>Click here for more info<\/summary>/);
    expect(top.indexOf('<details')).toBeGreaterThan(top.indexOf('every gate and every step'));   // summary first
    expect(top.indexOf('guided')).toBeGreaterThan(top.indexOf('<details'));                      // the long text inside
  });
});
