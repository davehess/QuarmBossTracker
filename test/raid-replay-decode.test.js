// test/raid-replay-decode.test.js — the decoder behind /spectator/replay.
//
// The fixtures are built by the REAL encoder (utils/raidTrack.js buildMinuteRow), so the decoder is proven
// against the format the bot actually writes, not against a hand-copied picture of it. A wrong decode still
// draws a plausible map, which is why these pin the things a look would miss:
//   • the axis swap: the recorder stores loc_x/loc_y as received, the map wants the server frame (swapped);
//   • `who` indexes are per MINUTE, so two minutes that number the same raider differently must still
//     resolve to the same name;
//   • the "unknown" sentinels (heading -1, hp -1, zone -1) must come back as null, never as a real 0/-1;
//   • one corrupt minute must cost that minute only.
//
// Run: npx vitest run test/raid-replay-decode.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import {
  decodeMinute, decodeRows, majorityZone, pickReplayZone, zoneCounts, frameIndexAt, frameAt, summarizeNights,
  nextSpanStart, windowIndex, MINUTE_MS, REPLAY_WINDOW_MS, FRAME_GAP_MS,
} from '../web/lib/raidReplay.ts';

const require = createRequire(import.meta.url);
const { buildMinuteRow } = require('../utils/raidTrack.js');

// One minute starting at 2026-10-14T00:30:00Z (an evening in ET, so night_key is the 13th).
const T0 = Date.UTC(2026, 9, 14, 0, 30, 0);

// A raider as the recorder holds them in a frame (utils/raidTrack.js latest map entries).
const mk = (name, cls, o = {}) => ({
  name, cls, group: 1, level: 60, hp: 80, x: 100, y: 200, z: 5, h: 128, atMs: 0, src: 'u1', ...o,
});
const frame = (sec, rows) => ({ t: T0 + sec * 1000, rows });
const build = (start, frames, srcZone) => buildMinuteRow(start, frames, {
  guildId: 'wolfpack', excluded: new Set(), srcZone: new Map(Object.entries(srcZone || { u1: 'cazicthule' })),
});

describe('decodeMinute against the real encoder', () => {
  const row = build(T0, [
    frame(0, [mk('Aldenmar', 'Cleric', { x: 100, y: 200 }), mk('Brackwyn', 'Warrior', { x: -50, y: 75, h: null, hp: null })]),
    frame(3, [mk('Aldenmar', 'Cleric', { x: 110, y: 205 }), mk('Brackwyn', 'Warrior', { x: -40, y: 80, h: null, hp: null }),
      mk('Corvale', 'Wizard', { src: 'u2', x: 7, y: 9 })]),
  ], { u1: 'cazicthule', u2: 'veksar' });

  it('the encoder produced a v1 row', () => {
    expect(JSON.parse(row.data).v).toBe(1);
    expect(row.frames).toBe(2);
    expect(row.zones.sort()).toEqual(['cazicthule', 'veksar']);
  });

  const frames = decodeMinute(row);

  it('frames carry absolute times from dt', () => {
    expect(frames.map(f => f.t)).toEqual([T0, T0 + 3000]);
  });

  it('resolves who, class, group and level', () => {
    const a = frames[0].raiders.find(r => r.name === 'Aldenmar');
    expect(a).toMatchObject({ cls: 'Cleric', group: 1, level: 60, hp: 80, h: 128, zone: 'cazicthule' });
  });

  it('puts positions in the SERVER frame: server x is the recorded loc_y, server y is loc_x', () => {
    const a = frames[0].raiders.find(r => r.name === 'Aldenmar');
    expect(a.x).toBe(200);
    expect(a.y).toBe(100);
    expect(a.z).toBe(5);
  });

  it('turns the -1 sentinels into null', () => {
    const b = frames[0].raiders.find(r => r.name === 'Brackwyn');
    expect(b.h).toBeNull();
    expect(b.hp).toBeNull();
  });

  it('keeps each raider in the zone of the uploader that reported them', () => {
    const c = frames[1].raiders.find(r => r.name === 'Corvale');
    expect(c.zone).toBe('veksar');
    expect(frames[1].raiders.filter(r => r.zone === 'cazicthule').map(r => r.name).sort()).toEqual(['Aldenmar', 'Brackwyn']);
  });

  it('a sample with no known zone decodes to zone null', () => {
    const r = build(T0, [frame(0, [mk('Aldenmar', 'Cleric'), mk('Corvale', 'Wizard', { src: 'uX' })])], { u1: 'cazicthule' });
    const f = decodeMinute(r)[0];
    expect(f.raiders.find(x => x.name === 'Corvale').zone).toBeNull();
    expect(f.raiders.find(x => x.name === 'Aldenmar').zone).toBe('cazicthule');
  });
});

