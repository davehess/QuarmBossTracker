// test/live-damage-merge.test.js — the merge behind the live guild DPS view.
//
// Every failure here renders as a plausible scoreboard, which is why it needs
// tests rather than a look:
//   • SUMMING uploaders instead of maxing double-counts everyone seen by more
//     than one client — and heavy overlap is the normal case, not the edge one.
//     (The sibling trap, maxing per-bucket DELTAS, was measured at ~2.4x
//     over-count in DESIGN-fight-timeline.md.)
//   • Pets not folded under their owner show up as extra "players".
//   • An old snapshot from the same uploader beating their newest one makes the
//     scoreboard run BACKWARDS as the fight goes on.
//
// Run: npx vitest run test/live-damage-merge.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, BOT_INDEX } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const handler = sliceBlock(src, 'async function _handleAgentLiveDamage', '\n}');

// The merge is embedded in the handler (which needs auth + supabase), so mirror
// its arithmetic here and assert the SOURCE still says what this models.
function mergeNewest(rows) {
  const newest = new Map();
  for (const r of rows) {                       // rows arrive snapshot_at DESC
    if (!r || !r.uploader) continue;
    if (!newest.has(r.uploader)) newest.set(r.uploader, r);
  }
  const best = new Map();
  for (const r of newest.values()) {
    for (const [name, v] of Object.entries(r.per_player || {})) {
      const dmg = Number(v && v.dmg) || 0;
      if (dmg <= 0) continue;
      const who = (v && v.pet_owner) ? String(v.pet_owner) : name;
      if (dmg > (best.get(who) || 0)) best.set(who, dmg);
    }
  }
  return [...best.entries()].map(([character, dmg]) => ({ character, dmg }))
    .sort((a, b) => b.dmg - a.dmg);
}

const row = (uploader, at, per_player) => ({ uploader, snapshot_at: at, per_player });

describe('the shipped handler still merges the way this models', () => {
  it('takes a MAX, never a sum', () => {
    expect(handler).toMatch(/if \(dmg > prev\) best\.set\(who, dmg\)/);
    expect(handler, 'a += would double-count overlapping uploaders').not.toMatch(/best\.set\(who, prev \+/);
  });

  it('keeps only the newest row per uploader', () => {
    expect(handler).toMatch(/if \(!newest\.has\(r\.uploader\)\) newest\.set\(r\.uploader, r\)/);
    expect(handler).toMatch(/order=snapshot_at\.desc/);
  });

  it('folds pets under their owner', () => {
    expect(handler).toMatch(/v\.pet_owner\) \? String\(v\.pet_owner\) : name/);
  });

  it('does NOT filter excluded characters on read', () => {
    // exclude_from_stats is enforced upload-side; filtering here would hide a
    // player from observers who legitimately saw them (Hitya, 2026-08-13).
    expect(handler).not.toMatch(/exclude_from_stats/);
  });

  it('reports staleness so the HUD can say "paused" instead of freezing', () => {
    expect(handler).toMatch(/newest_sample_age_sec/);
  });
});

describe('merge arithmetic', () => {
  it('two uploaders seeing the same player report that player ONCE', () => {
    const out = mergeNewest([
      row('A', '3', { Wabumkin: { dmg: 1000 } }),
      row('B', '3', { Wabumkin: { dmg: 900 } }),
    ]);
    expect(out).toEqual([{ character: 'Wabumkin', dmg: 1000 }]);   // not 1900
  });

  it('unions players across uploaders who each saw only part of the raid', () => {
    // The 0.1%-of-the-fight case: one client saw almost nothing.
    const out = mergeNewest([
      row('A', '3', { Statlander: { dmg: 5000 }, Hitya: { dmg: 4000 } }),
      row('B', '3', { Wabumkin: { dmg: 9000 } }),
    ]);
    expect(out.map(p => p.character)).toEqual(['Wabumkin', 'Statlander', 'Hitya']);
  });

  it('ignores an uploader\'s stale row in favour of their newest', () => {
    // Rows arrive DESC, so the first per uploader is newest. Taking the older
    // one would make the scoreboard run backwards mid-fight.
    const out = mergeNewest([
      row('A', '5', { Hitya: { dmg: 8000 } }),   // newest
      row('A', '1', { Hitya: { dmg: 3000 } }),   // stale, must lose
    ]);
    expect(out).toEqual([{ character: 'Hitya', dmg: 8000 }]);
  });

  it('folds a pet into its owner rather than listing it separately', () => {
    const out = mergeNewest([
      row('A', '3', {
        Hitya: { dmg: 5000 },
        'a hulking dire wolf': { dmg: 2000, pet_owner: 'Hitya' },
      }),
    ]);
    // Owner keeps the MAX of the two, consistent with the merge rule.
    expect(out).toEqual([{ character: 'Hitya', dmg: 5000 }]);
    expect(out.some(p => p.character.includes('wolf'))).toBe(false);
  });

  it('drops zero and junk damage without crashing', () => {
    const out = mergeNewest([
      row('A', '3', { Ghost: { dmg: 0 }, Bad: { dmg: null }, Real: { dmg: 12 } }),
      row('B', '3', null),
      null,
    ]);
    expect(out).toEqual([{ character: 'Real', dmg: 12 }]);
  });

  it('is monotonic as more uploaders report — a number can only rise', () => {
    // The property that makes a live view safe: late-arriving data never
    // revises someone downward.
    const first  = mergeNewest([row('A', '3', { Hitya: { dmg: 100 } })]);
    const second = mergeNewest([
      row('A', '3', { Hitya: { dmg: 100 } }),
      row('B', '3', { Hitya: { dmg: 450 } }),
    ]);
    expect(first[0].dmg).toBe(100);
    expect(second[0].dmg).toBeGreaterThanOrEqual(first[0].dmg);
  });
});
