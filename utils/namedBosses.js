// utils/namedBosses.js — the curated list of Planes of Power named bosses (data/named-bosses.json) that the
// catalog does not flag.
//
// The guild lead, 2026-10-18 (raid night): "The named bosses in Halls of Honor can be listed, same with the other
// major named bosses in the zones". The agent asks one question, "is this mob a raid boss?", and the bot answers it
// from eqemu_npc_types.raid_target. That column is false for nearly all of PoP (Advocent Joran, Freegan Haun,
// Halgoz Rellinic, even Lord Mithaniel Marr), and the weekly sync-quarm.yml mirror sync overwrites the table, so the
// fix cannot be written there. It is a committed file, and every place the bot serves raid_target goes through
// raidTarget() below, so every agent version picks it up with no agent change.
//
// A row matches by npc id, or by its name inside the zone its id sits in (id = zoneid * 1000 + n), which also
// catches the event and phase bodies a boss shares its name with (the second Tallon Zek, the dragon Rizlona).
'use strict';

const data = require('../data/named-bosses.json');

// "#Aerin`Dar" / "Terris_Thule" / "Terris Thule" are one name.
function normName(n) {
  return String(n || '').replace(/^#+_?/, '').replace(/_/g, ' ').replace(/'/g, '`').replace(/\s+/g, ' ').trim().toLowerCase();
}

const _ids = new Set();
const _zoneNames = new Set();
for (const z of Object.values(data.zones || {})) {
  for (const b of z.bosses || []) {
    _ids.add(Number(b.id));
    _zoneNames.add(z.zoneId + '|' + normName(b.name));
  }
}

// `row` is an eqemu_npc_types row (needs id and name).
function isNamedBoss(row) {
  if (!row) return false;
  const id = Number(row.id);
  if (!Number.isFinite(id)) return false;
  return _ids.has(id) || _zoneNames.has(Math.floor(id / 1000) + '|' + normName(row.name));
}

// What the bot serves as raid_target: the catalog's flag, or the curated list.
function raidTarget(row) {
  return !!(row && row.raid_target) || isNamedBoss(row);
}

module.exports = { isNamedBoss, raidTarget, normName, data };
