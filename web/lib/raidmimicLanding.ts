// The words and facts of the raidmimic.com landing page (the guild lead, 2026-10-18, option C, "two doors").
// eqmimic.quest stays the free EverQuest PLAYER tool; this page is the game-agnostic "raid orchestration and
// analytics as a service" pitch for GUILD LEADERS. It is a FIRST DRAFT: nothing here is settled copy.
//
// ONE content module, TWO layouts (web/app/raidmimic/_landing/): A "The pitch" (default) and B "The tour"
// (`?v=b`). The layouts decide order and shape; they never carry a sentence of their own, so a fact is
// corrected in exactly one place. Plain data, strings and a few pure helpers: no JSX. test/raidmimic-landing.test.js
// reads this file as text and imports it.
//
// RULE for every sentence below: say what exists, and say "coming" plainly for what does not. Each block and
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

// ─── What it does ───────────────────────────────────────────────────────────────────────────────────
// `aside` is the one sentence of "not yet" that belongs to that block, so a block can be live and still own up
// to the part that is coming.
export const BLOCKS_TITLE = 'What it does';
export const BLOCKS_LEAD = 'Six things, each marked with where it stands. Green runs today; a dashed orange tag is a plan.';
export interface Block { id: string; title: string; body: string; status: Status; aside?: string }
export const BLOCKS: Block[] = [
  {
    id: 'board', title: 'Shared raid boards', status: 'live',
    body: 'One board for the whole raid: what is up, what is down, when it spawns next. Every raider sees the same board, in Discord and on the web.',
    aside: 'Coming: the same board shared between guilds that raid together.',
  },
  {
    id: 'flags', title: 'Flags and lockouts at a glance', status: 'live',
    body: 'Who holds the flag to get in, who is locked out of a boss, and who can enter tonight’s zone. Answered before the pull, not after someone is pulled out of the zone.',
  },
  {
    id: 'loot', title: 'Loot and DKP', status: 'live',
    body: 'What dropped, who wants it, and where everyone stands, in one place. Works with OpenDKP today, with sealed bids.',
  },
  {
    id: 'parse', title: 'Parses from everyone’s view', status: 'live',
    body: 'One raider’s log sees part of a fight. Merged from every raider, you get one record of the fight: damage, healing, deaths and who was there.',
  },
  {
    id: 'review', title: 'Raid-night review and attendance', status: 'live',
    body: 'The morning-after summary of the night and who showed up, built from the same data.',
  },
  {
    id: 'overlays', title: 'Overlays: the on-screen half', status: 'live',
    body: 'Timers, damage meters, buff and debuff queues and trigger alerts drawn over the game, fed by the same shared data. Mimic is that half, and its player edition is free.',
    aside: 'In alpha: an overlay builder that lets you lay out your own panels.',
  },
];

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

// ─── The tour layout (B): screens first ─────────────────────────────────────────────────────────────
// `figure` names the CSS-only illustration in Tour.tsx. They are drawn, not captured: no screenshot is used, so
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

// ─── Rights and footer ──────────────────────────────────────────────────────────────────────────────
export { RIGHTS_NOTICE, FAN_PROJECT_LINE } from './eqmimicLanding';

// ─── Layout choice ──────────────────────────────────────────────────────────────────────────────────
export type Variant = 'a' | 'b';
/** `?v=b` shows B, the tour. Anything else (missing, `a`, junk, an array) shows A, the pitch. */
export function raidmimicVariant(v: string | string[] | undefined): Variant {
  const first = Array.isArray(v) ? v[0] : v;
  return typeof first === 'string' && first.trim().toLowerCase() === 'b' ? 'b' : 'a';
}

// ─── The inventory of promises ──────────────────────────────────────────────────────────────────────
// Everything the page says is coming, in one list. Shown on both layouts as "What is not built yet", and the
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
