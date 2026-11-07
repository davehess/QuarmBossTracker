// Mob Info carries each mob's own enrage % (ability 2, param0). REAL-IMPORT: calls the shipped helper.
// Server: Mob::StartEnrage uses param0 when > 0, else the rule default, so a bare `2,1` must read null.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const ms = require('../utils/mobSpecials.js');

describe('enragePct', () => {
  it('bare Enrage is the server default (null)', () => {
    expect(ms.enragePct({ special_abilities: '2,1' })).toBe(null);
    expect(ms.enragePct({ special_abilities: '2,1^8,1^13,1' })).toBe(null);
  });
  it('param0 is the percent', () => {
    expect(ms.enragePct({ special_abilities: '2,1,15' })).toBe(15);
    expect(ms.enragePct({ special_abilities: '1,1^2,1,20,5^3,1' })).toBe(20);
  });
  it('no Enrage, a disabled Enrage, a zero param or no row is null', () => {
    expect(ms.enragePct({ special_abilities: '3,1^8,1' })).toBe(null);
    expect(ms.enragePct({ special_abilities: '2,0,15' })).toBe(null);
    expect(ms.enragePct({ special_abilities: '2,1,0' })).toBe(null);
    expect(ms.enragePct({ special_abilities: null })).toBe(null);
    expect(ms.enragePct(null)).toBe(null);
  });
  it('the mob-info payload exposes it', () => {
    const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8')
      .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(src).toMatch(/enrage_pct:\s*mobSpecials\.enragePct\(r\)/);
  });
});
