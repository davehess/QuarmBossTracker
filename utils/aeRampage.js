// utils/aeRampage.js — how wide is a mob's Area Rampage, and how often does it fire.
//
// WHY THIS FILE EXISTS (the guild lead, 2026-10-15: "how wide is area rampage for this mob?
// ... can we mark that area rampage on the map"). The catalog only says THAT a mob has Area
// Rampage (special ability 4); the reach is not stored anywhere, it falls out of the server's
// rules. Project Quarm runs EQMacEmu, so this re-implements, in our own words, the four rules
// that decide it:
//
//   1. Who is hit. When the mob rampages it walks its hate list and hits every member that is
//      inside its combat range — except the mob's current target, unless that target is the only
//      one on the list (so the tank is spared, a lone tank is not). Feigned players are skipped.
//      The distance is measured from the MOB, centre to centre, and half a unit is added to it
//      before the test.
//   2. What "combat range" is. 0.75 × (the mob's bounding radius + the victim's bounding radius),
//      never under 14, plus 2 when the mob is standing still, plus the height difference between
//      the two, never over 75 (60 for a mob that cannot move at all). Inside when the squared
//      distance is within the squared range. This file leaves the height term out: the map is
//      flat, so the ring it gives is the range for two things at the same height.
//   3. Bounding radius. A base figure by race (6.0 unless the race table below says otherwise),
//      then scaled by size / 5. The twelve classic playable races, Iksar and Vah Shir are fixed
//      at radius 5 and size 5 whatever the catalog says; a bat, a lava dragon and a wurm have
//      their size replaced; a few dragon bodies carry a larger base radius.
//   4. How often. Ability 4's first parameter is the chance per attack round in percent (blank
//      or 0 means 20), the second the most people it hits (blank or 0 means everyone in range),
//      the third the damage as a percent of a normal round (blank or 0 means 100).
//
// Worked example: A_Recuso_Degenerate (race 237, size 12, ability `4,1,5`): radius 6 × 12 / 5 =
// 14.4, so the range is 0.75 × (14.4 + 5) = 14.55 while it walks and 16.55 standing, at 5%.
//
// Pure — no I/O — so the bot's mob-info endpoint and the tests share it.

const { parseSpecials } = require('./mobSpecials');

const AREA_RAMPAGE_CODE = 4;
const PLAYER_RADIUS = 5;          // a player is always radius 5 (a playable race, size 5)

const DEFAULT_RADIUS = 6.0;
const DEFAULT_CHANCE = 20;
const DEFAULT_DAMAGE_PCT = 100;

// Races whose radius AND size are fixed: the playable ones (human .. gnome, Iksar, Vah Shir).
const FIXED_PLAYABLE_RACES = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 128, 130]);
// Races whose catalog size is ignored in favour of one figure.
const SIZE_OVERRIDE = { 34: 5.0, 49: 32.5, 158: 16.0 };
// Races whose base radius is not the default 6.0.
const BASE_RADIUS = { 19: 10.48, 184: 9.48, 192: 10.48, 195: 9.48, 196: 9.48, 198: 9.48 };

// The mob's bounding radius, or null when the size is unknown (we do not guess a size).
function boundingRadius(race, size) {
  const r = Number(race);
  if (FIXED_PLAYABLE_RACES.has(r)) return PLAYER_RADIUS;
  const s = SIZE_OVERRIDE[r] != null ? SIZE_OVERRIDE[r] : (size == null ? NaN : Number(size));
  if (!Number.isFinite(s) || s <= 0) return null;
  const base = BASE_RADIUS[r] != null ? BASE_RADIUS[r] : DEFAULT_RADIUS;
  return base * s / 5;
}

// How far from the mob a player can stand and still be hit, in map units (no height term).
// opts.moving: true while the mob is walking (no +2); opts.rooted: the mob can never move (cap 60).
// Null when the mob's size is unknown.
function aeRampageRadius(race, size, opts) {
  const o = opts || {};
  const mob = boundingRadius(race, size);
  if (mob == null) return null;
  let range = 0.75 * (mob + PLAYER_RADIUS);
  if (range < 14) range = 14;
  if (!o.moving) range += 2;
  const cap = o.rooted ? 60 : 75;
  if (range > cap) range = cap;
  return range;
}

// Ability 4's parameters from an `eqemu_npc_types.special_abilities` string, or null when the mob
// has no Area Rampage. targets is null for "everyone in range".
function aeRampageParams(specialAbilities) {
  const ab = parseSpecials(specialAbilities).get(AREA_RAMPAGE_CODE);
  if (!ab) return null;
  const n = (i) => { const v = parseInt(ab.params[i], 10); return Number.isFinite(v) && v > 0 ? v : null; };
  return {
    chance: n(0) != null ? n(0) : DEFAULT_CHANCE,
    targets: n(1),
    damagePct: n(2) != null ? n(2) : DEFAULT_DAMAGE_PCT,
  };
}

// The mob-info field: { radius_still, radius_moving, chance, targets, damage_pct }, or null when
// the row has no Area Rampage or no usable size. Radii are rounded to 2 places.
function aeRampageInfo(row) {
  const p = aeRampageParams(row && row.special_abilities);
  if (!p) return null;
  const rooted = row.runspeed != null && Number(row.runspeed) === 0;
  const still = aeRampageRadius(row.race, row.size, { moving: false, rooted });
  const moving = aeRampageRadius(row.race, row.size, { moving: true, rooted });
  if (still == null || moving == null) return null;
  const r2 = (x) => Math.round(x * 100) / 100;
  return { radius_still: r2(still), radius_moving: r2(moving), chance: p.chance, targets: p.targets, damage_pct: p.damagePct };
}

module.exports = { boundingRadius, aeRampageRadius, aeRampageParams, aeRampageInfo, PLAYER_RADIUS };
