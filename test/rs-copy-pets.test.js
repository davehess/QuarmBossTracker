// test/rs-copy-pets.test.js — the 📋 copy puts a pet's damage on its owner's line (FB-22).
//
// A member's report: "when outputting the copied parse info, it's not counting the pet when you copy
// from the current fight. When you copy from history it does do the pet but it doesn't associate it
// with the player it belongs to."
//
// What the two copies did:
//   • live fight — built from the raw rows and listed raiders only: every pet row was dropped, and its
//     damage survived only inside the header total, so "1. Owner = …" was short by the pet and the
//     header was longer than the lines;
//   • History — built from rows already folded into their owners (the 2026-10-04 History work), so the
//     owner's number carried the pet, but nothing on the line said so.
// Both now go through one builder from folded rows, and an owner whose number carries a pet reads
// "Owner +Pets = 4.59K@148 in 31s" — the EQLogParser mark the bot's parser reads back as a pets flag.
//
// The real agent builds the rows; the overlay's own fold and line builder run as slices. Names invented.
//
// Run: npx vitest run test/rs-copy-pets.test.js

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, evalBlock, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const agent = require('../packages/wolfpack-logsync/index.js');
const { parseEQLog } = require('../utils/parseEqLog.js');
const overlay = readSource(path.join(ROOT, 'apps', 'mimic', 'overlay.html'));

// pnum / pnumK are the overlay's own number formatters, sliced with the code that calls them.
const { _foldPetsIntoOwners, _histRows, _rsLine, _liveRsRows } = evalBlock(
  sliceBlock(overlay, '  function pnum(n){', 'return String(n); }') + '\n'
  + sliceBlock(overlay, '  function pnumK(n){', "return (n/1e3).toFixed(2)+'K'; }") + '\n'
  + sliceBlock(overlay, '  function _foldPetsIntoOwners(allRows){', '\n  // ── Poll loop '),
  ['_foldPetsIntoOwners', '_histRows', '_rsLine', '_liveRsRows'],
);

const MOB = 'a Shissar acolyte';
let _min = 0;
function feeder(b) {
  const minute = String(10 + (_min++ % 50)).padStart(2, '0');
  let sec = 0;
  return (line) => {
    const full = `[Tue Sep 29 07:${minute}:${String(sec++ % 60).padStart(2, '0')} 2026] ${line}`;
    const ev = agent.parseEvent(full, agent.parseEqTimestamp(full));
    if (!ev) throw new Error('unparsed test line: ' + line);
    b.add(ev);
  };
}
const builder = (character) => new agent.EncounterBuilder({ character, onFlush: () => {} });
function record(b, character) {
  b._publishLiveThreat();
  const et = agent._liveThreatForTest();
  agent._recordFightHistory({ ...et, flushedAt: Date.now() }, character);
  return { et, entry: agent._fightHistoryForTest()[0] };
}
const total = (rows) => rows.reduce((s, r) => s + r[1], 0);
// What the live 📋 copies for a fight, and what History copies for the same fight once it is recorded.
const liveLine = (perPlayer, secs = 60) => { const r = _liveRsRows(perPlayer); return _rsLine(MOB, secs, total(r), r); };
const histLine = (entry, secs = 60) => { const r = _histRows(entry); return _rsLine(MOB, secs, total(r), r); };
const botRollup = (perPlayer) => {
  const per = new Map();
  for (const [name, v] of Object.entries(perPlayer)) {
    const d = Number(v.dmg) || 0; if (d <= 0) continue;
    const who = v.pet_owner ? String(v.pet_owner) : name;
    per.set(who, (per.get(who) || 0) + d);
  }
  return [...per.entries()].map(([character, dmg]) => ({ character, dmg })).sort((a, b) => b.dmg - a.dmg);
};

beforeEach(() => {
  agent._resetFightHistoryForTest();
  agent._charmTickTracker.clear();
  agent._applyPetOwnersResponse({ owners: {} });
  agent._setUploadOptsForTest(null);
});

