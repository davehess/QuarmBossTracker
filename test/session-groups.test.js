// test/session-groups.test.js — which raid is which inside one recorded window (web/lib/sessionGroups.ts), the filter
// that narrows a session review to one of them, and the recorder's raid stamp (utils/raidTrack.js).
// The report (the guild lead, 2026-10-26): slicing the night's last stretch "is still showing characters from the
// previous raid in it, because there were multiple raids active at that timeframe".
//
//   1. GROUPS     two raids in the same zone told apart by the stamp; two in different zones told apart by zone alone;
//                 one raid that changes zone stays one; a raider who switches raids does not weld two raids together;
//                 stragglers are not raids; an uploader with no stamp still gets a group of its own.
//   2. FILTER     narrowing a minute keeps only the group's raiders, reindexes the frames, drops a minute the group
//                 is absent from; attendance computed on the narrowed rows counts only the group.
//   3. LABELS     "Raid of N · led by <leader>", an opted-out leader is their label, the ids are opaque.
//   4. FIGHTS     a fight belongs to the group that holds at least half of its damage dealers.
//   5. RECORDER   the bot stamps each raider with the raid of the uploader that saw them, and the key it writes is
//                 the key the site hashes.
//
// Names are invented tokens. Source assertions run on comment-stripped text.
// Run: npx vitest run test/session-groups.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, stripJs } from './_source-slice.js';
import {
  buildGroups, filterMinuteData, groupLabel, groupOfFight, hasConcurrent, inGroupAt, inGroupEver, narrowRows, outsideRaids, raidKey,
  MIN_GROUP, SAME_RAID,
} from '../web/lib/sessionGroups.ts';
import { attendanceFromMinutes, anonLabels } from '../web/lib/raidSession.ts';
import { loadNightMarks } from '../web/lib/nightSlicesLoad.ts';

const require = createRequire(import.meta.url);
const T0 = Date.parse('2026-10-23T04:07:00Z');
const MIN = 60_000;

const crew = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

/**
 * One minute row. `parts`: [{ zone, tag?, names }] — every name in a part is placed in the part's zone, in two
 * frames; a part's `tag` is the raid leader's name (the recorder writes its hash, as `raids[i]`).
 */
function row(minuteIdx, parts) {
  const who = [], zones = [], raids = [], f1 = [0], f2 = [30];
  for (const p of parts) {
    let zi = zones.indexOf(p.zone);
    if (zi < 0) { zi = zones.length; zones.push(p.zone); }
    let ri = -1;
    if (p.tag) { const k = raidKey(p.tag); ri = raids.indexOf(k); if (ri < 0) { ri = raids.length; raids.push(k); } }
    for (const n of p.names) {
      const i = who.length;
      who.push(ri >= 0 ? [n, 'WAR', 1, 60, ri] : [n, 'WAR', 1, 60]);
      for (const fr of [f1, f2]) fr.push(i, 10 + i, 20, 0, 100, 90, zi);
    }
  }
  const data = JSON.stringify({ v: 1, step_s: 3, who, zones, f: [f1, f2], ...(raids.length ? { raids } : {}) });
  return { minute_at: new Date(T0 + minuteIdx * MIN).toISOString(), zones, data };
}
const span = (a, b, fn) => Array.from({ length: b - a }, (_, k) => row(a + k, fn(a + k)));

const A = crew('Aldenmar', 12);        // 12 raiders
const B = crew('Brackwyn', 9);         // 9 raiders

