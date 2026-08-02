// test/backfill-scan.test.js — [#f3] outcome-driven backfill requests.
//
// EVERY fixture below is VERBATIM live data, not a hand-written shape:
//
//   · NIGHT — all 13 encounters and all 118 contributions from the
//     2026-07-30 raid (Ssraeshza Temple), pulled from Supabase 2026-08-02.
//     The three uploads named in docs/STATUS.md as the `state.petOwners`
//     casualties are carried in their AS-UPLOADED form (the repaired rows keep
//     the originals under `raw_parse.players_pre_petfix`, which is where these
//     numbers come from) — Hawkner 380,247/35 on Blood, Bardtholemu
//     3,048,578/45 on the Emperor, Uilnayar 338,515/34 on Rhag`Mozdezh.
//   · EMPEROR_FAMILY — the two eqemu_npc_types rows the Emperor's name matches.
//   · BLOOD_* — the real melee rollup, defender and class data for that fight.
//
// The point of the whole file is the pair of claims in
// docs/DESIGN-outcome-backfill.md: the detector flags those three and ONLY
// those three across a full raid night, and the targeting picks people who can
// actually answer.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const bf = require('../utils/backfillScan.js');

// ── the 2026-07-30 night, verbatim ──────────────────────────────────────────
// [character, damage, playerCount] per upload, ordered as stored.
const NIGHT = [
  { npcId: 162037, name: '#a_glyph_covered_serpent', dur: 148, killed: true, hp: 300000, total: 299207,
    c: [['Shavimo', 299207, 37]] },
  { npcId: 162030, name: '#Arch_Lich_Rhag`Zadune', dur: 275, killed: true, hp: 825000, total: 824368,
    c: [['Hawkner', 888290, 35], ['Hitya', 861916, 35], ['Abrahms', 832881, 33], ['Chadivarius', 825953, 33],
        ['Shavimo', 825549, 32], ['Bardtholemu', 825043, 37], ['Vann', 823811, 33], ['Dant', 803409, 33],
        ['Naggato', 765321, 33], ['Peopleslayer', 689556, 32], ['Fargan', 649108, 32], ['Ashieron', 199542, 29],
        ['Jabouti', 15833, 18]] },
  { npcId: 76051, name: '#Ashenbone_Broodmaster', dur: 2, killed: true, hp: 32000, total: 93,
    c: [['Adiwen', 93, 1]] },
  { npcId: 162189, name: '#Blood_of_Ssraeshza', dur: 265, killed: true, hp: 200000, total: 219677,
    c: [['Hawkner', 380247, 35], ['Chadivarius', 185589, 21], ['Hitya', 182064, 21], ['Dant', 170554, 21],
        ['Shavimo', 148438, 22], ['Fargan', 146316, 19], ['Jabouti', 7800, 1]] },
  { npcId: 162065, name: '#Emperor_Ssraeshza', dur: 1070, killed: true, hp: 1250000, total: 1327143,
    c: [['Bardtholemu', 3048578, 45], ['Shavimo', 1457317, 36], ['Chadivarius', 1180658, 25], ['Hitya', 1180620, 25],
        ['Dant', 1180515, 25], ['Ghalix', 1180303, 25], ['Vann', 1177803, 25], ['Jankzer', 1162406, 32],
        ['Hawkner', 854810, 23], ['Uilnayar', 449180, 19], ['Notadoctor', 449007, 18], ['Wabumkin', 364246, 40],
        ['Jabouti', 83147, 3]] },
  { npcId: 76325, name: '#Lord_of_Ire', dur: 133, killed: true, hp: 32000, total: 20470,
    c: [['Jankzer', 24646, 4], ['Adiwen', 14244, 3]] },
  { npcId: 162192, name: '#Rhag`Mozdezh', dur: 68, killed: true, hp: 200000, total: 200676,
    c: [['Uilnayar', 338515, 34], ['Hawkner', 197919, 31], ['Chadivarius', 197555, 31], ['Abrahms', 197399, 31],
        ['Shavimo', 197374, 29], ['Vann', 196913, 31], ['Hitya', 195940, 31], ['Bardtholemu', 194991, 31],
        ['Peopleslayer', 145771, 28], ['Dant', 143935, 30], ['Fargan', 140037, 28], ['Stupidrichard', 53078, 20],
        ['Ashieron', 46179, 17], ['Jabouti', 6614, 6]] },
  { npcId: 162178, name: '#Rhag`Zhezum', dur: 101, killed: true, hp: 200000, total: 177970,
    c: [['Hawkner', 195268, 27], ['Abrahms', 195268, 27], ['Vann', 194610, 27], ['Bardtholemu', 191503, 28],
        ['Dant', 179016, 27], ['Peopleslayer', 165722, 26], ['Shavimo', 157552, 26], ['Hitya', 152064, 27],
        ['Fargan', 142560, 26], ['Stupidrichard', 54231, 27], ['Ashieron', 50352, 16], ['Chadivarius', 11600, 24],
        ['Jabouti', 4895, 1]] },
  { npcId: 162042, name: '#Vyzh`dra_the_Cursed', dur: 339, killed: true, hp: 900000, total: 876405,
    c: [['Abrahms', 876997, 34], ['Stupidrichard', 862248, 34], ['Hitya', 862175, 34], ['Hawkner', 862156, 34],
        ['Chadivarius', 861956, 34], ['Uilnayar', 861956, 34], ['Naggato', 861688, 34], ['Vann', 857622, 35],
        ['Bardtholemu', 834178, 35], ['Shavimo', 806596, 38], ['Dant', 789991, 34], ['Peopleslayer', 610268, 30],
        ['Fargan', 568462, 30], ['Ashieron', 303436, 24], ['Wabumkin', 92019, 3], ['Jabouti', 32659, 6]] },
  { npcId: 162039, name: '#Vyzh`dra_the_Exiled', dur: 135, killed: true, hp: 450000, total: 440682,
    c: [['Chadivarius', 433762, 36], ['Hawkner', 433762, 36], ['Hitya', 433762, 36], ['Stupidrichard', 433503, 35],
        ['Dant', 433503, 35], ['Shavimo', 433477, 34], ['Fittir', 433303, 35], ['Abrahms', 433303, 35],
        ['Vann', 433303, 35], ['Uilnayar', 433278, 34], ['Naggato', 426022, 34], ['Peopleslayer', 357176, 29],
        ['Bardtholemu', 339172, 35], ['Fargan', 181647, 29], ['Ashieron', 101389, 28], ['Jabouti', 14712, 8]] },
  { npcId: 162076, name: 'High_Priest_of_Ssraeshza', dur: 328, killed: true, hp: 930000, total: 919037,
    c: [['Shavimo', 919037, 33]] },
  { npcId: 72002, name: 'Terror', dur: 6, killed: true, hp: 32000, total: 9347,
    c: [['Abrahms', 9371, 18], ['Hawkner', 8520, 14], ['Hitya', 8156, 13], ['Uilnayar', 8156, 13],
        ['Vann', 8156, 13], ['Dant', 8156, 13], ['Jankzer', 8156, 13], ['Naggato', 8156, 13],
        ['Peopleslayer', 8156, 13], ['Stupidrichard', 8156, 13], ['Shavimo', 8155, 11], ['Fargan', 8076, 13]] },
  { npcId: 162190, name: 'Xerkizh_The_Creator', dur: 287, killed: true, hp: 800000, total: 796031,
    c: [['Uilnayar', 783489, 36], ['Bardtholemu', 776040, 32], ['Shavimo', 774708, 30], ['Hawkner', 774708, 32],
        ['Abrahms', 774708, 32], ['Vann', 774587, 32], ['Hitya', 774344, 32], ['Dant', 773925, 32],
        ['Naggato', 773721, 32], ['Chadivarius', 773615, 32], ['Ghalix', 773188, 32], ['Peopleslayer', 555112, 28],
        ['Fargan', 544797, 28], ['Stupidrichard', 488117, 31], ['Jankzer', 392209, 32], ['Wabumkin', 383792, 40],
        ['Ashieron', 236646, 27], ['Statlander', 72871, 1], ['Jabouti', 20825, 6]] },
];

