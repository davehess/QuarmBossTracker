// test/feedback-refs.test.js — FB-<n> handles for bug and idea reports, moved on by commits.
//
// The guild lead, 2026-09-29: "We need to start having referenceable IDs for each bug or enhancement
// request so the bot can update these when they get implemented". Runs utils/feedbackRefs.js and the
// bot's real card-status line rewrite.
//
// Run: npx vitest run test/feedback-refs.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readSource, BOT_INDEX, sliceBlock } from './_source-slice.js';

const require = createRequire(import.meta.url);
const fr = require('../utils/feedbackRefs.js');

describe('the handle', () => {
  it('FB-<n>, or nothing for a row without one', () => {
    expect(fr.tag(29)).toBe('FB-29');
    expect(fr.tag(null)).toBe('');
    expect(fr.tag(0)).toBe('');
  });
});

describe('which reports a commit closes', () => {
  it('a line that says fixes / implements / closes / resolves, every FB on it, once', () => {
    expect(fr.refsIn('agent v3.7.40 — bard recharm\n\nFixes FB-29, FB-30 and FB-29')).toEqual([29, 30]);
    expect(fr.refsIn('Implements: FB-31')).toEqual([31]);
    expect(fr.refsIn('resolved fb-12')).toEqual([12]);
  });

  it('a mention alone moves nothing — a docs note quoting a report must not mark it done', () => {
    expect(fr.refsIn('docs — FB-29 answered by §75; see FB-30')).toEqual([]);
    expect(fr.refsIn('Fixes the drag stutter\nSee FB-40 for the report')).toEqual([]);   // Different lines.
  });
});

describe('a report only moves forward', () => {
  it('beta → on beta, main → implemented', () => {
    expect(fr.advance('new', 'beta')).toBe('on_beta');
    expect(fr.advance('acked', 'main')).toBe('addressed');
    expect(fr.advance('on_beta', 'main')).toBe('addressed');
  });

  it('the main → beta sync can never knock an implemented report back', () => {
    expect(fr.advance('addressed', 'beta')).toBe(null);
    expect(fr.advance('on_beta', 'beta')).toBe(null);
    expect(fr.advance('addressed', 'main')).toBe(null);
  });

  it('a report closed as won\'t fix or duplicate stays closed', () => {
    expect(fr.advance('wont_fix', 'main')).toBe(null);
    expect(fr.advance('duplicate', 'beta')).toBe(null);
  });

  it('another branch does nothing', () => {
    expect(fr.advance('new', 'claude/something')).toBe(null);
  });
});

describe('what the card and the submitter see', () => {
  it('status lines carry the commit', () => {
    expect(fr.statusLine('on_beta', '63a0817cdeadbeef')).toBe('🧪 On beta (63a0817)');
    expect(fr.statusLine('addressed', '45be8088')).toBe('✅ Implemented (45be808)');
  });

  it('the DM names the report', () => {
    expect(fr.dmText(29, 'bug', 'on_beta')).toMatch(/bug report FB-29 is fixed on the beta/);
    expect(fr.dmText(31, 'idea', 'addressed')).toMatch(/idea FB-31 is done/);
  });

  it('a Mimic card\'s first line swaps its status, the new 🧪 one included', () => {
    const bot = readSource(BOT_INDEX);
    // eslint-disable-next-line no-new-func
    const _feedbackStatusContent = new Function(sliceBlock(bot, 'function _feedbackStatusContent(content, status) {', '\n}') + '\nreturn _feedbackStatusContent;')();
    const card = '🐞 Bug FB-29 from **Nyssara** via mimic 2.7.5-beta.1 · 📬 Acknowledged by an officer\n>>> Charm pet tracker not working?';
    const beta = _feedbackStatusContent(card, fr.statusLine('on_beta', '63a0817c'));
    expect(beta.split('\n')[0]).toBe('🐞 Bug FB-29 from **Nyssara** via mimic 2.7.5-beta.1 · 🧪 On beta (63a0817)');
    const live = _feedbackStatusContent(beta, fr.statusLine('addressed', '45be8088'));
    expect(live.split('\n')[0]).toBe('🐞 Bug FB-29 from **Nyssara** via mimic 2.7.5-beta.1 · ✅ Implemented (45be808)');
    expect(live.split('\n')[1]).toBe('>>> Charm pet tracker not working?');
  });
});
