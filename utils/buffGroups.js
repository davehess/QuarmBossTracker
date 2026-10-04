// utils/buffGroups.js — the `groups` field of GET /api/agent/raid-buff-queue.
//
// The guild lead, 2026-10-04: "we should be grouping people for buffs on
// https://wolfpack.quest/buffs — treat that like the buff queue as well."
//
// Pure — no I/O. index.js (_handleAgentRaidBuffQueue) computes each scoped raider's
// gaps with raidBuffs.missingLines() and hands the rows here; the web page and the
// Mimic buff-queue overlay read the result.
//
// Why by GROUP and not by raid: in this era (Classic → PoP, no Target Group Buff) a
// group buff lands on the CASTER'S OWN group. So the useful call-out is "4 of 6 in G3
// miss Haste — the enchanter in G3 can group-cast it"; with no capable caster in the
// group it is single-target, or someone moves. A caster in ANOTHER group never covers
// it, so `casters` only ever lists members of the same group. Two raids at once both
// have a "group 1": the caller passes only the requester's raid (the handler's
// rosterByName is already raid-scoped), so they cannot merge here.

const rb = require('./raidBuffs');

// Zeal's "ungrouped" value is unverified (raid_roster is empty off-raid), so
// anything that is not a whole number in 1..12 reads as ungrouped.
const DEFAULT_MAX_GROUP = 12;

// raid_roster classes arrive as full names ("Shadow Knight"); the abbreviations are
// the other spellings raidBuffs.CLASS_ROLE already accepts.
const CLASS_ALIAS = {
  clr: 'cleric', dru: 'druid', shm: 'shaman', enc: 'enchanter', mag: 'magician', mage: 'magician',
  pal: 'paladin', rng: 'ranger', bst: 'beastlord',
};
function canonClass(c) {
  const k = String(c || '').toLowerCase().trim();
  return CLASS_ALIAS[k] || k;
}

function normGroup(g, maxGroup) {
  if (g == null || g === '') return null;
  const n = Number(g);
  return Number.isInteger(n) && n >= 1 && n <= maxGroup ? n : null;
}

// The best group spell this member can cast for a line, or null. The level gate
// applies only when BOTH the member's level and the spell's are known: an enchanter
// at 60 is named for Speed of the Brood, not the level-65 Vallon's Quickening.
function casterSpell(member, key) {
  const cls = canonClass(member.class);
  const lvl = member.level == null || member.level === '' ? NaN : Number(member.level);
  const hit = (rb.GROUP_SPELLS[key] || []).find(e =>
    e.cls === cls && (!Number.isFinite(lvl) || e.lvl == null || lvl >= e.lvl));
  return hit ? hit.spell : null;
}

// The lowercase classes that can group-cast a line, in GROUP_SPELLS order ("no enchanter in
// G3" without the overlay keeping its own class map — the overlay agent, 2026-10-04).
function classesFor(key) {
  return [...new Set((rb.GROUP_SPELLS[key] || []).map(e => e.cls))];
}

// The group number a named raider is in (null when ungrouped or not listed) — the
// requester's own group, so the overlay can put it first. Reads the built `groups`
// so it can never disagree with how members were bucketed.
function groupOf(groups, name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  for (const g of groups || []) {
    if (g.members.some(m => String(m.name).toLowerCase() === n)) return g.group;
  }
  return null;
}

// members: [{ name, class, level, group, missing: [GROUP_SPELLS keys], inferred, noSignal }]
//   noSignal = nothing is known about the raider's buffs (no Mimic, no observed landing).
//   Their gaps are unknown, not zero, so they list in `members` flagged `no_signal: true`
//   and count toward no line — but they can still be casters.
// Returns the spec's array, sorted by group number with the ungrouped bucket last:
//   [{ group: 3 | null,
//      members: [{ name, class, missing: ['Haste', 'HP B'], inferred }],
//      lines:   [{ key, label, missing: [names], casters: [{ name, class, spell }],
//                  classes: ['enchanter'] }] }]   // classes = who CAN group-cast it, caster or not
// `missing` labels are the SAME strings the queue's buff_queue rows use. `lines` lists
// only gaps with at least one member, most-missing first (ties keep GROUP_SPELLS order).
// The ungrouped bucket never has casters: a group buff cast by someone with no group
// lands on nobody else.
function buildBuffGroups(members, opts) {
  const maxGroup = (opts && opts.maxGroup) || DEFAULT_MAX_GROUP;
  const buckets = new Map();
  for (const m of members || []) {
    if (!m || !m.name) continue;
    const g = normGroup(m.group, maxGroup);
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g).push(m);
  }
  const order = [...buckets.keys()].sort((a, b) => Number(a === null) - Number(b === null) || a - b);
  return order.map(g => {
    const mem = buckets.get(g).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const gaps = (m) => (m.noSignal ? [] : (m.missing || []));
    const lines = [];
    for (const key of rb.GROUP_LINE_KEYS) {
      const missing = mem.filter(m => gaps(m).includes(key)).map(m => m.name);
      if (missing.length === 0) continue;
      const casters = g === null ? [] : mem
        .map(m => ({ name: m.name, class: m.class || null, spell: casterSpell(m, key) }))
        .filter(c => c.spell);
      lines.push({ key, label: rb.lineLabel(key), missing, casters, classes: classesFor(key) });
    }
    lines.sort((a, b) => b.missing.length - a.missing.length);
    return {
      group: g,
      members: mem.map(m => {
        const out = {
          name: m.name,
          class: m.class || null,
          missing: rb.GROUP_LINE_KEYS.filter(k => gaps(m).includes(k)).map(rb.lineLabel),
          inferred: !!m.inferred,
        };
        if (m.noSignal) out.no_signal = true;
        return out;
      }),
      lines,
    };
  });
}

module.exports = { buildBuffGroups, casterSpell, canonClass, normGroup, classesFor, groupOf };
