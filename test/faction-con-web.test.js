// test/faction-con-web.test.js — the website's copy of the faction-con maths (web/lib/factionCon.ts) and the ?v=b variant.
//
// The guild lead, 2026-10-13: "The factions that are never KOS by default should always be green, the ones that can be KOS
// by default could be orange, the ones that are always KOS should be red." Three copies of this maths exist (the bot's
// utils, this one, the Map's), kept in step by tests on the SAME fixtures: change a fixture here, change it there.
//
// Run: npx vitest run test/faction-con-web.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';
import {
  CON_TIERS, CON_WORDS, conRank, isKos, PLAYER_RACES, ILLUSION_RACES, CLASSES, DEITIES, valueRange, kosClass,
  raceIdFromName, classIdFromName,
} from '../web/lib/factionCon.ts';

const allPlayerRaces = (mod) => Object.fromEntries(Object.keys(PLAYER_RACES).map(id => [`r${id}`, mod]));

// Inhabitants of Tranquility: nobody starts anywhere but 0.
const TRANQUILITY = { base: 0, min_cap: 0, max_cap: 0, mods: {} };
// Inhabitants of Valor: -1000 for everything that is not a player, +1000 to every player race.
const VALOR = { base: -1000, min_cap: -2000, max_cap: 2000, mods: allPlayerRaces(1000) };
// A KOS-to-everyone faction with no mods.
const KOS_ALL = { base: -1500, min_cap: 0, max_cap: 0, mods: {} };
// Neutral, but Dark Elves start at -1000.
const DARK_ELF_HATED = { base: 0, min_cap: 0, max_cap: 0, mods: { r6: -1000 } };

describe('conRank boundaries', () => {
  it.each([
    [1100, 8], [1099, 7], [750, 7], [749, 6], [500, 6], [499, 5], [100, 5], [99, 4],
    [0, 4], [-1, 3], [-100, 3], [-101, 2], [-700, 2], [-701, 1], [-999, 1], [-1000, 0], [-2000, 0],
  ])('%i -> rank %i', (v, rank) => {
    expect(conRank(v)).toBe(rank);
  });

  it('has a word for every rank the tiers can return', () => {
    expect(CON_WORDS).toHaveLength(9);
    expect(CON_WORDS[0]).toBe('scowls');
    expect(CON_WORDS[4]).toBe('indifferently');
    expect(CON_WORDS[8]).toBe('ally');
    for (const [, rank] of CON_TIERS) expect(CON_WORDS[rank]).toBeTruthy();
  });

  it('isKos is below -700 only', () => {
    expect(isKos(-700)).toBe(false);
    expect(isKos(-701)).toBe(true);
    expect(isKos(0)).toBe(false);
  });
});

describe('kosClass / valueRange on the fixtures', () => {
  it('Inhabitants of Tranquility: never KOS, range [0, 0]', () => {
    expect(kosClass(TRANQUILITY)).toBe('never');
    expect(valueRange(TRANQUILITY, null)).toEqual([0, 0]);
  });

  it('Inhabitants of Valor: never KOS to a player, but a Skeleton illusion (race 60) sits at -1000', () => {
    expect(kosClass(VALOR)).toBe('never');
    expect(valueRange(VALOR, null)).toEqual([0, 0]);
    expect(valueRange(VALOR, { race: 1 })).toEqual([0, 0]);
    expect(60 in PLAYER_RACES).toBe(false);
    const [skeleton] = valueRange(VALOR, { race: 60 });
    expect(skeleton).toBe(-1000);
    expect(isKos(skeleton)).toBe(true);
    expect(conRank(skeleton)).toBe(0);
  });

  it('a -1500 faction with no mods is KOS to everyone', () => {
    expect(kosClass(KOS_ALL)).toBe('always');
    expect(valueRange(KOS_ALL, null)).toEqual([-1500, -1500]);
  });

  it('a Dark Elf mod of -1000 makes it KOS for some only', () => {
    expect(kosClass(DARK_ELF_HATED)).toBe('some');
    expect(valueRange(DARK_ELF_HATED, { race: 6, cls: 1, deity: 206 })).toEqual([-1000, -1000]);
    expect(isKos(valueRange(DARK_ELF_HATED, { race: 6, cls: 1, deity: 206 })[0])).toBe(true);
    expect(valueRange(DARK_ELF_HATED, { race: 1, cls: 1, deity: 206 })).toEqual([0, 0]);
  });

  it('an unknown race, class or deity gives the range across the options; caps hold both ends', () => {
    expect(valueRange(DARK_ELF_HATED, { race: null, cls: 1, deity: 206 })).toEqual([-1000, 0]);
    expect(valueRange({ base: 0, min_cap: -500, max_cap: 500, mods: { r1: 9000 } }, { race: 1, cls: 1, deity: 206 })).toEqual([500, 500]);
    expect(valueRange({ base: 0, min_cap: -500, max_cap: 500, mods: { r1: -9000 } }, { race: 1, cls: 1, deity: 206 })).toEqual([-500, -500]);
  });

  it('a cap pair of 0/0 means uncapped', () => {
    expect(valueRange({ base: 5000, min_cap: 0, max_cap: 0, mods: {} }, null)).toEqual([5000, 5000]);
  });
});

