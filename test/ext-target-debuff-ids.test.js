// test/ext-target-debuff-ids.test.js — Extended Target puts a debuff on the mob its spawn id names.
//
// FB-39 (the guild lead, 2026-09-30): "You can see the spawnids are varied and the buffs should have
// been associated but they weren't, even though both of us were using miMIC." Two mobs of one name,
// rows split by spawn id, and the debuffs still came from a NAME-keyed map: one entry per spell (the
// newest landing), placed by guessing from the observer's current target. The landing's own
// buff_casts.target_id was never selected.
//
// Names below are invented; the mob name is the game's own.
//
// Run: npx vitest run test/ext-target-debuff-ids.test.js

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, evalBlock, stripJs } from './_source-slice.js';

const src = readSource(BOT_INDEX);
const { _extDebuffInstances, _extAttributeDebuffs } = evalBlock(
  sliceBlock(src, 'function _extDebuffInstances(landings) {', '\n  return out;\n}') + '\n'
  + sliceBlock(src, 'function _extAttributeDebuffs(debuffEntries, rows, observerInfo, hpTol, spawnOfRaider) {', '\n}'),
  ['_extDebuffInstances', '_extAttributeDebuffs'],
);

const T0 = 1_790_000_000_000;
const land = (spell, secAgo, observer, sid) => ({ spell, castMs: T0 - secAgo * 1000, durSecs: 180, observer, sid: sid == null ? null : sid });

describe('_extDebuffInstances — one entry per spell per mob', () => {
  it('one cast seen by two Mimics is one entry; the Mimic that knew the id names the mob', () => {
    // The FB-39 shape: the caster's Mimic stamps 1329, the bystander's sends no id.
    const e = _extDebuffInstances([land("Sha's Advantage", 10, 'Brackwyn', 1329), land("Sha's Advantage", 11, 'Aldenmar', null)]);
    expect(e).toHaveLength(1);
    expect(e[0].spawn_id).toBe(1329);
    expect(e[0].observers).toEqual(['Brackwyn', 'Aldenmar']);
  });
  it('the same spell on two mobs of one name stays two entries (the name map kept only the newest)', () => {
    const e = _extDebuffInstances([land("Sha's Advantage", 10, 'Brackwyn', 1329), land("Sha's Advantage", 90, 'Brackwyn', 1296)]);
    expect(e.map(x => x.spawn_id)).toEqual([1329, 1296]);
  });
  it('two Mimics naming different ids for one cast: neither is trusted', () => {
    // A bystander's Mimic stamps its OWN target's id whenever the name matches.
    const e = _extDebuffInstances([land('Tashania', 5, 'Brackwyn', 1329), land('Tashania', 6, 'Aldenmar', 1296)]);
    expect(e).toHaveLength(1);
    expect(e[0].spawn_id).toBeNull();
  });
  it('newest cast per spell per mob; an older cast with no id is not repeated beside one with an id', () => {
    const e = _extDebuffInstances([
      land('Tashania', 5, 'Brackwyn', 1329),
      land('Tashania', 60, 'Brackwyn', 1329),
      land('Tashania', 120, 'Aldenmar', null),
    ]);
    expect(e).toHaveLength(1);
    expect(e[0].castMs).toBe(T0 - 5000);
  });
  it('with no ids anywhere it is the old rule: newest landing per spell', () => {
    const e = _extDebuffInstances([land('Tashania', 5, 'Aldenmar', null), land('Tashania', 60, 'Brackwyn', null), land('Malosini', 7, 'Aldenmar', null)]);
    expect(e.map(x => [x.name, x.spawn_id])).toEqual([['Tashania', null], ['Malosini', null]]);
  });
  it('survives nothing', () => {
    expect(_extDebuffInstances(undefined)).toEqual([]);
    expect(_extDebuffInstances([])).toEqual([]);
  });
});