const encOf = (f, i) => ({
  id: `enc-${i}`, npcName: f.name, startedAt: '2026-07-31T02:35:10+00:00',
  durationSec: f.dur, totalDamage: f.total, killed: f.killed,
});
const contribsOf = f => f.c.map(([character, damage, playerCount], i) => ({
  id: `c-${i}`, character, damage, playerCount, durationSec: f.dur, agentVersion: '3.4.36',
}));

// ── eqemu_npc_types rows for the Emperor's name family (2026-08-02) ─────────
// The keyed row is a PLACEHOLDER (immune to melee 19 AND magic 20) at 1,000,000
// hp / AC 200; the body the raid actually kills is the trailing-space variant
// at 1,250,000 / AC 700.
const EMPEROR_FAMILY = [
  { id: 162065, name: '#Emperor_Ssraeshza', level: 66, maxlevel: 0, hp: 1000000, ac: 200, runspeed: 1.25,
    special_abilities: '10,1^19,1^20,1^21,1^24,1^25,1^35,1^39,1^43,1^46,1' },
  { id: 162491, name: 'Emperor_Ssraeshza_', level: 66, maxlevel: 0, hp: 1250000, ac: 700, runspeed: 1.25,
    special_abilities: '1,1^2,1^3,1,10,150^7,1^10,1^13,1^14,1^15,1^16,1^17,1^21,1^22,1^31,1^43,1^46,1' },
];

