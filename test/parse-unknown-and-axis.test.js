// test/parse-unknown-and-axis.test.js — the parse page's two 2026-10-26 reports (a foreign-guild wipe).
//
//   1. "The Unknowns here aren't actually unknown": the OpenDKP mirror stores the literal strings 'UNKNOWN' / 'Unknown'
//      for a toon nobody registered. Those were treated as a class, so they (a) stopped the /who lookup from running
//      for that player and (b) made a bucket beside the null fallback's own 'Unknown' — two "unknown" bars, one real.
//   2. "Why is the parse half the distance on the timeline?": the x-axis was the fight RECORD (390s) while damage ended
//      at 220s, so the stack and the HP line filled the left 56% of the chart.
//
// Behaviour, not text: every assertion runs the shipped functions. Names are invented.
//
// Run: npx vitest run test/parse-unknown-and-axis.test.js

import { describe, it, expect } from 'vitest';
import { realClass, resolveClasses, classBucket, CLASS_NOT_KNOWN } from '../web/lib/parseClasses.ts';
import { groupSeriesByClass, fitAxis, buildFightCurve } from '../web/lib/fightCurve.ts';

const loader = (table, calls) => async (missing) => {
  calls.push([...missing]);
  return new Map(Object.entries(table));
};

describe('realClass — a sentinel is no answer', () => {
  it('rejects every spelling a source uses for "I do not know"', () => {
    for (const s of ['UNKNOWN', 'Unknown', 'unknown', ' unk ', '', '  ', '?', '—', null, undefined, 42]) {
      expect(realClass(s)).toBeNull();
    }
  });

  it('keeps a real class, and folds a /who level title and a case variant to the one base class', () => {
    expect(realClass('Ranger')).toBe('Ranger');
    expect(realClass('RANGER')).toBe('Ranger');
    expect(realClass('shadowknight')).toBe('Shadow Knight');
    expect(realClass('Grave Lord')).toBe('Shadow Knight');
  });
});

describe('resolveClasses — strongest source first, each asked only what is left', () => {
  const names = ['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan'];

  it('takes the first source that has a real class and never overrides it with a later one', async () => {
    const calls = [];
    const got = await resolveClasses(names, [
      loader({ aldenmar: 'Wizard' }, calls),
      loader({ aldenmar: 'Cleric', brackwyn: 'Monk' }, calls),
    ]);
    expect(got.get('aldenmar')).toBe('Wizard');
    expect(got.get('brackwyn')).toBe('Monk');
  });

  it('a sentinel in an earlier source does NOT stop a later source (the bug: "UNKNOWN" blocked /who)', async () => {
    const calls = [];
    const got = await resolveClasses(names, [
      loader({ corvale: 'UNKNOWN', rethlan: 'Unknown' }, calls),
      loader({ corvale: 'Bard', rethlan: 'Rogue' }, calls),
    ]);
    expect(got.get('corvale')).toBe('Bard');
    expect(got.get('rethlan')).toBe('Rogue');
  });

  it('each later source is asked ONLY about the names still unresolved (reads stay small)', async () => {
    const calls = [];
    await resolveClasses(names, [
      loader({ aldenmar: 'Wizard', brackwyn: 'UNKNOWN' }, calls),
      loader({ corvale: 'Druid' }, calls),
      loader({}, calls),
    ]);
    expect(calls[0]).toEqual(names);
    expect(calls[1].sort()).toEqual(['Brackwyn', 'Corvale', 'Rethlan']);
    expect(calls[2].sort()).toEqual(['Brackwyn', 'Rethlan']);
  });

  it('stops reading once everyone is placed — no wasted query for a source that is not needed', async () => {
    const calls = [];
    await resolveClasses(['Aldenmar'], [loader({ aldenmar: 'Wizard' }, calls), loader({}, calls)]);
    expect(calls).toHaveLength(1);
  });

  it('a source that throws knows nothing; the cascade carries on', async () => {
    const got = await resolveClasses(names, [
      async () => { throw new Error('rpc missing'); },
      loader({ aldenmar: 'Paladin' }, []),
    ]);
    expect(got.get('aldenmar')).toBe('Paladin');
  });

  it('leaves a name no source resolves ABSENT (so the page can bucket it as not known)', async () => {
    const got = await resolveClasses(names, [loader({ aldenmar: 'UNKNOWN' }, [])]);
    expect(got.has('aldenmar')).toBe(false);
  });
});