describe('buildGroups', () => {
  it('tells two raids standing in the SAME zone apart by the raid stamp', () => {
    const rows = span(0, 30, () => [
      { zone: 'codecay', tag: 'Corvale', names: A },
      { zone: 'codecay', tag: 'Rethlan', names: B },
    ]);
    const idx = buildGroups(rows);
    expect(idx.groups.map(g => g.size)).toEqual([12, 9]);
    expect(idx.groups.every(g => g.tagged)).toBe(true);
    expect(hasConcurrent(idx.groups)).toBe(true);
    const [big, small] = idx.groups;
    expect(inGroupEver(idx, big.id, 'aldenmar1')).toBe(true);
    expect(inGroupEver(idx, big.id, 'brackwyn1')).toBe(false);
    expect(inGroupEver(idx, small.id, 'brackwyn1')).toBe(true);
  });

  it('names the leader when the leader was placed, and the id comes from the stamp (stable, opaque)', () => {
    const lead = 'Corvale';
    const rows = span(0, 10, () => [{ zone: 'codecay', tag: lead, names: [lead, ...A.slice(0, 7)] }]);
    const [g] = buildGroups(rows).groups;
    expect(g.leader).toBe('Corvale');
    expect(g.id).toBe('r' + raidKey(lead));
    expect(groupLabel(g)).toBe('Raid of 8 · led by Corvale');
    expect(g.id).not.toMatch(/corvale/i);
  });

  it('with no stamp, two raids in different zones are two groups; the zone stands in', () => {
    const rows = span(0, 20, () => [{ zone: 'podisease', names: A }, { zone: 'potranquility', names: B }]);
    const idx = buildGroups(rows);
    expect(idx.groups.map(g => [g.size, g.zones[0], g.tagged])).toEqual([[12, 'podisease', false], [9, 'potranquility', false]]);
    expect(groupLabel(idx.groups[1])).toBe('Raid of 9 · in potranquility');
  });

  it('one raid that moves zone is still ONE group', () => {
    const rows = [
      ...span(0, 10, () => [{ zone: 'podisease', names: A }]),
      ...span(10, 20, () => [{ zone: 'codecay', names: A }]),
    ];
    const idx = buildGroups(rows);
    expect(idx.groups).toHaveLength(1);
    expect(idx.groups[0].zones.sort()).toEqual(['codecay', 'podisease']);
  });

  it('a raider who switches raids is in each group for the minutes he was in it, and does not weld the two together', () => {
    const switcher = 'Nyssara';
    const rows = [
      ...span(0, 12, () => [{ zone: 'x', tag: 'Corvale', names: [...A, switcher] }, { zone: 'x', tag: 'Rethlan', names: B }]),
      ...span(12, 24, () => [{ zone: 'x', tag: 'Corvale', names: A }, { zone: 'x', tag: 'Rethlan', names: [...B, switcher] }]),
    ];
    const idx = buildGroups(rows);
    expect(idx.groups).toHaveLength(2);
    const a = idx.groups.find(g => g.id === 'r' + raidKey('Corvale'));
    const b = idx.groups.find(g => g.id === 'r' + raidKey('Rethlan'));
    expect(a && b).toBeTruthy();
    const at = i => T0 + i * MIN;
    expect(inGroupAt(idx, a.id, 'nyssara', at(3))).toBe(true);
    expect(inGroupAt(idx, b.id, 'nyssara', at(3))).toBe(false);
    expect(inGroupAt(idx, b.id, 'nyssara', at(18))).toBe(true);
    expect(inGroupAt(idx, a.id, 'nyssara', at(18))).toBe(false);
  });

  it('with no stamp, a raider alone in a third zone between two raids does not weld them together', () => {
    const sw = 'Nyssara';
    const rows = [
      ...span(0, 10, () => [{ zone: 'podisease', names: [...A, sw] }, { zone: 'potranquility', names: B }]),
      ...span(10, 11, () => [{ zone: 'podisease', names: A }, { zone: 'potranquility', names: B }, { zone: 'poknowledge', names: [sw] }]),   // zoning through
      ...span(11, 21, () => [{ zone: 'podisease', names: A }, { zone: 'potranquility', names: [...B, sw] }]),
    ];
    expect(buildGroups(rows).groups.map(g => g.size)).toEqual([12, 9]);
  });

  it('untagged raiders (an uploader that sent no roster rank) do not merge into a stamped raid', () => {
    const rows = span(0, 15, () => [
      { zone: 'codecay', tag: 'Corvale', names: A },
      { zone: 'potranquility', names: B },          // seen by an uploader with no stamp
    ]);
    const idx = buildGroups(rows);
    expect(idx.groups.map(g => g.tagged)).toEqual([true, false]);
    expect(idx.groups.map(g => g.size)).toEqual([12, 9]);
  });

  it('a handful of raiders, or a few minutes, is a straggler and not a raid', () => {
    const few = span(0, 20, () => [{ zone: 'pofire', names: crew('Zarrin', MIN_GROUP - 1) }]);
    const brief = span(0, 3, () => [{ zone: 'pofire', names: crew('Zarrin', 12) }]);
    expect(buildGroups(few).groups).toEqual([]);
    expect(buildGroups(brief).groups).toEqual([]);
  });

  it('a long gap in the recording ends a group; the crew coming back is a second group', () => {
    const rows = [...span(0, 10, () => [{ zone: 'x', names: A }]), ...span(20, 30, () => [{ zone: 'x', names: A }])];
    expect(buildGroups(rows).groups).toHaveLength(2);
  });

  it('a crew that is mostly replaced (under the shared share) is a different group', () => {
    const half = Math.floor(A.length * (1 - SAME_RAID)) - 1;   // fewer shared than SAME_RAID of the smaller side
    const next = [...A.slice(0, half), ...crew('Corvale', A.length - half)];
    const rows = [...span(0, 12, () => [{ zone: 'x', names: A }]), ...span(12, 24, () => [{ zone: 'x', names: next }])];
    expect(buildGroups(rows).groups).toHaveLength(2);
  });

  it('ids differ between groups, and an opted-out leader shows as their label', () => {
    const rows = span(0, 10, () => [{ zone: 'x', tag: 'Corvale', names: ['Corvale', ...A.slice(0, 8)] }, { zone: 'x', tag: 'Rethlan', names: B }]);
    const anon = anonLabels([{ name: 'Corvale', class: 'Cleric', exclude_from_stats: true }]);
    const idx = buildGroups(rows, anon);
    expect(new Set(idx.groups.map(g => g.id)).size).toBe(2);
    expect(idx.groups.find(g => g.id === 'r' + raidKey('Corvale')).leader).toBe('Cleric 1');
    expect(idx.groups.find(g => g.id === 'r' + raidKey('Rethlan')).leader).toBeNull();   // not placed, so no name to show
  });
});