describe('resolveHpPool — the #171 ladder decides the pool, not the keyed row', () => {
  it('Emperor Ssraeshza: keyed row is the 1.0M placeholder, real body is 1.25M', () => {
    const r = bf.resolveHpPool(EMPEROR_FAMILY, { npcId: 162065, keyedRow: EMPEROR_FAMILY[0] });
    expect(r.hpPool).toBe(1250000);
    expect(r.rowId).toBe(162491);
    expect(r.keyedWasPlaceholder).toBe(true);
  });

  it('using the KEYED row would have pushed the clean 1.18M consensus toward the gate', () => {
    // The 25-player consensus that night was 1,180,303. Against the placeholder
    // pool that reads 1.18x; against the real body it is 0.94x. Both are under
    // the 1.30 gate today, but the margin is 6x bigger with the right row —
    // which is the whole reason this goes through pickAndMergeMobRows.
    expect(1180303 / 1000000).toBeCloseTo(1.18, 2);
    expect(1180303 / 1250000).toBeCloseTo(0.94, 2);
  });

  it('a single-row name resolves to itself; an unknown name yields no pool', () => {
    const one = [{ id: 162189, name: '#Blood_of_Ssraeshza', level: 63, hp: 200000, special_abilities: '1,1^2,1' }];
    expect(bf.resolveHpPool(one, { npcId: 162189 }).hpPool).toBe(200000);
    expect(bf.resolveHpPool([], { npcId: 999999 }).hpPool).toBeNull();
  });
});

describe('findInflated — the 2026-07-30 night, all 13 fights', () => {
  const flagsFor = f => bf.findInflated(encOf(f, 0), contribsOf(f), f.hp);

  it('flags Hawkner on Blood of Ssraeshza (380k on a 200k mob, 2.4x the others)', () => {
    const hits = flagsFor(NIGHT.find(f => f.name === '#Blood_of_Ssraeshza'));
    expect(hits).toHaveLength(1);
    expect(hits[0].character).toBe('Hawkner');
    expect(hits[0].damage).toBe(380247);
    expect(hits[0].hpRatio).toBeCloseTo(1.90, 2);
    expect(hits[0].medianRatio).toBeCloseTo(2.38, 2);
    expect(hits[0].playerCount).toBe(35);
    expect(Math.round(hits[0].siblingPlayerCount)).toBe(21);
  });

  it('flags Bardtholemu on the 02:42 Emperor (3.05M against a 1.25M pool)', () => {
    const hits = flagsFor(NIGHT.find(f => f.name === '#Emperor_Ssraeshza'));
    expect(hits).toHaveLength(1);
    expect(hits[0].character).toBe('Bardtholemu');
    expect(hits[0].hpRatio).toBeCloseTo(2.44, 2);
    expect(hits[0].medianRatio).toBeCloseTo(2.61, 2);
  });

  it('flags Uilnayar on the 01:05 Rhag`Mozdezh — the tightest of the three', () => {
    const hits = flagsFor(NIGHT.find(f => f.name === '#Rhag`Mozdezh'));
    expect(hits).toHaveLength(1);
    expect(hits[0].character).toBe('Uilnayar');
    expect(hits[0].hpRatio).toBeCloseTo(1.69, 2);
    expect(hits[0].medianRatio).toBeCloseTo(1.74, 2);
    // Still a comfortable margin over both gates — not a threshold shave.
    expect(hits[0].hpRatio).toBeGreaterThan(bf.HP_RATIO * 1.25);
    expect(hits[0].medianRatio).toBeGreaterThan(bf.MEDIAN_RATIO * 1.15);
  });

  it('flags NOTHING on the other ten fights (118 uploads, zero false positives)', () => {
    const noisy = ['#Blood_of_Ssraeshza', '#Emperor_Ssraeshza', '#Rhag`Mozdezh'];
    for (const f of NIGHT.filter(x => !noisy.includes(x.name))) {
      expect(flagsFor(f), `${f.name} should be clean`).toEqual([]);
    }
  });

  it('the whole night yields exactly three flags', () => {
    const all = NIGHT.flatMap(f => flagsFor(f));
    expect(all.map(h => `${h.character}@${h.npcName}`).sort()).toEqual([
      'Bardtholemu@Emperor Ssraeshza',
      'Hawkner@Blood of Ssraeshza',
      'Uilnayar@Rhag`Mozdezh',
    ]);
  });
});

