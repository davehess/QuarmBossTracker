// test/night-slices.test.js — slicing a recorded night into raid / event / downtime / another guild's raid, the night's
// named fights and mass deaths, and the two beta previews of the editor (?v=slices, ?v=segments) on the session review
// (the guild lead, 2026-10-23; web/lib/nightSlices.ts, nightSlicesLoad.ts, app/raid/session/Night*.tsx).
//
//   1. MASS DEATH   5+ deaths of anyone within a minute are one moment; overlapping runs join; a trickle is not one.
//   2. FIGHTS       a named fight is a kill or a wipe, tagged when it is another guild's; the log interleaves the two.
//   3. SEGMENTS     a night is cut at quiet gaps, roster turnover and the hand-over between our fights and another
//                   guild's; short pieces fold in; merge / split / move-boundary keep the tiling honest.
//   4. STORE        planSliceWrite: replace what is inside the window, refuse overlaps / crossings / bad input.
//   5. LOADER       against a fake database: no name leaves loadNightMarks, saves are guarded by updated_at.
//   6. SOURCE       default page untouched, officer + same-origin gate on the write, members-only timeline route.
//
// Names are invented tokens. Source assertions run on comment-stripped text (stripJs).
// Run: npx vitest run test/night-slices.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import { MINUTE_MS } from '../web/lib/raidReplay.ts';
import {
  GAP_BREAK_MS, KEEP_DAYS, MAX_LABEL, MAX_PER_WRITE, MIN_SEGMENT_MS, cleanLabel, detectSegments, deathsDuring, fitNew, fightMark,
  markFights, massDeaths, mergeSegments, moveBoundary, moveEdge, nightLog, parseSliceStore, planSliceWrite, playerDeathName,
  slicesIn, spanStats, splitSegment, suggestKind,
} from '../web/lib/nightSlices.ts';
import { rosterCuts } from '../web/lib/liveRaidWindow.ts';
import { loadNightMarks, saveSlices } from '../web/lib/nightSlicesLoad.ts';

const T0 = Date.parse('2026-10-22T23:02:00Z');
const at = (min) => T0 + min * MINUTE_MS;
const WIN = { fromMs: at(0), toMs: at(540) };
const NOW = Date.parse('2026-10-23T09:00:00Z');
let n = 0;
const newId = () => `gen${++n}x`;

const fight = (id, startMin, durMin, over = {}) => ({
  id, name: `Boss ${id}`, zone: null, startMs: at(startMin), endMs: at(startMin + durMin), durationSec: durMin * 60, classification: null, ...over,
});

// ── 1. MASS DEATH ────────────────────────────────────────────────────────────────────────────────────────────
describe('massDeaths', () => {
  const s = (sec) => at(0) + sec * 1000;
  it('seven deaths in fifty seconds are one moment of seven', () => {
    const m = massDeaths([0, 5, 12, 20, 33, 41, 50].map(s));
    expect(m).toEqual([{ fromMs: s(0), toMs: s(50), count: 7 }]);
  });
  it('four deaths together are not a moment; five are', () => {
    expect(massDeaths([0, 10, 20, 30].map(s))).toEqual([]);
    expect(massDeaths([0, 10, 20, 30, 40].map(s))).toHaveLength(1);
  });
  it('a trickle (a death every 30 s for three minutes) never fits five in a minute', () => {
    expect(massDeaths(Array.from({ length: 7 }, (_, i) => s(i * 30)))).toEqual([]);
  });
  it('overlapping runs join into one longer moment, separate ones stay apart', () => {
    const wipe = [0, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80].map(s);     // 11 deaths over 80 s: every 60 s window holds 8+
    const later = [600, 605, 610, 615, 620].map(s);
    const m = massDeaths([...later, ...wipe]);                            // unsorted on purpose
    expect(m).toHaveLength(2);
    expect(m[0]).toEqual({ fromMs: s(0), toMs: s(80), count: 11 });
    expect(m[1].count).toBe(5);
  });
  it('ignores times that are not numbers', () => {
    expect(massDeaths([NaN, undefined, ...[0, 1, 2, 3, 4].map(s)])).toHaveLength(1);
  });
  it('counts a character, not an NPC or a pet', () => {
    expect(playerDeathName('Aldenmar')).toBe(true);
    expect(playerDeathName('an orc pawn')).toBe(false);
    expect(playerDeathName('The Protector')).toBe(false);
    expect(playerDeathName('Brackwyn`s pet')).toBe(false);
    expect(playerDeathName('')).toBe(false);
  });
});

