// test/fewest-kills.test.js: web/lib/fewestKills.ts, "how few raiders have we killed this boss with".
//
// Pinned on small hand-built nights (every name below is invented; none is anybody):
//   • PLAYERS are not CHARACTERS: two characters of one owner, or of one family with no owner on record, are one
//     player; both numbers are reported;
//   • a damage row whose name is not a guild character is not counted (and is reported as `unmatched`) unless the
//     raid recorder placed that name in the zone;
//   • the recorder adds the people who never hit the mob, only those placed in THIS zone and only around the kill;
//   • off-night = not inside a Sun/Wed/Thu 19:30-00:30 Eastern window;
//   • fewest first, five at most; unconfirmed and classified kills do not exist;
//   • reads are bounded: the 1,000-row cap does not drop damage rows, and the recorder is not read for a kill that
//     cannot reach the five smallest.
//
// Run: npx vitest run test/fewest-kills.test.js

import { describe, it, expect } from 'vitest';
import { fakeSupabase } from './_fake-supabase-js.js';
import { fewestKills, headcount, indexRoster, nightType } from '../web/lib/fewestKills.ts';

const G = 'g';
const ZONE = 'potactics';
const OVERSEER = 214092;
const GLYKUS = 214053;

const ch = (name, cls, extra = {}) => ({ guild_id: G, name, class: cls, main_name: null, main_name_override: null, discord_id: null, ...extra });
const ROSTER = [
  ch('Aldenmar', 'Cleric', { discord_id: 'd1', main_name: 'Aldenmar' }),
  ch('Brackwyn', 'Warrior', { discord_id: 'd1', main_name: 'Aldenmar' }),         // the same owner's second character
  ch('Corvale', 'Cleric', { discord_id: 'd2', main_name: 'Corvale' }),
  ch('Rethlan', 'Wizard', { discord_id: 'd3', main_name: 'Rethlan' }),
  ch('Nyssara', 'Bard', { discord_id: 'd4', main_name: 'Nyssara' }),
  ch('Zarrin', 'Rogue', { main_name: 'Zarrin' }),                                   // no owner on record ...
  ch('Zarrinalt', 'Druid', { main_name_override: 'Zarrin' }),                       // ... linked by family only
];
const MANY = Array.from({ length: 45 }, (_, i) => ch(`Testchar${String(i).padStart(2, '0')}`, 'Warrior', { discord_id: `m${i}` }));

let n = 0;
const kill = (npc, endIso, fighters, extra = {}) => {
  const id = `e${++n}`;
  const ended = Date.parse(endIso);
  return {
    enc: { id, guild_id: G, npc_id: npc, started_at: new Date(ended - 8000).toISOString(), ended_at: endIso, classification: null, ...extra },
    players: fighters.map(f => ({ encounter_id: id, character_name: f, total_damage: 100 })),
  };
};

// One minute of the recorder: `who` stand at frames every 3 seconds; `zoneOf` says which zone each one is in.
const minute = (iso, who, zoneOf = () => ZONE) => {
  const zones = [...new Set(who.map(([name]) => zoneOf(name)))];
  const frames = [];
  for (let dt = 0; dt < 60; dt += 3) {
    const f = [dt];
    who.forEach(([name], i) => f.push(i, 100 + i, 200, 0, 0, 100, zones.indexOf(zoneOf(name))));
    frames.push(f);
  }
  return {
    guild_id: G, minute_at: iso, zones,
    data: JSON.stringify({ v: 1, step_s: 3, who: who.map(([name, cls]) => [name, cls, 0, 65]), zones, f: frames }),
  };
};

function world({ kills = [], track = [], roster = ROSTER } = {}) {
  return fakeSupabase({
    tables: {
      encounters: kills.map(k => k.enc),
      encounter_players: kills.flatMap(k => k.players),
      characters: roster,
      eqemu_npc_types: [{ id: OVERSEER, name: 'The_Diaku_Overseer' }, { id: GLYKUS, name: 'Glykus_Helmir' }],
      raid_track_minutes: track,
    },
  });
}
const run = (db, npcIds = [OVERSEER]) => fewestKills(db, { guildId: G, zone: ZONE, npcIds });

// 2026-10-10 Saturday 15:00 ET = 19:00 UTC: an off-night afternoon, inside the recorder's life
const SAT = '2026-10-10T19:00:00Z';