describe('narrowing a review to one group', () => {
  const rows = span(0, 20, () => [
    { zone: 'codecay', tag: 'Corvale', names: A },
    { zone: 'codecay', tag: 'Rethlan', names: B },
  ]);
  const idx = buildGroups(rows);
  const mine = idx.groups.find(g => g.size === 9);

  it('keeps only the group in who and in the frames, with indexes repointed', () => {
    const narrow = narrowRows(rows, idx, mine.id);
    expect(narrow).toHaveLength(20);
    const d = JSON.parse(narrow[0].data);
    expect(d.who.map(w => w[0])).toEqual(B);
    expect(d.f[0].length).toBe(1 + 7 * B.length);
    expect(d.f[0][1]).toBe(0);   // first tuple points at who[0]
    expect(d.f[0].filter((_, k) => k > 0 && (k - 1) % 7 === 0).every(i => i < B.length)).toBe(true);
  });

  it('attendance on the narrowed rows counts the group only', () => {
    const all = attendanceFromMinutes(rows, new Map());
    const some = attendanceFromMinutes(narrowRows(rows, idx, mine.id), new Map());
    expect(all).toHaveLength(A.length + B.length);
    expect(some.map(r => r.name).sort()).toEqual([...B].sort());
    expect(some.every(r => r.minutes === 20)).toBe(true);
  });

  it('drops a minute the group is not in, and returns null for a blob it cannot read', () => {
    const gapRows = [...span(0, 10, () => [{ zone: 'x', names: A }]), ...span(10, 12, () => [{ zone: 'x', names: B }]), ...span(12, 20, () => [{ zone: 'x', names: A }])];
    const gi = buildGroups(gapRows);
    const g = gi.groups[0];
    const out = narrowRows(gapRows, gi, g.id);
    expect(out).toHaveLength(18);
    expect(filterMinuteData('not json', new Set(['a']))).toBeNull();
    expect(filterMinuteData(rows[0].data, new Set())).toBeNull();
    expect(filterMinuteData(rows[0].data, undefined)).toBeNull();
  });

  it('a group id that is not in the window narrows to nothing, never to everyone', () => {
    expect(narrowRows(rows, idx, 'rdeadbeef')).toEqual([]);
  });
});

describe('which group a fight belongs to', () => {
  const rows = span(0, 20, () => [{ zone: 'x', tag: 'Corvale', names: A }, { zone: 'x', tag: 'Rethlan', names: B }]);
  const idx = buildGroups(rows);
  const gA = idx.groups.find(g => g.size === 12), gB = idx.groups.find(g => g.size === 9);
  const t = T0 + 5 * MIN;
  it('is the group holding at least half of the damage dealers', () => {
    expect(groupOfFight(idx, t, ['aldenmar1', 'aldenmar2', 'aldenmar3', 'brackwyn1'])).toBe(gA.id);
    expect(groupOfFight(idx, t, ['brackwyn1', 'brackwyn2', 'brackwyn3', 'aldenmar1'])).toBe(gB.id);
  });
  it('is none when nobody in it is known, or when the dealers split with no majority', () => {
    expect(groupOfFight(idx, t, ['stranger1', 'stranger2'])).toBeNull();
    expect(groupOfFight(idx, t, ['aldenmar1', 'brackwyn1', 'stranger1', 'stranger2'])).toBeNull();
    expect(groupOfFight(idx, t, [])).toBeNull();
  });
});

