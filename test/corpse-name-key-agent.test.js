// A corpse's name resolves to its NPC in the agent (the guild lead, 2026-10-12: Target Info showed
// "no published drop table" on "Laef Windfall`s corpse"). The local cache key, the zone-pack key and
// the "your target just died" check all stripped only "'s corpse" with a straight apostrophe.
import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
// eslint-disable-next-line no-new-func
const F = new Function(
  sliceBlock(src, 'function _normMobNameAgent(n) {', '\n}') + '\n'
  + sliceBlock(src, 'function _mobCaseKey(n) {', '\n}') + '\nreturn { _normMobNameAgent, _mobCaseKey };')();

describe('agent mob-info name keys strip every corpse spelling', () => {
  for (const name of ["Laef Windfall`s corpse", "Laef Windfall's corpse", 'Laef Windfall’s corpse', "Laef Windfall`s corpse0", 'Laef_Windfall']) {
    it(name, () => {
      expect(F._normMobNameAgent(name)).toBe('laef_windfall');
      expect(F._mobCaseKey(name)).toBe('laef_Windfall');
    });
  }
  it('the target-died check sees a backticked corpse too', () => {
    const fn = stripJs(sliceBlock(src, 'function _noteMobDeathFromState(', '\n}'));
    expect(fn).toMatch(/const base = nn\.replace\(\/\[`'’\]s\\s\+corpse\\d\*\$\/i/);
  });
});