describe('findInflated — why BOTH gates are needed', () => {
  const blood = NIGHT.find(f => f.name === '#Blood_of_Ssraeshza');

  // Verbatim: Trakanon, 2026-07-30 01:03:20Z, npc 89154 (hp 32,000), six uploads.
  // Bardtholemu is 2.04x the median of the others — the sibling gate fires —
  // but only 1.28x the mob's health, which the HP anchor holds back. This is
  // the nearest MISS in the whole corpus and the reason the anchor exists: a
  // 31-second trash kill with one wide parse is not evidence of corruption.
  const TRAKANON = { npcId: 89154, name: 'Trakanon', dur: 31, killed: true, hp: 32000, total: 35054,
    c: [['Bardtholemu', 40955, 25], ['Barberic', 33723, 22], ['Chadivarius', 32077, 22],
        ['Fuggin', 20085, 19], ['Hawkner', 14885, 24], ['Donaldus', 13536, 10]] };

  it('the sibling-median gate alone flags Trakanon; the HP anchor holds it back', () => {
    const medOnly = bf.findInflated(encOf(TRAKANON, 0), contribsOf(TRAKANON), TRAKANON.hp, { hpRatio: 0 });
    // THREE of six uploads on one 31-second trash kill — that is what the
    // sibling gate on its own costs you.
    expect(medOnly.map(h => h.character)).toEqual(['Bardtholemu', 'Barberic', 'Chadivarius']);
    expect(medOnly[0].medianRatio).toBeCloseTo(2.04, 2);
    expect(medOnly[0].hpRatio).toBeCloseTo(1.28, 2);
    // Both gates → nothing. Corpus-wide the median gate alone fires on 21% of
    // uploads; paired with the anchor it fires on 1.1%.
    expect(bf.findInflated(encOf(TRAKANON, 0), contribsOf(TRAKANON), TRAKANON.hp)).toEqual([]);
  });

  it('the HP gate alone can be tripped by a merged double-kill — everyone overshoots together', () => {
    // find_or_create_encounter's ±30min window can knit two pulls into one row.
    // The tell is that EVERY real parse doubles, so no one disagrees.
    const doubled = contribsOf(blood).map(c => ({ ...c, damage: c.damage * 2 }));
    const hpOnly = bf.findInflated(encOf(blood, 0), doubled, blood.hp, { medianRatio: 0 });
    expect(hpOnly.map(h => h.character)).toEqual(
      ['Hawkner', 'Chadivarius', 'Hitya', 'Dant', 'Shavimo', 'Fargan']);   // all but the 1-player sliver
    // Both gates: only the one that ALSO disagrees with its siblings.
    expect(bf.findInflated(encOf(blood, 0), doubled, blood.hp).map(h => h.character)).toEqual(['Hawkner']);
  });

  it('needs a real consensus — under MIN_CONTRIBS nothing is flagged', () => {
    const two = contribsOf(blood).slice(0, 2);
    expect(bf.findInflated(encOf(blood, 0), two, blood.hp)).toEqual([]);
  });

  it('an unknown HP pool never guesses', () => {
    expect(bf.findInflated(encOf(blood, 0), contribsOf(blood), null)).toEqual([]);
    expect(bf.findInflated(encOf(blood, 0), contribsOf(blood), 0)).toEqual([]);
  });
});

describe('findCoverageGap — the other kind of bad data', () => {
  it('flags the two fights whose parse never really arrived', () => {
    const thin = NIGHT.map(f => bf.findCoverageGap(encOf(f, 0), f.hp)).filter(Boolean);
    expect(thin.map(t => t.npcName).sort()).toEqual(['Ashenbone Broodmaster', 'Terror']);
  });

  it('Ashenbone Broodmaster: a confirmed kill with 93 damage on the board', () => {
    const f = NIGHT.find(x => x.name === '#Ashenbone_Broodmaster');
    const t = bf.findCoverageGap(encOf(f, 0), f.hp);
    expect(t.coverage).toBeLessThan(0.01);
  });

  it('never fires on an unconfirmed engagement — short damage is what a wipe looks like', () => {
    const f = NIGHT.find(x => x.name === '#Ashenbone_Broodmaster');
    expect(bf.findCoverageGap({ ...encOf(f, 0), killed: false }, f.hp)).toBeNull();
  });

  it('leaves the ten fights that landed at 0.89-1.10 of the pool alone', () => {
    const clean = NIGHT.filter(f => !['#Ashenbone_Broodmaster', 'Terror'].includes(f.name));
    for (const f of clean) expect(bf.findCoverageGap(encOf(f, 0), f.hp), f.name).toBeNull();
  });
});

