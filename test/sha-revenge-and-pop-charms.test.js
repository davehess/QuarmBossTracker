// test/sha-revenge-and-pop-charms.test.js — two table gaps the guild lead reported on 2026-10-08.
//
// 1. "Sha's Revenge isn't showing as a slow." Spell 3462 (Beastlord, SPA 11 base 35 = a 65% slow) was on none of the
//    name-keyed slow lists, so a self-cast resolved by name was never a slow. Sha's Vengeance (2679, 55%) and Sha's
//    Lethargy (2634, 30%) had the same hole. Magnitudes are 100 minus SPA 11's base, read from eqemu_spells.
// 2. "Build in the new charms for bards, enchanters, druids, necros and mages." Every SPA 22 spell with a player
//    class that CHARM_SPELLS lacked: Beckon, Command of Druzzil, Command of Tunare, Word of Terris, Call of the
//    Arch Mage, Call of the Banshee, Enslave Death.
//
// Run: npx vitest run test/sha-revenge-and-pop-charms.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, AGENT_INDEX, ROOT } from './_source-slice.js';

const src = readSource(AGENT_INDEX);

const slow = evalBlock(
  sliceBlock(src, 'const SLOW_SPELLS = new Set([', "return SLOW_MAGNITUDES.get(String(name).toLowerCase().replace(/`/g, \"'\").trim()) || 0;\n}"),
  ['_isSlowSpell', '_slowClass', '_slowMagnitude'],
);

describe("Beastlord slows are slows", () => {
  const CASES = [["Sha`s Revenge", 65], ["Sha's Revenge", 65], ["Sha's Vengeance", 55], ["Sha's Lethargy", 30], ["Sha's Advantage", 50]];
  it.each(CASES)('%s is a slow of %i%%, labelled BST', (name, pct) => {
    expect(slow._isSlowSpell(name)).toBe(true);
    expect(slow._slowMagnitude(name)).toBe(pct);
    expect(slow._slowClass(name)).toBe('BST');
  });
  it('Sha`s Ferocity (a haste, SPA 11 above 100) is not a slow', () => {
    expect(slow._isSlowSpell("Sha's Ferocity")).toBe(false);
  });
});

describe('Mimic Extended Target keeps the same list', () => {
  const html = fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'extarget.html'), 'utf8');
  it("names Sha's Revenge in the set and in the magnitude map", () => {
    const set = html.slice(html.indexOf('var SLOW_DEBUFFS'), html.indexOf('var SLOW_MAG'));
    const mag = html.slice(html.indexOf('var SLOW_MAG'), html.indexOf('var MEZ_DEBUFFS'));
    expect(set).toContain(`"sha's revenge"`);
    expect(mag).toMatch(/"sha's revenge":\s*65/);
  });
});

describe('the Planes of Power charms are in CHARM_SPELLS', () => {
  const charm = evalBlock(sliceBlock(src, 'const CHARM_SPELLS = new Map([', '\n]);'), ['CHARM_SPELLS']).CHARM_SPELLS;
  const NEW = [
    ['beckon', 'enchanter'], ['command of druzzil', 'enchanter'], ['command of tunare', 'enchanter'],
    ['word of terris', 'enchanter'], ['call of the arch mage', 'enchanter'], ['call of the banshee', 'bard'],
    ['enslave death', 'enchanter'],
  ];
  it.each(NEW)('%s is a %s charm with a duration', (name, cls) => {
    const e = charm.get(name);
    expect(e).toBeTruthy();
    expect(e.cls).toBe(cls);
    expect(e.dur).toBeGreaterThan(0);
  });
  it('keeps the existing entries (nothing was replaced)', () => {
    expect(charm.get("solon's bewitching bravura").dur).toBe(60);
    expect(charm.get('charm').dur).toBe(720);
    expect(charm.get("tunare's request").catalogDur).toBe(true);
  });
});
