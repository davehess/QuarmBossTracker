// test/bard-slow.test.js — Requiem of Time is a slow, and the callout says "Bard Slow (55%)".
//
// The guild lead, 2026-10-13, with the spell window (Requiem of Time: Decrease Attack Speed by 55%): "Requiem of Time
// is a slow as well, call out Bard Slow (55%)". Spell 3066 is SPA 11 with max 45, so 100 - 45 = 55%. It lands as
// "<mob>'s rhythm slows.", a line no other spell uses, so a bystander sees which slow it was.
//
// Run: npx vitest run test/bard-slow.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, AGENT_INDEX, ROOT } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const tables = sliceBlock(src, 'const SLOW_SPELLS = new Set([', "return SLOW_MAGNITUDES.get(String(name).toLowerCase().replace(/`/g, \"'\").trim()) || 0;\n}");
const shortName = sliceBlock(src, 'const SLOW_CALLOUT_NAMES = new Map([', 'trim()) || null;\n}') + '\n'
  + sliceBlock(src, 'function _slowShortName(name) {', '\n}');
const announce = sliceBlock(src, 'function _announceSlowLand(best, mob) {', '\n}');
const pushed = [];
const slow = evalBlock(
  'const _pushOverlay = (o) => pushed.push(o);\n' + tables + '\n' + shortName + '\n' + announce,
  ['_isSlowSpell', '_slowClass', '_slowMagnitude', '_slowShortName', '_announceSlowLand'],
);
// evalBlock runs in its own scope: hand the overlay pushes back through a global the block can see.
function landed(best, mob) {
  globalThis.pushed = pushed;
  pushed.length = 0;
  slow._announceSlowLand(best, mob);
  return pushed[0];
}

describe('Requiem of Time is a bard slow', () => {
  it('is a 55% slow labelled BRD, either spelling', () => {
    for (const n of ['Requiem of Time', 'requiem of time']) {
      expect(slow._isSlowSpell(n)).toBe(true);
      expect(slow._slowMagnitude(n)).toBe(55);
      expect(slow._slowClass(n)).toBe('BRD');
    }
  });
  it('the land callout reads "Bard Slow (55%)" and says "Bard Slow"', () => {
    const o = landed({ name: 'Requiem of Time', magnitude: 55, caster: null }, 'a vann militis #412');
    expect(o.text).toBe('🐌 Slowed a vann militis #412 — Bard Slow (55%)');
    expect(o.tts).toBe('Slowed. Bard Slow');
    expect(slow._slowShortName('Requiem of Time')).toBe('Bard Slow');   // the drop / fading callouts too
  });
  it('other slows keep their own names', () => {
    const o = landed({ name: "Turgur's Insects", magnitude: 75, caster: null }, 'a vann militis');
    expect(o.text).toBe("🐌 Slowed a vann militis — Turgur's Insects 75%");
    expect(o.tts).toBe("Slowed. Turgur's");
  });
});

describe('the other lists carry it too', () => {
  it('Mimic Extended Target: in the set and the magnitude map', () => {
    const html = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'extarget.html'), 'utf8');
    const set = html.slice(html.indexOf('var SLOW_DEBUFFS'), html.indexOf('var SLOW_MAG'));
    const mag = html.slice(html.indexOf('var SLOW_MAG'), html.indexOf('var MEZ_DEBUFFS'));
    expect(set).toContain("'requiem of time'");
    expect(mag).toMatch(/'requiem of time':\s*55/);
  });
  it('the raid review counts it as a slow', () => {
    const ts = fs.readFileSync(path.join(ROOT, 'web', 'lib', 'raidReview.ts'), 'utf8');
    const set = ts.slice(ts.indexOf('export const SLOW_SPELLS'), ts.indexOf('export function isSlowSpell'));
    expect(set).toContain("'requiem of time'");
  });
});
