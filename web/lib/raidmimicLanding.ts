// The words and facts of the raidmimic.com landing page (the guild lead, 2026-10-18, option C, "two doors").
// eqmimic.quest stays the free EverQuest PLAYER tool; this page is the game-agnostic "raid orchestration and
// analytics as a service" pitch for GUILD LEADERS. It is a FIRST DRAFT: nothing here is settled copy.
//
// ONE content module, ONE layout (web/app/raidmimic/_landing/TourLayout.tsx, "The tour", the guild lead's pick
// of 2026-10-19). The layout decides order and shape; it never carries a sentence of its own, so a fact is
// corrected in exactly one place. Plain data, strings and a few pure helpers: no JSX. test/raidmimic-landing.test.js
// reads this file as text and imports it.
//
// RULE for every sentence below: say what exists, and say "coming" plainly for what does not. Each moment and
// each world carries a `status`; the `COMING` list at the bottom is the whole inventory of promises, and a
// test keeps the page honest about it. No prices, customer counts or testimonials are invented here.
//
// ⚠ This repo is PUBLIC. Nothing here names a member, a character, a real id, a token or an address. The
// illustrative boards and grids in the tour layout use placeholder labels (Guild One, Raider 1), not people.

import { REPO_URL } from './eqmimicLanding';

export { REPO_URL };

// ─── Where things live ──────────────────────────────────────────────────────────────────────────────
// The free player tool and the anonymous form both live on eqmimic.quest (raidmimic has no form of its own).
export const EQMIMIC_ORIGIN = 'https://eqmimic.quest';
export const EQMIMIC_FEEDBACK_PATH = '/eqmimic/feedback';   // the same form, on the wolfpack.quest hosts
export const PRIVACY_URL = 'https://wolfpack.quest/privacy';
export const SELFHOST_NOTE_URL = `${EQMIMIC_ORIGIN}/#hive`;

// ─── Status vocabulary ──────────────────────────────────────────────────────────────────────────────
// live   = running today for one guild (Wolf Pack, on Project Quarm)
// alpha  = built, in the alpha channel, not in anyone's stable install
// coming = not built; a plan
export type Status = 'live' | 'alpha' | 'coming';
export const STATUS_LABEL: Record<Status, string> = {
  live: 'Live today, for one guild',
  alpha: 'In alpha',
  coming: 'Coming',
};

// ─── Hero ───────────────────────────────────────────────────────────────────────────────────────────
export const HERO = {
  name: 'raidmimic',
  kicker: 'Raid orchestration and analytics, as a service',
  line:
    'One shared picture of your raid, built from the logs your raiders already write. ' +
    'For the person who has to run the night.',
  honest:
    'Today it runs for one guild, Wolf Pack, on Project Quarm. Running it for other guilds is coming, ' +
    'and this page says plainly which parts are which.',
  playerLine: 'Playing, not leading? The free player tool is Mimic, at eqmimic.quest.',
};

// ─── Works with what you already run ────────────────────────────────────────────────────────────────
export const WORKS_WITH = {
  title: 'Works with what you already run',
  lead:
    'PQ Companion, GINA and EQLogParser can stay installed and keep running. They read the game’s log file, ' +
    'and so does this, so there is nothing to uninstall and nothing to choose between.',
  tools: ['PQ Companion', 'GINA', 'EQLogParser'],
  extra: 'Triggers you already have as a GINA file can be imported.',
  rights: 'These tools belong to their makers. This project is not affiliated with them.',
};

// ─── The consent model ──────────────────────────────────────────────────────────────────────────────
export const DATA = {
  title: 'Your data stays yours',
  lead: 'Built so a raider can say yes, and say no again later.',
  points: [
    { head: 'Each member opts in', body: 'Nothing is uploaded until that member signs in.' },
    { head: 'Revoke any time', body: 'Signing out stops every upload from that player, at once.' },
    { head: 'Private chat stays on the PC', body: 'Officer, group, custom-channel, say, OOC, shout and auction chat is dropped on the player’s own machine before anything is sent. Tells are too, unless the player turns tell relay on.' },
    { head: 'Shown where it lives', body: 'A guild’s data stays in that guild’s own database. A shared board shows only what each guild chooses to put on it.' },
  ],
  aside: 'Opt-in, sign-out and the private-chat filter work today. Sharing between guilds is coming, and will follow the same rule.',
  link: 'Read the full privacy page',
};

