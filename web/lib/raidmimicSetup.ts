// The words of raidmimic.com/setup: how to set Mimic up for yourself when you are not in anyone's guild (the guild
// lead, 2026-10-21: "make a page on raidmimic.com for how to set up themselves"). Plain data, no JSX; the layout
// is web/app/raidmimic/setup/page.tsx and it carries no sentence of its own, so a fact is fixed in one place.
// test/raidmimic-setup.test.js reads this file as text and imports it.
//
// Written for a raider on a phone: plain words, one action per step. EverQuest terms are fine, code names are not.
//
// ⚠ The product name on this page is "Raid Mimic" (the page) and "Mimic" (the program). "Wolf Pack" appears ONCE,
// in CREDIT below, because the guild lead is weighing dropping it from the product name. Do not add it elsewhere
// (the web address wolfpack.quest/privacy is a link, not a name).
// ⚠ This repo is PUBLIC: no member, no character, no address of anyone's PC.

import { REPO_URL } from './eqmimicLanding';

// ─── Where things live ──────────────────────────────────────────────────────────────────────────────
// The stable release itself: the plain releases list opens on a run of betas (the guild lead, 2026-10-30).
export const RELEASES_URL = `${REPO_URL}/releases/latest`;
export const PRIVACY_URL = 'https://wolfpack.quest/privacy';
export const LANDING_PATH_ON_HOST = '/';                 // raidmimic.com/
export const LANDING_PATH_ON_WOLFPACK = '/raidmimic';    // wolfpack.quest/raidmimic

// ─── Header ─────────────────────────────────────────────────────────────────────────────────────────
export const TITLE = '[beta] Set up Raid Mimic';
export const DESCRIPTION =
  'A step-by-step guide to setting up Mimic on your own PC for EverQuest on Project Quarm, with no guild needed: what you need, what works on your own, and how to join a raid.';
export const BETA_NOTE = 'New page, a first draft, still being shaped.';

export const HERO = {
  kicker: 'Set up Raid Mimic',
  name: 'Set it up yourself',
  line: 'Mimic reads the log EverQuest already writes and draws overlays over the game. You do not need a guild, an account or a password to start.',
  fine: 'Six steps, about ten minutes. Everything stays on your PC until you choose otherwise.',
};

export const CREDIT = 'Made by the Wolf Pack guild on Project Quarm.';

// ─── The steps ──────────────────────────────────────────────────────────────────────────────────────
export interface Step {
  id: string;
  title: string;
  /** One plain sentence under the title. */
  lead: string;
  /** Short lines, each one thing to do or know. */
  items: string[];
  /** Optional link shown under the items. */
  link?: { label: string; href: string };
  /** Optional small-print note. */
  note?: string;
}

export const REQUIREMENTS = {
  title: 'What you need',
  items: [
    'A Windows PC.',
    'EverQuest on Project Quarm, with logging turned on. In the game, type /log on.',
    'Zeal is optional. A few overlays need it, and the guide says which.',
  ],
};

