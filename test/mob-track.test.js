// test/mob-track.test.js — the rules behind /spectator?v=b and ?v=c (web/lib/mobTrack.ts).
//
// Fixtures come from the REAL encoder (utils/raidTrack.js buildMinuteRow) and the REAL decoder (lib/raidReplay.ts), so
// the lanes are proven against the format the bot writes. Names are invented (Aldenmar is a raider, the mobs are
// catalog-style names). Corpora sit on both sides of every threshold so a rule that was never applied cannot pass.
//
// Run: npx vitest run test/mob-track.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { decodeRows, MINUTE_MS, REPLAY_WINDOW_MS } from '../web/lib/raidReplay.ts';
import {
  nightKeyOf, windowsBetween, readFrom, REREAD_MS, sightingsAt, liveEdge, buildMobLanes, laneFocusTime, lanePositionAt,
  buildMarkers, framePositions, SIGHTING_MS, SIGHTING_STALE_MS, PULL_MIN_N, MAX_MARKERS, BUCKET_MS,
} from '../web/lib/mobTrack.ts';

const require = createRequire(import.meta.url);
const { buildMinuteRow } = require('../utils/raidTrack.js');
const { nightKey: botNightKey } = require('../utils/raidNight.js');

const T0 = Date.UTC(2026, 9, 29, 0, 30, 0);   // an evening in ET: the night of the 28th
const raider = (name, o = {}) => ({ name, cls: 'Cleric', group: 1, level: 60, hp: 80, x: 100, y: 200, z: 5, h: 128, atMs: 0, src: 'u1', ...o });
const mob = (name, id, o = {}) => ({ name, id, x: 10, y: 20, z: 3, n: 1, zone: 'cazicthule', ...o });
const build = (start, frames) => buildMinuteRow(start, frames, { guildId: 'wolfpack', excluded: new Set(), srcZone: new Map([['u1', 'cazicthule']]) });
// frames at +0, +3, ... seconds into minute `m`, each with the mobs `f(sec)` returns
const minute = (m, f) => build(T0 + m * MINUTE_MS, [0, 3, 6, 9, 12, 15, 18, 21].map(sec => ({
  t: T0 + m * MINUTE_MS + sec * 1000, rows: [raider('Aldenmar')], mobs: f(sec),
})));
const frames = rows => decodeRows(rows.filter(Boolean));

describe('the night key and the read windows', () => {
  it('nightKeyOf is the bot\'s nightKey (rolls over at 06:00 Eastern, MM/DD/YYYY)', () => {
    for (const t of [T0, Date.UTC(2026, 9, 29, 9, 59, 0), Date.UTC(2026, 9, 29, 10, 0, 0), Date.UTC(2026, 2, 8, 6, 30, 0), Date.UTC(2026, 10, 1, 4, 30, 0)]) {
      expect(nightKeyOf(t)).toBe(botNightKey(t));
    }
    expect(nightKeyOf(Date.UTC(2026, 9, 29, 9, 59, 0))).toBe('10/28/2026');
    expect(nightKeyOf(Date.UTC(2026, 9, 29, 10, 0, 0))).toBe('10/29/2026');
  });

  it('windowsBetween cuts on minute edges into pieces the route will accept', () => {
    const w = windowsBetween(T0 + 20_000, T0 + 40 * MINUTE_MS + 5_000);
    expect(w[0].from).toBe(T0);
    expect(w.every(x => x.from % MINUTE_MS === 0 && x.to - x.from <= REPLAY_WINDOW_MS)).toBe(true);
    expect(w[w.length - 1].to).toBe(T0 + 41 * MINUTE_MS);
    for (let i = 1; i < w.length; i++) expect(w[i].from).toBe(w[i - 1].to);
    expect(windowsBetween(T0, T0)).toEqual([]);
  });

  it('readFrom goes back the lookback the first time and re-covers a few minutes after that, never past the lookback', () => {
    const now = T0 + 60 * MINUTE_MS;
    expect(readFrom(now, 30 * MINUTE_MS, null)).toBe(T0 + 30 * MINUTE_MS);
    expect(readFrom(now, 30 * MINUTE_MS, now - MINUTE_MS)).toBe(now - MINUTE_MS - REREAD_MS);
    expect(readFrom(now, 30 * MINUTE_MS, now - 50 * MINUTE_MS)).toBe(T0 + 30 * MINUTE_MS);
  });
});