describe('one unknown bucket', () => {
  it('classBucket sends null and every sentinel spelling to the same label', () => {
    expect(new Set([null, undefined, 'UNKNOWN', 'Unknown', ''].map(classBucket)))
      .toEqual(new Set([CLASS_NOT_KNOWN]));
    expect(classBucket('Wizard')).toBe('Wizard');
  });

  it('the damage chart merges a null-class player and a sentinel-class player into ONE group', () => {
    const series = [
      { name: 'Aldenmar', total: 500, cum: [100, 500] },
      { name: 'Brackwyn', total: 300, cum: [100, 300] },
      { name: 'Corvale', total: 200, cum: [50, 200] },
    ];
    const groups = groupSeriesByClass(series, { Aldenmar: 'UNKNOWN', Brackwyn: null, Corvale: 'Wizard' });
    const labels = groups.map(g => g.klass).sort();
    expect(labels).toEqual([CLASS_NOT_KNOWN, 'Wizard'].sort());
    const unk = groups.find(g => g.klass === CLASS_NOT_KNOWN);
    expect(unk.total).toBe(800);
    expect(unk.members.map(m => m.name).sort()).toEqual(['Aldenmar', 'Brackwyn']);
  });
});

describe('fitAxis — the axis ends where the data does', () => {
  // Damage in the first 215s (last bucket starts at 215 and ends at 220), then a 390s record.
  const rows = [];
  for (let t = 0; t <= 215; t += 5) rows.push({ t_sec: t, char_name: 'Aldenmar', pet_owner: null, dmg_delta: 100, took_delta: t <= 150 ? 50 : 0 });
  const curve = buildFightCurve(rows, 5);

  it('a wipe whose record outlasts the damage fits to the last damage bucket plus a small pad, and reports the tail', () => {
    const f = fitAxis(curve.buckets, curve.bands, curve.mt, 390);
    expect(f.spanSec).toBeGreaterThanOrEqual(220);
    expect(f.spanSec).toBeLessThanOrEqual(230);
    expect(f.tailSec).toBe(390 - f.spanSec);
    expect(f.showTail).toBe(true);
  });

  it('never clips data: a record SHORTER than the data (or missing) yields the data extent', () => {
    expect(fitAxis(curve.buckets, curve.bands, curve.mt, 100).spanSec).toBeGreaterThanOrEqual(220);
    expect(fitAxis(curve.buckets, curve.bands, curve.mt, null).spanSec).toBeGreaterThanOrEqual(220);
    expect(fitAxis(curve.buckets, curve.bands, curve.mt, 100).showTail).toBe(false);
  });

  it('a record that ends right after the damage is left alone and shows no tail note', () => {
    const f = fitAxis(curve.buckets, curve.bands, curve.mt, 222);
    expect(f.spanSec).toBe(222);
    expect(f.showTail).toBe(false);
  });

  it('the tanking strip counts as data: a late tanking segment extends the axis past the last damage', () => {
    const f = fitAxis(curve.buckets, curve.bands, [{ fromSec: 200, toSec: 300, name: 'Brackwyn', took: 10 }], 390);
    expect(f.spanSec).toBeGreaterThanOrEqual(300);
  });

  it('a lull in the middle does not end the axis early — only the LAST growth counts', () => {
    const gap = [];
    for (const t of [0, 5, 100, 105]) gap.push({ t_sec: t, char_name: 'Aldenmar', pet_owner: null, dmg_delta: 10, took_delta: 0 });
    const c = buildFightCurve(gap, 5);
    expect(fitAxis(c.buckets, c.bands, c.mt, 300).spanSec).toBeGreaterThanOrEqual(110);
  });

  it('no data at all falls back to the record length', () => {
    expect(fitAxis([], [], [], 120)).toEqual({ spanSec: 120, tailSec: 0, showTail: false });
  });
});
