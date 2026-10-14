// test/web-pronounce.test.js — the website's name-pronunciation helpers (web/lib/pronounce.ts).
//
// The guild lead, 2026-10-14: "get player pronunciation right. let each player suggest how their name should
// sound phonetically with some coaching and alternate pronunciation available to choose from." The bot keeps a
// port of the same rules in utils/pronounce.js; the fixtures below are the shared ones, so change one, change both.
// All names here are invented.
//
// Run: npx vitest run test/web-pronounce.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { suggestPronunciations, coachingTips, validSay, speakText } from '../web/lib/pronounce.ts';

describe('suggestPronunciations', () => {
  it('splits a plain name on vowel groups and offers the other stress positions', () => {
    const s = suggestPronunciations('Aldenmar');
    expect(s[0]).toBe('AL-den-mar');
    expect(s).toContain('al-DEN-mar');
    expect(s).toContain('al-den-MAR');
  });

  it('keeps digraphs together and splits double consonants', () => {
    expect(suggestPronunciations('Brackwyn')[0]).toBe('BRACK-win');
    expect(suggestPronunciations('Zarrin')[0]).toBe('ZAR-rin');
    expect(suggestPronunciations('Nyssara')[0]).toBe('NIS-sa-ra');
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
    expect(suggestPronunciations("Alden-m'ar")).toEqual(suggestPronunciations('Aldenmar'));
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

describe('the web files that use it', () => {
  const src = (p) => stripJs(fs.readFileSync(path.join(ROOT, p), 'utf8'));

  it('the save action re-checks the signed-in owner and validates on the server, then writes with the service client', () => {
    const a = src('web/app/character/[name]/actions.ts');
    expect(a).toMatch(/auth\.getUser\(\)/);
    expect(a).toMatch(/validSay\(/);
    expect(a).toMatch(/supabaseAdmin\(\)/);
    expect(a).toMatch(/GUILD_TAG/);
    expect(a).not.toMatch(/'wolfpack'/);
    expect(a).toMatch(/revalidatePath\(/);
  });

  it('only the owner is handed the editor', () => {
    const page = src('web/app/character/[name]/page.tsx');
    expect(page).toMatch(/<PronounceSection[^>]*canEdit=\{/);
  });
});
