// The agent's Target Info cache must keep two same-name NPCs apart when their
// names differ in capitalisation — `a_Shissar_acolyte` (Warrior, 162488) and
// `A_Shissar_Acolyte` (Wizard, 162153); the guild lead, 2026-09-23. Keyed on the
// lowercased name alone, whichever one was targeted first was served for both
// for six hours, even after the bot learned to tell them apart.
//
// Runs the real functions sliced from the agent.
//
// Run: npx vitest run test/mobinfo-case-cache.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const { _mobInfoCacheKey, _pacifyImmuneKnown, _mobInfoByName } = evalBlock(
  'const _mobInfoByName = new Map();\n'
  + sliceBlock(src, 'function _normMobNameAgent(n) {', '\n}') + '\n'
  + sliceBlock(src, 'function _mobCaseKey(n) {', '\n}') + '\n'
  + sliceBlock(src, 'function _mobInfoCacheKey(name, zoneId) {', '\n}') + '\n'
  + sliceBlock(src, 'function _pacifyImmuneKnown(targetName) {', '\n}'),
  ['_mobInfoCacheKey', '_pacifyImmuneKnown', '_mobInfoByName'],
);

describe('_mobInfoCacheKey', () => {
  it('the two acolytes get different keys', () => {
    expect(_mobInfoCacheKey('a Shissar acolyte', 162)).not.toBe(_mobInfoCacheKey('A Shissar Acolyte', 162));
  });
  it('one mob gets one key whether the name came from Zeal or the log', () => {
    // The log capitalises the first letter of a sentence; nothing else.
    expect(_mobInfoCacheKey('A Shissar acolyte', 162)).toBe(_mobInfoCacheKey('a Shissar acolyte', 162));
    expect(_mobInfoCacheKey('#a_Shissar_acolyte', 162)).toBe(_mobInfoCacheKey('a Shissar acolyte', 162));
  });
  it('the zone still separates the key (#141)', () => {
    expect(_mobInfoCacheKey('a geonid', 1)).not.toBe(_mobInfoCacheKey('a geonid', 2));
  });
});

describe('_pacifyImmuneKnown still finds rows under the new key', () => {
  it('scans by the lowercased-name prefix, which the key still starts with', () => {
    _mobInfoByName.set(_mobInfoCacheKey('a Shissar acolyte', 162), { at: Date.now(), mob: { specials: ['Immune Pacify'] } });
    expect(_pacifyImmuneKnown('A Shissar acolyte')).toBe(true);
  });
});