describe('players are not characters', () => {
  it('counts an owner with two characters once, and reports both numbers', async () => {
    const db = world({ kills: [kill(OVERSEER, SAT, ['Aldenmar', 'Brackwyn', 'Corvale'])] });
    const [boss] = await run(db);
    expect(boss.kills[0]).toMatchObject({ characters: 3, players: 2, fought_players: 2 });
    expect(boss.kills[0].classes).toEqual({ Cleric: 2, Warrior: 1 });
  });

  it('links a family that has no owner on record', async () => {
    const db = world({ kills: [kill(OVERSEER, SAT, ['Zarrin', 'Zarrinalt', 'Rethlan'])] });
    const [boss] = await run(db);
    expect(boss.kills[0]).toMatchObject({ characters: 3, players: 2 });
  });

  it('joins an owner to a family through a character that is not in the kill', () => {
    // A (owner d9) and C (owner d9) are one player; C and B share a family root, so A and B are one player too
    const idx = indexRoster([
      ch('Aaa', 'Cleric', { discord_id: 'd9', main_name: 'Aaa' }),
      ch('Ccc', 'Wizard', { discord_id: 'd9', main_name: 'Ccc' }),
      ch('Bbb', 'Rogue', { main_name: 'Ccc' }),
    ]);
    expect(idx.playerOf('Aaa')).toBe(idx.playerOf('Bbb'));
    expect(idx.playerOf('Nobody')).not.toBe(idx.playerOf('Aaa'));
  });
});

describe('who is counted', () => {
  it('leaves out a damage row that is not a guild character, and reports it', async () => {
    const db = world({ kills: [kill(OVERSEER, SAT, ['Aldenmar', 'Corvale', 'Strangerone', 'Strangertwo'])] });
    const [boss] = await run(db);
    expect(boss.kills[0]).toMatchObject({ characters: 2, players: 2, unmatched: 2, source: 'parse' });
  });

  it('adds the raiders the recorder placed in the zone (healers who never hit it), and not those in another zone', async () => {
    const k = kill(OVERSEER, SAT, ['Aldenmar', 'Corvale']);
    const track = [minute('2026-10-10T18:59:00Z',
      [['Aldenmar', 'Cleric'], ['Corvale', 'Cleric'], ['Rethlan', 'Wizard'], ['Nyssara', 'Bard']],
      name => (name === 'Nyssara' ? 'elsewhere' : ZONE))];
    const [boss] = await run(world({ kills: [k], track }));
    expect(boss.kills[0]).toMatchObject({ characters: 3, players: 3, fought_players: 2, source: 'track+parse' });
    expect(boss.kills[0].classes).toEqual({ Cleric: 2, Wizard: 1 });
  });

  it('counts a name the recorder placed even when the roster has never heard of it', async () => {
    const k = kill(OVERSEER, SAT, ['Aldenmar', 'Newcomer']);
    const track = [minute('2026-10-10T18:59:00Z', [['Aldenmar', 'Cleric'], ['Newcomer', 'Shaman']])];
    const [boss] = await run(world({ kills: [k], track }));
    expect(boss.kills[0]).toMatchObject({ characters: 2, players: 2, unmatched: 0 });
    expect(boss.kills[0].classes).toEqual({ Cleric: 1, Shaman: 1 });
  });

  it('ignores minutes that are not around the kill', async () => {
    const k = kill(OVERSEER, SAT, ['Aldenmar']);
    const track = [
      minute('2026-10-10T19:01:00Z', [['Rethlan', 'Wizard'], ['Nyssara', 'Bard']]),     // a minute later
      minute('2026-10-10T18:58:00Z', [['Corvale', 'Cleric']]),                          // a minute before the engage
    ];
    const [boss] = await run(world({ kills: [k], track }));
    expect(boss.kills[0]).toMatchObject({ characters: 1, players: 1, source: 'parse' });
  });
});

describe('night type', () => {
  it('is main only inside a Sun/Wed/Thu 19:30-00:30 Eastern window', () => {
    expect(nightType(Date.parse('2026-10-22T02:53:00Z'))).toBe('main');   // Wed 22:53 ET
    expect(nightType(Date.parse('2026-10-22T04:10:00Z'))).toBe('main');   // Thu 00:10 ET, still Wednesday's night
    expect(nightType(Date.parse('2026-10-19T00:30:00Z'))).toBe('main');   // Sun 20:30 ET
    expect(nightType(Date.parse('2026-10-21T16:00:00Z'))).toBe('off');    // Wed noon-ish: not a raid hour
    expect(nightType(Date.parse('2026-10-20T01:00:00Z'))).toBe('off');    // Mon 21:00 ET: not a raid night
    expect(nightType(Date.parse('2026-10-10T19:00:00Z'))).toBe('off');    // Sat afternoon
    expect(nightType(Date.parse('2026-10-22T05:00:00Z'))).toBe('off');    // Thu 01:00 ET: past 00:30
  });

  it('is stamped on each kill', async () => {
    const db = world({ kills: [
      kill(OVERSEER, '2026-10-22T02:53:00Z', ['Aldenmar', 'Corvale', 'Rethlan']),
      kill(OVERSEER, SAT, ['Aldenmar']),
    ] });
    const [boss] = await run(db);
    expect(boss.kills.map(k => k.night_type)).toEqual(['off', 'main']);      // fewest first
  });
});

