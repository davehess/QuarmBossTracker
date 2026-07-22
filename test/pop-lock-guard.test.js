// #139 spell-catalog `undefined 'expansion'` guard — REAL-IMPORT fidelity tier.
//
// Root cause: the spell-catalog handler computed its era level cap with
// `isPopLocked()` — no boss argument — and isPopLocked dereferenced
// `boss.expansion`, throwing "Cannot read properties of undefined (reading
// 'expansion')". That throw happens BEFORE the catalog's row loop, so it 500'd
// the ENTIRE endpoint (zero spells served) on every fetch. Fix: a global
// era helper (isPopEraLocked) for the no-boss case, plus a null-safe isPopLocked
// so a stray no-arg call can never crash again.

import { describe, it, expect } from 'vitest';
import { isPopLocked, isPopEraLocked, POP_UNLOCK_MS } from '../utils/config.js';

describe('isPopLocked — null-safe (#139)', () => {
  it('does not throw when called with no boss (the spell-catalog regression)', () => {
    expect(() => isPopLocked()).not.toThrow();
    expect(isPopLocked()).toBe(false);
  });

  it('does not throw on null / non-object bosses', () => {
    expect(() => isPopLocked(null)).not.toThrow();
    expect(() => isPopLocked(undefined)).not.toThrow();
    expect(isPopLocked({})).toBe(false);
  });

  it('still locks a PoP boss before unlock and never a non-PoP boss', () => {
    const locked = Date.now() < POP_UNLOCK_MS;
    expect(isPopLocked({ expansion: 'PoP' })).toBe(locked);
    expect(isPopLocked({ expansion: 'Luclin' })).toBe(false);
  });
});

describe('isPopEraLocked — global era check', () => {
  it('matches the POP_UNLOCK_MS boundary (no boss required)', () => {
    expect(isPopEraLocked()).toBe(Date.now() < POP_UNLOCK_MS);
  });

  it('is what the spell-catalog level cap should key off (60 while locked, else 65)', () => {
    const dsLevel = isPopEraLocked() ? 60 : 65;
    expect([60, 65]).toContain(dsLevel);
    // Today (pre-2026-10-01) the era is locked → cap 60.
    if (Date.now() < POP_UNLOCK_MS) expect(dsLevel).toBe(60);
  });
});