// The guild lead, 2026-10-30: a two-person raid's Growth and Lord of Ire kills sat in the Storms raid's session, "It's
// included in here, but shouldn't be". The pair stood in a raid of their own, too small to be a group.
describe('a fight from none of the window\'s raids leaves the whole-window view', () => {
  const pair = ['Zarrin1', 'Zarrin2'];
  const rows = span(0, 20, () => [{ zone: 'postorms', tag: 'Corvale', names: A }, { zone: 'growthplane', tag: 'Nyssara', names: pair }]);
  const idx = buildGroups(rows);
  const recorded = new Set(rows.map(r => Math.floor(Date.parse(r.minute_at) / MIN)));
  const t = T0 + 5 * MIN;
  it('the pair is no raid, and their fight is outside every raid', () => {
    expect(idx.groups).toHaveLength(1);
    expect(outsideRaids(idx, recorded, t, ['zarrin1', 'zarrin2'])).toBe(true);
  });
  it('a fight any raider was in stays, and so does one with no parse rows', () => {
    expect(outsideRaids(idx, recorded, t, ['aldenmar1'])).toBe(false);
    expect(outsideRaids(idx, recorded, t, ['zarrin1', 'aldenmar1'])).toBe(false);
    expect(outsideRaids(idx, recorded, t, [])).toBe(false);
  });
  it('a fight in a minute nobody recorded stays: a gap must not hide the raid\'s own kills', () => {
    expect(outsideRaids(idx, recorded, T0 + 40 * MIN, ['zarrin1'])).toBe(false);
  });
  it('a window with no raid at all keeps everything', () => {
    expect(outsideRaids(buildGroups(span(0, 20, () => [{ zone: 'x', tag: 'Nyssara', names: pair }])), recorded, t, ['zarrin1'])).toBe(false);
  });
});

describe('the night marks, for the whole window and for one raid', () => {
  const stamp = (m, s = 0) => new Date(T0 + m * MIN + s * 1000).toISOString();
  const tableDb = (tables) => ({
    from(table) {
      const b = {
        select: () => b, eq: () => b, is: () => b, or: () => b, in: () => b, gte: () => b, lt: () => b, order: () => b, range: () => b, limit: () => b,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (res, rej) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(res, rej),
      };
      return b;
    },
  });
  const listed = (id, name, over = {}) => ({
    id, boss: false, named: true, wipe: false, foreign: false, name, zone: 'codecay', startMs: T0 + 3 * MIN, endMs: T0 + 5 * MIN, durationSec: 120, totalDamage: 1, top: [], ...over,
  });
  const dies = (names, m) => names.map((n, i) => ({ name: n, ts: stamp(m, i), class: 'Cleric' }));
  const win = { fromMs: T0, toMs: T0 + 30 * MIN };
  const rows = span(0, 20, () => [{ zone: 'x', tag: 'Corvale', names: A }, { zone: 'x', tag: 'Rethlan', names: B }]);
  const idx = buildGroups(rows);
  const idOf = (tag) => 'r' + raidKey(tag);
  const tables = {
    encounters: [{ id: 'p1', npc_id: 9, started_at: stamp(10), ended_at: stamp(11), duration_sec: 60, zone_short: null, classification: 'pvp', is_wipe: false, eqemu_npc_types: { name: '#Some_Named' } }],
    bosses_local: [],
    encounter_players: [...A.slice(0, 3), ...A.slice(0, 1)].map(n => ({ encounter_id: 'p1', character_name: n })),
    contributions: [
      { id: 'c1', encounter_id: 'k1', deaths: dies([...A.slice(0, 3), ...B.slice(0, 4)], 4) },
    ],
  };

  it('whole window: a named wipe and another guild\'s fight arrive as marks, a named fight with no mark is a kill', async () => {
    const kills = [listed('k1', 'Alpha'), listed('k2', 'Beta', { wipe: true }), listed('k3', 'Gamma', { foreign: true, startMs: T0 + 8 * MIN, endMs: T0 + 9 * MIN })];
    const r = await loadNightMarks(tableDb(tables), win, kills);
    expect(r.fights.map(f => [f.name, f.result, f.tag])).toEqual([['Alpha', 'kill', null], ['Beta', 'wipe', null], ['Gamma', 'kill', 'foreign'], ['Some Named', 'kill', 'pvp']]);
    expect(r.deaths).toHaveLength(7);
  });
  it('one raid: only its deaths, and a marked fight its raiders were not in drops out', async () => {
    const kills = [listed('k1', 'Alpha')];
    const w = { fromMs: T0, toMs: T0 + 31 * MIN };
    const mine = await loadNightMarks(tableDb(tables), w, kills, { id: idOf('Corvale'), index: idx });
    const theirs = await loadNightMarks(tableDb(tables), w, kills, { id: idOf('Rethlan'), index: idx });
    expect(mine.deaths).toHaveLength(3);
    expect(theirs.deaths).toHaveLength(4);
    expect(mine.fights.map(f => f.name)).toContain('Some Named');         // its players are that raid's
    expect(theirs.fights.map(f => f.name)).not.toContain('Some Named');
    expect(JSON.stringify(mine)).not.toMatch(/Aldenmar|Brackwyn/);        // a name is read to place a death and never returned
  });
});