// ── targeting: the real Blood of Ssraeshza bystanders ────────────────────────
// melee = melee-verb hits from encounter_combat_rollup.by_skill;
// def    = the raw_parse.defenders entry (hits / damageTaken);
// active = has uploaded a contribution in the last 14 days.
const BLOOD_PEOPLE = [
  { name: 'Currygoat',    klass: 'Warrior',       melee: 358, def: { hits: 153, damageTaken: 40244 }, active: false },
  { name: 'Ashieron',     klass: 'Paladin',       melee: 82,  def: { hits: 140, damageTaken: 20231 }, active: true },
  { name: 'Peopleslayer', klass: 'Warrior',       melee: 76,  def: { hits: 30,  damageTaken: 15325 }, active: true },
  { name: 'Abrahms',      klass: 'Paladin',       melee: 53,  def: { hits: 80,  damageTaken: 12997 }, active: true },
  { name: 'Naggato',      klass: 'Paladin',       melee: 50,  def: { hits: 22,  damageTaken: 5510 },  active: true },
  { name: 'Fittir',       klass: 'Monk',          melee: 372, def: null,                              active: true },
  { name: 'Jankzer',      klass: 'Enchanter',     melee: 175, def: { hits: 19,  damageTaken: 4271 },  active: true },
  { name: 'Syphon',       klass: 'Shadow Knight', melee: 100, def: { hits: 25,  damageTaken: 3843 },  active: false, died: true },
  { name: 'Hitya',        klass: 'Monk',          melee: 341, def: { hits: 12,  damageTaken: 3063 },  active: true, uploaded: true },
  { name: 'Hawkner',      klass: 'Paladin',       melee: 83,  def: { hits: 80,  damageTaken: 10810 }, active: true, uploaded: true },
  { name: 'Damyu',        klass: 'Ranger',        melee: 1,   def: { hits: 1,   damageTaken: 350 },   active: true },
  { name: 'Elyas',        klass: 'Druid',         melee: 1,   def: null,                              active: true },
];

function bloodRankInput(overrides = {}) {
  return {
    durationSec: 265,
    present: BLOOD_PEOPLE.map(p => ({ name: p.name, observedDurationSec: 263 })),
    meleeHitsByName: new Map(BLOOD_PEOPLE.map(p => [p.name.toLowerCase(), p.melee])),
    defenderByName: new Map(BLOOD_PEOPLE.filter(p => p.def).map(p => [p.name.toLowerCase(), p.def])),
    classByName: new Map(BLOOD_PEOPLE.map(p => [p.name.toLowerCase(), p.klass])),
    diedNames: new Set(BLOOD_PEOPLE.filter(p => p.died).map(p => p.name.toLowerCase())),
    activeUploaders: new Set(BLOOD_PEOPLE.filter(p => p.active).map(p => p.name.toLowerCase())),
    alreadyUploaded: new Set(BLOOD_PEOPLE.filter(p => p.uploaded).map(p => p.name.toLowerCase())),
    excluded: new Set(['hawkner']),          // the suspect is never asked
    alreadyAsked: new Set(),
    ...overrides,
  };
}

