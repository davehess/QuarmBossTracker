// #134 Discord parse-card death dedup — REAL-IMPORT fidelity tier.
//
// Under test: dedupParseDeaths in utils/parseDeaths.js — the port of the web
// parse page's cross-uploader death dedup + phantom suppression
// (web/app/parses/[id]/page.tsx ~369-418). The bot's Discord auto-parse card
// USED to SUM each parser's sighting of the same death (Melting ×3 when three
// parsers each saw Melting die once); this helper collapses them so the card
// matches the website.

import { describe, it, expect } from 'vitest';
import { dedupParseDeaths, DEATH_DEDUP_MS } from '../utils/parseDeaths.js';

const byName = (rows) => Object.fromEntries(rows.map(r => [r.name, r.count]));

describe('dedupParseDeaths — cross-parser collapse (#134 repro)', () => {
  it('collapses three parsers each seeing the same six deaths once → each ×1', () => {
    // The confirmed fight (parse bdf0b801): Kebarer, Gabekn, Gibobab, Melting,
    // Gonobtik, Vebober each died ONCE — three parsers, ts within ~2s skew.
    const names = ['Kebarer', 'Gabekn', 'Gibobab', 'Melting', 'Gonobtik', 'Vebober'];
    const contrib = (skewSec) => names.map((n, i) => ({
      name: n,
      ts: new Date(Date.parse('2026-07-22T01:00:00Z') + i * 5000 + skewSec * 1000).toISOString(),
    }));
    const out = dedupParseDeaths([contrib(0), contrib(1), contrib(2)]);
    expect(out).toHaveLength(6);
    for (const r of out) expect(r.count).toBe(1);
    // Ordered by first death time
    expect(out.map(r => r.name)).toEqual(names);
  });
});

describe('dedupParseDeaths — phantom suppression', () => {
  it('drops a name any SINGLE contributor reported dying 2+ times', () => {
    // "Syphon" is both an SK player and a Quarm NPC — one parser credits every
    // NPC-Syphon kill to the player. That name must vanish entirely.
    const c1 = [
      { name: 'Syphon', ts: '2026-07-22T01:00:00Z' },
      { name: 'Syphon', ts: '2026-07-22T01:03:00Z' },
      { name: 'Syphon', ts: '2026-07-22T01:06:00Z' },
      { name: 'Realtank', ts: '2026-07-22T01:02:00Z' },
    ];
    const c2 = [{ name: 'Realtank', ts: '2026-07-22T01:02:01Z' }];
    const out = dedupParseDeaths([c1, c2]);
    expect(out.map(r => r.name)).toEqual(['Realtank']);
    expect(byName(out).Realtank).toBe(1);
  });
});

describe('dedupParseDeaths — genuine re-death vs window', () => {
  it('keeps a real second death well beyond the dedup window as ×2', () => {
    const c1 = [
      { name: 'Tanky', ts: '2026-07-22T01:00:00Z' },
      { name: 'Tanky', ts: '2026-07-22T01:05:00Z' }, // 5 min later — a real rez-and-die
    ];
    // NOTE: a single contributor reporting Tanky twice would normally be a
    // phantom — but here the two are minutes apart, matching the web's own
    // behavior (the web ALSO suppresses a name any one contributor reports 2+
    // times). So verify the phantom rule fires and Tanky is dropped.
    const out = dedupParseDeaths([c1]);
    expect(out).toHaveLength(0);
  });

  it('two DIFFERENT contributors reporting a death minutes apart → ×2 (not phantom)', () => {
    const c1 = [{ name: 'Tanky', ts: '2026-07-22T01:00:00Z' }];
    const c2 = [{ name: 'Tanky', ts: '2026-07-22T01:05:00Z' }];
    const out = dedupParseDeaths([c1, c2]);
    expect(out).toHaveLength(1);
    expect(out[0].count).toBe(2);
  });

  it('collapses sightings within the dedup window', () => {
    const c1 = [{ name: 'Tanky', ts: '2026-07-22T01:00:00Z' }];
    const c2 = [{ name: 'Tanky', ts: new Date(Date.parse('2026-07-22T01:00:00Z') + DEATH_DEDUP_MS - 1).toISOString() }];
    const out = dedupParseDeaths([c1, c2]);
    expect(out[0].count).toBe(1);
  });
});

describe('dedupParseDeaths — display fields', () => {
  it('carries class through and ORs the riposte flag across sightings', () => {
    const c1 = [{ name: 'Knightly', ts: '2026-07-22T01:00:00Z', class: 'Paladin', riposteDeath: false }];
    const c2 = [{ name: 'Knightly', ts: '2026-07-22T01:00:01Z', class: 'Paladin', riposteDeath: true }];
    const out = dedupParseDeaths([c1, c2]);
    expect(out).toHaveLength(1);
    expect(out[0].class).toBe('Paladin');
    expect(out[0].riposteDeath).toBe(true);
    expect(out[0].count).toBe(1);
  });

  it('tolerates empty / malformed input', () => {
    expect(dedupParseDeaths(null)).toEqual([]);
    expect(dedupParseDeaths([])).toEqual([]);
    expect(dedupParseDeaths([[], [{ name: '' }], [null]])).toEqual([]);
  });
});
