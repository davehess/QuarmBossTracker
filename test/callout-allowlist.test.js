// #136 raid callout allow-list — which guild-pushed / relayed fires may SPEAK.
//
// The allow-list mutes speech for guild triggers whose name, tags and action
// text match none of the curated categories. The text still flashes; only the
// voice is cut. Enrage was never one of those categories, so every guild
// enrage trigger went silent the day the allow-list shipped — nobody decided
// that, it simply was not on the list (a member, 2026-09-23: "Enrage didn't
// call out", on `Guard Sklinus has become ENRAGED.`).
//
// These tests run the REAL `_calloutAllowedToSpeak` sliced from the agent,
// against trigger shapes copied from the live guild_triggers rows — so a
// comment cannot satisfy them and a category cannot quietly drop out.
//
// Run: npx vitest run test/callout-allowlist.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, AGENT_INDEX } from './_source-slice.js';

const block = sliceBlock(
  readSource(AGENT_INDEX),
  'const _CALLOUT_ALLOW_CATEGORIES = [',
  '\n  return false;\n}',
);
const { _calloutAllowedToSpeak } = evalBlock(block, ['_calloutAllowedToSpeak']);

// Shapes as stored in guild_triggers (name + actions), 2026-09-23.
const ENRAGE_BEGIN = {
  name: 'Enrage (Begin)',
  actions: [
    { type: 'text_overlay', text: 'ENRAGE - {s}', color: 'red', duration_ms: 5000 },
    { type: 'tts', text: 'Enrage on.' },
  ],
};
const ENRAGE_END = {
  name: 'Enrage (End)',
  actions: [
    { type: 'text_overlay', text: 'ENRAGE END', color: 'red', duration_ms: 5000 },
    { type: 'tts', text: 'Enrage off.' },
  ],
};

describe('#136 allow-list: enrage speaks', () => {
  it('the live "Enrage (Begin)" trigger is allowed to speak', () => {
    expect(_calloutAllowedToSpeak(ENRAGE_BEGIN)).toBe(true);
  });
  it('the live "Enrage (End)" trigger is allowed to speak', () => {
    expect(_calloutAllowedToSpeak(ENRAGE_END)).toBe(true);
  });
  it('an enrage trigger named only in its speech still counts', () => {
    expect(_calloutAllowedToSpeak({ name: 'Boss mechanic', actions: [{ type: 'tts', text: 'Mob enraged' }] })).toBe(true);
  });
});

describe('#136 allow-list: still mutes the noise it exists to mute', () => {
  // If the enrage category were written loosely (/rage/) these would start
  // speaking again. They must stay muted.
  it('a personal-noise style trigger stays muted', () => {
    expect(_calloutAllowedToSpeak({ name: 'Too Far', actions: [{ type: 'text_overlay', text: 'TOO FAR' }] })).toBe(false);
  });
  it('a word that merely CONTAINS "rage" stays muted', () => {
    expect(_calloutAllowedToSpeak({ name: 'Storage full', actions: [{ type: 'tts', text: 'Average heal landed' }] })).toBe(false);
  });
  it('an unnamed, text-less fire stays muted', () => {
    expect(_calloutAllowedToSpeak({ actions: [] })).toBe(false);
  });
});

describe('suggested trigger "Mob is enraged" matches what EQ actually prints', () => {
  // It read `begins to enrage` — a string that appears in no log. Anyone who
  // enabled the suggestion got a callout that could never fire.
  const { SUGGESTED_TRIGGERS } = evalBlock(
    sliceBlock(readSource(AGENT_INDEX), 'const SUGGESTED_TRIGGERS = [', '\n];'),
    ['SUGGESTED_TRIGGERS'],
  );
  const s = SUGGESTED_TRIGGERS.find(x => x.id === 'mob_enraged');
  it('matches the real enrage line', () => {
    expect(new RegExp(s.pattern, 'i').test('[Wed Sep 23 10:41:22 2026] Guard Sklinus has become ENRAGED.')).toBe(true);
  });
  it('does not fire on the enrage END line', () => {
    expect(new RegExp(s.pattern, 'i').test('[Wed Sep 23 10:41:30 2026] Guard Sklinus is no longer enraged.')).toBe(false);
  });
});

describe('#136 allow-list: the existing categories are intact', () => {
  it.each([
    ['slow',     { name: 'Slow landed' }],
    ['death',    { name: 'Tank died' }],
    ['rampage',  { name: 'New Rampage' }],
    ['charm',    { name: 'Charm break' }],
    ['disc',     { name: 'Defensive discipline' }],
  ])('%s', (_label, t) => {
    expect(_calloutAllowedToSpeak(t)).toBe(true);
  });
});
