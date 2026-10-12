// A corpse's name resolves to its NPC on the bot (the guild lead, 2026-10-12: Target Info showed
// "no published drop table" on "Laef Windfall`s corpse"). The client writes the possessive with a
// backtick as well as an apostrophe, and some builds add a number after "corpse"; the strip only
// knew the straight apostrophe, so the lookup asked for "laef_windfall_s_corpse" and found nothing.
import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, BOT_INDEX } from './_source-slice.js';

const src = readSource(BOT_INDEX);
// eslint-disable-next-line no-new-func
const F = new Function(
  sliceBlock(src, 'function _normMobName(n) {', '\n}') + '\n'
  + sliceBlock(src, 'function _mobCaseKey(n) {', '\n}') + '\nreturn { _normMobName, _mobCaseKey };')();

describe('bot mob-info name keys strip every corpse spelling', () => {
  for (const name of ["Laef Windfall`s corpse", "Laef Windfall's corpse", 'Laef Windfall’s corpse', "Laef Windfall`s corpse0", 'Laef_Windfall']) {
    it(name, () => {
      expect(F._normMobName(name)).toBe('laef_windfall');
      expect(F._mobCaseKey(name)).toBe('laef_Windfall');
    });
  }
  it('a backticked NPC name keeps its backtick part', () => {
    expect(F._normMobName("Vyzh`dra the Exiled`s corpse")).toBe('vyzh_dra_the_exiled');
  });
});