describe('names to ids', () => {
  it('knows every player race and class by its own name', () => {
    for (const [id, name] of Object.entries(PLAYER_RACES)) expect(raceIdFromName(name)).toBe(Number(id));
    for (const [id, name] of Object.entries(CLASSES)) expect(classIdFromName(name)).toBe(Number(id));
  });

  it('is case-insensitive and tolerant of hyphen, space and no space', () => {
    expect(raceIdFromName('half-elf')).toBe(7);
    expect(raceIdFromName('Half Elf')).toBe(7);
    expect(raceIdFromName('HALFELF')).toBe(7);
    expect(raceIdFromName('Vah Shir')).toBe(130);
    expect(raceIdFromName('VahShir')).toBe(130);
    expect(raceIdFromName('dark elf')).toBe(6);
  });

  it('SK and Shadowknight are Shadow Knight', () => {
    expect(classIdFromName('SK')).toBe(5);
    expect(classIdFromName('Shadowknight')).toBe(5);
    expect(classIdFromName('Shadow Knight')).toBe(5);
  });

  it('gives null for anything it does not know, never a guess', () => {
    expect(raceIdFromName('Skeleton')).toBeNull();
    expect(raceIdFromName(null)).toBeNull();
    expect(raceIdFromName('')).toBeNull();
    expect(classIdFromName(undefined)).toBeNull();
    expect(classIdFromName('Jedi')).toBeNull();
  });

  it('the id tables carry the entries the page lists', () => {
    expect(Object.keys(PLAYER_RACES)).toHaveLength(14);
    expect(Object.keys(CLASSES)).toHaveLength(15);
    expect(DEITIES[396]).toBe('Agnostic');
    expect(ILLUSION_RACES[60]).toBe('Skeleton');
  });
});

describe('the ?v=b variant (source text, comments stripped)', () => {
  const read = (rel) => stripJs(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const page = read('web/app/db/faction/[id]/page.tsx');
  const variant = read('web/app/db/faction/[id]/FactionB.tsx');

  it('page.tsx hands ?v=b to the variant after its sign-in check, and nothing else changes', () => {
    expect(page).toMatch(/v === 'b'\) return <FactionB /);
    expect(page.indexOf('redirect(`/auth/signin')).toBeLessThan(page.indexOf("v === 'b'"));
  });

  it('colours the title by class and labels all three', () => {
    expect(variant).toContain('Never KOS by default');
    expect(variant).toContain('KOS for some races, classes or deities');
    expect(variant).toContain('KOS to everyone by default');
    expect(variant).toMatch(/never:\s*\{ title: 'text-green'/);
    expect(variant).toMatch(/some:\s*\{ title: 'text-orange'/);
    expect(variant).toMatch(/always:\s*\{ title: 'text-red'/);
  });

  it('says what an illusion does to the faction', () => {
    expect(variant).toContain('Sees through illusions');
    expect(variant).toContain('Illusions fool it: a non-player illusion counts as that race (no race modifier)');
  });

  it('has the three modifier groups, the illusion group, and both source lists', () => {
    for (const t of ['title="Races"', 'title="Classes"', 'title="Deities"', 'title="Illusion races"', 'title="Raise faction"', 'title="Lower faction"']) {
      expect(variant).toContain(t);
    }
    expect(variant).toContain('Your characters');
  });

  it('pages every table read through selectAll', () => {
    for (const t of ['eqemu_faction_list_mod', 'eqemu_npc_faction', 'eqemu_npc_faction_entries', 'eqemu_npc_types', 'faction_cons']) {
      expect(variant, t).toMatch(new RegExp(`selectAll<[A-Za-z]+>\\(\\(from, to\\) => sb\\.from\\('${t}'\\)[\\s\\S]*?\\.range\\(from, to\\)`));
    }
  });
});
