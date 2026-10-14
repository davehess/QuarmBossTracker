// test/pronounce.test.js — utils/pronounce.js: respelling suggestions, coaching tips, and the
// whole-word substitution Mimic uses before text goes to text-to-speech.
//
// The guild lead, 2026-10-14: "get player pronunciation right. let each player suggest how their name
// should sound phonetically with some coaching and alternate pronunciation available to choose from."
//
// This file is the bot's port of web/lib/pronounce.ts; the suggestion fixtures are the SAME ones
// test/web-pronounce.test.js pins, so Mimic and the website suggest the same spellings. Change one, change both.
// Names are invented (none is a member). Run: npx vitest run test/pronounce.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { suggestPronunciations, coachingTips, validSay, speakText, applyPronunciations } = require('../utils/pronounce.js');

describe('suggestPronunciations (shared fixtures with the website)', () => {
  it('splits a plain name on vowel groups and offers the other stress positions', () => {
    expect(suggestPronunciations('Aldenmar')).toEqual(['AL-den-mar', 'al-DEN-mar', 'al-den-MAR']);
  });

  it('keeps digraphs together and splits double consonants', () => {
    expect(suggestPronunciations('Brackwyn')[0]).toBe('BRACK-win');
    expect(suggestPronunciations('Zarrin')[0]).toBe('ZAR-rin');
    expect(suggestPronunciations('Nyssara')[0]).toBe('NIS-sa-ra');
  });

  it('keeps a vowel run as one nucleus', () => {
    expect(suggestPronunciations('Gideon')[0]).toBe('JI-deon');
  });

  it('treats a final E as silent, and offers speaking it as an alternate', () => {
    const s = suggestPronunciations('Corvale');
    expect(s[0]).toBe('COR-vale');
    expect(s).toContain('COR-va-lay');
  });

  it('offers both readings of a soft C and a vowel Y', () => {
    const s = suggestPronunciations('Cygnus');
    expect(s[0]).toBe('SIG-nus');
    expect(s).toContain('KIG-nus');
    expect(s.some(x => x.toLowerCase().includes('eye'))).toBe(true);
  });

  it('offers both readings of a soft G, ae and ie', () => {
    expect(suggestPronunciations('Gideon')).toEqual(expect.arrayContaining(['JI-deon', 'GHI-deon']));
    expect(suggestPronunciations('Aelric')[0]).toMatch(/^AY/i);
    expect(suggestPronunciations('Aelric').some(x => /^ee/i.test(x))).toBe(true);
    expect(suggestPronunciations('Ielara').some(x => /eye/i.test(x))).toBe(true);
  });

  it('puts the base guess first, then stress 2, then last, then the flips', () => {
    expect(suggestPronunciations('Corvale').slice(0, 3)).toEqual(['COR-vale', 'cor-VALE', 'COR-va-lay']);
    expect(suggestPronunciations('Cygnus')).toEqual(['SIG-nus', 'sig-NUS', 'KIG-nus', 'SEYEG-nus']);
  });

  it('gives at most five distinct, valid respellings', () => {
    for (const n of ['Aldenmar', 'Brackwyn', 'Corvale', 'Nyssara', 'Zarrin', 'Cygnus', 'Gideonaelcyrie']) {
      const s = suggestPronunciations(n);
      expect(s.length).toBeGreaterThan(0);
      expect(s.length).toBeLessThanOrEqual(5);
      expect(new Set(s).size).toBe(s.length);
      for (const x of s) expect(validSay(x)).toBe(true);
    }
  });

  it('puts the whole word in capitals when there is one syllable, and survives junk', () => {
    expect(suggestPronunciations('Brak')).toEqual(['BRAK']);
    expect(suggestPronunciations('')).toEqual([]);
    expect(suggestPronunciations(null)).toEqual([]);
    // apostrophes and backticks are dropped, exactly as on the website
    expect(suggestPronunciations("Alden-m'ar")).toEqual(suggestPronunciations('Aldenmar'));
    expect(suggestPronunciations('Alden`mar')).toEqual(suggestPronunciations('Aldenmar'));
  });
});

