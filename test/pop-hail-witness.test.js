// test/pop-hail-witness.test.js — witnessed hails as PoP flag coverage for
// raiders who don't run Mimic. SOURCE-SLICE tier.
//
// Hitya 2026-08-20: "we need people that don't use mimic to be covered as
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
});