// ── 2. FIGHTS ────────────────────────────────────────────────────────────────────────────────────────────────
describe('named fights', () => {
  it('a kill, a guild wipe and another guild\'s wipe are told apart', () => {
    expect(fightMark(fight('a', 10, 2))).toMatchObject({ result: 'kill', tag: null });
    expect(fightMark(fight('b', 10, 2, { classification: 'wipe' }))).toMatchObject({ result: 'wipe', tag: null });
    expect(fightMark(fight('c', 10, 2, { classification: 'foreign', isWipe: true }))).toMatchObject({ result: 'wipe', tag: 'foreign' });
    expect(fightMark(fight('d', 10, 2, { classification: 'foreign' }))).toMatchObject({ result: 'kill', tag: 'foreign' });
  });
  it('a fight with no end ends at its start plus its duration, and the list is in the order they ended', () => {
    const f = fightMark({ ...fight('e', 5, 3), endMs: null });
    expect(f.endMs).toBe(at(8));
    expect(markFights([fight('x', 30, 1), fight('y', 10, 1)]).map(m => m.id)).toEqual(['y', 'x']);
  });
  it('deaths count in a fight from five seconds before it to fifteen after', () => {
    const f = fightMark(fight('f', 10, 2));
    expect(deathsDuring(f, [f.startMs - 6000, f.startMs - 4000, f.endMs + 14000, f.endMs + 16000])).toBe(2);
  });
  it('the log puts the moments of mass death among the fights and names the fight they fell in', () => {
    const fights = markFights([fight('k1', 10, 3), fight('k2', 60, 3, { classification: 'foreign', isWipe: true })]);
    const deaths = [at(61), at(61) + 3000, at(61) + 6000, at(61) + 9000, at(61) + 12000, at(30)];
    const log = nightLog({ fights, deaths, mass: massDeaths(deaths) });
    expect(log.map(i => i.kind)).toEqual(['fight', 'fight', 'mass']);   // sorted by start; the mass moment starts a minute into k2
    const mass = log.find(i => i.kind === 'mass');
    expect(mass.during).toBe('Boss k2');
    expect(log.find(i => i.kind === 'fight' && i.fight.id === 'k2').deaths).toBe(5);
    expect(nightLog({ fights: [], deaths: [], mass: [] })).toEqual([]);
  });
});

// ── 3. SEGMENTS ──────────────────────────────────────────────────────────────────────────────────────────────
describe('what a span holds, and the kind it suggests', () => {
  const fights = markFights([
    fight('g1', 10, 2), fight('g2', 20, 2, { classification: 'wipe' }), fight('o1', 100, 2, { classification: 'foreign' }), fight('l1', 30, 1, { classification: 'live' }),
  ]);
  it('counts by the time a fight ENDED, and keeps live/pvp/test out of the guild counts', () => {
    expect(spanStats({ fromMs: at(0), toMs: at(60) }, { fights, deaths: [at(5)], mass: [] })).toEqual({ kills: 1, wipes: 1, otherGuild: 0, deaths: 1, mass: 0 });
    expect(spanStats({ fromMs: at(60), toMs: at(200) }, { fights, deaths: [], mass: [] }).otherGuild).toBe(1);
    expect(spanStats({ fromMs: at(0), toMs: at(11) }, { fights, deaths: [], mass: [] }).kills).toBe(0);   // g1 ends at minute 12
  });
  it('more fights by another guild than ours is their raid; any of ours is a raid; none is downtime', () => {
    expect(suggestKind({ kills: 0, wipes: 0, otherGuild: 3 })).toBe('other_guild');
    expect(suggestKind({ kills: 2, wipes: 0, otherGuild: 2 })).toBe('raid');
    expect(suggestKind({ kills: 0, wipes: 1, otherGuild: 0 })).toBe('raid');
    expect(suggestKind({ kills: 0, wipes: 0, otherGuild: 0 })).toBe('downtime');
  });
});