// Corvale 500, Nyssara 300, her pet Kebantik 100 (the guild pool names the owner): 900 in 60 s.
function ownedPetFight() {
  agent._applyPetOwnersResponse({ owners: { kebantik: 'Nyssara' } });
  const b = builder('Brackwyn'); const feed = feeder(b);
  feed(`Corvale slashes ${MOB} for 500 points of damage.`);
  feed(`Nyssara slashes ${MOB} for 300 points of damage.`);
  feed(`Kebantik hits ${MOB} for 100 points of damage.`);
  return record(b, 'Brackwyn');
}

describe('the current fight\'s copy counts the pet, under its owner', () => {
  it('"Nyssara +Pets = 400" — her 300 and the pet\'s 100 — where it listed her at 300 and dropped the pet', () => {
    const { et } = ownedPetFight();
    expect(liveLine(et.perPlayer)).toBe(
      '/rs a Shissar acolyte in 60s, 0.90K Damage @15, '
      + '1. Corvale = 500@8 in 60s | 2. Nyssara +Pets = 400@7 in 60s');
  });

  it('the lines add up to the header (the pet used to be in the header and nowhere else)', () => {
    const { et } = ownedPetFight();
    const parsed = parseEQLog(liveLine(et.perPlayer));
    expect(parsed.totalDamage).toBe(900);
    expect(parsed.players.reduce((s, p) => s + p.damage, 0)).toBe(900);
  });

  it('the bot reads it back as the owner, with a pets flag — not as a raider called "Nyssara +Pets"', () => {
    const { et } = ownedPetFight();
    const players = parseEQLog(liveLine(et.perPlayer)).players;
    expect(players.map(p => [p.name, p.hasPets, p.damage])).toEqual([['Corvale', false, 500], ['Nyssara', true, 400]]);
  });

  it('a charmer who never swung still gets a line — the pet is not the raider', () => {
    agent._applyPetOwnersResponse({ owners: { kebantik: 'Nyssara' } });
    const b = builder('Brackwyn'); const feed = feeder(b);
    feed(`Corvale slashes ${MOB} for 500 points of damage.`);
    feed(`Kebantik hits ${MOB} for 100 points of damage.`);
    const { et } = record(b, 'Brackwyn');
    expect(liveLine(et.perPlayer)).toBe(
      '/rs a Shissar acolyte in 60s, 0.60K Damage @10, '
      + '1. Corvale = 500@8 in 60s | 2. Nyssara +Pets = 100@2 in 60s');
  });

  it('whichever tab is on screen, the copy is a damage parse', () => {
    const { et } = ownedPetFight();
    const tanked = JSON.parse(JSON.stringify(et.perPlayer));
    tanked.Corvale.took = 90000;                                  // the Tank tab would rank on this
    expect(liveLine(tanked)).toBe(liveLine(et.perPlayer));
  });
});

describe('History\'s copy says whose pet it is', () => {
  it('unsettled: the same line the live copy gives for the same fight', () => {
    const { et, entry } = ownedPetFight();
    expect(histLine(entry)).toBe(liveLine(et.perPlayer));
    expect(histLine(entry)).toContain('2. Nyssara +Pets = 400@7 in 60s');
  });

  it('settled: the guild\'s numbers (the bot has already folded the pet) keep the mark', () => {
    const { et, entry } = ownedPetFight();
    const settled = { ...entry, players: botRollup(et.perPlayer), uploaders: 3, settled: true };
    expect(histLine(settled)).toBe(
      '/rs a Shissar acolyte in 60s, 0.90K Damage @15, '
      + '1. Corvale = 500@8 in 60s | 2. Nyssara +Pets = 400@7 in 60s');
  });

  it('settled, when the bot left the pet as a raider: no line of its own, no double count', () => {
    const { entry } = ownedPetFight();
    const guild = [{ character: 'Corvale', dmg: 500 }, { character: 'Nyssara', dmg: 400 }, { character: 'Kebantik', dmg: 100 }];
    const line = histLine({ ...entry, players: guild, settled: true });
    expect(line).not.toMatch(/Kebantik/);
    expect(line).toContain('0.90K Damage');
  });
});