describe('ordering and what exists', () => {
  it('lists the five smallest, fewest players first, and counts every confirmed kill', async () => {
    const sizes = [6, 3, 5, 1, 4, 2, 7];
    const names = ['Aldenmar', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin', 'Testchar00', 'Testchar01'];
    const kills = sizes.map((s, i) => kill(OVERSEER, `2026-09-${String(10 + i).padStart(2, '0')}T01:00:00Z`, names.slice(0, s)));
    const [boss] = await run(world({ kills, roster: [...ROSTER, ...MANY] }));
    expect(boss.total_kills).toBe(7);
    expect(boss.kills.map(k => k.players)).toEqual([1, 2, 3, 4, 5]);
  });

  it('does not see an unconfirmed kill or a classified one', async () => {
    const db = world({ kills: [
      kill(OVERSEER, SAT, ['Aldenmar', 'Corvale']),
      kill(OVERSEER, SAT, ['Aldenmar'], { ended_at: null }),                        // never confirmed
      kill(OVERSEER, '2026-10-11T19:00:00Z', ['Aldenmar'], { classification: 'trash' }),
    ] });
    const [boss] = await run(db);
    expect(boss.total_kills).toBe(1);
    expect(boss.kills).toHaveLength(1);
    expect(boss.kills[0].players).toBe(2);
  });

  it('answers a boss that has never died with an empty list, keeps the caller\'s order, and names the boss', async () => {
    const db = world({ kills: [kill(OVERSEER, SAT, ['Aldenmar'])] });
    const out = await run(db, [GLYKUS, OVERSEER]);
    expect(out.map(b => [b.npc_id, b.boss, b.total_kills])).toEqual([[GLYKUS, 'Glykus Helmir', 0], [OVERSEER, 'The Diaku Overseer', 1]]);
    expect(out[0].kills).toEqual([]);
  });

  it('never puts a name in the answer', async () => {
    const k = kill(OVERSEER, SAT, ['Aldenmar', 'Corvale']);
    const track = [minute('2026-10-10T18:59:00Z', [['Aldenmar', 'Cleric'], ['Rethlan', 'Wizard']])];
    const text = JSON.stringify(await run(world({ kills: [k], track })));
    for (const c of ROSTER) expect(text).not.toContain(c.name);
  });
});

describe('bounded reads', () => {
  it('pages the damage rows past the 1,000-row cap', async () => {
    const kills = Array.from({ length: 30 }, (_, i) =>
      kill(OVERSEER, `2026-09-${String(1 + i).padStart(2, '0')}T01:00:00Z`, MANY.slice(0, 40).map(c => c.name)));
    const out = await run(world({ kills, roster: MANY }));
    expect(out[0].kills).toHaveLength(5);
    for (const k of out[0].kills) expect(k.characters).toBe(40);     // a dropped page would leave a short kill
  });

  it('does not read the recorder for a kill that cannot reach the five smallest', async () => {
    const small = Array.from({ length: 6 }, (_, i) => kill(OVERSEER, `2026-10-1${i}T19:00:00Z`, ['Aldenmar']));
    const big = kill(OVERSEER, '2026-10-20T19:00:00Z', MANY.slice(0, 20).map(c => c.name));
    const db = world({ kills: [...small, big], roster: [...ROSTER, ...MANY] });
    await run(db);
    const reads = db.requests.filter(r => r.name === 'raid_track_minutes');
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.some(r => r.filters.some(f => f.startsWith('minute_at>=2026-10-20')))).toBe(false);
  });

  it('reads the recorder around the kills that can matter, and lets it move a kill down the list', async () => {
    // the kill that looks smallest by damage rows had a big raid standing there
    const crowded = kill(OVERSEER, '2026-10-11T19:00:00Z', ['Aldenmar']);
    const modest = kill(OVERSEER, '2026-10-12T19:00:00Z', ['Corvale', 'Rethlan']);
    const track = [minute('2026-10-11T18:59:00Z', [['Aldenmar', 'Cleric'], ...MANY.slice(0, 10).map(c => [c.name, 'Warrior'])])];
    const [boss] = await run(world({ kills: [crowded, modest], track, roster: [...ROSTER, ...MANY] }));
    expect(boss.kills.map(k => k.players)).toEqual([2, 11]);
    expect(boss.kills[1].source).toBe('track+parse');
  });
});

describe('headcount', () => {
  it('reports the class mix of the bodies, not of the players', () => {
    const idx = indexRoster(ROSTER);
    const h = headcount(idx, ['Aldenmar', 'Brackwyn'], []);
    expect(h).toMatchObject({ players: 1, characters: 2, classes: { Cleric: 1, Warrior: 1 } });
  });

  it('is case-insensitive about names', () => {
    const idx = indexRoster(ROSTER);
    expect(headcount(idx, ['ALDENMAR'], [{ name: 'aldenmar', cls: null }])).toMatchObject({ characters: 1, players: 1 });
  });
});
