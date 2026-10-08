// Extended Target: spawn ids overrule the position/HP guesses in the MERGE
// direction too.
//
// A member's overlay (2026-09-23) showed one mob as three rows —
// "A Shissar Taskmaster * #1/3, #2/3, #3/3", one targeter per row, all at 14%,
// all hitting the same tank. The asterisk (not a "#<spawn id>") proves ids did
// not split it; three engaged tanks standing apart did, via position
// clustering. Every targeter's Zeal was streaming ids, and an id that all of
// them agree on is proof of ONE mob — which the pipeline threw away, because
// ids were only ever consulted to SPLIT.
//
// These run the real functions sliced from the bot. Names in the fixtures are
// invented, per the repo's public-docs convention.
//
// Run: npx vitest run test/ext-target-agreed-id.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, stripJs, BOT_INDEX } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const { _extPosCluster, _extBindInstances, _extMergeByAgreedId, _extHeadingPoint } = evalBlock(
  sliceBlock(src, 'function _extHeadingPoint(m, reach, scale) {', '\n}') + '\n'
  + sliceBlock(src, 'function _extPosCluster(engaged, units, hOpts) {', '\n}') + '\n'
  + sliceBlock(src, 'function _extBindInstances(hpClusters, posInstances) {', '\n}') + '\n'
  + sliceBlock(src, 'function _extMergeByAgreedId(rows, idOf, hpOf) {', '\n}'),
  ['_extPosCluster', '_extBindInstances', '_extMergeByAgreedId', '_extHeadingPoint'],
);
void _extHeadingPoint;

const ZONE = 'Ssraeshza Temple';
const idMap = (pairs) => new Map(pairs.map(([r, id]) => [r.toLowerCase(), id == null ? null : `${ZONE}|${id}`]).filter(([, v]) => v != null));
const hpMap = (pairs) => new Map(pairs.map(([r, hp]) => [r.toLowerCase(), hp]));

describe('the reported shape: one mob, split three ways by position', () => {
  // Three targeters, one HP band, each also "engaged" far from the others.
  const cluster = [{ raiders: ['Aldenmar', 'Brackwyn', 'Corvale'], hp: 14 }];
  const engaged = [
    { raider: 'Aldenmar', tank: 'Aldenmar', x: 0,   y: 0, z: 0 },
    { raider: 'Brackwyn', tank: 'Brackwyn', x: 200, y: 0, z: 0 },
    { raider: 'Corvale',  tank: 'Corvale',  x: 400, y: 0, z: 0 },
  ];
  const pos = _extPosCluster(engaged, 25, { mode: 0 });
  const split = _extBindInstances(cluster, pos);
  const hp = hpMap([['Aldenmar', 14], ['Brackwyn', 14], ['Corvale', 14]]);

  it('position clustering alone still makes three rows (the precondition)', () => {
    expect(split).toHaveLength(3);
  });
  it('all three reporting the SAME spawn id → one row', () => {
    const rows = _extMergeByAgreedId(split, idMap([['Aldenmar', 3824], ['Brackwyn', 3824], ['Corvale', 3824]]), hp);
    expect(rows).toHaveLength(1);
    expect(rows[0].raiders.sort()).toEqual(['Aldenmar', 'Brackwyn', 'Corvale']);
    expect(rows[0].hp).toBe(14);
    expect(rows[0].pos_split).toBeUndefined();
  });
  it('one raider on an old Zeal (no id) stays where position put them', () => {
    const rows = _extMergeByAgreedId(split, idMap([['Aldenmar', 3824], ['Brackwyn', 3824], ['Corvale', null]]), hp);
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.raiders.sort().join(','))).toEqual(['Aldenmar,Brackwyn', 'Corvale']);
  });
});

describe('the extended-target handler actually applies the merge', () => {
  // The handler is too entangled to run whole, so this is a text check —
  // against comment-STRIPPED source, so this file's own explanations and the
  // bot's cannot satisfy it (CLAUDE.md, "comments satisfy text assertions").
  const clean = stripJs(src);
  it('merges after binding, keyed on the zone-scoped ids of this name', () => {
    expect(clean).toContain('rows = _extMergeByAgreedId(rows, idOfRaider, hpOfRaider);');
    expect(clean).toMatch(/const idOfRaider = new Map\(g\.obs\.filter\(o => o\.id != null\)/);
  });
});

describe('_extMergeByAgreedId — only ids that agree merge', () => {
  const r = (raiders, hp, extra = {}) => ({ raiders, hp, ...extra });

  it('different ids stay separate rows', () => {
    const rows = [r(['Aldenmar'], 40), r(['Brackwyn'], 90)];
    const out = _extMergeByAgreedId(rows, idMap([['Aldenmar', 11], ['Brackwyn', 22]]), hpMap([]));
    expect(out).toBe(rows);
  });
  it('no ids at all → the very same array (fleet without ids unchanged)', () => {
    const rows = [r(['Aldenmar'], 40), r(['Brackwyn'], 40)];
    expect(_extMergeByAgreedId(rows, new Map(), hpMap([]))).toBe(rows);
  });
  it('a single row is returned untouched', () => {
    const rows = [r(['Aldenmar'], 40)];
    expect(_extMergeByAgreedId(rows, idMap([['Aldenmar', 11]]), hpMap([]))).toBe(rows);
  });
  it('merges transitively and keeps the untouched row in place', () => {
    const rows = [r(['Aldenmar'], 50), r(['Nyssara'], 90), r(['Brackwyn'], 52)];
    const out = _extMergeByAgreedId(rows,
      idMap([['Aldenmar', 7], ['Brackwyn', 7], ['Nyssara', 9]]),
      hpMap([['Aldenmar', 50], ['Brackwyn', 52], ['Nyssara', 90]]));
    expect(out).toHaveLength(2);
    expect(out[0].raiders).toEqual(['Aldenmar', 'Brackwyn']);
    expect(out[0].hp).toBe(51);
    expect(out[1].raiders).toEqual(['Nyssara']);
  });
  it('unions the tank labels of the merged rows', () => {
    const rows = [r(['Aldenmar'], 14, { tanks: ['Rethlan'], pos_split: true }),
                  r(['Brackwyn'], 14, { tanks: ['Zarrin'],  pos_split: true })];
    const out = _extMergeByAgreedId(rows, idMap([['Aldenmar', 5], ['Brackwyn', 5]]), hpMap([]));
    expect(out).toHaveLength(1);
    expect(out[0].tanks).toEqual(['Rethlan', 'Zarrin']);
  });
});
