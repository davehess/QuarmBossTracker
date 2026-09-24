// test/deathroll.test.js — finding deathrolls in roll_sets rows.
//
// The guild lead, 2026-09-23: "These are called Deathrolls. First one to roll a
// zero loses - we should track these for fun."
//
// The fixture is the first game we captured, with its real ranges and real
// step timings (32000 → 0 in 11 rolls, 36 seconds). Seven uploaders saw it,
// with clocks up to 9 seconds apart; the names are invented stand-ins.
//
// Run: npx vitest run test/deathroll.test.js

import { describe, it, expect } from 'vitest';
import { flattenRolls, findDeathrolls, deathrollsFromRows, describeGame } from '../utils/deathroll.js';

const T0 = Date.parse('2026-09-24T02:57:40Z');
// [roller, range top, result, seconds after T0]
const GAME = [
  ['Brackwyn', 32000, 11194, 0],
  ['Aldenmar', 11194, 6897, 8],
  ['Brackwyn', 6897, 5243, 14],
  ['Aldenmar', 5243, 1617, 18],
  ['Brackwyn', 1617, 736, 22],
  ['Aldenmar', 736, 527, 25],
  ['Brackwyn', 527, 93, 27],
  ['Aldenmar', 93, 12, 31],
  ['Brackwyn', 12, 6, 32],
  ['Aldenmar', 6, 1, 35],
  ['Brackwyn', 1, 0, 36],
];

// One roll_sets row per step, as the agent uploads them (each range is its own set).
function rowsFor(steps, { uploader = 'u1', skewSec = 0, t0 = T0 } = {}) {
  return steps.map(([name, to, value, sec]) => {
    const at = new Date(t0 + (sec + skewSec) * 1000).toISOString();
    return { uploaded_by_discord_id: uploader, roll_from: 0, roll_to: to, started_at: at,
             rolls: [{ name, value, at, reroll: false }] };
  });
}

describe('the first captured game', () => {
  it('is one deathroll: Brackwyn lost to Aldenmar, 32000 → 0 in 11 rolls', () => {
    const games = deathrollsFromRows(rowsFor(GAME));
    expect(games).toHaveLength(1);
    const g = games[0];
    expect(g.loser).toBe('Brackwyn');
    expect(g.winners).toEqual(['Aldenmar']);
    expect(g.start).toBe(32000);
    expect(g.rolls).toBe(11);
    expect(g.endMs - g.startMs).toBe(36_000);
  });

  it('seven uploaders with clocks up to 9s apart still make ONE game', () => {
    const rows = [];
    [0, 2, 4, 9, 1, 7, 3].forEach((skew, i) => rows.push(...rowsFor(GAME, { uploader: 'u' + i, skewSec: skew })));
    expect(deathrollsFromRows(rows)).toHaveLength(1);
  });

  it('an observer who arrived mid-game does not shorten the record', () => {
    const rows = [...rowsFor(GAME.slice(7), { uploader: 'late', skewSec: 2 }), ...rowsFor(GAME, { uploader: 'full' })];
    const games = deathrollsFromRows(rows);
    expect(games).toHaveLength(1);
    expect(games[0].rolls).toBe(11);
    expect(games[0].start).toBe(32000);
  });

  it('describes itself for the Discord post', () => {
    expect(describeGame(deathrollsFromRows(rowsFor(GAME))[0]))
      .toBe('Brackwyn lost a deathroll to Aldenmar — 32,000 → 0 in 11 rolls');
  });
});

describe('what is not a deathroll', () => {
  it('loot rolls — several players on one range — are not', () => {
    const at = new Date(T0).toISOString();
    const loot = { uploaded_by_discord_id: 'u1', roll_from: 0, roll_to: 333, started_at: at, rolls: [
      { name: 'Corvale', value: 77, at }, { name: 'Rethlan', value: 0, at }, { name: 'Nyssara', value: 210, at },
    ] };
    expect(deathrollsFromRows([loot])).toHaveLength(0);
  });

  it('fewer than three rolls is not a game', () => {
    expect(deathrollsFromRows(rowsFor([['Brackwyn', 5, 1, 0], ['Aldenmar', 1, 0, 3]]))).toHaveLength(0);
  });

  it('the same player rolling twice in a row breaks the chain', () => {
    const steps = [['Brackwyn', 100, 40, 0], ['Brackwyn', 40, 9, 3], ['Aldenmar', 9, 2, 6], ['Brackwyn', 2, 0, 9]];
    const g = deathrollsFromRows(rowsFor(steps));
    // Only the tail 40 → 9 → 2 → 0 links (Brackwyn, Aldenmar, Brackwyn).
    expect(g).toHaveLength(1);
    expect(g[0].start).toBe(40);
    expect(g[0].rolls).toBe(3);
  });

  it('a step more than two minutes after the last one breaks the chain', () => {
    const steps = [['Brackwyn', 1000, 400, 0], ['Aldenmar', 400, 90, 5], ['Brackwyn', 90, 12, 200],
                   ['Aldenmar', 12, 3, 204], ['Brackwyn', 3, 0, 207]];
    const g = deathrollsFromRows(rowsFor(steps));
    expect(g).toHaveLength(1);
    expect(g[0].start).toBe(90);
  });
});

describe('the rules people actually play', () => {
  it('three players rotating: everyone but the loser wins', () => {
    const steps = [['Brackwyn', 500, 300, 0], ['Aldenmar', 300, 120, 4], ['Corvale', 120, 40, 8],
                   ['Brackwyn', 40, 10, 12], ['Aldenmar', 10, 0, 15]];
    const g = deathrollsFromRows(rowsFor(steps))[0];
    expect(g.loser).toBe('Aldenmar');
    expect(g.winners).toEqual(['Brackwyn', 'Corvale']);
  });

  it('rolling the top of the range hands the same range on', () => {
    const steps = [['Brackwyn', 6, 6, 0], ['Aldenmar', 6, 6, 3], ['Brackwyn', 6, 2, 6], ['Aldenmar', 2, 0, 9]];
    const g = deathrollsFromRows(rowsFor(steps))[0];
    expect(g.rolls).toBe(4);
    expect(g.loser).toBe('Aldenmar');
  });

  it('two games back to back are two games', () => {
    const second = GAME.map(([n, to, v, s]) => [n === 'Brackwyn' ? 'Aldenmar' : 'Brackwyn', to, v, s + 60]);
    const g = deathrollsFromRows(rowsFor([...GAME, ...second]));
    expect(g.map(x => x.loser)).toEqual(['Brackwyn', 'Aldenmar']);
  });
});

describe('flattenRolls', () => {
  it('orders single rolls by time across sets', () => {
    const rows = rowsFor(GAME).reverse();
    const flat = flattenRolls(rows);
    expect(flat.map(r => r.to)).toEqual(GAME.map(s => s[1]));
    expect(findDeathrolls(flat)).toHaveLength(1);
  });
});
