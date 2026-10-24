// The words of the raidmimic.com page's player-first story (the guild lead, 2026-10-23): "less about me setting it up as a
// service for them and more about here's what you get as a player, here's what you could have as a guild ... my
// intention is for you to use this yourself, but I can help you with a self-hosted version ... once you have enough
// of your guild actually using it, it is recommended that you either pay for hosting or you roll it out into your
// own instance."
//
// The guild lead picked "Pick your path" (2026-10-23, from two previews): three doors, Player, Guild and Self-host, each
// its own short story and next step, then "See it run" (the existing captures and clips) and "How it works" (the
// four-step scene). The Ladder preview and the earlier Scene-first layout were deleted.
//
// The page (web/app/raidmimic/_landing/PathsLayout.tsx) reads THIS module for the doors and the scene section, and
// web/lib/raidmimicLanding.ts for the facts the page has always stated (captures, clips, the small print, the coming
// list); a fact is corrected in one place. Plain data and strings: no JSX. test/raidmimic-landing.test.js reads this
// file as text and imports it.
//
// RULE for every sentence: say what runs today, and say "coming" plainly for what does not. Checked against:
//   free + local-only + no account ......... docs/HOW-ITS-BUILT.md "Local mode"; the button reads "Just me — stays on
//                                            this PC" in apps/mimic/welcome.html (the setup guide's "Run local-only" is older wording)
//   self-host is not turnkey, ~a day ....... web/lib/eqmimicLanding.ts NOT_FINISHED, docs/SELFHOSTING.md
//   hosting for other guilds, the guild lookup ... NOT built (docs/DECISIONS-2026-09-21.md §388), so the scene says coming
//   cost share, no uptime promise .......... docs/TERMS-hosted.md §1, §2, §4 (a DRAFT)
// No price is invented: the one dollar figure rides in on COST.scale from the content module.
//
// ⚠ This repo is PUBLIC. Nothing here names a member, a character, an id, a token or an address.

import { DOWNLOAD_PATH, WOLFPACK_ORIGIN, docUrl } from './eqmimicLanding';

export { docUrl };

// ─── Where the buttons go ───────────────────────────────────────────────────────────────────────────
// The installer is served by wolfpack.quest (the same direct link eqmimic.quest uses); on a Wolf Pack host it is a
// plain path, but an absolute address works on every host, so one constant serves both.
export const DOWNLOAD_URL = `${WOLFPACK_ORIGIN}${DOWNLOAD_PATH}`;
export const SELFHOST_GUIDE_URL = docUrl('docs/SELFHOSTING.md');

// ─── The hero ───────────────────────────────────────────────────────────────────────────────────────
export const HERO = {
  kicker: 'Raid Mimic · free for every player',
  name: 'Raid Mimic',
  fine: 'For Windows, free and open source. No guild, account or password needed to start.',
  download: 'Download Mimic for Windows',
  setup: 'Set it up yourself',
};

// ─── Tags (what a block needs from you) ─────────────────────────────────────────────────────────────
// 'free' is green (works today, for anyone), 'hub' is blue (needs the guild's own server), 'choice' is gold (your call).
// "Coming" is the page's StatusChip, so a promise looks the same everywhere.
export type Tone = 'free' | 'hub' | 'choice';
export const TAG: Record<Tone, string> = {
  free: 'Free · works today',
  hub: 'Needs your guild’s server',
  choice: 'Your call',
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

// ─── How it works: the four-step scene ──────────────────────────────────────────────────────────────
// An interactive isometric drawing (web/public/raidmimic/how/scene.html, ISO-GLOW, MIT) in a frame. It is a drawing, not a
// recording, so it says so. What it shows as not built (hosting for other guilds, the guild lookup) is labelled "coming"
// inside the drawing too; its words are in that file and test/raidmimic-landing.test.js holds them to this list.
export const HOW = {
  id: 'how',
  title: 'How it works',
  lead:
    'Four steps in one drawing. Start on one raider’s screen, then pull back to the raid, the raid leader’s review ' +
    'and the hub that runs it. Click it and press keys to play.',
  steps: ['Overlays', 'The raid', 'Raid leader', 'Hosting'],
  frameTitle:
    'How Raid Mimic works: an interactive drawing in four steps, from one raider’s overlays to the raid, ' +
    'the raid leader’s review and where the guild hub runs',
  src: '/raidmimic/how/scene.html',
  openLink: 'Open the drawing on its own page',
  note: 'A drawing, not a recording: the raiders in it are invented and its timers show the idea.',
};

// ─── The search card ────────────────────────────────────────────────────────────────────────────────
// The tab, the Google result and the Discord card (web/lib/pageMeta.ts has the same two strings: a test holds them equal).
// Player first, then what a guild can add, then free and open source. Facts only: no price, count or promise.
export const META = {
  title: 'Raid Mimic · free EverQuest raid overlays',
  description:
    'Free, open-source overlays for your EverQuest raids, built from the log the game already writes: ' +
    'run it on your own, or add a guild hub for shared raid reviews, merged parses and a command center.',
};

/** Every sentence the page's own story can put on the screen, for the sweeps in test/raidmimic-landing.test.js. */
export const ALL_TEXT = [HERO, PATHS, DOORS, TAG, ASK, HOW, META];