describe('what stays off the line', () => {
  it('a pet nobody owns, and a charmed mob nobody can name, are in the header total but are no raider', () => {
    const b = builder('Brackwyn'); const feed = feeder(b);
    // The sporeling's owner spoke two hours before the pull: last night's charm, so "(charmed)", not a raider.
    const old = '[Tue Sep 29 05:00:00 2026] a fungoid sporeling says \'My leader is Zarrin.\'';
    b.add(agent.parseEvent(old, agent.parseEqTimestamp(old)));
    feed(`Corvale slashes ${MOB} for 500 points of damage.`);
    feed(`Kebantik hits ${MOB} for 100 points of damage.`);      // a generated pet name, owner unknown
    feed(`A fungoid sporeling hits ${MOB} for 90 points of damage.`);
    const { et } = record(b, 'Brackwyn');
    expect(et.perPlayer.Kebantik.pet_summoned).toBe(true);
    expect(et.perPlayer['A fungoid sporeling'].pet_charm).toBe(true);
    const line = liveLine(et.perPlayer);
    expect(line).toBe('/rs a Shissar acolyte in 60s, 0.69K Damage @12, 1. Corvale = 500@8 in 60s');
  });

  it('a fight with no raider on it has no line (the button stays hidden)', () => {
    expect(liveLine({})).toBeNull();
    expect(liveLine({ Kebantik: { dmg: 100, pet_summoned: true } })).toBeNull();
  });

  it('at most ten raiders, biggest first', () => {
    const pp = {};
    for (let i = 1; i <= 12; i++) pp['Raider' + String.fromCharCode(96 + i)] = { dmg: i * 100 };
    const players = parseEQLog(liveLine(pp)).players;
    expect(players).toHaveLength(10);
    expect(players.map(p => p.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe('another raider\'s charm pet (FB-52) lands on the same line', () => {
  it('"Corvale +Pets" carries the charm pet a bystander heard claimed', () => {
    const b = builder('Brackwyn');
    const stamp = (s, text) => `[Mon Oct 05 02:47:${String(s).padStart(2, '0')} 2026] ${text}`;
    const feed = (s, text) => { const l = stamp(s, text); if (!agent.shouldKeep(l)) return; const ev = agent.parseEvent(l, agent.parseEqTimestamp(l)); if (ev) b.add(ev); };
    feed(1, "a lesser vind briesl says 'My leader is Corvale.'");
    feed(10, 'Aldenmar slashes a vind briesl for 300 points of damage.');
    feed(11, 'A lesser vind briesl pierces a vind briesl for 120 points of damage.');
    feed(12, 'Corvale hit a vind briesl for 80 points of non-melee damage.');
    const { et } = record(b, 'Brackwyn');
    expect(liveLine(et.perPlayer)).toBe(
      '/rs a Shissar acolyte in 60s, 0.50K Damage @8, '
      + '1. Aldenmar = 300@5 in 60s | 2. Corvale +Pets = 200@3 in 60s');
  });
});

// A correct builder nothing calls guards nothing (a stubbed call site has gone green four times).
// Comments stripped — this file's prose would satisfy a naive toContain.
describe('and both copies are wired through it', () => {
  const clean = stripJs(overlay);
  it('History copies _rsLine over the rows it is browsing', () => {
    expect(clean).toMatch(/_histParseLine = _rsLine\(boss, secs, totalDmg, allRows\);/);
  });
  it('the live copy folds the live rows first', () => {
    expect(clean).toMatch(/var liveRs = _liveRsRows\(et\.perPlayer\);/);
    expect(clean).toMatch(/_lastParseLine = liveRsLine;/);
  });
});
