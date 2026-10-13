// utils/factionCon.js — how a faction cons to a player by default (base + race / class / deity mods, capped).
// The guild lead, 2026-10-13: PoTranq "indifferent to everyone" → never KOS; PoValor has +1000 for every player race, so a
// non-player illusion (no race mod) leaves -1000 → scowls.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { BOT_INDEX } from './_source-slice.js';

const fc = createRequire(BOT_INDEX)('./utils/factionCon');
const ALL_PLAYER_RACES = Object.fromEntries(Object.keys(fc.PLAYER_RACES).map(id => ['r' + id, 1000]));

describe('factionCon', () => {
  it('con tiers at their boundaries (EQEmu CalculateFaction)', () => {
    const cases = [[1100, 8], [1099, 7], [750, 7], [749, 6], [500, 6], [100, 5], [99, 4], [0, 4], [-1, 3], [-100, 3],
      [-101, 2], [-700, 2], [-701, 1], [-999, 1], [-1000, 0]];
    for (const [v, r] of cases) expect([v, fc.conRank(v)]).toEqual([v, r]);
    expect(fc.isKos(-700)).toBe(false);
    expect(fc.isKos(-701)).toBe(true);
  });
  it('Inhabitants of Tranquility (base 0, caps 0/0, no mods): never KOS', () => {
    const f = { base: 0, min_cap: 0, max_cap: 0, mods: {} };
    expect(fc.valueRange(f, null)).toEqual([0, 0]);
    expect(fc.kosClass(f)).toBe('never');
  });
  it('Inhabitants of Valor: never KOS to a player race, scowls at a Skeleton illusion', () => {
    const f = { base: -1000, min_cap: -2000, max_cap: 2000, mods: ALL_PLAYER_RACES };
    expect(fc.kosClass(f)).toBe('never');
    const [v] = fc.valueRange(f, { race: 60, cls: 1, deity: 396 });
    expect(v).toBe(-1000);
    expect(fc.conRank(v)).toBe(0);
  });
  it('always / some, the unknown dimensions spread, and a real cap clamps', () => {
    expect(fc.kosClass({ base: -1500, mods: {} })).toBe('always');
    const de = { base: 0, mods: { r6: -1000 } };
    expect(fc.kosClass(de)).toBe('some');
    expect(fc.valueRange(de, { race: 6, cls: 1, deity: 206 })).toEqual([-1000, -1000]);
    expect(fc.valueRange(de, { race: null, cls: 1, deity: 206 })).toEqual([-1000, 0]);   // race unknown: both ends
    expect(fc.valueRange({ base: -3000, min_cap: -2000, max_cap: 2000, mods: {} }, null)).toEqual([-2000, -2000]);
  });
});