describe('sightingsAt: the mobs on the map at one instant', () => {
  // The spawn 101 is targeted in the first 9 s only; 202 for the whole minute.
  const fr = frames([minute(0, sec => [
    ...(sec <= 9 ? [mob('a Brackwyn Forager', 101, { x: 1, y: 2 })] : []),
    mob('Lord Corvale', 202, { x: 50, y: 60, n: 4 }),
  ])]);

  it('keeps a mob that is targeted in some frames and not others for SIGHTING_MS, then lets it go', () => {
    const at = T0 + 21_000;   // 12 s after spawn 101's last sample
    expect(sightingsAt(fr, at).map(d => d.sid).sort()).toEqual([101, 202]);
    const late = sightingsAt(fr, T0 + 9_000 + SIGHTING_MS + 3_000 + 1);
    expect(late.map(d => d.sid)).toEqual([202]);
  });

  it('reports the newest position, the targeter count and the age of the sample', () => {
    const d = sightingsAt(fr, T0 + 21_000).find(x => x.sid === 202);
    expect(d).toMatchObject({ name: 'Lord Corvale', n: 4, ageMs: 0, zone: 'cazicthule' });
    // serverXY swap: the recorder writes the mob's server x,y swapped back, the decoder swaps again, so the round trip is exact
    expect([d.x, d.y]).toEqual([50, 60]);
    expect(sightingsAt(fr, T0 + 21_000).find(x => x.sid === 101).ageMs).toBe(12_000);
  });

  it('is empty before the first frame', () => {
    expect(sightingsAt(fr, T0 - 1)).toEqual([]);
    expect(sightingsAt([], T0)).toEqual([]);
  });

  it('marks a boss and its death: dead only once the kill has happened, and not for last pull\'s kill', () => {
    const kill = { name: 'Lord_Corvale', atMs: T0 + 15_000 };   // Zeal spells it with underscores
    expect(sightingsAt(fr, T0 + 12_000, [kill]).find(x => x.sid === 202)).toMatchObject({ boss: true, dead: false });
    expect(sightingsAt(fr, T0 + 21_000, [kill]).find(x => x.sid === 202)).toMatchObject({ boss: true, dead: true });
    expect(sightingsAt(fr, T0 + 21_000, [kill]).find(x => x.sid === 101)).toMatchObject({ boss: false, dead: false });
    // an hour-old kill of the same name is a different pull
    expect(sightingsAt(fr, T0 + 21_000, [{ name: 'Lord Corvale', atMs: T0 - 3_600_000 }]).find(x => x.sid === 202).dead).toBe(false);
  });

  it('liveEdge is the newest sample, or null once the record is older than SIGHTING_STALE_MS', () => {
    const last = fr[fr.length - 1].t;
    expect(liveEdge(fr, last + 60_000)).toBe(last);
    expect(liveEdge(fr, last + SIGHTING_STALE_MS)).toBe(last);
    expect(liveEdge(fr, last + SIGHTING_STALE_MS + 1)).toBeNull();
    expect(liveEdge([], T0)).toBeNull();
  });
});

