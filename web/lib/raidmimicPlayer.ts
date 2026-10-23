// The words of the two raidmimic.com layout PREVIEWS (the guild lead, 2026-10-23): "less about me setting it up as a
// service for them and more about here's what you get as a player, here's what you could have as a guild ... my
// intention is for you to use this yourself, but I can help you with a self-hosted version ... once you have enough
// of your guild actually using it, it is recommended that you either pay for hosting or you roll it out into your
// own instance."
//
//   ?v=player  "Ladder"          one scroll, in the order the guild lead said it: player, jump in, guild, run it
//   ?v=paths   "Pick your path"  three doors (Player, Guild, Self-host), each its own short story and next step
//
// Both read THIS module and nothing else for their own sentences, so a fact is corrected in one place. The default page
// (no `?v=`) is untouched and still reads web/lib/raidmimicLanding.ts; its COMING inventory is the list of promises for
// the previews too, and every "coming" below names an entry in it. Plain data and strings: no JSX.
// test/raidmimic-landing.test.js reads this file as text and imports it.
//
// RULE for every sentence: say what runs today, and say "coming" plainly for what does not. Checked against:
//   free + local-only + no account ......... docs/HOW-ITS-BUILT.md "Local mode"; the button reads "Just me — stays on
//                                            this PC" in apps/mimic/welcome.html (the setup guide's "Run local-only" is older wording)
//   raid codes (six hours, kept on the PC) . docs/HOW-ITS-BUILT.md "Raid codes (3.8.48)", roadmapData 3.0
//   guild overlays need a hub .............. web/lib/eqmimicLanding.ts OVERLAYS (scope 'guild'), LOCAL_MODE
//   self-host is not turnkey, ~a day ....... web/lib/eqmimicLanding.ts NOT_FINISHED, docs/SELFHOSTING.md
//   cost share, no uptime promise .......... docs/TERMS-hosted.md §1, §2, §4 (a DRAFT)
// No price is invented: the one dollar figure rides in on COST.scale from the default page's own module.
//
// ⚠ This repo is PUBLIC. Nothing here names a member, a character, an id, a token or an address.

import { DOWNLOAD_PATH, WOLFPACK_ORIGIN, docUrl, LINUX_PATH } from './eqmimicLanding';

export { docUrl };

// ─── The switch ─────────────────────────────────────────────────────────────────────────────────────
export const VARIANTS = ['player', 'paths'] as const;
export type Variant = (typeof VARIANTS)[number];
export const VARIANT_LABEL: Record<Variant, string> = { player: 'Ladder', paths: 'Pick your path' };

/** The layout a `?v=` value asks for, or null for the page production shows. Unknown values and arrays are null. */
export function variantOf(v: unknown): Variant | null {
  return typeof v === 'string' && (VARIANTS as readonly string[]).includes(v) ? (v as Variant) : null;
}

export const PREVIEW_NOTE = 'Layout preview. Same facts, told a different way; pick one and the other goes.';

// ─── Where the buttons go ───────────────────────────────────────────────────────────────────────────
// The installer is served by wolfpack.quest (the same direct link eqmimic.quest uses); on a Wolf Pack host it is a
// plain path, but an absolute address works on every host, so one constant serves both.
export const DOWNLOAD_URL = `${WOLFPACK_ORIGIN}${DOWNLOAD_PATH}`;
export const LINUX_URL = `${WOLFPACK_ORIGIN}${LINUX_PATH}`;
export const SELFHOST_GUIDE_URL = docUrl('docs/SELFHOSTING.md');

// ─── The hero ───────────────────────────────────────────────────────────────────────────────────────
export const HERO = {
  kicker: 'Raid Mimic · free for every player',
  name: 'Raid Mimic',
  line:
    'Overlays for your raid, built from the log EverQuest already writes. ' +
    'Use it yourself today. Bring your guild along when you are ready.',
  fine: 'For Windows, free and open source. No guild, account or password needed to start.',
  download: 'Download Mimic for Windows',
  downloadNote: 'free · installs for your user only',
  setup: 'Set it up yourself',
  guildLink: 'For a guild',
  platformNote: 'Linux and Steam Deck is experimental: it works for some people and breaks for others.',
  platformLink: 'The experimental Linux build',
};