describe('detectSegments', () => {
  const ctx = (fights) => ({ fights: markFights(fights), deaths: [], mass: [] });
  const span = (a, b) => ({ from: at(a), to: at(b) });

  it('our raid, a long gap, another guild\'s raid: two segments, the second after the gap, with their own kinds', () => {
    const c = ctx([fight('a', 20, 2), fight('b', 60, 2), fight('c', 110, 2, { classification: 'wipe' }), fight('x', 300, 2, { classification: 'foreign' }), fight('y', 330, 2, { classification: 'foreign' })]);
    const segs = detectSegments(WIN, [span(0, 150), span(250, 400)], [], c);
    expect(segs).toHaveLength(2);
    expect(segs.map(s => s.kind)).toEqual(['raid', 'other_guild']);
    expect(segs[0]).toMatchObject({ fromMs: at(0), toMs: at(150), why: '' });
    expect(segs[1]).toMatchObject({ fromMs: at(250), toMs: at(400) });
    expect(segs[1].why).toMatch(/gap/);
    expect(segs[1].why).toMatch(/1 h 40 min/);
  });
  it('a hole shorter than the break is not a break', () => {
    const segs = detectSegments(WIN, [span(0, 60), span(60 + (GAP_BREAK_MS / MINUTE_MS) - 1, 120)], [], ctx([fight('a', 10, 2)]));
    expect(segs).toHaveLength(1);
  });
  it('with no gap, the hand-over from our fights to another guild\'s is cut in the quiet between them', () => {
    const c = ctx([fight('a', 10, 2), fight('b', 40, 2), fight('x', 120, 2, { classification: 'foreign' }), fight('y', 150, 2, { classification: 'foreign' })]);
    const segs = detectSegments(WIN, [span(0, 200)], [], c);
    expect(segs).toHaveLength(2);
    expect(segs[1].fromMs).toBe(at(81));                       // half way between b ending (42) and x starting (120)
    expect(segs[1].why).toMatch(/alternate/);
    expect(segs.map(s => s.kind)).toEqual(['raid', 'other_guild']);
  });
  it('a roster break cuts too, and a fight hand-over right at it adds no second cut', () => {
    const c = ctx([fight('a', 10, 2), fight('x', 100, 2, { classification: 'foreign' })]);
    const segs = detectSegments(WIN, [span(0, 200)], [at(90)], c);
    expect(segs).toHaveLength(2);
    expect(segs[1]).toMatchObject({ fromMs: at(90), why: 'the roster changed' });
  });
  it('a piece under ten minutes is folded into its neighbour', () => {
    const segs = detectSegments(WIN, [span(0, 200)], [at(5), at(100)], ctx([fight('a', 50, 2)]));
    expect(segs.map(s => [s.fromMs, s.toMs])).toEqual([[at(0), at(100)], [at(100), at(200)]]);
    expect(MIN_SEGMENT_MS).toBe(10 * MINUTE_MS);
  });
  it('nothing recorded gives nothing to confirm; spans outside the window are clipped', () => {
    expect(detectSegments(WIN, [], [], ctx([]))).toEqual([]);
    const segs = detectSegments(WIN, [{ from: at(-50), to: at(30) }], [], ctx([]));
    expect(segs).toEqual([{ fromMs: at(0), toMs: at(30), kind: 'downtime', label: '', why: '' }]);
  });
});

describe('the roster breaks the segments are guessed from (rosterCuts)', () => {
  // three groups of six, thirty minutes each: the roster turns over twice
  const series = [];
  const group = (g, from) => { for (let m = from; m < from + 30; m++) series.push({ t: at(m), who: Array.from({ length: 6 }, (_, i) => `${g}${i}`) }); };
  group('a', 0); group('b', 30); group('c', 60);
  it('finds both hand-overs, in order', () => {
    const b = rosterCuts(series);
    expect(b).toHaveLength(2);
    expect(Math.abs(b[0] - at(30))).toBeLessThanOrEqual(2 * MINUTE_MS);
    expect(Math.abs(b[1] - at(60))).toBeLessThanOrEqual(2 * MINUTE_MS);
  });
  it('one steady roster has none', () => {
    expect(rosterCuts(series.filter(s => s.t < at(30)))).toEqual([]);
  });
});