describe('the recorder stamps the raid', () => {
  const track = require('../utils/raidTrack.js');
  const members = (leader, names) => names.map(n => ({
    name: n, class: 'WAR', group_num: 1, level: 60, rank: n === leader ? 'Raid Leader' : null, hp_pct: 90, loc_x: 10, loc_y: 20, loc_z: 0, heading: 1,
  }));

  it("keys each raider by the raid of the uploader that saw them, with the key the site hashes", () => {
    track._reset();
    const now = Date.parse('2026-10-23T05:00:10Z');
    track.noteRows(members('Corvale', ['Corvale', ...crew('Aldenmar', 7)]), 'up1', now);
    track.noteRows(members('Rethlan', ['Rethlan', ...crew('Brackwyn', 7)]), 'up2', now);
    const frame = track.takeFrame(now + 1000);
    const row = track.buildMinuteRow(Math.floor(now / MIN) * MIN, [frame], { guildId: 'wolfpack' });
    const d = JSON.parse(row.data);
    expect(d.raids.sort()).toEqual([raidKey('Corvale'), raidKey('Rethlan')].sort());
    const tagOf = n => d.raids[d.who.find(w => w[0] === n)[4]];
    expect(tagOf('Aldenmar3')).toBe(raidKey('Corvale'));
    expect(tagOf('Brackwyn3')).toBe(raidKey('Rethlan'));
    expect(d.v).toBe(1);
    expect(track.raidKey('Corvale')).toBe(raidKey('Corvale'));
    // and the site reads its own recorder's row as two groups, in one zone
    const rows = Array.from({ length: 8 }, (_, k) => ({ minute_at: new Date(Math.floor(now / MIN) * MIN + k * MIN).toISOString(), data: row.data }));
    expect(buildGroups(rows).groups.map(g => g.size)).toEqual([8, 8]);
    track._reset();
  });

  it('an upload with no single raid leader leaves its raiders unstamped, and the row has no raids key', () => {
    track._reset();
    const now = Date.parse('2026-10-23T05:00:10Z');
    track.noteRows(members(null, crew('Aldenmar', 8)), 'up1', now);
    track.noteRows(members('x', crew('Brackwyn', 3)).map(m => ({ ...m, rank: 'Raid Leader' })), 'up2', now);   // two leaders: ambiguous
    const frame = track.takeFrame(now + 1000);
    const d = JSON.parse(track.buildMinuteRow(Math.floor(now / MIN) * MIN, [frame], { guildId: 'wolfpack' }).data);
    expect(d.raids).toBeUndefined();
    expect(d.who.every(w => w.length === 4)).toBe(true);
    track._reset();
  });
});

describe('source', () => {
  const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
  it('the members page and the replay route both narrow by the same index; the share page never takes a group', () => {
    expect(stripJs(read('web/lib/raidSessionLoad.ts'))).toMatch(/narrowRows\(/);
    expect(stripJs(read('web/app/api/raid/session/replay/route.ts'))).toMatch(/narrowRows\(/);
    expect(stripJs(read('web/app/api/share/raid/[token]/replay/route.ts'))).not.toMatch(/group/i);
  });
});