describe('rankAskCandidates — who can actually settle it', () => {
  it('picks the tanks who were in melee the whole fight and never died', () => {
    const top = bf.rankAskCandidates(bloodRankInput()).slice(0, 3).map(r => r.name);
    expect(top).toEqual(['Ashieron', 'Peopleslayer', 'Abrahms']);
  });

  it('drops Currygoat — the main tank, the best possible witness, no agent', () => {
    const all = bf.rankAskCandidates(bloodRankInput()).map(r => r.name);
    expect(all).not.toContain('Currygoat');
    // …and he'd have been first if he ran it. This is the exact failure mode of
    // the 92 stale pending rows: 50 of their 58 characters never uploaded once.
    const withAgent = bf.rankAskCandidates(bloodRankInput({
      activeUploaders: new Set([...bloodRankInput().activeUploaders, 'currygoat']),
    }));
    expect(withAgent[0].name).toBe('Currygoat');
  });

  it('never asks the suspect, and never asks someone whose log we already have', () => {
    const all = bf.rankAskCandidates(bloodRankInput()).map(r => r.name);
    expect(all).not.toContain('Hawkner');    // suspect
    expect(all).not.toContain('Hitya');      // already uploaded this fight
  });

  it('requires PROVEN presence — one stray swing is not a vantage point', () => {
    const all = bf.rankAskCandidates(bloodRankInput()).map(r => r.name);
    expect(all).not.toContain('Damyu');      // 1 melee hit, 1 defender hit
    expect(all).not.toContain('Elyas');      // 1 melee hit, never tanked
  });

  it('a raider who died ranks below one who did not — a corpse stops seeing the fight', () => {
    const base = bloodRankInput();
    const withDeath = bf.rankAskCandidates({ ...base, diedNames: new Set(['ashieron']) });
    expect(withDeath[0].name).not.toBe('Ashieron');
    expect(withDeath.find(r => r.name === 'Ashieron').why).toContain('died — log has a gap');
  });

  it('someone with an open ask for this same fight is skipped, not re-pinged', () => {
    const all = bf.rankAskCandidates(bloodRankInput({ alreadyAsked: new Set(['ashieron', 'peopleslayer']) }));
    expect(all.map(r => r.name).slice(0, 1)).toEqual(['Abrahms']);
  });

  it('is deterministic — same input, same order', () => {
    const a = bf.rankAskCandidates(bloodRankInput()).map(r => r.name);
    const b = bf.rankAskCandidates(bloodRankInput()).map(r => r.name);
    expect(a).toEqual(b);
  });

  it('a half-fight witness scores below a whole-fight one, all else equal', () => {
    const input = bloodRankInput();
    const late = bf.rankAskCandidates({
      ...input,
      present: input.present.map(p => p.name === 'Ashieron' ? { ...p, observedDurationSec: 40 } : p),
    });
    const full = bf.rankAskCandidates(input);
    const scoreOf = (rows, n) => rows.find(r => r.name === n).score;
    expect(scoreOf(late, 'Ashieron')).toBeLessThan(scoreOf(full, 'Ashieron'));
  });
});

describe('meleeHitsOf — melee verbs only', () => {
  it('counts swings, not spells, damage shields or pets', () => {
    // Verbatim by_skill for Currygoat on the Blood fight.
    expect(bf.meleeHitsOf({ by_skill: {
      hit: { dmg: 9350, hits: 94 }, kick: { dmg: 42, hits: 6 },
      slash: { dmg: 6450, hits: 258 }, 'ds:non-melee': { dmg: 2880, hits: 8 },
    } })).toBe(358);
    expect(bf.meleeHitsOf({ by_skill: {
      'non-melee': { dmg: 500000, hits: 40 }, 'Breath of Ro': { dmg: 172009, hits: 22 },
    } })).toBe(0);
    expect(bf.meleeHitsOf(null)).toBe(0);
  });
});

describe('the ask itself', () => {
  const finding = {
    kind: 'inflated', encounterId: 'enc-blood', npcName: 'Blood of Ssraeshza',
    startedAt: '2026-07-31T02:35:10+00:00', durationSec: 265, character: 'Hawkner',
    damage: 380247, siblingMedian: 159496, hpPool: 200000, hpRatio: 1.9, medianRatio: 2.38, severity: 4.5,
    candidates: bf.rankAskCandidates(bloodRankInput()),
  };

  it('never names the over-reporting uploader — this is a parser bug, not a person', () => {
    for (const c of finding.candidates.slice(0, 3)) {
      expect(bf.requestReason(finding, c)).not.toMatch(/Hawkner/);
    }
  });

  it('says what we think is wrong, why they were picked, and that nobody is in trouble', () => {
    const reason = bf.requestReason(finding, finding.candidates[0]);
    expect(reason).toMatch(/Blood of Ssraeshza/);
    expect(reason).toMatch(/melee swings on it/);
    expect(reason).toMatch(/nobody's in trouble/i);
    expect(reason.length).toBeLessThanOrEqual(300);
  });

  it('the coverage-gap copy asks for the missing half, not for an adjudication', () => {
    const thin = { kind: 'thin', npcName: 'Terror', startedAt: finding.startedAt, durationSec: 6,
                   coverage: 0.29, hpPool: 32000, totalDamage: 9347, severity: 0.71, candidates: finding.candidates };
    const reason = bf.requestReason(thin, finding.candidates[0]);
    expect(reason).toMatch(/partial parse/);
    expect(reason).toMatch(/Terror/);
    expect(reason.length).toBeLessThanOrEqual(300);
  });

  it('files at most 3 per fight, keyed on the encounter start so re-runs collapse', () => {
    const rows = bf.buildRequestRows([finding], { requestedByName: 'Hitya' });
    expect(rows).toHaveLength(3);
    expect(rows.map(r => r.character)).toEqual(['Ashieron', 'Peopleslayer', 'Abrahms']);
    for (const r of rows) {
      // start_iso VERBATIM — it's the unique-index key AND what /admin/encounters
      // matches on to grey out "already pinged".
      expect(r.scope.start_iso).toBe('2026-07-31T02:35:10+00:00');
      expect(r.scope.types).toEqual(['encounter']);
      expect(r.scope.source).toBe('outcome-scan');
      expect(Date.parse(r.scope.end_iso)).toBeGreaterThan(Date.parse(r.scope.start_iso) + 265_000);
    }
  });

  it('caps the whole scan, and nobody gets asked more than twice in one run', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ ...finding, encounterId: `e${i}`, severity: 10 - i }));
    const rows = bf.buildRequestRows(many, {});
    expect(rows.length).toBeLessThanOrEqual(bf.MAX_ASKS_PER_SCAN);
    const per = new Map();
    for (const r of rows) per.set(r.character, (per.get(r.character) || 0) + 1);
    for (const n of per.values()) expect(n).toBeLessThanOrEqual(bf.MAX_ASKS_PER_PERSON);
  });

  it('spends the cap on the worst data first — inflated before thin', () => {
    const thin = { kind: 'thin', npcName: 'Terror', startedAt: '2026-07-31T01:53:04+00:00', durationSec: 6,
                   coverage: 0.29, hpPool: 32000, totalDamage: 9347, severity: 0.71,
                   candidates: finding.candidates };
    const rows = bf.buildRequestRows([thin, finding], { maxPerScan: 3 });
    expect(rows.every(r => /Blood of Ssraeshza/.test(r.reason))).toBe(true);
  });

  it('a finding with no qualifying bystander files nothing at all', () => {
    expect(bf.buildRequestRows([{ ...finding, candidates: [] }], {})).toEqual([]);
  });
});

