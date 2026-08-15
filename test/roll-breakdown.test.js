// test/roll-breakdown.test.js — "who else rolled".
//
// Hitya, 2026-08-14: "can we start having a drop-down to open up lower rolls on
// the page and see who else rolled?"
//
// The /rolls page and the Command Center both show winners only; the losing
// rolls were captured all along and simply never rendered. rollBreakdown is the
// shared shape of that expansion, kept pure so both surfaces agree on two calls
// that are easy to get wrong in JSX:
//
//   • a re-roll is KEPT and FLAGGED, never dropped — dropping it makes the list
//     disagree with the roller count, and a high roll that lost with no reason
//     given reads as a bug in the parser rather than a rule of the raid;
//   • a winner is matched on name AND value, ONCE — matching on name alone
//     lights up that same player's losing re-roll as if it had won too.
//
// Run: npx vitest run test/roll-breakdown.test.js

import { describe, it, expect } from 'vitest';
import { rollBreakdown } from '../web/lib/rolls.ts';

const T = Date.parse('2026-08-14T21:49:00Z');
const roll = (name, value, over = {}) => ({ name, value, atMs: T, reroll: false, ...over });
const session = (over = {}) => ({
  from: 0, to: 333, item: 'Poison Tear', qty: null, zone: null,
  startMs: T, lastMs: T + 60_000, rollers: 3,
  winners: [{ name: 'Canopy', value: 156 }],
  rolls: [roll('Canopy', 156), roll('Ashieron', 80), roll('Fargan', 12)],
  ...over,
});

describe('rollBreakdown', () => {
  it('lists every roll, highest first', () => {
    expect(rollBreakdown(session()).map(l => [l.name, l.value]))
      .toEqual([['Canopy', 156], ['Ashieron', 80], ['Fargan', 12]]);
  });

  it('marks the winning roll and nothing else', () => {
    const lines = rollBreakdown(session());
    expect(lines.filter(l => l.isWinner).map(l => l.name)).toEqual(['Canopy']);
  });

  it('marks BOTH winners when the item dropped twice', () => {
    const lines = rollBreakdown(session({
      qty: 2,
      winners: [{ name: 'Canopy', value: 156 }, { name: 'Ashieron', value: 80 }],
    }));
    expect(lines.filter(l => l.isWinner).map(l => l.name)).toEqual(['Canopy', 'Ashieron']);
  });

  it('keeps a re-roll, flags it, and never calls it a winner', () => {
    // Ashieron rolled 220 and won, then re-rolled 5. The re-roll must show (or
    // the count lies) and must not be styled as a win.
    const lines = rollBreakdown(session({
      winners: [{ name: 'Ashieron', value: 220 }],
      rolls: [roll('Ashieron', 220), roll('Canopy', 100), roll('Ashieron', 5, { reroll: true })],
    }));
    expect(lines).toHaveLength(3);
    const rr = lines.find(l => l.reroll);
    expect(rr).toMatchObject({ name: 'Ashieron', value: 5, isWinner: false });
    expect(lines.filter(l => l.isWinner)).toHaveLength(1);
  });

  it('does NOT mark a re-roll that happens to equal the winning value', () => {
    // The nasty one: same name, same number, but a re-roll can't win. Matching
    // on name+value alone would light up both lines.
    const lines = rollBreakdown(session({
      winners: [{ name: 'Canopy', value: 156 }],
      rolls: [roll('Canopy', 156), roll('Canopy', 156, { reroll: true })],
    }));
    expect(lines.filter(l => l.isWinner)).toHaveLength(1);
    expect(lines.find(l => l.isWinner).reroll).toBe(false);
  });

  it('marks only ONE line when a loser happened to tie the winner', () => {
    // Two different people on 156, one winner. Exactly one line is the win.
    const lines = rollBreakdown(session({
      rolls: [roll('Canopy', 156), roll('Fargan', 156), roll('Ashieron', 80)],
    }));
    expect(lines.filter(l => l.isWinner)).toHaveLength(1);
    expect(lines.find(l => l.isWinner).name).toBe('Canopy');
  });

  it('is case-insensitive about the winner name', () => {
    const lines = rollBreakdown(session({ winners: [{ name: 'canopy', value: 156 }] }));
    expect(lines.filter(l => l.isWinner).map(l => l.name)).toEqual(['Canopy']);
  });

  it('sorts ties by name so the order is stable across renders', () => {
    const lines = rollBreakdown(session({
      rolls: [roll('Zed', 50), roll('Abe', 50), roll('Mid', 50)],
    }));
    expect(lines.map(l => l.name)).toEqual(['Abe', 'Mid', 'Zed']);
  });

  it('survives a session with no rolls captured', () => {
    // Older rows predate per-roll capture; the page must not throw on them.
    expect(rollBreakdown(session({ rolls: [] }))).toEqual([]);
    expect(rollBreakdown(session({ rolls: undefined }))).toEqual([]);
    expect(rollBreakdown(session({ winners: undefined, rolls: [roll('Solo', 9)] })))
      .toEqual([{ name: 'Solo', value: 9, reroll: false, isWinner: false }]);
  });

  it('does not mutate the session it was given', () => {
    // The page renders a session more than once per request; an in-place sort
    // would make the second render disagree with the first.
    const s = session();
    const before = s.rolls.map(r => r.name);
    rollBreakdown(s);
    expect(s.rolls.map(r => r.name)).toEqual(before);
  });
});