export const STEPS: Step[] = [
  {
    id: 'download',
    title: 'Download Mimic',
    lead: 'Get the newest release from the releases page and run the Windows installer.',
    items: [
      'Open the latest release: the link goes straight to the newest stable version.',
      'Download the Windows installer from the list of files under it and run it.',
      'The installer is not code-signed, so Windows may show a blue SmartScreen warning. Click More info, then Run anyway.',
      'If you already run PQ Companion, GINA or EQLogParser, leave them installed. They read the same log file and do not get in each other’s way.',
    ],
    link: { label: 'Open the latest release', href: RELEASES_URL },
    note: 'Install Mimic in its own folder, not inside your EverQuest folder. If Zeal is not found later, this is the first thing to fix.',
  },
  {
    id: 'first-run',
    title: 'First run: stay on your own PC',
    lead: 'Pick “Run local-only” and Mimic keeps everything on your PC.',
    items: [
      'Start Mimic. The welcome screen offers “Sign in with Discord” (for a guild that runs a hub) or “Run local-only for now”. Pick Run local-only.',
      'In local mode everything stays on your PC. Nothing is sent to any server.',
      'Log in to EverQuest and play. Mimic finds your character’s log by itself.',
    ],
    note: 'You can sign in to a guild later from Settings or the tray. Nothing you did before is lost.',
  },
  {
    id: 'on-your-own',
    title: 'What works on your own',
    lead: 'Most of Mimic needs no one else.',
    items: [
      'Overlays: the DPS meter, triggers with spoken alerts, timers, and the Canvas that holds them together.',
      'Inventory: on the dashboard open On this PC, then Inventory. In the game type /outputfile inventory first, so Mimic has a file to read.',
      'My replay: with Zeal connected, Mimic records where you stood and plays your night back on the zone map.',
      'My parses: your own fights, charted over a window you pick.',
      'Rebuild from my logs: if you played before you installed Mimic, this reads your old log files and fills in your fights.',
    ],
  },
  {
    id: 'join-a-raid',
    title: 'Joining someone else’s raid',
    lead: 'No guild account needed. A raid can use a short code instead.',
    items: [
      'On the dashboard open On this PC, then Join a raid with a code. Type the code the raid leader gave you. It works for 6 hours.',
      'When the night is over, save the raid file. It is one file, and it is yours to keep.',
      'Share that file with the raid leader or with a friend. They can merge it with theirs, and the merged file shows the night from every raider’s side.',
    ],
    note: 'Some of these screens come with Mimic 3.0. If you do not see On this PC on your dashboard, you have an older build: install the newest release.',
  },
  {
    id: 'for-a-guild',
    title: 'Running it for a guild',
    lead: 'A guild that wants one shared picture of its raids can have a hosted hub.',
    items: [
      'A hub gives a guild shared raid boards, flags and lockouts, loot, merged parses and the same overlays for everyone.',
      'The guild’s data is the guild’s. A player’s data is the player’s. Each member opts in, and signing out stops that player’s uploads at once.',
      'Hosting for other guilds is not built yet. The landing page says plainly which parts are which, and has a short form to register interest.',
    ],
    link: { label: 'See what a guild gets and register interest', href: '' },   // filled in by the page: the address differs by host
  },
  {
    id: 'privacy',
    title: 'Privacy, in plain words',
    lead: 'In local mode, your game stays on your PC.',
    items: [
      'Your logs, your chat, your tells, your inventory and your replays never leave your PC.',
      'Nothing is uploaded until you join a guild’s server yourself, and even then private chat (officer, group, custom channels, say, OOC, shout, auction) is dropped on your PC before anything is sent.',
      'The one thing that leaves your PC on purpose is a raid file you save and hand to someone yourself.',
      'Mimic checks GitHub for new versions of itself. That check sends no game data.',
      'There is no account to delete, because local mode has none. Uninstall Mimic and delete its folder, and it is gone.',
    ],
    link: { label: 'Read the full privacy page', href: PRIVACY_URL },
  },
];

// ─── Troubleshooting ────────────────────────────────────────────────────────────────────────────────
export interface Fix { id: string; problem: string; fix: string; note?: string }
export const TROUBLESHOOTING = {
  title: 'If something does not work',
  list: [
    {
      id: 'zeal-not-found',
      problem: 'Mimic cannot find Zeal at all.',
      fix: 'Reinstall Mimic in a folder outside your EverQuest folder. Mimic’s own files, or antivirus software that watches the game folder, can sometimes get in the way of Zeal when Mimic sits next to the game.',
      note: 'Mimic can still find your logs from inside the EverQuest folder. It is only Zeal that minds.',
    },
    {
      id: 'compat-mode',
      problem: 'Zeal never connects, and Mimic’s log keeps saying the Zeal pipe disconnected.',
      fix: 'Right-click eqgame.exe, open Properties, then the Compatibility tab, and untick Run this program in compatibility mode for. Restart the game.',
      note: 'Some guides tell you to run EverQuest in Windows XP compatibility mode to avoid crashes. That setting breaks the connection to Zeal. While you are on that tab, also check that Run this program as an administrator is off.',
    },
    {
      id: 'no-logs',
      problem: 'Mimic sees no character.',
      fix: 'In the game type /log on, then zone or send yourself a tell so the log gets a new line. Mimic reads eqlog files in your EverQuest Logs folder.',
    },
  ] as Fix[],
};

// ─── Footer pointers ────────────────────────────────────────────────────────────────────────────────
export const STILL_STUCK = {
  title: 'Still stuck?',
  body: 'The source code and every release are on GitHub, and the landing page has a short form that goes to people who read it.',
};
