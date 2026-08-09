// Raid anomaly detection — shared by /parses (auto-hide foreign raids) and
// /admin/anomalies (officer review).
//
// "Foreign raid": a guildie pugging ANOTHER guild's raid uploads the fight via
// their agent, so it lands on Wolf Pack's parses even though almost no one in
// it is a Pack member (Hitya 2026-06-29: "Ikibob attended a morning Kael
// raid with a different guild and it all showed up on Wolfpack quest").
//
// Membership signal: presence in the `characters` roster (the OpenDKP mirror +
// Discord mapping, guild_id='wolfpack'). A pug from another guild isn't on our
// roster, so an encounter whose named players are mostly NOT on the roster is a
// foreign raid. (Per CLAUDE.md the strict membership predicate is narrower, but
// roster presence is the right practical test here — a different guild's raid
// shares almost no names with our roster.)

export type EncPlayer = { character_name: string; total_damage: number };

// Auto-HIDE threshold (public /parses). Deliberately conservative: a real guild
// raid runs ~85%+ members, so < 1/3 members can only be a foreign raid. The
// 34–50% "majority non-member" band is left visible and surfaced on
// /admin/anomalies for an officer to Mark Non-Guild manually.
export const AUTO_FOREIGN_MAX_MEMBER_FRAC = 0.34;
export const AUTO_FOREIGN_MIN_PLAYERS     = 10;
// Review threshold (/admin/anomalies) — the user's "majority not members" line.
export const REVIEW_FOREIGN_MAX_MEMBER_FRAC = 0.5;
export const REVIEW_FOREIGN_MIN_PLAYERS     = 6;

// Only count real, single-word player names toward the member fraction — drops
// pets / NPC attackers ("a cliff golem") and unknown ("—") rows.
function isPlayerName(name: string | null | undefined): boolean {
  return !!name && /^[A-Za-z]{2,}$/.test(name);
}

export type GuildShare = {
  players: number;        // real player rows counted
  members: number;        // of those, how many are on the roster
  nonMembers: string[];   // names NOT on the roster (the pug list)
  memberFrac: number;     // members / players (0 when no players)
};

// roster = lowercased Set of guild character names.
export function guildShare(players: EncPlayer[], roster: Set<string>): GuildShare {
  const real = players.filter(p => isPlayerName(p.character_name));
  let members = 0;
  const nonMembers: string[] = [];
  for (const p of real) {
    if (roster.has(p.character_name.toLowerCase())) members++;
    else nonMembers.push(p.character_name);
  }
  return {
    players: real.length,
    members,
    nonMembers,
    memberFrac: real.length ? members / real.length : 0,
  };
}

// True when an encounter should be auto-hidden from /parses as a foreign raid.
export function isAutoForeign(share: GuildShare): boolean {
  return share.players >= AUTO_FOREIGN_MIN_PLAYERS
      && share.memberFrac < AUTO_FOREIGN_MAX_MEMBER_FRAC;
}

// True when an encounter is worth surfacing on /admin/anomalies for review
// (majority non-member, but above the auto-hide bar OR just over the player
// floor) — the band an officer should eyeball.
export function isReviewForeign(share: GuildShare): boolean {
  return share.players >= REVIEW_FOREIGN_MIN_PLAYERS
      && share.memberFrac < REVIEW_FOREIGN_MAX_MEMBER_FRAC;
}

// ── Off-hours raid-target kills ─────────────────────────────────────────────
// Hitya 2026-08-09, after two morning pug raids landed on our board with
// inflated rosters: *"That's outside of our raid window on a current era mob.
// you can assume that those are not us."*
//
// Deliberately a REVIEW queue, not an auto-hide. Measured before building: 51
// current-era fights since April start outside the window, and most are
// genuinely ours — off-night Praesertum/Akheva runs at 70–100% roster. Hitya:
// *"Some smaller fights can be done with less people on a different timeframe
// (The Va`Dyn in Akheva Ruins comes to mind). Most of the fights that we do
// during our raids should be off limits and shouldn't count us."*
//
// So the signal that matters is not "outside the window" alone — it is
// "outside the window AND this is a mob we kill ON raid nights". A boss the
// guild only ever kills during raids, showing up at 09:00 on a Saturday, is
// the pug case. A boss that also gets killed off-night by six people is the
// legitimate case, and it ranks below.
export const OFFHOURS_MIN_PLAYERS = 10;

const RAID_DAYS  = new Set(['Sun', 'Wed', 'Thu']);
const SPILL_DAYS = new Set(['Mon', 'Thu', 'Fri']);   // post-midnight tail

/** ET wall-clock weekday + minutes for an encounter start. DST-correct. */
export function etPartsOf(iso: string): { day: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return { day: get('weekday'), minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
}

/** True inside Sun/Wed/Thu 19:30 ET → 00:30 ET — same bounds as the deploy freeze. */
export function startedInRaidWindow(iso: string): boolean {
  const { day, minutes } = etPartsOf(iso);
  if (RAID_DAYS.has(day) && minutes >= 19 * 60 + 30) return true;
  if (SPILL_DAYS.has(day) && minutes < 30) return true;
  return false;
}
