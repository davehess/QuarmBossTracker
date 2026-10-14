'use strict';
// How a faction cons to a player BEFORE anything they have done: base + race mod + class mod + deity mod, the way
// EQEmu's CalculateFaction reads eqemu_faction_list_full + eqemu_faction_list_mod (mod_name r<id> / c<id> / d<id>).
// The guild lead, 2026-10-13: "The factions that are never KOS by default should always be green, the ones that can be
// KOS by default could be orange, the ones that are always KOS should be red", and on the Map "if someone has a
// non-player illusion on it should switch them to red immediately".
//
// ⚠ Three copies of this maths, kept in step by tests on the same fixtures: this file (bot: zone-spawns), the website's
// web/lib/factionCon.ts (the site imports nothing outside web/), and the Map's own (apps/mimic/map.html, beta).

// Con tiers by value (EQEmu CalculateFaction): rank 0 scowls … 8 ally, the agent's CON_STANDINGS ranks.
const CON_TIERS = [[1100, 8], [750, 7], [500, 6], [100, 5], [0, 4], [-100, 3], [-700, 2], [-999, 1]];
function conRank(v) { for (const [min, r] of CON_TIERS) if (v >= min) return r; return 0; }
// KOS: threatening (attacks on a roll) or scowls (attacks on sight), i.e. below -700.
function isKos(v) { return v < -700; }

const PLAYER_RACES = { 1: 'Human', 2: 'Barbarian', 3: 'Erudite', 4: 'Wood Elf', 5: 'High Elf', 6: 'Dark Elf', 7: 'Half Elf',
  8: 'Dwarf', 9: 'Troll', 10: 'Ogre', 11: 'Halfling', 12: 'Gnome', 128: 'Iksar', 130: 'Vah Shir' };
// Races an illusion can put you in that are not player races (the ones PQDI lists on a faction).
const ILLUSION_RACES = { 14: 'Werewolf', 26: 'Froglok', 42: 'Wolf', 43: 'Bear', 46: 'Imp', 60: 'Skeleton', 75: 'Elemental',
  82: 'Scarecrow', 85: 'Spectre', 108: 'Eye Of Zomm', 120: 'Wolf Elemental', 161: 'Iksar Skeleton' };
const CLASSES = { 1: 'Warrior', 2: 'Cleric', 3: 'Paladin', 4: 'Ranger', 5: 'Shadow Knight', 6: 'Druid', 7: 'Monk', 8: 'Bard',
  9: 'Rogue', 10: 'Shaman', 11: 'Necromancer', 12: 'Wizard', 13: 'Magician', 14: 'Enchanter', 15: 'Beastlord' };
const DEITIES = { 201: 'Bertoxxulous', 202: 'Brell Serilis', 203: 'Cazic Thule', 204: 'Erollisi Marr', 205: 'Bristlebane',
  206: 'Innoruuk', 207: 'Karana', 208: 'Mithaniel Marr', 209: 'Prexus', 210: 'Quellious', 211: 'Rallos Zek', 212: 'Rodcet Nife',
  213: 'Solusek Ro', 214: 'The Tribunal', 215: 'Tunare', 216: 'Veeshan', 396: 'Agnostic' };

// f = { base, min_cap, max_cap, mods: { r1: 1000, c3: -50, d215: 100, ... } }. A cap pair of 0/0 means no cap.
function clampCap(f, v) {
  const lo = Number(f.min_cap) || 0, hi = Number(f.max_cap) || 0;
  return (lo || hi) ? Math.max(lo, Math.min(hi, v)) : v;
}
function modOf(f, code) { const m = f && f.mods ? Number(f.mods[code]) : 0; return Number.isFinite(m) ? m : 0; }
// The lowest and highest a mod can add across a set of ids (0 for any id without a row).
function spread(f, prefix, ids) {
  let lo = Infinity, hi = -Infinity;
  for (const id of ids) { const m = modOf(f, prefix + id); if (m < lo) lo = m; if (m > hi) hi = m; }
  return [lo, hi];
}
const RACE_IDS = Object.keys(PLAYER_RACES).map(Number);
const CLASS_IDS = Object.keys(CLASSES).map(Number);
const DEITY_IDS = Object.keys(DEITIES).map(Number);
// The value range for a player: who = { race, cls, deity } (ids; null = unknown, so every player option counts).
function valueRange(f, who) {
  const w = who || {}, base = Number(f && f.base) || 0;
  const parts = [['r', w.race, RACE_IDS], ['c', w.cls, CLASS_IDS], ['d', w.deity, DEITY_IDS]];
  let lo = base, hi = base;
  for (const [p, id, all] of parts) {
    const [a, b] = id != null ? [modOf(f, p + id), modOf(f, p + id)] : spread(f, p, all);
    lo += a; hi += b;
  }
  return [clampCap(f, lo), clampCap(f, hi)];
}
// 'never' | 'some' | 'always': is this faction KOS to a player by default, over every race, class and deity.
function kosClass(f) {
  const [lo, hi] = valueRange(f, null);
  return isKos(hi) ? 'always' : isKos(lo) ? 'some' : 'never';
}

module.exports = { CON_TIERS, conRank, isKos, PLAYER_RACES, ILLUSION_RACES, CLASSES, DEITIES, valueRange, kosClass };