describe('buildMobLanes: one row per name, spawns inside it', () => {
  // minute 0-1: a swarm of three same-name spawns with one targeter each, then a boss with four, killed in minute 2.
  const rows = [
    minute(0, () => [mob('a Shik\'nar Forager', 1), mob('a Shik\'nar Forager', 2), mob('a Shik\'nar Forager', 3)]),
    minute(1, () => [mob('a Shik\'nar Forager', 2)]),
    minute(2, sec => (sec < 12 ? [mob('Lord Corvale', 900, { n: 5, x: 77, y: 88 })] : [])),
  ];
  const fr = frames(rows);
  const kill = { name: 'Lord Corvale', atMs: T0 + 2 * MINUTE_MS + 13_000 };
  const lanes = buildMobLanes(fr, [kill]);

  it('folds a swarm into one lane with a spawn each, and keeps a spawn id as one mob', () => {
    const swarm = lanes.find(l => l.key === 'a shik\'nar forager');
    expect(swarm.spawns.map(s => s.sid).sort()).toEqual([1, 2, 3]);
    expect(swarm.spawns.find(s => s.sid === 2).last).toBe(T0 + MINUTE_MS + 21_000);
    expect(swarm.spawns.find(s => s.sid === 1).last).toBe(T0 + 21_000);
    expect(swarm.boss).toBe(false);
    expect(swarm.killedAt).toBeNull();
    // the bucket with all three at once counts three spawns; the later one counts one
    expect(swarm.buckets[0].spawns).toBe(3);
    expect(swarm.buckets[swarm.buckets.length - 1].spawns).toBe(1);
    expect(swarm.buckets.every(b => b.t % BUCKET_MS === 0)).toBe(true);
  });

  it('matches a kill to its lane by name, and puts killed bosses first', () => {
    expect(lanes[0]).toMatchObject({ name: 'Lord Corvale', boss: true, killedAt: kill.atMs, peakN: 5 });
    expect(lanes[1].name).toBe('a Shik\'nar Forager');
  });

  it('ignores a kill that is not near the lane\'s span', () => {
    const far = buildMobLanes(fr, [{ name: 'Lord Corvale', atMs: T0 + 2 * MINUTE_MS + 30 * MINUTE_MS }]);
    expect(far.find(l => l.key === 'lord corvale')).toMatchObject({ boss: false, killedAt: null });
  });

  it('is empty for frames with no targets (rows recorded before targets existed)', () => {
    expect(buildMobLanes(frames([build(T0, [{ t: T0, rows: [raider('Aldenmar')], mobs: [] }])]))).toEqual([]);
  });

  it('laneFocusTime: the kill for a boss, the first hard pull for a mob, else its start', () => {
    const boss = lanes[0];
    expect(laneFocusTime(boss)).toBe(Math.min(kill.atMs, boss.to));
    const swarm = lanes.find(l => !l.boss);
    expect(laneFocusTime(swarm)).toBe(swarm.from);   // never 3 on one spawn, so no pull
    const pulled = buildMobLanes(frames([minute(0, sec => [mob('a Zarrin Wisp', 7, { n: sec >= 6 ? PULL_MIN_N : PULL_MIN_N - 1 })])]));
    expect(laneFocusTime(pulled[0])).toBe(Math.floor((T0 + 6_000) / BUCKET_MS) * BUCKET_MS);
  });

  it('lanePositionAt: the last sample at or before the time, else the first after', () => {
    expect(lanePositionAt(fr, 'lord corvale', T0 + 2 * MINUTE_MS + 20_000)).toMatchObject({ x: 77, y: 88 });
    expect(lanePositionAt(fr, 'lord corvale', T0)).toMatchObject({ x: 77, y: 88 });   // before it appeared: the first sighting
    expect(lanePositionAt(fr, 'nobody here', T0)).toBeNull();
    expect(lanePositionAt(fr, 'a shik\'nar forager', T0 + 2_000, 3)).toMatchObject({ sid: 3 });
  });
});

