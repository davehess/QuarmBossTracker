// test/replay-follow-split-bosses.test.js — the pure parts added to /spectator/replay: recorded targets, the
// split-screen rule, highlighting and following raiders (and the URL that carries it), and the killed-boss
// spawn points of nights recorded before targets existed.
//
// Names are invented (Aldenmar, Brackwyn, Corvale). The target fixtures are hand-built minute rows in the
// documented format (web/lib/raidReplay.ts header); the decoder tests also pin the axis swap, which a wrong
// decode would still draw plausibly. The split tests use a corpus on both sides of every threshold and walk
// time, so a rule that was never applied cannot pass.
//
// Run: npx vitest run test/replay-follow-split-bosses.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  decodeMinute, glideTargets, recentTargetNames, pickSplit, SPLIT_INIT, SPLIT_HOLD_MS, SPLIT_RESET_MS,
  SPLIT_MIN_RAIDERS, targetKey,
} from '../web/lib/raidReplay.ts';
import {
  parsePicks, picksSearch, togglePick, toggleFollow, isPicked, pickedSet, groupRoster, collectRoster, decayOffset,
  FOLLOW_SETTLED, MAX_PICKS, NO_PICKS,
} from '../web/lib/replayFollow.ts';
import {
  buildSpawnBosses, activeSpawns, normMobName, parseBosses, chunk, SPAWN_LINGER_MS, MAX_POINTS_PER_BOSS,
} from '../web/lib/replayBosses.ts';
import { ROOT, stripJs } from './_source-slice.js';

const T0 = Date.UTC(2026, 9, 14, 0, 30, 0);
const iso = (ms) => new Date(ms).toISOString();

// ── targets in the minute row ────────────────────────────────────────────────

const minute = (extra = {}) => ({
  minute_at: iso(T0),
  data: JSON.stringify({
    v: 1, step_s: 3,
    who: [['Aldenmar', 'Cleric', 1, 60], ['Brackwyn', 'Warrior', 1, 60]],
    zones: ['cazicthule', 'veksar'],
    f: [
      [0, 0, 100, 200, 5, 128, 80, 0, 1, -50, 75, 6, -1, -1, 0],
      [3, 0, 110, 205, 5, 128, 80, 0],
    ],
    ...extra,
  }),
});

describe('decodeMinute: targets', () => {
  const mobs = [['a grimling', 4411], ['Lord Nagafen', 0]];
  const mf = [
    [0, 0, 300, 400, 7, 3, 0],      // frame 0: a grimling, three raiders on it
    [0, 1, 10, 20, 0, 1, -1],       // frame 0: a mob with spawn id 0 and no zone
    [3, 0, 310, 410, 7, 2, 0],      // frame 1
    [9, 0, 1, 1, 1, 1, 0],          // dt 9 has no frame: nobody was placed then
  ];
  const frames = decodeMinute(minute({ mobs, mf }));

  it('hangs each target on the frame with the same dt, and drops one with no frame', () => {
    expect(frames.map(f => f.t)).toEqual([T0, T0 + 3000]);
    expect(frames[0].targets).toHaveLength(2);
    expect(frames[1].targets).toHaveLength(1);
  });

  it('puts the position in the SERVER frame like a raider: x is the recorded y', () => {
    const g = frames[0].targets.find(t => t.name === 'a grimling');
    expect(g).toMatchObject({ x: 400, y: 300, z: 7, n: 3, zone: 'cazicthule', sid: 4411 });
    // and the raider next to it was swapped the same way
    expect(frames[0].raiders.find(r => r.name === 'Aldenmar')).toMatchObject({ x: 200, y: 100 });
  });

  it('a spawn id of 0 is "none", and zone -1 is null', () => {
    const l = frames[0].targets.find(t => t.name === 'Lord Nagafen');
    expect(l.sid).toBeNull();
    expect(l.zone).toBeNull();
  });

  it('a row from before targets existed has no targets key, and decodes exactly as before', () => {
    const old = decodeMinute(minute());
    expect(old).toHaveLength(2);
    expect(old[0].targets).toBeUndefined();
    expect(old[0].raiders).toHaveLength(2);
  });

  it('a frame with no target at its dt has none, while another frame in the row does', () => {
    const f = decodeMinute(minute({ mobs, mf: [[3, 0, 310, 410, 7, 2, 0]] }));
    expect(f[0].targets).toBeUndefined();
    expect(f[1].targets).toHaveLength(1);
  });

  it('skips malformed entries without costing the frame, and ignores mf when mobs is not a list', () => {
    const bad = decodeMinute(minute({
      mobs: [['a grimling', 4411]],
      mf: [[0, 5, 1, 1, 1, 1, 0], [0], 'x', [0, 0, 'a', 2, 3, 1, 0], [0, 0, 5, 6, 7, 0, 0]],
    }));
    expect(bad).toHaveLength(2);
    expect(bad[0].targets).toHaveLength(1);         // only the last entry is well formed
    expect(bad[0].targets[0].n).toBe(1);            // n < 1 becomes 1
    expect(decodeMinute(minute({ mobs: 'nope', mf }))[0].targets).toBeUndefined();
  });
});

