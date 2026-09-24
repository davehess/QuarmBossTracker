// test/spell-catalog-mana-recast.test.js — the spell catalog carries each
// spell's mana cost and recast time.
//
// The Me overlay (the guild lead, 2026-09-24: "clerics focus on how many CHs
// are left · enchanters, charms or mezzes left, theft of thought or harvest
// timers") needs both, and the catalog carried neither: the agent could see a
// spell's name, landing text and cast time, but not what it costs or how long
// until it can go again.
//
// Run: npx vitest run test/spell-catalog-mana-recast.test.js

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, stripJs } from './_source-slice.js';

const src = stripJs(readSource(BOT_INDEX));

describe('spell catalog', () => {
  it('reads mana and recast_time from eqemu_spells', () => {
    const m = src.match(/const SELECT = 'select=([^']+)'/);
    expect(m).not.toBeNull();
    const cols = m[1].split(',');
    expect(cols).toContain('mana');
    expect(cols).toContain('recast_time');
  });

  it('ships them on each entry, only when non-zero', () => {
    expect(src).toContain('mana:   Number(r.mana) > 0 ? Number(r.mana) : undefined,');
    expect(src).toContain('recast: Number(r.recast_time) > 0 ? Number(r.recast_time) : undefined,');
  });
});