describe('buildMarkers: the moments worth a click', () => {
  const rows = [
    minute(0, () => [mob('Lord Corvale', 900, { n: 5 }), mob('a Shik\'nar Forager', 1, { n: PULL_MIN_N }), mob('a Rethlan Guard', 2, { n: PULL_MIN_N - 1 })]),
  ];
  const fr = frames(rows);
  const kills = [{ name: 'Lord Corvale', atMs: T0 + 20_000 }, { name: 'Somebody Far Away', atMs: T0 + 99 * MINUTE_MS }];

  it('has a kill, a pull for a mob that reached the threshold, and neither for one that did not', () => {
    const lanes = buildMobLanes(fr, kills);
    const m = buildMarkers(fr, lanes, kills, T0, T0 + 60_000);
    expect(m.filter(x => x.kind === 'kill').map(x => x.label)).toEqual(['Lord Corvale']);
    expect(m.filter(x => x.kind === 'pull').map(x => x.label)).toEqual(['a Shik\'nar Forager']);
    // the boss's pull is its kill's business
    expect(m.some(x => x.kind === 'pull' && x.lane === 'lord corvale')).toBe(false);
  });

  it('marks a zone change, and caps the list keeping every kill', () => {
    const zoned = frames([
      build(T0, [0, 3].map(s => ({ t: T0 + s * 1000, rows: [raider('Aldenmar')], mobs: [] }))),
      buildMinuteRow(T0 + MINUTE_MS, [{ t: T0 + MINUTE_MS, rows: [raider('Aldenmar', { src: 'u2' })], mobs: [] }],
        { guildId: 'wolfpack', excluded: new Set(), srcZone: new Map([['u2', 'gfaydark']]) }),
    ]);
    const z = buildMarkers(zoned, [], [], T0, T0 + 2 * MINUTE_MS).filter(x => x.kind === 'zone');
    expect(z).toHaveLength(1);
    expect(z[0].label).toBe('gfaydark');

    const many = Array.from({ length: 30 }, (_, i) => ({ name: `Boss ${i}`, atMs: T0 + i * 1000 }));
    const lanes = Array.from({ length: 30 }, (_, i) => ({ key: `mob ${i}`, name: `Mob ${i}`, spawns: [{}], peakN: 9, buckets: [{ t: T0 + i * 1000, n: 9, spawns: 1 }] }));
    const capped = buildMarkers(fr, lanes, many.slice(0, 5), T0, T0 + 60_000);
    expect(capped.length).toBeLessThanOrEqual(MAX_MARKERS);
    expect(capped.filter(x => x.kind === 'kill')).toHaveLength(5);
    expect(capped.map(x => x.t)).toEqual([...capped.map(x => x.t)].sort((a, b) => a - b));
  });
});

describe('framePositions: a recorded frame as the board\'s own feed', () => {
  it('makes Raiders the board can draw, counts zones, and counts a raider with no zone as unplaced', () => {
    const fr = frames([build(T0, [{ t: T0, rows: [raider('Aldenmar'), raider('Brackwyn', { src: 'nowhere' })], mobs: [] }])]);
    const p = framePositions(fr[0], new Map([['cazicthule', 'Plane of Fear']]));
    expect(p.raiders).toHaveLength(1);
    expect(p.raiders[0]).toMatchObject({ name: 'Aldenmar', zone: 'cazicthule', age_s: 0, heading: 128 });
    expect(p.zones).toEqual([{ zone: 'cazicthule', name: 'Plane of Fear', count: 1 }]);
    expect(p.unplaced).toBe(1);
    // no long name known: the short one stands in
    expect(framePositions(fr[0]).zones[0].name).toBe('cazicthule');
  });
});

describe('lane order', () => {
  it('after bosses, the mob the most raiders had targeted comes first, then the bigger swarm', () => {
    const fr = frames([minute(0, () => [
      mob('a Nyssara Wisp', 1, { n: 2 }), mob('a Brackwyn Bat', 2, { n: 6 }),
      mob('a Corvale Rat', 3, { n: 2 }), mob('a Corvale Rat', 4, { n: 2 }),
    ])]);
    expect(buildMobLanes(fr).map(l => l.name)).toEqual(['a Brackwyn Bat', 'a Corvale Rat', 'a Nyssara Wisp']);
  });
});