describe('targets over time', () => {
  const tg = (o) => ({ name: 'a grimling', sid: 5, x: 0, y: 0, z: 0, n: 1, zone: 'cazicthule', ...o });
  const fr = (t, targets) => ({ t, raiders: [], targets });

  it('glides a target between two frames, matched by spawn id', () => {
    const [g] = glideTargets(fr(0, [tg({})]), fr(3000, [tg({ x: 100 })]), 0.5, 200);
    expect(g.x).toBe(50);
  });

  it('does not glide a jump, a zone change, or a different spawn with the same name', () => {
    expect(glideTargets(fr(0, [tg({})]), fr(3000, [tg({ x: 1000 })]), 0.5, 200)[0].x).toBe(0);
    expect(glideTargets(fr(0, [tg({})]), fr(3000, [tg({ x: 10, zone: 'veksar' })]), 0.5, 200)[0].x).toBe(0);
    expect(glideTargets(fr(0, [tg({})]), fr(3000, [tg({ x: 10, sid: 6 })]), 0.5, 200)[0].x).toBe(0);
    expect(targetKey(tg({ sid: 5 }))).not.toBe(targetKey(tg({ sid: 6 })));
  });

  it('is empty with no frame or no targets', () => {
    expect(glideTargets(null, null, 0, 200)).toEqual([]);
    expect(glideTargets({ t: 0, raiders: [] }, null, 0, 200)).toEqual([]);
  });

  it('recentTargetNames looks back a window and no further', () => {
    const frames = [fr(0, [tg({ name: 'Old One' })]), fr(40_000, [tg({ name: 'Lord Nagafen' })]), fr(50_000, undefined)];
    expect([...recentTargetNames(frames, 2, 50_000, 30_000)]).toEqual(['Lord Nagafen']);
    expect([...recentTargetNames(frames, 2, 50_000, 60_000)].sort()).toEqual(['Lord Nagafen', 'Old One']);
  });
});

// ── the split-screen rule ────────────────────────────────────────────────────

const counts = (o) => new Map(Object.entries(o));
const S = 1000;

