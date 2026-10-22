// test/typical-raid.test.js — "what does a normal raid night of ours look like?"
// (utils/typicalRaid.js, behind the pre-raid checklist's thin-roster and class-shortage lines.)
//
// The guild lead, 2026-10-21: "these numbers are so skewed" — the old average was read from the live
// raid_roster (half a day deep), so "typical" was whatever had been logged in earlier the same day,
// counted characters not players, and included a morning raid with another group.

import { describe, it, expect } from 'vitest';
import { typicalRaidNights, candidateRaidNights, canonClass, MIN_NIGHT_PLAYERS } from '../utils/typicalRaid.js';
import { buildPreRaidChecklist } from '../utils/preRaidChecklist.js';

// Wed 2026-10-21, 19:00 ET (23:00Z) — the pre-raid post.
const NOW = Date.UTC(2026, 9, 21, 23, 0, 0);
const raid = (id, y, m, d) => ({ raid_id: id, ts: new Date(Date.UTC(y, m - 1, d, 12)).toISOString() });

// Aldenmar-style invented names. A "roster" is [{ name, class, main? }].
function makeRoster(prefix, spec) {
  const out = [];
  for (const [cls, n] of Object.entries(spec)) {
    for (let i = 0; i < n; i++) out.push({ name: `${prefix}${cls.slice(0, 3)}${i}`, class: cls });
  }
  return out;
}
const SPEC = { Cleric: 8, Warrior: 4, Wizard: 6, Bard: 6, Druid: 4, Shaman: 4, Rogue: 4 }; // 36 players
const ROSTER = makeRoster('Zz', SPEC);
const chars = (roster) => roster.map(r => ({ name: r.name, main_name: r.main || null, class: r.class }));
// 4 ticks of one raid, everyone on every tick
const ticksFor = (raidId, names) => [1, 2, 3, 4].map(t => ({ raid_id: raidId, tick_id: raidId * 10 + t, attendees: names }));
const names = (roster) => roster.map(r => r.name);

describe('canonClass', () => {
  it('reads the signup spelling and the roster spelling as one class, and refuses non-classes', () => {
    expect(canonClass('Shadowknight')).toBe('Shadow Knight');
    expect(canonClass('Shadow Knight')).toBe('Shadow Knight');
    expect(canonClass('cleric')).toBe('Cleric');
    for (const bad of ['Unknown', 'UNKNOWN', 'Late', 'Tentative', 'Bench', '', null, undefined]) expect(canonClass(bad)).toBeNull();
  });
});

describe('candidateRaidNights: raid nights only, never tonight', () => {
  it('keeps Sun/Wed/Thu, drops other days and tonight, newest first', () => {
    const raids = [
      raid(1, 2026, 10, 14),  // Wed
      raid(2, 2026, 10, 15),  // Thu
      raid(3, 2026, 10, 16),  // Fri - a bonus-award entry, not a raid night
      raid(4, 2026, 10, 17),  // Sat
      raid(5, 2026, 10, 18),  // Sun
      raid(6, 2026, 10, 19),  // Mon
      raid(7, 2026, 10, 20),  // Tue
      raid(8, 2026, 10, 21),  // Wed - tonight, already entered in OpenDKP
    ];
    expect(candidateRaidNights(raids, NOW).map(n => n.key)).toEqual(['10/18/2026', '10/15/2026', '10/14/2026']);
  });

  it('two raids on one night are one night', () => {
    const nights = candidateRaidNights([raid(10, 2026, 10, 15), raid(11, 2026, 10, 15)], NOW);
    expect(nights).toHaveLength(1);
    expect(nights[0].raidIds.sort()).toEqual([10, 11]);
  });

  it('ignores a raid that has no usable timestamp', () => {
    expect(candidateRaidNights([{ raid_id: 1, ts: null }, { raid_id: 2, ts: 'junk' }], NOW)).toEqual([]);
  });
});