// ─── Tags (what a block needs from you) ─────────────────────────────────────────────────────────────
// 'free' is green (works today, for anyone), 'hub' is blue (needs the guild's own server), 'choice' is gold (your call).
// "Coming" is the default page's own StatusChip, so a promise looks the same everywhere.
export type Tone = 'free' | 'hub' | 'choice';
export const TAG: Record<Tone, string> = {
  free: 'Free · works today',
  hub: 'Needs your guild’s server',
  choice: 'Your call',
};

export interface Point { head: string; body: string }

// ─── 1. What you get as a player ────────────────────────────────────────────────────────────────────
export const PLAYER = {
  n: '1',
  id: 'player',
  tone: 'free' as Tone,
  title: 'What you get as a player',
  lead:
    'Raid Mimic reads your game log and draws small windows over EverQuest. Everything below runs on your own PC, ' +
    'and nothing is sent anywhere.',
  points: [
    { head: 'Overlays on your screen', body: 'Damage meters with pets counted under their owners, trigger alerts that speak, countdown timers, a Map and a roll tracker.' },
    { head: 'Your own layout', body: 'The Canvas holds your overlays on one screen layer. Pull any overlay into parts and put each part where you want it.' },
    { head: 'Your own records', body: 'Every character’s items in one place, a replay of where you stood each night, your own parses, and a rebuild of old raids from your old logs.' },
    { head: 'Keeps what you already use', body: 'PQ Companion, GINA and EQLogParser can stay installed. Triggers you already have as a GINA file can be imported.' },
  ] as Point[],
  aside: 'A few overlays fill in more when other raiders run Mimic too. They are in step 3.',
  mediaNote: 'Real overlays, drawn on made-up data: every raider name is invented.',
};

// ─── 2. Jump in now ─────────────────────────────────────────────────────────────────────────────────
// ⚠ "The one that is currently enabled for any user to jump into": there is no public guild hub today (the shared trial
// is in the COMING inventory), so this section describes only what anyone can use right now, and says so.
export const JUMP = {
  n: '2',
  id: 'jump-in',
  tone: 'free' as Tone,
  title: 'Jump in now',
  lead: 'Nothing to ask for and no one to wait on. This is what any player can do today.',
  steps: [
    { head: 'Download it', body: 'Free, for Windows. Install it in its own folder, not inside your EverQuest folder.' },
    { head: 'Stay on your own PC', body: 'On the first screen, choose the button that says Just me — stays on this PC. Nothing is sent to any server, and you can sign in to a guild later without losing anything.' },
    { head: 'Join someone else’s raid with a code', body: 'A raid leader gives you a short code. It works for six hours, your PC keeps the raid for you, and you can save it as a file.' },
    { head: 'Watch a shared raid', body: 'A guild can share a raid by link. Anyone with the link can watch it, with no sign-in.' },
  ] as Point[],
  guide: 'The step-by-step guide',
  comingHead: 'A shared hub anyone can sign into',
  comingBody:
    'A hub we run for a small group of guilds to try before they host their own. This is the shared trial, and it is not built yet. ' +
    'Today the only guild hub running is Wolf Pack’s, and it is for that guild’s members.',
};

// ─── 3. What your guild could have ──────────────────────────────────────────────────────────────────
export const GUILD = {
  n: '3',
  id: 'guild',
  tone: 'hub' as Tone,
  title: 'What your guild could have',
  lead:
    'When your raiders all run Mimic, it can add them up into one picture of the night. ' +
    'That needs one shared server for the guild, called a hub.',
  points: [
    { head: 'Raid review', body: 'After the night, one page for the raid: the bosses, the deaths, the loot and who was there.' },
    { head: 'Parses from every log', body: 'One fight merged from every raider’s view, so no single log decides the numbers.' },
    { head: 'CH chain', body: 'Every healer sees the same rotation: whose slot is up, who is mid-cast, and a warning the moment a heal is late.' },
    { head: 'Command Center', body: 'Who still needs to hail before the projection leaves, who the boss is rampaging, who needs a cure and which healer is low on mana.' },
    { head: 'Shared replay', body: 'Play the night back on the zone map with the boss kills along the top, and send anyone a link. Guests need no sign-in.' },
  ] as Point[],
  comingHead: 'A raid board across two guilds',
  comingBody: 'Two guilds, one raid, one board, each keeping its own roster. Not built yet.',
  mediaHead: 'The kill and the hail',
  mediaNote: 'The same overlays and boards, running today for one guild, on made-up data.',
};