describe('expirySweepIds — the 92 stale rows', () => {
  // Shape of the real backlog: filed 2026-06-09, scoped at a 2026-06-08 fight.
  const stale = (id, status) => ({
    id, status, requested_at: '2026-06-09T18:00:00+00:00',
    scope: { start_iso: '2026-06-08T01:44:21+00:00', end_iso: '2026-06-08T01:54:21.000Z', types: ['encounter'] },
  });
  const NOW = Date.parse('2026-08-02T12:00:00Z');
  const UUID = n => `00000000-0000-0000-0000-00000000000${n}`;

  it('retires open requests whose LOG window is past the horizon', () => {
    const ids = bf.expirySweepIds([stale(UUID(1), 'pending'), stale(UUID(2), 'acked')], { nowMs: NOW });
    expect(ids).toEqual([UUID(1), UUID(2)]);
  });

  it('leaves anything already terminal alone', () => {
    for (const st of ['completed', 'dismissed', 'errored', 'expired']) {
      expect(bf.expirySweepIds([stale(UUID(3), st)], { nowMs: NOW })).toEqual([]);
    }
  });

  it('never touches a fresh ask', () => {
    const fresh = { id: UUID(4), status: 'pending', requested_at: '2026-08-01T00:00:00Z',
      scope: { start_iso: '2026-07-31T02:35:10+00:00', end_iso: '2026-07-31T02:45:10.000Z' } };
    expect(bf.expirySweepIds([fresh], { nowMs: NOW })).toEqual([]);
  });

  it('expires on the LOG window, not the filing date — a stale fight filed today still expires', () => {
    const filedToday = { ...stale(UUID(5), 'pending'), requested_at: '2026-08-02T11:00:00Z' };
    expect(bf.expirySweepIds([filedToday], { nowMs: NOW })).toEqual([UUID(5)]);
  });
});

