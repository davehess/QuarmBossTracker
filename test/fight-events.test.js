// test/fight-events.test.js — the fight event-log assembly, pinned to the
// three measured problems on /parses/d951b081 (2026-08-16, Hitya's review):
// the 0:00 wall (67 pre-start events clamped), the Too Far family shown as
// callouts, and "(copy)" duplicates + alternating rampage targets defeating
// the fold.
//
// Run: npx vitest run test/fight-events.test.js

import { describe, it, expect } from 'vitest';
import { buildEventLog, foldEvents, isNoiseCallout, normalizeLabel, offsetLabel }
  from '../web/lib/fightEvents.ts';

const ev = (atMs, label, kind = 'raid_event', detail = null) => ({ atMs, kind, label, detail });

describe('noise filter — the too far / can-not-see family', () => {
  it('drops the family, including (copy) clones, case-insensitively', () => {
    for (const l of ['Too Far', 'too far', 'Too Far (copy)', 'Can Not See', 'Cannot See',
                     'Can Not Hit From Here', 'Out of Range', 'Range', 'Range (copy)']) {
      expect(isNoiseCallout(l), l).toBe(true);
    }
  });
  it('does NOT drop real callouts that merely contain a noise word', () => {
    for (const l of ['Melee out', 'Enrage (Begin)', 'Shaman Slow landed', 'Ranger down']) {
      expect(isNoiseCallout(l), l).toBe(false);
    }
  });
  it('only FIRES are filtered — a raid_event never is', () => {
    const log = buildEventLog([
      ev(1000, 'Too Far', 'fire'),
      ev(1000, 'Range', 'raid_event'),   // hypothetical — kind wins
    ], 0);
    expect(log.noiseHidden).toBe(1);
    expect(log.main).toHaveLength(1);
    expect(log.main[0].kind).toBe('raid_event');
  });
});

describe('normalizeLabel — (copy) clones fold into the original', () => {
  it('strips one or more (copy) suffixes', () => {
    expect(normalizeLabel('Enrage (Begin) (copy)')).toBe('Enrage (Begin)');
    expect(normalizeLabel('Enrage (Begin) (copy) (copy)')).toBe('Enrage (Begin)');
    expect(normalizeLabel('Enrage (Begin)')).toBe('Enrage (Begin)');
  });
  it('a fire and its (copy) clone at the same moment become ONE ×2 row', () => {
    const rows = foldEvents([ev(1000, 'Enrage (Begin)', 'fire'), ev(1200, 'Enrage (Begin) (copy)', 'fire')]);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
  });
});

describe('windowed fold — alternation does not defeat it', () => {
  it('alternating rampage targets fold per-target, not per-run', () => {
    // → Moash / → Timberowl / → Moash / → Timberowl … every 10s. Consecutive
    // folding produced one row per event; windowed folding gives two rows.
    const rows = [];
    for (let i = 0; i < 10; i++) {
      rows.push(ev(i * 10_000, `RAMPAGE → ${i % 2 ? 'Timberowl' : 'Moash'}`));
    }
    const folded = foldEvents(rows, 45_000);
    expect(folded).toHaveLength(2);
    expect(folded.map(r => r.count)).toEqual([5, 5]);
    expect(folded[0].t).toBeLessThan(folded[1].t);
  });
  it('a gap past the window starts a NEW row — a second wave is a second story', () => {
    const folded = foldEvents([ev(0, 'RAMPAGE → Moash'), ev(10_000, 'RAMPAGE → Moash'),
                               ev(120_000, 'RAMPAGE → Moash')], 45_000);
    expect(folded).toHaveLength(2);
    expect(folded[0].count).toBe(2);
    expect(folded[1].t).toBe(120_000);
  });
  it('different detail (actor) stays a separate row even with one label', () => {
    const folded = foldEvents([
      ev(0, 'ENRAGED', 'raid_event', 'a restless burrower'),
      ev(1000, 'ENRAGED', 'raid_event', 'a summoned burrower'),
    ]);
    expect(folded).toHaveLength(2);
  });
});

describe('pre-start events — the 0:00 wall (67 of 126 on d951b081)', () => {
  const START = 1_000_000;
  it('events before started_at land in `early`, not clamped into main', () => {
    const log = buildEventLog([
      ev(START - 400_000, 'RAMPAGE → Fungalfist'),   // ~-6:40, the merged neighbor pull
      ev(START + 5_000, 'RAMPAGE → Moash'),
    ], START);
    expect(log.early).toHaveLength(1);
    expect(log.main).toHaveLength(1);
  });
  it('a few seconds of clock slack does NOT banish an on-time event', () => {
    const log = buildEventLog([ev(START - 3_000, 'Enrage (Begin)', 'fire')], START);
    expect(log.early).toHaveLength(0);
    expect(log.main).toHaveLength(1);
  });
  it('offsets keep their sign — −6:40 is not 0:00', () => {
    expect(offsetLabel(START - 400_000, START)).toBe('−6:40');
    expect(offsetLabel(START + 83_000, START)).toBe('1:23');
    expect(offsetLabel(START, START)).toBe('0:00');
  });
});
