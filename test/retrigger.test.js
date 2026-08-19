// test/retrigger.test.js — /retrigger's pure input parsing + the shared nudge
// card it re-posts (Hitya 2026-08-18). The Discord plumbing (fetch/edit/send)
// is thin; what must never regress is reading the window and target inputs
// and the card coming out of the SAME builder the ThreadCreate listener uses.
//
// Run: npx vitest run test/retrigger.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseWindowMs, parseTargetRef } = require('../commands/retrigger.js');
const { buildNudgeCard } = require('../utils/suggestNudge.js');
const bosses = require('../data/bosses.json');

describe('parseWindowMs', () => {
  it('reads the forms Hitya named: 10m, 5h (and days)', () => {
    expect(parseWindowMs('10m')).toBe(10 * 60_000);
    expect(parseWindowMs('5h')).toBe(5 * 3_600_000);
    expect(parseWindowMs('2d')).toBe(2 * 86_400_000);
    expect(parseWindowMs(' 30M ')).toBe(30 * 60_000);   // whitespace + case
  });
  it('refuses garbage instead of guessing', () => {
    for (const bad of ['', 'soon', '5 hours', '0m', '10', 'm10', null]) {
      expect(parseWindowMs(bad)).toBe(null);
    }
  });
});

describe('parseTargetRef', () => {
  it('reads message links (channel + message) and channel links', () => {
    expect(parseTargetRef('https://discord.com/channels/1168893924329402420/1242116105326166057/1406400000000000000'))
      .toEqual({ channelId: '1242116105326166057', messageId: '1406400000000000000' });
    expect(parseTargetRef('https://discord.com/channels/1168893924329402420/1242116105326166057'))
      .toEqual({ channelId: '1242116105326166057', messageId: null });
  });
  it('reads a bare snowflake as a channel id, refuses everything else', () => {
    expect(parseTargetRef('1242116105326166057')).toEqual({ channelId: '1242116105326166057', messageId: null });
    expect(parseTargetRef('trakanon')).toBe(null);
    expect(parseTargetRef('123')).toBe(null);   // too short to be a snowflake
    expect(parseTargetRef('')).toBe(null);
  });
});

describe('buildNudgeCard — the card /retrigger re-posts', () => {
  it("detects the boss from thread text and arms its button (Fungalfist's case)", () => {
    const { embeds, components, matchedBosses } =
      buildNudgeCard('trakanon kill - for vp key (final piece) willing to kill trakanon any time , any night', bosses);
    expect(matchedBosses.some(b => /trakanon/i.test(b.name))).toBe(true);
    const ids = components.flatMap(r => r.toJSON().components).map(c => c.custom_id);
    expect(ids.some(id => id.startsWith('sugnudge_boss:'))).toBe(true);
    expect(embeds[0].toJSON().title).toBe('📣 Want officers to host this?');
  });

  it('no detection → picker-only card, still tappable', () => {
    const { components } = buildNudgeCard('help me do a thing sometime', bosses);
    const ids = components.flatMap(r => r.toJSON().components).map(c => c.custom_id);
    expect(ids).toEqual(['sugnudge_other']);
  });
});
