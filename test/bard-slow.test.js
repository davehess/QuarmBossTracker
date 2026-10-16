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

describe('the re-slow warning: a minute ahead, never for a bard slow (2026-10-13)', () => {
  // The guild lead: "don't interrupt the fight unless there's a critical thing, like less than 1 minute left on a
  // non bard slow". The real _tickSlowCallouts runs here against a stubbed tracker.
  const tick = sliceBlock(src, 'const SLOW_FADING_WARN_SECS = 60;', '\n}');
  function run(best) {
    const out = [];
    // evalBlock's closure can't see `out` or `best` from here: pass them through globals the block reads.
    globalThis.out = out; globalThis.best = best;
    const t = evalBlock(
      'const _slowCalloutState = new Map([["grummus", { name: best.name, display: "Grummus" }]]);\n'
      + 'const _bestSlowForTarget = () => best;\nconst _watchedTargetId = () => null;\n'
      + 'const _isNameCurrentlyTargeted = () => true;\nconst _rampageOnMainTarget = () => true;\n'
      + 'const _slowCalloutMob = (d) => d;\nconst _slowShortName = (n) => n;\nconst _announceSlowDrop = () => {};\n'
      + 'const _pushOverlay = (o) => out.push(o);\n' + tick,
      ['_tickSlowCallouts'],
    );
    t._tickSlowCallouts();
    return out;
  }
  const at = Date.now() - 100_000;
  it('warns at 55 s left on a shaman slow', () => {
    expect(run({ name: "Turgur's Insects", cls: 'SHM', remaining_secs: 55, landedAtMs: at })).toHaveLength(1);
  });
  it('stays quiet at 90 s left', () => {
    expect(run({ name: "Turgur's Insects", cls: 'SHM', remaining_secs: 90, landedAtMs: at })).toHaveLength(0);
  });
  it('never warns for a bard slow', () => {
    expect(run({ name: 'Requiem of Time', cls: 'BRD', remaining_secs: 20, landedAtMs: at })).toHaveLength(0);
  });
});