// ─── What it costs ──────────────────────────────────────────────────────────────────────────────────
// ⚠ NO PRICE LIST. The one number is Wolf Pack's own measured hosting bill (docs/COSTS.md, September 2026), given
// as scale and labelled as not a quote. test/raidmimic-landing.test.js checks it still matches eqmimic's COSTS.
export const COST = {
  title: 'What it costs',
  lead: 'We price to recover what it costs to run it and to build it.',
  points: [
    { head: 'Hosting, passed through', body: 'Your guild runs on its own cloud account, so the hosting is billed by the provider to you, by the size of your guild, and the data lives in your name.' },
    { head: 'A small development share', body: 'A small amount on top, to keep building it.' },
    { head: 'A shared trial, to start', body: 'A small group of guilds can start on a shared trial that we run, then move to a cloud account of their own.' },
  ],
  trialStatus: 'coming' as Status,
  scale:
    'No price list yet. For a sense of scale only, Wolf Pack’s own hosting measured about $30 a month in September 2026. ' +
    'That is one guild’s bill, not a quote.',
  notTurnkey:
    'Standing up your own copy is not turnkey today: the setup wizard is designed, not built.',
  notTurnkeyLink: 'The honest list is on eqmimic.quest',
};

// ─── Any solved world ───────────────────────────────────────────────────────────────────────────────
export interface World { name: string; status: Status; note: string }
export const WORLDS = {
  title: 'Any solved world',
  lead:
    'A solved world is a game whose encounters, timers and rules are understood well enough to write down. ' +
    'EverQuest is the first. The same engine is meant to serve the others, which is why this page is not about one game.',
  list: [
    { name: 'EverQuest', status: 'live', note: 'On Project Quarm. This is what runs today.' },
    { name: 'Other EverQuest servers', status: 'coming', note: 'Project 1999, live EverQuest and other servers write the same log. Next.' },
    { name: 'Classic-era Warcraft', status: 'coming', note: 'Next, from the game\'s own combat log. Not built yet.' },
    { name: 'Monsters & Memories', status: 'coming', note: 'Waiting on the game: its rules forbid combat parsers today, and we have found no combat log to read.' },
  ] as World[],
  rights: 'Game names belong to their owners. This project is not affiliated with or endorsed by any of them.',
};

// ─── Register interest (no sales backend) ───────────────────────────────────────────────────────────
// There is no form of ours and no mailbox. The button opens the existing anonymous feedback form on
// eqmimic.quest as an Idea, with a short template in the box. The text rides the URL FRAGMENT (never the query
// string), exactly as Mimic does it: the form reads it and removes it from the address bar.
export const INTEREST_TEXT = 'raidmimic: register interest.\nGuild:\nGame:\nRoughly how many raiders:\n';
export const CTA = {
  title: 'Register interest',
  body:
    'There is no sales form and no account. Tell us your guild, your game and roughly how many raiders. ' +
    'Leave a Discord name in the form if you want a reply.',
  button: 'Register interest',
  note: 'Opens a short form on eqmimic.quest.',
};

/** The Register-interest address. `base` is the form’s own address on the host the page is being read on. */
export function interestUrl(base: string): string {
  return `${base}#${new URLSearchParams({ cat: 'idea', text: INTEREST_TEXT }).toString()}`;
}

// ─── The tour: screens first ─────────────────────────────────────────────────────────────
// `figure` names the CSS-only illustration in Figures.tsx. They are drawn, not captured: no screenshot is used, so
// nothing here can carry a real name.
export type FigureKey = 'boards' | 'flags' | 'parse' | 'builder';
export interface Moment { id: string; figure: FigureKey; title: string; line: string; status: Status }
export const MOMENTS: Moment[] = [
  { id: 'two-guilds', figure: 'boards', status: 'coming', title: 'A raid board across two guilds',
    line: 'Two guilds, one raid, one board: each sees what is up and what is down, and each keeps its own roster.' },
  { id: 'at-a-glance', figure: 'flags', status: 'live', title: 'Flags and lockouts at a glance',
    line: 'Your raiders against the gates and the bosses: who can zone in, who is locked out, who still needs a step.' },
  { id: 'a-parse', figure: 'parse', status: 'live', title: 'A parse built from every log',
    line: 'One fight, merged from every raider’s view, so no single log decides the numbers.' },
  { id: 'builder', figure: 'builder', status: 'alpha', title: 'The overlay builder',
    line: 'Lay out your own on-screen panels, meters, timers and queues, and put them where you want them.' },
];

export const ILLUSTRATIVE_NOTE = 'Drawn for this page, not screenshots. Labels are placeholders.';