describe('editing segments', () => {
  const c = { fights: markFights([fight('a', 10, 2), fight('x', 100, 2, { classification: 'foreign' }), fight('y', 110, 2, { classification: 'foreign' })]), deaths: [], mass: [] };
  const base = [
    { fromMs: at(0), toMs: at(60), kind: 'raid', label: 'first', why: '' },
    { fromMs: at(60), toMs: at(200), kind: 'raid', label: '', why: 'x' },
  ];
  it('merging joins two, covers the gap and suggests the kind again', () => {
    const m = mergeSegments(base, 0, c);
    expect(m).toHaveLength(1);
    // one fight of ours and two of another guild's now sit in it: the kind is guessed again from that
    expect(m[0]).toMatchObject({ fromMs: at(0), toMs: at(200), label: 'first', kind: 'other_guild' });
    expect(mergeSegments(base, 1, c)).toEqual(base);                   // nothing after the last
  });
  it('splitting cuts at the minute, keeps the first half, and suggests a kind for the second', () => {
    const s = splitSegment(base, 1, at(90) + 20_000, c);
    expect(s.map(x => [x.fromMs, x.toMs])).toEqual([[at(0), at(60)], [at(60), at(90)], [at(90), at(200)]]);
    expect(s[1].kind).toBe('raid');                                     // keeps the original
    expect(s[2].kind).toBe('other_guild');                              // two foreign fights end in it
    const thin = [{ fromMs: at(0), toMs: at(1), kind: 'raid', label: '', why: '' }];
    expect(splitSegment(thin, 0, at(0) + 20_000, c)).toEqual(thin);     // a one-minute segment cannot be cut
    expect(splitSegment(base, 0, at(0) + 5_000, c)[1].fromMs).toBe(at(1));   // a cut is held a minute inside the edge
  });
  it('moving a boundary shifts both sides and never empties one', () => {
    const m = moveBoundary(base, 0, 5 * MINUTE_MS);
    expect(m[0].toMs).toBe(at(65)); expect(m[1].fromMs).toBe(at(65));
    const way = moveBoundary(base, 0, 9999 * MINUTE_MS);
    expect(way[1].toMs - way[1].fromMs).toBe(MINUTE_MS);
    expect(moveBoundary([{ ...base[0] }, { ...base[1], fromMs: at(70) }], 0, MINUTE_MS)[0].toMs).toBe(at(60));   // not touching: left alone
  });
});

describe('drawing and nudging slices', () => {
  const list = [{ fromMs: at(100), toMs: at(150) }, { fromMs: at(200), toMs: at(260) }];
  it('a new span is held to the minute, inside the window, and cut short at the next one', () => {
    expect(fitNew(list, WIN, at(10) + 20_000, at(40))).toEqual({ fromMs: at(10), toMs: at(40) });
    expect(fitNew(list, WIN, at(160), at(400))).toEqual({ fromMs: at(160), toMs: at(200) });
    expect(fitNew(list, WIN, at(130), at(180))).toBeNull();            // starts inside one
    expect(fitNew(list, WIN, at(10), at(10) + 20_000)).toBeNull();     // under a minute
    expect(fitNew(list, WIN, at(40), at(10))).toEqual({ fromMs: at(10), toMs: at(40) });   // dragged backwards
  });
  it('an edge moves by minutes, stays a minute long, and stops at its neighbour and the window', () => {
    expect(moveEdge(list, 0, 'to', 5 * MINUTE_MS, WIN)[0].toMs).toBe(at(155));
    expect(moveEdge(list, 0, 'to', 500 * MINUTE_MS, WIN)[0].toMs).toBe(at(200));
    expect(moveEdge(list, 0, 'from', -500 * MINUTE_MS, WIN)[0].fromMs).toBe(WIN.fromMs);
    expect(moveEdge(list, 1, 'from', -500 * MINUTE_MS, WIN)[1].fromMs).toBe(at(150));
    expect(moveEdge(list, 0, 'from', 500 * MINUTE_MS, WIN)[0].fromMs).toBe(at(149));
  });
});

