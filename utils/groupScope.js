// utils/groupScope.js — whose callouts and targets are mine: my raid while I am in one, my group when I
// am not. One rule for the trigger relay and Extended Target, decided from data, never from the clock.
//
// The guild lead, 2026-10-07, after a raid broke into groups: "We need to do a better job of not leaking
// other group's mobs or callouts when we're not in a raid mode." Extended Target showed five mobs
// targeted by other groups in the same zone, and the relay kept every guild callout guild-wide for the
// whole Sun/Wed/Thu evening window, raid or not.
//
// Three contexts, in order:
//   raid   — the listener is in a raid some Mimic reports (utils/raidGroups.js `groupRaids`: an
//            uploader's latest raid_roster inside RAID_LIVE_MS names it). Today's behaviour; with two
//            raids at once a sender known to be in the OTHER raid is dropped (DESIGN-multi-raid.md §3,
//            one raid changes nothing).
//   group  — no raid, but the listener's Mimic told the bot its group (the reporter heartbeat's
//            `group_names`, from Zeal's group window). Only the listener's own group is kept.
//   zone   — no raid and no group known (an agent that does not send one, no Zeal): the existing
//            same-zone rule, and nothing else. The raid-window blanket is gone.
// 'legacy' is the kill switch (tuning flag_disable_groupscope=1), a failed roster read, or no data
// source: every caller keeps its old code path.
//
// Pure — no I/O. The bot (index.js) feeds it the roster split and registry entry it already holds.

// A group changes rarely, but a stale one would hide a callout from someone who just joined: the
// heartbeat is ~20 s, so three missed beats and the group counts as unknown.
const GROUP_FRESH_MS = 60 * 1000;
const NAME_RE = /^[A-Za-z]{2,30}$/;
const GROUP_CAP = 12;   // a group is six; a raid-sized list is not a group

// Heartbeat input → lowercased, de-duplicated EQ names.
function cleanNames(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const n of list) {
    const s = typeof n === 'string' ? n.trim() : '';
    if (!NAME_RE.test(s)) continue;
    const l = s.toLowerCase();
    if (!out.includes(l)) out.push(l);
    if (out.length >= GROUP_CAP) break;
  }
  return out;
}

// A reporter-registry entry → the names standing together with the character being played (itself
// included), or null when the group is unknown: no `group_names` ever sent, a stale heartbeat, or the
// heartbeat describes a different character than `character`. An EMPTY list from a fresh heartbeat is
// a real answer — solo, a group of one.
function groupOf(entry, now, character) {
  if (!entry || !Array.isArray(entry.group_names)) return null;
  if (!(now - (entry.last_seen || 0) <= GROUP_FRESH_MS)) return null;
  const live = entry.live_character ? String(entry.live_character).toLowerCase() : null;
  const want = character ? String(character).toLowerCase() : null;
  if (live && want && live !== want) return null;
  const self = want || live;
  if (!self) return null;
  const out = new Set(entry.group_names);
  out.add(self);
  return [...out];
}

// Where does this listener stand? split = groupRaids() output (`failed` set when the roster read
// failed); characters = the lowercased names this account is playing; group = groupOf() or null.
function scopeFor({ split, discordId, characters, group, disabled }) {
  if (disabled || !split || split.failed) return { mode: 'legacy' };
  let raid = discordId != null ? split.raidForUploader(discordId) : null;
  for (const c of characters || []) { if (raid) break; raid = split.raidForName(c); }
  if (raid) return { mode: 'raid', raidKey: raid.key, multi: !!split.multi };
  if (Array.isArray(group) && group.length) return { mode: 'group', names: new Set(group) };
  return { mode: 'zone' };
}

// What the relay stamps on a fire at POST time: the sender's raid key and group, as of the moment it
// fired. Either is null when unknown, and null never drops a fire.
function stampSender({ split, discordId, characters, group }) {
  const s = scopeFor({ split, discordId, characters, group, disabled: false });
  return {
    origin_raid: s.mode === 'raid' ? s.raidKey : null,
    origin_group: Array.isArray(group) && group.length ? group : null,
  };
}

// One relay fire against one listener's scope: true = keep, false = drop, null = no opinion (the caller
// applies the zone rule). scope is scopeFor()'s result, or anything without a mode (legacy).
function relayVerdict(scope, fire) {
  if (!scope || !fire) return null;
  if (scope.mode === 'raid') {
    // Only a sender KNOWN to be in another raid is dropped, and only while two raids run: one raid
    // keeps every fire, exactly as today.
    return scope.multi && fire.origin_raid && fire.origin_raid !== scope.raidKey ? false : true;
  }
  if (scope.mode === 'group') {
    const theirs = Array.isArray(fire.origin_group) ? fire.origin_group : null;
    if (theirs && theirs.some(n => scope.names.has(n))) return true;   // a groupmate, whatever the roster says
    if (fire.origin_raid) return false;                                // in a raid while we are not: not our group
    if (theirs && theirs.length) return false;                         // a different group
    return null;                                                       // sender's group unknown → zone rule
  }
  return null;
}

module.exports = { GROUP_FRESH_MS, cleanNames, groupOf, scopeFor, stampSender, relayVerdict };