describe('typicalRaidNights', () => {
  it('averages the last six raid nights per class and per player', () => {
    // Sun 9/6, Wed 9/9, Thu 9/10, Sun 9/13, Wed 9/16, Thu 9/17, Sun 9/20 — seven nights, only six count
    const days = [[9, 6], [9, 9], [9, 10], [9, 13], [9, 16], [9, 17], [9, 20]];
    const raids = days.map(([m, d], i) => raid(200 + i, 2026, m, d));
    const ticks = raids.flatMap(r => ticksFor(r.raid_id, names(ROSTER)));
    const out = typicalRaidNights({ nights: candidateRaidNights(raids, NOW), ticks, characters: chars(ROSTER) });
    expect(out.enough).toBe(true);
    expect(out.nightCount).toBe(6);
    expect(out.typicalHeadcount).toBe(36);
    expect(out.avgByClass.get('Cleric')).toBe(8);
    expect(out.avgByClass.get('Warrior')).toBe(4);
    expect(out.nights.map(n => n.key)[0]).toBe('09/20/2026');
  });

  it('a class absent on some nights averages down (missing counts as zero)', () => {
    const raids = [raid(1, 2026, 10, 14), raid(2, 2026, 10, 15)];
    const noCleric = ROSTER.filter(r => r.class !== 'Cleric');
    const extra = makeRoster('Yy', { Monk: 8 });
    const all = [...ROSTER, ...extra];
    const ticks = [...ticksFor(1, names(all)), ...ticksFor(2, names([...noCleric, ...extra]))];
    const out = typicalRaidNights({ nights: candidateRaidNights(raids, NOW), ticks, characters: chars(all), minPlayers: 20 });
    expect(out.avgByClass.get('Cleric')).toBe(4);   // 8 and 0
    expect(out.avgByClass.get('Monk')).toBe(8);
    expect(out.typicalHeadcount).toBe((44 + 36) / 2);
  });

  it('counts PLAYERS, not characters: a player who swapped to an alt is one head, as the class they sat on longest', () => {
    const raids = [raid(1, 2026, 10, 14), raid(2, 2026, 10, 15)];
    const main = { name: 'Aldenmar', class: 'Cleric' };
    const alt = { name: 'Brackwyn', class: 'Wizard', main: 'Aldenmar' };
    const base = makeRoster('Zz', { Warrior: 30 });
    const everyone = [...base, main, alt];
    const t = (raidId, tickId, ns) => ({ raid_id: raidId, tick_id: tickId, attendees: ns });
    const ticks = [];
    for (const rid of [1, 2]) {
      // tick 1: the main; ticks 2-4: the alt (so the alt is the class raided as)
      ticks.push(t(rid, rid * 10 + 1, [...names(base), 'Aldenmar']));
      for (const k of [2, 3, 4]) ticks.push(t(rid, rid * 10 + k, [...names(base), 'Brackwyn']));
    }
    const out = typicalRaidNights({ nights: candidateRaidNights(raids, NOW), ticks, characters: chars(everyone), minPlayers: 20 });
    expect(out.typicalHeadcount).toBe(31);                       // 30 warriors + ONE player, not 32
    expect(out.avgByClass.get('Wizard')).toBe(1);                // the class they actually raided as
    expect(out.avgByClass.get('Cleric')).toBeUndefined();
    expect(out.avgByClass.get('Warrior')).toBe(30);
  });

  it('a character unknown to the roster still counts as a head, with no class', () => {
    const raids = [raid(1, 2026, 10, 14), raid(2, 2026, 10, 15)];
    const ticks = [...ticksFor(1, [...names(ROSTER), 'Nobodyknown']), ...ticksFor(2, names(ROSTER))];
    const out = typicalRaidNights({ nights: candidateRaidNights(raids, NOW), ticks, characters: chars(ROSTER), minPlayers: 20 });
    expect(out.typicalHeadcount).toBe(36.5);
    expect([...out.avgByClass.values()].reduce((a, b) => a + b, 0)).toBe(36);
  });

  it('skips a stub night (an alt raid or a lone bonus tick) and takes the next real one', () => {
    const raids = [raid(1, 2026, 10, 14), raid(2, 2026, 10, 15), raid(3, 2026, 10, 18)];
    const alts = makeRoster('Xx', { Cleric: 10 });
    const ticks = [...ticksFor(1, names(ROSTER)), ...ticksFor(2, names(ROSTER)), ...ticksFor(3, names(alts))];
    const out = typicalRaidNights({ nights: candidateRaidNights(raids, NOW), ticks, characters: chars([...ROSTER, ...alts]) });
    expect(10).toBeLessThan(MIN_NIGHT_PLAYERS);
    expect(out.nights.map(n => n.key)).toEqual(['10/15/2026', '10/14/2026']);
    expect(out.typicalHeadcount).toBe(36);
  });

  it('NOT ENOUGH HISTORY: one raid night yields no number, never a one-night "average"', () => {
    const raids = [raid(1, 2026, 10, 18)];
    const out = typicalRaidNights({ nights: candidateRaidNights(raids, NOW), ticks: ticksFor(1, names(ROSTER)), characters: chars(ROSTER) });
    expect(out.enough).toBe(false);
    expect(out.nightCount).toBe(1);
    expect(out.typicalHeadcount).toBe(0);
    expect(out.avgByClass.size).toBe(0);
  });

  it('no raids at all is not enough history either', () => {
    const out = typicalRaidNights({});
    expect(out.enough).toBe(false);
    expect(out.avgByClass.size).toBe(0);
  });

  it('what is in the live roster is irrelevant: only OpenDKP ticks of past raid nights count', () => {
    // Tonight's raid is already entered with a huge list; it must not move the average.
    const raids = [raid(1, 2026, 10, 14), raid(2, 2026, 10, 15), raid(3, 2026, 10, 21)];
    const crowd = makeRoster('Ww', { Cleric: 40 });
    const ticks = [...ticksFor(1, names(ROSTER)), ...ticksFor(2, names(ROSTER)), ...ticksFor(3, names(crowd))];
    const out = typicalRaidNights({ nights: candidateRaidNights(raids, NOW), ticks, characters: chars([...ROSTER, ...crowd]) });
    expect(out.avgByClass.get('Cleric')).toBe(8);
    expect(out.typicalHeadcount).toBe(36);
  });
});

describe('the checklist, fed by it: the 2026-10-21 report', () => {
  // 52 signed up against a ~54-player norm was reported as "thin roster (52 vs ~82) · 11 class shortages".
  const typical = { avgByClass: new Map([['Cleric', 7.3], ['Bard', 6.8], ['Warrior', 3.2]]), typicalHeadcount: 54.5 };
  const tonight = new Map([['Cleric', 6], ['Bard', 6], ['Warrior', 3]]);

  it('52 going against a real ~54 norm is not a thin roster, and 6 clerics vs ~7 is not a shortage', () => {
    const out = buildPreRaidChecklist({ signups: { going: 52, tentative: 0, absent: 0, bench: 0 }, tonightByClass: tonight, ...typical });
    expect(out.flags.join(' ')).not.toMatch(/thin roster/);
    expect(out.shortages).toEqual([]);
  });

  it('with no usable history (empty average) the checklist raises no roster or class flag at all', () => {
    const out = buildPreRaidChecklist({ signups: { going: 5, tentative: 0, absent: 0, bench: 0 }, tonightByClass: tonight,
      avgByClass: new Map(), typicalHeadcount: 0 });
    expect(out.shortages).toEqual([]);
    expect(out.flags.join(' ')).not.toMatch(/thin roster|shortage/);
  });
});