// ── 4. STORE ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('the slice store', () => {
  const empty = { v: 1, s: [] };
  const sl = (a, b, over = {}) => ({ fromMs: at(a), toMs: at(b), kind: 'raid', label: '', ...over });

  it('saves what was sent, to the minute, clipped to the window, with fresh ids, oldest first', () => {
    const r = planSliceWrite(empty, WIN, [sl(300, 400, { label: ' Event ' }), { ...sl(-30, 100), fromMs: at(-30) + 10_000, toMs: at(100) + 20_000, kind: 'downtime' }], newId, NOW);
    expect(r.error).toBeUndefined();
    expect(r.saved.map(s => [s.fromMs, s.toMs, s.kind])).toEqual([[at(0), at(100), 'downtime'], [at(300), at(400), 'raid']]);
    expect(r.saved[1].label).toBe('Event');
    expect(new Set(r.saved.map(s => s.id)).size).toBe(2);
    expect(r.store.s).toHaveLength(2);
  });
  it('replaces what lies inside the window and keeps what is outside it', () => {
    const outside = { id: 'keepme1', fromMs: at(-600), toMs: at(-500), kind: 'event', label: 'earlier night' };
    const old = { id: 'oldone1', fromMs: at(10), toMs: at(50), kind: 'raid', label: 'old' };
    const r = planSliceWrite({ v: 1, s: [outside, old] }, WIN, [sl(20, 60, { id: 'oldone1', label: 'moved' })], newId, NOW);
    expect(r.store.s.map(s => s.id)).toEqual(['keepme1', 'oldone1']);
    expect(r.store.s[1]).toMatchObject({ fromMs: at(20), toMs: at(60), label: 'moved' });
    expect(planSliceWrite({ v: 1, s: [outside, old] }, WIN, [], newId, NOW).store.s).toEqual([outside]);   // [] clears the window
  });
  it('refuses a saved slice that crosses the window\'s edge, and writes nothing', () => {
    const crossing = { id: 'cross001', fromMs: at(500), toMs: at(600), kind: 'raid', label: '' };
    const r = planSliceWrite({ v: 1, s: [crossing] }, WIN, [sl(10, 20)], newId, NOW);
    expect(r.error).toMatch(/crosses/);
    expect(r.store).toBeUndefined();
  });
  it('refuses overlaps, bad kinds, bad times, non-lists and too many', () => {
    expect(planSliceWrite(empty, WIN, [sl(10, 60), sl(50, 90)], newId, NOW).error).toMatch(/overlap/);
    expect(planSliceWrite(empty, WIN, [sl(10, 60), sl(60, 90)], newId, NOW).error).toBeUndefined();     // touching is fine
    expect(planSliceWrite(empty, WIN, [sl(10, 60, { kind: 'party' })], newId, NOW).error).toBe('bad kind');
    expect(planSliceWrite(empty, WIN, [{ kind: 'raid', fromMs: 'soon', toMs: at(5) }], newId, NOW).error).toBe('bad time');
    expect(planSliceWrite(empty, WIN, 'nope', newId, NOW).error).toBeTruthy();
    expect(planSliceWrite(empty, WIN, Array.from({ length: MAX_PER_WRITE + 1 }, (_, i) => sl(i * 5, i * 5 + 4)), newId, NOW).error).toMatch(/at most/);
    expect(planSliceWrite(empty, { fromMs: at(0), toMs: at(2000) }, [], newId, NOW).error).toBe('bad window');
  });
  it('drops a slice that is empty once clipped, and repeats of an id get a new one', () => {
    const r = planSliceWrite(empty, WIN, [sl(600, 700), sl(10, 20, { id: 'dupe0001' }), sl(30, 40, { id: 'dupe0001' })], newId, NOW);
    expect(r.saved).toHaveLength(2);
    expect(r.saved[0].id).toBe('dupe0001');
    expect(r.saved[1].id).not.toBe('dupe0001');
  });
  it('a label is plain text of at most sixty characters', () => {
    expect(cleanLabel('  a\u0000b\n\tc  ')).toBe('a b c');
    expect(cleanLabel('x'.repeat(200))).toHaveLength(MAX_LABEL);
    expect(cleanLabel(undefined)).toBe('');
  });
  it('forgets slices older than the keep window', () => {
    const ancient = { id: 'ancient1', fromMs: NOW - (KEEP_DAYS + 5) * 86_400_000, toMs: NOW - (KEEP_DAYS + 4) * 86_400_000, kind: 'raid', label: '' };
    expect(planSliceWrite({ v: 1, s: [ancient] }, WIN, [sl(10, 20)], newId, NOW).store.s).toHaveLength(1);
  });
  it('reads a stored value defensively and finds the slices that touch a window', () => {
    const p = parseSliceStore({ v: 1, s: [{ id: 'good0001', fromMs: 5, toMs: 9, kind: 'event', label: 'ok' }, { id: 'BAD', fromMs: 1, toMs: 2, kind: 'raid' },
      { id: 'badkind1', fromMs: 1, toMs: 2, kind: 'nope' }, { id: 'rev00001', fromMs: 9, toMs: 3, kind: 'raid' }, null, 'x'] });
    expect(p.s.map(s => s.id)).toEqual(['good0001']);
    expect(parseSliceStore(null).s).toEqual([]);
    expect(parseSliceStore({ s: 'nope' }).s).toEqual([]);
    const all = [{ id: 'a0000001', fromMs: at(-10), toMs: at(5), kind: 'raid', label: '' }, { id: 'b0000001', fromMs: at(600), toMs: at(700), kind: 'raid', label: '' }];
    expect(slicesIn(all, WIN).map(s => s.id)).toEqual(['a0000001']);
  });
});