describe('pickSplit', () => {
  it('opens only when the second zone has at least 5 raiders AND a quarter of the busiest', () => {
    expect(pickSplit(counts({ a: 20, b: 5 }), 'a', SPLIT_INIT, T0).second).toBe('b');
    expect(pickSplit(counts({ a: 20, b: 4 }), 'a', SPLIT_INIT, T0).second).toBeNull();       // under 5
    expect(pickSplit(counts({ a: 40, b: 9 }), 'a', SPLIT_INIT, T0).second).toBeNull();       // 9 < 25% of 40
    expect(pickSplit(counts({ a: 40, b: 10 }), 'a', SPLIT_INIT, T0).second).toBe('b');
    expect(SPLIT_MIN_RAIDERS).toBe(5);
  });

  it('picks the busiest OTHER zone, ties to the name that sorts first, and never the primary', () => {
    expect(pickSplit(counts({ a: 20, b: 6, c: 9 }), 'a', SPLIT_INIT, T0).second).toBe('c');
    expect(pickSplit(counts({ a: 20, c: 8, b: 8 }), 'a', SPLIT_INIT, T0).second).toBe('b');
    // a pinned small primary: the second pane is the busiest zone, which is not the pin
    expect(pickSplit(counts({ a: 2, b: 30 }), 'a', SPLIT_INIT, T0).second).toBe('b');
    expect(pickSplit(counts({ a: 20 }), 'a', SPLIT_INIT, T0).second).toBeNull();
    expect(pickSplit(counts({ a: 20, b: 9 }), null, SPLIT_INIT, T0).second).toBeNull();
  });

  it('holds an open split for the hold time even when the second zone empties, then closes it', () => {
    let s = pickSplit(counts({ a: 20, b: 6 }), 'a', SPLIT_INIT, T0);
    expect(s.second).toBe('b');
    s = pickSplit(counts({ a: 26 }), 'a', s, T0 + 10 * S);
    expect(s.second).toBe('b');                                   // 10 s in: held
    s = pickSplit(counts({ a: 26 }), 'a', s, T0 + SPLIT_HOLD_MS - 1);
    expect(s.second).toBe('b');
    s = pickSplit(counts({ a: 26 }), 'a', s, T0 + SPLIT_HOLD_MS + S);
    expect(s.second).toBeNull();                                  // past the hold, nobody there: closed
  });

  it('an open split survives a dip between the open and keep thresholds, but not under the keep one', () => {
    const open = pickSplit(counts({ a: 20, b: 6 }), 'a', SPLIT_INIT, T0);
    const later = T0 + SPLIT_HOLD_MS + S;
    expect(pickSplit(counts({ a: 20, b: 3 }), 'a', open, later).second).toBe('b');   // 3 >= keep (3 and 15% of 20)
    expect(pickSplit(counts({ a: 20, b: 2 }), 'a', open, later).second).toBeNull();
    // a dip that would not have OPENED it (4 raiders) does not close it either
    expect(pickSplit(counts({ a: 20, b: 4 }), 'a', open, later).second).toBe('b');
  });

  it('a closed split stays closed for the hold time, so a zone that flaps does not flicker the layout', () => {
    let s = pickSplit(counts({ a: 20, b: 6 }), 'a', SPLIT_INIT, T0);
    s = pickSplit(counts({ a: 26 }), 'a', s, T0 + SPLIT_HOLD_MS + S);          // closes
    expect(s.second).toBeNull();
    const closedAt = T0 + SPLIT_HOLD_MS + S;
    s = pickSplit(counts({ a: 20, b: 9 }), 'a', s, closedAt + 10 * S);
    expect(s.second).toBeNull();                                               // qualifies again, too soon
    s = pickSplit(counts({ a: 20, b: 9 }), 'a', s, closedAt + SPLIT_HOLD_MS + S);
    expect(s.second).toBe('b');
  });

  it('swaps the second zone only after the hold and only when another has half again as many', () => {
    const open = pickSplit(counts({ a: 30, b: 8 }), 'a', SPLIT_INIT, T0);
    expect(pickSplit(counts({ a: 30, b: 8, c: 20 }), 'a', open, T0 + 5 * S).second).toBe('b');      // held
    const later = T0 + SPLIT_HOLD_MS + S;
    expect(pickSplit(counts({ a: 30, b: 8, c: 12 }), 'a', open, later).second).toBe('b');           // 12 <= 8 * 1.5
    expect(pickSplit(counts({ a: 30, b: 8, c: 13 }), 'a', open, later).second).toBe('c');
  });

  it('a scrub far from the last playhead starts fresh, so a seek lands on the right picture', () => {
    const closed = pickSplit(counts({ a: 26 }), 'a', pickSplit(counts({ a: 20, b: 6 }), 'a', SPLIT_INIT, T0), T0 + SPLIT_HOLD_MS + S);
    expect(closed.second).toBeNull();
    // 10 s after closing it would stay closed; a jump past the reset distance opens at once
    expect(pickSplit(counts({ a: 20, b: 9 }), 'a', closed, closed.lastT + SPLIT_RESET_MS + S).second).toBe('b');
    // and an open split does not hold a stale second zone across the jump
    const open = pickSplit(counts({ a: 20, b: 6 }), 'a', SPLIT_INIT, T0);
    expect(pickSplit(counts({ a: 20 }), 'a', open, T0 + SPLIT_RESET_MS + S).second).toBeNull();
  });

  it('a primary that is the current second zone (a pin, a follow) rebuilds the split instead of clashing', () => {
    const open = pickSplit(counts({ a: 20, b: 9 }), 'a', SPLIT_INIT, T0);
    const s = pickSplit(counts({ a: 20, b: 9 }), 'b', open, T0 + S);
    expect(s.second).toBe('a');
  });
});

