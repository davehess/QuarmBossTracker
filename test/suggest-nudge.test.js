// test/suggest-nudge.test.js — the forum nudge's tap-through request flow
// (Hitya 2026-08-17: "fungal would have hit '1' if he could have" — the card
// must BE the flow, not describe the /suggest command).
//
// Real module import (utils/ is bootable without the Discord client); the pure
// builders are pinned here, the interaction plumbing is thin routing.
//
// Run: npx vitest run test/suggest-nudge.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  buildNudgeComponents, timeStepComponents, timeChoiceLabel,
  expansionOptions, bossOptionsForExpansion,
} = require('../utils/suggestNudge.js');
const bosses = require('../data/bosses.json');

const flat = rows => rows.flatMap(r => r.toJSON().components);

describe('buildNudgeComponents', () => {
  it('one button per detected boss + the picker fallback', () => {
    const comps = flat(buildNudgeComponents([
      { id: 'trakanon', name: 'Trakanon', emoji: '🦴' },
      { id: 'arch_lich_rhag_zadune', name: 'Arch Lich Rhag`Zadune', emoji: '💀' },
    ]));
    expect(comps.map(c => c.custom_id)).toEqual([
      'sugnudge_boss:trakanon', 'sugnudge_boss:arch_lich_rhag_zadune', 'sugnudge_other',
    ]);
    expect(comps[0].label).toBe('🦴 Trakanon');
    expect(comps[2].label).toBe('🔎 Different boss…');
  });

  it('caps at 4 boss buttons — a Discord row holds 5 and the picker keeps its seat', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ id: `b${i}`, name: `Boss ${i}` }));
    const comps = flat(buildNudgeComponents(many));
    expect(comps).toHaveLength(5);
    expect(comps[4].custom_id).toBe('sugnudge_other');
  });

  it('no detections → just the Who/Where picker', () => {
    const comps = flat(buildNudgeComponents([]));
    expect(comps).toHaveLength(1);
    expect(comps[0].label).toBe('🔎 Who / Where?');
  });
});

describe('time step', () => {
  it('"Any time, any night" is the FIRST and primary option — it is what people mean', () => {
    const comps = flat(timeStepComponents('trakanon'));
    expect(comps[0].custom_id).toBe('sugnudge_time:trakanon:any');
    expect(comps[0].style).toBe(1);   // ButtonStyle.Primary
  });

  it('labels round-trip through timeChoiceLabel; unknown keys refuse', () => {
    expect(timeChoiceLabel('any')).toBe('any time, any night');
    expect(timeChoiceLabel('nextraid')).toContain('Sun/Wed/Thu');
    expect(timeChoiceLabel('nope')).toBe(null);
  });

  it('exact-time and different-boss escapes are present', () => {
    const ids = flat(timeStepComponents('x')).map(c => c.custom_id);
    expect(ids).toContain('sugnudge_exact:x');
    expect(ids).toContain('sugnudge_other');
  });
});

describe('the picker respects platform rules', () => {
  it('PoP stays hidden while the era lock is on', () => {
    const locked = expansionOptions(bosses, true).map(o => o.value);
    expect(locked).not.toContain('PoP');
    const unlocked = expansionOptions(bosses, false).map(o => o.value);
    expect(unlocked).toContain('PoP');
  });

  it('a big expansion truncates at the Discord select cap of 25, flagged', () => {
    const { options, truncated } = bossOptionsForExpansion(bosses, 'Luclin');
    expect(options).toHaveLength(25);
    expect(truncated).toBe(true);
  });

  it('a small expansion lists everything, values are bosses.json ids', () => {
    const { options, truncated } = bossOptionsForExpansion(bosses, 'Classic');
    expect(truncated).toBe(false);
    const ids = new Set(bosses.map(b => b.id));
    for (const o of options) expect(ids.has(o.value)).toBe(true);
  });
});

describe('group events (Seru Minis — Hitya 2026-08-19, from Hawkner\'s thread)', () => {
  const { buildNudgeCard, GROUP_EVENTS } = require('../utils/suggestNudge.js');

  it('the Seru Minis event leads the buttons on Hawkner-style text, ahead of Lord Inquisitor Seru', () => {
    const { matchedBosses, components } = buildNudgeCard(
      "Seru Mini's for Hawkner\nLooking for a day that works for a couple groups to take down house leaders.",
      bosses,
    );
    expect(matchedBosses[0].id).toBe('evt_seru_minis');
    const comps = flat(components);
    expect(comps[0].custom_id).toBe('sugnudge_boss:evt_seru_minis');
  });

  it('matches the phrasings members actually type; never fires on the raid boss alone', () => {
    const ev = GROUP_EVENTS.find(e => e.id === 'evt_seru_minis');
    for (const s of ['seru minis', "Seru Mini's", 'minis of sanctus seru', 'the house leaders', 'the four Praesertum', 'praesertum bikun']) {
      expect(ev.match.test(s), s).toBe(true);
    }
    expect(ev.match.test('Lord Inquisitor Seru raid tonight')).toBe(false);
  });

  it('rides the Luclin picker list despite the 25-option cap (events lead the list)', () => {
    const { options } = bossOptionsForExpansion(bosses, 'Luclin');
    expect(options[0].value).toBe('evt_seru_minis');
    expect(options).toHaveLength(25);
  });

  it('events never live in bosses.json — the board must not learn them', () => {
    for (const e of GROUP_EVENTS) {
      expect(e.id.startsWith('evt_')).toBe(true);
      expect(bosses.some(b => b.id === e.id)).toBe(false);
    }
  });
});
