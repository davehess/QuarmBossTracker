// Mimic's open-external allowlist lets the signed-out feedback button reach eqmimic.quest's form, and
// only that page (the guild lead, 2026-10-08: anonymous feedback goes to eqmimic.quest). Runs the real regex.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const src = fs.readFileSync(path.join(__dirname, '..', 'apps', 'mimic', 'main.js'), 'utf8');
const line = src.split('\n').find(l => /const ALLOW = \/\^https/.test(l));
// eslint-disable-next-line no-new-func
const ALLOW = new Function(line.trim() + '\nreturn ALLOW;')();

describe('open-external allowlist', () => {
  it('opens the eqmimic.quest feedback form, with or without a # payload', () => {
    expect(ALLOW.test('https://eqmimic.quest/feedback')).toBe(true);
    expect(ALLOW.test('https://eqmimic.quest/feedback#cat=bug&text=hello')).toBe(true);
  });
  it('refuses any other eqmimic.quest page, a query string, and look-alike hosts', () => {
    expect(ALLOW.test('https://eqmimic.quest/')).toBe(false);
    expect(ALLOW.test('https://eqmimic.quest/admin')).toBe(false);
    expect(ALLOW.test('https://eqmimic.quest/feedback?text=hello')).toBe(false);
    expect(ALLOW.test('https://eqmimic.quest/feedbackx')).toBe(false);
    expect(ALLOW.test('https://eqmimic.quest.evil.example/feedback')).toBe(false);
    expect(ALLOW.test('http://eqmimic.quest/feedback')).toBe(false);
  });
  it('still opens the existing sites', () => {
    expect(ALLOW.test('https://wolfpack.quest/pop/guide')).toBe(true);
    expect(ALLOW.test('https://www.pqdi.cc/npc/1')).toBe(true);
  });
});
