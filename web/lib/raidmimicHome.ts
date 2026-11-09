// Words for the raidmimic landing's big Skip and signed-in home panel (the guild lead, 2026-11-09: "a big skip video
// button at the top ... users log into it and have their information come up on the homepage ... a link 'rewatch the
// video' up top"; he picked the "Home panel" option the same day).

/** The hash the landing reads on the client to play the video. A raidmimic host drops every query string in
 *  middleware.ts, but a hash never leaves the browser, so it survives there. */
export const REWATCH_HASH = '#video';

/** localStorage key: set once a viewer has skipped the video, so they land past it next time. */
export const SKIP_KEY = 'rm-skipped-video';

export const HOME_WORDS = {
  skipBig: 'Skip video',
  rewatch: 'Rewatch the video',
  panelTitle: 'Your Raid Mimic',
  loadMore: 'Load more characters',
  empty: 'No characters loaded yet.',
  comingTitle: 'Coordination: coming',
  coming: [
    'Looking for flags or loot',
    'Raids that fit your loot system (need before greed, random rolls, DKP)',
    'Guilds recruiting your class',
    'Help on one character, get flagged on another',
  ],
} as const;

// ── The signed-in Dashboard (the guild lead, 2026-11-09: "site looks barebones here"; picked option B "Dashboard" on the
// Decision Desk the same day, over today's panel and a Get-started checklist). ─────────────────────────────────────────

export const DASH_WORDS = {
  welcome: 'Welcome back',
  characters: 'Your characters',
  charactersEmpty: 'No characters loaded yet. Load them from Zeal’s PoPFlags file and your flags and what you need next show up here.',
  charactersButton: 'Load your characters',
  charactersAll: 'All characters, and load more',
  guilds: 'Your guilds',
  guildsEmpty: 'You are not in a guild yet. Join one with an invite code, or start your own.',
  guildsManage: 'Manage your guilds',
  mimic: 'Mimic',
  mimicBlurb: 'Free overlays for your raids, built from the log the game already writes.',
  mimicButton: 'Download Mimic',
} as const;

/** Pure: "Coming: looking for flags or loot · raids that fit ..." (one dim line, never a link). */
export function comingLine(items: readonly string[] = HOME_WORDS.coming): string {
  return `Coming: ${items.map(t => t.charAt(0).toLowerCase() + t.slice(1)).join(' · ')}`;
}

/** One line per guild for the Dashboard: the name, and the address of its own site when it has one (null otherwise). */
export type HomeGuild = { key: string; name: string; site: string | null };

/** Pure: the built-in guild first (its site is configuration, already cleaned by builtinGuildSite, passed in), then the hosted
 *  guilds in the order given. No import of guildSites here: HomePanelGate (a client component) imports this file. */
export function toHomeGuilds(wolf: { key: string; name: string } | null, hub: readonly { guild_id: string; name: string; site: string | null }[], wolfSiteUrl: string | null): HomeGuild[] {
  return [
    ...(wolf ? [{ key: wolf.key, name: wolf.name, site: wolfSiteUrl || null }] : []),
    ...hub.map(g => ({ key: g.guild_id, name: g.name, site: g.site })),
  ];
}
