// test/kneel-test-guard.test.js — the junk-landing guard counts the CATALOG,
// not the survivors.
//
// Hitya, 2026-08-16: "for beta, I'm still seeing kneel test on the target
// info." The server was clean (0 buff_casts rows — the bot's ingest filter
// works); the phantom was LOCAL. Root cause: "is struck by a sudden force."
// is shared by 33 catalog spells, but the junk guard counted distinct names
// WITHIN each index — and exactly one of the 33 (Kneel Test, EQEmu's internal
// test row, the only timed+detrimental member) survived the index filters.
// A family of one sailed under the >8 guard and was crowned with full
// confidence on every Ssra knockback.
//
// The fix: ambiguity is a property of the TEXT, so sharers are counted over
// the whole catalog before any filtering. These tests rehydrate the real
// _rebuildBuffMatchers and pin all three behaviors: the Kneel Test shape is
// dropped, the slow-family rescue still works, and small real families are
// untouched.
//
// Run: npx vitest run test/kneel-test-guard.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

const src = fs.readFileSync(
  path.join(ROOT, 'packages', 'wolfpack-logsync', 'index.js'), 'utf8');

function grab(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  let depth = 0, end = start;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return src.slice(start, end);
}

// Rehydrate with a controllable catalog. Stubs mirror the real predicates'
// shapes: timed = positive duration formula; slow = the shaman-insects family.
function buildIndexes(entries) {
  const harness = new Function('entriesJson', `
    const _spellByNameLower = new Map();
    for (const e of JSON.parse(entriesJson)) _spellByNameLower.set(e.name.toLowerCase(), e);
    const _isTimedDurationFormula = (durf) => Number(durf) > 0;
    const _isTrackedBuffName = () => false;   // the buff index is not under test
    const _isSlowSpell = (n) => /insects|walking sleep/i.test(String(n));
    let _buffLandingBySuffix = new Map();
    let _debuffLandingBySuffix = new Map();
    const _rebuildMechanicMatchers = () => {};
    const console = { log: () => {} };
    ${grab('_rebuildBuffMatchers')}
    _rebuildBuffMatchers();
    return { dm: _debuffLandingBySuffix };
  `);
  return harness(JSON.stringify(entries));
}

const FORCE = 'is struck by a sudden force.';

describe('the junk-landing guard', () => {
  it('drops Kneel Test even as the sole indexed member of a 33-spell text', () => {
    // The exact regression shape: 33 sharers in the CATALOG, one survivor of
    // the timed+detrimental filters. Old guard: family of one → crowned.
    const entries = [
      { id: 2808, name: 'Kneel Test', other: FORCE, durf: 1, dur: 1, good: 0 },
      ...Array.from({ length: 32 }, (_, i) => ({
        id: 9000 + i, name: `Knockback ${i}`, other: FORCE, durf: 0, dur: 0, good: 0,
      })),
    ];
    const { dm } = buildIndexes(entries);
    expect(dm.has(FORCE), 'a 33-sharer text must never crown anyone').toBe(false);
  });

  it('still rescues the slow family from an over-threshold shared text', () => {
    // "yawns." — 11 detrimental timed spells, over the guard, but the slow
    // members are kept so the #130 slow badge keeps working (2026-07-27 rule).
    const entries = [
      { id: 1, name: "Turgur's Insects", other: 'yawns.', durf: 2, dur: 100, good: 0 },
      { id: 2, name: 'Walking Sleep',    other: 'yawns.', durf: 2, dur: 60,  good: 0 },
      ...Array.from({ length: 9 }, (_, i) => ({
        id: 100 + i, name: `Drowsy Variant ${i}`, other: 'yawns.', durf: 2, dur: 10, good: 0,
      })),
    ];
    const { dm } = buildIndexes(entries);
    expect(dm.has('yawns.')).toBe(true);
    expect(dm.get('yawns.').map(h => h.name).sort())
      .toEqual(["Turgur's Insects", 'Walking Sleep']);
  });

  it('leaves a small real family alone', () => {
    const entries = [
      { id: 2527, name: 'Plague of Insects',
        other: "'s motions slow as a plague of insects chews at their skin.",
        durf: 2, dur: 100, good: 0 },
    ];
    const { dm } = buildIndexes(entries);
    expect(dm.size).toBe(1);
  });
});