// ── highlight, follow, and the URL ───────────────────────────────────────────

describe('picks in the URL', () => {
  it('round-trips follow, highlights and split', () => {
    const p = { follow: 'Aldenmar', hl: ['Aldenmar', 'Brackwyn', 'Corvale'], split: 'off' };
    const s = picksSearch(p);
    expect(s).toBe('?follow=Aldenmar&hl=Brackwyn%2CCorvale&split=off');
    expect(parsePicks(s)).toEqual(p);
  });

  it('writes nothing for no picks, keeps unrelated params, and replaces its own', () => {
    expect(picksSearch(NO_PICKS)).toBe('');
    expect(picksSearch(NO_PICKS, '?foo=1&follow=Old&hl=X&split=off')).toBe('?foo=1');
    expect(picksSearch({ ...NO_PICKS, hl: ['Brackwyn'] }, '?foo=1')).toBe('?foo=1&hl=Brackwyn');
  });

  it('parses leniently: dupes by case, blanks, control characters, too many, too long', () => {
    const p = parsePicks('?hl=Aldenmar,,aldenmar,%00,Brackwyn&follow=zz' + 'x'.repeat(40));
    expect(p.hl).toEqual(['Aldenmar', 'Brackwyn']);
    expect(p.follow).toBeNull();                                          // a 42-character "name" is dropped
    const many = parsePicks('?hl=' + Array.from({ length: 30 }, (_, i) => `N${i}`).join(','));
    expect(many.hl).toHaveLength(MAX_PICKS);
    expect(parsePicks('?split=banana').split).toBe('auto');
  });

  it('a follow name is highlighted too, and matched without case', () => {
    const p = parsePicks('?follow=aldenmar');
    expect(p.hl).toEqual(['aldenmar']);
    expect(isPicked(pickedSet(p), 'Aldenmar')).toBe(true);
    expect(isPicked(pickedSet(p), 'Brackwyn')).toBe(false);
  });
});

describe('picking and following', () => {
  it('the first pick is followed, later picks only highlighted', () => {
    let p = togglePick(NO_PICKS, 'Aldenmar');
    expect(p).toMatchObject({ follow: 'Aldenmar', hl: ['Aldenmar'] });
    p = togglePick(p, 'Brackwyn');
    expect(p).toMatchObject({ follow: 'Aldenmar', hl: ['Aldenmar', 'Brackwyn'] });
  });

  it('removing the followed pick follows the last one left, or nobody when several are left', () => {
    let p = togglePick(togglePick(NO_PICKS, 'Aldenmar'), 'Brackwyn');
    expect(togglePick(p, 'Aldenmar')).toMatchObject({ follow: 'Brackwyn', hl: ['Brackwyn'] });
    p = togglePick(p, 'Corvale');
    expect(togglePick(p, 'Aldenmar')).toMatchObject({ follow: null, hl: ['Brackwyn', 'Corvale'] });
    expect(togglePick(p, 'Brackwyn').follow).toBe('Aldenmar');              // a non-followed removal changes nothing else
  });

  it('toggleFollow moves the follow, highlights the raider, and can stop without un-highlighting', () => {
    let p = togglePick(togglePick(NO_PICKS, 'Aldenmar'), 'Brackwyn');
    p = toggleFollow(p, 'Brackwyn');
    expect(p.follow).toBe('Brackwyn');
    p = toggleFollow(p, 'Brackwyn');
    expect(p).toMatchObject({ follow: null, hl: ['Aldenmar', 'Brackwyn'] });
    expect(toggleFollow(NO_PICKS, 'Corvale')).toMatchObject({ follow: 'Corvale', hl: ['Corvale'] });
  });

  it('stops adding at the limit', () => {
    let p = NO_PICKS;
    for (let i = 0; i < MAX_PICKS + 3; i++) p = togglePick(p, `N${i}`);
    expect(p.hl).toHaveLength(MAX_PICKS);
  });
});

