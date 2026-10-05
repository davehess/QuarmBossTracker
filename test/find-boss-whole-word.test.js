// test/find-boss-whole-word.test.js — findBossFromName partial matches are WHOLE-WORD.
//
// The bug (the guild lead, 2026-10-05): "A_tortured_soul" / "a tortured banshee"
// became Ture kills — 8 false encounters since Oct 2 — because the partial
// match was a bare substring test and "ture" sits inside "tortured" (and
// "mature", "captured"). The shorter name must now appear in the longer one
// bounded by non-letters/digits. Exact + nickname matching and the Vex Thal
// South-before-North tie-break are unchanged.
//
// Run: npx vitest run test/find-boss-whole-word.test.js

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { findBossFromName } = require('../utils/parseEqLog');
const bosses = require('../data/bosses.json');

const find = (name) => findBossFromName(name, bosses);

describe('the Ture false positive', () => {
  it('"a tortured soul" is not a boss', () => {
    expect(find('a tortured soul')).toBeNull();
    expect(find('A_tortured_soul')).toBeNull();
  });

  it('"A_tortured_banshee" and the other tortured mobs are not Ture', () => {
    expect(find('A_tortured_banshee')).toBeNull();
    expect(find('a_tortured_iksar_miner')).toBeNull();
  });

  it('other names with a boss buried inside a word are not that boss', () => {
    expect(find('a_mature_wurm')).toBeNull();        // "ture"
    expect(find('a_captured_netherbian')).toBeNull();  // "ture"
    expect(find('a_frightfinger')).toBeNull();       // "fright"
  });

  it('Ture himself still resolves, by name and by log form', () => {
    expect(find('Ture')?.id).toBe('ture');
    expect(find('#Ture')?.id).toBe('ture');
  });

  it('a parsed fragment that is not a whole word of any boss name matches nothing', () => {
    expect(find('da')).toBeNull();      // inside "Aerin`Dar", "Dagarn", ... but never a whole word
    expect(find('dar')?.id).toBe('aerin_dar');   // a nickname — the exact path, untouched
  });
});

describe('whole-word partial matches that must keep working', () => {
  it('an unqualified Vex Thal name still lands on the (South) entry', () => {
    expect(find('Kaas Thox Xi Aten Ha Ra')?.name).toBe('Kaas Thox Xi Aten Ha Ra (South)');
    expect(find('Kaas_Thox_Xi_Aten_Ha_Ra')?.name).toBe('Kaas Thox Xi Aten Ha Ra (South)');
    expect(find('Thall_Va_Xakra')?.name).toBe('Thall Va Xakra (South)');
  });

  it('a qualified Vex Thal name still lands on its own entry', () => {
    expect(find('Kaas Thox Xi Aten Ha Ra (North)')?.name).toBe('Kaas Thox Xi Aten Ha Ra (North)');
  });

  it('a longer log name that carries the boss as whole words still matches', () => {
    // The pull is logged "Overlord Banord Paffa"; the board entry is "Banord Paffa".
    expect(find('#Overlord_Banord_Paffa')?.id).toBe('banord_paffa');
  });

  it('a "(South)"-style suffix does not break the boundary', () => {
    expect(find('thall va xakra')?.name).toBe('Thall Va Xakra (South)');
  });

  it('two bosses whose names differ by a numeral never cross-match', () => {
    expect(find('Manaetic_Prototype_X')?.id).toBe('manaetic_prototype_x');
    expect(find('Manaetic_Prototype_XI')?.id).toBe('manaetic_prototype_xi');
    expect(find('Manaetic_Prototype_IX')?.id).toBe('manaetic_prototype_ix');
  });

  // The boss name as whole words inside a LONGER trash name: "a/an …" mobs and "… of <boss>" mobs
  // are the boss's minions, not the boss (found while fixing Ture: ~17 "a chokidai terror" fights).
  it('"a/an …" mobs and "… of <boss>" mobs carrying a boss name are not that boss', () => {
    expect(find('a chokidai terror')).toBeNull();
    expect(find('a_cleric_of_vallon_zek')).toBeNull();
    expect(find('a champion of innoruuk')).toBeNull();
    expect(find('the_herald_of_vulak`aerr')).toBeNull();
    expect(find('Vallon Zek')?.id).toBeTruthy();         // the boss itself still resolves
  });

  it('an empty or "#" name matches nothing (it used to match the first boss)', () => {
    expect(find('')).toBeNull();
    expect(find('#')).toBeNull();
  });
});

describe('the new Planes of Power names resolve as the catalog spells them', () => {
  // Names as eqemu_npc_types stores them (underscores, '#' on event mobs).
  const cases = [
    ['Gaukr_Sandstorm', 'gaukr_sandstorm'],
    ['Hreidar_Lynhillig', 'hreidar_lynhillig'],
    ['Laef_Windfall', 'laef_windfall'],
    ['Oreen_Wavecrasher', 'oreen_wavecrasher'],
    ['Auliffe_Chaoswind', 'auliffe_chaoswind'],
    ['Brynju_Thunderclap', 'brynju_thunderclap'],
    ['Kuanbyr_Hailstorm', 'kuanbyr_hailstorm'],
    ['Eindride_Icestorm', 'eindride_icestorm'],
    ['#_Carprin_Deatharn', 'carprin_deatharn'],
    ['#Carprin_Deatharn', 'carprin_deatharn'],
    ['#Spectre_of_Corruption', 'spectre_of_corruption'],
    ['#Banord_Paffa', 'banord_paffa'],
    ['#Grummus', 'grummus'],
    ['#Rallius_Rattican', 'rallius_rattican'],
    ['#Aramin_the_Spider_Guardian', 'aramin_the_spider_guardian'],
    ['#the_ancient_crawler', 'the_ancient_crawler'],
    ['#The_Sleep_Walker', 'the_sleep_walker'],
    ['Rahlgon', 'rahlgon'],
    ['#Terror_Matriarch', 'terror_matriarch'],
    ['#The_Bullyrag_Bat', 'the_bullyrag_bat'],
    ['Seilaen', 'seilaen'],
    ['Untel`Dak', 'untel_dak'],
    ['Vhaksiz_the_Shade', 'vhaksiz_the_shade'],
  ];
  it.each(cases)('%s -> %s', (catalogName, id) => {
    expect(find(catalogName)?.id).toBe(id);
  });

  it('the Bullyrag Bat placeholder mob is not the named', () => {
    expect(find('#a_bullyrag_bat')).toBeNull();
  });

  it('"Terror Matriarch" is its own entry, not the Luclin boss Terror', () => {
    expect(find('Terror_Matriarch')?.id).toBe('terror_matriarch');
    expect(find('Terror')?.id).toBe('terror');
  });
});
