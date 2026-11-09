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

// ── Signed-in home previews (the guild lead, 2026-11-09: "site looks barebones here") ─────────────────────────────────
// `?v=b` Dashboard and `?v=c` Get started, read on the Wolf Pack hosts only (a raidmimic host drops every query).

/** The preview a `?v=` value selects, or null for today's page. A raidmimic host never gets one: it drops the query anyway,
 *  and this keeps the answer the same if a query ever reached it. */
export function homeVariant(v: unknown, onHost: boolean): 'b' | 'c' | null {
  if (onHost) return null;
  return v === 'b' || v === 'c' ? v : null;
}

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

export const STEPS_WORDS = {
  title: 'Get started',
  done: 'Done',
  todo: 'To do',
  coming: 'Coming',
  signedIn: { title: 'Signed in with Discord', body: 'That is all it takes to have a Raid Mimic account.' },
  mimic: { title: 'Get Mimic', body: 'The free desktop app that reads your EverQuest log and draws the overlays.', button: 'Download Mimic' },
  characters: { title: 'Load your characters', body: 'Read your flags from Zeal’s PoPFlags file so Raid Mimic can tell you what each character needs next.', button: 'Load your characters' },
  guild: { title: 'Join or start a guild', body: 'Join with an invite code from an officer, or start a guild of your own.', join: 'Your guilds', start: 'Start a guild' },
  coordination: { title: 'Coordination', body: 'Finding flags and loot, and raids that fit your loot system.' },
  yourCharacters: 'Your characters',
} as const;

/** Pure: "Coming: looking for flags or loot · raids that fit ..." (one dim line, never a link). */
export function comingLine(items: readonly string[] = HOME_WORDS.coming): string {
  return `Coming: ${items.map(t => t.charAt(0).toLowerCase() + t.slice(1)).join(' · ')}`;
}

export type StepStatus = 'done' | 'todo' | 'coming';
export type StepKey = 'signedIn' | 'mimic' | 'characters' | 'guild' | 'coordination';

/** Pure: the five steps of the Get started list with their status. Mimic is always "to do" (a download cannot be seen from
 *  here); coordination is always "coming". */
export function checklistSteps(characterCount: number, guildCount: number): { n: number; key: StepKey; status: StepStatus }[] {
  const keys: [StepKey, StepStatus][] = [
    ['signedIn', 'done'],
    ['mimic', 'todo'],
    ['characters', characterCount > 0 ? 'done' : 'todo'],
    ['guild', guildCount > 0 ? 'done' : 'todo'],
    ['coordination', 'coming'],
  ];
  return keys.map(([key, status], i) => ({ n: i + 1, key, status }));
}

/** One line per guild for the home previews: the name, and the address of its own site when it has one (null otherwise). */
export type HomeGuild = { key: string; name: string; site: string | null };

/** Pure: the built-in guild first (its site is configuration, already cleaned by builtinGuildSite, passed in), then the hosted
 *  guilds in the order given. No import of guildSites here: HomePanelGate (a client component) imports this file. */
export function toHomeGuilds(wolf: { key: string; name: string } | null, hub: readonly { guild_id: string; name: string; site: string | null }[], wolfSiteUrl: string | null): HomeGuild[] {
  return [
    ...(wolf ? [{ key: wolf.key, name: wolf.name, site: wolfSiteUrl || null }] : []),
    ...hub.map(g => ({ key: g.guild_id, name: g.name, site: g.site })),
  ];
}