describe('analyzeScanData — the whole path, in real Supabase row shapes', () => {
  // The Blood of Ssraeshza encounter as `collectScanData` returns it.
  const START = '2026-07-31T02:35:10+00:00';
  const data = {
    window: { fromMs: Date.parse('2026-07-30T10:00:00Z'), toMs: Date.parse('2026-07-31T10:00:00Z') },
    encounters: [{
      id: 'blood', npc_id: 162189, started_at: START, ended_at: '2026-07-31T02:39:35+00:00',
      duration_sec: 265, total_damage: 219677, classification: null,
      eqemu_npc_types: { name: '#Blood_of_Ssraeshza', hp: 200000, special_abilities: '1,1^2,1' },
      encounter_players: BLOOD_PEOPLE.map(p => ({ character_name: p.name, total_damage: 1000, duration_sec: 265 })),
    }],
    contribs: NIGHT.find(f => f.name === '#Blood_of_Ssraeshza').c.map(([character, damage, pc], i) => ({
      id: `c${i}`, encounter_id: 'blood', contributor_character: character,
      total_damage: damage, player_count: pc, duration_sec: 265, agent_version: '3.4.36',
      players: BLOOD_PEOPLE.map(p => ({ name: p.name, duration: 263 })),
      defenders: BLOOD_PEOPLE.filter(p => p.def).map(p => ({ name: p.name, ...p.def })),
      deaths: character === 'Hitya' ? [{ name: 'Syphon', ts: '2026-07-31T02:37:00Z' }] : [],
    })),
    rollups: BLOOD_PEOPLE.map(p => ({
      encounter_id: 'blood', character_name: p.name, by_skill: { hit: { dmg: 1, hits: p.melee } },
    })),
    characters: BLOOD_PEOPLE.map(p => ({ name: p.name, class: p.klass, exclude_from_stats: false })),
    activeUploaders: new Set(BLOOD_PEOPLE.filter(p => p.active).map(p => p.name.toLowerCase())),
    openRequests: [],
    npcFamilyRows: new Map([[162189, [{ id: 162189, name: '#Blood_of_Ssraeshza', level: 63, hp: 200000,
      special_abilities: '1,1^2,1^5,1,25^10,1^13,1^14,1^15,1^16,1^17,1^21,1^23,1^31,1^43,1' }]]]),
  };

  it('detects the one bad upload and proposes three named asks', () => {
    const scan = bf.analyzeScanData(data);
    expect(scan.scanned).toBe(1);
    expect(scan.findings).toHaveLength(1);
    expect(scan.findings[0].character).toBe('Hawkner');
    expect(scan.proposals.map(r => r.character)).toEqual(['Ashieron', 'Peopleslayer', 'Abrahms']);
    expect(scan.proposals.every(r => r.scope.start_iso === START)).toBe(true);
  });

  it('respects exclude_from_stats — an opted-out raider is never asked', () => {
    const opted = {
      ...data,
      characters: data.characters.map(c => c.name === 'Ashieron' ? { ...c, exclude_from_stats: true } : c),
    };
    expect(bf.analyzeScanData(opted).proposals.map(r => r.character)).not.toContain('Ashieron');
  });

  it('skips a foreign raid entirely', () => {
    const foreign = { ...data, encounters: [{ ...data.encounters[0], classification: 'foreign' }] };
    const scan = bf.analyzeScanData(foreign);
    expect(scan.scanned).toBe(0);
    expect(scan.findings).toEqual([]);
  });

  it('does not re-ask someone who already has an open request for this fight', () => {
    const asked = { ...data, openRequests: [
      { id: 'r1', character: 'Ashieron', status: 'pending', scope: { start_iso: START } },
    ] };
    expect(bf.analyzeScanData(asked).proposals.map(r => r.character)).toEqual(
      ['Peopleslayer', 'Abrahms', 'Naggato']);
  });

  it('a clean encounter produces no findings and no proposals', () => {
    const clean = {
      ...data,
      contribs: data.contribs.filter(c => c.contributor_character !== 'Hawkner'),
    };
    const scan = bf.analyzeScanData(clean);
    expect(scan.findings).toEqual([]);
    expect(scan.proposals).toEqual([]);
  });
});

describe('renderScanEmbeds', () => {
  it('a clean night says so instead of inventing work', () => {
    const [e] = bf.renderScanEmbeds({ scanned: 13, findings: [], proposals: [], expirable: [] });
    expect(e.data.description).toMatch(/\*\*0\*\* with bad data/);
    expect(JSON.stringify(e.data.fields)).toMatch(/Nothing looks wrong/);
  });

  it('a preview says it is a preview', () => {
    const finding = { kind: 'inflated', npcName: 'Blood of Ssraeshza', startedAt: '2026-07-31T02:35:10+00:00',
      damage: 380247, siblingMedian: 159496, hpPool: 200000, hpRatio: 1.9, medianRatio: 2.38,
      playerCount: 35, siblingPlayerCount: 21, agentVersion: '3.4.36',
      candidates: bf.rankAskCandidates(bloodRankInput()) };
    const [e] = bf.renderScanEmbeds({ scanned: 13, findings: [finding],
      proposals: bf.buildRequestRows([finding], {}), expirable: [], applied: false });
    expect(e.data.footer.text).toMatch(/Preview only/);
    const body = JSON.stringify(e.data.fields);
    expect(body).toMatch(/\*\*190%\*\* of the 200k HP pool/);
    expect(body).toMatch(/Ashieron/);
  });
});