// ── 5. LOADER ────────────────────────────────────────────────────────────────────────────────────────────────
// A fake that answers by table, records the reads, and keeps ONE bot_kv row so a save can be checked end to end.
function fakeDb({ tables = {}, kv = null } = {}) {
  const db = { queries: [], kv };
  db.from = (table) => {
    const q = { table, ops: [], filters: {} };
    db.queries.push(q);
    const rec = (op) => (...a) => { q.ops.push([op, ...a]); if (op === 'eq') q.filters[a[0]] = a[1]; return b; };
    const rows = () => (table === 'bot_kv' ? (db.kv ? [db.kv] : []) : (tables[table] ?? []));
    const b = {
      select: rec('select'), eq: rec('eq'), is: rec('is'), or: rec('or'), in: rec('in'), gte: rec('gte'), lt: rec('lt'), order: rec('order'), range: rec('range'), limit: rec('limit'),
      maybeSingle() { return Promise.resolve({ data: rows()[0] ?? null, error: null }); },
      insert(v) { if (db.kv) return Promise.resolve({ error: { message: 'duplicate' } }); db.kv = v; return Promise.resolve({ error: null }); },
      update(v) { q.update = v; return b; },
      then(res, rej) {
        if (q.update) {
          const ok = db.kv && db.kv.updated_at === q.filters.updated_at;
          if (ok) db.kv = { ...db.kv, ...q.update };
          return Promise.resolve({ data: ok ? [{ key: 'k' }] : [], error: null }).then(res, rej);
        }
        return Promise.resolve({ data: rows(), error: null }).then(res, rej);
      },
    };
    return b;
  };
  return db;
}

