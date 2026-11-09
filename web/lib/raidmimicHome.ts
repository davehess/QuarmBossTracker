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
