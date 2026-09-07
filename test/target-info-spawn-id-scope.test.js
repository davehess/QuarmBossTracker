// test/target-info-spawn-id-scope.test.js — Target Info stops pooling effects
// across same-name mobs once the client can name the spawn.
//
// Hitya, 2026-09-02: "we also need to incorporate the spawn ID into the target
// info window so we dedup those effects between same named mobs, off of spawn
// id."
//
// buff_casts keys a landing by target NAME, so the cross-client relay merged
// every same-name mob in the zone into one effect list — the mob you are
// targeting showed timers belonging to its siblings. #141 fixed the same bug
// ACROSS zones; this is one level down, WITHIN a zone.
//
// ⚠ THE NULL RULE IS THE OPPOSITE OF _zoneScopeKeep'S AND THAT IS THE WHOLE
// DANGER HERE. An unknown observer ZONE is suspicious and drops. An unknown row
// ID is the ORDINARY case — a landing line names its target by name only, the
// pipe carries an id for the observer's own target and nothing else, and NO
// RELEASED ZEAL SENDS ONE AT ALL. Someone "tidying" this to match its sibling
// would drop every row in the table and empty Target Info for the whole guild,
// on a board people read mid-fight.
//
// Run: npx vitest run test/target-info-spawn-id-scope.test.js

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = readSource(BOT_INDEX);

// Both real predicates, run for real.
//
// ⚠ The end anchor is the COMMENT that opens the NEXT declaration, never a line
// of either function's body. An earlier draft of this file closed the slice on
// _idScopeKeep's own body, so every mutation to that body broke the slice and
// reported "no tests" — which reads like a kill in a mutation run and proves
// exactly nothing about the assertions.
const { _idScopeKeep, _zoneScopeKeep } = evalBlock(
  sliceBlock(
    src,
    'function _zoneScopeKeep(requesterZone, observerZone) {',
    '\n// GET /api/agent/target-casts?name=<npc|player>',
  ),
  ['_idScopeKeep', '_zoneScopeKeep'],
);

describe('what survives the spawn-id filter', () => {
  it('drops a proven sibling — the entire point of the feature', () => {
    expect(_idScopeKeep(4425, 4471)).toBe(false);
  });

  it('keeps the mob in front of you', () => {
    expect(_idScopeKeep(4425, 4425)).toBe(true);
  });

  // ⚠ Today's whole fleet. If this ever returns false, Target Info goes blank
  // for everyone until a Zeal release ships AND every raider updates.
  it('keeps every row when the requester has no id', () => {
    expect(_idScopeKeep(null, null)).toBe(true);
    expect(_idScopeKeep(null, 4471)).toBe(true);
    expect(_idScopeKeep(undefined, 4471)).toBe(true);
  });

  // ⚠ THE LIVE BUG, 2026-09-06 (Hitya, mid-fight on Kaas Thox Xi Aten Ha Ra).
  // Zeal reports target id 0 when there is no target, Number.isFinite(0) is
  // true, so the agent stamped 0 rather than null. 111 of 134 rows on that boss
  // carried 0; the one raider whose Zeal sent a REAL id compared 0 === 592 and
  // dropped all of them, leaving Target Info showing three debuffs out of
  // eight. Zero means UNPROVEN on BOTH sides of the comparison.
  it('treats 0 as unproven, not as spawn zero', () => {
    expect(_idScopeKeep(592, 0)).toBe(true);     // the row could not prove a spawn
    expect(_idScopeKeep(0, 592)).toBe(true);     // the requester could not prove one
    expect(_idScopeKeep('0', 592)).toBe(true);   // query strings arrive as text
    expect(_idScopeKeep(592, '0')).toBe(true);
  });

  // The feature still has to work — 0 is not a blanket "keep everything".
  it('still drops a proven sibling once BOTH ids are real', () => {
    expect(_idScopeKeep(592, 153)).toBe(false);
  });

  // ⚠ The other half of the same cliff: an observer who was targeting the tank
  // when the debuff landed cannot prove an id. Unproven is not disproven.
  it('keeps a row whose own id is unknown', () => {
    expect(_idScopeKeep(4425, null)).toBe(true);
    expect(_idScopeKeep(4425, undefined)).toBe(true);
  });

  it('compares numerically, so a stringy id from the query still matches', () => {
    expect(_idScopeKeep(4425, '4425')).toBe(true);
    expect(_idScopeKeep('4425', 4425)).toBe(true);
    expect(_idScopeKeep('4425', '4471')).toBe(false);
  });

  // ⚠ THIS TEST USED TO ASSERT THE OPPOSITE, and the assumption under it was
  // wrong. It read "spawn id 0 is a real slot", guarding a falsy-zero trap that
  // is real elsewhere — but Zeal SENDS 0 for "no target" rather than omitting
  // the field, which apps/mimic/main.js still documents as an omission. So 0
  // reaches us meaning unproven, and treating it as a real slot is what emptied
  // Target Info on 2026-09-06. The measurement that settles it: on one boss,
  // 13 of 15 observers wrote ONLY 0, and the single client with spawn-id
  // support wrote 0 on 169 observations and a real id on 51. Nobody targets
  // slot 0 that often. Kept as an explicit `Number(v) === 0`, never `!v`, so
  // the falsy-zero trap the old test feared still cannot creep in via a
  // null/undefined/empty-string shortcut.
  it('treats 0 as unproven on either side, not as spawn zero', () => {
    expect(_idScopeKeep(4471, 0)).toBe(true);
    expect(_idScopeKeep(0, 4471)).toBe(true);
    expect(_idScopeKeep(0, 0)).toBe(true);
  });

  // Pinned side by side because the asymmetry is the thing most likely to be
  // "cleaned up" by someone who notices the two functions look alike.
  it('is deliberately NOT the same null rule as its zone-scoping sibling', () => {
    expect(_zoneScopeKeep('Plane of Hate', null)).toBe(false);   // unknown zone drops
    expect(_idScopeKeep(4425, null)).toBe(true);                 // unknown id keeps
  });
});

