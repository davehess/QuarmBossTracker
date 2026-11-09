// Words and links for the raidmimic landing's skip / signed-in previews (the guild lead, 2026-11-09: "a big skip video
// button at the top ... users log into it and have their information come up on the homepage or redirect instead of hitting
// the video ... a link 'rewatch the video' up top"). Previews are `?v=b` (Doorway) and `?v=c` (Home panel) on the beta host.

/** The hash the landing reads on the client to play the video. A raidmimic host drops every query string in
 *  middleware.ts, but a hash never leaves the browser, so it survives there. */
export const REWATCH_HASH = '#video';

/** localStorage key: set once a viewer has skipped the video, so they land past it next time. */
export const SKIP_KEY = 'rm-skipped-video';

/** Where "Rewatch the video" goes. On a raidmimic host: the root plus the hash. On a Wolf Pack host the landing is
 *  /raidmimic, and `video=1` also tells the server not to redirect a signed-in Doorway visitor away from it. */
export function rewatchHref(onHost: boolean): string {
  return onHost ? `/${REWATCH_HASH}` : `/raidmimic?video=1${REWATCH_HASH}`;
}

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