describe('_extAttributeDebuffs — a spawn id places the debuff first', () => {
  // Two froglok krup shamans, each targeted by one of the pair; rows as _extIdInstances builds them.
  const rows = () => ([
    { raiders: ['Brackwyn'], hp: 40, spawn_id: 1296, id_proven: true },
    { raiders: ['Aldenmar'], hp: 90, spawn_id: 1329, id_proven: true },
  ]);
  const spawnOf = new Map([['brackwyn', 1296], ['aldenmar', 1329]]);

  it('each debuff lands on its own mob, even when the observer targets the other one', () => {
    const r = rows();
    // Aldenmar targets 1329 at 90%; under the old rules this landing went to Aldenmar's row.
    const info = new Map([['aldenmar', { targetsName: true, targetHp: 90 }]]);
    _extAttributeDebuffs([{ name: "Sha's Advantage", remaining_secs: 150, observers: ['Aldenmar'], spawn_id: 1296 }], r, info, 8, spawnOf);
    expect(r[0].debuffs).toEqual([{ name: "Sha's Advantage", remaining_secs: 150 }]);
    expect(r[1].debuffs).toEqual([]);
  });
  it('a row\'s id can come from its targeters when the row itself carries none', () => {
    const r = [{ raiders: ['Brackwyn'], hp: 40 }, { raiders: ['Aldenmar'], hp: 90 }];
    _extAttributeDebuffs([{ name: 'Tashania', remaining_secs: 90, observers: [], spawn_id: 1329 }], r, new Map(), 8, spawnOf);
    expect(r[1].debuffs.map(d => d.name)).toEqual(['Tashania']);
    expect(r[0].debuffs).toEqual([]);
  });
  it('an id no row has, when every row has one, is another mob: not shown here', () => {
    const r = rows();
    _extAttributeDebuffs([{ name: 'Tashania', remaining_secs: 90, observers: ['Aldenmar'], spawn_id: 1400 }], r, new Map(), 8, spawnOf);
    expect(r[0].debuffs).toEqual([]);
    expect(r[1].debuffs).toEqual([]);
  });
  it('no id: the old rules, unchanged (dimmed on every row when nothing places it)', () => {
    const r = rows();
    _extAttributeDebuffs([{ name: 'Malosini', remaining_secs: 90, observers: ['Bystander'], spawn_id: null }], r, new Map(), 8, spawnOf);
    for (const row of r) expect(row.debuffs).toEqual([{ name: 'Malosini', remaining_secs: 90, attributed: false }]);
  });
  it('K=1 is untouched', () => {
    const r = [{ raiders: ['Aldenmar'], hp: 90, spawn_id: 1329, debuffs: [{ name: 'Tashania' }] }];
    _extAttributeDebuffs([{ name: 'X', observers: [], spawn_id: 1329 }], r, new Map(), 8, spawnOf);
    expect(r[0].debuffs).toEqual([{ name: 'Tashania' }]);
  });
});

describe('wiring (comment-stripped source)', () => {
  const clean = stripJs(src);
  it('the landing\'s spawn id is selected, zone-checked, and reaches the attribution', () => {
    expect(clean).toContain('&select=target,target_id,spell_name,dur_ticks,cast_at,observer,is_charm_spell');
    expect(clean).toMatch(/const sid = \(Number\(b\.target_id\) > 0 && !\(scopeZone && obsZone && obsZone !== scopeZone\)\) \? Number\(b\.target_id\) : null;/);
    expect(clean).toContain('return _extDebuffInstances(landingsByTarget.get(key)).map(d => ({');
    expect(clean).toContain('_extAttributeDebuffs(debuffEntriesFor(g.key), rows, observerInfo, extHpSplitTol, spawnOfRaider);');
  });
  it('K=1 still reads the name map, so a single mob\'s row is unchanged', () => {
    expect(clean).toContain('debuffs: multi ? (c.debuffs || []) : debuffs,');
    expect(clean).toContain('const debuffs = debuffsFor(g.key);');
  });
});
