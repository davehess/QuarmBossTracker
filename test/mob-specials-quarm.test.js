// FB-54 — the special-abilities table follows PROJECT QUARM's numbering, and
// code 50 (Reverse Slow) is called out. REAL-IMPORT: every assertion calls the
// shipped functions in utils/mobSpecials.js; nothing here reads source text.
//
// Why: a member reported that some mobs are "reverse slowable" and the Target
// Info card said nothing. The table had been written against a different EQEmu
// numbering (Quad Attack at 7, "Immune Ranged Attacks" at 44, nothing at 50).
// The authority is Project Quarm's server, EQMacEmu:
//   https://github.com/SecretsOTheP/EQMacEmu  common/emu_constants.h
//   `namespace SpecialAbility` (lines 358-416 as of 2026-10-06; Max = 55)
// and PQDI renders the same numbers (pqdi.cc/npc/209070, 114618, 179037).

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ms = require('../utils/mobSpecials.js');

// The EQMacEmu enum, code → constant name, transcribed from emu_constants.h.
// If Quarm adds a code, this list goes stale ON PURPOSE: the coverage test
// below fails until the table and this list are both updated.
const QUARM_ENUM = {
  1: 'Summon', 2: 'Enrage', 3: 'Rampage', 4: 'AreaRampage', 5: 'Flurry',
  6: 'TripleAttack', 7: 'DualWield', 8: 'DisallowEquip', 9: 'BaneAttack',
  10: 'MagicalAttack', 11: 'RangedAttack', 12: 'SlowImmunity', 13: 'MesmerizeImmunity',
  14: 'CharmImmunity', 15: 'StunImmunity', 16: 'SnareImmunity', 17: 'FearImmunity',
  18: 'DispellImmunity', 19: 'MeleeImmunity', 20: 'MagicImmunity', 21: 'FleeingImmunity',
  22: 'MeleeImmunityExceptBane', 23: 'MeleeImmunityExceptMagical', 24: 'AggroImmunity',
  25: 'BeingAggroImmunity', 26: 'CastingFromRangeImmunity', 27: 'FeignDeathImmunity',
  28: 'TauntImmunity', 29: 'TunnelVision', 30: 'NoBuffHealFriends', 31: 'PacifyImmunity',
  32: 'Leash', 33: 'Tether', 34: 'PermarootFlee', 35: 'HarmFromClientImmunity',
  36: 'AlwaysFlee', 37: 'FleePercent', 38: 'AllowBeneficial', 39: 'DisableMelee',
  40: 'NPCChaseDistance', 41: 'AllowedToTank', 42: 'ProximityAggro', 43: 'AlwaysCallHelp',
  44: 'UseWarriorSkills', 45: 'AlwaysFleeLowCon', 46: 'NoLoitering',
  47: 'BadFactionBlockHandin', 48: 'PCDeathblowCorpse', 49: 'CorpseCamper',
  50: 'ReverseSlow', 51: 'HasteImmunity', 52: 'DisarmImmunity', 53: 'RiposteImmunity',
  54: 'ProximityAggro2',
};

// Real catalog row (eqemu_npc_types id 209070, PQDI 2026-10-06). PQDI reads it
// as: Summon, Do Not Equip, Magical Attack, Unmezzable, Uncharmable, Unsnarable,
// Unfearable, Immune to fleeing, Immune to melee except magical, Use Warrior
// Skills, Reverse Slow — with slow_mitigation 50.
const LAEF = {
  id: 209070, name: 'Laef_Windfall', level: 65, maxlevel: 0, hp: 0, runspeed: 1.25, npcspecialattks: null,
  special_abilities: '1,1^8,1^10,1^13,1^14,1^16,1^17,1^21,1^23,1^44,1^50,1',
};
// Real rows, PQDI 2026-10-06 — the numbers the OLD table got wrong.
const YELINAK = { id: 114618, special_abilities: '1,1^2,1^3,1,7^6,1^7,1^10,1^12,1^13,1^14,1^15,1^16,1^17,1^21,1^26,1' };
const ITRAER = { id: 179037, special_abilities: '1,1^2,1^3,1,35^10,1^12,1^13,1^14,1^16,1^17,1^21,1^23,1^31,1^42,1^43,1' };
const MAESTRO = { id: 76006, special_abilities: '1,1^10,1^13,1^14,1^15,1^16,1^17,1^21,1^23,1^31,1^42,1^44,1' };

const REVERSE = ms.MOB_SPECIAL_CODES[50].label;

