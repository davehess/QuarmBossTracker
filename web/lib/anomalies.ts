// Raid anomaly detection — shared by /parses (auto-hide foreign raids) and
// /admin/anomalies (officer review).
//
// "Foreign raid": a guildie pugging ANOTHER guild's raid uploads the fight via
// their agent, so it lands on Wolf Pack's parses even though almost no one in
// it is a Pack member (Uilnayar 2026-06-29: "Ikibob attended a morning Kael
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
