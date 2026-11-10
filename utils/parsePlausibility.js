// Plausibility ceilings for one uploaded parse row (data-integrity hardening).
//
// merge_encounter_players keeps max(damage) per player across contributors, so one absurd value would win the merge
// forever. A row is implausible when its damage exceeds max(DAMAGE_HP_FACTOR x catalog HP, DAMAGE_FLOOR) or its dps
// exceeds DPS_CEILING. Ceilings come from 90 days of encounter_players (204k rows, fights >= 10 s, 2026-11-10):
//   max damage in one row 1,090,194 | max damage / catalog HP 0.76 for mobs over 200k HP, 5.0 for 50k-200k HP
//   max dps 10,227 (p99.99 5,003).
// DAMAGE_FLOOR 2.5M is ~2.3x the largest damage ever seen; DAMAGE_HP_FACTOR 10 is above every ratio seen on a
// 50k+ HP mob (small-HP trash reaches 30x, and is covered by the floor instead); DPS_CEILING 25,000 is ~2.4x the max.
const DAMAGE_HP_FACTOR = 10;
const DAMAGE_FLOOR = 2500000;
const DPS_CEILING = 25000;

// Splits `players` into { kept, flagged }. Flagged rows are kept out of the merge input, never silently: each carries
// the reason so the caller can store it (raw_parse.flags) and log it once.
function splitImplausible(players, npcHp) {
  const hp = Number(npcHp);
  const damageCeiling = Math.max(DAMAGE_FLOOR, Number.isFinite(hp) && hp > 0 ? hp * DAMAGE_HP_FACTOR : 0);
  const kept = [];
  const flagged = [];
  for (const p of Array.isArray(players) ? players : []) {
    const damage = Number(p && p.damage);
    const dps = Number(p && p.dps);
    let reason = null;
    if (Number.isFinite(damage) && damage > damageCeiling) reason = 'damage_over_ceiling';
    else if (Number.isFinite(dps) && dps > DPS_CEILING) reason = 'dps_over_ceiling';
    if (reason) flagged.push({ name: p.name, reason, damage: p.damage, dps: p.dps, ceiling: reason === 'dps_over_ceiling' ? DPS_CEILING : damageCeiling });
    else kept.push(p);
  }
  return { kept, flagged };
}

module.exports = { splitImplausible, DAMAGE_HP_FACTOR, DAMAGE_FLOOR, DPS_CEILING };
