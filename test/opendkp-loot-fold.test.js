// test/opendkp-loot-fold.test.js — the OpenDKP awards that never reached the
// Loot tab.
//
// `opendkp_loot` mirrors itself automatically. `loot_observations` — what Mob
// Info reads for "N× won" — was written ONLY by an officer typing
// /backfillopendkploot. Somebody last ran it 2026-06-04, so by 2026-08-14 the
// Loot tab was missing 758 awards across 28 raids: Kazmodon won Silver Band of
// Secrets at raid 98561 for 150 DKP and the item still read as never dropped
// (Hitya: "are we missing rows of loot drops?").
//
// The half worth testing hardest is the ID reconciliation. OpenDKP carries two
// ids per award and they are NOT interchangeable — measured over the 283 rows
// where they disagree, `item_id` matched the item's real catalog name 0 times
// and `game_item_id` matched 13. /backfillopendkploot prefers ItemId, so it has
// been attributing those to whatever item happened to hold that catalog id.
//
// Run: npx vitest run test/opendkp-loot-fold.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const { resolveCatalogItemId, dedupByConflictKey } =
  require(path.join(ROOT, 'utils', 'openDkpSync.js'));

// nameById: catalog id → lowercased name. idByName: lowercased name → id,
// present only when that name is unambiguous in the catalog.
const nameById = new Map([
  [28993, 'silver band of secrets'],
  [26781, 'wristband of secrets'],
  [77777, 'some unrelated dagger'],
]);
const idByName = new Map([
  ['silver band of secrets', 28993],
  ['wristband of secrets', 26781],
]);
const R = (game_item_id, item_id, item_name) => ({ game_item_id, item_id, item_name });

describe('picking the right catalog id', () => {
  it('prefers game_item_id when the two disagree', () => {
    // The real shape of the 283 disagreeing rows: item_id is OpenDKP's own row
    // id and lands on some unrelated catalog entry.
    expect(resolveCatalogItemId(R(28993, 77777, 'Silver Band of Secrets'), nameById, idByName))
      .toBe(28993);
  });

  it('does not take an id whose catalog name contradicts the award', () => {
    // Even when only item_id resolves, a name that disagrees is evidence the id
    // is not this item — fall through to the name lookup instead.
    expect(resolveCatalogItemId(R(null, 77777, 'Silver Band of Secrets'), nameById, idByName))
      .toBe(28993);
  });

  it('uses the name when neither id resolves', () => {
    expect(resolveCatalogItemId(R(999999, 888888, 'Wristband of Secrets'), nameById, idByName))
      .toBe(26781);
  });

  it('matches names case- and space-insensitively', () => {
    expect(resolveCatalogItemId(R(null, null, '  SILVER BAND OF SECRETS  '), nameById, idByName))
      .toBe(28993);
  });

  it('agrees with itself in the ordinary case', () => {
    expect(resolveCatalogItemId(R(26781, 26781, 'Wristband of Secrets'), nameById, idByName))
      .toBe(26781);
  });

  it('keeps the id for the record when nothing resolves', () => {
    // A spell scroll or a Quarm-custom item the weekly catalog sync missed.
    // Better to write the row as source=opendkp_unknown than to drop the award.
    expect(resolveCatalogItemId(R(123456, 654321, 'Some Custom Thing'), nameById, idByName))
      .toBe(123456);
  });

  it('returns null rather than inventing an id', () => {
    expect(resolveCatalogItemId(R(null, null, 'Nothing We Know'), nameById, idByName)).toBeNull();
    expect(resolveCatalogItemId(R(0, -1, 'Nothing We Know'), nameById, idByName)).toBeNull();
  });

  it('will not resolve a name that is ambiguous in the catalog', () => {
    // idByName deliberately omits duplicated names; guessing one of them would
    // put a win count on the wrong mob's Loot tab.
    const ambiguous = new Map(idByName);            // 'shade summoning figurine' has two ids
    expect(resolveCatalogItemId(R(null, null, 'Shade Summoning Figurine'), nameById, ambiguous))
      .toBeNull();
  });
});

describe('one award is one row', () => {
  const key = ['source', 'raid_id', 'item_id', 'winner_character', 'dkp_amount'];
  const row = (over = {}) => ({
    source: 'opendkp', raid_id: 98561, item_id: 28993,
    winner_character: 'Kazmodon', dkp_amount: 150, ...over,
  });

  it('collapses an exact duplicate inside one raid', () => {
    const { rows } = dedupByConflictKey([row(), row()], key, { nullsNotDistinct: true });
    expect(rows).toHaveLength(1);
  });

  it('keeps two different winners of the same item', () => {
    // Two of the same drop in one raid is real and both are wins.
    const { rows } = dedupByConflictKey([row(), row({ winner_character: 'Uppers' })], key, { nullsNotDistinct: true });
    expect(rows).toHaveLength(2);
  });

  it('keeps the same winner at a different price', () => {
    const { rows } = dedupByConflictKey([row(), row({ dkp_amount: 200 })], key, { nullsNotDistinct: true });
    expect(rows).toHaveLength(2);
  });

  it('keeps the same award across different raids', () => {
    const { rows } = dedupByConflictKey([row(), row({ raid_id: 98999 })], key, { nullsNotDistinct: true });
    expect(rows).toHaveLength(2);
  });

  it('collapses unresolved items too, instead of writing one row per pass', () => {
    // item_id null must not read as "every row is distinct" — that is exactly
    // what nullsNotDistinct is for.
    const u = { source: 'opendkp_unknown', raid_id: 98561, item_id: null,
                winner_character: 'Kazmodon', dkp_amount: 150 };
    const { rows } = dedupByConflictKey([u, { ...u }], key, { nullsNotDistinct: true });
    expect(rows).toHaveLength(1);
  });
});

describe('the fold is wired into the sync', () => {
  const src = require('node:fs').readFileSync(path.join(ROOT, 'utils', 'openDkpSync.js'), 'utf8');

  it('runs at the end of runSync', () => {
    expect(src).toMatch(/await foldLootObservations\(\{ dryRun: !!opts\.dryRun \}\)/);
  });

  it('runs AFTER reconcile, so it cannot copy a row that is about to be deleted', () => {
    expect(src.indexOf('const reconcileResult')).toBeLessThan(src.indexOf('const lootFoldResult'));
  });

  it('fails open — a broken fold must never fail an OpenDKP sync', () => {
    expect(src).toMatch(/foldLootObservations\([^)]*\)\.catch\(/);
  });

  it('only ever folds raids that are not already in loot_observations', () => {
    expect(src).toMatch(/foldedRaids\.has\(r\.raid_id\)/);
  });

  it('stamps posted_at from the raid, not from now', () => {
    // Using now() would pile every backfilled award into one bogus instant and
    // break any date-scoped read of the table.
    expect(src).toMatch(/posted_at:\s+tsByRaid\.get\(a\.raid_id\)/);
  });
});