describe('wiring', () => {
  const bot = stripJs(src);
  const fn  = sliceBlock(bot, 'async function _handleAgentTargetBuffs(', '\nasync function ');

  it('reads the requester id off the query, fail-open when absent', () => {
    expect(fn).toContain("sp.get('target_id')");
    expect(fn).toMatch(/let name = '', selfChar = '', targetId = null;/);
  });

  it('selects the column it filters on', () => {
    expect(fn).toContain('is_charm_spell,target_id');
  });

  it('applies the filter beside the zone filter', () => {
    expect(fn).toContain('if (!_idScopeKeep(targetId, r.target_id)) continue;');
  });

  // ⚠ Without the id in the cache key, two raiders targeting DIFFERENT
  // same-name mobs in one zone share a cached list and the cache silently
  // undoes the filter — the bug would look fixed in code and not on screen.
  it('keys the relay cache by the spawn id too', () => {
    const key = sliceBlock(fn, '  const cacheKey =', ';');
    expect(key).toMatch(/targetId/);
  });

  it('the ingest persists the id, bounded to an integer', () => {
    expect(bot).toContain('target_id:    Number.isFinite(Number(c.target_id)) ? Math.trunc(Number(c.target_id)) : null,');
  });
});

// ── target-casts: spawn id first, name second (Hitya 2026-09-02) ────────────
//
// ⚠ mob-info is deliberately NOT scoped this way and that is not an omission.
// It returns catalog rows from eqemu_npc_types — HP, AC, resists, loot for the
// NPC TYPE. Every spawn of "a cliff golem" in a zone shares that row, so a
// spawn-id key there would fragment a cache for zero benefit. Zone is the right
// granularity for it and it already has that.
describe('target-casts is spawn-scoped too', () => {
  const bot = stripJs(readSource(BOT_INDEX));
  const fn  = sliceBlock(bot, 'async function _handleAgentTargetCasts(', '\nasync function ');

  it('reads the requester id and fails open when absent', () => {
    expect(fn).toContain("sp.get('target_id')");
    expect(fn).toMatch(/let name = '', selfChar = '', targetId = null;/);
  });

  it('applies the id filter after the zone filter, not instead of it', () => {
    // 2026-09-02: the zone filter now goes through _zoneScopeKeepForName, which
    // relaxes ONLY the unknown-observer case for a name that exists in one zone
    // (see test/target-info-zone-scope.test.js). The ORDER is what this asserts,
    // and it still has to hold.
    const zoneAt = fn.indexOf('_zoneScopeKeepForName(requesterZone, casterZone');
    const idAt   = fn.indexOf('_idScopeKeep(targetId, c.target_id)');
    expect(zoneAt).toBeGreaterThan(-1);
    expect(idAt).toBeGreaterThan(zoneAt);
  });

  it('stores the spawn id the caster was on', () => {
    expect(bot).toContain('target_id: Number.isFinite(Number(c.target_id)) ? Math.trunc(Number(c.target_id)) : null,');
  });

  it('uses the SAME predicate as the buffs relay, not a second copy', () => {
    // One predicate means one null rule. Two would drift, and the null rule is
    // the part that empties the board if it drifts the wrong way.
    const uses = (bot.match(/_idScopeKeep\(/g) || []).length;
    expect(uses).toBeGreaterThanOrEqual(3);   // definition + buffs + casts
    expect((bot.match(/function _idScopeKeep/g) || []).length).toBe(1);
  });
});
