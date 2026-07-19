// test/roll-attribution.test.js — #91 roll-night review surface.
//
// Real-imports the pure web lib (web/lib/rolls.ts): the tolerant item matcher,
// the multi-uploader roll merge + winner ranking, and the looted↔session
// attribution window join. These power the /rolls page's "looted by" column.

import { describe, it, expect } from 'vitest';
import {
  normalizeItemName,
  itemsMatch,
  mergeRollSets,
  attributeLoot,
  looterDiffersFromWinners,
  nightKey,
} from '../web/lib/rolls.ts';

describe('normalizeItemName', () => {
  it('lowercases, strips a leading article, and collapses punctuation', () => {
    expect(normalizeItemName('a Fine Steel Long Sword')).toBe('fine steel long sword');
    expect(normalizeItemName('an Iron Ration')).toBe('iron ration');
    expect(normalizeItemName('The Scepter of Destruction')).toBe('scepter of destruction');
    expect(normalizeItemName("Rune'd Bolster-Belt")).toBe('rune d bolster belt');
  });
});

describe('itemsMatch (tolerant)', () => {
  it('matches exact and article-only differences', () => {
    expect(itemsMatch('a Blue Diamond', 'Blue Diamond')).toBe(true);
    expect(itemsMatch('Fine Steel Long Sword', 'fine steel long sword')).toBe(true);
  });
  it('matches loose (substring) roll naming', () => {
    // roll session named it loosely; the looted line is the full item name
    expect(itemsMatch('Velium Battlehammer', 'Primal Velium Battlehammer')).toBe(true);
    expect(itemsMatch('Bone Chips', 'Bone Chip')).toBe(true);
  });
  it('matches on ≥2 shared significant tokens', () => {
    expect(itemsMatch('Fungus Covered Scale Tunic', 'Fungus Tunic')).toBe(true);
  });
  it('does NOT match different items that only share a stopword or one token', () => {
    expect(itemsMatch('Ring of the Ancients', 'Sword of the Ancients')).toBe(false);
    expect(itemsMatch('Cloak of Flames', 'Ring of Flames')).toBe(false);
    expect(itemsMatch('Golden Sarnak Idol', 'Golden Efreeti Boots')).toBe(false);
  });
  it('is false when either side is empty', () => {
    expect(itemsMatch('', 'Blue Diamond')).toBe(false);
    expect(itemsMatch('Blue Diamond', '')).toBe(false);
  });
});

describe('mergeRollSets', () => {
  const base = '2026-07-17T22:00:00.000Z';
  const at = (sMin) => new Date(Date.parse(base) + sMin * 1000).toISOString();
  // Two uploaders each saw the same 0-100 set — one missed a roller.
  const rows = [
    {
      roll_from: 0, roll_to: 100, item: 'Cloak of Flames', qty: 1, zone: 'The Overthere',
      started_at: base, last_at: at(30), uploaded_by_discord_id: 'u1',
      rolls: [
        { name: 'Grobnar', value: 87, at: at(0) },
        { name: 'Shavimo', value: 42, at: at(10) },
        { name: 'Uilnayar', value: 91, at: at(20) },
      ],
    },
    {
      roll_from: 0, roll_to: 100, item: null, qty: null, zone: null,
      started_at: new Date(Date.parse(base) + 1000).toISOString(), last_at: at(30), uploaded_by_discord_id: 'u2',
      rolls: [
        { name: 'Grobnar', value: 87, at: at(0) },   // same roll, other observer → collapses
        { name: 'Uilnayar', value: 91, at: at(20) },
        { name: 'Peopleslayer', value: 55, at: at(25) },
      ],
    },
  ];

  it('unions rolls across uploaders and dedups the same roll', () => {
    const [s] = mergeRollSets(rows);
    expect(s.rollers).toBe(4);                    // Grobnar, Shavimo, Uilnayar, Peopleslayer
    expect(s.item).toBe('Cloak of Flames');       // filled from the uploader that linked it
    expect(s.winners).toEqual([{ name: 'Uilnayar', value: 91 }]);   // highest first-roll
  });

  it('honors qty>1 for multiple winners', () => {
    const multi = [{ ...rows[0], qty: 2 }];
    const [s] = mergeRollSets(multi);
    expect(s.winners.map(w => w.name)).toEqual(['Uilnayar', 'Grobnar']);   // top 2
  });
});

describe('attributeLoot (window join)', () => {
  const base = Date.parse('2026-07-17T22:00:00.000Z');
  const iso = (min) => new Date(base + min * 60000).toISOString();
  const session = {
    from: 0, to: 100, item: 'Cloak of Flames', qty: 1, zone: 'The Overthere',
    startMs: base, lastMs: base + 30000, rollers: 4,
    winners: [{ name: 'Uilnayar', value: 91 }], rolls: [],
  };

  it('links a looted item within the window (winner passed → someone else looted)', () => {
    const looted = [
      { looter_character: 'Shavimo', item_name: 'Cloak of Flames', zone: 'The Overthere', looted_at: iso(3) },
    ];
    const hits = attributeLoot(session, looted);
    expect(hits).toHaveLength(1);
    expect(hits[0].looter).toBe('Shavimo');
    expect(looterDiffersFromWinners(hits[0].looter, session.winners)).toBe(true);
  });

  it('does not link loot outside the ±window', () => {
    const looted = [
      { looter_character: 'Shavimo', item_name: 'Cloak of Flames', zone: null, looted_at: iso(45) },   // 45 min later
    ];
    expect(attributeLoot(session, looted)).toHaveLength(0);
  });

  it('does not link a different item', () => {
    const looted = [
      { looter_character: 'Shavimo', item_name: 'Ring of the Ancients', zone: null, looted_at: iso(3) },
    ];
    expect(attributeLoot(session, looted)).toHaveLength(0);
  });

  it('reports the winner is NOT different when the winner looted it', () => {
    const looted = [
      { looter_character: 'Uilnayar', item_name: 'a Cloak of Flames', zone: null, looted_at: iso(2) },
    ];
    const hits = attributeLoot(session, looted);
    expect(hits).toHaveLength(1);
    expect(looterDiffersFromWinners(hits[0].looter, session.winners)).toBe(false);
  });
});

describe('nightKey', () => {
  it('buckets a late-night ET timestamp into its calendar day', () => {
    // 2026-07-18T02:30:00Z is 2026-07-17 22:30 in America/New_York
    expect(nightKey('2026-07-18T02:30:00.000Z', 'America/New_York')).toBe('2026-07-17');
  });
});