describe('coachingTips', () => {
  it('always opens with how to read a respelling', () => {
    for (const n of ['Aldenmar', 'Cygnus', '']) expect(coachingTips(n)[0]).toMatch(/Hyphens split syllables; CAPITALS mark the stressed/);
  });

  it('adds only the tips that fit the name', () => {
    expect(coachingTips('Cygnus').join(' ')).toMatch(/soft C/);
    expect(coachingTips('Aldenmar').join(' ')).not.toMatch(/soft C/);
    expect(coachingTips('Gideon').join(' ')).toMatch(/soft G/);
    expect(coachingTips('Corvale').join(' ')).toMatch(/final E/);
    expect(coachingTips('Zarrin').join(' ')).toMatch(/Doubled letters/);
    expect(coachingTips('Brackwyn').join(' ')).toMatch(/long I/);
  });

  it('is short', () => {
    for (const n of ['Aldenmar', 'Brackwyn', 'Corvale', 'Nyssara', 'Zarrin', 'Cygnus']) expect(coachingTips(n).length).toBeLessThanOrEqual(5);
  });
});

describe('validSay', () => {
  it.each(['AL-den-mar', "o'brien", 'two words', 'x'])('accepts %s', (s) => expect(validSay(s)).toBe(true));
  it.each(['', '-', '  ', 'al1den', 'al_den', 'a'.repeat(61), null, undefined, 42, '<b>x</b>'])('rejects %s', (s) => expect(validSay(s)).toBe(false));
  it('accepts exactly 60 characters', () => expect(validSay('a'.repeat(60))).toBe(true));
});

describe('speakText', () => {
  it('lower-cases and closes the hyphens up, so the voice cannot spell capitals out', () => {
    expect(speakText('AL-den-mar')).toBe('aldenmar');
    expect(speakText('Two  WORDS-x')).toBe('two wordsx');
  });
});

describe('applyPronunciations', () => {
  const map = { aldenmar: 'AL-den-mar', al: 'AHL', 'ka`thal': 'KAH-thal' };

  it('inserts the spoken form (lower case, hyphens closed), not the notation', () => {
    expect(applyPronunciations('Slow on ALDENMAR!  now, aldenmar.', map))
      .toBe('Slow on aldenmar!  now, aldenmar.');
    expect(applyPronunciations('Corvale hits', { corvale: 'COR-va-lay' })).toBe('corvalay hits');
  });

  it('never touches a name inside another word ("Al" inside "Aldenmar")', () => {
    expect(applyPronunciations('Aldenmar', { al: 'AHL' })).toBe('Aldenmar');
    expect(applyPronunciations('Alone Total Al', { al: 'AHL' })).toBe('Alone Total ahl');
  });

  it('takes the longest name first when one name starts another', () => {
    expect(applyPronunciations('Al and Aldenmar', map)).toBe('ahl and aldenmar');
  });

  it('allows a possessive but not an apostrophe that joins more letters', () => {
    expect(applyPronunciations("Aldenmar's heal", map)).toBe("aldenmar's heal");
    expect(applyPronunciations("Al'thar", map)).toBe("Al'thar");
  });

  it('matches a name with a backtick or apostrophe whichever the text uses', () => {
    expect(applyPronunciations("Ka`thal and Ka'thal and Ka’thal", map)).toBe('kahthal and kahthal and kahthal');
  });

  it('accepts a Map and ignores empty or non-string entries', () => {
    const m = new Map([['corvale', 'KOR-vayl'], ['', 'x'], ['zarrin', 42]]);
    expect(applyPronunciations('Corvale hits Zarrin', m)).toBe('korvayl hits Zarrin');
  });

  it('is not tripped by regex characters in a name or $ in a respelling', () => {
    expect(applyPronunciations('a.b hit', { 'a.b': '$&-x' })).toBe('$&x hit');
    expect(applyPronunciations('axb', { 'a.b': 'no' })).toBe('axb');
  });

  it('returns the input unchanged for empty text or an empty map', () => {
    expect(applyPronunciations('', map)).toBe('');
    expect(applyPronunciations('Aldenmar', {})).toBe('Aldenmar');
    expect(applyPronunciations('Aldenmar', null)).toBe('Aldenmar');
  });
});