// ─── 4. When your guild is using it ─────────────────────────────────────────────────────────────────
export const RUN = {
  n: '4',
  id: 'run-it',
  tone: 'choice' as Tone,
  title: 'When your guild is using it',
  lead:
    'Once enough of your guild runs Mimic, it is time for a hub of your own. There are two ways to get one: ' +
    'run it yourself, with help, or pay to have it hosted.',
  own: {
    head: 'Run your own',
    tag: 'Free software · you host it',
    points: [
      { head: 'Open source', body: 'Any guild can run its own copy for free, on a cloud account or on a PC at home. At home it costs electricity.' },
      { head: 'Not turnkey yet', body: 'The setup wizard is designed, not built. Your guild also builds its own copy of Mimic today, which is about a day of work.' },
      { head: 'We can help', body: 'Tell us you want help standing it up and we will.' },
    ] as Point[],
    guide: 'Read the self-hosting guide',
  },
  hosted: {
    head: 'Have it hosted',
    lead: 'We run it for your guild and you share the cost.',
    // Best effort, no uptime promise: docs/TERMS-hosted.md §2 (a draft).
    fine: 'Best effort, with no uptime guarantee. Hosting for other guilds is not built yet; a shared trial for a small group comes first.',
  },
};

export const ASK = {
  link: 'Ask for help standing it up',
  note: 'Opens a short form on eqmimic.quest.',
};

// ─── Pick your path: the three doors ────────────────────────────────────────────────────────────────
export interface Door {
  id: 'player' | 'guild' | 'selfhost';
  label: string;      // "Door 1 · I play"
  name: string;
  head: string;
  tone: Tone;
  story: string;
  points: string[];
  next: string;       // the next-step button
  nextNote?: string;
  more: string;       // the quiet second link
}
export const PATHS = {
  line: 'One program, three ways in. Pick the one that sounds like you.',
  doorsLabel: 'Three ways in',
  seeTitle: 'See it run',
  seeLead: 'The real overlays, on made-up raiders. Raiders get the screen; the people running the night get the board.',
};
export const DOORS: Door[] = [
  {
    id: 'player', label: 'Door 1 · I play', name: 'Player', head: 'Overlays for your own game', tone: 'free',
    story: 'Download it, choose Just me on the first screen, and play. It reads the log your game already writes.',
    points: [
      'Damage meters, timers, trigger alerts and a Map',
      'Your own inventory, replay and parses',
      'No guild, account or password',
    ],
    next: HERO.download,
    nextNote: 'Windows · free',
    more: HERO.setup,
  },
  {
    id: 'guild', label: 'Door 2 · My guild raids together', name: 'Guild', head: 'One picture of the night', tone: 'hub',
    story: 'Your raiders start on their own, free. When enough of them run it, a guild hub adds them up.',
    points: [
      'Raid review and parses merged from every log',
      'CH chain and Command Center for the whole raid',
      'A shared replay you can send by link',
    ],
    next: 'Ask about a hub',
    nextNote: 'Opens a short form',
    more: 'See what a guild gets',
  },
  {
    id: 'selfhost', label: 'Door 3 · We run our own', name: 'Self-host', head: 'Your own copy, with help', tone: 'choice',
    story: 'The code is open source, so your guild can run its own hub. It is not turnkey yet, and we will help.',
    points: [
      'Free software; the hosting bill is yours',
      'About a day of work to stand it up today',
      'Hosting it for you is coming, at cost',
    ],
    next: 'Read the self-hosting guide',
    nextNote: 'On GitHub',
    more: ASK.link,
  },
];

/** Every sentence these two layouts can put on the page, for the sweeps in test/raidmimic-landing.test.js. */
export const ALL_TEXT = [
  HERO, PLAYER, JUMP, GUILD, RUN, ASK, PATHS, DOORS, TAG, PREVIEW_NOTE,
];