describe('loadNightMarks (a fake database)', () => {
  const kills = [
    { id: 'e1', boss: true, name: 'Xuzl', zone: null, startMs: at(60), endMs: at(62), durationSec: 120, totalDamage: 1, top: [] },
    { id: 'e2', boss: false, name: 'a trash mob', zone: null, startMs: at(70), endMs: at(71), durationSec: 60, totalDamage: 1, top: [] },
  ];
  const stamp = (m, s = 0) => new Date(at(m) + s * 1000).toISOString();
  const dies = (names, m) => names.map((nm, i) => ({ name: nm, ts: stamp(m, i * 4), class: 'Cleric' }));
  const NAMES = ['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin'];
  const tables = {
    encounters: [{ id: 'e3', npc_id: 77, started_at: stamp(300), ended_at: stamp(307), duration_sec: 390, zone_short: 'podisease', classification: 'foreign', is_wipe: true, eqemu_npc_types: { name: '#Some_Boss' } }],
    bosses_local: [{ npc_id: 77 }],
    contributions: [
      { id: 'c1', encounter_id: 'e3', deaths: dies(NAMES, 305) },
      { id: 'c2', encounter_id: 'e3', deaths: dies(NAMES, 305).map(d => ({ ...d, ts: new Date(Date.parse(d.ts) + 2000).toISOString() })) },   // the same deaths, another uploader
      { id: 'c3', encounter_id: 'e2', deaths: [{ name: 'an orc pawn', ts: stamp(70), class: null }, { name: 'Aldenmar', ts: stamp(70, 5), class: 'Cleric' }] },
      { id: 'c4', encounter_id: 'e1', deaths: null },
    ],
  };

  it('returns the named fights (kills, and the marked wipe), the deaths as bare times, and one mass-death moment', async () => {
    const r = await loadNightMarks(fakeDb({ tables }), WIN, kills);
    expect(r.fights.map(f => [f.name, f.result, f.tag])).toEqual([['Xuzl', 'kill', null], ['Some Boss', 'wipe', 'foreign']]);
    expect(r.deaths).toHaveLength(7);                                    // six at the wipe (one view each), one in the trash fight; the NPC is dropped
    expect(r.deaths.every(Number.isFinite)).toBe(true);
    expect(r.mass).toHaveLength(1);
    expect(r.mass[0].count).toBe(6);
  });
  it('no name leaves it', async () => {
    const r = await loadNightMarks(fakeDb({ tables }), { fromMs: at(1), toMs: at(539) }, kills);
    const out = JSON.stringify(r);
    for (const nm of [...NAMES, 'orc pawn']) expect(out).not.toContain(nm);
  });
  it('reads only the marked fights and the deaths sub-array, every read on the window or on ids it returned', async () => {
    const db = fakeDb({ tables });
    await loadNightMarks(db, { fromMs: at(2), toMs: at(538) }, kills.slice());
    const enc = db.queries.find(q => q.table === 'encounters');
    expect(enc.ops.find(o => o[0] === 'or')[1]).toBe('classification.not.is.null,is_wipe.eq.true');
    expect(enc.ops.some(o => o[0] === 'gte' && o[1] === 'ended_at')).toBe(true);
    expect(enc.ops.some(o => o[0] === 'lt' && o[1] === 'ended_at')).toBe(true);
    const con = db.queries.find(q => q.table === 'contributions');
    expect(con.ops.find(o => o[0] === 'select')[1]).toBe('id, encounter_id, deaths:raw_parse->deaths');
    expect(con.ops.some(o => o[0] === 'in' && o[1] === 'encounter_id')).toBe(true);
    expect(con.ops.some(o => o[0] === 'order' && o[1] === 'id')).toBe(true);
  });
});

