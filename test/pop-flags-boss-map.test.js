// test/pop-flags-boss-map.test.js — a PoP flag grant is named by the boss that died just before it.
//
// The bot's map was keyed on short names ("keeper of sorrows", "coirnav"), but the server's NPC catalog
// names seven of the flag bosses differently (checked in eqemu_npc_types, 2026-09-29), so those kills'
// flags would all have landed as 'unmapped' and never ticked the PoP checklist. The map now carries the
// catalog names, and the lookup reads "#Xegony_the_Queen_of_Air" and "Xegony the Queen of Air" alike.
//
// Run: npx vitest run test/pop-flags-boss-map.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, BOT_INDEX } from './_source-slice.js';

const bot = readSource(BOT_INDEX);
const { POP_FLAG_BY_BOSS, _popBossKey } = evalBlock(
  sliceBlock(bot, 'const POP_FLAG_BY_BOSS = {', ".replace(/_/g, ' ').toLowerCase() : '');"),
  ['POP_FLAG_BY_BOSS', '_popBossKey'],
);
const flagFor = (boss) => POP_FLAG_BY_BOSS[_popBossKey(boss)] || 'unmapped';

describe('PoP flag grants map by the boss the server names', () => {
  it('the seven catalog names that used to miss', () => {
    expect(flagFor('The Keeper of Sorrows')).toBe('keeper_dead');
    expect(flagFor('Lord Mithaniel Marr')).toBe('marr_dead');
    expect(flagFor('Coirnav the Avatar of Water')).toBe('coirnav_dead');
    expect(flagFor('Fennin Ro the Tyrant of Fire')).toBe('fennin_dead');
    expect(flagFor('#Xegony_the_Queen_of_Air')).toBe('xegony_dead');
    expect(flagFor('A Mystical Arbitor of Earth')).toBe('arbitor_dead');
    expect(flagFor('A Rathe Councilman')).toBe('rathe_dead');
  });
  it('the names that already matched still do, and an unknown boss stays unmapped', () => {
    expect(flagFor('Grummus')).toBe('grummus_dead');
    expect(flagFor('Agnarr the Storm Lord')).toBe('agnarr_dead');
    expect(flagFor('a bat')).toBe('unmapped');
    expect(flagFor(null)).toBe('unmapped');
  });
});