describe('who indexes are per minute', () => {
  it('two minutes that number a raider differently still resolve the same name', () => {
    const m1 = build(T0, [frame(0, [mk('Aldenmar', 'Cleric'), mk('Brackwyn', 'Warrior')])]);
    const m2 = build(T0 + MINUTE_MS, [{ t: T0 + MINUTE_MS + 1000, rows: [mk('Brackwyn', 'Warrior', { x: 1, y: 2 })] }]);
    expect(JSON.parse(m1.data).who[1][0]).toBe('Brackwyn');
    expect(JSON.parse(m2.data).who[0][0]).toBe('Brackwyn');   // index 0 here, 1 there
    const all = decodeRows([m2, m1]);                          // out of order on purpose
    expect(all.map(f => f.t)).toEqual([T0, T0 + MINUTE_MS + 1000]);
    expect(all[1].raiders[0]).toMatchObject({ name: 'Brackwyn', cls: 'Warrior', x: 2, y: 1 });
  });
});

describe('malformed rows are skipped, not thrown', () => {
  const good = build(T0, [frame(0, [mk('Aldenmar', 'Cleric')])]);
  it('bad JSON, another version, a bad time, a short frame', () => {
    expect(decodeMinute({ minute_at: good.minute_at, data: '{nope' })).toEqual([]);
    expect(decodeMinute({ minute_at: good.minute_at, data: JSON.stringify({ v: 2, who: [], f: [] }) })).toEqual([]);
    expect(decodeMinute({ minute_at: 'not a date', data: good.data })).toEqual([]);
    const d = JSON.parse(good.data);
    d.f.push([5, 0, 1, 2]);                       // a frame cut short: no complete raider in it
    d.f.push([6, 99, 1, 2, 3, 4, 5, 0]);          // an index with no `who` entry
    expect(decodeMinute({ minute_at: good.minute_at, data: JSON.stringify(d) }).length).toBe(1);
  });
  it('one bad minute does not cost the others', () => {
    const rows = [good, { minute_at: new Date(T0 + MINUTE_MS).toISOString(), data: 'garbage' }];
    expect(decodeRows(rows).length).toBe(1);
  });
});

describe('zones', () => {
  const r = (zone) => ({ i: 0, name: 'x', cls: null, group: null, level: null, x: 0, y: 0, z: 0, h: null, hp: null, zone });
  const fr = (zones) => ({ t: 0, raiders: zones.map(r) });

  it('majorityZone picks the head count, ignores null, ties go to the name that sorts first', () => {
    expect(majorityZone(fr(['a', 'b', 'b', null, null, null]))).toBe('b');
    expect(majorityZone(fr(['b', 'a']))).toBe('a');
    expect(majorityZone(fr([null, null]))).toBeNull();
    expect(zoneCounts(fr(['a', 'a', 'b'])).get('a')).toBe(2);
  });

  it('pickReplayZone keeps the current zone until another has half again as many', () => {
    const c = (o) => new Map(Object.entries(o));
    expect(pickReplayZone(c({ a: 10, b: 12 }), 'a')).toBe('a');
    expect(pickReplayZone(c({ a: 10, b: 15 }), 'a')).toBe('a');
    expect(pickReplayZone(c({ a: 10, b: 16 }), 'a')).toBe('b');
    expect(pickReplayZone(c({ b: 3 }), 'a')).toBe('b');        // the current zone emptied
    expect(pickReplayZone(c({ a: 1, b: 1 }), null)).toBe('a');
    expect(pickReplayZone(c({}), 'a')).toBeNull();
  });
});

