// test/event-attempts-side.test.js — another guild's run of a scripted event is shown against ours, never counted as
// ours (the guild lead, 2026-11-11). Behaviour only; fixtures use invented ids and names.
// Run: npx vitest run test/event-attempts-side.test.js
import { describe, it, expect } from 'vitest';
import { rowSide, buildAttempts, oursOnly } from '../web/lib/eventAttempts.ts';
import { computeSplits } from '../web/lib/goldSplits.ts';
import { splitsDefFor } from '../web/lib/eventSplitsDefs.ts';

const def = splitsDefFor('powater-coirnav');
const BASE = Date.parse('2026-11-10T20:00:00Z');
const enc = (id, npc, startS, endS, o = {}) => ({
  id, npc_id: npc, raid_night_id: 'n1', classification: null, is_wipe: false,
  started_at: new Date(BASE + startS * 1000).toISOString(), ended_at: new Date(BASE + endS * 1000).toISOString(), ...o,
});
const names = (n, prefix) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe('rowSide', () => {
  const wp = new Set(names(40, 'wp').map(s => s.toLowerCase()));
  it('a foreign mark is another guild whatever the roster', () => {
    expect(rowSide('foreign', names(10, 'wp'), wp)).toBe('other');
  });
  it('a live mark is not a side: our own open-world raid stays ours, another guild in live goes by its roster', () => {
    expect(rowSide('live', names(30, 'wp'), wp)).toBe('ours');
    expect(rowSide('live', ['WP0', ...names(31, 'xx')], wp)).toBe('other');
  });
  it('one of 32 ours is another guild; 30 of 34 is ours', () => {
    expect(rowSide(null, ['WP0', ...names(31, 'xx')], wp)).toBe('other');
    expect(rowSide(null, [...names(30, 'wp'), ...names(4, 'xx')], wp)).toBe('ours');
  });
  it('under five players with no mark is ours, and the name match ignores case', () => {
    expect(rowSide(null, names(4, 'xx'), wp)).toBe('ours');
    expect(rowSide(null, [], wp)).toBe('ours');
    expect(rowSide(null, ['WP1', 'Wp2', 'wP3', 'WP4', 'xx'], wp)).toBe('ours');
  });
});

describe('attempts by side', () => {
  // ours: start 0, minis, end at 900. other: interleaved on the same night, much faster (end at 400).
  const ours = [enc('o1', 216053, 0, 10), enc('o2', 216236, 300, 320), enc('o3', 216247, 500, 520), enc('o4', 216245, 700, 720), enc('o5', 216048, 880, 900)];
  const theirs = [enc('t1', 216053, 5, 15), enc('t2', 216236, 100, 120), enc('t3', 216247, 200, 220), enc('t4', 216245, 300, 320), enc('t5', 216048, 380, 400)]
    .map(r => ({ ...r, side: 'other' }));
  const rows = [...ours, ...theirs].sort((a, b) => a.started_at.localeCompare(b.started_at));

  it('two sides interleaved on one night never share an attempt', () => {
    const out = buildAttempts(def, rows);
    expect(out).toHaveLength(2);
    expect(out.map(a => a.side).sort()).toEqual(['other', 'ours']);
    for (const a of out) {
      const ids = a.moments.filter(Boolean).map(m => m.encounterId);
      expect(ids.every(id => id.startsWith(a.side === 'other' ? 't' : 'o'))).toBe(true);
    }
    expect(new Set(out.map(a => a.key)).size).toBe(2);
  });
  it('a row with no side is ours', () => {
    expect(buildAttempts(def, ours).map(a => a.side)).toEqual(['ours']);
  });
  it('gold and the best run come from our attempts only', () => {
    const out = buildAttempts(def, rows);
    const sp = computeSplits(def.moments.length, oursOnly(out));
    expect(oursOnly(out)).toHaveLength(1);
    const mine = out.find(a => a.side === 'ours');
    const theirsAttempt = out.find(a => a.side === 'other');
    expect(theirsAttempt.endMs - theirsAttempt.startMs).toBeLessThan(mine.endMs - mine.startMs);
    expect(sp.attempts).toHaveLength(1);
    expect(sp.attempts[0].total).toBe(890);
    expect(sp.bestRun).toBe(0);
    expect(sp.sumOfBest).toBe(sp.attempts[0].total);
  });
});
