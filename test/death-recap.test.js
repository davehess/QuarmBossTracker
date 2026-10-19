// FB-84 (A): the local death recap — the 20 s of this log before each player death.
//
// The report: "a death log module that can see the last 10-20 seconds of log before death to see heals and
// damage coming for how quickly tanks died and what killed them. This will see if CH chain delay needs to be
// adjusted." The guild lead picked "A first then B": A is built from your own log and uploads nothing.
// Corpses with nothing on them vanish at once, so a recap belongs to a player and a time, never to a corpse.
//
// Run: npx vitest run test/death-recap.test.js

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { AGENT_INDEX, readSource, stripJs } from './_source-slice.js';

let agent;
beforeAll(() => {
  agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js');
});

const pad = (n) => String(n).padStart(2, '0');
const at = (min, sec) => `[Sun Aug 02 21:${pad(min)}:${pad(sec)} 2026] `;

let flushed;
function resetState() {
  agent._deathRecapsForTest().length = 0;
  agent._recentHealLandsForTest().length = 0;
  for (const k of Object.keys(agent._zealStateForTest())) delete agent._zealStateForTest()[k];
}
function makeBuilder(character = 'Syko') {
  return new agent.EncounterBuilder({ character, onFlush: (p) => flushed.push(p), silent: false });
}
// Feed lines the way the tail loop does: heal landings go to the ring, everything else to the builder.
function feed(builder, lines) {
  for (const [min, sec, text] of lines) {
    const line = at(min, sec) + text;
    agent.noteHealLandLine(line);
    agent.trackChChainLine(line, builder.character);
    const e = agent.parseEvent(line, agent.parseEqTimestamp(line));
    if (e) builder.add(e);
  }
}

beforeEach(() => {
  flushed = [];
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-02T21:01:30'));
  resetState();
  agent.confirmPlayer('Aldenmar');
});
afterEach(() => { vi.useRealTimers(); resetState(); });

// Aldenmar dies at 21:01:00 to "A Boss". Offsets before death in the comments.
const TANK_FIGHT = [
  [0, 35, 'A Boss slashes Aldenmar for 5000 points of damage.'],   // 25 s — outside the window
  [0, 44, 'A Boss slashes Aldenmar for 1000 points of damage.'],   // 16 s
  [0, 50, 'Aldenmar is completely healed.'],                        // 10 s — CH
  [0, 53, 'A Boss slashes Aldenmar for 2000 points of damage.'],   //  7 s — before the 6 s burst
  [0, 55, 'A Boss slashes Aldenmar for 3000 points of damage.'],   //  5 s
  [0, 56, 'Aldenmar feels much better.'],                           //  4 s — a heal, not a CH
  [0, 57, 'Aldenmar is completely healed.'],                        //  3 s — the last CH
  [0, 57, 'A Boss slashes Brackwyn for 9999 points of damage.'],    // someone else — must not count
  [0, 58, 'A Boss slashes Aldenmar for 4000 points of damage.'],   //  2 s
  [1, 0, 'Aldenmar has been slain by A Boss!'],
];