describe('finding the frame at a time', () => {
  const fs = [0, 3, 6, 40].map(s => ({ t: T0 + s * 1000, raiders: [] }));
  it('frameIndexAt is the last frame at or before t', () => {
    expect(frameIndexAt(fs, T0 - 1)).toBe(-1);
    expect(frameIndexAt(fs, T0)).toBe(0);
    expect(frameIndexAt(fs, T0 + 5999)).toBe(1);
    expect(frameIndexAt(fs, T0 + 6000)).toBe(2);
    expect(frameIndexAt(fs, T0 + 99_000)).toBe(3);
    expect(frameIndexAt([], T0)).toBe(-1);
  });
  it('frameAt refuses a frame older than the gap', () => {
    expect(frameAt(fs, T0 + 7000)).toBe(fs[2]);
    expect(frameAt(fs, T0 + 6000 + FRAME_GAP_MS)).toBe(fs[2]);
    expect(frameAt(fs, T0 + 6000 + FRAME_GAP_MS + 1)).toBeNull();
    expect(frameAt(fs, T0 - 1)).toBeNull();
  });
});

describe('the night list', () => {
  const at = (min) => new Date(T0 + min * MINUTE_MS).toISOString();
  const rows = [
    // night A: 0-4 min in cazicthule, a 10 minute break, then 15-17 min in veksar; one minute with both zones
    ...[0, 1, 2, 3, 4].map(m => ({ night_key: '10/13/2026', minute_at: at(m), zones: ['cazicthule'] })),
    ...[15, 16].map(m => ({ night_key: '10/13/2026', minute_at: at(m), zones: ['veksar'] })),
    { night_key: '10/13/2026', minute_at: at(17), zones: ['veksar', 'cazicthule'] },
    // an older night, and a row with no night key (ignored)
    { night_key: '10/11/2026', minute_at: new Date(T0 - 2 * 86_400_000).toISOString(), zones: ['nro'] },
    { night_key: null, minute_at: at(1), zones: ['x'] },
  ];
  const [a, old] = summarizeNights(rows);

  it('newest night first; rows with no night are dropped', () => {
    expect(summarizeNights(rows).map(n => n.night_key)).toEqual(['10/13/2026', '10/11/2026']);
    expect(old.zones).toEqual(['nro']);
  });
  it('counts minutes and finds first and last', () => {
    expect(a.minutes).toBe(8);
    expect(a.first).toBe(at(0));
    expect(a.last).toBe(at(17));
  });
  it('splits a break out as two spans', () => {
    expect(a.spans).toEqual([
      { from: T0, to: T0 + 5 * MINUTE_MS },
      { from: T0 + 15 * MINUTE_MS, to: T0 + 18 * MINUTE_MS },
    ]);
  });
  it('lists zones in visit order, a zone seen again after a long gap is a second visit', () => {
    expect(a.zones).toEqual(['cazicthule', 'veksar']);
    expect(a.runs.map(r => [r.zone, (r.from - T0) / MINUTE_MS, (r.to - T0) / MINUTE_MS])).toEqual([
      ['cazicthule', 0, 5],
      ['veksar', 15, 18],
      ['cazicthule', 17, 18],
    ]);
  });
  it('nextSpanStart says whether t is inside, and where the next span begins', () => {
    expect(nextSpanStart(a.spans, T0 + MINUTE_MS)).toEqual({ inside: true, next: null });
    expect(nextSpanStart(a.spans, T0 + 8 * MINUTE_MS)).toEqual({ inside: false, next: T0 + 15 * MINUTE_MS });
    expect(nextSpanStart(a.spans, T0 + 30 * MINUTE_MS)).toEqual({ inside: false, next: null });
  });
  it('windowIndex counts 15-minute windows from the first minute', () => {
    expect(windowIndex(T0, T0)).toBe(0);
    expect(windowIndex(T0, T0 + REPLAY_WINDOW_MS - 1)).toBe(0);
    expect(windowIndex(T0, T0 + REPLAY_WINDOW_MS)).toBe(1);
    expect(windowIndex(T0, T0 - 5)).toBe(0);
  });
});