// ─── Output first: the gallery (the `?v=b` layout, the guild lead, 2026-10-21) ──────────────────────
// "The raidmimic about page is lacking. We still want to show the output first. Anonymize names." So the preview
// layout opens on the real thing: captures of the running Mimic overlays, drawn from fixtures with invented
// player names (scripts/raidmimic-shots). Every one of these runs today for one guild, which is why the note
// below says so and no status chip is needed; the cross-guild board stays in MOMENTS, marked Coming.
//
// ⚠ PUBLIC. The captures hold game data (mobs, items, zones, spells) and invented raider names, never a member's
// character. test/raidmimic-landing.test.js checks each file exists, is small, and is the size given here.
export interface Shot {
  id: string;
  file: string;      // under web/public/raidmimic/shots
  w: number;         // the file's own pixel size (2x), for the width/height attributes
  h: number;
  title: string;     // the caption's name for the overlay
  line: string;      // one plain sentence: what it does for a raid
  alt: string;
  credit?: string;   // a rights line shown under the caption (the Map's walls come from a GPL project)
}
export const SHOTS_DIR = '/raidmimic/shots';
// Plane of Nightmares as the Map draws it. The wall lines are EQEmu-generated and credited as the spectator page credits
// them; Brewall's map lines (no stated licence, members only) are never used in a capture.
export const MAP_CREDIT = 'Generated walls: EQEmu maps (GPLv2+, © EQEmulator.NET, AX-Classic and ProjectEQ).';
export const SHOTS: Shot[] = [
  { id: 'map', file: 'map.webp', w: 2000, h: 1180, title: 'Map',
    line: 'Spawn timers on the map, where each mob walks and when it is back up, with your raid on it.',
    credit: MAP_CREDIT,
    alt: 'The Map overlay in Plane of Nightmares: spawn points with red aggro circles, a pulled mob whose circle has followed it away from its spawn point, the paths two mobs have walked, the player arrow and five raiders as dots, and a Timers list of engaged mobs, respawns that are up or due, mobs seen alive and a kill that is not pinned down yet.' },
  { id: 'cc', file: 'cc.webp', w: 960, h: 1358, title: 'Command Center',
    line: 'Who still needs to hail before the projection leaves, who the boss is rampaging, who needs a cure and which healer is low on mana.',
    alt: 'The Command Center overlay: the target’s health, a rampage warning, a hail board listing who still has to hail before the projection leaves in 18:50, a defensive cooldown, healer mana bars, curse and disease cure requests and the last two deaths.' },
  { id: 'target-stats', file: 'target-stats.webp', w: 1208, h: 688, title: 'Target Info, stats',
    line: 'Which debuffs are on the mob and who cast them, whether it is slowed, its resists, and how it hits.',
    alt: 'The Target Info overlay on a nightstalker: a slow timer, six observed debuffs with the caster and a draining bar each, armour class and resists, and chips for its special abilities.' },
  { id: 'target-quest', file: 'target-quest.webp', w: 1208, h: 802, title: 'Target Info, quests',
    line: 'For any quest NPC you target: what to say, what to hand in, and who to talk to next.',
    alt: 'The Target Info overlay on a quest NPC: the words to say with a copy button each, one answer opened, the item to hand in and what comes back, and the next NPC to find with a map line to copy.' },
  { id: 'dps', file: 'dps.webp', w: 1712, h: 800, title: 'Damage meters',
    line: 'The fight as bars or as a table, with each pet counted under its owner and your own row always on screen.',
    alt: 'Two damage overlays side by side: a ranked list of bars split into swings, procs and spells, and a table of damage, share, damage per second and seconds for each raider, with pets folded into their owners.' },
  { id: 'rolls', file: 'rolls.webp', w: 960, h: 852, title: 'Rolls',
    line: 'Every roll for every item, highest first, so a loot call is settled by the numbers.',
    alt: 'The Rolls card: six items being rolled for, each with its winner, and the first item opened to show all fifteen rolls ranked.' },
  { id: 'timeline', file: 'timeline.webp', w: 1520, h: 528, title: 'Boss timeline',
    line: 'When the next boss in a linked pair is due, counted from the last kill, with the timers that matter in between.',
    alt: 'The trigger overlay: three countdown timers and a timeline strip of recent boss deaths with the gap between them and a countdown to the next boss in the pair.' },
];
export const SHOTS_HEAD = {
  title: 'What the raid sees',
  note: 'These are the real Mimic overlays, running today for one guild, drawn here on made-up data: every raider name is invented.',
};
export const SETUP_LINK = { label: 'Set it up yourself', href: '/raidmimic/setup' };
export const FACTS_TITLE = 'The small print';

// ─── Rights and footer ──────────────────────────────────────────────────────────────────────────────
export { RIGHTS_NOTICE, FAN_PROJECT_LINE } from './eqmimicLanding';

// ─── The inventory of promises ──────────────────────────────────────────────────────────────────────
// Everything the page says is coming, in one list. Shown on the page as "What is not built yet", and the
// test fails if a status of 'coming' appears anywhere that this list does not name.
export const COMING: string[] = [
  'Running it for guilds other than Wolf Pack (multi-guild hosting).',
  'Raid boards shared between guilds.',
  'Sharing between guilds under the same opt-in rule.',
  'The shared trial for a small group of guilds.',
  'A setup wizard that stands a guild up on its own cloud account.',
  'Other EverQuest servers and classic-era Warcraft.',
  'Monsters & Memories, once its rules allow a combat parser.',
];
export const COMING_TITLE = 'What is not built yet';
