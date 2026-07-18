// Guild version-floor comparator (#74 Part 2) — MIRROR fidelity tier.
//
// The floor comparator `_verNum` ships in the AGENT (packages/wolfpack-logsync/
// index.js) on the BETA channel, so on `main` the shipped agent file does not yet
// contain it — a source-slice would read the stale stable copy. Following the
// established pattern for beta-only logic (trigger-class / timeline-events were
// mirrors before they graduated), this test MIRRORS the tiny pure function and its
// floor predicate. When the beta agent graduates to stable, upgrade this to a
// source-slice of the real `_verNum` (as STATUS notes was done for the others).
//
// MIRROR — keep in lock-step with `_verNum` in the agent:
//   major*10000 + minor*100 + patch, so 3.3.85 → 30385. Non-numeric/missing → 0
//   (fail-open: a 0 floor never stands anyone down).
function _verNum(v) {
  const p = String(v || '').split('.').map(n => parseInt(n, 10) || 0);
  return (p[0] || 0) * 10000 + (p[1] || 0) * 100 + (p[2] || 0);
}
// belowFloor mirrors _controlStandDown's floor branch: a positive floor that the
// agent's numeric version falls under → stand down.
function belowFloor(agentVer, minVerNum) {
  const floor = Number.isFinite(Number(minVerNum)) && Number(minVerNum) > 0 ? Math.floor(Number(minVerNum)) : 0;
  return floor > 0 && _verNum(agentVer) < floor;
}

import { describe, it, expect } from 'vitest';

describe('_verNum — version → comparable integer', () => {
  it('maps 3.3.85 → 30385 (the documented example)', () => {
    expect(_verNum('3.3.85')).toBe(30385);
  });

  it('is strictly monotonic across patch / minor / major bumps', () => {
    expect(_verNum('3.3.86')).toBeGreaterThan(_verNum('3.3.85'));
    expect(_verNum('3.4.0')).toBeGreaterThan(_verNum('3.3.99'));
    expect(_verNum('4.0.0')).toBeGreaterThan(_verNum('3.99.99'));
  });

  it('specific encodings', () => {
    expect(_verNum('3.3.86')).toBe(30386);
    expect(_verNum('3.4.0')).toBe(30400);
    expect(_verNum('4.0.0')).toBe(40000);
    expect(_verNum('1.9.6')).toBe(10906);
  });

  it('missing / malformed → 0 (fail-open, never stands an agent down)', () => {
    expect(_verNum('')).toBe(0);
    expect(_verNum(null)).toBe(0);
    expect(_verNum(undefined)).toBe(0);
    expect(_verNum('garbage')).toBe(0);
  });

  it('tolerates a trailing/short segment', () => {
    expect(_verNum('3.3')).toBe(30300);       // patch defaults to 0
    expect(_verNum('3')).toBe(30000);
  });
});

describe('belowFloor — the stand-down predicate', () => {
  it('an agent at exactly the floor is NOT below it', () => {
    expect(belowFloor('3.3.85', 30385)).toBe(false);
  });

  it('an agent below the floor stands down', () => {
    expect(belowFloor('3.3.84', 30385)).toBe(true);
    expect(belowFloor('3.2.99', 30385)).toBe(true);
  });

  it('an agent above the floor runs normally', () => {
    expect(belowFloor('3.3.86', 30385)).toBe(false);
    expect(belowFloor('3.4.0', 30385)).toBe(false);
  });

  it('unset / zero / non-numeric floor → nobody stands down (fail-open)', () => {
    expect(belowFloor('3.3.85', 0)).toBe(false);
    expect(belowFloor('3.3.85', '')).toBe(false);
    expect(belowFloor('3.3.85', undefined)).toBe(false);
    expect(belowFloor('1.0.0', 'garbage')).toBe(false);
  });
});
