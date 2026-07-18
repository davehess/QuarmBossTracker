// utils/range.js — position-based buff-range awareness (#117). REAL-IMPORT.
// Pure helper: distance, threshold, unknown-position ⇒ in-range (fail-open).

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const rng = require('../utils/range.js');

describe('utils/range (buff-range awareness)', () => {
  it('exports a named 200-unit v1 threshold', () => {
    expect(rng.BUFF_RANGE_UNITS).toBe(200);
  });

  describe('distance()', () => {
    it('computes 3D distance', () => {
      expect(rng.distance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBe(5);
      expect(rng.distance({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 })).toBe(10);
    });
    it('treats Z as coplanar when absent on either side', () => {
      // 3-4-? with no Z on the target → 2D distance 5.
      expect(rng.distance({ x: 0, y: 0, z: 5 }, { x: 3, y: 4 })).toBe(5);
      expect(rng.distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    });
    it('returns null when X or Y is missing / non-finite', () => {
      expect(rng.distance({ x: 0 }, { x: 3, y: 4 })).toBeNull();
      expect(rng.distance(null, { x: 3, y: 4 })).toBeNull();
      expect(rng.distance({ x: 0, y: 0 }, null)).toBeNull();
      expect(rng.distance({ x: NaN, y: 0 }, { x: 3, y: 4 })).toBeNull();
    });
  });

  describe('isLikelyOutOfRange()', () => {
    const near = { x: 100, y: 100, z: 0 };
    it('false when within the threshold', () => {
      expect(rng.isLikelyOutOfRange(near, { x: 150, y: 100, z: 0 })).toBe(false); // 50u
      expect(rng.isLikelyOutOfRange(near, { x: 300, y: 100, z: 0 })).toBe(false); // 200u — exactly at, not beyond
    });
    it('true when beyond the threshold', () => {
      expect(rng.isLikelyOutOfRange(near, { x: 400, y: 100, z: 0 })).toBe(true); // 300u
    });
    it('boundary: exactly 200 units is in range (fail-open on the edge)', () => {
      expect(rng.isLikelyOutOfRange({ x: 0, y: 0, z: 0 }, { x: 200, y: 0, z: 0 })).toBe(false);
      expect(rng.isLikelyOutOfRange({ x: 0, y: 0, z: 0 }, { x: 200.01, y: 0, z: 0 })).toBe(true);
    });
    it('FAIL-OPEN: unknown buffer or target position ⇒ in range', () => {
      expect(rng.isLikelyOutOfRange(null, { x: 999, y: 999, z: 0 })).toBe(false);
      expect(rng.isLikelyOutOfRange(near, null)).toBe(false);
      expect(rng.isLikelyOutOfRange({ x: null, y: null }, { x: 999, y: 999 })).toBe(false);
    });
    it('honors a custom threshold', () => {
      expect(rng.isLikelyOutOfRange({ x: 0, y: 0 }, { x: 50, y: 0 }, 40)).toBe(true);
      expect(rng.isLikelyOutOfRange({ x: 0, y: 0 }, { x: 50, y: 0 }, 100)).toBe(false);
    });
  });
});