describe('saving slices (a fake database)', () => {
  const sl = (a, b) => ({ fromMs: at(a), toMs: at(b), kind: 'raid', label: 'x' });
  it('the first save inserts the row, a later one updates it with the stamp it read', async () => {
    const db = fakeDb();
    const a = await saveSlices(db, WIN, [sl(10, 50)], NOW, newId);
    expect(a.saved).toHaveLength(1);
    expect(db.kv.key).toBe('night_slices:wolfpack');
    const b = await saveSlices(db, WIN, [sl(10, 50), sl(60, 90)], NOW + 5000, newId);
    expect(b.saved).toHaveLength(2);
    expect(db.kv.value.s).toHaveLength(2);
    expect(db.queries.at(-1).filters.updated_at).toBeTruthy();
  });
  it('a save made on a stale read loses (conflict) and changes nothing', async () => {
    const db = fakeDb({ kv: { guild_id: 'wolfpack', key: 'night_slices:wolfpack', value: { v: 1, s: [] }, updated_at: '2026-10-23T08:00:00.000Z' } });
    const realFrom = db.from;
    let reads = 0;
    db.from = (t) => {
      const b = realFrom(t);
      if (t === 'bot_kv') {
        const mm = b.maybeSingle;
        b.maybeSingle = () => { const p = mm(); if (++reads === 1) db.kv = { ...db.kv, updated_at: '2026-10-23T08:30:00.000Z' }; return p; };   // someone else saves right after our read
      }
      return b;
    };
    const r = await saveSlices(db, WIN, [sl(10, 50)], NOW, newId);
    expect(r.conflict).toBe(true);
    expect(db.kv.value.s).toEqual([]);
  });
  it('a refused plan writes nothing', async () => {
    const db = fakeDb();
    const r = await saveSlices(db, WIN, [{ ...sl(10, 50), kind: 'party' }], NOW, newId);
    expect(r.error).toBe('bad kind');
    expect(db.kv).toBeNull();
  });
});

// ── 6. SOURCE ────────────────────────────────────────────────────────────────────────────────────────────────
const web = (...p) => stripJs(fs.readFileSync(path.join(ROOT, 'web', ...p), 'utf8'));

describe('where it is wired', () => {
  it('the default page reads nothing new: marks and slices load only for ?v=slices / ?v=segments', () => {
    const page = web('app', 'raid', 'session', 'page.tsx');
    expect(page).toMatch(/const nightVariant = v === 'slices' \|\| v === 'segments' \? v : null;/);
    expect(page).toMatch(/nightVariant \? loadSlices\(admin\)/);
    expect(page).toMatch(/nightVariant \? await loadNightMarks/);
    expect(page).toMatch(/nightPanel=\{nightVariant && marks \?/);
    expect(page).toMatch(/breaks: nightVariant === 'segments'/);
  });
  it('the share page never gets the night panel', () => {
    const share = fs.readdirSync(path.join(ROOT, 'web', 'app', 'share', 'raid', '[token]')).filter(f => f.endsWith('.tsx'));
    for (const f of share) expect(web('app', 'share', 'raid', '[token]', f)).not.toMatch(/nightPanel|NightPanel/);
  });
  it('the review only draws the panel for a member', () => {
    expect(web('app', 'raid', 'session', 'SessionReview.tsx')).toMatch(/const nightOn = !!nightPanel && mode\.kind === 'member';/);
  });
  it('the write is officers-only and same-origin, and goes through saveSlices', () => {
    const r = web('app', 'api', 'raid', 'slices', 'route.ts');
    expect(r).toMatch(/isOfficer\(user\.id\)/);
    expect(r).toMatch(/cross-site request/);
    expect(r).toMatch(/saveSlices\(supabaseAdmin\(\)/);
    expect(r.indexOf('isOfficer(')).toBeLessThan(r.indexOf('saveSlices('));
    expect(r).not.toMatch(/export async function (GET|POST|DELETE|PATCH)/);
  });
  it('the fight timeline route needs a signed-in member and renames opted-out characters before the curve is built', () => {
    const r = web('app', 'api', 'raid', 'session', 'fight-timeline', 'route.ts');
    expect(r).toMatch(/if \(!user\) return fail\(401/);
    const l = web('lib', 'raidFightTimeline.ts');
    expect(l.indexOf('anonName(anon, n)')).toBeGreaterThan(-1);
    expect(l.indexOf('buildFightCurve(safe')).toBeGreaterThan(l.indexOf('const safe'));
  });
  it('both editors save through the same panel hook, and both variants show the same fight list', () => {
    expect(web('app', 'raid', 'session', 'NightPanel.tsx')).toMatch(/<NightFights ctx=\{ctx\}/);
    expect(web('app', 'raid', 'session', 'SlicesEditor.tsx')).toMatch(/save\.run\(/);
    expect(web('app', 'raid', 'session', 'SegmentsEditor.tsx')).toMatch(/save\.run\(/);
  });
});
