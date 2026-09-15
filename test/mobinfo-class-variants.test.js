// test/mobinfo-class-variants.test.js — one name, two bodies, two classes.
//
// Hitya, 2026-09-15, Plane of Hate: "Female forsaken revenant are enchanters,
// but show up as magicians in plane of hate. we have the model ID and sex, we
// should be able to differentiate." The catalog has a_forsaken_revenant twice
// — 76004 male Magician, 76005 female Enchanter — identical in level, HP,
// model and specials. The row-picker returned ONE row (76004 wins the tie on
// id), and mob-info reported its class as fact.
//
// Now the picker also hands back its candidates, mob-info lists every
// (class, sex) pair and flags the disagreement, and a `gender` hint on the
// request picks the exact body. The Zeal pipe does not carry the target's sex
// yet (its target object is {id, name}); until it does the overlay shows both.
//
// Run: npx vitest run test/mobinfo-class-variants.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, stripJs, BOT_INDEX } from './_source-slice.js';
const require = createRequire(import.meta.url);
const { pickAndMergeMobRows } = require('../utils/mobSpecials.js');

// The two live rows, verbatim from eqemu_npc_types (2026-09-15).
const MALE   = { id: 76004, name: 'a_forsaken_revenant', level: 49, race: 98, gender: 0, class: 13, hp: 10120, special_abilities: '1,1^10,1^23,1^42,1', npcspecialattks: '' };
const FEMALE = { id: 76005, name: 'a_forsaken_revenant', level: 49, race: 98, gender: 1, class: 14, hp: 10120, special_abilities: '1,1^10,1^23,1^42,1', npcspecialattks: '' };

describe('pickAndMergeMobRows', () => {
  it('still picks one primary, and now returns every candidate behind it', () => {
    const out = pickAndMergeMobRows([FEMALE, MALE], { zoneId: 76 });   // 76 = Plane of Hate (id = zoneid*1000 + n)
    expect(out.row.id).toBe(76004);                                   // the old winner is unchanged
    expect(out.candidates.map(r => r.id)).toEqual([76004, 76005]);
    expect(out.variants).toBe(2);
    expect(out.scope).toBe('zone-real');
  });

  it('a single-body name has one candidate', () => {
    const out = pickAndMergeMobRows([MALE], { zoneId: 76 });
    expect(out.candidates).toHaveLength(1);
  });
});

describe('mob-info reports the pair, not the winner as fact', () => {
  const bot = stripJs(readSource(BOT_INDEX));
  const handler = bot.slice(bot.indexOf('async function _handleAgentMobInfo('), bot.indexOf('\nasync function ', bot.indexOf('async function _handleAgentMobInfo(') + 10));

  it('fetches race and gender with the row', () => {
    expect(handler).toMatch(/see_improved_hide,race,gender&limit=200/);
  });
  it('builds class_variants over the candidates and flags a class disagreement', () => {
    expect(handler).toMatch(/const cands = Array\.isArray\(picked\.candidates\)/);
    expect(handler).toMatch(/const classAmbiguous = new Set\(classVariants\.map\(v => v\.class\)\)\.size > 1;/);
    expect(handler).toMatch(/class_variants:\s+classVariants,/);
    expect(handler).toMatch(/class_ambiguous: classAmbiguous,/);
    expect(handler).toMatch(/gender:\s+_GENDER_NAMES\[r\.gender\] \?\? null,/);
  });
  it('a gender hint picks the exact body and is part of the cache key', () => {
    expect(handler).toMatch(/const reqGender = _parseGender\(new URL\(req\.url, 'http:\/\/x'\)\.searchParams\.get\('gender'\)\);/);
    expect(handler).toMatch(/if \(classAmbiguous && reqGender != null\) \{/);
    expect(handler).toMatch(/\+ \(reqGender != null \? '\|g' \+ reqGender : ''\);/);
  });
});

describe('_parseGender', () => {
  const src = readSource(BOT_INDEX);
  const block = src.slice(src.indexOf('function _parseGender(v) {'), src.indexOf('\n}\n', src.indexOf('function _parseGender(v) {')) + 3);
  const _parseGender = new Function(block + '\nreturn _parseGender;')();
  it('accepts numbers and words, refuses everything else', () => {
    expect(_parseGender('1')).toBe(1);
    expect(_parseGender('female')).toBe(1);
    expect(_parseGender('M')).toBe(0);
    expect(_parseGender('neuter')).toBe(2);
    expect(_parseGender('')).toBeNull();
    expect(_parseGender(null)).toBeNull();
    expect(_parseGender('3')).toBeNull();
  });
});
