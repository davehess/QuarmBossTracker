// utils/raidTick.js — staged raid-attendance ticks (capture only, never submit).
//
// Hitya 2026-08-06: "can we put in the automatic raid tick capture (without
// submission) at 830/930/1030/1130", following "sometimes we will take the
// 'last tick' before the end of the raid, though, so we're not missing people."
//
// WHY IT MUST BE CAPTURED, NOT QUERIED LATER: raid_roster is a live view keyed
// (guild_id, uploaded_by_discord_id, name) — every agent overwrites its own rows
// every few seconds — and the midnight chain prunes it to
// RAID_ROSTER_RETENTION_HOURS (default ONE hour). Who was in the raid at 8:30
// cannot be recovered at 9:30. Write it down or lose it.
//
// NOTHING HERE SUBMITS. utils/dkpTick.js submitRaidTick() is a working path to
// OpenDKP and this deliberately does not call it. Capture is a record; filing it
// stays a deliberate officer action.
//
// The I/O lives in index.js; everything decidable without a network call is here
// so it can be tested.

// The four slots, named to match the ticks OpenDKP already carries
// ("Tick 1 (Raid Start)" … "Tick 4 (Raid End)"), so a captured row lines up with
// the tick an officer eventually files instead of inventing a parallel scheme.
// Times are the raid window's own boundaries — utils/timezone.js isInRaidWindow
// is 20:30–23:30 ET, i.e. slot 1 opens it and slot 4 closes it.
const TICK_SLOTS = [
  { slot: 1, hour: 20, minute: 30, description: 'Tick 1 (Raid Start)' },
  { slot: 2, hour: 21, minute: 30, description: 'Tick 2 (1 Hour)' },
  { slot: 3, hour: 22, minute: 30, description: 'Tick 3 (2 Hour)' },
  { slot: 4, hour: 23, minute: 30, description: 'Tick 4 (Raid End)' },
];

const RAID_DAYS = new Set(['sunday', 'wednesday', 'thursday']);

// How long after the target minute a capture may still fire. The checker runs on
// a 60s interval, so a window is needed at all; 5 minutes means a bot restarting
// across the top of the hour still records the tick.
//
// It is deliberately NOT generous. A tick is a claim about who was present at a
// moment, and capturing 8:30's attendance at 8:50 attributes the wrong people —
// worse than having no row, because a missing row is visibly missing while a
// late one looks authoritative. Past the window we log and skip.
const FIRE_WINDOW_MIN = Math.max(1, Math.min(15,
  Number(process.env.RAID_TICK_FIRE_WINDOW_MIN) || 5));

// Below this many raiders, treat it as "the raid already ended" rather than a
// tick worth recording. This is what makes Hitya's "(if we don't end early)"
// work, and it mostly takes care of itself: when a raid disbands there is no
// Zeal type-5 raid event, so agents stop reporting and the rows age out of the
// freshness window within minutes. The floor only catches the tail case of a
// few people still sitting in a raid window after everyone else logged.
const MIN_NAMES = Math.max(1, Number(process.env.RAID_TICK_MIN_NAMES) || 5);

/**
 * Which tick, if any, is due right now.
 *
 * @param parts from utils/timezone.js nowPartsInTz('America/New_York') —
 *   { hour, minute, dayOfWeek, ... }. Taking parts rather than a timestamp keeps
 *   this pure and DST-correct: the caller already resolved the zone.
 * @returns the slot object, or null.
 */
function dueSlotAt(parts) {
  if (!parts || !RAID_DAYS.has(String(parts.dayOfWeek || '').toLowerCase())) return null;
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return TICK_SLOTS.find(s =>
    s.hour === hour && minute >= s.minute && minute < s.minute + FIRE_WINDOW_MIN) || null;
}

/**
 * The raid, as of now, from raid_roster rows the caller already filtered for
 * freshness.
 *
 * Union across every reporting agent rather than any single agent's view: Zeal's
 * type-5 event shows the whole raid to everyone in it, so any one client should
 * see all of it — but a client that just zoned, or whose pipe hiccuped, reports a
 * partial roster. Taking the union means one bad view cannot drop a raider, which
 * is the failure this feature exists to prevent ("so we're not missing people").
 *
 * The cost is that a concurrent splinter raid merges in. Accepted: nothing is
 * submitted from these rows, so an officer reads the list first, and `uploaders`
 * is recorded so a suspiciously wide union is visible.
 */
function rosterUnion(rows) {
  const names = new Map();          // lower → display form (first seen wins)
  const uploaders = new Set();
  for (const r of (Array.isArray(rows) ? rows : [])) {
    if (!r) continue;
    if (r.uploaded_by_discord_id) uploaders.add(String(r.uploaded_by_discord_id));
    const raw = String(r.name || '').trim();
    // EQ character names are letters only. This drops nothing real and keeps a
    // malformed row from becoming a person on an attendance record.
    if (!/^[A-Za-z]{2,20}$/.test(raw)) continue;
    const k = raw.toLowerCase();
    if (!names.has(k)) names.set(k, raw);
  }
  return { names: [...names.values()].sort((a, b) => a.localeCompare(b)),
           uploaders: uploaders.size };
}

/** Is this roster worth recording as a tick, or has the raid ended? */
function worthRecording(nameCount) { return Number(nameCount) >= MIN_NAMES; }

module.exports = {
  TICK_SLOTS, RAID_DAYS, FIRE_WINDOW_MIN, MIN_NAMES,
  dueSlotAt, rosterUnion, worthRecording,
};