describe('the picker list', () => {
  const frames = [{ t: 0, raiders: [
    { name: 'Brackwyn', cls: 'Warrior' }, { name: 'Aldenmar', cls: 'Cleric' }, { name: 'Corvale', cls: 'Cleric' }, { name: 'Zarrin', cls: null },
  ] }];
  const roster = new Map();
  it('collects each raider once and reports whether anything was new', () => {
    expect(collectRoster(frames, roster)).toBe(true);
    expect(collectRoster(frames, roster)).toBe(false);
    expect(roster.size).toBe(4);
  });
  it('groups by class (classes A-Z, names A-Z) or as one alphabetical list', () => {
    const g = groupRoster(roster.values(), '', 'class');
    expect(g.map(x => x.label)).toEqual(['Cleric', 'Unknown class', 'Warrior']);
    expect(g[0].raiders.map(r => r.name)).toEqual(['Aldenmar', 'Corvale']);
    expect(groupRoster(roster.values(), '', 'alpha')[0].raiders.map(r => r.name)).toEqual(['Aldenmar', 'Brackwyn', 'Corvale', 'Zarrin']);
  });
  it('searches name or class without case, and an empty result has no groups', () => {
    expect(groupRoster(roster.values(), 'ALD', 'alpha')[0].raiders.map(r => r.name)).toEqual(['Aldenmar']);
    expect(groupRoster(roster.values(), 'cleric', 'alpha')[0].raiders).toHaveLength(2);
    expect(groupRoster(roster.values(), 'nobody', 'class')).toEqual([]);
  });
});

describe('the follow glide', () => {
  it('shrinks the offset, never overshoots, and lands exactly on the raider', () => {
    let o = { x: 400, y: -300 };
    let last = Math.hypot(o.x, o.y);
    let settled = false;
    for (let i = 0; i < 200 && !settled; i++) {
      o = decayOffset(o, 16);
      const d = Math.hypot(o.x, o.y);
      expect(d).toBeLessThanOrEqual(last);
      expect(Math.sign(o.x)).not.toBe(-1);                    // same side the whole way: no overshoot
      last = d;
      settled = o.x === 0 && o.y === 0;
    }
    expect(settled).toBe(true);
    expect(FOLLOW_SETTLED).toBeGreaterThan(0);
  });
  it('is frame-rate independent: two half steps equal one whole one', () => {
    const a = decayOffset(decayOffset({ x: 100, y: 50 }, 50), 50);
    const b = decayOffset({ x: 100, y: 50 }, 100);
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.y).toBeCloseTo(b.y, 6);
  });
  it('a zero offset stays zero', () => {
    expect(decayOffset({ x: 0, y: 0 }, 16)).toEqual({ x: 0, y: 0 });
  });
});

// ── bosses killed on the night, at their spawn points ────────────────────────

describe('buildSpawnBosses', () => {
  const enc = (o) => ({ npc_id: 1001, name: 'Lord_Aldenmar', zone_short: 'cazicthule', started_at: iso(T0), ended_at: iso(T0 + 60_000), ...o });
  const entries = [{ spawngroup_id: 7, npc_id: 1001 }, { spawngroup_id: 8, npc_id: 1002 }];
  const spawns = [
    { id: 70, spawngroup_id: 7, zone_short: 'cazicthule', x: 100, y: -200, z: 5 },
    { id: 71, spawngroup_id: 7, zone_short: 'cazicthule', x: 100.2, y: -200.3, z: 5 },   // the same spot, rounded
    { id: 72, spawngroup_id: 7, zone_short: 'veksar', x: 9, y: 9, z: 9 },
    { id: 80, spawngroup_id: 8, zone_short: 'veksar', x: 50, y: 60, z: null },
    { id: 81, spawngroup_id: 8, zone_short: 'veksar', x: null, y: 60, z: 1 },
  ];

  it('gives the spawn points untouched (the server frame is the raider frame) and a clean display name', () => {
    const [b] = buildSpawnBosses([enc({})], entries, spawns);
    expect(b.name).toBe('Lord Aldenmar');
    expect(b.points).toEqual([{ zone: 'cazicthule', x: 100, y: -200, z: 5 }]);   // zone filtered, duplicate merged
    expect(b.from).toBe(T0);
    expect(b.to).toBe(T0 + 60_000);
  });

  it('uses every zone when the encounter names none, skips unusable rows, and drops a boss with no place', () => {
    const out = buildSpawnBosses([enc({ zone_short: null }), enc({ npc_id: 1002, name: 'Brackwyn' }), enc({ npc_id: 9999, name: 'Nowhere' })], entries, spawns);
    expect(out.map(b => b.name)).toEqual(['Lord Aldenmar', 'Brackwyn']);
    expect(out[0].points.map(p => p.zone).sort()).toEqual(['cazicthule', 'veksar']);
    expect(out[1].points).toEqual([{ zone: 'veksar', x: 50, y: 60, z: 0 }]);     // null z -> 0; the null-x row is gone
  });

  it('keeps only the encounters that have a start and an end', () => {
    expect(buildSpawnBosses([enc({ ended_at: null }), enc({ started_at: 'junk' }), enc({ ended_at: iso(T0 - 1) })], entries, spawns)).toEqual([]);
  });

  it('caps the points a placeholder group can add', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: i, spawngroup_id: 7, zone_short: 'cazicthule', x: i * 50, y: 0, z: 0 }));
    expect(buildSpawnBosses([enc({})], entries, many)[0].points).toHaveLength(MAX_POINTS_PER_BOSS);
  });
});

