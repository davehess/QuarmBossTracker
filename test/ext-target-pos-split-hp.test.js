// Extended Target: a position-split row never inherits a sibling's health.
//
// The guild lead, 2026-10-21, mid-raid, a boss's 50% split: four rows of one name, each with its own spawn id,
// tags and attackers, every row at 85% while the game's own target window said 78%. Four engaged tanks standing
// apart split one HP band into four rows (position clustering); each split row is a copy of the band, median
// included, and only a row with a raider who reported a health got its own. The others kept the band's median, so
// a mob nobody on its row had a reading for showed a health that belonged to another mob.
//
// These run the real functions sliced from the bot. Names in the fixtures are invented, per the repo's
// public-docs convention.
//
// Run: npx vitest run test/ext-target-pos-split-hp.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, stripJs, BOT_INDEX } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const { _extPosCluster, _extBindInstances, _extPosSplitOwnHp, _extHeadingPoint } = evalBlock(
  sliceBlock(src, 'function _extHeadingPoint(m, reach, scale) {', '\n}') + '\n'
  + sliceBlock(src, 'function _extPosCluster(engaged, units, hOpts) {', '\n}') + '\n'
  + sliceBlock(src, 'function _extBindInstances(hpClusters, posInstances) {', '\n}') + '\n'
  + sliceBlock(src, 'function _extPosSplitOwnHp(rows, hpOfRaider) {', '\n}'),
  ['_extPosCluster', '_extBindInstances', '_extPosSplitOwnHp', '_extHeadingPoint'],
);
void _extHeadingPoint;

const hpMap = (pairs) => new Map(pairs.map(([r, hp]) => [r.toLowerCase(), hp]));
const tanks = ['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan'];
const engaged = tanks.map((n, i) => ({ raider: n, tank: n, x: i * 200, y: 0, z: 0 }));
const bandOf = (raiders) => [{ raiders, hp: 85 }];   // one HP band, the merged median

describe('four tanks apart split one HP band into four rows', () => {
  const split = () => _extBindInstances(bandOf(tanks), _extPosCluster(engaged, 25, { mode: 0 }));

  it('the precondition: four split rows, all carrying the band median', () => {
    const rows = split();
    expect(rows).toHaveLength(4);
    expect(rows.every(r => r.pos_split && r.hp === 85)).toBe(true);
  });
  it('only the row with a reporter of its own shows a health; the rest show none', () => {
    const rows = split();
    _extPosSplitOwnHp(rows, hpMap([['Corvale', 78]]));   // one Mimic user on the third tank
    const byTank = Object.fromEntries(rows.map(r => [r.raiders[0], r.hp]));
    expect(byTank).toEqual({ Aldenmar: null, Brackwyn: null, Corvale: 78, Rethlan: null });
  });
  it('rows whose raiders each reported keep their own, distinct healths', () => {
    const rows = split();
    _extPosSplitOwnHp(rows, hpMap([['Aldenmar', 85], ['Brackwyn', 80], ['Corvale', 78], ['Rethlan', 85]]));
    expect(rows.map(r => r.hp).sort((a, b) => a - b)).toEqual([78, 80, 85, 85]);
  });
  it('a row with several reporters takes their median', () => {
    const rows = _extBindInstances(bandOf([...tanks, 'Zarrin']), _extPosCluster(engaged, 25, { mode: 0 }));
    // Zarrin is unplaceable (no engagement), so she rides the first split; two reporters there
    _extPosSplitOwnHp(rows, hpMap([['Aldenmar', 70], ['Zarrin', 80]]));
    expect(rows[0].hp).toBe(75);
    expect(rows.slice(1).every(r => r.hp === null)).toBe(true);
  });
  it('a row that is not a position split is left exactly as it is', () => {
    const rows = [{ raiders: ['Aldenmar'], hp: 85 }, { raiders: ['Brackwyn'], hp: null }];
    _extPosSplitOwnHp(rows, hpMap([]));
    expect(rows.map(r => r.hp)).toEqual([85, null]);
  });
});

describe('the handler applies it', () => {
  const clean = stripJs(src);
  it('calls the helper on the bound rows, and the old keep-the-median loop is gone', () => {
    expect(clean).toContain('_extPosSplitOwnHp(rows, hpOfRaider);');
    expect(clean).not.toMatch(/if \(hps\.length\) c\.hp = median\(hps\);/);
  });
});
