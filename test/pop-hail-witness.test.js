// test/pop-hail-witness.test.js — witnessed hails as PoP flag coverage for
// raiders who don't run Mimic. SOURCE-SLICE tier.
//
// The guild lead 2026-08-20: "we need people that don't use mimic to be covered as
// well. When someone Hails a flagging NPC and we see that from a mimic-enabled
// raider, we should record that as a proper flag."
//
// The authoritative grant line ("You have received a character flag!") is a
// SELF message — it only ever reaches us for Mimic users. A hail is visible to
// everyone in range, which is exactly the missing coverage.

import { describe, it, expect } from 'vitest';
import { readSource, AGENT_INDEX, sliceBlock, evalBlock } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const block = sliceBlock(
  src, 'const _HAIL_WITNESS_RX',
  "ts:        ts ? ts.toISOString() : new Date().toISOString(),\n  };\n}",
);
const { parseWitnessedHail } = evalBlock(
  'const _zealState = {}; const parseEqTimestamp = () => null;\n' + block,
  ['parseWitnessedHail'],
);

describe('parseWitnessedHail', () => {
  it('captures the hailer and the NPC from a witnessed hail', () => {
    const e = parseWitnessedHail("[Thu Aug 20 21:14:02 2026] Fittir says, 'Hail, Seer Mal Nae'", 'Hitya');
    expect(e).toMatchObject({ character: 'Fittir', npc: 'Seer Mal Nae', source: 'hail_witnessed', witness: 'Hitya' });
  });

  it('handles the punctuation EQ actually emits', () => {
    expect(parseWitnessedHail("[x] Dant says, 'Hail, Mavuin!'", 'Hitya').npc).toBe('Mavuin');
    expect(parseWitnessedHail("[x] Dant says 'Hail Giwin Mirakon'", 'Hitya').npc).toBe('Giwin Mirakon');
  });

  it('is NOT a general say-chat capture — only the hail greeting form', () => {
    expect(parseWitnessedHail("[x] Dant says, 'that was close'", 'Hitya')).toBeNull();
    expect(parseWitnessedHail("[x] Dant says, 'we should hail him after'", 'Hitya')).toBeNull();
    expect(parseWitnessedHail("[x] Dant tells the guild, 'Hail, Mavuin'", 'Hitya')).toBeNull();
  });

  it('ignores lines with no hail at all', () => {
    expect(parseWitnessedHail('[x] You have received a character flag!', 'Hitya')).toBeNull();
    expect(parseWitnessedHail('', 'Hitya')).toBeNull();
  });

  it('carries no boss and its own source, so it can never be mistaken for the grant line', () => {
    const e = parseWitnessedHail("[x] Statlander says, 'Hail, Elder Poxbourne'", 'Hitya');
    expect(e.boss).toBeNull();
    expect(e.source).toBe('hail_witnessed');
  });

  // The hail board (the guild lead, 2026-10-05): the Planar Projection and the other flag NPCs the
  // board is built around. Invented hailer names.
  it('accepts every flag NPC the hail board stands up a window for', () => {
    const npcs = ['A Planar Projection', 'Planar Projection', 'Tylis Newleaf', 'Giwin Mirakon', 'Nitram Anizok', 'Tarkil Adan'];
    for (const npc of npcs) {
      const e = parseWitnessedHail(`[Sun Oct 04 20:10:01 2026] Brackwyn says, 'Hail, ${npc}'`, 'Aldenmar');
      expect(e, npc).toMatchObject({ character: 'Brackwyn', npc, witness: 'Aldenmar', self: false, source: 'hail_witnessed' });
    }
  });
});

// Your OWN hail prints "You say, ..." in your own log, never "<You> says". Some flag NPCs print no
// grant line (a Planar Projection can hand a flag over silently), so this is the only evidence the
// board gets for you.
describe('parseWitnessedHail — your own hail', () => {
  it('is attributed to the log\'s character, and says it was your own', () => {
    const e = parseWitnessedHail("[Sun Oct 04 20:10:01 2026] You say, 'Hail, A Planar Projection'", 'Aldenmar');
    expect(e).toMatchObject({ character: 'Aldenmar', npc: 'A Planar Projection', witness: 'Aldenmar', self: true, source: 'hail_witnessed' });
    expect(e.boss).toBeNull();
  });

  it('takes the same punctuation a witnessed hail does', () => {
    expect(parseWitnessedHail("[x] You say, 'Hail, Tylis Newleaf!'", 'Aldenmar').npc).toBe('Tylis Newleaf');
    expect(parseWitnessedHail("[x] You say 'Hail Giwin Mirakon'", 'Aldenmar').npc).toBe('Giwin Mirakon');
  });

  it('is still only the greeting, and only on /say', () => {
    expect(parseWitnessedHail("[x] You say, 'we should hail him after'", 'Aldenmar')).toBeNull();
    expect(parseWitnessedHail("[x] You say to your guild, 'Hail, Mavuin'", 'Aldenmar')).toBeNull();
    expect(parseWitnessedHail("[x] You shout, 'Hail, Mavuin'", 'Aldenmar')).toBeNull();
    expect(parseWitnessedHail("[x] You tell your group, 'Hail, Mavuin'", 'Aldenmar')).toBeNull();
  });

  it('needs a character to be attributed to', () => {
    expect(parseWitnessedHail("[x] You say, 'Hail, Mavuin'", '')).toBeNull();
    expect(parseWitnessedHail("[x] You say, 'Hail, Mavuin'", undefined)).toBeNull();
  });
});