describe('activeSpawns', () => {
  const boss = { npc_id: 1, name: 'Lord Aldenmar', from: T0, to: T0 + 60_000, points: [{ zone: 'cazicthule', x: 1, y: 2, z: 3 }, { zone: 'cazicthule', x: 4, y: 5, z: 6 }] };
  it('is on from the start of the fight to two minutes after the kill, and only then', () => {
    expect(activeSpawns([boss], T0 - 1, new Set())).toEqual([]);
    expect(activeSpawns([boss], T0, new Set())).toHaveLength(2);
    expect(activeSpawns([boss], T0 + 60_000 + SPAWN_LINGER_MS, new Set())).toHaveLength(2);
    expect(activeSpawns([boss], T0 + 60_000 + SPAWN_LINGER_MS + 1, new Set())).toEqual([]);
  });
  it('is hidden while a recorded target has the same name, however the names are dressed', () => {
    for (const seen of ['Lord_Aldenmar', '#Lord Aldenmar', 'lord  aldenmar']) {
      expect(activeSpawns([boss], T0 + 1000, new Set([normMobName(seen)]))).toEqual([]);
    }
    expect(activeSpawns([boss], T0 + 1000, new Set([normMobName('Brackwyn')]))).toHaveLength(2);
  });
});

describe('parseBosses', () => {
  it('keeps well-formed bosses and drops the rest', () => {
    const good = { npc_id: 1, name: 'Lord Aldenmar', from: 1, to: 2, points: [{ zone: 'z', x: 1, y: 2 }, { zone: 'z', x: 'bad', y: 2 }] };
    const out = parseBosses({ bosses: [good, { name: 5 }, null, { ...good, points: [] }, { ...good, from: 'x' }, { ...good, points: 'x' }] });
    expect(out).toHaveLength(2);   // the empty-points one stays: the local site's kills with no recorded position (the timeline wants them)
    expect(out[0].points).toEqual([{ zone: 'z', x: 1, y: 2, z: 0 }]);
    expect(out[1].points).toEqual([]);
    expect(parseBosses(null)).toEqual([]);
    expect(parseBosses({ bosses: 'x' })).toEqual([]);
  });
  it('chunk splits a list for a short URL', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});

describe('the bosses route', () => {
  const src = stripJs(fs.readFileSync(path.join(ROOT, 'web/app/api/spectator/replay/bosses/route.ts'), 'utf8'));
  it('is members-only, reads curated bosses and unclassified kills, and pages the big tables', () => {
    expect(src).toMatch(/auth\.getUser\(\)[\s\S]{0,120}return fail\(401/);
    expect(src).toMatch(/\.eq\('auto_registered', false\)/);
    expect(src).toMatch(/\.is\('classification', null\)/);
    expect(src).toMatch(/\.not\('ended_at', 'is', null\)/);
    expect(src).toMatch(/from\('eqemu_spawnentry'\)[\s\S]*?\.range\(from, to\)/);
    expect(src).toMatch(/from\('eqemu_spawn2'\)[\s\S]*?\.range\(from, to\)/);
  });
});