describe('death recap — a synthetic fight, a death, the fields', () => {
  it('captures hits, heals, the 6 s burst, the killer and the last CH offset', () => {
    feed(makeBuilder(), TANK_FIGHT);
    const list = agent.deathRecapSnapshot(50);
    expect(list).toHaveLength(1);
    const r = list[0];
    expect(r.name).toBe('Aldenmar');
    expect(r.killer).toBe('A Boss');
    expect(r.hits.map((h) => [h.offMs, h.amount])).toEqual([[16000, 1000], [7000, 2000], [5000, 3000], [2000, 4000]]);
    expect(r.hits[0]).toMatchObject({ attacker: 'A Boss', ability: 'slash' });
    expect(r.heals.map((h) => [h.offMs, h.ch])).toEqual([[10000, true], [4000, false], [3000, true]]);
    expect(r.dmg6).toBe(7000);              // the 5 s and 2 s hits; the 7 s hit is outside the burst
    expect(r.dmg20).toBe(10000);            // the 25 s hit and Brackwyn's are outside / not his
    expect(r.lastChOffMs).toBe(3000);       // the 4 s heal was not a Complete Heal
    expect(r.beatMs).toBeNull();            // no chain was running
    expect(r.self).toBe(false);
  });

  it('names the killer from the last hit when the death line names none', () => {
    feed(makeBuilder(), [
      [0, 50, 'A Boss slashes Aldenmar for 2000 points of damage.'],
      [1, 0, 'Aldenmar died.'],
    ]);
    const r = agent.deathRecapSnapshot(50)[0];
    expect(r.killer).toBe('A Boss');
  });

  it('your own death: "YOU" hits count, and the corpse-run tail stamps it confirmed', () => {
    feed(makeBuilder('Syko'), [
      [0, 50, 'A Boss hits YOU for 1500 points of damage.'],
      [0, 58, 'A Boss hits YOU for 2500 points of damage.'],
      [1, 0, 'You died.'],
      [1, 2, 'You are bleeding to death!'],
    ]);
    const r = agent.deathRecapSnapshot(50)[0];
    expect(r.name).toBe('Syko');
    expect(r.self).toBe(true);
    expect(r.dmg6).toBe(2500);
    expect(r.dmg20).toBe(4000);
    expect(r.killer).toBe('A Boss');
    expect(r.confirmed).toBe(true);
  });

  it('a death with nothing in the window still gets a recap (empty lists, no CH offset)', () => {
    feed(makeBuilder(), [[1, 0, 'Aldenmar died.']]);
    const r = agent.deathRecapSnapshot(50)[0];
    expect(r).toMatchObject({ name: 'Aldenmar', dmg6: 0, dmg20: 0, lastChOffMs: null, killer: null });
    expect(r.hits).toEqual([]);
  });

  it('the CH chain beat rides along when a chain was running', () => {
    const b = makeBuilder();
    // Three slots, 9 s apart -> a 9 s beat.
    feed(b, [
      [0, 30, "Rapha tells the raid, '001 CH Aldenmar'"],
      [0, 39, "Norbray tells the raid, '002 CH Aldenmar'"],
      [0, 48, "Taey tells the raid, '003 CH Aldenmar'"],
      [0, 55, 'A Boss slashes Aldenmar for 3000 points of damage.'],
      [1, 0, 'Aldenmar has been slain by A Boss!'],
    ]);
    expect(agent.deathRecapSnapshot(50)[0].beatMs).toBe(9000);
  });

  it('keeps only the newest 50, newest first; two logs seeing one death make one recap', () => {
    for (let i = 0; i < 55; i++) {
      const line = at(1, 0) + 'Aldenmar has been slain by A Boss!';
      const e = agent.parseEvent(line, agent.parseEqTimestamp(line));
      vi.setSystemTime(new Date(`2026-08-02T21:0${Math.floor(i / 60)}:${pad(i % 60)}`));
      const ev = { ...e, ts: new Date(Date.parse(e.ts) + i * 60_000).toISOString() };
      makeBuilder().add(ev);
    }
    const list = agent.deathRecapSnapshot(100);
    expect(list).toHaveLength(50);
    expect(list[0].id).toBeGreaterThan(list[49].id);

    resetState();
    const b1 = makeBuilder('Syko'), b2 = makeBuilder('Dongru');
    feed(b1, TANK_FIGHT);
    feed(b2, TANK_FIGHT.slice(-1));
    expect(agent.deathRecapSnapshot(50)).toHaveLength(1);
  });

  it('silent (backfill) builders record no recap', () => {
    const b = new agent.EncounterBuilder({ character: 'Syko', onFlush: () => {}, silent: true });
    feed(b, TANK_FIGHT);
    expect(agent.deathRecapSnapshot(50)).toHaveLength(0);
  });
});

