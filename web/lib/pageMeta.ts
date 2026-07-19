// Per-page link-preview descriptions (Uilnayar 2026-07-08: shared links must
// unfurl with THAT page's description, not the site-wide one).
//
// Served to link-preview crawlers by /api/embed-meta (middleware rewrites
// bot user-agents there — crawlers can't sign in, so they never see the real
// pages). Add an entry when adding a member-facing route; unknown paths fall
// back to the site default.

export const SITE_NAME = 'WolfPack.quest';
export const DEFAULT_DESCRIPTION =
  'Guild-wide build planner, parse history, and loadout library for Project Quarm.';

const STATIC_META: Record<string, { title: string; description: string }> = {
  '/':             { title: 'WolfPack.quest', description: DEFAULT_DESCRIPTION },
  '/pop':          { title: 'PoP Flags (Preview)', description: 'The guild’s road to Quarm — every flag gate by tier, how many raiders hold each flag, who can enter each zone today, and what to raid next to move the most people forward.' },
  '/roster':       { title: 'Raid Roster', description: 'Typical raiders by role and class — 60-day raid attendance from DKP ticks, tanks/healers/DPS grouped, notable alts called out.' },
  '/parses':       { title: 'Boss Kills & Parses', description: 'Per-night kill cards with merged damage parses, loot, and attendance for every raid.' },
  '/boards':       { title: 'Raid Boards', description: 'Instanced boss cooldowns and spawn windows, by expansion — the live raid-target board.' },
  '/buffs':        { title: 'Buff Coverage', description: 'Who has what raid buffs right now — class-by-class coverage vs role targets, gaps flagged.' },
  '/who':          { title: '/who Directory', description: 'Every character sighted in game — class, level, guild, and last seen, searchable.' },
  '/pvp':          { title: 'PvP Kills', description: 'Wolf Pack PvP leaderboard — kills, assists, unique victims, and PvP-server boss timers.' },
  '/pvp/hate':     { title: 'Plane of Hate Tracker', description: 'PvP Plane of Hate tracker — kills, camps, and contested timers.' },
  '/pvp/server':   { title: 'Server PvP Top 10', description: 'Server-wide PvP kill leaders on Project Quarm.' },
  '/leaderboards': { title: 'Leaderboards', description: 'Top damage parses, raid attendance, and DKP spent — who’s been crushing it lately.' },
  '/fun':          { title: 'Fun Counters', description: 'The guild record book — running gags, counters, and trophies from the logs.' },
  '/rolls':        { title: 'Roll Nights', description: 'Off-night NBG loot rolls by raid night — every session, the winning roll, who actually looted each drop, and Hot Dice callouts.' },
  '/me':           { title: 'My Stats', description: 'Your characters, tells, buffs, and personal history — private to you.' },
  '/loadouts':     { title: 'Tank Loadouts', description: 'Bandolier sets across the raid — who runs what weapons and procs.' },
  '/planner':      { title: 'Loadout Planner', description: 'Theory-craft weapon setups from the item database with hate-per-minute estimates.' },
  '/bards':        { title: 'Bard Melodies', description: 'Live bard song rotations across the raid.' },
  '/raid':         { title: 'Live Raid', description: 'The raid right now — who’s in, groups, HP, and buffs, live from Zeal.' },
  '/mimic':        { title: 'Download Mimic', description: 'Mimic — the Wolf Pack desktop overlay: DPS HUD, triggers, buff queue, and log sync for Project Quarm.' },
  '/feedback':     { title: 'Feedback', description: 'Bugs, ideas, kudos — straight to the officer inbox.' },
  '/roadmap':      { title: 'Roadmap', description: 'What’s shipped and what’s next for the Wolf Pack platform.' },
};

export function metaForPath(rawPath: string): { title: string; description: string } {
  const path = (rawPath || '/').replace(/\/+$/, '') || '/';
  const hit = STATIC_META[path];
  if (hit) return hit;
  // Dynamic routes — give the entity name when it's in the URL.
  let m = path.match(/^\/character\/([^/]+)/);
  if (m) {
    const name = decodeURIComponent(m[1]);
    return { title: `${name} — Character`, description: `Character profile for ${name} — parses, stats, gear, and raid history.` };
  }
  m = path.match(/^\/boss\/([^/]+)/);
  if (m) {
    const name = decodeURIComponent(m[1]);
    return { title: `${name} — Boss`, description: `Kill history, spawn timers, and drops for ${name}.` };
  }
  if (/^\/parses\/[^/]+$/.test(path)) {
    return { title: 'Parse Breakdown', description: 'Per-player damage, abilities, and boss-kill comparison for one encounter.' };
  }
  if (path.startsWith('/admin')) {
    return { title: 'Officer Tools', description: 'Wolf Pack officer tools — sign-in required.' };
  }
  return { title: SITE_NAME, description: DEFAULT_DESCRIPTION };
}
