// Target Info: two NPCs whose names differ only in capitalisation are two
// different mobs, and the capitalisation says which.
//
// The guild lead, 2026-09-23, on Target Info reading "a Shissar acolyte
// (Warrior ♀ / Wizard ♀)": "this a Shissar acolyte is always a Warrior, because
// the Wizard ones are a Capital letter on the Acolyte (162488 vs 162153)".
// The catalog agrees — `A_Shissar_Acolyte` 162153 is a Wizard, 9,500 HP;
// `a_Shissar_acolyte` 162488 is a Warrior, 12,500 HP — and it is not a one-off:
// 76 names differ only in case after the first letter, 19 of them in class.
// The mob-info lookup matched case-insensitively and merged the two.
//
// The FIRST letter is never evidence: the log capitalises a name that starts a
// sentence, while Zeal and the catalog do not.
//
// Runs the real functions sliced from the bot, with the real pickAndMergeMobRows.
//
// Run: npx vitest run test/mobinfo-case-variants.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, sliceBlock, evalBlock, stripJs, BOT_INDEX } from './_source-slice.js';
const require = createRequire(import.meta.url);
const { pickAndMergeMobRows } = require('../utils/mobSpecials.js');

const src = readSource(BOT_INDEX);
const { _mobCaseKey, _mobRowsForCase } = evalBlock(
  sliceBlock(src, 'function _mobCaseKey(n) {', '\n}') + '\n'
  + sliceBlock(src, 'function _mobRowsForCase(rows, caseKey) {', '\n}'),
  ['_mobCaseKey', '_mobRowsForCase'],
);

// The two catalog rows, as eqemu_npc_types holds them (Ssraeshza Temple, zone 162).
const WIZARD  = { id: 162153, name: 'A_Shissar_Acolyte', class: 12, level: 50, maxlevel: 54, hp: 9500,  gender: 1, special_abilities: '', npcspecialattks: '' };
const WARRIOR = { id: 162488, name: 'a_Shissar_acolyte', class: 1,  level: 51, maxlevel: 55, hp: 12500, gender: 1, special_abilities: '', npcspecialattks: '' };
const BOTH = [WIZARD, WARRIOR];
const pick = (name) => pickAndMergeMobRows(_mobRowsForCase(BOTH, _mobCaseKey(name)), { zoneId: 162 });

describe('the acolytes resolve to their own body', () => {
  it('Zeal\'s "a Shissar acolyte" is the Warrior, alone', () => {
    const out = pick('a Shissar acolyte');
    expect(out.row.id).toBe(162488);
    expect(out.candidates.map(r => r.id)).toEqual([162488]);   // no "Warrior / Wizard"
  });
  it('"A Shissar Acolyte" is the Wizard, alone', () => {
    const out = pick('A Shissar Acolyte');
    expect(out.row.id).toBe(162153);
    expect(out.candidates.map(r => r.id)).toEqual([162153]);
  });
  it('the log\'s sentence-start capital does not flip it', () => {
    // "A Shissar acolyte hits YOU" — the log capitalised the first letter only.
    expect(pick('A Shissar acolyte').row.id).toBe(162488);
    expect(pick('a Shissar Acolyte').row.id).toBe(162153);
  });
  it('the catalog spelling with underscores and a leading # matches too', () => {
    expect(_mobCaseKey('#a_Shissar_acolyte')).toBe(_mobCaseKey('a Shissar acolyte'));
    expect(_mobCaseKey("a Shissar acolyte's corpse")).toBe(_mobCaseKey('a Shissar acolyte'));
  });
});

describe('nothing changes when case cannot decide', () => {
  it('a request that arrives lowercased keeps every body, as before', () => {
    const rows = _mobRowsForCase(BOTH, _mobCaseKey('a shissar acolyte'));
    expect(rows).toBe(BOTH);
  });
  it('a name with a single spelling is untouched', () => {
    const rows = [WARRIOR];
    expect(_mobRowsForCase(rows, _mobCaseKey('a Shissar acolyte'))).toEqual([WARRIOR]);
  });
  it('same-case bodies (real + placeholder, #171) all survive the filter', () => {
    const REAL = { id: 1, name: 'The_Itraer_Vius', level: 55 };
    const PH   = { id: 2, name: 'The_Itraer_Vius', level: 1 };
    expect(_mobRowsForCase([REAL, PH], _mobCaseKey('The Itraer Vius'))).toHaveLength(2);
  });
});

describe('the handler uses it', () => {
  const clean = stripJs(src);
  it('filters by case before picking, and caches by the case-kept name', () => {
    expect(clean).toContain('mobSpecials.pickAndMergeMobRows(_mobRowsForCase(rows, caseKey), { zoneId: reqZoneId })');
    expect(clean).toMatch(/const caseKey = _mobCaseKey\(name\);\s*const cacheKey = caseKey \+ '\|'/);
  });
});