describe('death recap — the corpse', () => {
  it('the recap outlives the corpse and was never tied to one', () => {
    feed(makeBuilder(), TANK_FIGHT);
    const zs = agent._zealStateForTest();
    // Never targeted: still listed, linked to the player and the time.
    expect(agent.deathRecapSnapshot(50)).toHaveLength(1);
    expect(agent.deathRecapFocusId()).toBeNull();
    // Target the corpse, then the corpse is gone (nothing on it) and the target moves on.
    zs.Syko = { target_name: 'Aldenmar`s corpse' };
    expect(agent.deathRecapFocusId()).toBe(agent.deathRecapSnapshot(50)[0].id);
    zs.Syko = { target_name: null };
    expect(agent.deathRecapFocusId()).toBeNull();
    const r = agent.deathRecapSnapshot(50)[0];
    expect(r.name).toBe('Aldenmar');
    expect(r.hits.length).toBe(4);
  });

  it('targeting a corpse selects that player\'s LATEST recap (apostrophe, backtick, curly, numbered)', () => {
    const b = makeBuilder();
    feed(b, TANK_FIGHT);                                               // Aldenmar, 21:01:00
    feed(b, [[3, 0, 'A Boss slashes Aldenmar for 800 points of damage.'], [3, 5, 'Aldenmar has been slain by A Boss!']]);
    agent.confirmPlayer('Brackwyn');
    feed(b, [[4, 0, 'Brackwyn died.']]);
    const [brack, aldenNew, aldenOld] = agent.deathRecapSnapshot(50);
    expect([brack.name, aldenNew.name, aldenOld.name]).toEqual(['Brackwyn', 'Aldenmar', 'Aldenmar']);
    const zs = agent._zealStateForTest();
    for (const t of ["Aldenmar's corpse", 'Aldenmar`s corpse', 'Aldenmar’s corpse', 'Aldenmar`s corpse12', "aldenmar's corpse0"]) {
      zs.Syko = { target_name: t };
      expect(agent.deathRecapFocusId(), t).toBe(aldenNew.id);
    }
    zs.Syko = { target_name: "Brackwyn's corpse" };
    expect(agent.deathRecapFocusId()).toBe(brack.id);
  });

  it('only a player corpse with a recap focuses anything', () => {
    feed(makeBuilder(), TANK_FIGHT);
    const zs = agent._zealStateForTest();
    for (const t of ["Dongru's corpse", 'a gnoll corpse', 'Aldenmar', '', null, undefined, "Aldenmar's pet"]) {
      zs.Syko = { target_name: t };
      expect(agent.deathRecapFocusId(), String(t)).toBeNull();
    }
    expect(agent.corpseTargetOwner("Moash's corpse")).toBe('Moash');
    expect(agent.corpseTargetOwner('Moash`s corpse')).toBe('Moash');
  });
});

describe('death recap — nothing new leaves the machine', () => {
  it('the encounter payload and its deaths[] rows carry no recap data', () => {
    const b = makeBuilder();
    // Enough boss damage (10+ events) that the encounter is worth flushing, then the boss dies.
    const swings = [];
    for (let s = 0; s < 14; s++) swings.push([0, 30 + s, 'You slash A Boss for 900 points of damage.']);
    feed(b, swings);
    feed(b, TANK_FIGHT);
    feed(b, [[1, 5, 'A Boss has been slain by Syko!']]);
    b.flush();
    expect(flushed.length).toBeGreaterThan(0);
    const json = JSON.stringify(flushed);
    expect(json).not.toMatch(/recap|offMs|dmg6|lastChOff|beatMs/i);
    const deaths = flushed.flatMap((p) => (p.encounter && p.encounter.deaths) || []);
    expect(deaths.length).toBeGreaterThan(0);
    for (const d of deaths) {
      expect(Object.keys(d).sort().filter((k) => !['name', 'ts', 'riposteDeath', 'class', 'confirmed'].includes(k))).toEqual([]);
    }
  });

  it('no upload call in the agent mentions a recap', () => {
    const src = stripJs(readSource(AGENT_INDEX));
    const uploadLines = src.split('\n').filter((l) => /enqueueUpload\(|uploadEncounter\(|postJson\(/.test(l));
    expect(uploadLines.length).toBeGreaterThan(10);   // the filter is not vacuous
    expect(uploadLines.filter((l) => /deathRecap|buildDeathRecap/i.test(l))).toEqual([]);
  });
});