describe('FB-54 the table covers exactly the Quarm enum', () => {
  it('has an entry for every code 1..54 and nothing past the enum\'s Max', () => {
    const codes = Object.keys(ms.MOB_SPECIAL_CODES).map(Number).sort((a, b) => a - b);
    expect(codes).toEqual(Object.keys(QUARM_ENUM).map(Number).sort((a, b) => a - b));
  });

  it('pins the codes that differ from the older EQEmu numbering', () => {
    const L = (c) => ms.MOB_SPECIAL_CODES[c].label;
    expect(L(7)).toBe('Dual Wield');             // was 'Quad Attack'
    expect(L(8)).toBe('Does Not Equip');         // was 'Dual Wield'; shown on Target Info since 2026-10-08
    expect(L(31)).toBe('Immune Pacify');         // unchanged — the agent's pacify gate keys on it
    expect(L(34)).toBe('Permaroot Flee');        // was 'Destructible Object'
    expect(L(41)).toBe('Allowed To Tank');       // was 'Casting Resist Diff'
    expect(L(42)).toBe('Proximity Aggro');       // was 'Counter Avoid Damage'
    expect(L(43)).toBe('Always Call For Help');  // was 'Prox Aggro'
    expect(L(44)).toBe('Use Warrior Skills');    // was 'Immune Ranged Attacks'
    expect(L(46)).toBe('No Loitering');          // was 'Immune Damage (NPC/Pet)'
    expect(L(50)).toMatch(/^Reverse Slow/);      // was absent
  });

  it('keeps the labels other surfaces match on, at the codes Quarm uses', () => {
    // The agent greps `specials` for these exact strings.
    const L = (c) => ms.MOB_SPECIAL_CODES[c].label;
    expect([L(1), L(2), L(3), L(4), L(5), L(12), L(31)])
      .toEqual(['Summon', 'Enrage', 'Rampage', 'Area Rampage', 'Flurry', 'Unslowable', 'Immune Pacify']);
  });
});

describe('FB-54 Reverse Slow is called out', () => {
  it('is a shown, danger-flagged chip with a member-facing explanation', () => {
    const def = ms.MOB_SPECIAL_CODES[50];
    expect(def.show).toBe(true);
    expect(def.danger).toBe(true);
    expect(def.label).toMatch(/slowing hastes it/i);
  });

  it('Laef Windfall (209070) decodes the way PQDI reads it', () => {
    expect(ms.decodeSpecialLabels(LAEF.special_abilities, null)).toEqual([
      'Summon', 'Does Not Equip', 'Magical', 'Unmezzable', 'Uncharmable', 'Unsnareable', 'Unfearable',
      'Immune Fleeing', 'Immune Non-Magical', REVERSE,
    ]);
  });

  it('comes out of the full pick-and-merge path the endpoint uses', () => {
    const picked = ms.pickAndMergeMobRows([LAEF], { zoneId: ms.zoneIdOf(LAEF.id) });
    expect(picked.row.id).toBe(209070);
    expect(picked.specials).toContain(REVERSE);
  });

  it('is not shown on a mob without code 50, and a disabled 50 does not count', () => {
    expect(ms.decodeSpecialLabels(MAESTRO.special_abilities, null)).not.toContain(REVERSE);
    expect(ms.decodeSpecialLabels('10,1^50,0', null)).not.toContain(REVERSE);
  });

  it('is unioned across same-name bodies — one Reverse Slow body is enough to warn', () => {
    const plain = { id: 209071, name: 'Laef_Windfall', level: 65, hp: 1, special_abilities: '1,1^8,1' };
    const picked = ms.pickAndMergeMobRows([plain, LAEF], { zoneId: null });
    expect(picked.specials).toContain(REVERSE);
  });
});

describe('FB-54 the old numbering no longer leaks onto real mobs', () => {
  it('Use Warrior Skills (44) is not read as an immunity to ranged attacks', () => {
    for (const row of [LAEF, MAESTRO]) {
      const labels = ms.decodeSpecialLabels(row.special_abilities, null);
      expect(labels).not.toContain('Immune Ranged Attacks');
      expect(labels).not.toContain('Use Warrior Skills');   // hidden: not a raider action
    }
  });

  it('Lord Yelinak is not a "Quad Attack" mob (7 is Dual Wield), and keeps its real flags', () => {
    const labels = ms.decodeSpecialLabels(YELINAK.special_abilities, null);
    expect(labels).not.toContain('Quad Attack');
    expect(labels).toEqual(expect.arrayContaining(['Summon', 'Enrage', 'Rampage', 'Triple Attack', 'Unslowable', 'Immune Ranged Spells']));
  });

  it('The Itraer Vius keeps Immune Pacify (31); its 42/43 are Proximity Aggro / Call For Help, not chips', () => {
    const labels = ms.decodeSpecialLabels(ITRAER.special_abilities, null);
    expect(labels).toContain('Immune Pacify');
    expect(labels).not.toContain('Counter Avoid Damage');
    expect(labels).not.toContain('Prox Aggro');
  });

  it('No Loitering (46) is no longer shown as "Immune Damage (NPC/Pet)"', () => {
    expect(ms.decodeSpecialLabels('10,1^46,1', null)).toEqual(['Magical']);
  });

  it('Does Not Equip (8) is a Target Info chip (the guild lead, 2026-10-08); Dual Wield (7) still is not', () => {
    expect(ms.decodeSpecialLabels('8,1', null)).toEqual(['Does Not Equip']);
    expect(ms.decodeSpecialLabels('7,1^8,1^10,1', null)).toEqual(['Does Not Equip', 'Magical']);
    expect(ms.decodeSpecialLabels('7,1', null)).toEqual([]);
    expect(ms.decodeSpecialLabels('10,1', null)).not.toContain('Does Not Equip');
  });
});
